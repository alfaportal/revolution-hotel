const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const db = require("./database");
const printer = require("./printer");
const fiscalRegister = require("./fiscal-register");
const fiscalConfig = require("./fiscal/fiscal-config");
const fiscalPayment = require("./fiscal/fiscal-payment");
const fiscalCorrection = require("./fiscal/fiscal-correction");
const fiscalOffline = require("./fiscal/fiscal-offline");
const fiscalAudit = require("./fiscal/fiscal-audit");
const fiscalI18n = require("./fiscal/fiscal-i18n");
const fiscalNumbering = require("./fiscal/fiscal-numbering");
let _fiscalMain = null;
function getFiscalMain() {
  if (!_fiscalMain) _fiscalMain = require("./fiscal/fiscal-main");
  return _fiscalMain;
}
let _fiscalSelfTest = null;
function getFiscalSelfTest() {
  if (!_fiscalSelfTest) _fiscalSelfTest = require("./fiscal/fiscal-self-test");
  return _fiscalSelfTest;
}
let _fiscalReceiptsList = null;
function getFiscalReceiptsList() {
  if (!_fiscalReceiptsList) _fiscalReceiptsList = require("./fiscal/fiscal-receipts-list");
  return _fiscalReceiptsList;
}
let _tableQrService = null;
function getTableQrService() {
  if (!_tableQrService) _tableQrService = require("./table-qr-service");
  return _tableQrService;
}
let _hotelQrService = null;
function getHotelQrService() {
  if (!_hotelQrService) _hotelQrService = require("./hotel-qr-service");
  return _hotelQrService;
}
const { buildEscPosFromPlainText } = require("./receipt-text");
const cloudSync = require("./cloud-sync");
const cloudAutoSync = require("./cloud-auto-sync");
const onlineOrdersWatcher = require("./online-orders-watcher");
const license = require("./license");
const receiptPrint = require("./receipt-print");
const { printClosedTableReceipt } = require("./close-table-print");
const { buildXReportHtml, buildZReportHtml, buildXReportLines, buildZReportLines, buildDailySummaryLines } = require("./shift-report-html");
const { diffOrderItems } = require("./kitchen-ticket-html");
const menuStockPhotos = require("./menu-stock-photos");
const { getPublicCloudServerUrl, buildCloudAccessLinks, buildWaiterPersonalUrl } = require("./cloud-server-url");
const { buildDitariReportHtml } = require("./ditari-report");
const {
  buildMenuPrintHtml,
  buildReportPrintHtml,
  buildReportPrintLines,
  buildGuestFolioPrintHtml,
  buildGuestFolioPrintLines,
} = require("./export-print-html");
const { buildPurchaseInvoiceHtml, buildPurchasesListHtml } = require("./purchase-print-html");
const {
  buildSalesLedgerHtml,
  buildExpensesLedgerHtml,
  buildVatReportHtml,
  buildPurchasesLedgerHtml,
  buildBilancHtml,
} = require("./kontabilisti-html");
const reservationSync = require("./reservation-sync");
const promotionService = require("./promotion-service");
const registerMode = require("./register-mode");
const aiCloud = require("./ai-cloud");
const { notifyShiftCloseEmail } = require("./shift-close-email");
const VERSION = require("./version-config");
const i18n = require("./i18n");

const CLOUD_ORDER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let onlineOrdersWatcherStarted = false;

function ensureOnlineOrdersWatcher() {
  if (onlineOrdersWatcherStarted) return;
  onlineOrdersWatcher.startOnlineOrdersWatcher(db, opts => autoPrintKitchenTicket(db, opts));
  onlineOrdersWatcherStarted = true;
}

async function finalizeImportedCloudOrders(importedRows, waiterName) {
  for (const row of importedRows || []) {
    if (!row?.ok || !row.table_id) continue;
    const order = db.getActiveOrderForTable(row.table_id);
    if (!order) continue;
    const tableNum = Number(row.table_number) || 0;
    // Mos pushActiveOrderUpdate — porosia ekziston tashmë në cloud (WEB-WAITER/QR).
    let slipItems = Array.isArray(row.batch_items) ? row.batch_items : [];
    if (!slipItems.length) {
      try {
        slipItems = JSON.parse(order.items_json || "[]");
      } catch {
        slipItems = [];
      }
    }
    if (!slipItems.length) continue;
    const batchNo = db.recordPrintedBatch(order.id, order.items_json);
    void autoPrintOrderSlip(db, {
      tableNumber: tableNum || row.table_id,
      waiterName: row.waiter_name || waiterName,
      items: slipItems,
      batchNumber: batchNo,
      order,
      acceptedBy: waiterName,
    });
  }
}

async function acceptOnlineOrdersFlow(orderIds, pin, options = {}) {
  const ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  const pinTrim = String(pin || "").trim();
  let staff = options.trustedStaff || null;

  if (!staff) {
    if (!pinTrim) {
      throw Object.assign(new Error("Vendosni PIN-in e kamarierit që e pranon porosinë."), { status: 400 });
    }
    if (!/^\d{4}$/.test(pinTrim)) {
      throw Object.assign(new Error("PIN duhet të jetë 4 shifra."), { status: 400 });
    }
    staff = db.findStaffByPin(pinTrim);
    if (!staff) {
      throw Object.assign(new Error("PIN i gabuar!"), { status: 401 });
    }
  } else if (pinTrim) {
    const pinStaff = db.findStaffByPin(pinTrim);
    if (!pinStaff || Number(pinStaff.id) !== Number(staff.id)) {
      throw Object.assign(new Error("PIN i gabuar!"), { status: 401 });
    }
  }

  ensureOnlineOrdersWatcher();
  const preSnapshot = onlineOrdersWatcher.getOnlineOrdersSnapshot();
  const fallbackOrders = Array.isArray(options.fallbackOrders) ? options.fallbackOrders : [];

  function matchOrders(source) {
    const norm = onlineOrdersWatcher.normalizePendingOrder;
    return (source || [])
      .map(o => (typeof norm === "function" ? norm(o) : o))
      .filter(o => o?.id && ids.includes(String(o.id)));
  }

  const lookupSources = [
    fallbackOrders,
    preSnapshot.orders,
    db.listPendingCloudOrders(),
    onlineOrdersWatcher.getLastKnownOrders(),
  ];
  let ordersBefore = [];
  for (const source of lookupSources) {
    ordersBefore = matchOrders(source);
    if (ordersBefore.length) break;
  }
  if (!ordersBefore.length) {
    throw Object.assign(
      new Error("Porosia nuk u gjet — rifreskoni dhe provoni përsëri."),
      { status: 400 },
    );
  }
  if (ordersBefore.some(o => db.isCloudStaffWaiterOrder?.(o))) {
    throw Object.assign(
      new Error("Porosia e kamarierit (telefon) nuk pranohet këtu — vazhdoni nga telefoni."),
      { status: 400 },
    );
  }

  ordersBefore = ordersBefore.filter(o => {
    const rawId = String(o?.id ?? "").trim();
    if (CLOUD_ORDER_UUID_RE.test(rawId)) return true;
    console.warn(`[acceptOnlineOrdersFlow] Refuzuar: order.id nuk është UUID i vlefshëm (mundësisht numër slloti): ${JSON.stringify(rawId)}`);
    return false;
  });
  if (!ordersBefore.length) {
    throw Object.assign(
      new Error("Porosia nuk u gjet — rifreskoni dhe provoni përsëri."),
      { status: 400 },
    );
  }

  db.ensureTablesForPendingCloudOrders(ordersBefore);

  const waiterName = String(staff.name || "").trim();
  const ackPin = pinTrim || String(staff.pin || "").trim();

  let cloudResult = { ok: false, message: "", accepted_by: "" };
  if (ackPin) {
    try {
      cloudResult = await cloudSync.acknowledgeOnlineOrders(db, ids, ackPin);
    } catch (e) {
      cloudResult = { ok: false, message: e.message || "", accepted_by: "" };
    }
  }

  let slotLayout = [];
  try {
    slotLayout = await cloudSync.fetchOnlineSlotLayout(db, { unfiltered: true });
  } catch {
    /* offline */
  }
  function onlineSlotForOrder(orderId) {
    const id = String(orderId || "").trim();
    const hit = slotLayout.find(s => String(s.order?.id || "") === id);
    if (hit?.slot) return hit.slot;
    const withOrder = slotLayout.filter(s => s.order?.id);
    const idx = withOrder.findIndex(s => String(s.order.id) === id);
    return idx >= 0 ? withOrder[idx].slot : null;
  }

  const imported = [];
  for (const order of ordersBefore) {
    const slotNum = onlineSlotForOrder(order.id);
    const enriched = {
      ...order,
      table_number: db.isCloudQrTableOrder(order)
        ? db.parseQrTableNumberFromCloudOrder(order)
        : 0,
      ...(slotNum ? { online_slot: slotNum } : {}),
    };
    try {
      imported.push(db.importCloudOrderToLocal(enriched, waiterName));
    } catch (e) {
      imported.push({ ok: false, cloud_id: order.id, error: e.message });
    }
  }

  const success = imported.filter(r => r.ok);
  if (!success.length && !cloudResult.ok) {
    throw Object.assign(
      new Error(imported[0]?.error || cloudResult.message || "Importimi i porosisë dështoi."),
      { status: 400 },
    );
  }

  if (success.length) {
    await finalizeImportedCloudOrders(success, waiterName);
  }

  if (success.length || cloudResult.ok) {
    onlineOrdersWatcher.persistAcknowledged(db, ids);
    db.removePendingCloudOrders(ids);
  }

  if (!cloudResult.ok && success.length && ackPin) {
    cloudSync.acknowledgeOnlineOrders(db, ids, ackPin).catch(() => {});
  }

  onlineOrdersWatcher.markOrdersPrinted(db, ids);
  onlineOrdersWatcher.removeOrdersFromSnapshot(ids);
  const freshSnapshot = onlineOrdersWatcher.getOnlineOrdersSnapshot();

  return {
    acknowledged: ids.length,
    accepted_by: String(cloudResult.accepted_by || waiterName).trim(),
    imported,
    cloud_ok: !!cloudResult.ok,
    cloud_message: cloudResult.ok ? "" : (cloudResult.message || ""),
    import_ok: success.length > 0,
    snapshot: freshSnapshot,
  };
}

async function refusePendingOnlineOrdersFlow(orderIds, options = {}) {
  const ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) {
    throw Object.assign(new Error("Zgjidhni porosinë."), { status: 400 });
  }
  const orderId = ids[0];
  const refuseReason = String(options.reason || options.refuse_reason || "").trim();

  const pinTrim = String(options.pin || "").trim();
  let staff = options.trustedStaff || null;

  if (!staff) {
    if (!pinTrim) {
      throw Object.assign(new Error("Vendosni PIN-in e kamarierit që e refuzon porosinë."), { status: 400 });
    }
    if (!/^\d{4}$/.test(pinTrim)) {
      throw Object.assign(new Error("PIN duhet të jetë 4 shifra."), { status: 400 });
    }
    staff = db.findStaffByPin(pinTrim);
    if (!staff) {
      throw Object.assign(new Error("PIN i gabuar!"), { status: 401 });
    }
  } else if (pinTrim) {
    const pinStaff = db.findStaffByPin(pinTrim);
    if (!pinStaff || Number(pinStaff.id) !== Number(staff.id)) {
      throw Object.assign(new Error("PIN i gabuar!"), { status: 401 });
    }
  }

  ensureOnlineOrdersWatcher();

  let cloudResult = { ok: false, message: "", refused: 0, order_id: orderId };
  const ackPin = pinTrim || String(staff.pin || "").trim();
  try {
    cloudResult = await cloudSync.refuseOnlineOrder(db, orderId, ackPin, refuseReason);
  } catch (e) {
    cloudResult = { ok: false, message: e.message || "", refused: 0, order_id: orderId };
  }

  if (!cloudResult.ok) {
    cloudSync.refuseOnlineOrder(db, orderId, ackPin, refuseReason).catch(() => {});
    throw Object.assign(
      new Error(cloudResult.message || "Nuk u refuzua porosia në cloud — provoni përsëri."),
      { status: 400 },
    );
  }

  onlineOrdersWatcher.persistStaffRefusal(db, staff.id, orderId);

  const printBarTicket = opts => autoPrintKitchenTicket(db, opts);
  let freshSnapshot;
  try {
    freshSnapshot = await onlineOrdersWatcher.refreshOnlineOrders(db, printBarTicket);
  } catch {
    freshSnapshot = onlineOrdersWatcher.getOnlineOrdersSnapshot();
  }

  return {
    refused: 1,
    order_id: orderId,
    refused_by: String(cloudResult.refused_by || staff.name || "").trim(),
    grace_minutes: Number(cloudResult.grace_minutes) || 2,
    refuse_mode: cloudResult.refuse_mode || "grace_v2",
    refuse_reason: refuseReason || cloudResult.refuse_reason || "",
    cloud_ok: !!cloudResult.ok,
    cloud_message: cloudResult.ok ? "" : (cloudResult.message || ""),
    snapshot: freshSnapshot,
  };
}

async function cancelPendingOnlineOrdersFlow(orderIds) {
  const ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) {
    throw Object.assign(new Error("Zgjidhni porosinë."), { status: 400 });
  }

  ensureOnlineOrdersWatcher();

  onlineOrdersWatcher.persistAcknowledged(db, ids);
  db.removePendingCloudOrders(ids);
  onlineOrdersWatcher.markOrdersPrinted(db, ids);

  let cloudResult = { ok: false, message: "", cancelled: 0, order_ids: [] };
  try {
    cloudResult = await cloudSync.cancelOnlineOrders(db, ids);
  } catch (e) {
    cloudResult = { ok: false, message: e.message || "", cancelled: 0, order_ids: [] };
  }

  if (!cloudResult.ok) {
    cloudSync.cancelOnlineOrders(db, ids).catch(() => {});
  }

  onlineOrdersWatcher.removeOrdersFromSnapshot(ids);
  const freshSnapshot = onlineOrdersWatcher.getOnlineOrdersSnapshot();

  return {
    cancelled: ids.length,
    cloud_ok: !!cloudResult.ok,
    cloud_message: cloudResult.ok ? "" : (cloudResult.message || ""),
    snapshot: freshSnapshot,
  };
}

/** Njofton cloud-in për mbylljen e një porosie cloud-linked (QR tavolinë ose
 * takeaway/online). Tavolinat fizike (QR) përputhen 1:1 me cloud sipas numrit
 * të tavolinës, kështu që ato mbyllen me `closeCloudTableOrdersForPayment`
 * (table_number). Sllotet virtuale "Online N" NUK kanë ekuivalent në cloud —
 * numri i tyre është vetëm një ID lokale, ndaj ai NUK duhet dërguar te cloud;
 * ato mbyllen me UUID-në reale (`cloud_order_id`) përmes `closeCloudOnlineOrderById`.
 * Dërgimi i numrit të sllotit si "tavolinë" te cloud prodhonte gabimin
 * "invalid input syntax for type uuid" kur ai numër (p.sh. 1 ose 2) nuk
 * korrespondonte me asnjë tavolinë reale në cloud. */
async function closeCloudLinkedSale(tableId, cloudOrderIds, opts = {}) {
  const ids = [...new Set((cloudOrderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  const tableRow = db.db.prepare("SELECT * FROM tables WHERE id = ?").get(Number(tableId));

  if (db.isPhysicalVenueTable(tableRow)) {
    return cloudSync.closeCloudTableOrdersForPayment(db, tableRow?.number || 0, {
      ...opts,
      cloud_order_ids: ids,
    });
  }

  if (!ids.length) return { closed: 0 };
  const staff = db.findStaffByName?.(opts.waiter_name) || null;
  let closed = 0;
  for (const orderId of ids) {
    try {
      await cloudSync.closeCloudOnlineOrderById(db, {
        order_id: orderId,
        payment_method: opts.payment_method,
        waiter_name: opts.waiter_name,
        waiter_id: staff?.cloud_waiter_id || staff?.id,
        items: opts.items,
        fiscal_skip: opts.fiscal_skip,
        coupon_type: opts.coupon_type,
      });
      closed += 1;
    } catch (err) {
      console.warn("[close] cloud online order:", orderId, err.message);
    }
  }
  return { closed };
}

function purgeClosedCloudOrdersFromWatcher(cloudOrderIds) {
  const ids = [...new Set((cloudOrderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return;
  onlineOrdersWatcher.purgeRemoteHandledOrderIds(db, ids);
}

async function acceptAllPendingForStaff(staff, pin, seedOrders = []) {
  const printBarTicket = opts => autoPrintKitchenTicket(db, opts);
  const importedAll = [];
  const errors = [];
  let accepted = 0;

  for (let round = 0; round < 50; round += 1) {
    ensureOnlineOrdersWatcher();
    let snap;
    try {
      snap = await onlineOrdersWatcher.refreshOnlineOrders(db, printBarTicket);
    } catch {
      snap = onlineOrdersWatcher.getOnlineOrdersSnapshot();
    }
    let pending = (snap.orders || []).filter(o => o?.id && !db.isCloudOrderHandledLocally(o.id));
    if (!pending.length && seedOrders.length) {
      pending = seedOrders.filter(o => o?.id && !db.isCloudOrderHandledLocally(o.id));
    }
    if (!pending.length) break;

    try {
      const flow = await acceptOnlineOrdersFlow([String(pending[0].id)], pin, {
        fallbackOrders: pending,
        trustedStaff: staff,
      });
      importedAll.push(...(flow.imported || []));
      accepted += 1;
      seedOrders = [];
    } catch (e) {
      errors.push(e.message || "Pranimi dështoi.");
      break;
    }
  }

  return {
    accepted,
    imported: importedAll,
    errors,
    acknowledged: accepted,
    accepted_by: String(staff.name || "").trim(),
  };
}

async function autoPrintOrderSlip(db, { tableNumber, waiterName, items, batchNumber = 0, order = null, closedAt = "", acceptedBy = "" }) {
  // Order ticket (bar/kuzhinë) — GJITHMONË, pavarësisht fiscal ON/OFF ose replace/addon.
  // shouldPrintClosingNormalReceipt / replace mode NUK prek këtë rrugë.
  if (!items?.length) return { printed: false };
  const fiscal = db.getFiscalSettings();
  const { splitItemsByStation } = require("./print-routing");
  const { barItems, kitchenItems } = splitItemsByStation(items, db);
  const at = closedAt || new Date().toISOString();
  // Ndarja bar/kuzhinë mbetet gjithmonë — edhe me 1 printer printohen 2 fletë të ndara.
  // Nëse mungon printeri i kuzhinës, receipt-print bie te printeri i barit por fleta mbetet «kuzhinë».

  async function printStation(batchItems, station) {
    if (!batchItems.length) return null;
    const total = batchItems.reduce(
      (s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0),
      0,
    );
    return receiptPrint.printOrderReceipt(db, {
      order: order || { waiter_name: waiterName, accepted_by: acceptedBy },
      tableNumber,
      items: batchItems,
      totals: { total },
      fiscal,
      closedAt: at,
      orderNumber: batchNumber > 0 ? String(batchNumber) : "",
      slipKind: "order",
      station,
      acceptedBy,
    });
  }

  try {
    const results = [];
    if (barItems.length) results.push(await printStation(barItems, "bar"));
    if (kitchenItems.length) results.push(await printStation(kitchenItems, "kitchen"));
    const printed = results.some(r => r?.printed);
    return {
      printed,
      results,
      bar_items: barItems.length,
      kitchen_items: kitchenItems.length,
    };
  } catch (e) {
    console.warn("Order slip:", e.message);
    return { printed: false, message: e.message };
  }
}

/** Alias për porosi online / banak — një porosi = një fletë. */
async function autoPrintKitchenTicket(db, opts) {
  return autoPrintOrderSlip(db, opts);
}

/** Print fatura qëndrimi hoteli — ESC/POS 80mm (banak / fiskal). */
async function printGuestFolioReceipt(db, folio) {
  const settings = db.getSettings();
  const fiscal = db.getFiscalSettings();
  const hotelName = folio?.hotel_name || settings.business_name || "Hotel";
  const html = buildGuestFolioPrintHtml(folio, fiscal, hotelName);
  try {
    return await printer.printReceiptAt(html, db, "fiscal");
  } catch {
    const text = buildGuestFolioPrintLines(folio, fiscal, hotelName).join("\n");
    return await printer.printPlainTextAt(text, db, "bar");
  }
}

function syncCatalogToCloud() {
  cloudAutoSync.scheduleCatalogPush(db);
}

function toMenuItemDto(item) {
  const { photo, ...rest } = item;
  const dbPhoto = String(photo || "").trim();
  const stock = String(menuStockPhotos.stockPhotoForName(item.name) || "").trim();
  const hasStored = Boolean(dbPhoto) || Boolean(item.has_photo);
  const p = dbPhoto || (!hasStored ? stock : "");
  rest.has_photo = hasStored || Boolean(stock);
  rest.system_photo = Boolean(p) && (!hasStored || menuStockPhotos.isStockPhoto(dbPhoto || p));
  if (p.startsWith("/") || /^https?:\/\//i.test(p)) rest.photo_src = p;
  return rest;
}

function sendMenuPhoto(res, photoPath) {
  const filePath = path.join(__dirname, "public", photoPath.replace(/^\//, ""));
  if (!fs.existsSync(filePath)) return false;
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(filePath);
  return true;
}

function electronApp() {
  try {
    return require("electron").app;
  } catch {
    return null;
  }
}

function isFullPackageTier(tier) {
  return String(tier || "").trim() === "pako_5";
}

function normalizeStaffName(name) {
  return String(name || "").trim().toLowerCase().normalize("NFC");
}

/** Linket e kamarierëve: Standard+ (pako_3 / pako_4 / pako_5). */
function canShowKdsStaffLinks() {
  const t = String(VERSION.packageTier || "").trim();
  return t === "pako_3" || t === "pako_4" || t === "pako_5";
}

function resolveStaffWaiterUrl(cloudWaiter) {
  if (!cloudWaiter) return "";
  const fromCloud = String(cloudWaiter.waiter_url || "").trim();
  if (fromCloud) return fromCloud;
  const settings = db.getCloudSettings();
  const slug = settings.kitchen_slug || settings.cloud_client_id || "";
  const key = settings.kitchen_key || "";
  return buildWaiterPersonalUrl(slug, key, cloudWaiter.web_token);
}

function getLocalAdminUrl() {
  const port = process.env.ACTUAL_PORT || process.env.PORT || 3001;
  let ip = "";
  for (const ifName of Object.keys(os.networkInterfaces())) {
    for (const net of os.networkInterfaces()[ifName] || []) {
      if (net.family === "IPv4" && !net.internal) {
        ip = net.address;
        break;
      }
    }
    if (ip) break;
  }
  if (!ip) ip = "127.0.0.1";
  return `http://${ip}:${port}/admin.html`;
}

function cloudSyncLinksPayload(settings, status) {
  const health = require("./cloud-health").getHealthStatus();
  const serverUrl = getPublicCloudServerUrl();
  const slug = status.kitchen_slug || settings.kitchen_slug || status.client_id || settings.cloud_client_id || "";
  const key = status.kitchen_key || settings.kitchen_key || "";
  const built = buildCloudAccessLinks(serverUrl, { kitchen_slug: slug, kitchen_key: key, client_id: slug });
  const waiter_url = status.waiter_url || built.waiter_url;
  const bar_url = status.bar_url || built.bar_url;
  const kitchen_url = status.kitchen_url || built.kitchen_url;
  const kiosk_url = status.kiosk_url || built.kiosk_url;
  const public_page_url = status.public_page_url || built.public_page_url;
  return {
    connected: !!health.online && !!status.connected,
    offline: !health.online,
    mode: health.mode,
    public_server: health.public_server,
    active_server: health.active_server,
    owner_message: health.message,
    status_message: status.message || health.message,
    links_stale: !!status.links_stale,
    client_id: status.client_id || settings.cloud_client_id || "",
    client_name: status.client_name || settings.cloud_client_name || "",
    links_ready: !!(waiter_url || bar_url || kitchen_url || kiosk_url || public_page_url),
    waiter_url,
    bar_url,
    kitchen_url,
    kiosk_url,
    public_page_url,
  };
}

const app = express();
const PORT = process.env.PORT || 3001;
const SESSION_TTL = 12 * 60 * 60 * 1000;

const sessions = new Map();

function createSession(role, emri, staffId = null) {
  const token = crypto.randomBytes(24).toString("hex");
  const loginAt = Date.now();
  sessions.set(token, { role, emri, staff_id: staffId || null, loginAt });
  return { token, login_time: new Date(loginAt).toISOString() };
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.loginAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function auth(req, res, next) {
  const token = req.headers["x-session-token"] || req.query.token;
  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ gabim: "Sesioni skadoi. Hyni përsëri." });
  }
  req.session = session;
  req.sessionToken = token;
  next();
}

function adminOnly(req, res, next) {
  if (req.session.role !== "admin") {
    return res.status(403).json({ gabim: "Vetëm admini ka akses." });
  }
  next();
}

function waiterOnly(req, res, next) {
  if (req.session.role !== "kamarier") {
    return res.status(403).json({ gabim: "Vetëm kamarieri ka akses." });
  }
  next();
}

/** Recepsioni (kamarier) ose pronari — Check-in / Check-out dhomash. */
function staffOrAdmin(req, res, next) {
  const role = req.session?.role;
  if (role !== "kamarier" && role !== "admin") {
    return res.status(403).json({ gabim: "Nuk keni akses." });
  }
  next();
}

/** Recepsionisti (kamarier) ose pronari — Check-in / Check-out dhomash. */
function staffOrAdmin(req, res, next) {
  const role = req.session?.role;
  if (role !== "kamarier" && role !== "admin") {
    return res.status(403).json({ gabim: "Nuk keni akses." });
  }
  next();
}

function auditActivity(userName, userRole, action, detail = "") {
  try {
    db.logActivity({ user_name: userName, user_role: userRole, action, detail });
  } catch (e) {
    console.warn("activity_log:", e.message);
  }
}

/** Audit fiskal për login (kush / kur / IP) — pa hapur UI SEF. */
function logFiscalLoginAudit(req, operatorName, operatorId) {
  try {
    const ip =
      String(req.headers["x-forwarded-for"] || "")
        .split(",")[0]
        .trim() ||
      req.socket?.remoteAddress ||
      req.ip ||
      null;
    fiscalAudit.logFiscalAction(
      "login",
      {
        event: "login",
        operator_name: operatorName,
        operator_id: String(operatorId || "POS"),
        ip,
        user_agent: String(req.headers["user-agent"] || "").slice(0, 180) || null,
        at: new Date().toISOString(),
      },
      operatorName,
      String(operatorId || "POS")
    );
  } catch (e) {
    console.warn("[fiscal-audit] login:", e.message);
  }
}

function auditReq(req, action, detail = "") {
  auditActivity(req.session?.emri || "—", req.session?.role || "—", action, detail);
}

const { getDiskStatus, blocksNewRecords } = require("./disk-monitor");
const dbCrypto = require("./db-crypto");

function resolveHotelDbPath() {
  return db.DB_PATH || process.env.DB_PATH || dbCrypto.getDbPath();
}

let cachedDiskStatus = getDiskStatus(resolveHotelDbPath());

function refreshDiskStatus() {
  cachedDiskStatus = getDiskStatus(resolveHotelDbPath());
  return cachedDiskStatus;
}

function auditDiskStatus(status) {
  if (!status || status.level === "ok" || status.unknown) return;
  const action =
    status.level === "critical" ? "Disku kritik" : "Paralajmërim disku";
  const detail = `${status.message || ""} (${status.free_mb != null ? status.free_mb + " MB të lira" : "?"})`;
  auditActivity("SYSTEM", "system", action, detail);
}

function diskGuardResponse(res) {
  const status = refreshDiskStatus();
  if (!blocksNewRecords(status)) return null;
  return res.status(507).json({
    ok: false,
    disk_full: true,
    gabim: status.message || "Disku i mbushur — lironi hapësirë",
    disk: status,
  });
}

const DISK_GUARD_SKIP = new Set([
  "/api/system/disk-status",
  "/api/backup/run",
]);

auditDiskStatus(cachedDiskStatus);
setInterval(() => {
  auditDiskStatus(refreshDiskStatus());
}, 30 * 60 * 1000);

function ditariOptsFromQuery(query = {}) {
  if (query.from_date || query.from_datetime) {
    const fromDatetime = query.from_datetime
      || `${query.from_date} ${query.from_time || "00:00:00"}`;
    const toDatetime = query.to_datetime
      || `${query.to_date || query.from_date} ${query.to_time || "23:59:59"}`;
    return { fromDatetime, toDatetime };
  }
  return { period: query.period || "sot" };
}

app.use(express.json({ limit: "12mb" }));
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - t0;
    if (ms < 100) return;
    const line = `${req.method} ${req.originalUrl || req.url}`;
    console.log(`[slow-http] ${ms}ms ${line}`);
    try {
      const p = process.env.DB_PATH
        ? path.join(path.dirname(process.env.DB_PATH), "slow-ops.jsonl")
        : null;
      if (p) {
        fs.appendFileSync(
          p,
          JSON.stringify({ t: new Date().toISOString(), kind: "http", ms, detail: line.slice(0, 220) }) + "\n",
        );
      }
    } catch {
      /* ignore */
    }
  });
  next();
});
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const p = String(req.path || "");
    if (!DISK_GUARD_SKIP.has(p)) {
      const blocked = diskGuardResponse(res);
      if (blocked) return;
    }
  }
  next();
});
app.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === "object") {
      if (typeof body.gabim === "string") body.gabim = i18n.t(body.gabim);
      if (typeof body.message === "string") body.message = i18n.t(body.message);
      if (typeof body.printMessage === "string") body.printMessage = i18n.t(body.printMessage);
    }
    return origJson(body);
  };
  next();
});
app.get("/api/locale", (_req, res) => {
  res.json(i18n.localeInfo());
});
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
    }
  },
}));

app.get("/", (_req, res) => {
  if (!db.isSetupDone()) return res.redirect("/setup.html");
  res.redirect("/login.html");
});

/* ─── Setup (publik) ─── */
app.get("/api/setup/status", (_req, res) => {
  const payload = {
    setup_done: db.isSetupDone(),
    ...db.getSettings(),
    ...db.getVersionInfo(),
  };
  const eapp = electronApp();
  if (eapp) {
    try {
      payload.license = license.getLoginLicenseDisplay(eapp);
    } catch {
      payload.license = null;
    }
  }
  res.json(payload);
});

app.post("/api/setup", (req, res) => {
  if (db.isSetupDone()) {
    return res.status(400).json({ gabim: "Konfigurimi është bërë tashmë" });
  }
  const {
    restaurant_name,
    admin_password,
    table_count,
    business_subtype,
    business_type,
  } = req.body || {};
  if (!admin_password || admin_password.length < 4) {
    return res.status(400).json({ gabim: "Fjalëkalimi duhet të ketë të paktën 4 karaktere" });
  }
  const name = String(restaurant_name || "").trim();
  if (!name) {
    return res.status(400).json({ gabim: "Emri i objektit është i detyrueshëm" });
  }
  const subtype = business_subtype || business_type;
  if (!subtype) {
    return res.status(400).json({
      gabim: "Zgjidhni llojin: Hotel, Motel, Villa, Hostel ose Resort",
    });
  }
  try {
    db.runSetup({
      restaurant_name: name,
      admin_password,
      table_count,
      business_subtype: subtype,
    });
    try {
      const n = db.ensureMenuStockPhotos();
      if (n) console.log(`Setup: ${n} foto menu u vendosën automatikisht`);
    } catch (e) {
      console.warn("Setup stock photos:", e.message);
    }
    setTimeout(() => {
      cloudSync.syncRestaurantIdentityFromCloud(db).catch(() => {});
      syncCatalogToCloud();
    }, 500);
    res.json({ ok: true, ...db.getSettings() });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

/* ─── Login / Logout ─── */
app.post("/api/login", (req, res) => {
  const emri = (req.body.emri ?? req.body.name ?? "").toString();
  const roli = req.body.roli ?? (req.body.role === "waiter" ? "kamarier" : req.body.role);
  const fjalekalimi = req.body.fjalekalimi ?? req.body.password ?? "";

  if (roli === "admin") {
    if (!db.verifyAdminPassword(fjalekalimi || "")) {
      return res.status(401).json({ gabim: "Fjalëkalimi i adminit është i gabuar" });
    }
    const sess = createSession("admin", emri?.trim() || "Admin");
    const adminName = emri?.trim() || "Admin";
    auditActivity(adminName, "admin", "Hyrje pronari", "Fjalëkalim admin");
    logFiscalLoginAudit(req, adminName, "ADMIN");
    return res.json({ ok: true, roli: "admin", emri: adminName, ...sess });
  }

  if (roli === "kamarier") {
    return res.status(400).json({ gabim: "Kamarierët hyjnë vetëm me PIN (4 shifra)" });
  }

  res.status(400).json({ gabim: "Zgjidhni rolin: Admin ose Kamarier" });
});

app.get("/api/login/waiters", (_req, res) => {
  if (!db.isSetupDone()) {
    return res.json({ waiters: [] });
  }
  res.json({ waiters: db.getStaffForLogin() });
});

app.get("/api/login/online-orders", async (_req, res) => {
  try {
    ensureOnlineOrdersWatcher();
    const printBarTicket = opts => autoPrintKitchenTicket(db, opts);
    let snap;
    try {
      snap = await onlineOrdersWatcher.refreshOnlineOrders(db, printBarTicket);
    } catch {
      snap = onlineOrdersWatcher.getOnlineOrdersSnapshot();
    }
    let data;
    if (typeof cloudSync.isCloudConfigured === "function" && cloudSync.isCloudConfigured(db)) {
      data = await cloudSync.fetchLoginOrderNotify(db);
      if (!data.orders?.length && !(data.bar_orders || []).length && (snap.orders || []).length) {
        data = cloudSync.buildLoginNotifyFromOrders(db, snap.orders || [], snap);
      }
    } else {
      data = cloudSync.buildLoginNotifyFromOrders(db, snap.orders || [], snap);
    }
    res.json({
      ok: data.ok !== false,
      connected: data.connected,
      pending: data.pending,
      has_pending: data.has_pending,
      has_new: !!data.has_new,
      orders: data.orders || [],
      bar_pending: data.bar_pending || 0,
      bar_orders: data.bar_orders || [],
      message: data.message || "",
    });
  } catch (e) {
    res.json({
      ok: false,
      orders: [],
      pending: 0,
      has_pending: false,
      connected: false,
      message: e.message || "Gabim leximi porosish.",
    });
  }
});

app.post("/api/login/online-orders/acknowledge", async (req, res) => {
  try {
    const orderIds = Array.isArray(req.body?.order_ids)
      ? req.body.order_ids
      : (req.body?.order_id ? [req.body.order_id] : []);
    const ids = [...new Set(orderIds.map(id => String(id || "").trim()).filter(Boolean))];
    if (!ids.length) {
      return res.json({ ok: true, acknowledged: 0, pending: 0, has_pending: false, has_new: false, orders: [] });
    }

    const fallbackOrders = Array.isArray(req.body?.orders) ? req.body.orders : [];
    const flow = await acceptOnlineOrdersFlow(ids, req.body?.pin || req.body?.waiter_pin, { fallbackOrders });
    const snapshot = flow.snapshot || {};

    res.json({
      ok: true,
      acknowledged: flow.acknowledged,
      accepted_by: flow.accepted_by,
      imported: flow.imported,
      cloud_ok: !!flow.cloud_ok,
      cloud_message: flow.cloud_message || "",
      pending: snapshot.pending || 0,
      has_pending: !!snapshot.has_pending,
      has_new: false,
      connected: !!snapshot.connected,
      orders: snapshot.orders || [],
    });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.get("/api/login/bar-url", (_req, res) => {
  res.json({
    ok: true,
    bar_url: cloudSync.getBarScreenUrl(db) || "",
    cloud_ready: cloudSync.isCloudConfigured(db),
  });
});

/** Kamarieri «Harruat PIN?» → cloud dërgon kodin te email i pronarit (kodi nuk kthehet). */
app.post("/api/login/emergency-request", async (req, res) => {
  const publicMsg = "Kodi u dërgua te pronari juaj — kontaktoni pronarin.";
  try {
    const waiterName = String(req.body.waiter_name || req.body.emri || "").trim();
    const result = await license.requestEmergencyCodeToOwner(electronApp(), { waiterName });
    /* Gjithmonë 200 + mesazh publik — mos ekspozo detaje / kod. */
    res.json({
      ok: true,
      sent: !!(result.ok || result.sent),
      message: publicMsg,
    });
  } catch {
    res.json({ ok: true, sent: false, message: publicMsg });
  }
});

app.post("/api/login/emergency", async (req, res) => {
  const code = String(req.body.code || req.body.emergency_code || req.body.master_pin || "").trim();
  const role = req.body.role === "kamarier" ? "kamarier" : "admin";
  const staffId = req.body.staff_id != null ? Number(req.body.staff_id) : null;

  if (!code) {
    return res.status(400).json({ gabim: "Shkruani kodin emergjence." });
  }

  try {
    const unlock = await license.validateEmergencyUnlock({
      master_pin: code,
      emergency_code: code.replace(/\D/g, "") || code,
    });
    if (!unlock.valid) {
      return res.status(401).json({ gabim: unlock.message || "Kodi emergjence i gabuar." });
    }

    if (role === "kamarier") {
      // Harruat PIN: mjafton kodi emergjence + zgjedhja e kamarierit (staff_id).
      // PIN opsional vetëm nëse e dinë ende.
      let staff = staffId ? db.getStaff().find(s => s.id === staffId && s.active) : null;
      if (!staff) {
        const pin = String(req.body.pin || "").trim();
        if (/^\d{4}$/.test(pin)) {
          staff = db.findStaffByPin(pin);
        }
      }
      if (!staff) {
        const waiters = db.getStaffForLogin();
        if (waiters.length === 1) {
          staff = db.getStaff().find(s => s.id === waiters[0].id && s.active) || null;
        }
      }
      if (!staff) {
        return res.status(400).json({
          gabim: "Zgjidhni emrin tuaj (kamarieri), pastaj kodin emergjence 6-shifror. PIN nuk duhet.",
          code: "NEED_STAFF",
          waiters: db.getStaffForLogin(),
        });
      }
      const sess = createSession("kamarier", staff.name, staff.id);
      auditActivity(staff.name, "kamarier", "Hyrje emergjence", "Kamarier");
      logFiscalLoginAudit(req, staff.name, staff.id);
      return res.json({
        ok: true,
        roli: "kamarier",
        emri: staff.name,
        staff_id: staff.id,
        emergency: true,
        ...sess,
      });
    }

    const sess = createSession("admin", "Admin");
    auditActivity("Admin", "admin", "Hyrje emergjence", "Pronari");
    logFiscalLoginAudit(req, "Admin", "ADMIN");
    return res.json({
      ok: true,
      roli: "admin",
      emri: "Admin",
      emergency: true,
      ...sess,
    });
  } catch (e) {
    return res.status(500).json({ gabim: e.message });
  }
});

app.post("/api/login/pin", async (req, res) => {
  const pin = String(req.body.pin ?? "").trim();
  const staffId = req.body.staff_id != null ? Number(req.body.staff_id) : null;
  if (!/^\d{4}$/.test(pin)) {
    return res.status(400).json({ gabim: "PIN duhet të jetë 4 shifra" });
  }
  try {
    const staff = db.findStaffByPin(pin);
    if (!staff) {
      return res.status(401).json({ gabim: "PIN i gabuar!" });
    }
    if (staffId != null && staff.id !== staffId) {
      return res.status(401).json({ gabim: "PIN i gabuar për këtë kamarier!" });
    }

    const sess = createSession("kamarier", staff.name, staff.id);
    auditActivity(staff.name, "kamarier", "Hyrje PIN", "4 shifra");
    logFiscalLoginAudit(req, staff.name, staff.id);

    return res.json({
      ok: true,
      roli: "kamarier",
      emri: staff.name,
      staff_id: staff.id,
      ...sess,
    });
  } catch (e) {
    const status = e.status || 400;
    return res.status(status).json({ gabim: e.message });
  }
});

app.post("/api/login/card", async (req, res) => {
  const card_uid = req.body.card_uid ?? req.body.card ?? req.body.uid ?? "";
  const staffId = req.body.staff_id != null ? Number(req.body.staff_id) : null;
  try {
    const staff = db.findStaffByCard(card_uid);
    if (!staff) {
      return res.status(401).json({ gabim: "Kartela nuk njihet!" });
    }
    if (staffId != null && staff.id !== staffId) {
      return res.status(401).json({ gabim: "Kjo kartelë nuk i takon këtij kamarieri!" });
    }
    const sess = createSession("kamarier", staff.name, staff.id);
    auditActivity(staff.name, "kamarier", "Hyrje kartelë RFID", "RFID");
    logFiscalLoginAudit(req, staff.name, staff.id);

    return res.json({
      ok: true,
      roli: "kamarier",
      emri: staff.name,
      staff_id: staff.id,
      ...sess,
    });
  } catch (e) {
    return res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/logout", auth, (req, res) => {
  auditReq(req, "Dalje nga sistemi");
  sessions.delete(req.sessionToken);
  res.json({ ok: true });
});

/* ─── Kamarier (i mbrojtur) ─── */
app.get("/api/waiter/cloud-tables", auth, waiterOnly, async (req, res) => {
  try {
    const live = await cloudSync.fetchLiveCloudTables(db);
    res.json({ ok: true, tables: live?.tables || [], updated_at: live?.updated_at || null });
  } catch (e) {
    res.json({ ok: false, tables: [], gabim: e.message });
  }
});

app.post("/api/waiter/trigger-sync", auth, waiterOnly, async (req, res) => {
  try {
    ensureOnlineOrdersWatcher();
    const pbt = opts => autoPrintKitchenTicket(db, opts);
    const snap = await onlineOrdersWatcher.refreshOnlineOrders(db, pbt);
    res.json({ ok: true, pending: snap?.pending || 0 });
  } catch (e) {
    res.json({ ok: false, gabim: e.message });
  }
});

app.post("/api/waiter/import-cloud-table-order", auth, waiterOnly, async (req, res) => {
  try {
    let { order, waiter_name } = req.body || {};
    if (!order) return res.json({ ok: false, gabim: "Mungon porosia cloud" });
    order = await cloudSync.resolveCloudOrderPayload(db, order);
    if (!order?.id) {
      return res.json({ ok: false, gabim: "Mungon ID-ja e porosisë cloud (provoni rifreskim)" });
    }
    const activeExisting = db.getActiveOrderByCloudId(order.id);
    if (activeExisting) {
      db.db.prepare("UPDATE tables SET status = 'occupied' WHERE id = ?").run(activeExisting.table_id);
      const table = db.getTableById(activeExisting.table_id);
      return res.json({
        ok: true,
        skipped: true,
        table_id: activeExisting.table_id,
        table_number: table?.number || 0,
        waiter_name: activeExisting.waiter_name,
      });
    }
    const wName = String(
      waiter_name || order.accepted_by_waiter_name || order.accepted_by ||
      order.waiter_name || req.session.emri || "Kamarier"
    ).trim();
    const result = db.importCloudOrderToLocal(order, wName);
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, gabim: e.message });
  }
});

// Porosi të gatshme nga banaku — alarm te kamarieri
const _seenReadyOrderIds = new Set();

app.get("/api/waiter/orders/ready-check", auth, waiterOnly, async (_req, res) => {
  try {
    const orders = await cloudSync.fetchReadyTableOrders(db);
    const unseen = orders.filter(o => !_seenReadyOrderIds.has(String(o.id)));
    res.json({ ok: true, orders: unseen, has_ready: unseen.length > 0 });
  } catch {
    res.json({ ok: true, orders: [], has_ready: false });
  }
});

app.post("/api/waiter/orders/ready-dismiss", auth, waiterOnly, (req, res) => {
  const ids = Array.isArray(req.body?.order_ids) ? req.body.order_ids : [];
  ids.forEach(id => _seenReadyOrderIds.add(String(id)));
  res.json({ ok: true, dismissed: ids.length });
});

app.get("/api/waiter/online-orders/pending", auth, waiterOnly, async (req, res) => {
  try {
    ensureOnlineOrdersWatcher();
    const printBarTicket = opts => autoPrintKitchenTicket(db, opts);
    let data;
    try {
      data = await onlineOrdersWatcher.refreshOnlineOrders(db, printBarTicket);
    } catch {
      data = onlineOrdersWatcher.getOnlineOrdersSnapshot();
    }
    const isAcceptPending = (o) => o?.id && (
      db.isCloudPosAcceptQueueOrder(o) || db.isCloudOnlinePickupOrder(o)
    );
    const isStillPendingForPos = (o) => isAcceptPending(o)
      && !cloudSync.isCloudOrderAccepted(o);
    let orders = (data.orders || []).filter(isStillPendingForPos);
    if (!orders.length && !data.connected) {
      orders = (db.listPendingCloudOrders() || []).filter(isStillPendingForPos);
    }
    if (!orders.length && data.connected && typeof cloudSync.isCloudConfigured === "function" && cloudSync.isCloudConfigured(db)) {
      try {
        const cloud = await cloudSync.fetchOnlineOrders(db);
        // Vetëm "orders" (ende në pritje sipas cloud) — kurrë "all_orders", pasi ai
        // përfshin edhe porositë e pranuara/mbyllura dhe do t'i "ringjallte" te paneli.
        const pool = cloud.orders || [];
        orders = pool.filter(isStillPendingForPos);
        if (orders.length) {
          data = { ...data, connected: !!cloud.connected, has_new: true };
        }
      } catch { /* offline */ }
    }
    orders = orders.map(o => db.enrichCloudOrderForWaiter(o));
    const layoutChanged = db.ensureTablesForPendingCloudOrders(orders);
    const staffId = resolveWaiterStaffId(req.session);
    if (staffId) {
      orders = orders.filter(o => !onlineOrdersWatcher.isStaffRefusedOrder(db, staffId, o.id));
    }
    const myOrders = staffId ? db.listActiveOnlineOrdersForStaffId(staffId) : [];
    const hasPending = orders.length > 0;
    res.json({
      ok: true,
      connected: !!data.connected,
      pending: orders.length,
      has_pending: hasPending,
      has_new: hasPending && !!data.has_new,
      orders,
      my_external: myOrders.length,
      my_orders: myOrders,
      layout_refresh: layoutChanged,
      message: data.message || "",
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.get("/api/waiter/online-slots", auth, waiterOnly, async (req, res) => {
  try {
    const who = resolveStaffCloudWaiterIdentity(req.session);
    const rawSlots = await cloudSync.fetchOnlineSlotLayout(db, who);
    const slots = rawSlots.map(slot => {
      const oid = String(slot?.order?.id || "").trim();
      if (!oid) return slot;
      const local = db.getOrderByCloudId(oid);
      if (local && String(local.status || "").toLowerCase() !== "active") {
        return { ...slot, status: "free", order: null };
      }
      return slot;
    });
    const fallback = Array.from({ length: 6 }, (_, i) => ({
      slot: i + 1,
      label: `Online ${i + 1}`,
      status: "free",
      order: null,
    }));
    res.json({
      ok: true,
      online_slots: slots.length ? slots : fallback,
      online_zone_title: "POROSI ONLINE",
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.post("/api/waiter/online-orders/open-slot", auth, waiterOnly, async (req, res) => {
  try {
    const orderId = String(req.body?.order_id || "").trim();
    const slotNum = Number(req.body?.online_slot) || 0;
    const who = resolveStaffCloudWaiterIdentity(req.session);
    const slots = await cloudSync.fetchOnlineSlotLayout(db, who);
    const slot = slots.find(s => Number(s.slot) === slotNum)
      || slots.find(s => String(s.order?.id || "") === orderId);
    if (!slot?.order?.id) {
      return res.status(404).json({ ok: false, gabim: "Porosia nuk u gjet në cloud." });
    }
    if (slot.status !== "accepted") {
      return res.status(400).json({ ok: false, gabim: "Porosia duhet pranuar fillimisht." });
    }
    const acceptName = String(slot.order.accepted_by_waiter_name || "").trim().toLowerCase();
    const myName = String(req.session.emri || "").trim().toLowerCase();
    if (acceptName && myName && acceptName !== myName) {
      return res.status(403).json({ ok: false, gabim: "Porosia i përket kamarierit tjetër." });
    }
    const result = db.importCloudOrderToLocal(
      { ...slot.order, online_slot: slot.slot },
      req.session.emri,
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.post("/api/waiter/online-orders/close", auth, waiterOnly, async (req, res) => {
  try {
    const orderId = String(req.body?.order_id || req.body?.cloud_order_id || "").trim();
    if (!orderId) return res.status(400).json({ ok: false, gabim: "Mungon order_id." });
    const items = db.parseOrderItems(req.body?.items || []);
    const staff = db.findStaffByName?.(req.session.emri) || null;
    const cloud = await cloudSync.closeCloudOnlineOrderById(db, {
      order_id: orderId,
      payment_method: req.body?.payment_method || "cash",
      waiter_name: req.session.emri,
      waiter_id: staff?.cloud_waiter_id || staff?.id,
      items,
    });
    const active = db.getActiveOrderByCloudId(orderId);
    if (active) {
      try {
        db.closeOrderById(active.id, req.session.emri, false, req.body?.payment_method || "cash", null, {
          allowAnyWaiter: true,
        });
      } catch {
        /* tashmë mbyllur në cloud */
      }
    }
    purgeClosedCloudOrdersFromWatcher([orderId]);
    res.json({ ok: true, ...cloud });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.post("/api/waiter/online-orders/accept", auth, waiterOnly, async (req, res) => {
  try {
    const orderIds = Array.isArray(req.body?.order_ids)
      ? req.body.order_ids
      : (req.body?.order_id ? [req.body.order_id] : []);
    const ids = [...new Set(orderIds.map(id => String(id || "").trim()).filter(Boolean))];
    if (!ids.length) {
      return res.status(400).json({ ok: false, gabim: "Zgjidhni porosinë." });
    }

    const staffId = resolveWaiterStaffId(req.session);
    const pin = String(req.body?.pin || req.body?.waiter_pin || "").trim();
    let trustedStaff = null;

    if (/^\d{4}$/.test(pin)) {
      const pinStaff = db.findStaffByPin(pin);
      if (!pinStaff) {
        return res.status(401).json({ ok: false, gabim: "PIN i gabuar!" });
      }
      if (staffId != null && Number(pinStaff.id) !== Number(staffId)) {
        return res.status(401).json({ ok: false, gabim: "PIN i gabuar për këtë kamarier!" });
      }
      trustedStaff = pinStaff;
    } else if (staffId != null) {
      trustedStaff = db.findStaffById(staffId);
      if (!trustedStaff) {
        return res.status(401).json({ ok: false, gabim: "Sesioni i kamarierit nuk u gjet." });
      }
    } else {
      return res.status(400).json({ ok: false, gabim: "Vendosni PIN-in tuaj (4 shifra)." });
    }

    const fallbackOrders = Array.isArray(req.body?.orders) ? req.body.orders : [];
    const ackPin = pin || String(trustedStaff?.pin || "").trim();
    const flow = await acceptOnlineOrdersFlow(
      ids,
      ackPin,
      { fallbackOrders, trustedStaff },
    );
    const myOrders = staffId ? db.listActiveOnlineOrdersForStaffId(staffId) : [];
    res.json({
      ok: true,
      acknowledged: flow.acknowledged,
      accepted_by: flow.accepted_by,
      imported: flow.imported,
      my_external: myOrders.length,
      my_orders: myOrders,
      pending: flow.snapshot?.pending || 0,
      has_pending: !!flow.snapshot?.has_pending,
      orders: flow.snapshot?.orders || [],
      cloud_ok: !!flow.cloud_ok,
      cloud_message: flow.cloud_message || "",
    });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.post("/api/waiter/online-orders/refuse", auth, waiterOnly, async (req, res) => {
  try {
    const orderIds = Array.isArray(req.body?.order_ids)
      ? req.body.order_ids
      : (req.body?.order_id ? [req.body.order_id] : []);
    const ids = [...new Set(orderIds.map(id => String(id || "").trim()).filter(Boolean))];
    if (!ids.length) {
      return res.status(400).json({ ok: false, gabim: "Zgjidhni porosinë." });
    }

    const staffId = resolveWaiterStaffId(req.session);
    const pin = String(req.body?.pin || req.body?.waiter_pin || "").trim();
    let trustedStaff = null;

    if (/^\d{4}$/.test(pin)) {
      const pinStaff = db.findStaffByPin(pin);
      if (!pinStaff) {
        return res.status(401).json({ ok: false, gabim: "PIN i gabuar!" });
      }
      if (staffId != null && Number(pinStaff.id) !== Number(staffId)) {
        return res.status(401).json({ ok: false, gabim: "PIN i gabuar për këtë kamarier!" });
      }
      trustedStaff = pinStaff;
    } else if (staffId != null) {
      trustedStaff = db.findStaffById(staffId);
      if (!trustedStaff) {
        return res.status(401).json({ ok: false, gabim: "Sesioni i kamarierit nuk u gjet." });
      }
    } else {
      return res.status(400).json({ ok: false, gabim: "Vendosni PIN-in tuaj (4 shifra)." });
    }

    const reason = String(req.body?.reason || req.body?.refuse_reason || "").trim();
    const flow = await refusePendingOnlineOrdersFlow(ids, { pin, trustedStaff, reason });
    const myOrders = staffId ? db.listActiveOnlineOrdersForStaffId(staffId) : [];
    res.json({
      ok: true,
      refused: flow.refused,
      order_id: flow.order_id,
      refused_by: flow.refused_by,
      grace_minutes: flow.grace_minutes,
      refuse_mode: flow.refuse_mode,
      refuse_reason: reason || flow.refuse_reason || "",
      pending: flow.snapshot?.pending || 0,
      has_pending: !!flow.snapshot?.has_pending,
      orders: flow.snapshot?.orders || [],
      my_external: myOrders.length,
      my_orders: myOrders,
      cloud_ok: !!flow.cloud_ok,
      cloud_message: flow.cloud_message || "",
    });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.post("/api/waiter/online-orders/cancel", auth, waiterOnly, async (req, res) => {
  try {
    const orderIds = Array.isArray(req.body?.order_ids)
      ? req.body.order_ids
      : (req.body?.order_id ? [req.body.order_id] : []);
    const ids = [...new Set(orderIds.map(id => String(id || "").trim()).filter(Boolean))];
    if (!ids.length) {
      return res.status(400).json({ ok: false, gabim: "Zgjidhni porosinë." });
    }

    const flow = await cancelPendingOnlineOrdersFlow(ids);
    const staffId = resolveWaiterStaffId(req.session);
    const myOrders = staffId ? db.listActiveOnlineOrdersForStaffId(staffId) : [];
    res.json({
      ok: true,
      cancelled: flow.cancelled,
      pending: flow.snapshot?.pending || 0,
      has_pending: !!flow.snapshot?.has_pending,
      orders: flow.snapshot?.orders || [],
      my_external: myOrders.length,
      my_orders: myOrders,
      cloud_ok: !!flow.cloud_ok,
      cloud_message: flow.cloud_message || "",
    });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.get("/api/waiter/online-orders/accepted", auth, waiterOnly, (_req, res) => {
  try {
    res.json({ ok: true, orders: db.listActiveOnlineOrders() });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.get("/api/waiter/settings", auth, waiterOnly, (_req, res) => {
  res.json({
    ...db.getSettings(),
    ...db.getVersionInfo(),
  });
});

app.get("/api/waiter/active-register-mode", auth, (req, res) => {
  try {
    const state = registerMode.getRegisterModeState(db);
    res.json({ ok: true, ...state });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

function resolveWaiterStaffId(session) {
  if (session.staff_id) return Number(session.staff_id);
  const emri = String(session.emri || "").trim();
  if (!emri) return null;
  const staff = db.findStaffByName(emri) || db.findStaffByNameInsensitive(emri);
  return staff?.id ? Number(staff.id) : null;
}

function resolveStaffCloudWaiterIdentity(session) {
  const name = String(session?.emri || "").trim();
  if (!name) return { waiterId: "", waiterName: "" };
  const staff = db.findStaffByName(name) || db.findStaffByNameInsensitive(name);
  return {
    waiterId: String(staff?.cloud_waiter_id || staff?.id || "").trim(),
    waiterName: name,
  };
}

app.get("/api/waiter/shift/peers", auth, waiterOnly, (req, res) => {
  try {
    const staffId = resolveWaiterStaffId(req.session);
    if (!staffId) {
      return res.status(400).json({ gabim: "Kamarieri nuk u identifikua." });
    }
    res.json({ ok: true, peers: db.listHandoverPeers(staffId) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/shift/accept-handover", auth, waiterOnly, (req, res) => {
  try {
    const staffId = resolveWaiterStaffId(req.session);
    if (!staffId) {
      return res.status(400).json({ gabim: "Kamarieri nuk u identifikua." });
    }
    const summary = db.acceptShiftHandover(
      staffId,
      req.body?.handover_id,
      req.body?.opening_cash,
    );
    auditReq(req, "Pranim nderrimi", `${summary.waiter_name}: ${summary.opening_cash} EUR`);
    res.json({ ok: true, ...summary });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/shift/open", auth, waiterOnly, (req, res) => {
  try {
    const staffId = resolveWaiterStaffId(req.session);
    if (!staffId) {
      return res.status(400).json({ gabim: "Kamarieri nuk u identifikua. Dilni dhe hyni përsëri." });
    }
    const summary = db.openWaiterShiftWithCash(staffId, req.body?.opening_cash);
    auditReq(req, "Hapje nderrimi", `${summary.waiter_name}: ${summary.opening_cash} EUR`);
    res.json({ ok: true, ...summary });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/waiter/shift", auth, waiterOnly, (req, res) => {
  try {
    const staffId = resolveWaiterStaffId(req.session);
    if (!staffId) {
      return res.status(400).json({ gabim: "Kamarieri nuk u identifikua. Dilni dhe hyni përsëri." });
    }
    const summary = db.getWaiterShiftSummary(staffId);
    if (!summary) return res.status(404).json({ gabim: "Kamarieri nuk u gjet." });
    res.json({
      ok: true,
      ...summary,
      shift_ended: !!req.session.shift_ended,
      close_summary: req.session.shift_close_summary || null,
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/shift/close", auth, waiterOnly, async (req, res) => {
  try {
    const staffId = resolveWaiterStaffId(req.session);
    if (!staffId) {
      return res.status(400).json({ gabim: "Kamarieri nuk u identifikua. Dilni dhe hyni përsëri." });
    }
    const closed = db.closeWaiterShift(
      staffId,
      req.body?.actual_closing_cash,
      req.body?.handover_to_staff_id,
    );
    const salesDetail = db.getShiftSalesDetail(closed.shift.id);
    const printerConfig = printer.getPrinterConfig(db);
    const printEnabled = printerConfig.waiter_shift_print_enabled !== false;

    req.session.shift_ended = true;
    req.session.shift_close_summary = {
      order_count: closed.order_count,
      discount_total: closed.discount_total,
      opening_cash: closed.opening_cash,
      cash_total: closed.cash_total,
      card_total: closed.card_total,
      closing_cash_actual: closed.closing_cash_actual,
      expected_closing_cash: closed.expected_closing_cash,
      cash_difference: closed.cash_difference,
      handed_over_to_name: closed.handed_over_to_name,
      sales_detail: salesDetail,
      print_enabled: printEnabled,
      printed: false,
      printMessage: printEnabled ? "Duke printuar pazarin..." : "Printimi i pazarit është çaktivizuar nga pronari.",
    };

    auditReq(req, "Mbyllje nderrimi", `${closed.waiter_name}: ${closed.closing_cash_actual} EUR`);

    res.json({
      ok: true,
      ...closed,
      sales_detail: salesDetail,
      print_enabled: printEnabled,
      shift_ended: true,
      printed: false,
      printMessage: req.session.shift_close_summary.printMessage,
    });

    setImmediate(() => {
      notifyShiftCloseEmail(db, closed).catch(err => {
        console.warn("[shift-close-email]", err.message || err);
      });
    });

    if (!printEnabled) return;

    setImmediate(async () => {
      try {
        const settings = db.getSettings();
        const fiscal = db.getFiscalSettings();
        const { buildShiftCloseLines } = require("./waiter-shift-html");

        let paper = printerConfig.paper === "58mm" ? "58mm" : "80mm";
        try {
          const resolved = await Promise.race([
            printer.ensureReceiptPrinter(db, "bar"),
            new Promise((_, reject) => setTimeout(() => reject(new Error("printer timeout")), 2500)),
          ]);
          paper = resolved?.paper || paper;
        } catch {
          /* printer i panjohur — vazhdo me tekst në 80mm */
        }

        const reportPayload = {
          restaurantName: fiscal.biz_name || settings.business_name,
          phone: fiscal.biz_phone,
          address: fiscal.biz_address,
          city: fiscal.biz_city,
          registerName: fiscal.biz_register_number,
          cashierName: fiscal.biz_cashier_operator,
          waiterName: closed.waiter_name,
          shift: closed.shift,
          totals: closed,
          salesDetail,
          paper,
        };

        const text = buildShiftCloseLines({ fiscal, ...reportPayload }).join("\n");
        const printResult = await printer.printPlainTextAt(text, db, "bar");
        req.session.shift_close_summary.printed = true;
        req.session.shift_close_summary.printMessage = printResult?.printer
          ? `U printua te ${printResult.printer}`
          : "Pazari u printua.";
      } catch (err) {
        req.session.shift_close_summary.printMessage =
          err.message || "Printimi dështoi — ruajeni raportin manualisht.";
      }
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/admin/refused-orders", auth, adminOnly, async (req, res) => {
  try {
    const data = await cloudSync.listRefusedOrders(db, {
      from: req.query.from,
      to: req.query.to,
      limit: Number(req.query.limit) || 100,
    });
    if (!data.ok) {
      return res.status(data.connected === false ? 503 : 400).json({
        ok: false,
        gabim: data.message || "Nuk u lexuan refuzimet.",
        orders: [],
        stats: data.stats || { today: 0, week: 0, month: 0 },
      });
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim.", orders: [], stats: { today: 0, week: 0, month: 0 } });
  }
});

app.get("/api/admin/shift-reports", auth, adminOnly, (req, res) => {
  try {
    const rows = db.listShiftReports({
      from: req.query.from,
      to: req.query.to,
      staff_id: req.query.staff_id,
    });
    res.json({ ok: true, shifts: rows });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/menu", auth, (req, res) => {
  res.json(db.getMenuItems(true).map(toMenuItemDto));
});

app.get("/api/menu/:id/photo", auth, (req, res) => {
  const id = Number(req.params.id);
  const item = typeof db.getMenuItemById === "function"
    ? db.getMenuItemById(id)
    : db.getMenuItems(false).find(i => i.id === id);
  const stock = item ? menuStockPhotos.stockPhotoForName(item.name) : "";
  const stored = db.getMenuItemPhoto(id);
  const photo = String(stored || "").trim() || stock || "";
  const s = String(photo || "").trim();
  if (!s) return res.status(404).end();
  if (s.startsWith("/")) {
    if (sendMenuPhoto(res, s)) return;
    return res.status(404).end();
  }
  const dataMatch = s.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataMatch) {
    res.setHeader("Content-Type", dataMatch[1]);
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.send(Buffer.from(dataMatch[2], "base64"));
  }
  if (/^https?:\/\//i.test(s)) {
    return res.redirect(302, s);
  }
  try {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.send(Buffer.from(s, "base64"));
  } catch {
    return res.status(404).end();
  }
});

app.get("/api/categories", auth, (req, res) => {
  res.json(db.getCategories());
});

function enrichTableRow(t, session) {
  const waiterName = session?.role === "kamarier" ? session.emri : null;
  const isAdmin = session?.role === "admin";
  return {
    ...t,
    can_edit: !t.order || isAdmin || (waiterName && t.order.waiter_name === waiterName),
    occupied_by: t.order?.waiter_name || null,
  };
}

function enrichTablesList(tables, session) {
  return (tables || []).map(t => enrichTableRow(t, session));
}

app.get("/api/tables", auth, (req, res) => {
  try {
    const withReservations = req.session.role === "kamarier" || req.query.reservations === "1";
    if (req.session.role === "kamarier" && req.query.layout === "1") {
      try {
        const now = Date.now();
        if (now - (global.__hotelLastTableReconcileMs || 0) >= 3000) {
          global.__hotelLastTableReconcileMs = now;
          cloudSync.reconcileAllTablesWithCloud(db);
        }
      } catch (err) {
        console.warn("reconcileAllTablesWithCloud:", err.message);
      }
    }

    if (req.query.layout === "1") {
      const layout = db.getTableLayout();
      let zones = layout.zones.map(z => ({
        ...z,
        tables: enrichTablesList(z.tables, req.session),
      }));
      if (withReservations) {
        try {
          const flat = reservationSync.attachReservationsToTables(db, zones.flatMap(z => z.tables));
          const byId = Object.fromEntries(flat.map(t => [t.id, t]));
          zones = zones.map(z => ({
            ...z,
            tables: z.tables.map(t => byId[t.id] || t),
          }));
        } catch (err) {
          console.warn("attachReservationsToTables:", err.message);
        }
      }
      return res.json({ zones, table_count: layout.table_count });
    }

    let tables = enrichTablesList(db.getTablesWithOrders(), req.session);
    if (withReservations) {
      try {
        tables = reservationSync.attachReservationsToTables(db, tables);
      } catch (err) {
        console.warn("attachReservationsToTables:", err.message);
      }
    }
    res.json(tables);
  } catch (e) {
    console.error("/api/tables:", e.message);
    res.status(500).json({ gabim: e.message || "Gabim tavolinash" });
  }
});

app.get("/api/admin/table-layout", auth, adminOnly, (_req, res) => {
  res.json(db.getTableLayout());
});

app.get("/api/admin/table-zones", auth, adminOnly, (_req, res) => {
  res.json(db.listTableZones());
});

app.post("/api/admin/table-zones", auth, adminOnly, (req, res) => {
  try {
    const zone = db.createTableZone(req.body?.name);
    auditReq(req, "Zonë e re tavolinash", zone.name);
    syncCatalogToCloud();
    res.json({ ok: true, zone });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/admin/table-zones/:id", auth, adminOnly, (req, res) => {
  try {
    const zone = db.updateTableZone(req.params.id, req.body || {});
    auditReq(req, "Ndryshim zone tavolinash", zone.name);
    syncCatalogToCloud();
    res.json({ ok: true, zone });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.delete("/api/admin/table-zones/:id", auth, adminOnly, (req, res) => {
  try {
    db.deleteTableZone(req.params.id);
    auditReq(req, "Fshirje zone tavolinash", req.params.id);
    syncCatalogToCloud();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/admin/tables", auth, adminOnly, (req, res) => {
  try {
    const table = db.createTable(req.body || {});
    auditReq(req, "Tavolinë e re", table.display_name || table.number);
    syncCatalogToCloud();
    res.json({ ok: true, table });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/admin/tables/:id", auth, adminOnly, (req, res) => {
  try {
    const table = db.updateTable(req.params.id, req.body || {});
    auditReq(req, "Ndryshim tavoline", table.display_name || table.number);
    syncCatalogToCloud();
    res.json({ ok: true, table });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.delete("/api/admin/tables/:id", auth, adminOnly, (req, res) => {
  try {
    db.deleteTable(req.params.id);
    auditReq(req, "Fshirje tavoline", req.params.id);
    syncCatalogToCloud();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Dhomat e hotelit — modul i ndarë nga tavolinat (pa cloud sync). */
app.get("/api/admin/rooms", auth, adminOnly, (_req, res) => {
  res.json(db.listRoomsWithGuests());
});

app.post("/api/admin/rooms", auth, adminOnly, (req, res) => {
  try {
    const room = db.createRoom(req.body || {});
    auditReq(req, "Dhomë e re", room.room_number);
    res.status(201).json({ ok: true, room });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/admin/rooms/:id", auth, adminOnly, (req, res) => {
  try {
    const room = db.updateRoom(req.params.id, req.body || {});
    auditReq(req, "Ndryshim dhome", room.room_number);
    res.json({ ok: true, room });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.delete("/api/admin/rooms/:id", auth, adminOnly, (req, res) => {
  try {
    const existing = db.getRoomById(req.params.id);
    db.deleteRoom(req.params.id);
    auditReq(req, "Fshirje dhome", existing?.room_number || req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/admin/rooms/:id/check-in", auth, adminOnly, (req, res) => {
  try {
    const result = db.checkInGuest({
      ...(req.body || {}),
      room_id: Number(req.params.id),
    });
    auditReq(req, "Check-in", `${result.room.room_number} — ${result.guest.guest_name}`);
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/admin/rooms/:id/checkout-preview", auth, adminOnly, (req, res) => {
  try {
    const q = req.query || {};
    const extra = q.extra_services != null && q.extra_services !== ""
      ? Number(q.extra_services)
      : (q.services_total != null && q.services_total !== ""
        ? Number(q.services_total)
        : undefined);
    const result = db.getCheckoutPreview(req.params.id, {
      check_out_date: q.check_out_date || undefined,
      extra_services: extra,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/admin/rooms/:id/check-out", auth, adminOnly, (req, res) => {
  try {
    const body = req.body || {};
    const result = db.checkOutGuest(req.params.id, {
      check_out_date: body.check_out_date,
      extra_services: body.extra_services != null ? body.extra_services : body.services_total,
    });
    auditReq(
      req,
      "Check-out",
      `${result.room.room_number} — ${result.guest.guest_name} · ${result.bill.total}€`,
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/admin/rooms/:id/clean", auth, adminOnly, (req, res) => {
  try {
    const room = db.markRoomClean(req.params.id);
    auditReq(req, "Pastrimi i dhomës", room.room_number);
    res.json({ ok: true, room });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/admin/guests/history", auth, adminOnly, (req, res) => {
  try {
    const rows = db.listGuestsHistory({
      status: req.query?.status,
      from: req.query?.from,
      to: req.query?.to,
      limit: req.query?.limit,
    });
    res.json({ ok: true, guests: rows });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** CRM mysafirësh — histori komplet (SQLite lokal). */
app.get("/api/admin/guests/crm", auth, adminOnly, (req, res) => {
  try {
    const guests = db.listHotelGuestsCrm({
      q: req.query?.q,
      from: req.query?.from,
      to: req.query?.to,
      status: req.query?.status,
      limit: req.query?.limit,
    });
    res.json({ ok: true, guests, count: guests.length });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/admin/guests/:id/profile", auth, adminOnly, (req, res) => {
  try {
    const profile = db.getHotelGuestCrmProfile(req.params.id);
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/admin/guests/:id/print-folio", auth, adminOnly, async (req, res) => {
  try {
    const body = req.body || {};
    const folio = db.getGuestFolio(req.params.id, {
      check_out_date: body.check_out_date,
      extra_services: body.extra_services != null ? body.extra_services : body.services_total,
    });
    const result = await printGuestFolioReceipt(db, folio);
    auditReq(req, "Print faturë qëndrimi", `${folio.guest.guest_name} · Dh. ${folio.room.room_number}`);
    res.json({ ok: true, ...result, folio: { total: folio.bill.total, guest_id: folio.guest.id } });
  } catch (e) {
    res.status(400).json({ gabim: e.message || "Printimi dështoi" });
  }
});

app.post("/api/admin/rooms/:id/print-folio", auth, adminOnly, async (req, res) => {
  try {
    const body = req.body || {};
    const folio = db.getRoomFolioPreview(req.params.id, {
      check_out_date: body.check_out_date,
      extra_services: body.extra_services != null ? body.extra_services : body.services_total,
    });
    const result = await printGuestFolioReceipt(db, folio);
    auditReq(req, "Print faturë qëndrimi", `${folio.guest.guest_name} · Dh. ${folio.room.room_number}`);
    res.json({ ok: true, ...result, folio: { total: folio.bill.total, guest_id: folio.guest.id } });
  } catch (e) {
    res.status(400).json({ gabim: e.message || "Printimi dështoi" });
  }
});

app.get("/api/admin/guests/report", auth, adminOnly, (req, res) => {
  try {
    const report = db.getGuestsReport({
      from: req.query?.from,
      to: req.query?.to,
    });
    res.json({ ok: true, report });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Raportet e hotelit — ocupancy, të ardhura, mysafirë, shërbime, dhoma (SQLite lokal). */
app.get("/api/admin/hotel-reports", auth, adminOnly, (req, res) => {
  try {
    const report = db.getHotelPeriodReports(req.query?.from, req.query?.to);
    res.json({ ok: true, report });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/admin/hotel-reports/occupancy", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, report: db.getHotelOccupancyReport(req.query?.from, req.query?.to) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/admin/hotel-reports/revenue", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, report: db.getHotelRevenueReport(req.query?.from, req.query?.to) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/admin/hotel-reports/guests", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, report: db.getHotelGuestsHistoryReport(req.query?.from, req.query?.to) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/admin/hotel-reports/services", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, report: db.getHotelServicesReport(req.query?.from, req.query?.to) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/admin/hotel-reports/rooms", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, report: db.getHotelRoomsReport(req.query?.from, req.query?.to) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Recepsioni — dhomat (PIN / kamarier). Pa cloud. */
app.get("/api/waiter/rooms", auth, staffOrAdmin, (_req, res) => {
  res.json(db.listRoomsWithGuests());
});

app.post("/api/waiter/rooms/:id/check-in", auth, staffOrAdmin, (req, res) => {
  try {
    const result = db.checkInGuest({
      ...(req.body || {}),
      room_id: Number(req.params.id),
    });
    auditReq(req, "Check-in", `${result.room.room_number} — ${result.guest.guest_name}`);
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/waiter/rooms/:id/checkout-preview", auth, staffOrAdmin, (req, res) => {
  try {
    const q = req.query || {};
    const extra = q.extra_services != null && q.extra_services !== ""
      ? Number(q.extra_services)
      : (q.services_total != null && q.services_total !== ""
        ? Number(q.services_total)
        : undefined);
    const result = db.getCheckoutPreview(req.params.id, {
      check_out_date: q.check_out_date || undefined,
      extra_services: extra,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/rooms/:id/check-out", auth, staffOrAdmin, (req, res) => {
  try {
    const body = req.body || {};
    const result = db.checkOutGuest(req.params.id, {
      check_out_date: body.check_out_date,
      extra_services: body.extra_services != null ? body.extra_services : body.services_total,
    });
    auditReq(
      req,
      "Check-out",
      `${result.room.room_number} — ${result.guest.guest_name} · ${result.bill.total}€`,
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/rooms/:id/print-folio", auth, staffOrAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    let folio;
    try {
      folio = db.getRoomFolioPreview(req.params.id, {
        check_out_date: body.check_out_date,
        extra_services: body.extra_services != null ? body.extra_services : body.services_total,
      });
    } catch (previewErr) {
      /* Pas check-out: print sipas guest_id */
      if (body.guest_id) {
        folio = db.getGuestFolio(body.guest_id, {
          check_out_date: body.check_out_date,
          extra_services: body.extra_services != null ? body.extra_services : body.services_total,
        });
      } else {
        throw previewErr;
      }
    }
    const result = await printGuestFolioReceipt(db, folio);
    auditReq(req, "Print faturë qëndrimi", `${folio.guest.guest_name} · Dh. ${folio.room.room_number}`);
    res.json({ ok: true, ...result, folio: { total: folio.bill.total, guest_id: folio.guest.id } });
  } catch (e) {
    res.status(400).json({ gabim: e.message || "Printimi dështoi" });
  }
});

app.post("/api/waiter/guests/:id/print-folio", auth, staffOrAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const folio = db.getGuestFolio(req.params.id, {
      check_out_date: body.check_out_date,
      extra_services: body.extra_services != null ? body.extra_services : body.services_total,
    });
    const result = await printGuestFolioReceipt(db, folio);
    auditReq(req, "Print faturë qëndrimi", `${folio.guest.guest_name} · Dh. ${folio.room.room_number}`);
    res.json({ ok: true, ...result, folio: { total: folio.bill.total, guest_id: folio.guest.id } });
  } catch (e) {
    res.status(400).json({ gabim: e.message || "Printimi dështoi" });
  }
});

app.post("/api/waiter/rooms/:id/clean", auth, staffOrAdmin, (req, res) => {
  try {
    const room = db.markRoomClean(req.params.id);
    auditReq(req, "Pastrimi i dhomës", room.room_number);
    res.json({ ok: true, room });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Housekeeping — bordi profesional (SQLite lokal) */
app.get("/api/waiter/housekeeping", auth, staffOrAdmin, (_req, res) => {
  try {
    const board = db.listHousekeepingBoard();
    res.json({ ok: true, ...board });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/housekeeping/:roomId/assign", auth, staffOrAdmin, (req, res) => {
  try {
    const row = db.assignHousekeepingStaff(req.params.roomId, req.body?.staff_id);
    auditReq(req, "Caktim pastruesi", `Dhoma ${row?.room_number} · ${row?.assigned_name || "—"}`);
    res.json({ ok: true, room: row });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/housekeeping/:roomId/notes", auth, staffOrAdmin, (req, res) => {
  try {
    const row = db.updateHousekeepingNotes(req.params.roomId, req.body?.notes);
    res.json({ ok: true, room: row });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/housekeeping/:roomId/start", auth, staffOrAdmin, (req, res) => {
  try {
    const row = db.startHousekeepingCleaning(req.params.roomId);
    auditReq(req, "Fillim pastrimi", `Dhoma ${row?.room_number}`);
    res.json({ ok: true, room: row });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/housekeeping/:roomId/complete", auth, staffOrAdmin, (req, res) => {
  try {
    const room = db.completeHousekeepingRoom(req.params.roomId);
    auditReq(req, "Përfundim pastrimi", room.room_number);
    res.json({ ok: true, room });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/housekeeping/:roomId/maintenance", auth, staffOrAdmin, (req, res) => {
  try {
    const row = db.setHousekeepingMaintenance(req.params.roomId, req.body?.notes);
    auditReq(req, "Mirëmbajtje dhome", `Dhoma ${row?.room_number}`);
    res.json({ ok: true, room: row });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/housekeeping/:roomId/ready", auth, staffOrAdmin, (req, res) => {
  try {
    const room = db.readyHousekeepingFromMaintenance(req.params.roomId);
    auditReq(req, "Gati nga mirëmbajtja", room.room_number);
    res.json({ ok: true, room });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Shërbime shtesë — katalog lokal (kategori + shërbime) */
app.get("/api/admin/service-categories", auth, adminOnly, (_req, res) => {
  res.json({ ok: true, categories: db.listHotelServiceCategories() });
});

app.post("/api/admin/service-categories", auth, adminOnly, (req, res) => {
  try {
    const category = db.createHotelServiceCategory(req.body || {});
    auditReq(req, "Kategori shërbimi", category.name);
    res.status(201).json({ ok: true, category });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/admin/service-categories/:id", auth, adminOnly, (req, res) => {
  try {
    const category = db.updateHotelServiceCategory(req.params.id, req.body || {});
    auditReq(req, "Ndryshim kategorie shërbimi", category.name);
    res.json({ ok: true, category });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.delete("/api/admin/service-categories/:id", auth, adminOnly, (req, res) => {
  try {
    const existing = db.getHotelServiceCategoryById(req.params.id);
    db.deleteHotelServiceCategory(req.params.id);
    auditReq(req, "Fshirje kategorie shërbimi", existing?.name || req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/admin/services", auth, adminOnly, (_req, res) => {
  const catalog = db.listHotelServicesCatalog({ activeOnly: false });
  res.json({
    ok: true,
    services: catalog.services,
    categories: catalog.categories,
    groups: catalog.groups,
  });
});

app.post("/api/admin/services", auth, adminOnly, (req, res) => {
  try {
    const service = db.createHotelService(req.body || {});
    auditReq(req, "Shërbim i ri", `${service.name} · ${service.price}€`);
    res.status(201).json({ ok: true, service });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/admin/services/:id", auth, adminOnly, (req, res) => {
  try {
    const service = db.updateHotelService(req.params.id, req.body || {});
    auditReq(req, "Ndryshim shërbimi", `${service.name} · ${service.price}€`);
    res.json({ ok: true, service });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.delete("/api/admin/services/:id", auth, adminOnly, (req, res) => {
  try {
    const existing = db.getHotelServiceById(req.params.id);
    db.deleteHotelService(req.params.id);
    auditReq(req, "Fshirje shërbimi", existing?.name || req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/waiter/services", auth, staffOrAdmin, (_req, res) => {
  try {
    if (typeof db.ensureHotelServiceStockPhotos === "function") {
      db.ensureHotelServiceStockPhotos();
    }
  } catch (_) { /* */ }
  const catalog = db.listHotelServicesCatalog();
  res.json({
    ok: true,
    services: catalog.services,
    categories: catalog.categories,
    groups: catalog.groups,
  });
});

app.get("/api/waiter/active-orders", auth, staffOrAdmin, (_req, res) => {
  try {
    const data = db.listActiveHotelOrdersForWaiter();
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/rooms/:id/add-service", auth, staffOrAdmin, (req, res) => {
  try {
    const serviceId = Number(req.body?.service_id);
    if (!serviceId) return res.status(400).json({ gabim: "Shërbimi mungon." });
    const result = db.addServiceChargeToRoom(req.params.id, serviceId, {
      quantity: req.body?.quantity,
      notes: req.body?.notes,
      amount: req.body?.amount,
    });
    auditReq(
      req,
      "Shërbim në dhomë",
      `Dhoma ${result.room.room_number} · ${result.service.name} · ${result.charge.amount}€`,
    );
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Rezervime dhomash — pronari */
app.get("/api/admin/room-reservations", auth, adminOnly, (req, res) => {
  try {
    const rows = db.listRoomReservations({
      status: req.query?.status,
      from: req.query?.from,
      to: req.query?.to,
      on_date: req.query?.on_date,
      limit: req.query?.limit,
    });
    res.json({ ok: true, reservations: rows });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/admin/room-reservations/calendar", auth, adminOnly, (req, res) => {
  try {
    const calendar = db.getRoomAvailabilityCalendar({
      from: req.query?.from,
      to: req.query?.to,
    });
    res.json({ ok: true, calendar });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/admin/room-reservations", auth, adminOnly, (req, res) => {
  try {
    const reservation = db.createRoomReservation(req.body || {});
    auditReq(req, "Rezervim dhome", `${reservation.room_number} — ${reservation.guest_name}`);
    res.status(201).json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/admin/room-reservations/:id", auth, adminOnly, (req, res) => {
  try {
    const reservation = db.updateRoomReservation(req.params.id, req.body || {});
    auditReq(req, "Ndryshim rezervimi dhome", `${reservation.room_number} — ${reservation.guest_name}`);
    res.json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/admin/room-reservations/:id/cancel", auth, adminOnly, (req, res) => {
  try {
    const reservation = db.cancelRoomReservation(req.params.id);
    auditReq(req, "Anulim rezervimi dhome", `${reservation.room_number} — ${reservation.guest_name}`);
    res.json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/admin/room-reservations/:id/check-in", auth, adminOnly, (req, res) => {
  try {
    const result = db.convertReservationToCheckIn(req.params.id);
    auditReq(req, "Check-in nga rezervimi", `${result.room.room_number} — ${result.guest.guest_name}`);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Rezervime dhomash — recepsioni (SQLite lokal) */
app.get("/api/waiter/room-reservations", auth, staffOrAdmin, (req, res) => {
  try {
    const reservations = db.listRoomReservations({
      status: req.query?.status || "active",
      from: req.query?.from,
      to: req.query?.to,
      on_date: req.query?.on_date,
      limit: req.query?.limit || 200,
    });
    res.json({ ok: true, reservations });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/waiter/room-reservations/today", auth, staffOrAdmin, (req, res) => {
  try {
    const reservations = db.listTodaysRoomReservations(req.query?.date);
    res.json({ ok: true, reservations });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/waiter/room-reservations/today-stats", auth, staffOrAdmin, (req, res) => {
  try {
    const stats = db.getReservationDayStats(req.query?.date);
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/waiter/room-reservations/on-date", auth, staffOrAdmin, (req, res) => {
  try {
    const reservations = db.listActiveReservationsOnDate(req.query?.date);
    res.json({ ok: true, reservations });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/waiter/room-reservations/available-rooms", auth, staffOrAdmin, (req, res) => {
  try {
    const rooms = db.listAvailableRoomsForDates(
      req.query?.check_in,
      req.query?.check_out,
      req.query?.exclude_id,
    );
    res.json({ ok: true, rooms });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/room-reservations", auth, staffOrAdmin, (req, res) => {
  try {
    const reservation = db.createRoomReservation(req.body || {});
    auditReq(req, "Rezervim dhome", `${reservation.room_number} — ${reservation.guest_name}`);
    res.status(201).json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/waiter/room-reservations/:id", auth, staffOrAdmin, (req, res) => {
  try {
    const reservation = db.updateRoomReservation(req.params.id, req.body || {});
    auditReq(req, "Ndryshim rezervimi dhome", `${reservation.room_number} — ${reservation.guest_name}`);
    res.json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/room-reservations/:id/cancel", auth, staffOrAdmin, (req, res) => {
  try {
    const reservation = db.cancelRoomReservation(req.params.id);
    auditReq(req, "Anulim rezervimi dhome", `${reservation.room_number} — ${reservation.guest_name}`);
    res.json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/room-reservations/:id/check-in", auth, staffOrAdmin, (req, res) => {
  try {
    const result = db.convertReservationToCheckIn(req.params.id);
    auditReq(req, "Check-in nga rezervimi", `${result.room.room_number} — ${result.guest.guest_name}`);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/**
 * Faturë në dhomë: mbyll porosinë e tavolinës (closeTable një herë) dhe
 * shto charges te mysafiri aktiv. Nuk ndryshon closeTable.
 */
app.post("/api/waiter/charge-to-room", auth, waiterOnly, async (req, res) => {
  const { table_id, room_id, items, coupon_type } = req.body || {};
  const waiterName = req.session.emri;
  const tableId = Number(table_id);
  const roomId = Number(room_id);
  if (!tableId) return res.status(400).json({ gabim: "Tavolina mungon" });
  if (!roomId) return res.status(400).json({ gabim: "Dhoma mungon" });

  const room = db.getRoomById(roomId);
  if (!room) return res.status(400).json({ gabim: "Dhoma nuk u gjet." });
  if (room.status !== "occupied") {
    return res.status(400).json({ gabim: "Vetëm dhomat e zëna mund të faturohen." });
  }
  const guest = db.getActiveGuestForRoom(roomId);
  if (!guest) return res.status(400).json({ gabim: "Nuk ka mysafir aktiv në këtë dhomë." });

  const couponType = registerMode.resolveEffectiveCouponType(db, coupon_type);

  try {
    const tableRow = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
    if (!db.getActiveOrderForTable(tableId) && tableRow?.number) {
      await cloudSync.ensureCloudTableImported(db, tableRow.number, waiterName);
    }
    if (items?.length) {
      const existing = db.getActiveOrderForTable(tableId);
      const prev = db.parseOrderItems(existing?.items_json);
      const delta = diffOrderItems(prev, items);
      db.sendOrder({ table_id: tableId, waiter_name: waiterName, items });
      const afterSend = db.getActiveOrderForTable(tableId);
      if (afterSend) {
        const tbl = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
        cloudSync.pushActiveOrderUpdate(db, afterSend, {
          table_number: tbl?.number || 0,
          ordered_at: afterSend.created_at,
        });
      }
      if (afterSend && delta.length) {
        db.syncSlipSnapshot(afterSend.id, afterSend.items_json);
      }
    }

    const orderBefore = db.getActiveOrderForTable(tableId);
    if (!orderBefore) {
      return res.status(400).json({ gabim: "Nuk ka porosi aktive për këtë tavolinë." });
    }
    const closeItems = db.parseOrderItems(orderBefore.items_json);
    if (!closeItems.length) {
      return res.status(400).json({ gabim: "Nuk ka artikuj për t'i faturuar në dhomë." });
    }
    const pricing = promotionService.resolvePromotionDiscount(db, closeItems, req.body.promotion_id);

    const order = db.closeTable(tableId, waiterName, false, "room", pricing, {
      allowAnyWaiter: true,
    });
    if (!order) {
      return res.status(400).json({ gabim: "Nuk ka porosi aktive për këtë tavolinë." });
    }

    const chargeItems = db.parseOrderItems(order.items_json);
    let charges = [];
    try {
      charges = db.addRoomChargesFromOrderItems(guest.id, roomId, chargeItems, {
        table_number: tableRow?.number,
        decrement_stock: false, /* stoku zbret te closeTable */
      });
    } catch (chargeErr) {
      // Porosia u mbyll — mos e lë pa charge: rresht përmbledhës
      console.warn("[charge-to-room] itemize failed:", chargeErr.message);
      charges = [
        db.addRoomCharge({
          guest_id: guest.id,
          room_id: roomId,
          description: `Porosi T${tableRow?.number || "?"} (faturë dhome)`,
          amount: Number(order.total) || 0,
        }),
      ];
    }

    const receipt = db.createReceipt(order.id);
    const table = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
    const fiscal = db.getFiscalSettings();
    const totals = db.calcFiscalTotals(order.total, fiscal.tvsh_enabled, fiscal.tvsh_percent);

    const mirrorsCloud = cloudSync.orderMirrorsRemoteCloud(order);
    const cloudIds3 = db.getLinkedCloudOrderIds(order.id);

    let printResult = {
      printed: false,
      printMessage: "",
      coupon_type: couponType,
      html: null,
      source: null,
    };
    if (getFiscalMain().shouldPrintClosingNormalReceipt()) {
      printResult = await printClosedTableReceipt(db, {
        order,
        receipt,
        tableNumber: table?.number || 0,
        couponType: "thermal",
      });
    }

    if (mirrorsCloud || cloudIds3.length) {
      void closeCloudLinkedSale(tableId, cloudIds3, {
        items: closeItems,
        total: order.total,
        payment_method: "room",
        receipt_number: receipt.receipt_number,
        waiter_name: waiterName,
        closed_at: receipt.printed_at || new Date().toISOString(),
      })
        .catch((err) => console.warn("[charge-to-room] cloud:", err.message))
        .finally(() => purgeClosedCloudOrdersFromWatcher(cloudIds3));
    } else {
      cloudSync.pushSale(db, order, {
        table_number: table?.number || 0,
        receipt_number: receipt.receipt_number,
        closed_at: receipt.printed_at || new Date().toISOString(),
        status: "closed",
        payment_method: "room",
      });
      if (table?.number) cloudSync.pushTableFree(db, table.number);
    }

    auditReq(
      req,
      "Faturë në dhomë",
      `T${table?.number || "?"} → Dhoma ${room.room_number} · ${guest.guest_name} · ${order.total}€`,
    );

    const bill = db.getCheckoutPreview(roomId).bill;
    res.json({
      ok: true,
      receipt,
      fiscal,
      totals,
      room,
      guest,
      charges,
      bill,
      coupon_type: printResult.coupon_type || couponType,
      html: printResult.html || null,
      printed: !!printResult.printed,
      printMessage: printResult.printMessage || "",
      payment_method: "room",
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/orders", auth, async (req, res) => {
  const { table_id, waiter_name, items } = req.body;
  if (req.session.role === "kamarier" && waiter_name !== req.session.emri) {
    return res.status(403).json({ gabim: "Mund të dërgoni vetëm porositë tuaja" });
  }
  if (!table_id || !waiter_name || !items?.length) {
    return res.status(400).json({ gabim: "Tavolina, kamarieri dhe artikujt janë të detyrueshëm" });
  }
  try {
    const existing = db.getActiveOrderForTable(table_id);
    // Throttle backend: nëse artikujt janë identikë me ekzistuesin dhe u dërguan brenda 10s, kthe direkt
    if (existing) {
      const age = Date.now() - new Date(existing.updated_at || existing.created_at).getTime();
      if (age < 10000) {
        try {
          const existingItems = JSON.parse(existing.items_json || "[]");
          const incomingKey = JSON.stringify([...items].sort((a,b)=>String(a.id||a.name).localeCompare(String(b.id||b.name))));
          const existingKey = JSON.stringify([...existingItems].sort((a,b)=>String(a.id||a.name).localeCompare(String(b.id||b.name))));
          if (incomingKey === existingKey) {
            return res.json({ ok: true, id: existing.id, skipped: true });
          }
        } catch { /* ignore parse errors */ }
      }
    }
    let previousItems = [];
    if (existing) {
      try {
        previousItems = JSON.parse(existing.items_json || "[]");
      } catch {
        previousItems = [];
      }
    }
    const deltaItems = diffOrderItems(previousItems, items);

    const id = db.sendOrder({ table_id, waiter_name, items });
    const order = db.getActiveOrderForTable(table_id);
    const tables = db.getTablesWithOrders();
    const t = tables.find(x => x.id === Number(table_id));
    if (order) {
      cloudSync.pushActiveOrderUpdate(db, order, {
        table_number: t?.number || 0,
        ordered_at: order.created_at,
      });
    }
    const settings = db.getSettings();
    let batchNo = 0;
    if (deltaItems.length && order) {
      const slipAt = new Date().toISOString();
      batchNo = db.recordPrintedBatch(order.id, order.items_json);
      void autoPrintOrderSlip(db, {
        tableNumber: t?.number || table_id,
        waiterName: waiter_name,
        items: deltaItems,
        batchNumber: batchNo,
        order,
        closedAt: slipAt,
      });
    }
    res.json({ ok: true, id, batch_no: batchNo, printed_items: deltaItems.length, items: deltaItems });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/orders/close", auth, async (req, res) => {
  const { table_id, waiter_name, is_admin, payment_method } = req.body;
  const asAdmin = !!is_admin && req.session.role === "admin";
  const name = asAdmin ? (waiter_name || req.session.emri) : req.session.emri;
  const requestedCoupon = req.body?.coupon_type
    ? String(req.body.coupon_type).trim().toLowerCase()
    : null;
  const fiscalSkip = req.body?.fiscal_skip === true || requestedCoupon === "thermal";
  const cloudFiscalOpts = fiscalSkip
    ? { fiscal_skip: true, coupon_type: requestedCoupon || "thermal" }
    : (requestedCoupon ? { coupon_type: requestedCoupon } : {});
  if (req.session.role === "kamarier" && asAdmin) {
    return res.status(403).json({ gabim: "Vetëm admini mund ta mbyllë nga paneli i adminit" });
  }
  try {
    const tableRow = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(Number(table_id));
    const order = db.closeTable(Number(table_id), name, asAdmin, payment_method);
    if (order) {
      const tNum = tableRow?.number || 0;
      const mirrorsCloud = cloudSync.orderMirrorsRemoteCloud(order);
      if (!mirrorsCloud) {
        cloudSync.pushSale(db, order, {
          table_number: tNum,
          status: "closed",
          ...cloudFiscalOpts,
        });
        if (tNum) cloudSync.pushTableFree(db, tNum);
      } else {
        const cloudIds1 = db.getLinkedCloudOrderIds(order.id);
        void closeCloudLinkedSale(Number(table_id), cloudIds1, {
          items: db.parseOrderItems(order.items_json),
          total: order.total,
          payment_method: order.payment_method,
          waiter_name: name,
          closed_at: new Date().toISOString(),
          ...cloudFiscalOpts,
        }).catch(err => console.warn("[close] cloud table:", err.message));
      }
      const cloudIds1 = db.getLinkedCloudOrderIds(order.id);
      if (cloudIds1.length && !mirrorsCloud) cloudSync.cancelOnlineOrders(db, cloudIds1).catch(() => {});
      purgeClosedCloudOrdersFromWatcher(cloudIds1);
    }

    // HAPI FINAL — PAS closeTable (nuk e prek closeTable)
    let fiscalResult = null;
    if (order && fiscalConfig.isFiscalEnabled() && !fiscalSkip) {
      try {
        fiscalResult = await getFiscalMain().processFiscalReceipt(
          order.id,
          payment_method || order.payment_method || "cash",
          {
            operator_name: name,
            operator_id: String(req.session.userId || req.session.id || "POS"),
          }
        );
      } catch (fe) {
        console.warn("[fiscal-main] orders/close:", fe.message);
      }
    }

    res.json({ ok: true, order, fiscal: fiscalResult, fiscal_skipped: fiscalSkip });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/orders/cancel", auth, (req, res) => {
  const tableId = Number(req.body.table_id);
  if (!tableId) return res.status(400).json({ gabim: "Tavolina mungon" });
  try {
    const order = db.getActiveOrderForTable(tableId);
    if (!order) return res.status(400).json({ gabim: "Nuk ka porosi aktive për këtë tavolinë" });
    if (req.session.role === "kamarier" && order.waiter_name !== req.session.emri) {
      return res.status(403).json({ gabim: "Mund të anulloni vetëm porositë tuaja" });
    }
    const tables = db.getTablesWithOrders();
    const t = tables.find(x => x.id === Number(tableId));
    const cloudIds2 = db.getLinkedCloudOrderIds(order.id);
    cloudSync.pushTableCancelled(db, tableId);
    db.cancelActiveOrder(tableId);
    if (t?.number) cloudSync.pushTableFree(db, t.number);
    if (cloudIds2.length) cloudSync.cancelOnlineOrders(db, cloudIds2).catch(() => {});
    res.json({ ok: true, message: "Porosia u anullua" });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/close-and-print", auth, waiterOnly, async (req, res) => {
  const { table_id, items, payment_method, coupon_type } = req.body;
  const waiterName = req.session.emri;
  const tableId = Number(table_id);
  if (!tableId) return res.status(400).json({ gabim: "Tavolina mungon" });
  const requestedCoupon = coupon_type
    ? String(coupon_type).trim().toLowerCase()
    : null;
  const couponType = registerMode.resolveEffectiveCouponType(db, coupon_type);
  const fiscalSkip = req.body?.fiscal_skip === true || requestedCoupon === "thermal";
  const cloudFiscalOpts = fiscalSkip
    ? { fiscal_skip: true, coupon_type: requestedCoupon || "thermal" }
    : (requestedCoupon ? { coupon_type: requestedCoupon } : {});

  try {
    const tableRow = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
    if (!db.getActiveOrderForTable(tableId) && tableRow?.number) {
      await cloudSync.ensureCloudTableImported(db, tableRow.number, waiterName);
    }
    if (items?.length) {
      const existing = db.getActiveOrderForTable(tableId);
      const prev = db.parseOrderItems(existing?.items_json);
      const delta = diffOrderItems(prev, items);
      db.sendOrder({ table_id: tableId, waiter_name: waiterName, items });
      const afterSend = db.getActiveOrderForTable(tableId);
      if (afterSend) {
        const tbl = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
        cloudSync.pushActiveOrderUpdate(db, afterSend, {
          table_number: tbl?.number || 0,
          ordered_at: afterSend.created_at,
        });
      }
      if (afterSend && delta.length) {
        db.syncSlipSnapshot(afterSend.id, afterSend.items_json);
      }
    }
    const orderBefore = db.getActiveOrderForTable(tableId);
    const closeItems = db.parseOrderItems(orderBefore?.items_json);
    const pricing = promotionService.resolvePromotionDiscount(db, closeItems, req.body.promotion_id);
    const order = db.closeTable(tableId, waiterName, false, payment_method, pricing, {
      allowAnyWaiter: true,
    });
    if (!order) {
      return res.status(400).json({ gabim: "Nuk ka porosi aktive për këtë tavolinë." });
    }

    const receipt = db.createReceipt(order.id);
    const table = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
    const fiscal = db.getFiscalSettings();
    const totals = db.calcFiscalTotals(order.total, fiscal.tvsh_enabled, fiscal.tvsh_percent);

    // Print PARA cloud — faturën e shpejtë; cloud mbyllet në background (2–6s).
    const mirrorsCloud = cloudSync.orderMirrorsRemoteCloud(order);
    const cloudIds3 = db.getLinkedCloudOrderIds(order.id);

    const sefOn = fiscalConfig.isFiscalEnabled();
    const sefPrintMode = sefOn ? getFiscalMain().getFiscalPrintMode() : "addon";
    let printResult = {
      printed: false,
      printMessage: "",
      coupon_type: couponType,
      html: null,
      source: null,
    };

    // Termik i zgjedhur → mbyll/printo termik pa kupon fiskal.
    // SEF replace → skip VETËM kuponin normal të MBYLLJES. Order ticket nuk preket këtu.
    if (fiscalSkip || getFiscalMain().shouldPrintClosingNormalReceipt()) {
      printResult = await printClosedTableReceipt(db, {
        order,
        receipt,
        tableNumber: table?.number || 0,
        couponType: fiscalSkip ? "thermal" : (sefOn ? "thermal" : couponType),
      });
    } else {
      console.log("[close-and-print] SEF replace — skip kupon normal mbylljeje, vetëm fiskal");
    }

    // HAPI FINAL — PAS closeTable
    let fiscalResult = null;
    if (sefOn && !fiscalSkip) {
      try {
        fiscalResult = await getFiscalMain().processFiscalReceipt(
          order.id,
          payment_method || order.payment_method || "cash",
          {
            operator_name: waiterName,
            operator_id: String(req.session.userId || req.session.id || "POS"),
            subtotal: pricing?.subtotal,
            discount_amount: pricing?.discount_total,
            total_amount: order.total,
          }
        );
      } catch (fe) {
        console.warn("[fiscal-main] close-and-print:", fe.message);
      }
    }

    if (mirrorsCloud || cloudIds3.length) {
      // Cloud-linked → NJË njoftim mbylljeje (jo pushSale). Pa await: nuk bllokon printin.
      void closeCloudLinkedSale(tableId, cloudIds3, {
        items: closeItems,
        total: order.total,
        payment_method: order.payment_method,
        receipt_number: receipt.receipt_number,
        waiter_name: waiterName,
        closed_at: receipt.printed_at || new Date().toISOString(),
        ...cloudFiscalOpts,
      })
        .catch(err => console.warn("[close] cloud table:", err.message))
        .finally(() => purgeClosedCloudOrdersFromWatcher(cloudIds3));
    } else {
      cloudSync.pushSale(db, order, {
        table_number: table?.number || 0,
        receipt_number: receipt.receipt_number,
        closed_at: receipt.printed_at || new Date().toISOString(),
        status: "closed",
        payment_method: order.payment_method,
        ...cloudFiscalOpts,
      });
      if (table?.number) cloudSync.pushTableFree(db, table.number);
    }

    res.json({
      ok: true,
      receipt,
      fiscal,
      totals,
      coupon_type: printResult.coupon_type || couponType,
      html: printResult.html || null,
      printed: !!(printResult.printed || fiscalResult?.printed),
      printMessage: printResult.printMessage || fiscalResult?.printMessage || "",
      receipt_source: printResult.source,
      fiscal_receipt: fiscalResult,
      fiscal_skipped: fiscalSkip,
      sef_print_mode: sefPrintMode,
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/split-close-and-print", auth, waiterOnly, async (req, res) => {
  const { table_id, items, payment_method, coupon_type } = req.body;
  const waiterName = req.session.emri;
  const tableId = Number(table_id);
  if (!tableId) return res.status(400).json({ gabim: "Tavolina mungon" });
  if (!items?.length) return res.status(400).json({ gabim: "Zgjidhni artikuj për pagesë" });
  const requestedCoupon = coupon_type
    ? String(coupon_type).trim().toLowerCase()
    : null;
  const couponType = registerMode.resolveEffectiveCouponType(db, coupon_type);
  const fiscalSkip = req.body?.fiscal_skip === true || requestedCoupon === "thermal";
  const cloudFiscalOpts = fiscalSkip
    ? { fiscal_skip: true, coupon_type: requestedCoupon || "thermal" }
    : (requestedCoupon ? { coupon_type: requestedCoupon } : {});

  try {
    if (req.body?.pending_items?.length) {
      const existing = db.getActiveOrderForTable(tableId);
      const prev = db.parseOrderItems(existing?.items_json);
      const merged = [...prev];
      const key = db.orderItemKey;
      const map = new Map();
      for (const it of merged) map.set(key(it), { ...it, quantity: Number(it.quantity) || 0 });
      for (const it of req.body.pending_items) {
        const k = key(it);
        const qty = Number(it.quantity) || 0;
        if (qty <= 0) continue;
        const prevIt = map.get(k);
        if (prevIt) prevIt.quantity += qty;
        else map.set(k, { ...it, quantity: qty });
      }
      const itemsToSend = [...map.values()].filter(it => it.quantity > 0);
      db.sendOrder({ table_id: tableId, waiter_name: waiterName, items: itemsToSend });
      const afterSend = db.getActiveOrderForTable(tableId);
      if (afterSend) {
        const tbl = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
        cloudSync.pushActiveOrderUpdate(db, afterSend, {
          table_number: tbl?.number || 0,
          ordered_at: afterSend.created_at,
        });
      }
    }

    const pricing = promotionService.resolvePromotionDiscount(db, items, req.body.promotion_id);
    const result = db.closeTablePartial(tableId, waiterName, payment_method, items, pricing, {
      allowAnyWaiter: true,
    });
    const table = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
    const fiscalOrderId = result.fiscalOrderId;
    const partialOrder = {
      ...(result.splitOrder || result.order),
      id: fiscalOrderId,
      items_json: JSON.stringify(result.removed),
      total: result.partialTotal,
      payment_method: result.order.payment_method,
      subtotal: pricing.subtotal,
      discount_total: pricing.discount_total,
      promotion_name: pricing.promotion_name,
    };

    const receipt = db.createReceipt(fiscalOrderId);
    const fiscal = db.getFiscalSettings();
    const totals = db.calcFiscalTotals(result.partialTotal, fiscal.tvsh_enabled, fiscal.tvsh_percent);

    // Print PARA cloud — faturën e shpejtë; cloud në background.
    const mirrorsCloud = cloudSync.orderMirrorsRemoteCloud(result.order);
    const cloudIds4 = result.order?.id ? db.getLinkedCloudOrderIds(result.order.id) : [];

    const sefOn = fiscalConfig.isFiscalEnabled();
    const sefPrintMode = sefOn ? getFiscalMain().getFiscalPrintMode() : "addon";
    let printResult = {
      printed: false,
      printMessage: "",
      coupon_type: couponType,
      html: null,
      source: null,
    };
    if (fiscalSkip || getFiscalMain().shouldPrintClosingNormalReceipt()) {
      printResult = await printClosedTableReceipt(db, {
        order: partialOrder,
        receipt,
        tableNumber: table?.number || 0,
        couponType: fiscalSkip ? "thermal" : (sefOn ? "thermal" : couponType),
      });
    } else {
      console.log("[split-close] SEF replace — skip kupon normal mbylljeje, vetëm fiskal");
    }

    let fiscalResult = null;
    if (sefOn && !fiscalSkip) {
      try {
        fiscalResult = await getFiscalMain().processFiscalReceipt(
          fiscalOrderId,
          payment_method || result.order.payment_method || "cash",
          {
            operator_name: waiterName,
            operator_id: String(req.session.userId || req.session.id || "POS"),
            items: result.removed,
            subtotal: pricing?.subtotal,
            discount_amount: pricing?.discount_total,
            total_amount: result.partialTotal,
          }
        );
      } catch (fe) {
        console.warn("[fiscal-main] split-close:", fe.message);
      }
    }

    if (mirrorsCloud || cloudIds4.length) {
      // Cloud-linked → NJË njoftim (jo pushSale). Pa await kur mbyllet tavolina.
      if (result.tableFreed) {
        void closeCloudLinkedSale(tableId, cloudIds4, {
          items: result.removed,
          total: result.partialTotal,
          payment_method: result.order.payment_method,
          receipt_number: receipt.receipt_number,
          waiter_name: waiterName,
          closed_at: receipt.printed_at || new Date().toISOString(),
          ...cloudFiscalOpts,
        })
          .catch(err => console.warn("[split-close] cloud table:", err.message))
          .finally(() => purgeClosedCloudOrdersFromWatcher(cloudIds4));
      }
    } else {
      cloudSync.pushSale(db, partialOrder, {
        table_number: table?.number || 0,
        receipt_number: receipt.receipt_number,
        closed_at: receipt.printed_at || new Date().toISOString(),
        status: "closed",
        payment_method: partialOrder.payment_method,
        ...cloudFiscalOpts,
      });
      if (result.tableFreed && table?.number) {
        cloudSync.pushTableFree(db, table.number);
      }
    }

    if (!result.tableFreed) {
      const remaining = db.getActiveOrderForTable(tableId);
      if (remaining) {
        cloudSync.pushActiveOrderUpdate(db, remaining, {
          table_number: table?.number || 0,
          ordered_at: remaining.created_at,
        });
      }
    }

    res.json({
      ok: true,
      receipt,
      fiscal,
      totals,
      table_freed: result.tableFreed,
      remaining_total: result.tableFreed ? 0 : result.order.total,
      coupon_type: printResult.coupon_type || couponType,
      html: printResult.html || null,
      printed: !!(printResult.printed || fiscalResult?.printed),
      printMessage: printResult.printMessage || fiscalResult?.printMessage || "",
      receipt_source: printResult.source,
      fiscal_receipt: fiscalResult,
      fiscal_skipped: fiscalSkip,
      sef_print_mode: sefPrintMode,
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/* ─── Admin (i mbrojtur) ─── */
app.get("/api/settings", auth, adminOnly, async (_req, res) => {
  const payload = {
    ...db.getSettings(),
    ...db.getVersionInfo(),
    categories:    db.getCategoryNames(),
    fiscal:        db.getFiscalSettings(),
    register_mode: registerMode.getRegisterModeState(db),
  };
  /* Pakoja nga cloud (heartbeat) — jo VERSION bake-uar — që UI përditësohet pa restart */
  try {
    const eapp = electronApp();
    if (eapp) {
      const lic = await license.getLicenseStatusForApp(eapp);
      if (lic?.package_tier) {
        payload.packageTier = lic.package_tier;
        payload.packageFeatures = lic.features || {};
      }
    }
  } catch {
    /* mbaj VERSION.packageTier */
  }
  res.json(payload);
});

app.get("/api/admin/dashboard", auth, adminOnly, (_req, res) => {
  res.json(db.getDashboardOverview());
});

app.get("/api/admin/low-stock", auth, adminOnly, (_req, res) => {
  const items = db.getLowStockItems();
  res.json({ ok: true, items, count: items.length });
});

app.get("/api/admin/stock/reconcile", auth, adminOnly, (_req, res) => {
  try {
    const data = db.reconcileStock();
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/admin/rebuild-register", auth, adminOnly, async (req, res) => {
  try {
    auditReq(req, "Rifresko arkën nga cloud");
    const result = await cloudSync.rebuildRegisterFromCloud(db);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/* Rivendos si të re — fshin krejt userData lokale dhe rinis Electron (licenca mbahet). */
app.post("/api/admin/factory-reset", auth, adminOnly, (req, res) => {
  try {
    const confirm = String(req.body?.confirm || "").trim();
    if (confirm !== "RIVENDOS") {
      return res.status(400).json({ gabim: "Duhet të shkruani saktë RIVENDOS." });
    }
    if (typeof global["__scheduleFactoryResetRelaunch"] !== "function") {
      return res.status(500).json({
        gabim: "Rivendosja është e disponueshme vetëm në aplikacionin desktop (Electron).",
      });
    }
    auditReq(req, "Rivendos si të re", "factory-reset");
    res.json({ ok: true, message: "Programi po riniset si i ri..." });
    setTimeout(() => {
      try {
        global["__scheduleFactoryResetRelaunch"]();
      } catch (e) {
        console.error("factory-reset relaunch:", e.message);
      }
    }, 250);
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.get("/api/admin/ditari", auth, adminOnly, (req, res) => {
  const opts = ditariOptsFromQuery(req.query);
  const data = db.getDitari(opts);
  if (req.query.audit === "1") {
    auditReq(req, "Ditari — kërkim", data.periodLabel);
  }
  res.json(data);
});

app.get("/api/admin/ditari/preview", auth, adminOnly, (req, res) => {
  const opts = ditariOptsFromQuery(req.query);
  const ditari = db.getDitari(opts);
  const settings = db.getSettings();
  const fiscal = db.getFiscalSettings();
  const html = buildDitariReportHtml(ditari, fiscal, settings.business_name);
  res.json({ html, ditari });
});

app.post("/api/admin/ditari/print", auth, adminOnly, async (req, res) => {
  try {
    const opts = ditariOptsFromQuery({ ...req.query, ...req.body });
    const ditari = db.getDitari(opts);
    const settings = db.getSettings();
    const fiscal = db.getFiscalSettings();
    const html = buildDitariReportHtml(ditari, fiscal, settings.business_name);
    let result;
    try {
      result = await printer.printReceiptAt(html, db, "fiscal");
    } catch {
      result = await printer.printReceiptAt(html, db, "bar");
    }
    auditReq(req, "Ditari — print raport", ditari.periodLabel);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ gabim: e.message || "Gabim gjatë printimit" });
  }
});

app.get("/api/admin/ditari/export", auth, adminOnly, (req, res) => {
  const opts = ditariOptsFromQuery(req.query);
  const txt = db.exportDitariText(opts);
  const data = new Date().toISOString().slice(0, 10);
  auditReq(req, "Ditari — shkarkim txt", opts.period || "custom");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="ditari-${data}.txt"`);
  res.send(txt);
});

app.post("/api/categories", auth, adminOnly, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ gabim: "Shkruani emrin e kategorisë" });
  try {
    db.addCategory(name);
    syncCatalogToCloud();
    res.json({ ok: true, categories: db.getCategories() });
  } catch (e) {
    res.status(400).json({ gabim: e.message.includes("UNIQUE") ? "Kjo kategori ekziston tashmë" : e.message });
  }
});

/** Renditja e kategorive — vetëm admin/pronar (jo kamarier). */
app.put("/api/categories/reorder", auth, adminOnly, (req, res) => {
  try {
    const names = req.body?.names || req.body?.categories || [];
    const categories = db.reorderCategories(names);
    syncCatalogToCloud();
    res.json({ ok: true, categories });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.delete("/api/categories/:name", auth, adminOnly, (req, res) => {
  try {
    db.deleteCategory(decodeURIComponent(req.params.name));
    syncCatalogToCloud();
    res.json({ ok: true, categories: db.getCategories() });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/categories/:name/toggle-active", auth, adminOnly, (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const active = db.toggleCategoryActive(name);
    syncCatalogToCloud();
    res.json({ ok: true, active, categories: db.getCategories() });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/menu/all", auth, adminOnly, (_req, res) => {
  res.json(db.getMenuItems(false).map(toMenuItemDto));
});

/** Open Food Facts — USB barcode scanner (numra + Enter) → emër produkti. */
app.get("/api/menu/barcode-lookup/:code", auth, adminOnly, async (req, res) => {
  try {
    const { lookupOpenFoodFacts } = require("./barcode-lookup");
    const result = await lookupOpenFoodFacts(req.params.code);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(502).json({
      ok: false,
      found: false,
      gabim: e.message || "Open Food Facts nuk u përgjigj",
    });
  }
});

app.get("/api/vat/suggest", auth, adminOnly, (req, res) => {
  try {
    const { suggestVatFromName } = require("./vat-smart-map");
    const name = String(req.query.name || req.query.q || "").trim();
    const category = String(req.query.category || "").trim();
    const sug = suggestVatFromName(name, { category, project: "HOTEL" });
    res.json({ ok: true, suggestion: sug });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/vat/apply-smart-all", auth, adminOnly, (_req, res) => {
  try {
    const menu = db.applySmartVatToAllMenuItems();
    const services = typeof db.applySmartVatToAllServices === "function"
      ? db.applySmartVatToAllServices()
      : { total: 0, changed: 0, skipped_disputed: 0 };
    syncCatalogToCloud();
    res.json({
      ok: true,
      menu,
      services,
      total: (menu.total || 0) + (services.total || 0),
      changed: (menu.changed || 0) + (services.changed || 0),
      skipped_disputed: (menu.skipped_disputed || 0) + (services.skipped_disputed || 0),
    });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/products/update-vat-all", auth, adminOnly, (_req, res) => {
  try {
    const { loadDb, resolveVatFromNameSync, letterToVatCategory } = require("./vat-smart-map");
    const vatDb = loadDb();
    const items = db.getMenuItems(false);

    let updated = 0;
    let unchanged = 0;
    let disputed = 0;
    const details = [];

    for (const item of items) {
      const name = String(item.name || "").trim();
      const oldVat = String(item.vat_category || "18");
      const vat = resolveVatFromNameSync(name, vatDb);

      if (vat.disputed) {
        disputed += 1;
        details.push({ id: item.id, name, status: "disputed", old: oldVat });
        continue;
      }

      const nextVat = letterToVatCategory(vat.letter, vat.rate);
      if (nextVat === oldVat) {
        unchanged += 1;
        details.push({ id: item.id, name, status: "unchanged", old: oldVat, new: nextVat });
        continue;
      }

      db.updateMenuItem(item.id, { vat_category: nextVat });
      updated += 1;
      details.push({
        id: item.id,
        name,
        status: "updated",
        old: oldVat,
        new: nextVat,
        letter: vat.letter,
        rate: vat.rate,
      });
    }

    syncCatalogToCloud();
    res.json({ ok: true, updated, unchanged, disputed, total: items.length, details });
  } catch (e) {
    res.status(500).json({ gabim: e.message || "Gabim gjatë përditësimit të TVSH-së" });
  }
});

app.post("/api/menu", auth, adminOnly, (req, res) => {
  const { name, category, price, vat_category, stock_qty, low_stock_threshold, barcode, auto_vat } = req.body;
  if (!name?.trim()) return res.status(400).json({ gabim: "Shkruani emrin e artikullit" });
  try {
    const id = db.addMenuItem({
      name,
      category,
      price,
      vat_category,
      stock_qty,
      low_stock_threshold,
      barcode,
      auto_vat: auto_vat !== false && auto_vat !== 0 && auto_vat !== "0",
    });
    syncCatalogToCloud();
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Renditja e produkteve brenda kategorisë — vetëm admin/pronar. */
app.put("/api/menu/reorder", auth, adminOnly, (req, res) => {
  try {
    const ids = req.body?.ids || [];
    const items = db.reorderMenuItems(ids);
    syncCatalogToCloud();
    res.json({ ok: true, items: items.map(toMenuItemDto) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Shton stok me dorë (pa faturë blerjeje) — SQLite + sync katalogu. */
app.post("/api/stock/add", auth, adminOnly, (req, res) => {
  try {
    const menuItemId = Number(req.body?.menu_item_id ?? req.body?.product_id ?? req.body?.id);
    const qty = Number(req.body?.quantity ?? req.body?.qty ?? req.body?.sasia);
    const result = db.increaseMenuItemStock(menuItemId, qty);
    syncCatalogToCloud();
    auditReq(req, "Stok +", `${result.name} +${qty} → ${result.stock_qty}`);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/menu/:id/price", auth, adminOnly, (req, res) => {
  const price = Number(req.body.price);
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ gabim: "Çmim i pavlefshëm" });
  }
  try {
    db.updateMenuPrice(Number(req.params.id), price);
    syncCatalogToCloud();
    res.json({ ok: true, price });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/menu/:id/toggle-active", auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const item = typeof db.getMenuItemById === "function"
    ? db.getMenuItemById(id)
    : db.getMenuItems(false).find(i => i.id === id);
  if (!item) return res.status(404).json({ gabim: "Artikulli nuk u gjet" });
  db.toggleMenuItemActive(id, !item.active);
  syncCatalogToCloud();
  res.json({ ok: true, active: !item.active });
});

app.put("/api/menu/:id", auth, adminOnly, (req, res) => {
  try {
    db.updateMenuItem(Number(req.params.id), req.body);
    syncCatalogToCloud();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/menu/:id/photo", auth, adminOnly, (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = typeof db.getMenuItemById === "function"
      ? db.getMenuItemById(id)
      : db.getMenuItems(false).find(i => i.id === id);
    if (!item) {
      return res.status(404).json({ gabim: "Artikulli nuk u gjet" });
    }
    // Lejo ngarkim custom edhe për emra seed — mos blloko / mos kthe te stock.
    const photo = req.body?.photo;
    if (photo && String(photo).length > 700_000) {
      return res.status(400).json({ gabim: "Fotoja është shumë e madhe (max ~500 KB)." });
    }
    db.setMenuItemPhoto(id, photo ?? "");
    syncCatalogToCloud();
    res.json({ ok: true, has_photo: Boolean(String(photo || "").trim()) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/menu/apply-stock-photos", auth, adminOnly, (_req, res) => {
  try {
    // Veprim eksplicit admin — lejo overwrite stock për emra seed.
    const updated = menuStockPhotos.applyMissing(
      {
        getMenuItems: () => db.getMenuItems(false),
        getMenuItemPhoto: id => db.getMenuItemPhoto(id),
        setMenuItemPhoto: (id, p) => db.setMenuItemPhoto(id, p),
      },
      { forceAllStock: true, replaceRemote: true },
    );
    if (updated) syncCatalogToCloud();
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.delete("/api/menu/:id", auth, adminOnly, (req, res) => {
  db.deleteMenuItemPermanent(Number(req.params.id));
  syncCatalogToCloud();
  res.json({ ok: true });
});

app.get("/api/menu/export", auth, adminOnly, (_req, res) => {
  const txt = db.exportMenuText();
  const data = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="menu-${data}.txt"`);
  res.send(txt);
});

app.post("/api/menu/print", auth, adminOnly, async (req, res) => {
  try {
    const settings = db.getSettings();
    const fiscal = db.getFiscalSettings();
    const html = buildMenuPrintHtml(
      db.getCategoryNames(),
      db.getMenuItems(false),
      fiscal,
      settings.business_name,
      settings.version || settings.business_name,
    );
    let result;
    try {
      result = await printer.printReceiptAt(html, db, "fiscal");
    } catch {
      result = await printer.printReceiptAt(html, db, "bar");
    }
    auditReq(req, "Menu — print", "");
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ gabim: e.message || "Gabim gjatë printimit" });
  }
});

app.post("/api/tables/:id/clear", auth, adminOnly, (req, res) => {
  try {
    const tableId = Number(req.params.id);
    const tables = db.getTablesWithOrders();
    const t = tables.find(x => x.id === tableId);
    cloudSync.pushTableCancelled(db, tableId);
    db.cancelActiveOrder(tableId);
    if (t?.number) cloudSync.pushTableFree(db, t.number);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/reports", auth, adminOnly, (req, res) => {
  const { from, to } = req.query;
  res.json(db.getReports(from, to));
});

app.get("/api/reports/export", auth, adminOnly, (req, res) => {
  const { from, to } = req.query;
  const txt = db.exportReportText(from, to);
  const data = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="raporti-${data}.txt"`);
  res.send(txt);
});

app.post("/api/reports/print", auth, adminOnly, async (req, res) => {
  try {
    const sot = new Date().toISOString().slice(0, 10);
    const from = req.body?.from || req.query?.from || sot;
    const to = req.body?.to || req.query?.to || sot;
    const report = db.getReports(from, to);
    const settings = db.getSettings();
    const fiscal = db.getFiscalSettings();
    const html = buildReportPrintHtml(report, fiscal, settings.business_name);
    let result;
    try {
      result = await printer.printReceiptAt(html, db, "fiscal");
    } catch {
      const text = buildReportPrintLines(report, fiscal, settings.business_name).join("\n");
      result = await printer.printPlainTextAt(text, db, "bar");
    }
    auditReq(req, "Raport — print", `${from} — ${to}`);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ gabim: e.message || "Gabim gjatë printimit" });
  }
});

app.get("/api/admin/reports/x", auth, adminOnly, (_req, res) => {
  try {
    res.json({ ok: true, ...db.buildXReportData() });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/admin/reports/x/print", auth, adminOnly, async (req, res) => {
  try {
    const data = db.buildXReportData();
    const settings = db.getSettings();
    const fiscal = db.getFiscalSettings();
    const html = buildXReportHtml({ fiscal, restaurantName: settings.business_name, data });
    let result;
    try {
      result = await printer.printReceiptAt(html, db, "fiscal");
    } catch {
      const text = buildXReportLines({ fiscal, restaurantName: settings.business_name, data }).join("\n");
      result = await printer.printPlainTextAt(text, db, "bar");
    }
    auditReq(req, "Raporti X — print", `${data.open_shift_count} nderrime aktive · ${Number(data.total_sales).toFixed(2)} €`);
    res.json({ ok: true, ...result, html, data });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim gjatë printimit" });
  }
});

app.post("/api/admin/reports/daily-summary/print", auth, adminOnly, async (req, res) => {
  try {
    const data = db.buildDailySummaryData();
    const settings = db.getSettings();
    const fiscal = db.getFiscalSettings();
    const text = buildDailySummaryLines({ fiscal, restaurantName: settings.business_name, data }).join("\n");
    const result = await printer.printPlainTextAt(text, db, "bar");
    auditReq(req, "Përmbledhje ditore — print", `${data.items.length} artikuj · ${Number(data.total_sales).toFixed(2)} €`);

    // Fiskal ATK: pas përmbledhjes ditore — audit + reset numri ditor (1×/ditë). Nuk prek printin.
    let fiscal_day_close = null;
    if (fiscalConfig.isFiscalEnabled()) {
      try {
        fiscal_day_close = fiscalNumbering.onDailySummaryPrinted(
          req.session?.emri || "Admin",
          req.session?.role || "admin"
        );
      } catch (fe) {
        console.error("[fiscal] onDailySummaryPrinted:", fe.message || fe);
      }
    }

    res.json({ ok: true, ...result, data, fiscal_day_close });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim gjatë printimit" });
  }
});

/** Modi X fiskal (Neni 10 / 3.1) — gjendja aktuale e ditës, pa reset / pa mbyllje. */
function buildFiscalModXReportText(details, sefSettings) {
  const w = 42;
  const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  const line = (ch = "=") => ch.repeat(w);
  const row = (label, val) => {
    const v = String(val ?? "");
    const gap = Math.max(1, w - label.length - v.length);
    return `${label}${" ".repeat(gap)}${v}`;
  };
  const vat = details.vat_breakdown || {};
  const sefId = fiscalNumbering.getSefIdentifier() || "-";
  return [
    line("="),
    "RAPORTI X (MODI X)",
    "Gjendja aktuale — JO mbyllje",
    line("-"),
    row("Biznesi:", sefSettings.taxpayer_legal_name || "-"),
    row("NUI:", sefSettings.taxpayer_nui || "-"),
    row("Njësia:", sefSettings.unit_name || "-"),
    row("SEF ID:", sefId),
    row("Data:", details.date || "-"),
    line("-"),
    row("Nr. kuponësh:", details.coupon_count ?? 0),
    row("Totali (EUR):", money(details.total_amount)),
    row("Tot. pa TVSH:", money(details.total_without_tax)),
    row("TVSH A:", money(vat.A)),
    row("TVSH B:", money(vat.B)),
    row("TVSH C:", money(vat.C)),
    row("TVSH D 8%:", money(vat.D)),
    row("TVSH E 18%:", money(vat.E)),
    row("Offline:", details.offline_count ?? 0),
    row("Reset ditor:", "JO (Modi X)"),
    line("="),
    "Mund të printohet shumë herë",
    "",
  ].join("\n");
}

app.post("/api/admin/reports/fiscal-x/print", auth, adminOnly, async (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është aktiv" });
    }
    const details = fiscalNumbering.getXReportSnapshot(
      req.session?.emri || "Admin",
      req.session?.role || "admin"
    );
    if (!details) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është aktiv" });
    }
    const sefSettings = fiscalConfig.getFiscalSettings();
    const text = buildFiscalModXReportText(details, sefSettings);
    const result = await printer.printPlainTextAt(text, db, "bar");
    auditReq(
      req,
      "Raporti X fiskal (Modi X) — print",
      `${details.coupon_count} kuponë · ${Number(details.total_amount).toFixed(2)} €`
    );
    res.json({
      ok: true,
      ...result,
      details: { ...details, sef_id: fiscalNumbering.getSefIdentifier() || "" },
      text,
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim gjatë printimit" });
  }
});

app.post("/api/admin/reports/fiscal-periodic/print", auth, adminOnly, async (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është aktiv" });
    }
    const from = req.body?.from || req.body?.from_date;
    const to = req.body?.to || req.body?.to_date;
    const details = fiscalNumbering.getPeriodicFiscalReport(
      from,
      to,
      req.session?.emri || "Admin",
      req.session?.role || "admin"
    );
    if (!details) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është aktiv" });
    }
    const sefSettings = fiscalConfig.getFiscalSettings();
    const text = buildFiscalModXReportText(
      { ...details, mode: "PERIODIC" },
      sefSettings
    ).replace("RAPORTI X (MODI X)", "RAPORTI PERIODIK")
      .replace("Gjendja aktuale — JO mbyllje", "Mes dy datave — JO mbyllje")
      .replace("JO (Modi X)", "JO (periodik)");
    const result = await printer.printPlainTextAt(text, db, "bar");
    auditReq(
      req,
      "Raport periodik fiskal — print",
      `${details.from_date}…${details.to_date} · ${details.coupon_count} kuponë · ${Number(details.total_amount).toFixed(2)} €`
    );
    res.json({
      ok: true,
      ...result,
      details: { ...details, sef_id: fiscalNumbering.getSefIdentifier() || "" },
      text,
    });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || "Gabim gjatë printimit" });
  }
});

app.get("/api/admin/reports/z/closed-shifts", auth, adminOnly, (req, res) => {
  try {
    const limit = Number(req.query?.limit) || 30;
    res.json({ ok: true, shifts: db.listRecentClosedShifts(limit) });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/admin/reports/z/:shiftId", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.buildZReportData(req.params.shiftId) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.put("/api/admin/reports/z/:shiftId/reason", auth, adminOnly, (req, res) => {
  try {
    const data = db.updateShiftClosingReason(req.params.shiftId, req.body?.reason);
    auditReq(req, "Raporti Z — arsye diference", `Nderrim #${data.shift_id} (${data.waiter_name}): ${data.closing_reason || "—"}`);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/admin/reports/z/:shiftId/print", auth, adminOnly, async (req, res) => {
  try {
    const data = db.buildZReportData(req.params.shiftId);
    const settings = db.getSettings();
    const fiscal = db.getFiscalSettings();
    const html = buildZReportHtml({ fiscal, restaurantName: settings.business_name, data });
    let result;
    try {
      result = await printer.printReceiptAt(html, db, "fiscal");
    } catch {
      const text = buildZReportLines({ fiscal, restaurantName: settings.business_name, data }).join("\n");
      result = await printer.printPlainTextAt(text, db, "bar");
    }
    auditReq(req, "Raporti Z — print", `Nderrim #${data.shift_id} (${data.waiter_name}) · ${Number(data.total_sales).toFixed(2)} €`);
    res.json({ ok: true, ...result, html, data });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || "Gabim gjatë printimit" });
  }
});

app.get("/api/admin/reports/waiter/open-shifts", auth, adminOnly, (_req, res) => {
  try {
    res.json({ ok: true, shifts: db.listOpenShiftsForReports() });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/admin/reports/waiter/:shiftId", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getOpenShiftReportData(req.params.shiftId) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/admin/reports/waiter/:shiftId/print", auth, adminOnly, async (req, res) => {
  try {
    const data = db.getOpenShiftReportData(req.params.shiftId);
    const settings = db.getSettings();
    const { buildWaiterLiveReportLines } = require("./waiter-shift-html");
    const lines = buildWaiterLiveReportLines({
      restaurantName: settings.business_name,
      waiterName: data.waiter_name,
      shift: { opened_at: data.opened_at },
      totals: data,
      salesDetail: { item_summary: data.item_summary },
    });
    const text = lines.join("\n");
    const result = await printer.printPlainTextAt(text, db, "bar");
    auditReq(req, "Raporti i Kamarierit — print", `${data.waiter_name} · ${Number(data.total_sales).toFixed(2)} €`);
    res.json({ ok: true, ...result, data });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || "Gabim gjatë printimit" });
  }
});

app.get("/api/staff", auth, adminOnly, async (_req, res) => {
  const staff = db.getStaffForAdmin();
  const kdsEnabled = canShowKdsStaffLinks();
  let cloudWaiters = [];
  if (kdsEnabled) {
    try {
      await cloudSync.pushStaffAsync(db);
    } catch {
      /* ignore */
    }
    try {
      cloudWaiters = await license.fetchWaitersList(electronApp());
    } catch {
      cloudWaiters = [];
    }
    if (!cloudWaiters.length) {
      try {
        await cloudSync.pushStaffAsync(db);
        cloudWaiters = await license.fetchWaitersList(electronApp());
      } catch {
        /* ignore */
      }
    }
  }
  const byName = new Map(
    cloudWaiters.map(w => [normalizeStaffName(w.name), w]),
  );
  res.json({
    kds_enabled: kdsEnabled,
    staff: staff.map(s => {
      const cw = kdsEnabled ? byName.get(normalizeStaffName(s.name)) : null;
      return {
        ...s,
        waiter_url: kdsEnabled ? resolveStaffWaiterUrl(cw) : "",
      };
    }),
    active_today: db.getActiveStaffToday(),
  });
});

app.post("/api/staff", auth, adminOnly, (req, res) => {
  const { name, pin } = req.body;
  if (!name?.trim()) return res.status(400).json({ gabim: "Shkruani emrin e kamarierit" });
  if (!/^\d{4}$/.test(String(pin ?? "").trim())) {
    return res.status(400).json({ gabim: "PIN duhet të jetë 4 shifra" });
  }
  try {
    db.addStaff(name, pin);
    syncCatalogToCloud();
    void cloudSync.pushStaffAsync(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message.includes("UNIQUE") ? "Ky emër ekziston tashmë" : e.message });
  }
});

app.put("/api/staff/:id/pin", auth, adminOnly, (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ gabim: "Shkruani PIN-in (4 shifra)" });
  try {
    db.updateStaffPin(Number(req.params.id), pin);
    syncCatalogToCloud();
    void cloudSync.pushStaffAsync(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/staff/:id/card", auth, adminOnly, (req, res) => {
  const { card_uid } = req.body;
  if (!card_uid?.trim()) return res.status(400).json({ gabim: "Shkruani ose skanoni kodin RFID" });
  try {
    db.updateStaffCard(Number(req.params.id), card_uid);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.delete("/api/staff/:id/card", auth, adminOnly, (req, res) => {
  try {
    db.clearStaffCard(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.delete("/api/staff/:id", auth, adminOnly, (req, res) => {
  db.deleteStaff(Number(req.params.id));
  syncCatalogToCloud();
  res.json({ ok: true });
});

app.get("/api/purchases/stats", auth, adminOnly, (_req, res) => {
  res.json(db.getPurchaseStats30Days());
});

app.get("/api/purchases/export/pdf", auth, adminOnly, (req, res) => {
  const { from, to, supplier } = req.query;
  const invoices = db.listPurchases({ from, to, supplier });
  const settings = db.getSettings();
  const period = `${from || "—"} deri ${to || "—"}`;
  const html = buildPurchasesListHtml(invoices, settings.business_name, period);
  res.json({ html, count: invoices.length });
});

// ---- KONTABILISTI (vetëm Pako 3 Full / Pako 4 AI — jo Pako 1–2) ----
function accountantAllowed() {
  try {
    const { localFeaturesForTier } = require("./ai-cloud");
    let tier = String(VERSION.packageTier || "").trim();
    try {
      const license = require("./license");
      const eapp = require("electron").app;
      if (eapp) {
        const rec = license.readActivationRecord(eapp);
        if (rec?.package_tier) tier = rec.package_tier;
        if (rec?.features && typeof rec.features.accountant === "boolean") {
          return !!rec.features.accountant;
        }
      }
    } catch {
      /* ignore */
    }
    return !!localFeaturesForTier(tier).accountant;
  } catch {
    return false;
  }
}

app.use("/api/kontabilisti", (req, res, next) => {
  if (!accountantAllowed()) {
    return res.status(403).json({
      ok: false,
      gabim: "Kontabilisti nuk përfshihet në Pako 1–2. Duhet Pako 3 (Full) ose Pako 4 (AI).",
      code: "NO_ACCOUNTANT",
    });
  }
  next();
});

app.get("/api/kontabilisti/sales-ledger", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, rows: db.getSalesLedger(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/kontabilisti/sales-ledger/export.csv", auth, adminOnly, (req, res) => {
  const csv = db.exportSalesLedgerCsv(req.query);
  const data = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="libri-shitjeve-${data}.csv"`);
  res.send(csv);
});

app.get("/api/kontabilisti/sales-ledger/export/pdf", auth, adminOnly, (req, res) => {
  const { from, to } = req.query;
  const rows = db.getSalesLedger(req.query);
  const settings = db.getSettings();
  const period = `${from || "—"} deri ${to || "—"}`;
  const html = buildSalesLedgerHtml(rows, settings.business_name, period);
  res.json({ html, count: rows.length });
});

app.get("/api/kontabilisti/expenses", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, rows: db.listExpenses(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/kontabilisti/expenses", auth, adminOnly, (req, res) => {
  try {
    const id = db.addExpense({ ...req.body, entered_by: req.session?.emri || "—" });
    auditReq(req, "Shpenzim — shtuar", `${req.body?.vendor_name || "—"} · ${Number(req.body?.amount || 0).toFixed(2)} €`);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.delete("/api/kontabilisti/expenses/:id", auth, adminOnly, (req, res) => {
  try {
    db.deleteExpense(req.params.id);
    auditReq(req, "Shpenzim — fshirë", `#${req.params.id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/kontabilisti/expenses/export.csv", auth, adminOnly, (req, res) => {
  const csv = db.exportExpensesCsv(req.query);
  const data = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="libri-shpenzimeve-${data}.csv"`);
  res.send(csv);
});

app.get("/api/kontabilisti/expenses/export/pdf", auth, adminOnly, (req, res) => {
  const { from, to } = req.query;
  const rows = db.listExpenses(req.query);
  const settings = db.getSettings();
  const period = `${from || "—"} deri ${to || "—"}`;
  const html = buildExpensesLedgerHtml(rows, settings.business_name, period);
  res.json({ html, count: rows.length });
});

app.get("/api/kontabilisti/vat-report", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getVatReport(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/kontabilisti/vat-report/export.csv", auth, adminOnly, (req, res) => {
  const csv = db.exportVatReportCsv(req.query);
  const m = req.query?.month || new Date().toISOString().slice(0, 7);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="raporti-tvsh-${m}.csv"`);
  res.send(csv);
});

app.get("/api/kontabilisti/vat-report/export/pdf", auth, adminOnly, (req, res) => {
  const report = db.getVatReport(req.query);
  const settings = db.getSettings();
  const html = buildVatReportHtml(report, settings.business_name, report.month);
  res.json({ html, count: report.rows.length });
});

// ---- KONTABILISTI ATK (libra zyrtare) ----
app.get("/api/kontabilisti/atk/sales-vat", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getAtkSalesVatBook(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.get("/api/kontabilisti/atk/sales-vat/export.csv", auth, adminOnly, (req, res) => {
  const csv = db.exportAtkSalesVatCsv(req.query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="libri-shitjes-tvsh.csv"`);
  res.send(csv);
});
app.get("/api/kontabilisti/atk/purchases-vat", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getAtkPurchaseVatBook(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.get("/api/kontabilisti/atk/purchases-vat/export.csv", auth, adminOnly, (req, res) => {
  const csv = db.exportAtkPurchaseVatCsv(req.query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="libri-blerjes-tvsh.csv"`);
  res.send(csv);
});
app.get("/api/kontabilisti/atk/sales-quarterly", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getAtkSalesQuarterly(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.get("/api/kontabilisti/atk/sales-quarterly/export.csv", auth, adminOnly, (req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="libri-shitjes-kuartale.csv"`);
  res.send(db.exportAtkSalesQuarterlyCsv(req.query));
});
app.get("/api/kontabilisti/atk/purchases-quarterly", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getAtkPurchaseQuarterly(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.get("/api/kontabilisti/atk/purchases-quarterly/export.csv", auth, adminOnly, (req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="libri-blerjes-kuartale.csv"`);
  res.send(db.exportAtkPurchaseQuarterlyCsv(req.query));
});
app.get("/api/kontabilisti/atk/vat-declaration", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getAtkVatDeclaration(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.get("/api/kontabilisti/atk/payroll", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getAtkPayrollBundle(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.post("/api/kontabilisti/atk/payroll", auth, adminOnly, (req, res) => {
  try {
    const id = db.upsertAtkPayroll(req.body || {});
    auditReq(req, "ATK paga", `#${id}`);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.delete("/api/kontabilisti/atk/payroll/:id", auth, adminOnly, (req, res) => {
  try {
    db.deleteAtkPayroll(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.get("/api/kontabilisti/atk/rent", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getAtkRentBundle(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.post("/api/kontabilisti/atk/rent", auth, adminOnly, (req, res) => {
  try {
    const id = db.upsertAtkRent(req.body || {});
    auditReq(req, "ATK qera", `#${id}`);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.delete("/api/kontabilisti/atk/rent/:id", auth, adminOnly, (req, res) => {
  try {
    db.deleteAtkRent(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.get("/api/kontabilisti/atk/quarterly", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getAtkQuarterlyForm(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.get("/api/kontabilisti/atk/annual", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getAtkAnnualStatements(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.get("/api/kontabilisti/atk/opening-stock", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getAtkOpeningStock(req.query.year) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});
app.post("/api/kontabilisti/atk/opening-stock", auth, adminOnly, (req, res) => {
  try {
    const year = req.body?.year ?? req.query.year;
    const amount = req.body?.stock_start ?? req.body?.amount;
    res.json({ ok: true, ...db.setAtkOpeningStock(year, amount) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

async function sendAtkXlsx(res, filename, bufferPromise) {
  try {
    const buf = Buffer.from(await bufferPromise);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || "Eksporti Excel dështoi" });
  }
}

app.get("/api/kontabilisti/atk/sales-vat/export.xlsx", auth, adminOnly, async (req, res) => {
  const atkXlsx = require("./kontabilisti-excel");
  const book = db.getAtkSalesVatBook(req.query);
  await sendAtkXlsx(res, "Libri-i-Shitjes-TVSH.xlsx", atkXlsx.buildSalesVatXlsx(book.rows));
});
app.get("/api/kontabilisti/atk/purchases-vat/export.xlsx", auth, adminOnly, async (req, res) => {
  const atkXlsx = require("./kontabilisti-excel");
  const book = db.getAtkPurchaseVatBook(req.query);
  await sendAtkXlsx(res, "Libri-i-Blerjes-TVSH.xlsx", atkXlsx.buildPurchaseVatXlsx(book.rows));
});
app.get("/api/kontabilisti/atk/sales-quarterly/export.xlsx", auth, adminOnly, async (req, res) => {
  const atkXlsx = require("./kontabilisti-excel");
  const book = db.getAtkSalesQuarterly(req.query);
  await sendAtkXlsx(res, "Libri-i-Shitjes-Kuartale.xlsx", atkXlsx.buildSalesQuarterlyXlsx(book.rows));
});
app.get("/api/kontabilisti/atk/purchases-quarterly/export.xlsx", auth, adminOnly, async (req, res) => {
  const atkXlsx = require("./kontabilisti-excel");
  const book = db.getAtkPurchaseQuarterly(req.query);
  await sendAtkXlsx(res, "Libri-i-Blerjes-Kuartale.xlsx", atkXlsx.buildPurchaseQuarterlyXlsx(book.rows));
});
app.get("/api/kontabilisti/atk/vat-declaration/export.xlsx", auth, adminOnly, async (req, res) => {
  const atkXlsx = require("./kontabilisti-excel");
  const decl = db.getAtkVatDeclaration(req.query);
  await sendAtkXlsx(res, "Deklarata-e-TVSH.xlsx", atkXlsx.buildVatDeclarationXlsx(decl));
});
app.get("/api/kontabilisti/atk/payroll/export.xlsx", auth, adminOnly, async (req, res) => {
  const atkXlsx = require("./kontabilisti-excel");
  const bundle = db.getAtkPayrollBundle(req.query);
  await sendAtkXlsx(res, "Lista-e-pagave.xlsx", atkXlsx.buildPayrollXlsx(bundle.rows));
});
app.get("/api/kontabilisti/atk/payroll/withholding/export.xlsx", auth, adminOnly, async (req, res) => {
  const atkXlsx = require("./kontabilisti-excel");
  const bundle = db.getAtkPayrollBundle(req.query);
  await sendAtkXlsx(
    res,
    "Formulari-Tatim-ne-Burim.xlsx",
    atkXlsx.buildWithholdingPayrollXlsx(bundle.withholding),
  );
});
app.get("/api/kontabilisti/atk/rent/export.xlsx", auth, adminOnly, async (req, res) => {
  const atkXlsx = require("./kontabilisti-excel");
  const bundle = db.getAtkRentBundle(req.query);
  await sendAtkXlsx(res, "Lista-e-Qerase.xlsx", atkXlsx.buildRentListXlsx(bundle.rows));
});
app.get("/api/kontabilisti/atk/rent/form/export.xlsx", auth, adminOnly, async (req, res) => {
  const atkXlsx = require("./kontabilisti-excel");
  const bundle = db.getAtkRentBundle(req.query);
  await sendAtkXlsx(res, "Formulari-i-qerase.xlsx", atkXlsx.buildRentFormXlsx(bundle.form));
});
app.get("/api/kontabilisti/atk/quarterly/export.xlsx", auth, adminOnly, async (req, res) => {
  const atkXlsx = require("./kontabilisti-excel");
  const form = db.getAtkQuarterlyForm(req.query);
  await sendAtkXlsx(res, "Formulari-Tremujore.xlsx", atkXlsx.buildQuarterlyXlsx(form));
});
app.get("/api/kontabilisti/atk/annual/export.xlsx", auth, adminOnly, async (req, res) => {
  const atkXlsx = require("./kontabilisti-excel");
  const annual = db.getAtkAnnualStatements(req.query);
  await sendAtkXlsx(res, "Pasqyrat-Vjetore.xlsx", atkXlsx.buildAnnualXlsx(annual));
});

function atkBizHeader(extra = {}) {
  const fiscal = db.getFiscalSettings();
  return {
    bizName: fiscal.biz_name || "",
    nui: fiscal.biz_fiscal_number || "",
    brn: fiscal.biz_fiscal_number || "",
    address: [fiscal.biz_address, fiscal.biz_city].filter(Boolean).join(", "),
    phone: fiscal.biz_phone || "",
    contact: fiscal.biz_cashier_operator || fiscal.biz_name || "",
    ...extra,
  };
}

async function sendAtkPdf(res, filename, bufferPromise) {
  try {
    const buf = Buffer.from(await bufferPromise);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || "Eksporti PDF dështoi" });
  }
}

app.get("/api/kontabilisti/atk/vat-declaration/export.pdf", auth, adminOnly, async (req, res) => {
  const atkPdf = require("./kontabilisti-pdf");
  const decl = db.getAtkVatDeclaration(req.query);
  const period = req.query.month || `${decl.from || ""} — ${decl.to || ""}`;
  await sendAtkPdf(
    res,
    "Deklarata-e-TVSH.pdf",
    atkPdf.fillVatDeclarationPdf({
      salesTotals: decl.sales_totals,
      purchaseTotals: decl.purchase_totals,
      vatPayable: decl.vat_payable,
      header: atkBizHeader({ period }),
    }),
  );
});
app.get("/api/kontabilisti/atk/payroll/withholding/export.pdf", auth, adminOnly, async (req, res) => {
  const atkPdf = require("./kontabilisti-pdf");
  const bundle = db.getAtkPayrollBundle(req.query);
  await sendAtkPdf(
    res,
    "Formulari-Tatim-ne-Burim.pdf",
    atkPdf.fillWithholdingPayrollPdf({
      withholding: bundle.withholding,
      header: atkBizHeader({ period: req.query.year_month || "", createDate: new Date().toISOString().slice(0, 10) }),
    }),
  );
});
app.get("/api/kontabilisti/atk/rent/form/export.pdf", auth, adminOnly, async (req, res) => {
  const atkPdf = require("./kontabilisti-pdf");
  const bundle = db.getAtkRentBundle(req.query);
  await sendAtkPdf(
    res,
    "Formulari-i-qerase.pdf",
    atkPdf.fillRentFormPdf({
      form: bundle.form,
      header: atkBizHeader({ period: req.query.year_month || "" }),
    }),
  );
});
app.get("/api/kontabilisti/atk/quarterly/export.pdf", auth, adminOnly, async (req, res) => {
  const atkPdf = require("./kontabilisti-pdf");
  const form = db.getAtkQuarterlyForm(req.query);
  await sendAtkPdf(
    res,
    "Formulari-Tremujore.pdf",
    atkPdf.fillQuarterlyPdf({
      quarterly: form,
      header: atkBizHeader({ period: `${form.from || ""} — ${form.to || ""}` }),
    }),
  );
});
app.get("/api/kontabilisti/atk/annual/export.pdf", auth, adminOnly, async (req, res) => {
  const atkPdf = require("./kontabilisti-pdf");
  const annual = db.getAtkAnnualStatements(req.query);
  await sendAtkPdf(
    res,
    "Pasqyra-vjetore-CD.pdf",
    atkPdf.fillAnnualCdPdf({
      annual,
      header: atkBizHeader({ period: String(annual.year || "") }),
    }),
  );
});

// ---- KONTABILISTI — seksione të reja (blerje stoku + bilanc); nuk ndryshon endpoint-et sipër ----

app.get("/api/kontabilisti/purchases", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, rows: db.listPurchasesLedger(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/kontabilisti/purchases/export.csv", auth, adminOnly, (req, res) => {
  const csv = db.exportPurchasesLedgerCsv(req.query);
  const data = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kontabilisti-blerjet-${data}.csv"`);
  res.send(csv);
});

app.get("/api/kontabilisti/purchases/export/pdf", auth, adminOnly, (req, res) => {
  const { from, to } = req.query;
  const rows = db.listPurchasesLedger(req.query);
  const settings = db.getSettings();
  const period = `${from || "—"} deri ${to || "—"}`;
  const html = buildPurchasesLedgerHtml(rows, settings.business_name, period);
  const invoiceIds = new Set(rows.map((r) => r.invoice_id));
  res.json({ html, count: invoiceIds.size, line_count: rows.length });
});

app.get("/api/kontabilisti/bilanc", auth, adminOnly, (req, res) => {
  try {
    res.json({ ok: true, ...db.getKontabilistiBilanc(req.query) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/kontabilisti/bilanc/export.csv", auth, adminOnly, (req, res) => {
  const csv = db.exportKontabilistiBilancCsv(req.query);
  const data = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kontabilisti-bilanc-${data}.csv"`);
  res.send(csv);
});

app.get("/api/kontabilisti/bilanc/export/pdf", auth, adminOnly, (req, res) => {
  const bilanc = db.getKontabilistiBilanc(req.query);
  const settings = db.getSettings();
  const html = buildBilancHtml(bilanc, settings.business_name);
  res.json({ html, bilanc });
});

app.get("/api/purchases", auth, adminOnly, async (req, res) => {
  try {
    const purchaseCloudPull = require("./purchase-cloud-pull");
    await purchaseCloudPull.pullAndApplyPendingPurchases(db);
  } catch {
    /* ignore — lista lokale vazhdon */
  }
  const { from, to, supplier } = req.query;
  res.json({
    stats: db.getPurchaseStats30Days(),
    invoices: db.listPurchases({ from, to, supplier }),
    latest_purchase_date: db.getLatestPurchaseInvoiceDate(),
  });
});

app.post("/api/purchases/pull-cloud", auth, adminOnly, async (_req, res) => {
  try {
    const purchaseCloudPull = require("./purchase-cloud-pull");
    const result = await purchaseCloudPull.pullAndApplyPendingPurchases(db);
    if (result.applied > 0) syncCatalogToCloud();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/purchases/meta/latest-date", auth, adminOnly, (_req, res) => {
  res.json({ ok: true, latest_purchase_date: db.getLatestPurchaseInvoiceDate() });
});

app.get("/api/purchases/:id/print", auth, adminOnly, (req, res) => {
  const inv = db.getPurchaseInvoice(Number(req.params.id));
  if (!inv) return res.status(404).json({ gabim: "Fatura nuk u gjet" });
  const settings = db.getSettings();
  const html = buildPurchaseInvoiceHtml(inv, settings.business_name);
  res.json({ html, invoice: inv });
});

app.get("/api/purchases/:id", auth, adminOnly, (req, res) => {
  const inv = db.getPurchaseInvoice(Number(req.params.id));
  if (!inv) return res.status(404).json({ gabim: "Fatura nuk u gjet" });
  res.json(inv);
});

/** Fshi faturë blerjeje (p.sh. AI e gabuar) — kthen stokun dhe heq nga Kontabilisti. */
app.delete("/api/purchases/:id", auth, adminOnly, (req, res) => {
  try {
    const result = db.deletePurchaseInvoice(Number(req.params.id));
    syncCatalogToCloud();
    auditReq(req, "Fshi faturë blerjeje", `ID ${result.id} · ${result.supplier} · ${result.invoice_number}`);
    res.json({ ok: true, ...result, latest_purchase_date: db.getLatestPurchaseInvoiceDate() });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/purchases", auth, adminOnly, (req, res) => {
  try {
    const body = req.body || {};
    const isAdj =
      body.status === "adjustment" ||
      body.allow_backdate === true ||
      body.doc_type === "adjustment";
    const invoice = isAdj
      ? db.createPurchaseAdjustment(body)
      : db.createPurchaseInvoice(body);
    syncCatalogToCloud();
    auditReq(
      req,
      isAdj ? "Rregullim fature blerjeje" : "Blerje stoku — faturë e re",
      `${invoice.supplier} · ${Number(invoice.total).toFixed(2)} €`,
    );
    res.json({
      ok: true,
      invoice,
      kontabilisti: true,
      latest_purchase_date: db.getLatestPurchaseInvoiceDate(),
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/table-qrs/print", auth, adminOnly, async (_req, res) => {
  try {
    const data = await getTableQrService().listTableQrs(db);
    res.type("html").send(getTableQrService().qrPrintHtml(data.tables, data.business_name));
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/table-qrs/:table/print", auth, adminOnly, async (req, res) => {
  try {
    const entry = await getTableQrService().getTableQr(db, req.params.table);
    res.type("html").send(getTableQrService().qrPrintHtml([entry], entry.business_name));
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/table-qrs/:table/png", auth, adminOnly, async (req, res) => {
  try {
    const png = await getTableQrService().getTableQrPng(db, req.params.table);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="qr-tavolina-${req.params.table}.png"`);
    res.send(png);
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/table-qrs", auth, adminOnly, async (_req, res) => {
  try {
    res.json(await getTableQrService().listTableQrs(db));
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/table-qrs/regenerate", auth, adminOnly, async (_req, res) => {
  try {
    const data = await getTableQrService().regenerateTableQrs(db);
    res.json({ ok: true, ...data, message: "QR u rigjeneruan nga cloud." });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/** QR hoteli — lokal SQLite (pa cloud). */
app.get("/api/hotel-qrs", auth, adminOnly, async (_req, res) => {
  try {
    res.json({ ok: true, ...(await getHotelQrService().listHotelQrs(db)) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.put("/api/hotel-qrs/base-url", auth, adminOnly, (req, res) => {
  try {
    const base = getHotelQrService().setHotelQrBaseUrl(db, req.body?.base_url || "");
    res.json({ ok: true, base_url: base });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/hotel-qrs/print", auth, adminOnly, async (req, res) => {
  try {
    const kind = String(req.query?.kind || "room_service").toLowerCase();
    const data = await getHotelQrService().listHotelQrs(db);
    let codes = [];
    let title = "QR Kodet";
    if (kind === "menu") {
      codes = [data.shared.menu];
      title = "QR Menyja";
    } else if (kind === "services") {
      codes = [data.shared.services];
      title = "QR Shërbime";
    } else {
      codes = data.rooms.map((r) => ({
        ...r.room_service,
        label: `Dhoma ${r.room_number} — Room Service`,
      }));
      title = "QR Room Service";
    }
    res.type("html").send(getHotelQrService().qrPrintHtml(codes, data.business_name, title));
  } catch (e) {
    res.status(400).type("text").send(e.message || "Gabim printimi");
  }
});

app.get("/api/hotel-qrs/:room/print", auth, adminOnly, async (req, res) => {
  try {
    const entry = await getHotelQrService().getRoomServiceQr(db, req.params.room);
    res.type("html").send(
      getHotelQrService().qrPrintHtml(
        [{ ...entry, label: `Dhoma ${entry.room_number} — Room Service` }],
        entry.business_name,
        "QR Room Service",
      ),
    );
  } catch (e) {
    res.status(400).type("text").send(e.message || "Gabim printimi");
  }
});

app.get("/api/hotel-qrs/:room/png", auth, adminOnly, async (req, res) => {
  try {
    const entry = await getHotelQrService().getRoomServiceQr(db, req.params.room);
    const buf = Buffer.from(entry.png_base64, "base64");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="qr-room-${req.params.room}.png"`);
    res.send(buf);
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Katalog publik lokal për QR (pa auth, pa cloud). */
app.get("/api/guest/menu", (_req, res) => {
  try {
    const items = (db.getMenuItems(true) || []).map((it) => ({
      id: it.id,
      name: it.name,
      category: it.category,
      price: Number(it.price) || 0,
      photo: it.photo || "",
    }));
    const settings = db.getSettings();
    res.json({
      ok: true,
      hotel_name: settings.business_name || "Hotel",
      items,
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.get("/api/guest/services", (_req, res) => {
  try {
    const catalog = db.listHotelServicesCatalog({ activeOnly: true });
    const settings = db.getSettings();
    res.json({
      ok: true,
      hotel_name: settings.business_name || "Hotel",
      groups: catalog.groups || [],
      services: (catalog.services || []).map((s) => ({
        id: s.id,
        name: s.name,
        price: Number(s.price) || 0,
        price_mode: s.price_mode,
        category_name: s.category_name || "",
        photo: s.photo || "",
        icon: s.icon || "",
      })),
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.post("/api/guest/room-order", (req, res) => {
  try {
    const roomNumber = String(req.body?.room_number || req.body?.room || "").trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!roomNumber) throw new Error("Numri i dhomës mungon.");
    if (!items.length) throw new Error("Zgjidhni të paktën një artikull.");
    const rooms = db.listRoomsWithGuests();
    const room = rooms.find((r) => String(r.room_number) === roomNumber);
    if (!room) throw new Error(`Dhoma ${roomNumber} nuk u gjet.`);
    if (room.status !== "occupied" || !room.active_guest) {
      throw new Error("Dhoma nuk ka mysafir aktiv — room service nuk pranohet.");
    }
    const created = db.addRoomChargesFromOrderItems(
      room.active_guest.id,
      room.id,
      items,
      { source: "room_service", decrement_stock: true },
    );
    res.status(201).json({
      ok: true,
      count: created.length,
      guest_name: room.active_guest.guest_name,
      room_number: room.room_number,
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/reservations", auth, adminOnly, async (req, res) => {
  try {
    const { date, from, to } = req.query;
    const data = await reservationSync.listReservations(db, { date, from, to });
    res.json(data);
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/reservations", auth, adminOnly, async (req, res) => {
  try {
    const data = await reservationSync.createReservation(db, req.body);
    auditReq(req, "Rezervim i ri", `${req.body?.customer_name || ""} · T${req.body?.table_number || ""}`);
    if (data.offline) reservationSync.scheduleReservationSync(db);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.patch("/api/reservations/:id", auth, adminOnly, async (req, res) => {
  try {
    const data = await reservationSync.updateReservationStatus(db, req.params.id, req.body?.status);
    auditReq(req, "Rezervim — ndryshim statusi", String(req.body?.status || ""));
    if (data.offline) reservationSync.scheduleReservationSync(db);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/reservations/sync", auth, adminOnly, async (_req, res) => {
  try {
    const result = await reservationSync.syncPendingReservations(db);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/promotions", auth, adminOnly, (_req, res) => {
  try {
    const rows = db.listPromotions().map(promotionService.mapPromotionForClient);
    res.json({ ok: true, promotions: rows });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/promotions/active", auth, (_req, res) => {
  try {
    const rows = db.listPromotions()
      .filter(p => promotionService.isPromotionActiveNow(p))
      .map(promotionService.mapPromotionForClient);
    res.json({ ok: true, promotions: rows });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/promotions/preview", auth, (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const pricing = promotionService.resolvePromotionDiscount(db, items, req.body.promotion_id);
    res.json({ ok: true, pricing });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/promotions", auth, adminOnly, (req, res) => {
  try {
    const row = db.createPromotion(req.body);
    auditReq(req, "Promocion i ri", row.name);
    res.status(201).json({ ok: true, promotion: promotionService.mapPromotionForClient(row) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/promotions/:id", auth, adminOnly, (req, res) => {
  try {
    const row = db.updatePromotion(req.params.id, req.body);
    auditReq(req, "Promocion — ndryshim", row.name);
    res.json({ ok: true, promotion: promotionService.mapPromotionForClient(row) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.delete("/api/promotions/:id", auth, adminOnly, (req, res) => {
  try {
    const existing = db.getPromotion(req.params.id);
    db.deletePromotion(req.params.id);
    auditReq(req, "Promocion — fshirje", existing?.name || String(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/settings", auth, adminOnly, (req, res) => {
  try {
    db.updateSettings(req.body);
    syncCatalogToCloud();
    auditReq(req, "Ndryshim cilësimesh", "Lokal & biznesi");
    res.json({ ok: true, ...db.getSettings() });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/cloud/status", (_req, res) => {
  /* Hotel: zero cloud — pill Offline. */
  res.json({
    ok: true,
    connected: false,
    operational: false,
    offline: true,
    mode: "offline",
    reachable: false,
    configured: false,
    syncing: false,
    catalog_ok: false,
    server_url: "",
    public_server: "",
    active_server: "",
    message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
  });
});

app.get("/api/cloud/failures", auth, adminOnly, (req, res) => {
  try {
    const { listCloudFailures } = require("./cloud-failure-log");
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json({ ok: true, failures: listCloudFailures(db, limit) });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/cloud-sync", auth, adminOnly, async (_req, res) => {
  /* Hotel: pa checkConnection / rrjet — settings bosh + offline. */
  try {
    res.json({
      ok: true,
      server_url: "",
      celesi: "",
      kitchen_slug: "",
      kitchen_key: "",
      cloud_client_id: "",
      cloud_client_name: "",
      connected: false,
      offline: true,
      links_ready: false,
      waiter_url: "",
      bar_url: "",
      kitchen_url: "",
      kiosk_url: "",
      public_page_url: "",
      status_message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
      message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.put("/api/cloud-sync", auth, adminOnly, async (_req, res) => {
  /* Hotel: mos ruaj / mos sync me cloud hotel. */
  res.json({
    ok: true,
    connected: false,
    offline: true,
    message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
  });
});

app.post("/api/cloud-sync/test", auth, adminOnly, async (_req, res) => {
  res.json({
    connected: false,
    offline: true,
    message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
  });
});

app.post("/api/cloud-sync/sync-all", auth, adminOnly, async (_req, res) => {
  res.json({
    ok: false,
    connected: false,
    offline: true,
    message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
  });
});

app.get("/api/fiscal-settings", auth, adminOnly, (_req, res) => {
  res.json(db.getFiscalSettings());
});

app.put("/api/fiscal-settings", auth, adminOnly, (req, res) => {
  try {
    db.updateFiscalSettings(req.body);
    res.json({ ok: true, ...db.getFiscalSettings() });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/* HAPI 2 — SEF fiscal_settings (vetëm pronari / admin) */
app.get("/api/fiscal-config", auth, adminOnly, (_req, res) => {
  try {
    const settings = fiscalConfig.getFiscalSettings();
    res.json({
      ...settings,
      fiscal_release_locked: !!fiscalConfig.isFiscalReleaseLocked?.(),
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.put("/api/fiscal-config", auth, adminOnly, (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    if (fiscalConfig.isFiscalReleaseLocked?.()) {
      body.fiscal_enabled = false;
    }
    const saved = fiscalConfig.saveFiscalSettings(body);
    try {
      if (saved.fiscal_enabled) {
        fiscalOffline.startOfflineMonitor();
      } else {
        fiscalOffline.stopOfflineMonitor();
      }
    } catch (e) {
      console.warn("[fiscal-offline] toggle:", e.message);
    }
    res.json({
      ok: true,
      ...saved,
      fiscal_release_locked: !!fiscalConfig.isFiscalReleaseLocked?.(),
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/* Lista e kuponëve fiskalë — vetëm pronari */
app.get("/api/fiscal-receipts", auth, adminOnly, (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const limit = Number(req.query.limit) || 500;
    const receipts = getFiscalReceiptsList().listFiscalReceipts(limit) || [];
    res.json({ ok: true, count: receipts.length, receipts });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.get("/api/fiscal-receipts/:id", auth, adminOnly, (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const preview = getFiscalReceiptsList().getFiscalReceiptPreview(req.params.id);
    if (!preview) {
      return res.status(404).json({ gabim: "Kuponi nuk u gjet" });
    }
    res.json({ ok: true, receipt: preview });
  } catch (e) {
    const code = /nuk u gjet|pavlefshëm/i.test(e.message) ? 404 : 400;
    res.status(code).json({ gabim: e.message });
  }
});

/** Print nga Print Preview — reprint origjinal, pa INSERT të ri. */
app.post("/api/fiscal-receipts/:id/print", auth, adminOnly, async (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const reprint = getFiscalReceiptsList().prepareFiscalReceiptReprint(req.params.id);
    const { generateFiscalQR } = require("./fiscal/fiscal-qr");
    let qrResult = null;
    try {
      qrResult = await generateFiscalQR({
        nuikf: reprint.nuikf,
        total_amount: reprint.total_amount,
        fiscal_date: reprint.fiscal_date,
        taxpayer_nui: reprint.taxpayer_nui,
      });
    } catch (qe) {
      console.warn("[fiscal-receipts print] QR:", qe.message);
    }
    let printed = false;
    let printMessage = "";
    if (!req.body?.skip_print) {
      const pr = await getFiscalMain().printFiscalBundle(reprint.print_text, qrResult);
      printed = !!pr?.printed;
      printMessage = pr?.printMessage || "";
    }
    res.json({
      ok: true,
      receipt_id: reprint.id,
      nuikf: reprint.nuikf,
      printed,
      printMessage,
    });
  } catch (e) {
    const code = /nuk u gjet|pavlefshëm/i.test(e.message) ? 404 : 400;
    res.status(code).json({ ok: false, gabim: e.message });
  }
});

/* Test lokal i plotë fiskal — vetëm pronari, pa ATK (print termik opsional) */
app.post("/api/fiscal-self-test", auth, adminOnly, async (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({
        ok: false,
        gabim: "Fiskalizimi është OFF — aktivizoje për të testuar",
      });
    }
    const times = Number(req.body?.times || req.query?.times || 1);
    if (times > 1) {
      const report = await getFiscalSelfTest().runFiscalSelfTestBattery(times);
      return res.json(report);
    }
    const report = await getFiscalSelfTest().runFiscalSelfTest({ print: true });
    res.json(report);
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

/* Kupon fiskal provë — print termik, pa INSERT (vetëm kur fiscal ON) */
app.post("/api/fiscal-print-test-coupon", auth, adminOnly, async (_req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({
        ok: false,
        gabim: "Fiskalizimi është OFF — aktivizoje për të printuar",
      });
    }
    const result = await getFiscalMain().printTestFiscalCoupon();
    if (!result?.ok) {
      return res.status(400).json({
        ok: false,
        gabim: result?.gabim || "Printimi dështoi",
      });
    }
    res.json({ ok: true, message: result.message || "U printua", nuikf: result.nuikf });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim gjatë printimit" });
  }
});

/* HAPI 4 — a është fiskalizimi ON? (kamarier + pronar, pa ekspozuar settings) */
app.get("/api/fiscal-enabled", auth, (_req, res) => {
  try {
    const enabled = fiscalConfig.isFiscalEnabled();
    const language = fiscalI18n.syncLanguageFromSettings();
    console.log("[fiscal-enabled] GET → enabled=", enabled, "language=", language);
    res.json({
      enabled,
      language,
      methods: fiscalPayment.PAYMENT_METHODS,
      default: fiscalPayment.DEFAULT_PAYMENT_METHOD,
      labels: {
        title: fiscalI18n.t("payment_modal_title"),
        sub: fiscalI18n.t("payment_modal_sub"),
        cancel: fiscalI18n.t("payment_modal_cancel"),
      },
      method_labels: {
        cash: fiscalI18n.t("pay_cash"),
        debit_card: fiscalI18n.t("pay_debit"),
        credit_card: fiscalI18n.t("pay_credit"),
        bank_account: fiscalI18n.t("pay_bank"),
        voucher: fiscalI18n.t("pay_voucher"),
        check: fiscalI18n.t("pay_check"),
        sms: fiscalI18n.t("pay_sms"),
      },
    });
  } catch (e) {
    console.warn("[fiscal-enabled] ERROR:", e.message);
    res.json({ enabled: false, language: "sq", methods: [], default: "cash" });
  }
});

/* HAPI 7 — kuponë korrigjues (vetëm pronari) */
app.get("/api/fiscal-correction/lookup/:nuikf", auth, adminOnly, (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const nuikf = String(req.params.nuikf || "").trim();
    const original = fiscalCorrection.getOriginalReceipt(nuikf);
    if (!original) {
      return res.status(404).json({ gabim: "Kuponi origjinal nuk u gjet" });
    }
    res.json({
      ok: true,
      original,
      has_correction: fiscalCorrection.hasCorrection(nuikf),
      corrections: fiscalCorrection.getCorrectionHistory(nuikf),
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/fiscal-correction", auth, adminOnly, async (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const {
      original_nuikf,
      correction_type,
      items,
      reason,
    } = req.body || {};

    const created = fiscalCorrection.createCorrectionReceipt(
      original_nuikf,
      correction_type,
      items,
      reason,
      {
        operator_name: req.session.emri || "Pronari",
        operator_id: String(req.session.userId || req.session.id || "OWNER"),
      }
    );

    let printed = false;
    let printMessage = "";
    try {
      const text = created.print_text || "";
      if (text) {
        // Prefero ESC/POS me markera ^B/^L/^C; fallback tekst plain
        try {
          const buf = buildEscPosFromPlainText(text);
          const b64 = buf.toString("base64");
          await printer.printEscPosReceiptAt(b64, db, "bar");
          printed = true;
        } catch (escErr) {
          const result = await printer.printPlainTextAt(text, db, "bar");
          printed = !!result;
          if (!printed) printMessage = escErr.message || "Printimi dështoi";
        }
      }
    } catch (printErr) {
      printMessage = printErr.message || "Printimi dështoi";
    }

    res.json({
      ok: true,
      receipt: created,
      printed,
      printMessage: printMessage || (printed ? "U printua" : "U ruajt, por printimi dështoi"),
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/* HAPI 9 — status offline / internet për indikatorin e header-it */
app.get("/api/fiscal-offline/status", auth, async (_req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.json({ enabled: false });
    }
    const online = await fiscalOffline.checkInternetConnection();
    const warning = fiscalOffline.getOfflineWarning();
    const status = fiscalOffline.getOfflineStatus();
    res.json({
      enabled: true,
      taxpayer_nui: String(fiscalConfig.getFiscalSettings()?.taxpayer_nui || "").trim(),
      online: !!online,
      receipt_count: status?.receipt_count || 0,
      pending_count: status?.pending_count || 0,
      oldest_hours: status?.oldest_hours || 0,
      within_48h: status?.within_48h !== false,
      warning: warning?.message || null,
      warning_level: warning?.level || "ok",
    });
  } catch (e) {
    res.json({ enabled: false, online: false, gabim: e.message });
  }
});

/* HAPI 10 — audit log eksport (vetëm pronari) */
app.get("/api/fiscal-audit", auth, adminOnly, (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const from = req.query.from || req.query.fromDate || null;
    const to = req.query.to || req.query.toDate || null;
    const rows = fiscalAudit.getAuditLog(from, to) || [];
    res.json({ ok: true, rows, count: rows.length });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/fiscal-audit/export", auth, adminOnly, (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const format = String(req.body?.format || "csv").toLowerCase();
    const from = req.body?.from || req.body?.fromDate || null;
    const to = req.body?.to || req.body?.toDate || null;
    let filePath;
    if (format === "pdf") {
      filePath = fiscalAudit.exportAuditPDF(from, to);
    } else {
      filePath = fiscalAudit.exportAuditCSV(from, to);
    }
    if (!filePath) {
      return res.status(400).json({ gabim: "Eksporti dështoi" });
    }
    res.json({
      ok: true,
      format,
      path: filePath,
      message: `U ruajt: ${filePath}`,
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Neni 11 / 7 — rikuperim printimi pas ndërprerjes */
app.get("/api/fiscal-recovery/pending", auth, adminOnly, (_req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const fiscalRecovery = require("./fiscal/fiscal-recovery");
    res.json({ ok: true, pending: fiscalRecovery.listOpenPending() });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/fiscal-recovery/resume", auth, adminOnly, async (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const fiscalRecovery = require("./fiscal/fiscal-recovery");
    const result = await fiscalRecovery.resumeAllPendingOnBoot({
      skip_print: !!req.body?.skip_print,
    });
    auditReq(
      req,
      "Rikuperim fiskal (MUNGESË RRYME)",
      `resumed=${result.resumed?.length || 0} abandoned=${result.abandoned?.length || 0}`
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/* HAPI 11 — përkthime SEF (vetëm moduli fiskal) */
app.get("/api/fiscal-i18n", auth, adminOnly, (req, res) => {
  try {
    const lang = req.query.lang
      ? fiscalI18n.normalizeLang(req.query.lang)
      : fiscalI18n.getCurrentLanguage();
    res.json({
      ok: true,
      language: lang,
      translations: fiscalI18n.getTranslations(lang),
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/* HAPI FINAL — mode printimi: addon (normal+fiskal) | replace (vetëm fiskal) */
app.get("/api/fiscal-print-mode", auth, adminOnly, (_req, res) => {
  try {
    res.json({
      ok: true,
      mode: getFiscalMain().getFiscalPrintMode(),
      enabled: fiscalConfig.isFiscalEnabled(),
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/fiscal-print-mode", auth, adminOnly, (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const mode = getFiscalMain().setFiscalPrintMode(req.body?.mode);
    res.json({ ok: true, mode });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/register-mode", auth, adminOnly, (req, res) => {
  try {
    const mode = registerMode.normalizeRegisterMode(req.body?.mode);
    const state = registerMode.setRegisterMode(db, mode, req.session.emri);
    const label = mode === "auto" ? "Automatik (kamarieri zgjedh)" : mode === "fiscal" ? "Fiskal" : "Termik";
    auditReq(req, "Modaliteti i faturës", `Ndryshuar në: ${label}`);
    res.json({ ok: true, ...state });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/receipts/print", auth, adminOnly, async (req, res) => {
  const { order_id, coupon_type } = req.body;
  if (!order_id) return res.status(400).json({ gabim: "Porosia mungon" });
  try {
    const order = db.db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(order_id));
    if (!order) return res.status(404).json({ gabim: "Porosia nuk u gjet" });

    if (order.status === "active") {
      const deltaItems = db.getOrderSlipDelta(order);
      if (!deltaItems.length) {
        return res.status(400).json({ gabim: "Nuk ka artikuj të rinj për printim — gjithçka është printuar." });
      }
      const table = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(order.table_id);
      const settings = db.getSettings();
      const slipAt = new Date().toISOString();
      const batchNo = db.recordPrintedBatch(order.id, order.items_json);
      const printResult = await autoPrintOrderSlip(db, {
        tableNumber: table?.number || order.table_id,
        waiterName: order.waiter_name,
        items: deltaItems,
        batchNumber: batchNo,
        order,
        closedAt: slipAt,
      });
      return res.json({
        ok: true,
        batch: true,
        batch_no: batchNo,
        items: deltaItems,
        printed: printResult.printed,
        printMessage: printResult.message || "",
      });
    }

    const receipt = db.createReceipt(Number(order_id)); // idempotent: kthen ekzistuesin nëse ka
    const fiscal = db.getFiscalSettings();
    const totals = db.calcFiscalTotals(
      receipt.order.total,
      fiscal.tvsh_enabled,
      fiscal.tvsh_percent,
    );
    const table = receipt.order
      ? db.db.prepare("SELECT number FROM tables WHERE id = ?").get(receipt.order.table_id)
      : null;

    // pushSale vetëm nëse ky është printimi i parë (receipt.id === receipt.order.id nuk ka kuptim)
    // Shfrytëzojmë idempotency-n e upsertSaleFromPos — OK ta thërrasim sërish (cloud upserts)
    if (receipt.order) {
      cloudSync.pushSale(db, receipt.order, {
        table_number: table?.number || 0,
        receipt_number: receipt.receipt_number || "",
        closed_at: receipt.printed_at || new Date().toISOString(),
        payment_method: receipt.order.payment_method,
      });
    }

    const effectiveCouponType = registerMode.resolveEffectiveCouponType(db, coupon_type);
    const printResult = await printClosedTableReceipt(db, {
      order: receipt.order,
      receipt,
      tableNumber: table?.number || 0,
      couponType: effectiveCouponType,
    });

    res.json({
      ok: true,
      receipt,
      fiscal,
      totals,
      coupon_type: printResult.coupon_type || effectiveCouponType,
      printed: printResult.printed,
      printMessage: printResult.printMessage || "",
      html: printResult.html || null,
      receipt_source: printResult.source,
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/printer", auth, adminOnly, async (_req, res) => {
  try {
    res.json(await printer.getStatus(db));
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.put("/api/printer", auth, adminOnly, (req, res) => {
  const { name, kitchen_name, fiscal_name, paper, output, waiter_shift_print_enabled } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ gabim: "Zgjidhni një printer ose arkë fiskale." });
  }
  printer.savePrinterConfig(db, {
    name: String(name).trim(),
    kitchen_name: kitchen_name !== undefined ? String(kitchen_name || "").trim() : undefined,
    fiscal_name: fiscal_name !== undefined ? String(fiscal_name || "").trim() : undefined,
    paper: paper !== undefined ? String(paper).trim() : undefined,
    output: output !== undefined ? String(output).trim() : undefined,
    waiter_shift_print_enabled: waiter_shift_print_enabled !== undefined
      ? !!waiter_shift_print_enabled
      : undefined,
  });
  res.json({ ok: true, ...printer.getPrinterConfig(db) });
});

app.post("/api/printer/detect", auth, adminOnly, async (_req, res) => {
  try {
    const printers = await printer.listPrinters();
    const picked = printer.pickAutoPrinter(printers);
    if (!picked) {
      return res.status(404).json({
        gabim:
          "Nuk u gjet printer ose arkë fiskale. Instaloni driverin në Windows dhe provoni përsëri.",
      });
    }
    const info = printer.classifyPrinter(picked);
    printer.savePrinterConfig(db, {
      name: picked,
      paper: info.paper,
      output: info.output,
    });
    res.json({ ok: true, name: picked, ...(await printer.getStatus(db)) });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.post("/api/printer/test", auth, adminOnly, async (_req, res) => {
  try {
    const config = printer.getPrinterConfig(db);
    if (!config.name) {
      return res.status(400).json({ gabim: "Zgjidhni printerin ose arkën fillimisht." });
    }
    const result = await printer.printTestPage(db);
    res.json({ ok: true, printed: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/printer/print", auth, adminOnly, async (req, res) => {
  const { html, escpos_base64, text, lines } = req.body;
  const config = printer.getPrinterConfig(db);
  if (!config.name) {
    return res.json({ printed: false, fallback: true, message: "Nuk ka printer të zgjedhur." });
  }
  try {
    if (escpos_base64 || text || lines?.length) {
      const result = await printer.printServerReceipt({ escpos_base64, text, lines }, db);
      return res.json({ printed: true, ...result });
    }
    if (!html) return res.status(400).json({ gabim: "Fatura mungon." });
    const result = await printer.printReceipt(html, db);
    res.json({ printed: true, ...result });
  } catch (e) {
    res.json({ printed: false, fallback: true, message: e.message });
  }
});

app.get("/api/fiscal-register", auth, adminOnly, async (_req, res) => {
  try {
    res.json(await fiscalRegister.getStatus(db));
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.put("/api/fiscal-register", auth, adminOnly, async (req, res) => {
  try {
    const { register_name, com_port, baud_rate } = req.body;
    if (!register_name || !String(register_name).trim()) {
      return res.status(400).json({ gabim: "Shkruani emrin ose numrin e arkës fiskale." });
    }
    if (!com_port || !String(com_port).trim()) {
      return res.status(400).json({ gabim: "Zgjidhni portin COM." });
    }
    const port = String(com_port).trim().toUpperCase();
    if (!fiscalRegister.COM_PORTS.includes(port)) {
      return res.status(400).json({ gabim: "Porti COM duhet të jetë COM1–COM9." });
    }
    const baud = Number(baud_rate);
    if (!fiscalRegister.BAUD_RATES.includes(baud)) {
      return res.status(400).json({ gabim: "Baud rate i pavlefshëm." });
    }
    fiscalRegister.saveConfig(db, {
      register_name: String(register_name).trim(),
      com_port: port,
      baud_rate: baud,
    });
    res.json({ ok: true, ...(await fiscalRegister.getStatus(db)) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/fiscal-register/test", auth, adminOnly, async (_req, res) => {
  try {
    const config = fiscalRegister.getConfig(db);
    if (!config.com_port) {
      return res.status(400).json({ gabim: "Ruani fillimisht portin COM të arkës." });
    }
    const status = await fiscalRegister.getStatus(db);
    if (status.connected) {
      res.json({ ok: true, connected: true, message: status.message });
    } else {
      res.status(400).json({ gabim: status.message });
    }
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/license", auth, adminOnly, async (_req, res) => {
  const eapp = electronApp();
  if (!eapp) {
    return res.json({
      machine_id: license.getMachineId(),
      hardware_id: license.getHardwareIdForDisplay?.() || "",
      activated: true,
      dev_mode: true,
    });
  }
  try {
    res.json(await license.getLicenseStatusForApp(eapp));
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.put("/api/license", auth, adminOnly, async (req, res) => {
  const eapp = electronApp();
  if (!eapp) {
    return res.status(400).json({ gabim: "Aktivizimi bëhet vetëm në aplikacionin .exe." });
  }
  const { license_key } = req.body;
  if (!license_key || !String(license_key).trim()) {
    return res.status(400).json({ gabim: "Shkruani çelësin e licencës." });
  }
  try {
    const result = await license.activateWithKey(eapp, license_key);
    const normalized = String(license_key || "").trim().toUpperCase().replace(/\s+/g, "");
    /* Hotel: mos ruaj çelës hotel / mos sync cloud. */
    res.json(result);
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/ai/status", auth, adminOnly, async (_req, res) => {
  res.json({
    ok: true,
    enabled: false,
    paused: true,
    configured: false,
    package_ai: false,
    gabim: "AI do të aktivizohet kur hoteli të lidhet me cloud",
  });
});

app.post("/api/ai/scan-menu", auth, adminOnly, async (_req, res) => {
  return res.status(503).json({
    ok: false,
    gabim: "AI do të aktivizohet kur hoteli të lidhet me cloud",
  });
});

const AI_HOTEL_OFF = {
  ok: false,
  enabled: false,
  gabim: "AI do të aktivizohet kur hoteli të lidhet me cloud",
};

app.post("/api/ai/scan-invoice", auth, adminOnly, async (_req, res) => {
  res.status(503).json(AI_HOTEL_OFF);
});

app.post("/api/ai/apply-invoice-scan", auth, adminOnly, async (_req, res) => {
  res.status(503).json(AI_HOTEL_OFF);
});

app.get("/api/ai/usage", auth, adminOnly, async (_req, res) => {
  res.json({
    ok: true,
    enabled: false,
    calls: 0,
    tokens_total: 0,
    cost_eur_total: 0,
    gabim: AI_HOTEL_OFF.gabim,
  });
});

app.get("/api/ai/waiter-rating", auth, adminOnly, async (_req, res) => {
  res.status(503).json(AI_HOTEL_OFF);
});

app.post("/api/ai/waiter-rating/analyze", auth, adminOnly, async (_req, res) => {
  res.status(503).json(AI_HOTEL_OFF);
});

app.get("/api/ai/stock-predict", auth, adminOnly, async (_req, res) => {
  res.status(503).json(AI_HOTEL_OFF);
});

app.post("/api/ai/stock-predict/analyze", auth, adminOnly, async (_req, res) => {
  res.status(503).json(AI_HOTEL_OFF);
});

app.get("/api/ai/weekly-reports", auth, adminOnly, async (_req, res) => {
  res.status(503).json(AI_HOTEL_OFF);
});

app.post("/api/ai/weekly-reports/generate", auth, adminOnly, async (_req, res) => {
  res.status(503).json(AI_HOTEL_OFF);
});

app.post("/api/ai/assistant/chat", auth, adminOnly, async (_req, res) => {
  res.status(503).json(AI_HOTEL_OFF);
});

app.get("/api/system/disk-status", auth, adminOnly, (_req, res) => {
  try {
    const status = refreshDiskStatus();
    res.json({
      ok: true,
      disk: status,
      blocks_new_records: blocksNewRecords(status),
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/backup/run", auth, adminOnly, (req, res) => {
  try {
    const { runBackup, pickBackupFolderDialog } = require("./hotel-backup");
    let target =
      req.body && req.body.targetPath ? String(req.body.targetPath).trim() : "";
    if (!target) target = pickBackupFolderDialog();
    if (!target) {
      return res.status(400).json({
        ok: false,
        gabim: "Backup u anulua — nuk u zgjodh folder.",
      });
    }

    const result = runBackup(target);
    const operatorName =
      String(req.body?.operator_name || req.session?.emri || "Admin").trim() || "Admin";
    auditActivity(
      operatorName,
      req.session?.role || "admin",
      "Backup HOTEL",
      `${result.dest_dir} · ${result.file_count} skedarë`
    );

    res.json({
      ok: true,
      message: "Backup u krye me sukses",
      created_at: result.created_at,
      dest_dir: result.dest_dir,
      file_count: result.file_count,
    });
  } catch (e) {
    console.error("[backup]", e);
    res.status(500).json({ ok: false, gabim: e.message || "Backup dështoi" });
  }
});

const START_PORT = Number(process.env.PORT) || 3001;
const MAX_PORT = START_PORT + 10;

function onServerListening(server, port) {
  process.env.ACTUAL_PORT = String(port);
  if (process.env.DB_PATH) {
    try {
      fs.writeFileSync(
        path.join(path.dirname(process.env.DB_PATH), "server-port.txt"),
        String(port),
        "utf8",
      );
    } catch (e) {
      /* ignore */
    }
  }
  const ver = db.getVersionInfo().app_version || db.getVersionInfo().version;
  console.log(`\n  Revolution HOTEL — v${ver} — http://127.0.0.1:${port}\n`);
  setTimeout(() => {
    try {
      if (typeof db.ensureHotelServiceStockPhotos === "function") {
        db.ensureHotelServiceStockPhotos();
      }
    } catch (_) {}
    try {
      if (typeof db.ensureMenuCatalog === "function") {
        db.ensureMenuCatalog();
      }
    } catch (e) {
      console.warn("Menu catalog:", e.message);
    }
    try {
      const n = db.ensureMenuStockPhotos();
      if (n) console.log(`Foto menu: ${n} artikuj u plotësuan automatikisht`);
    } catch (e) {
      console.warn("Stock photos:", e.message);
    }
    try {
      cloudAutoSync.startCloudAutoSync(db);
    } catch (_) {}
  }, 2500);
  try {
    if (typeof db.ensureDefaultRooms === "function") {
      db.ensureDefaultRooms();
    }
  } catch (_) {}
}

/** Nis Express — përdoret nga Electron (main.js). */
function startServer(startPort = START_PORT) {
  return new Promise((resolve, reject) => {
    const tryListen = (port) => {
      if (port > MAX_PORT) {
        reject(new Error(`Nuk u gjet port i lirë (${START_PORT}–${MAX_PORT})`));
        return;
      }
      const server = app.listen(port, "0.0.0.0", () => {
        onServerListening(server, port);
        resolve({
          server,
          port,
          url: `http://127.0.0.1:${port}/`,
        });
      });
      server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          try {
            server.close();
          } catch {
            /* ignore */
          }
          tryListen(port + 1);
        } else {
          reject(err);
        }
      });
    };
    tryListen(Number(startPort) || START_PORT);
  });
}

module.exports = { app, startServer, START_PORT };

if (require.main === module) {
  Promise.resolve(typeof db.whenReady === "function" ? db.whenReady() : null)
    .then(() => startServer())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
