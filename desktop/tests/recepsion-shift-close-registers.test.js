"use strict";

const os = require("os");
const path = require("path");
const assert = require("assert");

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-rc-close-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  delete require.cache[require.resolve("../database.js")];
  delete require.cache[require.resolve("../hotel-advanced-reports.js")];
  const db = require("../database.js");
  const advanced = require("../hotel-advanced-reports.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "Rc Close Fiktiv", admin_password: "1234", table_count: 2 });

  const recepId = db.db
    .prepare(`INSERT INTO staff (name, staff_role, pin, active) VALUES ('Fiktiv Recep', 'recepsion', '909090', 1)`)
    .run().lastInsertRowid;
  const kamarierId = db.db
    .prepare(`INSERT INTO staff (name, staff_role, pin, active) VALUES ('Fiktiv Kamarier', 'kamarier', '808080', 1)`)
    .run().lastInsertRowid;

  db.openWaiterShiftWithCash(recepId, 80);
  const openShift = db.getOpenShift(recepId);
  assert.ok(openShift?.id);
  assert.strictEqual(Number(openShift.opening_cash), 80);

  const openedDay = String(openShift.opened_at || "").slice(0, 10);
  const openRows = db.listShiftReports({ from: openedDay, to: openedDay, include_open: true, staff_role: "recepsion" });
  const openRow = openRows.find((r) => r.id === openShift.id);
  assert.ok(openRow, "ndërrimi i hapur i recepsionit mungon te listShiftReports");
  assert.strictEqual(openRow.is_open, true);
  assert.strictEqual(openRow.staff_role, "recepsion");
  assert.strictEqual(Number(openRow.opening_cash), 80);

  db.db.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, staff_id, shift_id, items_json, total,
      receipt_number, status, payment_method, cash_amount, card_amount)
    VALUES (?, '12:10:00', 101, 'Fiktiv Recep', ?, ?, '[{"name":"Kafe","quantity":1,"price":25}]', 25,
      'RC-FIKTIV-1', 'completed', 'cash', 25, 0)
  `).run(openedDay, recepId, openShift.id);
  db.db.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, staff_id, shift_id, items_json, total,
      receipt_number, status, payment_method, cash_amount, card_amount)
    VALUES (?, '12:40:00', 102, 'Fiktiv Recep', ?, ?, '[{"name":"Dhome","quantity":1,"price":40}]', 40,
      'CO-FIKTIV-1', 'completed', 'karte', 0, 40)
  `).run(openedDay, recepId, openShift.id);

  const closed = db.closeWaiterShift(recepId, 100, null, { sessionRole: "recepsion" });
  assert.strictEqual(closed.waiter_name, "Fiktiv Recep");
  assert.strictEqual(Number(closed.opening_cash), 80);
  assert.strictEqual(Number(closed.cash_total), 25);
  assert.strictEqual(Number(closed.card_total), 40);
  assert.strictEqual(Number(closed.total_sales), 65);
  assert.strictEqual(Number(closed.order_count), 2);
  assert.strictEqual(Number(closed.expected_closing_cash), 105);
  assert.strictEqual(Number(closed.closing_cash_actual), 100);
  assert.strictEqual(Number(closed.cash_difference), -5);
  assert.ok(closed.shift?.closed_at);

  const closedDay = String(closed.shift.closed_at).slice(0, 10);

  function assertClosedShift(row, where) {
    assert.ok(row, `${where}: rreshti i mbyllur mungon`);
    assert.strictEqual(row.is_open, false, where);
    assert.strictEqual(row.staff_role, "recepsion", where);
    assert.strictEqual(row.waiter_name, "Fiktiv Recep", where);
    assert.strictEqual(Number(row.opening_cash), 80, where);
    assert.strictEqual(Number(row.total_sales), 65, where);
    assert.strictEqual(Number(row.cash_sales_total), 25, where);
    assert.strictEqual(Number(row.card_sales_total), 40, where);
    assert.strictEqual(Number(row.order_count_total), 2, where);
    assert.strictEqual(Number(row.expected_closing_cash), 105, where);
    assert.strictEqual(Number(row.closing_cash_actual), 100, where);
    assert.strictEqual(Number(row.cash_difference), -5, where);
  }

  const reports = db.listShiftReports({
    from: closedDay,
    to: closedDay,
    include_open: true,
    staff_role: "recepsion",
  });
  assertClosedShift(reports.find((r) => r.id === openShift.id), "Raportet");

  const ditari = db.getDitari({ dateFrom: closedDay, dateTo: closedDay });
  assertClosedShift(
    (ditari.shifts || []).find((r) => r.id === openShift.id),
    "Ditari",
  );
  const ditariReceipts = (ditari.entries || [])
    .filter((e) => e.shift_id === openShift.id)
    .map((e) => e.receipt_number)
    .sort();
  assert.deepStrictEqual(ditariReceipts, ["CO-FIKTIV-1", "RC-FIKTIV-1"]);

  const adv = advanced.getShiftsReport(closedDay, closedDay);
  assertClosedShift(
    (adv.shifts || []).find((r) => r.id === openShift.id),
    "Te avancuara",
  );

  const bal = db.getDailyBalanceReport(closedDay);
  const balRow = bal.reception.shifts.find((s) => s.staff_name === "Fiktiv Recep");
  assert.ok(balRow, "barazimi ditor: recepsioni mungon");
  assert.strictEqual(balRow.total, 65);
  assert.strictEqual(balRow.cash_amount, 25);
  assert.strictEqual(balRow.card_amount, 40);
  assert.strictEqual(bal.reception.subtotal, 65);
  assert.strictEqual(bal.restaurant.shifts.length, 0);

  db.openWaiterShiftWithCash(kamarierId, 40);
  const kShift = db.getOpenShift(kamarierId);
  const kDay = String(kShift.opened_at || "").slice(0, 10);
  db.db.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, staff_id, shift_id, items_json, total,
      receipt_number, status, payment_method, cash_amount, card_amount)
    VALUES (?, '13:00:00', 4, 'Fiktiv Kamarier', ?, ?, '[{"name":"Sallate","quantity":1,"price":15}]', 15,
      'T-FIKTIV-1', 'completed', 'cash', 15, 0)
  `).run(kDay, kamarierId, kShift.id);
  const kClosed = db.closeWaiterShift(kamarierId, 55, null, { sessionRole: "kamarier" });
  assert.strictEqual(Number(kClosed.cash_total), 15);
  assert.strictEqual(Number(kClosed.total_sales), 15);
  assert.strictEqual(Number(kClosed.expected_closing_cash), 55);
  assert.strictEqual(Number(kClosed.cash_difference), 0);
  const kDayClose = String(kClosed.shift.closed_at).slice(0, 10);
  const kReports = db.listShiftReports({
    from: kDayClose,
    to: kDayClose,
    include_open: true,
    staff_role: "kamarier",
  });
  const kRow = kReports.find((r) => r.id === kShift.id);
  assert.ok(kRow, "Raportet: ndërrimi i kamarierit mungon");
  assert.strictEqual(kRow.staff_role, "kamarier");
  assert.strictEqual(kRow.is_open, false);
  assert.strictEqual(Number(kRow.total_sales), 15);
  assert.strictEqual(Number(kRow.closing_cash_actual), 55);
  const kDitari = db.getDitari({ dateFrom: kDayClose, dateTo: kDayClose });
  assert.ok((kDitari.shifts || []).some((r) => r.id === kShift.id && r.staff_role === "kamarier"));
  const kAdv = advanced.getShiftsReport(kDayClose, kDayClose);
  assert.ok((kAdv.shifts || []).some((r) => r.id === kShift.id && r.staff_role === "kamarier" && !r.is_open));

  console.log(JSON.stringify({
    db: dbPath,
    recepsion: {
      opening: 80,
      cash: 25,
      card: 40,
      total: 65,
      expected: 105,
      counted: 100,
      difference: -5,
      day: closedDay,
      ditari: true,
      raportet: true,
      avancuara: true,
      barazim: true,
    },
    kamarier: {
      opening: 40,
      cash: 15,
      counted: 55,
      difference: 0,
      ditari: true,
      raportet: true,
      avancuara: true,
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
