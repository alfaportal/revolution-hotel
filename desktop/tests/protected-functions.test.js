"use strict";

/**
 * Regression tests for HOTEL/PROTECTED-FUNCTIONS.md.
 *
 * These exercise the real functions (no mocks) against a throwaway SQLite
 * file, so a future edit that reopens the 2026-07-07 double-billing bug
 * fails loudly here instead of in a live register.
 *
 * Also covers the 2026-07-10 takeaway reappear fix (isCloudOrderHandledLocally,
 * importCloudOrderToLocal).
 *
 * Run directly:   node tests/protected-functions.test.js
 * Run pre-build:  node scripts/pre-build-check.js  (wired into `npm run build`)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `hotel-protected-test-${process.pid}-${Date.now()}.db`,
);
process.env.DB_PATH = TEST_DB_PATH;
/* Teste: DB e thjeshtë (pa AES) — shpejtësi + pa varësi nga install-salt. */
process.env.HOTEL_DB_PLAIN = "1";

const db = require("../database.js");
const cloudSync = require("../cloud-sync.js");
const staffPinPolicy = require("../lib/staffPinPolicy.js");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

let waiterSeq = 0;
function openShiftForNewWaiter(prefix) {
  waiterSeq += 1;
  const name = `${prefix}-${waiterSeq}`;
  const pin = String(1000 + waiterSeq).padStart(4, "0"); // unique 4-digit pin per waiter
  db.addStaff(name, pin);
  const staff = db.findStaffByName(name);
  db.openWaiterShiftWithCash(staff.id, 0);
  return staff;
}

let menuItemId;

function setup() {
  db.runSetup({
    restaurant_name: "Test Hotel",
    admin_password: "test1234",
    table_count: 10,
  });
  db.addCategory("TestCat");
  menuItemId = db.addMenuItem({ name: "Test Kafe", category: "TestCat", price: 1.5 });
  db.db.prepare("UPDATE menu_items SET stock_qty = ? WHERE id = ?").run(50, menuItemId);
}

// --- a) closeTable creates exactly 1 daily_log entry per payment ---
test("closeTable creates exactly 1 daily_log entry", () => {
  const waiter = openShiftForNewWaiter("CloseOnce");
  const table = db.getTableByNumber(1);

  db.sendOrder({
    table_id: table.id,
    waiter_name: waiter.name,
    items: [{ menu_item_id: menuItemId, name: "Test Kafe", price: 1.5, quantity: 2 }],
  });

  const countRows = () =>
    db.db.prepare(
      "SELECT COUNT(*) AS n FROM daily_log WHERE table_number = ? AND status = 'completed'",
    ).get(table.number).n;

  const before = countRows();
  const closed = db.closeTable(table.id, waiter.name, false, "cash");
  const after = countRows();

  assert.ok(closed, "closeTable should return the closed order");
  assert.strictEqual(
    after - before,
    1,
    `expected exactly 1 new daily_log row after closeTable, got ${after - before}`,
  );
});

// --- b) computeShiftTotals only counts entries with matching shift_id ---
test("computeShiftTotals only counts entries with matching shift_id", () => {
  const waiterA = openShiftForNewWaiter("ShiftA");
  const waiterB = openShiftForNewWaiter("ShiftB");
  const tableA = db.getTableByNumber(2);
  const tableB = db.getTableByNumber(3);

  db.sendOrder({
    table_id: tableA.id,
    waiter_name: waiterA.name,
    items: [{ menu_item_id: menuItemId, name: "Test Kafe", price: 1.5, quantity: 4 }], // 6.00
  });
  db.sendOrder({
    table_id: tableB.id,
    waiter_name: waiterB.name,
    items: [{ menu_item_id: menuItemId, name: "Test Kafe", price: 1.5, quantity: 10 }], // 15.00
  });

  db.closeTable(tableA.id, waiterA.name, false, "cash");
  db.closeTable(tableB.id, waiterB.name, false, "cash");

  const summaryA = db.getWaiterShiftSummary(waiterA.id);
  const summaryB = db.getWaiterShiftSummary(waiterB.id);

  assert.ok(summaryA && summaryB, "expected shift summaries for both waiters");
  assert.strictEqual(
    Math.round(summaryA.cash_total * 100),
    600,
    `waiter A's shift total must only include their own 6.00 sale, got ${summaryA.cash_total}`,
  );
  assert.strictEqual(
    Math.round(summaryB.cash_total * 100),
    1500,
    `waiter B's shift total must only include their own 15.00 sale, got ${summaryB.cash_total}`,
  );
});

// --- c) stock decreases on sale ---
test("stock decreases on sale (decrementMenuItemStock)", () => {
  const waiter = openShiftForNewWaiter("Stock");
  const table = db.getTableByNumber(4);
  const qty = 3;

  const stockBefore = db.db.prepare(
    "SELECT stock_qty FROM menu_items WHERE id = ?",
  ).get(menuItemId).stock_qty;

  db.sendOrder({
    table_id: table.id,
    waiter_name: waiter.name,
    items: [{ menu_item_id: menuItemId, name: "Test Kafe", price: 1.5, quantity: qty }],
  });
  db.closeTable(table.id, waiter.name, false, "cash");

  const stockAfter = db.db.prepare(
    "SELECT stock_qty FROM menu_items WHERE id = ?",
  ).get(menuItemId).stock_qty;

  assert.strictEqual(
    stockAfter,
    stockBefore - qty,
    `expected stock to drop by ${qty} (${stockBefore} -> ${stockBefore - qty}), got ${stockAfter}`,
  );
});

test("stock decreases by product name when menu_item_id missing", () => {
  const waiter = openShiftForNewWaiter("StockName");
  const table = db.getTableByNumber(4);
  const qty = 2;

  const stockBefore = db.db.prepare(
    "SELECT stock_qty FROM menu_items WHERE id = ?",
  ).get(menuItemId).stock_qty;

  db.sendOrder({
    table_id: table.id,
    waiter_name: waiter.name,
    // Simulon porosi cloud / JSON të vjetër pa menu_item_id
    items: [{ name: "Test Kafe", price: 1.5, quantity: qty }],
  });
  db.closeTable(table.id, waiter.name, false, "cash");

  const stockAfter = db.db.prepare(
    "SELECT stock_qty FROM menu_items WHERE id = ?",
  ).get(menuItemId).stock_qty;

  assert.strictEqual(
    stockAfter,
    stockBefore - qty,
    `expected name-resolved stock drop by ${qty}, got ${stockAfter}`,
  );
});

test("increaseMenuItemStock adds purchase qty", () => {
  const before = Number(
    db.db.prepare("SELECT stock_qty FROM menu_items WHERE id = ?").get(menuItemId).stock_qty,
  );
  const r = db.increaseMenuItemStock(menuItemId, 5);
  assert.strictEqual(r.stock_qty, before + 5);
  const after = Number(
    db.db.prepare("SELECT stock_qty FROM menu_items WHERE id = ?").get(menuItemId).stock_qty,
  );
  assert.strictEqual(after, before + 5);
});

// --- d) local orders without cloud_order_id are not cancelled by sync ---
test("local orders without cloud_order_id are not cancelled by sync", async () => {
  const waiter = openShiftForNewWaiter("LocalOnly");
  const table = db.getTableByNumber(5);

  db.sendOrder({
    table_id: table.id,
    waiter_name: waiter.name,
    items: [{ menu_item_id: menuItemId, name: "Test Kafe", price: 1.5, quantity: 1 }],
  });

  const before = db.getActiveOrderForTable(table.id);
  assert.ok(before, "expected an active local order before sync");
  assert.ok(!before.cloud_order_id, "sanity check: this order must not be cloud-linked");

  // Fresh test DB has no cloud license configured — this exercises the real
  // "cloud not configured" no-op path, not a mock.
  assert.strictEqual(
    cloudSync.isCloudConfigured(db),
    false,
    "test expects cloud to be unconfigured for this DB",
  );

  await cloudSync.syncLocalCancelledFromCloud(db);

  const after = db.getActiveOrderForTable(table.id);
  assert.ok(
    after && after.status === "active",
    "a local-only order (no cloud_order_id) must remain active after syncLocalCancelledFromCloud",
  );
  db.cancelActiveOrder(table.id);
});

// --- e) paid takeaway cloud order must not reappear via re-import ---
test("importCloudOrderToLocal does not reactivate a completed cloud order", () => {
  const waiter = openShiftForNewWaiter("Takeaway");
  const cloudId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const cloudOrder = {
    id: cloudId,
    device_id: "WEB-PUBLIC",
    items: [{ name: "Test Kafe", price: 1.5, quantity: 1 }],
    total: 1.5,
    source_label: "Takeaway",
  };

  const imported = db.importCloudOrderToLocal(cloudOrder, waiter.name);
  assert.ok(imported?.table_id, "expected takeaway import to assign a local table");

  const tableBefore = db.db.prepare("SELECT status FROM tables WHERE id = ?").get(imported.table_id);
  assert.strictEqual(tableBefore.status, "occupied", "table should be occupied before payment");

  db.closeTable(imported.table_id, waiter.name, false, "cash");

  assert.strictEqual(
    db.isCloudOrderHandledLocally(cloudId),
    true,
    "completed cloud order must count as handled locally",
  );
  const closedRow = db.getOrderByCloudId(cloudId);
  assert.ok(closedRow && closedRow.status === "completed", "local row must be completed after payment");
  assert.ok(
    !db.getActiveOrderForTable(imported.table_id),
    "no active order should remain on the takeaway table after closeTable",
  );

  const tableAfterClose = db.db.prepare("SELECT status FROM tables WHERE id = ?").get(imported.table_id);
  assert.strictEqual(tableAfterClose.status, "free", "table should be free after payment");

  const reimport = db.importCloudOrderToLocal(cloudOrder, waiter.name);
  assert.strictEqual(reimport.already, true, "re-import must be a no-op");
  assert.strictEqual(reimport.closed, true, "re-import must report closed, not reactivated");
  assert.ok(!reimport.reactivated, "must never reactivate a completed order");

  assert.ok(
    !db.getActiveOrderForTable(imported.table_id),
    "re-import must not create a new active order on the table",
  );
  const tableAfterReimport = db.db.prepare("SELECT status FROM tables WHERE id = ?").get(imported.table_id);
  assert.strictEqual(
    tableAfterReimport.status,
    "free",
    "table must stay free after cloud poll would have re-imported",
  );
});

test("fromAcceptFlow does NOT reopen a takeaway that was already paid (completed)", () => {
  const waiter = openShiftForNewWaiter("TakeawayAccept");
  const cloudId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
  const cloudOrder = {
    id: cloudId,
    device_id: "WEB-PUBLIC",
    items: [{ name: "Latte e ftohtë", price: 2.5, quantity: 1 }],
    total: 2.5,
    source_label: "Takeaway",
  };

  const first = db.importCloudOrderToLocal(cloudOrder, waiter.name);
  assert.ok(first?.table_id, "expected first import");
  db.closeTable(first.table_id, waiter.name, false, "cash");
  assert.strictEqual(db.isCloudOrderHandledLocally(cloudId), true);

  const acceptImport = db.importCloudOrderToLocal(cloudOrder, waiter.name, { fromAcceptFlow: true });
  assert.strictEqual(acceptImport.ok, true);
  assert.strictEqual(acceptImport.already, true);
  assert.strictEqual(acceptImport.closed, true);
  assert.ok(!db.getActiveOrderByCloudId(cloudId), "must not create a new active order (no double charge)");
});

test("importCloudOrderToLocal returns batch_items when same cloud id adds items on occupied table", () => {
  const waiter = openShiftForNewWaiter("CloudWaiterBatch");
  const table = db.getTableByNumber(3);
  const cloudId = "cccccccc-dddd-eeee-ffff-000000000001";
  const first = {
    id: cloudId,
    device_id: "WEB-WAITER",
    table_number: table.number,
    items: [{ name: "Test Kafe", price: 1.5, quantity: 1 }],
    total: 1.5,
  };
  const second = {
    ...first,
    items: [{ name: "Test Kafe", price: 1.5, quantity: 3 }],
    total: 4.5,
  };

  const imp1 = db.importCloudOrderToLocal(first, waiter.name);
  assert.ok(imp1?.batch_items?.length === 1, "first import should print full batch");
  assert.strictEqual(imp1.batch_items[0].quantity, 1);

  const imp2 = db.importCloudOrderToLocal(second, waiter.name);
  assert.strictEqual(imp2.already, true);
  assert.strictEqual(imp2.merged, true);
  assert.ok(imp2.batch_items?.length === 1, "second import should expose only delta");
  assert.strictEqual(imp2.batch_items[0].quantity, 2, "delta is +2 kafe on same line");

  const active = db.getActiveOrderForTable(table.id);
  const items = JSON.parse(active.items_json || "[]");
  assert.strictEqual(items[0].quantity, 3);
});

test("rebuildDailyLogFromCloudSales does not double-decrement stock", () => {
  const waiter = openShiftForNewWaiter("RebuildStock");
  const staff = db.findStaffByName(waiter.name);
  const shift = db.getOpenShift(staff.id);
  assert.ok(shift, "waiter shift must be open");
  const table = db.getTableByNumber(5);
  const stockBefore = db.db.prepare("SELECT stock_qty FROM menu_items WHERE id = ?").get(menuItemId).stock_qty;
  const closedAt = new Date(Date.now() + 2000).toISOString();

  db.sendOrder({
    table_id: table.id,
    waiter_name: waiter.name,
    items: [{ menu_item_id: menuItemId, name: "Test Kafe", price: 1.5, quantity: 3 }],
  });
  db.closeTable(table.id, waiter.name, false, "cash");

  const stockAfterClose = db.db.prepare("SELECT stock_qty FROM menu_items WHERE id = ?").get(menuItemId).stock_qty;
  assert.strictEqual(stockAfterClose, stockBefore - 3, "closeTable decrements stock once");

  const cloudSale = {
    id: `rebuild-test-sale-${waiterSeq}`,
    waiter_name: waiter.name,
    table_number: table.number,
    total: 4.5,
    payment_method: "cash",
    closed_at: closedAt,
    items: [{ menu_item_id: menuItemId, name: "Test Kafe", price: 1.5, quantity: 3 }],
  };

  const rebuild = db.rebuildDailyLogFromCloudSales([cloudSale]);
  assert.ok(rebuild.ok, "rebuild should succeed");
  assert.strictEqual(rebuild.imported, 1, "one sale re-imported");

  const stockAfterRebuild = db.db.prepare("SELECT stock_qty FROM menu_items WHERE id = ?").get(menuItemId).stock_qty;
  assert.strictEqual(
    stockAfterRebuild,
    stockAfterClose,
    "rebuild must not decrement stock again (skipStockDecrement)",
  );
});

test("importClosedWebWaiterSaleFromCloud skipStockDecrement option", () => {
  const waiter = openShiftForNewWaiter("SkipStockOpt");
  const stockBefore = db.db.prepare("SELECT stock_qty FROM menu_items WHERE id = ?").get(menuItemId).stock_qty;
  const sale = {
    id: `skip-stock-opt-${waiterSeq}`,
    waiter_name: waiter.name,
    table_number: 6,
    total: 3,
    payment_method: "cash",
    closed_at: new Date(Date.now() + 2000).toISOString(),
    items: [{ menu_item_id: menuItemId, name: "Test Kafe", price: 1.5, quantity: 2 }],
  };

  const skipped = db.importClosedWebWaiterSaleFromCloud(sale, { skipStockDecrement: true });
  assert.ok(skipped.imported, "import with skipStockDecrement should insert daily_log");
  const stockAfterSkip = db.db.prepare("SELECT stock_qty FROM menu_items WHERE id = ?").get(menuItemId).stock_qty;
  assert.strictEqual(stockAfterSkip, stockBefore, "skipStockDecrement must not touch stock");

  db.db.prepare("DELETE FROM daily_log WHERE cloud_sale_id = ?").run(sale.id);
  const normal = db.importClosedWebWaiterSaleFromCloud(sale);
  assert.ok(normal.imported, "normal import should insert daily_log");
  const stockAfterNormal = db.db.prepare("SELECT stock_qty FROM menu_items WHERE id = ?").get(menuItemId).stock_qty;
  assert.strictEqual(stockAfterNormal, stockBefore - 2, "normal import decrements stock");
});

test("room payment: label, shift cash vs në dhomë, getReports without double count", () => {
  assert.strictEqual(db.normalizePaymentMethod("room"), "room");
  assert.strictEqual(db.paymentMethodLabel("room"), "Në dhomë");

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const beforeRep = db.getReports(today, today);

  const waiter = openShiftForNewWaiter("RoomAcct");
  const tableCash = db.getTableByNumber(6);
  const tableRoom = db.getTableByNumber(7);
  db.sendOrder({
    table_id: tableCash.id,
    waiter_name: waiter.name,
    items: [{ name: "Cash Item", price: 10, quantity: 1 }],
  });
  db.sendOrder({
    table_id: tableRoom.id,
    waiter_name: waiter.name,
    items: [{ name: "Room Item", price: 5, quantity: 1 }],
  });
  db.closeTable(tableCash.id, waiter.name, false, "cash");
  db.closeTable(tableRoom.id, waiter.name, false, "room");

  const summary = db.getWaiterShiftSummary(waiter.id);
  assert.strictEqual(
    Math.round(summary.cash_total * 100),
    1000,
    `restaurant drawer cash expected 10.00, got ${summary.cash_total}`,
  );
  assert.strictEqual(
    Math.round(summary.room_total * 100),
    500,
    `room charge expected 5.00, got ${summary.room_total}`,
  );
  assert.strictEqual(
    Math.round(summary.expected_closing_cash * 100),
    1000,
    `expected drawer cash 10.00, got ${summary.expected_closing_cash}`,
  );

  const midRep = db.getReports(today, today);
  assert.strictEqual(
    Math.round((midRep.restaurantSales - beforeRep.restaurantSales) * 100),
    1500,
    `restaurant +15.00 (10 cash + 5 room), delta=${midRep.restaurantSales - beforeRep.restaurantSales}`,
  );

  const tomorrow = new Date(d.getTime() + 86400000);
  const checkOutDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  const freeRoom = db.listRooms().find((r) => r.status === "free");
  assert.ok(freeRoom, "need a free room for checkout scenario");
  db.updateRoom(freeRoom.id, { price_per_night: 45 });
  const { guest } = db.checkInGuest({
    room_id: freeRoom.id,
    guest_name: "Room Acct Guest",
    persons: 1,
    check_in_date: today,
    check_out_date: checkOutDate,
  });
  db.addRoomCharge({
    guest_id: guest.id,
    room_id: freeRoom.id,
    description: "1× Room Item (T7)",
    amount: 5,
  });
  db.checkOutGuest(freeRoom.id, {
    check_out_date: today,
    payment_method: "cash",
    waiter_name: "Recepcion",
  });

  const rep = db.getReports(today, today);
  assert.strictEqual(
    Math.round((rep.receptionSales - midRep.receptionSales) * 100),
    5000,
    `reception collected +50.00 at checkout, delta=${rep.receptionSales - midRep.receptionSales}`,
  );
  assert.strictEqual(
    Math.round((rep.totalSales - beforeRep.totalSales) * 100),
    6000,
    `grand total +60.00 (not 65), delta=${rep.totalSales - beforeRep.totalSales}`,
  );
  const coEntries = rep.reception_collected;
  assert.ok(coEntries && Math.round(coEntries.restaurant * 100) >= 500);
  assert.ok(Math.round(coEntries.room * 100) >= 4500);
});

test("mixed cash + room: shift cash/room totals", () => {
  const waiter = openShiftForNewWaiter("MixedRoom");
  const staff = db.findStaffByName(waiter.name);
  const tMix = db.getTableByNumber(8);
  db.sendOrder({
    table_id: tMix.id,
    waiter_name: waiter.name,
    items: [{ name: "Mix", price: 15, quantity: 1 }],
  });
  db.closeTable(tMix.id, waiter.name, false, "mixed", null, {
    payment_splits: [
      { method: "cash", amount: 10 },
      { method: "room", amount: 5 },
    ],
  });
  const summary = db.getWaiterShiftSummary(staff.id);
  assert.strictEqual(Math.round(summary.cash_total * 100), 1000, "mixed: cash leg 10");
  assert.strictEqual(Math.round(summary.room_total * 100), 500, "mixed: room leg 5");
});

test("recepsion shift: opening 50 + checkout 100 cash → expected closing 150", () => {
  const pin = String(200000 + waiterSeq).padStart(6, "0");
  db.addStaff("Recep Kusur", pin, "recepsion");
  const recep = db.findStaffByName("Recep Kusur");
  db.openWaiterShiftWithCash(recep.id, 50);

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const tomorrow = new Date(d.getTime() + 86400000);
  const outDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  const freeRoom = db.listRooms().find((r) => r.status === "free");
  assert.ok(freeRoom, "need free room");
  db.updateRoom(freeRoom.id, { price_per_night: 100 });
  db.checkInGuest({
    room_id: freeRoom.id,
    guest_name: "Kusur Guest",
    persons: 1,
    check_in_date: today,
    check_out_date: outDate,
  });
  db.checkOutGuest(freeRoom.id, {
    check_out_date: outDate,
    payment_method: "cash",
    waiter_name: recep.name,
  });

  const summary = db.getWaiterShiftSummary(recep.id, { sessionRole: "recepsion" });
  assert.strictEqual(
    Math.round((summary.opening_cash || 0) * 100),
    5000,
    `opening cash 50.00, got ${summary.opening_cash}`,
  );
  assert.strictEqual(
    Math.round((summary.cash_total || 0) * 100),
    10000,
    `checkout cash 100.00, got ${summary.cash_total}`,
  );
  assert.strictEqual(
    Math.round((summary.expected_closing_cash || 0) * 100),
    15000,
    `expected drawer 150.00 (50+100), got ${summary.expected_closing_cash}`,
  );

  const closed = db.closeWaiterShift(recep.id, 150);
  assert.ok(closed?.expected_closing_cash != null);
  assert.strictEqual(
    Math.round(Number(closed.expected_closing_cash) * 100),
    15000,
    `close snapshot expected 150.00, got ${closed.expected_closing_cash}`,
  );
});

test("staff PIN: kamarier 4 shifra, recepsion 6; legacy 6 kamarier login", () => {
  db.addStaff("Pin4", "4321", "kamarier");
  db.addStaff("Pin6R", "654321", "recepsion");
  assert.throws(() => db.addStaff("BadK", "12345", "kamarier"));
  assert.throws(() => db.addStaff("BadK6", "654321", "kamarier"));
  assert.throws(() => db.addStaff("BadR", "1234", "recepsion"));
  assert.ok(db.findStaffByPin("4321"));
  assert.ok(db.findStaffByPin("654321"));
  assert.ok(staffPinPolicy.acceptsLoginPin("4321", "kamarier"));
  assert.ok(staffPinPolicy.acceptsLoginPin("001234", "kamarier"));
  assert.ok(!staffPinPolicy.acceptsLoginPin("4321", "recepsion"));
  const wrong = staffPinPolicy.wrongZoneMessage("recepsion", "kamarier");
  assert.ok(wrong && wrong.includes("Recepsionin"));
  const leg = db.db
    .prepare(
      "INSERT INTO staff (name, pin, active, web_token, staff_role) VALUES (?, ?, 1, ?, ?)",
    )
    .run("Legacy6K", "112233", "toklegacy6k", "kamarier");
  const legId = Number(leg.lastInsertRowid);
  db.updateStaffProfile(legId, { name: "Legacy6K Renamed" });
  db.updateStaffPin(legId, "112233");
  assert.throws(() => db.updateStaffPin(legId, "112244"));
});

async function run() {
  if (typeof db.whenReady === "function") {
    await db.whenReady();
  }
  setup();
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok - ${name}`);
      passed += 1;
    } catch (err) {
      console.error(`  FAIL - ${name}`);
      console.error(`    ${err.message}`);
      failed += 1;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed (${tests.length} total)`);

  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {
    /* best-effort cleanup */
  }

  process.exit(failed ? 1 : 0);
}

run();
