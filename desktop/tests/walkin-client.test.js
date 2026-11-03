"use strict";

const assert = require("assert");
const os = require("os");
const path = require("path");

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `hotel-walkin-${process.pid}-${Date.now()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.HOTEL_DB_PLAIN = "1";
  delete require.cache[require.resolve("../database.js")];
  delete require.cache[require.resolve("../hotel-advanced-reports.js")];
  const db = require("../database.js");
  const advanced = require("../hotel-advanced-reports.js");
  await db.whenReady();
  db.runSetup({ restaurant_name: "Klient Jashtem", admin_password: "1234", table_count: 2 });

  const recepId = db.db.prepare(
    "INSERT INTO staff (name, staff_role, pin, active) VALUES ('Fiktiv Recep', 'recepsion', '919191', 1)",
  ).run().lastInsertRowid;
  db.openWaiterShiftWithCash(recepId, 40);

  const pool = db.createHotelService({ name: "Pishine jashtem", price: 5, vat_category: "18" });
  const spa = db.createHotelService({ name: "Spa jashtem", price: 15, vat_category: "18" });
  const client = db.openWalkInClient({
    client_name: "Besa Jashtme",
    phone: "044111222",
    email: "besa@hotel.test",
  });
  assert.ok(client.id);
  assert.strictEqual(client.status, "open");
  assert.strictEqual(db.db.prepare("SELECT COUNT(*) AS n FROM room_charges").get().n, 0);

  const first = db.addWalkInService(client.id, pool.id, {
    quantity: 1,
    performer: { id: recepId, name: "Fiktiv Recep" },
  });
  assert.strictEqual(first.line.work_status, "accepted");
  assert.strictEqual(money(first.line.amount), 5);
  db.addWalkInService(client.id, spa.id, {
    quantity: 1,
    performer: { id: recepId, name: "Fiktiv Recep" },
  });
  const open = db.getWalkInClient(client.id);
  assert.strictEqual(money(open.total), 20);
  const shown = db.listStayServiceWork().filter((r) => r.guest_name === "Besa Jashtme");
  assert.strictEqual(shown.length, 2);
  assert.ok(shown.every((r) => r.status === "accepted"));
  assert.ok(shown.every((r) => r.room_number === "Jashtëm"));

  const mail = db.listDueGuestServiceEmails().find((r) => r.to_email === "besa@hotel.test");
  assert.ok(mail);
  assert.strictEqual(mail.body, "Shërbimi juaj është pranuar — Pishine jashtem. Faleminderit!");

  const silent = db.openWalkInClient({ client_name: "Pa Email" });
  const extra = db.createHotelService({ name: "Gym jashtem", price: 8, vat_category: "18" });
  const beforeMails = db.listDueGuestServiceEmails().length;
  db.addWalkInService(silent.id, extra.id, { quantity: 1 });
  assert.strictEqual(db.listDueGuestServiceEmails().length, beforeMails);
  const silentLine = db.getWalkInClient(silent.id).lines[0];
  db.setWalkInLineStatus(silentLine.id, "rejected", "Fiktiv Recep");
  assert.strictEqual(db.listDueGuestServiceEmails().length, beforeMails);

  for (const line of open.lines) db.setWalkInLineStatus(line.id, "done", "Fiktiv Recep");
  const paid = db.payWalkInClient(client.id, { waiter_name: "Fiktiv Recep", payment_method: "cash" });
  assert.strictEqual(paid.receipt_number, "KL-1");
  assert.strictEqual(money(paid.total), 20);
  assert.strictEqual(paid.client.status, "paid");
  assert.strictEqual(db.listOpenWalkInClients().some((c) => c.id === client.id), false);
  assert.strictEqual(db.listStayServiceWork().filter((r) => r.guest_name === "Besa Jashtme").length, 0);
  const kept = db.db.prepare(
    "SELECT COUNT(*) AS n FROM hotel_walkin_lines WHERE client_id = ? AND work_status = 'paid'",
  ).get(client.id);
  assert.strictEqual(kept.n, 2);
  assert.throws(() => db.payWalkInClient(client.id, { waiter_name: "Fiktiv Recep" }));

  const restaurantOrders = db.db.prepare(`
    SELECT COUNT(*) AS n FROM orders o
    JOIN tables t ON t.id = o.table_id
    WHERE t.number > 0
  `).get().n;
  assert.strictEqual(restaurantOrders, 0);
  assert.strictEqual(db.db.prepare("SELECT COUNT(*) AS n FROM room_charges").get().n, 0);

  const from = "2026-11-01";
  const to = "2026-11-05";
  const ditari = db.getDitari({ dateFrom: from, dateTo: to });
  const rows = (ditari.entries || []).filter((e) => e.status !== "cancelled");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(money(rows[0].total), 20);
  assert.ok(String(rows[0].receipt_number || "").startsWith("KL-"));
  const ledger = db.getSalesLedger({ from, to });
  assert.strictEqual(money(ledger.reduce((s, r) => s + (Number(r.total) || 0), 0)), 20);
  const staff = advanced.getStaffReport(from, to);
  assert.strictEqual(money(staff.summary.total), 20);
  const recep = (staff.staff || []).find((s) => s.operator === "Fiktiv Recep");
  assert.ok(recep && recep.services.length >= 2);

  const diary = db.listHotelDiary({ event_type: "payment" });
  assert.ok(diary.some((r) => r.guest_name === "Besa Jashtme" && money(r.amount) === 20));
  assert.ok(db.listHotelDiary({ event_type: "walkin_open" }).some((r) => r.guest_name === "Besa Jashtme"));

  console.log("walkin-client.test.js OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
