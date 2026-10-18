"use strict";

/**
 * Raporti Z — ndërrimi (z_report_printed_at) vs fiskal (staff /api/staff/fiscal/z-report).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("buildZReportData + markAllPendingShiftZReportsPrinted zgjidh bllokimin", async () => {
  const dbPath = path.join(
    os.tmpdir(),
    `hotel-z-gate-${process.pid}-${Date.now()}.db`,
  );
  process.env.DB_PATH = dbPath;
  delete require.cache[require.resolve("../database.js")];
  const db = require("../database.js");
  await db.whenReady();

  db.runSetup({
    restaurant_name: "Gate Test",
    admin_password: "1234",
    table_count: 2,
  });
  let staff = db.db.prepare("SELECT id, name FROM staff WHERE active = 1 LIMIT 1").get();
  if (!staff) {
    const r = db.db
      .prepare(
        `INSERT INTO staff (name, staff_role, pin, active) VALUES ('Test Waiter','kamarier','1234',1)`,
      )
      .run();
    staff = { id: r.lastInsertRowid, name: "Test Waiter" };
  }
  const now = new Date().toISOString();
  db.db
    .prepare(
      `INSERT INTO waiter_shifts
       (staff_id, waiter_name, opened_at, closed_at, opening_cash, closing_cash_actual, expected_closing_cash, cash_difference)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(staff.id, staff.name, now, now, 100, 95, 100, -5);

  const pending = db.getUnprintedClosedZShift();
  assert.ok(pending?.id, "duhet ndërrim i mbyllur pa Z");

  const data = db.buildZReportData(pending.id);
  assert.strictEqual(data.opening_cash, 100);
  assert.strictEqual(data.cash_difference, -5);

  const n = db.markAllPendingShiftZReportsPrinted();
  assert.strictEqual(n, 1);
  assert.strictEqual(db.getUnprintedClosedZShift(), undefined);

  assert.ok(!db.getUnprintedClosedZShift(), "pas mark — nuk duhet bllokim");
});

test("hap nderrim me pending Z — NUK bllokon (vetëm kujtesë)", async () => {
  const dbPath = path.join(
    os.tmpdir(),
    `hotel-z-open-${process.pid}-${Date.now()}.db`,
  );
  process.env.DB_PATH = dbPath;
  delete require.cache[require.resolve("../database.js")];
  const db = require("../database.js");
  await db.whenReady();
  db.runSetup({
    restaurant_name: "Open Z Test",
    admin_password: "1234",
    table_count: 2,
  });
  const staff = db.db
    .prepare(
      `INSERT INTO staff (name, staff_role, pin, active) VALUES ('Open Waiter','kamarier','1234',1)`,
    )
    .run();
  const now = new Date().toISOString();
  db.db
    .prepare(
      `INSERT INTO waiter_shifts
       (staff_id, waiter_name, opened_at, closed_at, opening_cash, closing_cash_actual, expected_closing_cash, cash_difference)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(staff.lastInsertRowid, "Open Waiter", now, now, 50, 50, 50, 0);

  const summary = db.getWaiterShiftSummary(staff.lastInsertRowid, { sessionRole: "kamarier" });
  assert.strictEqual(summary.blocks_new_shift, false);
  assert.strictEqual(summary.z_report_reminder, true);

  const opened = db.openWaiterShiftWithCash(staff.lastInsertRowid, 50);
  assert.ok(opened.open, "nderrimi duhet te hapet edhe pa Raport Z");
});

test("bllokimi Z — vetëm për të njëjtin rol (recepsion vs kamarier)", async () => {
  const dbPath = path.join(
    os.tmpdir(),
    `hotel-z-role-${process.pid}-${Date.now()}.db`,
  );
  process.env.DB_PATH = dbPath;
  delete require.cache[require.resolve("../database.js")];
  const db = require("../database.js");
  await db.whenReady();
  db.runSetup({
    restaurant_name: "Role Z Test",
    admin_password: "1234",
    table_count: 2,
  });
  const recep = db.db
    .prepare(
      `INSERT INTO staff (name, staff_role, pin, active) VALUES ('Recep Z','recepsion','1111',1)`,
    )
    .run();
  const waiter = db.db
    .prepare(
      `INSERT INTO staff (name, staff_role, pin, active) VALUES ('Wait Z','kamarier','2222',1)`,
    )
    .run();
  const now = new Date().toISOString();
  db.db
    .prepare(
      `INSERT INTO waiter_shifts
       (staff_id, waiter_name, opened_at, closed_at, opening_cash, closing_cash_actual, expected_closing_cash, cash_difference)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(recep.lastInsertRowid, "Recep Z", now, now, 0, 0, 0, 0);

  assert.ok(
    db.getUnprintedClosedZShift({ sessionRole: "recepsion" }),
    "recepsion duhet pending",
  );
  assert.ok(
    !db.getUnprintedClosedZShift({ sessionRole: "kamarier" }),
    "kamarier nuk bllokohet nga recepsion",
  );
});

(async () => {
  console.log("\n=== HOTEL z-report-shift-gate ===\n");
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log("  ok -", name);
    } catch (e) {
      failed += 1;
      console.error("  FAIL -", name, e.message || e);
    }
  }
  console.log(`\n${tests.length - failed} passed, ${failed} failed (${tests.length} total)\n`);
  process.exit(failed ? 1 : 0);
})();
