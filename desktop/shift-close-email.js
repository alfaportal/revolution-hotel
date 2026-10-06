/**
 * Njoftim cloud pas mbylljes së ndërrimit — email te pronari.
 * Gabimet vetëm logohen; mbyllja e ndërrimit nuk bllokohet kurrë.
 */
const cloudSync = require("./cloud-sync");
const cloudHealth = require("./cloud-health");

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

async function notifyShiftCloseEmail(db, closed) {
  if (!db || !closed) return { ok: false, skipped: true, reason: "missing_data" };
  if (!cloudSync.isCloudConfigured(db)) {
    console.log("[shift-email] skip: cloud_not_configured");
    return { ok: true, skipped: true, reason: "cloud_not_configured" };
  }

  const slug = String(db.getSetting("kitchen_slug", "") || "").trim();
  const key = String(db.getSetting("kitchen_key", "") || "").trim();
  console.log("[shift-email] duke dërguar...", {
    slug,
    keyPresent: Boolean(key),
    keyLen: key.length,
  });
  if (!slug || !key) {
    console.log("[shift-email] skip: missing_kitchen_access", { slug: slug || "(bosh)" });
    return { ok: true, skipped: true, reason: "missing_kitchen_access" };
  }

  const settings = typeof db.getSettings === "function" ? db.getSettings() : {};
  const fiscal = typeof db.getFiscalSettings === "function" ? db.getFiscalSettings() : {};
  const restaurantName =
    String(fiscal?.biz_name || settings?.restaurant_name || "").trim() || "Lokal";

  const shift = closed.shift || {};
  const lowStock = typeof db.getLowStockItems === "function" ? db.getLowStockItems() : [];

  const payload = {
    waiter_name: String(closed.waiter_name || "").trim(),
    shift_date: shift.closed_at || shift.opened_at || new Date().toISOString(),
    closed_at: shift.closed_at || null,
    opened_at: shift.opened_at || null,
    total_sales: Number(closed.total_sales) || 0,
    order_count: Number(closed.order_count) || 0,
    cash_total: Number(closed.cash_total) || 0,
    card_total: Number(closed.card_total) || 0,
    restaurant_name: restaurantName,
    low_stock_items: (lowStock || []).map(item => ({
      name: String(item.name || "").trim(),
      stock_qty: Number(item.stock_qty) || 0,
      low_stock_threshold: Number(item.low_stock_threshold) || 0,
    })),
  };

  const path = `/api/waiter/${encodeURIComponent(slug)}/shift-close-email?key=${encodeURIComponent(key)}`;
  console.log(
    "[shift-email] path:",
    path.replace(/key=[^&]+/, "key=***"),
    "body:",
    JSON.stringify(payload).substring(0, 200),
  );
  const res = await cloudHealth.requestJsonWithFallback("POST", path, payload, {
    timeoutMs: 12000,
    headers: {
      Accept: "application/json",
      "x-kitchen-key": key,
    },
  });

  const parsed = parseJsonSafe(res.data);
  console.log("[shift-email] përgjigje:", { status: res.status, parsed });
  if (res.status >= 400 || parsed.ok === false) {
    throw new Error(parsed.gabim || `shift-close-email HTTP ${res.status}`);
  }
  return parsed;
}

module.exports = { notifyShiftCloseEmail };
