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
assert.ok(js.includes("onSseDisconnected"), "SSE drop → reconnecting pa skanim automatik");
assert.ok(js.includes('setUi("reconnecting")'), "reconnecting UI");

const lanJs = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "lan-status-indicator.js"),
  "utf8",
);
assert.ok(lanJs.includes("isLanConnected"), "LanStatus.isLanConnected");
assert.ok(lanJs.includes("lan-status-dot"), "lan-status-dot");

const sseJs = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "local-staff-events.js"),
  "utf8",
);
assert.ok(sseJs.includes("onSseDisconnected"), "SSE mos discoverPos direkt");
assert.ok(sseJs.includes("fallbackIntervalMs"), "fallbackIntervalMs LAN");
assert.ok(sseJs.includes("RECONNECT_MS_MAX"), "SSE backoff max 30s");
assert.ok(sseJs.includes("scheduleReconnect"), "SSE exponential backoff");
assert.ok(
  !sseJs.match(/es\.onerror[\s\S]{0,500}discoverPos/),
  "SSE onerror mos thërras discoverPos direkt",
);
assert.ok(
  js.includes("probeServerInfo(origin, 2000)"),
  "SSE drop: health 2s para discovery",
);

console.log("ok - staff-auto-connect policy\n");
