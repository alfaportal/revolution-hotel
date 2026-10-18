"use strict";

/**
 * Parity BIZNES: çdo printFiscalReportText për raporte fiskale duhet reportDetails (+ QR/logo/e-kuponi).
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const serverPath = path.join(__dirname, "..", "server.js");
const src = fs.readFileSync(serverPath, "utf8");

const mustHaveReportDetails = [
  "/api/fiscal/x-report",
  "/api/staff/fiscal/z-report",
  "postFiscalZReportHandler",
  "/api/fiscal/periodic-report",
  "/api/admin/reports/fiscal-x/print",
  "/api/admin/reports/fiscal-periodic/print",
  "/api/admin/reports/daily-summary/print",
  "/api/fiscal/short-periodic-report",
  "/api/fiscal/monthly-memory-report",
];

for (const marker of mustHaveReportDetails) {
  const idx = src.indexOf(marker);
  assert.ok(idx >= 0, `mungon marker: ${marker}`);
  const slice = src.slice(idx, idx + 3500);
  assert.ok(
    slice.includes("reportDetails"),
    `${marker}: printFiscalReportText pa reportDetails`,
  );
}

console.log("ok - fiscal report print wiring (reportDetails)\n");
