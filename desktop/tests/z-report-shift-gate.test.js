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
