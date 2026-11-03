"use strict";

const assert = require("assert");
const staff = require("../cloud-staff-access");

assert.strictEqual(staff.STAFF_CLOUD_FEATURES_DISABLED, false);
assert.strictEqual(staff.isStaffCloudFeaturesDisabled(), false);
assert.strictEqual(staff.allowPosOutboundSalesSync(), true);
assert.strictEqual(staff.isCloudEnabledForSession({ role: "kamarier" }), true);
assert.strictEqual(staff.isCloudEnabledForSession({ role: "admin" }), true);

const fs = require("fs");
const path = require("path");
const uiOff = fs.readFileSync(path.join(__dirname, "..", "public", "js", "staff-cloud-disabled.js"), "utf8");
assert.ok(uiOff.includes("STAFF_CLOUD_FEATURES_OFF = false"));
assert.ok(!uiOff.includes("STAFF_CLOUD_FEATURES_OFF = true"));
const waiterHtml = fs.readFileSync(path.join(__dirname, "..", "public", "waiter.html"), "utf8");
const recepHtml = fs.readFileSync(path.join(__dirname, "..", "public", "recepcion.html"), "utf8");
assert.ok(!waiterHtml.includes("staff-cloud-ui-off"));
assert.ok(!recepHtml.includes("staff-cloud-ui-off"));
const watcherSrc = fs.readFileSync(path.join(__dirname, "..", "online-orders-watcher.js"), "utf8");
assert.ok(/function isCloudWaiterDisabled\(db\) \{\s*return false;\s*\}/.test(watcherSrc));
const autoSrc = fs.readFileSync(path.join(__dirname, "..", "cloud-auto-sync.js"), "utf8");
assert.ok(/function isCloudWaiterDisabled\(db\) \{\s*return false;\s*\}/.test(autoSrc));

const serverPath = require("path").join(__dirname, "..", "server.js");
const serverSrc = require("fs").readFileSync(serverPath, "utf8");
assert.ok(
  serverSrc.includes("pushWaiterOrderToCloudBackground"),
  "server si KAFENE — push porosi në cloud",
);
assert.ok(
  !serverSrc.includes("pos-cloud-bridge"),
  "pa pos-cloud-bridge — arkitekturë KAFENE",
);

console.log("cloud-staff-owner-sync.test.js OK");
