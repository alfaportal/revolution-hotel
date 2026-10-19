"use strict";

const os = require("os");
const path = require("path");
const assert = require("assert");

async function main() {
  const dbPath = path.join(os.tmpdir(), `audit-rr-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  delete require.cache[require.resolve("../database.js")];
  delete require.cache[require.resolve("../owner-report-snapshot.js")];
  const db = require("../database.js");
  const ownerSnap = require("../owner-report-snapshot.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "Audit RR", admin_password: "1234", table_count: 2 });

  const day = "2026-10-19";
  const ins = (role, name, pin) =>
    db.db
      .prepare(`INSERT INTO staff (name, staff_role, pin, active) VALUES (?,?,?,1)`)
      .run(name, role, pin).lastInsertRowid;

  const w1 = ins("kamarier", "Artan", "1111");
  const w2 = ins("kamarier", "Blendi", "2222");
  const r1 = ins("recepsion", "Clirim", "333333");
  const r2 = ins("recepsion", "Donika", "444444");

  const openClose = (staffId, name, role, cash, card, shiftNum) => {
    db.openWaiterShiftWithCash(staffId, 50);
    const sh = db.getOpenShift(staffId);
    const sid = sh.id;
    const tot = cash + card;
    if (role === "kamarier") {
      db.db.prepare(`
        INSERT INTO daily_log (date, time, table_number, waiter_name, staff_id, shift_id, items_json, total,
          receipt_number, status, payment_method, cash_amount, card_amount)
        VALUES (?, '10:00', 1, ?, ?, ?, '[]', ?, ?, 'completed', 'mixed', ?, ?)
      `).run(day, name, staffId, sid, tot, `T-${shiftNum}`, cash, card);
    } else {
      db.db.prepare(`
        INSERT INTO daily_log (date, time, table_number, waiter_name, staff_id, shift_id, items_json, total,
          receipt_number, status, payment_method, cash_amount, card_amount)
        VALUES (?, '10:00', 0, ?, ?, ?, '[]', ?, ?, 'completed', 'cash', ?, 0)
      `).run(day, name, staffId, sid, cash, `RC-${staffId}-${shiftNum}`, cash);
      db.db.prepare(`
        INSERT INTO daily_log (date, time, table_number, waiter_name, staff_id, shift_id, items_json, total,
          receipt_number, status, payment_method, cash_amount, card_amount)
        VALUES (?, '11:00:00', 0, ?, ?, ?, '[]', ?, ?, 'completed', 'karte', 0, ?)
      `).run(day, name, staffId, sid, card, `CO-${staffId}-${shiftNum}`, card);
    }
    db.closeWaiterShift(staffId, 50, null, { sessionRole: role });
    return sid;
  };

  openClose(w1, "Artan", "kamarier", 50, 120, 1);
  openClose(w2, "Blendi", "kamarier", 80, 200, 2);
  openClose(r1, "Clirim", "recepsion", 20, 50, 1);
  openClose(r2, "Donika", "recepsion", 30, 90, 2);

  // SVC on recepsion shift — reception prefix not in owner aggregate
  db.openWaiterShiftWithCash(r1, 50);
  const shR = db.getOpenShift(r1);
  db.db.prepare(`
    INSERT INTO daily_log (date, time, table_number, waiter_name, staff_id, shift_id, items_json, total,
      receipt_number, status, payment_method, cash_amount, card_amount)
    VALUES (?, '12:00:00', 0, 'Clirim', ?, ?, '[]', 15, 'SVC-1', 'completed', 'cash', 15, 0)
  `).run(day, r1, shR.id);
  db.closeWaiterShift(r1, 65, null, { sessionRole: "recepsion" });

  const bal = db.getDailyBalanceReport(day);
  assert.strictEqual(bal.restaurant.shifts.length, 2);
  assert.strictEqual(bal.reception.shifts.length, 3);
  assert.strictEqual(bal.restaurant.subtotal, 450);
  assert.strictEqual(bal.reception.subtotal, 205);

  const entries = db.db.prepare(`
    SELECT receipt_number, total FROM daily_log WHERE date = ? AND status = 'completed'
  `).all(day);
  const isRec = (r) => {
    const u = String(r || "").toUpperCase();
    return u.startsWith("CO-") || u.startsWith("RC-") || u.startsWith("SVC-");
  };
  let sumRest = 0;
  let sumRec = 0;
  let sumAll = 0;
  for (const e of entries) {
    const t = Number(e.total) || 0;
    sumAll += t;
    if (isRec(e.receipt_number)) sumRec += t;
    else sumRest += t;
  }
  assert.strictEqual(Math.round(sumAll * 100) / 100, Math.round((sumRest + sumRec) * 100) / 100);

  const snap = ownerSnap.buildOwnerDailySnapshot(db, day);
  const aggR = snap.cash_by_register.restorant;
  const aggRc = snap.cash_by_register.recepsion;
  const dashRest = Number(
    db.db.prepare(`
      SELECT COALESCE(SUM(total),0) t FROM daily_log WHERE date=? AND status='completed'
        AND (receipt_number IS NULL OR (
          receipt_number NOT LIKE 'CO-%'
          AND receipt_number NOT LIKE 'RC-%'
          AND receipt_number NOT LIKE 'SVC-%'
        ))
    `).get(day).t,
  );
  const dashRec = Number(
    db.db.prepare(`
      SELECT COALESCE(SUM(total),0) t FROM daily_log WHERE date=? AND status='completed'
        AND (
          receipt_number LIKE 'CO-%'
          OR receipt_number LIKE 'RC-%'
          OR receipt_number LIKE 'SVC-%'
        )
    `).get(day).t,
  );

  console.log("audit split:", {
    daily_log_total: sumAll,
    partition_rest: sumRest,
    partition_rec: sumRec,
    barazim_rest: bal.restaurant.subtotal,
    barazim_rec: bal.reception.subtotal,
    owner_agg_rest_cash_card: aggR.cash + aggR.card + aggR.ne_dhome,
    owner_agg_rec_cash_card: aggRc.cash + aggRc.card,
    dashboard_rest: dashRest,
    dashboard_rec: dashRec,
    svc_in_rec_partition: sumRec - (20 + 50 + 30 + 90 + 20 + 50),
  });

  assert.strictEqual(
    Math.round((aggRc.cash + aggRc.card) * 100) / 100,
    Math.round(sumRec * 100) / 100,
    "owner recepsion aggregate përfshin CO/RC/SVC",
  );

  console.log("audit-restaurant-reception-split.test.js OK (see metrics above)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
