/**
 * AI skanim faturash — foto → Claude Vision (cloud) → regjistrim stoku lokal.
 * Matching: emër i saktë + sinonime (Ice/Iced Tea).
 * Ujë: çdo «mineral» → Ujë mineral; «natyral/natural» (pa fruta) → Ujë natyral.
 * Sasia: pako → copë me matematikë (purchase-pack-math).
 */
const aiCloud = require("../ai-cloud");
const packMath = require("../purchase-pack-math");

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
 * 1) ujë: mineral → Ujë mineral; natyral (pije uji) → Ujë natyral
 * 2) lëngje: dredhez/molle/… → Lëng …
 * 3) emër i njëjtë (pas alias Ice/Iced)
 * 4) tokene dalluese (ice+tea)
 */
function findMenuItemIdByName(db, name) {
  const target = aliasNormalize(name);
  if (!target) return null;
  const items = typeof db.getMenuItems === "function" ? db.getMenuItems(false) : [];

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

  const invTokens = distinctiveTokens(name);
  const brandTokens = invTokens.filter((t) => t.length >= 6);

  for (const it of items) {
    if (aliasNormalize(it.name) === target) return it.id;
  }

  if (!invTokens.length) return null;

  let best = null;
  let bestScore = 0;
  for (const it of items) {
    const n = aliasNormalize(it.name);
    if (!n) continue;
    // Brand i faturës (Golden…) duhet të jetë edhe te produkti — ujë trajtohet më lart
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
  return best;
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

async function scanReceipt(db, { photo }) {
  return aiCloud.scanInvoiceFromCloud(db, { photo });
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
}) {
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
          vat_category: "18",
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

  let invNum = String(invoice_number || "").trim() || `AI-${Date.now()}`;
  const sup = String(supplier || "Furnizues AI").trim() || "Furnizues AI";

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

  const baseNotes = mustAdjust
    ? from_cloud_queue
      ? "Telefon/AI — rregullim (datë para faturës së fundit)"
      : "AI — rregullim (datë para faturës së fundit)"
    : from_cloud_queue
      ? "Telefon/AI"
      : "";

  let invoice;
  try {
    invoice = createInv(invNum, baseNotes);
  } catch (err) {
    const msg = String(err.message || err);
    if (/ekziston tashmë|dublikohet/i.test(msg)) {
      invNum = `${invNum}-R${Date.now().toString(36).slice(-4)}`;
      invoice = createInv(invNum, "AI — riblerje (nr. fature i ri për të shmangur dublimin)");
    } else {
      throw err;
    }
  }

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
  };
}

module.exports = {
  scanReceipt,
  applyReceiptToStock,
  findMenuItemIdByName,
  parseEuroNumber: packMath.parseEuroNumber,
  convertPackToPieces: packMath.convertPackToPieces,
  inferPiecesPerPack: packMath.inferPiecesPerPack,
  aliasNormalize,
  init() {},
};
