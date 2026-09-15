/**
 * Teste reale ATK — Kontabilisti (sipas ligjit / kutizat e deklaratës).
 * Simulon muaj biznesi: shitje A/C/D/E, blerje, shpenzime, paga, deklaratë.
 * Nuk prek closeTable / sync / printer.
 */
"use strict";

const assert = require("assert");
const path = require("path");
const atk = require(path.join(__dirname, "..", "kontabilisti-atk"));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${err.message}`);
  }
}

function eq(actual, expected, msg) {
  const a = atk.money(actual);
  const e = atk.money(expected);
  assert.strictEqual(a, e, msg || `expected ${e}, got ${a}`);
}

console.log("\n=== Kontabilisti ATK — teste reale (biznes) ===\n");

// ── 1) Shkronjat A/C/D/E → kutizat e veta (një faturë e përzier) ───────────
test("Shitje e përzier A/C/D/E mbush [9]/[10c]/[12]/[K1]/[14]/[K2]", () => {
  const rows = atk.buildSalesVatBook([
    {
      date: "2026-03-05",
      receipt_number: "SEF-1001",
      total: 278.8,
      vat_rate: "A/C/D/E",
      vat_buckets: [
        { letter: "A", rate: 0, gross: 100, net: 100, vat: 0 },
        { letter: "C", rate: 0, gross: 50, net: 50, vat: 0 },
        { letter: "D", rate: 8, gross: 10.8, net: 10, vat: 0.8 },
        { letter: "E", rate: 18, gross: 118, net: 100, vat: 18 },
      ],
    },
  ]);
  const r = rows[0];
  eq(r.box9, 100, "A → [9]");
  eq(r.box10c, 50, "C → [10c]");
  eq(r.box10, 50, "[10]=[10c]");
  eq(r.box12, 100, "E → [12]");
  eq(r.boxK1, 18, "E → [K1]");
  eq(r.box14, 10, "D → [14]");
  eq(r.boxK2, 0.8, "D → [K2]");
  eq(r.box30, 18.8, "[30]=K1+K2");
  eq(r.gross, 278.8);
});

// ── 2) Muaj real: disa fatura shitjeje ─────────────────────────────────────
test("Muaj shitjesh: disa fatura → totalet ATK korrekte", () => {
  const sales = [
    // Dyqan: mallra 18%
    {
      date: "2026-03-01",
      receipt_number: "F-001",
      total: 236,
      vat_rate: "E",
      vat_buckets: [{ letter: "E", rate: 18, gross: 236, net: 200, vat: 36 }],
    },
    // Shërbim 8%
    {
      date: "2026-03-02",
      receipt_number: "F-002",
      total: 54,
      vat_rate: "D",
      vat_buckets: [{ letter: "D", rate: 8, gross: 54, net: 50, vat: 4 }],
    },
    // E liruar A
    {
      date: "2026-03-03",
      receipt_number: "F-003",
      total: 40,
      vat_rate: "A",
      vat_buckets: [{ letter: "A", rate: 0, gross: 40, net: 40, vat: 0 }],
    },
    // Përzier D+E (si kupon fiskal)
    {
      date: "2026-03-04",
      receipt_number: "F-004",
      total: 128.8,
      vat_rate: "D/E",
      vat_buckets: [
        { letter: "D", rate: 8, gross: 10.8, net: 10, vat: 0.8 },
        { letter: "E", rate: 18, gross: 118, net: 100, vat: 18 },
      ],
    },
  ];
  const book = atk.buildSalesVatBook(sales);
  const t = atk.sumSalesVatBoxes(book);
  eq(t.box9, 40);
  eq(t.box12, 300); // 200 + 100
  eq(t.boxK1, 54); // 36 + 18
  eq(t.box14, 60); // 50 + 10
  eq(t.boxK2, 4.8); // 4 + 0.8
  eq(t.box30, 58.8);
});

// ── 3) Residual: 3×1.00€ @18% — pa ±0.01€ ─────────────────────────────────
test("Residual rounding: 3×1.00€ @18% → net+vat=gross ekzakt", () => {
  const buckets = atk.normalizeVatBuckets(
    [
      { letter: "E", rate: 18, gross: 1, net: 1 / 1.18, vat: 1 - 1 / 1.18 },
      { letter: "E", rate: 18, gross: 1, net: 1 / 1.18, vat: 1 - 1 / 1.18 },
      { letter: "E", rate: 18, gross: 1, net: 1 / 1.18, vat: 1 - 1 / 1.18 },
    ],
    3,
  );
  const sumG = atk.money(buckets.reduce((s, b) => s + b.gross, 0));
  const sumNV = atk.money(buckets.reduce((s, b) => s + b.net + b.vat, 0));
  eq(sumG, 3);
  eq(sumNV, 3);
  const row = atk.buildSalesVatBook([
    { total: 3, vat_rate: "E", vat_buckets: buckets },
  ])[0];
  eq(atk.money(row.box12 + row.boxK1), 3);
});

// ── 4) Blerje vendore / invest / shpenzim — kutizat e sakta ─────────────────
test("Blerje: mallra/invest/shpenzim → [43]/[47]/[45]/[49]/[31] + K1/K2", () => {
  const invoices = [
    {
      invoice_date: "2026-03-05",
      invoice_number: "BL-01",
      supplier: "Furnitor A",
      supplier_nui: "810000001",
      total: 1180,
      vat_rate: 18,
      purchase_kind: "goods",
    },
    {
      invoice_date: "2026-03-06",
      invoice_number: "BL-02",
      supplier: "Pajisje SHPK",
      total: 590,
      vat_rate: 18,
      purchase_kind: "invest",
    },
    {
      invoice_date: "2026-03-07",
      invoice_number: "BL-03",
      supplier: "Ushqim 8%",
      total: 108,
      vat_rate: 8,
      purchase_kind: "goods",
    },
    {
      invoice_date: "2026-03-08",
      invoice_number: "BL-04",
      supplier: "Invest 8%",
      total: 54,
      vat_rate: 8,
      purchase_kind: "invest",
    },
    {
      invoice_date: "2026-03-09",
      invoice_number: "BL-05",
      supplier: "Pa TVSH",
      total: 200,
      vat_rate: 0,
      purchase_kind: "goods",
    },
  ];
  const expenses = [
    {
      id: 1,
      expense_date: "2026-03-10",
      vendor_name: "Energjia",
      amount: 118,
      vat_rate: 18,
    },
  ];
  const rows = atk.buildPurchaseVatBook(invoices, expenses);
  const t = atk.sumPurchaseVatBoxes(rows);

  eq(t.box43, 1100); // mallra 18%: 1000 + shpenzim 100
  eq(t.box47, 500); // invest 18% (JO box39 import)
  eq(t.box39, 0, "invest vendore NUK shkon te [39] import");
  eq(t.box45, 100); // mallra 8%
  eq(t.box49, 50); // invest 8%
  eq(t.box31, 200); // pa TVSH
  eq(t.boxK1, 288); // 180 + 90 + 18
  eq(t.boxK2, 12); // 8 + 4
  eq(t.box67, 300);
});

// ── 5) Deklarata mbushët automatikisht nga librat ──────────────────────────
test("Deklarata TVSH: kutizat nga shitje+blerje + TVSH për pagesë", () => {
  const salesBook = atk.buildSalesVatBook([
    {
      total: 1180,
      vat_rate: "E",
      vat_buckets: [{ letter: "E", rate: 18, gross: 1180, net: 1000, vat: 180 }],
    },
    {
      total: 108,
      vat_rate: "D",
      vat_buckets: [{ letter: "D", rate: 8, gross: 108, net: 100, vat: 8 }],
    },
    {
      total: 80,
      vat_rate: "A",
      vat_buckets: [{ letter: "A", rate: 0, gross: 80, net: 80, vat: 0 }],
    },
  ]);
  const purchBook = atk.buildPurchaseVatBook(
    [
      {
        total: 590,
        vat_rate: 18,
        purchase_kind: "goods",
        invoice_date: "2026-03-01",
        invoice_number: "P1",
        supplier: "X",
      },
    ],
    [],
  );
  const sTot = atk.sumSalesVatBoxes(salesBook);
  const pTot = atk.sumPurchaseVatBoxes(purchBook);
  const decl = atk.buildVatDeclaration(sTot, pTot);
  const b = decl.boxes;

  eq(b["[9] Shitjet e liruara pa të drejtë kreditimi"], 80);
  eq(b["[12] Shitjet e tatueshme 18%"], 1000);
  eq(b["[14] Shitjet e tatueshme 8%"], 100);
  eq(b["[K1] TVSH e llogaritur 18%"], 180);
  eq(b["[K2] TVSH e llogaritur 8%"], 8);
  eq(b["[30] Total TVSH e llogaritur"], 188);
  eq(b["[43] Blerjet vendore 18%"], 500);
  eq(b["[K1] TVSH e zbritshme 18%"], 90);
  eq(b["[67] Total TVSH e zbritshme"], 90);
  eq(b["TVSH për pagesë / (kthim)"], 98); // 188 - 90
  eq(decl.vat_payable, 98);
});

// ── 6) Mos gabim: D/E pa bucket → NUK hidhet te një normë e vetme ──────────
test("Etiketë e përzier pa bucket → kutizat tatimore mbeten 0 (jo gabim)", () => {
  const r = atk.buildSalesVatBook([
    { total: 200, vat_rate: "D/E", vat_buckets: [] },
  ])[0];
  eq(r.box12, 0);
  eq(r.box14, 0);
  eq(r.boxK1, 0);
  eq(r.boxK2, 0);
  assert.strictEqual(atk.rateFromVatLabel("D/E"), null);
  assert.strictEqual(atk.rateFromVatLabel("Mikse"), null);
  assert.strictEqual(atk.rateFromVatLabel("E"), 18);
  assert.strictEqual(atk.rateFromVatLabel("D"), 8);
  assert.strictEqual(atk.rateFromVatLabel("A"), 0);
});

test("Etiketë — / bosh pa bucket → 18% [12]/[K1], JO [9]", () => {
  const dash = atk.buildSalesVatBook([{ total: 21.5, vat_rate: "—", vat_buckets: [] }])[0];
  const empty = atk.buildSalesVatBook([{ total: 21.5, vat_rate: "", vat_buckets: [] }])[0];
  eq(dash.box9, 0, "— nuk shkon te [9]");
  eq(empty.box9, 0, "bosh nuk shkon te [9]");
  eq(dash.box12, 18.22);
  eq(dash.boxK1, 3.28);
  eq(dash.box30, 3.28);
  eq(empty.box12, 18.22);
  eq(empty.boxK1, 3.28);
  assert.strictEqual(atk.rateFromVatLabel("—"), null);
  assert.strictEqual(atk.rateFromVatLabel(""), null);
});

test("Artikuj 18%/8%/0% → [12]/[K1] + [14]/[K2] + [9]", () => {
  const buckets = atk.buildSaleVatBuckets(
    [
      { name: "Kafe", price: 11.8, quantity: 1, vat_category: 18 },
      { name: "Ujë", price: 5.4, quantity: 1, vat_letter: "D" },
      { name: "Eksport", price: 4.3, quantity: 1, vat_letter: "A" },
    ],
    { targetTotal: 21.5, fallbackPercent: 18 },
  );
  const r = atk.buildSalesVatBook([{ total: 21.5, vat_rate: "Mikse", vat_buckets: buckets }])[0];
  eq(r.box12, 10);
  eq(r.boxK1, 1.8);
  eq(r.box14, 5);
  eq(r.boxK2, 0.4);
  eq(r.box9, 4.3);
  eq(r.box30, 2.2);
});

// ── 7) Menu path: rate 0/8/18 pa letter → A/D/E ────────────────────────────
test("Bucket nga norma menu (0/8/18) → A/D/E te kutizat e sakta", () => {
  const r = atk.buildSalesVatBook([
    {
      total: 168.8,
      vat_rate: "Mikse",
      vat_buckets: [
        { rate: 0, gross: 40, net: 40, vat: 0 },
        { rate: 8, gross: 10.8, net: 10, vat: 0.8 },
        { rate: 18, gross: 118, net: 100, vat: 18 },
      ],
    },
  ])[0];
  eq(r.box9, 40);
  eq(r.box14, 10);
  eq(r.boxK2, 0.8);
  eq(r.box12, 100);
  eq(r.boxK1, 18);
});

// ── 8) Tatimi në paga — shkallët zyrtare (Ligji 05/L-028, mujor) ───────────
test("Tatimi në paga: 80/200/300/500€ sipas shkallëve zyrtare", () => {
  eq(atk.approxWageTax(80), 0);
  eq(atk.approxWageTax(200), 4.8); // (200-80)*4%
  eq(atk.approxWageTax(300), 10.8); // 6.8 + 50*8%
  eq(atk.approxWageTax(500), 27.8); // 22.8 + 50*10%

  const wh = atk.buildWithholdingTaxFromPayroll([
    {
      gross_salary: 500,
      apply_wage_tax: 1,
      employee_pension: 25,
      employer_pension: 25,
    },
    {
      gross_salary: 200,
      apply_wage_tax: 1,
      employee_pension: 10,
      employer_pension: 10,
    },
  ]);
  eq(wh.box8, 700);
  eq(wh.box9, 32.6); // 27.8 + 4.8
});

// ── 9) A dhe C NUK bashkohen ───────────────────────────────────────────────
test("A dhe C mbeten të ndara ([9] vs [10c])", () => {
  const buckets = atk.normalizeVatBuckets(
    [
      { letter: "A", rate: 0, gross: 30, net: 30, vat: 0 },
      { letter: "C", rate: 0, gross: 20, net: 20, vat: 0 },
    ],
    50,
  );
  assert.ok(buckets.some((b) => b.letter === "A"));
  assert.ok(buckets.some((b) => b.letter === "C"));
  const r = atk.buildSalesVatBook([
    { total: 50, vat_rate: "A/C", vat_buckets: buckets },
  ])[0];
  eq(r.box9, 30);
  eq(r.box10c, 20);
});

// ── 10) Skenar i plotë biznesi (muaj) — kontroll final ─────────────────────
test("Skenar i plotë: shitje+blerje+deklaratë si kontroll ATK", () => {
  // Biznes tregtar: shitje 18% + 8%, blerje mallrash, investim pajisje
  const sales = atk.buildSalesVatBook([
    {
      date: "2026-03-15",
      receipt_number: "INV-900",
      total: 5900,
      vat_rate: "E",
      vat_buckets: [{ letter: "E", rate: 18, gross: 5900, net: 5000, vat: 900 }],
    },
    {
      date: "2026-03-16",
      receipt_number: "INV-901",
      total: 540,
      vat_rate: "D",
      vat_buckets: [{ letter: "D", rate: 8, gross: 540, net: 500, vat: 40 }],
    },
  ]);
  const purchases = atk.buildPurchaseVatBook(
    [
      {
        invoice_date: "2026-03-10",
        invoice_number: "SUP-50",
        supplier: "Grossist",
        total: 2360,
        vat_rate: 18,
        purchase_kind: "goods",
      },
      {
        invoice_date: "2026-03-12",
        invoice_number: "SUP-51",
        supplier: "IT Shop",
        total: 1180,
        vat_rate: 18,
        purchase_kind: "invest",
      },
    ],
    [
      {
        expense_date: "2026-03-20",
        vendor_name: "Qira zyre",
        amount: 500,
        vat_rate: 0,
      },
    ],
  );
  const s = atk.sumSalesVatBoxes(sales);
  const p = atk.sumPurchaseVatBoxes(purchases);
  const d = atk.buildVatDeclaration(s, p);

  eq(s.box12, 5000);
  eq(s.boxK1, 900);
  eq(s.box14, 500);
  eq(s.boxK2, 40);
  eq(s.box30, 940);

  eq(p.box43, 2000);
  eq(p.box47, 1000);
  eq(p.box31, 500);
  eq(p.boxK1, 540); // mallra 360 + invest 180
  eq(p.box67, 540);

  eq(d.vat_calculated, 940);
  eq(d.vat_deductible, 540);
  eq(d.vat_payable, 400); // 940 - 540 — TVSH për pagesë

  // Kutizat që nuk kanë burim të dhënash mbeten 0 (nuk inventohen)
  eq(s.box11, 0, "eksportet 0 pa të dhëna");
  eq(p.box35, 0, "importet 0 pa të dhëna");
  eq(p.box39, 0, "import invest 0");
});

// ── 8) Blerje me TVSH të përzier në një faturë ─────────────────────────────
test("Blerje: faturë me 8% + 18% → kutizat e ndara në një rresht ATK", () => {
  const rows = atk.buildPurchaseVatBook(
    [
      {
        invoice_date: "2026-03-15",
        invoice_number: "BL-MIX",
        supplier: "Furnitor mix",
        supplier_nui: "810000002",
        total: 100,
        vat_rate: -1,
        purchase_kind: "goods",
        items: [
          { line_total: 50, vat_rate: 8 },
          { line_total: 50, vat_rate: 18 },
        ],
      },
    ],
    [],
  );
  eq(rows.length, 1);
  const r = rows[0];
  eq(r.box45, 46.3);
  eq(r.box43, 42.37);
  eq(r.boxK2, 3.7);
  eq(r.boxK1, 7.63);
  eq(r.box67, 11.33);
  const t = atk.sumPurchaseVatBoxes(rows);
  eq(t.box45, 46.3);
  eq(t.box43, 42.37);
  eq(t.boxK1, 7.63);
  eq(t.boxK2, 3.7);
});

test("buildSaleVatBuckets: zbritje promocioni → shuma bucket = total", () => {
  const promo = require(path.join(__dirname, "..", "promotion-service"));
  const items = [{ name: "Kafe", price: 5, quantity: 2, menu_item_id: 1 }];
  const prepared = promo.prepareItemsForVatLedger(items, {
    subtotal: 10,
    discount_total: 2,
    total: 8,
    promotion_id: null,
  });
  const buckets = atk.buildSaleVatBuckets(prepared, {
    targetTotal: 8,
    fallbackPercent: 18,
    rateByMenuId: new Map([[1, 18]]),
  });
  const sumG = atk.money(buckets.reduce((s, b) => s + b.gross, 0));
  const sumNV = atk.money(buckets.reduce((s, b) => s + b.net + b.vat, 0));
  eq(sumG, 8);
  eq(sumNV, 8);
  eq(buckets[0].letter, "E");
});

test("prepareItemsForVatLedger: zbritje rreshti + promocion → total i saktë", () => {
  const promo = require(path.join(__dirname, "..", "promotion-service"));
  const items = [
    {
      name: "Pizza",
      price: 10,
      quantity: 1,
      menu_item_id: 2,
      line_discount_amount: 1,
    },
  ];
  const prepared = promo.prepareItemsForVatLedger(items, {
    subtotal: 10,
    discount_total: 0.9,
    total: 8.1,
    promotion_id: null,
  });
  const lineTotal = atk.money(
    prepared.reduce((s, it) => s + Number(it.price) * Number(it.quantity), 0),
  );
  eq(lineTotal, 8.1);
  const buckets = atk.buildSaleVatBuckets(prepared, {
    targetTotal: 8.1,
    fallbackPercent: 18,
    rateByMenuId: new Map([[2, 18]]),
  });
  eq(atk.money(buckets.reduce((s, b) => s + b.gross, 0)), 8.1);
});

test("buildSaleVatBuckets: D+E me zbritje → A/D/E të ndara, total i saktë", () => {
  const promo = require(path.join(__dirname, "..", "promotion-service"));
  const items = [
    { name: "Ushqim 8%", price: 10, quantity: 1, menu_item_id: 3, vat_norm: "D" },
    { name: "Pije 18%", price: 10, quantity: 1, menu_item_id: 4, vat_norm: "E" },
  ];
  const prepared = promo.prepareItemsForVatLedger(items, {
    subtotal: 20,
    discount_total: 2,
    total: 18,
    promotion_id: null,
  });
  const buckets = atk.buildSaleVatBuckets(prepared, {
    targetTotal: 18,
    fallbackPercent: 18,
    rateByMenuId: new Map([
      [3, 8],
      [4, 18],
    ]),
  });
  eq(atk.money(buckets.reduce((s, b) => s + b.gross, 0)), 18);
  assert.ok(buckets.some((b) => b.letter === "D"));
  assert.ok(buckets.some((b) => b.letter === "E"));
  const row = atk.buildSalesVatBook([
    { total: 18, vat_rate: "D/E", vat_buckets: buckets },
  ])[0];
  eq(atk.money(row.box12 + row.box14 + row.boxK1 + row.boxK2), 18);
});

console.log(`\n=== Rezultati: ${passed} OK, ${failed} FAIL ===\n`);
process.exit(failed ? 1 : 0);
