const { splitItemsByStation } = require("../print-routing");

function parseItems(json) {
  try {
    return JSON.parse(json || "[]");
  } catch {
    return [];
  }
}

function itemsTotal(items) {
  return (items || []).reduce(
    (sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0),
    0,
  );
}

function filterKitchenItems(items, db) {
  const { kitchenItems } = splitItemsByStation(items || [], db);
  return kitchenItems;
}

function filterBarItems(items, db) {
  const { barItems } = splitItemsByStation(items || [], db);
  return barItems;
}

function mapOrderRow(order, tableNumber, db) {
  const allItems = parseItems(order.items_json);
  const kitchenItems = filterKitchenItems(allItems, db);
  if (!kitchenItems.length) return null;
  const st = String(order.kds_kitchen_status || "ordered").trim().toLowerCase();
  // Pas «Gati» porosia hiqet nga lista e kuzhinës (kamarieri njoftohet).
  if (st === "ready") return null;
  return {
    id: String(order.id),
    local_order_id: String(order.id),
    table_number: Number(tableNumber) || 0,
    waiter_name: order.waiter_name || "",
    items_json: kitchenItems,
    total: itemsTotal(kitchenItems),
    ordered_at: order.created_at || new Date().toISOString(),
    accepted_at: order.kds_kitchen_accepted_at || null,
    accepted_by_waiter_name: order.kds_kitchen_accepted_by || "",
    ready_at: order.kds_kitchen_ready_at || null,
    device_id: order.cloud_order_id ? "WEB-WAITER" : "POS",
    status: st === "refused" ? "ordered" : st || "ordered",
    refused_at: st === "refused" ? order.kds_kitchen_refused_at || null : null,
    refuse_reason: order.kds_kitchen_refuse_reason || "",
  };
}

/** Porosi me artikuj kuzhine që duhen parë në KDS (pa «ready»). */
function orderEligibleForKitchenQueue(order, db) {
  if (!order || String(order.status || "") !== "active") return false;
  const kitchenItems = filterKitchenItems(parseItems(order.items_json), db);
  if (!kitchenItems.length) return false;
  const st = String(order.kds_kitchen_status || "").trim().toLowerCase();
  if (st === "ready") return false;
  if (st === "ordered" || st === "accepted" || st === "refused") return true;
  return (Number(order.batch_count) || 0) > 0;
}

function listKitchenOrders(db) {
  const rows = db.db.prepare(`
    SELECT o.*, t.number AS table_number
    FROM orders o
    JOIN tables t ON t.id = o.table_id
    WHERE o.status = 'active'
      AND (
        COALESCE(o.batch_count, 0) > 0
        OR LOWER(COALESCE(o.kds_kitchen_status, '')) IN ('ordered', 'accepted', 'refused')
      )
    ORDER BY o.created_at ASC
  `).all();
  const orders = [];
  for (const row of rows) {
    if (!orderEligibleForKitchenQueue(row, db)) continue;
    const mapped = mapOrderRow(row, row.table_number, db);
    if (mapped) orders.push(mapped);
  }
  return orders;
}

/** Porosi «Gati» lokale — alarm te kamarieri (pa cloud). */
function listWaiterReadyKitchenOrders(db, dismissedSet) {
  const dismissed = dismissedSet instanceof Set ? dismissedSet : new Set();
  const rows = db.db.prepare(`
    SELECT o.*, t.number AS table_number
    FROM orders o
    JOIN tables t ON t.id = o.table_id
    WHERE o.status = 'active'
      AND LOWER(COALESCE(o.kds_kitchen_status, '')) = 'ready'
    ORDER BY o.kds_kitchen_ready_at ASC, o.id ASC
  `).all();
  const out = [];
  for (const row of rows) {
    const id = String(row.id);
    if (dismissed.has(id)) continue;
    const kitchenItems = filterKitchenItems(parseItems(row.items_json), db);
    if (!kitchenItems.length) continue;
    out.push({
      id,
      local_order_id: id,
      table_number: Number(row.table_number) || 0,
      waiter_name: row.waiter_name || "",
      items_json: kitchenItems,
      total: itemsTotal(kitchenItems),
      status: "ready",
      ready_at: row.kds_kitchen_ready_at || null,
      device_id: row.cloud_order_id ? "WEB-WAITER" : "POS",
    });
  }
  return out;
}

function listKitchenCancelledOrders(_db) {
  return [];
}

function getOrderForKds(db, orderId) {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id < 1) return null;
  return db.db.prepare(`
    SELECT o.*, t.number AS table_number
    FROM orders o
    JOIN tables t ON t.id = o.table_id
    WHERE o.id = ?
  `).get(id);
}

function touchOrderAfterSend(db, orderId) {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id < 1) return;
  const order = getOrderForKds(db, id);
  if (!order) return;
  const kitchenItems = filterKitchenItems(parseItems(order.items_json), db);
  if (!kitchenItems.length) return;
  const st = String(order.kds_kitchen_status || "").trim().toLowerCase();
  if (st === "ready") {
    db.db.prepare(`
      UPDATE orders SET
        kds_kitchen_status = 'ordered',
        kds_kitchen_ready_at = NULL
      WHERE id = ? AND status = 'active'
    `).run(id);
    return;
  }
  db.db.prepare(`
    UPDATE orders SET kds_kitchen_status = 'ordered'
    WHERE id = ? AND status = 'active'
  `).run(id);
}

function acceptKitchenOrder(db, orderId, acceptedBy) {
  const order = getOrderForKds(db, orderId);
  if (!order || order.status !== "active") throw new Error("Porosia nuk u gjet.");
  const now = new Date().toISOString();
  const name = String(acceptedBy || "Kuzhina").trim() || "Kuzhina";
  db.db.prepare(`
    UPDATE orders SET
      kds_kitchen_status = 'accepted',
      kds_kitchen_accepted_at = ?,
      kds_kitchen_accepted_by = ?
    WHERE id = ?
  `).run(now, name, order.id);
  return getOrderForKds(db, order.id);
}

function refuseKitchenOrder(db, orderId, reason) {
  const order = getOrderForKds(db, orderId);
  if (!order || order.status !== "active") throw new Error("Porosia nuk u gjet.");
  const now = new Date().toISOString();
  const why = String(reason || "Pa arsye").trim();
  db.db.prepare(`
    UPDATE orders SET
      kds_kitchen_status = 'refused',
      kds_kitchen_refused_at = ?,
      kds_kitchen_refuse_reason = ?
    WHERE id = ?
  `).run(now, why, order.id);
  return getOrderForKds(db, order.id);
}

function markKitchenOrderReady(db, orderId) {
  const order = getOrderForKds(db, orderId);
  if (!order || order.status !== "active") throw new Error("Porosia nuk u gjet.");
  const now = new Date().toISOString();
  db.db.prepare(`
    UPDATE orders SET
      kds_kitchen_status = 'ready',
      kds_kitchen_ready_at = ?
    WHERE id = ?
  `).run(now, order.id);
  return getOrderForKds(db, order.id);
}

function listBarTablesLive(db) {
  const venue =
    db.getBusinessDisplayName?.()
    || db.getBusinessName?.()
    || db.getSetting?.("restaurant_name", "")
    || "Restorant";
  const tables = db.getTablesWithOrders();
  const out = [];
  for (const t of tables) {
    const label = t.label || `T${t.number}`;
    if (!t.order || t.order.status !== "active") {
      out.push({ label, number: t.number, status: "free" });
      continue;
    }
    const batch = Number(t.order.batch_count) || 0;
    if (batch < 1) {
      out.push({ label, number: t.number, status: "free" });
      continue;
    }
    const barItems = filterBarItems(parseItems(t.order.items_json), db);
    const kdsSt = String(t.order.kds_kitchen_status || "ordered").trim().toLowerCase();
    const orderStatus = kdsSt === "ready" ? "ready" : "ordered";
    out.push({
      label,
      number: t.number,
      status: "occupied",
      order: {
        total: itemsTotal(barItems),
        waiter_name: t.order.waiter_name || "",
        order_status: orderStatus,
        source_code: t.order.cloud_order_id ? "table" : "pos",
        accepted_by: t.order.kds_kitchen_accepted_by || "",
      },
    });
  }
  return {
    restaurant_name: venue,
    client_name: venue,
    updated_at: new Date().toISOString(),
    tables: out,
  };
}

module.exports = {
  listKitchenOrders,
  listKitchenCancelledOrders,
  listWaiterReadyKitchenOrders,
  listBarTablesLive,
  touchOrderAfterSend,
  acceptKitchenOrder,
  refuseKitchenOrder,
  markKitchenOrderReady,
  mapOrderRow,
  orderEligibleForKitchenQueue,
};
