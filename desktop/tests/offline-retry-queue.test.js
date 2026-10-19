"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const js = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "offline-retry-queue.js"),
  "utf8",
);

assert.ok(js.includes("pending_orders"), "LS pending_orders");
assert.ok(js.includes("pending_order_actions"), "LS pending_order_actions");
assert.ok(js.includes("processQueue"), "processQueue");
assert.ok(js.includes("getPendingCount"), "getPendingCount");
assert.ok(js.includes("MAX_AGE_MS"), "expiry 2h");
assert.ok(js.includes("/api/orders"), "retry order send");
assert.ok(js.includes("online-orders/accept"), "retry accept");
assert.ok(js.includes("staff-lan-status-changed"), "hook LAN reconnect");

console.log("ok - offline-retry-queue\n");
