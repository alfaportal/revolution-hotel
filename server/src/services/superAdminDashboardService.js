/**
 * Aggregime për Super Admin desktop dashboard (/admin/dashboard).
 * Lexon të dhëna ekzistuese — nuk ndryshon licenseService / owner / waiter.
 */
const fs = require("fs");
const path = require("path");
const { getSupabase } = require("../db");
const { listClients, listLicenses, normalizeHardwareIdStored, resolveLicenseHardwareId } = require("./licenseService");
const { listAiUsageSummary } = require("./aiUsageReportService");
const { listStockAlertsForAdmin } = require("./stockService");
const { packageLabel, packageLabelFull, packageContents, normalizePackageTier, featuresForTier } = require("../lib/packages");
const {
  CLIENT_SECTORS,
  MARKET_SECTORS,
  HOTEL_SECTORS,
  ADMIN_CLIENT_TIPI,
  TIPI_LABELS,
  normalizeClientTipi,
  labelForTipi,
  sectorForTipi,
} = require("../utils/businessTipi");
const { buildAiUsageInvoicePdf } = require("./aiBillingPdfService");
const { listSystemFailures } = require("./systemFailureLog");
const { isProblemAcked, ackProblem } = require("./problemAckStore");
const {
  normalizeProductLine,
  PRODUCT_LINES,
  adminProductOfClient,
  adminProductOfLicense,
} = require("../utils/productLine");
const { isDedicatedProduct, homeProduct } = require("../lib/productSupabase");

function clientProductLine(c) {
  return adminProductOfClient(c);
}

function licenseProductLine(l) {
  return adminProductOfLicense(l);
}

function filterByProduct(rows, product, getLine) {
  const home = homeProduct();
  if (home === "market" || home === "hotel") return rows || [];
  const p = normalizeProductLine(product || home || "kafene");
  return (rows || []).filter((r) => getLine(r) === p);
}

const FURRA_SECTORS = [
  { num: 1, id: "furre_buke", label: "Furrë Buke", tipet: ["furre_buke"], keywords: ["furra", "buke"] },
  { num: 2, id: "pasticeri", label: "Pastiçeri / Ëmbëltore", tipet: ["pasticeri"], keywords: ["pasticeri"] },
];

const SETTINGS_PATH = path.join(__dirname, "../../data/super-admin-settings.json");
const INVOICES_PATH = path.join(__dirname, "../../data/super-admin-invoices.json");

/**
 * Çmimet sipas ID legacy në DB (jo numri marketing).
 * Pako 1 → pako_3, Pako 2 → pako_4, Pako 3 → pako_2, Pako 4 → pako_5
 */
const DEFAULT_SETTINGS = {
  admin_name: "Super Admin",
  admin_email: "admin@revolutioninvest.com",
  package_prices: {
    pako_3: 150, // Pako 1
    pako_4: 180, // Pako 2
    pako_2: 220, // Pako 3 (pa AI)
    pako_5: 250, // Pako 4 (AI)
  },
  ai_price_per_1k_tokens: 0.0025,
  currency: "EUR",
};

function ensureDataDir() {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return structuredClone(fallback);
    return { ...structuredClone(fallback), ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch {
    return structuredClone(fallback);
  }
}

function writeJsonFile(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

/** Normalizo çmimet: UI marketing → ID legacy; mos humb çmime të ruajtura. */
function normalizePackagePrices(raw = {}) {
  const out = { ...DEFAULT_SETTINGS.package_prices };
  const src = raw && typeof raw === "object" ? raw : {};
  // ID legacy direkte
  for (const k of ["pako_2", "pako_3", "pako_4", "pako_5", "pako_1"]) {
    if (src[k] != null && src[k] !== "" && Number.isFinite(Number(src[k]))) {
      out[k] = Number(src[k]);
    }
  }
  // Nëse admini ruajti me çelësa marketing (pako_1=Pako1…) — mapo te legacy
  // Vetëm kur nuk ka ende vlerë legacy përkatëse nga UI i vjetër i gabuar:
  // UI i vjetër shkruante set-p1→pako_1, set-p3→pako_3 (gabim).
  // Tani UI dërgon marketing_prices ose legacy të sakta.
  if (src.marketing && typeof src.marketing === "object") {
    const m = src.marketing;
    if (m.pako_1 != null) out.pako_3 = Number(m.pako_1);
    if (m.pako_2 != null) out.pako_4 = Number(m.pako_2);
    if (m.pako_3 != null) out.pako_2 = Number(m.pako_3);
    if (m.pako_4 != null) out.pako_5 = Number(m.pako_4);
  }
  return out;
}

function mergeSettings(raw) {
  const base = structuredClone(DEFAULT_SETTINGS);
  const s = { ...base, ...(raw || {}) };
  s.package_prices = normalizePackagePrices(s.package_prices || {});
  if (s.ai_price_per_1k_tokens != null) {
    s.ai_price_per_1k_tokens = Number(s.ai_price_per_1k_tokens);
  }
  // Për UI: çmimet sipas numrit marketing 1–4
  s.package_prices_ui = {
    pako_1: s.package_prices.pako_3,
    pako_2: s.package_prices.pako_4,
    pako_3: s.package_prices.pako_2,
    pako_4: s.package_prices.pako_5,
  };
  s.package_catalog = [
    { id: "pako_3", ui: "pako_1", name: "Pako 1", contents: packageContents("pako_3"), price: s.package_prices.pako_3 },
    { id: "pako_4", ui: "pako_2", name: "Pako 2", contents: packageContents("pako_4"), price: s.package_prices.pako_4 },
    { id: "pako_2", ui: "pako_3", name: "Pako 3", contents: packageContents("pako_2"), price: s.package_prices.pako_2 },
    { id: "pako_5", ui: "pako_4", name: "Pako 4 (AI)", contents: packageContents("pako_5"), price: s.package_prices.pako_5 },
  ];
  return s;
}

async function readSettingsFromDb() {
  try {
    const db = getSupabase();
    const { data, error } = await db.from("super_admin_settings").select("settings").eq("id", 1).maybeSingle();
    if (error || !data?.settings) return null;
    return data.settings;
  } catch {
    return null;
  }
}

async function writeSettingsToDb(settings) {
  try {
    const db = getSupabase();
    const { error } = await db.from("super_admin_settings").upsert({
      id: 1,
      settings,
      updated_at: new Date().toISOString(),
    });
    if (error) console.warn("[super-admin-settings] db write:", error.message);
    return !error;
  } catch (e) {
    console.warn("[super-admin-settings] db write:", e.message || e);
    return false;
  }
}

function getSettings() {
  const file = readJsonFile(SETTINGS_PATH, DEFAULT_SETTINGS);
  return mergeSettings(file);
}

/** Async — preferon Supabase (mbijeton restart). */
async function getSettingsAsync() {
  const fromDb = await readSettingsFromDb();
  if (fromDb && typeof fromDb === "object") {
    const merged = mergeSettings(fromDb);
    // sync lokal për backup
    try {
      writeJsonFile(SETTINGS_PATH, {
        admin_name: merged.admin_name,
        admin_email: merged.admin_email,
        package_prices: merged.package_prices,
        ai_price_per_1k_tokens: merged.ai_price_per_1k_tokens,
        currency: merged.currency,
      });
    } catch {
      /* ignore */
    }
    return merged;
  }
  return getSettings();
}

function updateSettings(patch = {}) {
  const cur = getSettings();
  return updateSettingsSync(cur, patch);
}

async function updateSettingsAsync(patch = {}) {
  const cur = await getSettingsAsync();
  const next = updateSettingsSync(cur, patch);
  await writeSettingsToDb({
    admin_name: next.admin_name,
    admin_email: next.admin_email,
    package_prices: next.package_prices,
    ai_price_per_1k_tokens: next.ai_price_per_1k_tokens,
    currency: next.currency,
  });
  return next;
}

function updateSettingsSync(cur, patch = {}) {
  const pricePatch = { ...(patch.package_prices || {}) };
  // Nëse UI dërgon çelësa marketing (pako_1…pako_4 si Pako 1…4), mapo
  if (patch.package_prices_ui) {
    pricePatch.marketing = patch.package_prices_ui;
  } else if (
    patch.package_prices &&
    ("pako_1" in patch.package_prices || "pako_2" in patch.package_prices) &&
    patch._prices_are_marketing
  ) {
    pricePatch.marketing = {
      pako_1: patch.package_prices.pako_1,
      pako_2: patch.package_prices.pako_2,
      pako_3: patch.package_prices.pako_3,
      pako_4: patch.package_prices.pako_4,
    };
  }

  const nextRaw = {
    admin_name: patch.admin_name != null ? patch.admin_name : cur.admin_name,
    admin_email: patch.admin_email != null ? patch.admin_email : cur.admin_email,
    currency: patch.currency != null ? patch.currency : cur.currency,
    package_prices: {
      ...cur.package_prices,
      ...pricePatch,
    },
    ai_price_per_1k_tokens:
      patch.ai_price_per_1k_tokens != null
        ? Number(patch.ai_price_per_1k_tokens)
        : cur.ai_price_per_1k_tokens,
  };
  const next = mergeSettings(nextRaw);
  writeJsonFile(SETTINGS_PATH, {
    admin_name: next.admin_name,
    admin_email: next.admin_email,
    package_prices: next.package_prices,
    ai_price_per_1k_tokens: next.ai_price_per_1k_tokens,
    currency: next.currency,
  });
  return next;
}

async function listBillingInvoicesAsync() {
  try {
    const db = getSupabase();
    const { data, error } = await db
      .from("super_admin_invoices")
      .select("payload")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!error && Array.isArray(data) && data.length) {
      return data.map((r) => r.payload).filter(Boolean);
    }
  } catch {
    /* fallback file */
  }
  return listBillingInvoices();
}

function listBillingInvoices() {
  const data = readJsonFile(INVOICES_PATH, { invoices: [] });
  return Array.isArray(data.invoices) ? data.invoices : [];
}

function saveBillingInvoices(invoices) {
  writeJsonFile(INVOICES_PATH, { invoices });
}

async function saveBillingInvoiceDb(invoice) {
  try {
    const db = getSupabase();
    await db.from("super_admin_invoices").upsert({
      id: invoice.id,
      payload: invoice,
      created_at: invoice.created_at || new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[super-admin-invoices] db write:", e.message || e);
  }
  const all = listBillingInvoices();
  const idx = all.findIndex((x) => x.id === invoice.id);
  if (idx >= 0) all[idx] = invoice;
  else all.unshift(invoice);
  saveBillingInvoices(all);
}

function dayStartIso(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isoDate(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchClosedSales({ fromIso, toIso }) {
  const db = getSupabase();
  let q = db
    .from("sales_orders")
    .select("id, client_id, total, closed_at, status, waiter_name")
    .eq("status", "closed")
    .gte("closed_at", fromIso);
  if (toIso) q = q.lt("closed_at", toIso);
  const { data, error } = await q.limit(20000);
  if (error) {
    console.warn("[super-dashboard] sales_orders:", error.message);
    return [];
  }
  return data || [];
}

async function salesTodayByClient() {
  const fromIso = dayStartIso();
  const rows = await fetchClosedSales({ fromIso });
  const map = new Map();
  let total = 0;
  for (const r of rows) {
    const t = Number(r.total) || 0;
    total += t;
    const cid = r.client_id;
    if (!cid) continue;
    map.set(cid, (map.get(cid) || 0) + t);
  }
  return { total: Number(total.toFixed(2)), byClient: map };
}

async function weeklySalesSeries() {
  const days = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    days.push(isoDate(d));
  }
  const fromIso = dayStartIso(addDays(today, -6));
  const rows = await fetchClosedSales({ fromIso });
  const byDay = Object.fromEntries(days.map((d) => [d, 0]));
  for (const r of rows) {
    const d = isoDate(r.closed_at);
    if (byDay[d] == null) continue;
    byDay[d] += Number(r.total) || 0;
  }
  return days.map((date) => ({
    date,
    total: Number((byDay[date] || 0).toFixed(2)),
  }));
}

function licenseLastSeen(lic) {
  const terminals = lic.terminals || [];
  let latest = lic.last_activated_at || lic.updated_at || lic.created_at || null;
  for (const t of terminals) {
    if (t.last_seen_at && (!latest || new Date(t.last_seen_at) > new Date(latest))) {
      latest = t.last_seen_at;
    }
  }
  return latest;
}

function isOfflineOver48h(lic) {
  const seen = licenseLastSeen(lic);
  if (!seen) return true;
  return Date.now() - new Date(seen).getTime() > 48 * 60 * 60 * 1000;
}

/** Trial i vërtetë: afat i shkurtër (≤16 ditë). Licenca vjetore me trial_ends_at të mbushur gabimisht → JO trial. */
function isShortTrialLicense(l) {
  if (!l || String(l.statusi || "") !== "aktive") return false;
  const fill = l.data_fillimit ? new Date(l.data_fillimit) : null;
  const skad = l.data_skadimit ? new Date(l.data_skadimit) : null;
  if (fill && skad && !Number.isNaN(fill.getTime()) && !Number.isNaN(skad.getTime())) {
    const days = (skad.getTime() - fill.getTime()) / 86400000;
    if (days < 0 || days > 16) return false;
    return skad.getTime() >= Date.now() - 86400000;
  }
  if (!l.trial_ends_at) return false;
  const te = new Date(l.trial_ends_at);
  if (Number.isNaN(te.getTime()) || te.getTime() <= Date.now()) return false;
  const from = fill && !Number.isNaN(fill.getTime()) ? fill : new Date();
  return (te.getTime() - from.getTime()) / 86400000 <= 16;
}

async function getOverviewKafene(adminProduct = "kafene") {
  const slice = normalizeProductLine(adminProduct || "kafene");
  const dedicated = isDedicatedProduct(slice);
  const [clientsAll, licensesAll, stockAlerts, salesToday, weekly] = await Promise.all([
    listClients({ product: slice }),
    listLicenses({ product: slice }),
    dedicated ? Promise.resolve([]) : listStockAlertsForAdmin().catch(() => []),
    dedicated ? Promise.resolve({ total: 0, byClient: new Map() }) : salesTodayByClient(),
    dedicated ? Promise.resolve([]) : weeklySalesSeries(),
  ]);

  const clients = filterByProduct(clientsAll, slice, clientProductLine);
  const licenses = filterByProduct(licensesAll, slice, licenseProductLine);
  const activeClients = clients.filter((c) => c.aktiv !== false);
  const licByClient = new Map();
  for (const lic of licenses) {
    const cid = lic.client_id || lic.clients?.id;
    if (!cid) continue;
    if (!licByClient.has(cid)) licByClient.set(cid, []);
    licByClient.get(cid).push(lic);
  }

  const stockZeroClientIds = new Set(
    (stockAlerts || []).filter((a) => (a.out_count || 0) > 0).map((a) => a.client_id),
  );

  const problems = [];
  for (const c of clients) {
    const lics = licByClient.get(c.id) || [];
    const reasons = [];
    if (lics.some((l) => ["skaduar", "revokuar", "pezulluar"].includes(l.statusi))) {
      reasons.push("licencë skaduar/bllokuar");
    }
    if (lics.length && lics.every((l) => isOfflineOver48h(l))) {
      reasons.push("offline >48h");
    }
    if (stockZeroClientIds.has(c.id)) {
      reasons.push("stok zero");
    }
    if (reasons.length) {
      problems.push({
        id: c.id,
        emri: c.emri,
        tipi: normalizeClientTipi(c.tipi),
        tipi_label: labelForTipi(c.tipi),
        product_line: slice,
        reasons,
      });
    }
  }

  // Trial = licencë aktive me afat të shkurtër (≤16 ditë).
  // Mos numëro licenca vjetore që gabimisht kanë trial_ends_at të mbushur.
  const trial = licenses.filter((l) => isShortTrialLicense(l)).length;

  return {
    active_clients: activeClients.length,
    clients_total: clients.length,
    licenses_total: licenses.length,
    licenses_active: licenses.filter((l) => l.statusi === "aktive").length,
    trial_accounts: trial,
    sales_today_total: slice === "kafene" ? salesToday.total : 0,
    problem_clients: problems,
    weekly_sales: slice === "kafene" ? weekly : [],
    product_line: slice,
  };
}

async function getOverview({ product } = {}) {
  const p = normalizeProductLine(product || "kafene");
  if (p === "security") {
    return getSecurityOverview();
  }
  return getOverviewKafene(p);
}

async function getClientsGrouped({ product } = {}) {
  const p = normalizeProductLine(product || "kafene");
  if (p === "security") {
    return getSecurityClientsGrouped();
  }

  const [clientsAll, licenses, salesToday] = await Promise.all([
    listClients({ product: p }),
    listLicenses({ product: p }),
    isDedicatedProduct(p) ? Promise.resolve({ total: 0, byClient: new Map() }) : salesTodayByClient(),
  ]);
  const clients = filterByProduct(clientsAll, p, clientProductLine);

  const licByClient = new Map();
  for (const lic of licenses) {
    const cid = lic.client_id || lic.clients?.id;
    if (!cid) continue;
    if (!licByClient.has(cid)) licByClient.set(cid, []);
    licByClient.get(cid).push(lic);
  }

  const sectorDefs =
    p === "hotel"
      ? HOTEL_SECTORS
      : p === "furra"
        ? FURRA_SECTORS
        : p === "market"
          ? MARKET_SECTORS
          : CLIENT_SECTORS;
  const sectors = sectorDefs.map((s) => ({
    num: s.num,
    id: s.id,
    label: s.label,
    tipet: s.tipet,
    keywords: s.keywords || [],
    clients: [],
  }));
  const bySectorId = new Map(sectors.map((s) => [s.id, s]));

  for (const c of clients) {
    const tipi = normalizeClientTipi(c.tipi);
    let sector;
    if (p === "hotel") {
      sector = HOTEL_SECTORS.find((s) => s.tipet.includes(tipi)) || HOTEL_SECTORS[0];
    } else if (p === "furra") {
      sector = FURRA_SECTORS.find((s) => s.tipet.includes(tipi)) || FURRA_SECTORS[0];
    } else if (p === "market") {
      sector = MARKET_SECTORS.find((s) => s.tipet.includes(tipi)) || MARKET_SECTORS[0];
    } else {
      sector = sectorForTipi(tipi);
    }
    const lics = licByClient.get(c.id) || [];
    const activeLic = lics.some((l) => l.statusi === "aktive");
    const row = {
      id: c.id,
      emri: c.emri,
      tipi,
      tipi_label: labelForTipi(c.tipi),
      package_tier: c.package_tier,
      package_label: packageLabel(c.package_tier),
      package_contents: packageContents(c.package_tier),
      status: c.aktiv === false ? "joaktiv" : activeLic ? "aktiv" : "joaktiv",
      sales_today: Number((salesToday.byClient.get(c.id) || 0).toFixed(2)),
      email: c.email || "",
      telefoni: c.telefoni || "",
      icon: iconForTipi(tipi),
      sector_num: sector.num,
      sector_id: sector.id,
      product_line: p,
    };
    const bucket = bySectorId.get(sector.id) || bySectorId.get("other") || sectors[0];
    bucket.clients.push(row);
  }

  const padded = sectorDefs.map((def) => {
    const hit = bySectorId.get(def.id) || { clients: [] };
    return {
      num: def.num,
      id: def.id,
      label: def.label,
      tipet: def.tipet,
      keywords: def.keywords || [],
      clients: hit.clients || [],
      count: (hit.clients || []).length,
    };
  });

  return {
    sectors: padded,
    groups: padded,
    total: clients.length,
    product_line: p,
    products: PRODUCT_LINES,
  };
}

function iconForTipi(tipi) {
  const map = {
    kafene: "☕",
    restorant: "🍽️",
    bar: "🍸",
    pub_lounge: "🛋️",
    piceri: "🍕",
    fast_food: "🍔",
    kebab: "🥙",
    pasticeri: "🧁",
    akullore: "🍦",
    gjeltore: "🍗",
    furre_buke: "🥖",
    hotel_restorant: "🏨",
    hotel: "🏨",
    motel: "🛏️",
    hostel: "🧳",
    bujtine: "🧳",
    resort: "🌴",
    ville: "🏡",
    ville_me_qira: "🏡",
    bar_nate: "🌙",
    klub: "🎶",
    klub_nate: "🪩",
    diskoteke: "🪩",
    dyqan_pijesh: "🥤",
    market: "🛒",
    minimarket: "🛒",
    mini_market: "🛒",
    pilar: "🏪",
    supermarket: "🏬",
    dyqan_ushqimor: "🥫",
    manav: "🥬",
    bulmetore: "🧀",
    kasap: "🥩",
    peshkore: "🐟",
    dyqan_peshku: "🐟",
    dyqan_rroba: "👕",
    dyqan_kepuce: "👟",
    dyqan: "🏬",
    farmaci: "💊",
    optike: "👓",
    berber: "💈",
    sallon_bukurie: "💅",
    tjeter: "🏪",
  };
  return map[normalizeClientTipi(tipi)] || "🏪";
}

async function getClientDetail(clientId, productHint) {
  const { getSupabaseForProduct } = require("../lib/productSupabase");
  const db = getSupabaseForProduct(productHint || "kafene");
  const id = String(clientId || "").trim();
  if (!id) throw new Error("Mungon client_id");

  const { data: client, error } = await db.from("clients").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!client) throw new Error("Klienti nuk u gjet");

  const dedicated = isDedicatedProduct(productHint);
  const { listOwnersForClient } = require("./userService");
  const fromIso = dayStartIso(addDays(new Date(), -30));
  const [salesRows, licenses, stockAlerts, aiSummary, staff, owners] = await Promise.all([
    dedicated ? Promise.resolve([]) : fetchClosedSales({ fromIso }).then((rows) => rows.filter((r) => r.client_id === id)),
    listLicenses({ product: productHint || "kafene" }).then((all) => all.filter((l) => (l.client_id || l.clients?.id) === id)),
    dedicated ? Promise.resolve([]) : listStockAlertsForAdmin()
      .then((a) => a.filter((x) => x.client_id === id))
      .catch(() => []),
    dedicated ? Promise.resolve({ rows: [], totals: {} }) : listAiUsageSummary({}).catch(() => ({ rows: [], totals: {} })),
    dedicated
      ? Promise.resolve([])
      : db
        .from("pos_staff")
        .select("id, name, role, active, pin_hash")
        .eq("client_id", id)
        .order("name", { ascending: true })
        .then((r) => r.data || [])
        .catch(() => []),
    dedicated ? Promise.resolve([]) : listOwnersForClient(id).catch(() => []),
  ]);

  const salesToday = salesRows
    .filter((r) => isoDate(r.closed_at) === isoDate(new Date()))
    .reduce((s, r) => s + (Number(r.total) || 0), 0);
  const sales30 = salesRows.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const aiRow = (aiSummary.rows || []).find((r) => String(r.restaurant_id) === id);

  const { data: menuStock } = dedicated
    ? { data: [] }
    : await db
      .from("pos_menu_items")
      .select("id, name, stock_quantity, track_stock, active")
      .eq("client_id", id)
      .limit(500)
      .then((r) => r)
      .catch(() => ({ data: [] }));

  const zeroStock = (menuStock || []).filter(
    (m) => m.track_stock && m.active !== false && Number(m.stock_quantity || 0) <= 0,
  );

  return {
    client: {
      ...client,
      tipi_label: labelForTipi(client.tipi),
      package_label: packageLabel(client.package_tier),
      icon: iconForTipi(client.tipi),
    },
    sales: {
      today: Number(salesToday.toFixed(2)),
      last_30_days: Number(sales30.toFixed(2)),
      order_count_30d: salesRows.length,
      recent: salesRows.slice(0, 40).map((r) => ({
        id: r.id,
        total: Number(r.total) || 0,
        closed_at: r.closed_at,
        waiter_name: r.waiter_name || "",
      })),
    },
    stock: {
      alerts: stockAlerts,
      zero_items: zeroStock.slice(0, 50),
      zero_count: zeroStock.length,
    },
    waiters: (staff || []).map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role || "waiter",
      active: s.active !== false,
    })),
    licenses: licenses.map((l) => ({
      id: l.id,
      celesi: l.celesi,
      device_id: l.display_device_id || l.device_id || "",
      hardware_id: resolveLicenseHardwareId(l) || normalizeHardwareIdStored(l.hardware_id || ""),
      statusi: l.statusi,
      data_skadimit: l.data_skadimit || null,
      data_fillimit: l.data_fillimit || null,
      activated_at: l.last_activated_at || l.created_at,
      last_seen_at: licenseLastSeen(l),
      max_terminals: Number(l.max_terminals) || 1,
    })),
    ai_usage: aiRow || {
      tokens_total: 0,
      cost_eur_total: 0,
      calls: 0,
    },
    owners: owners || [],
  };
}

async function getLicensesView({ product } = {}) {
  const p = normalizeProductLine(product || "kafene");
  if (p === "security") {
    return getSecurityLicensesView();
  }

  const { ensureLicenseHardwareSchema } = require("../lib/ensureLicenseHardwareSchema");
  if (!isDedicatedProduct(p)) {
    await ensureLicenseHardwareSchema().catch(() => false);
  }
  const licenses = filterByProduct(await listLicenses({ product: p }), p, licenseProductLine);
  return {
    licenses: licenses.map((l) => {
      const device = String(l.display_device_id || l.device_id || "").trim();
      const hardware_id = resolveLicenseHardwareId(l);
      return {
        id: l.id,
        client_id: l.client_id || l.clients?.id,
        client_name: l.clients?.emri || "—",
        device_id: device,
        hardware_id,
        license_key: l.celesi || "",
        statusi: l.statusi,
        activated_at: l.last_activated_at || l.created_at,
        last_seen_at: licenseLastSeen(l),
        product_line: licenseProductLine(l),
      };
    }),
    product_line: p,
    products: PRODUCT_LINES,
  };
}

async function getAiUsageDashboard({ month } = {}) {
  const summary = await listAiUsageSummary({ month });
  const db = getSupabase();
  const rangeMonth = summary.month;
  const [y, m] = rangeMonth.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
  const end = new Date(Date.UTC(y, m, 1)).toISOString();

  const { data: logs } = await db
    .from("ai_usage_logs")
    .select("created_at, tokens_used, cost_eur")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: true })
    .limit(10000)
    .then((r) => r)
    .catch(() => ({ data: [] }));

  const byDay = new Map();
  for (const row of logs || []) {
    const d = isoDate(row.created_at);
    if (!byDay.has(d)) byDay.set(d, { date: d, tokens: 0, cost_eur: 0 });
    const e = byDay.get(d);
    e.tokens += Number(row.tokens_used) || 0;
    e.cost_eur += Number(row.cost_eur) || 0;
  }

  const timeline = [...byDay.values()].map((e) => ({
    date: e.date,
    tokens: e.tokens,
    cost_eur: Number(e.cost_eur.toFixed(4)),
  }));

  const rows = (summary.rows || []).map((r) => ({
    ...r,
    last_used_at: null,
  }));

  // last used per restaurant
  const lastByRest = new Map();
  for (const row of logs || []) {
    /* logs may not include restaurant_id in this select — refetch if needed */
  }
  const { data: lastLogs } = await db
    .from("ai_usage_logs")
    .select("restaurant_id, created_at")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: false })
    .limit(5000)
    .then((r) => r)
    .catch(() => ({ data: [] }));
  for (const row of lastLogs || []) {
    if (!row.restaurant_id || lastByRest.has(row.restaurant_id)) continue;
    lastByRest.set(row.restaurant_id, row.created_at);
  }
  for (const r of rows) {
    r.last_used_at = lastByRest.get(r.restaurant_id) || null;
  }

  return {
    month: summary.month,
    rows,
    totals: summary.totals,
    timeline,
    table_missing: summary.table_missing || false,
  };
}

async function getSalesReport({ from, to, group = "day" } = {}) {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : addDays(toDate, -29);
  fromDate.setHours(0, 0, 0, 0);
  toDate.setHours(23, 59, 59, 999);

  const rows = await fetchClosedSales({
    fromIso: fromDate.toISOString(),
    toIso: addDays(toDate, 1).toISOString(),
  });
  const clients = await listClients();
  const nameById = new Map(clients.map((c) => [c.id, c.emri]));

  const byClient = new Map();
  const byPeriod = new Map();

  function periodKey(iso) {
    const d = new Date(iso);
    if (group === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (group === "week") {
      const tmp = new Date(d);
      tmp.setHours(0, 0, 0, 0);
      tmp.setDate(tmp.getDate() - ((tmp.getDay() + 6) % 7));
      return isoDate(tmp);
    }
    return isoDate(d);
  }

  for (const r of rows) {
    const cid = r.client_id;
    const total = Number(r.total) || 0;
    if (!byClient.has(cid)) byClient.set(cid, { client_id: cid, client_name: nameById.get(cid) || cid, total: 0, orders: 0 });
    const c = byClient.get(cid);
    c.total += total;
    c.orders += 1;

    const pk = periodKey(r.closed_at);
    if (!byPeriod.has(pk)) byPeriod.set(pk, { period: pk, total: 0, orders: 0 });
    const p = byPeriod.get(pk);
    p.total += total;
    p.orders += 1;
  }

  return {
    from: isoDate(fromDate),
    to: isoDate(toDate),
    group,
    by_client: [...byClient.values()]
      .map((r) => ({ ...r, total: Number(r.total.toFixed(2)) }))
      .sort((a, b) => b.total - a.total),
    by_period: [...byPeriod.values()]
      .map((r) => ({ ...r, total: Number(r.total.toFixed(2)) }))
      .sort((a, b) => String(a.period).localeCompare(String(b.period))),
    grand_total: Number(rows.reduce((s, r) => s + (Number(r.total) || 0), 0).toFixed(2)),
    order_count: rows.length,
  };
}

function reportToCsv(report) {
  const lines = ["Klienti,Porosi,Shitje EUR"];
  for (const r of report.by_client || []) {
    const name = String(r.client_name || "").replace(/"/g, '""');
    lines.push(`"${name}",${r.orders},${Number(r.total).toFixed(2)}`);
  }
  lines.push(`TOTALI,${report.order_count},${Number(report.grand_total).toFixed(2)}`);
  lines.push("");
  lines.push("Periudha,Porosi,Shitje EUR");
  for (const r of report.by_period || []) {
    lines.push(`${r.period},${r.orders},${Number(r.total).toFixed(2)}`);
  }
  return lines.join("\n");
}

function classifyFailureEvent(entry) {
  const blob = `${entry.event || ""} ${entry.message || ""} ${JSON.stringify(entry.detail || {})}`.toLowerCase();
  if (/fiscal|fiskal|atk|tvsh|nuikf/.test(blob)) return "fiscal";
  if (/print|printer|esc\/pos|thermal|fatur/.test(blob)) return "print";
  if (/offline|outage|cloud_offline/.test(blob)) return "offline";
  return "program";
}

function matchClientFromFailure(entry, clients) {
  const msg = String(entry.message || "");
  const detail = entry.detail || {};
  const hay = `${msg} ${detail.client_id || ""} ${detail.client_name || ""}`.toLowerCase();
  for (const c of clients) {
    const name = String(c.emri || "").toLowerCase();
    if (name && hay.includes(name)) return c;
    if (c.id && hay.includes(String(c.id).toLowerCase())) return c;
  }
  return null;
}

/**
 * Raportet e Super Admin = VETËM probleme (jo shitje).
 */
function filterOpenProblems(rows) {
  return (rows || []).filter((r) => r?.problem_key && !isProblemAcked(r.problem_key));
}

async function getProblemsReport() {
  const [clients, licenses, stockAlerts] = await Promise.all([
    listClients(),
    listLicenses(),
    listStockAlertsForAdmin().catch(() => []),
  ]);

  const licByClient = new Map();
  for (const lic of licenses) {
    const cid = lic.client_id || lic.clients?.id;
    if (!cid) continue;
    if (!licByClient.has(cid)) licByClient.set(cid, []);
    licByClient.get(cid).push(lic);
  }

  const stockZeroClientIds = new Set(
    (stockAlerts || []).filter((a) => (a.out_count || 0) > 0).map((a) => a.client_id),
  );

  const program = [];
  const offline_48h = [];
  const license_expired = [];

  for (const c of clients) {
    const lics = licByClient.get(c.id) || [];
    const base = {
      id: c.id,
      emri: c.emri,
      tipi: normalizeClientTipi(c.tipi),
      tipi_label: labelForTipi(c.tipi),
      product_line: clientProductLine(c),
    };

    if (lics.some((l) => ["skaduar"].includes(l.statusi))) {
      const lic = lics.find((l) => l.statusi === "skaduar");
      license_expired.push({
        ...base,
        kind: "license",
        issue: "expired",
        detail: "Licencë e skaduar — zgjat këtu; ID/email/çelës vetëm te Klientët",
        at: lic?.updated_at || lic?.data_skadimit || null,
        license_id: lic?.id || null,
        data_skadimit: lic?.data_skadimit || null,
        statusi: lic?.statusi || "skaduar",
        problem_key: `license:expired:${c.id}:${lic?.id || "x"}`,
      });
    }
    if (lics.some((l) => ["revokuar", "pezulluar"].includes(l.statusi))) {
      const lic = lics.find((l) => ["revokuar", "pezulluar"].includes(l.statusi));
      program.push({
        ...base,
        kind: "program",
        issue: "blocked",
        detail: "Licencë e bllokuar / pezulluar",
        at: lic?.updated_at || null,
        license_id: lic?.id || null,
        data_skadimit: lic?.data_skadimit || null,
        statusi: lic?.statusi || null,
        problem_key: `program:blocked:${c.id}:${lic?.id || "x"}`,
      });
    }
    if (lics.length && lics.every((l) => isOfflineOver48h(l))) {
      const seen = lics.map(licenseLastSeen).filter(Boolean).sort().pop() || null;
      const lic = lics[0];
      offline_48h.push({
        ...base,
        kind: "offline",
        issue: "offline_48h",
        detail: "Offline më shumë se 48 orë",
        at: seen,
        last_seen_at: seen,
        license_id: lic?.id || null,
        data_skadimit: lic?.data_skadimit || null,
        statusi: lic?.statusi || null,
        problem_key: `offline:${c.id}`,
      });
    }
    if (stockZeroClientIds.has(c.id)) {
      const lic = lics.find((l) => l.statusi === "aktive") || lics[0];
      program.push({
        ...base,
        kind: "program",
        issue: "stock_zero",
        detail: "Stok zero — kontrollo te klienti / shëno si të zgjidhur",
        at: null,
        license_id: lic?.id || null,
        data_skadimit: lic?.data_skadimit || null,
        statusi: lic?.statusi || null,
        problem_key: `program:stock:${c.id}`,
      });
    }
  }

  const failures = listSystemFailures(200);
  const print_errors = [];
  const fiscal_errors = [];
  const history = [];

  for (const f of failures) {
    const kind = classifyFailureEvent(f);
    const client = matchClientFromFailure(f, clients);
    const failureId = f.id || `${f.at || ""}-${kind}`;
    const row = {
      id: client?.id || null,
      emri: client?.emri || (String(f.message || "").split("—")[0] || "").trim() || "I panjohur",
      tipi_label: client ? labelForTipi(client.tipi) : "—",
      product_line: client ? clientProductLine(client) : "kafene",
      detail: f.message || f.event || "Gabim",
      at: f.at || null,
      event: f.event || kind,
      source: f.source || "system",
      kind,
      issue: kind,
      failure_id: failureId,
      problem_key: `${kind}:failure:${failureId}`,
      license_id: null,
      statusi: null,
    };
    if (client) {
      const lics = licByClient.get(client.id) || [];
      const lic = lics.find((l) => l.statusi === "aktive") || lics[0];
      row.license_id = lic?.id || null;
      row.data_skadimit = lic?.data_skadimit || null;
      row.statusi = lic?.statusi || null;
    }
    history.push({
      at: row.at,
      client_name: row.emri,
      client_id: row.id,
      kind,
      message: row.detail,
      event: row.event,
      source: row.source,
      problem_key: row.problem_key,
    });
    if (isProblemAcked(row.problem_key)) continue;
    if (kind === "print") print_errors.push(row);
    else if (kind === "fiscal") fiscal_errors.push(row);
    else if (kind === "program" && client) {
      program.push({
        ...row,
        tipi: normalizeClientTipi(client.tipi),
        issue: "runtime",
        problem_key: `program:failure:${failureId}`,
      });
    }
  }

  history.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));

  const openProgram = filterOpenProblems(program);
  const openOffline = filterOpenProblems(offline_48h);
  const openLicense = filterOpenProblems(license_expired);

  return {
    program: openProgram,
    offline_48h: openOffline,
    license_expired: openLicense,
    print_errors,
    fiscal_errors,
    history,
    counts: {
      program: openProgram.length,
      offline_48h: openOffline.length,
      license_expired: openLicense.length,
      print_errors: print_errors.length,
      fiscal_errors: fiscal_errors.length,
      history: history.length,
    },
  };
}

async function createBillingInvoice({ restaurant_id, period_from, period_to, services, notes }) {
  const detail = await getClientDetail(restaurant_id);
  const settings = await getSettingsAsync();
  const tier = normalizePackageTier(detail.client.package_tier);
  const feats = featuresForTier(tier);
  const ai = detail.ai_usage || {};
  const packagePrice =
    Number(settings.package_prices?.[tier]) ||
    Number(settings.package_prices_ui?.[`pako_${marketingNumFallback(tier)}`]) ||
    0;
  const includeAi = Boolean(feats.ai);
  const tokenCost = includeAi ? Number(ai.cost_eur_total) || 0 : 0;
  const tokens = includeAi ? ai.tokens_total || 0 : 0;
  const pkgLabel = packageLabelFull(tier);
  const defaultServices = [
    {
      label: pkgLabel,
      amount: packagePrice,
      contents: packageContents(tier),
    },
  ];
  if (includeAi && tokenCost > 0) {
    defaultServices.push({
      label: `AI tokena (${Number(tokens).toLocaleString("sq-AL")})`,
      amount: tokenCost,
    });
  }
  const servicesList = Array.isArray(services) && services.length ? services : defaultServices;
  const servicesTotal = servicesList.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const total = Number(servicesTotal.toFixed(2));
  const invoice = {
    id: `INV-${Date.now()}`,
    restaurant_id,
    client_name: detail.client.emri,
    period_from: period_from || isoDate(addDays(new Date(), -30)),
    period_to: period_to || isoDate(new Date()),
    package_tier: tier,
    package_label: pkgLabel,
    package_contents: packageContents(tier),
    package_price: packagePrice,
    ai_tokens: tokens,
    ai_cost: tokenCost,
    ai_included: includeAi,
    services: servicesList,
    notes: notes || "",
    total,
    status: "papaguar",
    created_at: new Date().toISOString(),
  };
  await saveBillingInvoiceDb(invoice);
  return invoice;
}

function marketingNumFallback(tier) {
  const id = normalizePackageTier(tier);
  const map = { pako_3: 1, pako_4: 2, pako_2: 3, pako_5: 4 };
  return map[id] || 1;
}

function updateBillingInvoiceStatus(id, status) {
  const all = listBillingInvoices();
  const idx = all.findIndex((x) => x.id === id);
  if (idx < 0) throw new Error("Fatura nuk u gjet");
  const st = String(status) === "paguar" ? "paguar" : "papaguar";
  all[idx] = { ...all[idx], status: st, updated_at: new Date().toISOString() };
  saveBillingInvoices(all);
  saveBillingInvoiceDb(all[idx]).catch(() => {});
  return all[idx];
}

function buildBillingInvoicePdf(invoice) {
  const includeAi = invoice.ai_included === true && Number(invoice.ai_cost) > 0;
  const breakdown = {
    package: {
      calls: 1,
      tokens: 0,
      cost_eur: invoice.package_price,
      label: invoice.package_label || packageLabelFull(invoice.package_tier),
      contents: invoice.package_contents || packageContents(invoice.package_tier),
    },
  };
  if (includeAi) {
    breakdown.ai_tokens = {
      calls: 1,
      tokens: invoice.ai_tokens,
      cost_eur: invoice.ai_cost,
      label: "AI tokena",
    };
  }
  return buildAiUsageInvoicePdf({
    clientName: invoice.client_name,
    month: `${invoice.period_from} — ${invoice.period_to}`,
    tokensTotal: includeAi ? invoice.ai_tokens : 0,
    costEur: invoice.total,
    calls: includeAi ? invoice.ai_tokens : 0,
    packageTier: invoice.package_label || packageLabelFull(invoice.package_tier),
    packageContents: invoice.package_contents || packageContents(invoice.package_tier),
    invoiceNo: invoice.id,
    breakdown,
    showAi: includeAi,
  });
}

module.exports = {
  getOverview,
  getClientsGrouped,
  getClientDetail,
  getLicensesView,
  getAiUsageDashboard,
  getSalesReport,
  getProblemsReport,
  ackProblem,
  reportToCsv,
  getSettings,
  getSettingsAsync,
  updateSettings,
  updateSettingsAsync,
  listBillingInvoices,
  listBillingInvoicesAsync,
  createBillingInvoice,
  updateBillingInvoiceStatus,
  buildBillingInvoicePdf,
  iconForTipi,
  ADMIN_CLIENT_TIPI,
  TIPI_LABELS,
  PRODUCT_LINES,
};
