const { v4: uuidv4 } = require("uuid");
const { getSupabase } = require("../db");
const { getClientById, normalizeItems, mergeOrderItems, updateActiveSaleFromPos, syncSaleFromPos } = require("./salesService");
const { assertLicenseUsable } = require("../lib/licenseEnforcement");
const { WEB_WAITER, WEB_KIOSK, WEB_PUBLIC, isKioskWaiterName, isPosDesktopDevice } = require("../lib/orderSource");
const { buildMenuCategories, mapMenuItemForKitchen } = require("./menuCatalogService");
const { isVisibleOnWebMenu } = require("../lib/stockHelpers");
const {
  buildTablesFromAreas,
  loadAreasForClient,
} = require("./venueService");
const { resolveWaiterForOrder } = require("./waiterPinService");
const { getStaffBrandingForClient } = require("../lib/staffBranding");
const {
  listWaiterReservations,
  attachReservationsToLayout,
} = require("./reservationService");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEB_DEVICE = WEB_WAITER;

async function assertClient(clientId) {
  const id = String(clientId || "").trim();
  if (!UUID_RE.test(id)) throw new Error("ID klienti nuk është i vlefshëm.");
  const client = await getClientById(id);
  if (!client) throw new Error("Klienti nuk u gjet.");
  return client;
}

async function getActiveTableOrders(clientId) {
  const db = getSupabase();
  const { data, error } = await db
    .from("sales_orders")
    .select("id, table_number, waiter_name, waiter_id, status, total, ordered_at, items_json, local_order_id, device_id, accepted_by_waiter_id, accepted_by_waiter_name")
    .eq("client_id", clientId)
    .in("status", ["ordered", "ready"])
    .order("ordered_at", { ascending: true });
  if (error) throw error;

  const rowsByTable = new Map();
  for (const row of data || []) {
    const n = Number(row.table_number);
    if (!n) continue;
    if (!rowsByTable.has(n)) rowsByTable.set(n, []);
    rowsByTable.get(n).push(row);
  }

  const byTable = new Map();
  for (const [n, rows] of rowsByTable) {
    if (rows.length === 1) {
      byTable.set(n, rows[0]);
      continue;
    }
    let items = [];
    for (const row of rows) {
      items = mergeOrderItems(items, row.items_json);
    }
    const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const withLocalId = rows.filter(r => String(r.local_order_id || "").trim());
    const primary =
      withLocalId.find(r => String(r.device_id || "").toUpperCase() !== WEB_WAITER)
      || withLocalId[0]
      || rows.find(r => String(r.device_id || "").toUpperCase() !== WEB_WAITER)
      || rows[0];
    byTable.set(n, {
      ...primary,
      items_json: items,
      total,
      merged_order_ids: rows.map(r => r.id),
    });
  }
  return byTable;
}

const CANCEL_WINDOW_MS = 3 * 60 * 1000;

function assertWithinCancelWindow(orderedAt) {
  const t = new Date(orderedAt || 0).getTime();
  if (!t || Date.now() - t > CANCEL_WINDOW_MS) {
    throw new Error("Koha për anullim ka skaduar (3 minuta).");
  }
}

async function cancelTableOrder(clientId, { tableNumber, waiter, license, existing }) {
  if (!existing) {
    throw new Error(`Nuk ka porosi aktive për T${tableNumber}.`);
  }
  assertWithinCancelWindow(existing.ordered_at);

  const licenseRow = license || await getLicenseForClient(clientId);
  const items = normalizeItems(existing.items_json);

  return updateActiveSaleFromPos({
    celesi: licenseRow.celesi,
    device_id: existing.device_id || WEB_DEVICE,
    local_order_id: existing.local_order_id,
    table_number: tableNumber,
    waiter_name: existing.waiter_name,
    waiter_id: existing.waiter_id || waiter?.id,
    items,
    total: 0,
    status: "cancelled",
    ordered_at: existing.ordered_at,
  });
}

async function getLicenseForClient(clientId) {
  const db = getSupabase();
  const { data: license } = await db
    .from("licenses")
    .select("id, celesi, device_id, statusi, data_skadimit, trial_ends_at")
    .eq("client_id", clientId)
    .eq("statusi", "aktive")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!license?.celesi) throw new Error("Nuk ka licencë aktive për këtë klient.");
  assertLicenseUsable(license);
  return license;
}

function sameWaiterId(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function isExternalChannelOrder(existing) {
  if (!existing) return false;
  const device = String(existing.device_id || "").trim().toUpperCase();
  if (device === WEB_KIOSK || device === WEB_PUBLIC) return true;
  if (isKioskWaiterName(existing.waiter_name)) return true;
  const w = String(existing.waiter_name || "").trim().toLowerCase();
  return w.startsWith("takeaway") || w.startsWith("delivery");
}

function assertWaiterOnTable(existing, waiter, tableNumber) {
  if (!existing?.waiter_name) return;
  if (isExternalChannelOrder(existing)) return;
  // Porositë POS mund të mbyllen nga çdo kamarier nga telefoni
  if (isPosDesktopDevice(existing.device_id)) return;
  // Porositë WEB — kontrollo vetëm waiter_id nëse ekziston
  const wId = waiter?.id;
  const eId = existing.waiter_id;
  if (wId && eId && sameWaiterId(eId, wId)) return;
  if (wId && eId && !sameWaiterId(eId, wId)) {
    throw new Error(`Tavolina T${tableNumber} është e kamarierit: ${existing.waiter_name}`);
  }
  // Nëse nuk ka waiter_id, lejo mbylljen (emrat mund të ndryshojnë paksa)
  return;
}

async function getWaiterBootstrap(clientId, { kitchenSlug = "", channel = "waiter", webToken = "" } = {}) {
  const client = await assertClient(clientId);
  const db = getSupabase();
  const { getWaiterByWebToken } = require("./waiterPinService");

  let assigned_waiter = null;
  let web_token_invalid = false;
  const token = String(webToken || "").trim();
  if (token) {
    const w = await getWaiterByWebToken(clientId, token);
    if (w) {
      assigned_waiter = { id: w.id, name: w.name };
    } else {
      web_token_invalid = true;
    }
  }

  const [{ data: settings }, { data: categories }, { data: menu }] =
    await Promise.all([
      db.from("pos_settings").select("*").eq("client_id", clientId).maybeSingle(),
      db.from("pos_categories").select("name, sort_order").eq("client_id", clientId).order("sort_order"),
      db.from("pos_menu_items").select("local_id, name, category, price, active, photo, track_stock, stock_quantity, stock_alert_threshold").eq("client_id", clientId).eq("active", true).order("category").order("name"),
    ]);

  const areas = await loadAreasForClient(clientId);
  const activeTables = await getActiveTableOrders(clientId);
  const activeByTable = new Map();
  for (const [n, row] of activeTables) {
    activeByTable.set(n, {
      waiter_name: row.waiter_name,
      waiter_id: row.waiter_id || null,
      total: row.total,
      active_items: normalizeItems(row.items_json),
      device_id: row.device_id || null,
      accepted_by_waiter_id: row.accepted_by_waiter_id || null,
      accepted_by_waiter_name: row.accepted_by_waiter_name || null,
    });
  }
  const layout = buildTablesFromAreas(areas, settings?.table_count, activeByTable);
  const reservations = await listWaiterReservations(clientId);
  const layoutWithReservations = attachReservationsToLayout(layout, reservations);
  const pinWaiters = await loadPinWaitersCount(clientId);
  const branding = await getStaffBrandingForClient(client, kitchenSlug);

  // Filtrimi sipas caktimit të tavolinave (vetëm për link personal të kamarierit).
  // Nëse pronari ka caktuar tavolina, kamarieri sheh VETËM të vetat; tavolinat pa
  // caktim nuk shfaqen te askush. Nëse nuk ka asnjë caktim, sillet si më parë (të gjitha).
  let tables = layoutWithReservations.tables;
  let areasOut = layoutWithReservations.areas;
  if (assigned_waiter?.id) {
    const { getAssignmentState } = require("./waiterTablesService");
    const assignState = await getAssignmentState(clientId);
    if (assignState.hasAny) {
      const allowed = new Set(assignState.byWaiter.get(assigned_waiter.id) || []);
      tables = tables.filter(t => allowed.has(Number(t.number)));
      areasOut = areasOut
        .map(a => ({ ...a, tables: a.tables.filter(t => allowed.has(Number(t.number))) }))
        .filter(a => a.tables.length);
    }
  }

  return {
    client_name: client.emri,
    restaurant_name: settings?.restaurant_name || client.emri,
    address: branding.address,
    logo_url: branding.logo_url,
    revolution_logo_url: branding.revolution_logo_url,
    table_count: tables.length,
    synced_at: settings?.synced_at || null,
    pin_auth: true,
    waiter_count: pinWaiters,
    categories: buildMenuCategories(categories, menu),
    menu: (menu || []).filter(isVisibleOnWebMenu).map(row => mapMenuItemForKitchen(row, { slug: kitchenSlug, channel })),
    areas: areasOut,
    tables,
    reservations,
    assigned_waiter,
    web_token_invalid,
  };
}

async function loadPinWaitersCount(clientId) {
  const db = getSupabase();
  const { count, error } = await db
    .from("pos_staff")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("role", "waiter")
    .eq("active", true)
    .not("pin_hash", "is", null);
  if (error) return 0;
  return count || 0;
}

async function loginWaiterWithPin(clientId, pin, webToken = null) {
  await assertClient(clientId);
  const { verifyWaiterPin } = require("./waiterPinService");
  return verifyWaiterPin(clientId, pin, webToken);
}

async function submitWaiterOrder(clientId, body) {
  await assertClient(clientId);
  const waiter = await resolveWaiterForOrder(clientId, body.waiter_id, body.waiter_name);

  const tableNumber = Number(body.table_number);
  if (!tableNumber || tableNumber < 1) throw new Error("Zgjidhni tavolinën.");

  const newItems = normalizeItems(body.items);
  if (!newItems.length) throw new Error("Shtoni të paktën një artikull.");

  const active = await getActiveTableOrders(clientId);
  const existing = active.get(tableNumber);
  assertWaiterOnTable(existing, waiter, tableNumber);

  const items = existing
    ? mergeOrderItems(existing.items_json, newItems)
    : newItems;
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const now = new Date().toISOString();
  const license = await getLicenseForClient(clientId);
  const localOrderId = existing?.local_order_id || `web-${uuidv4()}`;

  const sale = await updateActiveSaleFromPos({
    celesi: license.celesi,
    device_id: existing?.device_id || WEB_DEVICE,
    local_order_id: localOrderId,
    table_number: tableNumber,
    waiter_name: waiter.name,
    waiter_id: waiter.id,
    items,
    total,
    status: "ordered",
    ordered_at: existing?.ordered_at || now,
  });

  let saved = sale;
  if (sale?.id) {
    const db = getSupabase();
    const patch = { waiter_name: waiter.name, waiter_id: waiter.id };
    let { data, error } = await db
      .from("sales_orders")
      .update(patch)
      .eq("id", sale.id)
      .select()
      .single();
    if (error && patch.waiter_id && /waiter_id|schema cache/i.test(String(error.message || ""))) {
      ({ data, error } = await db
        .from("sales_orders")
        .update({ waiter_name: waiter.name })
        .eq("id", sale.id)
        .select()
        .single());
    }
    if (!error && data) saved = data;
  }

  try {
    const { deductStockForOrder } = require("./stockService");
    await deductStockForOrder(clientId, newItems);
  } catch (err) {
    console.warn("[stock] waiter deduct failed:", err.message);
  }

  try {
    const { deductIngredientsForOrder } = require("./inventoryService");
    await deductIngredientsForOrder(clientId, newItems);
  } catch (err) {
    console.warn("[inventory] waiter deduct failed:", err.message);
  }

  console.log("[waiter/orders] saved", {
    id: saved?.id,
    clientId,
    table: tableNumber,
    device: saved?.device_id || WEB_DEVICE,
    waiter: waiter.name,
    items: newItems.length,
    total,
  });

  if (saved?.id) {
    try {
      const { updateOrdersAcceptance, isOrderAccepted } = require("../lib/salesOrderSelect");
      if (!isOrderAccepted(saved)) {
        await updateOrdersAcceptance(getSupabase(), {
          clientId,
          orderIds: [saved.id],
          waiterId: waiter.id,
          waiterName: waiter.name,
        });
        const { notifyKitchenUpdate } = require("./kdsEvents");
        // status "ordered" (jo "accepted") — KAFENE SSE nuk e markon si printed/purged para import+print
        notifyKitchenUpdate(clientId, {
          order_id: saved.id,
          table_number: tableNumber,
          status: "ordered",
          device_id: WEB_DEVICE,
          accepted_by: waiter.name,
        });
        console.log("[waiter/orders] SSE notified", { order_id: saved.id, status: "ordered" });
        const { data: refreshed } = await getSupabase()
          .from("sales_orders")
          .select("*")
          .eq("id", saved.id)
          .maybeSingle();
        if (refreshed) saved = refreshed;
      }
    } catch (err) {
      console.warn("[waiter] auto-accept on submit failed:", err.message);
    }
  }

  return { ok: true, order: saved, sent_to: "bar", waiter };
}

async function cancelWaiterOrder(clientId, body) {
  await assertClient(clientId);
  const waiter = await resolveWaiterForOrder(clientId, body.waiter_id, body.waiter_name);

  const tableNumber = Number(body.table_number);
  if (!tableNumber || tableNumber < 1) throw new Error("Zgjidhni tavolinën.");

  const active = await getActiveTableOrders(clientId);
  const existing = active.get(tableNumber);
  assertWaiterOnTable(existing, waiter, tableNumber);

  const sale = await cancelTableOrder(clientId, { tableNumber, waiter, existing });
  return { ok: true, message: "Porosia u anullua", order: sale };
}

async function fetchActiveOrderById(clientId, orderId) {
  const id = String(orderId || "").trim();
  if (!UUID_RE.test(id)) throw new Error("ID porosie i pavlefshëm.");
  const db = getSupabase();
  const { data, error } = await db
    .from("sales_orders")
    .select(
      "id, table_number, waiter_name, waiter_id, status, total, ordered_at, items_json, local_order_id, device_id, accepted_at, accepted_by_waiter_name",
    )
    .eq("client_id", clientId)
    .eq("id", id)
    .in("status", ["ordered", "ready"])
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Porosia nuk u gjet ose është mbyllur tashmë.");
  return data;
}

async function cancelSiblingActiveTableOrders(clientId, tableNumber, keepOrderId) {
  const db = getSupabase();
  const num = Number(tableNumber);
  const keepId = String(keepOrderId || "").trim();
  if (!num || !keepId) return;

  const { data, error } = await db
    .from("sales_orders")
    .select("id")
    .eq("client_id", clientId)
    .eq("table_number", num)
    .in("status", ["ordered", "ready"])
    .neq("id", keepId);
  if (error) throw error;

  const now = new Date().toISOString();
  for (const row of data || []) {
    await db
      .from("sales_orders")
      .update({ status: "cancelled", closed_at: now, total: 0, ready_at: null })
      .eq("id", row.id);
  }
}

async function closeWaiterTable(clientId, body) {
  await assertClient(clientId);
  const waiter = await resolveWaiterForOrder(clientId, body.waiter_id, body.waiter_name);

  const orderId = String(body.order_id || body.cloud_order_id || "").trim();
  const tableNumber = Number(body.table_number);
  let existing;
  let closeTableNum;

  if (orderId) {
    existing = await fetchActiveOrderById(clientId, orderId);
    closeTableNum = Number(existing.table_number) || 0;
    assertWaiterOnTable(existing, waiter, closeTableNum || tableNumber || 1);
  } else if (tableNumber >= 1) {
    closeTableNum = tableNumber;
    const active = await getActiveTableOrders(clientId);
    existing = active.get(tableNumber);
    if (!existing) {
      throw new Error(`Nuk ka porosi aktive në cloud për T${tableNumber}.`);
    }
    assertWaiterOnTable(existing, waiter, tableNumber);
  } else {
    throw new Error("Zgjidhni porosinë (order_id) ose tavolinën.");
  }

  const cartItems = normalizeItems(body.items);
  const existingItems = normalizeItems(existing.items_json);
  // Klienti dërgon listën e plotë të faturës — mos e bashko me ekzistuesen (dyfishon sasitë).
  const items = cartItems.length ? cartItems : existingItems;
  if (!items.length) {
    throw new Error("Nuk ka artikuj për të mbyllur tavolinën.");
  }

  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const now = new Date().toISOString();
  const license = await getLicenseForClient(clientId);
  const receiptNumber = `R-${Date.now().toString(36).toUpperCase()}`;
  // Fallback: porosi të vjetra / merge pa local_order_id — mos e blloko mbylljen nga telefoni.
  const localOrderId =
    String(existing.local_order_id || "").trim()
    || String(existing.id || "").trim()
    || `web-close-${uuidv4()}`;
  const deviceId = String(existing.device_id || WEB_DEVICE).trim().toUpperCase() || WEB_DEVICE;

  const saleResult = await syncSaleFromPos({
    celesi: license.celesi,
    device_id: deviceId,
    local_order_id: localOrderId,
    table_number: closeTableNum,
    waiter_name: waiter.name,
    waiter_id: waiter.id,
    items,
    total,
    receipt_number: receiptNumber,
    payment_method: body.payment_method || "cash",
    status: "closed",
    ordered_at: existing.ordered_at || now,
    closed_at: now,
  });

  if (saleResult.sale?.id) {
    const siblingIds = (existing.merged_order_ids || []).filter(id => id !== saleResult.sale.id);
    if (siblingIds.length) {
      const db = getSupabase();
      const cancelNow = new Date().toISOString();
      await db
        .from("sales_orders")
        .update({ status: "cancelled", closed_at: cancelNow, total: 0, ready_at: null })
        .in("id", siblingIds)
        .in("status", ["ordered", "ready"]);
    } else if (closeTableNum >= 1) {
      await cancelSiblingActiveTableOrders(clientId, closeTableNum, saleResult.sale.id);
    }
  }

  const receiptBundle = saleResult.receipt || null;

  return {
    ok: true,
    order: saleResult.sale,
    receipt: receiptBundle
      ? {
          ...receiptBundle.receipt,
          text: receiptBundle.text,
          lines: receiptBundle.lines,
          html: receiptBundle.html,
          escpos_base64: receiptBundle.escpos_base64,
          paper_width_mm: receiptBundle.paper_width_mm,
        }
      : {
          receipt_number: receiptNumber,
          table_number: closeTableNum,
          waiter_name: waiter.name,
          items,
          total,
          closed_at: now,
        },
  };
}

module.exports = {
  getWaiterBootstrap,
  loginWaiterWithPin,
  submitWaiterOrder,
  cancelWaiterOrder,
  closeWaiterTable,
  getActiveTableOrders,
  getLicenseForClient,
  cancelTableOrder,
};
