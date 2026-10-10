"use strict";

const assert = require("assert");
const path = require("path");
const os = require("os");

process.env.DB_PATH = path.join(os.tmpdir(), `hotel-ingredients-test-${Date.now()}.db`);
process.env.HOTEL_DB_PLAIN = "1";

async function main() {
  const db = require("../database");
  await db.whenReady();
  db.runSetup({
    restaurant_name: "Ingredients Test Hotel",
    admin_password: "test1234",
    table_count: 4,
  });

  const day = new Date().toISOString().slice(0, 10);
  db.addCategory("Restorant", "kitchen");

  const mishId = db.createIngredient({
    name: "Mish test",
    unit: "kg",
    stock_qty: 0,
    avg_cost_per_unit: 0,
    min_stock_qty: 0,
  }).id;

  db.createPurchaseInvoice({
    supplier: "Furnitor mish",
    invoice_number: "BL-MISH-1",
    invoice_date: day,
    items: [{ ingredient_id: mishId, quantity: 10, unit_price: 8, vat_rate: 18 }],
  });

  const mish = db.getIngredient(mishId);
  assert.strictEqual(mish.stock_qty, 10);
  assert.strictEqual(mish.avg_cost_per_unit, 8);

  const biftekId = db.addMenuItem({
    name: "Biftek test",
    category: "Restorant",
    price: 12,
    vat_category: "18",
  });

  const recipe = db.setMenuItemRecipe(biftekId, [
    { ingredient_id: mishId, quantity_used: 0.25 },
  ]);
  assert.strictEqual(recipe.portion_cost, 2);
  assert.strictEqual(recipe.profit_per_portion, 10);
  assert.strictEqual(recipe.portions_available, 40);

  const sellItems = [{ menu_item_id: biftekId, name: "Biftek test", quantity: 6, price: 12 }];
  db.decrementMenuItemStock(sellItems);

  const mishAfter = db.getIngredient(mishId);
  assert.strictEqual(mishAfter.stock_qty, 8.5);

  const cogsUnit = db.getMenuItemCostForCogs(biftekId);
  assert.strictEqual(cogsUnit, 2);
  const cogsTotal = 6 * cogsUnit;
  assert.strictEqual(cogsTotal, 12);

  db.restoreMenuItemStockFromSale([{ menu_item_id: biftekId, quantity: 1 }]);
  const mishUndo = db.getIngredient(mishId);
  assert.strictEqual(mishUndo.stock_qty, 8.75);

  const colaId = db.addMenuItem({
    name: "Coca-Cola test",
    category: "Restorant",
    price: 2.5,
    vat_category: "18",
  });
  db.createPurchaseInvoice({
    supplier: "Furnitor pije",
    invoice_number: "BL-COLA-1",
    invoice_date: day,
    items: [{ menu_item_id: colaId, quantity: 50, unit_price: 1, vat_rate: 18 }],
  });
  const colaBefore = db.db.prepare("SELECT stock_qty FROM menu_items WHERE id = ?").get(colaId).stock_qty;
  assert.strictEqual(colaBefore, 50);

  db.decrementMenuItemStock([{ menu_item_id: colaId, quantity: 3 }]);
  const colaAfter = db.db.prepare("SELECT stock_qty FROM menu_items WHERE id = ?").get(colaId).stock_qty;
  assert.strictEqual(colaAfter, 47);

  db.restoreMenuItemStockFromSale([{ menu_item_id: colaId, quantity: 1 }]);
  const colaRest = db.db.prepare("SELECT stock_qty FROM menu_items WHERE id = ?").get(colaId).stock_qty;
  assert.strictEqual(colaRest, 48);

  console.log("ingredients-recipes.test.js OK");
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
