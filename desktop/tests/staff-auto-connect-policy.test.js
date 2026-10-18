"use strict";

/**
 * Politika staff-auto-connect: loopback = pa skanim; mesazh LAN/Wi‑Fi.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const js = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "staff-auto-connect.js"),
  "utf8",
);

assert.ok(js.includes("isLoopbackPos"), "isLoopbackPos");
assert.ok(js.includes("shouldRunNetworkDiscovery"), "shouldRunNetworkDiscovery");
assert.ok(
  js.includes("LAN ose Wi"),
  "mesazh LAN/Wi‑Fi, jo vetëm Wi‑Fi",
);
assert.ok(
  !js.includes("!res.ok") || !js.match(/!res\.ok[\s\S]{0,80}discoverPos/),
  "mos nis discoverPos për çdo HTTP error",
);
assert.ok(js.includes("isLikelyNetworkFailure"), "vetëm dështime rrjeti në fetch wrap");

console.log("ok - staff-auto-connect policy\n");
