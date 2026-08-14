const { normalizeItems } = require("./salesService");
const {
  fetchOrderedSales,
  fetchRefusalGraceOrders,
  mergeOrdersById,
  acknowledgeBarOrders,
  isInRefusalGrace,
} = require("./kdsService");
const { isCustomerBarOrder, isBarMobileOrder, orderSourceLabel } = require("../lib/orderSource");
const { isOrderAccepted } = require("../lib/salesOrderSelect");
const { verifyWaiterPin } = require("./waiterPinService");
const { getSupabase } = require("../db");

function formatOrderForPos(row) {
  const src = orderSourceLabel(row);
  const handler = String(row.accepted_by_waiter_name || "").trim();
  const waiterName = String(row.waiter_name || "").trim();
  const accepted = isOrderAccepted(row);
  const inGrace = isInRefusalGrace(row);
  const items = normalizeItems(row.items_json);
  return {
    id: row.id,
    table_number: Number(row.table_number) || 0,
    customer_label: waiterName,
    waiter_name: waiterName,
    waiter_id: row.waiter_id || null,
    local_order_id: row.local_order_id || null,
    source: src.code,
    source_label: src.label,
    source_icon: src.icon,
    device_id: row.device_id || "",
    items,
    items_json: items,
    total: Number(row.total) || 0,
    ordered_at: row.ordered_at,
    status: row.status || "ordered",
    pending: !accepted,
    in_refusal_grace: inGrace,
    refused_at: row.refused_at || null,
    order_expires_at: row.order_expires_at || null,
    accepted_by: handler,
    accepted_by_waiter_name: handler,
    accepted_by_waiter_id: row.accepted_by_waiter_id || null,
    accepted_at: row.accepted_at || null,
    handler_label: handler || null,
  };
}

async function loadPosOnlineOrderRows(clientId) {
  const base = await fetchOrderedSales(clientId);
  return mergeOrdersById(base, await fetchRefusalGraceOrders(clientId));
}

async function listPendingOnlineOrders(clientId) {
  if (!clientId) return [];
  const rows = await loadPosOnlineOrderRows(clientId);
  return rows
    .filter(isCustomerBarOrder)
    .filter(row => !isOrderAccepted(row))
    .map(formatOrderForPos);
}

/**
 * Të gjitha porositë mobile për POS (QR/kiosk/public + WEB-WAITER).
 * WEB-WAITER duhet këtu — KAFENE auto-import + print kuponin nga all_orders.
 * Alarmi PRANO/REFUZO mbetet te listPendingOnlineOrders (vetëm klientët).
 */
async function listBarMobileOrderedForPos(clientId) {
  if (!clientId) return [];
  const rows = await loadPosOnlineOrderRows(clientId);
  return rows.filter(isBarMobileOrder).map(formatOrderForPos);
}

async function countPendingOnlineOrders(clientId) {
  const orders = await listPendingOnlineOrders(clientId);
  return orders.length;
}

async function refusePendingOnlineOrder(clientId, orderId, { pin = "", reason = "" } = {}) {
  const id = String(orderId || "").trim();
  if (!id) {
    const err = new Error("Mungon porosia.");
    err.code = "MISSING_ORDER";
    throw err;
  }

  const pinTrim = String(pin || "").trim();
  if (!pinTrim) {
    const err = new Error("Vendosni PIN-in e kamarierit që e refuzon porosinë.");
    err.code = "MISSING_PIN";
    throw err;
  }

  const handler = await verifyWaiterPin(clientId, pinTrim);
  const { refuseBarOrderWithGrace } = require("./kdsService");
  const order = await refuseBarOrderWithGrace(clientId, id, {
    waiterId: handler.id,
    waiterName: handler.name,
    reason,
  });

  return {
    ok: true,
    refused: 1,
    order_id: id,
    order,
    status: order.status,
    refuse_mode: "grace_v2",
    grace_minutes: 2,
    refused_by: handler.name,
    refuse_reason: order.refuse_reason || reason || "",
  };
}

async function acceptPendingOnlineOrders(clientId, orderIds, { waiterId = null, waiterName = "", pin = "" } = {}) {
  const ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return { ok: true, acknowledged: 0, order_ids: [], accepted_by: waiterName };

  if (pin && !waiterName) {
    const handler = await verifyWaiterPin(clientId, pin);
    waiterId = handler.id;
    waiterName = handler.name;
  }

  const result = await acknowledgeBarOrders(clientId, ids, { waiterId, waiterName });
  if (result.count > 0 && waiterId && waiterName) {
    const db = getSupabase();
    await db
      .from("sales_orders")
      .update({
        waiter_id: waiterId,
        waiter_name: waiterName,
      })
      .eq("client_id", clientId)
      .in("id", result.ids);
  }
  return {
    ok: result.count > 0,
    acknowledged: result.count,
    order_ids: result.ids,
    accepted_by: waiterName,
  };
}

module.exports = {
  formatOrderForPos,
  listPendingOnlineOrders,
  listBarMobileOrderedForPos,
  countPendingOnlineOrders,
  acceptPendingOnlineOrders,
  refusePendingOnlineOrder,
};
