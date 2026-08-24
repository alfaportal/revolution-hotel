/**
 * Poll porositë nga cloud — alarm për të papranuara.
 * WEB-WAITER / QR të pranuara: auto-import + print kupon porosie (bar/kuzhinë).
 * Kupon mbylljeje: nga paneli ose SSE cloud close (close-table-print).
 */
const cloudSync = require("./cloud-sync");

const POLL_MS = 2000;
/** Porosi që askush nuk prek — zhduken nga popup pas 60s (jo grace REFUZO 2 min). */
const UNTOUCHED_PENDING_EXPIRE_MS = 60 * 1000;
const PRINTED_KEY = "online_orders_printed_ids";
const LOCAL_ACK_KEY = "online_orders_local_ack_ids";
const LOCAL_REFUSED_KEY = "online_orders_staff_refused";

let printedIds = new Set();
let alarmIds = new Set();
let lastKnownOrders = [];
let lastSnapshot = { pending: 0, orderIds: [], orders: [], connected: false, ok: true };
let timer = null;
let tickInFlight = null;

function removeOrdersFromSnapshot(orderIds) {
  const drop = new Set((orderIds || []).map(id => String(id || "")).filter(Boolean));
  if (!drop.size) return;
  const orders = (lastSnapshot.orders || []).filter(o => o?.id && !drop.has(String(o.id)));
  lastSnapshot = {
    ...lastSnapshot,
    orders,
    pending: orders.length,
    orderIds: orders.map(o => o.id),
    has_pending: orders.length > 0,
    has_new: orders.some(o => !alarmIds.has(String(o.id))),
  };
}

function loadLocalAckIds(db) {
  try {
    return new Set(JSON.parse(db.getSetting(LOCAL_ACK_KEY, "[]")));
  } catch {
    return new Set();
  }
}

function saveLocalAckIds(db, ids) {
  const cur = loadLocalAckIds(db);
  for (const id of ids || []) cur.add(String(id));
  db.setSetting(LOCAL_ACK_KEY, JSON.stringify([...cur].slice(-400)));
}

function isLocallyAcked(db, orderId) {
  return loadLocalAckIds(db).has(String(orderId || ""));
}

function loadStaffRefusedMap(db) {
  try {
    return JSON.parse(db.getSetting(LOCAL_REFUSED_KEY, "{}"));
  } catch {
    return {};
  }
}

function persistStaffRefusal(db, staffId, orderId) {
  const sid = staffId != null ? String(staffId) : "";
  const oid = String(orderId || "").trim();
  if (!sid || !oid) return;
  const map = loadStaffRefusedMap(db);
  const cur = new Set(Array.isArray(map[sid]) ? map[sid] : []);
  cur.add(oid);
  map[sid] = [...cur].slice(-200);
  db.setSetting(LOCAL_REFUSED_KEY, JSON.stringify(map));
}

function isStaffRefusedOrder(db, staffId, orderId) {
  const sid = staffId != null ? String(staffId) : "";
  const oid = String(orderId || "").trim();
  if (!sid || !oid) return false;
  const list = loadStaffRefusedMap(db)[sid] || [];
  return list.includes(oid);
}

function parseRefusedWaiterIds(o) {
  const raw = o?.refused_by_waiter_ids;
  if (Array.isArray(raw)) return raw.map(id => String(id || "").trim()).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(id => String(id || "").trim()).filter(Boolean);
    } catch { /* ignore */ }
  }
  return [];
}

function isInRefusalGraceOrder(o, nowMs = Date.now()) {
  if (o?.in_refusal_grace === true) return true;
  if (!o?.refused_at) return false;
  const exp = o?.order_expires_at;
  if (!exp) return true;
  return new Date(exp).getTime() > nowMs;
}

function isExplicitlyAccepted(o) {
  if (!o) return false;
  if (cloudSync.isCloudOrderAccepted?.(o)) return true;
  if (o.accepted_at) return true;
  if (String(o.accepted_by_waiter_name || "").trim()) return true;
  const handler = String(o.accepted_by || "").trim();
  const customer = String(o.customer_label || "").trim();
  return !!(handler && handler !== customer);
}

function buildAcceptedIdSet(allOrders) {
  const ids = new Set();
  for (const o of allOrders || []) {
    if (o?.id && isExplicitlyAccepted(o)) ids.add(String(o.id));
  }
  return ids;
}

function buildCloudLiveIdSet(data, allOrders) {
  const ids = new Set();
  for (const o of [...(data?.orders || []), ...(allOrders || [])]) {
    if (o?.id) ids.add(String(o.id));
  }
  return ids;
}

function findCachedOrderById(orderId, db, allOrders) {
  const want = String(orderId || "");
  if (!want) return null;
  for (const o of safeListLocalPending(db)) {
    if (String(o?.id) === want) return normalizePendingOrder(o);
  }
  for (const o of lastSnapshot.orders || []) {
    if (String(o?.id) === want) return normalizePendingOrder(o);
  }
  for (const o of allOrders || []) {
    if (String(o?.id) === want) return o;
  }
  return null;
}

/** ID që cloud i ka pranuar, mbyllur, ose nuk i kthen më — hiqen nga cache lokale. */
function buildCloudResolvedIdSet(data, allOrders, db) {
  const resolved = new Set();
  const connected = !!data?.connected && data?.ok !== false;

  for (const o of [...(allOrders || []), ...(data?.orders || [])]) {
    if (o?.id && isExplicitlyAccepted(o)) resolved.add(String(o.id));
  }

  if (!connected) return resolved;

  const cloudLive = buildCloudLiveIdSet(data, allOrders);
  const localIds = new Set();
  for (const o of safeListLocalPending(db)) {
    if (o?.id) localIds.add(String(o.id));
  }
  for (const o of lastSnapshot.orders || []) {
    if (o?.id) localIds.add(String(o.id));
  }

  for (const id of localIds) {
    if (resolved.has(id) || cloudLive.has(id)) continue;
    const cached = findCachedOrderById(id, db, allOrders);
    if (cached && isInRefusalGraceOrder(cached)) continue;
    resolved.add(id);
  }

  return resolved;
}

function orderStillPending(o, suppressIds) {
  if (!o?.id) return false;
  if (suppressIds?.has(String(o.id))) return false;
  if (isExplicitlyAccepted(o)) return false;
  if (isInRefusalGraceOrder(o) && isOrderExpiredGrace(o)) return false;
  return true;
}

function syncAlarmIds(finalPending) {
  const live = new Set((finalPending || []).map(o => String(o.id)).filter(Boolean));
  for (const id of [...alarmIds]) {
    if (!live.has(id)) alarmIds.delete(id);
  }
}

function pendingFirstSeenMap(db) {
  if (typeof db.listPendingCloudOrderFirstSeen === "function") {
    return db.listPendingCloudOrderFirstSeen();
  }
  return new Map();
}

function splitUntouchedExpiredPending(db, orders) {
  const firstSeenMap = pendingFirstSeenMap(db);
  const nowMs = Date.now();
  const live = [];
  const expiredIds = [];
  for (const o of orders || []) {
    if (!o?.id) continue;
    if (isInRefusalGraceOrder(o)) {
      live.push(o);
      continue;
    }
    const firstSeenIso = firstSeenMap.get(String(o.id));
    const firstMs = firstSeenIso ? new Date(firstSeenIso).getTime() : NaN;
    if (!Number.isFinite(firstMs) || nowMs - firstMs <= UNTOUCHED_PENDING_EXPIRE_MS) {
      live.push(o);
      continue;
    }
    expiredIds.push(String(o.id));
  }
  return { live, expiredIds };
}

function expireUntouchedPendingOrders(db, orderIds) {
  purgeCloudResolvedOrders(db, orderIds);
}

function purgeCloudResolvedOrders(db, orderIds) {
  const ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return;
  purgeRemoteHandledOrderIds(db, ids);
  saveLocalAckIds(db, ids);
}

function normalizePendingOrder(o) {
  if (!o?.id) return null;
  let items = o.items;
  if (!items?.length && o.items_json) {
    try {
      items = typeof o.items_json === "string" ? JSON.parse(o.items_json) : o.items_json;
    } catch {
      items = [];
    }
  }
  return { ...o, items: items || [] };
}

function orderSortKey(o) {
  return String(o.ordered_at || o.created_at || "");
}

function safeListLocalPending(db) {
  try {
    if (typeof db.listPendingCloudOrders !== "function") return [];
    return db.listPendingCloudOrders();
  } catch (err) {
    console.warn("Radha lokale:", err.message);
    return [];
  }
}

function safeUpsertLocalPending(db, orders) {
  try {
    if (orders.length && typeof db.upsertPendingCloudOrders === "function") {
      db.upsertPendingCloudOrders(orders);
    }
  } catch (err) {
    console.warn("Ruajtje radhe:", err.message);
  }
}

function safeRemoveLocalPending(db, ids) {
  try {
    if (ids.length && typeof db.removePendingCloudOrders === "function") {
      db.removePendingCloudOrders(ids);
    }
  } catch (err) {
    console.warn("Pastrim radhe:", err.message);
  }
}

function dropLocallyHandled(db, orders) {
  return (orders || []).filter(o => {
    if (!o?.id) return false;
    if (typeof db.isCloudOrderHandledLocally === "function" && db.isCloudOrderHandledLocally(o.id)) {
      return false;
    }
    if (isInRefusalGraceOrder(o) && isOrderExpiredGrace(o)) return false;
    return true;
  });
}

function isOrderExpiredGrace(o, nowMs = Date.now()) {
  const exp = o?.order_expires_at;
  if (!exp) return false;
  return new Date(exp).getTime() <= nowMs;
}

function mergePending(db, cloudPending, localRows, suppressIds) {
  const byId = new Map();
  for (const o of cloudPending) {
    if (!o?.id || isLocallyAcked(db, o.id)) continue;
    if (!orderStillPending(o, suppressIds)) continue;
    byId.set(String(o.id), o);
  }
  for (const raw of localRows) {
    const o = normalizePendingOrder(raw);
    if (!o?.id || byId.has(String(o.id))) continue;
    if (!orderStillPending(o, suppressIds)) continue;
    if (!isLocallyAcked(db, o.id)) byId.set(String(o.id), o);
  }
  return [...byId.values()].sort((a, b) => orderSortKey(a).localeCompare(orderSortKey(b)));
}

function loadPrintedIds(db) {
  try {
    printedIds = new Set(JSON.parse(db.getSetting(PRINTED_KEY, "[]")));
  } catch {
    printedIds = new Set();
  }
}

function savePrintedIds(db) {
  db.setSetting(PRINTED_KEY, JSON.stringify([...printedIds].slice(-400)));
}

/**
 * Printon kuponin e porosisë pas auto-import WEB-WAITER / QR.
 * Fire-and-forget; printedIds vetëm pas suksesit.
 */
async function printOrderSlipAfterImport(db, printBarTicket, cloudOrder, importResult, waiterName) {
  if (typeof printBarTicket !== "function") return;
  if (!importResult?.ok || importResult.closed || importResult.cancelled) return;
  if (importResult.already && !importResult.merged) return;

  const cloudId = String(cloudOrder?.id || "").trim();
  if (!cloudId || printedIds.has(cloudId)) return;

  let slipItems = Array.isArray(importResult.batch_items) ? importResult.batch_items : [];
  if (!slipItems.length && importResult.table_id && typeof db.getActiveOrderForTable === "function") {
    try {
      const order = db.getActiveOrderForTable(importResult.table_id);
      slipItems = JSON.parse(order?.items_json || "[]");
    } catch {
      slipItems = [];
    }
  }
  if (!slipItems.length) return;

  try {
    const order =
      typeof db.getActiveOrderForTable === "function"
        ? db.getActiveOrderForTable(importResult.table_id)
        : null;
    let batchNo = 0;
    if (order && typeof db.recordPrintedBatch === "function") {
      batchNo = db.recordPrintedBatch(order.id, order.items_json);
    }
    console.log("[online-orders] print order slip", {
      cloudId,
      table: importResult.table_number || cloudOrder?.table_number,
      items: slipItems.length,
    });
    const result = await printBarTicket({
      tableNumber: Number(importResult.table_number) || Number(cloudOrder?.table_number) || 0,
      waiterName: importResult.waiter_name || waiterName || cloudOrder?.waiter_name || "Kamarier",
      items: slipItems,
      batchNumber: batchNo,
      order,
      acceptedBy: waiterName || importResult.waiter_name || "",
    });
    if (result?.printed) {
      printedIds.add(cloudId);
      try { savePrintedIds(db); } catch { /* */ }
    } else {
      console.warn("[online-orders] order slip nuk u printua:", result?.message || result?.printMessage || "printed=false");
    }
  } catch (e) {
    console.warn("[online-orders] print order slip after import:", e.message || e);
  }
}

function getLastKnownOrders() {
  return lastKnownOrders.map(o => ({ ...o, items: o.items ? [...o.items] : [] }));
}

function getSnapshot() {
  return { ...lastSnapshot, orders: lastSnapshot.orders ? [...lastSnapshot.orders] : [] };
}

function cloudReady(db) {
  if (typeof cloudSync.isCloudConfigured === "function") {
    return cloudSync.isCloudConfigured(db);
  }
  try {
    const cfg = cloudSync.getConfig(db);
    return !!(cfg?.celesi && cfg?.serverUrl);
  } catch {
    return false;
  }
}

function isLoginNotifyPendingOrder(o, db) {
  if (!o?.id || isExplicitlyAccepted(o)) return false;
  if (typeof db?.isGuestHotelServiceOrder === "function" && db.isGuestHotelServiceOrder(o)) return true;
  if (typeof db?.isCloudPosAcceptQueueOrder === "function" && db.isCloudPosAcceptQueueOrder(o)) return true;
  if (typeof db?.isCloudOnlinePickupOrder === "function" && db.isCloudOnlinePickupOrder(o)) return true;
  const device = String(o?.device_id || "").trim().toUpperCase();
  return device === "WEB-PUBLIC";
}

function isPosAcceptQueueOrder(o, db) {
  if (typeof db?.isCloudPosAcceptQueueOrder === "function") {
    return db.isCloudPosAcceptQueueOrder(o);
  }
  const device = String(o?.device_id || "").trim().toUpperCase();
  if (device === "WEB-WAITER") return false;
  if (device === "WEB-PUBLIC") return isLoginNotifyPendingOrder(o, db);
  return (Number(o?.table_number) || 0) > 0;
}

async function tick(db, printBarTicket) {
  if (tickInFlight) return tickInFlight;
  tickInFlight = (async () => {
  if (!cloudReady(db)) {
    const localOnly = dropLocallyHandled(
      db,
      mergePending(db, [], safeListLocalPending(db), new Set()),
    ).filter((o) => isLoginNotifyPendingOrder(o, db));
    syncAlarmIds(localOnly);
    lastSnapshot = {
      ok: true,
      pending: localOnly.length,
      orderIds: localOnly.map((o) => o.id),
      orders: localOnly,
      connected: false,
      has_pending: localOnly.length > 0,
      has_new: localOnly.some((o) => !alarmIds.has(String(o.id))),
      message: localOnly.length ? "Porosi lokale (QR / shërbime dhoma)" : "",
    };
    return lastSnapshot;
  }

  const data = await cloudSync.fetchOnlineOrders(db);
  const allOrders = (data.all_orders || []).map(normalizePendingOrder).filter(Boolean);
  if (allOrders.length) lastKnownOrders = allOrders;
  const connected = !!data.connected && data.ok !== false;
  const resolvedIds = buildCloudResolvedIdSet(data, allOrders, db);
  if (resolvedIds.size) {
    purgeCloudResolvedOrders(db, [...resolvedIds]);
  }
  const suppressIds = resolvedIds;

  // Auto-import: porositë me tavolinë nga cloud që nuk janë ende lokalisht
  // - WEB-WAITER (kamarier nga telefoni) → importo gjithmonë
  // - QR/kiosk të pranuara (nga bari ose gjetkë) → importo pasi nuk shfaqen më në pending
  if (data.ok !== false && data.connected && typeof db.importCloudOrderToLocal === "function") {
    const ordersToAutoImport = allOrders.filter(o => {
      if (!o?.id) return false;
      if ((Number(o.table_number) || 0) <= 0) return false;
      if (typeof db.isCloudOrderHandledLocally === "function" && db.isCloudOrderHandledLocally(o.id)) return false;
      const device = String(o.device_id || "").trim().toUpperCase();
      if (device === "WEB-WAITER") return true;
      // Porosi QR/kiosk që janë pranuar (nuk shfaqen në radhën pending të POS)
      if (isExplicitlyAccepted(o) && isPosAcceptQueueOrder(o, db)) return true;
      return false;
    });
    for (const order of ordersToAutoImport) {
      try {
        const wName = String(
          order.accepted_by_waiter_name || order.accepted_by || order.waiter_name || "Kamarier"
        ).trim();
        const imported = db.importCloudOrderToLocal(order, wName);
        void printOrderSlipAfterImport(db, printBarTicket, order, imported, wName);
      } catch {
        /* artikujt mund të mos njohen lokalisht — injorohet */
      }
    }

    // Takeaway/Delivery të pranuara → importo vetëm për kamarierin që e pranoi (emër lokal)
    try {
      const slotLayout = await cloudSync.fetchOnlineSlotLayout(db, { unfiltered: true });
      for (const slot of slotLayout) {
        if (slot.status !== "accepted" || !slot.order?.id) continue;
        if (typeof db.isCloudOnlinePickupOrder === "function" && !db.isCloudOnlinePickupOrder(slot.order)) continue;
        if (typeof db.isCloudOrderHandledLocally === "function" && db.isCloudOrderHandledLocally(slot.order.id)) continue;
        const acceptName = String(slot.order.accepted_by_waiter_name || "").trim();
        if (!acceptName) continue;
        const localStaff = typeof db.findStaffByNameInsensitive === "function"
          ? db.findStaffByNameInsensitive(acceptName)
          : null;
        if (!localStaff) continue;
        try {
          const imported = db.importCloudOrderToLocal({ ...slot.order, online_slot: slot.slot }, acceptName);
          void printOrderSlipAfterImport(db, printBarTicket, slot.order, imported, acceptName);
        } catch {
          /* injoro */
        }
      }
    } catch {
      /* offline */
    }
  }

  // Beso listën e serverit — QR tavolinë + takeaway/delivery (WEB-PUBLIC)
  let cloudPending = (data.orders || []).map(normalizePendingOrder).filter(o => o?.id && isLoginNotifyPendingOrder(o, db));

  if (!cloudPending.length && allOrders.length) {
    cloudPending = allOrders.filter(o => o?.id && !isExplicitlyAccepted(o) && isLoginNotifyPendingOrder(o, db));
  }

  if (data.ok !== false && data.connected) {
    safeUpsertLocalPending(db, cloudPending);
    if (typeof db.ensureTablesForPendingCloudOrders === "function") {
      db.ensureTablesForPendingCloudOrders(cloudPending);
    }
  }
  safeRemoveLocalPending(db, [...loadLocalAckIds(db)]);

  const pendingOrders = dropLocallyHandled(
    db,
    mergePending(db, cloudPending, safeListLocalPending(db), suppressIds),
  );
  const staleLocalIds = safeListLocalPending(db)
    .filter(o => o?.id && !isLoginNotifyPendingOrder(o, db))
    .map(o => o.id);
  safeRemoveLocalPending(db, staleLocalIds);
  let finalPending = pendingOrders.filter(o => orderStillPending(o, suppressIds));
  if (!finalPending.length && !connected && (lastSnapshot.orders || []).length) {
    finalPending = lastSnapshot.orders.filter(
      o => orderStillPending(o, suppressIds) && !isLocallyAcked(db, o.id),
    );
  }

  const expiredSplit = splitUntouchedExpiredPending(db, finalPending);
  finalPending = expiredSplit.live;
  if (expiredSplit.expiredIds.length) {
    expireUntouchedPendingOrders(db, expiredSplit.expiredIds);
  }

  syncAlarmIds(finalPending);

  lastSnapshot = {
    ok: connected || finalPending.length > 0,
    pending: finalPending.length,
    orderIds: finalPending.map(o => o.id),
    orders: finalPending,
    connected,
    has_pending: finalPending.length > 0,
    has_new: finalPending.some(o => !alarmIds.has(String(o.id))),
    message: !connected && finalPending.length
      ? "Pa lidhje — porositë në pritje janë ruajtur lokalisht."
      : (connected
        ? (finalPending.length ? "" : "Nuk ka porosi në pritje.")
        : (data.message || "Nuk ka lidhje me serverin online.")),
  };

  for (const o of finalPending) {
    alarmIds.add(String(o.id));
  }

  return lastSnapshot;
  })().finally(() => {
    tickInFlight = null;
  });
  return tickInFlight;
}

function startOnlineOrdersWatcher(db, printBarTicket) {
  if (timer) return;
  loadPrintedIds(db);

  const run = () => {
    tick(db, printBarTicket).catch(err => {
      console.warn("Poll porosish:", err.message);
      const pending = mergePending(db, [], safeListLocalPending(db), new Set());
      lastSnapshot = {
        ok: pending.length > 0,
        pending: pending.length,
        orderIds: pending.map(o => o.id),
        orders: pending,
        connected: false,
        has_pending: pending.length > 0,
        has_new: pending.some(o => !alarmIds.has(String(o.id))),
        message: pending.length
          ? "Pa lidhje — porositë në pritje janë ruajtur lokalisht."
          : err.message,
      };
    });
  };

  run();
  timer = setInterval(run, POLL_MS);
}

function stopOnlineOrdersWatcher() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function purgeRemoteHandledOrderIds(db, orderIds) {
  const ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return;
  removeOrdersFromSnapshot(ids);
  safeRemoveLocalPending(db, ids);
  for (const id of ids) alarmIds.delete(id);
}

function persistAcknowledged(db, orderIds) {
  saveLocalAckIds(db, orderIds);
  safeRemoveLocalPending(db, orderIds);
}

function markOrdersPrinted(db, orderIds) {
  for (const id of orderIds || []) printedIds.add(String(id));
  savePrintedIds(db);
}

module.exports = {
  startOnlineOrdersWatcher,
  stopOnlineOrdersWatcher,
  getOnlineOrdersSnapshot: getSnapshot,
  getSnapshot,
  getLastKnownOrders,
  refreshOnlineOrders: (db, printBarTicket) => tick(db, printBarTicket),
  removeOrdersFromSnapshot,
  purgeRemoteHandledOrderIds,
  purgeCloudResolvedOrders,
  persistAcknowledged,
  persistStaffRefusal,
  isStaffRefusedOrder,
  isInRefusalGraceOrder,
  markOrdersPrinted,
  normalizePendingOrder,
};
