"use strict";
/**
 * Përmbledhje PC → pc_analytics → insights (pa AI live).
 */
const assert = require("assert");
const path = require("path");
const os = require("os");

process.env.DB_PATH = path.join(os.tmpdir(), `hotel-analytics-test-${Date.now()}.db`);
process.env.HOTEL_DB_PLAIN = "1";

async function main() {
  const db = require("../database");
  await db.whenReady();
  db.runSetup({
    restaurant_name: "Analytics Test Hotel",
    admin_password: "test1234",
    table_count: 4,
  });

  const day = new Date().toISOString().slice(0, 10);
  db.addCategory("Test", "bar");
  const a = db.addMenuItem({ name: "Kafe Hot", category: "Test", price: 2.5 });
  const b = db.addMenuItem({ name: "Ujë", category: "Test", price: 1 });
  const c = db.addMenuItem({ name: "Zero Seller", category: "Test", price: 3 });

  db.createPurchaseInvoice({
    supplier: "Furnitor A",
    invoice_number: "T-1",
    invoice_date: day,
    items: [
      { menu_item_id: a, quantity: 100, unit_price: 1, vat_rate: 18 },
      { menu_item_id: b, quantity: 50, unit_price: 0.4, vat_rate: 18 },
      { menu_item_id: c, quantity: 20, unit_price: 1, vat_rate: 18 },
    ],
  });

  db.setMenuItemStockAbsolute(a, 30, "test", "Test");
  db.setMenuItemStockAbsolute(b, 10, "test", "Test");
  db.setMenuItemStockAbsolute(c, 100, "test", "Test");

  const sqlite = db.db;
  sqlite.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, items_json, total, status, payment_method)
    VALUES (?, '12:00:00', 1, 'Test', ?, ?, 'completed', 'cash')
  `).run(
    day,
    JSON.stringify([
      { menu_item_id: a, name: "Kafe Hot", price: 2.5, quantity: 5 },
      { menu_item_id: b, name: "Ujë", price: 1, quantity: 2 },
    ]),
    5 * 2.5 + 2 * 1,
  );

  const { buildOwnerDailySnapshot } = require("../owner-report-snapshot");
  const { deriveSnapshotInsights } = require("../owner-report-analytics");
  const snap = buildOwnerDailySnapshot(db, day);
  assert.ok(snap.pc_analytics, "pc_analytics mungon");
  assert.strictEqual(snap.pc_analytics.sales_by_item.length, 2);

  const insights = deriveSnapshotInsights(snap.pc_analytics);
  assert.strictEqual(insights.top_seller_by_qty.name, "Kafe Hot");
  assert.strictEqual(insights.top_seller_by_qty.quantity_sold, 5);
  assert.ok(!snap.pc_analytics.sales_by_item.some((s) => s.menu_item_id === c));
  assert.ok(insights.items_not_sold_today_count >= 1);

  const kafeStock = snap.pc_analytics.stock_runway.find((r) => r.menu_item_id === a);
  assert.ok(kafeStock, "stock_runway Kafe");
  assert.ok(kafeStock.days_of_stock_left != null && kafeStock.days_of_stock_left > 0);

  assert.ok(snap.pc_analytics.purchases_by_item.length >= 3);
  console.log("owner-report-analytics.test.js OK");
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
