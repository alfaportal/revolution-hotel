"use strict";

/**
 * Blerje / AI skanim — neto → bruto (purchase-pack-math + ai-receipt-scan).
 * Referencë konceptuale: MARKET purchase-invoice-fix, legacy-neto-purchase-lines.
 */

const assert = require("assert");
const path = require("path");

const packMath = require(path.join(__dirname, "..", "purchase-pack-math"));
const receiptScan = require(path.join(__dirname, "..", "ai", "ai-receipt-scan"));

const {
  normalizeLineVatRate,
  netUnitToGross,
  netLineToGross,
  convertPackToPieces,
} = packMath;

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function approx(actual, expected, eps = 0.011) {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= eps,
    `expected ~${expected}, got ${actual}`,
  );
}

const mockDb = {
  findPurchaseInvoiceDuplicate() {
    return null;
  },
};

function validInvoiceBase(overrides = {}) {
  return {
    supplier: "Furnitor Test",
    invoice_number: "BL-2026-100",
    invoice_date: "2026-03-15",
    vat_rate: 18,
    ...overrides,
  };
}

// ── purchase-pack-math ─────────────────────────────────────────────────────

test("normalizeLineVatRate: 0, 8, 18 dhe default 18", () => {
  assert.strictEqual(normalizeLineVatRate({ vat_rate: 0 }), 0);
  assert.strictEqual(normalizeLineVatRate({ vat_rate: 8 }), 8);
  assert.strictEqual(normalizeLineVatRate({ vat_rate: 18 }), 18);
  assert.strictEqual(normalizeLineVatRate({ vat_rate: 99 }), 18);
  assert.strictEqual(normalizeLineVatRate({}), 18);
  assert.strictEqual(normalizeLineVatRate({ vat_rate: -1 }), 18);
  assert.strictEqual(normalizeLineVatRate({ vat_rate: 5 }), 8);
});

test("netUnitToGross / netLineToGross @ 0%, 8%, 18%", () => {
  assert.strictEqual(netUnitToGross(100, 0), 100);
  assert.strictEqual(netUnitToGross(100, 8), 108);
  assert.strictEqual(netUnitToGross(100, 18), 118);
  assert.strictEqual(netLineToGross(50, 18), netUnitToGross(50, 18));
  assert.strictEqual(netUnitToGross(1.69, 18), 1.9942);
});

test("convertPackToPieces: neto 1.69 @18% → bruto ~1.99, line_net + line_total konsistente", () => {
  const row = convertPackToPieces({
    name: "Artikull test",
    unit: "copë",
    quantity: 10,
    unit_price: 1.69,
    vat_rate: 18,
  });
  assert.strictEqual(row.ok, true);
  approx(row.pack_price, 1.69);
  approx(row.pack_price_gross, 1.9942);
  approx(row.unit_price, 1.9942);
  assert.strictEqual(row.line_net, 16.9);
  approx(row.line_total, 19.94);
  approx(row.line_total, netLineToGross(row.line_net, 18), 0.02);
});

test("convertPackToPieces: pack_price (neto) vs pack_price_gross (bruto) për pako", () => {
  const row = convertPackToPieces({
    name: "Coca Cola 24 cop",
    unit: "pako",
    quantity: 2,
    unit_price: 12,
    pieces_per_pack: 24,
    vat_rate: 18,
  });
  assert.strictEqual(row.ok, true);
  assert.strictEqual(row.packs, 2);
  assert.strictEqual(row.pieces_per_pack, 24);
  assert.strictEqual(row.quantity, 48);
  assert.strictEqual(row.pack_price, 12);
  assert.strictEqual(row.pack_price_gross, netUnitToGross(12, 18));
  assert.strictEqual(row.line_net, 24);
  approx(row.line_total, netLineToGross(24, 18), 0.02);
  approx(row.unit_price, row.pack_price_gross / 24, 0.0001);
});

test("convertPackToPieces: reconcili line_total bruto nga AI", () => {
  const row = convertPackToPieces({
    name: "Reconcili bruto",
    unit: "copë",
    quantity: 10,
    unit_price: 1.69,
    vat_rate: 18,
    line_total: 19.94,
  });
  assert.strictEqual(row.ok, true);
  assert.strictEqual(row.line_net, 16.9);
  assert.strictEqual(row.line_total, 19.94);
});

test("convertPackToPieces: reconcili line_net nga AI → line_total bruto", () => {
  const row = convertPackToPieces({
    name: "Reconcili neto",
    unit: "copë",
    quantity: 10,
    unit_price: 1.69,
    vat_rate: 18,
    line_net: 16.9,
  });
  assert.strictEqual(row.ok, true);
  assert.strictEqual(row.line_net, 16.9);
  approx(row.line_total, 19.94, 0.02);
});

// ── ai-receipt-scan (normalizeScannedLineItem përmes payload) ───────────────

test("normalizeScannedLineItem: derivon unit_price nga line_net / quantity", () => {
  const payload = receiptScan.normalizeScannedInvoicePayload({
    invoice_number: "X",
    items: [
      { name: "Derivim", quantity: 5, line_net: 10, vat_rate: 18 },
    ],
  });
  const line = payload.items[0];
  assert.strictEqual(line.line_net, 10);
  assert.strictEqual(line.unit_price, 2);
});

test("validateReceiptScanApply: rreshta validë (neto në unit_price) → ok:true", () => {
  const res = receiptScan.validateReceiptScanApply(
    validInvoiceBase({
      items: [
        {
          name: "Neto AI",
          unit: "copë",
          quantity: 10,
          unit_price: 1.69,
          vat_rate: 18,
          line_net: 16.9,
          line_total: 19.94,
        },
      ],
    }),
    mockDb,
  );
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.errors.length, 0);
});

test("validateReceiptScanApply: qtyPriceMatchesLineTotal — bruto në line_total pranohet", () => {
  const res = receiptScan.validateReceiptScanApply(
    validInvoiceBase({
      items: [
        {
          name: "Bruto total",
          unit: "copë",
          quantity: 10,
          unit_price: 1.69,
          vat_rate: 18,
          line_total: 19.94,
        },
      ],
    }),
    mockDb,
  );
  assert.strictEqual(res.ok, true);
});

test("validateReceiptScanApply: line_total që nuk përputhet → errors[]", () => {
  const res = receiptScan.validateReceiptScanApply(
    validInvoiceBase({
      items: [
        {
          name: "Gabim shume",
          unit: "copë",
          quantity: 10,
          unit_price: 1.69,
          vat_rate: 18,
          line_total: 50,
        },
      ],
    }),
    mockDb,
  );
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /Gabim shume|sasia × çmimi|vlera në faturë/i.test(e)));
});

test("validateReceiptScanApply: sasi e pavlefshme → errors[]", () => {
  const res = receiptScan.validateReceiptScanApply(
    validInvoiceBase({
      items: [{ name: "Zero qty", quantity: 0, unit_price: 1.69 }],
    }),
    mockDb,
  );
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.length > 0);
});

test("Skenari rreziku: AI neto 1.69 → convertPackToPieces jep bruto për stok/kontabilist", () => {
  const aiRow = {
    name: "Rrezik neto",
    unit: "copë",
    quantity: 10,
    unit_price: 1.69,
    vat_rate: 18,
    line_net: 16.9,
    line_total: 19.94,
  };
  const normalized = receiptScan.normalizeScannedInvoicePayload({ items: [aiRow] }).items[0];
  const converted = convertPackToPieces(normalized);
  assert.strictEqual(converted.ok, true);
  assert.strictEqual(converted.pack_price, 1.69);
  approx(converted.unit_price, 1.9942);
  approx(converted.line_total, 19.94);
  assert.ok(
    converted.unit_price > converted.pack_price,
    "stok/kontabilist duhet çmim bruto, jo neto 1.69",
  );
  const validation = receiptScan.validateReceiptScanApply(
    validInvoiceBase({ items: [aiRow] }),
    mockDb,
  );
  assert.strictEqual(validation.ok, true);
});

(async () => {
  let passed = 0;
  let failed = 0;
  console.log("\n=== HOTEL purchase-neto-bruto ===\n");
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
  console.log(`\n${passed} passed, ${failed} failed (${tests.length} total)\n`);
  process.exit(failed ? 1 : 0);
})();
