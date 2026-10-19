"use strict";

const assert = require("assert");
const path = require("path");
const os = require("os");

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-ledger-dedup-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.HOTEL_DB_PLAIN = "1";
  delete require.cache[require.resolve("../database.js")];
  const db = require("../database.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "Ledger Dedup", admin_password: "1234", table_count: 1 });

  const day = "2026-10-19";
  const sqlite = db.db;
  const room = sqlite.prepare(`SELECT id, price_per_night FROM rooms ORDER BY id LIMIT 1`).get();
  assert.ok(room?.id, "room");
  const roomId = room.id;
  sqlite.prepare(`UPDATE rooms SET price_per_night = 50 WHERE id = ?`).run(roomId);
  const checkIn = "2026-10-17";

  const guestId = sqlite
    .prepare(`
      INSERT INTO guests (
        guest_name, room_id, check_in_date, check_out_date, status,
        persons, total_paid
      ) VALUES ('Test Guest', ?, ?, ?, 'checked_out', 1, 100)
    `)
    .run(roomId, checkIn, day).lastInsertRowid;

  sqlite.prepare(`
    INSERT INTO daily_log (
      date, time, table_number, waiter_name, items_json, total, status,
      payment_method, receipt_number, cash_amount, card_amount
    ) VALUES (?, '14:00:00', ?, 'Recepsion', ?, 100, 'completed', 'cash', ?, 100, 0)
  `).run(
    day,
    String(roomId),
    JSON.stringify([{ name: "Dhoma — 2 netë", quantity: 2, price: 50 }]),
    `CO-${guestId}`,
  );

  const ledger = db.getSalesLedger({ from: day, to: day });
  const coRows = ledger.filter((r) => String(r.receipt_number || "").toUpperCase() === `CO-${guestId}`);
  const dhRows = ledger.filter((r) => String(r.receipt_number || "").toUpperCase() === `DH-${guestId}`);
  assert.strictEqual(coRows.length, 1, "CO- duhet një herë nga daily_log");
  assert.strictEqual(dhRows.length, 0, "DH- sintetik skip kur ekziston CO-");
  const roomTotal = ledger
    .filter((r) => {
      const rn = String(r.receipt_number || "").toUpperCase();
      return rn === `CO-${guestId}` || rn === `DH-${guestId}`;
    })
    .reduce((s, r) => s + Number(r.total) || 0, 0);
  assert.strictEqual(roomTotal, 100, "të ardhura dhoma një herë");

  sqlite.prepare(`DELETE FROM daily_log WHERE receipt_number LIKE 'CO-%'`).run();
  const ledgerLegacy = db.getSalesLedger({ from: day, to: day });
  const dhLegacy = ledgerLegacy.filter(
    (r) => String(r.receipt_number || "").toUpperCase() === `DH-${guestId}`,
  );
  assert.strictEqual(dhLegacy.length, 1, "pa CO-, DH- sintetik mbetet");
  assert.strictEqual(Number(dhLegacy[0].total) || 0, 100);

  console.log("sales-ledger-co-dh-dedup.test.js OK");
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
