"use strict";

const assert = require("assert");
const os = require("os");
const path = require("path");

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-room-charge-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.HOTEL_DB_PLAIN = "1";
  delete require.cache[require.resolve("../database.js")];
  const db = require("../database.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "Room Charge Fiktiv", admin_password: "1234", table_count: 4 });

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const day = ymd(today);
  const next = ymd(tomorrow);

  const roomRow = db.db.prepare("SELECT id FROM rooms WHERE room_number = '102'").get()
    || db.db.prepare("SELECT id FROM rooms ORDER BY id LIMIT 1").get();
  db.db.prepare(
    "UPDATE rooms SET room_number = '102', price_per_night = 80, status = 'free' WHERE id = ?",
  ).run(roomRow.id);

  const recepId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Fiktiv Recep', 'recepsion', '919191', 1)",
  ).run().lastInsertRowid;
  const kamarierId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Fiktiv Kamarier', 'kamarier', '818181', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(recepId, 40);
  db.openWaiterShiftWithCash(kamarierId, 20);

  if (!db.db.prepare("SELECT id FROM categories WHERE name = ?").get("Ushqim")) db.addCategory("Ushqim");
  const biftek = db.addMenuItem({ name: "Biftek", category: "Ushqim", price: 9, vat_category: "18" });
  const sallate = db.addMenuItem({ name: "Sallatë", category: "Ushqim", price: 4, vat_category: "18" });

  const stay = db.checkInGuest({
    room_id: roomRow.id,
    guest_name: "Arta Fiktive",
    persons: 1,
    check_in_date: day,
    check_out_date: next,
    deposit: 0,
  });
  const guest = stay.guest;
  const table = db.db.prepare("SELECT id, number FROM tables WHERE number > 0 ORDER BY number LIMIT 1").get();
  db.sendOrder({
    table_id: table.id,
    waiter_name: "Fiktiv Kamarier",
    items: [
      { name: "Biftek", menu_item_id: biftek, quantity: 1, price: 9 },
      { name: "Sallatë", menu_item_id: sallate, quantity: 1, price: 4 },
    ],
  });
  const charged = db.chargeTableToRoomAtomic({
    tableId: table.id,
    waiterName: "Fiktiv Kamarier",
    guestId: guest.id,
    roomId: roomRow.id,
    tableNumber: table.number,
  });

  const log = db.db.prepare(`
    SELECT id, table_number, waiter_name, total, payment_method, items_json, order_id, shift_id
    FROM daily_log WHERE payment_method = 'room' ORDER BY id DESC LIMIT 1
  `).get();
  const charges = db.listRoomChargesForGuest(guest.id);
  const folio = db.getCheckoutPreview(roomRow.id).bill;
  const active = db.listActiveHotelOrdersForWaiter({ sessionRole: "recepsion" }).orders
    .filter((o) => String(o.source || "").startsWith("Restorant"));
  const work = db.listStayServiceWork().filter((row) => String(row.description || "").includes("(T"));
  const shift = db.getWaiterShiftSummary(kamarierId);
  const ditari = db.getDitari({ dateFrom: day, dateTo: next });
  const reports = db.getReports(day, next);
  const diary = db.listHotelDiary({ room: "102", event_type: "room_charge" });
  const ledgerBefore = db.getSalesLedger({ from: day, to: next });

  const report = {
    table: table.number,
    waiter: log?.waiter_name,
    log_total: money(log?.total),
    log_pay: log?.payment_method,
    charges: charges.map((c) => ({
      description: c.description,
      amount: money(c.amount),
      by: c.performed_by_name,
    })),
    folio: {
      room: money(folio.room_total),
      charges: money(folio.charges_total),
      total: money(folio.total),
    },
    porosi: active.map((o) => ({ source: o.source, products: o.products, total: o.total, who: o.waiter_name })),
    sherbimet: work.map((row) => ({
      description: row.description,
      room: row.room_number,
      guest: row.guest_name,
      by: row.performed_by_name,
      amount: row.amount,
    })),
    shift: {
      cash: money(shift.cash_total),
      card: money(shift.card_total),
      room: money(shift.room_total),
      sales: money(shift.total_sales),
    },
    ditari: (ditari.entries || [])
      .filter((e) => e.payment_method === "room" || String(e.receipt_number || "").startsWith("CO-"))
      .map((e) => ({ pay: e.payment_label, items: e.artikujt, total: money(e.total) })),
    ditari_room: money(ditari.totalRoom),
    ditari_cash: money(ditari.totalCash),
    raport: {
      restaurant: money(reports.restaurantSales),
      cash: money(reports.restaurant_payments?.cash),
      card: money(reports.restaurant_payments?.card),
      room: money(reports.restaurant_payments?.room),
      total: money(reports.totalSales),
    },
    diary: diary.map((row) => row.detail),
    ledger_before: ledgerBefore.map((r) => ({ receipt: r.receipt_number, total: money(r.total) })),
  };

  assert.strictEqual(log.waiter_name, "Fiktiv Kamarier");
  assert.strictEqual(Number(log.table_number), Number(table.number));
  assert.strictEqual(log.payment_method, "room");
  assert.strictEqual(money(log.total), 13);
  assert.strictEqual(charges.length, 2);
  assert.ok(charges.every((c) => c.performed_by_name === "Fiktiv Kamarier"));
  assert.strictEqual(money(folio.charges_total), 13);
  assert.strictEqual(money(folio.total), 93);
  assert.strictEqual(active.length, 2);
  assert.ok(active.every((o) => o.source === "Restorant → Dh. 102"));
  assert.ok(work.length >= 2);
  assert.ok(work.every((row) => row.performed_by_name === "Fiktiv Kamarier"));
  assert.strictEqual(money(shift.cash_total), 0);
  assert.strictEqual(money(shift.card_total), 0);
  assert.strictEqual(money(shift.room_total), 13);
  const roomLine = (ditari.entries || []).find((e) => e.payment_method === "room");
  assert.ok(roomLine, "ditari mban rreshtin në dhomë");
  assert.ok(String(roomLine.artikujt).includes("Biftek 9€ — Dhoma 102 (Arta Fiktive)"));
  assert.ok(String(roomLine.artikujt).includes("Sallatë 4€ — Dhoma 102 (Arta Fiktive)"));
  assert.strictEqual(roomLine.payment_label, "Në dhomë");
  assert.strictEqual(money(reports.restaurant_payments.cash), 0);
  assert.strictEqual(money(reports.restaurant_payments.card), 0);
  assert.strictEqual(money(reports.restaurant_payments.room), 13);
  assert.strictEqual(money(reports.restaurantSales), 13);
  assert.ok(diary.some((row) => row.detail === "Restorant → Dhoma 102: Biftek 9€, Kamarier: Fiktiv Kamarier"));
  assert.ok(diary.some((row) => row.detail === "Restorant → Dhoma 102: Sallatë 4€, Kamarier: Fiktiv Kamarier"));
  assert.ok(charged.charges.length === 2);

  const closed = db.checkOutGuest(roomRow.id, {
    waiter_name: "Fiktiv Recep",
    payment_method: "cash",
  });
  const co = db.db.prepare(
    "SELECT receipt_number, total, items_json, payment_method FROM daily_log WHERE receipt_number LIKE 'CO-%'",
  ).get();
  const ditariAfter = db.getDitari({ dateFrom: day, dateTo: next });
  const ledgerAfter = db.getSalesLedger({ from: day, to: next });
  const reportsAfter = db.getReports(day, next);
  const shiftAfter = db.getWaiterShiftSummary(kamarierId);
  const coItems = JSON.parse(co.items_json || "[]").map((it) => String(it.name || ""));
  const ledgerSum = money(ledgerAfter.reduce((s, r) => s + Number(r.total || 0), 0));
  const roomStill = (ditariAfter.entries || []).find((e) => e.payment_method === "room");

  report.after = {
    folio: money(closed.bill.total),
    co: money(co.total),
    co_pay: co.payment_method,
    co_items: coItems,
    ditari_total: money(ditariAfter.totalSales),
    ditari_cash: money(ditariAfter.totalCash),
    ditari_room: money(ditariAfter.totalRoom),
    ditari_line: roomStill?.artikujt || "",
    ledger: ledgerAfter.map((r) => ({ receipt: r.receipt_number, total: money(r.total), items: r.items })),
    ledger_sum: ledgerSum,
    raport_restaurant: money(reportsAfter.restaurantSales),
    raport_room: money(reportsAfter.restaurant_payments.room),
    raport_total: money(reportsAfter.totalSales),
    shift_cash: money(shiftAfter.cash_total),
    shift_card: money(shiftAfter.card_total),
    shift_room: money(shiftAfter.room_total),
    shift_sales: money(shiftAfter.total_sales),
  };

  assert.strictEqual(money(closed.bill.total), 93);
  assert.strictEqual(money(co.total), 93);
  assert.ok(coItems.some((name) => name.includes("Biftek")));
  assert.ok(coItems.some((name) => name.includes("Sallatë")));
  assert.ok(roomStill, "pas check-out ditari e mban rreshtin e restorantit");
  assert.strictEqual(money(ditariAfter.totalSales), 93);
  assert.strictEqual(money(ditariAfter.totalRoom), 13);
  assert.strictEqual(ledgerAfter.filter((r) => r.payment_method === "room").length, 0);
  assert.strictEqual(ledgerSum, 93);
  assert.strictEqual(money(reportsAfter.restaurant_payments.room), 13);
  assert.strictEqual(money(reportsAfter.restaurantSales), 13);
  assert.strictEqual(money(reportsAfter.totalSales), 93);
  assert.strictEqual(money(shiftAfter.cash_total), 0);
  assert.strictEqual(money(shiftAfter.card_total), 0);
  assert.strictEqual(money(shiftAfter.room_total), 13);
  assert.strictEqual(money(shiftAfter.total_sales), 0);

  console.log(JSON.stringify(report, null, 2));
  console.log("restaurant-room-charge.test.js OK folio=93 ditari=93 kontabilisti=93 ne-dhoma=13");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
