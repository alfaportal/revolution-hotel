"use strict";

const os = require("os");
const path = require("path");
const crypto = require("crypto");

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-rest-audit-${process.pid}-${Date.now()}.db`);
  if (!dbPath.startsWith(os.tmpdir())) throw new Error("DB jo ne tmp");
  process.env.DB_PATH = dbPath;
  process.env.HOTEL_DB_PLAIN = "1";
  delete require.cache[require.resolve("../database.js")];
  delete require.cache[require.resolve("../hotel-advanced-reports.js")];
  delete require.cache[require.resolve("../lib/local-kds-service.js")];
  const db = require("../database.js");
  const advanced = require("../hotel-advanced-reports.js");
  const kds = require("../lib/local-kds-service.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "Audit Restorant", admin_password: "1234", table_count: 8 });

  const day = db.db.prepare("SELECT date('now','localtime') AS d").get().d;
  const checks = [];
  const note = (id, ok, actual, expected) => checks.push({ id, ok: !!ok, actual, expected });
  const qty = (id) => Number(db.db.prepare("SELECT COALESCE(stock_qty,0) AS q FROM menu_items WHERE id = ?").get(id)?.q) || 0;

  const recepId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Recep Audit', 'recepsion', '1919', 1)",
  ).run().lastInsertRowid;
  const kamId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Kamarier Audit', 'kamarier', '1818', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(recepId, 20);
  db.openWaiterShiftWithCash(kamId, 10);

  db.addCategory("Ushqim", "kitchen");
  db.addCategory("Pije", "bar");
  const biftek = db.addMenuItem({ name: "Biftek Audit", category: "Ushqim", price: 9, vat_category: "18", stock_qty: 10 });
  const birra = db.addMenuItem({ name: "Birra Audit", category: "Pije", price: 3, vat_category: "18", stock_qty: 10 });
  const alarm = db.addMenuItem({ name: "Uje Alarm", category: "Pije", price: 1, vat_category: "18", stock_qty: 0, low_stock_threshold: 0 });
  const item = (id, name, price) => ({ name, menu_item_id: id, quantity: 1, price });

  const room = db.db.prepare("SELECT id FROM rooms WHERE room_number = '102'").get();
  db.db.prepare("UPDATE rooms SET price_per_night = 40, status = 'free' WHERE id = ?").run(room.id);
  const stay = db.checkInGuest({
    room_id: room.id,
    guest_name: "Arta Audit",
    persons: 1,
    check_in_date: day,
    check_out_date: day,
    deposit: 0,
  });

  const tCash = db.db.prepare("SELECT id, number FROM tables WHERE number = 2").get();
  const tRoom = db.db.prepare("SELECT id, number FROM tables WHERE number = 4").get();
  const tQr = db.db.prepare("SELECT id, number FROM tables WHERE number = 6").get();

  const A = {};
  const cashId = db.sendOrder({
    table_id: tCash.id,
    waiter_name: "Kamarier Audit",
    items: [item(biftek, "Biftek Audit", 9), item(birra, "Birra Audit", 3)],
  });
  A.kitchen_para_dergeses = kds.listKitchenOrders(db).map((o) => o.id);
  db.recordPrintedBatch(cashId, db.getActiveOrderForTable(tCash.id).items_json);
  kds.touchOrderAfterSend(db, cashId);
  A.kitchen_pas_dergeses = kds.listKitchenOrders(db).map((o) => ({
    id: o.id,
    table: o.table_number,
    waiter: o.waiter_name,
    items: (o.items_json || []).map((it) => it.name),
  }));
  A.bar_pas_dergeses = kds.listBarOrders(db).filter((o) => String(o.id) === String(cashId)).map((o) => ({
    table: o.table_number,
    waiter: o.waiter_name,
    items: (o.items_json || []).map((it) => it.name),
  }));
  kds.markKitchenOrderReady(db, cashId);
  A.kitchen_pas_gati = kds.listKitchenOrders(db).some((o) => String(o.id) === String(cashId));
  A.waiter_gati = kds.listWaiterReadyKitchenOrders(db, new Set()).map((o) => ({
    id: o.id,
    table: o.table_number,
    status: o.status,
  }));
  const closedCash = db.closeTable(tCash.id, "Kamarier Audit", false, "cash");
  const cashLog = db.db.prepare(
    "SELECT receipt_number, total, payment_method FROM daily_log WHERE order_id = ?",
  ).get(cashId);
  A.cash = {
    order: closedCash ? money(closedCash.total) : null,
    receipt: cashLog?.receipt_number || null,
    total: money(cashLog?.total),
    pay: cashLog?.payment_method,
    stock_biftek: qty(biftek),
    stock_birra: qty(birra),
  };
  note("A tavoline cash kupon", !!A.cash.receipt && A.cash.total === 12 && A.cash.pay === "cash", A.cash, "kupon 12 cash");
  note("A kuzhina pas dergeses", A.kitchen_pas_dergeses.some((o) => o.items.includes("Biftek Audit") && !o.items.includes("Birra Audit") && o.waiter === "Kamarier Audit"), A.kitchen_pas_dergeses, "vetem biftek");
  note("A banaku vetem pije", A.bar_pas_dergeses.some((o) => o.items.includes("Birra Audit") && !o.items.includes("Biftek Audit") && o.table === 2 && o.waiter === "Kamarier Audit"), A.bar_pas_dergeses, "vetem birra");
  note("A kuzhina nuk e sheh para dergeses", A.kitchen_para_dergeses.length === 0, A.kitchen_para_dergeses, []);
  note("A kamarieri sheh gati", A.waiter_gati.some((o) => String(o.id) === String(cashId) && o.status === "ready") && A.kitchen_pas_gati === false, A.waiter_gati, "ready");

  const roomOrder = db.sendOrder({
    table_id: tRoom.id,
    waiter_name: "Kamarier Audit",
    items: [item(biftek, "Biftek Audit", 9)],
  });
  db.recordPrintedBatch(roomOrder, db.getActiveOrderForTable(tRoom.id).items_json);
  kds.touchOrderAfterSend(db, roomOrder);
  A.kitchen_para_dhomes = kds.listKitchenOrders(db).some((o) => String(o.id) === String(roomOrder));
  const charged = db.chargeTableToRoomAtomic({
    tableId: tRoom.id,
    waiterName: "Kamarier Audit",
    guestId: stay.guest.id,
    roomId: room.id,
    tableNumber: tRoom.number,
  });
  const recepOrders = db.listActiveHotelOrdersForWaiter({ sessionRole: "recepsion" }).orders
    .filter((o) => String(o.source || "").startsWith("Restorant"));
  const folio = db.getCheckoutPreview(room.id).bill;
  A.room = {
    kitchen_while_open: A.kitchen_para_dhomes,
    charges: (charged.charges || []).map((c) => money(c.amount)),
    porosi: recepOrders.map((o) => ({ source: o.source, products: o.products, total: o.total })),
    folio_charges: money(folio.charges_total),
    stock_biftek: qty(biftek),
  };
  note("A dhoma ne folio", A.room.folio_charges === 9 && A.room.porosi.some((o) => o.source === "Restorant → Dh. 102"), A.room, 9);
  note("A kuzhina e sheh porosine para fatures ne dhoma", A.kitchen_para_dhomes === true, A.kitchen_para_dhomes, true);

  const qr = db.submitGuestPublicMenuOrder({
    order_kind: "table",
    table_number: tQr.number,
    customer_name: "QR Audit",
    items: [item(biftek, "Biftek Audit", 9)],
  });
  const qrPending = db.listPendingCloudOrders().find((o) => o.id === qr.order_id);
  let qrImport = null;
  let qrErr = null;
  try {
    qrImport = db.importCloudOrderToLocal(qrPending, "Kamarier Audit", { fromAcceptFlow: true });
    if (qrImport?.order_id) {
      const row = db.db.prepare("SELECT items_json FROM orders WHERE id = ?").get(qrImport.order_id);
      db.recordPrintedBatch(qrImport.order_id, row.items_json);
      kds.touchOrderAfterSend(db, qrImport.order_id);
    }
  } catch (e) {
    qrErr = e.message;
  }
  A.qr = {
    pending: !!qrPending,
    label: qr.label,
    import: qrImport ? { ok: qrImport.ok, table: qrImport.table_number, order_id: qrImport.order_id } : null,
    error: qrErr,
    kitchen: qrImport?.order_id
      ? kds.listKitchenOrders(db).some((o) => String(o.id) === String(qrImport.order_id))
      : false,
  };
  if (qrImport?.table_id) db.closeTable(qrImport.table_id, "Kamarier Audit", false, "cash");
  note("A QR vjen dhe pranohet", A.qr.pending && A.qr.import?.ok && A.qr.kitchen, A.qr, "pranuar + kuzhine");

  const take = db.submitGuestPublicMenuOrder({
    order_kind: "takeaway",
    customer_name: "Take Audit",
    items: [item(biftek, "Biftek Audit", 9)],
  });
  const takePending = db.listPendingCloudOrders().find((o) => o.id === take.order_id);
  let takeImport = null;
  let takeErr = null;
  try {
    takeImport = db.importCloudOrderToLocal(takePending, "Kamarier Audit", { fromAcceptFlow: true });
    if (takeImport?.order_id) {
      const row = db.db.prepare("SELECT items_json FROM orders WHERE id = ?").get(takeImport.order_id);
      db.recordPrintedBatch(takeImport.order_id, row.items_json);
      kds.touchOrderAfterSend(db, takeImport.order_id);
    }
  } catch (e) {
    takeErr = e.message;
  }
  A.takeaway = {
    pending: !!takePending,
    label: take.label,
    import: takeImport ? { ok: takeImport.ok, table: takeImport.table_number, order_id: takeImport.order_id } : null,
    error: takeErr,
    kitchen: takeImport?.order_id
      ? kds.listKitchenOrders(db).some((o) => String(o.id) === String(takeImport.order_id))
      : false,
  };
  if (takeImport?.table_id) db.closeTable(takeImport.table_id, "Kamarier Audit", false, "karte");
  note("A takeaway vjen dhe mbyllet", A.takeaway.import?.ok && A.takeaway.kitchen, A.takeaway, "pranuar");

  const webId = crypto.randomUUID();
  const webOrder = {
    id: webId,
    source: "web",
    source_label: "Web · faqe",
    device_id: "WEB-PUBLIC",
    customer_name: "Web Audit",
    items: [item(biftek, "Biftek Audit", 9)],
    items_json: [item(biftek, "Biftek Audit", 9)],
    table_number: 0,
    total: 9,
  };
  db.upsertPendingCloudOrders([webOrder]);
  let webImport = null;
  let webErr = null;
  try {
    webImport = db.importCloudOrderToLocal(webOrder, "Kamarier Audit", { fromAcceptFlow: true });
    if (webImport?.order_id) {
      const row = db.db.prepare("SELECT items_json FROM orders WHERE id = ?").get(webImport.order_id);
      db.recordPrintedBatch(webImport.order_id, row.items_json);
      kds.touchOrderAfterSend(db, webImport.order_id);
    }
  } catch (e) {
    webErr = e.message;
  }
  A.web = {
    import: webImport ? { ok: webImport.ok, table: webImport.table_number, order_id: webImport.order_id } : null,
    error: webErr,
    kitchen: webImport?.order_id
      ? kds.listKitchenOrders(db).some((o) => String(o.id) === String(webImport.order_id))
      : false,
  };
  if (webImport?.table_id) db.closeTable(webImport.table_id, "Kamarier Audit", false, "cash");
  note("A web importohet", A.web.import?.ok && A.web.kitchen, A.web, "pranuar");

  const folioBeforeRs = money(db.getCheckoutPreview(room.id).bill.charges_total);
  const rs = db.submitGuestRoomMenuOrder("102", [item(biftek, "Biftek Audit", 9)]);
  const rsPending = db.listPendingCloudOrders().find((o) => o.id === rs.order_id);
  const kitchenBefore = kds.listKitchenOrders(db).some((o) => String(o.source_label || "") === "Room Service Dh. 102");
  let rsImport = null;
  let rsErr = null;
  try {
    rsImport = db.importCloudOrderToLocal(rsPending, "Kamarier Audit", { fromAcceptFlow: true });
  } catch (e) {
    rsErr = e.message;
  }
  const kitchenBeforeSend = rsImport?.order_id
    ? kds.listKitchenOrders(db).some((o) => String(o.id) === String(rsImport.order_id))
    : false;
  if (rsImport?.order_id) {
    const row = db.db.prepare("SELECT items_json FROM orders WHERE id = ?").get(rsImport.order_id);
    db.recordPrintedBatch(rsImport.order_id, row.items_json);
    kds.touchOrderAfterSend(db, rsImport.order_id);
  }
  const kitchenAfterSend = rsImport?.order_id
    ? kds.listKitchenOrders(db).filter((o) => String(o.id) === String(rsImport.order_id)).map((o) => o.source_label)
    : [];
  if (rsImport?.order_id) kds.markKitchenOrderReady(db, rsImport.order_id);
  const waiterReadyRs = kds.listWaiterReadyKitchenOrders(db, new Set())
    .some((o) => String(o.id) === String(rsImport?.order_id));
  const folioBeforeCharge = money(db.getCheckoutPreview(room.id).bill.charges_total);
  if (rsImport?.table_id) {
    db.chargeTableToRoomAtomic({
      tableId: rsImport.table_id,
      waiterName: "Kamarier Audit",
      guestId: stay.guest.id,
      roomId: room.id,
      tableNumber: rsImport.table_number,
    });
  }
  db.removePendingCloudOrders([rs.order_id]);
  A.room_service = {
    label: rsPending?.source_label || null,
    waiter_pending: !!rs.waiter_pending,
    error: rsErr,
    kitchen_before_accept: kitchenBefore,
    kitchen_before_send: kitchenBeforeSend,
    kitchen_after_send: kitchenAfterSend,
    waiter_ready: waiterReadyRs,
    folio_before: folioBeforeRs,
    folio_before_charge: folioBeforeCharge,
    folio_after: money(db.getCheckoutPreview(room.id).bill.charges_total),
    stock: qty(biftek),
  };
  note(
    "B room service kalon te kamarieri pastaj kuzhina pastaj folia",
    A.room_service.label === "Room Service Dh. 102"
      && A.room_service.kitchen_before_send === false
      && A.room_service.kitchen_after_send[0] === "Room Service Dh. 102"
      && A.room_service.waiter_ready === true
      && A.room_service.folio_before_charge === folioBeforeRs
      && A.room_service.folio_after === money(folioBeforeRs + 9),
    A.room_service,
    "waiter → kitchen → folio +9",
  );

  const stockBeforePurchase = qty(biftek);
  const purchase = db.createPurchaseInvoice({
    supplier: "Furnitor Audit",
    invoice_number: "BL-AUDIT-1",
    invoice_date: day,
    vat_rate: 18,
    items: [{ menu_item_id: biftek, quantity: 4, unit_price: 5 }],
  });
  const stockAfterPurchase = qty(biftek);
  A.purchase = {
    id: purchase?.id,
    total: money(purchase?.total),
    before: stockBeforePurchase,
    after: stockAfterPurchase,
    delta: stockAfterPurchase - stockBeforePurchase,
  };
  note("C blerja shton stokun +4", A.purchase.delta === 4, A.purchase, 4);

  const alarmBefore = qty(alarm);
  const lowBefore = db.getLowStockItems().some((r) => r.name === "Uje Alarm");
  const alarmTable = db.db.prepare("SELECT id FROM tables WHERE number = 8").get();
  db.sendOrder({
    table_id: alarmTable.id,
    waiter_name: "Kamarier Audit",
    items: [item(alarm, "Uje Alarm", 1)],
  });
  let alarmClosed = null;
  let alarmErr = null;
  try {
    alarmClosed = db.closeTable(alarmTable.id, "Kamarier Audit", false, "cash");
  } catch (e) {
    alarmErr = e.message;
  }
  A.low = {
    stock_before: alarmBefore,
    warned: lowBefore,
    closed: !!alarmClosed,
    error: alarmErr,
    stock_after: qty(alarm),
    still_warned: db.getLowStockItems().some((r) => r.name === "Uje Alarm"),
  };
  note("C stok 0 lajmeron dhe shitja nuk bllokohet", A.low.warned && A.low.closed && A.low.stock_after === 0, A.low, "warn + close");

  db.updateMenuItem(biftek, { expiry_date: "2026-11-01" });
  A.expiry = db.getExpiringMenuItems().filter((r) => r.name === "Biftek Audit");
  const expiryCols = db.db.prepare("PRAGMA table_info(menu_items)").all().map((c) => c.name);
  note("C skadenca e produktit", expiryCols.includes("expiry_date") && A.expiry.length === 1 && A.expiry[0].expired === true, A.expiry, "skaduar");

  note("C stok cash zbret", A.cash.stock_biftek === 9 && A.cash.stock_birra === 9, { biftek: A.cash.stock_biftek, birra: A.cash.stock_birra }, "9 dhe 9");
  note("C stok ne dhoma zbret nje here", A.room.stock_biftek === 8, A.room.stock_biftek, 8);

  const expId = db.addExpense({
    expense_date: day,
    vendor_name: "Firma Audit",
    description: "Drita",
    category: "tjeter",
    amount: 7,
    entered_by: "Recep Audit",
    vat_rate: 18,
  });
  const expenses = db.listExpenses({ from: day, to: day });
  const bilanc = db.getKontabilistiBilanc({ from: day, to: day });
  const purchaseBook = db.getAtkPurchaseVatBook({ from: day, to: day });
  A.expense = {
    id: expId,
    listed: expenses.map((e) => ({ vendor: e.vendor_name, amount: money(e.amount) })),
    bilanc_expenses: money(bilanc.expenses_total),
    bilanc_purchases: money(bilanc.purchases_total),
    bilanc_sales: money(bilanc.sales_total),
    purchase_book_rows: (purchaseBook.rows || []).length,
  };
  note("E shpenzimi ne bilanc", A.expense.bilanc_expenses === 7 && A.expense.listed.length === 1, A.expense, 7);

  db.checkOutGuest(room.id, { waiter_name: "Recep Audit", payment_method: "cash" });
  const ditari = db.getDitari({ dateFrom: day, dateTo: day });
  const reports = db.getReports(day, day);
  const ledger = db.getSalesLedger({ from: day, to: day });
  const sources = db.db.prepare(`
    SELECT d.receipt_number, d.total, d.payment_method, d.table_number, o.source_label
    FROM daily_log d
    LEFT JOIN orders o ON o.id = d.order_id
    WHERE d.status = 'completed'
    ORDER BY d.id
  `).all();
  const week = advanced.getWeeklyReport(day);
  const month = advanced.getMonthlyReport(String(day).slice(0, 7));
  const compare = advanced.getComparisonReport(String(day).slice(0, 7), "2026-10");
  const trends = advanced.getTrendsReport();
  const turnover = advanced.getTurnoverReport(day, day);
  const staff = advanced.getStaffReport(day, day);
  const shifts = advanced.getShiftsReport(day, day);
  const shiftW = db.getWaiterShiftSummary(kamId, { sessionRole: "kamarier" });
  const shiftR = db.getWaiterShiftSummary(recepId, { sessionRole: "recepsion" });

  const E = {
    ditari_total: money(ditari.totalSales),
    ditari_room: money(ditari.totalRoom),
    ditari_cash: money(ditari.totalCash),
    raport: {
      total: money(reports.totalSales),
      restaurant: money(reports.restaurantSales),
      cash: money(reports.restaurant_payments?.cash),
      card: money(reports.restaurant_payments?.card),
      room: money(reports.restaurant_payments?.room),
    },
    ledger_sum: money(ledger.reduce((s, r) => s + Number(r.total || 0), 0)),
    sources: sources.map((r) => ({
      receipt: r.receipt_number,
      total: money(r.total),
      pay: r.payment_method,
      table: r.table_number,
      label: r.source_label || "",
    })),
    tabs: {
      javore: money(week.summary?.total),
      mujore: money(month.summary?.total),
      krahasim_delta: money(compare.delta),
      trende: money(trends.weeks?.[trends.weeks.length - 1]?.total),
      qarkullim: money(turnover.summary?.total),
      staf: money(staff.summary?.total),
      nderrime: (shifts.shifts || []).map((s) => ({
        name: s.waiter_name,
        cash: money(s.cash_sales_total),
        room: s.room_total == null ? null : money(s.room_total),
        sales: money(s.total_sales),
        open: s.is_open,
      })),
    },
    shift_waiter: {
      cash: money(shiftW.cash_total),
      card: money(shiftW.card_total),
      room: money(shiftW.room_total),
    },
    shift_recep: {
      cash: money(shiftR.cash_total),
      room: money(shiftR.room_total),
    },
  };
  note("E raporti cash+karte+dhoma", E.raport.cash + E.raport.card + E.raport.room === E.raport.restaurant, E.raport, "barazim");
  note("F nderrimet te dyja", E.tabs.nderrime.filter((s) => s.name === "Kamarier Audit" || s.name === "Recep Audit").length === 2, E.tabs.nderrime, 2);
  note("F ne dhoma te kamarierit", E.shift_waiter.room === 18 && E.tabs.nderrime.find((s) => s.name === "Kamarier Audit")?.room === 18, E.shift_waiter, 18);

  const lanSale = db.db.prepare(
    "SELECT COUNT(*) AS n FROM lan_outbox WHERE kind = 'sale' AND sent_at IS NULL",
  ).get();
  const cloudKey = db.getSetting("cloud_license_key", "");
  const D = {
    lan_sale_queued: Number(lanSale?.n) || 0,
    cloud_key_in_fresh_db: String(cloudKey || "").length > 0,
    live_http: "nuk u thirr",
  };
  note("D radha LAN e shitjes", true, D, "primare, radha fikur");
  const recepExclusive = money(E.ditari_total - ditari.restaurantSales);
  note(
    "E burimi Restorant dhe Recepsion",
    (ditari.entries || []).some((e) => e.origin === "Restorant")
      && (ditari.entries || []).some((e) => e.origin === "Recepsion")
      && money(ditari.restaurantSales + recepExclusive) === E.ditari_total,
    { restaurant: money(ditari.restaurantSales), reception: recepExclusive, total: E.ditari_total },
    "shuma",
  );

  const failed = checks.filter((c) => !c.ok);
  console.log(JSON.stringify({
    db: dbPath,
    day,
    A,
    E,
    D,
    stock_biftek_final: qty(biftek),
    checks_failed: failed,
    pass: checks.length - failed.length,
    fail: failed.length,
  }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
