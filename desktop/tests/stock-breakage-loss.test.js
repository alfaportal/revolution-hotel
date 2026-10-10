"use strict";
/**
 * Thyerje/humbje — stok ↓, shpenzim ↑, shitjet pa ndryshim.
 */
const assert = require("assert");
const path = require("path");
const os = require("os");

process.env.DB_PATH = path.join(os.tmpdir(), `hotel-breakage-test-${Date.now()}.db`);
process.env.HOTEL_DB_PLAIN = "1";

async function main() {
  const db = require("../database");
  await db.whenReady();
  db.runSetup({
    restaurant_name: "Breakage Test Hotel",
    admin_password: "test1234",
    table_count: 4,
  });

  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  db.addCategory("Inventar test", "bar");
  const itemId = db.addMenuItem({
    name: "Gota test",
    category: "Inventar test",
    price: 2,
    vat_category: "18",
  });
  db.createPurchaseInvoice({
    supplier: "Furnitor test",
    invoice_number: "BL-TEST-1",
    invoice_date: day,
    items: [{ menu_item_id: itemId, quantity: 100, unit_price: 2, vat_rate: 18 }],
  });
  db.setMenuItemStockAbsolute(itemId, 50, "Setup test stoku", "Test");

  const repBefore = db.getReports(day, day);
  const bilBefore = db.getKontabilistiBilanc({ from: day, to: day });

  const result = db.registerStockBreakageLoss({
    source_type: "menu",
    source_id: itemId,
    quantity: 3,
    reason: "thye",
    note: "Test provë",
    operator_name: "Kamarier Test",
    operator_role: "kamarier",
  });

  assert.strictEqual(result.stock_after, 47);
  assert.strictEqual(result.total_cost, 6);
  assert.ok(result.expense_id);

  const stock = db.db.prepare("SELECT stock_qty FROM menu_items WHERE id = ?").get(itemId).stock_qty;
  assert.strictEqual(stock, 47);

  const repAfter = db.getReports(day, day);
  assert.strictEqual(repAfter.totalSales, repBefore.totalSales, "shitjet nuk duhet ndryshuar");

  const bilAfter = db.getKontabilistiBilanc({ from: day, to: day });
  assert.ok(bilAfter.expenses_total >= bilBefore.expenses_total + 5.99);
  assert.ok(bilAfter.profit <= bilBefore.profit - 5.99);

  const summary = db.summarizeStockBreakageLoss({ from: day, to: day });
  assert.ok(summary.total_cost >= 6);
  assert.ok(summary.by_reason.some((r) => r.key === "thye"));

  console.log("stock-breakage-loss.test.js OK");
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
