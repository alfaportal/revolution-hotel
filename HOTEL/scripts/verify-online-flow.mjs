/**
 * Verifikon logjikën e porosive online (pa DB) — ekzekuto:
 *   node scripts/verify-online-flow.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cloudSync = require("../cloud-sync");
const watcher = require("../online-orders-watcher");

function isCustomerBarOrder(order) {
  const label = String(order?.waiter_name || order?.customer_label || "").trim();
  const device = String(order?.device_id || "").trim();
  return /takeaway|qr/i.test(label) || /^WEB-/i.test(device);
}

function isOrderAccepted(order) {
  if (order?.accepted_at) return true;
  if (String(order?.accepted_by_waiter_name || order?.accepted_by || "").trim()) return true;
  return false;
}

const takeawayPending = {
  id: "aaa-bbb",
  device_id: "WEB-PUBLIC",
  waiter_name: "Takeaway: Arta (044111222)",
  waiter_id: null,
  accepted_at: null,
  accepted_by_waiter_name: "",
  accepted_by_waiter_id: null,
};

const qrPending = {
  id: "ccc-ddd",
  device_id: "WEB-KIOSK",
  waiter_name: "QR · T3",
  waiter_id: null,
  accepted_at: null,
  accepted_by_waiter_name: "",
  accepted_by_waiter_id: null,
};

assert.ok(isCustomerBarOrder(takeawayPending), "takeaway është porosi banaku");
assert.ok(isCustomerBarOrder(qrPending), "QR është porosi banaku");
assert.equal(isOrderAccepted(takeawayPending), false, "takeaway e re nuk është e pranuar");
assert.equal(isOrderAccepted(qrPending), false, "QR e re nuk është e pranuar");

const takeawayFormatted = {
  id: takeawayPending.id,
  customer_label: takeawayPending.waiter_name,
  accepted_by: "",
  accepted_at: null,
  items: [{ name: "Kafe", price: 1, quantity: 1 }],
};
assert.equal(cloudSync.isCloudOrderAccepted(takeawayFormatted), false, "POS nuk e shënon takeaway si të pranuar");

const norm = watcher.normalizePendingOrder(takeawayFormatted);
assert.equal(norm.items.length, 1, "artikujt normalizohen");

console.log("OK — rrjedha takeaway + QR: hyrje → në pritje → alarm POS");
