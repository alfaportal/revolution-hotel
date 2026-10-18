"use strict";

const assert = require("assert");
const staff = require("../cloud-staff-access");

assert.strictEqual(staff.STAFF_CLOUD_FEATURES_DISABLED, false);
assert.strictEqual(staff.isStaffCloudFeaturesDisabled(), false);
assert.strictEqual(staff.allowPosOutboundSalesSync(), true);
assert.strictEqual(staff.isCloudEnabledForSession({ role: "kamarier" }), true);
assert.strictEqual(staff.isCloudEnabledForSession({ role: "admin" }), true);

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
