const express = require("express");
const path = require("path");
const fs = require("fs");
const {
  joinContent,
  listPublicStaticRoots,
  resolvePublicFile,
  clearPublicOverlayOnAppUpgrade,
  pruneStalePublicOverlay,
  refreshStalePinLoginOverlay,
} = require("./app-paths");
try {
  clearPublicOverlayOnAppUpgrade();
  pruneStalePublicOverlay();
  refreshStalePinLoginOverlay();
} catch (e) {
  console.warn("[hotel] public-overlay prune:", e.message || e);
}
const os = require("os");
const crypto = require("crypto");
process.env.FISCAL_LOCAL_RUN = process.env.FISCAL_LOCAL_RUN || "1";
process.env.ATK_AUTO_SEND = process.env.ATK_AUTO_SEND || "0";
try {
  const { applyStartupFiscalProfile } = require("./fiscal/fiscal-boot");
  applyStartupFiscalProfile();
} catch (e) {
  console.warn("[hotel] fiscal-boot:", e.message);
}
const db = require("./database");
const { isDrinkCategory } = require("./menu-groups");

function menuItemEligibleForRecipe(menuItem) {
  if (!menuItem) return false;
  return !isDrinkCategory(menuItem.category);
}
const {
  attachWaiterWebSocket,
  broadcastWaiterRealtime,
} = require("./waiter-ws-hub");
const bizDate = require("./lib/hotel-business-date");
const businessTodayYmd = () => bizDate.businessYmd();
const staffPinPolicy = require("./lib/staffPinPolicy");
const { openCashDrawer, paymentIncludesCash } = require("./lib/cash-drawer");

function isHotelPmsCloudMaster() {
  try {
    return license.terminalRegisterNumber() < 2;
  } catch {
    return true;
  }
}

/** PMS cloud push — debounced (mos blloko recepsionin; vetëm Kryesorja). */
const HOTEL_PMS_PUSH_DEBOUNCE_MS = 1200;
let hotelGuestStayPushTimer = null;
let hotelHousekeepingPushTimer = null;
let hotelReservationsPushTimer = null;

function pushHotelGuestStayToCloudAsync(reason) {
  const cloudStaffAccess = require("./cloud-staff-access");
  if (!cloudStaffAccess.allowBackgroundCloudPush(reason)) return;
  if (!isHotelPmsCloudMaster()) return;
  if (hotelGuestStayPushTimer) clearTimeout(hotelGuestStayPushTimer);
  hotelGuestStayPushTimer = setTimeout(() => {
    hotelGuestStayPushTimer = null;
    const hotelCloudSync = require("./hotel-cloud-sync");
    void hotelCloudSync.pushGuestStaySnapshotToCloud(db).catch((err) => {
      console.warn("[hotel-pms-cloud] guest-stay:", err.message || err);
    });
  }, HOTEL_PMS_PUSH_DEBOUNCE_MS);
}

function pushHousekeepingToCloudAsync(reason) {
  const cloudStaffAccess = require("./cloud-staff-access");
  if (!cloudStaffAccess.allowBackgroundCloudPush(reason)) return;
  if (!isHotelPmsCloudMaster()) return;
  if (hotelHousekeepingPushTimer) clearTimeout(hotelHousekeepingPushTimer);
  hotelHousekeepingPushTimer = setTimeout(() => {
    hotelHousekeepingPushTimer = null;
    const hotelCloudSync = require("./hotel-cloud-sync");
    void hotelCloudSync.pushHousekeepingToCloud(db).catch((err) => {
      console.warn("[hotel-pms-cloud] housekeeping:", err.message || err);
    });
  }, HOTEL_PMS_PUSH_DEBOUNCE_MS);
}

function pushHotelReservationsToCloudAsync(reason) {
  const cloudStaffAccess = require("./cloud-staff-access");
  if (!cloudStaffAccess.allowBackgroundCloudPush(reason)) return;
  if (!isHotelPmsCloudMaster()) return;
  if (hotelReservationsPushTimer) clearTimeout(hotelReservationsPushTimer);
  hotelReservationsPushTimer = setTimeout(() => {
    hotelReservationsPushTimer = null;
    const hotelCloudSync = require("./hotel-cloud-sync");
    void hotelCloudSync.pushReservationsToCloud(db).catch((err) => {
      console.warn("[hotel-pms-cloud] reservations:", err.message || err);
    });
  }, HOTEL_PMS_PUSH_DEBOUNCE_MS);
}

const { registerSalesInvoiceRoutes } = require("./sales-invoices-routes");
const printer = require("./printer");
const fiscalRegister = require("./fiscal-register");
const fiscalConfig = require("./fiscal/fiscal-config");
const fiscalTestMode = require("./fiscal/fiscal-test-mode-store");
const { getAtkStatus } = require("./fiscal/fiscal-atk-api");
const { getKeysDir } = require("./fiscal/fiscal-crypto");
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

function resolveBodyOperatorId(req) {
  return String(req.body?.operator_id || "POS").trim() || "POS";
}

function syncReportLanguage(settings) {
  fiscalI18n.syncLanguageFromSettings(settings?.language);
}

/** Tekst i përbashkët për Modin X dhe Raportin Z (parity BIZNES). */
function buildFiscalDayReportText(details, settings, mode) {
  syncReportLanguage(settings);
  const m = String(mode || details.mode || "Z").toUpperCase();
  const isX = m === "X";
  const isPeriodic = m === "PERIODIC" || m === "P";
  const w = 42;
  const line = (ch = "=") => ch.repeat(w);
  const row = (label, val) => {
    const v = String(val ?? "");
    const gap = Math.max(1, w - label.length - v.length);
    return `${label}${" ".repeat(gap)}${v}`;
  };
  const vat = details.vat_breakdown || {};
  const t = fiscalI18n.t;
  const title = isPeriodic
    ? t("report_periodic")
    : isX
      ? t("report_x")
      : t("report_z");
  const subtitle = isPeriodic
    ? t("report_subtitle_periodic")
    : isX
      ? t("report_subtitle_x")
      : t("report_subtitle_z");
  const lines = [
    line("="),
    title,
    subtitle,
    line("-"),
    row(t("report_business"), settings.taxpayer_legal_name || "-"),
    row(t("nui_label"), settings.taxpayer_nui || "-"),
    row(t("report_unit"), settings.unit_name || "-"),
    row(t("report_sef_id"), fiscalNumbering.getSefIdentifier() || "-"),
    row(t("date_label"), details.date || "-"),
    line("-"),
    row(t("report_coupon_count"), details.coupon_count ?? 0),
    row(t("report_total_eur"), roundPaymentMoney(details.total_amount).toFixed(2)),
    row(t("report_total_without_vat"), roundPaymentMoney(details.total_without_tax).toFixed(2)),
    row(t("report_vat_a"), roundPaymentMoney(vat.A).toFixed(2)),
    row(t("report_vat_b"), roundPaymentMoney(vat.B).toFixed(2)),
    row(t("report_vat_c"), roundPaymentMoney(vat.C).toFixed(2)),
    row(t("report_vat_d"), roundPaymentMoney(vat.D).toFixed(2)),
    row(t("report_vat_e"), roundPaymentMoney(vat.E).toFixed(2)),
    row(t("report_offline"), details.offline_count ?? 0),
  ];
  if (isX || isPeriodic) {
    lines.push(
      row(
        t("report_daily_reset"),
        isPeriodic ? t("report_no_periodic") : t("report_no_mod_x")
      )
    );
    lines.push(line("="));
    lines.push(t("report_print_many"));
  } else {
    const closureStatus = details.reset_applied
      ? t("report_z_closure_done")
      : details.day_already_closed
        ? t("report_z_closure_earlier")
        : t("report_z_closure_done");
    lines.push(row(t("report_daily_closure"), closureStatus));
    lines.push(line("="));
    if (details.reset_applied) {
      lines.push(t("report_pef_cleared"));
    } else if (details.day_already_closed) {
      lines.push(t("report_pef_cleared_earlier"));
    }
    const rfdCreated =
      details.rfd_created_count != null
        ? Number(details.rfd_created_count) || 0
        : Number(details.coupon_count) || 0;
    lines.push(row(t("report_rfd_created"), String(rfdCreated)));
    lines.push(t("report_end_z"));
  }
  lines.push("");
  return lines.join("\n");
}

function buildZReportText(details, settings) {
  return buildFiscalDayReportText(details, settings, "Z");
}

function buildXReportText(details, settings) {
  return buildFiscalDayReportText(details, settings, "X");
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function reportLayoutHelpers() {
  const w = 42;
  const line = (ch = "=") => ch.repeat(w);
  const row = (label, val) => {
    const v = String(val ?? "");
    const gap = Math.max(1, w - label.length - v.length);
    return `${label}${" ".repeat(gap)}${v}`;
  };
  const center = (s) => {
    const t = String(s || "");
    if (t.length >= w) return t.slice(0, w);
    const pad = Math.floor((w - t.length) / 2);
    return `${" ".repeat(pad)}${t}`;
  };
  return { w, line, row, center };
}

/** Neni 13 / 7 — Raport fiskal periodik i përmbledhur (i shkurtër). */
function buildShortPeriodicReportText(details, settings) {
  syncReportLanguage(settings);
  const t = fiscalI18n.t;
  const { line, row, center } = reportLayoutHelpers();
  const turnover = details.vat_turnover || {};
  const tax = details.vat_breakdown || {};
  const lines = [
    line("="),
    center(settings.taxpayer_legal_name || t("business_fallback")),
    row(t("nui_label"), settings.taxpayer_nui || "-"),
    row(t("report_nf_vat"), settings.taxpayer_vat_number || settings.taxpayer_vat || "-"),
    row(t("report_unit"), settings.unit_name || "-"),
    row(t("report_sef_id"), fiscalNumbering.getSefIdentifier() || "-"),
    line("-"),
    center(details.report_name || t("report_short_periodic_title")),
    line("-"),
    row(t("report_from_date"), details.from_date || "-"),
    row(t("report_to_date"), details.to_date || "-"),
    row(t("report_fiscalization"), details.fiscalization_datetime || "-"),
    line("-"),
    row(t("report_rfd_coupons"), details.rfd_count ?? details.coupon_count ?? 0),
    row(t("report_turnover_with_vat"), money(details.total_amount).toFixed(2)),
    row(t("report_total_vat_tax"), money(details.total_tax).toFixed(2)),
    line("-"),
    t("report_turnover_by_rate"),
    row(t("report_rate_a_0"), money(turnover.A).toFixed(2)),
    row(t("report_rate_c_0"), money(turnover.C).toFixed(2)),
    row(t("report_rate_d_8"), money(turnover.D).toFixed(2)),
    row(t("report_rate_e_18"), money(turnover.E).toFixed(2)),
    t("report_tax_by_rate"),
    row(t("report_tax_a"), money(tax.A).toFixed(2)),
    row(t("report_tax_c"), money(tax.C).toFixed(2)),
    row(t("report_tax_d"), money(tax.D).toFixed(2)),
    row(t("report_tax_e"), money(tax.E).toFixed(2)),
    line("="),
    center(t("report_end")),
    "",
  ];
  return lines.join("\n");
}

/** Neni 11 / 9 — Raporti mujor i memories fiskale të transferuar në ATK. */
function buildMonthlyMemoryReportText(details, settings) {
  syncReportLanguage(settings);
  const t = fiscalI18n.t;
  const { line, row, center } = reportLayoutHelpers();
  const payLabel = (key) => {
    const map = {
      cash: t("payment_mode_cash"),
      card: t("payment_mode_pos"),
      debit: t("pay_debit"),
      credit: t("pay_credit"),
      voucher: t("payment_mode_voucher"),
      mixed: t("mixed_payment"),
      other: t("payment_mode_other"),
    };
    return map[key] || String(key || "").toUpperCase();
  };
  const payments = details.payments || {};
  const payLines = Object.keys(payments).length
    ? Object.entries(payments).map(([k, v]) => row(`  ${payLabel(k)}:`, money(v).toFixed(2)))
    : [row(t("report_no_payments"), "0.00")];

  const lines = [
    line("="),
    center(settings.taxpayer_legal_name || t("business_fallback")),
    row(t("nui_label"), settings.taxpayer_nui || "-"),
    row(t("report_unit"), settings.unit_name || "-"),
    row(t("report_sef_id"), fiscalNumbering.getSefIdentifier() || "-"),
    line("-"),
    center(details.report_name || t("report_monthly_memory")),
    center(t("report_transferred_atk")),
    line("-"),
    row(t("report_from_date"), details.from_date || "-"),
    row(t("report_to_date"), details.to_date || "-"),
    row(t("report_fiscalization_date"), details.fiscalization_date || "-"),
    row(t("report_fiscalization_time"), details.fiscalization_time || "-"),
    line("-"),
    row(t("report_rfd_in_period"), details.rfd_count ?? details.coupon_count ?? 0),
    row(t("report_turnover_with_vat"), money(details.total_amount).toFixed(2)),
    row(t("report_total_vat_tax"), money(details.total_tax).toFixed(2)),
    row(t("report_total_without_vat"), money(details.total_without_tax).toFixed(2)),
    row(t("report_ram_resets"), details.ram_resets ?? 0),
    line("-"),
    t("report_payment_methods"),
    ...payLines,
    line("-"),
    center(details.transmission_ok ? t("report_transmission_ok") : t("report_transmission_fail")),
    line("="),
    center(t("report_end")),
    "",
  ];
  return lines.join("\n");
}

function roundPaymentMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function normalizeSplitMethod(raw) {
  const canonical = db.normalizePaymentMethod(raw);
  if (canonical === "room") return "room";
  if (canonical === "karte") return "credit_card";
  if (canonical === "mixed" || canonical === "perzier") return "mixed";
  const v = String(raw || "cash").trim().toLowerCase();
  if (["karte", "kartë", "card", "pos"].includes(v)) return "credit_card";
  if (["cheque", "cek", "çek"].includes(v)) return "check";
  if (
    [
      "cash",
      "debit_card",
      "credit_card",
      "bank_account",
      "voucher",
      "check",
      "sms",
      "crypto",
      "cryptocurrency",
      "room",
    ].includes(v)
  ) {
    return v;
  }
  return "cash";
}

/** Pagesë e përzier ose një metodë — validon shumat kundrejt totalit të pritur. */
function resolvePaymentFromBody(body, expectedTotal) {
  const rawSplits = Array.isArray(body?.payment_splits) ? body.payment_splits : [];
  const splits = rawSplits
    .map((p) => ({
      method: normalizeSplitMethod(p.method ?? p.id),
      amount: roundPaymentMoney(p.amount),
    }))
    .filter((p) => p.amount > 0);
  const wantsMixed =
    String(body?.payment_method || "").trim().toLowerCase() === "mixed" ||
    splits.length > 1;
  if (wantsMixed) {
    if (splits.length < 2) {
      throw new Error("Pagesa e përzier kërkon të paktën dy metoda me shuma > 0");
    }
    const total = roundPaymentMoney(expectedTotal);
    const sum = roundPaymentMoney(splits.reduce((s, p) => s + p.amount, 0));
    if (Math.abs(sum - total) > 0.02) {
      throw new Error(
        `Pagesa e përzier (${sum.toFixed(2)} €) ≠ totali (${total.toFixed(2)} €)`
      );
    }
    return { payment_method: "mixed", payment_splits: splits };
  }
  if (splits.length === 1) {
    return { payment_method: splits[0].method, payment_splits: splits };
  }
  const method = normalizeSplitMethod(body?.payment_method || "cash");
  return { payment_method: method, payment_splits: null };
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
const cloudStaffAccess = require("./cloud-staff-access");
const onlineOrdersWatcher = require("./online-orders-watcher");
const publicGuestRequestsWatcher = require("./public-guest-requests-watcher");

/** Vetëm admin/pronar — cloud outbound (alias CLOUD_ROLES në cloud-staff-access.js). */
const CLOUD_ROLES = cloudStaffAccess.CLOUD_ROLES;

function sessionMayTalkToCloud(session) {
  return cloudStaffAccess.isCloudEnabledForSession(session);
}

/** Staf: përgjigje lokale (SQLite). Admin: vazhdon te cloud. */
function rejectStaffCloud(req, res, localOnlyBody) {
  if (sessionMayTalkToCloud(req.session)) return false;
  if (localOnlyBody != null) {
    res.json(localOnlyBody);
    return true;
  }
  cloudStaffAccess.jsonStaffCloudDisabled(res);
  return true;
}

/** Porosi online (PRANO/refuzo) — cloud outbound vetëm admin; stafi/recepsioni = SQLite. */
function allowCloudOutboundForGuestOrderSession(session) {
  return sessionMayTalkToCloud(session);
}

const STAFF_LOCAL_EMPTY_ONLINE_ORDERS = {
  ok: true,
  orders: [],
  pending: 0,
  connected: false,
  has_pending: false,
  has_new: false,
  my_external: 0,
  my_orders: [],
  message: "",
};

/* ── Njoftimet "faturë në dhomë" — recepsioni i lexon me poll ────────── */
const _roomChargeNotifs = [];
const ROOM_CHARGE_NOTIF_TTL = 90_000;
function pushRoomChargeNotification(info) {
  _roomChargeNotifs.push({ ...info, ts: Date.now() });
  while (_roomChargeNotifs.length > 50) _roomChargeNotifs.shift();
}
function drainRoomChargeNotifications() {
  const now = Date.now();
  while (_roomChargeNotifs.length && now - _roomChargeNotifs[0].ts > ROOM_CHARGE_NOTIF_TTL) {
    _roomChargeNotifs.shift();
  }
  const out = _roomChargeNotifs.splice(0, _roomChargeNotifs.length);
  return out;
}

const license = require("./license");
const receiptPrint = require("./receipt-print");
const { printClosedTableReceipt } = require("./close-table-print");
const { buildXReportHtml, buildZReportHtml, buildXReportLines, buildZReportLines, buildDailySummaryLines } = require("./shift-report-html");
const { diffOrderItems } = require("./kitchen-ticket-html");
const localKdsEvents = require("./lib/local-kds-events");
const localEventsHub = require("./lib/local-events-hub");
const localKds = require("./lib/local-kds-service");
const menuStockPhotos = require("./menu-stock-photos");

function emitLocalStaffEvent(type, data = {}) {
  try {
    localEventsHub.emit(type, data);
  } catch {
    /* ignore */
  }
}

function notifyLocalKdsUpdate(payload = {}) {
  const p = payload && typeof payload === "object" ? payload : {};
  try {
    localKdsEvents.notifyKitchenUpdate(p);
  } catch {
    /* ignore */
  }
  const st = String(p.status || "").trim().toLowerCase();
  if (st === "ordered") emitLocalStaffEvent("order-new", p);
  else if (st === "accepted") emitLocalStaffEvent("order-accepted", p);
  else if (st === "refused") emitLocalStaffEvent("order-refused", p);
  else if (st === "ready") emitLocalStaffEvent("order-status", { ...p, status: "ready" });
  else if (st) emitLocalStaffEvent("order-status", p);
}
const {
  getPublicCloudServerUrl,
  buildCloudAccessLinks,
  buildPublicMenuUrl,
  buildWaiterPersonalUrl,
  buildStaffPersonalUrl,
  stripLegacyKitchenSlugSuffix,
  buildHotelVenueSlug,
  urlTipiSegment,
  PUBLIC_HOTEL_ORIGIN,
  HOTEL_ACCESS_ROLES,
  STAFF_ACCESS_ROLES,
} = require("./cloud-server-url");
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
let publicGuestRequestsWatcherStarted = false;

function ensureOnlineOrdersWatcher() {
  if (onlineOrdersWatcherStarted) return;
  onlineOrdersWatcher.startOnlineOrdersWatcher(db, opts => autoPrintKitchenTicket(db, opts));
  onlineOrdersWatcherStarted = true;
}

function ensurePublicGuestRequestsWatcher() {
  if (publicGuestRequestsWatcherStarted) return;
  publicGuestRequestsWatcher.ensurePublicGuestRequestsWatcher(db);
  publicGuestRequestsWatcherStarted = true;
}

function resolvePendingPublicBookingRow(dbRef, id) {
  const cid = String(id || "").trim();
  if (!cid || typeof dbRef.getPendingPublicBookingRequest !== "function") return null;
  return dbRef.getPendingPublicBookingRequest(cid);
}

async function loadPublicBookingRequestsForRecepcion() {
  ensurePublicGuestRequestsWatcher();
  try {
    await publicGuestRequestsWatcher.refreshPublicGuestRequests(db);
  } catch (err) {
    console.warn("[public-booking] refresh:", err?.message || err);
  }
  if (typeof db.listPendingPublicBookingRequests !== "function") return [];
  return db.listPendingPublicBookingRequests();
}

async function finalizeImportedCloudOrders(importedRows, waiterName) {
  for (const row of importedRows || []) {
    if (!row?.ok || !row.table_id) continue;
    const order = db.getActiveOrderForTable(row.table_id);
    if (!order) continue;
    const cloudId = String(row.cloud_id || order.cloud_order_id || "").trim();
    if (cloudId && onlineOrdersWatcher.isCloudOrderSlipMarkedPrinted(cloudId)) {
      continue;
    }
    const tableNum = Number(row.table_number) || 0;
    // Mos pushActiveOrderUpdate — porosia ekziston tashmë në cloud (WEB-WAITER/QR).
    let slipItems = Array.isArray(row.batch_items) ? row.batch_items : [];
    if (!slipItems.length && row.merged && typeof db.getOrderSlipDelta === "function") {
      slipItems = db.getOrderSlipDelta(order);
    }
    if (!slipItems.length && !row.merged) {
      try {
        slipItems = JSON.parse(order.items_json || "[]");
      } catch {
        slipItems = [];
      }
    }
    if (!slipItems.length) continue;
    if (cloudId) onlineOrdersWatcher.markOrdersPrinted(db, [cloudId]);
    const batchNo = db.recordPrintedBatch(order.id, order.items_json);
    await autoPrintOrderSlip(db, {
      tableNumber: tableNum || row.table_id,
      waiterName: row.waiter_name || waiterName,
      items: slipItems,
      batchNumber: batchNo,
      order,
      acceptedBy: waiterName,
    });
  }
}

function staffCloudAckMeta(staff) {
  if (!staff) return { waiterId: "", waiterName: "" };
  const name = String(staff.name || "").trim();
  const row = staff?.id != null ? db.findStaffById(staff.id) : staff;
  const cloudId = String(row?.cloud_waiter_id || staff?.cloud_waiter_id || "").trim();
  return {
    waiterId: cloudId,
    waiterName: name,
  };
}

function cloudAckPinFromInput(pinRaw) {
  const pinTrim = String(pinRaw || "").trim();
  return /^\d{4,6}$/.test(pinTrim) ? pinTrim : "";
}

function resolveTrustedStaffFromWaiterSession(session, pinRaw = "") {
  const pin = String(pinRaw || "").trim();
  if (/^\d{4,6}$/.test(pin)) {
    const pinStaff = db.findStaffByPin(pin);
    if (!pinStaff) {
      throw Object.assign(new Error("PIN i gabuar!"), { status: 401 });
    }
    const staffId = resolveWaiterStaffId(session);
    if (staffId != null && Number(pinStaff.id) !== Number(staffId)) {
      throw Object.assign(new Error("PIN i gabuar për këtë kamarier!"), { status: 401 });
    }
    return pinStaff;
  }
  const staffId = resolveWaiterStaffId(session);
  if (staffId != null) {
    const row = db.findStaffById(staffId);
    if (row) return row;
  }
  const emri = String(session?.emri || "").trim();
  if (emri) {
    const ident = resolveStaffCloudWaiterIdentity(session);
    return { id: staffId || null, name: emri, cloud_waiter_id: ident.waiterId };
  }
  throw Object.assign(new Error("Kyçuni si kamarier për të vazhduar."), { status: 400 });
}

async function acceptOnlineOrdersFlow(orderIds, pin, options = {}) {
  const ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  const pinTrim = String(pin || "").trim();
  let staff = options.trustedStaff || null;

  if (!staff) {
    if (!pinTrim) {
      throw Object.assign(new Error("Vendosni PIN-in e kamarierit që e pranon porosinë."), { status: 400 });
    }
    if (!/^\d{4,6}$/.test(pinTrim)) {
      throw Object.assign(new Error("PIN duhet të jetë 4 ose 6 shifra."), { status: 400 });
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

  const waiterName = String(staff.name || "").trim();
  const sessionRole = String(options.sessionRole || "").trim().toLowerCase();
  if (sessionRole === "recepsion") {
    const restOnly = ordersBefore.filter((o) => !db.isRecepcionCloudPendingOrder(o));
    if (restOnly.length) {
      throw Object.assign(
        new Error(
          "Porosi restoranti (QR tavolinë / takeaway) — vetëm kamarieri i pranon. "
          + "Recepsioni merr vetëm room service dhe shërbime hoteli nga QR dhomë.",
        ),
        { status: 403 },
      );
    }
    ordersBefore = ordersBefore.filter((o) => db.isRecepcionCloudPendingOrder(o));
  } else if (sessionRole === "kamarier") {
    ordersBefore = ordersBefore.filter((o) => !db.isRecepcionCloudPendingOrder(o));
    if (!ordersBefore.length) {
      throw Object.assign(
        new Error(
          "Porosi shërbimi hoteli (spa/saunë) — pranoni nga recepsioni. "
          + "Ushqim/pije QR dhomë i pranon kamarieri.",
        ),
        { status: 403 },
      );
    }
  }

  for (const o of ordersBefore) {
    const access = db.qrOrderAccessForWaiter(o, waiterName);
    if (!access.allowed) {
      throw Object.assign(
        new Error(`Porosia QR e tavolinës T${access.tableNumber} i përket kamarierit: ${access.owner}`),
        { status: 403 },
      );
    }
  }

  db.ensureTablesForPendingCloudOrders(ordersBefore);

  // Si KAFENE: PIN-i dërgohet në cloud vetëm kur punonjësi e ka shtypur tani;
  // përndryshe identifikimi bëhet me emrin e verifikuar në PC (pos_authenticated).
  const ackPin = cloudAckPinFromInput(pinTrim);
  const ackMeta = staffCloudAckMeta(staff);

  const allowCloudOutbound = options.allowCloudOutbound === true;
  let cloudResult = { ok: true, message: "", accepted_by: "", acknowledged: ids.length };
  if (allowCloudOutbound) {
    if (!ackPin && !ackMeta.waiterName) {
      throw Object.assign(
        new Error("Mungon identifikimi i kamarierit për cloud."),
        { status: 400 },
      );
    }
    try {
      cloudResult = await cloudSync.acknowledgeOnlineOrders(db, ids, ackPin, ackMeta);
    } catch (e) {
      cloudResult = { ok: false, message: e.message || "", accepted_by: "", acknowledged: 0 };
    }
    const ackCount = Number(cloudResult.acknowledged) || 0;
    if (!cloudResult.ok || ackCount < 1) {
      throw Object.assign(
        new Error(
          cloudResult.message
          || "Porosia nuk u shënua në cloud — provoni përsëri ose kontrolloni internetin.",
        ),
        { status: 400, cloud_ok: false },
      );
    }
  }

  let slotLayout = [];
  if (allowCloudOutbound) {
    try {
      slotLayout = await cloudSync.fetchOnlineSlotLayout(db, { unfiltered: true });
    } catch {
      /* offline */
    }
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
    const orderForApply = typeof db.hydrateCloudOrderForAccept === "function"
      ? db.hydrateCloudOrderForAccept(order)
      : order;
    if (typeof db.tryApplyCloudRoomMenuOrder === "function") {
      try {
        const roomResult = db.tryApplyCloudRoomMenuOrder(orderForApply);
        if (roomResult?.ok && !roomResult.pending) {
          imported.push({
            ok: true,
            cloud_id: order.id,
            room_menu: true,
            ...roomResult,
          });
          continue;
        }
      } catch {
        /* dhomë e pavlefshme — vazhdo me import QR / takeaway */
      }
    }
    if (typeof db.isGuestHotelServiceOrder === "function" && db.isGuestHotelServiceOrder(order)) {
      try {
        const applied = db.applyGuestHotelServiceOrder(order);
        imported.push({
          ok: true,
          cloud_id: order.id,
          guest_service: true,
          ...applied,
        });
      } catch (e) {
        imported.push({ ok: false, cloud_id: order.id, error: e.message });
      }
      continue;
    }
    const slotNum = onlineSlotForOrder(order.id);
    const isQr = typeof db.isCloudQrTableOrder === "function" && db.isCloudQrTableOrder(order);
    const enriched = {
      ...order,
      table_number: isQr ? db.parseQrTableNumberFromCloudOrder(order) : 0,
      ...(slotNum && !isQr ? { online_slot: slotNum } : {}),
    };
    try {
      imported.push(db.importCloudOrderToLocal(enriched, waiterName, { fromAcceptFlow: true }));
    } catch (e) {
      imported.push({ ok: false, cloud_id: order.id, error: e.message });
    }
  }

  const success = imported.filter(r => r.ok);
  const tableImports = success.filter(r => r.table_id && !r.room_menu && !r.guest_service);
  const localRecepImports = success.filter(r => r.guest_service || r.room_menu);
  if (!success.length) {
    throw Object.assign(
      new Error(imported[0]?.error || "Importimi i porosisë dështoi."),
      { status: 400 },
    );
  }
  const countsAsPosAccept = success.some((r) => {
    if (r.room_menu || r.guest_service) return true;
    if (r.closed || r.cancelled) return false;
    return !!(r.table_id && (r.order_id || r.already === false || r.merged));
  });
  if (!countsAsPosAccept) {
    throw Object.assign(
      new Error(
        "Porosia nuk u hap në POS (e mbyllur më parë ose pa tavolinë) — nuk u shënua si e pranuar.",
      ),
      { status: 400, cloud_ok: false },
    );
  }

  if (tableImports.length) {
    await finalizeImportedCloudOrders(tableImports, waiterName);
    const slipCloudIds = [];
    for (let i = 0; i < ordersBefore.length; i++) {
      const r = imported[i];
      if (r?.ok && r.table_id && !r.room_menu && !r.guest_service && ordersBefore[i]?.id) {
        slipCloudIds.push(String(ordersBefore[i].id));
      }
    }
    if (slipCloudIds.length) onlineOrdersWatcher.markOrdersPrinted(db, slipCloudIds);
  }

  onlineOrdersWatcher.persistAcknowledged(db, ids);
  db.removePendingCloudOrders(ids);
  onlineOrdersWatcher.removeOrdersFromSnapshot(ids);

  if (allowCloudOutbound && tableImports.length) {
    for (let i = 0; i < ordersBefore.length; i++) {
      const r = imported[i];
      const cloudOrder = ordersBefore[i];
      if (!r?.ok || !r.table_id || !cloudOrder?.id) continue;
      const isQrTable = typeof db.isCloudQrTableOrder === "function"
        && db.isCloudQrTableOrder(cloudOrder);
      const isOnlinePickup = typeof db.isCloudOnlinePickupOrder === "function"
        && db.isCloudOnlinePickupOrder(cloudOrder);
      if (!isQrTable && !isOnlinePickup) continue;
      const order = db.getActiveOrderByCloudId(cloudOrder.id)
        || db.getActiveOrderForTable(r.table_id);
      if (!order) continue;
      const tblNum = Number(r.table_number || cloudOrder.table_number) || 0;
      try {
        const pushRes = await cloudSync.pushQrWaiterAcceptToCloudKitchen(db, order, {
          cloudOrderId: cloudOrder.id,
          cloudOrder,
          waiterName,
          waiterId: ackMeta.waiterId,
          table_number: tblNum,
          batch_items: Array.isArray(r.batch_items) ? r.batch_items : null,
        });
        if (!pushRes?.ok) {
          console.warn("[accept] push → kuzhinë (QR/online):", pushRes.message || "dështoi");
        }
      } catch (pushErr) {
        console.warn("[accept] push → kuzhinë:", pushErr);
      }
    }
  }

  for (let i = 0; i < ordersBefore.length; i++) {
    const r = imported[i];
    const cloudOrder = ordersBefore[i];
    if (!r?.ok || !r.room_menu || !cloudOrder?.id) continue;
    const roomNum = String(
      r.room_number || db.parseRoomNumberFromCloudOrder(cloudOrder) || "",
    ).trim();
    let slipItems = [];
    try {
      let raw = cloudOrder.items ?? cloudOrder.items_json;
      if (typeof raw === "string") raw = JSON.parse(raw);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        raw = raw.items || raw.nested_items || [];
      }
      if (typeof db.mapCloudItemsToLocal === "function") {
        slipItems = db.mapCloudItemsToLocal(Array.isArray(raw) ? raw : []);
      }
    } catch {
      slipItems = [];
    }
    if (!slipItems.length) continue;
    const tableLabel = roomNum ? `Dh.${roomNum}` : "Dhoma";
    void autoPrintOrderSlip(db, {
      tableNumber: tableLabel,
      waiterName,
      items: slipItems,
      acceptedBy: waiterName,
    });
    const total = slipItems.reduce(
      (s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 1),
      0,
    );
    const synthOrder = {
      id: `guest-room-${cloudOrder.id}`,
      items_json: JSON.stringify(slipItems),
      total,
      waiter_name: waiterName,
      created_at: cloudOrder.created_at || new Date().toISOString(),
      cloud_order_id: cloudOrder.id,
    };
    if (allowCloudOutbound) {
      try {
        await cloudSync.pushQrWaiterAcceptToCloudKitchen(db, synthOrder, {
          cloudOrderId: cloudOrder.id,
          cloudOrder,
          waiterName,
          waiterId: ackMeta.waiterId,
          table_number: 0,
        });
      } catch (pushErr) {
        console.warn("[accept] push QR dhomë → kuzhinë:", pushErr.message || pushErr);
      }
    }
  }

  let freshSnapshot = onlineOrdersWatcher.getOnlineOrdersSnapshot();
  try {
    freshSnapshot = await onlineOrdersWatcher.refreshOnlineOrders(db, null);
  } catch {
    /* mbet snapshot i përditësuar lokalisht */
  }

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
    if (!/^\d{4,6}$/.test(pinTrim)) {
      throw Object.assign(new Error("PIN duhet të jetë 4 ose 6 shifra."), { status: 400 });
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

  const waiterName = String(staff?.name || "").trim();
  for (const id of ids) {
    const found = findCloudOrderForQrGuard(id);
    if (!found) continue;
    const access = db.qrOrderAccessForWaiter(found, waiterName);
    if (!access.allowed) {
      throw Object.assign(
        new Error(`Porosia QR e tavolinës T${access.tableNumber} i përket kamarierit: ${access.owner}`),
        { status: 403 },
      );
    }
  }

  const pendingLocal = db.listPendingCloudOrders().find((o) => String(o?.id) === String(orderId));
  const isLocalGuestOrder = !!(
    pendingLocal?.local_only
    || pendingLocal?.device_id === "WEB-PUBLIC-LOCAL"
    || (typeof db.isGuestHotelServiceOrder === "function" && db.isGuestHotelServiceOrder(pendingLocal))
  );

  const allowCloudOutbound = options.allowCloudOutbound === true;
  let cloudResult = { ok: true, message: "", refused: 1, order_id: orderId, refused_by: staff?.name || "" };
  const ackPin = cloudAckPinFromInput(pinTrim);
  const ackMeta = staffCloudAckMeta(staff);
  if (allowCloudOutbound) {
    try {
      cloudResult = await cloudSync.refuseOnlineOrder(db, orderId, ackPin, refuseReason, ackMeta);
    } catch (e) {
      cloudResult = { ok: false, message: e.message || "", refused: 0, order_id: orderId };
    }

    if (!cloudResult.ok && !isLocalGuestOrder) {
      cloudSync.refuseOnlineOrder(db, orderId, ackPin, refuseReason, ackMeta).catch(() => {});
      throw Object.assign(
        new Error(cloudResult.message || "Nuk u refuzua porosia në cloud — provoni përsëri."),
        { status: 400 },
      );
    }
  }

  if (isLocalGuestOrder || !allowCloudOutbound) {
    onlineOrdersWatcher.persistAcknowledged(db, ids);
    db.removePendingCloudOrders(ids);
    onlineOrdersWatcher.removeOrdersFromSnapshot(ids);
  }

  if (cloudResult.ok) {
    onlineOrdersWatcher.persistStaffRefusal(db, staff.id, orderId);
  }

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

async function cancelPendingOnlineOrdersFlow(orderIds, options = {}) {
  const ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) {
    throw Object.assign(new Error("Zgjidhni porosinë."), { status: 400 });
  }

  ensureOnlineOrdersWatcher();

  onlineOrdersWatcher.persistAcknowledged(db, ids);
  db.removePendingCloudOrders(ids);
  onlineOrdersWatcher.markOrdersPrinted(db, ids);

  const allowCloudOutbound = options.allowCloudOutbound === true;
  let cloudResult = { ok: true, message: "", cancelled: ids.length, order_ids: ids };
  if (allowCloudOutbound) {
    try {
      cloudResult = await cloudSync.cancelOnlineOrders(db, ids);
    } catch (e) {
      cloudResult = { ok: false, message: e.message || "", cancelled: 0, order_ids: [] };
    }

    if (!cloudResult.ok) {
      cloudSync.cancelOnlineOrders(db, ids).catch(() => {});
    }
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

async function ensureCloudTableImportedForCheckout(dbRef, tableNumber, waiterName, session) {
  if (session && !sessionMayTalkToCloud(session)) return null;
  const t = Number(tableNumber);
  if (!t) return null;
  try {
    return await Promise.race([
      cloudSync.ensureCloudTableImported(dbRef, t, waiterName),
      new Promise(resolve => setTimeout(() => resolve(null), 3500)),
    ]);
  } catch {
    return null;
  }
}

/** Cloud pas mbylljes lokale — mos blloko pagesën; lirim tavoline/slot sapo cloud mbyll. */
function scheduleCloudAfterTableClose(db, {
  tableId,
  order,
  table,
  receipt,
  closeItems,
  waiterName,
  mirrorsCloud,
  cloudOrderIds,
  logTag = "close",
  cloudFiscalOpts = {},
  skipCloud = false,
} = {}) {
  if (skipCloud) return;
  void (async () => {
    const ids = [...new Set((cloudOrderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
    try {
      if (mirrorsCloud || ids.length) {
        let closeRes = { closed: 0 };
        try {
          closeRes = await closeCloudLinkedSale(tableId, ids, {
            items: closeItems,
            total: order?.total,
            payment_method: order?.payment_method,
            receipt_number: receipt?.receipt_number,
            waiter_name: waiterName,
            closed_at: receipt?.printed_at || new Date().toISOString(),
            ...cloudFiscalOpts,
          }) || closeRes;
        } finally {
          purgeClosedCloudOrdersFromWatcher(ids);
        }
        if (table?.number && typeof db.isPhysicalVenueTable === "function") {
          const tRow = db.db.prepare("SELECT * FROM tables WHERE id = ?").get(Number(tableId));
          if (tRow && db.isPhysicalVenueTable(tRow)) {
            await cloudSync.pushTableFree(db, table.number);
          }
        }
      } else if (order) {
        const syncRes = await cloudSync.pushSaleSync(db, order, {
          table_number: table?.number || 0,
          receipt_number: receipt?.receipt_number || "",
          closed_at: receipt?.printed_at || new Date().toISOString(),
          status: "closed",
          payment_method: order.payment_method,
          timeoutMs: cloudSync.CLOUD_CLOSE_PUSH_TIMEOUT_MS,
          ...cloudFiscalOpts,
        });
        const st = String(syncRes?.sale_status || "").toLowerCase();
        if (syncRes?.ok && table?.number && (st === "closed" || st === "cancelled")) {
          await cloudSync.pushTableFree(db, table.number);
        }
      }
    } catch (err) {
      console.warn(`[${logTag}] cloud background:`, err.message);
    }
  })();
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
    pending = pending.filter(o => db.qrOrderAccessForWaiter(o, staff?.name).allowed);
    if (!pending.length && seedOrders.length) {
      pending = seedOrders.filter(o =>
        o?.id
        && !db.isCloudOrderHandledLocally(o.id)
        && db.qrOrderAccessForWaiter(o, staff?.name).allowed,
      );
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

function enrichGuestFolioForReceipt(db, folio, { processedBy, paymentMethod } = {}) {
  const name = String(processedBy || folio?.processed_by || "").trim();
  let shift_id = folio?.shift_id ?? null;
  if (name && shift_id == null && typeof db.shiftMetaForWaiter === "function") {
    try {
      shift_id = db.shiftMetaForWaiter(name).shift_id;
    } catch {
      shift_id = null;
    }
  }
  const pm = paymentMethod != null ? paymentMethod : folio?.payment_method;
  const payment_label = pm != null && typeof db.paymentMethodLabel === "function"
    ? db.paymentMethodLabel(pm)
    : (folio?.payment_label || "");
  return {
    ...folio,
    processed_by: name || folio?.processed_by,
    payment_method: pm,
    payment_label,
    shift_id: shift_id ?? folio?.shift_id,
  };
}

/** Print fatura qëndrimi hoteli — termik (bar) ose fiskal. */
async function printGuestFolioReceipt(db, folio, opts = {}) {
  const { normalizeCouponType } = require("./close-table-print");
  const kind = normalizeCouponType(opts.couponType || opts.coupon_type || "thermal");
  const settings = db.getSettings();
  const fiscal = db.getFiscalSettings();
  const hotelName = folio?.hotel_name || settings.business_name || "Hotel";
  const receiptFolio = enrichGuestFolioForReceipt(db, folio, {
    processedBy: opts.processedBy,
    paymentMethod: opts.paymentMethod,
  });
  const html = buildGuestFolioPrintHtml(receiptFolio, fiscal, hotelName);
  const text = buildGuestFolioPrintLines(receiptFolio, fiscal, hotelName).join("\n");

  if (kind === "fiscal") {
    try {
      const printResult = await printer.printReceiptAt(html, db, "fiscal");
      return { printed: true, coupon_type: "fiscal", html, printMessage: "", ...printResult };
    } catch (err) {
      return {
        printed: false,
        coupon_type: "fiscal",
        html,
        printMessage: err.message || "Printimi fiskal dështoi.",
      };
    }
  }

  try {
    const printResult = await printer.printPlainTextAt(text, db, "bar");
    return { printed: true, coupon_type: "thermal", html, printMessage: "", ...printResult };
  } catch (err) {
    return {
      printed: false,
      coupon_type: "thermal",
      html,
      printMessage: err.message || "Printeri termik nuk u gjet.",
    };
  }
}

function syncCatalogToCloud() {
  cloudAutoSync.scheduleCatalogPush(db);
  notifyWaitersRealtime("menu", { reason: "catalog" });
}

function toMenuItemDto(item) {
  const { photo, ...rest } = item;
  const dbPhoto = String(photo || "").trim();
  const stock = String(menuStockPhotos.stockPhotoForName(item.name) || "").trim();
  const hasStored = Boolean(dbPhoto) || Boolean(item.has_photo);
  let p = dbPhoto || stock || "";
  if (
    stock
    && dbPhoto
    && menuStockPhotos.isRemotePhoto(dbPhoto)
    && !menuStockPhotos.isStockPhoto(dbPhoto)
  ) {
    p = stock;
  }
  rest.has_photo = hasStored || Boolean(stock);
  rest.system_photo = Boolean(p) && (!hasStored || menuStockPhotos.isStockPhoto(dbPhoto || p));
  if (p.startsWith("/") || /^https?:\/\//i.test(p)) rest.photo_src = p;
  return rest;
}

function toGuestMenuItemDto(item) {
  const dto = toMenuItemDto(item);
  if (dto.id != null) {
    const stock = String(menuStockPhotos.stockPhotoForName(item.name) || "").trim();
    const resolved = String(resolveMenuItemPhoto(item.id) || "").trim();
    const direct = resolved.startsWith("/") ? resolved : stock;
    if (direct.startsWith("/") || /^https?:\/\//i.test(direct)) {
      dto.photo_src = direct;
      dto.has_photo = true;
    } else if (!dto.photo_src) {
      dto.photo_src = `/api/guest/menu/${dto.id}/photo`;
      dto.has_photo = true;
    }
  }
  return dto;
}

function toGuestServiceDto(service) {
  const s = service && typeof service === "object" ? { ...service } : {};
  const photo = String(s.photo || "").trim();
  if (photo.startsWith("/") || /^https?:\/\//i.test(photo)) {
    s.photo_src = photo;
  }
  if (s.id != null && !s.photo_src) {
    s.photo_src = `/api/guest/services/${s.id}/photo`;
  }
  return s;
}

function resolveMenuItemPhoto(id) {
  const numId = Number(id);
  const item = typeof db.getMenuItemById === "function"
    ? db.getMenuItemById(numId)
    : db.getMenuItems(false).find(i => Number(i.id) === numId);
  if (!item) return "";
  const stock = menuStockPhotos.stockPhotoForName(item.name);
  const stored = String(db.getMenuItemPhoto(numId) || "").trim();
  if (
    stock
    && stored
    && menuStockPhotos.isRemotePhoto(stored)
    && !menuStockPhotos.isStockPhoto(stored)
  ) {
    return stock;
  }
  return stored || stock || "";
}

function resolveServicePhoto(id) {
  const svc = typeof db.getHotelServiceById === "function" ? db.getHotelServiceById(id) : null;
  return String(svc?.photo || "").trim();
}

function sendResolvedPhoto(res, photo) {
  const s = String(photo || "").trim();
  if (!s) return false;
  if (s.startsWith("/")) {
    if (sendMenuPhoto(res, s)) return true;
    return false;
  }
  const dataMatch = s.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataMatch) {
    res.setHeader("Content-Type", dataMatch[1]);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(dataMatch[2], "base64"));
    return true;
  }
  if (/^https?:\/\//i.test(s)) {
    res.redirect(302, s);
    return true;
  }
  return false;
}

function ensureMenuCatalogReady() {
  try {
    if (typeof db.ensureMenuStockPhotos === "function") db.ensureMenuStockPhotos();
  } catch {
    /* ignore */
  }
}

function ensureServicesCatalogReady() {
  try {
    if (typeof db.ensureHotelServiceStockPhotos === "function") db.ensureHotelServiceStockPhotos();
    if (typeof db.ensureHotelServiceCategoryPhotos === "function") db.ensureHotelServiceCategoryPhotos();
  } catch {
    /* ignore */
  }
}

/** Si paneli kamarierit (KATEGORITE / sort_order) — QR, takeaway, guest lokal. */
function categoriesWithMenuItems(categoryNames, menuItems) {
  const present = new Set(
    (menuItems || []).map((m) => String(m.category || "").trim()).filter(Boolean),
  );
  return (categoryNames || []).filter((c) => present.has(String(c).trim()));
}

/** I njëjti katalog si paneli pronarit / kamarierit — menu restoranti. */
function buildMenuCatalogPayload(activeOnly = true) {
  ensureMenuCatalogReady();
  const items = (db.getMenuItems(activeOnly) || []).map(toMenuItemDto);
  const present = new Set(items.map((it) => String(it.category || "").trim()).filter(Boolean));
  const merged = [];
  const seen = new Set();
  for (const row of db.getCategories() || []) {
    const name = String(row?.name ?? row ?? "").trim();
    if (!name || !present.has(name) || seen.has(name)) continue;
    seen.add(name);
    merged.push(name);
  }
  const orphans = [...present].filter((n) => !seen.has(n));
  orphans.sort((a, b) => a.localeCompare(b, "sq"));
  merged.push(...orphans);
  return { items, categories: categoriesWithMenuItems(merged, items) };
}

function buildGuestServicesGroups(catalog) {
  return (catalog.groups || []).map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.icon || "",
    photo: g.photo || "",
    sort_order: g.sort_order,
    services: (g.services || []).map(toGuestServiceDto),
  }));
}

function mapGuestMenuPhoto(req, res) {
  const photo = resolveMenuItemPhoto(req.params.id);
  if (sendResolvedPhoto(res, photo)) return;
  res.status(404).end();
}

function mapGuestServicePhoto(req, res) {
  const photo = resolveServicePhoto(req.params.id);
  if (sendResolvedPhoto(res, photo)) return;
  res.status(404).end();
}

function sendMenuPhoto(res, photoPath) {
  const filePath = joinContent("public", photoPath.replace(/^\//, ""));
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

function terminalRegisterNumber() {
  const eapp = electronApp();
  const raw = eapp ? license.readTerminalRole(eapp) : "";
  const m = /^arka(\d+)$/.exec(String(raw || "").trim().toLowerCase());
  return m ? Number(m[1]) : 0;
}

function isFullPackageTier(tier) {
  const { normalizeHotelTier } = require("./package-tier-map");
  return normalizeHotelTier(tier) === "pako_3";
}

function normalizeStaffName(name) {
  return String(name || "").trim().toLowerCase().normalize("NFC");
}

/** Linket e stafit — të 3 pakot HOTEL. */
function canShowKdsStaffLinks() {
  const t = String(VERSION.packageTier || "").trim();
  return t === "pako_1" || t === "pako_2" || t === "pako_3";
}

function isCloudWaiterDisabledSetting() {
  return false;
}

function cloudStaffListKey(name, staffRole) {
  const role = db.normalizeStaffRole(staffRole || "kamarier");
  const cloudRole = role === "recepsion" ? "receptionist" : "waiter";
  return `${normalizeStaffName(name)}:${cloudRole}`;
}

function resolveStaffWaiterUrl(cloudRow, staffRow) {
  if (isCloudWaiterDisabledSetting()) return "";
  const links = buildHotelStaffLinks(db);
  if (!staffRow || staffRow.id == null) {
    const role = db.normalizeStaffRole(staffRow?.staff_role || "kamarier");
    return role === "recepsion" ? links.reception_url : links.waiter_url;
  }
  const localRole = db.normalizeStaffRole(staffRow.staff_role || "kamarier");
  const fromCloud = String(
    cloudRow?.waiter_url || cloudRow?.reception_url || "",
  ).trim();
  if (fromCloud && cloudRow) {
    const cloudRole = String(cloudRow.role || "waiter").toLowerCase();
    const localIsRecep = localRole === "recepsion";
    const cloudIsRecep = cloudRole === "receptionist";
    if (localIsRecep === cloudIsRecep) return fromCloud;
  }
  const token = db.ensureStaffWebToken(staffRow.id);
  const { slug, key } = resolveHotelVenueAccess(db);
  const personal = buildStaffPersonalUrl(slug, key, token, localRole);
  if (personal) return personal;
  return localRole === "recepsion" ? links.reception_url : links.waiter_url;
}

function lanInterfaceKind(ifName) {
  const n = String(ifName || "").toLowerCase();
  if (/wi-?fi|wireless|wlan|wifi/.test(n)) return "wifi";
  if (/ethernet|local area connection|\beth\b/.test(n)) return "ethernet";
  return "other";
}

function pickLanIPv4Address() {
  const candidates = [];
  for (const [ifName, addrs] of Object.entries(os.networkInterfaces())) {
    for (const net of addrs || []) {
      if (net.family !== "IPv4" || net.internal) continue;
      const ip = String(net.address || "").trim();
      if (!ip || ip.startsWith("169.254.")) continue;
      candidates.push({ ip, kind: lanInterfaceKind(ifName) });
    }
  }
  const wifi = candidates.find((c) => c.kind === "wifi");
  if (wifi) return wifi.ip;
  const ethernet = candidates.find((c) => c.kind === "ethernet");
  if (ethernet) return ethernet.ip;
  return candidates[0]?.ip || null;
}

/** Të gjitha IPv4 LAN (jo loopback / link-local) — për /api/server-info. */
function listLanIPv4Addresses() {
  const ips = [];
  const seen = new Set();
  for (const [, addrs] of Object.entries(os.networkInterfaces())) {
    for (const net of addrs || []) {
      if (net.family !== "IPv4" || net.internal) continue;
      const ip = String(net.address || "").trim();
      if (!ip || ip.startsWith("169.254.")) continue;
      if (seen.has(ip)) continue;
      seen.add(ip);
      ips.push(ip);
    }
  }
  return ips;
}

function buildServerInfoPayload() {
  const port = getLocalServerPort();
  const ips = listLanIPv4Addresses();
  const primary = pickLanIPv4Address() || ips[0] || "";
  const base = primary ? `http://${primary}:${port}`.replace(/\/+$/, "") : "";
  const link = (path) => (base ? `${base}${path}` : "");
  const lan = buildLocalWaiterLanLinkPayload();
  const venue = resolveLocalVenueSegments();
  const slug = String(venue.slug || "").trim();
  const mdnsServiceName = slug
    ? `Revolution-HOTEL-${slug}`.slice(0, 63)
    : "Revolution-HOTEL";
  const pcHost = sanitizeLanHostname(os.hostname());
  const hostnames = ["revolution-hotel.local"];
  if (pcHost) hostnames.push(`${pcHost}.local`);
  const kamarierUrl = lan.local_waiter_url || link("/waiter");
  const recepsionUrl = lan.local_recepsion_url || link("/recepcion");
  return {
    ok: true,
    ips,
    port,
    primary_ip: primary,
    local_lan_ip: primary,
    local_server_port: port,
    mdns: {
      service_type: "_http._tcp",
      service_name: mdnsServiceName,
      hostname: "revolution-hotel.local",
    },
    discovery: {
      port,
      slug,
      tipi: venue.tipi,
      hostnames,
    },
    links: {
      login: link("/login.html?mode=kamarier"),
      waiter: kamarierUrl,
      kamarier: kamarierUrl,
      recepcion: recepsionUrl,
      sherbimi: lan.local_sherbimi_url || "",
    },
    ...lan,
  };
}

function getLocalServerPort() {
  return Number(process.env.ACTUAL_PORT || process.env.PORT || 3001) || 3001;
}

function getLocalLanBaseUrl() {
  const port = getLocalServerPort();
  const ip = pickLanIPv4Address();
  return ip ? `http://${ip}:${port}`.replace(/\/+$/, "") : null;
}

function sanitizeLanHostname(name) {
  return String(name || "")
    .trim()
    .replace(/[^\w.-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/** URL hyrje kamarier pa IP — NetBIOS / mDNS (telefoni duhet në të njëjtin WiFi). */
function getLocalWaiterHostnamePanelUrls() {
  const port = getLocalServerPort();
  const staffSuffix = localStaffPathSuffix("kamarier");
  const suffix = staffSuffix || "/login.html?mode=kamarier";
  const out = [];
  const pc = sanitizeLanHostname(os.hostname());
  if (pc) {
    out.push({
      id: "pc-name",
      label: `Emri i PC-së (${pc})`,
      url: `http://${pc}:${port}${suffix}`,
    });
  }
  out.push({
    id: "revolution-hotel-local",
    label: "revolution-hotel.local",
    url: `http://revolution-hotel.local:${port}${suffix}`,
  });
  return out;
}

function buildLocalWaiterLanLinkPayload() {
  return {
    /** Hyrje stafi WiFi — PIN kamarier/recepsion (jo pronari / login.html). */
    local_waiter_url: getLocalWaiterUrl(),
    local_recepsion_url: getLocalRecepsionUrl(),
    local_sherbimi_url: getLocalSherbimiUrl(),
    local_waiter_panel_url: getLocalWaiterPanelUrl(),
    local_lan_ip: pickLanIPv4Address() || "",
    local_server_port: getLocalServerPort(),
    local_waiter_hostname_urls: getLocalWaiterHostnamePanelUrls(),
  };
}

function getLocalServerBaseUrl() {
  return getLocalLanBaseUrl() || `http://127.0.0.1:${process.env.ACTUAL_PORT || process.env.PORT || 3001}`;
}

function getLocalAdminUrl() {
  return `${getLocalServerBaseUrl()}/admin.html`;
}

function resolveLocalVenueSegments() {
  const settings = db.getCloudSettings();
  const rawTipi =
    db.getSetting("cloud_business_type", "")
    || settings.client_tipi
    || db.getSetting("client_tipi", "")
    || "hotel";
  const tipi = urlTipiSegment(rawTipi);
  let slug = String(
    db.getSetting("cloud_slug", "")
    || settings.kitchen_slug
    || settings.cloud_client_id
    || resolveHotelVenueAccess(db).slug
    || "",
  )
    .trim()
    .toLowerCase();
  slug = stripLegacyKitchenSlugSuffix(slug) || slug;
  return { tipi, slug, rawTipi };
}

function normalizeVenuePathSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

function localStaffPathSuffix(role, code) {
  const { tipi, slug } = resolveLocalVenueSegments();
  if (!slug) return null;
  const r = String(role || "kamarier").trim().toLowerCase();
  const seg =
    r === "recepsion" ? "recepsion"
      : r === "sherbimi" || r === "pastrim" || r === "housekeeping" ? "sherbimi"
        : r === "kuzhina" || r === "kitchen" ? "kuzhina"
          : r === "banaku" || r === "bar" ? "banaku"
            : "kamarier";
  let path = `/${tipi}/${slug}/${seg}`;
  const c = String(code ?? "").trim();
  if (c && /^\d{3}$/.test(c)) path += `/${c}`;
  return path;
}

function getLocalWaiterUrl() {
  const base = getLocalLanBaseUrl();
  const suffix = localStaffPathSuffix("kamarier");
  if (!base || !suffix) return null;
  return `${base}${suffix}`;
}

/** Panel kamarier LAN — hyrje me PIN (pas login.html ose direkt nëse sesioni ekziston). */
function getLocalWaiterPanelUrl() {
  const base = getLocalLanBaseUrl() || getLocalServerBaseUrl();
  if (!base) return null;
  return `${String(base).replace(/\/+$/, "")}/waiter.html`;
}

function getLocalRecepsionUrl() {
  const base = getLocalLanBaseUrl();
  const suffix = localStaffPathSuffix("recepsion");
  if (!base || !suffix) return null;
  return `${base}${suffix}`;
}

function getLocalSherbimiUrl() {
  const base = getLocalLanBaseUrl();
  const suffix = localStaffPathSuffix("sherbimi");
  if (!base || !suffix) return null;
  return `${base}${suffix}`;
}

function buildLocalStaffCodeUrl(role, code) {
  const base = getLocalLanBaseUrl();
  const suffix = localStaffPathSuffix(role, code);
  if (!base || !suffix) return null;
  return `${base}${suffix}`;
}

function isLocalStaffEntryPath(pathname) {
  const p = String(pathname || "").toLowerCase().replace(/\/+$/, "");
  return /^\/[a-z0-9-]+\/[a-z0-9-]+\/(kamarier|recepsion|sherbimi|kuzhina|banaku)(?:\/\d{3})?$/.test(p);
}

/** Statikë + API minimale për faqen e hyrjes stafi në WiFi (telefon). */
function isLocalStaffLoginAsset(pathname) {
  const p = String(pathname || "").toLowerCase();
  if (p.startsWith("/css/") || p.startsWith("/js/") || p.startsWith("/img/") || p.startsWith("/icons/")) {
    return true;
  }
  if (
    p === "/manifest.json"
    || p === "/manifest-kamarier.json"
    || p === "/manifest-recepsion.json"
    || p === "/manifest-sherbimi.json"
    || p === "/manifest-kuzhina.json"
    || p === "/manifest-banaku.json"
    || p === "/sw.js"
    || p === "/sw-staff.js"
    || p === "/icon-192.png"
    || p === "/login.html"
    || p === "/waiter.html"
    || p === "/recepcion.html"
    || p === "/sherbimi.html"
    || p === "/kitchen.html"
    || p === "/bar.html"
    || p === "/kasa-recepcion.html"
    || p.startsWith("/api/sherbimi/")
    || p.startsWith("/api/kds/")
    || p === "/api/local-events"
    || p === "/login"
    || p === "/waiter"
    || p === "/recepcion"
  ) {
    return true;
  }
  if (p === "/api/venue-logo" || p === "/api/locale" || p === "/api/setup/status") return true;
  if (p === "/api/login/staff-wifi-links" || p === "/api/server-info") return true;
  if (p.startsWith("/api/login/") || p.startsWith("/api/cloud/")) return true;
  return false;
}

function renderWaiterCodeErrorPage(message) {
  const text = String(message || "Kodi nuk ekziston.").replace(/</g, "&lt;");
  return `<!DOCTYPE html><html lang="sq"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kodi i pavlefshëm</title><style>body{font-family:system-ui,sans-serif;background:#0b1526;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1.5rem;text-align:center}p{max-width:22rem;line-height:1.5;color:rgba(255,255,255,.85)}</style></head><body><p>${text}</p></body></html>`;
}

const LOGIN_HTML_PATH = joinContent("public", "login.html");

const STAFF_PWA_MANIFEST_FILES = {
  kamarier: joinContent("public", "manifest-kamarier.json"),
  recepsion: joinContent("public", "manifest-recepsion.json"),
  sherbimi: joinContent("public", "manifest-sherbimi.json"),
  kuzhina: joinContent("public", "manifest-kuzhina.json"),
  banaku: joinContent("public", "manifest-banaku.json"),
};

function staffPwaStartPath(roleKey) {
  const { tipi, slug } = resolveLocalVenueSegments();
  const role = String(roleKey || "kamarier").trim().toLowerCase();
  if (!slug) return null;
  const tip = normalizeVenuePathSegment(tipi) || "hotel";
  const sl = normalizeVenuePathSegment(slug);
  if (!sl) return null;
  return `/${tip}/${sl}/${role}`;
}

function sendStaffRoleManifest(res, roleKey) {
  const filePath = STAFF_PWA_MANIFEST_FILES[roleKey];
  if (!filePath) return res.status(404).end();
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return res.status(404).end();
  }
  const startPath = staffPwaStartPath(roleKey);
  if (startPath) {
    manifest.start_url = startPath;
    const scopeBase = startPath.replace(/\/[^/]+\/?$/, "/");
    manifest.scope = scopeBase;
    manifest.id = startPath;
  }
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.type("application/manifest+json").send(JSON.stringify(manifest));
}

function stripGenericPwaFromLoginHtml(html) {
  return String(html || "")
    .replace(/<link rel="manifest"[^>]*>\s*/gi, "")
    .replace(/<meta name="theme-color"[^>]*>\s*/gi, "")
    .replace(/<meta name="apple-mobile-web-app-capable"[^>]*>\s*/gi, "")
    .replace(/<meta name="apple-mobile-web-app-status-bar-style"[^>]*>\s*/gi, "")
    .replace(/<link rel="apple-touch-icon"[^>]*>\s*/gi, "")
    .replace(/<script src="\/js\/pwa-staff-register.js"[^>]*><\/script>\s*/gi, "")
    .replace(
      /<meta name="viewport"[^>]*>/i,
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
    );
}

function buildStaffPwaHeadHtml(manifestRole) {
  const role = manifestRole === "recepsion"
    ? "recepsion"
    : manifestRole === "sherbimi"
      ? "sherbimi"
      : manifestRole === "kuzhina"
        ? "kuzhina"
        : manifestRole === "banaku"
          ? "banaku"
          : "kamarier";
  return [
    `<link rel="manifest" href="/manifest-${role}.json">`,
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta name="theme-color" content="#0f172a">',
    '<link rel="apple-touch-icon" href="/icon-192.png">',
    '<script src="/js/pwa-staff-register.js" defer></script>',
  ].join("\n");
}

function adminHtmlPathForRequest() {
  const fp = resolvePublicFile("admin.html");
  if (fp && fs.existsSync(fp)) return fp;
  return joinContent("public", "admin.html");
}

function serveStaffLoginPage(res, mode, entry = {}) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  let html;
  try {
    html = fs.readFileSync(LOGIN_HTML_PATH, "utf8");
  } catch {
    return res.status(500).send("login.html mungon.");
  }
  html = stripGenericPwaFromLoginHtml(html);
  const loginMode = mode === "recepsion"
    ? "recepsion"
    : mode === "sherbimi" || mode === "pastrim"
      ? "pastrim"
      : mode === "kuzhina" || mode === "kitchen"
        ? "kuzhina"
        : mode === "banaku" || mode === "bar"
          ? "banaku"
          : "kamarier";
  const manifestRole = loginMode === "recepsion"
    ? "recepsion"
    : loginMode === "pastrim"
      ? "sherbimi"
      : loginMode === "kuzhina"
        ? "kuzhina"
        : loginMode === "banaku"
          ? "banaku"
          : "kamarier";
  const payload = {
    mode: loginMode,
    waiter_code: entry.waiter_code != null ? String(entry.waiter_code) : "",
    staff_id: entry.staff_id != null ? String(entry.staff_id) : "",
    waiter_hint: entry.waiter_hint != null ? String(entry.waiter_hint) : "",
  };
  const staffUiClass = loginMode === "recepsion" || loginMode === "pastrim"
    ? "login-mode-staff-recepsion"
    : "login-mode-staff-kamarier";
  let staffCssInline = "";
  try {
    staffCssInline = fs.readFileSync(joinContent("public", "css", "login-staff-wifi.css"), "utf8");
  } catch {
    /* fallback: link /css/login-staff-wifi.css */
  }
  const headInject = [
    buildStaffPwaHeadHtml(manifestRole),
    `<script>window.__STAFF_WIFI_ENTRY__=${JSON.stringify(payload)};(function(){document.documentElement.classList.add("login-mode-staff","${staffUiClass}");})();</script>`,
    '<style>html,body{background:#0f172a}</style>',
    staffCssInline ? `<style id="hotel-staff-login-critical">${staffCssInline}</style>` : "",
  ].filter(Boolean).join("\n");
  html = html.replace("</head>", `${headInject}\n</head>`);
  html = html.replace(
    '<body class="staff-login-screen">',
    '<body class="staff-login-screen staff-wifi-lan">',
  );
  const marker = '<script src="/js/i18n-client.js"></script>';
  if (!html.includes("window.__STAFF_WIFI_ENTRY__")) {
    const inject = `<script>window.__STAFF_WIFI_ENTRY__=${JSON.stringify(payload)};</script>\n`;
    html = html.includes(marker) ? html.replace(marker, `${marker}\n${inject}`) : inject + html;
  }
  res.type("html").send(html);
}

function resolveHotelVenueAccess(db) {
  const settings = db.getCloudSettings();
  const licenseMod = require("./license");
  const deviceId = String(settings.device_id || licenseMod.getMachineId() || "").trim();
  const bizName = (
    db.getBusinessName?.()
    || db.getSettings?.()?.restaurant_name
    || db.getSetting?.("restaurant_name", "")
    || "hotel"
  );
  const hasLicense = String(settings.cloud_license_key || "").trim();
  let slug = String(settings.kitchen_slug || "").trim();
  if (!slug && !hasLicense) {
    slug = buildHotelVenueSlug(bizName, deviceId);
  }
  slug = stripLegacyKitchenSlugSuffix(slug) || slug;
  const key = String(settings.kitchen_key || "").trim();
  return { slug, key, deviceId, bizName: String(bizName || "").trim() };
}

/** Linke publike — format restoranti (/menu/{slug}/1, /waiter/{slug}?key=…). */
function buildHotelStaffLinks(db) {
  const venue = resolveHotelVenueAccess(db);
  const origin = getPublicCloudServerUrl(venue.slug) || PUBLIC_HOTEL_ORIGIN;
  return buildCloudAccessLinks(origin, {
    kitchen_slug: venue.slug,
    kitchen_key: venue.key,
    client_id: venue.slug,
  }, venue.key);
}

function resolveStaffLinksPayload(db) {
  const venue = resolveHotelVenueAccess(db);
  const links = buildHotelStaffLinks(db);
  return {
    local_base_url: getLocalServerBaseUrl(),
    server_url: getPublicCloudServerUrl(venue.slug) || PUBLIC_HOTEL_ORIGIN,
    hotel_slug: venue.slug,
    hotel_name: venue.bizName,
    waiter_url: links.waiter_url,
    kitchen_url: links.kitchen_url,
    bar_url: links.bar_url,
    kiosk_url: links.kiosk_url,
    public_page_url: links.public_page_url,
    housekeeping_url: links.housekeeping_url,
    reception_url: links.reception_url,
    cloud_waiter_url: links.waiter_url,
    cloud_kitchen_url: links.kitchen_url,
    cloud_bar_url: links.bar_url,
    links_ready: !!(venue.slug && venue.key),
    local_mode: false,
    staff_links_use_cloud_only: true,
  };
}

function cloudSyncLinksPayload(settings, status) {
  const health = require("./cloud-health").getHealthStatus();
  const rawSlug =
    status.kitchen_slug || settings.kitchen_slug || status.client_id || settings.cloud_client_id || "";
  const slug = stripLegacyKitchenSlugSuffix(String(rawSlug || "").trim()) || String(rawSlug || "").trim();
  const key = status.kitchen_key || settings.kitchen_key || "";
  const serverUrl = getPublicCloudServerUrl(slug) || PUBLIC_HOTEL_ORIGIN;
  const built = buildCloudAccessLinks(serverUrl, { kitchen_slug: slug, kitchen_key: key, client_id: slug }, key);
  const cloudDisabled = isCloudWaiterDisabledSetting();
  // HOTEL: mos përdor URL nga licenca (/kafene/) — vetëm /hotel/{slug}/…
  const waiter_url = cloudDisabled ? "" : (built.waiter_url || "");
  const reception_url = cloudDisabled ? "" : (built.reception_url || "");
  const bar_url = built.bar_url || "";
  const kitchen_url = built.kitchen_url || "";
  const kiosk_url = built.kiosk_url || "";
  const public_page_url = built.public_page_url || "";
  const takeaway_url = built.takeaway_url || built.public_order || "";
  const owner_panel_url = built.owner_panel_url || built.owner_url || "";
  const venue = resolveLocalVenueSegments();
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
    kitchen_slug: String(slug || "").trim(),
    kitchen_key: String(key || "").trim(),
    client_tipi: "hotel",
    local_base_url: getLocalServerBaseUrl(),
    links_ready: !!(
      waiter_url
      || bar_url
      || kitchen_url
      || kiosk_url
      || public_page_url
      || owner_panel_url
      || getLocalWaiterUrl()
    ),
    waiter_url,
    reception_url,
    bar_url,
    kitchen_url,
    kiosk_url,
    public_page_url,
    takeaway_url,
    public_order_url: takeaway_url,
    owner_url: owner_panel_url,
    owner_panel_url,
    cloud_waiter_disabled: cloudDisabled,
    local_waiter_url: getLocalWaiterUrl(),
    ...buildLocalWaiterLanLinkPayload(),
    local_recepsion_url: getLocalRecepsionUrl(),
    local_waiter_tipi: venue.tipi,
    local_waiter_slug: venue.slug,
    local_staff_wifi: {
      kamarier: getLocalWaiterUrl() || "",
      recepsion: getLocalRecepsionUrl() || "",
      sherbimi: getLocalSherbimiUrl() || "",
    },
    local_sherbimi_url: getLocalSherbimiUrl() || "",
    housekeeping_url: built.housekeeping_url || built.sherbimi_url || "",
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

/** Recepsion / kamarier / pronari — Check-in / Check-out dhomash. */
/** Pas pagesës cash — hap arkën (termik ESC/POS); mos blloko përgjigjen HTTP. */
function scheduleCashDrawerKick(ctx) {
  if (!paymentIncludesCash(ctx)) return;
  setImmediate(() => {
    openCashDrawer(db).catch(() => {});
  });
}

function staffOrAdmin(req, res, next) {
  const role = req.session?.role;
  if (role !== "kamarier" && role !== "recepsion" && role !== "admin") {
    return res.status(403).json({ gabim: "Nuk keni akses." });
  }
  next();
}

/** SSE lokal — çdo rol stafi (kamarier, recepsion, kuzhinë, banak, pastrim, admin). */
function anyStaffSessionAuth(req, res, next) {
  const role = String(req.session?.role || "").trim().toLowerCase();
  const ok = [
    "kamarier",
    "recepsion",
    "admin",
    "kuzhina",
    "banaku",
    "pastrim",
    "sherbimi",
    "housekeeping",
  ].includes(role);
  if (!ok) {
    return res.status(403).json({ gabim: "Nuk keni akses." });
  }
  next();
}

/** Ndërrimi stafi — kamarier ose recepsion (i njëjti staff_id / daily_log). */
function waiterOrRecepsion(req, res, next) {
  const role = req.session?.role;
  if (role !== "kamarier" && role !== "recepsion") {
    return res.status(403).json({ gabim: "Nuk keni akses." });
  }
  next();
}

function normalizePinLoginMode(raw) {
  const r = String(raw || "kamarier").trim().toLowerCase();
  if (r === "recepsion") return "recepsion";
  if (r === "sherbimi" || r === "pastrim" || r === "pastrimi" || r === "housekeeping") return "pastrim";
  if (r === "kuzhina" || r === "kitchen" || r === "kuzhine") return "kuzhina";
  if (r === "banaku" || r === "bar" || r === "banak") return "banaku";
  return "kamarier";
}

function sessionRoleFromLoginMode(loginMode) {
  if (loginMode === "recepsion") return "recepsion";
  if (loginMode === "pastrim") return "pastrim";
  if (loginMode === "kuzhina") return "kuzhina";
  if (loginMode === "banaku") return "banaku";
  return "kamarier";
}

function staffPinAllowedForLoginMode(staff, loginMode) {
  const raw = String(staff?.staff_role || "kamarier").trim().toLowerCase();
  if (loginMode === "kuzhina") {
    return (
      raw === "kitchen"
      || raw === "kuzhina"
      || raw === "kuzhine"
      || raw === "kamarier"
      || raw === "waiter"
    );
  }
  if (loginMode === "banaku") {
    return (
      raw === "bar"
      || raw === "banak"
      || raw === "banaku"
      || raw === "kamarier"
      || raw === "waiter"
    );
  }
  return db.normalizeStaffRole(staff.staff_role) === loginMode;
}

/** Pastrim / shërbimi — vetëm rol pastrim ose admin. */
function sherbimiStaffAuth(req, res, next) {
  const role = String(req.session?.role || "").trim().toLowerCase();
  if (role === "admin" || role === "pastrim" || role === "sherbimi" || role === "housekeeping") {
    return next();
  }
  return res.status(403).json({ gabim: "Vetëm stafi i pastrimit ka akses." });
}

/** Kuzhinë / banak — sesion PIN stafi (WiFi POS). */
function kdsPanelStaffAuth(req, res, next) {
  const role = String(req.session?.role || "").trim().toLowerCase();
  if (role === "admin" || role === "kuzhina" || role === "banaku") return next();
  return res.status(403).json({ gabim: "Vetëm kuzhina/banaku ka akses." });
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

function fiscalSettingsAuditOperator(req) {
  return {
    operator_name: req.body?.operator_name || req.session?.emri || "Admin",
    operator_id: String(req.body?.operator_id || req.session?.userId || req.session?.id || "ADMIN"),
  };
}

/** Audit setting_changed pas ndryshimeve fiskale (Neni 26) — parity BIZNES. */
function auditFiscalSettingsIfChanged(req, beforeSnap, source) {
  try {
    const op = fiscalSettingsAuditOperator(req);
    fiscalAudit.logFiscalSettingsChanged({
      before: beforeSnap,
      after: fiscalAudit.snapshotFiscalSettingsState(db),
      operator_name: op.operator_name,
      operator_id: op.operator_id,
      source: source || "api",
    });
  } catch (e) {
    console.warn("[fiscal-audit] setting_changed:", e.message || e);
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

/** Bllokon mutacione kur DB nuk dekriptohet ose disku është plot — parity BIZNES. */
function recordsGuardResponse(res) {
  if (global.DB_DECRYPT_FAILED) {
    return res.status(503).json({
      ok: false,
      db_decrypt_failed: true,
      error: "Databaza nuk lexohet — duhet rikthyer nga backup-i",
      gabim: "Databaza nuk lexohet — duhet rikthyer nga backup-i",
    });
  }
  return diskGuardResponse(res);
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

/** Arka 2+ — vetëm Kryesorja ndryshon menu, stok, punonjës, blerje, dhoma, shërbime, terminalet. */
const MASTER_ONLY_WRITE_PATHS = [
  /^\/api\/categories(\/|$)/,
  /^\/api\/menu(\/|$)/,
  /^\/api\/stock(\/|$)/,
  /^\/api\/staff(\/|$)/,
  /^\/api\/purchases(\/|$)/,
  /^\/api\/services(\/|$)/,
  /^\/api\/rooms(\/|$)/,
  /^\/api\/admin\/generate-pair-code$/,
  /^\/api\/admin\/terminals(\/|$)/,
  /^\/api\/admin\/service-categories(\/|$)/,
  /^\/api\/admin\/services(\/|$)/,
  /^\/api\/admin\/rooms(\/|$)/,
];
const MASTER_ONLY_WRITE_EXCEPT = [
  /^\/api\/menu\/print$/,
  /^\/api\/staff\/verify-pin$/,
  /^\/api\/purchases\/check-duplicate$/,
  /^\/api\/admin\/rooms\/[^/]+\/(check-in|check-out|clean|print-folio|checkout-preview)$/,
  /^\/api\/rooms\/[^/]+\/(check-in|check-out|clean|print-folio|checkout-preview)$/,
];

function isMasterOnlyWrite(method, reqPath) {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  const p = String(reqPath || "");
  if (MASTER_ONLY_WRITE_EXCEPT.some((re) => re.test(p))) return false;
  return MASTER_ONLY_WRITE_PATHS.some((re) => re.test(p));
}

function masterOnlyWriteGabim(reg, reqPath) {
  const p = String(reqPath || "");
  if (/^\/api\/admin\/(generate-pair-code|terminals)/.test(p)) {
    return `Arka ${reg} — arkat lidhen dhe hiqen vetëm nga paneli i Kryesores.`;
  }
  if (/^\/api\/(categories|menu)/.test(p)) {
    return `Vetëm Kryesorja mund të ndryshojë menunë. (Arka ${reg} — vetëm lexim.)`;
  }
  if (/^\/api\/stock/.test(p)) {
    return `Vetëm Kryesorja mund të ndryshojë stokun. (Arka ${reg} — vetëm lexim.)`;
  }
  if (/^\/api\/staff/.test(p)) {
    return `Vetëm Kryesorja mund të ndryshojë punonjësit. (Arka ${reg} — vetëm lexim.)`;
  }
  if (/^\/api\/purchases/.test(p)) {
    return `Vetëm Kryesorja mund të ndryshojë blerjet. (Arka ${reg} — vetëm lexim.)`;
  }
  if (/^\/api\/(services|admin\/service-categories|admin\/services)/.test(p)) {
    return `Vetëm Kryesorja mund të ndryshojë shërbimet. (Arka ${reg} — vetëm lexim.)`;
  }
  if (/^\/api\/(rooms|admin\/rooms)/.test(p)) {
    return `Vetëm Kryesorja mund të ndryshojë dhomat. (Arka ${reg} — vetëm lexim.)`;
  }
  return `Vetëm Kryesorja mund të ndryshojë këto të dhëna. (Arka ${reg} — vetëm lexim.)`;
}

app.use(express.json({ limit: "12mb" }));
app.use((req, res, next) => {
  if (!isMasterOnlyWrite(req.method, req.path)) return next();
  let reg = 0;
  try {
    reg = terminalRegisterNumber();
  } catch {
    reg = 0;
  }
  if (reg < 2) return next();
  return res.status(403).json({
    gabim: masterOnlyWriteGabim(reg, req.path),
    master_only: true,
  });
});
app.use((req, res, next) => {
  const m = req.method || "GET";
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  const p = String(req.path || "");
  if (
    !/^\/api\/(categories|menu|stock|staff|services|admin\/service-categories|admin\/services)(\/|$)/.test(
      p,
    )
  ) {
    return next();
  }
  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    try {
      if (terminalRegisterNumber() < 2) markMasterCatalogDirty();
    } catch {
      /* ignore */
    }
  });
  next();
});
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

function isLocalElectronHost(req) {
  const host = String(req.hostname || "").toLowerCase().replace(/:\d+$/, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** WiFi LAN: vetëm hyrje kamarier/recepsion + statikë/login — Electron (127.0.0.1) pa kufizime. */
app.use((req, res, next) => {
  if (isLocalElectronHost(req)) return next();
  const pathLower = String(req.path || "").toLowerCase();
  if (isLocalStaffEntryPath(pathLower)) return next();
  if (isLocalStaffLoginAsset(pathLower)) return next();
  if (pathLower === "/login") {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    return res.redirect(302, `/login.html${qs || "?mode=kamarier"}`);
  }
  if (pathLower === "/waiter") {
    const suffix = localStaffPathSuffix("kamarier");
    if (suffix) return res.redirect(302, suffix);
    return res.redirect(302, "/login.html?mode=kamarier");
  }
  if (pathLower === "/recepcion") {
    const suffix = localStaffPathSuffix("recepsion");
    if (suffix) return res.redirect(302, suffix);
    return res.redirect(302, "/login.html?mode=recepsion");
  }
  if (pathLower === "/login.html") {
    const mode = String(req.query.mode || "").toLowerCase();
    if (mode === "kamarier" || mode === "recepsion") return next();
    const suffix = localStaffPathSuffix("kamarier");
    if (suffix) return res.redirect(302, suffix);
    return res.redirect(302, "/login.html?mode=kamarier");
  }
  if (
    pathLower === "/admin.html"
    || pathLower === "/setup.html"
    || pathLower.startsWith("/api/admin")
    || pathLower.startsWith("/api/setup")
  ) {
    const suffix = localStaffPathSuffix("kamarier") || localStaffPathSuffix("recepsion");
    if (suffix) return res.redirect(302, suffix);
    return res.redirect(302, "/login.html?mode=kamarier");
  }
  if (pathLower === "/" || pathLower === "") {
    const suffix = localStaffPathSuffix("kamarier") || localStaffPathSuffix("recepsion");
    if (suffix) return res.redirect(302, suffix);
    return res.redirect(302, "/login.html?mode=kamarier");
  }
  next();
});

function handleStaffWifiEntry(req, res, mode) {
  if (!db.isSetupDone()) {
    return res.status(503).send("Konfigurimi nuk është përfunduar.");
  }
  const expected = resolveLocalVenueSegments();
  const reqTipi = normalizeVenuePathSegment(req.params.tipi);
  const reqSlug = normalizeVenuePathSegment(req.params.slug);
  const expTipi = normalizeVenuePathSegment(expected.tipi);
  const expSlug = normalizeVenuePathSegment(expected.slug);
  if (!expSlug || reqTipi !== expTipi || reqSlug !== expSlug) {
    return res.status(404).send("404 — lokali nuk u gjet.");
  }
  const kodRaw = req.params.kod != null ? String(req.params.kod).trim() : "";
  const codeRole = mode === "sherbimi"
    ? "pastrim"
    : (mode === "kuzhina" || mode === "banaku" ? "kamarier" : mode);
  if (kodRaw) {
    if (!/^\d{3}$/.test(kodRaw)) {
      return res.status(404).type("html").send(renderWaiterCodeErrorPage("Kodi nuk ekziston."));
    }
    const row = db.findActiveWaiterCode(kodRaw, codeRole);
    if (!row) {
      return res.status(404).type("html").send(renderWaiterCodeErrorPage("Kodi nuk ekziston."));
    }
    return serveStaffLoginPage(res, mode === "sherbimi" ? "sherbimi" : mode, {
      waiter_code: kodRaw,
      staff_id: row.waiter_id,
      waiter_hint: row.waiter_name || "",
    });
  }
  return serveStaffLoginPage(res, mode === "sherbimi" ? "sherbimi" : mode, {});
}

app.get("/:tipi/:slug/kamarier/:kod?", (req, res) => handleStaffWifiEntry(req, res, "kamarier"));
app.get("/:tipi/:slug/recepsion/:kod?", (req, res) => handleStaffWifiEntry(req, res, "recepsion"));
app.get("/:tipi/:slug/sherbimi/:kod?", (req, res) => handleStaffWifiEntry(req, res, "sherbimi"));
app.get("/:tipi/:slug/kuzhina/:kod?", (req, res) => handleStaffWifiEntry(req, res, "kuzhina"));
app.get("/:tipi/:slug/banaku/:kod?", (req, res) => handleStaffWifiEntry(req, res, "banaku"));

app.get("/manifest-kuzhina.json", (_req, res) => sendStaffRoleManifest(res, "kuzhina"));
app.get("/manifest-banaku.json", (_req, res) => sendStaffRoleManifest(res, "banaku"));

app.get("/api/kds/events", auth, kdsPanelStaffAuth, (req, res) => {
  localKdsEvents.subscribe(res);
});

app.get("/api/local-events", auth, anyStaffSessionAuth, (req, res) => {
  localEventsHub.subscribe(res);
});

app.get("/api/kds/orders", auth, kdsPanelStaffAuth, (req, res) => {
  try {
    const orders = localKds.listKitchenOrders(db);
    const cancelled = localKds.listKitchenCancelledOrders(db);
    const venue =
      db.getBusinessDisplayName?.()
      || db.getBusinessName?.()
      || db.getSetting?.("restaurant_name", "")
      || "Restorant";
    res.json({
      ok: true,
      client_name: venue,
      restaurant_name: venue,
      orders,
      cancelled,
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/kds/orders/:orderId/accept", auth, kdsPanelStaffAuth, (req, res) => {
  try {
    const acceptedBy = req.session?.emri || "Kuzhina";
    localKds.acceptKitchenOrder(db, req.params.orderId, acceptedBy);
    notifyLocalKdsUpdate({ order_id: req.params.orderId, status: "accepted" });
    res.json({ ok: true, accepted_by: acceptedBy });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/kds/orders/:orderId/refuse", auth, kdsPanelStaffAuth, (req, res) => {
  try {
    const reason = String(req.body?.reason || req.body?.refuse_reason || "").trim();
    localKds.refuseKitchenOrder(db, req.params.orderId, reason);
    notifyLocalKdsUpdate({ order_id: req.params.orderId, status: "refused" });
    res.json({ ok: true, refuse_reason: reason });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/kds/orders/:orderId/ready", auth, kdsPanelStaffAuth, (req, res) => {
  try {
    const row = localKds.markKitchenOrderReady(db, req.params.orderId);
    notifyLocalKdsUpdate({ order_id: req.params.orderId, status: "ready" });
    notifyWaitersRealtime("ready", { order_id: req.params.orderId, local: true });
    const mapped = localKds.mapOrderRow(row, row.table_number, db);
    res.json({ ok: true, order: mapped || { id: String(row.id) } });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/kds/bar/tables/live", auth, kdsPanelStaffAuth, (req, res) => {
  try {
    const live = localKds.listBarTablesLive(db);
    res.json({ ok: true, ...live });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/venue-logo", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const venue = String(db.getSetting("venue_logo_data_url", "") || "").trim();
  if (venue) return res.json({ ok: true, logo: venue });
  return res.json({ ok: true, logo: null });
});

/** IP LAN + linke PWA stafi — pa auth (vetëm LAN / Electron). */
app.get("/api/server-info", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.json(buildServerInfoPayload());
});

/** Manifest PWA stafi — start_url / scope sipas slug lokal (pa ndryshuar URL-të e rrugëve). */
app.get("/manifest-kamarier.json", (_req, res) => sendStaffRoleManifest(res, "kamarier"));
app.get("/manifest-recepsion.json", (_req, res) => sendStaffRoleManifest(res, "recepsion"));
app.get("/manifest-sherbimi.json", (_req, res) => sendStaffRoleManifest(res, "sherbimi"));

/** Linket WiFi për restorant (kamarier) dhe recepsion — pa auth (vetëm LAN). */
app.get("/api/login/staff-wifi-links", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (!db.isSetupDone()) {
    return res.status(503).json({ ok: false, gabim: "Konfigurimi nuk është përfunduar." });
  }
  const venue = resolveLocalVenueSegments();
  const kamarier_url = getLocalWaiterUrl() || "";
  const recepsion_url = getLocalRecepsionUrl() || "";
  res.json({
    ok: true,
    tipi: venue.tipi,
    slug: venue.slug,
    kamarier_url,
    recepsion_url,
    local_staff_wifi: { kamarier: kamarier_url, recepsion: recepsion_url },
    ...buildLocalWaiterLanLinkPayload(),
  });
});

/** Linke LAN kamarier — rifreskim i shpejtë (QR / IP) pa cloud sync të plotë. */
app.get("/api/admin/local-waiter-links", auth, adminOnly, (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.json({ ok: true, ...buildLocalWaiterLanLinkPayload() });
});

/** Meny publike — /menu/{slug}/{tavolina} (si restoranti). */
app.get("/menu/:slug/:tableNumber", (req, res) => {
  const table = String(req.params.tableNumber || "1").trim();
  const extra = req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "";
  const qs = new URLSearchParams(extra);
  if (!qs.has("table") && !qs.has("t")) qs.set("table", table);
  res.redirect(302, `/guest/menu.html?${qs.toString()}`);
});

/** Stafi — /waiter|bar|kitchen/{slug}?key=… → login lokal. */
for (const role of ["waiter", "bar", "kitchen", "housekeeping", "reception"]) {
  app.get(`/${role}/:slug`, (req, res) => {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(302, `/login.html${qs}`);
  });
}

/** Legacy /hotel/… — ridrejtim te formati i ri. */

app.get("/hotel/:a/:b", (req, res) => {
  const a = String(req.params.a || "").trim();
  const b = String(req.params.b || "").trim();
  const aLow = a.toLowerCase();
  const bLow = b.toLowerCase();
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";

  if (aLow === "menu" || bLow === "menu" || aLow === "kiosk" || bLow === "kiosk") {
    const slug = aLow === "menu" || aLow === "kiosk" ? b : a;
    const table = aLow === "menu" || aLow === "kiosk" ? "1" : b;
    return res.redirect(302, `/menu/${encodeURIComponent(slug)}/${encodeURIComponent(table)}${qs}`);
  }

  let role;
  let slug;
  if (HOTEL_ACCESS_ROLES.has(aLow)) {
    role = aLow;
    slug = b;
  } else if (HOTEL_ACCESS_ROLES.has(bLow)) {
    role = bLow;
    slug = a;
  } else {
    return res.status(404).send("Not found");
  }

  if (role === "kiosk" || role === "menu" || role === "public_menu") {
    return res.redirect(302, `/menu/${encodeURIComponent(slug)}/1${qs}`);
  }
  if (STAFF_ACCESS_ROLES.has(role)) {
    return res.redirect(302, `/${encodeURIComponent(role)}/${encodeURIComponent(slug)}${qs}`);
  }
  if (role === "room-service") {
    return res.redirect(302, `/guest/services.html${qs}`);
  }
  if (role === "services") {
    return res.redirect(302, `/guest/services.html${qs}`);
  }
  return res.status(404).send("Not found");
});

app.get("/admin.html", (_req, res) => {
  const fp = adminHtmlPathForRequest();
  if (!fp || !fs.existsSync(fp)) {
    return res.status(404).send("admin.html mungon");
  }
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.sendFile(fp);
});

const publicStaticOpts = {
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
    }
  },
};
for (const publicRoot of listPublicStaticRoots()) {
  app.use(express.static(publicRoot, publicStaticOpts));
}

app.get("/kasa-recepcion.html", (_req, res) => {
  const fp = resolvePublicFile("kasa-recepcion.html");
  if (!fs.existsSync(fp)) return res.status(404).send("kasa-recepcion.html mungon — build i ri ose sync-installed-public");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.sendFile(fp);
});

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
  const venueName = String(db.getBusinessDisplayName() || "").trim();
  if (venueName) {
    payload.business_display_name = venueName;
    payload.window_title = db.getAppWindowTitle({
      business_subtype: payload.business_subtype,
      restaurant_name: venueName,
    });
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
    return res.status(400).json({ gabim: "Kamarierët hyjnë vetëm me PIN (6 shifra)" });
  }

  res.status(400).json({ gabim: "Zgjidhni rolin: Admin ose Kamarier" });
});

/** Vetëm dev / PC lokal: rivendos fjalëkalimin e pronarit kur cloud+backup e kanë desinkronizuar. */
app.post("/api/login/local-recovery", (req, res) => {
  const rawIp = String(
    req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "",
  ).split(",")[0].trim().replace(/^::ffff:/, "");
  const local = rawIp === "127.0.0.1" || rawIp === "::1" || rawIp === "";
  let packaged = true;
  try {
    packaged = !!electronApp()?.isPackaged;
  } catch {
    packaged = true;
  }
  const allow =
    local
    && (!packaged || /^1|true|yes|on$/i.test(String(process.env.HOTEL_LOCAL_RECOVERY || "").trim()));
  if (!allow) {
    return res.status(403).json({ ok: false, gabim: "Rikthimi lokal nuk lejohet nga kjo adresë." });
  }
  const temp = String(req.body?.password || "1234").trim();
  if (temp.length < 4 || temp.length > 64) {
    return res.status(400).json({ ok: false, gabim: "Fjalëkalimi 4–64 karaktere." });
  }
  try {
    db.updateSettings({ admin_password: temp });
    const waiters = (db.getStaffForLogin?.() || []).map((w) => {
      const row = db.getStaff().find((s) => Number(s.id) === Number(w.id));
      return {
        id: w.id,
        name: w.name,
        staff_role: row?.staff_role || "",
        pin_len: row?.pin ? String(row.pin).length : 0,
      };
    });
    return res.json({
      ok: true,
      message: "Fjalëkalimi i pronarit u rivendos lokalisht.",
      owner_password: temp,
      waiters,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.get("/api/login/waiters", (_req, res) => {
  if (!db.isSetupDone()) {
    return res.json({ waiters: [] });
  }
  res.json({ waiters: db.getStaffForLogin() });
});

/** Pas pairing: numri i arkës (sync) + moduli UI (recepsion/kamarier) — login.html. */
app.get("/api/login/terminal-role", (_req, res) => {
  try {
    const license = require("./license");
    const eapp = electronApp();
    const terminal_role = license.readTerminalRole(eapp) || null;
    const terminal_module = license.readTerminalModule(eapp) || null;
    const register_number =
      typeof license.terminalRegisterNumber === "function"
        ? license.terminalRegisterNumber(eapp) || null
        : null;
    const max_registers = db.getMaxRegisters();
    res.json({
      ok: true,
      terminal_role,
      terminal_module,
      register_number,
      max_registers,
      lock_role_from_terminal:
        max_registers >= 2 &&
        (terminal_module === "recepsion" || terminal_module === "kamarier"),
    });
  } catch (e) {
    res.json({
      ok: false,
      terminal_role: null,
      terminal_module: null,
      gabim: e.message || String(e),
    });
  }
});

/** Bootstrap për link personal ?w=token — tregon emrin e kamarierit para PIN. */
app.get("/api/login/waiter-bootstrap", (req, res) => {
  try {
    const w = String(req.query.w || req.query.web_token || "").trim();
    if (!w) return res.json({ ok: false });
    const staff = db.findStaffByWebToken(w);
    if (!staff) {
      return res.json({ ok: false, invalid: true, gabim: "Linku i kamarierit nuk është i vlefshëm." });
    }
    return res.json({
      ok: true,
      staff_id: staff.id,
      name: staff.name,
      has_pin: !!staff.pin,
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
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
  const links = resolveStaffLinksPayload(db);
  res.json({
    ok: true,
    bar_url: links.bar_url || cloudSync.getBarScreenUrl(db) || "",
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
        if (/^\d{6}$/.test(pin)) {
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
  const webToken = String(req.body.web_token || req.body.w || "").trim();
  const loginMode = normalizePinLoginMode(req.body.login_mode || req.body.mode || "kamarier");
  if (!staffPinPolicy.acceptsLoginPin(pin, loginMode)) {
    return res.status(400).json({
      gabim: loginMode === "recepsion" || loginMode === "pastrim"
        ? "PIN duhet të jetë 6 shifra"
        : "PIN duhet 4 shifra (ose 6 për PIN të vjetër restoranti)",
    });
  }
  try {
    const staff = db.findStaffByPin(pin);
    if (!staff) {
      return res.status(401).json({ gabim: "PIN i gabuar!" });
    }
    if (!staffPinAllowedForLoginMode(staff, loginMode)) {
      const zoneMsg = staffPinPolicy.wrongZoneMessage(staff.staff_role, loginMode);
      return res.status(401).json({
        gabim: zoneMsg || "Ky PIN nuk lejohet për këtë panel",
        wrong_zone: true,
      });
    }
    if (webToken) {
      const linked = db.findStaffByWebToken(webToken);
      if (!linked || linked.id !== staff.id) {
        return res.status(401).json({ gabim: "PIN i gabuar për këtë link personal!" });
      }
    }
    if (staffId != null && staff.id !== staffId) {
      return res.status(401).json({ gabim: "PIN i gabuar për këtë kamarier!" });
    }

    const sessionRole = sessionRoleFromLoginMode(loginMode);
    const sess = createSession(sessionRole, staff.name, staff.id);
    auditActivity(staff.name, sessionRole, "Hyrje PIN", `${pin.length} shifra`);
    logFiscalLoginAudit(req, staff.name, staff.id);

    return res.json({
      ok: true,
      roli: sessionRole,
      emri: staff.name,
      staff_id: staff.id,
      ...sess,
    });
  } catch (e) {
    const status = e.status || 400;
    return res.status(status).json({ gabim: e.message });
  }
});

app.get("/api/waiter-codes", auth, adminOnly, (req, res) => {
  try {
    const role = req.query.role ? db.normalizeStaffRole(req.query.role) : null;
    const codes = db.getWaiterCodes(role).map(row => ({
      ...row,
      url: buildLocalStaffCodeUrl(row.role || "kamarier", row.code) || "",
    }));
    res.json({
      ok: true,
      codes,
      base_url_kamarier: getLocalWaiterUrl() || "",
      base_url_recepsion: getLocalRecepsionUrl() || "",
      max_active: 10,
      active_count: db.countActiveWaiterCodes(role),
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.post("/api/waiter-codes/generate", auth, adminOnly, (req, res) => {
  try {
    const waiter_name = req.body?.waiter_name ?? req.body?.name ?? "";
    const waiter_id = req.body?.waiter_id;
    const role = db.normalizeStaffRole(req.body?.role || "kamarier");
    const row = db.generateWaiterCode({ waiter_name, waiter_id, role });
    res.json({
      ok: true,
      code: row,
      url: buildLocalStaffCodeUrl(row.role, row.code) || "",
    });
  } catch (e) {
    res.status(e.status || 400).json({ gabim: e.message });
  }
});

app.delete("/api/waiter-codes/:code", auth, adminOnly, (req, res) => {
  try {
    db.deactivateWaiterCode(req.params.code);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/settings/cloud-waiter-status", auth, adminOnly, (_req, res) => {
  const disabled = isCloudWaiterDisabledSetting();
  res.json({
    ok: true,
    disabled,
    cloud_waiter_disabled: disabled ? "true" : "false",
  });
});

app.post("/api/login/card", async (req, res) => {
  const card_uid = req.body.card_uid ?? req.body.card ?? req.body.uid ?? "";
  const staffId = req.body.staff_id != null ? Number(req.body.staff_id) : null;
  const loginModeRaw = req.body.login_mode || req.body.mode || "";
  try {
    const adminHit = db.findAdminSessionByCard(card_uid);
    if (adminHit) {
      const sess = createSession("admin", adminHit.emri);
      auditActivity(adminHit.emri, "admin", "Hyrje kartelë RFID", "RFID pronari");
      logFiscalLoginAudit(req, adminHit.emri, "ADMIN");
      return res.json({
        ok: true,
        roli: "admin",
        emri: adminHit.emri,
        ...sess,
      });
    }
    const staff = db.findStaffByCard(card_uid);
    if (!staff) {
      return res.status(401).json({ gabim: "Kartela nuk njihet!" });
    }
    if (staffId != null && staff.id !== staffId) {
      return res.status(401).json({ gabim: "Kjo kartelë nuk i takon këtij punonjësi!" });
    }
    const staffRole = db.normalizeStaffRole(staff.staff_role);
    let sessionRole = sessionRoleFromLoginMode(staffRole);
    if (loginModeRaw) {
      const loginMode = normalizePinLoginMode(loginModeRaw);
      if (!staffPinAllowedForLoginMode(staff, loginMode)) {
        const zoneMsg = staffPinPolicy.wrongZoneMessage(staff.staff_role, loginMode);
        return res.status(401).json({
          gabim: zoneMsg || "Ky PIN nuk lejohet për këtë panel",
          wrong_zone: true,
        });
      }
      sessionRole = sessionRoleFromLoginMode(loginMode);
    }
    const sess = createSession(sessionRole, staff.name, staff.id);
    auditActivity(staff.name, sessionRole, "Hyrje kartelë RFID", "RFID");
    logFiscalLoginAudit(req, staff.name, staff.id);

    return res.json({
      ok: true,
      roli: sessionRole,
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
  if (rejectStaffCloud(req, res, { ok: true, tables: [], updated_at: null, local_only: true })) return;
  try {
    const live = await cloudSync.fetchLiveCloudTables(db);
    res.json({ ok: true, tables: live?.tables || [], updated_at: live?.updated_at || null });
  } catch (e) {
    res.json({ ok: false, tables: [], gabim: e.message });
  }
});

app.get("/api/admin/cloud-tables", auth, adminOnly, async (req, res) => {
  try {
    const live = await cloudSync.fetchLiveCloudTables(db);
    res.json({ ok: true, tables: live?.tables || [], updated_at: live?.updated_at || null });
  } catch (e) {
    res.json({ ok: false, tables: [], gabim: e.message });
  }
});

/** Faqja publike KDS — proxy përmes POS (admin tab → server → hotel-cloud-sync → cloud). */
app.get("/api/admin/kds-public-page", auth, adminOnly, async (_req, res) => {
  try {
    const hotelCloudSync = require("./hotel-cloud-sync");
    const data = await hotelCloudSync.fetchKdsPublicPage(db);
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/admin/kds-public-page", auth, adminOnly, async (req, res) => {
  try {
    const hotelCloudSync = require("./hotel-cloud-sync");
    const data = await hotelCloudSync.updateKdsPublicPage(db, req.body || {});
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/waiter/cloud-table/dismiss", auth, waiterOnly, async (req, res) => {
  if (rejectStaffCloud(req, res, { ok: true, skipped: true, local_only: true })) return;
  try {
    let tableNum = Number(req.body?.table_number);
    const tableId = Number(req.body?.table_id);
    if (!tableNum && tableId) {
      const row = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
      tableNum = Number(row?.number) || 0;
    }
    if (!tableNum) return res.status(400).json({ ok: false, gabim: "Mungon tavolina." });
    const tableRow = db.getTableByNumber?.(tableNum) || db.db.prepare("SELECT id FROM tables WHERE id = ?").get(tableId);
    const tid = Number(tableRow?.id || tableId);
    if (tid && db.getActiveOrderForTable(tid)) {
      return res.status(400).json({
        ok: false,
        gabim: "Ka porosi lokale — përdorni Anulo ose mbyllni tavolinën.",
      });
    }
    const result = await cloudSync.clearStuckCloudTableOrder(db, tableNum);
    if (result.still_occupied_in_cloud && !result.cloud_cancelled) {
      return res.status(409).json({
        ok: false,
        gabim: "Cloud nuk u pastrua — provoni përsëri ose nga Admin → Tavolinat.",
        ...result,
      });
    }
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || "Nuk u pastrua cloud." });
  }
});

app.post("/api/waiter/trigger-sync", auth, waiterOnly, async (req, res) => {
  if (rejectStaffCloud(req, res, { ok: true, pending: 0, local_only: true })) return;
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
  if (rejectStaffCloud(req, res, { ok: false, local_only: true, gabim: "Nuk disponohet për këtë rol." })) return;
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

/** Njoftim WS te kamarierët (polling mbetet fallback) — si KAFENE. */
function notifyWaitersRealtime(type, extra) {
  const e = extra && typeof extra === "object" ? extra : {};
  try {
    broadcastWaiterRealtime(type, extra);
  } catch {
    /* ignore */
  }
  try {
    const t = String(type || "").trim();
    if (t === "online_orders") emitLocalStaffEvent("guest-order", e);
    else if (t === "tables" || t === "cloud_tables") emitLocalStaffEvent("table-update", e);
    else if (t === "ready") emitLocalStaffEvent("order-status", { ...e, status: "ready" });
  } catch {
    /* ignore */
  }
}

let waiterReadyBroadcastKey = "";
let waiterReadyPollTimer = null;

function broadcastWaiterReadyIfChanged(orders) {
  const list = Array.isArray(orders) ? orders : [];
  const key = list
    .map((o) => String(o?.id ?? o?.order_id ?? "").trim())
    .filter(Boolean)
    .sort()
    .join("\0");
  if (!key || key === waiterReadyBroadcastKey) return;
  waiterReadyBroadcastKey = key;
  notifyWaitersRealtime("ready", { count: list.length });
}

/** «Gati» nga kuzhina → njofto kamarierët çdo 8s (si KAFENE pollWaiterReadyOrdersBroadcast). */
async function pollWaiterReadyOrdersBroadcast() {
  const localReady = collectLocalWaiterReadyOrders();
  let orders = localReady;
  if (cloudSync.isCloudConfigured(db)) {
    try {
      const raw = await cloudSync.fetchReadyTableOrders(db);
      orders = mergeReadyOrdersForWaiterAlarm([localReady, filterReadyOrdersForWaiterAlarm(raw)]);
    } catch {
      orders = localReady;
    }
  }
  if (!orders.length) return;
  broadcastWaiterReadyIfChanged(orders);
}

function ensureWaiterReadyPoller() {
  if (waiterReadyPollTimer) return;
  waiterReadyPollTimer = setInterval(() => {
    pollWaiterReadyOrdersBroadcast().catch(() => {});
  }, 8000);
}

// Porosi të gatshme nga banaku — alarm te kamarieri (IDs ruhen në DB — jo vetëm RAM)
const WAITER_READY_DISMISS_KEY = "waiter_ready_dismissed_order_ids";

function loadWaiterReadyDismissedIds() {
  try {
    const raw = db.getSetting(WAITER_READY_DISMISS_KEY, "[]");
    const arr = JSON.parse(raw);
    return new Set((Array.isArray(arr) ? arr : []).map(id => String(id || "").trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function persistWaiterReadyDismissedIds(set) {
  const arr = [...set].slice(-200);
  db.setSetting(WAITER_READY_DISMISS_KEY, JSON.stringify(arr));
}

const _seenReadyOrderIds = loadWaiterReadyDismissedIds();

function resolveOrderForWaiterReadyAlarm(alarmOrderId) {
  const id = String(alarmOrderId || "").trim();
  if (!id) return null;
  if (/^\d+$/.test(id)) {
    return db.db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(id));
  }
  if (typeof db.getOrderByCloudId === "function") {
    return db.getOrderByCloudId(id);
  }
  return null;
}

function filterReadyOrdersForWaiterAlarm(orders) {
  const out = [];
  let mutated = false;
  for (const o of orders || []) {
    const id = String(o?.id || "").trim();
    if (!id || _seenReadyOrderIds.has(id)) continue;
    const local = resolveOrderForWaiterReadyAlarm(id);
    if (local && String(local.status || "") !== "active") {
      _seenReadyOrderIds.add(id);
      mutated = true;
      continue;
    }
    out.push(o);
  }
  if (mutated) persistWaiterReadyDismissedIds(_seenReadyOrderIds);
  return out;
}

function mergeReadyOrdersForWaiterAlarm(lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const o of list || []) {
      const id = String(o?.id || "").trim();
      if (!id || _seenReadyOrderIds.has(id)) continue;
      if (!byId.has(id)) byId.set(id, o);
    }
  }
  return [...byId.values()];
}

function collectLocalWaiterReadyOrders() {
  return filterReadyOrdersForWaiterAlarm(
    localKds.listWaiterReadyKitchenOrders(db, _seenReadyOrderIds),
  );
}

app.get("/api/waiter/orders/ready-check", auth, waiterOnly, async (req, res) => {
  const localReady = collectLocalWaiterReadyOrders();
  let merged = localReady;
  if (cloudSync.isCloudConfigured(db)) {
    try {
      const cloudOrders = await cloudSync.fetchReadyTableOrders(db);
      const cloudUnseen = filterReadyOrdersForWaiterAlarm(cloudOrders);
      merged = mergeReadyOrdersForWaiterAlarm([localReady, cloudUnseen]);
    } catch {
      merged = localReady;
    }
  }
  res.json({
    ok: true,
    orders: merged,
    has_ready: merged.length > 0,
    local_only: !sessionMayTalkToCloud(req.session),
  });
});

app.post("/api/waiter/orders/ready-dismiss", auth, waiterOnly, async (req, res) => {
  const ids = (Array.isArray(req.body?.order_ids) ? req.body.order_ids : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  ids.forEach((id) => _seenReadyOrderIds.add(id));
  persistWaiterReadyDismissedIds(_seenReadyOrderIds);
  const cloudIds = ids.filter((id) => CLOUD_ORDER_UUID_RE.test(id));
  try {
    if (cloudSync.isCloudConfigured(db) && cloudIds.length) {
      await cloudSync.acknowledgeReadyOrdersPicked(db, cloudIds);
    }
  } catch (err) {
    console.warn("[ready-dismiss] cloud ack:", err?.message || err);
  }
  res.json({ ok: true, dismissed: ids.length, local_only: ids.length - cloudIds.length });
});

app.get("/api/waiter/online-orders/pending", auth, waiterOrRecepsion, async (req, res) => {
  const allowCloud = sessionMayTalkToCloud(req.session);
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
      db.isAnyStaffAcceptPendingOrder(o) || db.isCloudOnlinePickupOrder(o)
    );
    const isStillPendingForPos = (o) => {
      if (!isAcceptPending(o)) return false;
      const id = String(o?.id || "").trim();
      if (id && typeof onlineOrdersWatcher.isLocallyAcked === "function"
        && onlineOrdersWatcher.isLocallyAcked(db, id)) {
        return false;
      }
      return !cloudSync.isCloudOrderAccepted(o);
    };
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
    orders = orders.filter((o) => {
      const id = String(o?.id || "").trim();
      if (!id) return false;
      const localActive = typeof db.getActiveOrderByCloudId === "function"
        ? db.getActiveOrderByCloudId(id)
        : null;
      return !localActive;
    });
    const layoutChanged = db.ensureTablesForPendingCloudOrders(orders);
    const staffId = resolveWaiterStaffId(req.session);
    if (staffId) {
      orders = orders.filter(o => !onlineOrdersWatcher.isStaffRefusedOrder(db, staffId, o.id));
    }
    orders = filterOnlineOrdersForStaffRole(orders, req.session);
    const myOrders = staffId ? db.listActiveOnlineOrdersForStaffId(staffId) : [];
    const hasPending = orders.length > 0;
    let public_booking_requests = [];
    if (String(req.session?.role || "").trim() === "recepsion") {
      public_booking_requests = await loadPublicBookingRequestsForRecepcion();
    }
    res.json({
      ok: true,
      connected: !!data.connected,
      pending: orders.length,
      has_pending: hasPending,
      has_new: hasPending,
      orders,
      my_external: myOrders.length,
      my_orders: myOrders,
      layout_refresh: layoutChanged,
      message: data.message || "",
      public_booking_requests,
      public_booking_pending: public_booking_requests.length,
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.get("/api/waiter/online-slots", auth, waiterOnly, async (req, res) => {
  if (rejectStaffCloud(req, res, {
    ok: true,
    local_only: true,
    online_slots: Array.from({ length: 6 }, (_, i) => ({ slot: i + 1, status: "free", order: null })),
  })) return;
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
    }).map(slot => {
      if (!slot?.order) return slot;
      const o = slot.order;
      if (
        db.isRecepcionCloudPendingOrder(o)
        || db.isGuestHotelServiceOrder(o)
        || db.isGuestRoomMenuOrder(o)
      ) {
        return { ...slot, status: "free", order: null };
      }
      const access = db.qrOrderAccessForWaiter(o, req.session?.emri);
      if (access.allowed) return slot;
      return { ...slot, status: "free", order: null };
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
  if (rejectStaffCloud(req, res, { ok: true, skipped: true, local_only: true })) return;
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
    let cloud = { ok: true, local_only: true };
    if (sessionMayTalkToCloud(req.session)) {
      cloud = await cloudSync.closeCloudOnlineOrderById(db, {
        order_id: orderId,
        payment_method: req.body?.payment_method || "cash",
        waiter_name: req.session.emri,
        waiter_id: staff?.cloud_waiter_id || staff?.id,
        items,
      });
    }
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

app.post("/api/waiter/online-orders/accept", auth, waiterOrRecepsion, async (req, res) => {
  try {
    const orderIds = Array.isArray(req.body?.order_ids)
      ? req.body.order_ids
      : (req.body?.order_id ? [req.body.order_id] : []);
    const ids = [...new Set(orderIds.map(id => String(id || "").trim()).filter(Boolean))];
    if (!ids.length) {
      return res.status(400).json({ ok: false, gabim: "Zgjidhni porosinë." });
    }

    const pin = String(req.body?.pin || req.body?.waiter_pin || "").trim();
    let trustedStaff;
    try {
      trustedStaff = resolveTrustedStaffFromWaiterSession(req.session, pin);
    } catch (e) {
      return res.status(e.status || 400).json({ ok: false, gabim: e.message });
    }
    const staffId = resolveWaiterStaffId(req.session);

    const fallbackOrders = Array.isArray(req.body?.orders) ? req.body.orders : [];
    const acceptNote = String(req.body?.accept_note || req.body?.staff_note || "").trim();
    const flow = await acceptOnlineOrdersFlow(
      ids,
      pin,
      {
        fallbackOrders,
        trustedStaff,
        sessionRole: req.session.role,
        allowCloudOutbound: allowCloudOutboundForGuestOrderSession(req.session),
      },
    );
    if (acceptNote) {
      auditReq(req, "Porosi online pranuar — shënim", acceptNote);
    }
    const myOrders = staffId ? db.listActiveOnlineOrdersForStaffId(staffId) : [];
    const visibleOrders = filterOnlineOrdersForStaffRole(flow.snapshot?.orders || [], req.session);
    notifyWaitersRealtime("online_orders", { reason: "accept" });
    notifyWaitersRealtime("tables", { reason: "online_accept" });
    res.json({
      ok: true,
      acknowledged: flow.acknowledged,
      accepted_by: flow.accepted_by,
      imported: flow.imported,
      my_external: myOrders.length,
      my_orders: myOrders,
      pending: visibleOrders.length,
      has_pending: visibleOrders.length > 0,
      orders: visibleOrders,
      cloud_ok: !!flow.cloud_ok,
      cloud_message: flow.cloud_message || "",
    });
  } catch (e) {
    const msg = String(e.message || "Gabim.").trim();
    const biz = /nuk u gjet|mungon|pavlefsh|porosia|restoranti|recepsioni|dhom/i.test(msg);
    const status = e.status || (biz ? 400 : 500);
    res.status(status).json({ ok: false, gabim: msg });
  }
});

/** Rikthen në cloud porositë takeaway aktive (PC → telefon / revolution-pos.com). */
app.post("/api/waiter/online-orders/resync-cloud", auth, waiterOnly, async (req, res) => {
  if (rejectStaffCloud(req, res, { ok: true, pushed: 0, skipped: true, local_only: true })) return;
  try {
    const staff = db.findStaffByName(req.session.emri)
      || db.findStaffByNameInsensitive(req.session.emri);
    const ackMeta = staffCloudAckMeta(staff);
    const who = { waiterName: String(req.session.emri || "").trim(), waiterId: ackMeta.waiterId };
    let pushed = 0;
    const failed = [];
    for (const meta of db.listActiveOnlineOrders()) {
      const cloudId = String(meta.cloud_order_id || "").trim();
      if (!cloudId) continue;
      const order = db.getActiveOrderByCloudId(cloudId)
        || db.db.prepare("SELECT * FROM orders WHERE id = ?").get(meta.order_id);
      if (!order) continue;
      let cloudOrder = { id: cloudId, device_id: "WEB-PUBLIC" };
      try {
        const resolved = await cloudSync.resolveCloudOrderById(db, cloudId);
        if (resolved?.id) cloudOrder = resolved;
      } catch {
        /* minimal payload */
      }
      const r = await cloudSync.pushOnlinePickupAcceptToCloud(db, order, cloudOrder, who);
      if (r.ok) pushed += 1;
      else failed.push({ cloud_id: cloudId, error: r.message || "push dështoi" });
    }
    res.json({ ok: true, pushed, failed, total: db.listActiveOnlineOrders().length });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.post("/api/waiter/online-orders/refuse", auth, waiterOrRecepsion, async (req, res) => {
  try {
    const orderIds = Array.isArray(req.body?.order_ids)
      ? req.body.order_ids
      : (req.body?.order_id ? [req.body.order_id] : []);
    const ids = [...new Set(orderIds.map(id => String(id || "").trim()).filter(Boolean))];
    if (!ids.length) {
      return res.status(400).json({ ok: false, gabim: "Zgjidhni porosinë." });
    }

    const pin = String(req.body?.pin || req.body?.waiter_pin || "").trim();
    let trustedStaff;
    try {
      trustedStaff = resolveTrustedStaffFromWaiterSession(req.session, pin);
    } catch (e) {
      return res.status(e.status || 400).json({ ok: false, gabim: e.message });
    }
    const staffId = resolveWaiterStaffId(req.session);

    const reason = String(req.body?.reason || req.body?.refuse_reason || "").trim();
    const flow = await refusePendingOnlineOrdersFlow(ids, {
      pin,
      trustedStaff,
      reason,
      allowCloudOutbound: allowCloudOutboundForGuestOrderSession(req.session),
    });
    const myOrders = staffId ? db.listActiveOnlineOrdersForStaffId(staffId) : [];
    const visibleOrders = filterOnlineOrdersForStaffRole(flow.snapshot?.orders || [], req.session);
    notifyWaitersRealtime("online_orders", { reason: "refuse" });
    res.json({
      ok: true,
      refused: flow.refused,
      order_id: flow.order_id,
      refused_by: flow.refused_by,
      grace_minutes: flow.grace_minutes,
      refuse_mode: flow.refuse_mode,
      refuse_reason: reason || flow.refuse_reason || "",
      pending: visibleOrders.length,
      has_pending: visibleOrders.length > 0,
      orders: visibleOrders,
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

app.get("/api/waiter/public-booking-requests/pending", auth, waiterOrRecepsion, async (req, res) => {
  try {
    const requests = await loadPublicBookingRequestsForRecepcion();
    const staffCloud = sessionMayTalkToCloud(req.session);
    if (staffCloud) {
      try {
        const hotelCloudSync = require("./hotel-cloud-sync");
        const data = await hotelCloudSync.listPublicBookingRequestsPending(db);
        if (Array.isArray(data.requests) && data.requests.length) {
          db.reconcilePendingPublicBookingRequests(data.requests);
          return res.json({ ok: true, requests: data.requests, local_only: false });
        }
      } catch {
        /* cache */
      }
    }
    res.json({ ok: true, requests, local_only: !staffCloud });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message, requests: [] });
  }
});

app.post("/api/waiter/public-booking-requests/:id/respond", auth, waiterOrRecepsion, async (req, res) => {
  try {
    const hotelCloudSync = require("./hotel-cloud-sync");
    const data = await hotelCloudSync.respondPublicBookingRequest(db, req.params.id, {
      reply_kind: req.body?.reply_kind,
      staff_message: req.body?.staff_message,
      staff_name: req.body?.staff_name || req.session?.emri || "Recepsion",
    });
    if (typeof db.removePendingPublicBookingRequest === "function") {
      db.removePendingPublicBookingRequest(req.params.id);
    }
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/waiter/public-booking-requests/:id/available-rooms", auth, waiterOrRecepsion, async (req, res) => {
  try {
    let booking = resolvePendingPublicBookingRow(db, req.params.id);
    if (!booking) {
      await loadPublicBookingRequestsForRecepcion();
      booking = resolvePendingPublicBookingRow(db, req.params.id);
    }
    if (!booking && sessionMayTalkToCloud(req.session)) {
      const hotelCloudSync = require("./hotel-cloud-sync");
      const pending = await hotelCloudSync.listPublicBookingRequestsPending(db);
      booking = (pending.requests || []).find((r) => String(r.id) === String(req.params.id));
    }
    if (!booking) {
      return res.status(404).json({ ok: false, gabim: "Kërkesa nuk u gjet ose është përpunuar." });
    }
    const rooms = db.listAvailableRoomsForDates(
      booking.check_in_date,
      booking.check_out_date,
    ).filter((room) => {
      const want = String(booking.room_type || "").trim().toLowerCase();
      const got = String(room.room_type || room.type || "").trim().toLowerCase();
      if (!want) return true;
      if (!got) return true;
      return want === got || got.includes(want) || want.includes(got);
    }).map((room) => ({
      id: room.id,
      room_number: room.room_number,
      room_type: room.room_type || room.type || "",
      floor: room.floor,
      price_per_night: room.price_per_night,
    }));
    res.json({ ok: true, rooms, booking });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/** Kërkesa publike bazen/spa — POS recepsion (burimi kryesor i pranimit). */
app.get("/api/waiter/public-service-requests/pending", auth, waiterOrRecepsion, async (req, res) => {
  try {
    ensurePublicGuestRequestsWatcher();
    try {
      await publicGuestRequestsWatcher.refreshPublicGuestRequests(db);
    } catch {
      /* cache */
    }
    let requests = typeof db.listPendingPublicServiceRequests === "function"
      ? db.listPendingPublicServiceRequests()
      : [];
    const staffCloud = sessionMayTalkToCloud(req.session);
    if (staffCloud) {
      try {
        const hotelCloudSync = require("./hotel-cloud-sync");
        const data = await hotelCloudSync.listPublicServiceRequestsPending(db, { status: "open" });
        if (Array.isArray(data.requests)) {
          requests = data.requests;
          db.reconcilePendingPublicServiceRequests(requests);
        }
      } catch {
        /* cache */
      }
    }
    res.json({ ok: true, requests, local_only: !staffCloud });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message, requests: [] });
  }
});

app.post("/api/waiter/public-service-requests/:id/accept", auth, waiterOrRecepsion, async (req, res) => {
  try {
    const hotelCloudSync = require("./hotel-cloud-sync");
    const staffName = String(req.body?.staff_name || req.session?.emri || "Recepsion").trim();
    const data = await hotelCloudSync.acceptPublicServiceRequest(db, req.params.id, {
      staff_name: staffName,
      request_prepayment: req.body?.request_prepayment,
    });
    if (typeof db.removePendingPublicServiceRequest === "function") {
      db.removePendingPublicServiceRequest(req.params.id);
    }
    auditReq(req, "Shërbim publik pranuar", req.params.id);
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/waiter/public-service-requests/:id/reject", auth, waiterOrRecepsion, async (req, res) => {
  try {
    const hotelCloudSync = require("./hotel-cloud-sync");
    const staffName = String(req.body?.staff_name || req.session?.emri || "Recepsion").trim();
    const data = await hotelCloudSync.rejectPublicServiceRequest(db, req.params.id, {
      staff_name: staffName,
      staff_note: req.body?.staff_note || req.body?.reason || "",
    });
    if (typeof db.removePendingPublicServiceRequest === "function") {
      db.removePendingPublicServiceRequest(req.params.id);
    }
    auditReq(req, "Shërbim publik refuzuar", req.params.id);
    res.json(data);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/waiter/public-booking-requests/:id/accept", auth, waiterOrRecepsion, async (req, res) => {
  try {
    let booking = resolvePendingPublicBookingRow(db, req.params.id);
    if (!booking) {
      await loadPublicBookingRequestsForRecepcion();
      booking = resolvePendingPublicBookingRow(db, req.params.id);
    }
    const hotelCloudSync = require("./hotel-cloud-sync");
    if (!booking && sessionMayTalkToCloud(req.session)) {
      const pending = await hotelCloudSync.listPublicBookingRequestsPending(db);
      booking = (pending.requests || []).find((r) => String(r.id) === String(req.params.id));
    }
    if (!booking) {
      return res.status(404).json({ ok: false, gabim: "Kërkesa nuk u gjet ose është përpunuar." });
    }
    const roomId = Number(req.body?.room_id);
    if (!roomId) {
      return res.status(400).json({ ok: false, gabim: "Zgjidhni dhomën." });
    }
    const reservation = db.createRoomReservation({
      room_id: roomId,
      guest_name: booking.guest_name,
      phone: booking.phone,
      email: booking.email,
      check_in_date: booking.check_in_date,
      check_out_date: booking.check_out_date,
      persons: booking.persons,
      notes: booking.notes ? `${booking.notes} (web)` : "Rezervim nga faqja publike",
      status: "confirmed",
    });
    auditReq(req, "Rezervim web pranuar", `${reservation.room_number} — ${reservation.guest_name}`);
    const cloud = await hotelCloudSync.acceptPublicBookingRequest(db, req.params.id, {
      room_id: roomId,
      local_reservation_id: reservation.id,
      staff_name: req.body?.staff_name || req.session?.emri || "Recepsion",
    });
    pushHotelReservationsToCloudAsync("public-booking-accept");
    if (typeof db.removePendingPublicBookingRequest === "function") {
      db.removePendingPublicBookingRequest(req.params.id);
    }
    res.json({ ok: true, reservation, ...cloud });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
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

    for (const id of ids) {
      const found = findCloudOrderForQrGuard(id);
      if (!found) continue;
      const access = db.qrOrderAccessForWaiter(found, req.session?.emri);
      if (!access.allowed) {
        return res.status(403).json({
          ok: false,
          gabim: `Porosia QR e tavolinës T${access.tableNumber} i përket kamarierit: ${access.owner}`,
        });
      }
    }
    const flow = await cancelPendingOnlineOrdersFlow(ids, {
      allowCloudOutbound: sessionMayTalkToCloud(req.session),
    });
    const staffId = resolveWaiterStaffId(req.session);
    const myOrders = staffId ? db.listActiveOnlineOrdersForStaffId(staffId) : [];
    const visibleOrders = filterQrOrdersForWaiterName(flow.snapshot?.orders || [], req.session?.emri);
    res.json({
      ok: true,
      cancelled: flow.cancelled,
      pending: visibleOrders.length,
      has_pending: visibleOrders.length > 0,
      orders: visibleOrders,
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

function filterQrOrdersForWaiterName(orders, waiterName) {
  return (orders || []).filter(o => db.qrOrderAccessForWaiter(o, waiterName).allowed);
}

function filterOnlineOrdersForStaffRole(orders, session) {
  let list = filterQrOrdersForWaiterName(orders, session?.emri);
  const role = String(session?.role || "").trim();
  if (role === "recepsion") {
    list = list.filter(o => db.isRecepcionCloudPendingOrder(o));
  } else if (role === "kamarier") {
    list = list.filter((o) => !db.isRecepcionCloudPendingOrder(o));
  }
  return list;
}

function findCloudOrderForQrGuard(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return null;
  const norm = onlineOrdersWatcher.normalizePendingOrder;
  const sources = [
    onlineOrdersWatcher.getOnlineOrdersSnapshot()?.orders,
    db.listPendingCloudOrders(),
    onlineOrdersWatcher.getLastKnownOrders(),
  ];
  for (const source of sources) {
    for (const raw of source || []) {
      const o = typeof norm === "function" ? norm(raw) : raw;
      if (o?.id && String(o.id) === id) return o;
    }
  }
  return null;
}

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
    waiterId: String(staff?.cloud_waiter_id || "").trim(),
    waiterName: name,
  };
}

app.get("/api/waiter/shift/peers", auth, waiterOrRecepsion, (req, res) => {
  try {
    const staffId = resolveWaiterStaffId(req.session);
    if (!staffId) {
      return res.status(400).json({ gabim: "Kamarieri nuk u identifikua." });
    }
    res.json({ ok: true, peers: db.listHandoverPeers(staffId, req.session.role) });
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

app.post("/api/waiter/shift/open", auth, waiterOrRecepsion, (req, res) => {
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

app.get("/api/waiter/shift", auth, waiterOrRecepsion, (req, res) => {
  try {
    const staffId = resolveWaiterStaffId(req.session);
    if (!staffId) {
      return res.status(400).json({ gabim: "Kamarieri nuk u identifikua. Dilni dhe hyni përsëri." });
    }
    const summary = db.getWaiterShiftSummary(staffId, {
      sessionRole: req.session.role,
    });
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

app.post("/api/waiter/shift/close", auth, waiterOrRecepsion, async (req, res) => {
  try {
    const staffId = resolveWaiterStaffId(req.session);
    if (!staffId) {
      return res.status(400).json({ gabim: "Kamarieri nuk u identifikua. Dilni dhe hyni përsëri." });
    }
    const closed = db.closeWaiterShift(
      staffId,
      req.body?.actual_closing_cash,
      req.body?.handover_to_staff_id,
      { sessionRole: req.session.role },
    );
    const salesDetail = db.getShiftSalesDetail(closed.shift.id, req.session.role);
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
      const slug = String(db.getSetting("kitchen_slug", "") || "").trim();
      const key = String(db.getSetting("kitchen_key", "") || "").trim();
      console.log("[shift-email] server: pas closeWaiterShift, nis email cloud", {
        slug,
        keyPresent: Boolean(key),
        waiter: closed.waiter_name,
      });
      notifyShiftCloseEmail(db, closed, { sessionRole: req.session.role }).catch(err => {
        console.warn("[shift-close-email]", err.message || err);
      });
      try {
        const ownerReportSync = require("./owner-report-sync");
        const day = businessTodayYmd();
        ownerReportSync.queueOwnerReportDates(db, [day]);
        ownerReportSync.runOwnerReportSync(db).catch(() => {});
      } catch {
        /* ignore */
      }
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
      staff_role: req.query.staff_role,
    });
    res.json({ ok: true, shifts: rows });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/menu", auth, (req, res) => {
  const { items } = buildMenuCatalogPayload(true);
  res.json(items);
});

app.get("/api/menu/:id/photo", auth, (req, res) => {
  const photo = resolveMenuItemPhoto(req.params.id);
  if (sendResolvedPhoto(res, photo)) return;
  res.status(404).end();
});

app.get("/api/categories", auth, (req, res) => {
  res.json(db.getCategories());
});

function enrichTableRow(t, session) {
  const waiterName = session?.role === "kamarier" ? session.emri : null;
  const isAdmin = session?.role === "admin";
  const hasActiveOrder = Boolean(t.order);
  return {
    ...t,
    status: hasActiveOrder ? "occupied" : t.status,
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
    const result = db.deleteRoom(req.params.id);
    auditReq(req, "Fshirje dhome", existing?.room_number || req.params.id);
    res.json({
      ok: true,
      archived: !!result?.archived,
      message: result?.archived
        ? "Dhoma u hoq nga lista (historia e mysafirëve mbetet)."
        : "Dhoma u fshi.",
    });
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
    pushHotelGuestStayToCloudAsync("admin-check-in");
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
    pushHotelGuestStayToCloudAsync("admin-check-out");
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/admin/rooms/:id/clean", auth, adminOnly, (req, res) => {
  try {
    const room = db.markRoomClean(req.params.id);
    auditReq(req, "Pastrimi i dhomës", room.room_number);
    pushHousekeepingToCloudAsync("admin-room-clean");
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
    const result = await printGuestFolioReceipt(db, folio, {
      processedBy: req.session.emri || "Admin",
    });
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
    const result = await printGuestFolioReceipt(db, folio, {
      processedBy: req.session.emri || "Admin",
    });
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

registerSalesInvoiceRoutes(app, { auth, adminOnly, waiterOnly });

/** Recepsioni — dhomat (PIN / kamarier). Pa cloud. */
app.get("/api/waiter/rooms", auth, staffOrAdmin, (_req, res) => {
  if (terminalRegisterNumberLocal() >= 2) {
    const state = db.getTerminalOccupiedCacheState();
    if (!state.has_list) {
      return res.json([]);
    }
    return res.json(db.listRoomsWithGuestsFromTerminalCache());
  }
  res.json(db.listRoomsWithGuests());
});

/** Njoftimet kur tavolina faturohet në dhomë — recepsioni poll. */
app.get("/api/waiter/room-charge-notifications", auth, staffOrAdmin, (_req, res) => {
  res.json({ ok: true, notifications: drainRoomChargeNotifications() });
});

app.post("/api/waiter/rooms/:id/check-in", auth, staffOrAdmin, (req, res) => {
  try {
    const result = db.checkInGuest({
      ...(req.body || {}),
      room_id: Number(req.params.id),
    });
    auditReq(req, "Check-in", `${result.room.room_number} — ${result.guest.guest_name}`);
    pushHotelGuestStayToCloudAsync("recepsion-check-in");
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

app.post("/api/waiter/rooms/:id/check-out", auth, staffOrAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const checkout = beginCheckoutToken(req, res);
    if (checkout.blocked) return;
    if (respondIfWaiterCheckoutAlreadyProcessed(req, res, checkout)) return;
    const checkoutToken = String(body.checkout_token || "").trim().slice(0, 80);
    const preview = db.getCheckoutPreview(req.params.id, {
      check_out_date: body.check_out_date,
      extra_services: body.extra_services != null ? body.extra_services : body.services_total,
    });
    if (
      preview.pending_room_charges?.has_pending
      && !body.confirm_pending_room_charges
      && !body.force_checkout_pending_room_charges
    ) {
      releaseInMemoryCheckoutToken(checkoutToken);
      return res.status(409).json({
        ok: false,
        code: "PENDING_ROOM_CHARGES_FROM_TERMINAL",
        gabim: preview.pending_room_charges.message,
        pending_room_charges: preview.pending_room_charges,
        preview: { guest: preview.guest, room: preview.room, bill: preview.bill },
      });
    }
    const checkoutPayTotal =
      Number(preview.bill.total_due) != null && Number.isFinite(Number(preview.bill.total_due))
        ? Number(preview.bill.total_due)
        : Number(preview.bill.total) || 0;
    const payInfo = resolvePaymentFromBody(body, checkoutPayTotal);
    const requestedCoupon = body.coupon_type
      ? String(body.coupon_type).trim().toLowerCase()
      : null;
    const couponType = registerMode.resolveEffectiveCouponType(db, body.coupon_type);
    const fiscalSkip =
      body.fiscal_skip === true || requestedCoupon === "thermal" || couponType === "thermal";
    const result = db.checkOutGuest(req.params.id, {
      check_out_date: body.check_out_date,
      extra_services: body.extra_services != null ? body.extra_services : body.services_total,
      payment_method: payInfo.payment_method,
      payment_splits: payInfo.payment_splits,
      waiter_name: req.session.emri || "Recepcion",
      checkout_token: checkoutToken || undefined,
    });
    let folio = null;
    try {
      folio = db.getGuestFolio(result.guest.id, {
        check_out_date: body.check_out_date,
        extra_services: body.extra_services != null ? body.extra_services : body.services_total,
      });
    } catch {
      folio = {
        guest: result.guest,
        room: result.room,
        bill: result.bill,
        hotel_name: db.getSettings()?.business_name || "Hotel",
      };
    }
    const processedBy = req.session.emri || "Recepcion";
    const folioPrintOpts = {
      processedBy,
      paymentMethod: payInfo.payment_method,
    };
    let printResult = { printed: false, printMessage: "", html: null, coupon_type: couponType };
    if (fiscalSkip) {
      printResult = await printGuestFolioReceipt(db, folio, { couponType: "thermal", ...folioPrintOpts });
    } else if (fiscalConfig.isFiscalEnabled()) {
      printResult = await printGuestFolioReceipt(db, folio, { couponType: "fiscal", ...folioPrintOpts });
    } else {
      printResult = await printGuestFolioReceipt(db, folio, { couponType: "thermal", ...folioPrintOpts });
    }
    auditReq(
      req,
      "Check-out",
      `${result.room.room_number} — ${result.guest.guest_name} · ${result.bill.total}€ · ${payInfo.payment_method} · ${printResult.coupon_type || couponType}`,
    );
    pushHotelGuestStayToCloudAsync("recepsion-check-out");
    setImmediate(() => {
      try {
        const ownerReportSync = require("./owner-report-sync");
        const coDay = String(body.check_out_date || businessTodayYmd()).slice(0, 10);
        ownerReportSync.queueOwnerReportDates(db, [coDay, businessTodayYmd()]);
        ownerReportSync.runOwnerReportSync(db).catch(() => {});
      } catch {
        /* ignore */
      }
    });
    checkout.markClosed();
    res.json({
      ok: true,
      ...result,
      payment_method: payInfo.payment_method,
      coupon_type: printResult.coupon_type || couponType,
      printed: !!printResult.printed,
      printMessage: printResult.printMessage || "",
      html: printResult.html || null,
      fiscal_skipped: fiscalSkip,
    });
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
    const result = await printGuestFolioReceipt(db, folio, {
      processedBy: req.session.emri || "Recepcion",
    });
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
    const result = await printGuestFolioReceipt(db, folio, {
      processedBy: req.session.emri || "Recepcion",
    });
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
    pushHousekeepingToCloudAsync("recepsion-room-clean");
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
    pushHousekeepingToCloudAsync("hk-assign");
    emitLocalStaffEvent("room-assigned", {
      room_id: row?.room_id,
      room_number: row?.room_number,
      assigned_to: row?.assigned_to,
      assigned_name: row?.assigned_name,
    });
    res.json({ ok: true, room: row });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/housekeeping/:roomId/notes", auth, staffOrAdmin, (req, res) => {
  try {
    const row = db.updateHousekeepingNotes(req.params.roomId, req.body?.notes);
    pushHousekeepingToCloudAsync("hk-notes");
    res.json({ ok: true, room: row });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/housekeeping/:roomId/start", auth, staffOrAdmin, (req, res) => {
  try {
    const row = db.startHousekeepingCleaning(req.params.roomId);
    auditReq(req, "Fillim pastrimi", `Dhoma ${row?.room_number}`);
    pushHousekeepingToCloudAsync("hk-start");
    emitLocalStaffEvent("room-status", {
      room_id: row?.room_id,
      room_number: row?.room_number,
      status: "in_progress",
      status_label: housekeepingStatusLabel("in_progress"),
      changed_by: String(req.session?.emri || "").trim(),
    });
    res.json({ ok: true, room: row });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/housekeeping/:roomId/complete", auth, staffOrAdmin, (req, res) => {
  try {
    const room = db.completeHousekeepingRoom(req.params.roomId);
    auditReq(req, "Përfundim pastrimi", room.room_number);
    pushHousekeepingToCloudAsync("hk-complete");
    emitLocalStaffEvent("room-status", {
      room_id: room?.id,
      room_number: room?.room_number,
      status: "clean",
      status_label: housekeepingStatusLabel("clean"),
      changed_by: String(req.session?.emri || "").trim(),
    });
    res.json({ ok: true, room });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/housekeeping/:roomId/maintenance", auth, staffOrAdmin, (req, res) => {
  try {
    const row = db.setHousekeepingMaintenance(req.params.roomId, req.body?.notes);
    auditReq(req, "Mirëmbajtje dhome", `Dhoma ${row?.room_number}`);
    pushHousekeepingToCloudAsync("hk-maintenance");
    res.json({ ok: true, room: row });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/housekeeping/:roomId/ready", auth, staffOrAdmin, (req, res) => {
  try {
    const room = db.readyHousekeepingFromMaintenance(req.params.roomId);
    auditReq(req, "Gati nga mirëmbajtja", room.room_number);
    pushHousekeepingToCloudAsync("hk-ready");
    res.json({ ok: true, room });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

function housekeepingStatusLabel(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "clean") return "Pastër";
  if (s === "in_progress") return "Në pastrim";
  if (s === "occupied") return "E zënë";
  if (s === "dirty") return "E papastër";
  return s || "—";
}

function mapSherbimiRoomRow(row) {
  if (!row) return null;
  let status = "clean";
  const hk = String(row.hk_status || "").toLowerCase();
  if (hk === "occupied") status = "occupied";
  else if (hk === "in_progress") status = "in_progress";
  else if (hk === "dirty" || hk === "maintenance") status = "dirty";
  else status = "clean";
  return {
    id: row.room_id,
    room_number: row.room_number,
    floor: row.floor,
    type: row.type,
    status,
    hk_status: row.hk_status,
    room_status: row.room_status,
  };
}

/** Pastrim stafi — vetëm SQLite lokal (pa cloud). */
app.get("/api/sherbimi/rooms", auth, sherbimiStaffAuth, (_req, res) => {
  try {
    const board = db.listHousekeepingBoard();
    res.json({
      ok: true,
      rooms: (board.rooms || []).map(mapSherbimiRoomRow),
      counts: board.counts,
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/sherbimi/rooms/:id/status", auth, sherbimiStaffAuth, (req, res) => {
  try {
    const status = String(req.body?.status || "").trim().toLowerCase();
    const roomId = Number(req.params.id);
    const boardBefore = db.listHousekeepingBoard();
    const prev = (boardBefore.rooms || []).find((r) => Number(r.room_id) === roomId);
    const oldStatus = prev ? (mapSherbimiRoomRow(prev)?.status || "") : "";
    const row = db.setSherbimiCleaningStatus(req.params.id, status);
    auditReq(req, "Status pastrimi", `Dhoma ${row?.room_number || req.params.id} → ${status}`);
    if (status && status !== oldStatus) {
      const changedBy = String(req.session?.emri || "").trim();
      db.insertHousekeepingNotification({
        room_id: roomId,
        room_number: row?.room_number ?? prev?.room_number,
        old_status: oldStatus,
        new_status: status,
        changed_by: changedBy,
      });
      emitLocalStaffEvent("room-status", {
        room_id: roomId,
        room_number: row?.room_number ?? prev?.room_number,
        status,
        status_label: housekeepingStatusLabel(status),
        changed_by: changedBy,
      });
    }
    res.json({ ok: true, room: mapSherbimiRoomRow(row) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Ndryshime statusi pastrimi (poll recepsioni — SQLite lokal). */
app.get("/api/waiter/housekeeping-updates", auth, staffOrAdmin, (_req, res) => {
  try {
    const rows = db.drainHousekeepingNotifications();
    res.json({
      ok: true,
      updates: rows.map((r) => ({
        room_id: r.room_id,
        room_number: r.room_number,
        status: r.new_status,
        status_label: housekeepingStatusLabel(r.new_status),
        old_status: r.old_status,
        changed_by: r.changed_by,
        timestamp: r.created_at,
      })),
    });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message, updates: [] });
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
  ensureServicesCatalogReady();
  const catalog = db.listHotelServicesCatalog();
  res.json({
    ok: true,
    services: catalog.services,
    categories: catalog.categories,
    groups: catalog.groups,
  });
});

app.post("/api/recepcion/kasa/pay", auth, waiterOrRecepsion, (req, res) => {
  try {
    if (req.session?.role !== "recepsion" && req.session?.role !== "admin") {
      return res.status(403).json({ gabim: "Vetëm recepsioni." });
    }
    const waiterName = String(req.session?.name || req.session?.emri || "Recepsion").trim();
    const result = db.recordRecepcionKasaSale({
      items: req.body?.items,
      payment_method: req.body?.payment_method,
      payment_splits: req.body?.payment_splits,
      waiter_name: waiterName,
    });
    auditReq(
      req,
      "Kasa recepsion",
      `${result.receipt_number} · ${result.total}€ · ${result.payment_method}`,
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/waiter/active-orders", auth, staffOrAdmin, (req, res) => {
  try {
    const data = db.listActiveHotelOrdersForWaiter({ sessionRole: req.session.role });
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

app.get("/api/admin/reservations/unified", auth, adminOnly, (req, res) => {
  try {
    const rows = db.listUnifiedReservations({
      from: req.query?.from || req.query?.fromDate,
      to: req.query?.to || req.query?.toDate,
      types: req.query?.types
        ? String(req.query.types).split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
      status: req.query?.status || "active",
      limit: Number(req.query?.limit) || 300,
    });
    res.json({ ok: true, reservations: rows, count: rows.length });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/admin/room-reservations", auth, adminOnly, (req, res) => {
  try {
    const reservation = db.createRoomReservation(req.body || {});
    auditReq(req, "Rezervim dhome", `${reservation.room_number} — ${reservation.guest_name}`);
    pushHotelReservationsToCloudAsync("admin-reservation-create");
    res.status(201).json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/admin/room-reservations/:id", auth, adminOnly, (req, res) => {
  try {
    const reservation = db.updateRoomReservation(req.params.id, req.body || {});
    auditReq(req, "Ndryshim rezervimi dhome", `${reservation.room_number} — ${reservation.guest_name}`);
    pushHotelReservationsToCloudAsync("admin-reservation-update");
    res.json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/admin/room-reservations/:id/cancel", auth, adminOnly, (req, res) => {
  try {
    const reservation = db.cancelRoomReservation(req.params.id);
    auditReq(req, "Anulim rezervimi dhome", `${reservation.room_number} — ${reservation.guest_name}`);
    pushHotelReservationsToCloudAsync("admin-reservation-cancel");
    res.json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/admin/room-reservations/:id/check-in", auth, adminOnly, (req, res) => {
  try {
    const result = db.convertReservationToCheckIn(req.params.id);
    auditReq(req, "Check-in nga rezervimi", `${result.room.room_number} — ${result.guest.guest_name}`);
    pushHotelGuestStayToCloudAsync("admin-reservation-check-in");
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Rezervime / dhoma nga cloud (telefon recepsion) → SQLite para listës në POS. */
app.post("/api/waiter/hotel-pms/pull-cloud", auth, staffOrAdmin, async (req, res) => {
  if (rejectStaffCloud(req, res, { ok: true, skipped: true, local_only: true, message: "Të dhënat lokale (POS)." })) return;
  try {
    const hotelCloudSync = require("./hotel-cloud-sync");
    const forceFull =
      String(req.query?.full || req.body?.full || "").trim() === "1"
      || String(req.body?.force_full || "").trim() === "1";
    const result = await hotelCloudSync.pullHotelPmsFromCloudOnly(db, { forceFull });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || "Gabim." });
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
    pushHotelReservationsToCloudAsync("recepsion-reservation-create");
    res.status(201).json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/waiter/room-reservations/:id", auth, staffOrAdmin, (req, res) => {
  try {
    const reservation = db.updateRoomReservation(req.params.id, req.body || {});
    auditReq(req, "Ndryshim rezervimi dhome", `${reservation.room_number} — ${reservation.guest_name}`);
    pushHotelReservationsToCloudAsync("recepsion-reservation-update");
    res.json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/room-reservations/:id/cancel", auth, staffOrAdmin, (req, res) => {
  try {
    const reservation = db.cancelRoomReservation(req.params.id);
    auditReq(req, "Anulim rezervimi dhome", `${reservation.room_number} — ${reservation.guest_name}`);
    pushHotelReservationsToCloudAsync("recepsion-reservation-cancel");
    res.json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/waiter/room-reservations/:id/check-in", auth, staffOrAdmin, (req, res) => {
  try {
    const result = db.convertReservationToCheckIn(req.params.id);
    auditReq(req, "Check-in nga rezervimi", `${result.room.room_number} — ${result.guest.guest_name}`);
    pushHotelGuestStayToCloudAsync("recepsion-reservation-check-in");
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/**
 * Faturë në dhomë: closeTable + room_charges (ose queue master) në një transaksion SQLite.
 */
app.post("/api/waiter/charge-to-room", auth, waiterOnly, async (req, res) => {
  const { table_id, room_id, items, coupon_type } = req.body || {};
  const waiterName = req.session.emri;
  const tableId = Number(table_id);
  const roomId = Number(room_id);
  if (!tableId) return res.status(400).json({ gabim: "Tavolina mungon" });
  if (!roomId) return res.status(400).json({ gabim: "Dhoma mungon" });

  const onSecondaryRegisterEarly = terminalRegisterNumberLocal() >= 2;
  let room = db.getRoomById(roomId);
  let guest = null;
  if (onSecondaryRegisterEarly) {
    try {
      const ok = db.assertChargeToRoomAgainstMasterOccupiedList(roomId);
      room = { ...ok.room, status: "occupied", room_number: ok.room_number };
      guest = ok.guest;
    } catch (e) {
      return res.status(400).json({ gabim: e.message || String(e) });
    }
  } else {
    if (!room) return res.status(400).json({ gabim: "Dhoma nuk u gjet." });
    if (room.status !== "occupied") {
      return res.status(400).json({ gabim: "Vetëm dhomat e zëna mund të faturohen." });
    }
    guest = db.getActiveGuestForRoom(roomId);
    if (!guest) return res.status(400).json({ gabim: "Nuk ka mysafir aktiv në këtë dhomë." });
  }

  const couponType = registerMode.resolveEffectiveCouponType(db, coupon_type);

  try {
    const tableRow = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
    if (!db.getActiveOrderForTable(tableId) && tableRow?.number) {
      await ensureCloudTableImportedForCheckout(db, tableRow.number, waiterName, req.session);
    }
    if (items?.length) {
      const existing = db.getActiveOrderForTable(tableId);
      const prev = db.parseOrderItems(existing?.items_json);
      const delta = diffOrderItems(prev, items);
      db.sendOrder({ table_id: tableId, waiter_name: waiterName, items });
      const afterSend = db.getActiveOrderForTable(tableId);
      if (afterSend) {
        const tbl = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
        cloudSync.pushWaiterOrderToCloudBackground(db, afterSend, {
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

    const onSecondaryRegister = terminalRegisterNumberLocal() >= 2;
    let order;
    let charges;
    try {
      const atomic = db.chargeTableToRoomAtomic({
        tableId,
        waiterName,
        pricing,
        guestId: guest.id,
        roomId,
        tableNumber: tableRow?.number,
        queueToMaster: onSecondaryRegister,
        masterQueue: onSecondaryRegister
          ? {
              ref: Number(orderBefore.id),
              room_number: room.room_number,
              guest_name: guest.guest_name,
              table_number: tableRow?.number,
              items: closeItems,
              fallback_total: Number(orderBefore.total) || 0,
            }
          : null,
      });
      order = atomic.order;
      charges = atomic.charges;
    } catch (atomicErr) {
      return res.status(400).json({ gabim: atomicErr.message || "Faturë në dhomë dështoi." });
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
        closedBy: waiterName,
      });
    }

    scheduleCloudAfterTableClose(db, {
      tableId,
      order,
      table,
      receipt,
      closeItems,
      waiterName,
      mirrorsCloud,
      cloudOrderIds: cloudIds3,
      logTag: "charge-to-room",
      skipCloud: !sessionMayTalkToCloud(req.session),
    });

    auditReq(
      req,
      "Faturë në dhomë",
      `T${table?.number || "?"} → Dhoma ${room.room_number} · ${guest.guest_name} · ${order.total}€`,
    );

    pushRoomChargeNotification({
      table_number: table?.number || 0,
      room_number: room.room_number,
      guest_name: guest.guest_name,
      total: Number(order.total) || 0,
      waiter_name: waiterName,
      source: "pos",
    });

    const bill = onSecondaryRegister ? null : db.getCheckoutPreview(roomId).bill;
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
      cloudSync.pushWaiterOrderToCloudBackground(db, order, {
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
      localKds.touchOrderAfterSend(db, order.id);
      notifyLocalKdsUpdate({
        order_id: String(order.id),
        table_number: t?.number || 0,
        status: "ordered",
      });
    }
    res.json({ ok: true, id, batch_no: batchNo, printed_items: deltaItems.length, items: deltaItems });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/orders/close", auth, async (req, res) => {
  const { table_id, waiter_name, is_admin } = req.body;
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
    const tableId = Number(table_id);
    const tableRow = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
    if (!db.getActiveOrderForTable(tableId) && tableRow?.number) {
      await ensureCloudTableImportedForCheckout(db, tableRow.number, name, req.session);
    }
    const orderBefore = db.getActiveOrderForTable(tableId);
    const closeItems = db.parseOrderItems(orderBefore?.items_json);
    const pricing = promotionService.resolvePromotionDiscount(
      db,
      closeItems,
      req.body.promotion_id
    );
    const expectedTotal =
      pricing?.total != null ? Number(pricing.total) : Number(orderBefore?.total || 0);
    const payInfo = resolvePaymentFromBody(req.body, expectedTotal);
    const order = db.closeTable(tableId, name, asAdmin, payInfo.payment_method, pricing, {
      allowAnyWaiter: asAdmin,
      payment_splits: payInfo.payment_splits,
    });
    const mirrorsCloud = order ? cloudSync.orderMirrorsRemoteCloud(order) : false;
    const cloudIdsClose = order ? db.getLinkedCloudOrderIds(order.id) : [];

    // HAPI FINAL — PAS closeTable (nuk e prek closeTable)
    let fiscalResult = null;
    if (order && fiscalConfig.isFiscalEnabled() && !fiscalSkip) {
      try {
        fiscalResult = await getFiscalMain().processFiscalReceipt(
          order.id,
          payInfo.payment_method || order.payment_method || "cash",
          {
            operator_name: name,
            operator_id: String(req.session.userId || req.session.id || "POS"),
            payment_splits: payInfo.payment_splits,
            subtotal: pricing?.subtotal,
            discount_amount: pricing?.discount_total,
            total_amount: expectedTotal,
          }
        );
      } catch (fe) {
        console.warn("[fiscal-main] orders/close:", fe.message);
      }
    }

    if (order) {
      scheduleCashDrawerKick({
        payment_method: payInfo.payment_method,
        payment_splits: payInfo.payment_splits,
        order,
      });
      scheduleCloudAfterTableClose(db, {
        tableId,
        order,
        table: tableRow ? { number: tableRow.number } : null,
        receipt: null,
        closeItems,
        waiterName: name,
        mirrorsCloud,
        cloudOrderIds: cloudIdsClose,
        logTag: "orders/close",
        cloudFiscalOpts,
        skipCloud: !sessionMayTalkToCloud(req.session),
      });
    }

    emitLocalStaffEvent("table-update", {
      table_id: tableId,
      action: "closed",
      room_number: tableRow?.number,
    });
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
    emitLocalStaffEvent("table-update", {
      table_id: tableId,
      table_number: t?.number,
      action: "cancelled",
    });
    res.json({ ok: true, message: "Porosia u anullua" });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

const CHECKOUT_TOKEN_TTL_MS = 15 * 60 * 1000;
const checkoutTokens = new Map();

function releaseInMemoryCheckoutToken(token) {
  const t = String(token || "").trim().slice(0, 80);
  if (t) checkoutTokens.delete(t);
}

/** Idempotency DB — token i ruajtur në daily_log.checkout_token pas pagesës së suksesshme. */
function respondIfWaiterCheckoutAlreadyProcessed(req, res, checkout) {
  const token = String(req.body?.checkout_token || "").trim().slice(0, 80);
  if (!token) return false;
  const dailyLogId = db.findDailyLogIdByCheckoutToken(token);
  if (!dailyLogId) return false;
  releaseInMemoryCheckoutToken(token);
  checkout?.markClosed?.();
  res.json({ ok: true, already_processed: true, daily_log_id: dailyLogId });
  return true;
}

function beginCheckoutToken(req, res) {
  const token = String(req.body?.checkout_token || "").trim().slice(0, 80);
  if (!token) return { blocked: false, markClosed() {} };
  const now = Date.now();
  for (const [k, v] of checkoutTokens) {
    if (now - v.at > CHECKOUT_TOKEN_TTL_MS) checkoutTokens.delete(k);
  }
  const prev = checkoutTokens.get(token);
  if (prev) {
    if (prev.response) res.json({ ...prev.response, duplicate: true });
    else if (prev.closed) res.json({ ok: true, duplicate: true, already_closed: true });
    else res.status(409).json({ gabim: "Pagesa po kryhet — prisni pak.", checkout_pending: true });
    return { blocked: true, markClosed() {} };
  }
  const entry = { at: now, closed: false, response: null };
  checkoutTokens.set(token, entry);
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400 && body && body.ok) entry.response = body;
    else if (!entry.closed) checkoutTokens.delete(token);
    return origJson(body);
  };
  return { blocked: false, markClosed() { entry.closed = true; } };
}

app.post("/api/waiter/open-drawer", auth, staffOrAdmin, async (_req, res) => {
  const result = await openCashDrawer(db);
  res.json({ ok: !!result.ok, ...result });
});

app.post("/api/waiter/close-and-print", auth, waiterOnly, async (req, res) => {
  const { table_id, items, coupon_type } = req.body;
  const waiterName = req.session.emri;
  const tableId = Number(table_id);
  if (!tableId) return res.status(400).json({ gabim: "Tavolina mungon" });
  const checkout = beginCheckoutToken(req, res);
  if (checkout.blocked) return;
  if (respondIfWaiterCheckoutAlreadyProcessed(req, res, checkout)) return;
  const checkoutToken = String(req.body?.checkout_token || "").trim().slice(0, 80);
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
      await ensureCloudTableImportedForCheckout(db, tableRow.number, waiterName, req.session);
    }
    if (items?.length) {
      const existing = db.getActiveOrderForTable(tableId);
      const prev = db.parseOrderItems(existing?.items_json);
      const delta = diffOrderItems(prev, items);
      if (delta.length > 0) {
        releaseInMemoryCheckoutToken(checkoutToken);
        return res.status(409).json({
          gabim:
            "Keni artikuj të padërguar — përdorni «Dërgo porosinë» para pagesës që t'i shohë kuzhina.",
          must_send_order_first: true,
        });
      }
    }
    const orderBefore = db.getActiveOrderForTable(tableId);
    const closeItems = db.parseOrderItems(orderBefore?.items_json);
    const pricing = promotionService.resolvePromotionDiscount(db, closeItems, req.body.promotion_id);
    const expectedTotal =
      pricing?.total != null ? Number(pricing.total) : Number(orderBefore?.total || 0);
    const payInfo = resolvePaymentFromBody(req.body, expectedTotal);
    const order = db.closeTable(tableId, waiterName, false, payInfo.payment_method, pricing, {
      allowAnyWaiter: true,
      payment_splits: payInfo.payment_splits,
      checkout_token: checkoutToken || undefined,
    });
    if (!order) {
      return res.status(400).json({ gabim: "Nuk ka porosi aktive për këtë tavolinë." });
    }

    scheduleCashDrawerKick({
      payment_method: payInfo.payment_method,
      payment_splits: payInfo.payment_splits,
      order,
    });

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
        closedBy: waiterName,
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
          payInfo.payment_method || order.payment_method || "cash",
          {
            operator_name: waiterName,
            operator_id: String(req.session.userId || req.session.id || "POS"),
            subtotal: pricing?.subtotal,
            discount_amount: pricing?.discount_total,
            total_amount: order.total,
            payment_splits: payInfo.payment_splits,
          }
        );
      } catch (fe) {
        console.warn("[fiscal-main] close-and-print:", fe.message);
      }
    }

    scheduleCloudAfterTableClose(db, {
      tableId,
      order,
      table,
      receipt,
      closeItems,
      waiterName,
      mirrorsCloud,
      cloudOrderIds: cloudIds3,
      logTag: "close-and-print",
      cloudFiscalOpts,
      skipCloud: !sessionMayTalkToCloud(req.session),
    });

    checkout.markClosed();
    res.json({
      ok: true,
      receipt,
      order_id: order.id,
      sale_items: closeItems,
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

async function handleWaiterPrintThermalReceipt(req, res) {
  const orderId = Number(req.body?.order_id);
  if (!orderId) return res.status(400).json({ gabim: "Porosia mungon" });
  try {
    const order = db.db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (!order) return res.status(404).json({ gabim: "Porosia nuk u gjet" });
    if (order.status === "active") {
      return res.status(400).json({
        gabim: "Tavolina ende e hapur — zgjidhni llojin e kuponit para pagesës.",
      });
    }
    const receipt = db.createReceipt(orderId);
    const table = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(order.table_id);
    const printResult = await printClosedTableReceipt(db, {
      order,
      receipt,
      tableNumber: table?.number || 0,
      couponType: "thermal",
      closedBy: req.session.emri,
    });
    res.json({
      ok: true,
      order_id: orderId,
      coupon_type: "thermal",
      html: printResult.html || null,
      printed: !!printResult.printed,
      printMessage: printResult.printMessage || "",
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
}

/** Riprint kupon termik për porosi të mbyllur (pa fiskal). */
app.post("/api/waiter/print-thermal-receipt", auth, waiterOnly, handleWaiterPrintThermalReceipt);
app.post("/api/print/thermal-receipt", auth, waiterOnly, handleWaiterPrintThermalReceipt);

app.post("/api/waiter/split-close-and-print", auth, waiterOnly, async (req, res) => {
  const { table_id, items, coupon_type } = req.body;
  const waiterName = req.session.emri;
  const tableId = Number(table_id);
  if (!tableId) return res.status(400).json({ gabim: "Tavolina mungon" });
  if (!items?.length) return res.status(400).json({ gabim: "Zgjidhni artikuj për pagesë" });
  const checkout = beginCheckoutToken(req, res);
  if (checkout.blocked) return;
  if (respondIfWaiterCheckoutAlreadyProcessed(req, res, checkout)) return;
  const checkoutToken = String(req.body?.checkout_token || "").trim().slice(0, 80);
  const requestedCoupon = coupon_type
    ? String(coupon_type).trim().toLowerCase()
    : null;
  const couponType = registerMode.resolveEffectiveCouponType(db, coupon_type);
  const fiscalSkip = req.body?.fiscal_skip === true || requestedCoupon === "thermal";
  const cloudFiscalOpts = fiscalSkip
    ? { fiscal_skip: true, coupon_type: requestedCoupon || "thermal" }
    : (requestedCoupon ? { coupon_type: requestedCoupon } : {});

  try {
    const tableRowSplit = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
    if (!db.getActiveOrderForTable(tableId) && tableRowSplit?.number) {
      await ensureCloudTableImportedForCheckout(db, tableRowSplit.number, waiterName, req.session);
    }
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
        cloudSync.pushWaiterOrderToCloudBackground(db, afterSend, {
          table_number: tbl?.number || 0,
          ordered_at: afterSend.created_at,
        });
      }
    }

    const pricing = promotionService.resolvePromotionDiscount(db, items, req.body.promotion_id);
    const expectedTotal =
      pricing?.total != null
        ? Number(pricing.total)
        : (Array.isArray(items)
            ? items.reduce(
                (s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0),
                0
              )
            : 0);
    const payInfo = resolvePaymentFromBody(req.body, expectedTotal);
    const result = db.closeTablePartial(tableId, waiterName, payInfo.payment_method, items, pricing, {
      allowAnyWaiter: true,
      payment_splits: payInfo.payment_splits,
      checkout_token: checkoutToken || undefined,
    });
    scheduleCashDrawerKick({
      payment_method: payInfo.payment_method,
      payment_splits: payInfo.payment_splits,
      order: result.order,
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
      closed_by: waiterName,
      source_label: result.order?.source_label || "",
      waiter_name: result.order?.waiter_name || waiterName,
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
        closedBy: waiterName,
      });
    } else {
      console.log("[split-close] SEF replace — skip kupon normal mbylljeje, vetëm fiskal");
    }

    let fiscalResult = null;
    if (sefOn && !fiscalSkip) {
      try {
        fiscalResult = await getFiscalMain().processFiscalReceipt(
          fiscalOrderId,
          payInfo.payment_method || result.order.payment_method || "cash",
          {
            operator_name: waiterName,
            operator_id: String(req.session.userId || req.session.id || "POS"),
            items: result.removed,
            subtotal: pricing?.subtotal,
            discount_amount: pricing?.discount_total,
            total_amount: result.partialTotal,
            payment_splits: payInfo.payment_splits,
          }
        );
      } catch (fe) {
        console.warn("[fiscal-main] split-close:", fe.message);
      }
    }

    if (result.tableFreed) {
      scheduleCloudAfterTableClose(db, {
        tableId,
        order: partialOrder,
        table,
        receipt,
        closeItems: result.removed,
        waiterName,
        mirrorsCloud,
        cloudOrderIds: cloudIds4,
        logTag: "split-close",
        cloudFiscalOpts,
        skipCloud: !sessionMayTalkToCloud(req.session),
      });
    }

    if (!result.tableFreed) {
      const remaining = db.getActiveOrderForTable(tableId);
      if (remaining) {
        cloudSync.pushWaiterOrderToCloudBackground(db, remaining, {
          table_number: table?.number || 0,
          ordered_at: remaining.created_at,
        });
      }
    }

    checkout.markClosed();
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

app.put("/api/admin/tab-order", auth, adminOnly, (req, res) => {
  try {
    const order = db.setAdminTabOrder(req.body?.order);
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ gabim: e.message || "Rendi i skedave nuk u ruajt." });
  }
});

app.get("/api/admin/register-status", auth, adminOnly, (_req, res) => {
  try {
    if (terminalRegisterNumber() >= 2) {
      return res.status(403).json({ ok: false, gabim: "Vetëm arka Kryesore e sheh statusin e arkave." });
    }
    res.json({ ok: true, ...db.getAdminRegisterStatus() });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || String(e) });
  }
});

app.get("/api/admin/relay-link", auth, adminOnly, (_req, res) => {
  try {
    const n = terminalRegisterNumber();
    const terminalRelay = require("./terminal-relay");
    const outbox =
      typeof db.getLanOutboxStatus === "function"
        ? db.getLanOutboxStatus()
        : { pending: 0, last_error: null, last_sent_at: null };
    if (n < 2) {
      return res.json({
        ok: true,
        register_number: n,
        role: "primary",
        ...outbox,
      });
    }
    const linkExtra =
      terminalLanSyncInstance && typeof terminalLanSyncInstance.getCloudRelayLinkStatus === "function"
        ? terminalLanSyncInstance.getCloudRelayLinkStatus()
        : {
            primary_last_seen_at: terminalRelay.getMasterPrimaryLastSeenAt(),
            primary_cloud_online: terminalRelay.isMasterPrimaryOnlineOnCloud(),
          };
    res.json({
      ok: true,
      register_number: n,
      role: "secondary",
      ...outbox,
      ...linkExtra,
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || String(e) });
  }
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

function stockBreakageStaffAllowed(req) {
  const role = String(req.session?.role || "").trim().toLowerCase();
  if (role === "admin") return true;
  if (role === "kamarier" || role === "waiter") return true;
  if (role === "recepsion" || role === "reception" || role === "receptionist") return true;
  if (role === "sherbimi" || role === "pastrim" || role === "housekeeping") return true;
  return false;
}

function stockBreakageStaffAuth(req, res, next) {
  if (!req.session?.emri) {
    return res.status(401).json({ gabim: "Kërkohet autentifikim." });
  }
  if (!stockBreakageStaffAllowed(req)) {
    return res.status(403).json({ gabim: "Nuk keni leje për thyerje/humbje." });
  }
  next();
}

app.get("/api/stock-breakage/items", auth, stockBreakageStaffAuth, (_req, res) => {
  try {
    res.json({
      ok: true,
      reasons: db.STOCK_BREAKAGE_REASONS.map((code) => ({
        code,
        label: db.stockBreakageReasonLabel(code),
      })),
      menu_items: db.listStockBreakagePickableMenu(),
      local_inventory: db.listHotelLocalInventory(),
    });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/stock-breakage", auth, stockBreakageStaffAuth, (req, res) => {
  try {
    const body = req.body || {};
    const result = db.registerStockBreakageLoss({
      source_type: body.source_type,
      source_id: body.source_id,
      quantity: body.quantity,
      reason: body.reason,
      note: body.note,
      operator_name: req.session.emri || req.session.name || "Staf",
      operator_role: req.session.role || "",
    });
    auditReq(req, "Thyerje/humbje", `${result.item_name} × ${result.quantity} (${result.reason})`);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/admin/stock-breakage/report", auth, adminOnly, (req, res) => {
  try {
    const summary = db.summarizeStockBreakageLoss({
      from: req.query.from,
      to: req.query.to,
    });
    const entries = db.listStockBreakageLoss({
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
    });
    res.json({ ok: true, summary, entries });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/admin/local-inventory", auth, adminOnly, (req, res) => {
  try {
    const row = db.upsertHotelLocalInventoryItem(req.body || {});
    res.json({ ok: true, item: row });
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

function requireAdminPurgeConfirm(body) {
  const confirm = String(body?.confirm || "").trim();
  if (confirm !== "FSHIJ") {
    const err = new Error('Shkruani saktë "FSHIJ" për të konfirmuar.');
    err.status = 400;
    throw err;
  }
}

app.post("/api/admin/purge-today", auth, adminOnly, (req, res) => {
  try {
    requireAdminPurgeConfirm(req.body || {});
    const result = db.purgeTodaySalesData();
    auditReq(req, "Fshij shitjet e sotme (restorant)", JSON.stringify(result));
    try {
      syncCatalogToCloud();
    } catch (e) {
      console.warn("[purge-today] cloud:", e.message);
    }
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, gabim: e.message });
  }
});

app.delete("/api/categories/:id/purge", auth, adminOnly, (req, res) => {
  try {
    requireAdminPurgeConfirm(req.body || {});
    const result = db.purgeCategoryById(Number(req.params.id));
    auditReq(req, "Fshij kategori (purge)", result.category_name);
    syncCatalogToCloud();
    res.json({ ok: true, ...result, categories: db.getCategories() });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, gabim: e.message });
  }
});

app.delete("/api/menu/:id/purge", auth, adminOnly, (req, res) => {
  try {
    requireAdminPurgeConfirm(req.body || {});
    const result = db.purgeMenuItemById(Number(req.params.id));
    auditReq(req, "Fshij produkt (purge)", `${result.name} (#${result.id})`);
    syncCatalogToCloud();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, gabim: e.message });
  }
});

/* Fshirje e plotë — të gjitha të dhënat lokale; licenca mbetet; setup wizard pas rinisjes. */
app.post("/api/admin/full-wipe", auth, adminOnly, (req, res) => {
  try {
    const confirm = String(req.body?.confirm || "").trim();
    const adminPassword = String(req.body?.admin_password || "").trim();
    if (confirm !== "FSHIJ GJITHÇKA") {
      return res.status(400).json({
        gabim: 'Duhet të shkruani saktë fjalën FSHIJ GJITHÇKA.',
      });
    }
    if (!adminPassword) {
      return res.status(400).json({ gabim: "Jepni fjalëkalimin e administratorit." });
    }
    if (!db.verifyAdminPassword(adminPassword)) {
      return res.status(403).json({ gabim: "Fjalëkalimi i administratorit është i gabuar." });
    }
    if (typeof global["__scheduleFactoryResetRelaunch"] !== "function") {
      return res.status(500).json({
        gabim: "Fshirja e plotë është e disponueshme vetëm në aplikacionin desktop (Electron).",
      });
    }
    const wipe = db.wipeFull();
    try {
      const licenseMod = require("./license");
      const eapp = electronApp();
      const userData =
        eapp?.getPath?.("userData") ||
        path.join(require("os").homedir(), "AppData", "Roaming", "Revolution HOTEL");
      if (typeof licenseMod.wipeAllClientData === "function") {
        licenseMod.registerInstallContext(eapp);
        licenseMod.wipeAllClientData(eapp, userData);
      }
    } catch (e) {
      console.warn("[full-wipe] fiscal-keys wipe:", e.message || e);
    }
    try {
      db.flushDatabase();
    } catch {
      /* ignore */
    }
    auditReq(req, "Fshirje e plotë e të dhënave", "full-wipe");
    res.json({
      ok: true,
      message: "Të gjitha të dhënat u fshinë. Programi po riniset…",
      wipe,
    });
    setTimeout(() => {
      try {
        global["__scheduleFactoryResetRelaunch"]({ skipDbWipe: true, fullWipe: true });
      } catch (e) {
        console.error("full-wipe relaunch:", e.message);
      }
    }, 250);
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

/* Rivendos — fshin shitjet/porositë (konfigurimi mbetet), fiscal-keys, rinis Electron. */
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
    const wipe = db.wipeSalesDataOnly();
    try {
      const licenseMod = require("./license");
      const eapp = electronApp();
      const userData =
        eapp?.getPath?.("userData") ||
        path.join(require("os").homedir(), "AppData", "Roaming", "Revolution HOTEL");
      if (typeof licenseMod.wipeAllClientData === "function") {
        licenseMod.registerInstallContext(eapp);
        licenseMod.wipeAllClientData(eapp, userData);
      }
    } catch (e) {
      console.warn("[factory-reset] fiscal-keys wipe:", e.message || e);
    }
    try {
      db.flushDatabase();
    } catch {
      /* ignore */
    }
    auditReq(req, "Rivendos si të re", "factory-reset");
    res.json({
      ok: true,
      message: "Shitjet u fshinë. Programi po riniset…",
      wipe,
    });
    setTimeout(() => {
      try {
        global["__scheduleFactoryResetRelaunch"]({ skipDbWipe: true });
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
  const data = businessTodayYmd();
  auditReq(req, "Ditari — shkarkim txt", opts.period || "custom");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="ditari-${data}.txt"`);
  res.send(txt);
});

app.post("/api/categories", auth, adminOnly, (req, res) => {
  const { name, route } = req.body;
  if (!name?.trim()) return res.status(400).json({ gabim: "Shkruani emrin e kategorisë" });
  try {
    db.addCategory(name, route);
    syncCatalogToCloud();
    res.json({ ok: true, categories: db.getCategories() });
  } catch (e) {
    res.status(400).json({ gabim: e.message.includes("UNIQUE") ? "Kjo kategori ekziston tashmë" : e.message });
  }
});

app.put("/api/categories/:name/route", auth, adminOnly, (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const categories = db.updateCategoryRoute(name, req.body?.route);
    syncCatalogToCloud();
    res.json({ ok: true, categories });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
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

app.get("/api/ingredients", auth, adminOnly, (_req, res) => {
  try {
    res.json({ ok: true, ingredients: db.listIngredients() });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/ingredients", auth, adminOnly, (req, res) => {
  try {
    const row = db.createIngredient(req.body || {});
    auditReq(req, "Përbërës i ri", row.name);
    res.json({ ok: true, ingredient: row });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.put("/api/ingredients/:id", auth, adminOnly, (req, res) => {
  try {
    const row = db.updateIngredient(Number(req.params.id), req.body || {});
    auditReq(req, "Ndryshim përbërës", row.name);
    res.json({ ok: true, ingredient: row });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.delete("/api/ingredients/:id", auth, adminOnly, (req, res) => {
  try {
    const row = db.deleteIngredient(Number(req.params.id));
    auditReq(req, "Fshirje përbërës", row.name);
    res.json({ ok: true, ...row });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/menu/recipe-workbench", auth, adminOnly, (req, res) => {
  try {
    if (typeof db.purgeDrinkMenuItemRecipeLines === "function") {
      db.purgeDrinkMenuItemRecipeLines();
    }
    const q = String(req.query.q || "").trim().toLowerCase();
    const items = (db.getMenuItems(false) || [])
      .filter((m) => menuItemEligibleForRecipe(m))
      .filter((m) => {
        if (!q) return true;
        return String(m.name || "").toLowerCase().includes(q)
          || String(m.category || "").toLowerCase().includes(q);
      })
      .map((m) => {
        const bundle = db.getMenuItemRecipeBundle(Number(m.id));
        return {
          id: m.id,
          name: m.name,
          category: m.category,
          price: m.price,
          description: String(m.description || "").trim(),
          has_recipe: !!bundle?.has_recipe,
          portion_cost: bundle?.portion_cost ?? null,
          profit_per_portion: bundle?.profit_per_portion ?? null,
          portions_available: bundle?.portions_available ?? null,
        };
      });
    res.json({ ok: true, items });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/menu/:id/recipe", auth, adminOnly, (req, res) => {
  try {
    const mid = Number(req.params.id);
    const menu = typeof db.getMenuItemById === "function" ? db.getMenuItemById(mid) : null;
    if (!menuItemEligibleForRecipe(menu)) {
      return res.status(400).json({
        ok: false,
        gabim: "Recetat lejohen vetëm për produkte ushqimi, jo për pije.",
      });
    }
    const recipe = db.getMenuItemRecipeBundle(mid);
    res.json({
      ok: true,
      recipe: {
        ...recipe,
        description: String(menu?.description || "").trim(),
      },
    });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.put("/api/menu/:id/recipe", auth, adminOnly, (req, res) => {
  try {
    const mid = Number(req.params.id);
    const menu = typeof db.getMenuItemById === "function" ? db.getMenuItemById(mid) : null;
    if (!menuItemEligibleForRecipe(menu)) {
      return res.status(400).json({
        ok: false,
        gabim: "Recetat lejohen vetëm për produkte ushqimi, jo për pije.",
      });
    }
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : req.body?.items;
    const recipe = db.setMenuItemRecipe(mid, lines);
    auditReq(req, "Recetë menu", `Artikull #${req.params.id}`);
    res.json({ ok: true, recipe });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/stock-count/targets", auth, adminOnly, (_req, res) => {
  try {
    res.json({ ok: true, targets: db.listStockCountTargets() });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/stock-count/latest", auth, adminOnly, (_req, res) => {
  try {
    res.json({ ok: true, summary: db.getLatestStockCountSummary() });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/stock-count", auth, adminOnly, (req, res) => {
  try {
    const body = req.body || {};
    const result = db.submitStockCount({
      lines: body.lines || body.items,
      operator_name: body.operator_name || req.session?.emri || "Admin",
      operator_role: body.operator_role || req.session?.roli || "admin",
      note: body.note,
    });
    auditReq(req, "Numërim stoku", `${result.lines.length} rreshta`);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/inventory/consumption-variance", auth, adminOnly, (req, res) => {
  try {
    const from = req.query.from || req.query.from_date;
    const to = req.query.to || req.query.to_date;
    const report = db.buildConsumptionVarianceReport({ from, to });
    res.json({ ok: true, report });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
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
      operator_name: req.session?.emri || "Admin",
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

/** Shtesë stoku nga paneli — faturë blerjeje (goods) + stok përmes applyPurchaseStockDelta. */
app.post("/api/stock/add", auth, adminOnly, (req, res) => {
  try {
    const menuItemId = Number(req.body?.menu_item_id ?? req.body?.product_id ?? req.body?.id);
    const qty = Number(req.body?.quantity ?? req.body?.qty ?? req.body?.sasia);
    if (!menuItemId || !Number.isFinite(qty) || !(qty > 0)) {
      return res.status(400).json({ gabim: "Produkt ose sasi e pavlefshme për stok." });
    }
    const menuRow = db.getMenuItemById(menuItemId);
    if (!menuRow) return res.status(400).json({ gabim: "Produkti nuk u gjet" });
    const fromBodyCost = Number(req.body?.unit_price ?? req.body?.cost_price);
    let unitPrice = Number(menuRow.cost_price) || 0;
    if (Number.isFinite(fromBodyCost) && fromBodyCost >= 0) {
      unitPrice = fromBodyCost;
      db.updateMenuItem(menuItemId, { cost_price: unitPrice });
    } else if (unitPrice > 0) {
      unitPrice = Math.max(0, unitPrice);
    } else {
      unitPrice = Math.max(0, Number(menuRow.price) || 0);
    }
    const sellFromBody = Number(req.body?.sell_price ?? req.body?.price);
    if (Number.isFinite(sellFromBody) && sellFromBody >= 0) {
      db.updateMenuPrice(menuItemId, sellFromBody);
    }
    const today = businessTodayYmd();
    const invoice = db.createPurchaseInvoice({
      supplier: "Shtesë manuale (Stoku)",
      invoice_number: `STK-${Date.now()}-${menuItemId}`,
      invoice_date: today,
      purchase_kind: "goods",
      items: [
        {
          menu_item_id: menuItemId,
          quantity: qty,
          unit_price: unitPrice,
        },
      ],
    });
    syncCatalogToCloud();
    const after = db.getMenuItemById(menuItemId);
    auditReq(
      req,
      "Stok + / blerje",
      `${after?.name || menuRow.name} +${qty} → ${after?.stock_qty ?? "?"}`,
    );
    res.json({
      ok: true,
      id: menuItemId,
      name: after?.name || menuRow.name,
      stock_qty: after?.stock_qty ?? menuRow.stock_qty,
      invoice_id: invoice?.id ?? null,
      purchase_registered: true,
    });
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
    db.updateMenuItem(Number(req.params.id), {
      ...req.body,
      operator_name: req.session?.emri || "Admin",
    });
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
    if (photo && String(photo).length > 900_000) {
      return res.status(400).json({ gabim: "Fotoja është shumë e madhe pas kompresimit." });
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
  const data = businessTodayYmd();
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

app.post("/api/tables/:id/clear", auth, adminOnly, async (req, res) => {
  try {
    const tableId = Number(req.params.id);
    const tables = db.getTablesWithOrders();
    const t = tables.find(x => x.id === tableId);
    const order = db.getActiveOrderForTable(tableId);
    const cloudIds = order ? db.getLinkedCloudOrderIds(order.id) : [];
    cloudSync.pushTableCancelled(db, tableId);
    db.cancelActiveOrder(tableId);
    let cloud = null;
    if (t?.number) {
      cloud = await cloudSync.clearStuckCloudTableOrder(db, t.number, {
        cloud_order_ids: cloudIds,
      });
    }
    if (cloud?.still_occupied_in_cloud) {
      return res.status(409).json({
        ok: false,
        gabim: "Cloud ende tregon tavolinë të zënë — kontrolloni lidhjen ose provoni përsëri.",
        cloud,
      });
    }
    res.json({ ok: true, cloud });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/reports", auth, adminOnly, (req, res) => {
  const { from, to } = req.query;
  res.json(db.getReports(from, to));
});

app.get("/api/reports/export", auth, adminOnly, (req, res) => {
  const { from, to } = req.query;
  const txt = db.exportReportText(from, to);
  const data = businessTodayYmd();
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="raporti-${data}.txt"`);
  res.send(txt);
});

app.post("/api/reports/print", auth, adminOnly, async (req, res) => {
  try {
    const sot = businessTodayYmd();
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
    let result;
    if (fiscalConfig.isFiscalEnabled()) {
      result = await getFiscalMain().printFiscalReportText(text, { station: "bar" });
    } else {
      result = await printer.printPlainTextAt(text, db, "bar");
    }
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
    const result = await getFiscalMain().printFiscalReportText(text, { station: "bar" });
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
    const result = await getFiscalMain().printFiscalReportText(text, { station: "bar" });
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
    db.markShiftZReportPrinted(data.shift_id);
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
  const cloudWaiterOn = !isCloudWaiterDisabledSetting();
  let cloudWaiters = [];
  if (cloudWaiterOn) {
    try {
      await cloudSync.pushStaffAsync(db);
    } catch {
      /* ignore */
    }
  }
  if (kdsEnabled || cloudWaiterOn) {
    try {
      cloudWaiters = await license.fetchWaitersList(electronApp());
    } catch {
      cloudWaiters = [];
    }
    if (cloudWaiterOn && !cloudWaiters.length) {
      try {
        await cloudSync.pushStaffAsync(db);
        cloudWaiters = await license.fetchWaitersList(electronApp());
      } catch {
        /* ignore */
      }
    }
  }
  const byStaffKey = new Map(
    cloudWaiters.map(w => [cloudStaffListKey(w.name, w.role === "receptionist" ? "recepsion" : "kamarier"), w]),
  );
  const staffRows = db.getStaff();
  const staffById = new Map(staffRows.map((s) => [Number(s.id), s]));
  res.json({
    kds_enabled: kdsEnabled,
    cloud_waiter_disabled: isCloudWaiterDisabledSetting(),
    staff: staff.map(s => {
      const full = staffById.get(Number(s.id)) || null;
      const cw = cloudWaiterOn ? byStaffKey.get(cloudStaffListKey(s.name, s.staff_role)) : null;
      const cloudUrl = resolveStaffWaiterUrl(cw, full);
      return {
        ...s,
        waiter_url: cloudUrl,
        staff_cloud_url: cloudUrl,
      };
    }),
    active_today: db.getActiveStaffToday(),
  });
});

app.post("/api/staff", auth, adminOnly, (req, res) => {
  const { name, pin } = req.body;
  const staff_role = db.normalizeStaffRole(req.body?.staff_role || req.body?.role || "kamarier");
  if (!name?.trim()) return res.status(400).json({ gabim: "Shkruani emrin e kamarierit" });
  try {
    staffPinPolicy.validateNewStaffPin(pin, staff_role);
  } catch (e) {
    return res.status(400).json({ gabim: e.message });
  }
  try {
    const created = db.addStaff(name, pin, staff_role);
    syncCatalogToCloud();
    void cloudSync.pushStaffAsync(db);
    const full = db.getStaff().find(s => Number(s.id) === Number(created.id));
    const waiter_url = resolveStaffWaiterUrl(null, full || { id: created.id, web_token: created.web_token });
    res.json({ ok: true, staff_id: created.id, waiter_url });
  } catch (e) {
    res.status(400).json({ gabim: e.message.includes("UNIQUE") ? "Ky emër ekziston tashmë" : e.message });
  }
});

app.put("/api/staff/:id", auth, adminOnly, (req, res) => {
  try {
    const id = Number(req.params.id);
    db.updateStaffProfile(id, {
      name: req.body?.name,
      staff_role: req.body?.staff_role ?? req.body?.role,
    });
    syncCatalogToCloud();
    void cloudSync.pushStaffAsync(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/staff/:id/pin", auth, adminOnly, (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ gabim: "Shkruani PIN-in" });
  try {
    const id = Number(req.params.id);
    db.updateStaffPin(id, pin);
    syncCatalogToCloud();
    void cloudSync.pushStaffAsync(db);
    const full = db.getStaff().find(s => Number(s.id) === id);
    res.json({
      ok: true,
      waiter_url: resolveStaffWaiterUrl(null, full),
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/staff/:id/regenerate-link", auth, adminOnly, (req, res) => {
  try {
    const id = Number(req.params.id);
    db.regenerateStaffWebToken(id);
    const full = db.getStaff().find(s => Number(s.id) === id);
    res.json({
      ok: true,
      waiter_url: resolveStaffWaiterUrl(null, full),
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/settings/admin-card", auth, adminOnly, (req, res) => {
  try {
    if (req.body?.clear === true || req.body?.clear_admin_card === true) {
      db.clearAdminCard();
      auditReq(req, "Hequr kartela RFID pronari", "Lokal & llogaria");
      return res.json({ ok: true, ...db.getSettings() });
    }
    const { card_uid } = req.body;
    if (!card_uid?.trim()) return res.status(400).json({ gabim: "Skanoni kartelën RFID" });
    db.updateAdminCard(card_uid);
    auditReq(req, "Regjistruar kartela RFID pronari", "Lokal & llogaria");
    res.json({ ok: true, ...db.getSettings() });
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

app.get("/api/suppliers", auth, adminOnly, (req, res) => {
  const activeOnly = req.query.active === "1" || req.query.active === "true";
  const rows = db.listSuppliersWithBalance(activeOnly);
  res.json({ ok: true, suppliers: rows });
});

app.get("/api/suppliers/:id", auth, adminOnly, (req, res) => {
  try {
    const row = db.getSupplierBalance(Number(req.params.id));
    const payments = db.listSupplierPayments(row.id);
    res.json({ ok: true, supplier: row, payments });
  } catch (e) {
    res.status(404).json({ gabim: e.message });
  }
});

app.post("/api/suppliers", auth, adminOnly, (req, res) => {
  try {
    const supplier = db.upsertSupplier(req.body || {});
    auditReq(req, "Furnitor", supplier.name);
    res.json({ ok: true, supplier: db.getSupplierBalance(supplier.id) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.put("/api/suppliers/:id", auth, adminOnly, (req, res) => {
  try {
    const supplier = db.upsertSupplier({ ...(req.body || {}), id: Number(req.params.id) });
    res.json({ ok: true, supplier: db.getSupplierBalance(supplier.id) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/suppliers/:id/pay", auth, adminOnly, (req, res) => {
  try {
    const supplier = db.addSupplierPayment({
      supplier_id: Number(req.params.id),
      invoice_id: req.body?.invoice_id,
      amount: req.body?.amount,
      paid_at: req.body?.paid_at,
      note: req.body?.note,
    });
    auditReq(req, "Pagesë furnitori", `${supplier.name} · ${Number(req.body?.amount || 0).toFixed(2)} €`);
    res.json({ ok: true, supplier, payments: db.listSupplierPayments(supplier.id) });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/purchases/export/pdf", auth, adminOnly, (req, res) => {
  const { from, to, supplier } = req.query;
  const invoices = db.listPurchases({ from, to, supplier });
  const settings = db.getSettings();
  const period = `${from || "—"} deri ${to || "—"}`;
  const html = buildPurchasesListHtml(invoices, settings.business_name, period);
  res.json({ html, count: invoices.length });
});

// ---- KONTABILISTI (vetëm Pako 3 Premium + AI — jo Pako 1–2) ----
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
      gabim: "Kontabilisti nuk përfshihet në Pako 1–2. Duhet Pako 3 (Premium + AI).",
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
  const data = businessTodayYmd();
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
  const data = businessTodayYmd();
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
  const data = businessTodayYmd();
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
  const data = businessTodayYmd();
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

app.post("/api/purchases/check-duplicate", auth, adminOnly, (req, res) => {
  const duplicate_of = db.findPurchaseInvoiceDuplicate(
    req.body?.supplier,
    req.body?.invoice_number,
  );
  res.json({ ok: true, duplicate_of: duplicate_of || null });
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
      `${invoice.supplier} · ${Number(invoice.total).toFixed(2)} € · ${invoice.invoice_number || ""}`,
    );
    const origNum = String(body.invoice_number || "").trim();
    const duplicate_copy =
      body.allow_duplicate === true &&
      origNum &&
      String(invoice.invoice_number || "").includes("-KOPIE-");
    res.json({
      ok: true,
      invoice,
      kontabilisti: true,
      latest_purchase_date: db.getLatestPurchaseInvoiceDate(),
      duplicate_copy,
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

async function syncHotelQrVenuesToCloudQuiet() {
  try {
    const hotelCloudSync = require("./hotel-cloud-sync");
    if (typeof hotelCloudSync.pushHotelQrVenuesToCloud === "function") {
      await hotelCloudSync.pushHotelQrVenuesToCloud(db);
    }
  } catch (err) {
    console.warn("[hotel-qr-venues] cloud sync:", err.message);
  }
}

app.get("/api/hotel-qr-venues", auth, adminOnly, (_req, res) => {
  try {
    const venues = db.listHotelQrVenues({ activeOnly: false });
    res.json({ ok: true, venues });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/hotel-qr-venues", auth, adminOnly, async (req, res) => {
  try {
    const row = db.createHotelQrVenue(req.body || {});
    await syncHotelQrVenuesToCloudQuiet();
    res.status(201).json({ ok: true, venue: row });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.put("/api/hotel-qr-venues/:id", auth, adminOnly, async (req, res) => {
  try {
    const row = db.updateHotelQrVenue(req.params.id, req.body || {});
    await syncHotelQrVenuesToCloudQuiet();
    res.json({ ok: true, venue: row });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.delete("/api/hotel-qr-venues/:id", auth, adminOnly, async (req, res) => {
  try {
    const result = db.deleteHotelQrVenue(req.params.id);
    await syncHotelQrVenuesToCloudQuiet();
    res.json({ ok: true, ...result });
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

/** Katalog publik — i njëjti si /api/menu + /api/waiter/services (sinkron me panelin). */
app.get("/api/guest/menu/:id/photo", mapGuestMenuPhoto);

app.get("/api/guest/services/:id/photo", mapGuestServicePhoto);

app.get("/api/guest/menu", (req, res) => {
  try {
    let { items, categories } = buildMenuCatalogPayload(true);
    const categoryFilter = String(req.query.category || "").trim();
    if (categoryFilter) {
      const want = categoryFilter.toLowerCase();
      items = items.filter(
        (it) => String(it.category || "").trim().toLowerCase() === want,
      );
      categories = categories.filter((c) => String(c || "").trim().toLowerCase() === want);
      if (!categories.length && items.length) categories = [categoryFilter];
    }
    const settings = db.getSettings();
    const hotelName =
      db.getBusinessDisplayName?.()
      || settings.business_display_name
      || settings.business_name
      || settings.restaurant_name
      || "Hotel";
    res.json({
      ok: true,
      source: "restaurant_menu",
      hotel_name: hotelName,
      categories,
      items: items.map(toGuestMenuItemDto),
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.get("/api/guest/services", (_req, res) => {
  try {
    ensureServicesCatalogReady();
    const catalog = db.listHotelServicesCatalog({ activeOnly: true });
    const settings = db.getSettings();
    const groups = buildGuestServicesGroups(catalog);
    res.json({
      ok: true,
      source: "hotel_services",
      hotel_name: settings.business_name || settings.restaurant_name || "Hotel",
      groups,
      categories: catalog.categories || [],
      services: (catalog.services || []).map(toGuestServiceDto),
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.post("/api/guest/room-order", (req, res) => {
  try {
    const roomNumber = String(req.body?.room_number || req.body?.room || "").trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const result = db.submitGuestRoomMenuOrder(roomNumber, items);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/guest/service-order", (req, res) => {
  try {
    const roomNumber = String(req.body?.room_number || req.body?.room || "").trim();
    const raw = Array.isArray(req.body?.services) ? req.body.services : [];
    if (!raw.length && req.body?.service_id) {
      raw.push({
        service_id: req.body.service_id,
        quantity: req.body.quantity,
        amount: req.body.amount,
        notes: req.body.notes,
      });
    }
    const result = db.submitGuestRoomServiceOrder(roomNumber, raw);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/guest/menu-order", (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const roomNumber = String(req.body?.room_number || req.body?.room || "").trim();
    const tableNumber = req.body?.table_number ?? req.body?.table;
    if (roomNumber) {
      const result = db.submitGuestRoomMenuOrder(roomNumber, items);
      return res.status(201).json(result);
    }
    const result = db.submitGuestPublicMenuOrder({
      items,
      order_kind: tableNumber != null && String(tableNumber).trim() !== "" ? "table" : "takeaway",
      table_number: tableNumber,
      customer_name: req.body?.customer_name || req.body?.name,
      customer_phone: req.body?.customer_phone || req.body?.phone,
    });
    notifyWaitersRealtime("online_orders", { reason: "guest_menu" });
    res.status(201).json(result);
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
    const adminPwPlain =
      req.body?.admin_password != null ? String(req.body.admin_password).trim() : "";
    db.updateSettings(req.body);
    if (adminPwPlain) {
      cloudSync.pushOwnerAdminPasswordAsync(db, adminPwPlain).catch(err => {
        console.warn("[settings] push owner admin password:", err.message || err);
      });
    }
    syncCatalogToCloud();
    auditReq(req, "Ndryshim cilësimesh", "Lokal & biznesi");
    res.json({ ok: true, ...db.getSettings() });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/cloud/status", (_req, res) => {
  try {
    res.json(cloudAutoSync.getStatus(db));
  } catch (e) {
    res.status(500).json({ ok: false, connected: false, message: e.message });
  }
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

const CLOUD_ADMIN_LINK_KEYS = new Set([
  "waiter_url",
  "reception_url",
  "bar_url",
  "kitchen_url",
  "kiosk_url",
  "public_page_url",
  "takeaway_url",
  "public_order_url",
  "owner_url",
  "owner_panel_url",
  "housekeeping_url",
  "kitchen_slug",
  "kitchen_key",
  "client_tipi",
  "client_id",
  "client_name",
]);

function stripLicenseLinkFieldsFromExtra(extra = {}) {
  const out = { ...extra };
  CLOUD_ADMIN_LINK_KEYS.forEach((k) => {
    delete out[k];
  });
  if (out.sync && typeof out.sync === "object") {
    const sync = { ...out.sync };
    CLOUD_ADMIN_LINK_KEYS.forEach((k) => {
      delete sync[k];
    });
    out.sync = sync;
  }
  return out;
}

/** Admin «Linke stafi» — i njëjti format si paneli i pronarit (/hotel/{slug}/…). */
function mergeCloudSyncAdminResponse(settings, status, extra = {}) {
  const links = cloudSyncLinksPayload(settings, status);
  const safeExtra = stripLicenseLinkFieldsFromExtra(extra);
  return {
    ok: status.ok !== false,
    connected: links.connected,
    offline: links.offline,
    cloud_license_key: settings.cloud_license_key,
    celesi: settings.cloud_license_key,
    device_id: settings.device_id,
    server_url: settings.cloud_server_url || links.public_server,
    message: status.message,
    status_message: links.status_message,
    ...safeExtra,
    ...links,
  };
}

app.get("/api/cloud-sync", auth, adminOnly, async (_req, res) => {
  try {
    const settings = db.getCloudSettings();
    const status = await cloudSync.checkConnection(db);
    res.json(mergeCloudSyncAdminResponse(settings, status));
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.put("/api/cloud-sync", auth, adminOnly, async (req, res) => {
  try {
    db.updateCloudSettings(req.body);
    const settings = db.getCloudSettings();
    const sync = await cloudSync.fullCloudSync(db);
    const status = await cloudSync.checkConnection(db);
    res.json(mergeCloudSyncAdminResponse(settings, status, { sync }));
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.post("/api/cloud-sync/test", auth, adminOnly, async (_req, res) => {
  try {
    const sync = await cloudSync.fullCloudSync(db);
    const settings = db.getCloudSettings();
    const status = await cloudSync.checkConnection(db);
    res.json(mergeCloudSyncAdminResponse(settings, status, { sync }));
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.post("/api/cloud-sync/push-guest-stays", auth, adminOnly, async (_req, res) => {
  try {
    const hotelCloudSync = require("./hotel-cloud-sync");
    const result = await hotelCloudSync.pushGuestStaySnapshotToCloud(db);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim." });
  }
});

app.post("/api/cloud-sync/sync-all", auth, adminOnly, async (_req, res) => {
  try {
    const sync = await cloudSync.fullCloudSync(db);
    const settings = db.getCloudSettings();
    const status = await cloudSync.checkConnection(db);
    res.json(mergeCloudSyncAdminResponse(settings, status, {
      ok: sync.connected || sync.catalog_ok,
      sync,
    }));
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

function handleGetFiscalSettingsLegacy(req, res) {
  res.json(db.getFiscalSettings());
}

function handleGetFiscalSettingsSlash(req, res) {
  try {
    const { getSefIdentifier } = require("./fiscal/fiscal-numbering");
    const { getAtkStatus } = require("./fiscal/fiscal-atk-api");
    const { isAtkTestMode } = require("./fiscal/fiscal-test-mode-store");
    const { isAtkAutoSendEnabled } = require("./fiscal/fiscal-offline");
    const s = fiscalConfig.getFiscalSettings();
    const atkAuto = isAtkAutoSendEnabled();
    const atkTestMode = isAtkTestMode();
    res.json({
      ok: true,
      settings: {
        ...s,
        sef_identifier_computed: getSefIdentifier() || "",
        atk_auto_send: atkAuto ? "1" : "0",
        atk_test_mode: atkTestMode ? "1" : "0",
      },
      atk: { ...getAtkStatus(), atk_auto_send: atkAuto, atk_test_mode: atkTestMode },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, gabim: e.message });
  }
}

app.get("/api/fiscal-settings", auth, adminOnly, handleGetFiscalSettingsLegacy);
app.get("/api/fiscal/settings", auth, adminOnly, handleGetFiscalSettingsSlash);

function handlePutFiscalSettingsLegacy(req, res) {
  try {
    const beforeSnap = fiscalAudit.snapshotFiscalSettingsState(db);
    db.updateFiscalSettings(req.body);
    auditFiscalSettingsIfChanged(req, beforeSnap, "PUT /api/fiscal-settings");
    res.json({ ok: true, ...db.getFiscalSettings() });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
}

async function handlePutFiscalSettingsSlash(req, res) {
  try {
    const beforeSnap = fiscalAudit.snapshotFiscalSettingsState(db);
    const body = { ...(req.body || {}) };
    if (body.atk_auto_send !== undefined) {
      const autoOn =
        body.atk_auto_send === true ||
        body.atk_auto_send === 1 ||
        body.atk_auto_send === "1" ||
        body.atk_auto_send === "on";
      db.setSetting("atk_auto_send", autoOn ? "1" : "0");
      if (autoOn) db.setSetting("atk_send_allowed", "1");
    }
    if (body.atk_send_allowed !== undefined) {
      const on =
        body.atk_send_allowed === true ||
        body.atk_send_allowed === 1 ||
        body.atk_send_allowed === "1" ||
        body.atk_send_allowed === "on";
      db.setSetting("atk_send_allowed", on ? "1" : "0");
      if (!on) db.setSetting("atk_auto_send", "0");
    }
    if (body.atk_test_mode !== undefined) {
      const on =
        body.atk_test_mode === true ||
        body.atk_test_mode === 1 ||
        body.atk_test_mode === "1" ||
        body.atk_test_mode === "on";
      db.setSetting("atk_test_mode", on ? "1" : "0");
    }
    if (fiscalConfig.isFiscalReleaseLocked?.()) {
      body.fiscal_enabled = false;
    }
    const saved = fiscalConfig.saveFiscalSettings(body);
    try {
      const { syncAtkTransmissionFromSettings } = require("./fiscal/fiscal-boot");
      syncAtkTransmissionFromSettings(db);
    } catch (e) {
      console.warn("[fiscal] ATK sync pas ruajtjes:", e.message);
    }
    try {
      if (saved.fiscal_enabled) {
        fiscalOffline.startOfflineMonitor();
      } else {
        fiscalOffline.stopOfflineMonitor();
      }
    } catch (e) {
      console.warn("[fiscal-offline] toggle:", e.message);
    }
    const { getAtkStatus } = require("./fiscal/fiscal-atk-api");
    const { isAtkTestMode } = require("./fiscal/fiscal-test-mode-store");
    const { isAtkAutoSendEnabled } = require("./fiscal/fiscal-offline");
    const atkAuto = isAtkAutoSendEnabled();
    const atkTestMode = isAtkTestMode();
    let pendingFlush = null;
    if (atkAuto && !require("./fiscal/fiscal-test-mode-store").isAtkTransmissionBlocked()) {
      try {
        const { processOfflineQueue } = require("./fiscal/fiscal-offline");
        pendingFlush = await processOfflineQueue({ manual: true });
      } catch (e) {
        pendingFlush = { processed: 0, error: e.message };
      }
    }
    auditFiscalSettingsIfChanged(req, beforeSnap, "PUT /api/fiscal/settings");
    res.json({
      ok: true,
      settings: {
        ...saved,
        atk_auto_send: atkAuto ? "1" : "0",
        atk_test_mode: atkTestMode ? "1" : "0",
      },
      atk: { ...getAtkStatus(), atk_auto_send: atkAuto, atk_test_mode: atkTestMode },
      pending_flush: pendingFlush,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, gabim: e.message });
  }
}

app.put("/api/fiscal-settings", auth, adminOnly, handlePutFiscalSettingsLegacy);
app.put("/api/fiscal/settings", auth, adminOnly, handlePutFiscalSettingsSlash);

/* HAPI 2 — SEF fiscal_settings (vetëm pronari / admin) */
function fiscalDevToolsForbidden(res) {
  if (typeof fiscalConfig.isFiscalDevToolsEnabled === "function" && fiscalConfig.isFiscalDevToolsEnabled()) {
    return false;
  }
  res.status(403).json({
    ok: false,
    gabim: "Mjetet e testit fiskal janë vetëm për mjedisin biznes (SEF test).",
  });
  return true;
}

app.get("/api/fiscal-config", auth, adminOnly, (_req, res) => {
  try {
    const settings = fiscalConfig.getFiscalSettings();
    const missing = fiscalConfig.getMissingFiscalProfileFields?.(settings) || [];
    res.json({
      ...settings,
      activation: fiscalConfig.getFiscalActivationCheck(settings),
      fiscal_release_locked: !!fiscalConfig.isFiscalReleaseLocked?.(),
      fiscal_profile_complete: !!fiscalConfig.isFiscalProfileComplete?.(settings),
      fiscal_missing_fields: missing,
      fiscal_local_only: !!fiscalTestMode.isLocalPrintOnly?.(),
      dev_tools_enabled: !!fiscalConfig.isFiscalDevToolsEnabled?.(),
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

app.put("/api/fiscal-config", auth, adminOnly, (req, res) => {
  try {
    const beforeSnap = fiscalAudit.snapshotFiscalSettingsState(db);
    const body = { ...(req.body || {}) };
    if (fiscalConfig.isFiscalReleaseLocked?.()) {
      body.fiscal_enabled = false;
    }
    const saved = fiscalConfig.saveFiscalSettings(body);
    const missing = fiscalConfig.getMissingFiscalProfileFields?.(saved) || [];
    try {
      if (saved.fiscal_enabled) {
        fiscalOffline.startOfflineMonitor();
      } else {
        fiscalOffline.stopOfflineMonitor();
      }
    } catch (e) {
      console.warn("[fiscal-offline] toggle:", e.message);
    }
    auditFiscalSettingsIfChanged(req, beforeSnap, "PUT /api/fiscal-config");
    res.json({
      ok: true,
      ...saved,
      activation: fiscalConfig.getFiscalActivationCheck(saved),
      fiscal_release_locked: !!fiscalConfig.isFiscalReleaseLocked?.(),
      fiscal_profile_complete: !!fiscalConfig.isFiscalProfileComplete?.(saved),
      fiscal_missing_fields: missing,
      fiscal_local_only: !!fiscalTestMode.isLocalPrintOnly?.(),
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

app.get("/api/fiscal/atk-status", auth, adminOnly, async (_req, res) => {
  try {
    try {
      if (typeof fiscalOffline.checkInternetConnection === "function") {
        await fiscalOffline.checkInternetConnection();
      }
    } catch {
      /* */
    }
    let offline = null;
    let offlineWarning = null;
    try {
      offline = fiscalOffline.getOfflineStatus?.() || null;
      offlineWarning = fiscalOffline.getOfflineWarning?.() || null;
    } catch {
      /* */
    }
    res.json({
      ok: true,
      atk: getAtkStatus(),
      offline,
      offline_warning: offlineWarning,
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/fiscal/open-keys-folder", auth, adminOnly, (_req, res) => {
  try {
    const dir = getKeysDir();
    fs.mkdirSync(dir, { recursive: true });
    const { exec } = require("child_process");
    exec(`explorer "${dir.replace(/"/g, "")}"`);
    res.json({ ok: true, keys_dir: dir });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/fiscal/onboard-atk", auth, adminOnly, async (req, res) => {
  const { onboardPosAtAtk } = require("./fiscal/fiscal-onboarding");
  const beforeOnboardSnap = fiscalAudit.snapshotFiscalSettingsState(db);
  try {
    const settings = fiscalConfig.getFiscalSettings();
    if (!settings?.taxpayer_nui || String(settings.taxpayer_nui).length !== 9) {
      return res.status(400).json({
        success: false,
        error: "Plotëso NUI (9 shifra) te Fiskalizimi para onboarding.",
      });
    }
    if (!settings.fiscalization_number) {
      return res.status(400).json({
        success: false,
        error: "Plotëso Numrin e Fiskalizimit te Fiskalizimi.",
      });
    }
    if (!settings.pos_id) {
      return res.status(400).json({ success: false, error: "Plotëso POS ID te Fiskalizimi." });
    }
    if (!settings.application_id) {
      return res.status(400).json({
        success: false,
        error: "Plotëso Application ID te Lidhja me ATK.",
      });
    }
    if (!settings.business_unit_number && !settings.unit_number) {
      return res.status(400).json({
        success: false,
        error: "Plotëso Numrin e Njësisë ARBK te Fiskalizimi.",
      });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const onboardSettings = {
      ...settings,
      ...(body.pos_id != null && String(body.pos_id).trim() !== ""
        ? { pos_id: String(body.pos_id).trim() }
        : {}),
      ...(body.business_unit_number != null &&
      String(body.business_unit_number).trim() !== ""
        ? {
            business_unit_number: String(body.business_unit_number).trim(),
            unit_number: String(body.business_unit_number).trim(),
          }
        : {}),
      ...(body.fiscalization_number != null &&
      String(body.fiscalization_number).trim() !== ""
        ? { fiscalization_number: String(body.fiscalization_number).trim() }
        : {}),
      ...(body.application_id != null && String(body.application_id).trim() !== ""
        ? { application_id: String(body.application_id).trim() }
        : {}),
      ...(body.atk_api_url != null && String(body.atk_api_url).trim() !== ""
        ? { atk_api_url: String(body.atk_api_url).trim() }
        : {}),
    };

    if (
      body.pos_id != null ||
      body.business_unit_number != null ||
      body.application_id != null ||
      body.fiscalization_number != null ||
      body.atk_api_url != null
    ) {
      fiscalConfig.saveFiscalSettings({
        pos_id: onboardSettings.pos_id,
        business_unit_number: onboardSettings.business_unit_number,
        unit_number: onboardSettings.unit_number,
        fiscalization_number: onboardSettings.fiscalization_number,
        application_id: onboardSettings.application_id,
        atk_api_url: onboardSettings.atk_api_url,
        fiscal_enabled: true,
      });
    }

    const atkNow = getAtkStatus();
    const { compareCertWithSettings } = require("./fiscal/fiscal-crypto");
    const certMatch = compareCertWithSettings(
      onboardSettings,
      atkNow.certificate_path || ""
    );
    if (
      atkNow.ready_for_atk &&
      !atkNow.certificate_is_placeholder &&
      certMatch.match &&
      req.body?.force !== true
    ) {
      db.setSetting("atk_send_allowed", "1");
      db.setSetting("atk_auto_send", "1");
      const { syncAtkTransmissionFromSettings } = require("./fiscal/fiscal-boot");
      syncAtkTransmissionFromSettings(db);
      auditFiscalSettingsIfChanged(
        req,
        beforeOnboardSnap,
        "POST /api/fiscal/onboard-atk (already_connected)"
      );
      return res.json({
        success: true,
        already_connected: true,
        business_name: onboardSettings.taxpayer_legal_name || "—",
        certificate_path: atkNow.certificate_path || "",
        message: "Ky POS është tashmë i lidhur me ATK.",
        atk_sync: { allowed: true, auto_send: true },
      });
    }

    const result = await onboardPosAtAtk(onboardSettings);
    if (result && result.success !== false) {
      db.setSetting("atk_send_allowed", "1");
      db.setSetting("atk_auto_send", "1");
      const { syncAtkTransmissionFromSettings } = require("./fiscal/fiscal-boot");
      syncAtkTransmissionFromSettings(db);
      result.atk_sync = { allowed: true, auto_send: true };
      if (result.business_name && !onboardSettings.taxpayer_legal_name) {
        fiscalConfig.saveFiscalSettings({
          taxpayer_legal_name: result.business_name,
        });
      }
      auditFiscalSettingsIfChanged(req, beforeOnboardSnap, "POST /api/fiscal/onboard-atk");
    } else if (
      body.pos_id != null ||
      body.business_unit_number != null ||
      body.application_id != null ||
      body.fiscalization_number != null ||
      body.atk_api_url != null
    ) {
      auditFiscalSettingsIfChanged(
        req,
        beforeOnboardSnap,
        "POST /api/fiscal/onboard-atk (settings_only)"
      );
    }
    res.json(result);
  } catch (err) {
    console.error("[ATK Onboard Error]", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/fiscal/x-report", auth, adminOnly, async (req, res) => {
  try {
    const settings = fiscalConfig.getFiscalSettings();
    const operatorName = req.body?.operator_name || "Operator";
    const operatorId = resolveBodyOperatorId(req);
    const details = fiscalNumbering.getXReportSnapshot(operatorName, operatorId);
    if (!details) throw new Error("Fiskalizimi nuk është aktiv");

    const text = buildXReportText(details, settings);
    let printed = false;
    let printMessage = "";
    if (!req.body?.skip_print) {
      try {
        const pr = await getFiscalMain().printFiscalReportText(text, {
          reportDetails: details,
          reportMode: "X",
          operatorId,
        });
        printed = pr.printed;
        if (!pr.printed) printMessage = pr.printMessage || "Printimi X dështoi";
      } catch (pe) {
        printMessage = pe.message || "Printimi X dështoi";
      }
    }

    res.json({
      ok: true,
      details: { ...details, sef_id: fiscalNumbering.getSefIdentifier() || "" },
      text,
      printed,
      printMessage,
    });
  } catch (e) {
    console.error("[x-report]", e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

async function getFiscalZReportReminderPayload() {
  const { getZReportReminderStatusAsync } = require("./fiscal/fiscal-z-reminder");
  return getZReportReminderStatusAsync(db);
}

/** Raporti Z i ndërrimit (pa ATK) — për lokale pa fiskal ose si fallback. */
async function printClosedShiftZReport(shiftId) {
  const data = db.buildZReportData(shiftId);
  const settings = db.getSettings();
  const fiscal = db.getFiscalSettings();
  const venueName =
    String(settings.business_name || settings.restaurant_name || "").trim() || "Revolution HOTEL";
  const html = buildZReportHtml({ fiscal, restaurantName: venueName, data });
  const text = buildZReportLines({ fiscal, restaurantName: venueName, data }).join("\n");
  let printResult;
  try {
    printResult = await printer.printReceiptAt(html, db, "fiscal");
  } catch {
    printResult = await printer.printPlainTextAt(text, db, "bar");
  }
  db.markShiftZReportPrinted(data.shift_id);
  return {
    data,
    text,
    printed: printResult?.printed !== false,
    printMessage: printResult?.printMessage || printResult?.message || "",
    printResult,
  };
}

async function postFiscalZReportHandler(req, res) {
  try {
    const settings = fiscalConfig.getFiscalSettings();
    const sessionName = String(req.session?.emri || "").trim();
    const operatorName = String(req.body?.operator_name || sessionName || "Operator").trim();
    const operatorId = resolveBodyOperatorId(req);
    const reportDate = String(req.body?.report_date || req.body?.business_date || "").slice(0, 10);
    const zOpts = /^\d{4}-\d{2}-\d{2}$/.test(reportDate) ? { dateYmd: reportDate } : {};
    const fiscalOn = fiscalConfig.isFiscalEnabled();
    const skipPrint = !!req.body?.skip_print;

    let details = null;
    let text = "";
    let printed = false;
    let printMessage = "";
    let shiftReport = null;
    let shiftsMarked = 0;

    if (fiscalOn) {
      details = fiscalNumbering.onDailySummaryPrinted(operatorName, operatorId, zOpts);
      if (!details) throw new Error("Fiskalizimi nuk është aktiv");

      text = buildZReportText(details, settings);
      if (!skipPrint) {
        try {
          const pr = await getFiscalMain().printFiscalReportText(text, {
            reportDetails: details,
            reportMode: "Z",
            operatorId,
          });
          printed = pr.printed;
          if (!pr.printed) printMessage = pr.printMessage || "Printimi Z dështoi";
        } catch (pe) {
          printMessage = pe.message || "Printimi Z dështoi";
        }
      }
      shiftsMarked = db.markAllPendingShiftZReportsPrinted();
    } else {
      const pending = db.getUnprintedClosedZShift();
      if (!pending) {
        throw new Error("Nuk ka ndërrim të mbyllur që pret Raportin Z.");
      }
      if (!skipPrint) {
        shiftReport = await printClosedShiftZReport(pending.id);
        text = shiftReport.text;
        printed = shiftReport.printed;
        printMessage = shiftReport.printMessage || "";
        shiftsMarked = 1;
      } else {
        shiftsMarked = db.markAllPendingShiftZReportsPrinted();
      }
    }

    const enrichedDetails = details
      ? { ...details, sef_id: fiscalNumbering.getSefIdentifier() || "" }
      : null;
    let delivery = null;
    if (fiscalOn && enrichedDetails) {
      try {
        const { processZReportDelivery } = require("./fiscal/fiscal-z-report-atk");
        delivery = await processZReportDelivery({
          text,
          details: enrichedDetails,
          settings,
          operator_name: operatorName,
          operator_id: operatorId,
          manual: false,
        });
      } catch (de) {
        console.warn("[z-report] delivery:", de.message || de);
      }
    }

    const role = String(req.session?.role || "").trim().toLowerCase();
    if (role && role !== "admin") {
      auditReq(req, "Raporti Z (staf)", operatorName);
    }

    res.json({
      ok: true,
      details: enrichedDetails,
      shift_report: shiftReport?.data || null,
      shifts_marked: shiftsMarked,
      text,
      printed,
      printMessage,
      delivery,
    });
  } catch (e) {
    console.error("[z-report]", e);
    const msg = e.message || "Raporti Z dështoi";
    res.status(400).json({ ok: false, gabim: msg, error: msg });
  }
}

app.get("/api/fiscal/z-report/reminder", auth, adminOnly, async (req, res) => {
  try {
    const status = await getFiscalZReportReminderPayload();
    res.json({ ok: true, ...status });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/fiscal/z-report", auth, adminOnly, postFiscalZReportHandler);

app.get("/api/staff/fiscal/z-report/reminder", auth, staffOrAdmin, async (req, res) => {
  try {
    const status = await getFiscalZReportReminderPayload();
    res.json({ ok: true, ...status });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/staff/fiscal/z-report", auth, staffOrAdmin, postFiscalZReportHandler);

app.post("/api/fiscal/z-report/send-atk", auth, adminOnly, async (req, res) => {
  try {
    const {
      processZReportDelivery,
      getLatestZReportForSend,
      ATK_Z_UNSUPPORTED_MSG,
    } = require("./fiscal/fiscal-z-report-atk");
    const settings = fiscalConfig.getFiscalSettings();
    const operatorName = req.body?.operator_name || "Operator";
    const operatorId = resolveBodyOperatorId(req);

    const latest = getLatestZReportForSend();
    if (!latest) {
      return res.status(400).json({
        ok: false,
        error: "Nuk ka Raport Z — gjeneroni Raportin Z së pari.",
      });
    }

    let text = String(latest.text || "").trim();
    const details = { ...(latest.details || {}), sef_id: fiscalNumbering.getSefIdentifier() || "" };
    if (!text) {
      text = buildZReportText(details, settings);
    }

    const delivery = await processZReportDelivery({
      text,
      details,
      settings,
      operator_name: operatorName,
      operator_id: operatorId,
      manual: true,
    });

    res.json({
      ok: true,
      delivery,
      message: delivery.atk_message || ATK_Z_UNSUPPORTED_MSG,
    });
  } catch (e) {
    console.error("[z-report/send-atk]", e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** Raport periodik (mes dy datave) */
app.post("/api/fiscal/periodic-report", auth, adminOnly, async (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const settings = fiscalConfig.getFiscalSettings();
    const operatorName = req.body?.operator_name || req.session?.emri || "Admin";
    const operatorId = resolveBodyOperatorId(req);
    const details = fiscalNumbering.getPeriodicFiscalReport(
      req.body?.from || req.body?.from_date,
      req.body?.to || req.body?.to_date,
      operatorName,
      operatorId
    );
    if (!details) throw new Error("Fiskalizimi nuk është aktiv");
    const text = buildFiscalDayReportText(details, settings, "PERIODIC");
    let printed = false;
    let printMessage = "";
    if (!req.body?.skip_print) {
      try {
        const pr = await getFiscalMain().printFiscalReportText(text, {
          reportDetails: details,
          reportMode: "PERIODIC",
          operatorId,
        });
        printed = !!pr.printed;
        if (!pr.printed) printMessage = pr.printMessage || "Printimi periodik dështoi";
      } catch (pe) {
        printMessage = pe.message || "Printimi periodik dështoi";
      }
    }
    res.json({
      ok: true,
      details: { ...details, sef_id: fiscalNumbering.getSefIdentifier() || "" },
      text,
      printed,
      printMessage,
    });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message, error: e.message });
  }
});

/** Raport i shkurtër periodik (Neni 13 / 7) */
app.post("/api/fiscal/short-periodic-report", auth, adminOnly, async (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const settings = fiscalConfig.getFiscalSettings();
    const operatorName = req.body?.operator_name || req.session?.emri || "Admin";
    const operatorId = resolveBodyOperatorId(req);
    const details = fiscalNumbering.getShortPeriodicFiscalReport(
      req.body?.from || req.body?.from_date,
      req.body?.to || req.body?.to_date,
      operatorName,
      operatorId
    );
    if (!details) throw new Error("Fiskalizimi nuk është aktiv");
    const text = buildShortPeriodicReportText(details, settings);
    let printed = false;
    let printMessage = "";
    if (!req.body?.skip_print) {
      try {
        const pr = await getFiscalMain().printFiscalReportText(text);
        printed = !!pr.printed;
        if (!pr.printed) printMessage = pr.printMessage || "Printimi i raportit të shkurtër dështoi";
      } catch (pe) {
        printMessage = pe.message || "Printimi i raportit të shkurtër dështoi";
      }
    }
    res.json({
      ok: true,
      details: { ...details, sef_id: fiscalNumbering.getSefIdentifier() || "" },
      text,
      printed,
      printMessage,
    });
  } catch (e) {
    console.error("[short-periodic]", e);
    res.status(400).json({ ok: false, gabim: e.message, error: e.message });
  }
});

/** Raporti mujor i memories fiskale → ATK (Neni 11 / 9) */
app.post("/api/fiscal/monthly-memory-report", auth, adminOnly, async (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const from = req.body?.from || req.body?.from_date;
    const to = req.body?.to || req.body?.to_date;
    const { from: periodFrom, to: periodTo } = fiscalNumbering.resolveMonthlyReportPeriod(from, to);

    const transmission_flush = await fiscalOffline.processPendingForPeriod(periodFrom, periodTo, {
      manual: true,
    });

    const settings = fiscalConfig.getFiscalSettings();
    const operatorName = req.body?.operator_name || req.session?.emri || "Admin";
    const operatorId = resolveBodyOperatorId(req);
    const details = fiscalNumbering.getMonthlyFiscalMemoryReport(from, to, operatorName, operatorId);
    if (!details) throw new Error("Fiskalizimi nuk është aktiv");
    const text = buildMonthlyMemoryReportText(details, settings);
    let printed = false;
    let printMessage = "";
    if (!req.body?.skip_print) {
      try {
        const pr = await getFiscalMain().printFiscalReportText(text);
        printed = !!pr.printed;
        if (!pr.printed) printMessage = pr.printMessage || "Printimi i raportit mujor dështoi";
      } catch (pe) {
        printMessage = pe.message || "Printimi i raportit mujor dështoi";
      }
    }
    res.json({
      ok: true,
      details: {
        ...details,
        sef_id: fiscalNumbering.getSefIdentifier() || "",
        transmission_flush,
      },
      text,
      printed,
      printMessage,
    });
  } catch (e) {
    console.error("[monthly-memory]", e);
    res.status(400).json({ ok: false, gabim: e.message, error: e.message });
  }
});

function enrichFiscalReceiptRowsForApi(rows) {
  const { isAtkTransmissionBlocked } = require("./fiscal/fiscal-test-mode-store");
  const atkBlocked = isAtkTransmissionBlocked();
  return (rows || []).map((r) => ({
    ...r,
    sent_to_atk: r.sent_to_atk ? 1 : 0,
    is_offline: r.is_offline ? 1 : 0,
    atk_label: atkBlocked
      ? Number(r.sent_to_atk) === 1
        ? "ATK OK"
        : "LOKAL"
      : Number(r.sent_to_atk) === 1
        ? "ATK OK"
        : Number(r.is_offline) === 1
          ? "OFFLINE"
          : "Në pritje",
    atk_ok: Number(r.sent_to_atk) === 1,
  }));
}

function handleGetFiscalReceiptsList(req, res) {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const limit = Number(req.query.limit) || 500;
    const raw = getFiscalReceiptsList().listFiscalReceipts(limit) || [];
    const receipts = enrichFiscalReceiptRowsForApi(raw);
    res.json({ ok: true, count: receipts.length, receipts });
  } catch (e) {
    res.status(500).json({ gabim: e.message, error: e.message });
  }
}

/* Lista e kuponëve fiskalë — vetëm pronari (+ alias path BIZNES) */
app.get("/api/fiscal-receipts", auth, adminOnly, handleGetFiscalReceiptsList);
app.get("/api/fiscal/receipts", auth, adminOnly, handleGetFiscalReceiptsList);

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

/** Dërgim elektronik i kuponit te konsumatori (email via revolution-restaurant-server). */
async function postFiscalReceiptEmailHandler(req, res) {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const { emailFiscalReceiptToConsumer } = require("./fiscal/fiscal-receipt-email");
    const email = String(req.body?.email || "").trim();
    const result = await emailFiscalReceiptToConsumer({
      receipt_id: req.params.id,
      email,
      operator_name: req.body?.operator_name || req.session?.emri || "Admin",
      operator_id: req.body?.operator_id || "ADMIN",
    });
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        gabim: result.error,
        error: result.error,
        nuikf: result.nuikf,
      });
    }
    res.json({
      ok: true,
      nuikf: result.nuikf,
      email: result.email,
      message: result.message || "Kuponi u dërgua me email.",
    });
  } catch (e) {
    console.error("[receipt/email]", e);
    res.status(400).json({ ok: false, gabim: e.message || "Dërgimi i emailit dështoi" });
  }
}

app.post("/api/fiscal/receipts/:id/email", auth, adminOnly, postFiscalReceiptEmailHandler);
app.post("/api/fiscal-receipts/:id/email", auth, adminOnly, postFiscalReceiptEmailHandler);

/** Reprint origjinal (pas Preview) — pa INSERT të ri; mbështet print_text nga preview si BIZNES. */
async function postFiscalReceiptPrintHandler(req, res) {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    let reprint;
    if (req.body?.print_text && req.body?.nuikf) {
      reprint = {
        id: Number(req.params.id) || 0,
        print_text: String(req.body.print_text),
        nuikf: String(req.body.nuikf).trim().toUpperCase(),
        total_amount: Number(req.body.total_amount) || 0,
        fiscal_date: String(req.body.fiscal_date || ""),
        taxpayer_nui: String(req.body.taxpayer_nui || ""),
      };
    } else {
      reprint = getFiscalReceiptsList().prepareFiscalReceiptReprint(req.params.id);
    }
    const { generateFiscalQR } = require("./fiscal/fiscal-qr");
    const settings = fiscalConfig.getFiscalSettings();
    let qrResult = null;
    try {
      qrResult = await generateFiscalQR({
        nuikf: reprint.nuikf,
        total_amount: reprint.total_amount,
        fiscal_date: reprint.fiscal_date,
        taxpayer_nui: reprint.taxpayer_nui || settings?.taxpayer_nui || "",
      });
    } catch (qe) {
      console.warn("[fiscal-receipts print] QR:", qe.message);
    }
    let printed = false;
    let printMessage = "";
    let printMethod = "";
    if (!req.body?.skip_print) {
      const pr = await getFiscalMain().printFiscalBundle(reprint.print_text, qrResult);
      printed = !!pr?.printed;
      printMessage = pr?.printMessage || "";
      printMethod = pr?.printMethod || "";
    }
    res.json({
      ok: true,
      receipt_id: reprint.id,
      nuikf: reprint.nuikf,
      text: reprint.print_text,
      printed,
      printMessage,
      printMethod,
    });
  } catch (e) {
    const code = /nuk u gjet|pavlefshëm/i.test(e.message) ? 404 : 400;
    res.status(code).json({ ok: false, gabim: e.message, error: e.message });
  }
}

app.post("/api/fiscal-receipts/:id/print", auth, adminOnly, postFiscalReceiptPrintHandler);
app.post("/api/fiscal/receipts/:id/print", auth, adminOnly, postFiscalReceiptPrintHandler);

/** Dërgim manual i radhës offline te ATK (BIZNES: POST /api/fiscal/send-pending) */
app.post("/api/fiscal/send-pending", auth, adminOnly, async (_req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const { isAtkTransmissionBlocked } = require("./fiscal/fiscal-test-mode-store");
    if (isAtkTransmissionBlocked()) {
      return res.status(403).json({
        ok: false,
        error: "Modalitet LOKAL — dërgimi te ATK është i çaktivizuar",
        gabim: "Modalitet LOKAL — dërgimi te ATK është i çaktivizuar",
      });
    }
    const { processOfflineQueue } = require("./fiscal/fiscal-offline");
    const result = await processOfflineQueue({ manual: true });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, gabim: e.message });
  }
});

/** Rikuperim — pending të hapura (alias BIZNES GET /api/fiscal/pending) */
app.get("/api/fiscal/pending", auth, adminOnly, (_req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const fiscalRecovery = require("./fiscal/fiscal-recovery");
    res.json({ ok: true, pending: fiscalRecovery.listOpenPending() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, gabim: e.message });
  }
});

/** Lookup artikujsh për kthim / ndërrim */
app.get("/api/fiscal/receipts/lookup", auth, adminOnly, (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const lookupInput = String(req.query.nuikf || req.query.serial_no || "").trim();
    if (!lookupInput) throw new Error("NUIKF ose numri serik mungon");
    const { getOriginalReceipt, getReturnableItemsForReceipt } = require("./fiscal/fiscal-correction");
    const items = getReturnableItemsForReceipt(lookupInput);
    if (!items) {
      return res.status(404).json({
        ok: false,
        error:
          "Kuponi origjinal nuk u gjet (regular ose bllok letër i regjistruar në SEF)",
        gabim:
          "Kuponi origjinal nuk u gjet (regular ose bllok letër i regjistruar në SEF)",
      });
    }
    const receipt = getOriginalReceipt(lookupInput);
    res.json({
      ok: true,
      receipt: {
        id: receipt.id,
        nuikf: receipt.nuikf,
        receipt_type: receipt.receipt_type,
        total_amount: receipt.total_amount,
        fiscal_date: receipt.fiscal_date,
        fiscal_time: receipt.fiscal_time,
        items: items.map((it) => ({
          name: it.name,
          quantity: it.remaining_quantity,
          original_quantity: it.original_quantity,
          already_returned: it.already_returned,
          remaining_quantity: it.remaining_quantity,
          price: it.unit_price,
          unit_price: it.unit_price,
          vat_norm: it.vat_norm,
          vat_letter: it.vat_norm,
        })),
      },
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, gabim: e.message });
  }
});

/** Print preview + QR (pa printim letre) */
app.get("/api/fiscal/receipts/:id/preview", auth, adminOnly, async (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const preview = await getFiscalReceiptsList().getFiscalReceiptPreviewWithQr(req.params.id);
    if (!preview) throw new Error("Fiskalizimi nuk është aktiv");
    res.json({
      ok: true,
      receipt_id: preview.id,
      nuikf: preview.nuikf,
      text: preview.print_text,
      qr_png_base64: preview.qr_png_base64,
      qr_verify_url: preview.qr_verify_url,
      qr_error: preview.qr_error,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, gabim: e.message });
  }
});

/** Kopje kuponi — print me shënimin KOPJE E KUPONIT */
app.post("/api/fiscal/receipts/:id/print-copy", auth, adminOnly, async (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const copy = getFiscalReceiptsList().prepareFiscalReceiptCopy(req.params.id);
    const { generateFiscalQR } = require("./fiscal/fiscal-qr");
    let qrResult = null;
    try {
      qrResult = await generateFiscalQR({
        nuikf: copy.nuikf,
        total_amount: copy.total_amount,
        fiscal_date: copy.fiscal_date,
        taxpayer_nui: copy.taxpayer_nui,
      });
    } catch (qe) {
      console.warn("[print-copy] QR:", qe.message);
    }
    let printed = false;
    let printMessage = "";
    if (!req.body?.skip_print) {
      const pr = await getFiscalMain().printFiscalBundle(copy.print_text, qrResult);
      printed = !!pr?.printed;
      printMessage = pr?.printMessage || "";
    }
    res.json({
      ok: true,
      is_copy: true,
      receipt_id: copy.id,
      nuikf: copy.nuikf,
      text: copy.print_text,
      printed,
      printMessage,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, gabim: e.message });
  }
});

/** Storno / cancel / return kupon korrigjues */
app.post("/api/fiscal/storno", auth, adminOnly, async (req, res) => {
  try {
    const blocked = recordsGuardResponse(res);
    if (blocked) return blocked;
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const nuikf = String(req.body?.nuikf || "")
      .trim()
      .toUpperCase();
    if (!nuikf) throw new Error("NUIKF mungon");
    const type = String(req.body?.type || "storno").toLowerCase();
    const correctionType =
      type === "cancel" ? "cancel" : type === "return" ? "return" : "storno";
    const { createCorrectionReceipt } = require("./fiscal/fiscal-correction");
    const { generateFiscalQR } = require("./fiscal/fiscal-qr");
    const { isAtkTransmissionBlocked } = require("./fiscal/fiscal-test-mode-store");
    const op = {
      operator_name: req.body?.operator_name || req.session?.emri || "Admin",
      operator_id: req.body?.operator_id || "ADMIN",
    };

    const result = createCorrectionReceipt(
      nuikf,
      correctionType,
      correctionType === "return" ? req.body?.items || null : null,
      req.body?.reason || `${correctionType} ATK`,
      op
    );

    let qrResult = null;
    try {
      const settings = fiscalConfig.getFiscalSettings();
      qrResult = await generateFiscalQR({
        nuikf: result.nuikf,
        total_amount: result.total_amount,
        fiscal_date: result.fiscal_date,
        taxpayer_nui: settings.taxpayer_nui,
      });
    } catch (qe) {
      console.warn("[storno] QR:", qe.message);
    }

    let atk = { atk_sent: false, atk_message: "LOKAL — pa dërgim te ATK" };
    let printOfflineBanner = false;
    if (!isAtkTransmissionBlocked()) {
      const { tryAutoSendFiscalReceiptById } = require("./fiscal/fiscal-offline");
      atk = await tryAutoSendFiscalReceiptById(result.id);
      if (
        !atk.atk_sent &&
        !atk.atk_test_mode &&
        atk.atk_status === "send_failed"
      ) {
        printOfflineBanner = true;
      }
    }

    let printed = false;
    let printMessage = "";
    if (!req.body?.skip_print && result.print_text) {
      const pr = await getFiscalMain().printFiscalBundle(result.print_text, qrResult, {
        printOfflineBanner,
      });
      printed = !!pr?.printed;
      printMessage = pr?.printMessage || "";
    }

    res.json({
      ok: true,
      correction: {
        id: result.id,
        nuikf: result.nuikf,
        original_nuikf: result.original_nuikf,
        receipt_type: result.receipt_type,
        total_amount: result.total_amount,
      },
      printed,
      printMessage,
      atk,
      atk_sent: !!atk.atk_sent,
      atk_message: atk.atk_message,
    });
  } catch (e) {
    console.error("[storno]", e);
    res.status(400).json({ ok: false, error: e.message, gabim: e.message });
  }
});

/** Ndërrim artikulli — kthim + shitje e re */
app.post("/api/fiscal/exchange", auth, adminOnly, async (req, res) => {
  try {
    const blocked = recordsGuardResponse(res);
    if (blocked) return blocked;
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const { runFiscalExchange } = require("./fiscal/fiscal-exchange");
    const op = {
      operator_name: req.body?.operator_name || req.session?.emri || "Admin",
      operator_id: req.body?.operator_id || "ADMIN",
    };
    const payload = await runFiscalExchange(db, req.body || {}, op, {
      processFiscalReceipt: getFiscalMain().processFiscalReceipt,
      printFiscalBundle: getFiscalMain().printFiscalBundle,
    });
    res.json({ ok: true, ...payload });
  } catch (e) {
    console.error("[exchange]", e);
    res.status(400).json({ ok: false, error: e.message, gabim: e.message });
  }
});

/** Status i shkurtër për arka / recepsion (pa listë admin). */
app.get("/api/fiscal/paper-block/active", auth, waiterOrRecepsion, (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.json({ ok: true, active: false });
    }
    const { isPaperBlockModeActive } = require("./fiscal/fiscal-paper-block");
    res.json({ ok: true, active: isPaperBlockModeActive() });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

/** Checkout me bllok letër (Neni 45) */
app.post("/api/fiscal/paper-block/checkout", auth, waiterOrRecepsion, async (req, res) => {
  try {
    const blocked = recordsGuardResponse(res);
    if (blocked) return blocked;
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const {
      isPaperBlockModeActive,
      issuePaperBlockCoupon,
    } = require("./fiscal/fiscal-paper-block");

    if (!isPaperBlockModeActive()) {
      return res.status(409).json({
        ok: false,
        error: "Modaliteti bllok letër nuk është aktiv",
        gabim: "Modaliteti bllok letër nuk është aktiv",
      });
    }

    const serial = String(req.body?.paper_serial || req.body?.serial_no || "").trim();
    if (!serial) {
      return res.status(400).json({
        ok: false,
        error: "Numri serik i bllokut letër mungon",
        gabim: "Numri serik i bllokut letër mungon",
      });
    }

    const items = req.body?.items || [];
    let preview = { total: 0, subtotal: 0, discount_total: 0 };
    if (typeof db.previewSaleTotals === "function") {
      preview = db.previewSaleTotals({
        items,
        cart_discount: req.body?.cart_discount || null,
        cart_surcharge: req.body?.cart_surcharge || null,
      });
    } else {
      preview.total = items.reduce(
        (s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0),
        0
      );
      preview.subtotal = preview.total;
    }

    if (preview.total > 1000 && !req.body?.confirmed_over_1000) {
      return res.status(409).json({
        ok: false,
        needs_confirm_over_1000: true,
        total: preview.total,
        error: "Transaksioni mbi 1000€ kërkon konfirmim shtesë para finalizimit",
        gabim: "Transaksioni mbi 1000€ kërkon konfirmim shtesë para finalizimit",
      });
    }

    let orderId = null;
    let saleItems = items;
    if (typeof db.createSale === "function") {
      const sale = db.createSale({
        items,
        payment_method: req.body?.payment_method || "cash",
        operator_name: req.body?.operator_name || req.session?.emri || "Admin",
        cart_discount: req.body?.cart_discount || null,
        cart_surcharge: req.body?.cart_surcharge || null,
        payment_splits: req.body?.payment_splits || null,
      });
      orderId = sale.id;
      saleItems = sale.items;
      preview.subtotal = sale.subtotal;
      preview.total = sale.total;
      preview.discount_total = sale.discount_total;
    }

    const paper = issuePaperBlockCoupon({
      serial_no: serial,
      items: saleItems,
      subtotal: preview.subtotal,
      discount_amount: preview.discount_total || 0,
      total_amount: preview.total,
      payment_method: req.body?.payment_method || "cash",
      operator_name: req.body?.operator_name || req.session?.emri || "Admin",
      operator_id: req.body?.operator_id || "ADMIN",
    });

    if (req.body?.recepcion_kasa && typeof db.recordRecepcionKasaSale === "function") {
      try {
        const waiterName = String(req.session?.name || req.session?.emri || "Recepsion").trim();
        db.recordRecepcionKasaSale({
          items: req.body.items,
          payment_method: req.body.payment_method || "cash",
          payment_splits: req.body.payment_splits || null,
          waiter_name: waiterName,
        });
      } catch (e) {
        console.warn("[paper-block/checkout] recepcion kasa:", e.message);
      }
    }

    let printed = false;
    let printMessage = "";
    if (!req.body?.skip_print && paper.slip_text) {
      try {
        const printer = require("./printer");
        await printer.printPlainTextReceipt(paper.slip_text, db);
        printed = true;
      } catch (e) {
        printMessage = e.message || "print dështoi";
      }
    }

    res.json({
      ok: true,
      order_id: orderId,
      total: preview.total,
      paper_block: true,
      paper,
      printed,
      printMessage,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, gabim: e.message });
  }
});

/* Test lokal i plotë fiskal — vetëm pronari, pa ATK (print termik opsional) */
async function handlePostFiscalSelfTest(req, res) {
  try {
    if (fiscalDevToolsForbidden(res)) return;
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
}
app.post("/api/fiscal-self-test", auth, adminOnly, handlePostFiscalSelfTest);
app.post("/api/fiscal/self-test", auth, adminOnly, handlePostFiscalSelfTest);

/* Kupon fiskal provë — print termik, pa INSERT (vetëm kur fiscal ON) */
app.post("/api/fiscal-print-test-coupon", auth, adminOnly, async (_req, res) => {
  try {
    if (fiscalDevToolsForbidden(res)) return;
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
    const blocked = recordsGuardResponse(res);
    if (blocked) return blocked;
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

/** Pajtueshmëria offline (Neni 44.5 / 44.6) — gjendje + raporte ATK */
app.get("/api/fiscal/offline-compliance", auth, adminOnly, (_req, res) => {
  try {
    const { evaluateOfflineCompliance } = require("./fiscal/fiscal-offline-compliance");
    res.json({ ok: true, compliance: evaluateOfflineCompliance() });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/fiscal/offline-compliance/ack", auth, adminOnly, (req, res) => {
  try {
    const { acknowledgeOfflineCompliance } = require("./fiscal/fiscal-offline-compliance");
    const compliance = acknowledgeOfflineCompliance(
      req.body?.type,
      req.body?.operator_name || req.session?.emri || "Admin",
      req.body?.notes || ""
    );
    res.json({ ok: true, compliance });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/fiscal/offline-compliance/export", auth, adminOnly, (req, res) => {
  try {
    const { exportOfflineComplianceReport } = require("./fiscal/fiscal-offline-compliance");
    const result = exportOfflineComplianceReport(req.body?.type || "48h");
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
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
      compliance: warning?.compliance || status?.compliance || null,
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

/** Lista kuponësh fiskalë për tab-in Audit (ATK) — vetëm fiscal_receipts. */
app.get("/api/admin/audit-log", auth, adminOnly, (req, res) => {
  try {
    const from = req.query.from || req.query.fromDate || null;
    const to = req.query.to || req.query.toDate || null;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 250));
    const entries =
      fiscalAudit.getAdminFiscalReceiptEntries(from, to, {
        includeWhenDisabled: true,
        limit,
      }) || [];
    res.json({ ok: true, entries, count: entries.length });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

function handlePostFiscalAuditExport(req, res) {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const format = String(req.body?.format || "csv").toLowerCase();
    const from = req.body?.from || req.body?.fromDate || null;
    const to = req.body?.to || req.body?.toDate || null;
    const savePath =
      req.body?.savePath || req.body?.targetPath
        ? String(req.body.savePath || req.body.targetPath).trim()
        : "";
    if (!savePath) {
      return res.status(400).json({
        ok: false,
        cancelled: true,
        gabim: "Eksporti u anulua — nuk u zgjodh vendi i ruajtjes.",
      });
    }
    let filePath;
    if (format === "pdf") {
      filePath = fiscalAudit.exportAuditPDF(from, to, savePath);
    } else {
      filePath = fiscalAudit.exportAuditCSV(from, to, savePath);
    }
    if (!filePath) {
      return res.status(400).json({ gabim: "Eksporti dështoi" });
    }
    res.json({
      ok: true,
      format,
      path: filePath,
      filePath,
      message: `U ruajt: ${filePath}`,
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
}
app.post("/api/fiscal-audit/export", auth, adminOnly, handlePostFiscalAuditExport);
app.post("/api/fiscal/audit/export", auth, adminOnly, handlePostFiscalAuditExport);

function truthyFiscalApiFlag(v) {
  return v === true || v === 1 || v === "1" || v === "on" || v === "yes";
}

/** Field 8 discount E2E — lista kuponësh për NUIKF picker */
app.get("/api/fiscal-test-atk-discount/receipts", auth, adminOnly, (req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const limit = Number(req.query.limit) || 100;
    const receipts = (getFiscalReceiptsList().listFiscalReceipts(limit) || [])
      .filter((r) => String(r.receipt_type || "").toLowerCase() === "regular")
      .map((r) => ({
        ...r,
        sent_to_atk: r.sent_to_atk ? 1 : 0,
        atk_ok: Number(r.sent_to_atk) === 1,
      }));
    res.json({ ok: true, receipts });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

async function handleGetFiscalTestAtkDiscount(req, res) {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const { runAtkDiscountE2eTest } = require("./fiscal/fiscal-atk-discount-e2e");
    const useSample = req.query?.use_sample === "1" || req.query?.use_sample === "true";
    const result = await runAtkDiscountE2eTest({
      dry_run: true,
      use_sample: useSample,
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
}
async function handlePostFiscalTestAtkDiscount(req, res) {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const { runAtkDiscountE2eTest } = require("./fiscal/fiscal-atk-discount-e2e");
    const body = req.body || {};
    const send = !!(
      body.send_to_atk === true ||
      body.send_to_atk === 1 ||
      body.send_to_atk === "1"
    );
    const previewOnly =
      truthyFiscalApiFlag(body.dry_run) || (!send && !truthyFiscalApiFlag(body.send_to_atk));
    const result = await runAtkDiscountE2eTest({
      dry_run: previewOnly,
      send_to_atk: send,
      confirmed: truthyFiscalApiFlag(body.confirmed),
      operator_name: body.operator_name || req.session?.emri || "Admin",
      use_sample: truthyFiscalApiFlag(body.use_sample),
      nuikf: body.nuikf,
      receipt_id: body.receipt_id,
    });
    res.json({ ok: !!result.ok, result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
}
app.get("/api/fiscal-test-atk-discount", auth, adminOnly, handleGetFiscalTestAtkDiscount);
app.get("/api/fiscal/test-atk-discount", auth, adminOnly, handleGetFiscalTestAtkDiscount);
app.post("/api/fiscal-test-atk-discount", auth, adminOnly, handlePostFiscalTestAtkDiscount);
app.post("/api/fiscal/test-atk-discount", auth, adminOnly, handlePostFiscalTestAtkDiscount);

/** Neni 45 — bllok letër kur SEF ndalon plotësisht */
function handleGetFiscalPaperBlock(req, res) {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const { getPaperBlockStatus, listPaperBlockReceipts } = require("./fiscal/fiscal-paper-block");
    res.json({
      ok: true,
      status: getPaperBlockStatus(),
      receipts: listPaperBlockReceipts({ pendingOnly: false }),
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
}
function handlePostFiscalPaperBlockEnable(req, res) {
  try {
    const blocked = recordsGuardResponse(res);
    if (blocked) return blocked;
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const { enablePaperBlockMode } = require("./fiscal/fiscal-paper-block");
    const status = enablePaperBlockMode(req.body?.operator_name || req.session?.emri || "Admin", {
      batch_id: req.body?.batch_id,
      reason: req.body?.reason,
    });
    res.json({ ok: true, status });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
}
function handlePostFiscalPaperBlockDisable(req, res) {
  try {
    const blocked = recordsGuardResponse(res);
    if (blocked) return blocked;
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const { disablePaperBlockMode } = require("./fiscal/fiscal-paper-block");
    const status = disablePaperBlockMode(req.body?.operator_name || req.session?.emri || "Admin", {
      force: !!req.body?.force,
    });
    res.json({ ok: true, status });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
}
function handlePostFiscalPaperBlockIssue(req, res) {
  try {
    const blocked = recordsGuardResponse(res);
    if (blocked) return blocked;
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const { issuePaperBlockCoupon } = require("./fiscal/fiscal-paper-block");
    const result = issuePaperBlockCoupon({
      ...(req.body || {}),
      operator_name: req.body?.operator_name || req.session?.emri || "Admin",
      operator_id: req.body?.operator_id || "ADMIN",
    });
    res.json({ ok: true, paper: result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
}
async function handlePostFiscalPaperBlockRegisterAll(req, res) {
  try {
    const blocked = recordsGuardResponse(res);
    if (blocked) return blocked;
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const { registerAllPaperBlockInSef } = require("./fiscal/fiscal-paper-block");
    const result = await registerAllPaperBlockInSef({
      send_to_atk: req.body?.send_to_atk !== false,
      operator_name: req.body?.operator_name || req.session?.emri || "Admin",
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
}
app.get("/api/fiscal-paper-block", auth, adminOnly, handleGetFiscalPaperBlock);
app.get("/api/fiscal/paper-block", auth, adminOnly, handleGetFiscalPaperBlock);
app.post("/api/fiscal-paper-block/enable", auth, adminOnly, handlePostFiscalPaperBlockEnable);
app.post("/api/fiscal/paper-block/enable", auth, adminOnly, handlePostFiscalPaperBlockEnable);
app.post("/api/fiscal-paper-block/disable", auth, adminOnly, handlePostFiscalPaperBlockDisable);
app.post("/api/fiscal/paper-block/disable", auth, adminOnly, handlePostFiscalPaperBlockDisable);
app.post("/api/fiscal-paper-block/issue", auth, adminOnly, handlePostFiscalPaperBlockIssue);
app.post("/api/fiscal/paper-block/issue", auth, adminOnly, handlePostFiscalPaperBlockIssue);
app.post("/api/fiscal-paper-block/register-all", auth, adminOnly, handlePostFiscalPaperBlockRegisterAll);
app.post("/api/fiscal/paper-block/register-all", auth, adminOnly, handlePostFiscalPaperBlockRegisterAll);

/** Wizard riparimi SEF (48h) — kontekst + hapa */
app.get("/api/fiscal/repair-wizard/context", auth, adminOnly, (_req, res) => {
  try {
    const { getRepairWizardContext } = require("./fiscal/fiscal-repair-wizard");
    const ctx = getRepairWizardContext();
    if (!ctx.ok) {
      return res.status(400).json({ ok: false, gabim: ctx.error || "Wizard i padisponueshëm" });
    }
    res.json({ ok: true, ...ctx });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/fiscal/repair-wizard/step/:step", auth, adminOnly, async (req, res) => {
  try {
    const { runRepairWizardStep } = require("./fiscal/fiscal-repair-wizard");
    const step = Number(req.params.step);
    const result = await runRepairWizardStep(step, {
      operator_name: req.body?.operator_name || req.session?.emri || "Admin",
      operator_id: req.body?.operator_id || "ADMIN",
      step_results: req.body?.step_results || null,
    });
    res.json({ ok: result.ok !== false, result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/** Verifikim zinxhiri hash (Neni 26) — kopjuar nga biznes */
app.get("/api/fiscal/hash-chain/verify", auth, adminOnly, (_req, res) => {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ ok: false, gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const { verifyFullChain } = require("./fiscal/fiscal-hash-chain");
    const report = verifyFullChain(5000);
    res.json({ ok: !!report.ok, report });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
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

async function postFiscalRecoveryResumeHandler(req, res) {
  try {
    if (!fiscalConfig.isFiscalEnabled()) {
      return res.status(400).json({ gabim: "Fiskalizimi nuk është i aktivizuar" });
    }
    const fiscalRecovery = require("./fiscal/fiscal-recovery");
    if (req.body?.pending_id) {
      const all = fiscalRecovery.listOpenPending();
      const p = all.find((x) => Number(x.id) === Number(req.body.pending_id));
      if (!p) throw new Error("Pending nuk u gjet");
      const result = await fiscalRecovery.resumePendingPrint(p, {
        skip_print: !!req.body?.skip_print,
      });
      return res.json({ ok: true, result });
    }
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
    res.status(400).json({ gabim: e.message, error: e.message });
  }
}

app.post("/api/fiscal-recovery/resume", auth, adminOnly, postFiscalRecoveryResumeHandler);
app.post("/api/fiscal/recovery/resume", auth, adminOnly, postFiscalRecoveryResumeHandler);

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
      closedBy: req.session.emri || receipt.order?.closed_by || "",
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

app.get("/api/printers", auth, adminOnly, async (_req, res) => {
  try {
    const registered = db.listPrinters();
    const windows_devices = await printer.listPrinters();
    const legacy_fallback = registered.length === 0;
    res.json({
      ok: true,
      printers: registered,
      windows_devices,
      legacy_fallback,
      legacy: legacy_fallback ? printer.getPrinterConfig(db) : null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/printers", auth, adminOnly, (req, res) => {
  try {
    const body = req.body || {};
    const row = db.addPrinter(body.name, body.role, body.paper_size || "80", {
      connection_type: body.connection_type,
      ip_address: body.ip_address,
      port: body.port,
    });
    if (body.is_default) {
      db.updatePrinter(row.id, { is_default: true });
    }
    if (body.enabled === false) {
      db.updatePrinter(row.id, { enabled: false });
    }
    auditReq(req, "Shto printer", `${row.role} → ${row.name}`);
    res.status(201).json({ ok: true, printer: db.getPrinterById(row.id) });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.put("/api/printers/:id", auth, adminOnly, (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const row = db.updatePrinter(id, {
      name: body.name,
      role: body.role,
      paper_size: body.paper_size,
      connection_type: body.connection_type,
      ip_address: body.ip_address,
      port: body.port,
      is_default: body.is_default,
      enabled: body.enabled,
    });
    auditReq(req, "Ndrysho printer", `#${id} · ${row.role} → ${row.name}`);
    res.json({ ok: true, printer: row });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.delete("/api/printers/:id", auth, adminOnly, (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.getPrinterById(id);
    if (!existing) return res.status(404).json({ ok: false, gabim: "Printeri nuk u gjet." });
    db.deletePrinter(id);
    auditReq(req, "Fshi printer", `#${id} · ${existing.role} → ${existing.name}`);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
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

function storedLicenseKeyForCloud() {
  const eapp = electronApp();
  if (!eapp) return "";
  try {
    license.registerInstallContext(eapp);
  } catch {
    /* ignore */
  }
  return String(license.readStoredLicense(eapp) || "").trim();
}

function isPrivateLanAddress(raw) {
  const ip = String(raw || "").trim().replace(/^::ffff:/i, "");
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  const m = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
  return !!(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

function normalizeLanLicenseKey(key) {
  return String(key || "").trim().toUpperCase().replace(/\s+/g, "");
}

function terminalRegisterNumberLocal() {
  return terminalRegisterNumber();
}

function ownTerminalDeviceId() {
  return String(license.getMachineId() || "").trim().toUpperCase();
}

function readTerminalRoleDisplay() {
  const num = terminalRegisterNumberLocal();
  if (!num || num < 2) return "Kryesore";
  return `Arka ${num}`;
}

function readTerminalRoleCode() {
  const num = terminalRegisterNumberLocal();
  if (!num || num < 2) return "arka1";
  return `arka${num}`;
}

/** Të gjitha IPv4 private të Kryesores — Arka 2+ i merr nga snapshot cloud + locator. */
function listLanIPv4Addresses() {
  const out = [];
  for (const [ifName, addrs] of Object.entries(os.networkInterfaces())) {
    for (const net of addrs || []) {
      if (net.family !== "IPv4" && net.family !== 4) continue;
      if (net.internal) continue;
      const ip = String(net.address || "").trim();
      if (!isPrivateLanAddress(ip) || out.some((x) => x.ip === ip)) continue;
      out.push({ ip, kind: lanInterfaceKind(ifName) });
    }
  }
  const rank = { ethernet: 0, wifi: 1 };
  return out.sort((a, b) => (rank[a.kind] ?? 2) - (rank[b.kind] ?? 2)).map((x) => x.ip);
}

const CATALOG_SNAPSHOT_PUBLISH_MS = 5 * 60 * 1000;
const RELAY_TICK_ACTIVE_MS = 10 * 1000;
const RELAY_TICK_IDLE_STEPS_MS = [10 * 1000, 30 * 1000, 60 * 1000, 120 * 1000, 180 * 1000];
const RELAY_TICK_MAX_ONLINE_MS = 60 * 1000;
const RELAY_TICK_MAX_OFFLINE_MS = 180 * 1000;
const RELAY_TICK_UNAVAILABLE_MS = 10 * 60 * 1000;
const RELAY_DIRTY_PUBLISH_MS = 120 * 1000;
const RELAY_PAIRING_WINDOW_MS = 30 * 60 * 1000;
const RELAY_PRESENCE_ONLINE_MS = 90 * 1000;

let masterCloudRelayBusy = false;
let terminalLanSyncInstance = null;
const catalogSnapshotPublished = {};
const relayPresenceSeen = new Map();
const masterCatalogDirty = { at: 0 };
const masterCloudRelay = {
  timer: null,
  idleStep: 0,
  pairingUntil: 0,
  lastSecondaryOnline: false,
};

function markMasterCatalogDirty() {
  if (terminalRegisterNumberLocal() >= 2) return;
  masterCatalogDirty.at = Date.now();
  scheduleMasterCloudRelay(400);
}

function markMasterRelayDirty() {
  markMasterCatalogDirty();
}

function isRelayPresenceOnline(entry) {
  const t = Date.parse(entry?.updated_at || "");
  if (!Number.isFinite(t) || Date.now() - t > RELAY_PRESENCE_ONLINE_MS) return false;
  if (Math.floor(Number(entry?.register_number) || 0) < 2) return false;
  return entry?.body?.online !== false;
}

function computeMasterCloudRelayDelayMs(result) {
  if (result?.unavailable) return RELAY_TICK_UNAVAILABLE_MS;
  if (result?.hadQueueRows || result?.hadImport) {
    masterCloudRelay.idleStep = 0;
    return RELAY_TICK_ACTIVE_MS;
  }
  masterCloudRelay.idleStep = Math.min(
    masterCloudRelay.idleStep + 1,
    RELAY_TICK_IDLE_STEPS_MS.length - 1,
  );
  let next = RELAY_TICK_IDLE_STEPS_MS[masterCloudRelay.idleStep];
  const online = !!result?.secondaryOnline;
  masterCloudRelay.lastSecondaryOnline = online;
  if (online) {
    next = Math.min(next, RELAY_TICK_MAX_ONLINE_MS);
  } else {
    next = RELAY_TICK_MAX_OFFLINE_MS;
  }
  if (Date.now() < masterCloudRelay.pairingUntil) {
    next = Math.min(next, RELAY_TICK_ACTIVE_MS);
  }
  return next;
}

function scheduleMasterCloudRelay(delayMs) {
  if (terminalRegisterNumberLocal() >= 2) return;
  if (masterCloudRelay.timer) clearTimeout(masterCloudRelay.timer);
  masterCloudRelay.timer = setTimeout(async () => {
    masterCloudRelay.timer = null;
    let result = { skipped: true };
    try {
      result = await masterCloudRelayTick();
    } catch (e) {
      console.warn("[relay] Kryesorja:", e.message || e);
      result = { unavailable: e.code === "RELAY_UNAVAILABLE" };
    }
    if (result.skipped) {
      scheduleMasterCloudRelay(RELAY_TICK_IDLE_STEPS_MS[2]);
      return;
    }
    scheduleMasterCloudRelay(computeMasterCloudRelayDelayMs(result));
  }, Math.max(0, delayMs));
}

async function publishMasterCatalogSnapshots() {
  if (terminalRegisterNumberLocal() >= 2) return;
  const celesi = storedLicenseKeyForCloud();
  if (!celesi) return;
  try {
    const terminalRelay = require("./terminal-relay");
    const staff = buildTerminalStaffList();
    const menuPayload = buildTerminalMenuPayload();
    const servicesPayload = buildTerminalServicesPayload();
    const items = db.getStockForTerminal();
    const port = Number(process.env.ACTUAL_PORT || process.env.PORT || 3001);
    const snapshots = {
      master: {
        device_id: ownTerminalDeviceId(),
        lan_hosts: listLanIPv4Addresses(),
        port,
        app_version: db.getVersionInfo().app_version || db.getVersionInfo().version,
      },
    };
    if (staff.length) snapshots.staff = { staff };
    if (menuPayload.categories?.length && menuPayload.items?.length) {
      snapshots.menu = { categories: menuPayload.categories, items: menuPayload.items };
    }
    if (servicesPayload.services?.length) {
      snapshots.services = {
        categories: servicesPayload.categories || [],
        services: servicesPayload.services,
        groups: servicesPayload.groups || [],
      };
    }
    snapshots.stock = { items: items || [], relay_acked_through: db.getRelayAckedThrough() };
    const r = await terminalRelay.publishSnapshots({
      celesi,
      deviceId: ownTerminalDeviceId(),
      snapshots,
      published: catalogSnapshotPublished,
    });
    if (r.published) {
      Object.assign(catalogSnapshotPublished, r.hashes);
      console.log(`[relay-snapshots] Kryesorja → cloud: ${(r.kinds || []).join(", ")}`);
    }
  } catch (e) {
    if (e.code !== "RELAY_UNAVAILABLE") console.warn("[relay-snapshots] Kryesorja:", e.message || e);
  }
}

async function masterCloudRelayTick() {
  if (masterCloudRelayBusy || terminalRegisterNumberLocal() >= 2) return { skipped: true };
  const celesi = storedLicenseKeyForCloud();
  if (!celesi) return { skipped: true };
  masterCloudRelayBusy = true;
  let secondaryOnline = false;
  let hadQueueRows = false;
  let hadImport = false;
  let unavailable = false;
  try {
    const terminalRelay = require("./terminal-relay");
    const deviceId = ownTerminalDeviceId();

    try {
      const pres = await terminalRelay.fetchRelayPresence({ celesi, deviceId });
      for (const p of pres.presence || []) {
        if (isRelayPresenceOnline(p)) secondaryOnline = true;
        if (!p.body || !p.updated_at || Math.floor(Number(p.register_number) || 0) < 2) continue;
        const dev = String(p.device_id || "").trim().toUpperCase();
        const seenKey = `${dev}:${p.updated_at}`;
        if (relayPresenceSeen.get(dev) === seenKey) continue;
        relayPresenceSeen.set(dev, seenKey);
        try {
          db.touchRemoteRegister(
            dev,
            p.register_number,
            { ...p.body, via: "cloud", online: p.body.online !== false },
            p.body.remote_ip || p.body.lan_ip || null,
            p.updated_at,
          );
        } catch (e) {
          console.warn(`[relay-presence] Arka ${p.register_number}:`, e.message);
        }
      }
    } catch (e) {
      if (e.code !== "RELAY_UNAVAILABLE") {
        console.warn("[relay-presence] Kryesorja:", e.message || e);
      } else {
        unavailable = true;
      }
    }

    const pulled = await terminalRelay.pullQueue({
      celesi,
      deviceId,
      limit: 100,
    });
    hadQueueRows = (pulled.items || []).length > 0;
    const ackIds = [];
    const ackedThrough = db.getRelayAckedThrough();
    let throughChanged = false;
    for (const row of pulled.items || []) {
      if (!row.body) {
        console.warn(
          `[relay] rreshti #${row.id} nga Arka ${row.register_number} nuk u hap (${row.error || ""}) — pa ack`,
        );
        continue;
      }
      const dev = String(row.source_device_id || "").trim().toUpperCase();
      const reg = Math.floor(Number(row.register_number) || 0);
      const maxRegRelay = db.getMaxRegisters();
      if (!dev || reg < 2) continue;
      if (reg > maxRegRelay) {
        console.warn(`[relay] queue#${row.id} Arka ${reg} tejkalon max_registers=${maxRegRelay} — pa import`);
        continue;
      }
      try {
        db.touchRemoteRegister(
          dev,
          reg,
          {
            via: "cloud",
            register_number: reg,
            app_version: masterRemoteAppVersion(),
          },
          null,
          row.created_at,
        );
      } catch (e) {
        console.warn(`[relay] Arka ${reg} presence:`, e.message);
      }
      const source = { device_id: dev, register_number: reg };
      let imported = false;
      if (row.kind === "sale") {
        const { accepted, rejected } = db.importSalesFromTerminal([row.body], source);
        imported = accepted.length > 0 && rejected.length === 0;
        if (imported) {
          console.log(
            `[relay] Arka ${reg} (${dev}) daily_log#${accepted[0]} u importua te Kryesorja (queue#${row.id})`,
          );
        } else if (rejected.length) {
          console.warn(`[relay] queue#${row.id} shitje: ${rejected[0].gabim}`);
        }
      } else if (row.kind === "shift") {
        const { accepted_shifts, rejected_shifts } = db.importShiftsFromTerminal([row.body], source);
        imported = accepted_shifts.length > 0 && rejected_shifts.length === 0;
        if (imported) {
          console.log(
            `[relay] Arka ${reg} (${dev}) ndërrimi#${accepted_shifts[0]} u importua te Kryesorja (queue#${row.id})`,
          );
        } else if (rejected_shifts.length) {
          console.warn(`[relay] queue#${row.id} ndërrim: ${rejected_shifts[0].gabim}`);
        }
      } else if (row.kind === "room_charge") {
        const { accepted, rejected } = db.importRoomChargesFromTerminal([row.body], source);
        imported = accepted.length > 0 && rejected.length === 0;
        if (imported) {
          console.log(
            `[relay] Arka ${reg} (${dev}) room_charge#${accepted[0]} u importua te Kryesorja (queue#${row.id})`,
          );
        } else if (rejected.length) {
          console.warn(`[relay] queue#${row.id} room_charge: ${rejected[0].gabim}`);
        }
      }
      if (imported) {
        ackIds.push(row.id);
        ackedThrough[dev] = Math.max(Number(ackedThrough[dev]) || 0, Number(row.id) || 0);
        throughChanged = true;
      }
    }
    if (throughChanged) db.setRelayAckedThrough(ackedThrough);
    if (ackIds.length) {
      const ack = await terminalRelay.ackQueueItems({
        celesi,
        deviceId,
        ids: ackIds,
        relayAckedThrough: throughChanged ? ackedThrough : null,
      });
      if (Number(ack.acked) !== ackIds.length) {
        console.warn(`[relay] ack: u kërkuan ${ackIds.length}, u konfirmuan ${Number(ack.acked) || 0}`);
      }
    }
    hadImport = ackIds.length > 0;

    const needPublish =
      (masterCatalogDirty.at && Date.now() - masterCatalogDirty.at < RELAY_DIRTY_PUBLISH_MS) ||
      Date.now() < masterCloudRelay.pairingUntil ||
      secondaryOnline;
    if (needPublish) {
      await publishMasterCatalogSnapshots();
      if (masterCatalogDirty.at) masterCatalogDirty.at = 0;
    }
  } catch (e) {
    if (e.code !== "RELAY_UNAVAILABLE") console.warn("[relay] Kryesorja (cloud):", e.message || e);
    else unavailable = true;
  } finally {
    masterCloudRelayBusy = false;
  }
  return { hadQueueRows, hadImport, secondaryOnline, unavailable };
}

/** LAN: vetëm rrjet lokal, çelësi i licencës, dhe vetëm Kryesorja (arka1) përgjigjet. */
function assertLanTerminalMaster(req, res) {
  if (!isPrivateLanAddress(req.socket?.remoteAddress)) {
    res.status(403).json({ ok: false, gabim: "Lejohet vetëm nga rrjeti lokal." });
    return false;
  }
  const given = normalizeLanLicenseKey(req.headers["x-license-key"] || req.query.celesi);
  const own = normalizeLanLicenseKey(storedLicenseKeyForCloud());
  const a = Buffer.from(given);
  const b = Buffer.from(own);
  if (!own || !given || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(403).json({ ok: false, gabim: "Çelësi i licencës nuk përputhet." });
    return false;
  }
  if (terminalRegisterNumberLocal() >= 2) {
    res.status(403).json({ ok: false, gabim: "Ky PC nuk është arka Kryesore." });
    return false;
  }
  return true;
}

function buildTerminalStaffList() {
  return db
    .getStaff()
    .filter((s) => {
      const r = String(s.staff_role || "kamarier").trim().toLowerCase();
      return r === "kamarier" || r === "recepsion";
    })
    .map((s) => ({
      name: s.name,
      pin: s.pin || null,
      card_uid: s.card_uid || null,
      active: !!s.active,
      role: String(s.staff_role || "kamarier").trim().toLowerCase() === "recepsion" ? "recepsion" : "kamarier",
    }));
}

function buildTerminalMenuPayload() {
  const categories = db.getCategories().map((c) => ({
    name: c.name,
    sort_order: Number(c.sort_order) || 0,
    active: c.active !== 0 && c.active !== false,
    route: c.route,
  }));
  const items = db.getMenuItems(true).map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    price: Number(m.price) || 0,
    active: !!m.active,
    sort_order: Number(m.sort_order) || 0,
    vat_category: m.vat_category,
    barcode: m.barcode || "",
    stock_qty: Number(m.stock_qty) || 0,
    low_stock_threshold: Number(m.low_stock_threshold) || 0,
  }));
  return { categories, items };
}

function buildTerminalServicesPayload() {
  const catalog = db.listHotelServicesCatalog({ activeOnly: true });
  const services = (catalog.services || []).map((s) => ({
    id: s.id,
    name: s.name,
    price: Number(s.price) || 0,
    active: !!s.active,
    category_id: s.category_id != null ? Number(s.category_id) : null,
    category_name: s.category_name || "",
    vat_category: s.vat_category,
    sort_order: Number(s.sort_order) || 0,
  }));
  const categories = (catalog.categories || []).map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon || "",
    sort_order: Number(c.sort_order) || 0,
  }));
  return { categories, services, groups: catalog.groups || [] };
}

function alignTerminalRegisterOnBoot() {
  try {
    const eapp = electronApp();
    const role = eapp ? license.readTerminalRole(eapp) : "";
    if (role) db.alignCashRegisterWithTerminalRole(role);
    const regNum = terminalRegisterNumberLocal();
    if (typeof db.setLanOutboxEnabled === "function") {
      db.setLanOutboxEnabled(regNum >= 2);
    }
  } catch (e) {
    console.warn("[register] align terminal role:", e.message);
  }
}

function masterRemoteAppVersion() {
  const v = db.getVersionInfo();
  return String(v.app_version || v.version || "").slice(0, 40);
}

function processTerminalRegisterReport(
  deviceId,
  registerNumber,
  body,
  { status = null, remoteIp = null, seenAt = null, tag = "lan-report" } = {},
) {
  if (status !== null) {
    try {
      const st = status && typeof status === "object" ? status : {};
      db.touchRemoteRegister(deviceId, registerNumber, st, remoteIp, seenAt);
    } catch (e) {
      console.warn(`[${tag}] Arka ${registerNumber} presence:`, e.message);
    }
  }
  const source = { device_id: deviceId, register_number: registerNumber };
  const { accepted, rejected } = db.importSalesFromTerminal(body?.sales, source);
  const { accepted_shifts, rejected_shifts } = db.importShiftsFromTerminal(body?.shifts, source);
  const roomImport = db.importRoomChargesFromTerminal(body?.room_charges, source);
  return {
    accepted,
    rejected,
    accepted_shifts,
    rejected_shifts,
    accepted_room_charges: roomImport.accepted,
    rejected_room_charges: roomImport.rejected,
  };
}

app.get("/api/terminal/ping", (req, res) => {
  if (!assertLanTerminalMaster(req, res)) return;
  const eapp = electronApp();
  const terminal_module =
    eapp && typeof license.readTerminalModule === "function"
      ? license.readTerminalModule(eapp) || "kamarier"
      : "kamarier";
  const ver = db.getVersionInfo();
  const regNum = terminalRegisterNumberLocal();
  res.json({
    ok: true,
    role: readTerminalRoleDisplay(),
    role_code: readTerminalRoleCode(),
    register_number: regNum >= 1 ? regNum : 1,
    device_id: ownTerminalDeviceId(),
    app_version: ver.app_version || ver.version,
    terminal_module,
  });
});

app.get("/api/terminal/staff", (req, res) => {
  if (!assertLanTerminalMaster(req, res)) return;
  try {
    res.json({ ok: true, staff: buildTerminalStaffList() });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || String(e) });
  }
});

app.get("/api/terminal/menu", (req, res) => {
  if (!assertLanTerminalMaster(req, res)) return;
  try {
    res.json({ ok: true, ...buildTerminalMenuPayload() });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || String(e) });
  }
});

app.get("/api/terminal/stock", (req, res) => {
  if (!assertLanTerminalMaster(req, res)) return;
  try {
    res.json({
      ok: true,
      items: db.getStockForTerminal(),
      relay_acked_through: db.getRelayAckedThrough(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || String(e) });
  }
});

app.get("/api/terminal/services", (req, res) => {
  if (!assertLanTerminalMaster(req, res)) return;
  try {
    res.json({ ok: true, ...buildTerminalServicesPayload() });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || String(e) });
  }
});

app.get("/api/terminal/occupied-rooms", (req, res) => {
  if (!assertLanTerminalMaster(req, res)) return;
  try {
    res.json({ ok: true, rooms: db.buildOccupiedRoomsTerminalPayload() });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || String(e) });
  }
});

/** Arka 2+ → Kryesore (LAN): shitjet nga daily_log (lan_outbox). */
app.post("/api/terminal/report", (req, res) => {
  if (!isPrivateLanAddress(req.socket?.remoteAddress)) {
    return res.status(403).json({ ok: false, gabim: "Lejohet vetëm nga rrjeti lokal." });
  }
  const given = normalizeLanLicenseKey(req.headers["x-license-key"] || req.query.celesi);
  const own = normalizeLanLicenseKey(storedLicenseKeyForCloud());
  const a = Buffer.from(given);
  const b = Buffer.from(own);
  if (!own || !given || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ ok: false, gabim: "Çelësi i licencës nuk përputhet." });
  }
  if (terminalRegisterNumberLocal() >= 2) {
    return res.status(403).json({ ok: false, gabim: "Ky PC nuk është arka Kryesore." });
  }
  const deviceId = String(req.body?.device_id || "").trim().toUpperCase();
  const registerNumber = Math.floor(Number(req.body?.register_number) || 0);
  const ownDevice = ownTerminalDeviceId();
  if (!/^[A-F0-9]{12}$/.test(deviceId) || deviceId === ownDevice || registerNumber < 2) {
    return res.status(400).json({ ok: false, gabim: "device_id / register_number i pavlefshëm." });
  }
  const maxRegLan = db.getMaxRegisters();
  if (registerNumber > maxRegLan) {
    return res.status(400).json({
      ok: false,
      gabim: `Arka ${registerNumber} tejkalon limitin e licencës (${maxRegLan}).`,
    });
  }
  try {
    const status =
      req.body?.status && typeof req.body.status === "object"
        ? { ...req.body.status, via: "lan" }
        : { via: "lan", register_number: registerNumber, app_version: masterRemoteAppVersion() };
    const {
      accepted,
      rejected,
      accepted_shifts,
      rejected_shifts,
      accepted_room_charges,
    } = processTerminalRegisterReport(
      deviceId,
      registerNumber,
      req.body,
      {
        status,
        remoteIp: req.socket?.remoteAddress,
        tag: "lan-report",
      },
    );
    for (const ref of accepted) {
      if (!ref) continue;
      console.log(
        `[lan-report] Arka ${registerNumber} (${deviceId}) daily_log#${ref} u importua te Kryesorja`,
      );
    }
    for (const ref of accepted_shifts) {
      if (!ref) continue;
      console.log(
        `[lan-report] Arka ${registerNumber} (${deviceId}) ndërrimi#${ref} u importua te Kryesorja`,
      );
    }
    for (const ref of accepted_room_charges || []) {
      if (!ref) continue;
      console.log(
        `[lan-report] Arka ${registerNumber} (${deviceId}) room_charge#${ref} u importua te Kryesorja`,
      );
    }
    res.json({
      ok: true,
      accepted,
      rejected,
      accepted_shifts,
      rejected_shifts,
      accepted_room_charges: accepted_room_charges || [],
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || String(e) });
  }
});

async function cloudTerminalJson(method, apiPath, payload) {
  const cloudHealth = require("./cloud-health");
  const { hotelCloudApiPath } = require("./cloud-server-url");
  const res = await cloudHealth.requestJsonWithFallback(
    method,
    hotelCloudApiPath(apiPath),
    payload,
  );
  let parsed = {};
  try {
    parsed = JSON.parse(res.data || "{}");
  } catch {
    parsed = {};
  }
  return { status: res.status, parsed };
}

app.post("/api/admin/generate-pair-code", auth, adminOnly, async (req, res) => {
  try {
    const celesi = storedLicenseKeyForCloud();
    if (!celesi) {
      return res.status(400).json({ ok: false, gabim: "Nuk ka licencë aktive në këtë POS." });
    }
    const maxReg = db.getMaxRegisters();
    if (maxReg < 2) {
      return res.status(403).json({
        ok: false,
        gabim: "Licenca lejon vetëm një pajisje — pairing nuk nevojitet.",
      });
    }
    const roleRaw = String(req.body?.terminal_role || "kamarier").trim().toLowerCase();
    const terminal_role = roleRaw === "recepsion" ? "recepsion" : "kamarier";
    const licenseGuard = require("./fiscal/license-guard");
    const eapp = electronApp();
    const cloudBody = licenseGuard.buildGeneratePairCodeCloudBody(eapp, { celesi, terminal_role });
    const { status, parsed } = await cloudTerminalJson(
      "POST",
      "/api/v1/terminal/generate-pair-code",
      cloudBody,
    );
    if (status >= 400 || parsed.ok === false) {
      return res.status(status >= 400 ? status : 400).json({
        ok: false,
        gabim: parsed.gabim || parsed.message || "Nuk u gjenerua kodi.",
      });
    }
    masterCloudRelay.pairingUntil = Date.now() + RELAY_PAIRING_WINDOW_MS;
    markMasterCatalogDirty();
    scheduleMasterCloudRelay(400);
    res.status(201).json(parsed);
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim cloud." });
  }
});

app.get("/api/admin/terminals", auth, adminOnly, async (_req, res) => {
  try {
    const celesi = storedLicenseKeyForCloud();
    const max_registers = db.getMaxRegisters();
    if (!celesi) {
      return res.json({ ok: true, terminals: [], max_registers, max_terminals: max_registers });
    }
    const qs = new URLSearchParams({ celesi }).toString();
    const { status, parsed } = await cloudTerminalJson(
      "GET",
      `/api/v1/terminal/terminals?${qs}`,
      null,
    );
    if (status >= 400 || parsed.ok === false) {
      return res.status(status >= 400 ? status : 502).json({
        ok: false,
        terminals: [],
        max_registers,
        gabim: parsed.gabim || "Nuk u lexua lista e terminaleve.",
      });
    }
    res.json({
      ...parsed,
      max_registers: parsed.max_registers != null ? parsed.max_registers : max_registers,
      max_terminals: parsed.max_registers != null ? parsed.max_registers : max_registers,
    });
  } catch (e) {
    res.status(500).json({ ok: false, terminals: [], gabim: e.message || "Gabim cloud." });
  }
});

app.delete("/api/admin/terminals/:deviceId", auth, adminOnly, async (req, res) => {
  try {
    const celesi = storedLicenseKeyForCloud();
    if (!celesi) {
      return res.status(400).json({ ok: false, gabim: "Nuk ka licencë aktive." });
    }
    const deviceId = encodeURIComponent(String(req.params.deviceId || "").trim());
    if (!deviceId) {
      return res.status(400).json({ ok: false, gabim: "Mungon pajisja." });
    }
    const licenseGuard = require("./fiscal/license-guard");
    const qs = licenseGuard.buildRemoveTerminalCloudQuery(electronApp(), celesi);
    const { status, parsed } = await cloudTerminalJson(
      "DELETE",
      `/api/v1/terminal/terminals/${deviceId}?${qs}`,
      null,
    );
    if (status >= 400 || parsed.ok === false) {
      return res.status(status >= 400 ? status : 400).json({
        ok: false,
        gabim: parsed.gabim || "Nuk u hoq terminali.",
      });
    }
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim cloud." });
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
  try {
    if (!aiCloud.AI_ENABLED) {
      return res.json({
        ok: true,
        enabled: false,
        paused: true,
        configured: false,
        package_ai: false,
        gabim: aiCloud.AI_DISABLED_MSG || "AI është i çaktivizuar.",
      });
    }
    const status = await aiCloud.fetchAiStatus(db);
    res.json(status);
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/ai/scan-menu", auth, adminOnly, async (req, res) => {
  try {
    if (!aiCloud.AI_ENABLED) {
      return res.status(503).json({ ok: false, gabim: aiCloud.AI_DISABLED_MSG });
    }
    const photo = req.body?.photo || req.body?.image || "";
    const result = await aiCloud.scanMenuFromCloud(db, { photo });
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.status === 403 ? 403 : e.status === 503 ? 503 : 400;
    res.status(status).json({ ok: false, gabim: e.message, code: e.code || null });
  }
});

const AI_HOTEL_OFF = {
  ok: false,
  enabled: false,
  gabim: aiCloud.AI_DISABLED_MSG || "AI nuk është i disponueshëm.",
};

app.post("/api/ai/scan-invoice", auth, adminOnly, async (req, res) => {
  try {
    if (!aiCloud.AI_ENABLED) {
      return res.status(503).json({ ok: false, gabim: AI_HOTEL_OFF.gabim });
    }
    const photo = req.body?.photo || req.body?.image || "";
    const receiptScan = require("./ai/ai-receipt-scan");
    const result = await receiptScan.scanReceipt(db, { photo });
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.status === 403 ? 403 : e.status === 503 ? 503 : 400;
    res.status(status).json({ ok: false, gabim: e.message, code: e.code || null });
  }
});

app.post("/api/ai/validate-invoice-scan", auth, adminOnly, (req, res) => {
  try {
    const receiptScan = require("./ai/ai-receipt-scan");
    const validation = receiptScan.validateReceiptScanApply(
      {
        supplier: req.body?.supplier,
        invoice_number: req.body?.invoice_number,
        invoice_date: req.body?.invoice_date,
        items: req.body?.items || [],
        scan_warnings: req.body?.scan_warnings,
        totals_check: req.body?.totals_check,
        allow_duplicate: req.body?.allow_duplicate === true,
        allow_owner_override: req.body?.allow_owner_override === true,
      },
      db,
    );
    res.json({
      ok: validation.ok,
      errors: validation.errors,
      duplicate_of: validation.duplicate_of || null,
      validation_skipped: validation.validation_skipped || null,
    });
  } catch (e) {
    res.status(400).json({ ok: false, errors: [e.message] });
  }
});

app.post("/api/ai/apply-invoice-scan", auth, adminOnly, async (req, res) => {
  try {
    if (!aiCloud.AI_ENABLED) {
      return res.status(503).json({ ok: false, gabim: AI_HOTEL_OFF.gabim });
    }
    const receiptScan = require("./ai/ai-receipt-scan");
    const result = receiptScan.applyReceiptToStock(db, {
      supplier: req.body?.supplier,
      invoice_number: req.body?.invoice_number,
      invoice_date: req.body?.invoice_date,
      items: req.body?.items || [],
      supplier_nui: req.body?.supplier_nui,
      supplier_vat: req.body?.supplier_vat,
      vat_rate: req.body?.vat_rate,
      purchase_kind: req.body?.purchase_kind || "goods",
      scan_warnings: req.body?.scan_warnings,
      totals_check: req.body?.totals_check,
      allow_duplicate: req.body?.allow_duplicate === true,
      allow_owner_override: req.body?.allow_owner_override === true,
    });
    syncCatalogToCloud();
    auditReq(
      req,
      "AI skanim fature → stok",
      `${result.applied_count} artikuj · ${result.created_count} të rinj`,
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/ai/usage", auth, adminOnly, async (req, res) => {
  try {
    if (!aiCloud.AI_ENABLED) {
      return res.json({
        ok: true,
        enabled: false,
        calls: 0,
        tokens_total: 0,
        cost_eur_total: 0,
        gabim: AI_HOTEL_OFF.gabim,
      });
    }
    const summary = await aiCloud.fetchAiUsageFromCloud(db, { month: req.query.month });
    res.json(summary);
  } catch (e) {
    res.status(Number(e.status) || 500).json({ ok: false, gabim: e.message });
  }
});

async function proxyAiCloudGet(req, res, cloudPath) {
  try {
    if (!aiCloud.AI_ENABLED) return res.status(503).json(AI_HOTEL_OFF);
    const data = await aiCloud.fetchOwnerAi(db, cloudPath, { query: req.query });
    res.json(data);
  } catch (e) {
    res.status(Number(e.status) || 400).json({ ok: false, gabim: e.message, code: e.code || null });
  }
}

async function proxyAiCloudPost(req, res, cloudPath) {
  try {
    if (!aiCloud.AI_ENABLED) return res.status(503).json(AI_HOTEL_OFF);
    const data = await aiCloud.postOwnerAi(db, cloudPath, req.body || {});
    res.json(data);
  } catch (e) {
    res.status(Number(e.status) || 400).json({ ok: false, gabim: e.message, code: e.code || null });
  }
}

app.get("/api/ai/waiter-rating", auth, adminOnly, (req, res) => {
  void proxyAiCloudGet(req, res, "/api/ai/waiter-rating");
});

app.post("/api/ai/waiter-rating/analyze", auth, adminOnly, (req, res) => {
  void proxyAiCloudPost(req, res, "/api/ai/waiter-rating/analyze");
});

app.get("/api/ai/stock-predict", auth, adminOnly, (req, res) => {
  void proxyAiCloudGet(req, res, "/api/ai/stock-predict");
});

app.post("/api/ai/stock-predict/analyze", auth, adminOnly, (req, res) => {
  void proxyAiCloudPost(req, res, "/api/ai/stock-predict/analyze");
});

app.get("/api/ai/weekly-reports", auth, adminOnly, (req, res) => {
  void proxyAiCloudGet(req, res, "/api/ai/weekly-reports");
});

app.post("/api/ai/weekly-reports/generate", auth, adminOnly, (req, res) => {
  void proxyAiCloudPost(req, res, "/api/ai/weekly-reports/generate");
});

app.post("/api/ai/assistant/chat", auth, adminOnly, (req, res) => {
  void proxyAiCloudPost(req, res, "/api/ai/owner-chat");
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

function resolveAutoBackupPaths() {
  const dbPath = process.env.DB_PATH || db.DB_PATH || "";
  const dataDir = dbPath ? path.dirname(dbPath) : "";
  return {
    dbPath,
    fiscalKeysPath: dataDir ? path.join(dataDir, "fiscal-keys") : "",
  };
}

function autoBackupPersistOpts(extra = {}) {
  return {
    getPersistedBackupDir: () => db.getSetting("auto_backup_dir", ""),
    setPersistedBackupDir: (dir) => {
      db.setSetting("auto_backup_dir", String(dir || "").trim());
    },
    ...extra,
  };
}

function collectAutoBackupSettingsSnapshot() {
  const cs = typeof db.getCloudSettings === "function" ? db.getCloudSettings() : {};
  return {
    biz_name: typeof db.getBusinessName === "function" ? db.getBusinessName() : "",
    restaurant_name: db.getSetting("restaurant_name", ""),
    kitchen_slug: cs.kitchen_slug || db.getSetting("kitchen_slug", ""),
    cloud_license_key: cs.cloud_license_key || db.getSetting("cloud_license_key", ""),
    cloud_client_id: cs.cloud_client_id || db.getSetting("cloud_client_id", ""),
    device_id: cs.device_id || db.getSetting("device_id", ""),
  };
}

app.get("/api/auto-backup/status", auth, adminOnly, (_req, res) => {
  try {
    const autoBackup = require("./auto-backup");
    res.json({ ok: true, ...autoBackup.getBackupStatus(autoBackupPersistOpts()) });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.get("/api/auto-backup/catalog", auth, adminOnly, (_req, res) => {
  try {
    const autoBackup = require("./auto-backup");
    res.json(autoBackup.listRestoreCatalog(autoBackupPersistOpts()));
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/auto-backup/run-now", auth, adminOnly, (_req, res) => {
  try {
    const autoBackup = require("./auto-backup");
    const paths = resolveAutoBackupPaths();
    const result = autoBackup.runBackupCycle(
      autoBackupPersistOpts({
        dbPath: paths.dbPath,
        fiscalKeysPath: paths.fiscalKeysPath,
        flushSave: typeof db.flushDatabase === "function" ? () => db.flushDatabase() : undefined,
        getSettingsSnapshot: collectAutoBackupSettingsSnapshot,
      }),
    );
    res.json({ ok: !!result.ok, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/auto-backup/restore", auth, adminOnly, async (req, res) => {
  try {
    const gate = require("./auto-backup-restore-gate");
    if (!(await gate.isLicenseActiveForDataRestore(electronApp()))) {
      return res.status(403).json({
        ok: false,
        gabim: gate.MESSAGE,
        license_required: true,
      });
    }
    const autoBackup = require("./auto-backup");
    const paths = resolveAutoBackupPaths();
    if (!paths.dbPath) {
      return res.status(400).json({ ok: false, gabim: "DB_PATH mungon." });
    }
    const sourceType = String(req.body?.source_type || req.body?.sourceType || "latest").trim();
    const sourceId = String(req.body?.source_id || req.body?.sourceId || "latest").trim();
    const result = autoBackup.restoreFromBackup(
      autoBackupPersistOpts({
        targetDbPath: paths.dbPath,
        targetKeysPath: paths.fiscalKeysPath,
        source_type: sourceType,
        source_id: sourceId,
      }),
    );
    if (!result.restored) {
      return res.status(400).json({ ok: false, gabim: result.error || "Restore dështoi." });
    }
    auditActivity(
      String(req.session?.emri || "Admin"),
      req.session?.role || "admin",
      "Rikthim auto-backup",
      `${sourceType}/${sourceId} · ${result.restored_at || ""}`,
    );
    res.json({
      ok: true,
      message: result.message,
      restart_required: true,
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
  global.__hotelHttpServer = server;
  try {
    attachWaiterWebSocket(server, { getSession });
  } catch (e) {
    console.warn("[waiter-ws] attach:", e.message);
  }
  alignTerminalRegisterOnBoot();
  try {
    db.setSetting("local_print_only", "1");
    if (!/^1|true|yes|on$/i.test(String(process.env.HOTEL_ATK_SEND_ALLOWED || "").trim())) {
      db.setSetting("atk_send_allowed", "0");
      db.setSetting("atk_auto_send", "0");
      process.env.FISCAL_LOCAL_RUN = "1";
      process.env.ATK_AUTO_SEND = "0";
    }
  } catch (e) {
    console.warn("[fiscal] local lockdown:", e.message);
  }
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
    try {
      const { startStaffLocalLinksLanWatcher } = require("./local-staff-links");
      startStaffLocalLinksLanWatcher(db);
    } catch (e) {
      console.warn("[lan-staff-links] watcher:", e.message);
    }
    try {
      const { NetworkMonitor } = require("./lib/network-monitor");
      const { startLocalDiscovery, restartLocalDiscovery } = require("./lib/local-discovery");
      const bootVenue = resolveLocalVenueSegments();
      const bootPort = getLocalServerPort();
      const mdnsOpts = () => ({
        port: getLocalServerPort(),
        slug: resolveLocalVenueSegments().slug,
        hostname: "revolution-hotel",
      });
      startLocalDiscovery(mdnsOpts());
      const lanNetworkMonitor = new NetworkMonitor(30000);
      lanNetworkMonitor.on("change", ({ previous, current }) => {
        const fromIp = previous?.primary_ip || "—";
        const toIp = current?.primary_ip || "—";
        console.log(`[lan] IP LAN ndryshoi: ${fromIp} → ${toIp} (port ${current?.port || bootPort})`);
        restartLocalDiscovery(mdnsOpts());
      });
      lanNetworkMonitor.start();
    } catch (e) {
      console.warn("[lan] discovery/monitor:", e.message);
    }
    setTimeout(() => {
      cloudSync.syncRestaurantIdentityFromCloud(db).catch(() => {});
    }, 2000);
    setTimeout(() => {
      setInterval(() => cloudSync.reconcileAllTablesWithCloud(db), 60000);
    }, 15000);
    setTimeout(() => {
      // Mos sync-anulo cloud 7s pas nisjes — kuzhina humb porosinë sapo «Dërgo porosinë».
      setInterval(() => cloudSync.syncLocalCancelledFromCloud(db).catch(() => {}), 25000);
    }, 90000);
    setTimeout(() => {
      try {
        const purchaseCloudPull = require("./purchase-cloud-pull");
        purchaseCloudPull.startPendingPurchasePull(db, 45000);
      } catch (e) {
        console.warn("[purchase-cloud] start:", e.message);
      }
    }, 12000);
    setTimeout(() => {
      try {
        ensureOnlineOrdersWatcher();
      } catch (e) {
        console.warn("[cloud] online-orders-watcher:", e.message);
      }
      try {
        ensurePublicGuestRequestsWatcher();
      } catch (e) {
        console.warn("[cloud] public-guest-requests-watcher:", e.message);
      }
      try {
        ensureWaiterReadyPoller();
        pollWaiterReadyOrdersBroadcast().catch(() => {});
      } catch (e) {
        console.warn("[cloud] waiter-ready-poller:", e.message);
      }
    }, 1500);
    try {
      const autoBackup = require("./auto-backup");
      const paths = resolveAutoBackupPaths();
      if (paths.dbPath) {
        autoBackup.startAutoBackup(
          autoBackupPersistOpts({
            dbPath: paths.dbPath,
            fiscalKeysPath: paths.fiscalKeysPath,
            intervalMs: 60 * 1000,
            flushSave: typeof db.flushDatabase === "function" ? () => db.flushDatabase() : undefined,
            getSettingsSnapshot: collectAutoBackupSettingsSnapshot,
          }),
        );
      }
    } catch (e) {
      console.warn("[backup] auto-start:", e.message);
    }
    try {
      const terminalSync = require("./terminal-sync");
      terminalLanSyncInstance = terminalSync.createTerminalLanSync({
        db,
        electronApp,
        storedLicenseKeyForCloud,
        terminalRegisterNumber: terminalRegisterNumberLocal,
      });
      terminalLanSyncInstance.startTerminalLanSync();
    } catch (e) {
      console.warn("[lan-sync] start:", e.message);
    }
    try {
      scheduleMasterCloudRelay(8000);
    } catch (e) {
      console.warn("[relay] schedule:", e.message);
    }
    if (terminalRegisterNumberLocal() < 2) {
      setTimeout(() => {
        publishMasterCatalogSnapshots().catch((e) => console.warn("[relay-snapshots]", e.message || e));
      }, 12000);
      setInterval(() => {
        publishMasterCatalogSnapshots().catch((e) => console.warn("[relay-snapshots]", e.message || e));
      }, CATALOG_SNAPSHOT_PUBLISH_MS);
    }
    try {
      const {
        applyLocalRunDatabaseLockdown,
        scheduleStartupSelfTest,
        logStartupFiscalStatus,
      } = require("./fiscal/fiscal-boot");
      applyLocalRunDatabaseLockdown();
      scheduleStartupSelfTest(3500);
      logStartupFiscalStatus();
    } catch (e) {
      console.warn("[hotel] fiscal-boot:", e.message);
    }
    try {
      const { isAtkAutoSendEnabled, processOfflineQueue } = require("./fiscal/fiscal-offline");
      const { isFiscalLocalRun } = require("./fiscal/fiscal-local-env");
      if (isAtkAutoSendEnabled() && !isFiscalLocalRun()) {
        setTimeout(() => {
          processOfflineQueue({ manual: false })
            .then((r) => {
              const n = Number(r?.processed) || 0;
              if (n > 0) {
                console.log(`[hotel] ATK — u dërguan ${n} kupon(ë) në pritje (nisje)`);
              }
            })
            .catch((e) => console.warn("[hotel] ATK boot flush:", e.message));
        }, 4000);
      }
    } catch (e) {
      console.warn("[hotel] offline queue schedule:", e.message);
    }
    setTimeout(() => {
      try {
        const { resumeAllPendingOnBoot } = require("./fiscal/fiscal-recovery");
        resumeAllPendingOnBoot({ skip_print: false })
          .then((r) => {
            if ((r.resumed && r.resumed.length) || (r.abandoned && r.abandoned.length)) {
              console.log(
                `[hotel] recovery: resumed=${r.resumed?.length || 0} abandoned=${r.abandoned?.length || 0}`
              );
            }
          })
          .catch((e) => console.warn("[hotel] recovery:", e.message));
      } catch (e) {
        console.warn("[hotel] recovery boot:", e.message);
      }
    }, 1500);
  }, 2500);
  setImmediate(() => {
    try {
      const { startOfflineMonitor } = require("./fiscal/fiscal-offline");
      startOfflineMonitor();
    } catch (e) {
      console.warn("[hotel] offline monitor:", e.message);
    }
  });
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
    .then(() => {
      alignTerminalRegisterOnBoot();
      return startServer();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
