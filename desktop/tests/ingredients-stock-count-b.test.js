"use strict";

const assert = require("assert");
const path = require("path");
const os = require("os");

process.env.DB_PATH = path.join(os.tmpdir(), `hotel-stock-count-b-${Date.now()}.db`);
process.env.HOTEL_DB_PLAIN = "1";

async function runPartASetup(db, day) {
  db.addCategory("Restorant", "kitchen");
  const mishId = db.createIngredient({
    name: "Mish test B",
    unit: "kg",
    stock_qty: 0,
    avg_cost_per_unit: 0,
    min_stock_qty: 0,
  }).id;

  db.createPurchaseInvoice({
    supplier: "Furnitor mish",
    invoice_number: "BL-MISH-B",
    invoice_date: day,
    items: [{ ingredient_id: mishId, quantity: 10, unit_price: 8, vat_rate: 18 }],
  });

  const biftekId = db.addMenuItem({
    name: "Biftek test B",
    category: "Restorant",
    price: 12,
    vat_category: "18",
  });

  db.setMenuItemRecipe(biftekId, [{ ingredient_id: mishId, quantity_used: 0.25 }]);

  const sellItems = [{ menu_item_id: biftekId, name: "Biftek test B", quantity: 6, price: 12 }];
  db.decrementMenuItemStock(sellItems);
  db.restoreMenuItemStockFromSale([{ menu_item_id: biftekId, quantity: 1 }]);

  const mish = db.getIngredient(mishId);
  assert.strictEqual(mish.stock_qty, 8.75);
  return { mishId, biftekId };
}

async function main() {
  const db = require("../database");
  await db.whenReady();
  db.runSetup({
    restaurant_name: "Stock Count B Hotel",
    admin_password: "test1234",
    table_count: 4,
  });

  const day = new Date().toISOString().slice(0, 10);
  const { mishId } = await runPartASetup(db, day);

  const count = db.submitStockCount({
    operator_name: "Test Admin",
    operator_role: "admin",
    note: "Provë numërim B",
    lines: [{ target_type: "ingredient", target_id: mishId, counted_qty: 8.5 }],
  });

  const line = count.lines.find((l) => l.target_id === mishId);
  assert.ok(line, "rreshti përbërësit");
  assert.strictEqual(line.diff_qty, -0.25);
  assert.strictEqual(line.diff_value, -2);

  const mishAfter = db.getIngredient(mishId);
  assert.strictEqual(mishAfter.stock_qty, 8.5);

  const snap = db.buildIngredientsSnapshot(day);
  assert.ok(snap.last_stock_count?.lines?.length);
  const snapLine = snap.last_stock_count.lines.find((l) => l.target_id === mishId);
  assert.strictEqual(snapLine.diff_qty, -0.25);
  assert.strictEqual(snapLine.diff_value, -2);

  const analytics = require("../owner-report-analytics").buildOwnerReportAnalytics(db, day);
  assert.strictEqual(analytics.last_stock_count.lines[0].diff_value, -2);
  const ins = require("../owner-report-analytics").deriveSnapshotInsights(analytics);
  assert.ok(ins.last_count_adjustments?.length);
  assert.strictEqual(ins.last_count_adjustments[0].diff_value, -2);

  const variance = db.buildConsumptionVarianceReport({ from: day, to: day });
  const vRow = variance.items.find((i) => i.ingredient_id === mishId);
  assert.ok(vRow, "rresht variance");

  console.log("ingredients-stock-count-b.test.js OK");
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
