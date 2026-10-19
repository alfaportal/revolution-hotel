"use strict";
/**
 * Analitikë ditore për snapshot pronari — burim i vetëm për AI hotel (PC).
 */
function fixRound(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseOrderItems(json) {
  try {
    const p = typeof json === "string" ? JSON.parse(json || "[]") : json;
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

const { addBusinessDays, businessYmd } = require("./lib/hotel-business-date");

function addDays(dateStr, delta) {
  return addBusinessDays(String(dateStr).slice(0, 10), delta);
}

function resolveMenuItemId(it, byId, byName) {
  const mid = Number(it.menu_item_id ?? it.menuItemId ?? it.id);
  if (mid && byId.has(mid)) return mid;
  const name = String(it.name || "").trim().toLowerCase();
  if (name && byName.has(name)) return byName.get(name).id;
  return null;
}

function buildSalesByItemForDay(db, date) {
  const sqlite = db.db;
  const menu = typeof db.getMenuItems === "function" ? db.getMenuItems(false) : [];
  const byId = new Map(menu.map((m) => [Number(m.id), m]));
  const byName = new Map(menu.map((m) => [String(m.name || "").trim().toLowerCase(), m]));

  const qtyMap = new Map();
  const revMap = new Map();

  const entries = sqlite.prepare(`
    SELECT items_json FROM daily_log
    WHERE status = 'completed' AND date(date) = date(?)
      AND NOT (
        UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'CO-%'
        OR UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'RC-%'
        OR UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'SVC-%'
      )
  `).all(date);

  for (const e of entries) {
    for (const it of parseOrderItems(e.items_json)) {
      const menuItemId = resolveMenuItemId(it, byId, byName);
      if (!menuItemId) continue;
      const qty = Number(it.quantity) || 1;
      const rev = qty * (Number(it.price) || 0);
      qtyMap.set(menuItemId, (qtyMap.get(menuItemId) || 0) + qty);
      revMap.set(menuItemId, (revMap.get(menuItemId) || 0) + rev);
    }
  }

  const rows = [];
  for (const [menuItemId, quantity_sold] of qtyMap) {
    const meta = byId.get(menuItemId);
    const revenue = fixRound(revMap.get(menuItemId) || 0);
    const unitCost =
      typeof db.getMenuItemCostForCogs === "function"
        ? Number(db.getMenuItemCostForCogs(menuItemId)) || 0
        : 0;
    const total_cost = fixRound(quantity_sold * unitCost);
    const gross_profit = fixRound(revenue - total_cost);
    const gross_profit_pct =
      revenue > 0.0001 ? fixRound((gross_profit / revenue) * 100) : 0;
    rows.push({
      menu_item_id: menuItemId,
      name: meta?.name || "",
      quantity_sold: fixRound(quantity_sold),
      revenue,
      unit_cost: fixRound(unitCost),
      total_cost,
      gross_profit,
      gross_profit_pct,
    });
  }
  rows.sort(
    (a, b) =>
      b.quantity_sold - a.quantity_sold ||
      b.revenue - a.revenue ||
      a.name.localeCompare(b.name, "sq"),
  );
  return rows;
}

function buildStockRunway(db, date, { paceDays = 30 } = {}) {
  const sqlite = db.db;
  const from = addDays(date, -(Math.max(1, paceDays) - 1));
  const menu = typeof db.getMenuItems === "function" ? db.getMenuItems(false) : [];
  const byId = new Map(menu.map((m) => [Number(m.id), m]));
  const byName = new Map(menu.map((m) => [String(m.name || "").trim().toLowerCase(), m]));

  const soldMap = new Map();
  const entries = sqlite.prepare(`
    SELECT items_json FROM daily_log
    WHERE status = 'completed' AND date(date) >= date(?) AND date(date) <= date(?)
      AND NOT (
        UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'CO-%'
        OR UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'RC-%'
        OR UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'SVC-%'
      )
  `).all(from, date);

  for (const e of entries) {
    for (const it of parseOrderItems(e.items_json)) {
      const menuItemId = resolveMenuItemId(it, byId, byName);
      if (!menuItemId) continue;
      const qty = Number(it.quantity) || 1;
      soldMap.set(menuItemId, (soldMap.get(menuItemId) || 0) + qty);
    }
  }

  const spanDays = Math.max(1, paceDays);
  const rows = [];
  for (const m of menu) {
    if (m.active === 0 || m.active === false) continue;
    const id = Number(m.id);
    const stock_qty = fixRound(Number(m.stock_qty) || 0);
    const sold_qty_period = fixRound(soldMap.get(id) || 0);
    const avg_daily_sold = fixRound(sold_qty_period / spanDays);
    let days_of_stock_left = null;
    if (avg_daily_sold > 0.0001) {
      days_of_stock_left = fixRound(stock_qty / avg_daily_sold);
    }
    rows.push({
      menu_item_id: id,
      name: String(m.name || ""),
      stock_qty,
      sold_qty_period,
      avg_daily_sold,
      pace_days: spanDays,
      days_of_stock_left,
    });
  }
  rows.sort((a, b) => {
    const da = a.days_of_stock_left ?? 99999;
    const db_ = b.days_of_stock_left ?? 99999;
    return da - db_ || b.avg_daily_sold - a.avg_daily_sold;
  });
  return rows;
}

function buildBreakageByItem(db, date) {
  if (typeof db.listStockBreakageLoss !== "function") return [];
  const entries = db.listStockBreakageLoss({ from: date, to: date, limit: 500 });
  const map = new Map();
  for (const e of entries || []) {
    if (String(e.source_type || "").toLowerCase() !== "menu") continue;
    const key = Number(e.source_id) || e.item_name;
    const prev = map.get(key) || {
      menu_item_id: Number(e.source_id) || null,
      name: e.item_name || "",
      quantity: 0,
      total_cost: 0,
      reasons: new Set(),
    };
    prev.quantity += Number(e.quantity) || 0;
    prev.total_cost += Number(e.total_cost) || 0;
    if (e.reason) prev.reasons.add(String(e.reason));
    map.set(key, prev);
  }
  return [...map.values()].map((r) => ({
    menu_item_id: r.menu_item_id,
    name: r.name,
    quantity: fixRound(r.quantity),
    total_cost: fixRound(r.total_cost),
    reasons: [...r.reasons],
  }));
}

function buildPurchasesByItemForDay(db, date) {
  const sqlite = db.db;
  const rows = sqlite.prepare(`
    SELECT
      pii.menu_item_id,
      pii.product_name,
      pii.quantity,
      pii.line_total,
      pii.unit_price,
      pi.supplier,
      pi.invoice_number,
      pi.invoice_date
    FROM purchase_invoice_items pii
    INNER JOIN purchase_invoices pi ON pi.id = pii.invoice_id
    WHERE date(pi.invoice_date) = date(?)
    ORDER BY pi.supplier ASC, pii.product_name ASC
  `).all(date);
  return rows.map((r) => ({
    menu_item_id: r.menu_item_id ? Number(r.menu_item_id) : null,
    product_name: String(r.product_name || "").trim(),
    supplier: String(r.supplier || "").trim(),
    quantity: fixRound(Number(r.quantity) || 0),
    unit_price: fixRound(Number(r.unit_price) || 0),
    line_total: fixRound(Number(r.line_total) || 0),
    invoice_number: String(r.invoice_number || "").trim(),
    invoice_date: String(r.invoice_date || date).slice(0, 10),
  }));
}

function buildOwnerReportAnalytics(db, reportDate) {
  const date = String(reportDate || businessYmd()).slice(0, 10);
  let ingredientsBlock = {
    ingredients: [],
    menu_recipes: [],
    consumption_variance_week: { from: date, to: date, items: [] },
    last_stock_count: null,
    weak_profit_items: [],
  };
  if (typeof db.buildIngredientsSnapshot === "function") {
    try {
      ingredientsBlock = db.buildIngredientsSnapshot(date);
    } catch (e) {
      console.warn("[pc_analytics] ingredients snapshot:", e.message);
    }
  }
  return {
    sales_by_item: buildSalesByItemForDay(db, date),
    stock_runway: buildStockRunway(db, date, { paceDays: 30 }),
    breakage_by_item: buildBreakageByItem(db, date),
    purchases_by_item: buildPurchasesByItemForDay(db, date),
    ...ingredientsBlock,
  };
}

/** Për provë AI — pa thirrje model. */
function deriveSnapshotInsights(analytics) {
  const sales = analytics?.sales_by_item || [];
  const stock = analytics?.stock_runway || [];
  const top = sales.length
    ? sales.reduce((a, b) => (b.quantity_sold > a.quantity_sold ? b : a))
    : null;
  const soldTodayIds = new Set(
    sales.filter((s) => s.quantity_sold > 0).map((s) => s.menu_item_id),
  );
  const notSoldToday = stock.filter((s) => !soldTodayIds.has(s.menu_item_id));
  const lowestRunway = stock
    .filter((s) => s.days_of_stock_left != null && s.avg_daily_sold > 0)
    .sort((a, b) => a.days_of_stock_left - b.days_of_stock_left)[0];
  const ingredients = analytics?.ingredients || [];
  const lowIngredients = ingredients.filter((i) => i.below_minimum || i.negative_stock);
  const variance = analytics?.consumption_variance_week?.items || [];
  const topLoss = variance.find((v) => Math.abs(v.variance_value) > 0.01) || null;
  const countDiffs = analytics?.last_stock_count?.lines || [];
  return {
    top_seller_by_qty: top,
    items_not_sold_today_count: notSoldToday.length,
    not_sold_today: notSoldToday.slice(0, 10).map((s) => s.name),
    lowest_stock_runway: lowestRunway || null,
    low_ingredients_count: lowIngredients.length,
    top_ingredient_variance: topLoss,
    last_count_adjustments: countDiffs.slice(0, 5),
    weak_profit_items: (analytics?.weak_profit_items || []).slice(0, 5),
  };
}

module.exports = {
  buildOwnerReportAnalytics,
  buildSalesByItemForDay,
  buildStockRunway,
  buildBreakageByItem,
  buildPurchasesByItemForDay,
  deriveSnapshotInsights,
};
