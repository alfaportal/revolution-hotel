/**
 * Kontabilisti ATK — libra & deklarata sipas formateve zyrtare (Kosovë).
 * Nuk prek closeTable / cloud-sync / fiskal print.
 * TVSH: residual rounding (si fiscal-vat.js) që net+vat = gross ekzakt.
 */

const {
  applyResidualRounding,
  round2: fiscalRound2,
  VAT_RATES,
  VAT_LETTERS,
} = require("./fiscal/fiscal-vat");

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function csvEsc(val) {
  const s = val == null ? "" : String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvEsc).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEsc(row[h])).join(","));
  }
  return "\uFEFF" + lines.join("\n");
}

/** Shkronja ATK nga norma % (menu: 0/8/18 → A/D/E). */
function letterFromRate(ratePct) {
  const r = Number(ratePct) || 0;
  if (r <= 0) return "A";
  if (r <= 8) return "D";
  return "E";
}

function normalizeLetter(letter, ratePct) {
  const L = String(letter || "").trim().toUpperCase();
  if (VAT_LETTERS.includes(L)) return L;
  return letterFromRate(ratePct);
}

function isMixedVatLabel(label) {
  const vr = String(label || "").trim().toUpperCase();
  if (!vr || vr === "—" || vr === "MIKSE") return vr === "MIKSE";
  if (vr.includes("/")) return true;
  return false;
}

/**
 * Norma % nga etiketa — VETËM kur ka një shkronjë/normë.
 * Për "D/E" / "Mikse" kthehet null → duhen vat_buckets.
 */
function isUnknownVatLabel(label) {
  const vr = String(label || "").trim();
  return !vr || vr === "—" || vr === "-" || vr === "–";
}

function rateFromVatLabel(label) {
  const vr = String(label || "").trim().toUpperCase();
  if (isUnknownVatLabel(label)) return null;
  if (vr === "MIKSE" || vr.includes("/")) return null;
  if (vr === "A" || vr === "B" || vr === "C" || vr === "0%" || vr === "0") return 0;
  if (vr === "D" || vr === "8%" || vr === "8") return 8;
  if (vr === "E" || vr === "18%" || vr === "18") return 18;
  if (vr.startsWith("8")) return 8;
  if (vr.startsWith("18")) return 18;
  const m = vr.match(/^(\d+(?:\.\d+)?)%?$/);
  return m ? Number(m[1]) : 18;
}

function splitGross(gross, ratePct) {
  const g = money(gross);
  const r = Number(ratePct) || 0;
  if (r <= 0) return { net: g, vat: 0, gross: g };
  const net = money(g / (1 + r / 100));
  return { net, vat: money(g - net), gross: g };
}

/**
 * Rrumbullakon bucket-et sipas shkronjave A–E me residual:
 * sum(vat) + sum(net) = targetGross (si kupon fiskal).
 * Ruan shkronjën (A≠C) që secila të shkojë te kutia e vet ATK.
 */
function normalizeVatBuckets(buckets, targetGross) {
  const taxRaw = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const grossRaw = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  let sumGrossExact = 0;

  for (const b of buckets || []) {
    const L = normalizeLetter(b.letter, b.rate);
    const g = Number(b.gross) || 0;
    sumGrossExact += g;
    grossRaw[L] += g;
    const rate = Number(VAT_RATES[L]) || Number(b.rate) || 0;
    const vatExact =
      b.vat != null || b.net != null
        ? Number(b.vat) || Math.max(0, g - (Number(b.net) || 0))
        : rate > 0
          ? (g * rate) / (100 + rate)
          : 0;
    taxRaw[L] += vatExact;
  }

  if (!sumGrossExact && !(Number(targetGross) > 0)) return [];

  const target = money(targetGross != null && targetGross !== "" ? targetGross : sumGrossExact);
  const grossRounded = applyResidualRounding(
    Object.fromEntries(VAT_LETTERS.map((L) => [L, fiscalRound2(grossRaw[L])])),
    target,
  );
  let targetTax = money(
    VAT_LETTERS.reduce((s, L) => {
      const g = grossRounded[L] || 0;
      const r = Number(VAT_RATES[L]) || 0;
      return s + (r > 0 ? (g * r) / (100 + r) : 0);
    }, 0),
  );
  const storedTax = money(VAT_LETTERS.reduce((s, L) => s + (Number(taxRaw[L]) || 0), 0));
  if (storedTax > 0) targetTax = storedTax;

  const taxRounded = applyResidualRounding(
    Object.fromEntries(VAT_LETTERS.map((L) => [L, fiscalRound2(taxRaw[L])])),
    targetTax,
  );

  const out = [];
  for (const L of VAT_LETTERS) {
    const g = money(grossRounded[L] || 0);
    const v = money(taxRounded[L] || 0);
    if (g <= 0 && v <= 0) continue;
    const rate = Number(VAT_RATES[L]) || 0;
    out.push({ letter: L, rate, gross: g, vat: v, net: money(g - v) });
  }
  return out;
}

function itemCatalogId(it) {
  if (it?.menu_item_id != null && it.menu_item_id !== "") return Number(it.menu_item_id);
  if (it?.product_id != null && it.product_id !== "") return Number(it.product_id);
  return null;
}

/** Norma % e rreshtit: shkronja/vat e artikullit → katalogu → 18% (ATK default). */
function resolveItemVatRate(it, rateByMenuId, fallbackPercent) {
  const letter = String(it?.vat_norm || it?.vat_letter || "").trim().toUpperCase();
  if (VAT_LETTERS.includes(letter)) return Number(VAT_RATES[letter]) || 0;
  const raw = it?.vat_rate ?? it?.vat_percent ?? it?.vat_category;
  if (raw != null && raw !== "") {
    const labeled = rateFromVatLabel(raw);
    if (labeled != null) return labeled;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const id = itemCatalogId(it);
  if (id != null && rateByMenuId && rateByMenuId.has(id)) {
    return Number(rateByMenuId.get(id));
  }
  return Number(fallbackPercent) || 18;
}

/** vat_norm/vat_letter nga menu (0/8/18 → A/D/E) kur mungon në artikull. */
function enrichItemsWithVatNorm(items, rateByMenuId, fallbackPercent) {
  const fb = Number(fallbackPercent) || 18;
  return (items || []).map((it) => {
    const copy = { ...it };
    const raw = String(copy.vat_norm ?? copy.vat_letter ?? "")
      .trim()
      .toUpperCase();
    if (VAT_LETTERS.includes(raw)) {
      copy.vat_norm = raw;
      copy.vat_letter = raw;
      return copy;
    }
    const menuItemId =
      copy.menu_item_id != null ? Number(copy.menu_item_id) : null;
    const rate =
      menuItemId != null && rateByMenuId && rateByMenuId.has(menuItemId)
        ? Number(rateByMenuId.get(menuItemId))
        : fb;
    const letter = letterFromRate(rate);
    copy.vat_norm = letter;
    copy.vat_letter = letter;
    return copy;
  });
}

/**
 * Bucket-e TVSH për një shitje — i njëjti matematikë si kupon fiskal.
 * targetTotal = shuma e paguar (daily_log.total); residual → net+vat=gross.
 */
function buildSaleVatBuckets(preparedItems, opts = {}) {
  const list = Array.isArray(preparedItems) ? preparedItems : [];
  const rateByMenuId = opts.rateByMenuId || new Map();
  const fallbackPercent = Number(opts.fallbackPercent) || 18;
  const sumLines = money(
    list.reduce(
      (s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 1),
      0,
    ),
  );
  const target =
    opts.targetTotal != null && opts.targetTotal !== ""
      ? money(opts.targetTotal)
      : sumLines;
  if (!list.length && !(target > 0)) return [];

  let fiscalOn = false;
  try {
    const { isFiscalEnabled } = require("./fiscal/fiscal-config");
    fiscalOn = !!isFiscalEnabled();
  } catch {
    fiscalOn = false;
  }

  if (fiscalOn) {
    const enriched = enrichItemsWithVatNorm(list, rateByMenuId, fallbackPercent);
    const {
      calculateVatBreakdown,
      calculateVatTaxBreakdown,
      VAT_RATES,
      round2,
    } = require("./fiscal/fiscal-vat");
    const grossByLetter = calculateVatBreakdown(enriched);
    const taxResult = calculateVatTaxBreakdown(enriched, { totalAmount: target });
    if (grossByLetter && taxResult?.tax) {
      const buckets = [];
      for (const L of VAT_LETTERS) {
        const g = Number(grossByLetter[L]) || 0;
        const v = Number(taxResult.tax[L]) || 0;
        if (g <= 0 && v <= 0) continue;
        buckets.push({
          letter: L,
          rate: Number(VAT_RATES[L]) || 0,
          gross: round2(g),
          vat: round2(v),
          net: round2(g - v),
        });
      }
      return normalizeVatBuckets(buckets, target);
    }
  }

  const byRate = new Map();
  for (const it of list) {
    const rate = resolveItemVatRate(it, rateByMenuId, fallbackPercent);
    const qty = Number(it?.quantity ?? it?.qty) || 1;
    const unit = Number(it?.price ?? it?.unit_price) || 0;
    const gross = unit * qty;
    const net = rate > 0 ? gross / (1 + rate / 100) : gross;
    const vat = gross - net;
    if (!byRate.has(rate)) byRate.set(rate, { rate, gross: 0, net: 0, vat: 0 });
    const bucket = byRate.get(rate);
    bucket.gross += gross;
    bucket.net += net;
    bucket.vat += vat;
  }
  const withLetters = [...byRate.values()].map((b) => ({
    ...b,
    letter: letterFromRate(b.rate),
  }));
  return normalizeVatBuckets(withLetters, target);
}

/**
 * Mapimi ATK (Libri i Shitjes / Deklarata):
 * A → [9]  liruar pa kreditim
 * B → [9]  (rezervuar, 0% — si A)
 * C → [10c] liruar tjeter me kreditim
 * D → [14] bazë 8% + [K2] TVSH
 * E → [12] bazë 18% + [K1] TVSH
 */
function mapLetterToSalesBoxes(letter, net, vat, acc) {
  const L = normalizeLetter(letter);
  const n = money(net);
  const v = money(vat);
  if (L === "A" || L === "B") acc.box9 = money(acc.box9 + n);
  else if (L === "C") acc.box10c = money(acc.box10c + n);
  else if (L === "D") {
    acc.box14 = money(acc.box14 + n);
    acc.boxK2 = money(acc.boxK2 + v);
  } else {
    // E (default tatueshëm 18%)
    acc.box12 = money(acc.box12 + n);
    acc.boxK1 = money(acc.boxK1 + v);
  }
}

/** Libri i Shitjes TVSH — një rresht për faturë (B2C: blerësi bosh). */
function buildSalesVatBook(salesRows) {
  const rows = [];
  let nr = 0;
  for (const s of salesRows || []) {
    nr += 1;
    let rawBuckets = Array.isArray(s.vat_buckets) && s.vat_buckets.length
      ? s.vat_buckets
      : null;
    if (!rawBuckets) {
      const rate = rateFromVatLabel(s.vat_rate);
      // Mikse / D/E pa bucket → mos e hidh krejt te një normë (gabim ATK)
      if (rate == null) {
        if (isUnknownVatLabel(s.vat_rate)) {
          const split = splitGross(s.total, 18);
          rawBuckets = [{ letter: "E", rate: 18, ...split }];
        } else {
          rawBuckets = [];
        }
      } else {
        const split = splitGross(s.total, rate);
        const letter = normalizeLetter(
          typeof s.vat_rate === "string" && /^[A-E]$/i.test(String(s.vat_rate).trim())
            ? s.vat_rate
            : null,
          rate,
        );
        rawBuckets = [{ letter, rate, ...split }];
      }
    }
    const buckets = normalizeVatBuckets(rawBuckets, s.total);

    const acc = {
      box9: 0,
      box10a: 0,
      box10b: 0,
      box10c: 0,
      box11: 0,
      box12: 0,
      box14: 0,
      boxK1: 0,
      boxK2: 0,
    };
    for (const b of buckets) {
      mapLetterToSalesBoxes(b.letter || letterFromRate(b.rate), b.net, b.vat, acc);
    }
    const box10 = money(acc.box10a + acc.box10b + acc.box10c);
    const box30 = money(acc.boxK1 + acc.boxK2);

    rows.push({
      nr,
      date: s.date || "",
      invoice_number: s.receipt_number || "",
      buyer_name: s.buyer_name || "",
      buyer_fiscal: s.buyer_fiscal || "",
      buyer_vat: s.buyer_vat || "",
      box9: acc.box9,
      box10a: acc.box10a,
      box10b: acc.box10b,
      box10c: acc.box10c,
      box10,
      box11: acc.box11,
      box12: acc.box12,
      box16: 0,
      box20: 0,
      box24: 0,
      box28: 0,
      boxK1: acc.boxK1,
      box14: acc.box14,
      box18: 0,
      box22: 0,
      box26: 0,
      boxK2: acc.boxK2,
      box30,
      gross: money(s.total),
      payment_method: s.payment_method || "",
    });
  }
  return rows;
}

function sumSalesVatBoxes(bookRows) {
  const keys = [
    "box9", "box10a", "box10b", "box10c", "box10", "box11", "box12", "box16", "box20", "box24", "box28",
    "boxK1", "box14", "box18", "box22", "box26", "boxK2", "box30",
  ];
  const tot = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of bookRows || []) {
    for (const k of keys) tot[k] = money(tot[k] + (Number(r[k]) || 0));
  }
  tot.box10 = money(tot.box10a + tot.box10b + tot.box10c);
  tot.box30 = money(tot.boxK1 + tot.boxK2);
  return tot;
}

function exportSalesVatBookCsv(bookRows) {
  const headers = [
    "nr", "date", "invoice_number", "buyer_name", "buyer_fiscal", "buyer_vat",
    "box9", "box10a", "box10b", "box10c", "box10", "box11",
    "box12", "box16", "box20", "box24", "box28", "boxK1",
    "box14", "box18", "box22", "box26", "boxK2", "box30",
  ];
  return toCsv(headers, bookRows);
}

/** Libri i Shitjes Kuartale */
function buildSalesQuarterlyBook(salesRows) {
  return (salesRows || []).map((s, i) => {
    const gross = money(s.total);
    return {
      nr: i + 1,
      date: s.date || "",
      invoice_number: s.receipt_number || "",
      buyer_name: s.buyer_name || "",
      buyer_nui: s.buyer_fiscal || "",
      col_a: gross,
      col_b: 0,
      col_c: 0,
      col_d: gross,
    };
  });
}

function exportSalesQuarterlyCsv(rows) {
  return toCsv(
    ["nr", "date", "invoice_number", "buyer_name", "buyer_nui", "col_a", "col_b", "col_c", "col_d"],
    rows,
  );
}

/**
 * Libri i Blerjes TVSH — një rresht për faturë blerjeje / shpenzim.
 * kind: goods | expense | invest
 * Faturat me norma të përziera: splitGross për çdo rresht (inv.items).
 */
function addPurchaseVatSplitToRow(row, gross, rate, isInvest) {
  const split = splitGross(gross, rate);
  const r = Number(rate) >= 0 ? Number(rate) : 18;
  if (r <= 0) {
    if (isInvest) row.box32 = money((row.box32 || 0) + split.net);
    else row.box31 = money((row.box31 || 0) + split.net);
  } else if (r <= 8) {
    if (isInvest) {
      row.box49 = money((row.box49 || 0) + split.net);
      row.boxK2 = money((row.boxK2 || 0) + split.vat);
    } else {
      row.box45 = money((row.box45 || 0) + split.net);
      row.boxK2 = money((row.boxK2 || 0) + split.vat);
    }
  } else if (isInvest) {
    row.box47 = money((row.box47 || 0) + split.net);
    row.boxK1 = money((row.boxK1 || 0) + split.vat);
  } else {
    row.box43 = money((row.box43 || 0) + split.net);
    row.boxK1 = money((row.boxK1 || 0) + split.vat);
  }
}

function purchaseVatSplitsForInvoice(inv) {
  const items = Array.isArray(inv.items) ? inv.items : [];
  if (items.length) {
    return items.map((it) => ({
      gross: Number(it.line_total) || 0,
      rate: Number(it.vat_rate) >= 0 ? Number(it.vat_rate) : 18,
    }));
  }
  const hdr = Number(inv.vat_rate);
  if (hdr === -1) {
    return [{ gross: Number(inv.total) || 0, rate: 18 }];
  }
  return [{ gross: Number(inv.total) || 0, rate: hdr >= 0 ? hdr : 18 }];
}

/** Shuma neto e faturës blerje (pa TVSH hyrëse) — për bilancin e kontabilistit. */
function purchaseInvoiceNetTotal(inv) {
  let net = 0;
  for (const { gross, rate } of purchaseVatSplitsForInvoice(inv)) {
    if (!(gross > 0)) continue;
    net += splitGross(gross, rate).net;
  }
  return money(net);
}

/** Shuma neto e rreshtit të shitjes (pa TVSH dalëse) — nga vat_buckets ose total−vat. */
function saleLedgerNetTotal(row) {
  const buckets = Array.isArray(row?.vat_buckets) ? row.vat_buckets : [];
  if (buckets.length) {
    return money(buckets.reduce((s, b) => s + (Number(b.net) || 0), 0));
  }
  const gross = Number(row?.total) || 0;
  const vat = Number(row?.vat_amount) || 0;
  return money(vat > 0 ? gross - vat : gross);
}

function buildPurchaseVatBook(invoices, expenses) {
  const rows = [];
  let nr = 0;

  for (const inv of invoices || []) {
    nr += 1;
    const isInvest = String(inv.purchase_kind || "") === "invest";
    const row = emptyPurchaseVatRow(nr, {
      date: inv.invoice_date || inv.date || "",
      invoice_number: inv.invoice_number || "",
      seller_name: inv.supplier || "",
      seller_fiscal: inv.supplier_nui || "",
      seller_vat: inv.supplier_vat || "",
    });
    for (const { gross, rate } of purchaseVatSplitsForInvoice(inv)) {
      if (!(gross > 0)) continue;
      addPurchaseVatSplitToRow(row, gross, rate, isInvest);
    }
    row.box67 = money(row.boxK1 + row.boxK2);
    rows.push(row);
  }

  for (const e of expenses || []) {
    nr += 1;
    const rate = Number(e.vat_rate) >= 0 ? Number(e.vat_rate) : 18;
    const split = splitGross(e.amount, rate);
    const row = emptyPurchaseVatRow(nr, {
      date: e.expense_date || "",
      invoice_number: "",
      seller_name: e.vendor_name || "",
      seller_fiscal: e.vendor_nui || "",
      seller_vat: "",
    });
    if (rate <= 0) {
      row.box31 = split.net;
    } else if (rate <= 8) {
      row.box45 = split.net;
      row.boxK2 = split.vat;
    } else {
      row.box43 = split.net;
      row.boxK1 = split.vat;
    }
    row.box67 = money((row.boxK1 || 0) + (row.boxK2 || 0));
    row._source = "expense";
    row._expense_id = e.id;
    rows.push(row);
  }

  return rows;
}

function emptyPurchaseVatRow(nr, meta) {
  return {
    nr,
    date: meta.date || "",
    invoice_number: meta.invoice_number || "",
    seller_name: meta.seller_name || "",
    seller_fiscal: meta.seller_fiscal || "",
    seller_vat: meta.seller_vat || "",
    box31: 0,
    box32: 0,
    box33: 0,
    box34: 0,
    box35: 0,
    box39: 0,
    box43: 0,
    box47: 0,
    box53: 0,
    box57: 0,
    box61: 0,
    box65: 0,
    boxK1: 0,
    box37: 0,
    box41: 0,
    box45: 0,
    box49: 0,
    box51: 0,
    box55: 0,
    box59: 0,
    box63: 0,
    boxK2: 0,
    box67: 0,
  };
}

function sumPurchaseVatBoxes(bookRows) {
  const keys = [
    "box31", "box32", "box33", "box34", "box35", "box39", "box43", "box47", "box53", "box57", "box61", "box65", "boxK1",
    "box37", "box41", "box45", "box49", "box51", "box55", "box59", "box63", "boxK2", "box67",
  ];
  const tot = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of bookRows || []) {
    for (const k of keys) tot[k] = money(tot[k] + (Number(r[k]) || 0));
  }
  tot.box67 = money(tot.boxK1 + tot.boxK2);
  return tot;
}

function exportPurchaseVatBookCsv(bookRows) {
  const headers = [
    "nr", "date", "invoice_number", "seller_name", "seller_fiscal", "seller_vat",
    "box31", "box32", "box33", "box34", "box35", "box39", "box43", "box47", "box53", "box57", "box61", "box65", "boxK1",
    "box37", "box41", "box45", "box49", "box51", "box55", "box59", "box63", "boxK2", "box67",
  ];
  return toCsv(headers, bookRows);
}

/** Libri i Blerjes Kuartale */
function buildPurchaseQuarterlyBook(invoices, expenses) {
  const rows = [];
  let nr = 0;
  for (const inv of invoices || []) {
    nr += 1;
    const total = money(inv.total);
    const kind = String(inv.purchase_kind || "goods");
    const row = {
      nr,
      date: inv.invoice_date || inv.date || "",
      invoice_number: inv.invoice_number || "",
      seller_name: inv.supplier || "",
      seller_nui: inv.supplier_nui || "",
      col_a: kind === "goods" || !kind ? total : 0,
      col_b: kind === "expense" ? total : 0,
      col_c: kind === "invest" ? total : 0,
      col_d: 0,
      col_e: 0,
      col_f: 0,
      col_g: total,
    };
    if (!kind || kind === "goods") row.col_a = total;
    rows.push(row);
  }
  for (const e of expenses || []) {
    nr += 1;
    const total = money(e.amount);
    rows.push({
      nr,
      date: e.expense_date || "",
      invoice_number: "",
      seller_name: e.vendor_name || "",
      seller_nui: e.vendor_nui || "",
      col_a: 0,
      col_b: total,
      col_c: 0,
      col_d: 0,
      col_e: 0,
      col_f: 0,
      col_g: total,
    });
  }
  return rows;
}

function exportPurchaseQuarterlyCsv(rows) {
  return toCsv(
    ["nr", "date", "invoice_number", "seller_name", "seller_nui", "col_a", "col_b", "col_c", "col_d", "col_e", "col_f", "col_g"],
    rows,
  );
}

/** Deklarata e TVSH-së — kutizat kryesore nga librat (+ kutiza bosh për plotësi ATK) */
function buildVatDeclaration(salesBoxes, purchaseBoxes) {
  const s = salesBoxes || {};
  const p = purchaseBoxes || {};
  const boxes = {
    "[9] Shitjet e liruara pa të drejtë kreditimi": s.box9 || 0,
    "[10a] Shitjet e shërbimeve jashtë vendit": s.box10a || 0,
    "[10b] Shitjet me ngarkesë të kundërt": s.box10b || 0,
    "[10c] Shitjet tjera të liruara me kreditim": s.box10c || 0,
    "[10] Totali i shitjeve të liruara me kreditim": s.box10 || 0,
    "[11] Eksportet": s.box11 || 0,
    "[12] Shitjet e tatueshme 18%": s.box12 || 0,
    "[14] Shitjet e tatueshme 8%": s.box14 || 0,
    "[16] Nota debitore / kreditore 18%": s.box16 || 0,
    "[18] Nota debitore / kreditore 8%": s.box18 || 0,
    "[20] Fatura e borxhit të keq 18%": s.box20 || 0,
    "[22] Fatura e borxhit të keq 8%": s.box22 || 0,
    "[24] Rregullimet për të rritur TVSH 18%": s.box24 || 0,
    "[26] Rregullimet / ngarkesa e kundërt 8%": s.box26 || 0,
    "[28] Blerjet me ngarkesë të kundërt": s.box28 || 0,
    "[K1] TVSH e llogaritur 18%": s.boxK1 || 0,
    "[K2] TVSH e llogaritur 8%": s.boxK2 || 0,
    "[30] Total TVSH e llogaritur": s.box30 || 0,
    "[31] Blerjet/importet pa TVSH": p.box31 || 0,
    "[32] Blerjet/importet investive pa TVSH": p.box32 || 0,
    "[33] Blerjet me TVSH jo të zbritshme": p.box33 || 0,
    "[34] Blerjet investive me TVSH jo të zbritshme": p.box34 || 0,
    "[35] Importet 18%": p.box35 || 0,
    "[37] Importet 8%": p.box37 || 0,
    "[39] Importet investive 18%": p.box39 || 0,
    "[41] Importet investive 8%": p.box41 || 0,
    "[43] Blerjet vendore 18%": p.box43 || 0,
    "[45] Blerjet vendore 8%": p.box45 || 0,
    "[47] Blerjet investive vendore 18%": p.box47 || 0,
    "[49] Blerjet investive vendore 8%": p.box49 || 0,
    "[51] Blerjet nga fermerët 8%": p.box51 || 0,
    "[53] Nota debitore/kreditore blerje 18%": p.box53 || 0,
    "[55] Nota debitore/kreditore blerje 8%": p.box55 || 0,
    "[57] Fatura e borxhit të keq e lëshuar 18%": p.box57 || 0,
    "[59] Fatura e borxhit të keq e lëshuar 8%": p.box59 || 0,
    "[61] Rregullimet për të ulur TVSH 18%": p.box61 || 0,
    "[63] Rregullimet / ngarkesa e kundërt 8%": p.box63 || 0,
    "[65] E drejta e kreditimit (ngarkesa e kundërt)": p.box65 || 0,
    "[K1] TVSH e zbritshme 18%": p.boxK1 || 0,
    "[K2] TVSH e zbritshme 8%": p.boxK2 || 0,
    "[67] Total TVSH e zbritshme": p.box67 || 0,
  };
  const vatOut = money(s.box30 || 0);
  const vatIn = money(p.box67 || 0);
  boxes["TVSH për pagesë / (kthim)"] = money(vatOut - vatIn);
  return {
    boxes,
    rows: Object.entries(boxes).map(([code, amount]) => ({ code, amount: money(amount) })),
    vat_calculated: vatOut,
    vat_deductible: vatIn,
    vat_payable: money(vatOut - vatIn),
  };
}

/** Lista e pagave — rreshta + formula ATK */
function computePayrollRow(input) {
  const gross = money(input.gross_salary);
  const empPension = money(input.employee_pension != null ? input.employee_pension : gross * 0.05);
  const erPension = money(input.employer_pension != null ? input.employer_pension : gross * 0.05);
  const empSup = money(input.employee_supplement || 0);
  const erSup = money(input.employer_supplement || 0);
  return {
    ...input,
    gross_salary: gross,
    employee_pension: empPension,
    employer_pension: erPension,
    employee_supplement: empSup,
    employer_supplement: erSup,
    primary_job: input.primary_job === false || input.primary_job === 0 ? 0 : 1,
    include_contributions: input.include_contributions === false || input.include_contributions === 0 ? 0 : 1,
    apply_wage_tax: input.apply_wage_tax === false || input.apply_wage_tax === 0 ? 0 : 1,
  };
}

function buildWithholdingTaxFromPayroll(payrollRows) {
  const list = payrollRows || [];
  const gross = money(list.reduce((s, r) => s + (Number(r.gross_salary) || 0), 0));
  const empPen = money(list.reduce((s, r) => s + (Number(r.employee_pension) || 0), 0));
  const erPen = money(list.reduce((s, r) => s + (Number(r.employer_pension) || 0), 0));
  const taxed = list.filter((r) => Number(r.apply_wage_tax) !== 0);
  // Kosovë PIT (mujor, Ligji 05/L-028): 0≤80, 4% 80–250, 8% 250–450, 10% >450
  let wageTax = 0;
  const bands = { up_to_250: 0, from_250_450: 0, over_450: 0 };
  for (const r of taxed) {
    const g = Number(r.gross_salary) || 0;
    if (g <= 250) bands.up_to_250 += 1;
    else if (g <= 450) bands.from_250_450 += 1;
    else bands.over_450 += 1;
    wageTax += approxWageTax(g);
  }
  return {
    box8: gross,
    box9: money(wageTax),
    box10: list.length,
    box11: bands.up_to_250,
    box12: bands.from_250_450,
    box13: bands.over_450,
    box16: list.length,
    box17: gross,
    box18: empPen,
    box19: erPen,
    box20: money(empPen + erPen),
    box22: money(list.reduce((s, r) => s + (Number(r.employee_supplement) || 0), 0)),
    box23: money(list.reduce((s, r) => s + (Number(r.employer_supplement) || 0), 0)),
  };
}

/** Tatimi në paga (mujor) — shkallët zyrtare ATK / Ligji 05/L-028. */
function approxWageTax(gross) {
  const g = Number(gross) || 0;
  if (g <= 80) return 0;
  if (g <= 250) return money((g - 80) * 0.04);
  if (g <= 450) return money(6.8 + (g - 250) * 0.08); // 170×4% = 6.80
  return money(22.8 + (g - 450) * 0.1); // 6.80 + 200×8% = 22.80
}

/** Lista e qerase — TMB 9% mbi qira, 10% mbi interes/të drejta/lotari */
function computeRentRow(input) {
  const interest = money(input.interest || 0);
  const royalties = money(input.royalties || 0);
  const lottery = money(input.lottery || 0);
  const rent = money(input.rent_gross || 0);
  const nrEnt = money(input.non_resident_entertainment || 0);
  const nrSvc = money(input.non_resident_services || 0);
  const tmbOther = money((interest + royalties + lottery) * 0.1);
  const tmbRent = money(rent * 0.09);
  const tmbNr = money((nrEnt + nrSvc) * 0.05);
  return {
    ...input,
    interest,
    royalties,
    lottery,
    rent_gross: rent,
    non_resident_entertainment: nrEnt,
    non_resident_services: nrSvc,
    tmb_other: tmbOther,
    tmb_rent: tmbRent,
    tmb_non_resident: tmbNr,
    tmb_total: money(tmbOther + tmbRent + tmbNr),
    special_payments: money(input.special_payments || 0),
    area_m2: Number(input.area_m2) || 0,
    monthly_rent: money(input.monthly_rent || rent),
    country: String(input.country || "Kosovë").trim(),
  };
}

function buildRentWithholdingForm(rentRows) {
  const list = rentRows || [];
  const sum = (k) => money(list.reduce((s, r) => s + (Number(r[k]) || 0), 0));
  return {
    box8: sum("interest"),
    box9: sum("royalties"),
    box10: sum("lottery"),
    box12: sum("tmb_other"),
    box13: sum("rent_gross"),
    box14: sum("tmb_rent"),
    box15: sum("non_resident_entertainment"),
    box16: sum("non_resident_services"),
    box17: sum("tmb_non_resident"),
    box18: money(sum("tmb_other") + sum("tmb_rent") + sum("tmb_non_resident")),
  };
}

/** Formulari tremujor — opsioni A nga të dhënat e periudhës */
function buildQuarterlyInstallment({ income, expenses, priorYearTax = 0 }) {
  const rev = money(income);
  const exp = money(expenses);
  const profit = money(Math.max(0, rev - exp));
  const box11 = money(profit * 0.1);
  const box12 = money((Number(priorYearTax) || 0) * 1.1 / 4);
  const box13 = money(Math.max(box11, box12));
  return {
    box8: rev,
    box9: exp,
    box10: profit,
    box11,
    box12,
    box13,
    box14: 0,
    box15: box13,
  };
}

/** Pasqyra vjetore / CD — të gjitha fletët + kutizat CD */
function buildAnnualStatements({
  year,
  bizName,
  nui,
  address,
  sales,
  purchases,
  expenses,
  stockStart = 0,
  stockEnd = 0,
  wages = 0,
  priorYear = null,
  cogs: cogsOverride = null,
}) {
  const y = Number(year) || new Date().getFullYear();
  const prev = priorYear || {};
  const revenue = money(sales);
  const purch = money(purchases);
  const stStart = money(stockStart);
  const stEnd = money(stockEnd);
  const cogs = cogsOverride != null
    ? money(cogsOverride)
    : money(stStart + purch - stEnd);
  const grossProfit = money(revenue - cogs);
  const adminExp = money(expenses);
  const wageTotal = money(wages);
  const operating = money(grossProfit - adminExp - wageTotal);
  const profitBeforeTax = operating;
  const tax = money(Math.max(0, profitBeforeTax) * 0.1);
  const netProfit = money(profitBeforeTax - tax);

  const prevNet = money(prev.netProfit);
  const prevTax = money(prev.tax != null ? prev.tax : Math.max(0, money(prev.profitBeforeTax)) * 0.1);
  const prevStock = money(prev.stockEnd != null ? prev.stockEnd : stStart);
  const prevCashRaw = money(prev.cash != null ? prev.cash : prevNet);
  const retainedStart = prevNet;
  const retainedEnd = money(retainedStart + netProfit);

  // Bilanci i ekuilibruar: stok + para = ekuitet + tatim i pagueshëm
  const taxPayable = tax;
  const equity = retainedEnd;
  const cash = money(equity + taxPayable - stEnd);
  const prevCash = money(prevCashRaw);
  const cashDelta = money(cash - prevCash);
  const stockDelta = money(stEnd - prevStock);

  return {
    year: y,
    header: { bizName: bizName || "", nui: nui || "", address: address || "" },
    totals: {
      revenue,
      purchases: purch,
      cogs,
      grossProfit,
      expenses: adminExp,
      wages: wageTotal,
      operating,
      profitBeforeTax,
      tax,
      netProfit,
      stockStart: stStart,
      stockEnd: stEnd,
      cash,
      prevCash,
    },
    income_statement: [
      { label: "Të hyrat", note: "5", current: revenue, prior: money(prev.sales) },
      { label: "Kostoja e shitjes", note: "6", current: cogs, prior: money(prev.cogs) },
      { label: "Fitimi / (humbja) bruto", note: "", current: grossProfit, prior: money(prev.grossProfit) },
      { label: "Të ardhurat tjera", note: "5.1", current: 0, prior: 0 },
      { label: "Shpenzimet administrative", note: "7", current: adminExp, prior: money(prev.expenses) },
      { label: "Shpenzimet e shpërndarjes", note: "8", current: 0, prior: 0 },
      { label: "Shpenzimet e tjera", note: "", current: wageTotal, prior: money(prev.wages) },
      { label: "Fitimi / (humbja) operativ", note: "", current: operating, prior: money(prev.operating) },
      { label: "Shpenzimet financiare", note: "9", current: 0, prior: 0 },
      { label: "Të ardhurat financiare", note: "5", current: 0, prior: 0 },
      { label: "Fitimi / (humbja) para tatimit", note: "", current: profitBeforeTax, prior: money(prev.profitBeforeTax) },
      { label: "Shpenzimet e tatimit në fitim", note: "10", current: tax, prior: prevTax },
      { label: "Fitimi / (humbja) i/e vitit", note: "", current: netProfit, prior: prevNet },
      { label: "Fitimet (Humbjet) e mbajtura në fillim të vitit", note: "18", current: retainedStart, prior: 0 },
      { label: "Dividenda", note: "18", current: 0, prior: 0 },
      { label: "Fitimet e mbajtura në fund të vitit", note: "", current: retainedEnd, prior: retainedStart },
    ],
    balance_sheet: {
      cash,
      stock: stEnd,
      currentAssets: money(cash + stEnd),
      totalAssets: money(cash + stEnd),
      taxPayable,
      currentLiabilities: taxPayable,
      totalLiabilities: taxPayable,
      shareCapital: 0,
      retained: retainedEnd,
      totalEquity: retainedEnd,
      equityAndLiabilities: money(retainedEnd + taxPayable),
      prior: {
        cash: prevCash,
        stock: prevStock,
        currentAssets: money(prevCash + prevStock),
        totalAssets: money(prevCash + prevStock),
        taxPayable: prevTax,
        retained: retainedStart,
        totalEquity: retainedStart,
        equityAndLiabilities: money(retainedStart + prevTax),
      },
    },
    cash_flow: {
      netProfit,
      tax,
      stockChange: money(-stockDelta), // rritje stoku = përdorim parash (-)
      operatingNet: money(netProfit + tax - stockDelta),
      cashStart: prevCash,
      cashEnd: cash,
      cashNetChange: cashDelta,
      priorNetProfit: prevNet,
    },
    cd_boxes: {
      "[1] Periudha": String(y),
      "[2] NRF / NUI": String(nui || ""),
      "[4] Emri i biznesit": String(bizName || ""),
      "[5] Adresa": String(address || ""),
      "[10] Të ardhurat neto (DF)": netProfit,
      "[11] Të ardhura me burim të huaj": 0,
      "[12] Arkëtimi i borxheve të këqija": 0,
      "[13] Fitimet kapitale": 0,
      "[14] Dividentet": 0,
      "[15] Të ardhura/fitime të tjera": 0,
      "[16] Rregullimi total në të ardhura": 0,
      "[17] Fitimi pas rregullimit": netProfit,
      "[18] Shpenzimet e pazbritshme": 0,
      "[60] Të ardhurat bruto operative": revenue,
      "[61] Stoku në fillim": stStart,
      "[62] Blerjet apo kostoja e prodhimit": purch,
      "[63] Totali ([61]+[62])": money(stStart + purch),
      "[64] Stoku në fund": stEnd,
      "[65] Kostoja e mallrave të shitura": cogs,
      "[66] Bruto fitimi": grossProfit,
      "[67] Pagat bruto": wageTotal,
      "[78] Të ardhurat neto (→ kutia 10)": netProfit,
    },
    cash: cash,
  };
}

module.exports = {
  money,
  rateFromVatLabel,
  isUnknownVatLabel,
  resolveItemVatRate,
  isMixedVatLabel,
  letterFromRate,
  normalizeLetter,
  splitGross,
  purchaseInvoiceNetTotal,
  saleLedgerNetTotal,
  normalizeVatBuckets,
  enrichItemsWithVatNorm,
  buildSaleVatBuckets,
  mapLetterToSalesBoxes,
  buildSalesVatBook,
  sumSalesVatBoxes,
  exportSalesVatBookCsv,
  buildSalesQuarterlyBook,
  exportSalesQuarterlyCsv,
  buildPurchaseVatBook,
  sumPurchaseVatBoxes,
  exportPurchaseVatBookCsv,
  buildPurchaseQuarterlyBook,
  exportPurchaseQuarterlyCsv,
  buildVatDeclaration,
  computePayrollRow,
  buildWithholdingTaxFromPayroll,
  computeRentRow,
  buildRentWithholdingForm,
  buildQuarterlyInstallment,
  buildAnnualStatements,
  approxWageTax,
};
