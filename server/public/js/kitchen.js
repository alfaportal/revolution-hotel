(function () {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const slug = parts[0] === "kitchen" ? parts[1] : "";
  const urlParams = new URLSearchParams(window.location.search);
  const kitchenKey = urlParams.get("key") || "";
  const waiterToken = String(urlParams.get("w") || "").trim();
  const waiterMode = !!waiterToken;

  const titleEl = document.getElementById("kitchen-title");
  const subEl = document.getElementById("kitchen-sub");
  const headerEl = document.querySelector(".kitchen-header");
  const gridEl = document.getElementById("orders-grid");
  const emptyEl = document.getElementById("empty-state");
  const errorEl = document.getElementById("error-box");
  const countEl = document.getElementById("order-count");
  const syncEl = document.getElementById("last-sync");
  const toastEl = document.getElementById("order-toast");

  let knownIds = new Set();
  let eventSource = null;
  let alarmTimer = null;
  let toastTimer = null;
  let assignedWaiter = null;
  const venueInfo = { name: "", address: "" };
  let activeModalOrderId = null;   // porosia që shfaqet aktualisht te modali
  const handledOrderIds = new Set(); // porositë e trajtuara (pranuar/refuzuar) në këtë sesion

  function apiQuery() {
    const p = [];
    if (kitchenKey) p.push(`key=${encodeURIComponent(kitchenKey)}`);
    if (waiterToken) p.push(`w=${encodeURIComponent(waiterToken)}`);
    return p.length ? `?${p.join("&")}` : "";
  }

  function apiHeaders() {
    return kitchenKey ? { "x-kitchen-key": kitchenKey } : {};
  }

  function showToast(msg, kind = "info") {
    if (!toastEl || !msg) return;
    toastEl.textContent = msg;
    toastEl.className = `order-toast ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.className = "order-toast hidden";
      toastEl.textContent = "";
    }, kind === "error" ? 5000 : 3500);
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
    gridEl.innerHTML = "";
    emptyEl.classList.add("hidden");
  }

  function hideError() {
    errorEl.classList.add("hidden");
  }

  function formatTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleTimeString("sq-AL", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "—";
    }
  }

  function elapsed(iso) {
    if (!iso) return "";
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return "tani";
    return `${min} min`;
  }

  function formatEuro(n) {
    return Number(n || 0).toFixed(2) + " €";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sourceMeta(order) {
    const device = String(order.device_id || "").toUpperCase();
    if (device === "WEB-PUBLIC") {
      const w = String(order.waiter_name || "").toLowerCase();
      if (w.startsWith("delivery")) return { icon: "🛵", label: "Delivery" };
      return { icon: "🥡", label: "Takeaway" };
    }
    if (device === "WEB-KIOSK") return { icon: "📱", label: "QR Code" };
    if (device === "WEB-WAITER") return { icon: "📱", label: "Kamarier" };
    return { icon: "🖥️", label: "POS" };
  }

  function tableLabel(order) {
    const device = String(order.device_id || "").toUpperCase();
    if (device === "WEB-PUBLIC") {
      const w = String(order.waiter_name || "").toLowerCase();
      if (w.startsWith("delivery")) return "Delivery";
      if (w.startsWith("takeaway")) return "Takeaway";
      return "Online";
    }
    return `T${order.table_number || "?"}`;
  }

  function renderOrderItem(it) {
    const qty = Number(it.quantity) || 1;
    const price = Number(it.price) || 0;
    const lineTotal = price * qty;
    return `<li>
      <span class="qty">${qty}×</span>
      <span class="item-name">${escapeHtml(it.name)}</span>
      <span class="item-price">${formatEuro(price)}${qty > 1 ? `<small> = ${formatEuro(lineTotal)}</small>` : ""}</span>
    </li>`;
  }

  function playNewOrderSound() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const playBeep = (freq, start, dur) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
        osc.stop(start + dur);
      };
      playBeep(880, ctx.currentTime, 0.18);
      playBeep(1100, ctx.currentTime + 0.22, 0.22);
    } catch { /* */ }
  }

  function updateAlarmState(orders) {
    const pending = (orders || []).filter(o => !(o.accepted_at || o.accepted_by_waiter_name));
    const active = pending.length > 0;
    headerEl?.classList.toggle("alarm-pulse", active);
    if (active && !alarmTimer) {
      alarmTimer = setInterval(() => playNewOrderSound(), 12000);
    } else if (!active && alarmTimer) {
      clearInterval(alarmTimer);
      alarmTimer = null;
    }
  }

  function foldText(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  /** Të GJITHA pijet — hiq nga kuzhina. */
  function isDrinkLikeItem(it) {
    const name = foldText(it?.name || it?.emri || "");
    const cat = foldText(it?.category || it?.kategoria || "");
    if (!name && !cat) return false;

    const drinkHit =
      /espress|cappuccin|macchiato|americano|latte|frappe|frape|nescafe|neskafe|coffee|kafe|\bcafe\b|birra|\bbeer\b|cocktail|koktej|coca|\bcola\b|fanta|sprite|pepsi|smoothie|energji|energy|redbull|mojito|ayran|limonad|qumesht|\bmilk\b|icetea|ice tea|tonic|soda|gazuar|mineral|whisky|whiskey|viski|vodka|tequila|raki|prosecco|\b(tea|caj|uje|water|sok|juice|wine|vere|vera|pije|drink|gin|rum)\b/.test(
        name,
      );

    if (drinkHit) return true;

    return /pije|kafe|espress|coffee|drink|beverage|\bbar\b|ftoht|ngroht|alkool|birra/.test(
      cat,
    );
  }

  /** Vetëm ushqim i qartë — mbetet te kuzhina. */
  function isFoodLikeItem(it) {
    if (isDrinkLikeItem(it)) return false;
    const name = foldText(it?.name || it?.emri || "");
    const cat = foldText(it?.category || it?.kategoria || "");
    const foodRe =
      /\b(pizza|pica|pasta|mish|supa|supe|salat\w*|sallat\w*|sandwi\w*|hamburger|burger|nugget|qofte|wrap|rizotto|risotto|steak|fileto|skara|grill|zgar|qebap|kebab|byrek|burek|omlet\w*|patate|fries|sushi|lasagn\w*|makaron|spaghetti|pule|chicken|toast|schnitzel|pjate|pjata|embel|desert|dessert|kapreze|caprese)\b/;
    if (
      foodRe.test(name) ||
      name.includes("sallat") ||
      name.includes("salat") ||
      name.includes("pizza") ||
      name.includes("kapreze")
    ) {
      return true;
    }
    if (
      foodRe.test(cat) ||
      cat.includes("ushqim") ||
      cat.includes("food") ||
      cat.includes("kuzhin") ||
      cat.includes("sallat") ||
      cat.includes("embels")
    ) {
      return true;
    }
    return false;
  }

  function normalizeOrderItems(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const p = JSON.parse(raw);
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  function filterKitchenViewOrders(orders) {
    // Vetëm ushqim — çdo pije / unknown hiqet nga ekrani i kuzhinës
    return (orders || [])
      .map((o) => {
        const items = normalizeOrderItems(o.items_json).filter((it) => isFoodLikeItem(it));
        if (!items.length) return null;
        return { ...o, items_json: items };
      })
      .filter(Boolean);
  }

  function renderOrders(orders, cancelledOrders) {
    hideError();
    const active = filterKitchenViewOrders(orders);
    const cancelled = filterKitchenViewOrders(cancelledOrders);
    let hasNew = false;
    for (const o of active) {
      if (!knownIds.has(o.id)) hasNew = true;
    }
    if (hasNew && knownIds.size) {
      playNewOrderSound();
      showToast(waiterMode ? "Porosi e re" : "Porosi e re — pranoni me PIN", "info");
    }

    updateAlarmState(active);
    const n = active.length;
    countEl.textContent = n === 1 ? "1 porosi" : `${n} porosi`;
    syncEl.textContent = `Rifreskuar: ${formatTime(new Date().toISOString())}`;

    if (!active.length && !cancelled.length) {
      gridEl.innerHTML = "";
      emptyEl.classList.remove("hidden");
      knownIds = new Set();
      return;
    }

    emptyEl.classList.add("hidden");
    const cancelledHtml = cancelled.map(o => {
      const src = sourceMeta(o);
      const items = (o.items_json || []).map(renderOrderItem).join("");
      return `
        <article class="order-ticket cancelled" data-id="${o.id}">
          <div class="ticket-cancelled-banner">E ANULLUAR ❌</div>
          <div class="ticket-head">
            <div class="ticket-table">${escapeHtml(tableLabel(o))}</div>
            <div class="ticket-time">${formatTime(o.ordered_at || o.created_at)}</div>
          </div>
          <div class="ticket-waiter">${src.icon} ${src.label} · 👤 <strong>${escapeHtml(o.waiter_name || "—")}</strong></div>
          <ul class="ticket-items">${items || "<li>—</li>"}</ul>
        </article>`;
    }).join("");

    gridEl.innerHTML = cancelledHtml + active.map(o => {
      const isNew = !knownIds.has(o.id);
      const src = sourceMeta(o);
      const items = (o.items_json || []).map(renderOrderItem).join("");
      const accepted = !!(o.accepted_at || o.accepted_by_waiter_name);
      const acceptor = String(o.accepted_by_waiter_name || "").trim();
      const acceptLine = accepted
        ? `<div class="ticket-waiter ticket-accepted">✅ Pranuar nga: <strong>${escapeHtml(acceptor || "—")}</strong></div>`
        : `<div class="ticket-waiter ticket-pending">⏳ Në pritje${waiterMode ? "" : " — pranoni me PIN"}</div>`;
      let actions;
      if (accepted) {
        actions = `<button type="button" class="btn-ready" data-ready="${o.id}">Gati ✅</button>`;
      } else if (waiterMode) {
        actions = `<div class="ticket-actions">
          <button type="button" class="btn-ready btn-accept" data-accept="${o.id}">PRANO ✅</button>
          <button type="button" class="btn-ready btn-refuse" data-refuse="${o.id}">REFUZO ✖</button>
        </div>`;
      } else {
        actions = `<button type="button" class="btn-ready btn-accept" data-accept="${o.id}">Prano me PIN 🔐</button>`;
      }
      return `
        <article class="order-ticket${isNew ? " new" : ""}${accepted ? " accepted" : " pending"}" data-id="${o.id}">
          <div class="ticket-source">${src.icon} ${src.label}</div>
          <div class="ticket-head">
            <div class="ticket-table">${escapeHtml(tableLabel(o))}</div>
            <div class="ticket-time">${formatTime(o.ordered_at || o.created_at)}<br><small>${elapsed(o.ordered_at || o.created_at)}</small></div>
          </div>
          <div class="ticket-waiter">👤 <strong>${escapeHtml(o.waiter_name || "—")}</strong></div>
          ${acceptLine}
          <ul class="ticket-items">${items || "<li>—</li>"}</ul>
          ${actions}
        </article>`;
    }).join("");

    knownIds = new Set(active.map(o => o.id));
    gridEl.querySelectorAll("[data-accept]").forEach(btn => {
      btn.addEventListener("click", () => acceptOrder(btn.dataset.accept, btn));
    });
    gridEl.querySelectorAll("[data-refuse]").forEach(btn => {
      btn.addEventListener("click", () => refuseOrder(btn.dataset.refuse, btn));
    });
    gridEl.querySelectorAll("[data-ready]").forEach(btn => {
      btn.addEventListener("click", () => markReady(btn.dataset.ready, btn));
    });
  }

  async function fetchOrders() {
    if (!slug) {
      showError("Linku i kuzhinës nuk është i saktë. Duhet /kitchen/[slug]?key=...");
      return;
    }
    if (!kitchenKey) {
      showError("Mungon kodi i aksesit (?key=...) në link.");
      return;
    }
    try {
      // Kuzhina: GJITHMONË /orders (vetëm ushqim). ?w= ridrejtohet te /waiter/.
      const res = await fetch(`/api/kds/${encodeURIComponent(slug)}/orders${apiQuery()}`, {
        headers: apiHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showError(data.gabim || "Nuk u ngarkuan porositë.");
        return;
      }
      if (data.restaurant_name || data.client_name) {
        const venue = data.restaurant_name || data.client_name;
        venueInfo.name = venue;
        venueInfo.address = data.address || "";
        titleEl.textContent = waiterMode && data.assigned_waiter?.name
          ? `Kamarieri: ${data.assigned_waiter.name}`
          : venue;
        subEl.textContent = waiterMode
          ? "Porositë e tavolinave tuaja — rifreskohet automatikisht"
          : "Porositë e ushqimit — rifreskohet automatikisht";
        document.title = `${waiterMode ? "Porositë" : "Kuzhina"} — ${venue}`;
        const venueBar = document.getElementById("kitchen-venue-name");
        if (venueBar) venueBar.textContent = venue;
      }
      assignedWaiter = data.assigned_waiter || assignedWaiter;
      renderOrders(data.orders || [], data.cancelled || []);
      if (waiterMode) maybeShowAcceptModal(data.orders || []);
    } catch (e) {
      showError(e.message || "Gabim rrjeti.");
    }
  }

  async function acceptOrder(orderId, btn, orderForReceipt) {
    let body = {};
    // Rrjedha e re (link personal): pa PIN — kamarieri është identifikuar.
    if (!waiterMode) {
      const pinTrim = await OrderPinModal.request({
        title: "Prano porosinë",
        hint: "Shkruani PIN-in 4-shifror të kamarierit që e pranon porosinë",
      });
      if (!pinTrim) return;
      if (!/^\d{4}$/.test(String(pinTrim).trim())) {
        showToast("PIN duhet të jetë 4 shifra.", "error");
        return;
      }
      body = { pin: String(pinTrim).trim() };
    }
    if (btn) { btn.disabled = true; btn.textContent = "Duke u përpunuar..."; }
    try {
      const res = await fetch(
        `/api/kds/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}/accept${apiQuery()}`,
        {
          method: "POST",
          headers: { ...apiHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showToast(data.gabim || "Nuk u pranua porosia.", "error");
        if (btn) { btn.disabled = false; btn.textContent = waiterMode ? "PRANO ✅" : "Prano me PIN 🔐"; }
        return;
      }
      handledOrderIds.add(orderId);
      closeAcceptModal();
      const acceptedBy = data.accepted_by || "";
      showToast(acceptedBy ? `Porosia u pranua nga ${acceptedBy}` : "Porosia u pranua.", "success");
      // Printo kuponin e pranimit (fatura termike) — vetëm në rrjedhën e re.
      if (waiterMode) {
        const src = orderForReceipt || data.order;
        if (src) printAcceptanceReceipt(src, acceptedBy);
      }
      await fetchOrders();
    } catch (e) {
      showToast(e.message || "Gabim.", "error");
      if (btn) { btn.disabled = false; btn.textContent = waiterMode ? "PRANO ✅" : "Prano me PIN 🔐"; }
    }
  }

  function pickRefuseReason() {
    return new Promise((resolve) => {
      const existing = document.getElementById("refuse-reason-modal");
      if (existing) existing.remove();
      const presets = ["Shumë i zënë", "Mungon artikulli", "Mbyllje / pushim", "Tavolina e gabuar"];
      const wrap = document.createElement("div");
      wrap.id = "refuse-reason-modal";
      wrap.style.cssText = "position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:1rem;";
      wrap.innerHTML = `
        <div style="background:#fff;border-radius:14px;max-width:340px;width:100%;padding:1rem 1.1rem">
          <h3 style="margin:0 0 .75rem;font-size:1.1rem">Pse e refuzoni?</h3>
          <div id="refuse-reason-btns" style="display:flex;flex-direction:column;gap:.45rem"></div>
          <input id="refuse-reason-other" type="text" maxlength="300" placeholder="Arsye tjetër…"
            style="width:100%;margin-top:.65rem;padding:.55rem .7rem;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box" />
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

  async function refuseOrder(orderId, btn) {
    if (!waiterMode) return;
    const reason = await pickRefuseReason();
    if (reason == null) return;
    if (btn) { btn.disabled = true; btn.textContent = "Duke u përpunuar..."; }
    try {
      const res = await fetch(
        `/api/kds/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}/refuse${apiQuery()}`,
        {
          method: "POST",
          headers: { ...apiHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showToast(data.gabim || "Nuk u refuzua porosia.", "error");
        if (btn) { btn.disabled = false; btn.textContent = "REFUZO ✖"; }
        return;
      }
      handledOrderIds.add(orderId);
      closeAcceptModal();
      showToast("Porosia kaloi te kamarierët e tjerë — 2 minuta.", "info");
      await fetchOrders();
    } catch (e) {
      showToast(e.message || "Gabim.", "error");
      if (btn) { btn.disabled = false; btn.textContent = "REFUZO ✖"; }
    }
  }

  async function markReady(orderId, btn) {
    btn.disabled = true;
    btn.textContent = "Duke u përpunuar...";
    try {
      const res = await fetch(
        `/api/kds/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}/ready${apiQuery()}`,
        { method: "POST", headers: apiHeaders() },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showToast(data.gabim || "Nuk u shënua si gati.", "error");
        btn.disabled = false;
        btn.textContent = "Gati ✅";
        return;
      }
      showToast("Porosia u shënua si gati.", "success");
      await fetchOrders();
    } catch (e) {
      showToast(e.message || "Gabim.", "error");
      btn.disabled = false;
      btn.textContent = "Gati ✅";
    }
  }

  // ---- Modal PRANO / REFUZO (rrjedha e re, pa PIN) ----
  function orderTotal(o) {
    if (o.total != null) return Number(o.total) || 0;
    return (o.items_json || []).reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
  }

  function maybeShowAcceptModal(orders) {
    const pending = (orders || []).filter(o =>
      !(o.accepted_at || o.accepted_by_waiter_name) && !handledOrderIds.has(o.id));
    if (!pending.length) {
      closeAcceptModal();
      return;
    }
    // Shfaq porosinë më të vjetër në pritje (nëse nuk po shfaqet tashmë).
    const next = pending[0];
    if (activeModalOrderId === next.id) return;
    renderAcceptModal(next);
  }

  function renderAcceptModal(o) {
    const modal = document.getElementById("accept-modal");
    if (!modal) return;
    activeModalOrderId = o.id;
    const src = sourceMeta(o);
    const srcName = String(o.waiter_name || "").trim();
    const srcText = `${src.icon} ${src.label}${srcName ? ` · ${escapeHtml(srcName)}` : ""}`;
    document.getElementById("accept-modal-source").innerHTML = srcText;
    document.getElementById("accept-modal-table").textContent = tableLabel(o);
    document.getElementById("accept-modal-items").innerHTML =
      (o.items_json || []).map(renderOrderItem).join("") || "<li>—</li>";
    document.getElementById("accept-modal-total").textContent = formatEuro(orderTotal(o));

    const acceptBtn = document.getElementById("accept-modal-accept");
    const refuseBtn = document.getElementById("accept-modal-refuse");
    if (acceptBtn) {
      acceptBtn.disabled = false;
      acceptBtn.textContent = "PRANO ✅";
      acceptBtn.onclick = () => acceptOrder(o.id, acceptBtn, o);
    }
    if (refuseBtn) {
      refuseBtn.disabled = false;
      refuseBtn.textContent = "REFUZO ✖";
      refuseBtn.onclick = () => refuseOrder(o.id, refuseBtn);
    }
    modal.classList.remove("hidden");
    modal.removeAttribute("hidden");
  }

  function closeAcceptModal() {
    activeModalOrderId = null;
    const modal = document.getElementById("accept-modal");
    if (modal) {
      modal.classList.add("hidden");
      modal.setAttribute("hidden", "");
    }
  }

  // ---- Printimi i kuponit të pranimit (fatura termike, print në shfletues) ----
  function acceptanceReceiptHtml(o, acceptedBy) {
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
      `Tavolina: ${tableLabel(o)}`,
      acceptedBy ? `Kamarieri: ${escapeHtml(acceptedBy)}` : "",
      `Data: ${now.toLocaleDateString("sq-AL")}  Ora: ${now.toLocaleTimeString("sq-AL", { hour: "2-digit", minute: "2-digit" })}`,
    ].filter(Boolean);
    return `<div class="receipt-thermal">
      <div class="rc-header">
        <div class="rc-business-name">${escapeHtml(venueInfo.name || "Faturë")}</div>
        ${venueInfo.address ? `<div class="rc-meta-line">${escapeHtml(venueInfo.address)}</div>` : ""}
        <div class="rc-meta-line">POROSI E PRANUAR</div>
      </div>
      <div class="rc-divider"></div>
      <div class="rc-order-meta">${meta.map(m => `<div>${m}</div>`).join("")}</div>
      <div class="rc-divider"></div>
      <div class="rc-items-compact">${items || '<div class="rc-empty">—</div>'}</div>
      <div class="rc-divider"></div>
      <div class="rc-total"><span class="rc-total-label">TOTALI:</span><span class="rc-total-value">${fmt(orderTotal(o))} EUR</span></div>
      <div class="rc-divider"></div>
      <div class="rc-thanks">Faleminderit!</div>
    </div>`;
  }

  function receiptPrintStyles(mm) {
    return `
      * { margin:0; padding:0; box-sizing:border-box; }
      @page { size: ${mm}mm auto; margin: 0; }
      html, body { width:100%; background:#fff; }
      body { font-family:"Courier New","Consolas",ui-monospace,monospace; color:#000; font-size:13px; line-height:1.3; padding:3mm 3mm 6mm; }
      .receipt-thermal { width:100%; }
      .rc-header { text-align:center; margin-bottom:2mm; }
      .rc-business-name { font-weight:700; font-size:1.35em; text-transform:uppercase; margin-bottom:1mm; }
      .rc-meta-line { font-size:0.95em; }
      .rc-divider { border:0; border-top:1px dashed #000; margin:1.6mm 0; }
      .rc-order-meta { font-size:0.95em; line-height:1.4; }
      .rc-items-compact .rc-item-line { display:flex; justify-content:space-between; gap:3mm; margin:0.8mm 0; }
      .rc-items-compact .rc-item-name { flex:1; word-break:break-word; }
      .rc-items-compact .rc-item-calc { white-space:nowrap; }
      .rc-total { display:flex; justify-content:space-between; font-weight:700; font-size:1.2em; margin:1.2mm 0; }
      .rc-thanks { text-align:center; font-weight:700; margin-top:2mm; }
      .rc-empty { text-align:center; }
    `;
  }

  function printAcceptanceReceipt(o, acceptedBy) {
    try {
      const mm = 80;
      const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">` +
        `<title>${escapeHtml(venueInfo.name || "Faturë")}</title>` +
        `<style>${receiptPrintStyles(mm)}</style></head>` +
        `<body>${acceptanceReceiptHtml(o, acceptedBy)}</body></html>`;
      const old = document.getElementById("accept-print-frame");
      if (old) old.remove();
      const frame = document.createElement("iframe");
      frame.id = "accept-print-frame";
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
      document.body.appendChild(frame);
      let done = false;
      const cleanup = () => setTimeout(() => { try { frame.remove(); } catch (_) { /* */ } }, 800);
      const trigger = () => {
        if (done) return;
        done = true;
        try {
          frame.contentWindow.focus();
          frame.contentWindow.onafterprint = cleanup;
          frame.contentWindow.print();
          cleanup();
        } catch (_) { cleanup(); }
      };
      const fdoc = frame.contentWindow.document;
      fdoc.open();
      fdoc.write(doc);
      fdoc.close();
      frame.onload = () => setTimeout(trigger, 200);
      setTimeout(trigger, 500);
    } catch (_) { /* print opsional */ }
  }

  function connectSse() {
    if (!slug || !kitchenKey || typeof EventSource === "undefined") return;
    const url = `/api/kds/${encodeURIComponent(slug)}/events?key=${encodeURIComponent(kitchenKey)}`;
    eventSource = new EventSource(url);
    eventSource.addEventListener("kitchen", () => fetchOrders());
    eventSource.onerror = () => {
      if (eventSource) eventSource.close();
      setTimeout(connectSse, 5000);
    };
  }

  fetchOrders();
  connectSse();
  setInterval(fetchOrders, 5000);
})();
