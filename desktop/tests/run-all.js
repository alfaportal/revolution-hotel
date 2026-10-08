"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

/** Bazë → ATK → B2B → blerje/AI → factory reset */
const tests = [
  "protected-functions.test.js",
  "kontabilisti-atk.test.js",
  "hotel-b2b-kontabilist.test.js",
  "purchase-neto-bruto.test.js",
  "factory-reset-wipe.test.js",
];

let failed = 0;
console.log("\n=== HOTEL — Full test suite ===\n");

for (const file of tests) {
  console.log(`\n--- ${file} ---\n`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
    env: process.env,
  });
  if (r.status !== 0) failed += 1;
}

console.log(`\n=== Përfundim: ${tests.length - failed}/${tests.length} suite kaloi ===\n`);
process.exit(failed ? 1 : 0);
