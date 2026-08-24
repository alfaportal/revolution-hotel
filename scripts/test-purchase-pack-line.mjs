/**
 * Test: PAKO × SASIA = stok; Total = PAKO × Çmim/pako; çmim/copë = Çmim/pako ÷ SASIA
 */
function stockQty(pack_qty, pieces_per_pack) {
  const packs = Number(pack_qty);
  const ppp = Number(pieces_per_pack);
  if (!Number.isFinite(packs) || !Number.isFinite(ppp) || ppp <= 0) return 0;
  return Math.round(packs * ppp * 1000) / 1000;
}
function unitPrice(pack_price, pieces_per_pack) {
  const ppp = Number(pieces_per_pack);
  const packPrice = Number(pack_price) || 0;
  if (!Number.isFinite(ppp) || ppp <= 0) return packPrice;
  return Math.round((packPrice / ppp) * 10000) / 10000;
}
function lineTotal(pack_qty, pack_price) {
  return Math.round((Number(pack_qty) || 0) * (Number(pack_price) || 0) * 100) / 100;
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else console.log("OK:", msg);
}

// 2 pako × 24 copë = 48 stok; 2 × 12€ = 24€; çmim/copë = 0.5
assert(stockQty(2, 24) === 48, "2×24 = 48 copë stok");
assert(lineTotal(2, 12) === 24, "2×12€ = 24€ total");
assert(unitPrice(12, 24) === 0.5, "12€/24 = 0.5€/copë");
assert(Math.round(stockQty(2, 24) * unitPrice(12, 24) * 100) / 100 === 24, "stok×çmim/copë = total");

// çmim i lirë me decimal
assert(lineTotal(1, 1.25) === 1.25, "çmim 1.25 i lirë");
assert(unitPrice(1.25, 5) === 0.25, "1.25/5 = 0.25");

// 1 pako, 1 sasí
assert(stockQty(1, 1) === 1, "1×1 = 1");

if (failed) {
  console.error("\n" + failed + " dështuan");
  process.exit(1);
}
console.log("\nTë gjitha OK");
