/* Master Admin desktop dashboard — /admin/dashboard */
let token = localStorage.getItem("rip_token") || "";
let currentUser = null;
let clientsFlat = [];
let sectorsCache = [];
let openSectorIds = new Set();
/** Produkti aktiv: kafene | security | hotel | furra | market — kurrë «all» */
let currentProduct = "hotel";
/** Produkti i drawer-it të hapur (që Ruaj / rifreskimi mos e humbasë) */
let drawerProduct = null;
/** Rifreskim automatik kur tab Klientët/Licencat është hapur (sinkron telefon ↔ desktop) */
let sectionRefreshTimer = null;

/** REVOLUTION POS — vetëm shitje; gjithmonë të dukshme. */
const FALLBACK_SECTORS = [
  { num: 1, id: "kafene", label: "Kafene", keywords: ["kafene"], clients: [] },
  { num: 2, id: "restorant", label: "Restorant", keywords: ["restorant"], clients: [] },
  { num: 3, id: "bar_pub", label: "Bar / Pub", keywords: ["bar", "pub"], clients: [] },
  { num: 4, id: "nightlife", label: "Klub nate / Diskotekë", keywords: ["klub", "diskotek", "nate"], clients: [] },
  { num: 5, id: "piceri", label: "Piceri", keywords: ["piceri"], clients: [] },
  { num: 6, id: "fast_food", label: "Fast Food Kiosk", keywords: ["fast", "food", "kiosk"], clients: [] },
  { num: 7, id: "dyqan_pijesh", label: "Dyqan pijesh", keywords: ["pijesh", "pije"], clients: [] },
  { num: 8, id: "other", label: "Të tjera (klientë të vjetër)", keywords: ["tjeter"], clients: [] },
];

/** REVOLUTION SECURITY — vetëm menaxhim punëtorësh; i ndarë nga POS. */
const FALLBACK_HOTEL_SECTORS = [
  { num: 1, id: "hotel", label: "Hotel", keywords: ["hotel"], clients: [] },
  { num: 2, id: "motel", label: "Motel", keywords: ["motel"], clients: [] },
  { num: 3, id: "hostel", label: "Hostel", keywords: ["hostel", "bujtine"], clients: [] },
  { num: 4, id: "resort", label: "Resort", keywords: ["resort"], clients: [] },
  { num: 5, id: "ville_me_qira", label: "Villë me qira", keywords: ["ville", "villa", "qira"], clients: [] },
];
const FALLBACK_FURRA_SECTORS = [
  { num: 1, id: "furre_buke", label: "Furrë Buke", keywords: ["furra", "buke"], clients: [] },
  { num: 2, id: "pasticeri", label: "Pastiçeri / Ëmbëltore", keywords: ["pasticeri"], clients: [] },
];
const FALLBACK_MARKET_SECTORS = [
  { num: 1, id: "minimarket", label: "Mini-market / Market", keywords: ["mini", "market"], clients: [] },
  { num: 2, id: "pilar", label: "Pilar (dyqan i vogël lagje)", keywords: ["pilar", "lagje"], clients: [] },
  { num: 3, id: "supermarket", label: "Supermarket", keywords: ["supermarket"], clients: [] },
  { num: 4, id: "dyqan_ushqimor", label: "Dyqan ushqimor", keywords: ["ushqimor"], clients: [] },
  { num: 5, id: "manav", label: "Dyqan pemë-perimesh (manav)", keywords: ["manav", "peme", "perime"], clients: [] },
  { num: 6, id: "bulmetore", label: "Dyqan bulmetore", keywords: ["bulmetore"], clients: [] },
  { num: 7, id: "kasap", label: "Dyqan mishit (kasap)", keywords: ["kasap", "mish"], clients: [] },
  { num: 8, id: "dyqan_peshku", label: "Dyqan peshku", keywords: ["peshk"], clients: [] },
];

const FALLBACK_SECURITY_SECTORS = [
  { num: 1, id: "sec_kompani_sigurie", label: "Kompani sigurie (roje, patrullime)", keywords: ["sigurie", "roje"], clients: [] },
  { num: 2, id: "sec_pastrim", label: "Kompani pastrimi", keywords: ["pastrim"], clients: [] },
  { num: 3, id: "sec_ndertimtari", label: "Ndërtimtari", keywords: ["ndertim"], clients: [] },
  { num: 4, id: "sec_transport_logjistike", label: "Transport / Logjistikë", keywords: ["transport"], clients: [] },
  { num: 5, id: "sec_sherbime_teknike", label: "Shërbime teknike", keywords: ["teknike"], clients: [] },
  { num: 6, id: "sec_mirembajtje_nderte", label: "Mirëmbajtje ndërtesash", keywords: ["mirembajtje"], clients: [] },
  { num: 7, id: "sec_agjenci_punesimi", label: "Agjenci punësimi", keywords: ["punesim"], clients: [] },
  { num: 8, id: "sec_bujqesi", label: "Bujqësi", keywords: ["bujqesi"], clients: [] },
  { num: 9, id: "sec_kuriere_dergesa", label: "Kurierë / Dërgesa", keywords: ["kuriere", "dergesa"], clients: [] },
];

const SECURITY_VEPRIMTARI_OPTS = [
  ["kompani_sigurie", "Kompani sigurie (roje, patrullime)"],
  ["pastrim", "Kompani pastrimi (pastrues nëpër objekte)"],
  ["ndertimtari", "Ndërtimtari (punëtorë kantiere)"],
  ["transport_logjistike", "Transport / Logjistikë (shoferë, dërgesa)"],
  ["sherbime_teknike", "Shërbime teknike (elektricistë, hidraulikë, servis)"],
  ["mirembajtje_nderte", "Mirëmbajtje ndërtesash (maintenance)"],
  ["agjenci_punesimi", "Agjenci punësimi (punëtorë të dërguar te klientët)"],
  ["bujqesi", "Bujqësi (punëtorë sezone)"],
  ["kuriere_dergesa", "Kurierë / Dërgesa"],
];

function ensureSectors(apiSectors, fallback) {
  const list = fallback || FALLBACK_SECTORS;
  const byId = new Map((apiSectors || []).map((s) => [s.id, s]));
  const byNum = new Map((apiSectors || []).map((s) => [Number(s.num), s]));
  return list.map((fb) => {
    const hit = byId.get(fb.id) || byNum.get(fb.num) || null;
    return {
      num: fb.num,
      id: fb.id,
      label: fb.label,
      keywords: hit?.keywords?.length ? hit.keywords : fb.keywords,
      clients: Array.isArray(hit?.clients) ? hit.clients : [],
    };
  });
}

function ensureNineSectors(apiSectors) {
  return ensureSectors(apiSectors, FALLBACK_SECTORS);
}

function ensureSecuritySectors(apiSectors) {
  return ensureSectors(apiSectors, FALLBACK_SECURITY_SECTORS);
}

function productQuery(_forClients = false) {
  const p = currentProduct || "kafene";
  if (p === "all" || p === "te_gjitha") return "kafene";
  return p;
}

function setProductTab(product, { reload = true } = {}) {
  const allowed = { kafene: 1, security: 1, hotel: 1, furra: 1, market: 1 };
  currentProduct = allowed[product] ? product : "kafene";
  localStorage.setItem("rip_admin_product", currentProduct);
  document.querySelectorAll(".product-tab").forEach((btn) => {
    const on = btn.dataset.product === currentProduct;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  const nc = document.getElementById("nc-product");
  if (nc) {
    nc.value = currentProduct;
    syncNewClientForm();
  }
  const title = document.getElementById("clients-list-title");
  if (title) {
    title.textContent =
      currentProduct === "security"
        ? "Klientët REVOLUTION SECURITY"
        : currentProduct === "hotel"
          ? "Klientët REVOLUTION HOTEL"
          : currentProduct === "furra"
            ? "Klientët REVOLUTION FURRA"
            : currentProduct === "market"
              ? "Klientët REVOLUTION MARKET"
              : "Klientët REVOLUTION POS";
  }
  if (!reload) return;
  const activeSec = document.querySelector(".section.active");
  const name = activeSec?.id?.replace(/^sec-/, "") || "pasqyra";
  openSection(name);
}

function syncNewClientForm() {
  const product = document.getElementById("nc-product")?.value || "kafene";
  document.querySelectorAll(".nc-kafene-only").forEach((el) => {
    el.classList.toggle("hidden", product !== "kafene");
  });
  document.querySelectorAll(".nc-security-only").forEach((el) => {
    el.classList.toggle("hidden", product !== "security");
  });
  document.querySelectorAll(".nc-hotel-only").forEach((el) => {
    el.classList.toggle("hidden", product !== "hotel");
  });
  document.querySelectorAll(".nc-furra-only").forEach((el) => {
    el.classList.toggle("hidden", product !== "furra");
  });
  document.querySelectorAll(".nc-market-only").forEach((el) => {
    el.classList.toggle("hidden", product !== "market");
  });
  document.querySelectorAll(".nc-tier-only").forEach((el) => {
    el.classList.toggle("hidden", product !== "kafene" && product !== "market");
  });
  const pako = document.getElementById("nc-pako")?.closest(".field");
  if (pako) pako.classList.toggle("hidden", product === "security");
}

function showBridgeMsg(text) {
  const el = document.getElementById("product-bridge-msg");
  if (!el) return;
  if (!text) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
}

const TITLES = {
  pasqyra: ["Pasqyra", "Përmbledhje e platformës"],
  klientet: ["Klientët", "9 kategori — gjithmonë të dukshme"],
  licencat: ["Licencat", "ID · Licencë · Ruaj · Kopjo"],
  ai: ["AI Usage", "Tokena, kosto dhe harxhimi me kohë"],
  faturimi: ["Faturimi", "Pagesa bankare + fatura PDF"],
  raportet: ["Probleme", "Vetëm probleme — pa shitje"],
  cilesimet: ["Cilësimet", "Admini, çmimet e pakove, AI"],
};

function euro(n) {
  return `${Number(n || 0).toLocaleString("sq-AL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("sq-AL");
  } catch {
    return String(iso);
  }
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...opts, headers, credentials: "include" });
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/pdf") || ct.includes("text/csv")) {
    if (!res.ok) throw new Error("Kërkesa dështoi");
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout(false);
    throw new Error(data.gabim || "Sesioni skadoi");
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.gabim || data.message || `Gabim ${res.status}`);
  }
  return data;
}

function showLogin() {
  document.getElementById("view-login").classList.remove("hidden");
  document.getElementById("view-app").classList.add("hidden");
}

function showApp() {
  document.getElementById("view-login").classList.add("hidden");
  document.getElementById("view-app").classList.remove("hidden");
  document.getElementById("user-label").textContent = currentUser?.emri || currentUser?.email || "Super Admin";
}

function logout(callApi = true) {
  token = "";
  localStorage.removeItem("rip_token");
  if (callApi) fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
  showLogin();
}

function closeNav() {
  document.body.classList.remove("nav-open");
}

function openSection(name) {
  if (sectionRefreshTimer) {
    clearInterval(sectionRefreshTimer);
    sectionRefreshTimer = null;
  }
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.section === name));
  document.querySelectorAll(".section").forEach((s) => s.classList.toggle("active", s.id === `sec-${name}`));
  const [t, sub] = TITLES[name] || [name, ""];
  document.getElementById("page-title").textContent = t;
  document.getElementById("page-sub").textContent = sub;
  closeNav();
  if (name === "pasqyra") loadOverview();
  if (name === "klientet") loadClients();
  if (name === "licencat") loadLicenses();
  if (name === "ai") loadAi();
  if (name === "faturimi") {
    loadBankPayments().catch((ex) => console.warn(ex));
    loadBilling();
  }
  if (name === "raportet") loadReports();
  if (name === "cilesimet") loadSettings();
  // Sinkron: kur hap Probleme ose Klientët, rifresko të dyja në background
  if (name === "klientet" || name === "raportet") {
    Promise.all([
      name === "raportet" ? loadClients().catch(() => null) : loadReports().catch(() => null),
    ]).catch(() => {});
  }
  if (name === "klientet" || name === "licencat") {
    sectionRefreshTimer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (name === "klientet") loadClients().catch(() => null);
      else loadLicenses().catch(() => null);
    }, 30_000);
  }
}

function renderChart(el, points, valueKey = "total") {
  if (!el) return;
  const vals = points.map((p) => Number(p[valueKey]) || 0);
  const max = Math.max(...vals, 1);
  el.innerHTML = points
    .map((p) => {
      const v = Number(p[valueKey]) || 0;
      const h = Math.max(4, Math.round((v / max) * 140));
      const label = String(p.date || "").slice(5);
      return `<div class="chart-bar" title="${esc(p.date)}: ${v}"><div class="fill" style="height:${h}px"></div><div class="lbl">${esc(label)}</div></div>`;
    })
    .join("");
}

async function loadOverview() {
  const d = await api(`/api/super/dashboard/overview?product=${encodeURIComponent(currentProduct || "all")}`);
  document.getElementById("kpi-active").textContent = String(d.active_clients ?? 0);
  const kpiLic = document.getElementById("kpi-licenses");
  if (kpiLic) kpiLic.textContent = String(d.licenses_active ?? d.licenses_total ?? 0);
  const kpiTrial = document.getElementById("kpi-trial");
  if (kpiTrial) kpiTrial.textContent = String(d.trial_accounts ?? 0);
  document.getElementById("kpi-sales").textContent = euro(d.sales_today_total);
  document.getElementById("kpi-problems").textContent = String((d.problem_clients || []).length);
  showBridgeMsg(d.bridge_error || d.by_product?.security?.bridge_error || "");
  renderChart(document.getElementById("chart-weekly"), d.weekly_sales || [], "total");
  const list = document.getElementById("problem-list");
  const problems = d.problem_clients || [];
  list.innerHTML = problems.length
    ? problems
        .map(
          (p) => `<li class="prob-overview-row" data-goto-problems role="button" tabindex="0" style="cursor:pointer">
            <div><strong>${esc(p.emri)}</strong><div style="color:var(--muted);font-size:0.8rem">${esc(p.tipi_label || "")}${p.product_line ? ` · ${esc(p.product_line)}` : ""}</div></div>
            <div>${(p.reasons || []).map((r) => `<span class="badge badge-warn">${esc(r)}</span>`).join(" ")}
              <span class="badge badge-ok" style="margin-left:0.25rem">Te Probleme</span>
            </div>
          </li>`,
        )
        .join("")
    : `<li style="color:var(--muted)">Nuk ka klientë me probleme.</li>`;
  list.querySelectorAll("[data-goto-problems]").forEach((row) => {
    const go = () => {
      document.querySelector('.nav-item[data-section="raportet"]')?.click();
    };
    row.addEventListener("click", go);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  });
}

function normalizeSearch(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ë/g, "e");
}

function renderClientsSectors(filterText = "") {
  const root = document.getElementById("clients-sectors");
  if (!root) return;
  const q = normalizeSearch(filterText);
  clientsFlat = [];
  // Security dhe Kafene: sektore të ndara, gjithmonë të dukshme (edhe me 0)
  const sectors =
    currentProduct === "security"
      ? ensureSecuritySectors(sectorsCache)
      : currentProduct === "hotel"
        ? ensureSectors(sectorsCache, FALLBACK_HOTEL_SECTORS)
        : currentProduct === "furra"
          ? ensureSectors(sectorsCache, FALLBACK_FURRA_SECTORS)
          : currentProduct === "market"
            ? ensureSectors(sectorsCache, FALLBACK_MARKET_SECTORS)
            : ensureNineSectors(sectorsCache);

  const html = sectors
    .map((s) => {
      const sectorBlob = normalizeSearch(`${s.num} ${s.label} ${(s.keywords || []).join(" ")}`);
      const sectorMatch = !q || sectorBlob.includes(q) || q.split(/\s+/).some((w) => w && sectorBlob.includes(w));

      let clients = s.clients || [];
      if (q) {
        const nameHits = clients.filter((c) =>
          normalizeSearch(`${c.emri} ${c.tipi_label} ${c.package_label}`).includes(q),
        );
        if (sectorMatch) clients = nameHits.length ? nameHits : clients;
        else clients = nameHits;
        // Gjatë kërkimit: fsheh vetëm nëse as sektori as klientët nuk përputhen
        if (!clients.length && !sectorMatch) return "";
      }

      clientsFlat.push(...clients);
      const isOpen = openSectorIds.has(s.id) || Boolean(q && (sectorMatch || clients.length));
      const rows = clients
        .map(
          (c) => `<div class="client-row" data-client-id="${esc(c.id)}" data-product="${esc(c.product_line || currentProduct || "kafene")}">
            <div class="client-meta">
              <strong>${esc(c.emri)}</strong>
              <span>${esc(c.tipi_label)} · ${esc(c.package_label)}${c.package_contents ? ` — ${esc(c.package_contents)}` : ""}</span>
            </div>
            <div class="client-row-actions" style="display:flex;align-items:center;gap:0.35rem;flex-shrink:0">
              <span class="badge ${c.status === "aktiv" ? "badge-ok" : "badge-off"}">${esc(c.status)}</span>
              <button type="button" class="btn btn-danger btn-sm" data-delete-client="${esc(c.id)}" data-product="${esc(c.product_line || currentProduct || "kafene")}" data-name="${esc(c.emri)}">Fshi</button>
            </div>
          </div>`,
        )
        .join("");

      return `<div class="sector ${isOpen ? "open" : ""}" data-sector-id="${esc(s.id)}">
        <button type="button" class="sector-head" data-toggle-sector="${esc(s.id)}">
          <span class="sector-num">${s.num}</span>
          <span class="sector-label">${esc(s.label)}</span>
          <span class="sector-count">(${clients.length})</span>
        </button>
        <div class="sector-body">
          ${rows || '<p style="color:var(--muted);padding:0.75rem;font-size:1.05rem">Nuk ka klientë ende.</p>'}
        </div>
      </div>`;
    })
    .filter(Boolean)
    .join("");

  // Pa kërkim: gjithmonë 9 butona. Me kërkim pa hit: mesazh.
  root.innerHTML = html || '<p style="color:var(--muted);font-size:1.1rem;padding:0.5rem">Asnjë rezultat.</p>';

  root.querySelectorAll("[data-toggle-sector]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.toggleSector;
      const el = btn.closest(".sector");
      const open = el.classList.toggle("open");
      if (open) openSectorIds.add(id);
      else openSectorIds.delete(id);
    });
  });
  root.querySelectorAll("[data-delete-client]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteClientById(btn.dataset.deleteClient, {
        product: btn.dataset.product,
        name: btn.dataset.name,
      });
    });
  });
  root.querySelectorAll("[data-client-id]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-delete-client]")) return;
      const hit = clientsFlat.find((c) => String(c.id) === String(row.dataset.clientId));
      openClientDetail(row.dataset.clientId, {
        product: hit?.product_line || productQuery(true) || "kafene",
      }).catch((ex) => alert(ex.message || ex));
    });
  });

  const sel = document.getElementById("inv-client");
  if (sel) {
    const all = (sectorsCache || []).flatMap((s) => s.clients || []);
    sel.innerHTML = all
      .map((c) => `<option value="${esc(c.id)}">${esc(c.emri)} (${esc(c.tipi_label)})</option>`)
      .join("");
  }
}

async function loadClients() {
  try {
    const product = productQuery(true);
    const d = await api(`/api/super/dashboard/clients?product=${encodeURIComponent(product)}`);
    showBridgeMsg(d.bridge_error || "");
    if (product === "security") {
      sectorsCache = d.sectors || d.groups || [];
    } else if (product === "hotel") {
      sectorsCache = ensureSectors(d.sectors || d.groups || [], FALLBACK_HOTEL_SECTORS);
    } else if (product === "furra") {
      sectorsCache = ensureSectors(d.sectors || d.groups || [], FALLBACK_FURRA_SECTORS);
    } else if (product === "market") {
      sectorsCache = ensureSectors(d.sectors || d.groups || [], FALLBACK_MARKET_SECTORS);
    } else {
      sectorsCache = ensureNineSectors(d.sectors || d.groups || []);
    }
  } catch (e) {
    showBridgeMsg(e.message || "Gabim gjatë ngarkimit të klientëve");
    sectorsCache = currentProduct === "security" ? [] : [];
  }
  const q = document.getElementById("clients-search")?.value || "";
  renderClientsSectors(q);
}

async function copyText(text, btn) {
  const val = String(text || "").trim();
  if (!val || val === "—") return;
  try {
    await navigator.clipboard.writeText(val);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "Kopjuar ✓";
      setTimeout(() => {
        btn.textContent = prev;
      }, 1200);
    }
  } catch {
    prompt("Kopjo:", val);
  }
}

const DRAWER_TIPI_OPTS = [
  ["kafene", "Kafene"],
  ["restorant", "Restorant"],
  ["bar", "Bar / Pub"],
  ["klub_nate", "Klub nate / Diskotekë"],
  ["piceri", "Piceri"],
  ["fast_food", "Fast Food Kiosk"],
  ["dyqan_pijesh", "Dyqan pijesh"],
];

const DRAWER_PAKO_OPTS = [
  ["pako_3", "Pako 1"],
  ["pako_4", "Pako 2"],
  ["pako_2", "Pako 3"],
  ["pako_5", "Pako 4 (AI)"],
];

function selectOpts(options, selected) {
  const sel = String(selected || "");
  const has = options.some(([v]) => v === sel);
  const list = has || !sel ? options : [[sel, sel], ...options];
  return list
    .map(([v, lab]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(lab)}</option>`)
    .join("");
}

function renderLicenseEditBlocks(licenses, { security = false } = {}) {
  return (licenses || [])
    .map(
      (l) => `<div class="lic-detail-row" data-lic-edit="${esc(l.id)}" style="margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:1px solid var(--border)">
        <div class="drawer-form">
          <label>Statusi
            <select data-lic-status="${esc(l.id)}">
              ${selectOpts(
                [
                  ["aktive", "aktive"],
                  ["pezulluar", "pezulluar"],
                  ["revokuar", "revokuar"],
                  ["skaduar", "skaduar"],
                ],
                l.statusi || "aktive",
              )}
            </select>
          </label>
          <label>Hardware ID (16)
            <input class="mono" data-lic-hw="${esc(l.id)}" value="${esc(l.hardware_id || "")}" placeholder="XXXX-XXXX-XXXX-XXXX">
          </label>
          <label>Çelësi i licencës
            <input class="mono" data-lic-key="${esc(l.id)}" value="${esc(l.celesi || l.license_key || "")}" placeholder="XXXX-XXXX-XXXX-XXXX">
          </label>
          ${
            security
              ? ""
              : `<label>Device ID (terminal)
            <input class="mono" data-lic-dev="${esc(l.id)}" value="${esc(l.device_id || "")}" placeholder="opsionale">
          </label>`
          }
          <label>Skadon
            <input type="date" data-lic-exp="${esc(l.id)}" value="${esc(String(l.data_skadimit || "").slice(0, 10))}">
          </label>
        </div>
        <div class="prob-actions" style="margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:0.35rem">
          ${
            security
              ? `
              ${
                ["pezulluar", "revokuar", "skaduar"].includes(String(l.statusi || ""))
                  ? `<button type="button" class="btn btn-ok btn-sm" data-sec-status="${esc(l.id)}" data-status="active">Riaktivizo</button>`
                  : `<button type="button" class="btn btn-danger btn-sm" data-sec-status="${esc(l.id)}" data-status="revoked">Revoko</button>
                     <button type="button" class="btn btn-ghost btn-sm" data-sec-status="${esc(l.id)}" data-status="suspended">Pezullo</button>`
              }`
              : `
              <button type="button" class="btn btn-ghost btn-sm" data-drawer-extend="${esc(l.id)}" data-months="1">+1 muaj</button>
              <button type="button" class="btn btn-ghost btn-sm" data-drawer-extend="${esc(l.id)}" data-months="3">+3 muaj</button>
              <button type="button" class="btn btn-primary btn-sm" data-drawer-extend="${esc(l.id)}" data-months="12">+12 muaj</button>
              ${
                ["pezulluar", "revokuar"].includes(String(l.statusi || ""))
                  ? `<button type="button" class="btn btn-ok btn-sm" data-drawer-reactivate="${esc(l.id)}" data-hw="${esc(l.hardware_id || "")}">Riaktivizo</button>
                     <button type="button" class="btn btn-ghost btn-sm" data-drawer-unblock="${esc(l.id)}">Zhblloko</button>`
                  : `<button type="button" class="btn btn-danger btn-sm" data-drawer-revoke="${esc(l.id)}" data-hw="${esc(l.hardware_id || "")}">Çaktivizo</button>`
              }
              <button type="button" class="btn btn-ghost btn-sm" style="border-color:#b45309;color:#b45309" data-drawer-wipe="${esc(l.id)}" data-hw="${esc(l.hardware_id || "")}">Fshi të Dhënat</button>`
          }
        </div>
      </div>`,
    )
    .join("") || '<div style="color:var(--muted)">Nuk ka licenca</div>';
}

function renderPasswordBlock(owners) {
  const ownerLabel = (owners || []).length
    ? (owners || []).map((o) => o.email).filter(Boolean).join(", ")
    : "nuk ka llogari ende — krijohet me email + fjalëkalim";
  return `
    <div class="detail-block">
      <h4>Fjalëkalimi i pronarit</h4>
      <p style="color:var(--muted);font-size:0.88rem;margin:0 0 0.65rem">Llogaria: <strong>${esc(ownerLabel)}</strong></p>
      <div class="drawer-form">
        <label>Fjalëkalim i ri
          <input id="dr-password" type="password" minlength="6" placeholder="min. 6 karaktere" autocomplete="new-password">
        </label>
        <label>Përsërit fjalëkalimin
          <input id="dr-password2" type="password" minlength="6" placeholder="përsërit" autocomplete="new-password">
        </label>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.75rem">
        <button type="button" class="btn btn-ok" id="btn-drawer-set-pw">Vendos fjalëkalimin</button>
        <button type="button" class="btn btn-ghost" id="btn-drawer-send-reset">Dërgo kod me email</button>
      </div>
      <p id="dr-pw-msg" style="color:var(--muted);font-size:0.9rem;margin:0.5rem 0 0"></p>
    </div>`;
}

async function fetchClientDetailSmart(id, preferredProduct) {
  const prefer = String(preferredProduct || "").toLowerCase();
  const order =
    prefer === "security"
      ? ["security", "kafene"]
      : prefer === "kafene"
        ? ["kafene", "security"]
        : currentProduct === "security"
          ? ["security", "kafene"]
          : ["kafene", "security"];

  let lastErr = null;
  for (const product of order) {
    try {
      const d = await api(
        `/api/super/dashboard/clients/${encodeURIComponent(id)}?product=${encodeURIComponent(product)}`,
      );
      if (d?.client?.id || d?.client?.emri) {
        return { d, product };
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Klienti nuk u gjet");
}

async function openClientDetail(id, opts = {}) {
  const preferred =
    opts.product
    || opts.product_line
    || drawerProduct
    || (typeof opts === "string" ? opts : null)
    || null;
  const { d, product } = await fetchClientDetailSmart(id, preferred);
  drawerProduct = product;
  const isSecurity = product === "security";
  const c = d.client || {};
  const licenses = d.licenses || [];
  const owners = d.owners || [];

  document.getElementById("drawer-root").classList.remove("hidden");
  document.getElementById("drawer-title").textContent = `${c.icon || (isSecurity ? "🛡️" : "🏪")} ${c.emri || "Klient"}`;
  document.getElementById("drawer-sub").textContent = "Edito klientin, licencat & fjalëkalimin — Ruaj";

  const sectorFields = isSecurity
    ? `<label>Veprimtari (Security)
        <select id="dr-veprimtari">
          ${selectOpts(SECURITY_VEPRIMTARI_OPTS, c.veprimtari || c.tipi || "kompani_sigurie")}
        </select>
      </label>
      <label>Adresa<input id="dr-adresa" value="${esc(c.adresa || "")}"></label>`
    : `<label>Adresa<input id="dr-adresa" value="${esc(c.adresa || "")}"></label>
      <label>Veprimtaria (POS)<select id="dr-tipi">${selectOpts(DRAWER_TIPI_OPTS, c.tipi)}</select></label>
      <label>Pako<select id="dr-pako">${selectOpts(DRAWER_PAKO_OPTS, c.package_tier)}</select></label>`;

  document.getElementById("drawer-body").innerHTML = `
    <div class="detail-block">
      <h4>Të dhënat e klientit</h4>
      <div class="drawer-form">
        <label>Emri<input id="dr-emri" value="${esc(c.emri || "")}" required></label>
        <label>Email<input id="dr-email" type="email" value="${esc(c.email || "")}"></label>
        <label>Telefon<input id="dr-tel" value="${esc(c.telefoni || "")}"></label>
        ${sectorFields}
      </div>
      <button type="button" class="btn btn-primary" id="btn-drawer-save" style="margin-top:0.75rem;width:100%">Ruaj ndryshimet</button>
      <button type="button" class="btn btn-danger" id="btn-drawer-delete-client" style="margin-top:0.5rem;width:100%">Fshi klientin krejt</button>
      <p id="dr-save-msg" style="color:var(--muted);font-size:0.9rem;margin:0.5rem 0 0"></p>
    </div>
    ${renderPasswordBlock(owners)}
    <div class="detail-block">
      <h4>Licenca (edito ID / çelës / status)</h4>
      ${renderLicenseEditBlocks(licenses, { security: isSecurity })}
    </div>
  `;
  const body = document.getElementById("drawer-body");
  body.querySelectorAll("[data-lic-hw], [data-lic-key]").forEach((el) => bindDrawerHex16(el));
  bindDrawerSave(id, product);
  bindDrawerPassword(id, product);
  bindDrawerLicenseFix(body, id, product);
  bindLicenseActions(body);
  document.getElementById("btn-drawer-delete-client")?.addEventListener("click", async () => {
    await deleteClientById(id, { product, name: c.emri, close: true });
  });
}

async function deleteClientById(id, { product, name, close } = {}) {
  const label = name || id;
  let prod = product || drawerProduct || null;
  if (!prod || prod === "all") {
    const hit = clientsFlat.find((c) => String(c.id) === String(id));
    prod = hit?.product_line || (currentProduct === "security" ? "security" : "kafene");
  }
  if (
    !confirm(
      `Fshi krejt klientin «${label}»?\n\nFshihen edhe licencat e tij.\nNuk kthehet mbrapa.`,
    )
  ) {
    return;
  }
  const typed = prompt('Shkruani FSHI për të konfirmuar:', "");
  if (typed === null) return;
  if (String(typed).trim().toUpperCase() !== "FSHI") {
    alert("Konfirmimi nuk përputhet. Asgjë nuk u fshi.");
    return;
  }
  try {
    const qs = prod === "security" ? "?product=security" : "?product=kafene";
    await api(`/api/super/dashboard/clients/${id}${qs}`, { method: "DELETE" });
    alert("Klienti u fshi.");
    if (close) closeDrawer();
    await loadClients();
    if (typeof loadLicenses === "function") {
      try {
        await loadLicenses();
      } catch {
        /* ignore */
      }
    }
  } catch (ex) {
    alert(ex.message || "Fshirja e klientit dështoi.");
  }
}

function bindDrawerPassword(clientId, productLine) {
  const msg = () => document.getElementById("dr-pw-msg");
  document.getElementById("btn-drawer-set-pw")?.addEventListener("click", async () => {
    const pw = document.getElementById("dr-password")?.value || "";
    const pw2 = document.getElementById("dr-password2")?.value || "";
    const m = msg();
    if (pw.length < 6) {
      if (m) m.textContent = "Fjalëkalimi min. 6 karaktere.";
      return;
    }
    if (pw !== pw2) {
      if (m) m.textContent = "Fjalëkalimet nuk përputhen.";
      return;
    }
    const btn = document.getElementById("btn-drawer-set-pw");
    if (btn) btn.disabled = true;
    if (m) m.textContent = "Duke vendosur fjalëkalimin…";
    try {
      const data = await api(`/api/super/dashboard/clients/${encodeURIComponent(clientId)}/set-password`, {
        method: "POST",
        body: JSON.stringify({
          product_line: productLine,
          password: pw,
          email: document.getElementById("dr-email")?.value?.trim(),
          emri: document.getElementById("dr-emri")?.value?.trim(),
        }),
      });
      if (m) {
        m.textContent = data.created
          ? "Pronari u krijua dhe fjalëkalimi u vendos."
          : "Fjalëkalimi u ndryshua.";
      }
      document.getElementById("dr-password").value = "";
      document.getElementById("dr-password2").value = "";
    } catch (ex) {
      if (m) m.textContent = ex.message || "Dështoi";
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("btn-drawer-send-reset")?.addEventListener("click", async () => {
    const m = msg();
    if (!confirm("Dërgo kod rivendosjeje me email te pronari?")) return;
    const btn = document.getElementById("btn-drawer-send-reset");
    if (btn) btn.disabled = true;
    if (m) m.textContent = "Duke dërguar email…";
    try {
      // Ruaj email-in e klientit së pari nëse është ndryshuar
      const email = document.getElementById("dr-email")?.value?.trim();
      if (email) {
        await api(`/api/super/dashboard/clients/${encodeURIComponent(clientId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            product_line: productLine,
            emri: document.getElementById("dr-emri")?.value?.trim(),
            email,
            telefoni: document.getElementById("dr-tel")?.value?.trim(),
            telefon: document.getElementById("dr-tel")?.value?.trim(),
          }),
        }).catch(() => null);
      }
      const data = await api(
        `/api/super/dashboard/clients/${encodeURIComponent(clientId)}/send-password-reset`,
        {
          method: "POST",
          body: JSON.stringify({ product_line: productLine }),
        },
      );
      if (m) m.textContent = data.message || "Kodi u dërgua me email.";
    } catch (ex) {
      if (m) m.textContent = ex.message || "Dërgimi dështoi";
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function bindDrawerHex16(el) {
  if (!el || el.dataset.fmtBound === "1") return;
  el.dataset.fmtBound = "1";
  el.addEventListener("input", () => {
    const hex = String(el.value || "")
      .replace(/[^a-fA-F0-9]/g, "")
      .toUpperCase()
      .slice(0, 16);
    let next = hex;
    if (hex.length > 12) next = `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12)}`;
    else if (hex.length > 8) next = `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8)}`;
    else if (hex.length > 4) next = `${hex.slice(0, 4)}-${hex.slice(4)}`;
    if (next !== el.value) el.value = next;
  });
}

function bindDrawerSave(clientId, productLine) {
  const btn = document.getElementById("btn-drawer-save");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const msg = document.getElementById("dr-save-msg");
    const emri = document.getElementById("dr-emri")?.value?.trim();
    if (!emri) {
      if (msg) msg.textContent = "Emri është i detyrueshëm.";
      return;
    }
    const product = productLine || drawerProduct || "kafene";
    const body = {
      product_line: product,
      emri,
      email: document.getElementById("dr-email")?.value?.trim() || "",
      telefoni: document.getElementById("dr-tel")?.value?.trim() || "",
      telefon: document.getElementById("dr-tel")?.value?.trim() || "",
      adresa: document.getElementById("dr-adresa")?.value?.trim() || "",
      licenses: [],
    };
    const tipiEl = document.getElementById("dr-tipi");
    const pakoEl = document.getElementById("dr-pako");
    const veprimtariEl = document.getElementById("dr-veprimtari");
    if (tipiEl?.value) body.tipi = tipiEl.value;
    if (pakoEl?.value) body.package_tier = pakoEl.value;
    if (veprimtariEl?.value) body.veprimtari = veprimtariEl.value;

    document.querySelectorAll("[data-lic-edit]").forEach((row) => {
      const id = row.dataset.licEdit;
      body.licenses.push({
        id,
        statusi: row.querySelector(`[data-lic-status="${id}"]`)?.value,
        hardware_id: row.querySelector(`[data-lic-hw="${id}"]`)?.value?.trim() || "",
        celesi: row.querySelector(`[data-lic-key="${id}"]`)?.value?.trim() || "",
        device_id: row.querySelector(`[data-lic-dev="${id}"]`)?.value?.trim() || "",
        data_skadimit: row.querySelector(`[data-lic-exp="${id}"]`)?.value || undefined,
      });
    });
    btn.disabled = true;
    if (msg) msg.textContent = "Duke ruajtur…";
    try {
      const saved = await api(`/api/super/dashboard/clients/${encodeURIComponent(clientId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const licErrs = saved?.license_errors || [];
      if (msg) {
        msg.textContent = licErrs.length
          ? `Klienti u ruajt. Licenca: ${licErrs.map((e) => e.gabim).join("; ")}`
          : "U ruajt.";
      }
      await refreshClientsAndProblems().catch(() => null);
      await openClientDetail(clientId, { product: saved?.product_line || product });
    } catch (ex) {
      if (msg) msg.textContent = ex.message || "Ruajtja dështoi";
      else alert(ex.message || "Ruajtja dështoi");
    } finally {
      btn.disabled = false;
    }
  });
}

function bindDrawerLicenseFix(root, clientId, productLine) {
  if (!root) return;
  const reopen = async () => {
    if (!clientId) return;
    await openClientDetail(clientId, { product: productLine || drawerProduct });
  };
  root.querySelectorAll("[data-drawer-extend]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const months = Number(btn.dataset.months) || 12;
      if (!confirm(`Zgjato licencën me ${months} muaj?`)) return;
      btn.disabled = true;
      try {
        const r = await api(`/api/super/dashboard/licenses/${btn.dataset.drawerExtend}/extend`, {
          method: "POST",
          body: JSON.stringify({ months }),
        });
        alert(`Licenca u zgjat deri më ${r.data_skadimit || "—"}.`);
        await refreshClientsAndProblems();
        await reopen();
      } catch (ex) {
        alert(ex.message || "Zgjatja dështoi.");
      } finally {
        btn.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-drawer-unblock]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Zhblloko licencën?")) return;
      btn.disabled = true;
      try {
        await api(`/api/super/dashboard/licenses/${btn.dataset.drawerUnblock}/unblock`, {
          method: "POST",
        });
        await refreshClientsAndProblems();
        await reopen();
      } catch (ex) {
        alert(ex.message || "Zhbllokimi dështoi.");
      } finally {
        btn.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-drawer-revoke]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reason = prompt("Çaktivizo menjëherë? Arsyeja (opsionale):", "");
      if (reason === null) return;
      btn.disabled = true;
      try {
        await api(`/api/super/dashboard/licenses/${btn.dataset.drawerRevoke}/revoke`, {
          method: "POST",
          body: JSON.stringify({
            hardware_id: btn.dataset.hw || undefined,
            reason: String(reason || "").trim(),
          }),
        });
        await refreshClientsAndProblems();
        await reopen();
      } catch (ex) {
        alert(ex.message || "Çaktivizimi dështoi.");
      } finally {
        btn.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-drawer-reactivate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Riaktivizo licencën?")) return;
      btn.disabled = true;
      try {
        await api(`/api/super/dashboard/licenses/${btn.dataset.drawerReactivate}/reactivate`, {
          method: "POST",
          body: JSON.stringify({ hardware_id: btn.dataset.hw || undefined }),
        });
        await refreshClientsAndProblems();
        await reopen();
      } catch (ex) {
        alert(ex.message || "Riaktivizimi dështoi.");
      } finally {
        btn.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-drawer-wipe]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Fshi të dhënat lokale te POS? (Cloud nuk fshihet)")) return;
      const typed = prompt('Shkruani FSHI TE DHENAT për të konfirmuar:', "");
      if (typed === null) return;
      if (String(typed).trim().toUpperCase().replace(/\s+/g, " ") !== "FSHI TE DHENAT") {
        alert("Konfirmimi nuk përputhet.");
        return;
      }
      btn.disabled = true;
      try {
        await api(`/api/super/dashboard/licenses/${btn.dataset.drawerWipe}/wipe-data`, {
          method: "POST",
          body: JSON.stringify({
            confirm: "FSHI TE DHENAT",
            hardware_id: btn.dataset.hw || undefined,
          }),
        });
        alert("Urdhri i fshirjes u dërgua te POS.");
        await refreshClientsAndProblems();
        await reopen();
      } catch (ex) {
        alert(ex.message || "Fshirja dështoi.");
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function closeDrawer() {
  drawerProduct = null;
  document.getElementById("drawer-root").classList.add("hidden");
}

function bindLicenseActions(root) {
  if (!root) return;
  root.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const sel = btn.dataset.copyFrom;
      const val = sel ? String(root.querySelector(sel)?.value || "").trim() : btn.dataset.copy;
      copyText(val || "", btn);
    });
  });
  root.querySelectorAll("[data-copy-text]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyText(btn.dataset.copyText || "", btn);
    });
  });
  root.querySelectorAll("[data-sec-status]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const status = btn.dataset.status;
      const label = status === "active" ? "riaktivizosh" : status === "suspended" ? "pezullosh" : "revokosh";
      if (!confirm(`A doni të ${label} këtë licencë Security?`)) return;
      btn.disabled = true;
      try {
        await api(`/api/super/dashboard/security/licenses/${btn.dataset.secStatus}/status`, {
          method: "POST",
          body: JSON.stringify({ status }),
        });
        await loadLicenses();
      } catch (ex) {
        alert(ex.message || "Ndryshimi i statusit dështoi.");
      } finally {
        btn.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-delete-license]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteLicense;
      const key = btn.dataset.key || id;
      const isSec = btn.dataset.product === "security";
      if (!confirm(`Fshi krejt licencën ${key}?\nNuk kthehet mbrapa.`)) return;
      btn.disabled = true;
      try {
        const path = isSec
          ? `/api/super/dashboard/security/licenses/${id}`
          : `/api/super/dashboard/licenses/${id}`;
        await api(path, { method: "DELETE" });
        alert("Licenca u fshi.");
        await loadLicenses();
      } catch (ex) {
        alert(ex.message || "Fshirja dështoi.");
      } finally {
        btn.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-block]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Çaktivizo licencën?")) return;
      await api(`/api/super/dashboard/licenses/${btn.dataset.block}/block`, { method: "POST" });
      loadLicenses();
    });
  });
  root.querySelectorAll("[data-unblock]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/super/dashboard/licenses/${btn.dataset.unblock}/unblock`, { method: "POST" });
      loadLicenses();
    });
  });
  root.querySelectorAll("[data-revoke]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reason = prompt(
        "Çaktivizo menjëherë këtë licencë / Hardware ID?\nPOS mbyllet brenda ~15 sekondash.\nArsyeja (opsionale):",
        "",
      );
      if (reason === null) return;
      btn.disabled = true;
      try {
        await api(`/api/super/dashboard/licenses/${btn.dataset.revoke}/revoke`, {
          method: "POST",
          body: JSON.stringify({
            hardware_id: btn.dataset.hw || undefined,
            reason: String(reason || "").trim(),
          }),
        });
        alert("Licenca u çaktivizua. POS do të mbyllet në heartbeat-in e radhës.");
        loadLicenses();
      } catch (ex) {
        alert(ex.message || "Çaktivizimi dështoi.");
      } finally {
        btn.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-reactivate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Riaktivizo licencën? Klienti mund të hapë POS përsëri.")) return;
      btn.disabled = true;
      try {
        await api(`/api/super/dashboard/licenses/${btn.dataset.reactivate}/reactivate`, {
          method: "POST",
          body: JSON.stringify({
            hardware_id: btn.dataset.hw || undefined,
          }),
        });
        alert("Licenca u riaktivizua.");
        loadLicenses();
      } catch (ex) {
        alert(ex.message || "Riaktivizimi dështoi.");
      } finally {
        btn.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-wipe]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (
        !confirm(
          "Fshi të dhënat LOKALE te POS (SQLite / rivendos si të re)?\n\nKjo NUK çaktivizon licencën.\nCloud NUK fshihet.\n\nVazhdo?",
        )
      ) {
        return;
      }
      const typed = prompt('Shkruani FSHI TE DHENAT për të konfirmuar:', "");
      if (typed === null) return;
      if (String(typed).trim().toUpperCase().replace(/\s+/g, " ") !== "FSHI TE DHENAT") {
        alert("Konfirmimi nuk përputhet. Asgjë nuk u ndryshua.");
        return;
      }
      const reason = prompt("Arsyeja (opsionale):", "") || "";
      btn.disabled = true;
      try {
        await api(`/api/super/dashboard/licenses/${btn.dataset.wipe}/wipe-data`, {
          method: "POST",
          body: JSON.stringify({
            confirm: "FSHI TE DHENAT",
            hardware_id: btn.dataset.hw || undefined,
            reason: String(reason).trim(),
          }),
        });
        alert("Urdhri u dërgua. POS do të rivendosë të dhënat lokale në heartbeat-in e radhës.");
        loadLicenses();
      } catch (ex) {
        alert(ex.message || "Fshirja dështoi.");
      } finally {
        btn.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-gen-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.genId;
      const hwEl = root.querySelector(`[data-hw-input="${id}"]`);
      const msgEl =
        btn.closest("[data-license-card]")?.querySelector(`[data-save-msg="${id}"]`) ||
        root.querySelector(`[data-save-msg="${id}"]`);
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
      const hw =
        `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
      if (hwEl) hwEl.value = hw;
      if (msgEl) {
        msgEl.classList.remove("err");
        msgEl.textContent = `ID: ${hw}`;
      }
    });
  });
  root.querySelectorAll("[data-copy-pair]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.copyPair;
      const hwEl = root.querySelector(`[data-hw-input="${id}"]`);
      const keyEl = root.querySelector(`[data-key-input="${id}"]`);
      const hw = String(hwEl?.value || "").trim();
      const key = String(keyEl?.value || "").trim();
      const text = key && hw ? `ID: ${hw}\nLicenca: ${key}` : key || hw;
      if (!text) {
        alert("Nuk ka ID as licencë.");
        return;
      }
      copyText(text, btn);
    });
  });
  root.querySelectorAll("[data-gen-from-hw]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.genFromHw;
      const hwEl = root.querySelector(`[data-hw-input="${id}"]`);
      const keyEl = root.querySelector(`[data-key-input="${id}"]`);
      const msgEl =
        btn.closest("[data-license-card]")?.querySelector(`[data-save-msg="${id}"]`) ||
        root.querySelector(`[data-save-msg="${id}"]`);
      const hardwareId = String(hwEl?.value || "").trim();
      const hwHex = hardwareId.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
      if (!hardwareId || hwHex.length !== 16) {
        const msg =
          "Ngjit ID e pajisjes nga ekrani «Aktivizo» te POS (16 shenja: XXXX-XXXX-XXXX-XXXX). Pastaj shtyp përsëri Gjenero.";
        if (msgEl) {
          msgEl.classList.add("err");
          msgEl.textContent = msg;
        } else {
          alert(msg);
        }
        hwEl?.focus();
        return;
      }
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = "Duke gjeneruar…";
      try {
        const licenseType =
          String(document.getElementById("gen-license-type")?.value || "annual").toLowerCase() ===
          "trial"
            ? "trial"
            : "annual";
        let data;
        try {
          data = await api("/api/admin/licenses/generate-hardware-key", {
            method: "POST",
            body: JSON.stringify({ hardwareId, licenseType }),
          });
        } catch {
          data = await api("/api/super/generate-license-key", {
            method: "POST",
            body: JSON.stringify({ hardwareId, licenseType }),
          });
        }
        const key = data.licenseKey || data.celesi || "";
        const hwOut = data.hardwareId || hardwareId;
        if (hwEl) hwEl.value = hwOut;
        if (keyEl) {
          keyEl.value = key;
          keyEl.readOnly = false;
          keyEl.focus();
          keyEl.select();
        }
        if (msgEl) {
          msgEl.classList.remove("err");
          msgEl.textContent = `Licenca u gjenerua — shtyp Ruaj`;
        }
        btn.textContent = "U gjenerua ✓";
        setTimeout(() => {
          btn.textContent = prev;
          btn.disabled = false;
        }, 1200);
      } catch (ex) {
        btn.textContent = prev;
        btn.disabled = false;
        const err = ex.message || "Gjenerimi dështoi.";
        if (msgEl) {
          msgEl.classList.add("err");
          msgEl.textContent = err;
        } else {
          alert(err);
        }
      }
    });
  });
  root.querySelectorAll("[data-save-license]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.saveLicense;
      const card = btn.closest("[data-license-card]") || root;
      const hwEl = root.querySelector(`[data-hw-input="${id}"]`);
      const keyEl = root.querySelector(`[data-key-input="${id}"]`);
      const msgEl = card.querySelector(`[data-save-msg="${id}"]`) || root.querySelector(`[data-save-msg="${id}"]`);
      const hwRaw = String(hwEl?.value || "").trim();
      const celesi = String(keyEl?.value || "").trim();
      const hwHex = hwRaw.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
      if (!celesi) {
        if (msgEl) {
          msgEl.textContent = "Shkruaj ose gjenero kodin e licencës.";
          msgEl.classList.add("err");
        } else {
          alert("Shkruaj ose gjenero kodin e licencës.");
        }
        keyEl?.focus();
        return;
      }
      if (hwRaw && hwHex.length !== 16) {
        const msg = "ID e pajisjes duhet 16 shenja (XXXX-XXXX-XXXX-XXXX) nga POS Aktivizo.";
        if (msgEl) {
          msgEl.textContent = msg;
          msgEl.classList.add("err");
        } else {
          alert(msg);
        }
        hwEl?.focus();
        return;
      }
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = "Duke ruajtur…";
      if (msgEl) {
        msgEl.textContent = "";
        msgEl.classList.remove("err");
      }
      try {
        const patch = { celesi };
        if (hwHex.length === 16) {
          try {
            await api(`/api/admin/licenses/${id}`, {
              method: "PATCH",
              body: JSON.stringify({ celesi, hardware_id: hwRaw }),
            });
          } catch {
            await api(`/api/admin/licenses/${id}`, {
              method: "PATCH",
              body: JSON.stringify(patch),
            });
          }
        } else {
          await api(`/api/admin/licenses/${id}`, {
            method: "PATCH",
            body: JSON.stringify(patch),
          });
        }
        btn.textContent = "U ruajt ✓";
        if (msgEl) {
          msgEl.classList.remove("err");
          msgEl.textContent = "U ruajt — i njëjti ID/licencë te telefon + panel.";
        }
        setTimeout(() => {
          btn.textContent = prev;
          btn.disabled = false;
          loadLicenses().catch(() => {});
        }, 800);
      } catch (ex) {
        btn.textContent = prev;
        btn.disabled = false;
        const err = ex.message || "Ruajtja dështoi.";
        if (msgEl) {
          msgEl.classList.add("err");
          msgEl.textContent = err;
        } else {
          alert(err);
        }
      }
    });
  });
  root.querySelectorAll("[data-hw-input]").forEach((el) => {
    if (el.dataset.fmtBound === "1") return;
    el.dataset.fmtBound = "1";
    el.addEventListener("input", () => {
      const hex = String(el.value || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase().slice(0, 16);
      let next = hex;
      if (hex.length > 12) next = `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12)}`;
      else if (hex.length > 8) next = `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8)}`;
      else if (hex.length > 4) next = `${hex.slice(0, 4)}-${hex.slice(4)}`;
      if (next !== el.value) el.value = next;
    });
  });
}

function formatLicenseHwId(raw) {
  const hex = String(raw || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toUpperCase();
  if (hex.length !== 16) return "";
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

let licensesCache = [];

async function loadLicenses() {
  const product = productQuery(true);
  let list = [];
  let d = { licenses: [] };
  try {
    d = await api(`/api/super/dashboard/licenses?product=${encodeURIComponent(product)}`);
    showBridgeMsg(d.bridge_error || "");
  } catch (e) {
    showBridgeMsg(e.message || "Gabim gjatë ngarkimit të licencave");
    licensesCache = [];
    renderLicensesList("");
    return;
  }
  list = (d.licenses || []).map((l) => ({
    id: l.id,
    client_name: l.client_name || l.clients?.emri || "—",
    hardware_id: formatLicenseHwId(l.hardware_id) || formatLicenseHwId(l.display_device_id) || formatLicenseHwId(l.device_id) || l.hardware_id || "",
    license_key: l.license_key || l.celesi || "",
    statusi: l.statusi,
    activation_email: l.activation_email || "",
    source: product === "security" ? "securetrack" : "pos",
    product_line: product,
  }));
  licensesCache = list;
  renderLicensesList(document.getElementById("licenses-search")?.value || "");
}

function renderLicensesList(filterText = "") {
  const product = productQuery(true);
  const q = normalizeSearch(filterText);
  const list = (licensesCache || []).filter((l) => {
    if (!q) return true;
    return normalizeSearch(`${l.client_name} ${l.license_key} ${l.hardware_id}`).includes(q);
  });

  const isSecurity = product === "security";
  const cards = document.getElementById("licenses-cards");
  if (cards) {
    cards.innerHTML = list.length
      ? list
          .map((l) => {
            const active = l.statusi === "aktive";
            const hw = l.hardware_id || "";
            const key = l.license_key || "";
            if (isSecurity) {
              return `<div class="license-card" data-license-card="${esc(l.id)}">
                <h4>${esc(l.client_name)}
                  <span class="badge ${active ? "badge-ok" : "badge-bad"}" style="margin-left:0.35rem">${esc(l.statusi)}</span>
                </h4>
                <div class="lic-field-block">
                  <label class="lic-field-label">Licenca</label>
                  <div class="mono" style="word-break:break-all">${esc(key || "—")}</div>
                </div>
                <div class="lic-card-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
                  <button type="button" class="btn btn-ghost" data-copy-text="${esc(key)}">Kopjo</button>
                  ${
                    active
                      ? `<button type="button" class="btn btn-danger btn-sm" data-sec-status="${esc(l.id)}" data-status="revoked">Revoko</button>
                         <button type="button" class="btn btn-ghost btn-sm" data-sec-status="${esc(l.id)}" data-status="suspended">Pezullo</button>`
                      : `<button type="button" class="btn btn-ok btn-sm" data-sec-status="${esc(l.id)}" data-status="active">Riaktivizo</button>`
                  }
                  <button type="button" class="btn btn-danger btn-sm" data-delete-license="${esc(l.id)}" data-product="security" data-key="${esc(key)}">Fshi</button>
                </div>
              </div>`;
            }
            return `<div class="license-card" data-license-card="${esc(l.id)}">
              <h4>${esc(l.client_name)}
                <span class="badge ${active ? "badge-ok" : "badge-bad"}" style="margin-left:0.35rem">${esc(l.statusi)}</span>
              </h4>
              <div class="lic-field-block">
                <label class="lic-field-label">ID</label>
                <input type="text" class="lic-edit-input mono" data-hw-input="${esc(l.id)}" value="${esc(hw)}" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text">
              </div>
              <div class="lic-field-block">
                <label class="lic-field-label">Licenca</label>
                <input type="text" class="lic-edit-input mono" data-key-input="${esc(l.id)}" value="${esc(key)}" placeholder="—" autocomplete="off">
              </div>
              ${
                l.activation_email
                  ? `<div class="lic-field-block"><label class="lic-field-label">Email aktivizimi</label><div class="mono" style="font-size:0.9rem">${esc(l.activation_email)}</div></div>`
                  : ""
              }
              <p class="lic-save-msg" data-save-msg="${esc(l.id)}"></p>
              <div class="lic-card-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
                <button type="button" class="btn btn-ok" data-gen-id="${esc(l.id)}">Gjenero ID</button>
                <button type="button" class="btn btn-primary" data-gen-from-hw="${esc(l.id)}">Gjenero Licencë</button>
                <button type="button" class="btn btn-accent" data-save-license="${esc(l.id)}">Ruaj</button>
                <button type="button" class="btn btn-ghost" data-copy-pair="${esc(l.id)}">Kopjo</button>
              </div>
              <div class="lic-card-actions" style="display:grid;grid-template-columns:1fr;gap:0.4rem;margin-top:0.55rem">
                ${
                  ["revokuar", "pezulluar"].includes(String(l.statusi || ""))
                    ? `<button type="button" class="btn btn-ok btn-sm" data-reactivate="${esc(l.id)}" data-hw="${esc(hw)}">Riaktivizo</button>`
                    : `<button type="button" class="btn btn-danger btn-sm" data-revoke="${esc(l.id)}" data-hw="${esc(hw)}">Çaktivizo Menjëherë</button>`
                }
                <button type="button" class="btn btn-ghost btn-sm" style="border-color:#b45309;color:#b45309" data-wipe="${esc(l.id)}" data-hw="${esc(hw)}">Fshi të Dhënat</button>
                <button type="button" class="btn btn-danger btn-sm" data-delete-license="${esc(l.id)}" data-product="pos" data-key="${esc(key)}">Fshi licencën</button>
              </div>
            </div>`;
          })
          .join("")
      : `<p style="color:var(--muted);font-size:1.05rem">Nuk ka licenca</p>`;
    bindLicenseActions(cards);
  }

  const body = document.getElementById("licenses-body");
  if (body) {
    body.innerHTML = list
      .map((l) => {
        const active = l.statusi === "aktive";
        const hw = l.hardware_id || "";
        const key = l.license_key || "";
        if (isSecurity) {
          return `<tr>
            <td>${esc(l.client_name)}</td>
            <td class="mono">${esc(hw || "—")}</td>
            <td class="mono">${esc(key || "—")}</td>
            <td><span class="badge ${active ? "badge-ok" : "badge-bad"}">${esc(l.statusi)}</span></td>
            <td style="white-space:nowrap">
              <button type="button" class="btn btn-ghost btn-sm" data-copy-text="${esc(key)}">Kopjo</button>
              ${
                active
                  ? `<button type="button" class="btn btn-danger btn-sm" data-sec-status="${esc(l.id)}" data-status="revoked">Revoko</button>
                     <button type="button" class="btn btn-ghost btn-sm" data-sec-status="${esc(l.id)}" data-status="suspended">Pezullo</button>`
                  : `<button type="button" class="btn btn-ok btn-sm" data-sec-status="${esc(l.id)}" data-status="active">Riaktivizo</button>`
              }
              <button type="button" class="btn btn-danger btn-sm" data-delete-license="${esc(l.id)}" data-product="security" data-key="${esc(key)}">Fshi</button>
            </td>
          </tr>`;
        }
        return `<tr>
          <td>${esc(l.client_name)}</td>
          <td>
            <input type="text" class="lic-edit-input mono" data-hw-input="${esc(l.id)}" value="${esc(hw)}" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false">
          </td>
          <td>
            <input type="text" class="lic-edit-input mono" data-key-input="${esc(l.id)}" value="${esc(key)}" placeholder="—" autocomplete="off" spellcheck="false">
          </td>
          <td><span class="badge ${active ? "badge-ok" : "badge-bad"}">${esc(l.statusi)}</span></td>
          <td style="white-space:nowrap">
            <button type="button" class="btn btn-ok btn-sm" data-gen-id="${esc(l.id)}">Gjenero ID</button>
            <button type="button" class="btn btn-primary btn-sm" data-gen-from-hw="${esc(l.id)}">Gjenero Licencë</button>
            <button type="button" class="btn btn-accent btn-sm" data-save-license="${esc(l.id)}">Ruaj</button>
            <button type="button" class="btn btn-ghost btn-sm" data-copy-pair="${esc(l.id)}">Kopjo</button>
            ${
              ["revokuar", "pezulluar"].includes(String(l.statusi || ""))
                ? `<button type="button" class="btn btn-ok btn-sm" data-reactivate="${esc(l.id)}" data-hw="${esc(hw)}">Riaktivizo</button>`
                : `<button type="button" class="btn btn-danger btn-sm" data-revoke="${esc(l.id)}" data-hw="${esc(hw)}">Çaktivizo Menjëherë</button>`
            }
            <button type="button" class="btn btn-ghost btn-sm" style="border-color:#b45309;color:#b45309" data-wipe="${esc(l.id)}" data-hw="${esc(hw)}">Fshi të Dhënat</button>
            <button type="button" class="btn btn-danger btn-sm" data-delete-license="${esc(l.id)}" data-product="pos" data-key="${esc(key)}">Fshi</button>
            <p class="lic-save-msg" data-save-msg="${esc(l.id)}"></p>
          </td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="5" style="color:var(--muted)">Nuk ka licenca</td></tr>`;
    bindLicenseActions(body);
  }
}

async function loadAi() {
  const monthEl = document.getElementById("ai-month");
  if (monthEl && !monthEl.value) {
    const now = new Date();
    monthEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  const qs = monthEl?.value ? `?month=${encodeURIComponent(monthEl.value)}` : "";
  const d = await api(`/api/super/dashboard/ai-usage${qs}`);
  document.getElementById("ai-tokens-total").textContent = Number(d.totals?.tokens_total || 0).toLocaleString("sq-AL");
  document.getElementById("ai-cost-total").textContent = euro(d.totals?.cost_eur_total);
  document.getElementById("ai-calls-total").textContent = String(d.totals?.calls || 0);
  renderChart(document.getElementById("chart-ai"), d.timeline || [], "tokens");
  document.getElementById("ai-body").innerHTML = (d.rows || [])
    .map(
      (r) => `<tr>
        <td>${esc(r.local_name)}</td>
        <td>${Number(r.tokens_total || 0).toLocaleString("sq-AL")}</td>
        <td>${euro(r.cost_eur_total)}</td>
        <td>${r.calls || 0}</td>
        <td>${esc(fmtDate(r.last_used_at))}</td>
      </tr>`,
    )
    .join("") || `<tr><td colspan="5" style="color:var(--muted)">Nuk ka përdorim AI</td></tr>`;
}

function bindBankConfirmButtons(root) {
  (root || document).querySelectorAll("[data-bank-confirm]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const token = btn.dataset.bankConfirm;
      if (
        !confirm(
          "A ka ardhur pagesa në bankë?\n\nVetëm nëse PO — lëshohet fatura PDF (vulë/datë) me email dhe çelësi i licencës.",
        )
      ) {
        return;
      }
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = "Duke dërguar…";
      try {
        const r = await api(`/api/admin/bank-payments/${encodeURIComponent(token)}/confirm`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        alert(
          r.already
            ? `Tashmë e dërguar: ${r.invoice_number || ""}`
            : `Fatura u dërgua: ${r.invoice_number || ""}\nEmail: ${r.email || ""}\nÇelësi: ${r.celesi || "—"}`,
        );
        loadBankPayments();
      } catch (ex) {
        alert(ex.message || ex);
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
  });
}

async function loadBankPayments() {
  const body = document.getElementById("bank-pay-body");
  const cards = document.getElementById("bank-pay-cards");
  const d = await api("/api/admin/bank-payments");
  const rows = d.payments || [];

  const statusMeta = (p) => {
    const pending = p.status === "pending";
    const issued = p.invoice_issued;
    return {
      pending,
      issued,
      statusLabel: issued ? "Fatura dërguar" : pending ? "Në pritje të pagesës" : esc(p.status),
      badge: issued ? "badge-ok" : pending ? "badge-warn" : "badge-ok",
      action: pending
        ? `<button type="button" class="btn btn-ok bank-confirm-btn" data-bank-confirm="${esc(p.token)}">Konfirmo pagesën &amp; dërgo faturë PDF</button>`
        : issued
          ? `<span class="mono" style="font-size:0.85rem">${esc(p.invoice_number || "OK")}</span>`
          : "—",
    };
  };

  if (cards) {
    cards.innerHTML =
      rows
        .map((p) => {
          const m = statusMeta(p);
          return `<article class="bank-pay-card">
            <div class="bank-pay-card-top">
              <strong>${esc(p.business_name || "—")}</strong>
              <span class="badge ${m.badge}">${m.statusLabel}</span>
            </div>
            <div class="bank-pay-card-meta">${esc(p.owner_name || "")} · ${esc(fmtDate(p.created_at))}</div>
            <div class="bank-pay-card-row"><span>Pako</span><strong>${esc(p.plan_label || p.plan)}</strong></div>
            <div class="bank-pay-card-row"><span>Shuma</span><strong>${euro(p.amount_eur)}</strong></div>
            <div class="bank-pay-card-row"><span>Email</span><strong class="mono">${esc(p.email)}</strong></div>
            ${p.phone ? `<div class="bank-pay-card-row"><span>Tel</span><a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></div>` : ""}
            <div class="bank-pay-card-actions">${m.action}</div>
          </article>`;
        })
        .join("") ||
      `<p class="bank-pay-empty">Nuk ka kërkesa bankare ende</p>`;
    bindBankConfirmButtons(cards);
  }

  if (body) {
    body.innerHTML =
      rows
        .map((p) => {
          const m = statusMeta(p);
          return `<tr>
        <td>${esc(fmtDate(p.created_at))}</td>
        <td>${esc(p.business_name)}<div style="font-size:0.8rem;color:var(--muted)">${esc(p.owner_name)}</div></td>
        <td>${esc(p.plan_label || p.plan)}</td>
        <td>${euro(p.amount_eur)}</td>
        <td class="mono" style="font-size:0.85rem">${esc(p.email)}</td>
        <td><span class="badge ${m.badge}">${m.statusLabel}</span></td>
        <td style="white-space:nowrap">${m.action}</td>
      </tr>`;
        })
        .join("") ||
      `<tr><td colspan="7" style="color:var(--muted)">Nuk ka kërkesa bankare ende</td></tr>`;
    bindBankConfirmButtons(body);
  }
}

async function loadBilling() {
  if (!clientsFlat.length) {
    try {
      await loadClients();
    } catch {
      /* ignore */
    }
  }
  const today = new Date();
  const from = new Date(today);
  from.setDate(1);
  const invFrom = document.getElementById("inv-from");
  const invTo = document.getElementById("inv-to");
  if (invFrom && !invFrom.value) invFrom.value = from.toISOString().slice(0, 10);
  if (invTo && !invTo.value) invTo.value = today.toISOString().slice(0, 10);

  const d = await api("/api/super/dashboard/billing/invoices");
  document.getElementById("inv-body").innerHTML = (d.invoices || [])
    .map(
      (inv) => `<tr>
        <td class="mono">${esc(inv.id)}</td>
        <td>${esc(inv.client_name)}</td>
        <td>${esc(inv.period_from)} — ${esc(inv.period_to)}</td>
        <td>${euro(inv.total)}</td>
        <td><span class="badge ${inv.status === "paguar" ? "badge-ok" : "badge-warn"}">${esc(inv.status)}</span></td>
        <td style="white-space:nowrap">
          <button type="button" class="btn btn-ghost btn-sm" data-pdf="${esc(inv.id)}">PDF</button>
          <button type="button" class="btn btn-sm ${inv.status === "paguar" ? "btn-ghost" : "btn-ok"}" data-status="${esc(inv.id)}" data-next="${inv.status === "paguar" ? "papaguar" : "paguar"}">
            ${inv.status === "paguar" ? "Papaguar" : "Paguar"}
          </button>
        </td>
      </tr>`,
    )
    .join("") || `<tr><td colspan="6" style="color:var(--muted)">Nuk ka fatura ende</td></tr>`;

  document.querySelectorAll("[data-pdf]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const res = await api(`/api/super/dashboard/billing/invoices/${btn.dataset.pdf}/pdf`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    });
  });
  document.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/super/dashboard/billing/invoices/${btn.dataset.status}`, {
        method: "PATCH",
        body: JSON.stringify({ status: btn.dataset.next }),
      });
      loadBilling();
    });
  });
}

const PROBLEM_KIND_LABEL = {
  program: "Program",
  offline: "Offline",
  print: "Print",
  fiscal: "Fiskale",
  license: "Licencë",
};

let activeProblem = null;
const problemRowStore = new Map();
let problemRowSeq = 0;

function storeProblemRow(p) {
  const id = `pr${++problemRowSeq}`;
  problemRowStore.set(id, p);
  return id;
}

function problemKindOf(p, listHint) {
  return p.kind || listHint || "program";
}

function problemActionsHtml(p, listHint) {
  const rid = storeProblemRow(p || {});
  const kind = problemKindOf(p, listHint);
  return `<div class="prob-actions">
    <button type="button" class="btn btn-primary btn-sm" data-prob-fix="${esc(rid)}" data-kind="${esc(kind)}">Rregullo</button>
  </div>`;
}

function renderProblemList(elId, rows, emptyText, listHint) {
  const el = document.getElementById(elId);
  if (!el) return;
  const list = rows || [];
  el.innerHTML = list.length
    ? list
        .map(
          (p) => `<li class="prob-row">
            <div class="prob-main">
              <strong>${esc(p.emri)}</strong>
              <div style="color:var(--muted);font-size:0.8rem">${esc(p.tipi_label || "")}${p.at ? ` · ${esc(fmtDate(p.at))}` : ""}${p.data_skadimit ? ` · skadon ${esc(p.data_skadimit)}` : ""}</div>
              <div style="margin-top:0.25rem;font-size:0.9rem">${esc(p.detail || "")}</div>
              ${problemActionsHtml(p, listHint)}
            </div>
          </li>`,
        )
        .join("")
    : `<li style="color:var(--muted)">${esc(emptyText)}</li>`;
  bindProblemActions(el);
}

function closeProblemResolve() {
  activeProblem = null;
  document.getElementById("prob-resolve-root")?.classList.add("hidden");
}

function resolvePanelHtml(p, kind) {
  const issue = p.issue || kind;
  const blocked = ["pezulluar", "revokuar"].includes(String(p.statusi || "")) || issue === "blocked";
  const expired = kind === "license" || issue === "expired";
  const offline = kind === "offline";
  const print = kind === "print";
  const fiscal = kind === "fiscal";
  const stock = issue === "stock_zero";

  let actions = "";
  if (expired && p.license_id) {
    actions = `
      <div class="prob-resolve-block">
        <h4>1. Zgjidhja</h4>
        <p>Zgjato afatin e licencës. Ndryshimi i ID / email / çelësit bëhet te Klientët.</p>
        <div class="prob-resolve-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-pr-extend="1">+1 muaj</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pr-extend="3">+3 muaj</button>
          <button type="button" class="btn btn-primary btn-sm" data-pr-extend="12">+12 muaj</button>
        </div>
      </div>`;
  } else if (blocked && p.license_id) {
    actions = `
      <div class="prob-resolve-block">
        <h4>1. Zgjidhja</h4>
        <p>Zhblloko licencën që klienti të hyjë përsëri.</p>
        <div class="prob-resolve-actions">
          <button type="button" class="btn btn-primary btn-sm" data-pr-unblock>Zhblloko licencën</button>
        </div>
      </div>`;
  } else if (offline) {
    actions = `
      <div class="prob-resolve-block">
        <h4>1. Çfarë po bën?</h4>
        <div class="prob-resolve-choice">
          <label><input type="radio" name="pr-res" value="contacted" checked> E kontaktova / e di — hiqe nga lista</label>
          <label><input type="radio" name="pr-res" value="waiting_online"> Pret që të kthehet online</label>
          <label><input type="radio" name="pr-res" value="device_issue"> Problem me pajisjen / internetin te klienti</label>
        </div>
        <label for="pr-note">Shënim (opsional)</label>
        <textarea id="pr-note" class="prob-resolve-note" placeholder="p.sh. e thirra, do lidhet nesër…"></textarea>
        <div class="prob-resolve-actions" style="margin-top:0.65rem">
          <button type="button" class="btn btn-primary btn-sm" data-pr-ack>Shëno si të zgjidhur</button>
        </div>
      </div>`;
  } else if (print || fiscal) {
    const label = print ? "printimit" : "fiskales";
    actions = `
      <div class="prob-resolve-block">
        <h4>1. Zgjidhja për ${esc(label)}</h4>
        <div class="prob-resolve-choice">
          <label><input type="radio" name="pr-res" value="fixed_on_site" checked> U rregullua te klienti (kabllo / driver / konfigurim)</label>
          <label><input type="radio" name="pr-res" value="reprint_ok"> Print / fiskale funksionon tani</label>
          <label><input type="radio" name="pr-res" value="temp_glitch"> Gabim i përkohshëm — hiqe nga lista</label>
          <label><input type="radio" name="pr-res" value="needs_visit"> Duhet vizitë / ndihmë e mëtejshme</label>
        </div>
        <label for="pr-note">Çfarë bëre / shënim</label>
        <textarea id="pr-note" class="prob-resolve-note" placeholder="p.sh. u ndërrua IP e printerit…"></textarea>
        <div class="prob-resolve-actions" style="margin-top:0.65rem">
          <button type="button" class="btn btn-primary btn-sm" data-pr-ack>Ruaj zgjidhjen</button>
        </div>
      </div>`;
  } else if (stock) {
    actions = `
      <div class="prob-resolve-block">
        <h4>1. Stok zero</h4>
        <p>Kjo nuk rregullohet me licencë. Pronari duhet të mbushë stokun; ti mund ta shënosh si të njohur.</p>
        <label for="pr-note">Shënim</label>
        <textarea id="pr-note" class="prob-resolve-note" placeholder="p.sh. i thashë të rifutë stokun…"></textarea>
        <div class="prob-resolve-actions" style="margin-top:0.65rem">
          <button type="button" class="btn btn-primary btn-sm" data-pr-ack>Shëno si të zgjidhur</button>
        </div>
      </div>`;
  } else {
    actions = `
      <div class="prob-resolve-block">
        <h4>1. Zgjidhja</h4>
        <div class="prob-resolve-choice">
          <label><input type="radio" name="pr-res" value="fixed" checked> U rregullua</label>
          <label><input type="radio" name="pr-res" value="monitoring"> Në monitorim</label>
          <label><input type="radio" name="pr-res" value="false_alarm"> Alarm i gabuar</label>
        </div>
        <label for="pr-note">Shënim</label>
        <textarea id="pr-note" class="prob-resolve-note"></textarea>
        <div class="prob-resolve-actions" style="margin-top:0.65rem">
          <button type="button" class="btn btn-primary btn-sm" data-pr-ack>Shëno si të zgjidhur</button>
        </div>
      </div>`;
  }

  const clientLink = p.id
    ? `<div class="prob-resolve-foot">
        ID, email, fjalëkalim, hardware ID dhe çelësi i licencës →
        <button type="button" class="btn btn-ghost btn-sm" data-pr-goto-client>Te Klientët</button>
        <span style="opacity:0.75">(vetëm nëse të duhen kredencialet)</span>
      </div>`
    : `<div class="prob-resolve-foot">Nuk u gjet klienti i lidhur — shëno zgjidhjen ose kontrollo historinë.</div>`;

  return `
    <div class="prob-resolve-block">
      <h4>Problemi</h4>
      <p><strong>${esc(PROBLEM_KIND_LABEL[kind] || kind)}</strong>${p.issue ? ` · ${esc(p.issue)}` : ""}</p>
      <p>${esc(p.detail || "—")}</p>
      ${p.last_seen_at || p.at ? `<p>Kohë: ${esc(fmtDate(p.last_seen_at || p.at))}</p>` : ""}
      ${p.data_skadimit ? `<p>Skadon: ${esc(p.data_skadimit)}</p>` : ""}
    </div>
    ${actions}
    ${clientLink}`;
}

function openProblemResolve(p, kindHint) {
  const kind = problemKindOf(p, kindHint);
  activeProblem = { ...p, kind };
  const root = document.getElementById("prob-resolve-root");
  const title = document.getElementById("prob-resolve-title");
  const sub = document.getElementById("prob-resolve-sub");
  const body = document.getElementById("prob-resolve-body");
  if (!root || !body) return;
  title.textContent = "Rregullo problemin";
  sub.textContent = `${p.emri || "Klienti"} · ${p.tipi_label || ""}`.trim();
  body.innerHTML = resolvePanelHtml(p, kind);
  root.classList.remove("hidden");
}

async function ackActiveProblem(btn) {
  if (!activeProblem?.problem_key) {
    alert("Ky problem nuk ka çelës për mbyllje. Rifresko listën.");
    return;
  }
  const resolution =
    document.querySelector('#prob-resolve-body input[name="pr-res"]:checked')?.value || "resolved";
  const note = document.getElementById("pr-note")?.value || "";
  if (btn) btn.disabled = true;
  try {
    await api("/api/super/dashboard/problems/ack", {
      method: "POST",
      body: JSON.stringify({
        problem_key: activeProblem.problem_key,
        kind: activeProblem.kind,
        client_id: activeProblem.id || null,
        resolution,
        note,
      }),
    });
    closeProblemResolve();
    await refreshClientsAndProblems();
  } catch (ex) {
    alert(ex.message || "Nuk u shënua.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function bindProblemActions(root) {
  if (!root || root.dataset.bound === "1") return;
  root.dataset.bound = "1";
  root.addEventListener("click", (e) => {
    const fixBtn = e.target.closest("[data-prob-fix]");
    if (!fixBtn) return;
    e.preventDefault();
    const payload = problemRowStore.get(fixBtn.dataset.probFix) || {};
    openProblemResolve(payload, fixBtn.dataset.kind || "program");
  });
}

function bindProblemResolveUi() {
  const root = document.getElementById("prob-resolve-root");
  if (!root || root.dataset.bound === "1") return;
  root.dataset.bound = "1";
  document.getElementById("prob-resolve-close")?.addEventListener("click", closeProblemResolve);
  document.getElementById("prob-resolve-backdrop")?.addEventListener("click", closeProblemResolve);
  root.addEventListener("click", async (e) => {
    const goto = e.target.closest("[data-pr-goto-client]");
    if (goto && activeProblem?.id) {
      e.preventDefault();
      closeProblemResolve();
      try {
        await openClientDetail(activeProblem.id, {
          product: activeProblem.product_line || "kafene",
        });
      } catch (ex) {
        alert(ex.message || "Nuk u hap klienti.");
      }
      return;
    }
    if (e.target.closest("[data-pr-ack]")) {
      e.preventDefault();
      await ackActiveProblem(e.target.closest("[data-pr-ack]"));
      return;
    }
    const unblock = e.target.closest("[data-pr-unblock]");
    if (unblock && activeProblem?.license_id) {
      e.preventDefault();
      if (!confirm("Zhblloko licencën?")) return;
      unblock.disabled = true;
      try {
        await api(`/api/super/dashboard/licenses/${activeProblem.license_id}/unblock`, {
          method: "POST",
        });
        if (activeProblem.problem_key) {
          await api("/api/super/dashboard/problems/ack", {
            method: "POST",
            body: JSON.stringify({
              problem_key: activeProblem.problem_key,
              kind: activeProblem.kind,
              client_id: activeProblem.id,
              resolution: "unblocked",
            }),
          }).catch(() => null);
        }
        closeProblemResolve();
        await refreshClientsAndProblems();
      } catch (ex) {
        alert(ex.message || "Zhbllokimi dështoi.");
      } finally {
        unblock.disabled = false;
      }
      return;
    }
    const ext = e.target.closest("[data-pr-extend]");
    if (ext && activeProblem?.license_id) {
      e.preventDefault();
      const months = Number(ext.dataset.prExtend) || 12;
      if (!confirm(`Zgjato licencën me ${months} muaj?`)) return;
      ext.disabled = true;
      try {
        const r = await api(`/api/super/dashboard/licenses/${activeProblem.license_id}/extend`, {
          method: "POST",
          body: JSON.stringify({ months }),
        });
        if (activeProblem.problem_key) {
          await api("/api/super/dashboard/problems/ack", {
            method: "POST",
            body: JSON.stringify({
              problem_key: activeProblem.problem_key,
              kind: activeProblem.kind,
              client_id: activeProblem.id,
              resolution: `extended_${months}m`,
              note: `deri ${r.data_skadimit || ""}`,
            }),
          }).catch(() => null);
        }
        alert(`Licenca u zgjat deri më ${r.data_skadimit || "—"}.`);
        closeProblemResolve();
        await refreshClientsAndProblems();
      } catch (ex) {
        alert(ex.message || "Zgjatja dështoi.");
      } finally {
        ext.disabled = false;
      }
    }
  });
}

function jumpToProblemCard(kind) {
  document.querySelectorAll(".kpi-jump").forEach((b) => {
    b.classList.toggle("active", b.dataset.probJump === kind);
  });
  document.querySelectorAll("[data-prob-card]").forEach((card) => {
    const on = card.dataset.probCard === kind;
    card.classList.toggle("prob-card-focus", on);
  });
  const card = document.querySelector(`[data-prob-card="${kind}"]`);
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function refreshClientsAndProblems(btn) {
  const buttons = btn
    ? [btn]
    : [
        document.getElementById("btn-rep-load"),
        document.getElementById("btn-refresh-clients"),
      ].filter(Boolean);
  buttons.forEach((b) => {
    b.disabled = true;
    b.dataset.prevLabel = b.textContent;
    b.textContent = "Duke rifreskuar…";
  });
  try {
    await Promise.all([loadClients().catch(() => null), loadReports()]);
  } finally {
    buttons.forEach((b) => {
      b.disabled = false;
      b.textContent = b.dataset.prevLabel || "Rifresko";
    });
  }
}

async function loadReports() {
  problemRowStore.clear();
  problemRowSeq = 0;
  const d = await api("/api/super/dashboard/problems").catch(() =>
    api("/api/super/dashboard/reports"),
  );
  const c = d.counts || {};
  const set = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(n ?? 0);
  };
  set("prob-kpi-program", c.program);
  set("prob-kpi-offline", c.offline_48h);
  set("prob-kpi-license", c.license_expired);
  set("prob-kpi-print", c.print_errors);
  set("prob-kpi-fiscal", c.fiscal_errors);

  renderProblemList("prob-program", d.program, "Nuk ka probleme me programin.", "program");
  renderProblemList("prob-offline", d.offline_48h, "Nuk ka klientë offline >48h.", "offline");
  renderProblemList("prob-license", d.license_expired, "Nuk ka licenca të skaduara.", "license");
  renderProblemList("prob-print", d.print_errors, "Nuk ka gabime printimi.", "print");
  renderProblemList("prob-fiscal", d.fiscal_errors, "Nuk ka gabime fiskale.", "fiscal");

  const body = document.getElementById("prob-history-body");
  if (body) {
    const hist = d.history || [];
    body.innerHTML = hist.length
      ? hist
          .map(
            (h) => `<tr>
              <td>${esc(fmtDate(h.at))}</td>
              <td>${esc(h.client_name || "—")}</td>
              <td><span class="badge badge-warn">${esc(PROBLEM_KIND_LABEL[h.kind] || h.kind || "—")}</span></td>
              <td>${esc(h.message || h.event || "—")}</td>
            </tr>`,
          )
          .join("")
      : `<tr><td colspan="4" style="color:var(--muted)">Nuk ka histori problemesh ende.</td></tr>`;
  }
}

async function loadSettings() {
  const d = await api("/api/super/dashboard/settings");
  const s = d.settings || {};
  const ui = s.package_prices_ui || {};
  document.getElementById("set-name").value = s.admin_name || "";
  document.getElementById("set-email").value = s.admin_email || "";
  // UI Pako 1–4 → çmimet e sakta (jo ID legacy)
  document.getElementById("set-p1").value = ui.pako_1 ?? s.package_prices?.pako_3 ?? "";
  document.getElementById("set-p2").value = ui.pako_2 ?? s.package_prices?.pako_4 ?? "";
  document.getElementById("set-p3").value = ui.pako_3 ?? s.package_prices?.pako_2 ?? "";
  document.getElementById("set-p4").value = ui.pako_4 ?? s.package_prices?.pako_5 ?? "";
  document.getElementById("set-ai").value = s.ai_price_per_1k_tokens ?? "";
}

async function boot() {
  bindProblemResolveUi();
  document.querySelectorAll(".product-tab").forEach((btn) => {
    btn.addEventListener("click", () => setProductTab(btn.dataset.product));
  });
  setProductTab(currentProduct, { reload: false });
  document.getElementById("nc-product")?.addEventListener("change", syncNewClientForm);
  syncNewClientForm();

  function bindNcHex16(el) {
    if (!el || el.dataset.fmtBound === "1") return;
    el.dataset.fmtBound = "1";
    el.addEventListener("input", () => {
      const hex = String(el.value || "")
        .replace(/[^a-fA-F0-9]/g, "")
        .toUpperCase()
        .slice(0, 16);
      let next = hex;
      if (hex.length > 12) next = `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12)}`;
      else if (hex.length > 8) next = `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8)}`;
      else if (hex.length > 4) next = `${hex.slice(0, 4)}-${hex.slice(4)}`;
      if (next !== el.value) el.value = next;
    });
  }
  bindNcHex16(document.getElementById("nc-hw-id"));
  bindNcHex16(document.getElementById("nc-license-key"));

  function randomHw16() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
  }

  document.getElementById("btn-nc-gen-id")?.addEventListener("click", () => {
    const hwEl = document.getElementById("nc-hw-id");
    const msg = document.getElementById("nc-msg");
    const hw = randomHw16();
    if (hwEl) hwEl.value = hw;
    if (msg) msg.textContent = `ID: ${hw}`;
  });

  /** Gjenero Licencë — mbush menjëherë fushën 16-shenja (krijon ID nëse mungon). */
  document.getElementById("btn-nc-gen-key")?.addEventListener("click", async () => {
    const hwEl = document.getElementById("nc-hw-id");
    const keyEl = document.getElementById("nc-license-key");
    const msg = document.getElementById("nc-msg");
    const btn = document.getElementById("btn-nc-gen-key");
    let hardwareId = String(hwEl?.value || "").trim();
    let hwHex = hardwareId.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
    if (!hardwareId || hwHex.length !== 16) {
      hardwareId = randomHw16();
      hwHex = hardwareId.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
      if (hwEl) hwEl.value = hardwareId;
    }
    const licenseType =
      String(document.getElementById("nc-license-type")?.value || "annual").toLowerCase() === "trial"
        ? "trial"
        : "annual";
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = "Duke gjeneruar licencën…";
    try {
      let data;
      try {
        data = await api("/api/super/generate-license-key", {
          method: "POST",
          body: JSON.stringify({ hardwareId, licenseType }),
        });
      } catch {
        data = await api("/api/admin/licenses/generate-hardware-key", {
          method: "POST",
          body: JSON.stringify({ hardwareId, licenseType }),
        });
      }
      const key = data.licenseKey || data.celesi || "";
      if (!key) throw new Error("Serveri nuk ktheu çelës licence.");
      if (hwEl) hwEl.value = data.hardwareId || formatLicenseHwId(hardwareId) || hardwareId;
      if (keyEl) {
        keyEl.value = key;
        keyEl.focus();
        keyEl.select();
      }
      const chk = document.getElementById("nc-license");
      if (chk) chk.checked = true;
      if (msg) msg.textContent = `Licenca: ${key}`;
    } catch (ex) {
      if (msg) msg.textContent = ex.message || "Gjenerimi dështoi";
      else alert(ex.message || "Gjenerimi dështoi");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("btn-nc-copy-pair")?.addEventListener("click", (e) => {
    const hw = String(document.getElementById("nc-hw-id")?.value || "").trim();
    const key = String(document.getElementById("nc-license-key")?.value || "").trim();
    const text = key && hw ? `ID: ${hw}\nLicenca: ${key}` : key || hw;
    if (!text) {
      alert("Nuk ka ID as licencë.");
      return;
    }
    copyText(text, e.currentTarget);
  });

  document.getElementById("form-new-client")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("nc-msg");
    const btn = document.getElementById("btn-nc-submit");
    const product = document.getElementById("nc-product")?.value || "kafene";
    const hardwareId = String(document.getElementById("nc-hw-id")?.value || "").trim();
    const licenseKey = String(document.getElementById("nc-license-key")?.value || "").trim();
    const issueLicense = Boolean(document.getElementById("nc-license")?.checked);
    const licenseType =
      String(document.getElementById("nc-license-type")?.value || "annual").toLowerCase() === "trial"
        ? "trial"
        : "annual";
    const hwHex = hardwareId.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
    const keyHex = licenseKey.replace(/[^a-fA-F0-9]/g, "").toUpperCase();

    if (issueLicense && hardwareId && hwHex.length !== 16) {
      if (msg) msg.textContent = "ID e pajisjes duhet 16 shenja (XXXX-XXXX-XXXX-XXXX).";
      return;
    }
    if (issueLicense && licenseKey && keyHex.length !== 16) {
      if (msg) msg.textContent = "Çelësi i licencës duhet 16 shenja (XXXX-XXXX-XXXX-XXXX).";
      return;
    }

    const body = {
      product_line: product,
      emri: document.getElementById("nc-emri")?.value?.trim(),
      email: document.getElementById("nc-email")?.value?.trim(),
      telefoni: document.getElementById("nc-tel")?.value?.trim(),
      telefon: document.getElementById("nc-tel")?.value?.trim(),
      tipi:
        product === "hotel"
          ? document.getElementById("nc-hotel-tipi")?.value || "hotel"
          : product === "furra"
            ? document.getElementById("nc-furra-tipi")?.value || "furre_buke"
            : product === "market"
              ? document.getElementById("nc-market-tipi")?.value || "minimarket"
              : document.getElementById("nc-tipi")?.value,
      package_tier: document.getElementById("nc-pako")?.value,
      veprimtari: document.getElementById("nc-veprimtari")?.value,
      issue_license: issueLicense,
      license_type: licenseType,
      hardware_id: hardwareId || undefined,
      celesi: licenseKey || undefined,
      license_key: licenseKey || undefined,
    };
    if (!body.emri) {
      if (msg) msg.textContent = "Emri është i detyrueshëm.";
      return;
    }
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = "Duke regjistruar klientin + licencën…";
    try {
      const data = await api("/api/super/dashboard/clients", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const licKey = data.license?.celesi || data.license?.license_key || licenseKey || "";
      const hwOut = data.hardware_id || hardwareId || "";
      if (msg) {
        msg.textContent = licKey
          ? `U krijua. ID: ${hwOut || "—"} · Licenca: ${licKey}`
          : "Klienti u krijua.";
      }
      if (licKey && document.getElementById("nc-license-key")) {
        document.getElementById("nc-license-key").value = licKey;
      }
      if (hwOut && document.getElementById("nc-hw-id")) {
        document.getElementById("nc-hw-id").value = hwOut;
      }
      document.getElementById("nc-emri").value = "";
      setProductTab(product);
      await loadLicenses().catch(() => null);
    } catch (ex) {
      if (msg) msg.textContent = ex.message || "Gabim";
      else alert(ex.message || "Gabim");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("login-error");
    err.classList.add("hidden");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("email").value.trim(),
          password: document.getElementById("password").value,
        }),
      });
      if (data.user?.roli !== "super_admin") throw new Error("Vetëm Super Admin.");
      token = data.token;
      localStorage.setItem("rip_token", token);
      currentUser = data.user;
      showApp();
      openSection("pasqyra");
    } catch (ex) {
      err.textContent = ex.message || "Hyrja dështoi";
      err.classList.remove("hidden");
    }
  });

  document.getElementById("btn-logout").addEventListener("click", () => logout(true));
  document.getElementById("btn-hamburger").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  document.getElementById("nav-backdrop").addEventListener("click", closeNav);
  document.getElementById("nav-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-section]");
    if (btn) openSection(btn.dataset.section);
  });
  document.getElementById("btn-refresh-clients").addEventListener("click", (e) => {
    e.preventDefault();
    refreshClientsAndProblems(e.currentTarget).catch((ex) => alert(ex.message || ex));
  });
  document.getElementById("problems-kpi")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-prob-jump]");
    if (!btn) return;
    e.preventDefault();
    jumpToProblemCard(btn.dataset.probJump);
  });
  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  document.getElementById("drawer-backdrop").addEventListener("click", closeDrawer);

  document.getElementById("clients-search")?.addEventListener("input", (e) => {
    renderClientsSectors(e.target.value);
  });
  document.getElementById("licenses-search")?.addEventListener("input", (e) => {
    renderLicensesList(e.target.value);
  });

  document.getElementById("btn-setup-link")?.addEventListener("click", async () => {
    const box = document.getElementById("setup-link-result");
    if (!box) return;
    box.textContent = "Duke gjeneruar…";
    try {
      const ttl = Number(document.getElementById("setup-ttl")?.value || 168);
      const data = await api(`/api/admin/setup-download-link?ttlHours=${encodeURIComponent(ttl)}`);
      const url = data.url || "";
      box.innerHTML = `
        <div class="copy-row">
          <div class="mono-box"><div style="color:var(--muted);font-size:0.85rem;margin-bottom:0.25rem">Setup v${esc(data.setup_version || "")} — skadon ${esc(String(data.expires_in_hours || ttl))}h</div>${esc(url)}</div>
          <button type="button" class="btn btn-ghost btn-copy" data-copy="${esc(url)}">Kopjo link</button>
        </div>`;
      box.querySelector("[data-copy]")?.addEventListener("click", (e) => {
        copyText(url, e.currentTarget).catch(() => {});
      });
    } catch (ex) {
      box.textContent = ex.message || String(ex);
    }
  });

  document.getElementById("btn-ai-load").addEventListener("click", () => loadAi().catch(alert));
  document.getElementById("btn-bank-pay-refresh")?.addEventListener("click", () => {
    loadBankPayments().catch((ex) => alert(ex.message || ex));
  });
  document.getElementById("btn-inv-create").addEventListener("click", async () => {
    try {
      await api("/api/super/dashboard/billing/invoices", {
        method: "POST",
        body: JSON.stringify({
          restaurant_id: document.getElementById("inv-client").value,
          period_from: document.getElementById("inv-from").value,
          period_to: document.getElementById("inv-to").value,
        }),
      });
      await loadBilling();
      alert("Fatura u krijua.");
    } catch (ex) {
      alert(ex.message);
    }
  });
  document.getElementById("btn-rep-load")?.addEventListener("click", (e) => {
    e.preventDefault();
    refreshClientsAndProblems(e.currentTarget).catch((ex) => alert(ex.message || ex));
  });
  document.getElementById("btn-settings-save").addEventListener("click", async () => {
    try {
      await api("/api/super/dashboard/settings", {
        method: "PUT",
        body: JSON.stringify({
          admin_name: document.getElementById("set-name").value.trim(),
          admin_email: document.getElementById("set-email").value.trim(),
          // Marketing Pako 1–4 (jo ID legacy) — serveri i mapon dhe i ruan në DB
          package_prices_ui: {
            pako_1: Number(document.getElementById("set-p1").value),
            pako_2: Number(document.getElementById("set-p2").value),
            pako_3: Number(document.getElementById("set-p3").value),
            pako_4: Number(document.getElementById("set-p4").value),
          },
          ai_price_per_1k_tokens: Number(document.getElementById("set-ai").value),
        }),
      });
      const msg = document.getElementById("settings-msg");
      msg.textContent = "U ruajt në sistem. Nuk ndryshojnë derisa ti t’i ndryshosh.";
      msg.classList.remove("hidden");
      await loadSettings();
    } catch (ex) {
      alert(ex.message);
    }
  });

  if (!token) {
    showLogin();
    return;
  }
  try {
    const me = await api("/api/auth/me");
    if (me.user?.roli !== "super_admin") throw new Error("jo super");
    currentUser = me.user;
    showApp();
    openSection("pasqyra");
  } catch {
    logout(false);
  }
}

boot();
