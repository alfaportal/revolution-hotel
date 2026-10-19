"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-rc-successor-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  delete require.cache[require.resolve("../database.js")];
  const db = require("../database.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "Rc Test", admin_password: "1234", table_count: 1 });
  const ins = (name, pin) =>
    db.db
      .prepare(`INSERT INTO staff (name, staff_role, pin, active) VALUES (?, 'recepsion', ?, 1)`)
      .run(name, pin).lastInsertRowid;
  const a = ins("Recep A", "111111");
  const b = ins("Recep B", "222222");
  assert.strictEqual(db.hasActiveRecepcionShift(), false);
  db.openWaiterShiftWithCash(a, 100);
  assert.strictEqual(db.hasActiveRecepcionShift(), true);
  const open = db.getOpenShift(a);
  db.closeWaiterShift(a, 100, null, { sessionRole: "recepsion" });
  assert.strictEqual(db.hasActiveRecepcionShift(), false);
  const h = db.ensureRecepsionHandoverForClosedShift(open.id, b);
  assert.ok(h?.id);
  const sum = db.acceptShiftHandover(b, h.id, 100);
  assert.strictEqual(db.hasActiveRecepcionShift(), true);
  assert.ok(sum.open);
  console.log("recepsion-successor-handover.test.js OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
