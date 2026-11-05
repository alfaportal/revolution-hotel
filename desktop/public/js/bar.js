(function () {
  function apiUrl(path) {
    return String(path || "");
  }

  const titleEl = document.getElementById("bar-title");
  const errorEl = document.getElementById("error-box");
  const syncEl = document.getElementById("last-sync");
  const tablesGridEl = document.getElementById("bar-tables-grid");
  const tablesUpdatedEl = document.getElementById("bar-tables-updated");
  const ordersGridEl = document.getElementById("bar-orders-grid");
  const ordersCountEl = document.getElementById("bar-orders-count");
  const ordersEmptyEl = document.getElementById("bar-orders-empty");

  let eventSource = null;

  function apiQuery() {
    return "";
  }

  function readBarSession() {
    if (typeof KdsStationSession !== "undefined") {
      const fromStore = KdsStationSession.restoreToSessionStorage("banaku");
      if (fromStore?.token) return fromStore;
    }
    try {
      return JSON.parse(sessionStorage.getItem("rh_user") || "null");
    } catch {
      return null;
    }
  }

  function apiHeaders() {
    const u = readBarSession();
    if (u?.token) return { "X-Session-Token": String(u.token) };
    return {};
  }

  let sessionBootstrapDone = false;

  async function ensureBarSessionAsync() {
    if (apiHeaders()["X-Session-Token"]) return true;
    if (window.RhKdsStationBootstrap) {
      try {
        await window.RhKdsStationBootstrap.ensureKdsStationSession("banaku");
        sessionBootstrapDone = true;
        return !!apiHeaders()["X-Session-Token"];
      } catch (e) {
        showError(e.message || "Nuk u lidh me POS — kontrolloni Wi‑Fi.");
        return false;
      }
    }
    showError("Paneli i banakut — prit lidhjen me POS.");
    return false;
  }

  function ensureBarSession() {
    if (apiHeaders()["X-Session-Token"]) return true;
    if (!sessionBootstrapDone && window.RhKdsStationBootstrap) {
      void ensureBarSessionAsync().then((ok) => {
        if (ok) fetchLiveTables();
      });
      return false;
    }
    return !!apiHeaders()["X-Session-Token"];
  }

  function fetchOpts(extra) {
    return { credentials: "include", ...extra };
  }

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  }

  function hideError() {
    errorEl?.classList.add("hidden");
  }

  function formatTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleTimeString("sq-AL", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "—";
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatEuro(n) {
    return Number(n || 0).toFixed(2) + " €";
  }

  function orderHead(o) {
    const src = String(o.source_label || "").trim();
    const table = Number(o.table_number) || 0;
    if (src) return src;
    return table ? `T${table}` : "Banak";
  }

  function renderBarTicket(o) {
    const items = (Array.isArray(o.items_json) ? o.items_json : []).map((it) => {
      const qty = Number(it.quantity) || 1;
      const rawName = String(it.name || it.emri || "—");
      const name = escapeHtml(rawName);
      return `<li><span class="qty">${qty}×</span> ${name} <button type="button" class="btn-bar-ready" data-bar-ready="${escapeHtml(o.id)}" data-item="${escapeHtml(rawName)}">Gati</button></li>`;
    }).join("");
    return `<article class="order-ticket" data-id="${escapeHtml(o.id)}">
      <div class="ticket-kind">Banak · pije</div>
      <div class="ticket-head">
        <div class="ticket-table">${escapeHtml(orderHead(o))}</div>
        <div class="ticket-time">${formatTime(o.ordered_at)}</div>
      </div>
      <div class="ticket-waiter">👤 <strong>${escapeHtml(o.waiter_name || "—")}</strong></div>
      <ul class="ticket-items">${items || "<li>—</li>"}</ul>
      <div class="ticket-total">${formatEuro(o.total)}</div>
    </article>`;
  }

  async function fetchBarOrders() {
    if (!ordersGridEl) return;
    if (!ensureBarSession()) return;
    try {
      const res = await fetch(
        apiUrl(`/api/kds/bar/orders${apiQuery()}`),
        fetchOpts({ headers: apiHeaders() }),
      );
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      hideError();
      const orders = data.orders || [];
      if (ordersCountEl) ordersCountEl.textContent = String(orders.length);
      if (ordersEmptyEl) ordersEmptyEl.hidden = orders.length > 0;
      ordersGridEl.innerHTML = orders.map(renderBarTicket).join("");
    } catch {
      /* ignore */
    }
  }

  function renderLiveTableCard(t) {
    if (t.status === "free") {
      return `<div class="bar-table-card free">
        <div class="bar-table-num">${escapeHtml(t.label)}</div>
        <div class="bar-table-status">E lirë</div>
      </div>`;
    }
    const o = t.order || {};
    const isQr = o.source_code === "table";
    const ready = o.order_status === "ready";
    const classes = ["bar-table-card", "occupied", isQr ? "qr" : "", ready ? "ready" : ""].filter(Boolean).join(" ");
    let status = isQr ? "🪑 QR" : "E zënë";
    if (ready) status = isQr ? "QR · Gati" : "Gati";
    const meta = o.accepted_by
      ? escapeHtml(o.accepted_by)
      : (isQr ? "Në pritje" : escapeHtml(o.waiter_name || "—"));
    return `<div class="${classes}">
      <div class="bar-table-num">${escapeHtml(t.label)}</div>
      <div class="bar-table-status">${status}</div>
      <div class="bar-table-total">${formatEuro(o.total)}</div>
      <div class="bar-table-meta" title="${meta}">${meta}</div>
    </div>`;
  }

  function applyVenueName(venue) {
    if (!venue) return;
    titleEl.textContent = `Banak — ${venue}`;
    document.title = `Banak — ${venue}`;
    const venueBar = document.getElementById("bar-venue-name");
    if (venueBar) venueBar.textContent = venue;
  }

  async function fetchLiveTables() {
    if (!tablesGridEl) return;
    if (!ensureBarSession()) return;
    try {
      const res = await fetch(
        apiUrl(`/api/kds/bar/tables/live${apiQuery()}`),
        fetchOpts({ headers: apiHeaders() }),
      );
      const data = await res.json();
      if (res.status === 403 || res.status === 401) {
        sessionBootstrapDone = false;
        if (await ensureBarSessionAsync()) {
          return fetchLiveTables();
        }
        return;
      }
      if (!res.ok || !data.ok) return;
      hideError();
      applyVenueName(data.restaurant_name || "");
      const tables = data.tables || [];
      tablesGridEl.innerHTML = tables.length
        ? tables.map(renderLiveTableCard).join("")
        : '<p class="bar-tables-hint">Nuk ka tavolina të konfiguruara.</p>';
      const stamp = formatTime(data.updated_at || new Date().toISOString());
      if (tablesUpdatedEl) tablesUpdatedEl.textContent = `Përditësuar: ${stamp}`;
      if (syncEl) syncEl.textContent = `Rifreskuar: ${stamp}`;
    } catch {
      /* ignore */
    }
  }

  if (ordersGridEl) {
    ordersGridEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-bar-ready]");
      if (!btn) return;
      btn.disabled = true;
      try {
        const res = await fetch(
          apiUrl(`/api/kds/bar/orders/${encodeURIComponent(btn.dataset.barReady)}/ready${apiQuery()}`),
          fetchOpts({
            method: "POST",
            headers: { ...apiHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ item_name: btn.dataset.item || "" }),
          }),
        );
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showError(data.gabim || "Nuk u shënua si gati.");
          btn.disabled = false;
          return;
        }
        btn.textContent = "Gati";
        fetchBarOrders();
      } catch (err) {
        showError(err.message || "Nuk u shënua si gati.");
        btn.disabled = false;
      }
    });
  }

  function connectLocalStaffEvents() {
    if (!window.LocalStaffEvents) return;
    const refresh = () => {
      fetchBarOrders();
      fetchLiveTables();
    };
    window.LocalStaffEvents.on("order-new", refresh);
    window.LocalStaffEvents.on("table-update", refresh);
    window.LocalStaffEvents.on("order-status", refresh);
    window.LocalStaffEvents.connect(refresh);
  }

  async function bootBar() {
    await ensureBarSessionAsync();
    fetchBarOrders();
    fetchLiveTables();
    connectLocalStaffEvents();
    if (window.LanStatus?.startAdaptivePoll) {
      window.LanStatus.startAdaptivePoll(() => {
        fetchBarOrders();
        fetchLiveTables();
      }, 8000, 30000);
    } else {
      setInterval(() => {
        fetchBarOrders();
        fetchLiveTables();
      }, 30_000);
    }
  }
  void bootBar();
  window.addEventListener("staff-pos-reconnected", () => {
    sessionBootstrapDone = false;
    void ensureBarSessionAsync().then((ok) => { if (ok) fetchLiveTables(); });
  });
})();
