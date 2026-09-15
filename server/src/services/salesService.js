const bcrypt = require("bcryptjs");
const { getSupabase } = require("../db");
const { findLicenseByKey, normalizeKey } = require("./licenseService");
const { assertLicenseUsable } = require("../lib/licenseEnforcement");
const { logOwnerActivity } = require("./ownerAuditService");

/** Arsyet e lejuara për anulimin e një fature të printuar (owner panel). */
const VOID_REASONS = {
  customer_returned: "Klienti e ktheu porosinë",
  wrong_order: "Porosi e gabuar",
  staff_error: "Gabim i stafit",
  other: "Tjetër",
};

function dateRanges() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return {
    today,
    week_from: weekAgo.toISOString().slice(0, 10),
    month_from: monthStart,
  };
}

function normalizeItems(raw) {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }
  const arr = Array.isArray(parsed) ? parsed : [];
  return arr
    .map(it => {
      const row = {
        name: String(it.name || it.emri || "").trim(),
        quantity: Number(it.quantity ?? it.sasia ?? 1) || 1,
        price: Number(it.price ?? it.cmimi ?? 0) || 0,
        menu_id: it.menu_id ?? it.id ?? it.local_id ?? null,
      };
      const cat = String(it.category || it.kategoria || "").trim();
      if (cat) row.category = cat;
      return row;
    })
    .filter(it => it.name);
}

function mergeOrderItems(existingItems, newItems) {
  const merged = normalizeItems(existingItems).map(it => ({ ...it }));
  for (const item of normalizeItems(newItems)) {
    const match = merged.find(
      it => it.name === item.name && Number(it.price) === Number(item.price),
    );
    if (match) match.quantity += item.quantity;
    else merged.push({ ...item });
  }
  return merged;
}

/** Parandalon double-submit: porosi e njëjtë brenda 60s (table + device + waiter). */
async function findRecentActiveOrderForDedup(db, {
  clientId,
  tableNumber,
  deviceId,
  waiterId = "",
  windowSec = 60,
} = {}) {
  const num = Number(tableNumber);
  if (!num || num < 1 || !clientId || !deviceId) return null;
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  let q = db
    .from("sales_orders")
    .select("id, local_order_id, device_id, waiter_id, waiter_name, items_json, total, ordered_at, status, accepted_at, accepted_by_waiter_name, accepted_by_waiter_id")
    .eq("client_id", clientId)
    .eq("table_number", num)
    .eq("device_id", deviceId)
    .in("status", ["ordered", "ready"])
    .gte("ordered_at", since)
    .order("ordered_at", { ascending: false })
    .limit(1);
  const wid = String(waiterId || "").trim();
  if (wid) q = q.eq("waiter_id", wid);
  const { data, error } = await q.maybeSingle();
  if (error) return null;
  return data || null;
}

/** Një porosi aktive për tavolinë — mbyll rreshtat e vjetër (WEB-WAITER vs POS etj.) */
async function cancelOtherActiveOrdersForTable(clientId, tableNumber, except = null) {
  const num = Number(tableNumber);
  if (!num || num < 1) return 0;
  const { isRemoteActiveTableOrder } = require("../lib/orderSource");
  const db = getSupabase();
  const { data: rows, error } = await db
    .from("sales_orders")
    .select("id, local_order_id, device_id")
    .eq("client_id", clientId)
    .eq("table_number", num)
    .in("status", ["ordered", "ready"]);
  if (error) throw error;

  const now = new Date().toISOString();
  let cancelled = 0;
  for (const row of rows || []) {
    if (
      except &&
      String(row.local_order_id) === String(except.local_order_id) &&
      String(row.device_id).toUpperCase() === String(except.device_id).toUpperCase()
    ) {
      continue;
    }
    if (isRemoteActiveTableOrder(row.device_id)) continue;
    const { error: updErr } = await db
      .from("sales_orders")
      .update({ status: "cancelled", closed_at: now, total: 0, ready_at: null })
      .eq("id", row.id);
    if (!updErr) cancelled += 1;
    else console.warn("[sales] cancel stale row:", updErr.message);
  }
  return cancelled;
}

const STALE_POS_SYNC_MS = 2 * 60 * 1000;
const EXPIRE_STARTUP_GRACE_MS = 90 * 1000;
const _salesServiceStartedAt = Date.now();

/** Anulon porositë POS në cloud pa heartbeat — tavolina kthehet «e lirë» pas 2 min. */
async function expireStalePosSyncOrders(clientId) {
  if (Date.now() - _salesServiceStartedAt < EXPIRE_STARTUP_GRACE_MS) return;

  const { isPosDesktopDevice } = require("../lib/orderSource");
  const db = getSupabase();
  const cutoffMs = Date.now() - STALE_POS_SYNC_MS;
  const now = new Date().toISOString();

  let rows;
  try {
    const { data, error } = await db
      .from("sales_orders")
      .select("id, table_number, device_id, ordered_at, pos_synced_at")
      .eq("client_id", clientId)
      .in("status", ["ordered", "ready"])
      .gte("table_number", 1);
    if (error) throw error;
    rows = data || [];
  } catch (err) {
    if (!/pos_synced_at|column|schema cache/i.test(String(err.message || ""))) {
      console.warn("[sales] expire stale sync:", err.message);
      return;
    }
    const { data, error } = await db
      .from("sales_orders")
      .select("id, table_number, device_id, ordered_at, closed_at")
      .eq("client_id", clientId)
      .in("status", ["ordered", "ready"])
      .gte("table_number", 1);
    if (error) {
      console.warn("[sales] expire stale sync:", error.message);
      return;
    }
    rows = (data || []).map(r => ({ ...r, pos_synced_at: r.closed_at }));
  }

  const freedTables = new Set();
  for (const row of rows) {
    if (!isPosDesktopDevice(row.device_id)) continue;
    const touch = row.pos_synced_at || row.ordered_at;
    if (!touch || new Date(touch).getTime() > cutoffMs) continue;

    const { error: updErr } = await db
      .from("sales_orders")
      .update({ status: "cancelled", closed_at: now, total: 0, ready_at: null })
      .eq("id", row.id);
    if (!updErr && row.table_number) freedTables.add(Number(row.table_number));
    else if (updErr) console.warn("[sales] expire stale row:", updErr.message);
  }

  if (!freedTables.size) return;

  try {
    const kds = require("./kdsEvents");
    for (const table_number of freedTables) {
      kds.notifyKitchenUpdate(clientId, { table_number, status: "free" });
    }
  } catch {
    /* optional */
  }
}

async function freeTableFromPos(body) {
  const celesi = normalizeKey(body.celesi || body.license_key);
  if (!celesi) throw new Error("Mungon çelësi i licencës.");
  const license = await findLicenseByKey(celesi);
  assertLicenseUsable(license);
  const tableNum = Number(body.table_number);
  if (!tableNum || tableNum < 1) throw new Error("Mungon numri i tavolinës.");

  const { isRemoteActiveTableOrder } = require("../lib/orderSource");
  const db = getSupabase();
  const { data: rows, error } = await db
    .from("sales_orders")
    .select("id, device_id")
    .eq("client_id", license.client_id)
    .eq("table_number", tableNum)
    .in("status", ["ordered", "ready"]);
  if (error) throw error;

  const now = new Date().toISOString();
  let cancelled = 0;
  for (const row of rows || []) {
    if (isRemoteActiveTableOrder(row.device_id)) continue;
    const { error: updErr } = await db
      .from("sales_orders")
      .update({ status: "cancelled", closed_at: now, total: 0, ready_at: null })
      .eq("id", row.id);
    if (!updErr) cancelled += 1;
  }

  try {
    require("./kdsEvents").notifyKitchenUpdate(license.client_id, {
      table_number: tableNum,
      status: "free",
    });
  } catch {
    /* optional */
  }
  return { ok: true, cancelled };
}

async function upsertSaleFromPos(body, { defaultStatus = "closed" } = {}) {
  const celesi = normalizeKey(body.celesi || body.license_key);
  if (!celesi) throw new Error("Mungon çelësi i licencës.");

  const license = await findLicenseByKey(celesi);
  assertLicenseUsable(license);

  const deviceId = String(body.device_id || license.device_id || "").trim().toUpperCase();
  const { WEB_KIOSK, WEB_PUBLIC } = require("../lib/orderSource");
  const rawItems = Array.isArray(body.items) ? body.items : JSON.parse(body.items_json || "[]");
  let items = normalizeItems(rawItems);
  let total = Number(body.total) || items.reduce((s, i) => s + i.price * i.quantity, 0);
  const now = new Date().toISOString();
  const incomingStatus = String(body.status || defaultStatus).toLowerCase();
  const allowed = ["ordered", "ready", "closed", "cancelled"];
  const status = allowed.includes(incomingStatus) ? incomingStatus : defaultStatus;

  let localOrderId = String(body.local_order_id || body.order_id || Date.now());
  const db = getSupabase();

  let { data: existing } = await db
    .from("sales_orders")
    .select("status, closed_at, ordered_at, items_json, accepted_at, accepted_by_waiter_name, accepted_by_waiter_id, local_order_id, device_id, id, total, waiter_name, waiter_id")
    .eq("client_id", license.client_id)
    .eq("local_order_id", localOrderId)
    .eq("device_id", deviceId)
    .maybeSingle();

  const tableNum = Number(body.table_number) || 0;
  if (!existing && status === "ordered" && tableNum >= 1) {
    const recent = await findRecentActiveOrderForDedup(db, {
      clientId: license.client_id,
      tableNumber: tableNum,
      deviceId,
      waiterId: body.waiter_id,
    });
    if (recent) {
      const prevItems = normalizeItems(recent.items_json);
      const nextItems = items;
      if (JSON.stringify(prevItems) === JSON.stringify(nextItems)) {
        return recent;
      }
      localOrderId = recent.local_order_id;
      existing = recent;
      items = mergeOrderItems(prevItems, nextItems);
      total = items.reduce((s, i) => s + i.price * i.quantity, 0);
    }
  }

  let finalStatus = status;
  if (existing?.status === "closed" && status === "ordered") {
    finalStatus = "closed";
  } else if (existing?.status === "ready" && status === "ordered") {
    const prevItems = JSON.stringify(normalizeItems(existing.items_json));
    const nextItems = JSON.stringify(items);
    finalStatus = prevItems === nextItems ? "ready" : "ordered";
  }

  const itemsChanged = !!existing
    && finalStatus === "ordered"
    && JSON.stringify(normalizeItems(existing.items_json)) !== JSON.stringify(items);

  const keepKey = { local_order_id: localOrderId, device_id: deviceId };
  const skipSiblingCancel = deviceId === WEB_KIOSK || deviceId === WEB_PUBLIC;
  if (tableNum >= 1 && ["ordered", "ready", "closed", "cancelled"].includes(finalStatus) && !skipSiblingCancel) {
    await cancelOtherActiveOrdersForTable(license.client_id, tableNum, keepKey);
  }

  const row = {
    client_id: license.client_id,
    license_id: license.id,
    local_order_id: localOrderId,
    device_id: deviceId,
    table_number: Number(body.table_number) || 0,
    waiter_name: String(body.waiter_name || "").trim(),
    items_json: items,
    total,
    receipt_number: String(body.receipt_number || "").trim(),
    status: finalStatus,
  };

  const waiterId = String(body.waiter_id || "").trim();
  if (waiterId) row.waiter_id = waiterId;

  const pmRaw = String(body.payment_method || "cash").trim().toLowerCase();
  row.payment_method = ["karte", "kartë", "card", "kart"].includes(pmRaw) ? "karte" : "cash";

  const { isPosDesktopDevice } = require("../lib/orderSource");
  if (isPosDesktopDevice(deviceId) && ["ordered", "ready"].includes(finalStatus)) {
    row.pos_synced_at = now;
  }

  if (finalStatus === "ordered") {
    row.ordered_at = itemsChanged ? now : (body.ordered_at || existing?.ordered_at || now);
    row.closed_at = row.ordered_at;
    row.ready_at = null;
    if (itemsChanged) {
      row.accepted_at = null;
      row.accepted_by_waiter_name = null;
      row.accepted_by_waiter_id = null;
    }
  } else if (finalStatus === "cancelled") {
    row.ordered_at = body.ordered_at || existing?.ordered_at || now;
    row.closed_at = now;
    row.ready_at = null;
    const preserveItems = items.length
      ? items
      : normalizeItems(existing?.items_json || []);
    row.items_json = preserveItems;
    row.total = 0;
  } else if (finalStatus === "ready") {
    row.ready_at = body.ready_at || now;
    row.closed_at = body.closed_at || existing?.closed_at || now;
  } else {
    row.closed_at = body.closed_at || now;
    if (finalStatus === "closed") {
      row.payment_status = "paid";
      if (!existing) {
        row.ordered_at = body.ordered_at || row.closed_at;
      }
      if (existing?.accepted_at) row.accepted_at = existing.accepted_at;
      if (existing?.accepted_by_waiter_name) {
        row.accepted_by_waiter_name = existing.accepted_by_waiter_name;
      }
      if (existing?.accepted_by_waiter_id) {
        row.accepted_by_waiter_id = existing.accepted_by_waiter_id;
      }
    }
  }

  let { data, error } = await db
    .from("sales_orders")
    .upsert(row, { onConflict: "client_id,local_order_id,device_id" })
    .select()
    .single();

  if (error && row.waiter_id && /waiter_id|schema cache/i.test(String(error.message || ""))) {
    delete row.waiter_id;
    ({ data, error } = await db
      .from("sales_orders")
      .upsert(row, { onConflict: "client_id,local_order_id,device_id" })
      .select()
      .single());
  }

  if (error && row.pos_synced_at && /pos_synced_at|schema cache/i.test(String(error.message || ""))) {
    delete row.pos_synced_at;
    ({ data, error } = await db
      .from("sales_orders")
      .upsert(row, { onConflict: "client_id,local_order_id,device_id" })
      .select()
      .single());
  }

  if (error) {
    const msg = String(error.message || error.details || error.hint || "Gabim në ruajtjen e porosisë.");
    if (/waiter_id/i.test(msg) && /column|schema cache/i.test(msg)) {
      throw new Error("Mungon migrimi i bazës së të dhënave (014_waiter_pin.sql). Ekzekutojeni në Supabase.");
    }
    if (/payment_method/i.test(msg) && /column|schema cache/i.test(msg)) {
      throw new Error("Mungon kolona payment_method te sales_orders. Ekzekutoni supabase/migrations/020_sales_payment_method.sql në Supabase.");
    }
    throw new Error(msg);
  }

  if (finalStatus === "ordered" || finalStatus === "cancelled" || finalStatus === "ready" || finalStatus === "closed") {
    const { isCustomerChannelDevice } = require("../lib/orderSource");
    const skipKdsPing = isCustomerChannelDevice(deviceId) && finalStatus === "ordered";
    if (!skipKdsPing) {
      try {
        const kds = require("./kdsEvents");
        const tableNum = Number(data?.table_number ?? body.table_number) || 0;
        kds.notifyKitchenUpdate(license.client_id, {
          order_id: data?.id,
          status: finalStatus,
          local_order_id: localOrderId,
          device_id: deviceId,
          ...(tableNum >= 1 ? { table_number: tableNum } : {}),
          ...(finalStatus === "closed"
            ? { payment_method: body.payment_method || data?.payment_method || "cash" }
            : {}),
        });
        // Mos dërgo «free» menjëherë pas «closed» — POS e liron tavolinën
        // PAS printimit të faturës. «free» i menjëhershëm anulonte porosinë
        // lokale para printClosing → fatura e mbylljes nuk dilte.
      } catch {
        /* optional */
      }
    }
  }

  return data;
}

async function buildSaleReceipt(sale, body = {}) {
  if (!sale || sale.status !== "closed") return null;
  const { formatReceiptBundle } = require("./receiptService");
  return formatReceiptBundle(sale.client_id, {
    slip_kind: "final",
    payment_method: body.payment_method || sale.payment_method || "cash",
    receipt_number: sale.receipt_number || body.receipt_number,
    order_number: sale.local_order_id || body.local_order_id,
    table_number: sale.table_number ?? body.table_number,
    waiter_name: sale.waiter_name || body.waiter_name,
    items: sale.items_json || body.items,
    total: sale.total ?? body.total,
    closed_at: sale.closed_at || body.closed_at,
    register_name: body.register_name || body.arka,
    cashier_name: body.cashier_name || body.operator_name,
  });
}

async function syncSaleFromPos(body) {
  const sale = await upsertSaleFromPos(body, { defaultStatus: "closed" });
  const device = String(body.device_id || sale?.device_id || "").trim().toUpperCase();
  const { WEB_WAITER, WEB_KIOSK, WEB_PUBLIC } = require("../lib/orderSource");
  const isWeb = [WEB_WAITER, WEB_KIOSK, WEB_PUBLIC].includes(device);
  if (!isWeb && sale?.status === "closed") {
    try {
      const { deductStockForOrder } = require("./stockService");
      await deductStockForOrder(sale.client_id, sale.items_json || body.items);
    } catch (err) {
      console.warn("[stock] POS deduct failed:", err.message);
    }
    try {
      const { deductIngredientsForOrder } = require("./inventoryService");
      await deductIngredientsForOrder(sale.client_id, sale.items_json || body.items);
    } catch (err) {
      console.warn("[inventory] POS deduct failed:", err.message);
    }
  }
  const receipt = await buildSaleReceipt(sale, body);
  return { sale, receipt };
}

async function updateActiveSaleFromPos(body) {
  const status = String(body.status || "ordered").toLowerCase();
  if (!["ordered", "cancelled"].includes(status)) {
    throw new Error("Statusi duhet të jetë ordered ose cancelled.");
  }
  return upsertSaleFromPos({ ...body, status }, { defaultStatus: "ordered" });
}

async function fetchOwnerActiveOrders(clientId) {
  const db = getSupabase();
  const { selectWithAcceptanceFallback } = require("../lib/salesOrderSelect");
  const base =
    "id, table_number, waiter_name, waiter_id, items_json, total, ordered_at, local_order_id, status, device_id";

  return selectWithAcceptanceFallback(withAcceptance => {
    const select = withAcceptance
      ? `${base}, accepted_by_waiter_id, accepted_by_waiter_name, accepted_at`
      : base;
    return db
      .from("sales_orders")
      .select(select)
      .eq("client_id", clientId)
      .in("status", ["ordered", "ready"])
      .order("ordered_at", { ascending: false });
  });
}

async function getLiveTablesForOwner(clientId) {
  const db = getSupabase();
  const { loadAreasForClient } = require("./venueService");
  const { buildTablesFromAreas } = require("../lib/tableLayout");

  await expireStalePosSyncOrders(clientId);

  const activeOrders = await fetchOwnerActiveOrders(clientId);

  const { data: settings } = await db
    .from("pos_settings")
    .select("table_count, restaurant_name")
    .eq("client_id", clientId)
    .maybeSingle();

  let areas = [];
  try {
    areas = await loadAreasForClient(clientId);
  } catch (err) {
    console.warn("[getLiveTablesForOwner] areas:", err.message);
  }

  const { orderSourceLabel } = require("../lib/orderSource");
  const metaByTable = new Map();
  const activeByTable = new Map();
  for (const o of activeOrders || []) {
    const num = Number(o.table_number) || 0;
    if (num < 1 || metaByTable.has(num)) continue;
    const src = orderSourceLabel(o);
    metaByTable.set(num, {
      id: o.id || null,
      ordered_at: o.ordered_at,
      local_order_id: o.local_order_id,
      order_status: o.status || "ordered",
      device_id: o.device_id || "",
      source_code: src.code,
      source_label: src.label,
      source_icon: src.icon,
      accepted_by: String(o.accepted_by_waiter_name || "").trim(),
      accepted_at: o.accepted_at || null,
    });
    activeByTable.set(num, {
      waiter_name: o.waiter_name || "",
      waiter_id: o.waiter_id || null,
      total: Number(o.total) || 0,
      active_items: normalizeItems(o.items_json),
    });
  }

  const layout = buildTablesFromAreas(areas, settings?.table_count, activeByTable);
  const tables = layout.tables.map(t => {
    const meta = metaByTable.get(t.number);
    const order = t.status === "occupied"
      ? {
          id: meta?.id || null,
          table_number: t.number,
          waiter_name: t.waiter_name || "",
          waiter_id: t.waiter_id || null,
          items: t.active_items || [],
          total: t.order_total || 0,
          ordered_at: meta?.ordered_at || null,
          local_order_id: meta?.local_order_id || null,
          order_status: meta?.order_status || "ordered",
          device_id: meta?.device_id || "",
          source_code: meta?.source_code || "pos",
          source_label: meta?.source_label || "",
          source_icon: meta?.source_icon || "",
          accepted_by: meta?.accepted_by || "",
          accepted_at: meta?.accepted_at || null,
        }
      : null;
    return {
      number: t.number,
      label: `T${t.number}`,
      area_name: t.area_name || null,
      status: t.status === "occupied" ? "occupied" : "free",
      order,
    };
  });

  return {
    table_count: layout.table_count,
    tables,
    areas: layout.areas,
    updated_at: new Date().toISOString(),
  };
}

async function sumSales(clientId, fromDate, toDate) {
  const db = getSupabase();
  let q = db
    .from("sales_orders")
    .select("total, closed_at")
    .eq("client_id", clientId)
    .eq("status", "closed");

  if (fromDate) q = q.gte("closed_at", `${fromDate}T00:00:00.000Z`);
  if (toDate) q = q.lte("closed_at", `${toDate}T23:59:59.999Z`);

  const { data, error } = await q;
  if (error) throw error;
  const rows = data || [];
  return {
    total: rows.reduce((s, r) => s + Number(r.total), 0),
    count: rows.length,
  };
}

async function sumSalesForClients(clientIds, fromDate, toDate) {
  const ids = [...new Set((clientIds || []).filter(Boolean))];
  if (!ids.length) return { total: 0, count: 0 };

  const db = getSupabase();
  let q = db
    .from("sales_orders")
    .select("total, closed_at")
    .in("client_id", ids)
    .eq("status", "closed");

  if (fromDate) q = q.gte("closed_at", `${fromDate}T00:00:00.000Z`);
  if (toDate) q = q.lte("closed_at", `${toDate}T23:59:59.999Z`);

  const { data, error } = await q;
  if (error) throw error;
  const rows = data || [];
  return {
    total: rows.reduce((s, r) => s + Number(r.total), 0),
    count: rows.length,
  };
}

async function countChannelOrders(clientId, deviceId, fromDate, toDate) {
  const db = getSupabase();
  let q = db
    .from("sales_orders")
    .select("id")
    .eq("client_id", clientId)
    .eq("device_id", deviceId);
  if (fromDate) q = q.gte("ordered_at", `${fromDate}T00:00:00.000Z`);
  if (toDate) q = q.lte("ordered_at", `${toDate}T23:59:59.999Z`);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).length;
}

async function countChannelOrdersForClients(clientIds, deviceId, fromDate, toDate) {
  const ids = [...new Set((clientIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  const db = getSupabase();
  let q = db
    .from("sales_orders")
    .select("id")
    .in("client_id", ids)
    .eq("device_id", deviceId);
  if (fromDate) q = q.gte("ordered_at", `${fromDate}T00:00:00.000Z`);
  if (toDate) q = q.lte("ordered_at", `${toDate}T23:59:59.999Z`);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).length;
}

async function getOwnerStats(clientId) {
  const r = dateRanges();
  const { WEB_KIOSK, WEB_PUBLIC } = require("../lib/orderSource");
  const [today, week, month, qrSot, webSot, qrJava, webJava] = await Promise.all([
    sumSales(clientId, r.today, r.today),
    sumSales(clientId, r.week_from, r.today),
    sumSales(clientId, r.month_from, r.today),
    countChannelOrders(clientId, WEB_KIOSK, r.today, r.today),
    countChannelOrders(clientId, WEB_PUBLIC, r.today, r.today),
    countChannelOrders(clientId, WEB_KIOSK, r.week_from, r.today),
    countChannelOrders(clientId, WEB_PUBLIC, r.week_from, r.today),
  ]);
  return {
    sot: today,
    java: week,
    muaj: month,
    channels: {
      qr_sot: qrSot,
      web_sot: webSot,
      qr_java: qrJava,
      web_java: webJava,
    },
  };
}

async function loadWaiterStaffMaps(clientId) {
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_staff")
    .select("id, name, active")
    .eq("client_id", clientId)
    .eq("role", "waiter");
  if (error) throw error;

  const byId = new Map();
  const byNameLower = new Map();
  const staffNames = [];
  for (const row of data || []) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    staffNames.push(name);
    byId.set(String(row.id).toLowerCase(), name);
    byNameLower.set(name.toLowerCase(), { id: row.id, name });
  }
  return { byId, byNameLower, staffNames };
}

function pgFilterQuoted(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/** Filtron porositë e mbyllura sipas emrit ose waiter_id (WEB-WAITER, QR etj.) */
function applyWaiterFilterToQuery(q, waiterName, maps) {
  const name = String(waiterName || "").trim();
  if (!name) return q;
  const staff = maps.byNameLower.get(name.toLowerCase());
  const qName = pgFilterQuoted(name);
  const parts = [`waiter_name.eq.${qName}`, `accepted_by_waiter_name.eq.${qName}`];
  if (staff?.id) {
    parts.push(`waiter_id.eq.${staff.id}`, `accepted_by_waiter_id.eq.${staff.id}`);
  }
  return q.or(parts.join(","));
}

function resolveWaiterAttribution(order, maps) {
  const acceptedName = String(order.accepted_by_waiter_name || "").trim();
  const acceptedId = order.accepted_by_waiter_id
    ? String(order.accepted_by_waiter_id).toLowerCase()
    : "";
  if (acceptedName || acceptedId) {
    return {
      name: acceptedName || maps.byId.get(acceptedId) || "",
      id: order.accepted_by_waiter_id || null,
    };
  }
  const waiterName = String(order.waiter_name || "").trim();
  const waiterId = order.waiter_id ? String(order.waiter_id).toLowerCase() : "";
  return {
    name: waiterName || (waiterId ? maps.byId.get(waiterId) : "") || "",
    id: order.waiter_id || null,
  };
}

async function listOwnerOrders(clientId, opts = {}) {
  const limit = Math.min(100, Number(opts.limit) || 50);
  const db = getSupabase();
  const maps = await loadWaiterStaffMaps(clientId);
  const { selectWithAcceptanceFallback } = require("../lib/salesOrderSelect");
  const base =
    "id, table_number, waiter_name, waiter_id, items_json, total, receipt_number, closed_at, status, device_id";

  const rows = await selectWithAcceptanceFallback(withAcceptance => {
    const select = withAcceptance
      ? `${base}, accepted_by_waiter_name, accepted_by_waiter_id, accepted_at`
      : base;
    let q = db
      .from("sales_orders")
      .select(select)
      .eq("client_id", clientId)
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(limit);

    if (opts.waiter) q = applyWaiterFilterToQuery(q, opts.waiter, maps);
    if (opts.table != null && opts.table !== "") {
      q = q.eq("table_number", Number(opts.table));
    }
    return q;
  });

  const { orderSourceLabel } = require("../lib/orderSource");
  return rows.map(o => {
    const attr = resolveWaiterAttribution(o, maps);
    return {
      ...o,
      waiter_name: attr.name || o.waiter_name || "",
      waiter_id: attr.id || o.waiter_id || null,
      items_json: normalizeItems(o.items_json),
      source: orderSourceLabel(o),
      accepted_by: String(o.accepted_by_waiter_name || "").trim(),
    };
  });
}

async function getOwnerOrderFilters(clientId) {
  const db = getSupabase();
  const maps = await loadWaiterStaffMaps(clientId);
  const { data, error } = await db
    .from("sales_orders")
    .select("waiter_name, waiter_id, accepted_by_waiter_name, accepted_by_waiter_id, table_number")
    .eq("client_id", clientId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = data || [];
  const waiterNames = new Set(maps.staffNames);
  for (const row of rows) {
    const attr = resolveWaiterAttribution(row, maps);
    if (attr.name) waiterNames.add(attr.name);
  }
  const waiters = [...waiterNames].sort((a, b) => a.localeCompare(b, "sq"));
  const tables = [...new Set(rows.map(r => r.table_number).filter(n => n != null && n !== ""))]
    .map(Number)
    .sort((a, b) => a - b);
  return { waiters, tables };
}

async function getOwnerReport(clientId, from, to) {
  const db = getSupabase();
  const maps = await loadWaiterStaffMaps(clientId);
  const fromD = from || new Date().toISOString().slice(0, 10);
  const toD = to || fromD;

  const { data, error } = await db
    .from("sales_orders")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "closed")
    .gte("closed_at", `${fromD}T00:00:00.000Z`)
    .lte("closed_at", `${toD}T23:59:59.999Z`)
    .order("closed_at", { ascending: false });

  if (error) throw error;
  const orders = (data || []).map(o => {
    const attr = resolveWaiterAttribution(o, maps);
    return {
      ...o,
      waiter_name: attr.name || o.waiter_name || "",
      waiter_id: attr.id || o.waiter_id || null,
    };
  });
  const total = orders.reduce((s, o) => s + Number(o.total), 0);

  const byDay = {};
  for (const o of orders) {
    const d = o.closed_at.slice(0, 10);
    if (!byDay[d]) byDay[d] = { date: d, total: 0, count: 0 };
    byDay[d].total += Number(o.total);
    byDay[d].count += 1;
  }

  return {
    from: fromD,
    to: toD,
    total,
    order_count: orders.length,
    by_day: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
    orders,
  };
}

/** Porosi të mbyllura (të gjitha kanalet) — për sync në daily_log të POS-it. */
async function listClosedWebWaiterSalesForPos(clientId, sinceIso = "") {
  const db = getSupabase();
  const { isRemoteActiveTableOrder } = require("../lib/orderSource");
  let q = db
    .from("sales_orders")
    .select(
      "id, table_number, waiter_name, waiter_id, items_json, total, receipt_number, closed_at, payment_method, local_order_id, device_id, accepted_by_waiter_name, accepted_by_waiter_id",
    )
    .eq("client_id", clientId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(100);
  const since = String(sinceIso || "").trim();
  if (since) q = q.gte("closed_at", since);
  const { data, error } = await q;
  if (error) throw error;
  // Vetëm porosi nga telefon/QR/web — JO mbylljet e panelit POS.
  // Përndryshe closeTable lokale + pushSale + re-import = dyfishim daily_log / faturë.
  const rows = (data || [])
    .filter(row => isRemoteActiveTableOrder(row.device_id))
    .slice()
    .sort((a, b) =>
      String(a.closed_at || "").localeCompare(String(b.closed_at || "")),
    );
  console.log(
    "[sales/waiter-closed] client=",
    clientId,
    "since=",
    since || "(all)",
    "found=",
    rows.length,
    "(web-only; POS closes excluded)",
  );
  return rows.map(row => ({
    id: row.id,
    table_number: Number(row.table_number) || 0,
    waiter_name: String(row.accepted_by_waiter_name || row.waiter_name || "").trim(),
    waiter_id: row.accepted_by_waiter_id || row.waiter_id || null,
    items: normalizeItems(row.items_json),
    total: Number(row.total) || 0,
    receipt_number: String(row.receipt_number || "").trim(),
    closed_at: row.closed_at || null,
    payment_method: row.payment_method || "cash",
    local_order_id: String(row.local_order_id || "").trim(),
    device_id: String(row.device_id || "").trim(),
  }));
}

function mapClosedSaleRowForPos(row) {
  return {
    id: row.id,
    table_number: Number(row.table_number) || 0,
    waiter_name: String(row.accepted_by_waiter_name || row.waiter_name || "").trim(),
    waiter_id: row.accepted_by_waiter_id || row.waiter_id || null,
    items: normalizeItems(row.items_json),
    total: Number(row.total) || 0,
    receipt_number: String(row.receipt_number || "").trim(),
    closed_at: row.closed_at || null,
    payment_method: row.payment_method || "cash",
    local_order_id: String(row.local_order_id || "").trim(),
    device_id: String(row.device_id || "").trim(),
  };
}

/** Të gjitha porositë closed — rindërtim i plotë i daily_log (POS + web). */
async function listAllClosedSalesForPosRebuild(clientId) {
  const db = getSupabase();
  const pageSize = 1000;
  const select =
    "id, table_number, waiter_name, waiter_id, items_json, total, receipt_number, closed_at, payment_method, local_order_id, device_id, accepted_by_waiter_name, accepted_by_waiter_id";
  const all = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await db
      .from("sales_orders")
      .select(select)
      .eq("client_id", clientId)
      .eq("status", "closed")
      .order("closed_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (offset > 50000) break;
  }
  console.log("[sales/rebuild-register] client=", clientId, "closed=", all.length);
  return all.map(mapClosedSaleRowForPos);
}

async function getOwnerStatsForGroup(clientIds) {
  const ids = [...new Set((clientIds || []).filter(Boolean))];
  const r = dateRanges();
  const { WEB_KIOSK, WEB_PUBLIC } = require("../lib/orderSource");
  const [today, week, month, qrSot, webSot, qrJava, webJava] = await Promise.all([
    sumSalesForClients(ids, r.today, r.today),
    sumSalesForClients(ids, r.week_from, r.today),
    sumSalesForClients(ids, r.month_from, r.today),
    countChannelOrdersForClients(ids, WEB_KIOSK, r.today, r.today),
    countChannelOrdersForClients(ids, WEB_PUBLIC, r.today, r.today),
    countChannelOrdersForClients(ids, WEB_KIOSK, r.week_from, r.today),
    countChannelOrdersForClients(ids, WEB_PUBLIC, r.week_from, r.today),
  ]);
  return {
    sot: today,
    java: week,
    muaj: month,
    channels: {
      qr_sot: qrSot,
      web_sot: webSot,
      qr_java: qrJava,
      web_java: webJava,
    },
    aggregate: true,
    location_count: ids.length,
  };
}

async function getClientById(clientId) {
  const db = getSupabase();
  const { data, error } = await db.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Anulim ("void") i një fature të mbyllur/printuar tashmë — kërkon arsye,
 * regjistrohet te owner_activity_log. Nuk fshin/prek rreshtin te sales_orders
 * përveç status → 'cancelled' (asnjë kolonë e re, sipas Rregullit #11). */
async function voidOwnerOrder(clientId, orderId, { reason, note = "", actorEmail = "" } = {}) {
  const reasonKey = VOID_REASONS[reason] ? reason : null;
  if (!reasonKey) {
    throw new Error("Zgjidhni një arsye të vlefshme për anulimin.");
  }
  const db = getSupabase();
  const { data: order, error: findErr } = await db
    .from("sales_orders")
    .select("id, table_number, total, receipt_number, status, closed_at, waiter_name")
    .eq("client_id", clientId)
    .eq("id", orderId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!order) throw new Error("Porosia nuk u gjet.");
  if (order.status !== "closed") {
    throw new Error("Vetëm faturat e mbyllura (të printuara) mund të anulohen këtu.");
  }

  const { data: updated, error } = await db
    .from("sales_orders")
    .update({ status: "cancelled" })
    .eq("client_id", clientId)
    .eq("id", orderId)
    .eq("status", "closed")
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!updated) {
    throw new Error("Fatura u ndryshua tashmë nga dikush tjetër. Rifreskoni listën.");
  }

  await logOwnerActivity(clientId, {
    actorEmail,
    action: "order_voided",
    targetType: "sales_order",
    targetId: orderId,
    targetLabel: order.table_number
      ? `Tavolina ${order.table_number} — ${Number(order.total).toFixed(2)}€`
      : (order.receipt_number || orderId),
    details: {
      reason: reasonKey,
      reason_label: VOID_REASONS[reasonKey],
      note: String(note || "").trim().slice(0, 300),
      table_number: order.table_number,
      total: order.total,
      receipt_number: order.receipt_number,
      closed_at: order.closed_at,
      waiter_name: order.waiter_name,
    },
  });

  return { voided: true, order: updated };
}

module.exports = {
  normalizeItems,
  mergeOrderItems,
  syncSaleFromPos,
  buildSaleReceipt,
  updateActiveSaleFromPos,
  freeTableFromPos,
  getLiveTablesForOwner,
  getOwnerStats,
  getOwnerStatsForGroup,
  listOwnerOrders,
  getOwnerOrderFilters,
  getOwnerReport,
  listClosedWebWaiterSalesForPos,
  listAllClosedSalesForPosRebuild,
  getClientById,
  voidOwnerOrder,
  VOID_REASONS,
};
