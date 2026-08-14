const { getClientById, normalizeItems } = require("./salesService");
const { getSupabase } = require("../db");
const { notifyKitchenUpdate } = require("./kdsEvents");
const { isBarMobileOrder, isKioskWaiterName, isDirectCustomerKitchenOrder, isStaffWaiterOrder, WEB_KIOSK, WEB_PUBLIC } = require("../lib/orderSource");
const { isDrinkCategory, isDrinkItemName, isKitchenRouteItem } = require("../lib/menuGroups");
const { selectWithAcceptanceFallback, updateOrdersAcceptance, normalizeAcceptanceFields, isMissingAcceptanceColumnError } = require("../lib/salesOrderSelect");
const { getPgPool } = require("../lib/pgPool");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const categoryCache = new Map();
const CATEGORY_CACHE_MS = 60_000;
const REFUSAL_GRACE_MS = 2 * 60 * 1000;

function isMissingRefusalColumnError(error) {
  return /refused_|order_expires_at/i.test(String(error?.message || error || ""));
}

function parseRefusedWaiterIds(order) {
  const raw = order?.refused_by_waiter_ids;
  if (Array.isArray(raw)) return raw.map(id => String(id || "").trim()).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(id => String(id || "").trim()).filter(Boolean);
    } catch { /* ignore */ }
  }
  return [];
}

function normalizeRefusalFields(row = {}) {
  return {
    ...row,
    refused_at: row.refused_at ?? null,
    order_expires_at: row.order_expires_at ?? null,
    refused_by_waiter_ids: parseRefusedWaiterIds(row),
  };
}

/** Porosi që kërkojnë PRANO/REFUZO (jo porositë e kamarierit nga telefoni). */
function needsWaiterAcceptance(order) {
  if (!order || isStaffWaiterOrder(order)) return false;
  const device = String(order?.device_id || "").trim().toUpperCase();
  if (device === WEB_KIOSK || device === WEB_PUBLIC) return true;
  if (isKioskWaiterName(order?.waiter_name)) return true;
  if (device && !device.startsWith("WEB-")) return true;
  return false;
}

function isOrderExpired(order, nowMs = Date.now()) {
  const exp = order?.order_expires_at;
  if (!exp) return false;
  return new Date(exp).getTime() <= nowMs;
}

/** Porosi në grace period pas REFUZO — nuk duhet anuluar menjëherë. */
function isInRefusalGrace(order, nowMs = Date.now()) {
  const norm = normalizeRefusalFields(order);
  return !!norm.refused_at && !isOrderExpired(norm, nowMs);
}

function waiterRefusedOrder(order, waiterId) {
  const wid = String(waiterId || "").trim().toLowerCase();
  if (!wid) return false;
  return parseRefusedWaiterIds(order).some(id => id.toLowerCase() === wid);
}

/** Filtron porositë për modalin PRANO/REFUZO të kamarierit. */
function filterWaiterAcceptOrders(orders, waiterId) {
  const wid = String(waiterId || "").trim();
  return (orders || []).filter(o => {
    if (!needsWaiterAcceptance(o)) return false;
    if (o.accepted_at || String(o.accepted_by_waiter_name || "").trim()) return false;
    if (waiterRefusedOrder(o, wid)) return false;
    if (isOrderExpired(o)) return false;
    return true;
  });
}

/** Takeaway/Delivery — slotet Online 1…6 (jo QR tavolinë). */
function isOnlineSlotOrder(order) {
  if (!order || isStaffWaiterOrder(order)) return false;
  const device = String(order?.device_id || "").trim().toUpperCase();
  if (device === WEB_PUBLIC) return true;
  const tableNum = Number(order.table_number) || 0;
  if (tableNum > 0) return false;
  if (device === WEB_KIOSK || isKioskWaiterName(order?.waiter_name)) return false;
  const w = String(order?.waiter_name || "").trim().toLowerCase();
  if (w.startsWith("takeaway") || w.startsWith("delivery")) return true;
  return false;
}

function mapOrderForOnlineSlot(order) {
  const norm = normalizeRefusalFields(normalizeAcceptanceFields(order));
  return {
    id: norm.id,
    table_number: Number(norm.table_number) || 0,
    waiter_name: norm.waiter_name,
    waiter_id: norm.waiter_id,
    items_json: normalizeItems(norm.items_json),
    total: Number(norm.total) || 0,
    ordered_at: norm.ordered_at,
    device_id: norm.device_id,
    accepted_at: norm.accepted_at,
    accepted_by_waiter_id: norm.accepted_by_waiter_id,
    accepted_by_waiter_name: norm.accepted_by_waiter_name,
    refused_at: norm.refused_at,
    order_expires_at: norm.order_expires_at,
  };
}

function sameWaiterId(a, b) {
  if (!a || !b) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Porosia u pranua nga ky kamarier (ID, pastaj emër). */
function isOrderAcceptedByWaiter(order, waiterId, waiterName = "") {
  const norm = normalizeAcceptanceFields(order);
  const accepted = !!(norm.accepted_at || String(norm.accepted_by_waiter_name || "").trim());
  if (!accepted) return false;
  const acceptId = String(norm.accepted_by_waiter_id || "").trim();
  const wid = String(waiterId || "").trim();
  if (acceptId && wid && sameWaiterId(acceptId, wid)) return true;
  const acceptName = String(norm.accepted_by_waiter_name || "").trim().toLowerCase();
  const wName = String(waiterName || "").trim().toLowerCase();
  return !!(acceptName && wName && acceptName === wName);
}

/** A duhet sloti të shfaqet për këtë kamarier (pending= të gjithë, accepted= vetëm pranuesi). */
function onlineSlotVisibleToWaiter(raw, waiterId, waiterName = "") {
  const wid = String(waiterId || "").trim();
  if (!wid) return { visible: true };

  const norm = normalizeRefusalFields(normalizeAcceptanceFields(raw));
  const accepted = !!(norm.accepted_at || String(norm.accepted_by_waiter_name || "").trim());

  if (accepted) {
    if (isOrderAcceptedByWaiter(norm, wid, waiterName)) {
      return { visible: true, status: "accepted" };
    }
    return { visible: false, status: "free" };
  }

  if (waiterRefusedOrder(norm, wid)) return { visible: false, status: "free" };
  if (isOrderExpired(norm)) return { visible: false, status: "free" };
  if (!needsWaiterAcceptance(raw)) return { visible: false, status: "free" };
  return { visible: true, status: "pending" };
}

/** Ndërton Online 1…N — renditje globale ordered_at ↑; maskë per-kamarier kur waiterId. */
function buildOnlineSlotLayout(orders, { slotCount = 6, waiterId = null, waiterName = "" } = {}) {
  const count = Math.min(12, Math.max(1, Number(slotCount) || 6));
  const slots = [];
  for (let i = 1; i <= count; i += 1) {
    slots.push({ slot: i, label: `Online ${i}`, status: "free", order: null });
  }

  const onlineOrders = (orders || [])
    .filter(isOnlineSlotOrder)
    .filter(o => String(o.status || "ordered") === "ordered")
    .sort((a, b) => String(a.ordered_at || a.created_at || "").localeCompare(String(b.ordered_at || b.created_at || "")));

  onlineOrders.forEach((raw, idx) => {
    if (idx >= count) return;
    const order = mapOrderForOnlineSlot(raw);
    const accepted = !!(order.accepted_at || String(order.accepted_by_waiter_name || "").trim());

    if (!waiterId) {
      slots[idx].order = order;
      slots[idx].status = accepted ? "accepted" : "pending";
      return;
    }

    const vis = onlineSlotVisibleToWaiter(raw, waiterId, waiterName);
    if (vis.visible) {
      slots[idx].order = order;
      slots[idx].status = vis.status || (accepted ? "accepted" : "pending");
    }
  });

  return slots;
}

/**
 * Filtron sipas tavolinave të caktuara — POROSI NË GRACE PAS REFUZO shfaqen te krejt kamarierët.
 * @param {{ hasAny: boolean, byWaiter: Map<string, number[]> }} assignmentState
 */
function filterOrdersForWaiterPolling(orders, waiterId, assignmentState) {
  const state = assignmentState || { hasAny: false, byWaiter: new Map() };
  if (!state.hasAny) return orders || [];

  const allowed = new Set(state.byWaiter.get(waiterId) || []);
  const wid = String(waiterId || "").trim();

  return (orders || []).filter(o => {
    const norm = normalizeRefusalFields(o);
    const sharedAfterRefusal = norm.refused_at
      && !isOrderExpired(norm)
      && needsWaiterAcceptance(o)
      && !waiterRefusedOrder(norm, wid);
    if (sharedAfterRefusal) return true;

    const tableNum = Number(o.table_number);
    if (!tableNum) {
      return needsWaiterAcceptance(o);
    }
    return allowed.has(tableNum);
  });
}

async function fetchRefusalGraceOrders(clientId) {
  const db = getSupabase();
  const now = new Date().toISOString();
  try {
    const { data, error } = await db
      .from("sales_orders")
      .select(
        "id, table_number, waiter_name, waiter_id, items_json, total, ordered_at, created_at, local_order_id, device_id, refused_at, order_expires_at, refused_by_waiter_ids, accepted_by_waiter_id, accepted_by_waiter_name, accepted_at",
      )
      .eq("client_id", clientId)
      .eq("status", "ordered")
      .not("refused_at", "is", null)
      .gt("order_expires_at", now);
    if (error) throw error;
    return (data || []).map(o => normalizeRefusalFields(normalizeAcceptanceFields(o))).map(o => ({
      ...o,
      items_json: normalizeItems(o.items_json),
    }));
  } catch (err) {
    if (isMissingRefusalColumnError(err)) return [];
    throw err;
  }
}

function mergeOrdersById(primary, extra) {
  const byId = new Map((primary || []).map(o => [o.id, o]));
  for (const o of extra || []) {
    byId.set(o.id, { ...byId.get(o.id), ...o });
  }
  return [...byId.values()];
}

async function fetchOrderedSales(clientId) {
  const db = getSupabase();
  const base =
    "id, table_number, waiter_name, waiter_id, items_json, total, ordered_at, created_at, local_order_id, device_id";
  const refusalExtra = ", refused_at, order_expires_at, refused_by_waiter_ids";

  async function runQuery(withAcceptance, withRefusal) {
    const select = [
      base,
      withAcceptance ? ", accepted_by_waiter_id, accepted_by_waiter_name, accepted_at" : "",
      withRefusal ? refusalExtra : "",
    ].join("");
    return db
      .from("sales_orders")
      .select(select)
      .eq("client_id", clientId)
      .eq("status", "ordered")
      .order("ordered_at", { ascending: true, nullsFirst: false })
      .limit(200);
  }

  let result = await runQuery(true, true);
  if (result.error && isMissingRefusalColumnError(result.error)) {
    result = await runQuery(true, false);
  }
  if (result.error && isMissingAcceptanceColumnError(result.error)) {
    result = await runQuery(false, false);
  }
  if (result.error) throw result.error;

  return (result.data || []).map(o => normalizeRefusalFields(normalizeAcceptanceFields(o))).map(o => ({
    ...o,
    items_json: normalizeItems(o.items_json),
  }));
}

/** Porosi që duhen te banaku (QR, kamarier web, online, POS lokal) */
function isBanakOrder(order) {
  if (isBarMobileOrder(order)) return true;
  if (isKioskWaiterName(order?.waiter_name)) return true;
  const device = String(order?.device_id || "").trim();
  if (!device) return true;
  return !device.startsWith("WEB-");
}

async function loadCategoryLookup(clientId) {
  const key = String(clientId);
  const cached = categoryCache.get(key);
  if (cached && Date.now() - cached.at < CATEGORY_CACHE_MS) {
    return cached.lookup;
  }

  const db = getSupabase();
  const { data, error } = await db
    .from("pos_menu_items")
    .select("name, local_id, category")
    .eq("client_id", clientId);
  if (error) throw error;

  const byName = new Map();
  const byLocalId = new Map();
  for (const row of data || []) {
    const name = String(row.name || "").trim().toLowerCase();
    const cat = String(row.category || "").trim();
    if (name && cat) byName.set(name, cat);
    if (row.local_id != null && cat) byLocalId.set(String(row.local_id), cat);
  }

  const lookup = { byName, byLocalId };
  categoryCache.set(key, { at: Date.now(), lookup });
  return lookup;
}

function resolveItemCategory(item, lookup) {
  const inline = String(item.category || item.kategoria || "").trim();
  if (inline) return inline;
  const name = String(item.name || "").trim().toLowerCase();
  if (name && lookup.byName.has(name)) return lookup.byName.get(name);
  const menuId = item.menu_id ?? item.menu_item_id ?? item.local_id ?? item.id;
  if (menuId != null && lookup.byLocalId.has(String(menuId))) {
    return lookup.byLocalId.get(String(menuId));
  }
  return "";
}

function isKitchenItem(item, lookup) {
  const name = String(item?.name || item?.emri || "");
  const cat = resolveItemCategory(item, lookup);
  // Vetëm ushqim i qartë — TË GJITHA pijet + unknown → JO te kuzhina
  return isKitchenRouteItem(name, cat);
}

function isBarItem(item, lookup) {
  // Çdo gjë që NUK është ushqim kuzhine → bar (pije + unknown)
  return !isKitchenItem(item, lookup);
}

function itemsTotal(items) {
  return (items || []).reduce(
    (sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0),
    0,
  );
}

function mapOrderWithItems(order, items) {
  if (!items.length) return null;
  return {
    ...order,
    items_json: items,
    total: itemsTotal(items),
  };
}

async function getClientForKitchen(clientId) {
  const id = String(clientId || "").trim();
  if (!UUID_RE.test(id)) throw new Error("ID klienti nuk është i vlefshëm.");
  const client = await getClientById(id);
  if (!client) throw new Error("Klienti nuk u gjet.");
  return client;
}

/** Banak — porosi QR, kamarier, online, POS (rruga /bar/ në link) */
async function listBarOrders(clientId) {
  const orders = await fetchOrderedSales(clientId);
  const lookup = await loadCategoryLookup(clientId);
  const result = [];

  for (const order of orders) {
    if (!isBanakOrder(order)) continue;
    // Vetëm pije — mos e kthe të gjithë porosinë (ushqim) kur s’ka pije.
    const items = normalizeItems(order.items_json).filter(it => isBarItem(it, lookup));
    const mapped = mapOrderWithItems(order, items);
    if (mapped) result.push(mapped);
  }

  return result;
}

/** Kuzhina KDS — vetëm artikuj ushqimi (rruga /kitchen/ në link) */
async function listKitchenOrders(clientId) {
  const orders = await fetchOrderedSales(clientId);
  const lookup = await loadCategoryLookup(clientId);
  const result = [];

  for (const order of orders) {
    if (isDirectCustomerKitchenOrder(order)) continue;
    const items = normalizeItems(order.items_json).filter(it => isKitchenItem(it, lookup));
    const mapped = mapOrderWithItems(order, items);
    if (mapped) result.push(mapped);
  }

  return result;
}

async function acceptBarOrder(clientId, orderId, { waiterId = null, waiterName = "" } = {}) {
  const db = getSupabase();
  const name = String(waiterName || "").trim();
  const { ids } = await updateOrdersAcceptance(db, {
    clientId,
    orderIds: [orderId],
    waiterId,
    waiterName: name,
  });
  if (!ids.length) throw new Error("Porosia nuk u gjet, është pranuar tashmë, ose është mbyllur.");

  const { data, error } = await db
    .from("sales_orders")
    .select("*")
    .eq("id", orderId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Porosia nuk u gjet.");

  try {
    await db
      .from("sales_orders")
      .update({
        order_expires_at: null,
        refused_at: null,
        refused_by_waiter_ids: [],
      })
      .eq("id", orderId)
      .eq("client_id", clientId);
  } catch (err) {
    if (!isMissingRefusalColumnError(err)) throw err;
  }

  notifyKitchenUpdate(clientId, { order_id: orderId, status: "accepted", accepted_by: name });
  return data;
}

async function refuseBarOrderWithGraceViaSql(clientId, orderId, wid, reasonText = "") {
  const pool = getPgPool();
  if (!pool) return null;

  const { rows, rowCount } = await pool.query(
    `UPDATE sales_orders SET
       refused_by_waiter_ids = CASE
         WHEN refused_by_waiter_ids @> jsonb_build_array($3::text)
         THEN refused_by_waiter_ids
         ELSE refused_by_waiter_ids || jsonb_build_array($3::text)
       END,
       refused_at = COALESCE(refused_at, NOW()),
       order_expires_at = COALESCE(order_expires_at, NOW() + INTERVAL '2 minutes'),
       refuse_reason = COALESCE(NULLIF($4::text, ''), refuse_reason)
     WHERE id = $1::uuid
       AND client_id = $2::uuid
       AND status = 'ordered'
     RETURNING *`,
    [orderId, clientId, wid, String(reasonText || "").trim()],
  );
  if (!rowCount) return null;
  return rows[0];
}

function assertRefusalGraceOrder(row, orderId) {
  if (!row) throw new Error("Porosia nuk u refuzua.");
  if (String(row.status || "") !== "ordered") {
    throw new Error(`REFUZO ndryshoi statusin në «${row.status}» — duhet «ordered».`);
  }
  if (!row.refused_at || !row.order_expires_at) {
    throw new Error("REFUZO nuk vendosi refused_at/order_expires_at — ekzekutoni migrimin 040.");
  }
  console.log(
    `[refuse-grace] order=${orderId} status=${row.status} refused_at=${row.refused_at} expires=${row.order_expires_at}`,
  );
}

async function refuseBarOrderWithGrace(clientId, orderId, { waiterId = null, waiterName = "", reason = "" } = {}) {
  const db = getSupabase();
  const wid = String(waiterId || "").trim();
  if (!wid) throw new Error("Mungon identifikimi i kamarierit.");
  const { normalizeReason, logRefusalEvent } = require("./orderRefusalService");
  const reasonText = normalizeReason(reason);

  console.log("REFUZO START", { orderId, clientId, waiterId: wid, waiterName, reason: reasonText });

  const { data: order, error: fetchErr } = await db
    .from("sales_orders")
    .select("*")
    .eq("id", orderId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!order) throw new Error("Porosia nuk u gjet.");

  console.log("REFUZO FETCH", {
    orderId,
    currentStatus: order.status,
    refused_at: order.refused_at ?? null,
    order_expires_at: order.order_expires_at ?? null,
    refused_by_waiter_ids: order.refused_by_waiter_ids ?? null,
  });

  if (String(order.status || "") !== "ordered") {
    throw new Error("Porosia nuk është më aktive.");
  }
  if (!needsWaiterAcceptance(order)) {
    throw new Error("Kjo porosi nuk refuzohet nga ky ekran.");
  }
  if (order.accepted_at || String(order.accepted_by_waiter_name || "").trim()) {
    throw new Error("Porosia është pranuar tashmë.");
  }

  const normalized = normalizeRefusalFields(order);
  if (waiterRefusedOrder(normalized, wid)) {
    console.log("REFUZO SKIP", { orderId, reason: "already_refused_by_waiter" });
    return normalized;
  }

  let data = null;
  let updateVia = null;
  try {
    data = await refuseBarOrderWithGraceViaSql(clientId, orderId, wid, reasonText);
    if (data) updateVia = "sql";
  } catch (err) {
    if (isMissingRefusalColumnError(err)) {
      throw new Error("Mungon migrimi 040_order_refusal_grace.sql në Supabase.");
    }
    if (/refuse_reason/i.test(String(err.message || ""))) {
      /* fallback supabase pa kolonën e re */
    } else {
      throw err;
    }
  }

  if (!data) {
    updateVia = "supabase";
    const refusedIds = parseRefusedWaiterIds(normalized);
    refusedIds.push(wid);
    const now = new Date();
    const patch = {
      refused_by_waiter_ids: refusedIds,
      refuse_reason: reasonText,
    };
    if (!normalized.refused_at) {
      patch.refused_at = now.toISOString();
      patch.order_expires_at = new Date(now.getTime() + REFUSAL_GRACE_MS).toISOString();
    }

    let { data: updated, error } = await db
      .from("sales_orders")
      .update(patch)
      .eq("id", orderId)
      .eq("client_id", clientId)
      .eq("status", "ordered")
      .select("*")
      .maybeSingle();

    if (error && /refuse_reason/i.test(String(error.message || ""))) {
      delete patch.refuse_reason;
      ({ data: updated, error } = await db
        .from("sales_orders")
        .update(patch)
        .eq("id", orderId)
        .eq("client_id", clientId)
        .eq("status", "ordered")
        .select("*")
        .maybeSingle());
    }

    if (error) {
      if (isMissingRefusalColumnError(error)) {
        throw new Error("Mungon migrimi 040_order_refusal_grace.sql në Supabase.");
      }
      throw error;
    }
    data = updated;
  }

  assertRefusalGraceOrder(data, orderId);

  try {
    await logRefusalEvent(clientId, data, {
      waiterId: wid,
      waiterName: String(waiterName || "").trim() || wid,
      reason: reasonText,
    });
  } catch (logErr) {
    console.warn("[refuse-grace] logRefusalEvent:", logErr.message || logErr);
  }

  console.log("REFUZO END", {
    orderId,
    updateVia,
    newStatus: data.status,
    refused_at: data.refused_at,
    order_expires_at: data.order_expires_at,
    refused_by_waiter_ids: data.refused_by_waiter_ids,
    refuse_reason: reasonText,
  });

  notifyKitchenUpdate(clientId, {
    order_id: orderId,
    status: "refusal_grace",
    refused_by: String(waiterName || "").trim() || wid,
    refuse_reason: reasonText,
  });
  return normalizeRefusalFields({ ...data, refuse_reason: reasonText });
}

async function expireRefusedOrders() {
  const db = getSupabase();
  const now = new Date().toISOString();

  let rows;
  try {
    const { data, error } = await db
      .from("sales_orders")
      .select("id, client_id")
      .eq("status", "ordered")
      .not("refused_at", "is", null)
      .not("order_expires_at", "is", null)
      .lt("order_expires_at", now);
    if (error) throw error;
    rows = data || [];
  } catch (err) {
    if (isMissingRefusalColumnError(err)) return { expired: 0 };
    throw err;
  }

  let expired = 0;
  for (const row of rows) {
    const { error: updErr } = await db
      .from("sales_orders")
      .update({ status: "cancelled", closed_at: now, total: 0, ready_at: null })
      .eq("id", row.id)
      .eq("status", "ordered");
    if (updErr) {
      console.warn("[refusal-expiry] cancel row:", updErr.message);
      continue;
    }
    expired += 1;
    notifyKitchenUpdate(row.client_id, { order_id: row.id, status: "cancelled", reason: "refusal_expired" });
  }
  return { expired };
}

async function markKitchenOrderReady(clientId, orderId) {
  const db = getSupabase();
  const now = new Date().toISOString();
  const patch = { status: "ready", ready_at: now };
  const { data, error } = await db
    .from("sales_orders")
    .update(patch)
    .eq("id", orderId)
    .eq("client_id", clientId)
    .eq("status", "ordered")
    .select()
    .single();

  if (error) throw error;
  if (!data) throw new Error("Porosia nuk u gjet ose është përfunduar.");
  notifyKitchenUpdate(clientId, { order_id: orderId, status: "ready" });
  return data;
}

async function acknowledgeBarOrders(clientId, orderIds, { waiterId = null, waiterName = "" } = {}) {
  const db = getSupabase();
  const name = String(waiterName || "").trim();
  const { ids: acked } = await updateOrdersAcceptance(db, {
    clientId,
    orderIds,
    waiterId,
    waiterName: name,
  });
  if (acked.length) {
    notifyKitchenUpdate(clientId, { order_ids: acked, status: "accepted", accepted_by: name });
  }
  return { count: acked.length, ids: acked };
}

async function cancelBarOrdersViaSql(clientId, orderIds) {
  const pool = getPgPool();
  if (!pool || !orderIds.length) return null;

  const { rows } = await pool.query(
    `UPDATE sales_orders SET
       status = 'cancelled',
       closed_at = NOW(),
       total = 0,
       ready_at = NULL
     WHERE client_id = $1::uuid
       AND status = 'ordered'
       AND id = ANY($2::uuid[])
       AND NOT (
         refused_at IS NOT NULL
         AND order_expires_at IS NOT NULL
         AND order_expires_at > NOW()
       )
     RETURNING id`,
    [clientId, orderIds],
  );
  return (rows || []).map(r => r.id).filter(Boolean);
}

async function cancelBarOrders(clientId, orderIds, { force = false, reason = "unknown" } = {}) {
  console.warn("[cancelBarOrders] CALLED", {
    clientId,
    orderIds,
    force,
    reason,
    stack: new Error().stack?.split("\n").slice(1, 5).join(" | "),
  });
  const db = getSupabase();
  let ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return { count: 0, ids: [], skipped_grace: [] };

  const skippedGrace = [];
  let toCancel = ids;

  if (!force) {
    const { data: rows, error: fetchErr } = await db
      .from("sales_orders")
      .select("id, status, refused_at, order_expires_at, refused_by_waiter_ids")
      .eq("client_id", clientId)
      .in("id", ids);

    if (fetchErr && !isMissingRefusalColumnError(fetchErr)) throw fetchErr;

    if (!fetchErr && rows?.length) {
      toCancel = [];
      for (const row of rows) {
        const norm = normalizeRefusalFields(row);
        if (isInRefusalGrace(norm)) {
          console.log("[cancelBarOrders] SKIPPED - order in grace period", {
            orderId: row.id,
            refused_at: norm.refused_at,
            order_expires_at: norm.order_expires_at,
            reason,
          });
          skippedGrace.push(row.id);
          continue;
        }
        if (String(row.status || "") === "ordered") {
          toCancel.push(row.id);
        }
      }
    }
  }

  if (!toCancel.length) {
    console.log("[cancelBarOrders] nothing to cancel", { skipped_grace: skippedGrace, reason });
    return { count: 0, ids: [], skipped_grace: skippedGrace };
  }

  let cancelled = [];
  const pool = getPgPool();
  if (pool) {
    try {
      cancelled = await cancelBarOrdersViaSql(clientId, toCancel) || [];
    } catch (err) {
      if (!isMissingRefusalColumnError(err)) throw err;
    }
  }

  if (!pool && toCancel.length) {
    const now = new Date().toISOString();
    const { data, error } = await db
      .from("sales_orders")
      .update({ status: "cancelled", closed_at: now, total: 0, ready_at: null })
      .eq("client_id", clientId)
      .eq("status", "ordered")
      .in("id", toCancel)
      .select("id");

    if (error) throw error;
    cancelled = (data || []).map(row => row.id).filter(Boolean);
  }

  if (cancelled.length) {
    notifyKitchenUpdate(clientId, { order_ids: cancelled, status: "cancelled" });
  }
  return { count: cancelled.length, ids: cancelled, skipped_grace: skippedGrace };
}

async function listRecentlyCancelledOrders(clientId, windowSec = 30) {
  const db = getSupabase();
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  const { data, error } = await db
    .from("sales_orders")
    .select(
      "id, table_number, waiter_name, waiter_id, items_json, total, ordered_at, created_at, closed_at, local_order_id, device_id",
    )
    .eq("client_id", clientId)
    .eq("status", "cancelled")
    .gte("closed_at", since)
    .order("closed_at", { ascending: false })
    .limit(40);

  if (error) throw error;
  return (data || []).map(o => ({
    ...o,
    items_json: normalizeItems(o.items_json),
    cancelled: true,
  }));
}

async function listBarCancelledOrders(clientId, windowSec = 30) {
  const orders = await listRecentlyCancelledOrders(clientId, windowSec);
  return orders.filter(isBanakOrder);
}

async function listKitchenCancelledOrders(clientId, windowSec = 30) {
  const orders = await listRecentlyCancelledOrders(clientId, windowSec);
  const lookup = await loadCategoryLookup(clientId);
  const result = [];
  for (const order of orders) {
    if (isDirectCustomerKitchenOrder(order)) continue;
    const items = normalizeItems(order.items_json).filter((it) => isKitchenItem(it, lookup));
    const mapped = mapOrderWithItems(order, items);
    if (mapped) result.push({ ...mapped, cancelled: true });
  }
  return result;
}

module.exports = {
  getClientForKitchen,
  listKitchenOrders,
  listBarOrders,
  fetchOrderedSales,
  fetchRefusalGraceOrders,
  mergeOrdersById,
  listRecentlyCancelledOrders,
  listBarCancelledOrders,
  listKitchenCancelledOrders,
  acceptBarOrder,
  refuseBarOrderWithGrace,
  filterWaiterAcceptOrders,
  filterOrdersForWaiterPolling,
  isOnlineSlotOrder,
  isOrderAcceptedByWaiter,
  onlineSlotVisibleToWaiter,
  buildOnlineSlotLayout,
  expireRefusedOrders,
  isInRefusalGrace,
  needsWaiterAcceptance,
  markKitchenOrderReady,
  acknowledgeBarOrders,
  cancelBarOrders,
  isBanakOrder,
};
