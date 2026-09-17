/**
 * AI skanim faturash — foto → Claude Vision (cloud) → regjistrim stoku lokal.
 * Matching: emër i saktë + sinonime (Ice/Iced Tea).
 * Ujë: çdo «mineral» → Ujë mineral; «natyral/natural» (pa fruta) → Ujë natyral.
 * Sasia: pako → copë me matematikë (purchase-pack-math).
 */
const aiCloud = require("../ai-cloud");
const packMath = require("../purchase-pack-math");

function normalizeReceiptVatCategory(v) {
  const n = Number(v);
  if (n === 0 || n === 8 || n === 18) return String(n);
  return "18";
}

/** Fjalë të përgjithshme — nuk mjafton vetëm këto për matching. */
const STOP_TOKENS = new Set([
  "mineral", "minerale", "natyral", "natyrale", "natural", "uje", "water",
  "pije", "pako", "copa", "cop", "the", "and", "me", "ne", "i", "e", "a",
]);

function normalizeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sinonime të vogla shkrimi — jo matching i gjerë. */
function aliasNormalize(name) {
  return normalizeName(name)
    .replace(/\biceds?\b/g, "ice")
    .replace(/\bqaj\b/g, "caj")
    .replace(/\bcaj\b/g, "caj")
    .replace(/\bdrezhez\b/g, "dredhez")
    .replace(/\bcremozo\b/g, "cremoso")
    .replace(/\bqumesht\b/g, "qumesht")
    .replace(/\bqumesht\b/g, "qumesht");
}

function distinctiveTokens(name) {
  return aliasNormalize(name)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t) && !/^\d/.test(t));
}

function levDist(a, b) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const row = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    let prev = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cur = s[i - 1] === t[j - 1] ? row[j - 1] : 1 + Math.min(row[j - 1], row[j], prev);
      row[j - 1] = prev;
      prev = cur;
    }
    row[t.length] = prev;
  }
  return row[t.length];
}

/** Aria/Pellisterka Mineral → Ujë mineral; Pellisterka Natural → Ujë natyral (jo leng frutash). */
function waterMenuTarget(name) {
  const n = aliasNormalize(name);
  if (!n) return null;
  const fruit = /\b(dredhez|drezhez|molle|portokall|limon|pjeshke|vjollce|frut|juice|leng)\b/.test(n);
  if (fruit) return null;
  if (/\bmineral/.test(n)) return "uje mineral";
  if (/\b(natyral|natural)\b/.test(n) && /\b(pellister|aria|roga|rugove|uje|0\s*25|0\s*50|0\s*5)\b/.test(n)) {
    return "uje natyral";
  }
  if (/\b(natyral|natural)\b/.test(n) && /\b0\s*25\s*l\b/.test(n)) return "uje natyral";
  return null;
}

/** Natural Dredhez / Molle → Lëngjet (jo ujë, jo produkt i ri). */
function juiceMenuTarget(name) {
  const n = aliasNormalize(name);
  if (!n) return null;
  if (/\b(dredhez|drezhez|strawberry)\b/.test(n)) return "leng dredhez";
  if (/\b(molle|molla|apple)\b/.test(n)) return "leng molle";
  if (/\b(portokall|portokalli|orange)\b/.test(n)) return "leng portokalli";
  if (/\b(ananasi|ananas|pineapple)\b/.test(n)) return "leng ananasi";
  if (/\b(shege|sheg)\b/.test(n)) return "leng shege";
  return null;
}

function findByAliasTarget(items, targetAlias) {
  if (!targetAlias) return null;
  for (const it of items) {
    const n = aliasNormalize(it.name);
    if (n === targetAlias || n.includes(targetAlias)) return it.id;
  }
  for (const it of items) {
    const n = aliasNormalize(it.name);
    if (targetAlias === "uje mineral" && n.includes("uje") && n.includes("mineral")) return it.id;
    if (targetAlias === "uje natyral" && n.includes("uje") && (n.includes("natyral") || n.includes("natural"))) {
      return it.id;
    }
    // Lëngje: prefero «Lëng …», pastaj frutash
    if (targetAlias === "leng molle" && n.includes("leng") && n.includes("molle")) return it.id;
    if (targetAlias === "leng portokalli" && n.includes("leng") && n.includes("portokall")) return it.id;
    if (targetAlias === "leng ananasi" && n.includes("leng") && n.includes("ananas")) return it.id;
    if (targetAlias === "leng shege" && n.includes("leng") && n.includes("shege")) return it.id;
    if (targetAlias === "leng dredhez") {
      if (n.includes("leng") && (n.includes("dredhez") || n.includes("drezhez") || n.includes("strawberry"))) {
        return it.id;
      }
    }
  }
  // Dredhez: nuk ka Lëng dredhez → Lëng frutash
  if (targetAlias === "leng dredhez") {
    for (const it of items) {
      const n = aliasNormalize(it.name);
      if (n.includes("leng") && n.includes("frut")) return it.id;
    }
  }
  return null;
}

/**
 * Gjen produktin ekzistues:
 * 1) emër i njëjtë (pas alias Ice/Iced)
 * 2) tokene dalluese (golden+eagle, coca+cola, …)
 * 3) ujë/lëng generic — vetëm nëse s'ka match më sipër
 */
function findMenuItemIdByName(db, name) {
  const target = aliasNormalize(name);
  if (!target) return null;
  const items = typeof db.getMenuItems === "function" ? db.getMenuItems(false) : [];

  for (const it of items) {
    if (aliasNormalize(it.name) === target) return it.id;
  }

  const invTokens = distinctiveTokens(name);
  const brandTokens = invTokens.filter((t) => t.length >= 4);

  if (invTokens.length) {
    let best = null;
    let bestScore = 0;
    for (const it of items) {
      const n = aliasNormalize(it.name);
      if (!n) continue;
      if (brandTokens.length && !brandTokens.every((b) => n.includes(b))) continue;
      const allFound = invTokens.every(
        (t) => n.includes(t) || n.split(" ").some((m) => m === t || (t.length >= 3 && levDist(m, t) <= 1)),
      );
      if (!allFound) continue;
      if (!invTokens.some((t) => t.length >= 4) && invTokens.length < 2) continue;
      const score = invTokens.join("").length;
      if (score > bestScore) {
        bestScore = score;
        best = it.id;
      }
    }
    if (best) return best;
  }

  const waterTarget = waterMenuTarget(name);
  if (waterTarget) {
    const wid = findByAliasTarget(items, waterTarget);
    if (wid) return wid;
  }

  const juiceTarget = juiceMenuTarget(name);
  if (juiceTarget) {
    const jid = findByAliasTarget(items, juiceTarget);
    if (jid) return jid;
  }

  return null;
}

function ensureStockCategory(db) {
  const names = db.getCategoryNames ? db.getCategoryNames() : [];
  const preferred = ["Furnizime", "Stok", "Pije joalkoolike", "Pije të nxehta", "Pije te nxehta"];
  for (const p of preferred) {
    if (names.includes(p)) return p;
  }
  if (names[0]) return names[0];
  try {
    db.addCategory("Furnizime");
    return "Furnizime";
  } catch {
    /* fall through */
  }
  if (names.length) return names[0];
  throw new Error("Nuk ka kategori menuje. Shtoni një kategori para se të regjistroni stokun.");
}

/** DD/MM/YYYY, DD.MM.YYYY, ose vit nga numri faturës (p.sh. 2026-988 + 01/09). */
function normalizeInvoiceDateFromScan(rawDate, invoiceNumber) {
  let s = String(rawDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmY = s.match(/(\d{1,2})[./\s-](\d{1,2})[./\s-](20\d{2})/);
  if (dmY) {
    return `${dmY[3]}-${dmY[2].padStart(2, "0")}-${dmY[1].padStart(2, "0")}`;
  }
  const ymd = s.match(/(20\d{2})[./\s-](\d{1,2})[./\s-](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }
  const numYear = String(invoiceNumber || "").match(/\b(20\d{2})\b/);
  const dmOnly = s.match(/(\d{1,2})[./\s-](\d{1,2})/);
  if (numYear && dmOnly) {
    return `${numYear[1]}-${dmOnly[2].padStart(2, "0")}-${dmOnly[1].padStart(2, "0")}`;
  }
  return "";
}

function normalizeScannedInvoicePayload(data) {
  if (!data || typeof data !== "object") return data;
  const invoice_number = String(data.invoice_number || "").trim() || data.invoice_number;
  const normalized = normalizeInvoiceDateFromScan(data.invoice_date, invoice_number);
  const invoice_date =
    normalized || (String(data.invoice_date || "").trim().slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/)
      ? String(data.invoice_date).slice(0, 10)
      : data.invoice_date);
  return { ...data, invoice_number, invoice_date };
}

async function scanReceipt(db, { photo }) {
  const raw = await aiCloud.scanInvoiceFromCloud(db, { photo });
  return normalizeScannedInvoicePayload(raw);
}

/**
 * Validim para regjistrimit — pa kaluar këtu NUK lejohet faturë «e pranuar».
 */
function validateReceiptScanApply(
  {
    supplier,
    invoice_number,
    invoice_date,
    items,
    scan_warnings,
    totals_check,
    allow_duplicate,
    allow_owner_override,
  } = {},
  db,
) {
  const errors = [];
  const sup = String(supplier || "").trim();
  if (!sup) errors.push("Mungon furnizuesi — plotëso ose skano përsëri faturën.");

  const invNum = String(invoice_number || "").trim();
  if (!invNum) errors.push("Mungon numri i faturës.");

  let duplicate_of = null;
  if (db && typeof db.findPurchaseInvoiceDuplicate === "function" && sup && invNum) {
    duplicate_of = db.findPurchaseInvoiceDuplicate(sup, invNum);
    if (duplicate_of && !allow_duplicate) {
      const tot = Number(duplicate_of.total) || 0;
      errors.push(
        `Fatura «${invNum}» për «${sup}» është regjistruar më parë ` +
          `(data ${duplicate_of.invoice_date || "—"}, shuma ${tot.toFixed(2)} €, ID ${duplicate_of.id}). ` +
          "E njëjta faturë nuk regjistrohet dy herë — kontrollo te Blerjet ose fshi faturën e vjetër.",
      );
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  let invDate = String(invoice_date || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invDate)) {
    const fixed = normalizeInvoiceDateFromScan(invoice_date, invNum);
    if (fixed) invDate = fixed;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invDate)) {
    errors.push(
      "Data e faturës është e pavlefshme ose bosh. Kontrollo skanimin (formati: VVVV-MM-DD).",
    );
  } else {
    if (invDate > today) {
      errors.push(
        `Data ${invDate} është në të ardhmen. Ndrysho datën sipas faturës fizike para regjistrimit.`,
      );
    }
    const yearInNum = invNum.match(/\b(20\d{2})\b/);
    if (yearInNum && yearInNum[1] !== invDate.slice(0, 4)) {
      errors.push(
        `Numri i faturës përmend vitin ${yearInNum[1]}, por data është ${invDate.slice(0, 4)}. ` +
          "Rregullo datën ose numrin — skanimi duket i gabuar.",
      );
    }
  }

  const lines = Array.isArray(items) ? items : [];
  if (!lines.length) errors.push("Nuk ka artikuj me sasi > 0 për regjistrim.");

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const label = String(raw.name || raw.emri || `Rreshti ${i + 1}`).trim() || `Rreshti ${i + 1}`;
    const converted = packMath.convertPackToPieces(raw);
    if (!converted.ok) {
      errors.push(`«${label}»: ${converted.reason || "rresht i pavlefshëm"}.`);
      continue;
    }
    const unit = packMath.normalizeUnit(raw.unit || raw.njesia);
    if (unit === "pako") {
      const explicit = Number(raw.pieces_per_pack ?? raw.copa_ne_pako ?? raw.copa_per_pako);
      const fromName = packMath.piecesFromName(raw.name || raw.emri);
      const ppp = converted.pieces_per_pack;
      if (ppp <= 1 && !(explicit > 1) && !fromName) {
        errors.push(
          `«${label}»: njësia është PAko — shkruani sa copë ka 1 pako (p.sh. 24 për Coca Cola, 12 për birra), ` +
            "ose ndrysho në copë nëse çdo rresht është 1 copë.",
        );
      }
    }
    const aiLine = packMath.parseEuroNumber(
      raw.line_total ?? raw.vlera ?? raw.total ?? raw.vlera_me_tvsh,
    );
    if (Number.isFinite(aiLine) && aiLine > 0) {
      const diff = Math.abs(converted.line_total - aiLine);
      if (diff > 0.06) {
        errors.push(
          `«${label}»: sasia × çmimi (${converted.line_total.toFixed(2)} €) ≠ vlera në faturë (${aiLine.toFixed(2)} €). ` +
            "Korrigjo sasinë, njesinë, copa/pako ose çmimin.",
        );
      }
    }
  }

  const warnList = Array.isArray(scan_warnings) ? scan_warnings.filter(Boolean) : [];
  for (const w of warnList) {
    errors.push(typeof w === "string" ? w : String(w.message || w));
  }

  const tc = totals_check && typeof totals_check === "object" ? totals_check : null;
  if (tc && tc.ok === false) {
    const msg = String(tc.message || tc.gabim || "").trim();
    errors.push(
      msg ||
        "Totali i faturës nuk përputhet me rreshtat — skanimi duket i pasaktë.",
    );
  }

  if (allow_owner_override) {
    const critical = [];
    if (!sup) critical.push("Mungon furnizuesi — plotëso ose skano përsëri faturën.");
    const lineCount = Array.isArray(items) ? items.filter((raw) => {
      const converted = packMath.convertPackToPieces(raw);
      return converted.ok && converted.quantity > 0;
    }).length : 0;
    if (!lineCount) critical.push("Nuk ka artikuj me sasi > 0 për regjistrim.");
    return {
      ok: critical.length === 0,
      errors: critical,
      duplicate_of,
      validation_skipped: errors,
    };
  }

  return { ok: errors.length === 0, errors, duplicate_of };
}

function applyReceiptToStock(db, {
  supplier,
  invoice_number,
  invoice_date,
  items,
  from_cloud_queue,
  supplier_nui,
  supplier_vat,
  vat_rate,
  purchase_kind,
  scan_warnings,
  totals_check,
  allow_duplicate,
  allow_owner_override,
}) {
  const validation = validateReceiptScanApply(
    {
      supplier,
      invoice_number,
      invoice_date,
      items,
      scan_warnings,
      totals_check,
      allow_duplicate,
      allow_owner_override,
    },
    db,
  );
  if (!validation.ok) {
    throw new Error(
      "Fatura NUK u regjistrua — rregulloni gabimet dhe provoni përsëri:\n\n" +
        validation.errors.join("\n"),
    );
  }

  const lines = Array.isArray(items) ? items : [];
  if (!lines.length) throw new Error("Nuk ka artikuj për regjistrim.");

  const category = ensureStockCategory(db);
  const purchaseItems = [];
  const skipped = [];
  const conversions = [];
  let created = 0;
  let matched = 0;

  for (const raw of lines) {
    const converted = packMath.convertPackToPieces(raw);
    if (!converted.ok) {
      skipped.push({ name: converted.name, reason: converted.reason || "i pavlefshëm" });
      continue;
    }

    let menuItemId = raw.menu_item_id ? Number(raw.menu_item_id) : findMenuItemIdByName(db, converted.name);
    if (!menuItemId) {
      try {
        const sellPrice = Math.round(converted.unit_price * 100) / 100;
        menuItemId = db.addMenuItem({
          name: converted.name,
          category,
          price: sellPrice > 0 ? sellPrice : 0,
          vat_category:
            raw.vat_rate != null && raw.vat_rate !== ""
              ? normalizeReceiptVatCategory(raw.vat_rate)
              : "18",
        });
        created += 1;
      } catch (err) {
        skipped.push({ name: converted.name, reason: err.message || "krijimi dështoi" });
        continue;
      }
    } else {
      matched += 1;
    }

    purchaseItems.push({
      menu_item_id: menuItemId,
      quantity: converted.quantity,
      unit_price: converted.unit_price >= 0 ? converted.unit_price : 0,
      vat_rate: raw.vat_rate != null && raw.vat_rate !== "" ? raw.vat_rate : undefined,
    });
    conversions.push({
      name: converted.name,
      matched_menu_item_id: menuItemId,
      packs: converted.packs,
      pieces_per_pack: converted.pieces_per_pack,
      pieces: converted.quantity,
      pack_price: converted.pack_price,
      unit_price: converted.unit_price,
    });
  }

  if (!purchaseItems.length) {
    const detail = skipped.length
      ? ` (${skipped.map((s) => s.name || s.reason).join(", ")})`
      : "";
    throw new Error(`Asnjë rresht i vlefshëm për stok.${detail}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  let invDate = String(invoice_date || today).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invDate)) invDate = today;

  const latest =
    typeof db.getLatestPurchaseInvoiceDate === "function" ? db.getLatestPurchaseInvoiceDate() : null;
  const mustAdjust = latest && invDate < latest;

  const invNumOriginal = String(invoice_number || "").trim() || `AI-${Date.now()}`;
  let invNum = invNumOriginal;
  const sup = String(supplier || "Furnizues AI").trim() || "Furnizues AI";

  const dupExisting =
    typeof db.findPurchaseInvoiceDuplicate === "function"
      ? db.findPurchaseInvoiceDuplicate(sup, invNumOriginal)
      : null;
  if (dupExisting && !allow_duplicate) {
    const tot = Number(dupExisting.total) || 0;
    throw new Error(
      `Fatura «${invNumOriginal}» për «${sup}» ekziston (ID ${dupExisting.id}, ${dupExisting.invoice_date}, ${tot.toFixed(2)} €). Nuk dublikohet.`,
    );
  }

  function createInv(numberStored, notes) {
    return db.createPurchaseInvoice({
      supplier: sup,
      invoice_number: numberStored,
      invoice_date: invDate,
      items: purchaseItems,
      status: mustAdjust ? "adjustment" : "completed",
      allow_backdate: !!mustAdjust,
      notes: notes || "",
      supplier_nui,
      supplier_vat,
      vat_rate,
      purchase_kind,
    });
  }

  let baseNotes = mustAdjust
    ? from_cloud_queue
      ? "Telefon/AI — rregullim (datë para faturës së fundit)"
      : "AI — rregullim (datë para faturës së fundit)"
    : from_cloud_queue
      ? "Telefon/AI"
      : "";

  if (dupExisting && allow_duplicate) {
    invNum = `${invNumOriginal}-KOPIE-${Date.now().toString(36).slice(-4)}`;
    baseNotes =
      `${baseNotes ? baseNotes + " · " : ""}Regjistrim i dytë me leje pronari — nr. origjinal «${invNumOriginal}», ID ekzistues ${dupExisting.id}.`;
  }

  const skippedChecks = Array.isArray(validation.validation_skipped)
    ? validation.validation_skipped.filter(Boolean)
    : [];
  if (allow_owner_override && skippedChecks.length) {
    const brief = skippedChecks.slice(0, 6).join("; ");
    const extra = skippedChecks.length > 6 ? ` (+${skippedChecks.length - 6} të tjera)` : "";
    baseNotes =
      `${baseNotes ? baseNotes + " · " : ""}` +
      "Leje pronari — kontrolli AI nuk kaloi: stoku/kontabilist mund të mos jenë saktë. " +
      brief +
      extra;
  }

  const invoice = createInv(invNum, baseNotes);

  if (!invoice || !invoice.items?.length) {
    throw new Error("Ruajtja e faturës dështoi — stoku NUK u ndryshua. Provoni sërish.");
  }

  return {
    invoice,
    applied_count: purchaseItems.length,
    created_count: created,
    updated_count: matched,
    skipped_count: skipped.length,
    skipped,
    conversions,
    as_adjustment: !!mustAdjust,
    invoice_number_stored: invNum,
    duplicate_copy: !!(dupExisting && allow_duplicate),
  };
}

module.exports = {
  scanReceipt,
  validateReceiptScanApply,
  applyReceiptToStock,
  normalizeInvoiceDateFromScan,
  normalizeScannedInvoicePayload,
  findMenuItemIdByName,
  parseEuroNumber: packMath.parseEuroNumber,
  convertPackToPieces: packMath.convertPackToPieces,
  inferPiecesPerPack: packMath.inferPiecesPerPack,
  aliasNormalize,
  init() {},
};
