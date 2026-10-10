"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const TEST_DB = path.join(os.tmpdir(), `hotel-b2b-pay-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TEST_DB;
process.env.HOTEL_DB_PLAIN = "1";

const db = require("../database.js");
const svc = require("../sales-invoices-service");

async function main() {
  await db.whenReady();
  db.runSetup({
    restaurant_name: "B2B Pay Test",
    admin_password: "test1234",
    table_count: 2,
  });

  const today = db.db.prepare("SELECT date('now','localtime') AS d").get().d;
  const repBefore = db.getReports(today, today);

  const inv = svc.saveInvoice({
    date: today,
    status: "final",
    guest: {
      kind: "company",
      companyName: "Pay Test SHPK",
      name: "Kontakt",
      nui: "810555444",
    },
    lines: [{ description: "Shërbim B2B", qty: 1, unitPrice: 100, discount: { type: "amount", value: 0 } }],
    vat: { enabled: false, percent: 18 },
  });

  assert.strictEqual(inv.paymentStatus, "unpaid");
  assert.strictEqual(inv.balanceDue, 100);

  const p1 = svc.addInvoicePayment(inv.id, {
    amount: 40,
    payment_method: "cash",
    payment_date: today,
    note: "Parë",
  });
  assert.strictEqual(p1.invoice.paymentStatus, "partial");
  assert.strictEqual(p1.invoice.balanceDue, 60);
  assert.strictEqual(p1.invoice.amountPaid, 40);

  const debtsMid = svc.listBusinessDebts();
  const rowMid = debtsMid.find((b) => b.nui === "810555444");
  assert.ok(rowMid, "business debt row");
  assert.strictEqual(rowMid.balanceDue, 60);

  const p2 = svc.addInvoicePayment(inv.id, {
    amount: 60,
    payment_method: "bank",
    payment_date: today,
    note: "Saldo",
  });
  assert.strictEqual(p2.invoice.paymentStatus, "paid");
  assert.strictEqual(p2.invoice.balanceDue, 0);
  assert.strictEqual(p2.invoice.amountPaid, 100);

  const debtsAfter = svc.listBusinessDebts();
  assert.ok(!debtsAfter.some((b) => b.nui === "810555444"), "no debt after full pay");

  const repAfter = db.getReports(today, today);
  const recepRegs = (repAfter.byRegister || []).filter((b) => /recepsion/i.test(b.register_name));
  const recepCashAfter = recepRegs.reduce((s, b) => s + (Number(b.cash) || 0), 0);
  const recepRegsBefore = (repBefore.byRegister || []).filter((b) => /recepsion/i.test(b.register_name));
  const recepCashBefore = recepRegsBefore.reduce((s, b) => s + (Number(b.cash) || 0), 0);
  assert.strictEqual(
    Math.round((recepCashAfter - recepCashBefore) * 100),
    4000,
    "only cash payment 40€ hits reception register",
  );

  console.log("\n=== HOTEL B2B payments ===\n");
  console.log("  OK  partial + full payment, debt list, cash register only for cash\n");
  try {
    fs.unlinkSync(TEST_DB);
  } catch {
    /* ignore */
  }
}

main().catch((e) => {
  console.error("  FAIL", e.message || e);
  process.exit(1);
});
