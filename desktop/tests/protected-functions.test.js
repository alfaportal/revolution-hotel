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

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

let waiterSeq = 0;
function openShiftForNewWaiter(prefix) {
  waiterSeq += 1;
  const name = `${prefix}-${waiterSeq}`;
  const pin = String(1000 + waiterSeq); // unique 4-digit pin per waiter
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
