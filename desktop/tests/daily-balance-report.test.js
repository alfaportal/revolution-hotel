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

  const rep = db.getDailyBalanceReport(day);
  assert.strictEqual(rep.restaurant.shifts.length, 1);
  assert.strictEqual(rep.reception.shifts.length, 1);
  assert.strictEqual(rep.grand_total, 160);
  assert.strictEqual(rep.restaurant.subtotal, 100);
  assert.strictEqual(rep.reception.subtotal, 60);
  console.log("daily-balance-report.test.js OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
