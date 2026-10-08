"use strict";

/**
 * Factory reset — wipeAllClientData + flamuj pending/done (si main.js boot).
 * Referencë: MARKET tests/factory-reset-wipe.test.js
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

/** Pasqyron main.js — lexon stamp nga pending (lokal ose external). */
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

/** Pasqyron main.js writeFactoryResetPendingFlags (pa Electron). */
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

test("wipeAllClientData: DB, sidecar enkriptimi, fiscal-keys — të gjitha fshihen", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-factory-wipe-"));

  touch(userData, "hotel.db");
  touch(userData, "restaurant.db");
  touch(userData, ".db-master.dpapi");
  touch(userData, ".db-master.scrypt");
  touch(userData, ".db-install-salt");
  touch(userData, "fiscal-keys/key.pem");
  touch(userData, "fiscal-keys/cert.pem");

  const wiped = license.wipeAllClientData(null, userData);
  assert.strictEqual(wiped.ok, true);
  assert.ok(wiped.deleted.includes("hotel.db"));
  assert.ok(wiped.deleted.includes("restaurant.db"));
  assert.ok(wiped.deleted.includes(".db-master.dpapi"));
  assert.ok(wiped.deleted.includes(".db-master.scrypt"));
  assert.ok(wiped.deleted.includes(".db-install-salt"));
  assert.ok(wiped.deleted.some((d) => String(d).startsWith("fiscal-keys")));

  assert.strictEqual(fs.existsSync(path.join(userData, "hotel.db")), false);
  assert.strictEqual(fs.existsSync(path.join(userData, "restaurant.db")), false);
  assert.strictEqual(fs.existsSync(path.join(userData, "fiscal-keys")), false);

  fs.rmSync(userData, { recursive: true, force: true });
});

test("wipeAllClientData: licencë/config jashtë listës — NUK fshihen", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-factory-keep-"));

  touch(userData, "hotel.db");
  const keepLicenseStub = touch(userData, ".lic-stub-not-in-wipe-list");
  const keepConfig = touch(userData, "client-settings-keep.json");

  const wiped = license.wipeAllClientData(null, userData);
  assert.strictEqual(wiped.ok, true);
  assert.strictEqual(fs.existsSync(keepLicenseStub), true);
  assert.strictEqual(fs.existsSync(keepConfig), true);
  assert.strictEqual(fs.readFileSync(keepConfig, "utf8"), "test");

  fs.rmSync(userData, { recursive: true, force: true });
});

test("wipeAllClientData: hotel.db.corrupt-* dhe hotel.db.load-fail-* fshihen", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-factory-sidecar-"));

  touch(userData, "hotel.db.load-fail-123.bak");
  touch(userData, "hotel.db.corrupt-456.bak");
  touch(userData, "restaurant.db.load-fail-789.bak");
  touch(userData, "restaurant.db.corrupt-000.bak");

  const wiped = license.wipeAllClientData(null, userData);
  assert.strictEqual(wiped.ok, true);

  assert.strictEqual(fs.existsSync(path.join(userData, "hotel.db.load-fail-123.bak")), false);
  assert.strictEqual(fs.existsSync(path.join(userData, "hotel.db.corrupt-456.bak")), false);
  assert.strictEqual(fs.existsSync(path.join(userData, "restaurant.db.load-fail-789.bak")), false);
  assert.strictEqual(fs.existsSync(path.join(userData, "restaurant.db.corrupt-000.bak")), false);

  fs.rmSync(userData, { recursive: true, force: true });
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
  assert.strictEqual(
    fs.existsSync(path.join(userData, ".factory-reset-pending")),
    true,
  );
  assert.strictEqual(fs.existsSync(externalFlag), true);

  fs.rmSync(path.dirname(externalFlag), { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
});

test("Boot flow: pending → done → wipe → clear pending; restore skip factory_reset", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-factory-boot-"));
  const externalFlag = path.join(userData, "_external", "hotel-factory-reset-pending");

  touch(userData, "hotel.db");
  touch(userData, "fiscal-keys/key.pem");

  const stamp = writeFactoryResetPendingFlags(userData, externalFlag);
  assert.strictEqual(readFactoryResetPendingAt(userData, externalFlag), stamp);

  const factoryResetRequested =
    fs.existsSync(path.join(userData, ".factory-reset-pending")) ||
    fs.existsSync(externalFlag);
  assert.strictEqual(factoryResetRequested, true);

  markFactoryResetSkipBackupRestore(userData);
  assert.strictEqual(fs.existsSync(path.join(userData, ".factory-reset-done")), true);

  const wiped = license.wipeAllClientData(null, userData);
  assert.strictEqual(wiped.ok, true);
  clearFactoryResetFlags(userData, externalFlag);

  assert.strictEqual(fs.existsSync(path.join(userData, ".factory-reset-pending")), false);
  assert.strictEqual(fs.existsSync(externalFlag), false);
  assert.strictEqual(fs.existsSync(path.join(userData, "hotel.db")), false);

  const skipRestoreAfterReset = consumeFactoryResetSkipRestore(userData);
  assert.strictEqual(skipRestoreAfterReset, true);
  assert.strictEqual(fs.existsSync(path.join(userData, ".factory-reset-done")), false);

  const restore = skipRestoreAfterReset
    ? { restored: false, skipped: true, reason: "factory_reset" }
    : autoBackup.maybeRestoreOnStartup({
        targetDbPath: path.join(userData, "hotel.db"),
        skipLicenseCheck: true,
      });
  assert.strictEqual(restore.skipped, true);
  assert.strictEqual(restore.reason, "factory_reset");

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
