"use strict";

const assert = require("assert");
const os = require("os");
const path = require("path");

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-x-role-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.HOTEL_DB_PLAIN = "1";
  delete require.cache[require.resolve("../database.js")];
  const db = require("../database.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "X Role", admin_password: "1234", table_count: 1 });
  const day = "2026-10-19";
  const sqlite = db.db;
  const wId = sqlite
    .prepare(`INSERT INTO staff (name, staff_role, pin, active) VALUES ('W','kamarier','1111',1)`)
    .run().lastInsertRowid;
  const rId = sqlite
    .prepare(`INSERT INTO staff (name, staff_role, pin, active) VALUES ('R','recepsion','222222',1)`)
    .run().lastInsertRowid;
  const openW = sqlite
    .prepare(`
    INSERT INTO waiter_shifts (staff_id, waiter_name, opened_at, opening_cash)
    VALUES (?, 'W', ?, 0)
  `)
    .run(wId, `${day}T08:00:00.000Z`).lastInsertRowid;
  const openR = sqlite
    .prepare(`
    INSERT INTO waiter_shifts (staff_id, waiter_name, opened_at, opening_cash)
    VALUES (?, 'R', ?, 0)
  `)
    .run(rId, `${day}T08:00:00.000Z`).lastInsertRowid;

  sqlite.prepare(`
    INSERT INTO daily_log (date, time, table_number, shift_id, staff_id, waiter_name, items_json, total, status, payment_method, receipt_number)
    VALUES (?, '09:00:00', 1, ?, ?, 'W', '[]', 20, 'completed', 'cash', 'T-1')
  `).run(day, openW, wId);
  sqlite.prepare(`
    INSERT INTO daily_log (date, time, table_number, shift_id, staff_id, waiter_name, items_json, total, status, payment_method, receipt_number)
    VALUES (?, '09:30:00', 2, ?, ?, 'R', '[]', 15, 'completed', 'cash', 'RC-1')
  `).run(day, openR, rId);
  sqlite.prepare(`
    INSERT INTO daily_log (date, time, table_number, shift_id, staff_id, waiter_name, items_json, total, status, payment_method, receipt_number)
    VALUES (?, '09:31:00', 1, ?, ?, 'W', '[]', 99, 'completed', 'cash', 'RC-99')
  `).run(day, openW, wId);

  const adminX = db.buildXReportData();
  assert.strictEqual(adminX.total_sales, 20 + 15 + 99);

  const recepX = db.buildXReportData("recepsion");
  assert.strictEqual(recepX.total_sales, 114);

  const openWData = db.getOpenShiftReportData(openW);
  assert.strictEqual(openWData.total_sales, 20);

  const openRData = db.getOpenShiftReportData(openR);
  assert.strictEqual(openRData.total_sales, 15);

  console.log("shift-x-role-filter.test.js OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
