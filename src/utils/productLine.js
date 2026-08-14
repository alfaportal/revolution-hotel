/**
 * Produktet e Master Admin (Revolution Invest) — NJË admin për të gjitha.
 * Listat NUK përzihen. Security lexohet VETËM nga Supabase e Security.
 * Hotel / Market kanë Supabase të ndarë (product_line = hotel | market).
 * Furra mbetet në POS, e ndarë sipas `tipi`.
 */
const PRODUCT_LINES = [
  {
    id: "kafene",
    label: "REVOLUTION POS",
    short: "POS",
    description: "Biznese që SHESIN — kafene, restorant, bar/pub, klub nate, piceri, fast food, dyqan pijesh",
  },
  {
    id: "security",
    label: "REVOLUTION SECURITY",
    short: "Security",
    description: "Biznese që MENAXHOJNË punëtorë në terren — siguri, pastrim, ndërtim, transport, …",
  },
  {
    id: "hotel",
    label: "REVOLUTION HOTEL",
    short: "Hotel",
    description: "Hotel, motel, hostel, resort, villë me qira — lista e ndarë nga POS",
  },
  {
    id: "furra",
    label: "REVOLUTION FURRA",
    short: "Furra",
    description: "Furrë buke dhe pastiçeri — lista e ndarë nga POS",
  },
  {
    id: "market",
    label: "REVOLUTION MARKET",
    short: "Market",
    description: "Ushqimore / Tregtare — mini-market, pilar, supermarket, manav, kasap, peshkore",
  },
];

const { MARKET_TIPI, HOTEL_TIPI } = require("./businessTipi");

const FURRA_TIPI = ["furre_buke", "pasticeri"];
const ALLOWED_APP_TYPES = ["restorant", "kafene", "sekurim", "market"];

function normalizeProductLine(v) {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (s === "security" || s === "sekurim" || s === "securetrack") return "security";
  if (s === "hotel" || s === "hotel_restorant" || s === "motel" || s === "hostel" || s === "resort" || s === "ville" || s === "ville_me_qira" || s === "bujtine") return "hotel";
  if (s === "furra" || s === "furre" || s === "furre_buke" || s === "bakery") return "furra";
  if (s === "market" || s === "minimarket" || s === "mini_market") return "market";
  if (s === "kafene" || s === "cafe" || s === "pos" || s === "hospitality") return "kafene";
  if (PRODUCT_LINES.some((p) => p.id === s && p.enabled !== false)) return s;
  return "kafene";
}

/** POS DB: kafene | security. MARKET/HOTEL DB: market | hotel. */
function toDbProductLine(v) {
  const p = normalizeProductLine(v);
  if (p === "security") return "security";
  if (p === "market" || p === "hotel") return p;
  return "kafene";
}

function productLineLabel(id) {
  return PRODUCT_LINES.find((p) => p.id === normalizeProductLine(id))?.label || id || "—";
}

function appTypeForProductLine(productLine, tipi) {
  const line = normalizeProductLine(productLine);
  if (line === "security") return "sekurim";
  if (line === "market") return "market";
  const t = String(tipi || "").toLowerCase();
  if (MARKET_TIPI.includes(t)) return "market";
  return t === "kafene" ? "kafene" : "restorant";
}

function adminProductOfClient(c) {
  const rawPl = String(c?.product_line || "").trim().toLowerCase();
  if (rawPl === "security" || rawPl === "sekurim" || rawPl === "securetrack") return "security";
  if (rawPl === "market" || rawPl === "hotel") return rawPl;
  const tipi = String(c?.tipi || "").trim().toLowerCase();
  if (HOTEL_TIPI.includes(tipi)) return "hotel";
  if (FURRA_TIPI.includes(tipi)) return "furra";
  if (MARKET_TIPI.includes(tipi)) return "market";
  return "kafene";
}

function adminProductOfLicense(l) {
  const appType = String(l?.app_type || "").toLowerCase();
  if (appType === "sekurim") return "security";
  if (appType === "market") return "market";
  const pl = String(l?.product_line || l?.clients?.product_line || "").toLowerCase();
  if (pl === "security" || pl === "sekurim" || pl === "securetrack") return "security";
  if (pl === "market" || pl === "hotel") return pl;
  return adminProductOfClient(l?.clients || { tipi: l?.clients?.tipi, product_line: l?.product_line });
}

module.exports = {
  PRODUCT_LINES,
  HOTEL_TIPI,
  FURRA_TIPI,
  MARKET_TIPI,
  ALLOWED_APP_TYPES,
  normalizeProductLine,
  toDbProductLine,
  productLineLabel,
  appTypeForProductLine,
  adminProductOfClient,
  adminProductOfLicense,
};
