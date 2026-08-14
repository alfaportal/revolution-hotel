(function () {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const slug = parts[0] === "waiter" ? parts[1] : "";
  const urlParams = new URLSearchParams(window.location.search);
  const kitchenKey = urlParams.get("key") || "";
  let waiterToken = urlParams.get("w") || "";
  const returnUrl = urlParams.get("return") || "";
  const kasaSession = urlParams.get("kasa_session") || "";
  const WAITER_IDLE_MS = 300000;
  const WAITER_SESSION_KEY = slug ? `waiter_session_${slug}` : "waiter_session";

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js?v=16", { scope: "/waiter/" })
      .then((reg) => {
        reg.update?.();
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        reg.addEventListener?.("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              sw.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch(() => {});
  }

  function isMobileWaiter() {
    try {
      return window.matchMedia("(pointer: coarse)").matches
        || window.matchMedia("(max-width: 900px)").matches;
    } catch {
      return window.innerWidth < 900;
    }
  }

  let syncInProgress = false;
  let waiterEventSource = null;

  function apiQuery() {
    const parts = [];
    if (kitchenKey) parts.push(`key=${encodeURIComponent(kitchenKey)}`);
    if (waiterToken) parts.push(`w=${encodeURIComponent(waiterToken)}`);
    else if (activeWaiter?.id) parts.push(`waiter_id=${encodeURIComponent(activeWaiter.id)}`);
    return parts.length ? `?${parts.join("&")}` : "";
  }

  function dropInvalidWaiterTokenFromUrl() {
    if (!waiterToken) return;
    waiterToken = "";
    try {
      const p = new URLSearchParams(window.location.search);
      p.delete("w");
      const q = p.toString();
      const next = `${window.location.pathname}${q ? `?${q}` : ""}`;
      window.history.replaceState(null, "", next);
    } catch { /* ignore */ }
  }

  function apiHeaders(extra = {}) {
    return {
      "Content-Type": "application/json",
      ...(kitchenKey ? { "x-kitchen-key": kitchenKey } : {}),
      ...extra,
    };
  }

  let bootstrap = null;
  /** @type {{ id: string, name: string } | null} */
  let activeWaiter = null;
  let tableNumber = 0;
  let cart = [];
  let menuGroupFilter = "all";
  let pinDigits = [];
  let successToastTimer = null;
  let cartLinesBound = false;
  let idleTimer = null;
  let wakeLock = null;
  const reservationNotified = new Set();
  let reservationCheckTimer = null;

  // Njoftimi për porosi të reja (tingull + vibrim)
  let orderSnapshot = null;          // Map<tableNumber, itemCount> nga polling-u i mëparshëm
  let suppressOrderAlertOnce = false; // Anashkalon njoftimin për veprimin lokal të kamarierit
  let orderSubmitting = false;
  let tableClosing = false;
  let audioCtx = null;

  const $ = id => document.getElementById(id);

  // ---- Tingull + vibrim për porosi të reja ----
  function ensureAudioUnlocked() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    } catch { /* ignore */ }
  }

  function playOrderBeep() {
    ensureAudioUnlocked();
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      // Dy beep-e të shkurtra "ding-ding".
      [0, 0.22].forEach(offset => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, now + offset);
        osc.frequency.setValueAtTime(1175, now + offset + 0.09);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.2);
      });
    } catch { /* ignore */ }
  }

  function vibrateOrder() {
    // navigator.vibrate() punon në Android; iOS Safari s'e mbështet (thjesht injorohet).
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([200, 100, 200]);
      }
    } catch { /* ignore */ }
  }

  function playOrderAlert() {
    playOrderBeep();
    vibrateOrder();
  }

  function tableItemQtyTotal(t) {
    if (Array.isArray(t?.active_items) && t.active_items.length) {
      return t.active_items.reduce((s, i) => s + (Number(i.quantity) || 1), 0);
    }
    return t?.status === "occupied" ? 1 : 0;
  }

  /** Burimi i porosisë — nga emri i kamarierit në cloud (pa device_id). */
  function inferTableOrderSource(t) {
    const name = String(t?.waiter_name || "").trim();
    const lower = name.toLowerCase();
    if (lower.startsWith("takeaway") || lower.startsWith("delivery")) {
      return { code: "takeaway", label: "Takeaway", icon: "🥡" };
    }
    if (lower.startsWith("qr") || lower.startsWith("tavolin")) {
      return { code: "qr", label: "QR Code", icon: "📱" };
    }
    if (lower === "kiosk" || lower.startsWith("kiosk")) {
      return { code: "kiosk", label: "Kiosk", icon: "🪑" };
    }
    return { code: "pos", label: "POS", icon: "🖥️" };
  }

  function detectIncomingOrders(tables) {
    const snap = new Map();
    const list = tables || [];
    list.forEach(t => snap.set(Number(t.number), tableItemQtyTotal(t)));

    const newAlerts = [];
    if (orderSnapshot !== null) {
      snap.forEach((count, num) => {
        const prev = orderSnapshot.get(num) || 0;
        if (count > prev) {
          const tbl = list.find(x => Number(x.number) === num);
          const src = tbl ? inferTableOrderSource(tbl) : { label: "POS", icon: "🖥️" };
          newAlerts.push({ num, src, added: count - prev });
        }
      });
    }

    orderSnapshot = snap;

    if (suppressOrderAlertOnce) {
      suppressOrderAlertOnce = false;
      return;
    }
    if (!newAlerts.length) return;

    playOrderAlert();
    newAlerts.forEach(({ num, src, added }) => {
      const qty = added === 1 ? "1 artikull" : `${added} artikuj`;
      showSuccessToast(`🔔 T${num} — ${src.icon} ${src.label} · +${qty}`);
    });
  }

  function updateTablesLiveBar(tables) {
    const occupied = (tables || []).filter(t => t.status === "occupied").length;
    const onlinePending = (onlineSlots || []).filter(s => s.status === "pending").length;
    const onlineAccepted = (onlineSlots || []).filter(s => s.status === "accepted").length;
    const countEl = $("tables-order-count");
    if (countEl) {
      const parts = [];
      if (onlinePending > 0) {
        parts.push(onlinePending === 1 ? "1 online" : `${onlinePending} online`);
      } else if (onlineAccepted > 0) {
        parts.push(onlineAccepted === 1 ? "1 online pranuar" : `${onlineAccepted} online pranuar`);
      }
      if (occupied > 0) parts.push(occupied === 1 ? "1 tavolinë" : `${occupied} tavolina`);
      countEl.textContent = parts.length ? parts.join(" · ") : "0 porosi";
    }
    const liveBar = $("tables-live-bar");
    if (liveBar) liveBar.classList.toggle("has-online-pending", onlinePending > 0);
    const refreshedEl = $("tables-refreshed");
    if (refreshedEl) {
      const t = new Date().toLocaleTimeString("sq-AL", { hour: "2-digit", minute: "2-digit" });
      refreshedEl.textContent = `Rifreskuar: ${t}`;
    }
  }

  function waiterPayload() {
    if (!activeWaiter?.id) throw new Error("Sesioni i kamarierit ka skaduar. Shkruani PIN-in.");
    return {
      waiter_id: activeWaiter.id,
      waiter_name: activeWaiter.name,
    };
  }

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    $(id).classList.add("active");
  }

  function showErr(el, msg) {
    if (!el) return;
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = msg;
    el.classList.remove("hidden");
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function formatEuro(n) {
    return Number(n).toFixed(2) + " €";
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: apiHeaders(opts.headers || {}),
      ...opts,
    });
    let data = {};
    try { data = await res.json(); } catch { /* */ }
    if (!res.ok || data.ok === false) {
      if (res.status === 403 && data.code === "KITCHEN_KEY_INVALID") {
        throw new Error("Kodi i linkut (?key=...) nuk është i saktë. Kopjoni linkun e ri te paneli → Kamarierët → Kopjo.");
      }
      if (res.status === 403 && data.code === "PACKAGE_UPGRADE_REQUIRED") {
        throw new Error(data.gabim || "Plani juaj nuk përfshin modulin e kamarierit.");
      }
      throw new Error(data.gabim || `Gabim HTTP ${res.status}`);
    }
    return data;
  }

  function isNetworkError(err) {
    if (!navigator.onLine) return true;
    const msg = String(err?.message || err || "").toLowerCase();
    return msg.includes("failed to fetch") || msg.includes("network") || msg.includes("fetch");
  }

  function updateConnectionBadges() {
    document.querySelectorAll(".conn-status").forEach(el => {
      const online = navigator.onLine;
      el.textContent = online ? "Online" : "Offline";
      el.classList.toggle("is-online", online);
      el.classList.toggle("is-offline", !online);
    });
  }

  async function updatePendingIndicator() {
    if (!window.OfflineQueue) return;
    const count = await OfflineQueue.countPendingOrders(slug);
    const online = navigator.onLine;
    document.querySelectorAll(".conn-status").forEach(el => {
      const base = online ? "Online" : "Offline";
      el.textContent = count > 0 ? `${base} · ${count} pritje` : base;
      el.classList.toggle("is-online", online);
      el.classList.toggle("is-offline", !online);
    });
  }

  function setupConnectionStatus() {
    updateConnectionBadges();
    window.addEventListener("online", () => {
      updateConnectionBadges();
      syncPendingOrders().catch(() => {});
    });
    window.addEventListener("offline", () => {
      updateConnectionBadges();
      updatePendingIndicator().catch(() => {});
    });
    updatePendingIndicator().catch(() => {});
  }

  async function syncPendingOrders() {
    if (syncInProgress || !navigator.onLine || !window.OfflineQueue || !slug) return;
    syncInProgress = true;
    try {
      const result = await OfflineQueue.syncWaiterOrders({
        slug,
        fetchImpl: fetch,
        apiHeaders: () => apiHeaders(),
      });
      await updatePendingIndicator();
      if (result.synced > 0) {
        showSuccessToast(`✅ ${result.synced} porosi offline u sinkronizuan.`);
        await refreshBootstrap();
      }
    } finally {
      syncInProgress = false;
    }
  }

  function saveWaiterSession() {
    if (!activeWaiter || !slug) return;
    try {
      localStorage.setItem(WAITER_SESSION_KEY, JSON.stringify(activeWaiter));
    } catch { /* ignore */ }
  }

  function loadWaiterSession() {
    try {
      const raw = localStorage.getItem(WAITER_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function clearWaiterSession() {
    try {
      localStorage.removeItem(WAITER_SESSION_KEY);
    } catch { /* ignore */ }
  }

  async function enqueueOfflineOrder(orderUrl, payload, sentTable) {
    await OfflineQueue.enqueueWaiterOrder({
      slug,
      kitchenKey,
      waiterToken,
      url: orderUrl,
      body: payload,
    });
    cart = [];
    renderCart();
    showOrderMsg("", false);
    showSuccessToast(
      `📴 Porosia për T${sentTable} u ruajt offline — do të dërgohet kur kthehet interneti.`,
    );
    await updatePendingIndicator();
    scheduleIdleLock();
  }

  function renderPinDisplay() {
    const el = $("pin-display");
    if (!el) return;
    if (!pinDigits.length) {
      el.textContent = "••••";
      return;
    }
    el.textContent = pinDigits.map(() => "●").join(" ") + " ".repeat(Math.max(0, 3 - pinDigits.length) * 2);
  }

  function clearPin() {
    pinDigits = [];
    renderPinDisplay();
    showErr($("login-err"), "");
  }

  function appendPin(digit) {
    if (pinDigits.length >= 4) return;
    pinDigits.push(String(digit));
    renderPinDisplay();
    if (pinDigits.length === 4) {
      submitPinLogin();
    }
  }

  function backspacePin() {
    pinDigits.pop();
    renderPinDisplay();
  }

  function applyBranding(data) {
    const venue = data.restaurant_name || data.client_name || "Kamarieri";
    const location = data.address || data.client_name || "";

    const venueNameEl = $("login-venue-name");
    if (venueNameEl) venueNameEl.textContent = venue;

    const venueSubEl = $("login-venue-sub");
    if (venueSubEl) venueSubEl.textContent = location || "Kamarier — hyrje me PIN";

    const venueLogo = $("venue-logo");
    if (venueLogo) {
      if (data.logo_url) {
        venueLogo.src = data.logo_url;
        venueLogo.classList.remove("hidden");
      } else {
        venueLogo.classList.add("hidden");
        venueLogo.removeAttribute("src");
      }
    }

    $("tables-title").textContent = venue;
    document.title = `Kamarieri — ${venue}`;

    const barVenue = $("bar-venue-name");
    if (barVenue) barVenue.textContent = venue;
    const orderBarVenue = $("order-bar-venue");
    if (orderBarVenue) orderBarVenue.textContent = venue;
  }

  async function loadBootstrap() {
    if (!slug) throw new Error("URL i gabuar. Duhet /waiter/[slug]?key=...&w=...");
    if (!kitchenKey) {
      throw new Error("Mungon kodi i aksesit (?key=...) në link. Kopjoni linkun e plotë nga paneli → Kamarierët → Kopjo.");
    }
    try {
      bootstrap = await api(`/api/waiter/${encodeURIComponent(slug)}/bootstrap${apiQuery()}`);
      if (window.OfflineQueue) {
        await OfflineQueue.saveBootstrapCache(slug, kitchenKey, bootstrap);
      }
    } catch (e) {
      if (window.OfflineQueue) {
        const cached = await OfflineQueue.loadBootstrapCache(slug, kitchenKey);
        if (cached) {
          bootstrap = cached;
          applyBranding(bootstrap);
          const hint = $("sync-hint");
          if (hint) {
            hint.textContent = "Offline — menu e fundit e ruajtur lokalisht.";
          }
          return;
        }
      }
      throw e;
    }
    applyBranding(bootstrap);
    const hint = $("sync-hint");
    if (bootstrap.web_token_invalid && urlParams.get("w")) {
      dropInvalidWaiterTokenFromUrl();
      if (hint) {
        hint.textContent = "Linku personal ishte i vjetër — shkruani PIN-in. Merrni link të ri te Kamarierët → Kopjo.";
      }
    } else {
      if (bootstrap.assigned_waiter?.name) {
        const welcome = $("login-welcome");
        const sub = $("login-sub");
        if (welcome) welcome.textContent = `Mirë se vini, ${bootstrap.assigned_waiter.name}`;
        if (sub) sub.textContent = "Shkruani PIN-in tuaj (4 shifra) — vetëm për ju";
      }
      const parts = [];
      if (bootstrap.waiter_count != null) {
        parts.push(`${bootstrap.waiter_count} kamarierë me PIN`);
      }
      if (bootstrap.synced_at) {
        parts.push(`Menuja: ${new Date(bootstrap.synced_at).toLocaleString("sq-AL")}`);
      }
      if (bootstrap.waiter_count === 0) {
        if (hint) {
          hint.textContent =
            "Nuk ka PIN në cloud — në PC: Admin → Cloud → «Sinkronizo gjithçka» (pas vendosjes së PIN te Kamarierët).";
        }
      } else if (parts.length && hint) {
        hint.textContent = parts.join(" · ");
      } else if (hint) {
        hint.textContent = "Pronari shton kamarierët te paneli → Kamarierët.";
      }
    }
  }

  function escapeAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function sameWaiterId(a, b) {
    if (!a || !b) return false;
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  function showOrderMsg(msg, ok) {
    const el = $("cart-msg");
    if (!el) return;
    if (!msg) {
      el.textContent = "";
      el.className = "cart-msg hidden";
      return;
    }
    el.textContent = msg;
    el.className = "cart-msg " + (ok ? "ok" : "err");
  }

  function showSuccessToast(msg) {
    const el = $("success-toast");
    const msgEl = $("success-toast-msg");
    if (!el || !msgEl) return;
    if (successToastTimer) clearTimeout(successToastTimer);
    msgEl.textContent = msg;
    el.classList.remove("hidden");
    successToastTimer = setTimeout(() => {
      el.classList.add("hidden");
      msgEl.textContent = "";
    }, 4500);
  }

  /** Reliable tap/click for mobile — one action per gesture, blocks ghost click after touch. */
  function bindTap(el, handler, { preventTouchScroll = false } = {}) {
    if (!el || el.dataset.tapBound) return;
    el.dataset.tapBound = "1";
    let lastFire = 0;
    let suppressClickUntil = 0;
    const fire = (e, sourceEl) => {
      const now = Date.now();
      if (now - lastFire < 400) return;
      lastFire = now;
      return handler(e, sourceEl);
    };
    el.addEventListener("touchend", e => {
      const touch = e.changedTouches?.[0];
      const target = touch
        ? document.elementFromPoint(touch.clientX, touch.clientY)
        : e.target;
      if (!target || !el.contains(target)) return;
      suppressClickUntil = Date.now() + 600;
      const handled = fire(e, target);
      if (preventTouchScroll && handled !== false) e.preventDefault();
    }, { passive: false });
    el.addEventListener("click", e => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      fire(e, e.target);
    });
  }

  function getTableMeta(num) {
    return bootstrap?.tables?.find(t => Number(t.number) === Number(num));
  }

  function tableBillTotal(num) {
    const items = getTableMeta(num)?.active_items || [];
    return items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
  }

  function orderItemKey(it) {
    return `${String(it.name || "").trim()}|${Number(it.price) || 0}`;
  }

  /** Artikujt e plotë për mbyllje: tavolina aktive + çfarë ka ende në shportë. */
  function getCloseTableItems(num) {
    const map = new Map();
    for (const it of getTableMeta(num)?.active_items || []) {
      const key = orderItemKey(it);
      map.set(key, {
        name: String(it.name || "").trim(),
        price: Number(it.price) || 0,
        quantity: Number(it.quantity) || 1,
      });
    }
    for (const it of cart) {
      const key = orderItemKey(it);
      const prev = map.get(key);
      if (prev) prev.quantity += Number(it.quantity) || 1;
      else {
        map.set(key, {
          name: String(it.name || "").trim(),
          price: Number(it.price) || 0,
          quantity: Number(it.quantity) || 1,
        });
      }
    }
    return [...map.values()].filter(it => it.name && it.quantity > 0);
  }

  function canPayTable(num) {
    return (getTableMeta(num)?.active_items || []).length > 0;
  }

  function syncCartBarLayout() {
    const screen = $("screen-order");
    const bar = $("cart-bar");
    if (!screen || !bar) return;
    const hasCart = cart.length > 0;
    const showPay = tableNumber > 0 && canPayTable(tableNumber);
    const showBar = hasCart || showPay;
    screen.classList.toggle("has-cart", showBar);
    bar.classList.toggle("hidden", !showBar);
    if (showBar) {
      const h = Math.ceil(bar.getBoundingClientRect().height);
      screen.style.setProperty("--cart-bar-height", `${h}px`);
    } else {
      screen.style.removeProperty("--cart-bar-height");
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/</g, "&lt;");
  }

  function renderTableCard(t) {
    const reserved = Boolean(t.reserved || t.reservation);
    const lock = reserved ? '<span class="table-reserve-icon" aria-hidden="true">🔒</span>' : "";
    const reserveMeta = t.reservation
      ? `<span class="table-reserve-meta">${escapeHtml(t.reservation.time)} · ${t.reservation.guests}p</span>`
      : "";
    const cardClass = [t.status, reserved ? "reserved" : ""].filter(Boolean).join(" ");
    const isOccupied = t.status === "occupied";
    const itemCount = tableItemQtyTotal(t);
    const source = isOccupied ? inferTableOrderSource(t) : null;
    const statusPill = isOccupied
      ? '<span class="table-status-pill occupied">E zënë</span>'
      : reserved
        ? '<span class="table-status-pill reserved">Rezervuar</span>'
        : '<span class="table-status-pill free">E lirë</span>';
    const sourceBadge = source
      ? `<span class="table-source-badge source-${source.code}">${source.icon} ${source.label}</span>`
      : "";
    const stats = isOccupied
      ? `<div class="table-stats">
          <span class="table-stat">${itemCount === 1 ? "1 artikull" : `${itemCount} artikuj`}</span>
          <span class="table-stat table-total">${formatEuro(t.order_total || tableBillTotal(t.number))}</span>
        </div>`
      : reserved
        ? `<div class="table-stats">${reserveMeta}</div>`
        : "";

    return `
      <button type="button" class="table-card ${cardClass}" data-table="${t.number}">
        <div class="num">T${t.number}${lock}</div>
        ${statusPill}
        ${sourceBadge}
        <div class="meta">${stats}</div>
      </button>`;
  }

  function reservationDateTimeMs(r) {
    if (!r?.date || !r?.time) return NaN;
    return new Date(`${r.date}T${String(r.time).slice(0, 5)}:00`).getTime();
  }

  function checkReservationReminders() {
    const rows = bootstrap?.reservations || [];
    if (!rows.length || !activeWaiter) return;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    for (const r of rows) {
      if (reservationNotified.has(r.id)) continue;
      if (r.status === "cancelled") continue;
      const at = reservationDateTimeMs(r);
      if (!Number.isFinite(at)) continue;
      const diff = at - now;
      if (diff > 0 && diff <= windowMs) {
        reservationNotified.add(r.id);
        showSuccessToast(
          `🔒 Rezervim T${r.table_number}: ${r.customer_name} om ${String(r.time).slice(0, 5)} (${r.guests} persona)`,
        );
      }
    }
  }

  function setupReservationReminders() {
    if (reservationCheckTimer) clearInterval(reservationCheckTimer);
    checkReservationReminders();
    reservationCheckTimer = setInterval(checkReservationReminders, 60000);
  }

  function bindTableCards(root) {
    (root || $("tables-grid")).querySelectorAll("[data-table]").forEach(btn => {
      bindTap(btn, () => openOrder(Number(btn.dataset.table)));
    });
  }

  function onlineSlotItemCount(o) {
    return (o?.items_json || []).reduce((s, it) => s + (Number(it.quantity) || 1), 0);
  }

  function renderOnlineSlotCard(slot) {
    const label = escapeHtml(slot.label || `Online ${slot.slot}`);
    if (slot.status === "free" || !slot.order) {
      return `<button type="button" class="online-slot-card table-card free" data-online-slot="${slot.slot}" disabled tabindex="-1">
        <div class="num online-slot-label">${label}</div>
        <span class="table-status-pill free">Lirë</span>
      </button>`;
    }
    const o = slot.order;
    const pending = slot.status === "pending";
    const src = orderSourceMeta(o);
    const itemCount = onlineSlotItemCount(o);
    const total = orderItemsTotal(o);
    const customer = escapeHtml(String(o.waiter_name || "").trim() || "Klient");
    const cardClass = pending ? "pending-online pending-cloud" : "accepted-online occupied";
    const statusText = pending
      ? "Në pritje"
      : escapeHtml(String(o.accepted_by_waiter_name || "Pranuar").trim() || "Pranuar");
    const stats = `<div class="table-stats">
        <span class="table-stat">${itemCount === 1 ? "1 artikull" : `${itemCount} artikuj`}</span>
        <span class="table-stat table-total">${formatEuro(total)}</span>
      </div>`;
    return `<button type="button" class="online-slot-card table-card ${cardClass}"
        data-online-slot="${slot.slot}" data-order-id="${escapeHtml(o.id)}"${pending ? ' data-online-pending="1"' : ' data-online-accepted="1"'}>
      <div class="num online-slot-label">${label}</div>
      <span class="table-status-pill ${pending ? "pending-online-pill" : "occupied"}">${statusText}</span>
      <span class="table-source-badge source-warn">${src.icon} ${src.label}</span>
      <div class="meta">${stats}</div>
      <div class="online-slot-hint">${customer}</div>
      ${pending ? '<div class="online-slot-action">Kliko → PRANO / REFUZO</div>' : '<div class="online-slot-action">Kliko → Cash / Kartë</div>'}
    </button>`;
  }

  function renderOnlineZoneSection() {
    const slots = onlineSlots?.length ? onlineSlots : defaultOnlineSlots();
    const title = escapeHtml(onlineZoneTitle || "POROSI ONLINE");
    return `
      <section class="waiter-area-block waiter-online-zone">
        <h2 class="waiter-area-title">${title}</h2>
        <div class="tables-grid-area online-slots-grid">${slots.map(renderOnlineSlotCard).join("")}</div>
      </section>`;
  }

  function bindOnlineSlotCards(root) {
    (root || $("tables-grid")).querySelectorAll(".online-slot-card.pending-online[data-order-id]").forEach(btn => {
      bindTap(btn, () => {
        const slotNum = Number(btn.dataset.onlineSlot);
        const orderId = String(btn.dataset.orderId || "");
        const slot = (onlineSlots || []).find(s => Number(s.slot) === slotNum);
        if (!slot || slot.status !== "pending" || !slot.order) return;
        if (String(slot.order.id) !== orderId) return;
        renderAcceptModal(slot.order);
      });
    });
    (root || $("tables-grid")).querySelectorAll(".online-slot-card.accepted-online[data-order-id]").forEach(btn => {
      bindTap(btn, () => {
        const slotNum = Number(btn.dataset.onlineSlot);
        const orderId = String(btn.dataset.orderId || "");
        const slot = (onlineSlots || []).find(s => Number(s.slot) === slotNum);
        if (!slot || slot.status !== "accepted" || !slot.order) return;
        if (String(slot.order.id) !== orderId) return;
        const owner = foreignAcceptedOwner(slot.order.accepted_by_waiter_id, slot.order.accepted_by_waiter_name);
        if (owner) {
          showSuccessToast(`Kjo porosi i përket kamarierit ${owner}. Vetëm ai/ajo mund ta mbyllë.`);
          return;
        }
        renderOnlineCloseModal(slot.order, slot);
      });
    });
  }

  function kitchenPhotoUrl(item) {
    if (!item?.photo_url) return "";
    const url = String(item.photo_url);
    if (/^https?:\/\//i.test(url)) return url;
    // Static studio photos must not get ?key= (breaks some caches / proxies)
    if (url.startsWith("/menu-stock/")) return url;
    return url + apiQuery();
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function scheduleIdleLock() {
    clearIdleTimer();
    if (!activeWaiter) return;
    idleTimer = setTimeout(() => lockSession(), WAITER_IDLE_MS);
  }

  function setupWaiterIdleLock() {
    function onActivity() {
      if (activeWaiter) scheduleIdleLock();
    }
    ["pointerdown", "touchstart", "keydown", "click"].forEach(ev => {
      document.addEventListener(ev, onActivity, { passive: true, capture: true });
    });
    document.addEventListener("scroll", onActivity, { passive: true, capture: true });
    window.resetWaiterIdleLock = scheduleIdleLock;
  }

  function hideWaiterSplash() {
    $("waiter-splash")?.classList.add("hidden");
  }

  function setupDesktopReturn() {
    const btn = $("btn-back-desktop");
    if (!btn) return;
    if (returnUrl && /^https?:\/\//i.test(returnUrl)) {
      btn.classList.remove("hidden");
      btn.addEventListener("click", () => window.location.assign(returnUrl));
    }
  }

  function setupDesktopCalculatorBar() {
    const footer = $("waiter-desktop-footer");
    if (!footer) return;
    const desktopEmbed = Boolean(kasaSession || returnUrl) && !isMobileWaiter();
    if (desktopEmbed) {
      footer.classList.remove("hidden");
      document.body.classList.add("has-desktop-calc-footer");
    }
  }

  function bindCartLines() {
    const lines = $("cart-lines");
    if (!lines || cartLinesBound) return;
    cartLinesBound = true;
    bindTap(lines, (_e, target) => {
      const minus = target?.closest?.("[data-minus]");
      const plus = target?.closest?.("[data-plus]");
      if (minus) {
        const i = Number(minus.getAttribute("data-minus"));
        if (Number.isNaN(i) || !cart[i]) return;
        cart[i].quantity -= 1;
        if (cart[i].quantity <= 0) cart.splice(i, 1);
        renderCart();
        return;
      }
      if (plus) {
        const i = Number(plus.getAttribute("data-plus"));
        if (Number.isNaN(i) || !cart[i]) return;
        cart[i].quantity += 1;
        renderCart();
      }
    });
  }

  function renderTables() {
    const grid = $("tables-grid");
    if (!grid) return;
    const parts = [];
    const tables = bootstrap?.tables || [];
    if (!tables.length) {
      parts.push('<p class="hint">Nuk ka tavolina. Pronari shton hapësira te Lokal &amp; Stafi në panel.</p>');
    } else {
      const areas = bootstrap.areas?.filter(a => a.tables?.length) || [];
      if (areas.length > 1) {
        parts.push(areas.map(area => `
          <section class="waiter-area-block">
            <h2 class="waiter-area-title">${escapeHtml(area.name)}</h2>
            <div class="tables-grid-area">${area.tables.map(renderTableCard).join("")}</div>
          </section>`).join(""));
      } else {
        parts.push(`<div class="tables-grid-area">${tables.map(renderTableCard).join("")}</div>`);
      }
    }
    if (activeWaiter?.id) {
      parts.push(renderOnlineZoneSection());
    }
    grid.innerHTML = parts.join("");
    bindTableCards(grid);
    bindOnlineSlotCards(grid);
    updateTablesLiveBar(tables);
    renderPendingOnlineBanner();
  }

  /** Si paneli: kategoritë nga POS (sort_order), jo catOrder hardkoduar. */
  function orderedMenuCategories(menu) {
    const present = new Set((menu || []).map(m => String(m.category || "").trim()).filter(Boolean));
    const fromApi = (bootstrap?.categories || [])
      .map(c => String(c || "").trim())
      .filter(c => c && present.has(c));
    if (fromApi.length) {
      for (const c of present) {
        if (!fromApi.includes(c)) fromApi.push(c);
      }
      return fromApi;
    }
    return [...present];
  }

  /** Si paneli/seed: id (local_id) — Espresso… pastaj Çaj, jo alfabet me locale. */
  function menuSortedLikePanel(menu) {
    return (menu || []).slice().sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  }

  function renderMenu() {
    const menu = menuSortedLikePanel(bootstrap?.menu || []);
    const grid = $("menu-grid");
    if (!grid) return;
    if (!menu.length) {
      grid.innerHTML = '<p class="hint">Menuja është bosh. Pronari shton artikuj te Menuja në panel, ose sinkronizoni menuën nga POS-i lokal.</p>';
      return;
    }

    var tabBar = grid.parentElement.querySelector("#menu-cat-bar");
    if (!tabBar) {
      tabBar = document.createElement("div");
      tabBar.id = "menu-cat-bar";
      grid.parentElement.insertBefore(tabBar, grid);
    }
    var categories = orderedMenuCategories(menu);
    if (categories.length) {
      if (!categories.includes(menuGroupFilter)) menuGroupFilter = categories[0];
      var catKey = categories.join("\0");
      if (tabBar.dataset.catKey !== catKey) {
        tabBar.dataset.catKey = catKey;
        MenuPosUI.buildCategoryTabs(tabBar, categories, function(cat) {
          menuGroupFilter = cat;
          renderMenuItems();
        }, menuGroupFilter);
      }
    }
    renderMenuItems();
  }

  function renderMenuItems() {
    var menu = menuSortedLikePanel(bootstrap?.menu || []);
    var grid = $("menu-grid");
    if (!grid) return;
    MenuPosUI.renderMenuGrid({
      container: grid,
      menuItems: menu,
      groupFilter: menuGroupFilter,
      formatEuro: formatEuro,
      getPhotoUrl: kitchenPhotoUrl,
      onSelectItem: function(item, btn) {
        addToCart({
          id: item.id,
          name: item.name,
          price: Number(item.price),
        }, btn);
      },
    });
  }

  // Link personal i kamarierit: token valid në URL + kamarier i caktuar nga bootstrap.
  function hasPersonalWaiterLink() {
    return Boolean(waiterToken) && Boolean(bootstrap?.assigned_waiter?.id);
  }

  // ---- Pranimi i porosive (link personal — pa PIN) ----
  let acceptModalOrderId = null;
  const handledAcceptIds = new Set();
  let acceptPollTimer = null;
  let lastAlertedAcceptOrderId = null;
  /** Porosi QR/Takeaway/Delivery në pritje PRANO/REFUZO (nga /bar/orders). */
  let pendingAcceptOrders = [];
  /** Slotet Online 1…6 — sync nga cloud (/bar/orders). */
  let onlineSlots = [];
  let onlineZoneTitle = "POROSI ONLINE";

  function defaultOnlineSlots(count = 6) {
    return Array.from({ length: count }, (_, i) => ({
      slot: i + 1,
      label: `Online ${i + 1}`,
      status: "free",
      order: null,
    }));
  }

  function findOnlineSlotForOrder(orderId) {
    if (!orderId) return null;
    return (onlineSlots || []).find(s => s.order?.id === orderId) || null;
  }

  function syncOnlineSlotsFromPoll(data) {
    if (Array.isArray(data?.online_slots)) {
      onlineSlots = data.online_slots.length ? data.online_slots : defaultOnlineSlots();
      onlineZoneTitle = String(data.online_zone_title || "POROSI ONLINE").trim() || "POROSI ONLINE";
    } else {
      onlineSlots = defaultOnlineSlots();
    }
    if (onlineCloseOrderId) {
      const stillOpen = (onlineSlots || []).some(s =>
        s.order?.id === onlineCloseOrderId && s.status !== "free");
      if (!stillOpen) closeOnlineCloseModal();
    }
  }

  /** Pas poll — mbyll modal/slot të vjetër kur porosia u pranua ose mbyll remote. */
  function reconcileWaiterOrderState(orders) {
    if (acceptModalOrderId) {
      const current = (orders || []).find(o => o.id === acceptModalOrderId);
      const slot = findOnlineSlotForOrder(acceptModalOrderId);
      const accepted = !!(current?.accepted_at || String(current?.accepted_by_waiter_name || "").trim())
        || slot?.status === "accepted";
      const gone = !current && (!slot || slot.status === "free");
      if (accepted || gone) {
        handledAcceptIds.add(acceptModalOrderId);
        closeAcceptModal();
      }
    }
    if (lastAlertedAcceptOrderId) {
      const slot = findOnlineSlotForOrder(lastAlertedAcceptOrderId);
      const inOrders = (orders || []).find(o => o.id === lastAlertedAcceptOrderId);
      const stillPending = slot?.status === "pending"
        || (inOrders && !(inOrders.accepted_at || inOrders.accepted_by_waiter_name));
      if (!stillPending) lastAlertedAcceptOrderId = null;
    }
  }

  function isPendingAcceptOrder(o) {
    if (!o?.id) return false;
    if (o.accepted_at || String(o.accepted_by_waiter_name || "").trim()) return false;
    if (handledAcceptIds.has(o.id)) return false;
    if (isOrderFromCurrentWaiter(o)) return false;
    return true;
  }

  function syncPendingAcceptOrders(orders) {
    pendingAcceptOrders = (orders || []).filter(isPendingAcceptOrder);
    updateTablesLiveBar(bootstrap?.tables || []);
  }

  function renderPendingOnlineBanner() {
    const host = $("tables-online-banner");
    if (host) {
      host.classList.add("hidden");
      host.innerHTML = "";
    }
  }

  function canAcceptOrdersWithoutPin() {
    return Boolean(activeWaiter?.id) && Boolean(waiterToken) && Boolean(bootstrap?.assigned_waiter?.id);
  }

  function isOrderFromCurrentWaiter(o) {
    if (!activeWaiter || !o) return false;
    const oid = String(o.waiter_id || "").trim().toLowerCase();
    const oname = String(o.waiter_name || "").trim().toLowerCase();
    const myId = String(activeWaiter.id).trim().toLowerCase();
    const myName = String(activeWaiter.name).trim().toLowerCase();
    if (oid && oid === myId) return true;
    if (oname && myName && oname === myName) return true;
    const device = String(o.device_id || "").toUpperCase();
    if (device === "WEB-WAITER" && oid === myId) return true;
    return false;
  }

  /** Për porosi online (QR/Takeaway/Delivery) të pranuara: kthen emrin e kamarierit
   * që e pranoi nëse NUK jam unë, përndryshe null (mund ta mbyll). */
  function foreignAcceptedOwner(acceptedId, acceptedName) {
    const aid = String(acceptedId || "").trim().toLowerCase();
    const aname = String(acceptedName || "").trim();
    if (!aid && !aname) return null;
    const myId = String(activeWaiter?.id || "").trim().toLowerCase();
    const myName = String(activeWaiter?.name || "").trim().toLowerCase();
    if (aid && myId && aid === myId) return null;
    if (aname && myName && aname.toLowerCase() === myName) return null;
    return aname || "kamarieri tjetër";
  }

  async function autoAcceptOwnOrder(orderId) {
    if (!orderId || handledAcceptIds.has(orderId)) return;
    handledAcceptIds.add(orderId);
    try {
      await api(
        `/api/kds/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}/accept${apiQuery()}`,
        { method: "POST", body: JSON.stringify({}) },
      );
    } catch { /* pranim i heshtur — porosia e kamarierit */ }
  }

  function orderSourceMeta(o) {
    const device = String(o?.device_id || "").toUpperCase();
    const w = String(o?.waiter_name || "").trim().toLowerCase();
    if (device === "WEB-PUBLIC" || w.startsWith("takeaway") || w.startsWith("delivery")) {
      return { icon: "🥡", label: "Takeaway" };
    }
    if (device === "WEB-KIOSK" || w.startsWith("qr") || w.startsWith("tavolin")) {
      return { icon: "📱", label: "QR Code" };
    }
    if (w === "kiosk" || w.startsWith("kiosk")) {
      return { icon: "🪑", label: "Kiosk" };
    }
    return { icon: "🖥️", label: "POS" };
  }

  function orderTableLabel(o) {
    const device = String(o?.device_id || "").toUpperCase();
    if (device === "WEB-PUBLIC") {
      const w = String(o?.waiter_name || "").toLowerCase();
      if (w.startsWith("delivery")) return "Delivery";
      if (w.startsWith("takeaway")) return "Takeaway";
      return "Online";
    }
    return `T${o?.table_number || "?"}`;
  }

  function orderItemsTotal(o) {
    if (o?.total != null) return Number(o.total) || 0;
    return (o?.items_json || []).reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0);
  }

  function renderAcceptOrderItem(it) {
    const qty = Number(it.quantity) || 1;
    const price = Number(it.price) || 0;
    const lineTotal = price * qty;
    return `<li>
      <span class="qty">${qty}×</span>
      <span class="item-name">${escapeHtml(it.name)}</span>
      <span class="item-price">${formatEuro(price)}${qty > 1 ? ` <small>= ${formatEuro(lineTotal)}</small>` : ""}</span>
    </li>`;
  }

  function acceptWaiterAuthBody() {
    const body = {};
    if (!waiterToken && activeWaiter?.id) body.waiter_id = activeWaiter.id;
    return body;
  }

  function setupAcceptModalButtons() {
    bindTap($("accept-modal-accept"), () => {
      if (!acceptModalOrderId) return;
      acceptIncomingOrder(acceptModalOrderId, $("accept-modal-accept"));
    });
    bindTap($("accept-modal-refuse"), () => {
      if (!acceptModalOrderId) return;
      refuseIncomingOrder(acceptModalOrderId, $("accept-modal-refuse"));
    });
  }

  function setupOnlineCloseModalButtons() {
    bindTap($("online-close-modal-cash"), () => {
      if (!onlineCloseOrderId) return;
      const slot = (onlineSlots || []).find(s => s.order?.id === onlineCloseOrderId);
      if (!slot?.order) return;
      closeOnlineAcceptedOrder(slot.order, "cash", $("online-close-modal-cash"), $("online-close-modal-card"));
    });
    bindTap($("online-close-modal-card"), () => {
      if (!onlineCloseOrderId) return;
      const slot = (onlineSlots || []).find(s => s.order?.id === onlineCloseOrderId);
      if (!slot?.order) return;
      closeOnlineAcceptedOrder(slot.order, "karte", $("online-close-modal-cash"), $("online-close-modal-card"));
    });
  }

  function closeAcceptModal() {
    acceptModalOrderId = null;
    const modal = $("accept-modal");
    if (modal) {
      modal.classList.add("hidden");
      modal.setAttribute("hidden", "");
    }
  }

  function renderAcceptModal(o) {
    const modal = $("accept-modal");
    if (!modal || !o) return;
    acceptModalOrderId = o.id;
    const src = orderSourceMeta(o);
    const srcName = String(o.waiter_name || "").trim();
    $("accept-modal-source").innerHTML = `${src.icon} ${src.label}${srcName ? ` · ${escapeHtml(srcName)}` : ""}`;
    $("accept-modal-table").textContent = orderTableLabel(o);
    $("accept-modal-items").innerHTML =
      (o.items_json || []).map(renderAcceptOrderItem).join("") || "<li>—</li>";
    $("accept-modal-total").textContent = formatEuro(orderItemsTotal(o));

    const acceptBtn = $("accept-modal-accept");
    const refuseBtn = $("accept-modal-refuse");
    if (acceptBtn) {
      acceptBtn.disabled = false;
      acceptBtn.textContent = "PRANO";
    }
    if (refuseBtn) {
      refuseBtn.disabled = false;
      refuseBtn.textContent = "REFUZO";
    }
    modal.classList.remove("hidden");
    modal.removeAttribute("hidden");
  }

  async function maybeShowAcceptModal(orders) {
    if (acceptModalOrderId) {
      const current = (orders || []).find(o => o.id === acceptModalOrderId);
      const slot = findOnlineSlotForOrder(acceptModalOrderId);
      const accepted = !!(current?.accepted_at || String(current?.accepted_by_waiter_name || "").trim())
        || slot?.status === "accepted";
      const gone = !current && (!slot || slot.status === "free");
      if (accepted || gone) {
        handledAcceptIds.add(acceptModalOrderId);
        closeAcceptModal();
      }
    }

    const pending = (orders || []).filter(o => {
      if (o.accepted_at || o.accepted_by_waiter_name || handledAcceptIds.has(o.id)) return false;
      const slot = findOnlineSlotForOrder(o.id);
      if (slot && slot.status !== "pending") return false;
      return true;
    });

    const own = pending.filter(isOrderFromCurrentWaiter);
    const external = pending.filter(o => !isOrderFromCurrentWaiter(o));

    for (const o of own) {
      await autoAcceptOwnOrder(o.id);
    }

    if (!external.length) {
      closeAcceptModal();
      lastAlertedAcceptOrderId = null;
      return;
    }
    const next = external[0];
    const hasPendingOnlineSlots = (onlineSlots || []).some(s => s.status === "pending");
    if (hasPendingOnlineSlots) {
      if (lastAlertedAcceptOrderId !== next.id) {
        lastAlertedAcceptOrderId = next.id;
        playOrderAlert();
        const src = orderSourceMeta(next);
        showSuccessToast(`🥡 Porosi e re — ${src.icon} ${orderTableLabel(next)}`);
      }
      return;
    }
    if (acceptModalOrderId === next.id) return;
    renderAcceptModal(next);
    playOrderAlert();
  }

  async function acceptIncomingOrder(orderId, btn, orderForReceipt) {
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    try {
      const data = await api(
        `/api/kds/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}/accept${apiQuery()}`,
        { method: "POST", body: JSON.stringify(acceptWaiterAuthBody()) },
      );
      handledAcceptIds.add(orderId);
      closeAcceptModal();
      showSuccessToast(data.accepted_by
        ? `✅ Porosia u pranua — ${data.accepted_by}`
        : "✅ Porosia u pranua.");
      await pollIncomingOrders();
      await refreshBootstrap();
    } catch (e) {
      showSuccessToast(e.message || "Nuk u pranua porosia.");
      if (btn) { btn.disabled = false; btn.textContent = "PRANO"; }
    }
  }

  function pickRefuseReason() {
    return new Promise((resolve) => {
      const existing = document.getElementById("refuse-reason-modal");
      if (existing) existing.remove();
      const presets = [
        "Shumë i zënë",
        "Mungon artikulli",
        "Mbyllje / pushim",
        "Tavolina e gabuar",
      ];
      const wrap = document.createElement("div");
      wrap.id = "refuse-reason-modal";
      wrap.setAttribute("role", "dialog");
      wrap.style.cssText = "position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:1rem;";
      wrap.innerHTML = `
        <div style="background:#fff;border-radius:14px;max-width:340px;width:100%;padding:1rem 1.1rem;box-shadow:0 12px 40px rgba(0,0,0,.25)">
          <h3 style="margin:0 0 .75rem;font-size:1.1rem">Pse e refuzoni?</h3>
          <div id="refuse-reason-btns" style="display:flex;flex-direction:column;gap:.45rem"></div>
          <input id="refuse-reason-other" type="text" maxlength="300" placeholder="Arsye tjetër…"
            style="width:100%;margin-top:.65rem;padding:.55rem .7rem;border:1px solid #d1d5db;border-radius:8px;font-size:.95rem;box-sizing:border-box" />
          <div style="display:flex;gap:.5rem;margin-top:.85rem">
            <button type="button" id="refuse-reason-cancel" style="flex:1;padding:.65rem;border:none;border-radius:8px;background:#e5e7eb;font-weight:600">Anulo</button>
            <button type="button" id="refuse-reason-ok" style="flex:1;padding:.65rem;border:none;border-radius:8px;background:#dc2626;color:#fff;font-weight:700">REFUZO</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      let chosen = "";
      const btns = wrap.querySelector("#refuse-reason-btns");
      presets.forEach((label) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.cssText = "padding:.65rem;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;font-weight:600;text-align:left";
        b.onclick = () => {
          chosen = label;
          wrap.querySelector("#refuse-reason-other").value = "";
          btns.querySelectorAll("button").forEach((x) => { x.style.borderColor = "#e5e7eb"; x.style.background = "#f9fafb"; });
          b.style.borderColor = "#dc2626";
          b.style.background = "#fef2f2";
        };
        btns.appendChild(b);
      });
      const finish = (val) => { wrap.remove(); resolve(val); };
      wrap.querySelector("#refuse-reason-cancel").onclick = () => finish(null);
      wrap.querySelector("#refuse-reason-ok").onclick = () => {
        const other = String(wrap.querySelector("#refuse-reason-other").value || "").trim();
        finish(other || chosen || "Pa arsye");
      };
      wrap.addEventListener("click", (e) => { if (e.target === wrap) finish(null); });
    });
  }

  async function refuseIncomingOrder(orderId, btn) {
    const reason = await pickRefuseReason();
    if (reason == null) return;
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    const refuseUrl = `/api/kds/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}/refuse${apiQuery()}`;
    console.log("[waiter] REFUZO click", { orderId, url: refuseUrl, reason });
    try {
      const body = { ...acceptWaiterAuthBody(), reason };
      const data = await api(refuseUrl, { method: "POST", body: JSON.stringify(body) });
      console.log("[waiter] REFUZO response", {
        orderId,
        refuse_mode: data.refuse_mode,
        status: data.status,
        refused_at: data.order?.refused_at,
        order_expires_at: data.order?.order_expires_at,
        refuse_reason: data.refuse_reason || reason,
      });
      if (data.refuse_mode !== "grace_v2") {
        console.warn("[waiter] REFUZO: server nuk përdor grace_v2 — redeploy i nevojshëm!");
      }
      handledAcceptIds.add(orderId);
      closeAcceptModal();
      showSuccessToast("Porosia kaloi te kamarierët e tjerë — 2 minuta për ta pranuar.");
      await pollIncomingOrders();
    } catch (e) {
      console.error("[waiter] REFUZO error", { orderId, error: e.message });
      showSuccessToast(e.message || "Nuk u refuzua porosia.");
      if (btn) { btn.disabled = false; btn.textContent = "REFUZO"; }
    }
  }

  let onlineCloseOrderId = null;

  function closeOnlineCloseModal() {
    onlineCloseOrderId = null;
    const modal = $("online-close-modal");
    if (modal) {
      modal.classList.add("hidden");
      modal.setAttribute("hidden", "");
    }
  }

  function renderOnlineCloseModal(o, slot) {
    const modal = $("online-close-modal");
    if (!modal || !o?.id) return;
    onlineCloseOrderId = o.id;
    const src = orderSourceMeta(o);
    const srcName = String(o.waiter_name || "").trim();
    const slotLabel = slot?.label || `Online ${slot?.slot || "?"}`;
    $("online-close-modal-title").textContent = slotLabel;
    $("online-close-modal-source").innerHTML = `${src.icon} ${src.label}${srcName ? ` · ${escapeHtml(srcName)}` : ""}`;
    $("online-close-modal-items").innerHTML =
      (o.items_json || []).map(renderAcceptOrderItem).join("") || "<li>—</li>";
    $("online-close-modal-total").textContent = formatEuro(orderItemsTotal(o));

    const cashBtn = $("online-close-modal-cash");
    const cardBtn = $("online-close-modal-card");
    if (cashBtn) {
      cashBtn.disabled = false;
      cashBtn.textContent = "Cash";
    }
    if (cardBtn) {
      cardBtn.disabled = false;
      cardBtn.textContent = "Kartë";
    }
    modal.classList.remove("hidden");
    modal.removeAttribute("hidden");
  }

  async function closeOnlineAcceptedOrder(order, paymentMethod, btnCash, btnCard) {
    if (!order?.id || tableClosing) return;
    const owner = foreignAcceptedOwner(order.accepted_by_waiter_id, order.accepted_by_waiter_name);
    if (owner) {
      closeOnlineCloseModal();
      showSuccessToast(`Kjo porosi i përket kamarierit ${owner}. Vetëm ai/ajo mund ta mbyllë.`);
      return;
    }
    tableClosing = true;
    const prevCash = btnCash?.textContent || "Cash";
    const prevCard = btnCard?.textContent || "Kartë";
    if (btnCash) { btnCash.disabled = true; btnCard.disabled = true; }
    if (paymentMethod === "cash" && btnCash) btnCash.textContent = "…";
    if (paymentMethod === "karte" && btnCard) btnCard.textContent = "…";
    try {
      const closeItems = (order.items_json || []).map(it => ({
        name: it.name,
        quantity: Number(it.quantity) || 1,
        price: Number(it.price) || 0,
      }));
      const data = await api(`/api/waiter/${encodeURIComponent(slug)}/orders/close${apiQuery()}`, {
        method: "POST",
        body: JSON.stringify({
          ...waiterPayload(),
          order_id: order.id,
          table_number: 0,
          payment_method: paymentMethod,
          items: closeItems,
        }),
      });
      closeOnlineCloseModal();
      const payLabel = paymentMethod === "karte" ? "Kartë" : "Cash";
      showSuccessToast(`✅ ${orderTableLabel(order)} u mbyll — ${payLabel}`);
      if (data.receipt) showReceipt(data.receipt);
      await pollIncomingOrders();
      await refreshBootstrap();
      scheduleIdleLock();
    } catch (e) {
      showSuccessToast(e.message || "Nuk u mbyll porosia.");
      if (btnCash) { btnCash.disabled = false; btnCash.textContent = prevCash; }
      if (btnCard) { btnCard.disabled = false; btnCard.textContent = prevCard; }
    } finally {
      tableClosing = false;
    }
  }

  async function pollIncomingOrders() {
    if (!activeWaiter?.id || !slug || !kitchenKey) return;
    try {
      const pollUrl = `/api/kds/${encodeURIComponent(slug)}/bar/orders${apiQuery()}`;
      const data = await api(pollUrl);
      const orders = data.orders || [];
      console.log("[waiter] accept poll", {
        count: orders.length,
        pendingAccept: orders.filter(isPendingAcceptOrder).length,
        onlineSlots: (data.online_slots || []).filter(s => s.status !== "free").length,
        grace: orders.filter(o => o.refused_at).length,
        ids: orders.map(o => o.id),
      });
      syncOnlineSlotsFromPoll(data);
      syncPendingAcceptOrders(orders);
      reconcileWaiterOrderState(orders);
      await maybeShowAcceptModal(orders);
      renderTables();
    } catch (e) {
      console.warn("[waiter] accept poll failed", e.message);
    }
  }

  function startAcceptPolling() {
    if (acceptPollTimer) clearInterval(acceptPollTimer);
    if (!activeWaiter?.id) return;
    pollIncomingOrders();
    acceptPollTimer = setInterval(() => pollIncomingOrders(), 3000);
  }

  function stopAcceptPolling() {
    if (acceptPollTimer) {
      clearInterval(acceptPollTimer);
      acceptPollTimer = null;
    }
    closeAcceptModal();
  }

  async function refreshWaiterLiveState() {
    if (!activeWaiter?.id) return;
    try {
      await pollIncomingOrders();
      await refreshBootstrap();
    } catch { /* SSE refresh — poll/bootstrap log own errors */ }
  }

  let sseReconnectTimer = null;
  function connectWaiterSse() {
    if (!slug || !kitchenKey || typeof EventSource === "undefined") return;
    if (sseReconnectTimer) {
      clearTimeout(sseReconnectTimer);
      sseReconnectTimer = null;
    }
    if (waiterEventSource) {
      try { waiterEventSource.close(); } catch { /* ignore */ }
      waiterEventSource = null;
    }
    const url = `/api/kds/${encodeURIComponent(slug)}/events?key=${encodeURIComponent(kitchenKey)}`;
    waiterEventSource = new EventSource(url);
    waiterEventSource.addEventListener("kitchen", () => {
      refreshWaiterLiveState().catch(() => {});
    });
    waiterEventSource.onerror = () => {
      if (waiterEventSource) {
        try { waiterEventSource.close(); } catch { /* ignore */ }
        waiterEventSource = null;
      }
      if (!activeWaiter) return;
      if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
      sseReconnectTimer = setTimeout(() => {
        sseReconnectTimer = null;
        if (activeWaiter) connectWaiterSse();
      }, 4000);
    };
  }

  function disconnectWaiterSse() {
    if (sseReconnectTimer) {
      clearTimeout(sseReconnectTimer);
      sseReconnectTimer = null;
    }
    if (waiterEventSource) {
      try { waiterEventSource.close(); } catch { /* ignore */ }
      waiterEventSource = null;
    }
  }

  function printAcceptanceReceipt(o, acceptedBy) {
    const venue = bootstrap?.restaurant_name || bootstrap?.client_name || "Faturë";
    const fmt = n => Number(n || 0).toFixed(2);
    const items = (o.items_json || []).map(it => {
      const qty = Number(it.quantity) || 1;
      const unit = fmt(it.price);
      const line = fmt((Number(it.price) || 0) * qty);
      return `<div class="rc-item-line"><span class="rc-item-name">${escapeHtml(it.name)}</span>` +
        `<span class="rc-item-calc">${qty}x ${unit} = ${line}</span></div>`;
    }).join("");
    const now = new Date();
    const meta = [
      `Tavolina: ${orderTableLabel(o)}`,
      acceptedBy ? `Kamarieri: ${escapeHtml(acceptedBy)}` : "",
      `Data: ${now.toLocaleDateString("sq-AL")}  Ora: ${now.toLocaleTimeString("sq-AL", { hour: "2-digit", minute: "2-digit" })}`,
    ].filter(Boolean);
    const html = `<div class="receipt-thermal" data-width-mm="80">
      <div class="rc-header">
        <div class="rc-business-name">${escapeHtml(venue)}</div>
        <div class="rc-meta-line">POROSI E PRANUAR</div>
      </div>
      <div class="rc-divider"></div>
      <div class="rc-order-meta">${meta.map(m => `<div>${m}</div>`).join("")}</div>
      <div class="rc-divider"></div>
      <div class="rc-items-compact">${items || '<div class="rc-empty">—</div>'}</div>
      <div class="rc-divider"></div>
      <div class="rc-total"><span class="rc-total-label">TOTALI:</span><span class="rc-total-value">${fmt(orderItemsTotal(o))} EUR</span></div>
      <div class="rc-divider"></div>
      <div class="rc-thanks">Faleminderit!</div>
    </div>`;
    showReceipt({ html, paper_width_mm: 80 });
  }

  // ---- Wake Lock — mban ekranin ndezur ----
  async function requestWakeLock() {
    try {
      if (!("wakeLock" in navigator)) return;
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", function() { wakeLock = null; });
    } catch (e) {
      console.log("[waiter] wake lock denied:", e.message);
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      try { wakeLock.release(); } catch(e) {}
      wakeLock = null;
    }
  }

  /**
   * Safari / Edge (sidomos telefon) ngrin timer-at + SSE kur faqja është në background.
   * Kur kthehet: rifillo polling + SSE menjëherë — pa refresh manual.
   */
  let resumeRealtimeTimer = null;
  function resumeWaiterRealtime() {
    if (!activeWaiter) return;
    if (resumeRealtimeTimer) clearTimeout(resumeRealtimeTimer);
    resumeRealtimeTimer = setTimeout(() => {
      resumeRealtimeTimer = null;
      if (!activeWaiter) return;
      requestWakeLock();
      startAcceptPolling();
      connectWaiterSse();
      refreshWaiterLiveState().catch(() => {});
    }, 120);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumeWaiterRealtime();
  });
  window.addEventListener("pageshow", () => resumeWaiterRealtime());
  window.addEventListener("focus", () => resumeWaiterRealtime());
  window.addEventListener("online", () => resumeWaiterRealtime());

  function enterWaiterSession(waiter) {
    activeWaiter = { id: waiter.id, name: waiter.name };
    saveWaiterSession();
    $("tables-title").textContent = `Kamarieri: ${waiter.name}`;
    $("tables-waiter").textContent = bootstrap?.restaurant_name || bootstrap?.client_name || "";
    onlineSlots = defaultOnlineSlots();
    renderTables();
    setupReservationReminders();
    scheduleIdleLock();
    startAcceptPolling();
    connectWaiterSse();
    requestWakeLock();
    showScreen("screen-tables");
  }

  function lockSession() {
    stopAcceptPolling();
    disconnectWaiterSse();
    pendingAcceptOrders = [];
    onlineSlots = [];
    renderPendingOnlineBanner();
    clearIdleTimer();
    releaseWakeLock();
    activeWaiter = null;
    clearWaiterSession();
    tableNumber = 0;
    cart = [];
    clearPin();
    hideReceipt();
    $("cart-badge")?.classList.add("hidden");
    $("cart-bar")?.classList.add("hidden");
    $("screen-order")?.classList.remove("has-cart");
    showScreen("screen-pin");
  }

  async function tryKasaSessionEnter() {
    if (!kasaSession) return false;
    try {
      const data = await api(`/api/waiter/${encodeURIComponent(slug)}/kasa-session${apiQuery()}`, {
        method: "POST",
        body: JSON.stringify({ session_token: kasaSession }),
      });
      stripKasaSessionFromUrl();
      enterWaiterSession(data.waiter);
      return true;
    } catch {
      stripKasaSessionFromUrl();
      return false;
    }
  }

  function stripKasaSessionFromUrl() {
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("kasa_session");
      window.history.replaceState({}, "", u.pathname + u.search + u.hash);
    } catch {
      /* ignore */
    }
  }

  async function submitPinLogin() {
    const err = $("login-err");
    showErr(err, "");
    if (pinDigits.length !== 4) {
      showErr(err, "PIN duhet të jetë 4 shifra.");
      return;
    }
    const btn = $("btn-pin-login");
    btn.disabled = true;
    const pin = pinDigits.join("");
    try {
      if (!bootstrap) await loadBootstrap();
      const data = await api(`/api/waiter/${encodeURIComponent(slug)}/login${apiQuery()}`, {
        method: "POST",
        body: JSON.stringify({
          pin,
          web_token: waiterToken || undefined,
        }),
      });
      clearPin();
      enterWaiterSession(data.waiter);
    } catch (e) {
      clearPin();
      showErr(err, e.message);
    } finally {
      btn.disabled = false;
    }
  }

  function openOrder(num) {
    if (!activeWaiter) {
      lockSession();
      return;
    }
    tableNumber = num;
    cart = [];
    $("order-title").textContent = `T${num}`;
    showOrderMsg("", false);
    renderMenu();
    renderCart();
    showScreen("screen-order");
  }

  function addToCart(item, btnEl) {
    const existing = cart.find(c => c.name === item.name && Number(c.price) === Number(item.price));
    if (existing) existing.quantity += 1;
    else cart.push({ ...item, quantity: 1 });
    if (btnEl) MenuPosUI.flashButton(btnEl);
    renderCart();
  }

  function renderCart() {
    const lines = $("cart-lines");
    const count = cart.reduce((s, i) => s + i.quantity, 0);
    const badge = $("cart-badge");
    const countLabel = $("cart-count-label");

    if (badge) {
      badge.textContent = String(count);
      badge.classList.toggle("hidden", count === 0);
    }
    if (countLabel) {
      countLabel.textContent = count === 1 ? "1 artikull" : `${count} artikuj`;
    }

    if (!cart.length) {
      lines.innerHTML = "";
    } else {
      lines.innerHTML = cart.map((it, idx) => `
        <div class="cart-line">
          <span>${it.quantity}× ${escapeHtml(it.name)} <small class="cart-unit-price">${formatEuro(it.price)}</small></span>
          <span class="cart-line-total">${formatEuro(it.price * it.quantity)}</span>
          <span class="cart-line-actions">
            <button type="button" class="btn btn-ghost cart-qty-btn" data-minus="${idx}">−</button>
            <button type="button" class="btn btn-ghost cart-qty-btn" data-plus="${idx}">+</button>
          </span>
        </div>`).join("");
    }
    const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    $("cart-total").textContent = formatEuro(total);

    const showPay = tableNumber > 0 && canPayTable(tableNumber);
    $("cart-table-bill")?.classList.toggle("hidden", !showPay);
    if ($("cart-table-total")) {
      $("cart-table-total").textContent = formatEuro(tableBillTotal(tableNumber));
    }
    $("cart-pay-row")?.classList.toggle("hidden", !showPay);

    syncCartBarLayout();
    requestAnimationFrame(syncCartBarLayout);
  }

  async function refreshBootstrap() {
    if (!activeWaiter) return;
    try {
      const data = await api(`/api/waiter/${encodeURIComponent(slug)}/bootstrap${apiQuery()}`);
      bootstrap.tables = data.tables;
      bootstrap.areas = data.areas;
      bootstrap.reservations = data.reservations || [];
      bootstrap.synced_at = data.synced_at;
      bootstrap.menu = data.menu;
      bootstrap.categories = data.categories;
      bootstrap.waiter_count = data.waiter_count;
      detectIncomingOrders(data.tables);
      const hint = $("sync-hint");
      if (bootstrap.synced_at) {
        hint.textContent = `Menuja u sinkronizua: ${new Date(bootstrap.synced_at).toLocaleString("sq-AL")}`;
      }
      if ($("screen-order").classList.contains("active") && tableNumber > 0) {
        // Mos e nxjerr kamarierit automatikisht — ai kthehet vetë me butonin ← Tavolinat
      }
      if ($("screen-order").classList.contains("active")) {
        renderMenu();
        renderCart();
      }
      if (!acceptPollTimer) renderTables();
      checkReservationReminders();
    } catch { /* ignore background refresh */ }
  }

  $("pin-keypad")?.querySelectorAll("[data-digit]").forEach(btn => {
    btn.addEventListener("click", () => appendPin(btn.dataset.digit));
  });
  $("pin-clear")?.addEventListener("click", clearPin);
  $("pin-back")?.addEventListener("click", backspacePin);
  $("btn-pin-login")?.addEventListener("click", submitPinLogin);

  $("btn-logout")?.addEventListener("click", lockSession);

  $("btn-back")?.addEventListener("click", () => {
    tableNumber = 0;
    showOrderMsg("", false);
    showScreen("screen-tables");
    refreshBootstrap();
  });

  function renderReceiptFallback(receipt) {
    const mm = receipt.paper_width_mm || 80;
    const biz = receipt.business || {};
    const items = receipt.items || [];
    const fmt = n => Number(n).toFixed(2);

    const itemLines = items.map(i => {
      const qty = Number(i.quantity) || 1;
      const unit = fmt(i.price);
      const lineTotal = fmt(Number(i.price) * qty);
      return `<div class="rc-item-line">
        <span class="rc-item-name">${escapeHtml(i.name)}</span>
        <span class="rc-item-calc">${qty}x ${unit} = ${lineTotal}</span>
      </div>`;
    }).join("");

    const meta = [
      receipt.receipt_number ? `Nr. Porosia: ${escapeHtml(receipt.receipt_number)}` : "",
      receipt.table_number ? `Tavolina: T${receipt.table_number}` : "",
      receipt.waiter_name ? `Kamarieri: ${escapeHtml(receipt.waiter_name)}` : "",
      receipt.date && receipt.time ? `Data: ${receipt.date} &nbsp; Ora: ${receipt.time}` : "",
    ].filter(Boolean);

    return `<div class="receipt-thermal" data-width-mm="${mm}">
      <div class="rc-header">
        <div class="rc-business-name">${escapeHtml(biz.business_name || receipt.restaurant_name || "Faturë")}</div>
        ${biz.address ? `<div class="rc-meta-line">${escapeHtml(biz.address)}</div>` : ""}
        ${biz.phone ? `<div class="rc-meta-line">Tel: ${escapeHtml(biz.phone)}</div>` : ""}
      </div>
      <div class="rc-divider"></div>
      <div class="rc-order-meta">${meta.map(line => `<div>${line}</div>`).join("")}</div>
      <div class="rc-divider"></div>
      <div class="rc-items-compact">${itemLines || '<div class="rc-empty">—</div>'}</div>
      <div class="rc-divider"></div>
      <div class="rc-total"><span class="rc-total-label">TOTALI:</span><span class="rc-total-value">${fmt(receipt.total || 0)} EUR</span></div>
      ${receipt.payment_label ? `<div class="rc-payment">Pagesa: ${escapeHtml(receipt.payment_label)}</div>` : ""}
      <div class="rc-divider"></div>
      <div class="rc-thanks">Faleminderit!</div>
    </div>`;
  }

  function showReceipt(receipt) {
    const sheet = $("receipt-print");
    sheet.innerHTML = receipt.html || renderReceiptFallback(receipt);
    const mm = receipt.paper_width_mm || sheet.querySelector(".receipt-thermal")?.dataset?.widthMm || 80;
    sheet.style.maxWidth = `${mm}mm`;
    const printBtn = $("btn-print");
    if (printBtn) printBtn.classList.add("hidden");
    $("receipt-modal").classList.remove("hidden");
  }

  function receiptPrintStyles(mm) {
    // Fatura mbush 100% të gjerësisë së letrës: në printer termik mbush rrotullën
    // (58/80mm), në çdo letër tjetër (p.sh. A4 në iPhone) mbush gjerësinë e faqes —
    // kështu nuk del kurrë e vockël në mes të një faqeje bosh.
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      @page { size: ${mm}mm auto; margin: 0; }
      html, body { width: 100%; height: auto !important; min-height: 0 !important; background: #fff; overflow: hidden; }
      body {
        font-family: "Courier New", "Consolas", ui-monospace, monospace;
        color: #000;
        font-size: 13px;
        line-height: 1.3;
        padding: 3mm 3mm 6mm;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .receipt-thermal { width: 100%; max-width: none; }
      .rc-header { text-align: center; margin-bottom: 2mm; }
      .rc-business-name {
        font-weight: 700; font-size: 1.35em; line-height: 1.2;
        margin-bottom: 1mm; text-transform: uppercase;
      }
      .rc-business-meta, .rc-meta-line { font-size: 0.95em; line-height: 1.35; }
      .rc-meta-line { margin: 0.4mm 0; }
      .rc-divider { border: 0; border-top: 1px dashed #000; margin: 1.6mm 0; height: 0; }
      .rc-divider-strong { border-top-style: solid; }
      .rc-order-meta { font-size: 0.95em; line-height: 1.4; }
      .rc-order-meta div { margin: 0.3mm 0; }
      .rc-items-compact .rc-item-line {
        display: flex; justify-content: space-between; align-items: flex-start;
        gap: 3mm; font-size: 1em; line-height: 1.3; margin: 0.8mm 0;
      }
      .rc-items-compact .rc-item-name { flex: 1; min-width: 0; word-break: break-word; }
      .rc-items-compact .rc-item-calc { white-space: nowrap; font-variant-numeric: tabular-nums; }
      .rc-total {
        display: flex; justify-content: space-between; align-items: baseline;
        gap: 3mm; font-weight: 700; font-size: 1.2em; margin: 1.2mm 0;
      }
      .rc-total-value { white-space: nowrap; font-variant-numeric: tabular-nums; }
      .rc-payment { font-weight: 700; font-size: 1em; margin: 1mm 0; }
      .rc-thanks { text-align: center; font-weight: 700; font-size: 1.05em; margin-top: 2mm; }
      .rc-empty { text-align: center; padding: 1mm 0; }
    `;
  }

  function printReceipt() {
    return;
    const sheet = $("receipt-print");
    if (!sheet) return;
    const thermal = sheet.querySelector(".receipt-thermal");
    const mm = Number(thermal?.dataset?.widthMm || sheet?.style?.maxWidth?.replace("mm", "") || 80) || 80;
    const bizName = thermal?.querySelector(".rc-business-name")?.textContent?.trim() || "Faturë";
    const content = thermal ? thermal.outerHTML : sheet.innerHTML;

    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${escapeHtml(bizName)}</title>` +
      `<style>${receiptPrintStyles(mm)}</style></head>` +
      `<body>${content}</body></html>`;

    const old = document.getElementById("receipt-print-frame");
    if (old) old.remove();

    const frame = document.createElement("iframe");
    frame.id = "receipt-print-frame";
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
    document.body.appendChild(frame);

    let done = false;
    const cleanup = () => {
      setTimeout(() => {
        try { frame.remove(); } catch (_) { /* ignore */ }
      }, 800);
    };

    const triggerPrint = () => {
      if (done) return;
      done = true;
      const win = frame.contentWindow;
      const bdoc = win.document;
      try {
        const h = Math.max(bdoc.body.scrollHeight, bdoc.documentElement.scrollHeight);
        bdoc.documentElement.style.height = `${h}px`;
        bdoc.body.style.height = `${h}px`;
        win.focus();
        win.onafterprint = cleanup;
        win.print();
        cleanup();
      } catch (_) {
        cleanup();
      }
    };

    const fdoc = frame.contentWindow.document;
    fdoc.open();
    fdoc.write(doc);
    fdoc.close();

    frame.onload = () => setTimeout(triggerPrint, 200);
    // Rezervë nëse onload nuk aktivizohet (disa shfletues).
    setTimeout(triggerPrint, 500);
  }

  function hideReceipt() {
    $("receipt-modal").classList.add("hidden");
  }

  $("btn-print")?.addEventListener("click", printReceipt);

  $("btn-receipt-done")?.addEventListener("click", async () => {
    hideReceipt();
    cart = [];
    renderCart();
    tableNumber = 0;
    await refreshBootstrap();
    showScreen("screen-tables");
  });

  async function closeTableWithPayment(paymentMethod) {
    if (tableClosing) return;
    const err = $("order-err");
    showErr(err, "");
    showOrderMsg("", false);

    if (!activeWaiter?.id) {
      showErr(err, "Sesioni ka skaduar. Shkruani PIN-in.");
      lockSession();
      return;
    }
    const table = getTableMeta(tableNumber);
    if (!tableNumber || !canPayTable(tableNumber)) {
      showErr(err, "Nuk ka artikuj për të mbyllur tavolinën.");
      return;
    }
    if (inferTableOrderSource(table).code === "qr") {
      const owner = foreignAcceptedOwner(table.accepted_by_waiter_id, table.accepted_by_waiter_name);
      if (owner) {
        showErr(err, `Kjo porosi i përket kamarierit ${owner}. Vetëm ai/ajo mund ta mbyllë.`);
        return;
      }
    }

    const btnCash = $("btn-pay-cash");
    const btnCard = $("btn-pay-card");
    if (btnCash) btnCash.disabled = true;
    if (btnCard) btnCard.disabled = true;
    const prevCash = btnCash?.textContent || "Cash";
    const prevCard = btnCard?.textContent || "Kartë";
    if (paymentMethod === "cash" && btnCash) btnCash.textContent = "Duke mbyllur...";
    if (paymentMethod === "karte" && btnCard) btnCard.textContent = "Duke mbyllur...";

    const closedTable = tableNumber;
    // Lista e plotë e faturës (tavolina + shporta) — para se të pastrohet cart.
    const closeItems = getCloseTableItems(closedTable);
    if (!closeItems.length) {
      showErr(err, "Nuk ka artikuj për të mbyllur tavolinën.");
      return;
    }
    tableClosing = true;
    try {
      // Nëse ka artikuj në shportë, dërgoji si porosi para mbylljes
      if (cart.length) {
        await api(`/api/waiter/${encodeURIComponent(slug)}/orders${apiQuery()}`, {
          method: "POST",
          body: JSON.stringify({
            ...waiterPayload(),
            table_number: closedTable,
            items: cart.map(c => ({
              name: c.name,
              quantity: c.quantity,
              price: c.price,
            })),
          }),
        });
        cart = [];
        renderCart();
      }

      // Dërgo items eksplicit — mos u mbështet vetëm te bootstrap i vjetër në telefon.
      const data = await api(`/api/waiter/${encodeURIComponent(slug)}/orders/close${apiQuery()}`, {
        method: "POST",
        body: JSON.stringify({
          ...waiterPayload(),
          table_number: closedTable,
          payment_method: paymentMethod,
          items: closeItems,
        }),
      });
      cart = [];
      renderCart();
      const payLabel = paymentMethod === "karte" ? "Kartë" : "Cash";
      showSuccessToast(`✅ T${closedTable} u mbyll — ${payLabel}`);
      if (data.receipt) {
        showReceipt(data.receipt);
        await refreshBootstrap();
        scheduleIdleLock();
        return;
      }
      tableNumber = 0;
      await refreshBootstrap();
      showScreen("screen-tables");
      scheduleIdleLock();
    } catch (e) {
      showErr(err, e.message);
      showSuccessToast(e.message || "Nuk u mbyll pagesa.");
    } finally {
      tableClosing = false;
      if (btnCash) {
        btnCash.disabled = false;
        btnCash.textContent = prevCash;
      }
      if (btnCard) {
        btnCard.disabled = false;
        btnCard.textContent = prevCard;
      }
    }
  }

  bindTap($("btn-pay-cash"), () => closeTableWithPayment("cash"));
  bindTap($("btn-pay-card"), () => closeTableWithPayment("karte"));

  async function submitOrder() {
    const btn = $("btn-send");
    if (btn?.disabled || orderSubmitting) return;

    const err = $("order-err");
    showErr(err, "");
    showOrderMsg("", false);

    if (!activeWaiter?.id) {
      const msg = "Sesioni i kamarierit ka skaduar. Shkruani PIN-in.";
      showErr(err, msg);
      showOrderMsg(msg, false);
      lockSession();
      return;
    }
    if (!tableNumber || tableNumber < 1) {
      const msg = "Zgjidhni tavolinën para se të dërgoni porosinë.";
      showErr(err, msg);
      showOrderMsg(msg, false);
      return;
    }
    if (!cart.length) {
      const msg = "Shtoni të paktën një artikull.";
      showErr(err, msg);
      showOrderMsg(msg, false);
      return;
    }

    if (!btn) return;
    orderSubmitting = true;
    btn.disabled = true;
    btn.textContent = "Duke dërguar...";
    const sentTable = tableNumber;
    let payload;
    try {
      payload = {
        ...waiterPayload(),
        table_number: sentTable,
        items: cart.map(c => ({
          name: c.name,
          quantity: c.quantity,
          price: c.price,
        })),
      };
    } catch (e) {
      showErr(err, e.message);
      showOrderMsg(e.message, false);
      btn.disabled = false;
      btn.textContent = "Dërgo Porosinë";
      orderSubmitting = false;
      return;
    }

    const orderUrl = `/api/waiter/${encodeURIComponent(slug)}/orders${apiQuery()}`;

    if (!navigator.onLine && window.OfflineQueue) {
      try {
        await enqueueOfflineOrder(orderUrl, payload, sentTable);
      } catch (e) {
        showErr(err, e.message);
        showOrderMsg(e.message, false);
      } finally {
        btn.disabled = false;
        btn.textContent = "Dërgo Porosinë";
        orderSubmitting = false;
      }
      return;
    }

    try {
      const data = await api(orderUrl, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (data.order?.id) handledAcceptIds.add(data.order.id);
      cart = [];
      renderCart();
      const sentMsg = `✅ Porosia u dërgua për T${sentTable}!`;
      showOrderMsg("", false);
      showSuccessToast(sentMsg);
      scheduleIdleLock();
      suppressOrderAlertOnce = true;
      // Kthehu te tavolinat — pa nevojë për refresh manual të faqes
      showScreen("screen-tables");
      try {
        await refreshBootstrap();
      } catch {
        refreshWaiterLiveState().catch(() => {});
      }
      connectWaiterSse();
    } catch (e) {
      if (window.OfflineQueue && isNetworkError(e)) {
        try {
          await enqueueOfflineOrder(orderUrl, payload, sentTable);
          return;
        } catch (queueErr) {
          e = queueErr;
        }
      }
      const msg = e.message || "Porosia nuk u dërgua. Provoni përsëri.";
      showErr(err, msg);
      showOrderMsg(msg, false);
    } finally {
      orderSubmitting = false;
      btn.disabled = cart.length === 0;
      btn.textContent = "Dërgo Porosinë";
    }
  }

  // Çaktivizo bllokimin e audios pas gjestit të parë (kërkesë e iOS/Android).
  ["touchstart", "pointerdown", "click", "keydown"].forEach(ev =>
    document.addEventListener(ev, ensureAudioUnlocked, { passive: true }),
  );

  bindCartLines();
  setupAcceptModalButtons();
  setupOnlineCloseModalButtons();
  $("accept-modal-backdrop")?.addEventListener("click", closeAcceptModal);
  $("online-close-modal-backdrop")?.addEventListener("click", closeOnlineCloseModal);
  setupWaiterIdleLock();
  setupDesktopReturn();
  setupDesktopCalculatorBar();
  if (typeof window.initWaiterCalculator === "function") window.initWaiterCalculator();
  setupConnectionStatus();
  registerServiceWorker();
  setupReservationReminders();
  bindTap($("btn-send"), submitOrder);
  (async () => {
    try {
      await loadBootstrap();
      if (await tryKasaSessionEnter()) return;
      // Link personal i kamarierit: identifikohet automatikisht pa PIN.
      if (hasPersonalWaiterLink()) {
        enterWaiterSession(bootstrap.assigned_waiter);
        return;
      }
      const restored = loadWaiterSession();
      if (restored?.id && restored?.name) {
        enterWaiterSession(restored);
        return;
      }
      renderPinDisplay();
      showScreen("screen-pin");
    } catch (e) {
      showErr($("login-err"), e.message);
    } finally {
      hideWaiterSplash();
    }
  })();

  setInterval(() => {
    if (navigator.onLine) syncPendingOrders().catch(() => {});
    if (activeWaiter && ($("screen-tables").classList.contains("active") || $("screen-order").classList.contains("active"))) {
      refreshWaiterLiveState().catch(() => {});
    }
  }, 5000);
})();
