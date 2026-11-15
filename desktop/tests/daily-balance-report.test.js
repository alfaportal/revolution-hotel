"use strict";

const os = require("os");
const path = require("path");
const assert = require("assert");

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-daily-bal-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  delete require.cache[require.resolve("../database.js")];
  const db = require("../database.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "Bal Test", admin_password: "1234", table_count: 1 });
  const day = "2026-10-19";
  const insW = db.db
    .prepare(`INSERT INTO staff (name, staff_role, pin, active) VALUES ('W','kamarier','1111',1)`)
    .run().lastInsertRowid;
  const insR = db.db
    .prepare(`INSERT INTO staff (name, staff_role, pin, active) VALUES ('R','recepsion','222222',1)`)
    .run().lastInsertRowid;
  const now = `${day}T10:00:00.000Z`;
  const later = `${day}T18:00:00.000Z`;
  db.db.prepare(`
    INSERT INTO waiter_shifts
    (staff_id, waiter_name, opened_at, closed_at, opening_cash, closing_cash_actual,
     cash_sales_total, card_sales_total, order_count_total, total_sales)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(insW, "W", now, later, 50, 50, 30, 70, 5, 100);
  db.db.prepare(`
    INSERT INTO waiter_shifts
    (staff_id, waiter_name, opened_at, closed_at, opening_cash, closing_cash_actual,
     cash_sales_total, card_sales_total, order_count_total, total_sales)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(insR, "R", now, later, 100, 100, 20, 40, 2, 60);
  db.db.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, staff_id, items_json, total,
      receipt_number, status, payment_method, cash_amount, card_amount)
    VALUES (?, '10:00:00', 1, 'W', ?, '[]', 100, 'T-BAL-1', 'completed', 'mixed', 30, 70)
  `).run(day, insW);
  db.db.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, staff_id, items_json, total,
      receipt_number, status, payment_method, cash_amount, card_amount)
    VALUES (?, '11:00:00', 101, 'R', ?, '[]', 20, 'RC-BAL-1', 'completed', 'cash', 20, 0)
  `).run(day, insR);
  db.db.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, staff_id, items_json, total,
      receipt_number, status, payment_method, cash_amount, card_amount)
    VALUES (?, '12:00:00', 102, 'R', ?, '[]', 40, 'CO-BAL-1', 'completed', 'karte', 0, 40)
  `).run(day, insR);

  const ditari = db.getDitari({ dateFrom: day, dateTo: day });
  const rep = db.getDailyBalanceReport(day);
  assert.strictEqual(rep.restaurant.shifts.length, 1);
  assert.strictEqual(rep.reception.shifts.length, 1);
  assert.strictEqual(rep.grand_total, 160);
  assert.strictEqual(rep.restaurant.subtotal, 100);
  assert.strictEqual(rep.reception.subtotal, 60);
  assert.strictEqual(rep.grand_total, ditari.totalSales);
  assert.strictEqual(rep.restaurant.subtotal, ditari.restaurantSales);
  assert.strictEqual(rep.reception.subtotal, ditari.receptionSales);

  const openStaff = db.db
    .prepare(`INSERT INTO staff (name, staff_role, pin, active) VALUES ('OpenW','kamarier','3333',1)`)
    .run().lastInsertRowid;
  db.db.prepare(`
    INSERT INTO waiter_shifts (staff_id, waiter_name, opened_at, opening_cash)
    VALUES (?, 'OpenW', ?, 0)
  `).run(openStaff, now);
  db.db.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, staff_id, items_json, total,
      receipt_number, status, payment_method, cash_amount, card_amount)
    VALUES (?, '13:00:00', 2, 'OpenW', ?, '[]', 8, 'T-BAL-OPEN', 'completed', 'cash', 8, 0)
  `).run(day, openStaff);
  const withOpen = db.getDailyBalanceReport(day);
  const ditariOpen = db.getDitari({ dateFrom: day, dateTo: day });
  assert.strictEqual(withOpen.grand_total, 168);
  assert.strictEqual(withOpen.grand_total, ditariOpen.totalSales);
  assert.strictEqual(withOpen.restaurant.subtotal, ditariOpen.restaurantSales);
  console.log("daily-balance-report.test.js OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
