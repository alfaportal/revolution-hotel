/**
 * Verifikim i shpejtë — link personal kamarier (vetëm Paketa 4).
 * Përdorimi: node scripts/verify-paketa4-kds.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const VERSION = require(path.join(root, "version-config.js"));
const { buildWaiterPersonalUrl } = require(path.join(root, "cloud-server-url.js"));
const adminHtml = readFileSync(path.join(root, "public", "admin.html"), "utf8");
const serverJs = readFileSync(path.join(root, "server.js"), "utf8");

assert.equal(VERSION.packageTier, "pako_5", "package-tier duhet Paketa 4 (pako_5)");
assert.equal(VERSION.packageLabel, "4", "packageLabel duhet 4");

const url = buildWaiterPersonalUrl("demo-kafe", "kk-123", "wt-abc");
assert.match(url, /\/waiter\//, "URL kamarieri duhet /waiter/");
assert.match(url, /[?&]key=/, "URL kamarieri duhet key=");
assert.match(url, /[?&]w=wt-abc/, "URL kamarieri duhet w=token");
assert.equal(buildWaiterPersonalUrl("", "k", "t"), "", "URL bosh pa slug");

assert.match(adminHtml, /id="staff-modal-copy-waiter"/, "admin.html: butoni Kopjo");
assert.doesNotMatch(adminHtml, /Kopjo KDS/, "admin.html: pa Kopjo KDS");
assert.match(adminHtml, /id="staff-modal-waiter-block"/, "admin.html: blloku linku kamarier");
assert.match(adminHtml, /staff-modal-waiter-url/, "admin.html: fusha linku kamarier");
assert.match(adminHtml, /async function hapModalStafit/, "admin.html: rifreskim staff para modalit");

assert.match(serverJs, /function canShowKdsStaffLinks\(\)/, "server: canShowKdsStaffLinks");
assert.match(serverJs, /function resolveStaffWaiterUrl/, "server: resolveStaffWaiterUrl");
assert.match(serverJs, /buildWaiterPersonalUrl/, "server: buildWaiterPersonalUrl");

console.log("✔ verify-paketa4-kds — OK");
console.log("  Shembull URL:", url);
