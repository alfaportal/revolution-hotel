let token = localStorage.getItem("owner_token") || "";

function showBootError(msg) {
  const el = document.getElementById("panel-boot-error");
  if (!el) return;
  if (!msg) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.classList.remove("hidden");
}

function showBootInfo(msg) {
  const el = document.getElementById("panel-boot-info");
  if (!el) return;
  if (!msg) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.classList.remove("hidden");
}

async function verifyOwnerSession() {
  const res = await fetch("/api/auth/owner/me", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  });
  if (!res.ok) return false;
  return true;
}

function redirectOwnerLogin() {
  localStorage.removeItem("owner_token");
  location.href = "/owner/login";
}

async function runBootStep(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.warn(`Panel boot [${label}]:`, err.message);
    showBootError(`Disa të dhëna nuk u ngarkuan (${label}). ${err.message || "Provoni rifreskimin."}`);
  }
}

const PWA_BANNER_KEY = "ri_pos_pwa_banner_dismissed";

function isStandalonePwa() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function initPwaInstallBanner() {
  const banner = document.getElementById("pwa-install-banner");
  const hint = document.getElementById("pwa-install-hint");
  const closeBtn = document.getElementById("pwa-install-close");
  if (!banner || !hint || !closeBtn) return;

  if (isStandalonePwa() || localStorage.getItem(PWA_BANNER_KEY) === "1") return;

  hint.textContent = isIosDevice()
    ? "Kliko Share (□↑) → Add to Home Screen"
    : "Kliko menunë (3 pika) → Add to Home Screen";

  banner.classList.remove("hidden");

  closeBtn.addEventListener("click", () => {
    localStorage.setItem(PWA_BANNER_KEY, "1");
    banner.classList.add("hidden");
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/owner/sw.js?v=8", { scope: "/owner/" }).catch(() => {});
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.gabim || `HTTP ${res.status}`);
  return data;
}

window.ownerApi = api;

window.setOwnerToken = (t) => {
  token = t || "";
  if (token) localStorage.setItem("owner_token", token);
  else localStorage.removeItem("owner_token");
};

window.getOwnerToken = () => token;

window.reloadOwnerDashboard = async () => {
  await runBootStep("klienti", loadClient);
  await runBootStep("tavolinat", loadLiveTables);
  await runBootStep("porositë", async () => {
    await loadOrderFilters();
    await loadOrders();
  });
};

function euro(n) {
  return Number(n || 0).toFixed(2) + " €";
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString("sq-AL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderItemsTable(items) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return '<p class="order-items-empty">—</p>';
  const rows = arr.map(it => {
    const qty = Number(it.quantity ?? it.sasia ?? 1) || 1;
    const price = Number(it.price ?? it.cmimi ?? 0) || 0;
    const name = it.name || it.emri || "—";
    return `<tr>
      <td>${name}</td>
      <td class="num">${qty}</td>
      <td class="num">${euro(price)}</td>
      <td class="num">${euro(price * qty)}</td>
    </tr>`;
  }).join("");
  return `<table class="order-items-table">
    <thead><tr><th>Produkti</th><th>Sasia</th><th>Çmimi</th><th>Nëntotali</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function liveTableSourceLabel(o, t) {
  const direct = String(o?.source_label || "").trim();
  if (direct) return direct;
  const code = String(o?.source_code || "").trim();
  if (code === "table") return "Tavolinë";
  if (code === "takeaway") return "Takeaway";
  if (code === "delivery") return "Delivery";
  if (code === "waiter") return "Kamarier";
  const area = String(t?.area_name || "").trim().toLowerCase();
  if (/online|porosi/.test(area)) return "Online tavolin";
  if (code === "pos" && Number(o?.table_number || t?.number) > 0) return "Tavolinë";
  return "";
}

function renderLiveTableCard(t) {
  if (t.status === "free") {
    return `<div class="live-table-card free">
      <div class="live-table-title">${t.label}</div>
      <div class="live-table-status">E lirë</div>
    </div>`;
  }
  const o = t.order || {};
  const items = Array.isArray(o.items) ? o.items : [];
  const itemsHtml = items.length
    ? `<ul class="live-table-items">${items.map(it => {
        const qty = Number(it.quantity) || 1;
        const price = Number(it.price) || 0;
        return `<li><span>${qty}× ${it.name}</span><span>${euro(price)}</span></li>`;
      }).join("")}</ul>`
    : "";
  const srcLabel = liveTableSourceLabel(o, t);
  const srcHtml = srcLabel
    ? `<div class="live-table-source">${escapeHtml(srcLabel)}</div>`
    : "";
  return `<div class="live-table-card occupied${o.order_status === "ready" ? " ready" : ""}${o.source_code === "table" ? " qr-order" : ""}">
    <div class="live-table-title">${t.label}</div>
    <div class="live-table-status">${o.order_status === "ready" ? "Gati · tavolinë aktive" : "E zënë"}</div>
    <div class="live-table-meta">${o.accepted_by ? `✅ Pranuar: ${o.accepted_by}<br>` : "⏳ Në pritje pranimi<br>"}🕐 ${o.ordered_at ? fmtTime(o.ordered_at) : "—"}</div>
    ${itemsHtml}
    <div class="live-table-total">${euro(o.total)}</div>
    ${srcHtml}
  </div>`;
}

function renderOrderCard(o) {
  const src = o.source || {};
  const waiterLabel = o.accepted_by
    ? `Pranuar: ${o.accepted_by}`
    : (o.waiter_name || "—");
  return `<div class="order-card">
    <div class="order-card-head">
      <span class="order-card-title">${src.icon || ""} ${o.table_number ? `Tavolina ${o.table_number}` : (src.label || "Porosi")}</span>
      <span class="order-card-total">${euro(o.total)}</span>
    </div>
    <div class="order-card-meta">
      <span>🕐 ${fmtTime(o.closed_at)}</span>
      <span>👤 ${waiterLabel}</span>
      ${src.label ? `<span>${src.icon || ""} ${src.label}</span>` : ""}
      ${o.receipt_number ? `<span>🧾 ${o.receipt_number}</span>` : ""}
    </div>
    ${renderItemsTable(o.items_json)}
    <div class="order-card-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-void-order="${o.id}" data-void-table="${o.table_number || ""}" data-void-total="${o.total}" data-void-receipt="${escHtml(o.receipt_number || "")}">Anulo faturën</button>
    </div>
  </div>`;
}

let ownerPackageFeatures = {};
const AI_UPGRADE_MSG = "Kontaktoni Revolution POS për upgrade";
window.AI_UPGRADE_MSG = AI_UPGRADE_MSG;

function applyAiFeatureLock(el, data) {
  if (!el || !data) return;
  const active = !!data.enabled;
  const needsUpgrade = !!data.configured && !data.paused && !data.package_ai;
  if (active) {
    el.removeAttribute("hidden");
    el.classList.remove("hidden", "ai-feature-locked");
    el.removeAttribute("title");
    el.removeAttribute("aria-disabled");
    if (el.disabled !== undefined) el.disabled = false;
  } else if (needsUpgrade) {
    el.removeAttribute("hidden");
    el.classList.remove("hidden");
    el.classList.add("ai-feature-locked");
    el.title = AI_UPGRADE_MSG;
    el.setAttribute("aria-disabled", "true");
    if (el.disabled !== undefined) el.disabled = true;
  } else {
    el.setAttribute("hidden", "");
    el.classList.add("hidden");
    el.classList.remove("ai-feature-locked");
    el.removeAttribute("aria-disabled");
    el.removeAttribute("title");
    if (el.disabled !== undefined) el.disabled = false;
  }
}
window.applyAiFeatureLock = applyAiFeatureLock;

async function loadClient() {
  const data = await api("/api/owner/client");
  const { client, links = {}, features = {}, view_all: viewAll } = data;
  ownerPackageFeatures = features || {};
  if (client) {
    document.getElementById("biz-name").textContent = client.emri || "Paneli i pronarit";
    const tipiLabels = {
      kafene: "Kafene",
      restorant: "Restorant",
      bar: "Bar",
      market: "Market",
      dyqan: "Dyqan",
      tjeter: "Tjetër",
    };
    const typeLbl = viewAll
      ? "Të gjitha"
      : (tipiLabels[client.tipi] || "Lokali");
    document.getElementById("biz-sub").textContent =
      viewAll
        ? `Përmbledhje e ${data.location_count || 0} lokaleve`
        : typeLbl + (client.adresa ? ` · ${client.adresa}` : "");
  } else {
    document.getElementById("biz-sub").textContent = "Shitjet dhe raportet e lokalit tuaj";
  }

  const linksTab = document.getElementById("tab-linqet");
  if (linksTab) linksTab.classList.toggle("hidden", !!viewAll);

  const linksCard = document.getElementById("owner-links-card");
  if (linksCard) linksCard.classList.toggle("hidden", !!viewAll);

  const rows = [
    ["owner-link-bar-row", "owner-bar-url", features.kds, links.bar || data.bar_url],
    ["owner-link-waiter-row", "owner-waiter-url", features.waiter, links.waiter || data.waiter_url],
    ["owner-link-kitchen-row", "owner-kitchen-url", features.kds, links.kitchen || data.kitchen_url],
    ["owner-link-kiosk-row", "owner-kiosk-url", features.kiosk, links.kiosk],
    ["owner-link-public-row", "owner-public-url", features.website, links.public_page],
  ];
  for (const [rowId, inputId, enabled, url] of rows) {
    const row = document.getElementById(rowId);
    if (row) row.classList.toggle("hidden", !enabled);
    const input = document.getElementById(inputId);
    if (input) input.value = enabled ? (url || "") : "";
  }
  const empty = document.getElementById("owner-links-empty");
  if (empty) {
    empty.classList.toggle("hidden", !!(features.waiter || features.kds || features.kiosk || features.website));
  }
}

async function kopjoLinkun(inputId, btn) {
  const val = document.getElementById(inputId).value;
  if (!val) return;
  try {
    await navigator.clipboard.writeText(val);
    const orig = btn.textContent;
    btn.textContent = "U kopjua!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch {
    document.getElementById(inputId).select();
    document.execCommand("copy");
  }
}

document.getElementById("btn-owner-copy-waiter").addEventListener("click", function () {
  kopjoLinkun("owner-waiter-url", this);
});
document.getElementById("btn-owner-copy-kitchen").addEventListener("click", function () {
  kopjoLinkun("owner-kitchen-url", this);
});
document.getElementById("btn-owner-copy-bar")?.addEventListener("click", function () {
  kopjoLinkun("owner-bar-url", this);
});
document.getElementById("btn-owner-copy-kiosk")?.addEventListener("click", function () {
  kopjoLinkun("owner-kiosk-url", this);
});
document.getElementById("btn-owner-copy-public")?.addEventListener("click", function () {
  kopjoLinkun("owner-public-url", this);
});

async function loadOrderFilters() {
  const { waiters, tables } = await api("/api/owner/orders/filters");
  const wSel = document.getElementById("filter-waiter");
  const tSel = document.getElementById("filter-table");
  const wVal = wSel.value;
  const tVal = tSel.value;
  wSel.innerHTML = '<option value="">Të gjithë</option>' +
    (waiters || []).map(w => `<option value="${w}">${w}</option>`).join("");
  tSel.innerHTML = '<option value="">Të gjitha</option>' +
    (tables || []).map(t => `<option value="${t}">Tavolina ${t}</option>`).join("");
  wSel.value = wVal;
  tSel.value = tVal;
}

function parseOwnerBarKdsAccess() {
  const url = (document.getElementById("owner-bar-url")?.value || "").trim();
  if (!url) return null;
  try {
    const u = new URL(url, window.location.origin);
    const parts = u.pathname.split("/").filter(Boolean);
    const slug = parts[0] === "bar" ? parts[1] : "";
    const key = u.searchParams.get("key") || "";
    if (!slug || !key) return null;
    return { slug, key };
  } catch {
    return null;
  }
}

function defaultOwnerOnlineSlots(count = 6) {
  return Array.from({ length: count }, (_, i) => ({
    slot: i + 1,
    label: `Online ${i + 1}`,
    status: "free",
    order: null,
  }));
}

function ownerOnlineSlotTotal(order) {
  const items = Array.isArray(order?.items_json) ? order.items_json : [];
  if (!items.length) return Number(order?.total) || 0;
  return items.reduce((sum, it) => {
    const qty = Number(it.quantity) || 1;
    const price = Number(it.price) || 0;
    return sum + price * qty;
  }, 0);
}

function renderOwnerOnlineSlotCard(slot) {
  const label = escapeHtml(slot.label || `Online ${slot.slot}`);
  if (slot.status === "free" || !slot.order) {
    return `<div class="live-online-slot-card free">
      <div class="live-online-slot-label">${label}</div>
      <div class="live-online-slot-status">Lirë</div>
    </div>`;
  }
  const o = slot.order;
  const pending = slot.status === "pending";
  const statusText = pending
    ? "Në pritje"
    : escapeHtml(String(o.accepted_by_waiter_name || "Pranuar").trim() || "Pranuar");
  const customer = escapeHtml(String(o.waiter_name || "").trim() || "Klient");
  return `<div class="live-online-slot-card ${pending ? "pending" : "occupied"}">
    <div class="live-online-slot-label">${label}</div>
    <div class="live-online-slot-status">${statusText}</div>
    <div class="live-online-slot-meta">${customer}</div>
    <div class="live-online-slot-total">${euro(ownerOnlineSlotTotal(o))}</div>
  </div>`;
}

async function fetchOwnerOnlineSlots() {
  const access = parseOwnerBarKdsAccess();
  if (!access) {
    return { slots: defaultOwnerOnlineSlots(), title: "POROSI ONLINE" };
  }
  const q = `?key=${encodeURIComponent(access.key)}`;
  const res = await fetch(`/api/kds/${encodeURIComponent(access.slug)}/bar/orders${q}`, {
    headers: { "x-kitchen-key": access.key },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.gabim || "Nuk u ngarkuan slotet online.");
  return {
    slots: Array.isArray(data.online_slots) && data.online_slots.length
      ? data.online_slots
      : defaultOwnerOnlineSlots(),
    title: String(data.online_zone_title || "POROSI ONLINE").trim() || "POROSI ONLINE",
  };
}

async function loadLiveOnlineSlots() {
  const zone = document.getElementById("owner-online-zone");
  const grid = document.getElementById("live-online-slots-grid");
  const titleEl = document.getElementById("owner-online-title");
  if (!zone || !grid) return;

  if (!ownerPackageFeatures.kds || !parseOwnerBarKdsAccess()) {
    zone.classList.add("hidden");
    grid.innerHTML = "";
    return;
  }

  zone.classList.remove("hidden");
  try {
    const { slots, title } = await fetchOwnerOnlineSlots();
    if (titleEl) titleEl.textContent = title;
    grid.innerHTML = slots.map(renderOwnerOnlineSlotCard).join("");
  } catch {
    grid.innerHTML = defaultOwnerOnlineSlots().map(renderOwnerOnlineSlotCard).join("");
  }
}

async function loadLiveTables() {
  const data = await api("/api/owner/tables/live");
  const grid = document.getElementById("live-tables-grid");
  const updated = document.getElementById("live-tables-updated");
  if (!grid) return;
  grid.innerHTML = (data.tables || []).map(renderLiveTableCard).join("");
  if (updated && data.updated_at) {
    updated.textContent = `Përditësuar: ${fmtTime(data.updated_at)}`;
  }
  await loadLiveOnlineSlots();
}

function connectOwnerLiveEvents() {
  if (typeof EventSource === "undefined") return;
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  const url = `/api/owner/tables/events${q}`;
  let es;
  const connect = () => {
    es = new EventSource(url);
    es.addEventListener("kitchen", () => {
      if (!document.getElementById("panel-tavolinat")?.classList.contains("hidden")) {
        loadLiveTables().catch(() => {});
      }
    });
    es.onerror = () => {
      es.close();
      setTimeout(connect, 5000);
    };
  };
  connect();
}

async function loadOrders() {
  const q = new URLSearchParams({ limit: "50" });
  const waiter = document.getElementById("filter-waiter").value;
  const table = document.getElementById("filter-table").value;
  if (waiter) q.set("waiter", waiter);
  if (table) q.set("table", table);

  const { orders } = await api(`/api/owner/orders?${q}`);
  const el = document.getElementById("orders-list");
  if (!orders.length) {
    el.innerHTML = '<p style="color:var(--muted)">Nuk ka porosi për këtë filtër.</p>';
    return;
  }
  el.innerHTML = orders.map(renderOrderCard).join("");
  el.querySelectorAll("[data-void-order]").forEach(btn => {
    btn.addEventListener("click", () => openVoidOrderModal({
      id: btn.dataset.voidOrder,
      table_number: btn.dataset.voidTable,
      total: btn.dataset.voidTotal,
      receipt_number: btn.dataset.voidReceipt,
    }));
  });
}

function refuseDefaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

async function loadRefusedOrders() {
  const fromEl = document.getElementById("refuse-from");
  const toEl = document.getElementById("refuse-to");
  const listEl = document.getElementById("refuse-list");
  const statsEl = document.getElementById("refuse-stats");
  if (!listEl) return;
  if (fromEl && !fromEl.value) {
    const r = refuseDefaultRange();
    fromEl.value = r.from;
    if (toEl) toEl.value = r.to;
  }
  const q = new URLSearchParams({ limit: "80" });
  if (fromEl?.value) q.set("from", fromEl.value);
  if (toEl?.value) q.set("to", toEl.value);
  listEl.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Duke ngarkuar…</p>';
  try {
    const data = await api(`/api/owner/refused-orders?${q}`);
    const stats = data.stats || {};
    if (statsEl) {
      statsEl.innerHTML = [
        `<span style="background:#fef2f2;color:#991b1b;padding:.25rem .55rem;border-radius:999px;font-weight:700">Sot: ${stats.today || 0}</span>`,
        `<span style="background:#fff7ed;color:#9a3412;padding:.25rem .55rem;border-radius:999px;font-weight:700">Java: ${stats.week || 0}</span>`,
        `<span style="background:#f3f4f6;color:#374151;padding:.25rem .55rem;border-radius:999px;font-weight:700">Muaji: ${stats.month || 0}</span>`,
      ].join("");
    }
    const orders = data.orders || [];
    if (!orders.length) {
      listEl.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Nuk ka refuzime në këtë periudhë.</p>';
      return;
    }
    listEl.innerHTML = orders.map((o) => {
      const table = o.table_number != null ? `Tav. ${o.table_number}` : "Online";
      return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:.65rem .75rem;margin-bottom:.5rem">
        <div style="display:flex;justify-content:space-between;gap:.5rem;font-size:.8rem;color:var(--muted)">
          <span>${escapeHtml(o.date || "")} · ${escapeHtml(o.time || "")}</span>
          <span>${escapeHtml(table)}</span>
        </div>
        <div style="font-weight:700;margin:.2rem 0">${escapeHtml(o.waiter_name || "Kamarier")}</div>
        <div style="font-size:.88rem;line-height:1.35">${escapeHtml(o.items_summary || "—")}</div>
        <div style="margin-top:.35rem;font-size:.85rem;color:#991b1b"><strong>Arsyeja:</strong> ${escapeHtml(o.reason || "Pa arsye")}</div>
      </div>`;
    }).join("");
  } catch (err) {
    listEl.innerHTML = `<p style="color:#b91c1c;font-size:.9rem">${escapeHtml(err.message || "Gabim")}</p>`;
  }
}

let voidOrderTarget = null;

function setVoidOrderModalMsg(text, ok) {
  const msg = document.getElementById("void-order-modal-msg");
  if (!msg) return;
  msg.textContent = text || "";
  msg.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
}

function openVoidOrderModal(order) {
  voidOrderTarget = order;
  const summary = document.getElementById("void-order-summary");
  if (summary) {
    const parts = [];
    if (order.table_number) parts.push(`Tavolina ${order.table_number}`);
    if (order.receipt_number) parts.push(order.receipt_number);
    parts.push(euro(order.total));
    summary.textContent = parts.join(" · ");
  }
  document.getElementById("void-order-reason").value = "customer_returned";
  document.getElementById("void-order-note").value = "";
  setVoidOrderModalMsg("");
  document.getElementById("void-order-modal")?.classList.remove("hidden");
}

function closeVoidOrderModal() {
  voidOrderTarget = null;
  document.getElementById("void-order-modal")?.classList.add("hidden");
}

async function saveVoidOrderFromModal() {
  if (!voidOrderTarget) return;
  const btn = document.getElementById("btn-void-order-save");
  if (btn) btn.disabled = true;
  setVoidOrderModalMsg("Duke anuluar…", true);
  try {
    await api(`/api/owner/orders/${encodeURIComponent(voidOrderTarget.id)}/void`, {
      method: "POST",
      body: JSON.stringify({
        reason: document.getElementById("void-order-reason")?.value,
        note: document.getElementById("void-order-note")?.value?.trim(),
      }),
    });
    closeVoidOrderModal();
    await loadOrders();
  } catch (err) {
    setVoidOrderModalMsg(err.message, false);
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.getElementById("void-order-close")?.addEventListener("click", closeVoidOrderModal);
document.getElementById("void-order-backdrop")?.addEventListener("click", closeVoidOrderModal);
document.getElementById("btn-void-order-save")?.addEventListener("click", saveVoidOrderFromModal);

async function loadReport() {
  const nga = document.getElementById("raport-nga").value;
  const deri = document.getElementById("raport-deri").value;
  const q = new URLSearchParams();
  if (nga) q.set("from", nga);
  if (deri) q.set("to", deri);
  const { report } = await api(`/api/owner/reports?${q}`);
  document.getElementById("report-summary").textContent =
    `Totali: ${euro(report.total)} · ${report.order_count} porosi`;

  const max = Math.max(...(report.by_day.map(d => d.total)), 1);
  document.getElementById("report-bars").innerHTML = report.by_day.map(d => `
    <div class="report-bar">
      <span style="width:4.5rem">${d.date.slice(5)}</span>
      <div class="bar"><div class="fill" style="width:${Math.round((d.total / max) * 100)}%"></div></div>
      <span>${euro(d.total)}</span>
    </div>`).join("") || '<p style="color:var(--muted)">Nuk ka të dhëna për këtë periudhë.</p>';

  document.getElementById("report-table").innerHTML = report.orders.length
    ? report.orders.map(o => `<tr>
        <td>${fmtTime(o.closed_at)}</td>
        <td>T${o.table_number || "—"}</td>
        <td>${o.waiter_name || "—"}</td>
        <td>${euro(o.total)}</td>
      </tr>`).join("")
    : '<tr><td colspan="4" style="color:var(--muted)">—</td></tr>';
}

const AUDIT_ACTION_LABELS = {
  menu_price_change: "Ndryshim çmimi",
  order_voided: "Faturë e anuluar",
  expense_added: "Shpenzim i shtuar",
  expense_updated: "Shpenzim i ndryshuar",
  expense_deleted: "Shpenzim i fshirë",
};

function auditActionDetails(entry) {
  const d = entry.details || {};
  if (entry.action === "menu_price_change") {
    return `${euro(d.old_price)} → ${euro(d.new_price)}`;
  }
  if (entry.action === "order_voided") {
    return `${d.reason_label || d.reason || "—"}${d.note ? ` — ${d.note}` : ""}`;
  }
  if (entry.action === "expense_added" || entry.action === "expense_deleted") {
    return `${euro(d.amount)}${d.description ? ` — ${d.description}` : ""}`;
  }
  if (entry.action === "expense_updated") {
    return `${euro(d.before?.amount)} → ${euro(d.after?.amount ?? d.before?.amount)}`;
  }
  return JSON.stringify(d);
}

async function loadAuditLog() {
  const body = document.getElementById("audit-log-body");
  if (!body) return;
  try {
    const { entries } = await api("/api/owner/audit-log?limit=100");
    body.innerHTML = (entries || []).length
      ? entries.map(e => `<tr>
          <td>${fmtTime(e.created_at)}</td>
          <td>${AUDIT_ACTION_LABELS[e.action] || escHtml(e.action)}</td>
          <td>${escHtml(e.target_label || "—")}</td>
          <td>${escHtml(auditActionDetails(e))}</td>
          <td>${escHtml(e.actor_email || "—")}</td>
        </tr>`).join("")
      : '<tr><td colspan="5" style="color:var(--muted)">Nuk ka veprime të regjistruara.</td></tr>';
  } catch {
    body.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">Gabim gjatë ngarkimit.</td></tr>';
  }
}

const EXPENSE_CATEGORY_LABELS = {
  pastrim: "Pastrim",
  sherbime: "Shërbime",
  papritur: "Shpenzim i papritur",
  tjeter: "Tjetër",
};

function setExpensesMsg(text, ok) {
  const msg = document.getElementById("expenses-msg");
  if (!msg) return;
  msg.textContent = text || "";
  msg.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
}

function renderExpensesList(expenses) {
  const body = document.getElementById("expenses-list-body");
  if (!body) return;
  body.innerHTML = expenses.length
    ? expenses.map(e => `<tr>
        <td>${fmtDateSq(e.expense_date)}</td>
        <td>${EXPENSE_CATEGORY_LABELS[e.category] || escHtml(e.category)}</td>
        <td>${escHtml(e.vendor_name || "—")}</td>
        <td>${euro(e.amount)}</td>
        <td>${escHtml(e.description || "—")}</td>
        <td>${escHtml(e.entered_by || "—")}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-expense-delete="${e.id}">Fshi</button></td>
      </tr>`).join("")
    : '<tr><td colspan="7" style="color:var(--muted)">Nuk ka shpenzime të regjistruara.</td></tr>';
  body.querySelectorAll("[data-expense-delete]").forEach(btn => {
    btn.addEventListener("click", () => deleteExpense(btn.dataset.expenseDelete));
  });
}

async function loadExpenses() {
  try {
    const { expenses } = await api("/api/owner/expenses?limit=100");
    renderExpensesList(expenses || []);
  } catch (err) {
    setExpensesMsg(err.message, false);
  }
}

async function addExpense() {
  const btn = document.getElementById("btn-expense-add");
  const vendorName = document.getElementById("expense-vendor")?.value?.trim();
  if (!vendorName) {
    setExpensesMsg("Emri i firmës është i detyrueshëm.", false);
    return;
  }
  if (btn) btn.disabled = true;
  setExpensesMsg("Duke ruajtur…", true);
  try {
    await api("/api/owner/expenses", {
      method: "POST",
      body: JSON.stringify({
        category: document.getElementById("expense-category")?.value,
        amount: Number(document.getElementById("expense-amount")?.value),
        vendor_name: vendorName,
        description: document.getElementById("expense-description")?.value?.trim(),
        expense_date: document.getElementById("expense-date")?.value,
      }),
    });
    document.getElementById("expense-amount").value = "";
    document.getElementById("expense-vendor").value = "";
    document.getElementById("expense-description").value = "";
    setExpensesMsg("Shpenzimi u shtua.", true);
    await loadExpenses();
  } catch (err) {
    setExpensesMsg(err.message, false);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteExpense(id) {
  if (!confirm("Fshi këtë shpenzim?")) return;
  try {
    await api(`/api/owner/expenses/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadExpenses();
  } catch (err) {
    setExpensesMsg(err.message, false);
  }
}

const expenseDateInput = document.getElementById("expense-date");
if (expenseDateInput) expenseDateInput.value = new Date().toISOString().slice(0, 10);
document.getElementById("btn-expense-add")?.addEventListener("click", addExpense);

function formatLicenseKey(raw) {
  const clean = String(raw || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 16);
  const parts = [];
  for (let i = 0; i < clean.length; i += 4) parts.push(clean.slice(i, i + 4));
  return parts.join("-");
}

function setOwnerLicenseStatus(activated, text) {
  const box = document.getElementById("owner-license-status");
  const icon = document.getElementById("owner-license-icon");
  const label = document.getElementById("owner-license-text");
  if (!box || !icon || !label) return;
  box.className = "owner-license-status " + (activated ? "active" : "inactive");
  icon.textContent = activated ? "✅" : "❌";
  label.textContent = text || (activated ? "Licenca është aktive." : "Licenca nuk është aktive.");
}

function renderOwnerTerminals(s) {
  const wrap = document.getElementById("owner-terminal-summary");
  const countEl = document.getElementById("owner-terminals-count");
  const warnEl = document.getElementById("owner-terminal-warning");
  const listEl = document.getElementById("owner-terminals-list");
  if (!wrap || !countEl || !warnEl || !listEl) return;

  const active = Number(s.active_terminal_count) || 0;
  const max = Number(s.max_terminals) || 1;
  const terminals = Array.isArray(s.terminals) ? s.terminals : [];

  if (!s.has_license) {
    wrap.classList.add("hidden");
    return;
  }

  wrap.classList.remove("hidden");
  countEl.textContent = `${active} / ${max} të lejuara`;

  const showLimitWarning = Boolean(s.terminal_limit_reached || s.terminal_over_limit);
  warnEl.classList.toggle("hidden", !showLimitWarning);

  if (!terminals.length) {
    listEl.innerHTML = '<p class="owner-terminals-empty">Asnjë terminal aktiv — aktivizoni licencën në POS.</p>';
    return;
  }

  listEl.innerHTML = `<table class="owner-terminals-table">
    <thead><tr><th>ID pajisje</th><th>Kompjuteri</th><th>Pamja e fundit</th></tr></thead>
    <tbody>${terminals.map(t => `<tr>
      <td class="mono">${escHtml(t.device_id || "—")}</td>
      <td>${escHtml(t.device_hostname || "—")}</td>
      <td>${t.last_seen_at ? fmtTime(t.last_seen_at) : "—"}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

async function loadLicense() {
  const msg = document.getElementById("owner-license-msg");
  if (msg) msg.textContent = "";
  try {
    const s = await api("/api/owner/license");
    document.getElementById("owner-license-device-id").value = s.machine_id || "— (aktivizoni në POS)";
    const keyEl = document.getElementById("owner-license-key");
    if (keyEl && s.license_key && !keyEl.value.trim()) {
      keyEl.value = s.license_key;
    }
    setOwnerLicenseStatus(!!s.activated, s.message || "");
    renderOwnerTerminals(s);
  } catch (err) {
    setOwnerLicenseStatus(false, err.message || "Nuk u lexua licenca.");
    renderOwnerTerminals({ has_license: false });
  }
}

let currentZReport = null;

const VAT_LABELS = {
  A: "A — 18%",
  B: "B — 8%",
  C: "C — 0%",
  D: "D — E përjashtuar",
  E: "E — Tjeter",
};

let currentReportMode = "Z";

function zReportDate() {
  const el = document.getElementById("zreport-date");
  return el?.value || new Date().toISOString().slice(0, 10);
}

function periodicFromDate() {
  const el = document.getElementById("periodic-from");
  return el?.value || new Date().toISOString().slice(0, 10);
}

function periodicToDate() {
  const el = document.getElementById("periodic-to");
  return el?.value || new Date().toISOString().slice(0, 10);
}

function initPeriodicDateInputs() {
  const today = new Date().toISOString().slice(0, 10);
  const fromEl = document.getElementById("periodic-from");
  const toEl = document.getElementById("periodic-to");
  if (fromEl && !fromEl.value) fromEl.value = today;
  if (toEl && !toEl.value) toEl.value = today;
}

function reportApiPath() {
  if (currentReportMode === "X") return "x-report";
  if (currentReportMode === "PERIODIC") return "periodic-report";
  return "z-report";
}

function reportExportFilenamePrefix() {
  if (currentReportMode === "PERIODIC") {
    return `periodic-report-${periodicFromDate()}_${periodicToDate()}`;
  }
  return `${reportApiPath()}-${zReportDate()}`;
}

function reportFetchQuery() {
  if (currentReportMode === "PERIODIC") {
    const from = periodicFromDate();
    const to = periodicToDate();
    return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  }
  return `date=${encodeURIComponent(zReportDate())}`;
}

function applyReportModeUi() {
  const isX = currentReportMode === "X";
  const isPeriodic = currentReportMode === "PERIODIC";
  const title = document.getElementById("zreport-title");
  if (title) {
    title.textContent = isPeriodic
      ? "Raport Periodik Fiskal"
      : isX
        ? "Raporti X (i përkohshëm)"
        : "Raporti Ditor (Z-Report)";
  }
  const cashSection = document.getElementById("zreport-cash-section");
  if (cashSection) cashSection.classList.toggle("hidden", isX || isPeriodic);
  const closeBtn = document.getElementById("btn-zreport-close");
  if (closeBtn) closeBtn.classList.toggle("hidden", isX || isPeriodic);
  const dailyDates = document.getElementById("zreport-daily-dates");
  const periodicDates = document.getElementById("zreport-periodic-dates");
  if (dailyDates) dailyDates.classList.toggle("hidden", isPeriodic);
  if (periodicDates) {
    periodicDates.classList.toggle("hidden", !isPeriodic);
    periodicDates.style.display = isPeriodic ? "inline-flex" : "none";
  }
  const historyWrap = document.getElementById("zreport-history-wrap");
  if (historyWrap) historyWrap.classList.toggle("hidden", isPeriodic);
  const btnX = document.getElementById("btn-report-view-x");
  const btnZ = document.getElementById("btn-report-view-z");
  const btnP = document.getElementById("btn-report-view-periodic");
  if (btnX) btnX.classList.toggle("btn-primary", isX);
  if (btnZ) btnZ.classList.toggle("btn-primary", !isX && !isPeriodic);
  if (btnP) btnP.classList.toggle("btn-primary", isPeriodic);
  if (isPeriodic) initPeriodicDateInputs();
}

function renderZReport(report) {
  currentZReport = report;
  const summary = document.getElementById("zreport-summary");
  if (summary) {
    const range = report.receipt_number_range || {};
    summary.innerHTML = `
      <div class="zreport-stat"><div class="lbl">Kuponë fiskalë</div><div class="val">${report.coupon_count ?? 0}</div></div>
      <div class="zreport-stat"><div class="lbl">Rangu i kuponëve</div><div class="val">${range.from || "—"} – ${range.to || "—"}</div></div>
      <div class="zreport-stat"><div class="lbl">Nr. Serial PEF</div><div class="val">${report.pef_serial_number || "—"}</div></div>
      <div class="zreport-stat"><div class="lbl">Qarkullimi ditor</div><div class="val">${euro(report.turnover_total)}</div></div>
      <div class="zreport-stat"><div class="lbl">Totali pa TVSH</div><div class="val">${euro(report.turnover_net)}</div></div>
      <div class="zreport-stat"><div class="lbl">TVSH total</div><div class="val">${euro(report.turnover_vat)}</div></div>
      <div class="zreport-stat"><div class="lbl">Gjendja e arkës</div><div class="val">${euro(report.cash_register_balance)}</div></div>
      <div class="zreport-stat"><div class="lbl">Pagesa Cash</div><div class="val">${euro(report.payment_totals?.cash)}</div></div>
      <div class="zreport-stat"><div class="lbl">Pagesa Kartë</div><div class="val">${euro(report.payment_totals?.karte)}</div></div>
      ${report.report_type === "PERIODIC"
        ? `<div class="zreport-stat"><div class="lbl">Offline</div><div class="val">${report.offline_count ?? 0}</div></div>`
        : `<div class="zreport-stat"><div class="lbl">Qarkullimi kumulativ</div><div class="val">${euro(report.cumulative_turnover)}</div></div>`}`;
  }

  const vatEl = document.getElementById("zreport-vat");
  if (vatEl) {
    const rows = ["A", "B", "C", "D", "E"].map(k => {
      const v = report.vat_breakdown?.[k] || { net: 0, vat: 0, gross: 0 };
      return `<tr><td>${VAT_LABELS[k]}</td><td class="num">${euro(v.net)}</td><td class="num">${euro(v.vat)}</td><td class="num">${euro(v.gross)}</td></tr>`;
    }).join("");
    vatEl.innerHTML = `<strong>TVSH breakdown (A–E)</strong>
      <table><thead><tr><th>Kategoria</th><th>Neto</th><th>TVSH</th><th>Bruto</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  const openingEl = document.getElementById("zreport-opening-float");
  if (openingEl) openingEl.value = report.opening_float != null ? Number(report.opening_float).toFixed(2) : "";
  const closingEl = document.getElementById("zreport-closing-actual");
  if (closingEl) closingEl.value = report.closing_cash_actual != null ? Number(report.closing_cash_actual).toFixed(2) : "";
  const reasonEl = document.getElementById("zreport-diff-reason");
  if (reasonEl) reasonEl.value = report.cash_difference_reason || "";

  const cashSummaryEl = document.getElementById("zreport-cash-summary");
  if (cashSummaryEl) {
    if (report.opening_float == null) {
      cashSummaryEl.innerHTML = '<p style="color:var(--muted)">Vendosni paranë e nisjes së arkës për ditën për të parë barazimin.</p>';
    } else {
      const diff = report.cash_difference;
      cashSummaryEl.innerHTML = `
        <div class="zreport-stat"><div class="lbl">Paraja e nisjes</div><div class="val">${euro(report.opening_float)}</div></div>
        <div class="zreport-stat"><div class="lbl">Paraja e pritshme</div><div class="val">${euro(report.expected_closing_cash)}</div></div>
        ${report.closing_cash_actual != null ? `<div class="zreport-stat"><div class="lbl">Paraja e numëruar</div><div class="val">${euro(report.closing_cash_actual)}</div></div>` : ""}
        ${diff != null ? `<div class="zreport-stat"><div class="lbl">Diferenca</div><div class="val">${euro(diff)}</div></div>` : ""}`;
    }
  }

  const categoryEl = document.getElementById("zreport-by-category");
  if (categoryEl) {
    const rows = report.by_category || [];
    categoryEl.innerHTML = rows.length
      ? rows.map(c => `<tr><td>${c.category}</td><td class="num">${euro(c.total)}</td></tr>`).join("")
      : '<tr><td colspan="2" style="color:var(--muted)">Nuk ka të dhëna.</td></tr>';
  }

  const waiterEl = document.getElementById("zreport-by-waiter");
  if (waiterEl) {
    const rows = report.by_waiter || [];
    waiterEl.innerHTML = rows.length
      ? rows.map(w => `<tr><td>${w.waiter_name}</td><td class="num">${w.order_count}</td><td class="num">${euro(w.total_sales)}</td></tr>`).join("")
      : '<tr><td colspan="3" style="color:var(--muted)">Nuk ka të dhëna.</td></tr>';
  }

  const salesEl = document.getElementById("zreport-sales");
  if (salesEl) {
    const sales = report.sales || [];
    salesEl.innerHTML = sales.length
      ? sales.map(s => `<tr>
          <td>${fmtTime(s.time)}</td>
          <td>T${s.table_number || "—"}</td>
          <td>${s.waiter_name || "—"}</td>
          <td class="num">${euro(s.total)}</td>
          <td>${s.payment_label || "Cash"}</td>
          <td>${s.coupon_nr || "—"}</td>
          <td>${s.payment_status || "—"}</td>
        </tr>`).join("")
      : '<tr><td colspan="7" style="color:var(--muted)">Nuk ka shitje për këtë ditë.</td></tr>';
  }
}

async function loadZReportHistory() {
  const el = document.getElementById("zreport-history");
  if (!el) return;
  try {
    const { history } = await api("/api/owner/z-report/history?limit=30");
    if (!history?.length) {
      el.innerHTML = '<p style="color:var(--muted)">Nuk ka raporte të ruajtura.</p>';
      return;
    }
    el.innerHTML = history.map(h => `
      <div class="zreport-history-item">
        <span><strong>${h.report_date}</strong> · ${h.coupon_count} kuponë · ${euro(h.turnover_total)}</span>
        <span>${h.closed_at ? "Mbyllur" : "Hapur"}</span>
      </div>`).join("");
  } catch {
    el.innerHTML = "";
  }
}

async function loadZReport() {
  applyReportModeUi();
  const { report } = await api(`/api/owner/${reportApiPath()}?${reportFetchQuery()}`);
  renderZReport(report);
  if (currentReportMode === "Z") await loadZReportHistory();
}

async function loadFiscalSettings() {
  try {
    const { settings } = await api("/api/owner/fiscal/settings");
    const nr = document.getElementById("fiscal-nr");
    const com = document.getElementById("fiscal-com");
    const op = document.getElementById("fiscal-operator");
    const model = document.getElementById("fiscal-model");
    const pefSerial = document.getElementById("fiscal-pef-serial");
    const enabled = document.getElementById("fiscal-enabled");
    if (nr) nr.value = settings.fiscal_nr || "";
    if (com) com.value = settings.fiscal_com_port || "";
    if (op) op.value = settings.fiscal_operator_name || "";
    if (model) model.value = settings.fiscal_device_model || "";
    if (pefSerial) pefSerial.value = settings.pef_serial_number || "";
    if (enabled) enabled.checked = settings.fiscal_enabled !== false;
    await loadFiscalDiagnostics();
    await loadRegisterSwitchState();
  } catch { /* */ }
}

function registerModeLabel(mode) {
  if (mode === "fiscal") return "Fiskale";
  if (mode === "thermal") return "Termike";
  return "Automatik";
}

function setRegisterModeBadge(state) {
  const el = document.getElementById("register-mode-badge");
  const select = document.getElementById("register-mode-select");
  if (select) select.value = state.mode || "auto";
  if (!el) return;
  const mode = state.mode || "auto";
  el.className = "fiscal-conn-badge " + (mode === "fiscal" ? "connected" : mode === "thermal" ? "disconnected" : "unknown");
  const who = state.updated_by ? ` — ${state.updated_by}` : "";
  el.textContent = registerModeLabel(mode) + who;
}

async function loadRegisterSwitchState() {
  try {
    const data = await api("/api/owner/register-switch");
    setRegisterModeBadge(data);
  } catch {
    setRegisterModeBadge({ mode: "auto" });
  }
}

function setFiscalConnStatus(state, label) {
  const el = document.getElementById("fiscal-conn-status");
  if (!el) return;
  el.className = "fiscal-conn-badge " + state;
  el.textContent = label;
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function showFiscalDiagMsg(text, ok, suggestions) {
  const msg = document.getElementById("fiscal-diag-msg");
  const list = document.getElementById("fiscal-diag-suggestions");
  if (msg) {
    if (!text) {
      msg.textContent = "";
      msg.className = "fiscal-diag-msg hidden";
    } else {
      msg.textContent = text;
      msg.className = "fiscal-diag-msg " + (ok ? "ok" : "err");
    }
  }
  if (list) {
    if (!suggestions?.length) {
      list.innerHTML = "";
      list.classList.add("hidden");
    } else {
      list.innerHTML = suggestions.map(s => `<li>${escHtml(s)}</li>`).join("");
      list.classList.remove("hidden");
    }
  }
}

async function loadFiscalDiagnostics() {
  try {
    const { diagnostics } = await api("/api/owner/fiscal/diagnostics");
    if (!diagnostics.fiscal_enabled) {
      setFiscalConnStatus("unknown", "Çaktivizuar");
      return;
    }
    if (diagnostics.server_status === "connected") {
      setFiscalConnStatus("connected", "E lidhur");
      return;
    }
    if (diagnostics.server_status === "disconnected") {
      setFiscalConnStatus("disconnected", "E shkëputur");
      return;
    }
    setFiscalConnStatus("unknown", "E panjohur — testoni");
  } catch {
    setFiscalConnStatus("unknown", "E panjohur");
  }
}

async function runFiscalConnectionTest() {
  const testBtn = document.getElementById("btn-fiscal-test");
  const autoBtn = document.getElementById("btn-fiscal-autofind");
  const com = document.getElementById("fiscal-com")?.value || "";
  const enabled = document.getElementById("fiscal-enabled")?.checked !== false;

  if (!enabled) {
    showFiscalDiagMsg("Arka fiskale është çaktivizuar. Aktivizojeni për të testuar lidhjen.", false, []);
    setFiscalConnStatus("unknown", "Çaktivizuar");
    return;
  }

  if (!window.FiscalDiagnostics) {
    showFiscalDiagMsg("Moduli i diagnostikës nuk u ngarkua. Rifreskoni faqen.", false, []);
    return;
  }

  showFiscalDiagMsg("");
  setFiscalConnStatus("testing", "Duke testuar…");
  if (testBtn) testBtn.disabled = true;
  if (autoBtn) autoBtn.disabled = true;

  try {
    const result = await FiscalDiagnostics.testConnection(com);
    if (result.ok) {
      setFiscalConnStatus("connected", "E lidhur");
      showFiscalDiagMsg(result.message || "Lidhja me arkën fiskale u verifikua.", true, []);
      return;
    }
    setFiscalConnStatus("disconnected", "E shkëputur");
    showFiscalDiagMsg(result.error || "Lidhja dështoi.", false, result.suggestions || []);
  } catch (err) {
    setFiscalConnStatus("disconnected", "E shkëputur");
    showFiscalDiagMsg(err.message || "Gabim gjatë testit.", false, FiscalDiagnostics.comSuggestions(com).length
      ? [`Provo ${FiscalDiagnostics.comSuggestions(com).join(", ")}`, "Kontrollo kabllot"]
      : ["Kontrollo kabllot"]);
  } finally {
    if (testBtn) testBtn.disabled = false;
    if (autoBtn) autoBtn.disabled = false;
  }
}

async function runFiscalAutoFind() {
  const testBtn = document.getElementById("btn-fiscal-test");
  const autoBtn = document.getElementById("btn-fiscal-autofind");
  const comInput = document.getElementById("fiscal-com");

  if (!window.FiscalDiagnostics) {
    showFiscalDiagMsg("Moduli i diagnostikës nuk u ngarkua. Rifreskoni faqen.", false, []);
    return;
  }

  showFiscalDiagMsg("");
  setFiscalConnStatus("testing", "Duke skanuar…");
  if (testBtn) testBtn.disabled = true;
  if (autoBtn) autoBtn.disabled = true;

  try {
    const result = await FiscalDiagnostics.autoFindPort();
    if (result.ok) {
      setFiscalConnStatus("connected", "E lidhur");
      if (result.com_port && comInput) {
        comInput.value = result.com_port;
      }
      showFiscalDiagMsg(result.message || "Pajisja u gjet.", true, result.com_port ? [] : ["Ruajeni settings pas përditësimit të COM portit"]);
      return;
    }
    setFiscalConnStatus("disconnected", "E shkëputur");
    showFiscalDiagMsg(result.error || "Nuk u gjet arkë fiskale.", false, result.suggestions || []);
  } catch (err) {
    setFiscalConnStatus("disconnected", "E shkëputur");
    showFiscalDiagMsg(err.message || "Skanimi dështoi.", false, ["Kontrollo kabllot", "Provo COM1, COM2, COM4"]);
  } finally {
    if (testBtn) testBtn.disabled = false;
    if (autoBtn) autoBtn.disabled = false;
  }
}

async function exportZReport(format) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(
    `/api/owner/${reportApiPath()}/export?${reportFetchQuery()}&format=${encodeURIComponent(format)}`,
    { headers, credentials: "include" },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.gabim || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (format === "html" || format === "pdf") {
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = `${reportExportFilenamePrefix()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function printZReport() {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(
    `/api/owner/${reportApiPath()}/export?${reportFetchQuery()}&format=html`,
    { headers, credentials: "include" },
  );
  if (!res.ok) throw new Error("Nuk u gjenerua raporti për printim.");
  const html = await res.text();
  const w = window.open("", "_blank", "noopener");
  if (!w) throw new Error("Lejoni popup për printim.");
  w.document.write(html);
  w.document.close();
  w.onload = () => w.print();
}

let ownerMenuCache = { items: [], categories: [] };

function setMenuMsg(text, ok) {
  const msg = document.getElementById("menu-msg");
  if (!msg) return;
  msg.textContent = text || "";
  msg.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
}

function updateOwnerMenuSyncHint(syncedAt) {
  const hint = document.getElementById("menu-sync-hint");
  if (!hint) return;
  if (syncedAt) {
    ownerMenuCache.synced_at = syncedAt;
    hint.textContent = `Menuja u përditësua: ${fmtTime(syncedAt)} — kamarieri, tavolina, banaku dhe POS e marrin brenda ~15 sekondave.`;
  } else {
    hint.textContent = "Menuja do të shfaqet te kamarieri, tavolina dhe banaku pas ruajtjes.";
  }
}

function renderMenuCategoryOptions(categories) {
  const list = document.getElementById("menu-category-list");
  if (!list) return;
  list.innerHTML = (categories || []).map(c => `<option value="${c.replace(/"/g, "&quot;")}">`).join("");
}

function renderMenuTable() {
  const body = document.getElementById("menu-items-body");
  if (!body) return;
  const items = ownerMenuCache.items || [];
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="8" style="color:var(--muted)">Nuk ka artikuj. Shtoni të parin më sipër ose sinkronizoni nga POS.</td></tr>';
    return;
  }

  body.innerHTML = items.map(item => {
    const photoCell = item.has_photo
      ? `<img class="menu-photo-thumb" src="/api/owner/menu/${item.id}/photo" alt="">`
      : `<div class="menu-photo-placeholder">📷</div>`;
    return `<tr class="${item.active ? "" : "inactive-row"}" data-id="${item.id}">
      <td class="menu-photo-cell">
        ${photoCell}
        <div class="menu-photo-actions">
          <label class="btn btn-ghost btn-sm menu-photo-upload" for="menu-photo-${item.id}">${item.has_photo ? "Ndrysho foto" : "Shto foto"}</label>
          <input type="file" id="menu-photo-${item.id}" class="menu-photo-input" accept="image/png,image/jpeg,image/jpg" hidden data-id="${item.id}">
          ${item.has_photo ? `<button type="button" class="btn btn-ghost btn-sm btn-menu-photo-remove" data-id="${item.id}">Hiq foton</button>` : ""}
        </div>
      </td>
      <td>
        <input type="text" class="menu-edit-barcode" inputmode="numeric" autocomplete="off" value="${escAttr(item.barcode || "")}" placeholder="Barcode" title="USB scanner dërgon numrin + Enter">
        <small class="menu-barcode-status" style="display:block;color:var(--muted);font-size:0.75rem"></small>
      </td>
      <td><input type="text" class="menu-edit-name" value="${escAttr(item.name)}"></td>
      <td>
        <input type="text" class="menu-edit-category" list="menu-category-list" value="${escAttr(item.category)}">
      </td>
      <td><input type="number" class="menu-edit-price menu-price-input" min="0" step="0.01" value="${Number(item.price).toFixed(2)}"></td>
      <td>
        <select class="menu-edit-vat">
          <option value="A" ${item.vat_category === "A" ? "selected" : ""}>A — 18%</option>
          <option value="B" ${item.vat_category === "B" ? "selected" : ""}>B — 8%</option>
          <option value="C" ${item.vat_category === "C" ? "selected" : ""}>C — 0%</option>
          <option value="D" ${item.vat_category === "D" ? "selected" : ""}>D — Përjashtuar</option>
          <option value="E" ${item.vat_category === "E" ? "selected" : ""}>E — Tjetër</option>
        </select>
      </td>
      <td><span class="menu-status ${item.active ? "active" : "inactive"}">${item.active ? "Aktiv" : "Joaktiv"}</span></td>
      <td>
        <div class="menu-row-actions">
          <button type="button" class="btn btn-primary btn-sm btn-menu-save">Ruaj</button>
          <button type="button" class="btn btn-ghost btn-sm btn-menu-toggle">${item.active ? "Fshih" : "Aktivizo"}</button>
          <button type="button" class="btn btn-danger btn-sm btn-menu-delete">Fshi</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  body.querySelectorAll(".btn-menu-save").forEach(btn => {
    btn.addEventListener("click", () => saveMenuRow(btn.closest("tr")));
  });
  body.querySelectorAll(".btn-menu-toggle").forEach(btn => {
    btn.addEventListener("click", () => toggleMenuRow(btn.closest("tr")));
  });
  body.querySelectorAll(".btn-menu-delete").forEach(btn => {
    btn.addEventListener("click", () => deleteMenuRow(btn.closest("tr")));
  });
  body.querySelectorAll(".menu-photo-input").forEach(input => {
    input.addEventListener("change", () => uploadMenuPhoto(input));
  });
  body.querySelectorAll(".btn-menu-photo-remove").forEach(btn => {
    btn.addEventListener("click", () => removeMenuPhoto(btn.dataset.id));
  });
  body.querySelectorAll(".menu-edit-barcode").forEach((input) => {
    input.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      const row = input.closest("tr");
      lookupBarcodeFillName(
        input,
        row?.querySelector(".menu-edit-name"),
        row?.querySelector(".menu-barcode-status"),
      );
    });
  });
}

async function readImageFile(file, maxBytes, label) {
  if (!file) return null;
  if (file.size > maxBytes) {
    throw new Error(`${label} max ${Math.round(maxBytes / 1024)} KB.`);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Nuk u lexua skedari."));
    reader.readAsDataURL(file);
  });
}

async function uploadMenuPhoto(input) {
  const id = input.dataset.id;
  const file = input.files?.[0];
  input.value = "";
  if (!id || !file) return;
  try {
    setMenuMsg("");
    const photo = await readImageFile(file, 512_000, "Fotoja");
    const { item, synced_at } = await api(`/api/owner/menu/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ photo }),
    });
    const idx = ownerMenuCache.items.findIndex(i => i.id === id);
    if (idx >= 0) ownerMenuCache.items[idx] = item;
    renderMenuTable();
    updateOwnerMenuSyncHint(synced_at);
    setMenuMsg("Fotoja u ruajt — shfaqet te tavolina, kamarieri, banaku dhe faqja publike.", true);
  } catch (err) {
    setMenuMsg(err.message, false);
  }
}

async function removeMenuPhoto(id) {
  if (!id) return;
  try {
    setMenuMsg("");
    const { item, synced_at } = await api(`/api/owner/menu/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ photo: "" }),
    });
    const idx = ownerMenuCache.items.findIndex(i => i.id === id);
    if (idx >= 0) ownerMenuCache.items[idx] = item;
    renderMenuTable();
    updateOwnerMenuSyncHint(synced_at);
    setMenuMsg("Fotoja u hoq — shfaqet fotoja e paracaktuar e katalogut (nëse ka).", true);
  } catch (err) {
    setMenuMsg(err.message, false);
  }
}

function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

async function loadOwnerMenu() {
  const data = await api("/api/owner/menu");
  ownerMenuCache = {
    items: data.items || [],
    categories: data.categories || [],
    synced_at: data.synced_at,
  };
  renderMenuCategoryOptions(ownerMenuCache.categories);
  renderMenuTable();
  updateOwnerMenuSyncHint(data.synced_at);
}

window.loadOwnerMenu = loadOwnerMenu;

async function saveMenuRow(row) {
  if (!row) return;
  const id = row.dataset.id;
  const name = row.querySelector(".menu-edit-name")?.value?.trim();
  const category = row.querySelector(".menu-edit-category")?.value?.trim();
  const price = Number(row.querySelector(".menu-edit-price")?.value);
  const vat_category = row.querySelector(".menu-edit-vat")?.value;
  const barcode = row.querySelector(".menu-edit-barcode")?.value?.trim() || "";
  if (!name || !category) {
    setMenuMsg("Emri dhe kategoria janë të detyrueshme.", false);
    return;
  }
  try {
    setMenuMsg("");
    const { item, synced_at } = await api(`/api/owner/menu/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, category, price, vat_category, barcode }),
    });
    const idx = ownerMenuCache.items.findIndex(i => i.id === id);
    if (idx >= 0) ownerMenuCache.items[idx] = item;
    if (!ownerMenuCache.categories.includes(item.category)) {
      ownerMenuCache.categories.push(item.category);
      renderMenuCategoryOptions(ownerMenuCache.categories);
    }
    renderMenuTable();
    updateOwnerMenuSyncHint(synced_at);
    setMenuMsg("Artikulli u ruajt — shfaqet te tabletat e porosive.", true);
  } catch (err) {
    setMenuMsg(err.message, false);
  }
}

async function toggleMenuRow(row) {
  if (!row) return;
  const id = row.dataset.id;
  const item = ownerMenuCache.items.find(i => i.id === id);
  if (!item) return;
  try {
    setMenuMsg("");
    const { item: updated, synced_at } = await api(`/api/owner/menu/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !item.active }),
    });
    item.active = updated.active;
    renderMenuTable();
    updateOwnerMenuSyncHint(synced_at);
    setMenuMsg(updated.active ? "Artikulli u aktivizua." : "Artikulli u fsheh nga tabletat.", true);
  } catch (err) {
    setMenuMsg(err.message, false);
  }
}

async function deleteMenuRow(row) {
  if (!row) return;
  const id = row.dataset.id;
  const name = row.querySelector(".menu-edit-name")?.value?.trim() || "artikullin";
  if (!confirm(`Fshi "${name}" përgjithmonë?`)) return;
  try {
    setMenuMsg("");
    const { synced_at } = await api(`/api/owner/menu/${id}`, { method: "DELETE" });
    ownerMenuCache.items = ownerMenuCache.items.filter(i => i.id !== id);
    renderMenuTable();
    updateOwnerMenuSyncHint(synced_at);
    setMenuMsg("Artikulli u fshi.", true);
  } catch (err) {
    setMenuMsg(err.message, false);
  }
}

let ownerVenueCache = { areas: [], staff: [], table_count: 0 };

function setVenueMsg(text, ok) {
  const msg = document.getElementById("venue-msg");
  if (!msg) return;
  msg.textContent = text || "";
  msg.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
}

function updateVenueSyncHint(syncedAt, tableCount) {
  const hint = document.getElementById("venue-sync-hint");
  const fallback = document.getElementById("venue-fallback-count");
  if (fallback) fallback.textContent = String(tableCount ?? ownerVenueCache.table_count ?? "—");
  if (!hint) return;
  if (syncedAt) {
    ownerVenueCache.synced_at = syncedAt;
    hint.textContent = `U përditësua: ${fmtTime(syncedAt)} — kamarieri e merr brenda ~15 sekondave.`;
  } else {
    hint.textContent = "Ndryshimet shfaqen te tabletat e kamarierit pas ruajtjes.";
  }
}

function renderVenueAreas() {
  const body = document.getElementById("venue-areas-body");
  if (!body) return;
  const areas = ownerVenueCache.areas || [];
  if (!areas.length) {
    body.innerHTML = '<tr><td colspan="4" style="color:var(--muted)">Nuk ka hapësira. Shtoni Sallë, Terasë etj.</td></tr>';
    return;
  }
  body.innerHTML = areas.map(area => `
    <tr class="${area.active ? "" : "inactive-row"}" data-id="${area.id}">
      <td><input type="text" class="venue-edit-name" value="${escAttr(area.name)}"></td>
      <td><input type="number" class="venue-edit-count" min="1" max="30" value="${Number(area.table_count)}"></td>
      <td><span class="menu-status ${area.active ? "active" : "inactive"}">${area.active ? "Aktive" : "Joaktive"}</span></td>
      <td>
        <div class="menu-row-actions">
          <button type="button" class="btn btn-primary btn-sm btn-area-save">Ruaj</button>
          <button type="button" class="btn btn-ghost btn-sm btn-area-toggle">${area.active ? "Fshih" : "Aktivizo"}</button>
          <button type="button" class="btn btn-danger btn-sm btn-area-delete">Fshi</button>
        </div>
      </td>
    </tr>`).join("");
  body.querySelectorAll(".btn-area-save").forEach(btn => {
    btn.addEventListener("click", () => saveAreaRow(btn.closest("tr")));
  });
  body.querySelectorAll(".btn-area-toggle").forEach(btn => {
    btn.addEventListener("click", () => toggleAreaRow(btn.closest("tr")));
  });
  body.querySelectorAll(".btn-area-delete").forEach(btn => {
    btn.addEventListener("click", () => deleteAreaRow(btn.closest("tr")));
  });
}

function renderVenueStaff() {
  const body = document.getElementById("venue-staff-body");
  if (!body) return;
  const staff = ownerVenueCache.staff || [];
  if (!staff.length) {
    body.innerHTML = '<tr><td colspan="4" style="color:var(--muted)">Nuk ka staf. Shtoni kamarierë ose kuzhinierë.</td></tr>';
    return;
  }
  body.innerHTML = staff.map(member => `
    <tr class="${member.active ? "" : "inactive-row"}" data-id="${member.id}">
      <td><input type="text" class="venue-edit-staff-name" value="${escAttr(member.name)}"></td>
      <td>
        <select class="venue-edit-staff-role">
          <option value="waiter"${member.role === "waiter" ? " selected" : ""}>Kamarier</option>
          <option value="kitchen"${member.role === "kitchen" ? " selected" : ""}>Kuzhinier</option>
        </select>
      </td>
      <td><span class="menu-status ${member.active ? "active" : "inactive"}">${member.active ? "Aktiv" : "Joaktiv"}</span></td>
      <td>
        <div class="menu-row-actions">
          <button type="button" class="btn btn-primary btn-sm btn-staff-save">Ruaj</button>
          <button type="button" class="btn btn-ghost btn-sm btn-staff-toggle">${member.active ? "Fshih" : "Aktivizo"}</button>
          <button type="button" class="btn btn-danger btn-sm btn-staff-delete">Fshi</button>
        </div>
      </td>
    </tr>`).join("");
  body.querySelectorAll(".btn-staff-save").forEach(btn => {
    btn.addEventListener("click", () => saveStaffRow(btn.closest("tr")));
  });
  body.querySelectorAll(".btn-staff-toggle").forEach(btn => {
    btn.addEventListener("click", () => toggleStaffRow(btn.closest("tr")));
  });
  body.querySelectorAll(".btn-staff-delete").forEach(btn => {
    btn.addEventListener("click", () => deleteStaffRow(btn.closest("tr")));
  });
}

async function loadOwnerVenue() {
  const data = await api("/api/owner/venue");
  ownerVenueCache = {
    areas: data.areas || [],
    staff: data.staff || [],
    table_count: data.table_count || 0,
    synced_at: data.synced_at,
  };
  renderVenueAreas();
  renderVenueStaff();
  updateVenueSyncHint(data.synced_at, data.table_count);
}

async function saveAreaRow(row) {
  if (!row) return;
  const id = row.dataset.id;
  const name = row.querySelector(".venue-edit-name")?.value?.trim();
  const table_count = Number(row.querySelector(".venue-edit-count")?.value);
  if (!name) {
    setVenueMsg("Shkruani emrin e hapësirës.", false);
    return;
  }
  try {
    setVenueMsg("");
    const { area, synced_at } = await api(`/api/owner/venue/areas/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, table_count }),
    });
    const idx = ownerVenueCache.areas.findIndex(a => a.id === id);
    if (idx >= 0) ownerVenueCache.areas[idx] = area;
    renderVenueAreas();
    updateVenueSyncHint(synced_at, ownerVenueCache.table_count);
    setVenueMsg("Hapësira u ruajt.", true);
  } catch (err) {
    setVenueMsg(err.message, false);
  }
}

async function toggleAreaRow(row) {
  if (!row) return;
  const id = row.dataset.id;
  const area = ownerVenueCache.areas.find(a => a.id === id);
  if (!area) return;
  try {
    setVenueMsg("");
    const { area: updated, synced_at } = await api(`/api/owner/venue/areas/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !area.active }),
    });
    Object.assign(area, updated);
    renderVenueAreas();
    updateVenueSyncHint(synced_at);
    setVenueMsg(updated.active ? "Hapësira u aktivizua." : "Hapësira u fsheh.", true);
  } catch (err) {
    setVenueMsg(err.message, false);
  }
}

async function deleteAreaRow(row) {
  if (!row) return;
  const id = row.dataset.id;
  const name = row.querySelector(".venue-edit-name")?.value?.trim() || "hapësirën";
  if (!confirm(`Fshi "${name}"?`)) return;
  try {
    setVenueMsg("");
    const { synced_at } = await api(`/api/owner/venue/areas/${id}`, { method: "DELETE" });
    ownerVenueCache.areas = ownerVenueCache.areas.filter(a => a.id !== id);
    renderVenueAreas();
    updateVenueSyncHint(synced_at);
    setVenueMsg("Hapësira u fshi.", true);
  } catch (err) {
    setVenueMsg(err.message, false);
  }
}

async function saveStaffRow(row) {
  if (!row) return;
  const id = row.dataset.id;
  const name = row.querySelector(".venue-edit-staff-name")?.value?.trim();
  const role = row.querySelector(".venue-edit-staff-role")?.value;
  if (!name) {
    setVenueMsg("Shkruani emrin e stafit.", false);
    return;
  }
  try {
    setVenueMsg("");
    const { member, synced_at } = await api(`/api/owner/venue/staff/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, role }),
    });
    const idx = ownerVenueCache.staff.findIndex(s => s.id === id);
    if (idx >= 0) ownerVenueCache.staff[idx] = member;
    renderVenueStaff();
    updateVenueSyncHint(synced_at);
    setVenueMsg("Stafi u ruajt.", true);
  } catch (err) {
    setVenueMsg(err.message, false);
  }
}

async function toggleStaffRow(row) {
  if (!row) return;
  const id = row.dataset.id;
  const member = ownerVenueCache.staff.find(s => s.id === id);
  if (!member) return;
  try {
    setVenueMsg("");
    const { member: updated, synced_at } = await api(`/api/owner/venue/staff/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !member.active }),
    });
    Object.assign(member, updated);
    renderVenueStaff();
    updateVenueSyncHint(synced_at);
    setVenueMsg(updated.active ? "Stafi u aktivizua." : "Stafi u fsheh.", true);
  } catch (err) {
    setVenueMsg(err.message, false);
  }
}

async function deleteStaffRow(row) {
  if (!row) return;
  const id = row.dataset.id;
  const name = row.querySelector(".venue-edit-staff-name")?.value?.trim() || "anëtarin";
  if (!confirm(`Fshi "${name}"?`)) return;
  try {
    setVenueMsg("");
    const { synced_at } = await api(`/api/owner/venue/staff/${id}`, { method: "DELETE" });
    ownerVenueCache.staff = ownerVenueCache.staff.filter(s => s.id !== id);
    renderVenueStaff();
    updateVenueSyncHint(synced_at);
    setVenueMsg("Stafi u fshi.", true);
  } catch (err) {
    setVenueMsg(err.message, false);
  }
}

document.getElementById("owner-license-key")?.addEventListener("input", e => {
  const el = e.target;
  el.value = formatLicenseKey(el.value);
});

document.getElementById("btn-owner-copy-device-id")?.addEventListener("click", function () {
  kopjoLinkun("owner-license-device-id", this);
});

document.getElementById("btn-owner-license-save")?.addEventListener("click", async () => {
  const msg = document.getElementById("owner-license-msg");
  const license_key = formatLicenseKey(document.getElementById("owner-license-key").value);
  if (!license_key) {
    msg.textContent = "Shkruani çelësin e licencës.";
    msg.className = "owner-license-msg err";
    return;
  }
  try {
    const r = await api("/api/owner/license", {
      method: "PUT",
      body: JSON.stringify({ license_key }),
    });
    msg.textContent = r.info || "Çelësi u verifikua.";
    msg.className = "owner-license-msg ok";
    await loadLicense();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "owner-license-msg err";
  }
});

const PUBLIC_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const PUBLIC_DAY_LABELS = {
  mon: "E hënë",
  tue: "E martë",
  wed: "E mërkurë",
  thu: "E enjte",
  fri: "E premte",
  sat: "E shtunë",
  sun: "E diel",
};

let publicPageLogoData = undefined;
let publicPageLogoDirty = false;
let publicCoverData = undefined;
let publicCoverDirty = false;
let publicGalleryData = [];
let publicGalleryDirty = false;
let publicReviewsData = [];

function readImageFile(file, maxBytes, onDone) {
  if (!file) return;
  if (file.size > maxBytes) {
    setPublicPageMsg(`Skedari max ${Math.round(maxBytes / 1024)} KB.`, false);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => onDone(reader.result);
  reader.readAsDataURL(file);
}

function updatePublicCoverPreview(dataUrl) {
  const img = document.getElementById("public-cover-preview");
  const ph = document.getElementById("public-cover-placeholder");
  if (dataUrl) {
    img.src = dataUrl;
    img.classList.remove("hidden");
    ph?.classList.add("hidden");
  } else {
    img.removeAttribute("src");
    img.classList.add("hidden");
    ph?.classList.remove("hidden");
  }
}

function renderPublicGalleryGrid() {
  const grid = document.getElementById("public-gallery-grid");
  const input = document.getElementById("public-gallery-input");
  if (!grid) return;
  grid.innerHTML = publicGalleryData.map((url, idx) => `
    <div class="public-gallery-item">
      <img src="${escAttr(url)}" alt="Galeri ${idx + 1}">
      <button type="button" class="btn btn-danger btn-sm" data-gallery-remove="${idx}">×</button>
    </div>
  `).join("");
  grid.querySelectorAll("[data-gallery-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      publicGalleryData.splice(Number(btn.dataset.galleryRemove), 1);
      publicGalleryDirty = true;
      renderPublicGalleryGrid();
    });
  });
  if (input) {
    input.disabled = publicGalleryData.length >= 5;
  }
}

function renderPublicReviewsEditor() {
  const list = document.getElementById("public-reviews-list");
  const addBtn = document.getElementById("btn-public-review-add");
  if (!list) return;

  list.innerHTML = publicReviewsData.map((row, idx) => {
    const stars = Math.max(1, Math.min(5, Number(row.stars) || 5));
    const starBtns = [1, 2, 3, 4, 5].map(n =>
      `<button type="button" class="${n <= stars ? "active" : ""}" data-review-star="${idx}" data-star="${n}" aria-label="${n} yje">★</button>`,
    ).join("");
    return `
      <div class="public-review-row" data-review-idx="${idx}">
        <div class="public-review-row-head">
          <input type="text" class="public-review-name" value="${escAttr(row.name || "")}" placeholder="Emri i klientit" maxlength="80">
          <div class="public-review-stars">${starBtns}</div>
          <button type="button" class="btn btn-danger btn-sm" data-review-remove="${idx}">Fshi</button>
        </div>
        <textarea class="public-review-text" rows="2" maxlength="500" placeholder="Koment (opsional)">${escHtml(row.text || "")}</textarea>
      </div>`;
  }).join("");

  list.querySelectorAll("[data-review-star]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.reviewStar);
      publicReviewsData[idx].stars = Number(btn.dataset.star);
      renderPublicReviewsEditor();
    });
  });
  list.querySelectorAll("[data-review-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      publicReviewsData.splice(Number(btn.dataset.reviewRemove), 1);
      renderPublicReviewsEditor();
    });
  });
  list.querySelectorAll(".public-review-name").forEach((el, idx) => {
    el.addEventListener("input", () => {
      publicReviewsData[idx].name = el.value;
    });
  });
  list.querySelectorAll(".public-review-text").forEach((el, idx) => {
    el.addEventListener("input", () => {
      publicReviewsData[idx].text = el.value;
    });
  });

  if (addBtn) {
    addBtn.disabled = publicReviewsData.length >= 5;
  }
}

function collectPublicReviews() {
  return publicReviewsData
    .map(r => ({
      name: String(r.name || "").trim(),
      stars: Math.max(1, Math.min(5, Number(r.stars) || 5)),
      text: String(r.text || "").trim(),
    }))
    .filter(r => r.name);
}

function setPublicPageMsg(text, ok) {
  const msg = document.getElementById("public-page-msg");
  if (!msg) return;
  msg.textContent = text || "";
  msg.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
}

function renderPublicHoursGrid(hours) {
  const grid = document.getElementById("public-hours-grid");
  if (!grid) return;
  grid.innerHTML = PUBLIC_DAY_KEYS.map(key => {
    const row = hours?.[key] || { open: "09:00", close: "22:00", closed: false };
    return `
      <div class="public-hours-row" data-day="${key}">
        <span class="public-hours-day">${PUBLIC_DAY_LABELS[key]}</span>
        <label class="public-hours-closed">
          <input type="checkbox" class="public-hours-closed-cb" ${row.closed ? "checked" : ""}>
          Mbyllur
        </label>
        <input type="time" class="public-hours-open" value="${row.open || "09:00"}" ${row.closed ? "disabled" : ""}>
        <span class="public-hours-sep">–</span>
        <input type="time" class="public-hours-close" value="${row.close || "22:00"}" ${row.closed ? "disabled" : ""}>
      </div>`;
  }).join("");

  grid.querySelectorAll(".public-hours-closed-cb").forEach(cb => {
    cb.addEventListener("change", () => {
      const row = cb.closest(".public-hours-row");
      const disabled = cb.checked;
      row.querySelector(".public-hours-open").disabled = disabled;
      row.querySelector(".public-hours-close").disabled = disabled;
    });
  });
}

function collectPublicHours() {
  const hours = {};
  document.querySelectorAll(".public-hours-row").forEach(row => {
    const key = row.dataset.day;
    const closed = row.querySelector(".public-hours-closed-cb")?.checked;
    hours[key] = {
      open: row.querySelector(".public-hours-open")?.value || "09:00",
      close: row.querySelector(".public-hours-close")?.value || "22:00",
      closed: Boolean(closed),
    };
  });
  return hours;
}

function updatePublicLogoPreview(dataUrl) {
  const img = document.getElementById("public-logo-preview");
  const ph = document.getElementById("public-logo-placeholder");
  if (dataUrl) {
    img.src = dataUrl;
    img.classList.remove("hidden");
    ph?.classList.add("hidden");
  } else {
    img.removeAttribute("src");
    img.classList.add("hidden");
    ph?.classList.remove("hidden");
  }
}

let publicPageUrlPrefix = "/r/";

function updatePublicSlugPreview(slug) {
  const preview = document.getElementById("public-slug-preview");
  if (preview) preview.textContent = slug || "slug";
  const prefixEl = document.getElementById("public-slug-prefix");
  if (prefixEl) prefixEl.textContent = publicPageUrlPrefix;
  const pathEl = document.getElementById("public-slug-path");
  if (pathEl) pathEl.textContent = publicPageUrlPrefix;
}

const PUBLIC_SLUG_CHARS_RE = /^[a-z0-9-]*$/;
const PUBLIC_SLUG_FULL_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PUBLIC_SLUG_MIN = 3;
const PUBLIC_SLUG_MAX = 48;

function sanitizePublicSlugInput(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function validatePublicSlugClient(raw) {
  const slug = sanitizePublicSlugInput(raw);
  if (slug.length < PUBLIC_SLUG_MIN || slug.length > PUBLIC_SLUG_MAX) {
    throw new Error(`Slug duhet ${PUBLIC_SLUG_MIN}–${PUBLIC_SLUG_MAX} karaktere.`);
  }
  if (!PUBLIC_SLUG_FULL_RE.test(slug)) {
    throw new Error("Slug lejon vetëm a-z, 0-9 dhe vizë (-), pa vizë në fillim/fund.");
  }
  return slug;
}

function getPublicPageTargetUrl() {
  const slugInput = document.getElementById("public-page-slug")?.value;
  const prefix = publicPageUrlPrefix || "/r/";
  try {
    const slug = validatePublicSlugClient(slugInput);
    return `${window.location.origin}${prefix}${encodeURIComponent(slug)}`;
  } catch {
    const saved = document.getElementById("public-page-url")?.value?.trim();
    if (saved) return saved;
    throw new Error("Shkruani slug të vlefshme (a-z, 0-9, vizë) ose ruajeni fillimisht.");
  }
}

function renderPublicPageQrCanvas(url) {
  const canvasWrap = document.getElementById("public-page-qr-canvas");
  if (!canvasWrap) throw new Error("Mungon zona e QR.");
  if (typeof QRCode === "undefined") throw new Error("Biblioteka qrcode.js nuk u ngarkua.");
  canvasWrap.innerHTML = "";
  // eslint-disable-next-line no-new
  new QRCode(canvasWrap, {
    text: url,
    width: 200,
    height: 200,
    colorDark: "#0f172a",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M,
  });
}

function getPublicPageQrPngDataUrl() {
  const canvas = document.querySelector("#public-page-qr-canvas canvas");
  if (!canvas) throw new Error("Gjeneroni QR fillimisht.");
  return canvas.toDataURL("image/png");
}

function resetPublicPageQrPreview() {
  publicPageQrData = null;
  document.getElementById("public-page-qr-preview")?.classList.add("hidden");
  const canvasWrap = document.getElementById("public-page-qr-canvas");
  if (canvasWrap) canvasWrap.innerHTML = "";
  const urlEl = document.getElementById("public-page-qr-url");
  if (urlEl) urlEl.textContent = "";
  const dlBtn = document.getElementById("btn-public-download-qr");
  if (dlBtn) dlBtn.disabled = true;
}

let publicPageQrData = null;

async function loadPublicPage() {
  setPublicPageMsg("");
  try {
    const data = await api("/api/owner/public-page");
    const upgrade = document.getElementById("public-page-upgrade");
    if (upgrade) {
      if (data.website_enabled === false) {
        upgrade.textContent = "Paketa juaj nuk përfshin faqen publike. Kontaktoni administratorin.";
        upgrade.classList.remove("hidden");
      } else {
        upgrade.classList.add("hidden");
      }
    }

    publicPageUrlPrefix = data.url_prefix || (data.storefront_type === "shop" ? "/s/" : "/r/");
    document.getElementById("public-enabled").checked = data.public_enabled !== false;
    document.getElementById("public-description").value = data.public_description || "";
    document.getElementById("public-theme").value = data.public_theme_color || "#c2410c";
    document.getElementById("public-page-url").value = data.public_url || "";
    const slugInput = document.getElementById("public-page-slug");
    if (slugInput) slugInput.value = data.slug || "";
    updatePublicSlugPreview(data.slug || "");
    resetPublicPageQrPreview();
    const preview = document.getElementById("btn-public-preview");
    if (preview && data.public_url) preview.href = data.public_url;

    publicPageLogoData = data.logo_preview || null;
    publicPageLogoDirty = false;
    updatePublicLogoPreview(publicPageLogoData);

    publicCoverData = data.cover_preview || null;
    publicCoverDirty = false;
    updatePublicCoverPreview(publicCoverData);

    publicGalleryData = Array.isArray(data.gallery_previews) ? [...data.gallery_previews] : [];
    publicGalleryDirty = false;
    renderPublicGalleryGrid();

    publicReviewsData = Array.isArray(data.reviews)
      ? data.reviews.map(r => ({ name: r.name || "", stars: r.stars || 5, text: r.text || "" }))
      : [];
    renderPublicReviewsEditor();

    document.getElementById("public-daily-offer").value = data.daily_offer || "";
    document.getElementById("public-social-instagram").value = data.social_instagram || "";
    document.getElementById("public-social-facebook").value = data.social_facebook || "";
    document.getElementById("public-social-tiktok").value = data.social_tiktok || "";
    document.getElementById("public-whatsapp").value = data.public_whatsapp || "";

    renderPublicHoursGrid(data.public_hours);
  } catch (err) {
    setPublicPageMsg(err.message, false);
  }
}

async function savePublicPage() {
  setPublicPageMsg("Duke ruajtur…", true);
  try {
    const body = {
      public_enabled: document.getElementById("public-enabled").checked,
      public_description: document.getElementById("public-description").value,
      public_hours: collectPublicHours(),
      public_theme_color: document.getElementById("public-theme").value,
      public_daily_offer: document.getElementById("public-daily-offer").value,
      public_reviews: collectPublicReviews(),
      public_social_instagram: document.getElementById("public-social-instagram").value,
      public_social_facebook: document.getElementById("public-social-facebook").value,
      public_social_tiktok: document.getElementById("public-social-tiktok").value,
      public_whatsapp: document.getElementById("public-whatsapp").value,
    };
    if (publicPageLogoDirty) {
      body.public_logo = publicPageLogoData || "";
    }
    if (publicCoverDirty) {
      body.public_cover = publicCoverData || "";
    }
    if (publicGalleryDirty) {
      body.public_gallery = publicGalleryData;
    }
    const data = await api("/api/owner/public-page", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    publicPageLogoData = data.logo_preview || null;
    publicPageLogoDirty = false;
    updatePublicLogoPreview(publicPageLogoData);
    publicCoverData = data.cover_preview || null;
    publicCoverDirty = false;
    updatePublicCoverPreview(publicCoverData);
    publicGalleryData = Array.isArray(data.gallery_previews) ? [...data.gallery_previews] : [];
    publicGalleryDirty = false;
    renderPublicGalleryGrid();
    publicReviewsData = Array.isArray(data.reviews)
      ? data.reviews.map(r => ({ name: r.name || "", stars: r.stars || 5, text: r.text || "" }))
      : [];
    renderPublicReviewsEditor();
    document.getElementById("public-page-url").value = data.public_url || "";
    setPublicPageMsg("Faqja publike u ruajt.", true);
  } catch (err) {
    setPublicPageMsg(err.message, false);
  }
}

document.getElementById("public-logo-input")?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 512_000) {
    setPublicPageMsg("Logo max 500 KB.", false);
    e.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    publicPageLogoData = reader.result;
    publicPageLogoDirty = true;
    updatePublicLogoPreview(publicPageLogoData);
    setPublicPageMsg("");
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});

document.getElementById("btn-public-logo-remove")?.addEventListener("click", () => {
  publicPageLogoData = null;
  publicPageLogoDirty = true;
  updatePublicLogoPreview(null);
});

document.getElementById("public-cover-input")?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  readImageFile(file, 800_000, (dataUrl) => {
    publicCoverData = dataUrl;
    publicCoverDirty = true;
    updatePublicCoverPreview(publicCoverData);
    setPublicPageMsg("");
  });
  e.target.value = "";
});

document.getElementById("btn-public-cover-remove")?.addEventListener("click", () => {
  publicCoverData = null;
  publicCoverDirty = true;
  updatePublicCoverPreview(null);
});

document.getElementById("public-gallery-input")?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (publicGalleryData.length >= 5) {
    setPublicPageMsg("Maksimum 5 foto në galeri.", false);
    e.target.value = "";
    return;
  }
  readImageFile(file, 512_000, (dataUrl) => {
    publicGalleryData.push(dataUrl);
    publicGalleryDirty = true;
    renderPublicGalleryGrid();
    setPublicPageMsg("");
  });
  e.target.value = "";
});

document.getElementById("btn-public-review-add")?.addEventListener("click", () => {
  if (publicReviewsData.length >= 5) return;
  publicReviewsData.push({ name: "", stars: 5, text: "" });
  renderPublicReviewsEditor();
});

document.getElementById("btn-public-save")?.addEventListener("click", savePublicPage);

document.getElementById("public-page-slug")?.addEventListener("input", e => {
  const cleaned = sanitizePublicSlugInput(e.target.value);
  if (e.target.value !== cleaned) e.target.value = cleaned;
  updatePublicSlugPreview(cleaned);
});

document.getElementById("btn-public-save-slug")?.addEventListener("click", async () => {
  const input = document.getElementById("public-page-slug");
  const btn = document.getElementById("btn-public-save-slug");
  if (btn) btn.disabled = true;
  setPublicPageMsg("Duke ruajtur slug…", true);
  try {
    const slug = validatePublicSlugClient(input?.value);
    const data = await api("/api/owner/slug", {
      method: "PUT",
      body: JSON.stringify({ slug }),
    });
    if (input) input.value = data.slug || slug;
    document.getElementById("public-page-url").value = data.public_url || "";
    updatePublicSlugPreview(data.slug || slug);
    resetPublicPageQrPreview();
    const preview = document.getElementById("btn-public-preview");
    if (preview && data.public_url) preview.href = data.public_url;
    await loadClient();
    setPublicPageMsg("Slug u ruajt në kitchen_slug.", true);
  } catch (err) {
    setPublicPageMsg(err.message, false);
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById("btn-public-generate-qr")?.addEventListener("click", () => {
  const btn = document.getElementById("btn-public-generate-qr");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Duke gjeneruar…";
  }
  setPublicPageMsg("");
  try {
    const url = getPublicPageTargetUrl();
    renderPublicPageQrCanvas(url);
    publicPageQrData = { url };
    const wrap = document.getElementById("public-page-qr-preview");
    const urlEl = document.getElementById("public-page-qr-url");
    if (urlEl) urlEl.textContent = url;
    wrap?.classList.remove("hidden");
    document.getElementById("btn-public-download-qr").disabled = false;
    setPublicPageMsg("QR u gjenerua.", true);
  } catch (err) {
    setPublicPageMsg(err.message, false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Gjenero QR Kod";
    }
  }
});

document.getElementById("btn-public-download-qr")?.addEventListener("click", () => {
  const btn = document.getElementById("btn-public-download-qr");
  if (btn) btn.disabled = true;
  try {
    setPublicPageMsg("");
    const dataUrl = getPublicPageQrPngDataUrl();
    const slug = sanitizePublicSlugInput(document.getElementById("public-page-slug")?.value) || "faqja";
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `qr-faqe-${slug}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setPublicPageMsg("QR u shkarkua (PNG).", true);
  } catch (err) {
    setPublicPageMsg(err.message, false);
  } finally {
    if (btn) btn.disabled = !publicPageQrData;
  }
});

document.getElementById("btn-public-copy-url")?.addEventListener("click", async () => {
  const url = document.getElementById("public-page-url")?.value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    setPublicPageMsg("URL u kopjua.", true);
  } catch {
    setPublicPageMsg("Nuk u kopjua.", false);
  }
});

let reservationsCache = [];
let reservationsTableCount = 10;
let reservationsFilter = "today";

function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function reservationStatusLabel(status) {
  if (status === "confirmed") return "Konfirmuar";
  if (status === "cancelled") return "Anuluar";
  return "Në pritje";
}

function setReservationsMsg(text, ok) {
  const msg = document.getElementById("reservations-msg");
  if (!msg) return;
  msg.textContent = text || "";
  msg.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
}

function setReservationModalMsg(text, ok) {
  const msg = document.getElementById("reservation-modal-msg");
  if (!msg) return;
  msg.textContent = text || "";
  msg.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
}

function reservationQueryForFilter(filter) {
  if (filter === "tomorrow") {
    const d = isoDateOffset(1);
    return { date: d };
  }
  if (filter === "week") {
    return { from: isoDateOffset(0), to: isoDateOffset(6) };
  }
  return { date: isoDateOffset(0) };
}

function renderReservationsList() {
  const list = document.getElementById("reservations-list");
  if (!list) return;
  if (!reservationsCache.length) {
    list.innerHTML = '<p class="links-hint">Nuk ka rezervime për këtë periudhë.</p>';
    return;
  }
  list.innerHTML = reservationsCache.map(r => {
    const actions = r.status === "cancelled"
      ? ""
      : `<div class="reservation-actions">
          ${r.status === "pending"
        ? `<button type="button" class="btn btn-primary btn-sm" data-res-confirm="${r.id}">Konfirmo</button>`
        : ""}
          <button type="button" class="btn btn-ghost btn-sm" data-res-cancel="${r.id}">Anulo</button>
        </div>`;
    return `
      <article class="reservation-card reservation-${r.status}">
        <div class="reservation-card-head">
          <strong>T${r.table_number} · ${escapeHtml(r.customer_name)}</strong>
          <span class="reservation-status reservation-status-${r.status}">${reservationStatusLabel(r.status)}</span>
        </div>
        <div class="reservation-card-meta">
          <span>${fmtDateSq(r.date)} · ${escapeHtml(String(r.time).slice(0, 5))}</span>
          <span>${r.guests} persona</span>
          ${r.customer_phone ? `<span>${escapeHtml(r.customer_phone)}</span>` : ""}
        </div>
        ${r.notes ? `<p class="reservation-notes">${escapeHtml(r.notes)}</p>` : ""}
        ${actions}
      </article>`;
  }).join("");

  list.querySelectorAll("[data-res-confirm]").forEach(btn => {
    btn.addEventListener("click", () => updateReservationStatus(btn.dataset.resConfirm, "confirmed"));
  });
  list.querySelectorAll("[data-res-cancel]").forEach(btn => {
    btn.addEventListener("click", () => updateReservationStatus(btn.dataset.resCancel, "cancelled"));
  });
}

function fmtDateSq(iso) {
  const [y, m, d] = String(iso || "").split("-");
  if (!y) return iso;
  return `${d}.${m}.${y}`;
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function loadReservations() {
  setReservationsMsg("Duke ngarkuar…", true);
  try {
    const q = reservationQueryForFilter(reservationsFilter);
    const params = new URLSearchParams(q);
    const data = await api(`/api/owner/reservations?${params}`);
    reservationsCache = data.reservations || [];
    reservationsTableCount = Number(data.table_count) || reservationsTableCount;
    renderReservationsList();
    setReservationsMsg("", true);
  } catch (err) {
    setReservationsMsg(err.message, false);
  }
}

function populateReservationTableSelect() {
  const sel = document.getElementById("reservation-table");
  if (!sel) return;
  const count = Math.max(1, reservationsTableCount || 10);
  sel.innerHTML = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return `<option value="${n}">T${n}</option>`;
  }).join("");
}

function openReservationModal() {
  populateReservationTableSelect();
  document.getElementById("reservation-customer-name").value = "";
  document.getElementById("reservation-customer-phone").value = "";
  document.getElementById("reservation-guests").value = "2";
  document.getElementById("reservation-date").value = isoDateOffset(0);
  document.getElementById("reservation-time").value = "19:00";
  document.getElementById("reservation-notes").value = "";
  setReservationModalMsg("");
  document.getElementById("reservation-modal")?.classList.remove("hidden");
}

function closeReservationModal() {
  document.getElementById("reservation-modal")?.classList.add("hidden");
}

async function saveReservationFromModal() {
  const btn = document.getElementById("btn-reservation-save");
  if (btn) btn.disabled = true;
  setReservationModalMsg("Duke ruajtur…", true);
  try {
    await api("/api/owner/reservations", {
      method: "POST",
      body: JSON.stringify({
        customer_name: document.getElementById("reservation-customer-name")?.value?.trim(),
        customer_phone: document.getElementById("reservation-customer-phone")?.value?.trim(),
        table_number: Number(document.getElementById("reservation-table")?.value),
        date: document.getElementById("reservation-date")?.value,
        time: document.getElementById("reservation-time")?.value,
        guests: Number(document.getElementById("reservation-guests")?.value) || 2,
        notes: document.getElementById("reservation-notes")?.value?.trim(),
      }),
    });
    closeReservationModal();
    await loadReservations();
    setReservationsMsg("Rezervimi u shtua.", true);
  } catch (err) {
    setReservationModalMsg(err.message, false);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function updateReservationStatus(id, status) {
  const label = status === "confirmed" ? "konfirmuar" : "anuluar";
  if (!confirm(`Të ${label} ky rezervim?`)) return;
  setReservationsMsg(`Duke ${label}…`, true);
  try {
    await api(`/api/owner/reservations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await loadReservations();
    setReservationsMsg(`Rezervimi u ${label}.`, true);
  } catch (err) {
    setReservationsMsg(err.message, false);
  }
}

document.getElementById("btn-reservation-add")?.addEventListener("click", openReservationModal);
document.getElementById("reservation-modal-close")?.addEventListener("click", closeReservationModal);
document.getElementById("reservation-modal-backdrop")?.addEventListener("click", closeReservationModal);
document.getElementById("btn-reservation-save")?.addEventListener("click", saveReservationFromModal);

document.querySelectorAll(".reservation-filter").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".reservation-filter").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    reservationsFilter = btn.dataset.resFilter || "today";
    loadReservations().catch(() => {});
  });
});

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    if (tab.classList.contains("ai-feature-locked")) {
      alert(AI_UPGRADE_MSG);
      return;
    }
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".panel-section").forEach(p => p.classList.add("hidden"));
    document.getElementById(`panel-${tab.dataset.tab}`).classList.remove("hidden");
    if (tab.dataset.tab === "tavolinat") loadLiveTables();
    if (tab.dataset.tab === "raportet") { loadReport(); loadAuditLog(); loadExpenses(); }
    if (tab.dataset.tab === "porosite") {
      loadOrders();
      loadRefusedOrders();
    }
    if (tab.dataset.tab === "stoku") {
      loadOwnerInventory?.();
      loadOwnerStock?.();
      applyAiUiState();
      loadOwnerSupplySuggestions?.();
    }
    if (tab.dataset.tab === "blerje") {
      window.loadOwnerBlerjePanel?.();
    }
    if (tab.dataset.tab === "ai-raporte") loadOwnerAiReports?.();
    if (tab.dataset.tab === "ai-asistent") loadOwnerAiAssistant?.();
    if (tab.dataset.tab === "njoftimet") loadOwnerNotifications?.();
    if (tab.dataset.tab === "faqja") loadPublicPage();
    if (tab.dataset.tab === "zreport") loadZReport();
    if (tab.dataset.tab === "fiskale") loadFiscalSettings();
    if (tab.dataset.tab === "licenca") loadLicense();
  });
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  try { await api("/api/auth/owner/logout", { method: "POST" }); } catch { /* */ }
  localStorage.removeItem("owner_token");
  location.href = "/owner/login";
});

document.getElementById("btn-owner-password-save")?.addEventListener("click", async () => {
  const msg = document.getElementById("owner-password-msg");
  const current = document.getElementById("owner-pw-current")?.value || "";
  const next = document.getElementById("owner-pw-new")?.value || "";
  const next2 = document.getElementById("owner-pw-new2")?.value || "";
  if (msg) {
    msg.textContent = "";
    msg.className = "owner-license-msg";
  }
  if (!current || !next) {
    if (msg) {
      msg.textContent = "Plotësoni fjalëkalimin aktual dhe të riun.";
      msg.className = "owner-license-msg err";
    }
    return;
  }
  if (next.length < 6) {
    if (msg) {
      msg.textContent = "Fjalëkalimi i ri duhet min. 6 karaktere.";
      msg.className = "owner-license-msg err";
    }
    return;
  }
  if (next !== next2) {
    if (msg) {
      msg.textContent = "Fjalëkalimet e reja nuk përputhen.";
      msg.className = "owner-license-msg err";
    }
    return;
  }
  try {
    const data = await api("/api/auth/owner/password/change", {
      method: "POST",
      body: JSON.stringify({
        current_password: current,
        new_password: next,
        new_password2: next2,
      }),
    });
    if (msg) {
      msg.textContent = data.message || "Fjalëkalimi u ndryshua. I njëjti vlen edhe në telefon.";
      msg.className = "owner-license-msg ok";
    }
    const curEl = document.getElementById("owner-pw-current");
    const n1 = document.getElementById("owner-pw-new");
    const n2 = document.getElementById("owner-pw-new2");
    if (curEl) curEl.value = "";
    if (n1) n1.value = "";
    if (n2) n2.value = "";
  } catch (err) {
    if (msg) {
      msg.textContent = err.message || "Ndryshimi dështoi.";
      msg.className = "owner-license-msg err";
    }
  }
});

document.getElementById("btn-raport").addEventListener("click", loadReport);
document.getElementById("btn-audit-log-refresh")?.addEventListener("click", loadAuditLog);
document.getElementById("btn-filter-orders").addEventListener("click", loadOrders);
document.getElementById("filter-waiter").addEventListener("change", loadOrders);
document.getElementById("filter-table").addEventListener("change", loadOrders);
document.getElementById("btn-refuse-filter")?.addEventListener("click", loadRefusedOrders);

document.getElementById("btn-zreport-refresh")?.addEventListener("click", loadZReport);
document.getElementById("zreport-date")?.addEventListener("change", loadZReport);
document.getElementById("btn-report-view-x")?.addEventListener("click", () => {
  currentReportMode = "X";
  loadZReport().catch(err => alert(err.message));
});
document.getElementById("btn-report-view-z")?.addEventListener("click", () => {
  currentReportMode = "Z";
  loadZReport().catch(err => alert(err.message));
});
document.getElementById("btn-report-view-periodic")?.addEventListener("click", () => {
  currentReportMode = "PERIODIC";
  loadZReport().catch(err => alert(err.message));
});
document.getElementById("periodic-from")?.addEventListener("change", loadZReport);
document.getElementById("periodic-to")?.addEventListener("change", loadZReport);
document.getElementById("btn-zreport-opening-save")?.addEventListener("click", async () => {
  const date = zReportDate();
  const opening_float = Number(document.getElementById("zreport-opening-float")?.value);
  if (!Number.isFinite(opening_float) || opening_float < 0) {
    alert("Shkruani një shumë të vlefshme për paranë e nisjes.");
    return;
  }
  try {
    await api("/api/owner/z-report/opening-float", {
      method: "PUT",
      body: JSON.stringify({ date, opening_float }),
    });
    await loadZReport();
  } catch (err) {
    alert(err.message);
  }
});
document.getElementById("btn-zreport-close")?.addEventListener("click", async () => {
  const date = zReportDate();
  const closing_cash_actual = document.getElementById("zreport-closing-actual")?.value;
  const cash_difference_reason = document.getElementById("zreport-diff-reason")?.value?.trim() || "";
  if (!confirm(`Mbyll ditën ${date} dhe ruaj raportin ditor?`)) return;
  try {
    await api("/api/owner/z-report/close", {
      method: "POST",
      body: JSON.stringify({
        date,
        closing_cash_actual: closing_cash_actual === "" ? null : Number(closing_cash_actual),
        cash_difference_reason,
      }),
    });
    await loadZReport();
    alert("Raporti ditor u ruajt.");
  } catch (err) {
    alert(err.message);
  }
});
document.getElementById("btn-zreport-print")?.addEventListener("click", () => {
  printZReport().catch(err => alert(err.message));
});
document.getElementById("btn-zreport-csv")?.addEventListener("click", () => {
  exportZReport("csv").catch(err => alert(err.message));
});
document.getElementById("btn-zreport-html")?.addEventListener("click", () => {
  exportZReport("html").catch(err => alert(err.message));
});
document.getElementById("btn-fiscal-test")?.addEventListener("click", () => {
  runFiscalConnectionTest();
});
document.getElementById("btn-fiscal-autofind")?.addEventListener("click", () => {
  runFiscalAutoFind();
});
document.getElementById("btn-fiscal-save")?.addEventListener("click", async () => {
  const msg = document.getElementById("fiscal-msg");
  if (msg) {
    msg.textContent = "";
    msg.className = "owner-license-msg";
  }
  try {
    await api("/api/owner/fiscal/settings", {
      method: "PATCH",
      body: JSON.stringify({
        fiscal_nr: document.getElementById("fiscal-nr")?.value?.trim() || "",
        fiscal_com_port: document.getElementById("fiscal-com")?.value?.trim() || "",
        fiscal_operator_name: document.getElementById("fiscal-operator")?.value?.trim() || "",
        fiscal_device_model: document.getElementById("fiscal-model")?.value?.trim() || "",
        pef_serial_number: document.getElementById("fiscal-pef-serial")?.value?.trim() || "",
        fiscal_enabled: document.getElementById("fiscal-enabled")?.checked !== false,
      }),
    });
    if (msg) {
      msg.textContent = "Settings fiskale u ruajtën.";
      msg.className = "owner-license-msg ok";
    }
    await loadFiscalDiagnostics();
  } catch (err) {
    if (msg) {
      msg.textContent = err.message;
      msg.className = "owner-license-msg err";
    }
  }
});

document.getElementById("btn-register-mode-save")?.addEventListener("click", async () => {
  const msg = document.getElementById("register-mode-msg");
  const select = document.getElementById("register-mode-select");
  const mode = select?.value || "auto";
  if (msg) {
    msg.textContent = "";
    msg.className = "owner-license-msg";
  }
  if (!confirm(`Ndrysho modalitetin e faturës në "${registerModeLabel(mode)}" për të gjithë kamarierët?`)) {
    return;
  }
  try {
    const data = await api("/api/owner/register-switch/mode", {
      method: "PUT",
      body: JSON.stringify({ mode }),
    });
    setRegisterModeBadge(data);
    if (msg) {
      msg.textContent = "U ruajt!";
      msg.className = "owner-license-msg ok";
    }
  } catch (err) {
    if (msg) {
      msg.textContent = err.message;
      msg.className = "owner-license-msg err";
    }
  }
});

async function lookupBarcodeFillName(barcodeInput, nameInput, statusEl) {
  const code = String(barcodeInput?.value || "").trim();
  if (!statusEl) statusEl = { textContent: "" };
  if (!code || code.length < 4) {
    statusEl.textContent = "";
    return;
  }
  statusEl.textContent = "Duke kërkuar në Open Food Facts…";
  try {
    const data = await api(`/api/owner/menu/barcode-lookup/${encodeURIComponent(code)}`);
    if (data?.found && data.name) {
      if (nameInput) {
        nameInput.value = data.name;
        nameInput.dataset.barcodeFilled = "1";
      }
      statusEl.textContent = `✓ U gjet: ${data.name}`;
    } else {
      statusEl.textContent = "Barkodi nuk u gjet — shkruani emrin manualisht.";
    }
  } catch (err) {
    statusEl.textContent = err.message || "Kërkimi dështoi — shkruani emrin manualisht.";
  }
}

const menuAddBarcodeEl = document.getElementById("menu-add-barcode");
const menuAddNameEl = document.getElementById("menu-add-name");
const menuAddBarcodeStatus = document.getElementById("menu-add-barcode-status");
menuAddBarcodeEl?.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  lookupBarcodeFillName(menuAddBarcodeEl, menuAddNameEl, menuAddBarcodeStatus);
});
menuAddNameEl?.addEventListener("input", () => {
  if (menuAddNameEl.dataset.barcodeFilled === "1") menuAddNameEl.dataset.barcodeFilled = "0";
});

document.getElementById("btn-menu-add")?.addEventListener("click", async () => {
  const name = document.getElementById("menu-add-name")?.value?.trim();
  const category = document.getElementById("menu-add-category")?.value?.trim();
  const price = Number(document.getElementById("menu-add-price")?.value);
  const vat_category = document.getElementById("menu-add-vat")?.value || "A";
  const barcode = document.getElementById("menu-add-barcode")?.value?.trim() || "";
  if (!name || !category) {
    setMenuMsg("Shkruani emrin dhe kategorinë.", false);
    return;
  }
  try {
    setMenuMsg("");
    const { item, synced_at } = await api("/api/owner/menu", {
      method: "POST",
      body: JSON.stringify({ name, category, price, vat_category, barcode }),
    });
    ownerMenuCache.items.push(item);
    if (!ownerMenuCache.categories.includes(item.category)) {
      ownerMenuCache.categories.push(item.category);
    }
    document.getElementById("menu-add-name").value = "";
    document.getElementById("menu-add-price").value = "";
    document.getElementById("menu-add-barcode").value = "";
    if (menuAddBarcodeStatus) menuAddBarcodeStatus.textContent = "";
    if (menuAddNameEl) menuAddNameEl.dataset.barcodeFilled = "0";
    renderMenuCategoryOptions(ownerMenuCache.categories);
    renderMenuTable();
    updateOwnerMenuSyncHint(synced_at);
    setMenuMsg("Artikulli u shtua — shfaqet te tabletat e porosive.", true);
  } catch (err) {
    setMenuMsg(err.message, false);
  }
});

let menuScanItems = [];
let menuScanPreviewUrl = null;

function setMenuScanStatus(text, ok) {
  const el = document.getElementById("menu-scan-status");
  if (!el) return;
  if (!text) {
    el.textContent = "";
    el.className = "owner-license-msg";
    return;
  }
  el.textContent = text;
  el.className = `owner-license-msg ${ok ? "ok" : "err"}`;
}

function renderMenuScanItems() {
  const body = document.getElementById("menu-scan-items-body");
  const results = document.getElementById("menu-scan-results");
  if (!body || !results) return;

  if (!menuScanItems.length) {
    body.innerHTML = "";
    results.classList.add("hidden");
    return;
  }

  body.innerHTML = menuScanItems
    .map(
      (item, idx) => `<tr>
        <td><input type="text" class="menu-scan-name" data-idx="${idx}" value="${escAttr(item.name)}"></td>
        <td><input type="number" class="menu-scan-price" data-idx="${idx}" min="0" step="0.01" value="${Number(item.price || 0).toFixed(2)}"></td>
      </tr>`,
    )
    .join("");
  results.classList.remove("hidden");
}

function readMenuScanItemsFromDom() {
  return menuScanItems.map((item, idx) => {
    const name = document.querySelector(`.menu-scan-name[data-idx="${idx}"]`)?.value?.trim();
    const price = Number(document.querySelector(`.menu-scan-price[data-idx="${idx}"]`)?.value);
    return {
      name: name || item.name,
      price: Number.isFinite(price) ? price : item.price,
    };
  }).filter(item => item.name && Number.isFinite(item.price) && item.price >= 0);
}

function openMenuScanModal() {
  menuScanItems = [];
  setMenuScanStatus("", true);
  document.getElementById("menu-scan-results")?.classList.add("hidden");
  document.getElementById("menu-scan-loading")?.classList.add("hidden");
  document.getElementById("menu-scan-file").value = "";
  document.getElementById("btn-menu-scan-run").disabled = true;
  if (menuScanPreviewUrl) {
    URL.revokeObjectURL(menuScanPreviewUrl);
    menuScanPreviewUrl = null;
  }
  document.getElementById("menu-scan-preview-wrap")?.classList.add("hidden");
  document.getElementById("menu-scan-modal")?.classList.remove("hidden");
}

function closeMenuScanModal() {
  document.getElementById("menu-scan-modal")?.classList.add("hidden");
}

async function runMenuScan() {
  const file = document.getElementById("menu-scan-file")?.files?.[0];
  if (!file) {
    setMenuScanStatus("Zgjidhni një foto fillimisht.", false);
    return;
  }

  const runBtn = document.getElementById("btn-menu-scan-run");
  const loading = document.getElementById("menu-scan-loading");
  if (runBtn) runBtn.disabled = true;
  loading?.classList.remove("hidden");
  setMenuScanStatus("", true);
  document.getElementById("menu-scan-results")?.classList.add("hidden");

  try {
    const photo = await readImageFile(file, 4_000_000, "Foto e menusë");
    const data = await api("/api/ai/scan-menu", {
      method: "POST",
      body: JSON.stringify({ photo }),
    });
    menuScanItems = Array.isArray(data.items) ? data.items : [];
    renderMenuScanItems();
    setMenuScanStatus(
      `${menuScanItems.length} artikuj u gjetën (${Number(data.usage?.tokens_used || 0).toLocaleString("sq-AL")} tokenë).`,
      true,
    );
  } catch (err) {
    setMenuScanStatus(err.message, false);
  } finally {
    loading?.classList.add("hidden");
    if (runBtn) runBtn.disabled = false;
  }
}

async function importScannedMenuItems() {
  const items = readMenuScanItemsFromDom();
  const category = document.getElementById("menu-scan-category")?.value?.trim() || "Menu";
  if (!items.length) {
    setMenuScanStatus("Nuk ka artikuj për import.", false);
    return;
  }
  if (!category) {
    setMenuScanStatus("Shkruani kategorinë për import.", false);
    return;
  }

  const importBtn = document.getElementById("btn-menu-scan-import");
  if (importBtn) importBtn.disabled = true;
  setMenuScanStatus("Duke importuar artikujt…", true);

  try {
    let lastSynced = null;
    for (const item of items) {
      const { synced_at } = await api("/api/owner/menu", {
        method: "POST",
        body: JSON.stringify({ name: item.name, category, price: item.price }),
      });
      lastSynced = synced_at || lastSynced;
    }
    await loadOwnerMenu();
    if (lastSynced) updateOwnerMenuSyncHint(lastSynced);
    closeMenuScanModal();
    setMenuMsg(`${items.length} artikuj u importuan në menynë.`, true);
  } catch (err) {
    setMenuScanStatus(err.message, false);
  } finally {
    if (importBtn) importBtn.disabled = false;
  }
}

async function refreshOwnerAiUsage() {
  const el = document.getElementById("owner-ai-usage");
  if (!el) return;
  try {
    const u = await api("/api/ai/usage");
    el.textContent =
      `Tokenë këtë muaj: ${Number(u.tokens_total || 0).toLocaleString("sq-AL")} · ` +
      `Kosto: ${Number(u.cost_eur_total || 0).toFixed(4)} € · Thirrje: ${Number(u.calls || 0)}`;
  } catch (err) {
    el.textContent = err.message || "Tokenët nuk u lexuan.";
  }
}
window.refreshOwnerAiUsage = refreshOwnerAiUsage;
window.ownerApi = api;

function applyAiHubTab(data) {
  const tab = document.getElementById("tab-ai-hub");
  if (!tab || !data) return;
  const active = !!data.enabled;
  const needsUpgrade = !!data.configured && !data.paused && !data.package_ai;
  if (active || needsUpgrade) {
    tab.removeAttribute("hidden");
    tab.classList.remove("hidden");
    tab.classList.toggle("ai-feature-locked", !active && needsUpgrade);
    tab.title = active ? "AI" : (window.AI_UPGRADE_MSG || "Kontaktoni Revolution POS për upgrade");
  } else {
    tab.setAttribute("hidden", "");
    tab.classList.add("hidden");
  }
  if (active) {
    refreshOwnerAiUsage().catch(() => {});
    window.refreshOwnerAiModules?.().catch(() => {});
  }
}

let _ownerLastPackageTier = "";

async function applyAiUiState() {
  const root = document.getElementById("ai-chat-root");
  const scanBtn = document.getElementById("btn-menu-scan-ai");
  const fab = document.getElementById("ai-chat-fab");
  try {
    const data = await api("/api/ai/status");
    const active = !!data.enabled;
    const needsUpgrade = !!data.configured && !data.paused && !data.package_ai;
    const nextTier = String(data.package_tier || "").trim();
    if (nextTier && nextTier !== _ownerLastPackageTier) {
      console.log("[owner] Pako e re nga cloud:", nextTier, "| package_ai:", !!data.package_ai);
      _ownerLastPackageTier = nextTier;
      /* Linqet waiter/kds/kiosk varen nga features — rifresko pa restart */
      loadClient().catch(() => {});
    }
    root?.classList.toggle("hidden", !active);
    applyAiFeatureLock(fab, data);
    if (scanBtn) {
      if (active) {
        scanBtn.removeAttribute("hidden");
        scanBtn.disabled = false;
        scanBtn.classList.remove("ai-feature-locked");
        scanBtn.removeAttribute("title");
      } else if (needsUpgrade) {
        scanBtn.removeAttribute("hidden");
        scanBtn.disabled = true;
        scanBtn.classList.add("ai-feature-locked");
        scanBtn.title = AI_UPGRADE_MSG;
      } else {
        scanBtn.setAttribute("hidden", "");
        scanBtn.disabled = false;
        scanBtn.classList.remove("ai-feature-locked");
      }
    }
    applyAiHubTab(data);
    window.applyInvoiceScanAiButton?.(data);
    window.applyAiReportsTab?.(data);
    window.applySupplySuggestionsSection?.(data);
    window.applyAiAssistantTab?.(data);
    window.applyNotificationsTab?.(data);
  } catch {
    root?.classList.add("hidden");
    fab?.classList.add("hidden");
    scanBtn?.setAttribute("hidden", "");
    document.getElementById("btn-invoice-scan-ai")?.setAttribute("hidden", "");
    document.getElementById("tab-ai-hub")?.setAttribute("hidden", "");
    document.getElementById("tab-ai-reports")?.setAttribute("hidden", "");
    document.getElementById("tab-ai-assistant")?.setAttribute("hidden", "");
    document.getElementById("tab-notifications")?.setAttribute("hidden", "");
  }
}

document.getElementById("ai-chat-fab")?.addEventListener("click", () => {
  const fab = document.getElementById("ai-chat-fab");
  if (fab?.classList.contains("ai-feature-locked")) {
    alert(AI_UPGRADE_MSG);
    return;
  }
  window.openOwnerAiAssistantTab?.();
});

document.getElementById("btn-menu-scan-ai")?.addEventListener("click", openMenuScanModal);
document.getElementById("menu-scan-close")?.addEventListener("click", closeMenuScanModal);
document.getElementById("menu-scan-backdrop")?.addEventListener("click", closeMenuScanModal);
document.getElementById("btn-menu-scan-run")?.addEventListener("click", () => {
  runMenuScan().catch(err => setMenuScanStatus(err.message, false));
});
document.getElementById("btn-menu-scan-import")?.addEventListener("click", () => {
  importScannedMenuItems().catch(err => setMenuScanStatus(err.message, false));
});

document.getElementById("menu-scan-file")?.addEventListener("change", e => {
  const file = e.target.files?.[0];
  const previewWrap = document.getElementById("menu-scan-preview-wrap");
  const preview = document.getElementById("menu-scan-preview");
  const runBtn = document.getElementById("btn-menu-scan-run");
  if (!file) {
    if (runBtn) runBtn.disabled = true;
    previewWrap?.classList.add("hidden");
    return;
  }
  if (menuScanPreviewUrl) URL.revokeObjectURL(menuScanPreviewUrl);
  menuScanPreviewUrl = URL.createObjectURL(file);
  if (preview) preview.src = menuScanPreviewUrl;
  previewWrap?.classList.remove("hidden");
  if (runBtn) runBtn.disabled = false;
  menuScanItems = [];
  document.getElementById("menu-scan-results")?.classList.add("hidden");
  setMenuScanStatus("", true);
});

document.getElementById("btn-area-add")?.addEventListener("click", async () => {
  const name = document.getElementById("area-add-name")?.value?.trim();
  const table_count = Number(document.getElementById("area-add-count")?.value);
  if (!name) {
    setVenueMsg("Shkruani emrin e hapësirës.", false);
    return;
  }
  try {
    setVenueMsg("");
    const { area, synced_at } = await api("/api/owner/venue/areas", {
      method: "POST",
      body: JSON.stringify({ name, table_count }),
    });
    ownerVenueCache.areas.push(area);
    document.getElementById("area-add-name").value = "";
    renderVenueAreas();
    updateVenueSyncHint(synced_at);
    setVenueMsg("Hapësira u shtua.", true);
  } catch (err) {
    setVenueMsg(err.message, false);
  }
});

document.getElementById("btn-staff-add")?.addEventListener("click", async () => {
  const name = document.getElementById("staff-add-name")?.value?.trim();
  const role = document.getElementById("staff-add-role")?.value || "waiter";
  if (!name) {
    setVenueMsg("Shkruani emrin e stafit.", false);
    return;
  }
  try {
    setVenueMsg("");
    const { member, synced_at } = await api("/api/owner/venue/staff", {
      method: "POST",
      body: JSON.stringify({ name, role }),
    });
    ownerVenueCache.staff.push(member);
    document.getElementById("staff-add-name").value = "";
    renderVenueStaff();
    updateVenueSyncHint(synced_at);
    setVenueMsg("Stafi u shtua.", true);
  } catch (err) {
    setVenueMsg(err.message, false);
  }
});

(async () => {
  registerServiceWorker();
  initPwaInstallBanner();

  if (window.OfflineQueue) {
    OfflineQueue.initConnectionStatus(document.getElementById("conn-status-owner"));
  }

  const newLicenseKey = sessionStorage.getItem("owner_new_license_key");
  if (newLicenseKey) {
    sessionStorage.removeItem("owner_new_license_key");
    showBootInfo(`U krijua llogaria! Çelësi i licencës për POS: ${newLicenseKey} — ruajeni tani.`);
  }

  const authed = await verifyOwnerSession();
  if (!authed) {
    redirectOwnerLogin();
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);
  document.getElementById("raport-nga").value = weekAgo.toISOString().slice(0, 10);
  document.getElementById("raport-deri").value = today;
  const zDate = document.getElementById("zreport-date");
  if (zDate) zDate.value = today;

  await runBootStep("klienti", loadClient);
  if (typeof window.initOwnerLocationSwitcher === "function") {
    await runBootStep("lokalet", window.initOwnerLocationSwitcher);
  }
  await runBootStep("ai-status", applyAiUiState);
  await runBootStep("tavolinat", loadLiveTables);
  connectOwnerLiveEvents();
  await runBootStep("porositë", async () => {
    await loadOrderFilters();
    await loadOrders();
  });

  setInterval(async () => {
    try {
      if (!document.getElementById("panel-tavolinat").classList.contains("hidden")) {
        await loadLiveTables();
      }
      if (!document.getElementById("panel-porosite").classList.contains("hidden")) {
        await loadOrderFilters();
        await loadOrders();
      }
    } catch {
      /* poll — mos nxirr jashtë */
    }
  }, 3000);

  /* Pakoja nga Naseri (PATCH) — AI + linqe, pa restart (12s) */
  setInterval(() => {
    applyAiUiState().catch(() => {});
  }, 12000);

  document.getElementById("btn-ai-hub-scan-invoice")?.addEventListener("click", () => {
    const hubTab = document.getElementById("tab-ai-hub");
    if (hubTab?.classList.contains("ai-feature-locked")) {
      alert(typeof AI_UPGRADE_MSG !== "undefined" ? AI_UPGRADE_MSG : "Kontaktoni Revolution POS për upgrade");
      return;
    }
    if (typeof window.openBlerjeAndScan === "function") {
      window.openBlerjeAndScan();
      return;
    }
    document.querySelector('.tab[data-tab="blerje"]')?.click();
    document.getElementById("btn-invoice-scan-ai")?.click();
  });
})();
