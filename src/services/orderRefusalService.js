const { getSupabase } = require("../db");
const { ensureOrderRefusalSchema } = require("../lib/ensureOrderRefusalSchema");
const { normalizeItems } = require("./salesService");
const { getZonedParts } = require("./aiDailyReportService");

const DEFAULT_REASON = "Pa arsye";

function normalizeReason(raw) {
  const s = String(raw || "").trim().slice(0, 300);
  return s || DEFAULT_REASON;
}

function itemsSummary(itemsJson) {
  const items = normalizeItems(itemsJson || []);
  return items
    .map((it) => {
      const q = Number(it.quantity) || 1;
      const name = String(it.name || "Artikull").trim();
      return q > 1 ? `${q}× ${name}` : name;
    })
    .slice(0, 12)
    .join(", ");
}

/**
 * Regjistron një refuzim (event + arsyeja e fundit te sales_orders).
 */
async function logRefusalEvent(clientId, orderRow, { waiterId, waiterName, reason } = {}) {
  await ensureOrderRefusalSchema();
  const db = getSupabase();
  const reasonText = normalizeReason(reason);
  const orderId = orderRow?.id;
  if (!clientId || !orderId) return null;

  try {
    await db
      .from("sales_orders")
      .update({ refuse_reason: reasonText })
      .eq("id", orderId)
      .eq("client_id", clientId);
  } catch (err) {
    if (!/refuse_reason/i.test(String(err.message || ""))) {
      console.warn("[refusal] update refuse_reason:", err.message);
    }
  }

  const { data, error } = await db
    .from("order_refusal_events")
    .insert({
      client_id: clientId,
      sales_order_id: orderId,
      waiter_id: String(waiterId || "").trim(),
      waiter_name: String(waiterName || "").trim() || String(waiterId || "").trim() || "Kamarier",
      reason: reasonText,
      table_number: orderRow.table_number != null ? Number(orderRow.table_number) : null,
      total: Number(orderRow.total) || 0,
      items_json: normalizeItems(orderRow.items_json || []),
      device_id: orderRow.device_id || null,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    console.warn("[refusal] insert event:", error.message);
    return null;
  }
  return data;
}

function dayBounds(dateStr) {
  return {
    start: `${dateStr}T00:00:00.000Z`,
    end: `${dateStr}T23:59:59.999Z`,
  };
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function getRefusalStats(clientId) {
  await ensureOrderRefusalSchema();
  const db = getSupabase();
  const today = getZonedParts().date;
  const weekStart = addDays(today, -6);
  const monthStart = `${today.slice(0, 8)}01`;

  async function countSince(fromDate) {
    const { count, error } = await db
      .from("order_refusal_events")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gte("created_at", `${fromDate}T00:00:00.000Z`);
    if (error) return 0;
    return Number(count) || 0;
  }

  const [today_count, week_count, month_count] = await Promise.all([
    countSince(today),
    countSince(weekStart),
    countSince(monthStart),
  ]);

  return { today: today_count, week: week_count, month: month_count, as_of: today };
}

/**
 * Lista e refuzimeve për panelin e pronarit.
 */
async function listRefusedOrders(clientId, { from, to, limit = 100 } = {}) {
  await ensureOrderRefusalSchema();
  const db = getSupabase();
  const today = getZonedParts().date;
  const fromD = String(from || addDays(today, -30)).slice(0, 10);
  const toD = String(to || today).slice(0, 10);
  const { start } = dayBounds(fromD);
  const { end } = dayBounds(toD);

  const { data, error } = await db
    .from("order_refusal_events")
    .select(
      "id, sales_order_id, waiter_id, waiter_name, reason, table_number, total, items_json, device_id, created_at",
    )
    .eq("client_id", clientId)
    .gte("created_at", start)
    .lte("created_at", end)
    .order("created_at", { ascending: false })
    .limit(Math.min(300, Math.max(1, Number(limit) || 100)));

  if (error) {
    if (/order_refusal_events/i.test(error.message || "")) {
      return { orders: [], stats: await getRefusalStats(clientId).catch(() => ({ today: 0, week: 0, month: 0 })), from: fromD, to: toD };
    }
    throw error;
  }

  const orders = (data || []).map((row) => {
    const created = row.created_at ? new Date(row.created_at) : null;
    const zoned = created && !Number.isNaN(created.getTime()) ? getZonedParts(created) : null;
    const date = zoned?.date || "";
    const time = zoned
      ? `${String(zoned.hour).padStart(2, "0")}:${String(zoned.minute).padStart(2, "0")}`
      : "";
    return {
      id: row.id,
      sales_order_id: row.sales_order_id,
      date,
      time,
      created_at: row.created_at,
      waiter_id: row.waiter_id,
      waiter_name: row.waiter_name || "Kamarier",
      reason: row.reason || DEFAULT_REASON,
      table_number: row.table_number,
      total: Number(row.total) || 0,
      items: normalizeItems(row.items_json || []),
      items_summary: itemsSummary(row.items_json),
      device_id: row.device_id || "",
    };
  });

  const stats = await getRefusalStats(clientId);
  return { ok: true, from: fromD, to: toD, orders, stats };
}

/** Për AI — arsyet e fundit të refuzimit sipas kamarierit */
async function listRecentRefusalReasons(clientId, { days = 30, limit = 40 } = {}) {
  await ensureOrderRefusalSchema();
  const db = getSupabase();
  const from = addDays(getZonedParts().date, -Math.max(1, Number(days) || 30));
  const { data, error } = await db
    .from("order_refusal_events")
    .select("waiter_name, reason, created_at, items_json")
    .eq("client_id", clientId)
    .gte("created_at", `${from}T00:00:00.000Z`)
    .order("created_at", { ascending: false })
    .limit(Math.min(80, Math.max(5, Number(limit) || 40)));
  if (error) return [];
  return (data || []).map((r) => ({
    waiter_name: r.waiter_name,
    reason: r.reason || DEFAULT_REASON,
    created_at: r.created_at,
    items_summary: itemsSummary(r.items_json),
  }));
}

module.exports = {
  DEFAULT_REASON,
  normalizeReason,
  logRefusalEvent,
  listRefusedOrders,
  getRefusalStats,
  listRecentRefusalReasons,
};
