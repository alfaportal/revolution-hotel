/** Llogaritja dhe zbatimi i promocioneve / zbritjeve. */

const {
  resolveLineDiscountAmount,
  resolveLineSurchargeAmount,
} = require("./fiscal/fiscal-line-discount");
const { round4, normalizeQty } = require("./fiscal/fiscal-vat");

function parseTargets(raw) {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function normalizeTime(raw) {
  const s = String(raw || "").trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : "";
}

function isPromotionActiveNow(promo, now = new Date()) {
  if (!promo || !Number(promo.active)) return false;
  const date = now.toISOString().slice(0, 10);
  const from = String(promo.date_from || "").slice(0, 10);
  const to = String(promo.date_to || "").slice(0, 10);
  if (from && date < from) return false;
  if (to && date > to) return false;

  const tf = normalizeTime(promo.time_from);
  const tt = normalizeTime(promo.time_to);
  if (tf && tt) {
    const cur = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (cur < tf || cur > tt) return false;
  }
  return true;
}

function buildCategoryMap(db) {
  const map = new Map();
  for (const it of db.getMenuItems(false)) {
    map.set(Number(it.id), String(it.category || "").trim());
  }
  return map;
}

function itemSubtotal(items) {
  return (items || []).reduce(
    (s, i) => s + Number(i.price || 0) * (Number(i.quantity) || 0),
    0,
  );
}

function eligibleItems(items, promotion, categoryMap) {
  const applies = String(promotion.applies_to || "order").toLowerCase();
  const targets = parseTargets(promotion.target_json);

  if (applies === "order") return items || [];
  if (applies === "category") {
    const set = new Set(targets.map(t => String(t).trim()).filter(Boolean));
    return (items || []).filter(it => {
      const cat = categoryMap.get(Number(it.menu_item_id)) || String(it.category || "").trim();
      return set.has(cat);
    });
  }
  if (applies === "product") {
    const ids = new Set(targets.map(t => Number(t)).filter(n => n > 0));
    return (items || []).filter(it => ids.has(Number(it.menu_item_id)));
  }
  return [];
}

function calculateDiscountForPromotion(items, promotion, categoryMap) {
  const subtotal = itemSubtotal(items);
  const eligible = eligibleItems(items, promotion, categoryMap);
  const eligibleSubtotal = itemSubtotal(eligible);
  if (eligibleSubtotal <= 0) {
    return {
      subtotal,
      discount_total: 0,
      total: subtotal,
      promotion_id: null,
      promotion_name: "",
    };
  }

  let discount = 0;
  const dtype = String(promotion.discount_type || "percent").toLowerCase();
  if (dtype === "fixed") {
    discount = Math.min(Number(promotion.discount_value) || 0, eligibleSubtotal);
  } else {
    discount = eligibleSubtotal * (Number(promotion.discount_value) || 0) / 100;
  }
  discount = Math.round(discount * 100) / 100;

  return {
    subtotal,
    discount_total: discount,
    total: Math.max(0, Math.round((subtotal - discount) * 100) / 100),
    promotion_id: promotion.id,
    promotion_name: promotion.name,
  };
}

function resolvePromotionDiscount(db, items, promotionId = null) {
  const categoryMap = buildCategoryMap(db);
  const subtotal = itemSubtotal(items);

  if (promotionId === "" || promotionId === "none") {
    return {
      subtotal,
      discount_total: 0,
      total: subtotal,
      promotion_id: null,
      promotion_name: "",
    };
  }

  if (promotionId != null && promotionId !== "auto") {
    const promo = db.getPromotion(Number(promotionId));
    if (!promo) throw new Error("Promocioni nuk u gjet.");
    if (!isPromotionActiveNow(promo)) {
      throw new Error(`Promocioni «${promo.name}» nuk është aktiv tani.`);
    }
    const result = calculateDiscountForPromotion(items, promo, categoryMap);
    if (result.discount_total <= 0) {
      throw new Error(`Promocioni «${promo.name}» nuk vlen për artikujt e zgjedhur.`);
    }
    return result;
  }

  const active = db.listPromotions().filter(p => isPromotionActiveNow(p));
  let best = null;
  for (const promo of active) {
    const result = calculateDiscountForPromotion(items, promo, categoryMap);
    if (result.discount_total > 0 && (!best || result.discount_total > best.discount_total)) {
      best = result;
    }
  }

  if (best) return best;
  return {
    subtotal,
    discount_total: 0,
    total: subtotal,
    promotion_id: null,
    promotion_name: "",
  };
}

function itemMatchKey(it) {
  const id = it?.menu_item_id != null ? Number(it.menu_item_id) : "";
  const name = String(it?.name || "").trim().toLowerCase();
  const price = Number(it?.price || 0).toFixed(4);
  return `${id}|${name}|${price}`;
}

function lineGross(it) {
  return (Number(it?.price) || 0) * (Number(it?.quantity) || 1);
}

/** Zbritje/rritje për rresht — neto për njësi (4 dec), si fiskali. */
function applyLineAdjustmentsToItems(items) {
  return (items || []).map((it) => {
    const copy = { ...it };
    const qty = normalizeQty(copy.quantity ?? copy.qty ?? 1);
    const ld = resolveLineDiscountAmount(copy);
    const ls = resolveLineSurchargeAmount(copy);
    if (ld <= 0 && ls <= 0) return copy;
    const unit = Number(copy.unit_price ?? copy.price ?? copy.cmimi ?? 0) || 0;
    const base = copy.base_price != null ? Number(copy.base_price) : unit;
    const gross = round4(base * qty);
    const net = round4(Math.max(0, gross - ld + ls));
    const netUnit = qty > 0 ? round4(net / qty) : unit;
    copy.price = netUnit;
    copy.unit_price = netUnit;
    if (copy.base_price == null && (ld > 0 || ls > 0)) copy.base_price = base;
    return copy;
  });
}

/**
 * Artikuj të përgatitur për librin / TVSH: rresht (zbritje/rritje) → promocion.
 * @param {Array} items
 * @param {{ subtotal?: number, discount_total?: number, total?: number, promotion_id?: number|null }} saleMeta
 * @param {object|null} db
 */
function prepareItemsForVatLedger(items, saleMeta = {}, db = null) {
  const list = applyLineAdjustmentsToItems(items);
  if (!list.length) return list;

  const discount = Number(saleMeta.discount_total) || 0;
  if (discount <= 0) return list;

  const rawSubtotal = itemSubtotal((items || []).map((it) => ({ ...it })));
  const adjustedSubtotal = itemSubtotal(list);
  const meta = { ...saleMeta };
  if (meta.subtotal == null) {
    meta.subtotal = adjustedSubtotal;
  } else if (
    Math.abs(Number(meta.subtotal) - rawSubtotal) < 0.02 &&
    Math.abs(adjustedSubtotal - rawSubtotal) > 0.001
  ) {
    meta.subtotal = adjustedSubtotal;
  }
  if (meta.total == null && meta.subtotal != null) {
    meta.total = Math.max(
      0,
      Math.round((Number(meta.subtotal) - discount) * 100) / 100,
    );
  }
  return itemsForVatAfterDiscount(list, meta, db);
}

/**
 * Zbrit çmimet e rreshtave për llogaritjen e TVSH-së (bazë = çmimi i paguar).
 * @param {Array} items
 * @param {{ subtotal?: number, discount_total?: number, total?: number, promotion_id?: number|null }} saleMeta
 * @param {object|null} db — për promotion_id (eligible category/product)
 */
function itemsForVatAfterDiscount(items, saleMeta = {}, db = null) {
  const list = (items || []).map((it) => ({ ...it }));
  if (!list.length) return list;

  const discount = Number(saleMeta.discount_total) || 0;
  if (discount <= 0) return list;

  const subtotal =
    saleMeta.subtotal != null ? Number(saleMeta.subtotal) : itemSubtotal(list);
  const payable =
    saleMeta.total != null
      ? Number(saleMeta.total)
      : Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  if (subtotal <= 0 || payable < 0) return list;

  const promotionId =
    saleMeta.promotion_id != null && saleMeta.promotion_id !== ""
      ? Number(saleMeta.promotion_id)
      : null;
  let allocated = false;

  if (promotionId && db && typeof db.getPromotion === "function") {
    const promo = db.getPromotion(promotionId);
    if (promo) {
      const categoryMap = buildCategoryMap(db);
      const eligible = eligibleItems(list, promo, categoryMap);
      const eligibleKeys = new Set(eligible.map(itemMatchKey));
      let eligibleGross = 0;
      const grosses = list.map((it) => {
        const g = lineGross(it);
        if (eligibleKeys.has(itemMatchKey(it))) eligibleGross += g;
        return g;
      });
      if (eligibleGross > 0) {
        const discountToApply = Math.min(discount, eligibleGross);
        for (let i = 0; i < list.length; i++) {
          if (!eligibleKeys.has(itemMatchKey(list[i]))) continue;
          const share = (grosses[i] / eligibleGross) * discountToApply;
          const newGross = Math.max(0, grosses[i] - share);
          const qty = Number(list[i].quantity) || 1;
          list[i].price = qty > 0 ? Math.round((newGross / qty) * 10000) / 10000 : 0;
        }
        allocated = true;
      }
    }
  }

  if (!allocated) {
    const factor = payable / subtotal;
    for (const it of list) {
      const qty = Number(it.quantity) || 1;
      const gross = lineGross(it);
      const newGross = gross * factor;
      it.price = qty > 0 ? Math.round((newGross / qty) * 10000) / 10000 : 0;
    }
  }

  const sumAfter = itemSubtotal(list);
  if (Math.abs(sumAfter - payable) > 0.02 && sumAfter > 0) {
    const adj = payable / sumAfter;
    for (const it of list) {
      const qty = Number(it.quantity) || 1;
      it.price = Math.round(Number(it.price) * adj * 10000) / 10000;
    }
  }

  return list;
}

function mapPromotionForClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    discount_type: row.discount_type,
    discount_value: Number(row.discount_value) || 0,
    applies_to: row.applies_to,
    targets: parseTargets(row.target_json),
    date_from: String(row.date_from || "").slice(0, 10),
    date_to: String(row.date_to || "").slice(0, 10),
    time_from: normalizeTime(row.time_from),
    time_to: normalizeTime(row.time_to),
    active: !!Number(row.active),
    created_at: row.created_at,
    active_now: isPromotionActiveNow(row),
  };
}

module.exports = {
  parseTargets,
  isPromotionActiveNow,
  buildCategoryMap,
  itemSubtotal,
  lineGross,
  itemMatchKey,
  eligibleItems,
  calculateDiscountForPromotion,
  resolvePromotionDiscount,
  applyLineAdjustmentsToItems,
  prepareItemsForVatLedger,
  itemsForVatAfterDiscount,
  mapPromotionForClient,
};
