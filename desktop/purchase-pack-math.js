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

function normalizeLineVatRate(line) {
  const n = Number(line?.vat_rate ?? line?.vat);
  if (n === 0 || n === 8 || n === 18) return n;
  if (!Number.isFinite(n) || n < 0) return 18;
  if (n <= 8) return 8;
  return 18;
}

/** Çmim neto → bruto (me TVSH) për regjistrim stoku / createPurchaseInvoice. */
function netUnitToGross(net, vatPct) {
  const n = Number(net);
  if (!(n >= 0) || !Number.isFinite(n)) return 0;
  const v = normalizeLineVatRate({ vat_rate: vatPct });
  if (v <= 0) return Math.round(n * 10000) / 10000;
  return Math.round(n * (1 + v / 100) * 10000) / 10000;
}

/** Shumë rreshti neto → bruto (e njëjta formulë si për njësi). */
function netLineToGross(netLine, vatPct) {
  return netUnitToGross(netLine, vatPct);
}

/**
 * Konverton rresht fature → sasi/çmim për stok (copë).
 * Hyrja unit_price / pack_price nga skanimi = zakonisht PA TVSH (neto).
 * Dalja unit_price / line_total = ME TVSH (bruto) — si createPurchaseInvoice pret.
 * copë: quantity mbetet sasia; pako: pieces = packs × ppp.
 */
function convertPackToPieces(line = {}) {
  const name = String(line.name || line.emri || "").trim();
  const unit = normalizeUnit(line.unit || line.njesia || "copë");
  const packs = parseEuroNumber(line.quantity ?? line.sasia ?? line.pack_qty);
  const packPriceNet = parseEuroNumber(line.unit_price ?? line.price ?? line.cmimi ?? line.pack_price ?? 0);
  if (!(packs > 0)) {
    return { ok: false, reason: "sasi e pavlefshme", name };
  }
  const vatRate = normalizeLineVatRate(line);
  const piecesPerPack = inferPiecesPerPack(
    name,
    unit,
    line.pieces_per_pack ?? line.copa_ne_pako ?? line.copa_per_pako,
  );
  const pieces = Math.round(packs * piecesPerPack * 1000) / 1000;
  const packPriceGross = netUnitToGross(
    Number.isFinite(packPriceNet) ? packPriceNet : 0,
    vatRate,
  );
  let pricePerPieceGross =
    piecesPerPack > 0 && packPriceGross > 0
      ? Math.round((packPriceGross / piecesPerPack) * 10000) / 10000
      : 0;
  const lineTotalNet = Math.round(packs * (Number.isFinite(packPriceNet) ? packPriceNet : 0) * 100) / 100;
  let lineTotalGross = Math.round(packs * packPriceGross * 100) / 100;

  const explicitFromGrossFields = parseEuroNumber(line.line_total ?? line.vlera_me_tvsh);
  const explicitFromNetFields = parseEuroNumber(
    line.line_net ?? line.shuma_pa_tvsh ?? line.vlera_pa_tvsh,
  );
  const explicitAmbiguous = parseEuroNumber(line.vlera ?? line.total);

  const applyExplicitLineTotal = (amount, treatAsNet) => {
    if (!(amount > 0) || !(pieces > 0)) return false;
    const tol = Math.max(0.06, amount * 0.02);
    const expectedNet = lineTotalNet;
    const expectedGross = lineTotalGross;
    if (treatAsNet) {
      if (Math.abs(amount - expectedNet) > tol) return false;
      lineTotalGross = Math.round(netLineToGross(amount, vatRate) * 100) / 100;
    } else {
      if (Math.abs(amount - expectedGross) > tol) return false;
      lineTotalGross = Math.round(amount * 100) / 100;
    }
    pricePerPieceGross = Math.round((lineTotalGross / pieces) * 10000) / 10000;
    return true;
  };

  if (
    !applyExplicitLineTotal(explicitFromGrossFields, false) &&
    !applyExplicitLineTotal(explicitFromNetFields, true)
  ) {
    if (!applyExplicitLineTotal(explicitAmbiguous, false)) {
      applyExplicitLineTotal(explicitAmbiguous, true);
    }
  }

  return {
    ok: true,
    name,
    unit,
    packs,
    pieces_per_pack: piecesPerPack,
    quantity: pieces,
    unit_price: pricePerPieceGross,
    pack_price: Number.isFinite(packPriceNet) ? packPriceNet : 0,
    pack_price_gross: packPriceGross,
    line_net: lineTotalNet,
    line_total: lineTotalGross,
    vat_rate: vatRate,
  };
}

module.exports = {
  parseEuroNumber,
  normalizeUnit,
  piecesFromName,
  inferPiecesPerPack,
  normalizeLineVatRate,
  netUnitToGross,
  netLineToGross,
  convertPackToPieces,
};
