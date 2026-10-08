"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `hotel-b2b-kont-${process.pid}-${Date.now()}.db`,
);
process.env.DB_PATH = TEST_DB_PATH;
process.env.HOTEL_DB_PLAIN = "1";

const db = require("../database.js");
const svc = require("../sales-invoices-service");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

let today;
let yesterday;
let menuItemId;

function saveInv(payload) {
  return svc.saveInvoice(payload);
}

function setupData() {
  today = db.db.prepare("SELECT date('now','localtime') AS d").get().d;
  yesterday = db.db.prepare("SELECT date('now','localtime','-1 day') AS d").get().d;

  saveInv({
    date: today,
    status: "final",
    guest: {
      kind: "company",
      companyName: "Kompania Test SHPK",
      name: "Kontakt",
      nui: "810123456",
      fiscalNumber: "XK123",
    },
    lines: [
      { description: "Dhomë / natë", qty: 2, unitPrice: 50, discount: { type: "amount", value: 0 } },
    ],
    vat: { enabled: true, percent: 18 },
  });

  saveInv({
    date: today,
    status: "final",
    guest: { kind: "individual", name: "Mysafir Individual", nui: "" },
    lines: [{ description: "SPA pa TVSH", qty: 1, unitPrice: 30, discount: { type: "amount", value: 0 } }],
    vat: { enabled: false, percent: 18 },
  });

  saveInv({
    date: today,
    status: "printed",
    guest: {
      kind: "company",
      companyName: "Kompania 8%",
      name: "Kontakt",
      nui: "810999888",
    },
    lines: [{ description: "Konferencë", qty: 1, unitPrice: 100, discount: { type: "amount", value: 0 } }],
    vat: { enabled: true, percent: 8 },
  });

  saveInv({
    date: today,
    status: "emailed",
    guest: {
      kind: "company",
      companyName: "Emailed SHPK",
      name: "Kontakt",
      nui: "810111222",
    },
    lines: [{ description: "Catering", qty: 1, unitPrice: 20, discount: { type: "amount", value: 0 } }],
    vat: { enabled: true, percent: 18 },
  });

  saveInv({
    date: today,
    status: "draft",
    guest: { kind: "company", companyName: "Draft Co", name: "X", nui: "810000001" },
    lines: [{ description: "Draft", qty: 1, unitPrice: 999, discount: { type: "amount", value: 0 } }],
    vat: { enabled: true, percent: 18 },
  });

  saveInv({
    date: yesterday,
    status: "final",
    guest: { kind: "individual", name: "Dje", nui: "" },
    lines: [{ description: "Dje", qty: 1, unitPrice: 11, discount: { type: "amount", value: 0 } }],
    vat: { enabled: true, percent: 18 },
  });

  db.addCategory("B2BKontCat");
  menuItemId = db.addMenuItem({ name: "B2B Kafe", category: "B2BKontCat", price: 2 });
  db.db.prepare("UPDATE menu_items SET stock_qty = ? WHERE id = ?").run(50, menuItemId);
  db.addStaff("B2BWaiter", "654321");
  const staff = db.findStaffByName("B2BWaiter");
  db.openWaiterShiftWithCash(staff.id, 0);
  const table = db.getTableByNumber(1);
  db.sendOrder({
    table_id: table.id,
    waiter_name: staff.name,
    items: [{ menu_item_id: menuItemId, name: "B2B Kafe", price: 2, quantity: 1 }],
  });
  db.closeTable(table.id, staff.name, false, "cash");
}

test("listFinalizedHotelSalesForKont — filtrim datë, status, guest_kind", () => {
  const listToday = db.listFinalizedHotelSalesForKont({ from: today, to: today });
  assert.strictEqual(listToday.length, 4, "final + printed + emailed; jo draft/dje");
  assert.ok(listToday.every((x) => ["final", "printed", "emailed"].includes(x.status)));

  const listYesterday = db.listFinalizedHotelSalesForKont({ from: yesterday, to: yesterday });
  assert.strictEqual(listYesterday.length, 1);
  assert.strictEqual(listYesterday[0].guest_kind, "individual");

  const company = listToday.find((x) => x.client_name === "Kompania Test SHPK");
  assert.ok(company);
  assert.strictEqual(company.guest_kind, "company");
  assert.ok(company.lines.length >= 1);
  assert.strictEqual(company.lines[0].unit_price, 50);

  const individual = listToday.find((x) => x.client_name === "Mysafir Individual");
  assert.ok(individual);
  assert.strictEqual(individual.guest_kind, "individual");
  assert.strictEqual(individual.vat_enabled, false);

  assert.ok(!listToday.some((x) => x.client_name === "Draft Co"));
});

test("buildHotelB2bSalesLedgerRows — source b2b-sales, TVSH 18% / 8% / off", () => {
  const invs = db.listFinalizedHotelSalesForKont({ from: today, to: today });
  const rows = db.buildHotelB2bSalesLedgerRows(invs);
  assert.strictEqual(rows.length, 4);
  assert.ok(rows.every((r) => r.source === "b2b-sales"));
  assert.ok(rows.every((r) => r.receipt_number && r.buyer_name));

  const row18 = rows.find((r) => r.vat_rate === "18%" && r.buyer_name === "Kompania Test SHPK");
  assert.ok(row18);
  assert.strictEqual(Number(row18.total), 118);
  assert.ok(Array.isArray(row18.vat_buckets));
  assert.strictEqual(row18.vat_buckets[0].rate, 18);

  const row8 = rows.find((r) => r.vat_rate === "8%");
  assert.ok(row8);
  assert.strictEqual(Number(row8.total), 108);
  assert.strictEqual(row8.vat_buckets[0].rate, 8);

  const row0 = rows.find((r) => r.buyer_name === "Mysafir Individual");
  assert.ok(row0);
  assert.strictEqual(row0.vat_rate, "0%");
  assert.strictEqual(row0.vat_buckets[0].rate, 0);
  assert.strictEqual(Number(row0.vat_buckets[0].gross), 30);
});

test("getAtkSalesVatBook — rows_b2b vs B2C, totals_b2c + totals_b2b", () => {
  const book = db.getAtkSalesVatBook({ from: today, to: today });
  assert.ok(Array.isArray(book.rows), "B2C te rows (buildSalesVatBook)");
  assert.ok(Array.isArray(book.rows_b2b));
  assert.strictEqual(book.rows_b2b.length, 4);
  assert.ok(book.b2c_count >= 1, "closeTable shtron shitje B2C në libër");
  assert.strictEqual(book.b2b_count, 4);
  assert.strictEqual(book.rows.length, book.b2c_count);

  assert.strictEqual(
    Number(book.totals.box12),
    Number(book.totals_b2c.box12) + Number(book.totals_b2b.box12),
  );
  assert.strictEqual(
    Number(book.totals.boxK1),
    Number(book.totals_b2c.boxK1) + Number(book.totals_b2b.boxK1),
  );
  assert.strictEqual(
    Number(book.totals.box14),
    Number(book.totals_b2c.box14) + Number(book.totals_b2b.box14),
  );
  assert.strictEqual(
    Number(book.totals.box9),
    Number(book.totals_b2c.box9) + Number(book.totals_b2b.box9),
  );

  const noVatRow = book.rows_b2b.find((r) => r.buyer_name === "Mysafir Individual");
  assert.ok(noVatRow);
  assert.strictEqual(Number(noVatRow.box9), 30);
  assert.strictEqual(Number(noVatRow.box12), 0);
});

test("getKontabilistiBilanc — sales_b2c, sales_b2b, count-et", () => {
  const bilanc = db.getKontabilistiBilanc({ from: today, to: today });
  assert.ok(bilanc.sales_b2b > 0);
  assert.ok(bilanc.sales_b2c >= 0);
  assert.strictEqual(bilanc.sales_b2b_count, 4);
  assert.ok(bilanc.sales_b2c_count >= 1);
  assert.strictEqual(bilanc.sales_total, bilanc.sales_b2c + bilanc.sales_b2b);
  assert.strictEqual(bilanc.sales_count, bilanc.sales_b2c_count + bilanc.sales_b2b_count);
});

test("Edge: vat_enabled=0 — bucket rate 0, neto = shuma (pa TVSH)", () => {
  const invs = db.listFinalizedHotelSalesForKont({ from: today, to: today });
  const spa = invs.find((x) => x.client_name === "Mysafir Individual");
  assert.ok(spa);
  assert.strictEqual(spa.vat_enabled, false);
  assert.strictEqual(Number(spa.vat_amount), 0);
  assert.strictEqual(Number(spa.grand_total), 30);

  const ledger = db.buildHotelB2bSalesLedgerRows([spa])[0];
  assert.strictEqual(ledger.vat_rate, "0%");
  assert.strictEqual(ledger.vat_buckets[0].rate, 0);
  assert.strictEqual(Number(ledger.vat_buckets[0].vat), 0);

  const atk = require("../kontabilisti-atk");
  const net = atk.saleLedgerNetTotal(ledger);
  assert.strictEqual(net, 30);
});

(async () => {
  let passed = 0;
  let failed = 0;
  console.log("\n=== HOTEL B2B kontabilist ===\n");
  try {
    await db.whenReady();
    db.runSetup({
      restaurant_name: "Hotel B2B Kont",
      admin_password: "test1234",
      table_count: 3,
    });
    setupData();
    for (const t of tests) {
      try {
        await t.fn();
        console.log(`  ok - ${t.name}`);
        passed += 1;
      } catch (err) {
        console.error(`  FAIL - ${t.name}`);
        console.error(`    ${err.message}`);
        failed += 1;
      }
    }
  } catch (e) {
    console.error("SETUP FAIL:", e.message);
    console.error(e.stack);
    failed += 1;
  }
  console.log(`\n${passed} passed, ${failed} failed (${tests.length} total)\n`);
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {
    /* ignore */
  }
  process.exit(failed ? 1 : 0);
})();
