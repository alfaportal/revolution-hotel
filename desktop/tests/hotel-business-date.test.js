"use strict";

const assert = require("assert");
const {
  businessYmd,
  businessYesterdayYmd,
  addBusinessDays,
  BUSINESS_TZ,
} = require("../lib/hotel-business-date");

console.log("hotel-business-date.test.js");

assert.strictEqual(BUSINESS_TZ, "Europe/Belgrade");

/** 00:30 Kosovë ≈ 22:30 UTC ditën e mëparshme (CEST +2). */
const at0030Kosovo = new Date("2026-10-10T22:30:00.000Z");
assert.strictEqual(businessYmd(at0030Kosovo), "2026-10-11");
assert.strictEqual(businessYesterdayYmd(at0030Kosovo), "2026-10-10");

assert.strictEqual(addBusinessDays("2026-10-11", -1), "2026-10-10");
assert.strictEqual(addBusinessDays("2026-10-11", 1), "2026-10-12");

console.log("OK — business day Belgrade @ 00:30 sim");
