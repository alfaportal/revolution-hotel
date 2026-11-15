"use strict";

const assert = require("assert");
const path = require("path");
const os = require("os");

process.env.DB_PATH = path.join(os.tmpdir(), `hotel-stock-reconcile-${Date.now()}.db`);
process.env.HOTEL_DB_PLAIN = "1";

async function main() {
  const db = require("../database");
  await db.whenReady();
  db.runSetup({
    restaurant_name: "Stock Reconcile Hotel",
    admin_password: "test1234",
    table_count: 6,
  });
  db.addCategory("TestStok", "bar");
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const espressoId = db.addMenuItem({
    name: "Espresso 40ml",
    category: "TestStok",
    price: 0.8,
    vat_category: "18",
  });
  const colaId = db.addMenuItem({
    name: "Coca-Cola Test",
    category: "TestStok",
    price: 2,
    vat_category: "18",
  });
  const frappeId = db.addMenuItem({
    name: "Frappuccino Test",
    category: "TestStok",
    price: 3,
    vat_category: "18",
  });

  db.createPurchaseInvoice({
    supplier: "Furnitor stok",
    invoice_number: "BL-STOK-1",
    invoice_date: day,
    items: [{ menu_item_id: espressoId, quantity: 5, unit_price: 1, vat_rate: 18 }],
  });

  const waiter = (() => {
    db.addStaff("StokKamarier", "1234");
    const staff = db.findStaffByName("StokKamarier");
    db.openWaiterShiftWithCash(staff.id, 0);
    return staff;
  })();
  const table = db.getTableByNumber(1);
  db.sendOrder({
    table_id: table.id,
    waiter_name: waiter.name,
    items: [{ menu_item_id: espressoId, name: "Espresso 40ml", price: 0.8, quantity: 2 }],
  });
  const closed = db.closeTable(table.id, waiter.name, false, "cash");
  const orderId = closed?.order_id || closed?.id;
  assert.ok(orderId, "closeTable duhet të kthejë order id");

  db.refundHotelSale(orderId, waiter.name, "test storno", "storno");

  const rowEsp = db.reconcileStock().items.find((i) => i.menu_item_id === espressoId);
  assert.strictEqual(rowEsp.purchased, 5);
  assert.ok(rowEsp.returned >= 2, `kthimi duhet ≥2, got ${rowEsp.returned}`);
  assert.strictEqual(rowEsp.actual_stock, rowEsp.expected_stock, "espresso pas storno");
  assert.strictEqual(rowEsp.has_deviation, false);

  db.db.prepare("UPDATE menu_items SET stock_qty = ? WHERE id = ?").run(24, colaId);
  db.db.prepare("DELETE FROM settings WHERE key = ?").run("stock_reconcile_baseline_v2");
  const healed = db.baselineStockOpeningOnce();
  assert.ok(healed.healed >= 1, "baseline v2 duhet të shkruajë opening");
  const rowCola = db.reconcileStock().items.find((i) => i.menu_item_id === colaId);
  assert.strictEqual(rowCola.opening_stock, 24);
  assert.strictEqual(rowCola.actual_stock, 24);
  assert.strictEqual(rowCola.expected_stock, 24);
  assert.strictEqual(rowCola.has_deviation, false);

  const table2 = db.getTableByNumber(2);
  db.sendOrder({
    table_id: table2.id,
    waiter_name: waiter.name,
    items: [{ menu_item_id: frappeId, name: "Frappuccino Test", price: 3, quantity: 4 }],
  });
  db.closeTable(table2.id, waiter.name, false, "cash");
  const rowFr = db.reconcileStock().items.find((i) => i.menu_item_id === frappeId);
  assert.strictEqual(rowFr.actual_stock, 0);
  assert.strictEqual(rowFr.expected_stock, 0);
  assert.ok(rowFr.sold >= 4);
  assert.strictEqual(rowFr.has_deviation, false);

  db.db.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, items_json, total, status, payment_method)
    VALUES (?, '12:00:00', 0, 'RS', ?, 2, 'completed', 'room')
  `).run(day, JSON.stringify([{
    menu_item_id: colaId,
    name: "1× Coca-Cola Test (RS) · mysafir",
    quantity: 1,
    price: 2,
  }]));
  const guest = db.db.prepare("SELECT id FROM guests LIMIT 1").get();
  const room = db.db.prepare("SELECT id FROM rooms LIMIT 1").get();
  if (guest && room) {
    db.addRoomCharge({
      guest_id: guest.id,
      room_id: room.id,
      description: "1× Coca-Cola Test (RS)",
      amount: 2,
      menu_item_id: colaId,
    });
  } else {
    db.db.prepare(`
      INSERT INTO room_charges (guest_id, room_id, description, amount, menu_item_id)
      VALUES (1, 1, '1× Coca-Cola Test (RS)', 2, ?)
    `).run(colaId);
  }
  const rowCola2 = db.reconcileStock().items.find((i) => i.menu_item_id === colaId);
  assert.strictEqual(rowCola2.sold_daily_log, 0, "fletë RS në ditar nuk duhet si shitje tavoline");
  assert.ok(rowCola2.sold_room_service >= 1);

  const leftover = db.reconcileStock().deviations.filter((i) =>
    [espressoId, frappeId].includes(i.menu_item_id));
  assert.strictEqual(leftover.length, 0, JSON.stringify(leftover));

  console.log("stock-reconcile.test.js OK");
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
