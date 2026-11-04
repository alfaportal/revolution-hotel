"use strict";

const assert = require("assert");
const os = require("os");
const path = require("path");

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sum(rows, key) {
  return money(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0));
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-guest-flow-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  delete require.cache[require.resolve("../database.js")];
  delete require.cache[require.resolve("../hotel-advanced-reports.js")];
  const db = require("../database.js");
  const advanced = require("../hotel-advanced-reports.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "Guest Flow Fiktiv", admin_password: "1234", table_count: 4 });

  const report = { db: dbPath, steps: [] };
  const note = (id, ok, detail) => {
    report.steps.push({ id, ok: !!ok, ...detail });
  };

  const roomRow = db.db.prepare("SELECT id, status FROM rooms WHERE room_number = '102'").get()
    || db.db.prepare("SELECT id, status FROM rooms ORDER BY id LIMIT 1").get();
  db.db.prepare(
    "UPDATE rooms SET room_number = '102', price_per_night = 80, status = 'free' WHERE id = ?",
  ).run(roomRow.id);

  const recepId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Fiktiv Recep', 'recepsion', '919191', 1)",
  ).run().lastInsertRowid;
  const kamarierId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Fiktiv Kamarier', 'kamarier', '818181', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(recepId, 50);
  db.openWaiterShiftWithCash(kamarierId, 20);

  for (const name of ["Pije", "Ushqim", "Minibar"]) {
    if (!db.db.prepare("SELECT id FROM categories WHERE name = ?").get(name)) db.addCategory(name);
  }
  const kafe = db.addMenuItem({ name: "Kafe", category: "Pije", price: 2.5, vat_category: "18" });
  const sanduic = db.addMenuItem({ name: "Sanduiç", category: "Ushqim", price: 4, vat_category: "18" });
  const minibar = db.addMenuItem({ name: "Ujë minibar", category: "Minibar", price: 3, vat_category: "18" });
  const biftek = db.addMenuItem({ name: "Biftek", category: "Ushqim", price: 9, vat_category: "18" });
  const pastrim = db.createHotelService({ name: "Pastrim dhome", price: 12, vat_category: "18" });

  const stay = db.checkInGuest({
    room_id: roomRow.id,
    guest_name: "Arta Fiktive",
    persons: 1,
    check_in_date: "2026-11-03",
    check_out_date: "2026-11-04",
    deposit: 0,
  });
  const guest = stay.guest;

  const rs = db.submitGuestRoomMenuOrder("102", [
    { name: "Kafe", quantity: 1, price: 2.5, menu_item_id: kafe },
    { name: "Sanduiç", quantity: 1, price: 4, menu_item_id: sanduic },
  ]);
  const pendingAfterRs = db.listPendingCloudOrders();
  const rsPending = pendingAfterRs.find((o) => o.id === rs.order_id);
  const chargesBeforeWaiter = db.listRoomChargesForGuest(guest.id);
  const importedRs = db.importCloudOrderToLocal(rsPending, "Fiktiv Kamarier", { fromAcceptFlow: true });
  db.removePendingCloudOrders([rs.order_id]);
  if (importedRs?.order_id) {
    const row = db.db.prepare("SELECT items_json FROM orders WHERE id = ?").get(importedRs.order_id);
    db.recordPrintedBatch(importedRs.order_id, row.items_json);
    require("../lib/local-kds-service").touchOrderAfterSend(db, importedRs.order_id);
  }
  if (importedRs?.table_id) {
    db.chargeTableToRoomAtomic({
      tableId: importedRs.table_id,
      waiterName: "Fiktiv Kamarier",
      guestId: guest.id,
      roomId: roomRow.id,
      tableNumber: importedRs.table_number,
    });
  }
  note("1-room-service-kamarier", true, {
    label: rsPending?.source_label || null,
    waiter_pending: rs.waiter_pending,
    charges_before: chargesBeforeWaiter.length,
    imported: importedRs ? { order_id: importedRs.order_id, table: importedRs.table_number } : null,
    charges_after: db.listRoomChargesForGuest(guest.id).length,
    folio: db.getCheckoutPreview(roomRow.id).bill.charges_total,
  });

  const mini = db.submitGuestRoomMenuOrder("102", [
    { name: "Ujë minibar", quantity: 1, price: 3, category: "Minibar", menu_item_id: minibar },
  ]);
  const miniPending = db.listPendingCloudOrders().find((o) => o.id === mini.order_id);
  db.tryApplyCloudRoomMenuOrder(miniPending);
  db.removePendingCloudOrders([mini.order_id]);
  note("3-minibar", true, {
    label: miniPending?.source_label || null,
    category_on_item: miniPending?.items?.[0]?.category || null,
    charges: db.listRoomChargesForGuest(guest.id).map((c) => c.description),
  });

  const clean = db.submitGuestRoomServiceOrder("102", [
    { service_id: pastrim.id, quantity: 1 },
  ]);
  const cleanPending = db.listPendingCloudOrders().find((o) => o.id === clean.order_id);
  const chargesBeforeClean = db.listRoomChargesForGuest(guest.id).length;
  const activeBeforeClean = db.listActiveHotelOrdersForWaiter({ sessionRole: "recepsion" }).orders
    .filter((o) => String(o.products || "").toLowerCase().includes("pastrim"));
  const appliedClean = db.applyGuestHotelServiceOrder(cleanPending);
  db.removePendingCloudOrders([clean.order_id]);
  note("4-pastrim", true, {
    before_accept: {
      pending: cleanPending
        ? { source: cleanPending.source_label, customer: cleanPending.customer_label, total: cleanPending.total }
        : null,
      in_porosi_aktive: activeBeforeClean.length,
      charges: chargesBeforeClean,
    },
    after_accept: appliedClean,
    charges: db.listRoomChargesForGuest(guest.id).map((c) => ({ description: c.description, amount: c.amount })),
  });

  const table = db.db.prepare("SELECT id, number FROM tables ORDER BY number LIMIT 1").get();
  const orderId = db.sendOrder({
    table_id: table.id,
    waiter_name: "Fiktiv Kamarier",
    items: [{ name: "Biftek", menu_item_id: biftek, quantity: 1, price: 9 }],
  });
  const charged = db.chargeTableToRoomAtomic({
    tableId: table.id,
    waiterName: "Fiktiv Kamarier",
    guestId: guest.id,
    roomId: roomRow.id,
    tableNumber: table.number,
  });
  note("5-restorant-ne-dhome", true, {
    order_id: orderId,
    table: table.number,
    charges: (charged.charges || []).map((c) => ({ description: c.description, amount: c.amount })),
    daily_log_room: db.db.prepare(
      "SELECT receipt_number, total, payment_method, items_json FROM daily_log WHERE status = 'completed'",
    ).all(),
  });

  const preview = db.getCheckoutPreview(roomRow.id);
  const fiscal = db.buildCheckoutFiscalItems(preview.bill, preview.room);
  const day = "2026-11-03";
  const ledgerBefore = db.getSalesLedger({ from: day, to: "2026-11-04" });
  const ditariBefore = db.getDitari({ dateFrom: day, dateTo: "2026-11-04" });
  note("6-para-checkout", true, {
    folio: {
      nights: preview.bill.nights,
      room_total: preview.bill.room_total,
      charges_total: preview.bill.charges_total,
      total: preview.bill.total,
      charges: (preview.bill.charges || []).map((c) => ({ description: c.description, amount: c.amount })),
    },
    fiscal_coupon_lines: fiscal.items,
    fiscal_total: fiscal.total_amount,
    ditari_entries: (ditariBefore.entries || []).map((e) => ({
      receipt: e.receipt_number, total: e.total, pay: e.payment_method, items: e.artikujt,
    })),
    ditari_total: money((ditariBefore.entries || []).filter((e) => e.status !== "cancelled").reduce((s, e) => s + Number(e.total || 0), 0)),
    kontabilisti: ledgerBefore.map((r) => ({
      receipt: r.receipt_number, source: r.source, total: r.total, items: r.items,
    })),
    kontabilisti_total: sum(ledgerBefore, "total"),
  });

  const closed = db.checkOutGuest(roomRow.id, {
    waiter_name: "Fiktiv Recep",
    payment_method: "cash",
  });
  const activeAfterOut = db.listActiveHotelOrdersForWaiter({ sessionRole: "recepsion" }).orders
    .filter((o) => String(o.source || "").includes("Arta") || String(o.source || "").includes("102"));
  const co = db.db.prepare(
    "SELECT receipt_number, total, payment_method, items_json, date FROM daily_log WHERE receipt_number LIKE 'CO-%'",
  ).get();
  const ditariAfter = db.getDitari({ dateFrom: day, dateTo: "2026-11-04" });
  const ledgerAfter = db.getSalesLedger({ from: day, to: "2026-11-04" });
  const coDate = String(co?.date || day).slice(0, 10);
  const week = advanced.getWeeklyReport(coDate);
  const month = advanced.getMonthlyReport(coDate.slice(0, 7));
  const compare = advanced.getComparisonReport(coDate.slice(0, 7), "2026-10");
  const trends = advanced.getTrendsReport();
  const turnover = advanced.getTurnoverReport(coDate, coDate);
  const staff = advanced.getStaffReport(coDate, coDate);
  const shifts = advanced.getShiftsReport(coDate, coDate);

  note("7-checkout", true, {
    guest_status: closed.guest.status,
    room_status: closed.room.status,
    folio_total: closed.bill.total,
    folio_charges: closed.bill.charges_total,
    folio_room: closed.bill.room_total,
    coupon_items: JSON.parse(co?.items_json || "[]"),
    coupon_total: co?.total,
    porosi_aktive_per_102: activeAfterOut,
    ditari: (ditariAfter.entries || []).map((e) => ({
      receipt: e.receipt_number, total: e.total, pay: e.payment_method,
    })),
    ditari_sum: money(ditariAfter.totalSales),
    kontabilisti: ledgerAfter.map((r) => ({
      receipt: r.receipt_number, source: r.source, total: r.total, items: r.items,
    })),
    kontabilisti_sum: sum(ledgerAfter, "total"),
    avancuara: {
      javore: week.summary,
      mujore: month.summary,
      krahasime: { delta: compare.delta, muaji: compare.month2?.summary },
      trende_java_e_fundit: trends.weeks[trends.weeks.length - 1],
      qarkullimi: { summary: turnover.summary, categories: turnover.categories },
      punonjesit: staff.staff,
      nderrimet: (shifts.shifts || []).map((s) => ({
        name: s.waiter_name, role: s.staff_role, open: s.is_open, sales: s.total_sales,
      })),
    },
  });

  const ditariSum = money(ditariAfter.totalSales);
  const roomTrace = (ditariAfter.entries || []).find((e) => e.folio_settled && e.payment_method === "room");
  assert.ok(roomTrace, "rreshti restorant → dhomë mbetet i dukshëm");
  assert.ok(String(roomTrace.artikujt || "").includes("Dhoma 102"));
  const ledgerSum = sum(ledgerAfter, "total");
  const shiftSum = money((shifts.shifts || []).reduce((s, r) => s + (Number(r.total_sales) || 0), 0));
  assert.strictEqual(money(preview.bill.total), 110.5);
  assert.strictEqual(money(closed.bill.total), 110.5);
  assert.strictEqual(money(co?.total), 110.5);
  assert.strictEqual(ditariSum, 110.5);
  assert.strictEqual(ledgerSum, 110.5);
  assert.strictEqual(money(week.summary.total), 110.5);
  assert.strictEqual(money(month.summary.total), 110.5);
  assert.strictEqual(money(turnover.summary.total), 110.5);
  assert.strictEqual(money(staff.summary.total), 110.5);
  assert.strictEqual(shiftSum, 110.5);
  const chargesLeft = db.db.prepare("SELECT COUNT(*) AS n FROM room_charges WHERE guest_id = ?").get(closed.guest.id);
  assert.ok(chargesLeft.n >= 5, "room_charges mbeten si gjurmë");

  console.log(JSON.stringify(report, null, 2));
  console.log("guest-service-flow-e2e.test.js OK ditari=110.50 kontabilisti=110.50 avancuara=110.50");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
