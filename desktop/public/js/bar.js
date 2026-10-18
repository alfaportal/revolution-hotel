(function () {
  function apiUrl(path) {
    return String(path || "");
  }

  const titleEl = document.getElementById("bar-title");
  const errorEl = document.getElementById("error-box");
  const syncEl = document.getElementById("last-sync");
  const tablesGridEl = document.getElementById("bar-tables-grid");
  const tablesUpdatedEl = document.getElementById("bar-tables-updated");

  let eventSource = null;

  function apiQuery() {
    return "";
  }

  function apiHeaders() {
    try {
      const u = JSON.parse(sessionStorage.getItem("rh_user") || "null");
      if (u?.token) return { "X-Session-Token": String(u.token) };
    } catch {
      /* ignore */
    }
    return {};
  }

  function redirectBarLogin() {
    const ret = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login.html?mode=banaku&next=${ret}`);
  }

  function ensureBarSession() {
    if (apiHeaders()["X-Session-Token"]) return true;
    redirectBarLogin();
    return false;
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
      if (res.status === 401 || res.status === 403) {
        redirectBarLogin();
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

  function connectLocalStaffEvents() {
    if (!window.LocalStaffEvents) return;
    window.LocalStaffEvents.on("order-new", () => fetchLiveTables());
    window.LocalStaffEvents.on("table-update", () => fetchLiveTables());
    window.LocalStaffEvents.on("order-status", () => fetchLiveTables());
    window.LocalStaffEvents.connect(() => fetchLiveTables());
  }

  fetchLiveTables();
  connectLocalStaffEvents();
  setInterval(fetchLiveTables, 30_000);
})();
