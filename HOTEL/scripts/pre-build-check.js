"use strict";

/**
 * Runs tests/protected-functions.test.js before every `npm run build`.
 * If any protected-function test fails, the build stops (non-zero exit).
 * See ../PROTECTED-FUNCTIONS.md for what's covered and why.
 */

const path = require("path");
const { spawnSync } = require("child_process");

const hotelDir = path.join(__dirname, "..");
const testFile = path.join(hotelDir, "tests", "protected-functions.test.js");

console.log("[pre-build] Duke testuar funksionet e mbrojtura (PROTECTED-FUNCTIONS.md)...");

const result = spawnSync(process.execPath, [testFile], {
  stdio: "inherit",
  cwd: hotelDir,
});

if (result.error) {
  console.error("[pre-build] Nuk u ekzekutuan testet:", result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error("");
  console.error("[pre-build] ✗ Testet e funksioneve të mbrojtura DËSHTUAN — build u ndal.");
  console.error("[pre-build] Lexo HOTEL/PROTECTED-FUNCTIONS.md para se të prekësh kodin e mbrojtur.");
  process.exit(result.status || 1);
}

console.log("[pre-build] ✓ Testet e funksioneve të mbrojtura kaluan.\n");
