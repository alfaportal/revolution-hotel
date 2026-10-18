"use strict";

const assert = require("assert");
const path = require("path");
const os = require("os");

process.env.DB_PATH = path.join(os.tmpdir(), `hotel-report-totals-${Date.now()}.db`);
process.env.HOTEL_DB_PLAIN = "1";

async function main() {
  const db = require("../database");
  await db.whenReady();
  db.runSetup({
    restaurant_name: "Report Totals Hotel",
    admin_password: "test1234",
    table_count: 4,
  });

  const day = "2026-10-18";
  const sqlite = db.db;
  const guestId = 42;

  sqlite.prepare(`
    INSERT INTO daily_log (
      date, time, table_number, waiter_name, items_json, total, status,
      payment_method, receipt_number, cash_amount, card_amount
    ) VALUES (?, '00:35:00', 'Dh.104', 'hasan', ?, 60, 'completed', 'cash', ?, 60, 0)
  `).run(
    day,
    JSON.stringify([{ name: "Dhoma 104 — 2 netë — 1 persona", quantity: 2, price: 30 }]),
    `CO-${guestId}`,
  );

  const rep = db.getReports(day, day);
  assert.strictEqual(rep.receptionSales, 60, "RECEPCION gross CO");
  assert.strictEqual(rep.totalSales, 60, "TOTALI duhet të përfshijë dhoma nga check-out");
  assert.strictEqual(rep.hotelNights, 0, "Netët akruale skip pas CO në periudhë");

  const dit = db.getDitari({
    dateFrom: day,
    dateTo: day,
    timeFrom: "00:00:00",
    timeTo: "23:59:59",
  });
  assert.strictEqual(dit.totalSales, 60, "Ditari totalSales = CO");
  assert.strictEqual(dit.totalCash, 60, "Ditari cash përfshin CO");

  sqlite.prepare(`
    INSERT INTO daily_log (
      date, time, table_number, waiter_name, items_json, total, status,
      payment_method, cash_amount, card_amount
    ) VALUES (?, '12:00:00', '5', 'waiter', ?, 100, 'completed', 'mixed', 40, 60)
  `).run(day, JSON.stringify([{ name: "Test", quantity: 1, price: 100 }]));

  const repMix = db.getReports(day, day);
  assert.strictEqual(repMix.totalCash, 40, "Raportet cash vetëm tavolina (mixed 40)");
  assert.strictEqual(repMix.totalKarte, 60, "mixed kartë 60");
  assert.strictEqual(repMix.totalTjera, 0, "pa tjera për cash+kartë");
  const restOnly = Number(repMix.restaurantRegisterSales) || 0;
  assert.strictEqual(
    Math.round((repMix.totalCash + repMix.totalKarte + repMix.totalTjera) * 100) / 100,
    restOnly,
    "Cash+Kartë+Tjera = shitje restorant (daily_log pa recepsion)",
  );

  const ditMix = db.getDitari({
    dateFrom: day,
    dateTo: day,
    timeFrom: "00:00:00",
    timeTo: "23:59:59",
  });
  assert.strictEqual(ditMix.totalCash, 100, "Ditari cash: CO 60 + mixed 40");
  assert.strictEqual(ditMix.totalKarte, 60, "Ditari kartë mixed");

  const cashReg = db.getCashInRegister(day, day);
  assert.strictEqual(cashReg.sales_cash, 100, "cash_amount: CO 60 + mixed 40");
  assert.strictEqual(repMix.cash_in_register, cashReg.cash_in_register, "getReports cash_in_register");

  console.log("hotel-report-totals.test.js OK");
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
