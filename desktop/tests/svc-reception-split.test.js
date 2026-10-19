"use strict";

const assert = require("assert");
const os = require("os");
const path = require("path");

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-svc-split-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.HOTEL_DB_PLAIN = "1";
  delete require.cache[require.resolve("../database.js")];
  const db = require("../database.js");
  const { buildOwnerDailySnapshot } = require("../owner-report-snapshot.js");
  const { businessYmd } = require("../lib/hotel-business-date");
  await db.whenReady();
  db.runSetup({ restaurant_name: "SVC Test", admin_password: "1234", table_count: 1 });
  const day = businessYmd();
  const sqlite = db.db;
  sqlite.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, items_json, total, status, payment_method, receipt_number)
    VALUES (?, '10:00:00', 1, 'W', '[]', 10, 'completed', 'cash', NULL)
  `).run(day);
  sqlite.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, items_json, total, status, payment_method, receipt_number)
    VALUES (?, '11:00:00', 1, 'R', '[]', 25, 'completed', 'cash', 'SVC-1001')
  `).run(day);

  const dash = db.getDashboardOverview();
  assert.strictEqual(dash.daily_revenue.restaurant, 10);
  assert.strictEqual(dash.daily_revenue.reception, 25);

  const snap = buildOwnerDailySnapshot(db, day);
  assert.strictEqual(snap.cash_by_register.restorant.cash, 10);
  assert.strictEqual(snap.cash_by_register.recepsion.cash, 25);
  assert.ok(snap.daily_balance?.restaurant, "daily_balance.restaurant në snapshot");
  assert.ok(snap.daily_balance?.reception, "daily_balance.reception në snapshot");

  const rep = db.getReports(day, day);
  assert.strictEqual(rep.restaurantRegisterSales, 10);
  assert.strictEqual(rep.receptionSales, 25);

  console.log("svc-reception-split.test.js OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
