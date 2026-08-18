/**
 * Matematikë pako → copë për blerje / AI faturë.
 * Fatura DISKONT (Njesia=copë): Sasia shkon drejt në stok (×1).
 * Vetëm kur Njesia=pako: Sasia × copa/pako.
 */

function parseEuroNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 1000) / 1000;
  }
  let cleaned = String(value ?? "")
    .replace(/\s/g, "")
    .replace(/[^\d.,-]/g, "");
  if (!cleaned) return NaN;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(",", ".");
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN;
}

function normalizeUnit(unit) {
  const u = String(unit || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (/^(pako|pake|pak|box|carton|kutia|kuti)$/.test(u)) return "pako";
  if (/^(kg|kilogram|kilograme|kilo|g|gr|gram)$/.test(u)) return "kg";
  if (/^(l|lt|liter|litra|ml)$/.test(u)) return "l";
  return "copë";
}

/** Nga emri: "Nescafe Cremoso 10 cop" → 10 (vetëm kur unit=pako) */
function piecesFromName(name) {
  const m = String(name || "").match(/(\d+)\s*cop(?:e|ë|a)?\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function volumeLiters(name) {
  const s = String(name || "").toLowerCase().replace(",", ".");
  const ml = s.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (ml) return Number(ml[1]) / 1000;
  const l = s.match(/(\d+(?:\.\d+)?)\s*l\b/);
  if (l) return Number(l[1]);
  return null;
}

function looksLikeMilk(name) {
  return /qumesht|qumësht|milk|barista|llokum/i.test(String(name || ""));
}

function looksLikeWater(name) {
  return /mineral|natyr|uje|ujë|aria|pellister|roga|rugove/i.test(String(name || ""));
}

/**
 * Sa copë ka 1 pako.
 * Nëse njësia NUK është pako → gjithmonë 1.
 */
function inferPiecesPerPack(name, unit, explicit) {
  const u = normalizeUnit(unit);
  if (u !== "pako") return 1;

  const e = parseEuroNumber(explicit);
  if (e > 0) return Math.max(1, Math.round(e));
  const fromName = piecesFromName(name);
  if (fromName) return fromName;

  const vol = volumeLiters(name);
  if (looksLikeMilk(name)) return 12;
  if (looksLikeWater(name) && vol != null && vol >= 0.45 && vol <= 0.6) return 12;
  return 24;
}

/**
 * Konverton rresht fature → sasi/çmim për stok (copë).
 * copë: quantity mbetet sasia, unit_price mbetet cmimi.
 * pako: pieces = packs × ppp, unit_price = packPrice / ppp.
 */
function convertPackToPieces(line = {}) {
  const name = String(line.name || line.emri || "").trim();
  const unit = normalizeUnit(line.unit || line.njesia || "copë");
  const packs = parseEuroNumber(line.quantity ?? line.sasia ?? line.pack_qty);
  const packPrice = parseEuroNumber(line.unit_price ?? line.price ?? line.cmimi ?? line.pack_price ?? 0);
  if (!(packs > 0)) {
    return { ok: false, reason: "sasi e pavlefshme", name };
  }
  const piecesPerPack = inferPiecesPerPack(
    name,
    unit,
    line.pieces_per_pack ?? line.copa_ne_pako ?? line.copa_per_pako,
  );
  const pieces = Math.round(packs * piecesPerPack * 1000) / 1000;
  const pricePerPiece =
    piecesPerPack > 0 && Number.isFinite(packPrice)
      ? Math.round((packPrice / piecesPerPack) * 10000) / 10000
      : 0;
  const lineTotal = Math.round(packs * (Number.isFinite(packPrice) ? packPrice : 0) * 100) / 100;
  return {
    ok: true,
    name,
    unit,
    packs,
    pieces_per_pack: piecesPerPack,
    quantity: pieces,
    unit_price: pricePerPiece,
    pack_price: Number.isFinite(packPrice) ? packPrice : 0,
    line_total: lineTotal,
  };
}

module.exports = {
  parseEuroNumber,
  normalizeUnit,
  piecesFromName,
  inferPiecesPerPack,
  convertPackToPieces,
};
