"use strict";

/**
 * Kontroll para build: package.json i plotë, burimi jo i ofuskuar gabimisht,
 * çdo require("./…") root i nevojshëm është në build.files.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BACKUP_DIR = path.join(ROOT, ".build-source-backup");

const ENTRY_FILES = [
  "main.js",
  "server.js",
  "database.js",
  "preload.js",
  "license.js",
  "cloud-sync.js",
  "cloud-auto-sync.js",
  "owner-report-snapshot.js",
  "owner-report-sync.js",
  "hotel-cloud-sync.js",
  "local-staff-links.js",
];

function fail(msg) {
  console.error("\n[pre-build] ✗ " + msg);
  process.exit(1);
}

function readPkg() {
  const pkgPath = path.join(ROOT, "package.json");
  let raw;
  try {
    raw = fs.readFileSync(pkgPath, "utf8");
  } catch (e) {
    fail("Nuk lexohet package.json: " + (e.message || e));
  }
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    fail("package.json nuk është JSON i vlefshëm — rikthe nga git (git checkout HEAD -- package.json).");
  }
  return pkg;
}

function assertPackageJsonComplete(pkg) {
  if (!pkg.scripts || typeof pkg.scripts !== "object" || !pkg.scripts.build) {
    fail(
      "package.json nuk ka scripts.build — Setup do dështojë. Rikthe skedarin e plotë nga git.",
    );
  }
  if (!pkg.build || !Array.isArray(pkg.build.files) || pkg.build.files.length < 10) {
    fail(
      "package.json nuk ka build.files (whitelist) — Setup do jetë i paplotë. Rikthe nga git.",
    );
  }
}

function assertNoStaleBuildBackup() {
  if (!fs.existsSync(BACKUP_DIR)) return;
  fail(
    "Ekziston .build-source-backup/ — një build u ndal në mes. " +
      "Rikthe: kopjo .build-source-backup/package.json → package.json, pastaj fshi .build-source-backup/ me leje të Naserit.",
  );
}

function looksObfuscatedSource(abs) {
  try {
    const head = fs.readFileSync(abs, "utf8").slice(0, 800);
    if (/^\/\*\*/.test(head.trim()) || /^\/\//.test(head.trim()) || /^"use strict"/.test(head.trim())) {
      return false;
    }
    if (/const _0x[a-f0-9]+=/.test(head) && head.length > 400 && !head.includes("function pushSale")) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function assertSourceNotObfuscated() {
  const critical = ["cloud-sync.js", "server.js", "database.js"];
  for (const name of critical) {
    const abs = path.join(ROOT, name);
    if (!fs.existsSync(abs)) continue;
    if (looksObfuscatedSource(abs)) {
      fail(
        `${name} duket i ofuskuar në burim (jo në .protected-build). ` +
          "Rikthe nga git: git checkout HEAD -- " + name,
      );
    }
  }
}

function globMatch(fileRel, pattern) {
  const norm = fileRel.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");
  if (pat === norm) return true;
  if (pat.endsWith("/**/*")) {
    const prefix = pat.slice(0, -5);
    return norm === prefix || norm.startsWith(prefix + "/");
  }
  if (pat.endsWith("/**")) {
    const prefix = pat.slice(0, -3);
    return norm === prefix || norm.startsWith(prefix + "/");
  }
  if (pat.startsWith("!")) return false;
  if (pat.includes("*")) {
    const re = new RegExp(
      "^" +
        pat
          .replace(/\./g, "\\.")
          .replace(/\*\*/g, "§§")
          .replace(/\*/g, "[^/]*")
          .replace(/§§/g, ".*") +
        "$",
    );
    return re.test(norm);
  }
  return false;
}

function isPackagedByFiles(fileRel, filesPatterns) {
  const norm = fileRel.replace(/\\/g, "/");
  for (const p of filesPatterns) {
    if (String(p).startsWith("!")) continue;
    if (globMatch(norm, String(p))) return true;
  }
  return false;
}

function collectRootRequires(fromFile, seen, out) {
  const abs = path.join(ROOT, fromFile);
  if (!fs.existsSync(abs) || seen.has(fromFile)) return;
  seen.add(fromFile);
  let text;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return;
  }
  const re = /require\s*\(\s*["'](\.\/[^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(text))) {
    let spec = m[1];
    if (spec.startsWith("./")) spec = spec.slice(2);
    if (spec.includes("/")) {
      if (spec.startsWith("fiscal/") || spec.startsWith("ai/") || spec.startsWith("lib/")) {
        /* mbulohen me fiscal/** ai/** lib/** */
      }
      continue;
    }
    let rel = spec.endsWith(".js") ? spec : spec + ".js";
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    out.add(rel.replace(/\\/g, "/"));
    collectRootRequires(rel, seen, out);
  }
}

function assertRootRequiresInFiles(pkg) {
  const files = pkg.build.files || [];
  const needed = new Set();
  const seen = new Set();
  for (const entry of ENTRY_FILES) {
    if (fs.existsSync(path.join(ROOT, entry))) {
      collectRootRequires(entry, seen, needed);
    }
  }
  const missing = [];
  for (const rel of [...needed].sort()) {
    if (!isPackagedByFiles(rel, files)) missing.push(rel);
  }
  if (missing.length) {
    fail(
      "Këto skedarë root kërkohen nga require() por NUK janë në build.files:\n  " +
        missing.join("\n  ") +
        "\nShtoji në package.json → build.files para build-it.",
    );
  }
  console.log(
    "[pre-build] ✓ " + needed.size + " module root në build.files (require audit).",
  );
}

function assertExplicitFilesExist(pkg) {
  const files = pkg.build.files || [];
  const missing = [];
  for (const p of files) {
    if (String(p).startsWith("!")) continue;
    if (p.includes("*")) continue;
    const abs = path.join(ROOT, p);
    if (!fs.existsSync(abs)) missing.push(p);
  }
  if (missing.length) {
    fail(
      "build.files liston skedarë që mungojnë në disk:\n  " + missing.slice(0, 15).join("\n  "),
    );
  }
}

function runBuildManifestValidation(options = {}) {
  const skipBackupCheck = !!options.skipBackupCheck;
  if (!skipBackupCheck) assertNoStaleBuildBackup();
  const pkg = readPkg();
  assertPackageJsonComplete(pkg);
  assertSourceNotObfuscated();
  assertExplicitFilesExist(pkg);
  assertRootRequiresInFiles(pkg);
  return pkg;
}

module.exports = { runBuildManifestValidation };

if (require.main === module) {
  runBuildManifestValidation();
}
