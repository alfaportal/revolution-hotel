/**
 * Poll porositë nga cloud — alarm për të papranuara.
 * WEB-WAITER / QR të pranuara: auto-import + print kupon porosie (bar/kuzhinë).
 * Kupon mbylljeje: nga paneli ose SSE cloud close (close-table-print).
 */
const cloudSync = require("./cloud-sync");

function isCloudWaiterDisabled(db) {
  try {
    return String(db.getSetting("cloud_waiter_disabled", "false")).trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

const POLL_MS = 5000;
/** Alarm popup — porosi të shkurtra (jo QR/takeaway që presin PRANO 15 min). */
const UNTOUCHED_POPUP_EXPIRE_MS = 60 * 1000;
const PENDING_ACCEPT_EXPIRE_MS = 15 * 60 * 1000;
const PRINTED_KEY = "online_orders_printed_ids";
const LOCAL_ACK_KEY = "online_orders_local_ack_ids";
const LOCAL_REFUSED_KEY = "online_orders_staff_refused";

let printedIds = new Set();
let alarmIds = new Set();
let lastKnownOrders = [];
let lastSnapshot = { pending: 0, orderIds: [], orders: [], connected: false, ok: true };
let timer = null;
let tickInFlight = null;
let printBarTicketRef = null;

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

function isExplicitlyAccepted(o, db) {
  if (!o) return false;
  if (typeof cloudSync.isCloudOrderAccepted === "function") {
    return cloudSync.isCloudOrderAccepted(o, db);
  }
  if (
    typeof db?.isQrTableOrderSubjectToAcceptGate === "function"
    && db.isQrTableOrderSubjectToAcceptGate(o)
  ) {
    return typeof db.isCloudOrderAcceptedForImport === "function"
      && db.isCloudOrderAcceptedForImport(o);
  }
  if (o.accepted_at != null && String(o.accepted_at).trim() !== "") return true;
  if (String(o.accepted_by_waiter_name || "").trim()) return true;
  return false;
}

function buildAcceptedIdSet(allOrders, db) {
  const ids = new Set();
  for (const o of allOrders || []) {
    if (o?.id && isExplicitlyAccepted(o, db)) ids.add(String(o.id));
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
    if (o?.id && isExplicitlyAccepted(o, db)) resolved.add(String(o.id));
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
    if (cached?.local_only === true) continue;
    const dev = String(cached?.device_id || "").trim().toUpperCase();
    if (dev === "WEB-PUBLIC-LOCAL") continue;
    if (
      typeof db?.isQrTableOrderSubjectToAcceptGate === "function"
      && cached
      && db.isQrTableOrderSubjectToAcceptGate(cached)
      && !isExplicitlyAccepted(cached, db)
    ) {
      continue;
    }
    resolved.add(id);
  }

  return resolved;
}

function orderStillPending(o, suppressIds, db) {
  if (!o?.id) return false;
  if (suppressIds?.has(String(o.id))) return false;
  if (isLocallyAcked(db, o.id)) return false;
  if (
    typeof db?.isCloudQrTableOrder === "function"
    && db.isCloudQrTableOrder(o)
    && typeof db.isQrCloudOrderResolvedForPos === "function"
    && db.isQrCloudOrderResolvedForPos(o)
  ) {
    return false;
  }
  if (isExplicitlyAccepted(o, db)) return false;
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

function pendingAcceptGateOrder(o, db) {
  if (!o?.id) return false;
  if (
    typeof db?.isQrTableOrderSubjectToAcceptGate === "function"
    && db.isQrTableOrderSubjectToAcceptGate(o)
  ) {
    return true;
  }
  if (
    typeof db?.isCloudOnlinePickupOrder === "function"
    && db.isCloudOnlinePickupOrder(o)
  ) {
    return true;
  }
  if (
    typeof db?.isGuestRoomMenuOrder === "function"
    && db.isGuestRoomMenuOrder(o)
  ) {
    return true;
  }
  return false;
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
    if (pendingAcceptGateOrder(o, db)) {
      const firstSeenIso = firstSeenMap.get(String(o.id));
      const firstMs = firstSeenIso ? new Date(firstSeenIso).getTime() : NaN;
      const ageMs = Number.isFinite(firstMs) ? nowMs - firstMs : 0;
      if (!Number.isFinite(firstMs) || ageMs <= PENDING_ACCEPT_EXPIRE_MS) {
        live.push(o);
      } else {
        expiredIds.push(String(o.id));
      }
      continue;
    }
    const firstSeenIso = firstSeenMap.get(String(o.id));
    const firstMs = firstSeenIso ? new Date(firstSeenIso).getTime() : NaN;
    if (!Number.isFinite(firstMs) || nowMs - firstMs <= UNTOUCHED_POPUP_EXPIRE_MS) {
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
    if (typeof db.isCloudOrderLocallyDismissed === "function" && db.isCloudOrderLocallyDismissed(o.id)) {
      return false;
    }
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
    if (!orderStillPending(o, suppressIds, db)) continue;
    byId.set(String(o.id), o);
  }
  for (const raw of localRows) {
    const o = normalizePendingOrder(raw);
    if (!o?.id || byId.has(String(o.id))) continue;
    if (!orderStillPending(o, suppressIds, db)) continue;
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
      if (importResult.merged && typeof db.getOrderSlipDelta === "function") {
        slipItems = db.getOrderSlipDelta(order);
      }
      if (!slipItems.length && !importResult.merged) {
        slipItems = JSON.parse(order?.items_json || "[]");
      }
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
  if (!o?.id || isExplicitlyAccepted(o, db)) return false;
  if (
    typeof db?.isCloudQrTableOrder === "function"
    && db.isCloudQrTableOrder(o)
    && typeof db.isQrCloudOrderResolvedForPos === "function"
    && db.isQrCloudOrderResolvedForPos(o)
  ) {
    return false;
  }
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

function tableNumFromCloudOrder(o, db) {
  if (typeof db.parseTableNumberFromCloudOrder === "function") {
    return db.parseTableNumberFromCloudOrder(o);
  }
  return Number(o?.table_number) || 0;
}

/** A duhet auto-import (e njëjta logjikë si te tick). */
function isOrderEligibleForAutoImport(o, db) {
  if (!o?.id) return false;
  if (
    typeof db.isCloudOnlinePickupOrder === "function"
    && db.isCloudOnlinePickupOrder(o)
  ) {
    if (typeof db.isCloudOrderHandledLocally === "function" && db.isCloudOrderHandledLocally(o.id)) {
      return false;
    }
    return isExplicitlyAccepted(o, db);
  }
  const tableNum = tableNumFromCloudOrder(o, db);
  if (tableNum <= 0) return false;
  const device = String(o.device_id || "").trim().toUpperCase();
  if (device === "WEB-WAITER") {
    if (isCloudWaiterDisabled(db)) {
      console.log("[watcher] SKIP WEB-WAITER import — cloud kamarieri i çaktivizuar");
      return false;
    }
    return true;
  }
  if (typeof db.isCloudOrderHandledLocally === "function" && db.isCloudOrderHandledLocally(o.id)) {
    return false;
  }
  if (
    typeof db.isQrTableOrderSubjectToAcceptGate === "function"
    && db.isQrTableOrderSubjectToAcceptGate(o)
    && typeof db.isCloudOrderAcceptedForImport === "function"
    && !db.isCloudOrderAcceptedForImport(o)
  ) {
    return false;
  }
  if (isExplicitlyAccepted(o, db) && isPosAcceptQueueOrder(o, db)) return true;
  return false;
}

function mergeKitchenSseIntoOrder(order, payload) {
  if (!order) return null;
  const acceptedBy = String(payload?.accepted_by || payload?.accepted_by_waiter_name || "").trim();
  const device = String(order.device_id || payload?.device_id || "").trim().toUpperCase();
  const tableNum = Number(order.table_number) || Number(payload?.table_number) || 0;
  const merged = {
    ...order,
    ...(device ? { device_id: device } : {}),
    ...(tableNum > 0 ? { table_number: tableNum } : {}),
  };
  if (acceptedBy) {
    merged.accepted_by_waiter_name = String(merged.accepted_by_waiter_name || acceptedBy).trim() || acceptedBy;
    merged.accepted_by = String(merged.accepted_by || acceptedBy).trim() || acceptedBy;
  }
  const st = String(payload?.status || "").trim().toLowerCase();
  if (st === "accepted" && !merged.accepted_at) {
    merged.accepted_at = merged.accepted_at || new Date().toISOString();
  }
  return merged;
}

function ssePayloadOrderIds(payload) {
  return [
    ...new Set(
      [
        ...(Array.isArray(payload?.order_ids) ? payload.order_ids : []),
        ...(payload?.order_id ? [payload.order_id] : []),
      ]
        .map(id => String(id || "").trim())
        .filter(Boolean),
    ),
  ];
}

function broadcastInstantPosRefresh(extra = {}) {
  try {
    const { broadcastWaiterRealtime } = require("./waiter-ws-hub");
    broadcastWaiterRealtime("tables", { reason: "sse_instant_import", ...extra });
    broadcastWaiterRealtime("online_orders", { reason: "sse_instant_import", ...extra });
    broadcastWaiterRealtime("cloud_tables", { reason: "sse_instant_import", ...extra });
  } catch {
    /* ignore */
  }
}

/**
 * Import i një porosie cloud → SQLite + print slip (nëse ka).
 * @returns {{ imported: boolean, result?: object, order?: object, waiterName?: string }}
 */
async function attachOnlineSlotForPickupOrders(db, orders) {
  const list = (orders || []).filter(Boolean);
  if (!list.some(o => typeof db.isCloudOnlinePickupOrder === "function" && db.isCloudOnlinePickupOrder(o))) {
    return list;
  }
  let layout = [];
  try {
    layout = await cloudSync.fetchOnlineSlotLayout(db, { unfiltered: true });
  } catch {
    /* offline */
  }
  return list.map(o => {
    if (typeof db.isCloudOnlinePickupOrder !== "function" || !db.isCloudOnlinePickupOrder(o)) return o;
    const hit = layout.find(s => String(s.order?.id || "") === String(o.id));
    if (hit?.slot) return { ...o, online_slot: hit.slot };
    return o;
  });
}

async function autoImportOneCloudOrder(db, printBarTicket, rawOrder) {
  if (!rawOrder?.id || typeof db.importCloudOrderToLocal !== "function") {
    return { imported: false };
  }
  const earlyCloudId = String(rawOrder.id || "").trim();
  if (
    earlyCloudId
    && typeof db.isCloudOrderHandledLocally === "function"
    && db.isCloudOrderHandledLocally(earlyCloudId)
    && typeof db.getActiveOrderByCloudId === "function"
  ) {
    const active = db.getActiveOrderByCloudId(earlyCloudId);
    if (active) {
      return {
        imported: false,
        result: { ok: true, already: true, order_id: active.id },
        order: normalizePendingOrder(rawOrder),
      };
    }
  }
  let order = normalizePendingOrder(rawOrder);
  if (!order) return { imported: false };

  const parsedTn = tableNumFromCloudOrder(order, db);
  if (parsedTn > 0 && !(Number(order.table_number) > 0)) {
    order = { ...order, table_number: parsedTn };
  }

  const isQrTable =
    typeof db.isQrTableOrderSubjectToAcceptGate === "function"
    && db.isQrTableOrderSubjectToAcceptGate(order);
  let wName = String(
    order.accepted_by_waiter_name || order.accepted_by || order.waiter_name || "",
  ).trim();
  if (isQrTable && typeof db.resolveLocalWaiterForCloudOrder === "function") {
    wName = db.resolveLocalWaiterForCloudOrder(order) || wName;
  }
  if (isQrTable) {
    const staffOk =
      typeof db.isLocalWaiterStaffName === "function"
        ? db.isLocalWaiterStaffName(wName)
        : !!(typeof db.findStaffByNameInsensitive === "function"
          && db.findStaffByNameInsensitive(wName));
    if (!staffOk) {
      console.warn("[online-orders] QR skip import — emri i pranuesit nuk është staf lokal:", wName || "(bosh)");
      return { imported: false };
    }
    const localStaff =
      typeof db.findStaffByNameInsensitive === "function"
        ? db.findStaffByNameInsensitive(wName)
        : null;
    if (localStaff?.name) wName = String(localStaff.name).trim();
  } else if (!wName) {
    wName = "Kamarier";
  }

  try {
    const imported = db.importCloudOrderToLocal(order, wName);
    if (imported?.needs_accept || (imported && imported.ok === false && !imported.already)) {
      return { imported: false, result: imported, order, waiterName: wName };
    }
    const slipDelta = Array.isArray(imported.batch_items) && imported.batch_items.length > 0;
    const didWrite =
      imported?.ok
      && !imported?.needs_accept
      && (imported.already === false || imported.merged || slipDelta);
    void printOrderSlipAfterImport(db, printBarTicket, order, imported, wName);
    return { imported: !!didWrite, result: imported, order, waiterName: wName };
  } catch (err) {
    console.warn("[online-orders] auto-import:", err.message || err);
    return { imported: false };
  }
}

async function fetchCloudOrdersForKitchenSse(db, payload) {
  const wantIds = ssePayloadOrderIds(payload);
  const tableHint = Number(payload?.table_number) || 0;
  const deviceHint = String(payload?.device_id || "").trim().toUpperCase();
  const attempts = 5;
  const delays = [0, 60, 120, 200, 350];

  for (let i = 0; i < attempts; i++) {
    if (delays[i] > 0) {
      await new Promise(r => setTimeout(r, delays[i]));
    }
    let data;
    try {
      data = await cloudSync.fetchOnlineOrders(db);
    } catch {
      continue;
    }
    const allOrders = (data.all_orders || []).map(normalizePendingOrder).filter(Boolean);
    if (allOrders.length) lastKnownOrders = allOrders;

    let hits = [];
    if (wantIds.length) {
      const want = new Set(wantIds);
      hits = allOrders.filter(o => want.has(String(o.id)));
      if (!hits.length) {
        hits = lastKnownOrders.filter(o => want.has(String(o.id)));
      }
    } else if (tableHint > 0) {
      hits = allOrders.filter(o => {
        const tn = tableNumFromCloudOrder(o, db);
        if (tn !== tableHint) return false;
        if (deviceHint && String(o.device_id || "").trim().toUpperCase() !== deviceHint) return false;
        return isOrderEligibleForAutoImport(o, db);
      });
    }

    if (hits.length || (i === attempts - 1 && allOrders.length)) {
      return { data, allOrders, hits };
    }
  }
  return { data: null, allOrders: lastKnownOrders, hits: [] };
}

/** Rruga kryesore SSE: import menjëherë, pastaj WS; poll 5s mbetet fallback. */
async function runKitchenSseInstantImport(db, payload) {
  const status = String(payload?.status || "").trim().toLowerCase();
  if (status !== "ordered" && status !== "accepted") return { imported: false };

  if (!cloudReady(db)) return { imported: false };

  const printBarTicket = printBarTicketRef;
  const { hits, allOrders } = await fetchCloudOrdersForKitchenSse(db, payload);
  let targets = hits.length
    ? hits
    : (ssePayloadOrderIds(payload).length
      ? []
      : (allOrders || []).filter(o => isOrderEligibleForAutoImport(o, db)));
  targets = await attachOnlineSlotForPickupOrders(db, targets);

  let importedAny = false;
  const tablesUpdated = new Set();

  for (const raw of targets) {
    const order = mergeKitchenSseIntoOrder(raw, payload);
    if (!order || !isOrderEligibleForAutoImport(order, db)) continue;
    const out = await autoImportOneCloudOrder(db, printBarTicket, order);
    if (out.imported) {
      importedAny = true;
      const tn = Number(out.result?.table_number) || tableNumFromCloudOrder(order, db);
      if (tn > 0) tablesUpdated.add(tn);
      console.log("[online-orders] SSE instant import", {
        status,
        cloud_id: order.id,
        table: tn,
      });
    }
  }

  if (importedAny) {
    broadcastInstantPosRefresh({
      status,
      table_numbers: [...tablesUpdated],
      order_ids: targets.map(o => o.id).filter(Boolean),
    });
  }

  void tick(db, printBarTicket).catch(err => {
    console.warn("[online-orders] SSE fallback tick:", err.message);
  });

  return { imported: importedAny };
}

async function tick(db, printBarTicket) {
  if (tickInFlight) return tickInFlight;
  tickInFlight = (async () => {
  if (!cloudReady(db)) {
    lastSnapshot = {
      ok: false,
      pending: 0,
      orderIds: [],
      orders: [],
      connected: false,
      has_pending: false,
      has_new: false,
      message: "Vendosni çelësin e licencës te Admin → Cloud, pastaj «Testo lidhjen».",
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
  // - WEB-WAITER (kamarier nga telefoni) → importo, përveç kur cloud_waiter_disabled
  // - QR/kiosk (WEB-KIOSK) → importo VETËM pasi pranohet (accepted_at ≠ null)
  // - QR/kiosk të pranuara (nga bari ose gjetkë) → importo pasi nuk shfaqen më në pending
  if (data.ok !== false && data.connected && typeof db.importCloudOrderToLocal === "function") {
    const ordersToAutoImport = allOrders.filter(o => isOrderEligibleForAutoImport(o, db));
    for (const order of ordersToAutoImport) {
      await autoImportOneCloudOrder(db, printBarTicket, order);
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
          if (imported?.needs_accept || (imported && imported.ok === false && !imported.already)) continue;
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
    cloudPending = allOrders.filter(o => o?.id && !isExplicitlyAccepted(o, db) && isLoginNotifyPendingOrder(o, db));
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
  let finalPending = pendingOrders.filter(o => orderStillPending(o, suppressIds, db));
  if (!finalPending.length && !connected && (lastSnapshot.orders || []).length) {
    finalPending = lastSnapshot.orders.filter(
      o => orderStillPending(o, suppressIds, db) && !isLocallyAcked(db, o.id),
    );
  }

  const expiredSplit = splitUntouchedExpiredPending(db, finalPending);
  finalPending = expiredSplit.live;
  if (expiredSplit.expiredIds.length) {
    expireUntouchedPendingOrders(db, expiredSplit.expiredIds);
  }

  syncAlarmIds(finalPending);

  const prevOrderKey = (lastSnapshot.orderIds || []).map(String).join("\0");

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

  const newOrderKey = (lastSnapshot.orderIds || []).map(String).join("\0");
  if (newOrderKey !== prevOrderKey || lastSnapshot.has_new) {
    try {
      const { broadcastWaiterRealtime } = require("./waiter-ws-hub");
      broadcastWaiterRealtime("online_orders", { pending: lastSnapshot.pending });
      if (lastSnapshot.has_new) broadcastWaiterRealtime("tables", { reason: "online_pending" });
    } catch {
      /* ignore */
    }
  }

  return lastSnapshot;
  })().finally(() => {
    tickInFlight = null;
  });
  return tickInFlight;
}

function startOnlineOrdersWatcher(db, printBarTicket) {
  if (timer) return;
  printBarTicketRef = printBarTicket;
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
  printBarTicketRef = null;
}

/** SSE status=ordered — import + WS menjëherë (WEB-WAITER / tavolinë). */
function refreshOnKitchenSseOrdered(db, payload) {
  const status = String(payload?.status || "").trim().toLowerCase();
  if (status !== "ordered") return;
  void runKitchenSseInstantImport(db, payload).catch(err => {
    console.warn("[online-orders] SSE ordered instant import:", err.message);
  });
}

/** SSE status=accepted — QR / pranim cloud → import + WS menjëherë. */
function refreshOnKitchenSseAccepted(db, payload) {
  const status = String(payload?.status || "").trim().toLowerCase();
  if (status !== "accepted") return;
  void runKitchenSseInstantImport(db, payload).catch(err => {
    console.warn("[online-orders] SSE accepted instant import:", err.message);
  });
}

function refreshOnlineOrders(db, printBarTicket) {
  return tick(db, printBarTicket);
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

function isCloudOrderSlipMarkedPrinted(cloudOrderId) {
  const id = String(cloudOrderId || "").trim();
  return id ? printedIds.has(id) : false;
}

module.exports = {
  startOnlineOrdersWatcher,
  stopOnlineOrdersWatcher,
  getOnlineOrdersSnapshot: getSnapshot,
  getSnapshot,
  getLastKnownOrders,
  refreshOnlineOrders,
  refreshOnKitchenSseOrdered,
  refreshOnKitchenSseAccepted,
  removeOrdersFromSnapshot,
  purgeRemoteHandledOrderIds,
  purgeCloudResolvedOrders,
  persistAcknowledged,
  persistStaffRefusal,
  isStaffRefusedOrder,
  isInRefusalGraceOrder,
  markOrdersPrinted,
  isCloudOrderSlipMarkedPrinted,
  normalizePendingOrder,
};
