/** Kategoritë TVSH ATK Kosovo (A–E) — norma default */

const VAT_CATEGORIES = {
  A: { label: "A — 18%", rate: 0.18 },
  B: { label: "B — 8%", rate: 0.08 },
  C: { label: "C — 0%", rate: 0 },
  D: { label: "D — E përjashtuar", rate: 0 },
  E: { label: "E — Tjeter", rate: 0 },
};

const VAT_KEYS = ["A", "B", "C", "D", "E"];

function emptyVatBreakdown() {
  const b = {};
  for (const k of VAT_KEYS) {
    b[k] = { net: 0, vat: 0, gross: 0 };
  }
  return b;
}

function normalizeVatCategory(cat) {
  const c = String(cat || "A").trim().toUpperCase();
  return VAT_KEYS.includes(c) ? c : "A";
}

function splitGrossByCategory(gross, category = "A") {
  const cat = normalizeVatCategory(category);
  const rate = VAT_CATEGORIES[cat].rate;
  const grossNum = Number(gross) || 0;
  if (rate <= 0) {
    return { category: cat, net: grossNum, vat: 0, gross: grossNum };
  }
  const net = Math.round((grossNum / (1 + rate)) * 100) / 100;
  const vat = Math.round((grossNum - net) * 100) / 100;
  return { category: cat, net, vat, gross: grossNum };
}

function addToVatBreakdown(breakdown, { category, net, vat, gross }) {
  const b = breakdown || emptyVatBreakdown();
  const cat = normalizeVatCategory(category);
  b[cat].net = Math.round((b[cat].net + net) * 100) / 100;
  b[cat].vat = Math.round((b[cat].vat + vat) * 100) / 100;
  b[cat].gross = Math.round((b[cat].gross + gross) * 100) / 100;
  return b;
}

function computeItemsVat(items, defaultCategory = "A") {
  let breakdown = emptyVatBreakdown();
  let totalGross = 0;
  let totalNet = 0;
  let totalVat = 0;

  for (const item of items || []) {
    const qty = Number(item.quantity) || 1;
    const price = Number(item.price) || 0;
    const gross = qty * price;
    const cat = normalizeVatCategory(item.vat_category || defaultCategory);
    const split = splitGrossByCategory(gross, cat);
    breakdown = addToVatBreakdown(breakdown, split);
    totalGross += split.gross;
    totalNet += split.net;
    totalVat += split.vat;
  }

  return {
    breakdown,
    totalGross: Math.round(totalGross * 100) / 100,
    totalNet: Math.round(totalNet * 100) / 100,
    totalVat: Math.round(totalVat * 100) / 100,
  };
}

function sumVatBreakdowns(list) {
  let breakdown = emptyVatBreakdown();
  let totalGross = 0;
  let totalNet = 0;
  let totalVat = 0;
  for (const row of list || []) {
    const b = row?.vat_breakdown || row?.breakdown || {};
    for (const k of VAT_KEYS) {
      if (!b[k]) continue;
      breakdown[k].net += Number(b[k].net) || 0;
      breakdown[k].vat += Number(b[k].vat) || 0;
      breakdown[k].gross += Number(b[k].gross) || 0;
    }
    totalGross += Number(row.total_gross ?? row.total) || 0;
    totalNet += Number(row.total_net) || 0;
    totalVat += Number(row.total_vat) || 0;
  }
  for (const k of VAT_KEYS) {
    breakdown[k].net = Math.round(breakdown[k].net * 100) / 100;
    breakdown[k].vat = Math.round(breakdown[k].vat * 100) / 100;
    breakdown[k].gross = Math.round(breakdown[k].gross * 100) / 100;
  }
  return {
    breakdown,
    totalGross: Math.round(totalGross * 100) / 100,
    totalNet: Math.round(totalNet * 100) / 100,
    totalVat: Math.round(totalVat * 100) / 100,
  };
}

module.exports = {
  VAT_CATEGORIES,
  VAT_KEYS,
  emptyVatBreakdown,
  normalizeVatCategory,
  splitGrossByCategory,
  computeItemsVat,
  sumVatBreakdowns,
};
