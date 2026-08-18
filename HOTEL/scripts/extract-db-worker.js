const fs = require("fs");
const path = require("path");

const srcPath = path.join(__dirname, "..", "database.js");
const destPath = path.join(__dirname, "..", "db-rpc-worker.js");
const src = fs.readFileSync(srcPath, "utf8");
const lines = src.split(/\n/);

let startLine = -1;
let endLine = -1;
for (let n = 0; n < lines.length; n++) {
  if (lines[n].startsWith("if (!isMainThread) {")) startLine = n;
  if (
    startLine >= 0 &&
    n > startLine &&
    lines[n].startsWith("} else {") &&
    lines[n + 1] &&
    lines[n + 1].includes("syncSab")
  ) {
    endLine = n;
    break;
  }
}

if (startLine < 0 || endLine < 0) {
  console.error("markers not found", startLine, endLine);
  process.exit(1);
}

const body = lines.slice(startLine + 1, endLine).join("\n");
const out =
  `"use strict";
/**
 * SQL RPC worker — skedar i veçantë (asarUnpack).
 * Mos require database.js nga Worker (ngrin Electron e paketu).
 */
const fs = require("fs");
const path = require("path");
const { parentPort, workerData } = require("worker_threads");
let VERSION = { defaultCategories: ["Pije", "Ushqim", "Të tjera"] };
try {
  VERSION = require("./version-config");
} catch (_) {}
` +
  body +
  "\n";

fs.writeFileSync(destPath, out);
console.log("OK", destPath, "lines", startLine + 2, "-", endLine, "bytes", out.length);
