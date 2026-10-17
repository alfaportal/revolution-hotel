"use strict";

/**
 * Factory reset — wipeSalesDataOnly (konfigurimi mbetet) + license fiscal-keys wipe.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const license = require("../license.js");
const autoBackup = require("../auto-backup.js");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function touch(userDataRoot, rel) {
  const full = path.join(userDataRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "test", "utf8");
  return full;
}

function readFactoryResetPendingAt(userData, resetFlagExternal) {
  const resetFlag = path.join(userData, ".factory-reset-pending");
  for (const flagPath of [resetFlag, resetFlagExternal]) {
    try {
      if (flagPath && fs.existsSync(flagPath)) {
        const t = fs.readFileSync(flagPath, "utf8").trim();
        if (t) return t;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function writeFactoryResetPendingFlags(userData, resetFlagExternal) {
  const stamp = new Date().toISOString();
  fs.mkdirSync(path.dirname(resetFlagExternal), { recursive: true });
  fs.writeFileSync(resetFlagExternal, stamp, "utf8");
  fs.writeFileSync(path.join(userData, ".factory-reset-pending"), stamp, "utf8");
  return stamp;
}

function clearFactoryResetFlags(userData, resetFlagExternal) {
  try {
    if (fs.existsSync(resetFlagExternal)) fs.unlinkSync(resetFlagExternal);
  } catch {
    /* ignore */
  }
  const resetFlag = path.join(userData, ".factory-reset-pending");
  try {
    if (fs.existsSync(resetFlag)) fs.unlinkSync(resetFlag);
  } catch {
    /* ignore */
  }
}

function markFactoryResetSkipBackupRestore(userData) {
  fs.writeFileSync(
    path.join(userData, ".factory-reset-done"),
    new Date().toISOString(),
    "utf8",
  );
}

function consumeFactoryResetSkipRestore(userData) {
  const flagPath = path.join(userData, ".factory-reset-done");
  if (!fs.existsSync(flagPath)) return false;
  try {
    fs.unlinkSync(flagPath);
  } catch {
    /* ignore */
  }
  return true;
}

function countTable(db, table) {
  try {
    return Number(db.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c || 0);
  } catch {
    return -1;
  }
}

test("wipeAllClientData: fiscal-keys fshihen; hotel.db mbetet", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-factory-wipe-"));

  touch(userData, "hotel.db");
  touch(userData, "fiscal-keys/key.pem");

  const wiped = license.wipeAllClientData(null, userData);
  assert.strictEqual(wiped.ok, true);
  assert.ok(wiped.deleted.some((d) => String(d).startsWith("fiscal-keys")));
  assert.strictEqual(fs.existsSync(path.join(userData, "hotel.db")), true);
  assert.strictEqual(fs.existsSync(path.join(userData, "fiscal-keys")), false);

  fs.rmSync(userData, { recursive: true, force: true });
});

test("wipeAllClientData: licencë jashtë listës — NUK fshihet", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-factory-keep-"));

  touch(userData, "hotel.db");
  const keepLicenseStub = touch(userData, ".lic-stub-not-in-wipe-list");

  const wiped = license.wipeAllClientData(null, userData);
  assert.strictEqual(wiped.ok, true);
  assert.strictEqual(fs.existsSync(keepLicenseStub), true);

  fs.rmSync(userData, { recursive: true, force: true });
});

test("wipeAllClientData: hotel.db.corrupt-* fshihen (sidecar)", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-factory-sidecar-"));

  touch(userData, "hotel.db.load-fail-123.bak");
  touch(userData, "hotel.db.corrupt-456.bak");

  license.wipeAllClientData(null, userData);
  assert.strictEqual(fs.existsSync(path.join(userData, "hotel.db.load-fail-123.bak")), false);
  assert.strictEqual(fs.existsSync(path.join(userData, "hotel.db.corrupt-456.bak")), false);

  fs.rmSync(userData, { recursive: true, force: true });
});

test("wipeSalesDataOnly: menu/staff/settings mbeten; orders/shifts/daily_log bosh", async () => {
  const TEST_DB = path.join(
    os.tmpdir(),
    `hotel-factory-sales-wipe-${process.pid}-${Date.now()}.db`,
  );
  process.env.DB_PATH = TEST_DB;
  process.env.HOTEL_DB_PLAIN = "1";

  const db = require("../database.js");
  await db.whenReady();

  db.runSetup({
    restaurant_name: "Test Hotel Factory",
    admin_password: "1234",
    table_count: 3,
    business_subtype: "hotel",
  });

  const staff = db.addStaff("Wiper Test", "1234");
  db.openWaiterShiftWithCash(staff.id, 10);

  const menuBefore = countTable(db, "menu_items");
  const staffBefore = countTable(db, "staff");
  const settingsBefore = countTable(db, "settings");
  assert.ok(menuBefore > 0);
  assert.ok(staffBefore > 0);
  assert.ok(settingsBefore > 0);

  db.db.prepare(`
    INSERT INTO orders (table_id, waiter_name, items_json, total, status)
    VALUES (1, 'Wiper Test', '[]', 5.5, 'active')
  `).run();
  db.db.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, items_json, total, status)
    VALUES ('2026-01-01', '12:00', 1, 'Wiper Test', '[]', 5.5, 'completed')
  `).run();

  assert.ok(countTable(db, "orders") > 0);
  assert.ok(countTable(db, "daily_log") > 0);
  assert.ok(countTable(db, "waiter_shifts") > 0);

  const wipe = db.wipeSalesDataOnly();
  assert.strictEqual(wipe.ok, true);

  assert.ok(countTable(db, "menu_items") >= menuBefore);
  assert.ok(countTable(db, "staff") >= staffBefore);
  assert.ok(countTable(db, "settings") >= settingsBefore);
  assert.strictEqual(countTable(db, "orders"), 0);
  assert.strictEqual(countTable(db, "daily_log"), 0);
  assert.strictEqual(countTable(db, "waiter_shifts"), 0);

  try {
    fs.unlinkSync(TEST_DB);
  } catch {
    /* ignore */
  }
});

test("wipeSalesDataOnly: atomike — dështim në mes, asgjë nuk fshihet", async () => {
  const TEST_DB = path.join(
    os.tmpdir(),
    `hotel-factory-atomic-${process.pid}-${Date.now()}.db`,
  );
  process.env.DB_PATH = TEST_DB;
  process.env.HOTEL_DB_PLAIN = "1";

  delete require.cache[require.resolve("../database.js")];
  const db = require("../database.js");
  await db.whenReady();

  db.runSetup({
    restaurant_name: "Atomic Test",
    admin_password: "1234",
    table_count: 2,
    business_subtype: "hotel",
  });

  db.db.prepare(`
    INSERT INTO orders (table_id, waiter_name, items_json, total, status)
    VALUES (1, 'A', '[]', 1, 'active')
  `).run();
  const ordersBefore = countTable(db, "orders");
  assert.strictEqual(ordersBefore, 1);

  let threw = false;
  try {
    db.wipeSalesDataOnly({ _testFailAt: "daily_log" });
  } catch (e) {
    threw = true;
    assert.match(String(e.message), /factory-reset test inject fail/);
  }
  assert.strictEqual(threw, true);
  assert.strictEqual(countTable(db, "orders"), ordersBefore);

  try {
    fs.unlinkSync(TEST_DB);
  } catch {
    /* ignore */
  }
});

test("Flamuj pending: vetëm .factory-reset-pending — DB mbetet deri në wipe", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-factory-pending-"));
  const externalFlag = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "hotel-factory-ext-")),
    "hotel-factory-reset-pending",
  );
  const dbPath = path.join(userData, "hotel.db");
  fs.writeFileSync(dbPath, "open-db-bytes", "utf8");

  const stamp = writeFactoryResetPendingFlags(userData, externalFlag);
  assert.strictEqual(fs.existsSync(dbPath), true);
  assert.strictEqual(readFactoryResetPendingAt(userData, externalFlag), stamp);

  fs.rmSync(path.dirname(externalFlag), { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
});

test("Boot flow: pending → done → skip restore (backup)", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-factory-boot-"));
  const externalFlag = path.join(userData, "_external", "hotel-factory-reset-pending");

  writeFactoryResetPendingFlags(userData, externalFlag);
  markFactoryResetSkipBackupRestore(userData);

  const skipRestoreAfterReset = consumeFactoryResetSkipRestore(userData);
  assert.strictEqual(skipRestoreAfterReset, true);

  const restore = skipRestoreAfterReset
    ? { restored: false, skipped: true, reason: "factory_reset" }
    : autoBackup.maybeRestoreOnStartup({
        targetDbPath: path.join(userData, "hotel.db"),
        skipLicenseCheck: true,
      });
  assert.strictEqual(restore.skipped, true);
  assert.strictEqual(restore.reason, "factory_reset");

  clearFactoryResetFlags(userData, externalFlag);
  fs.rmSync(userData, { recursive: true, force: true });
});

(async () => {
  let passed = 0;
  let failed = 0;
  console.log("\n=== HOTEL factory-reset-wipe ===\n");
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ok - ${t.name}`);
      passed += 1;
    } catch (err) {
      console.error(`  FAIL - ${t.name}`);
      console.error(`    ${err.message}`);
      if (err.stack) console.error(err.stack.split("\n").slice(0, 4).join("\n"));
      failed += 1;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed (${tests.length} total)\n`);
  process.exit(failed ? 1 : 0);
})();
