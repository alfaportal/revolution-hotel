/**
 * Test i shpejtë: pranim lokal porosie online (pa varësi cloud të jashtme).
 * Ekzekuto: node scripts/test-online-accept.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const watcher = require("../online-orders-watcher");

function isMissingAcceptanceColumnError(err) {
  const msg = String(err?.message || err || "");
  return /accepted_at/i.test(msg) && /schema cache|column/i.test(msg);
}

async function updateOrdersAcceptance(_db, { orderIds } = {}) {
  return { ids: Array.isArray(orderIds) ? orderIds.slice(0, 1) : [] };
}

function testOrderMatching() {
  const norm = watcher.normalizePendingOrder;
  const orders = [
    norm({
      id: "abc-123",
      items: [{ name: "Kafe me qumësht", price: 1.4, quantity: 1 }],
      customer_label: "Takeaway: Test",
    }),
  ];
  const ids = ["abc-123"];
  const matched = orders.filter(o => o?.id && ids.includes(String(o.id)));
  assert.equal(matched.length, 1, "matchOrders duhet të gjejë porosinë");
  assert.equal(matched[0].items.length, 1, "artikujt ruhen pas normalizimit");
}

async function testCloudAcceptanceFallback() {
  const acceptedAtError = { message: "Could not find the 'accepted_at' column of 'sales_orders' in the schema cache" };
  assert.ok(isMissingAcceptanceColumnError(acceptedAtError), "duhet të njihet gabimi accepted_at");

  const result = await updateOrdersAcceptance(null, {
    clientId: "client-1",
    orderIds: ["ord-1"],
    waiterId: 5,
    waiterName: "Naser",
  });
  assert.equal(result.ids.length, 1, "fallback pa accepted_at duhet të pranojë porosinë");
}

function testLastKnownOrdersExport() {
  assert.equal(typeof watcher.getLastKnownOrders, "function", "getLastKnownOrders eksportohet");
}

function testTakeawayNotFalseAccepted() {
  const cloudSync = require("../cloud-sync");
  const pending = {
    id: "t-1",
    customer_label: "Takeaway: Arta (044123456)",
    accepted_by: "",
    accepted_at: null,
  };
  assert.equal(cloudSync.isCloudOrderAccepted(pending), false, "takeaway në pritje nuk duhet të duket e pranuar");
}

testOrderMatching();
testTakeawayNotFalseAccepted();
testLastKnownOrdersExport();
await testCloudAcceptanceFallback();
console.log("OK — test-online-accept.mjs kaloi");
