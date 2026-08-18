/**
 * Kopjon app-in në .protected-build, obfuskon JS, pastaj (opsionale) electron-builder.
 * Përdorimi:
 *   node scripts/obfuscate-build.mjs HOTEL
 *   node scripts/obfuscate-build.mjs HOTEL --prepare-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";
import JavaScriptObfuscator from "javascript-obfuscator";

const require = createRequire(import.meta.url);
const { cleanDistBeforeBuild, finalizeDistDelivery } = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "build-deliver.js"),
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const appName = process.argv[2] || "HOTEL";
const prepareOnly = process.argv.includes("--prepare-only");
/** Vetëm staging i brendshëm — NUK shkon në Desktop / USB klienti. */
const portableInternal = process.argv.includes("--portable-internal");
const appDir = path.join(root, appName);
const outDir = path.join(appDir, ".protected-build");

/** Të gjithë JS që dërgohen në instalues (build.files + public/js). */
const OBFUSCATE_FILES = [
  // main.js — JO obfuscation (entry async whenReady; pa Worker freeze)
  "server.js",
  "database.js",
  "printer.js",
  "fiscal-register.js",
  // fiscal-db.js — JO obfuscation (CREATE TABLE + WRITE-ONCE)
  // fiscal-self-test.js — JO obfuscation (thirr fiscalReceiptUpdate; bracket/transform e prish)
  "fiscal/fiscal-config.js",
  "fiscal/fiscal-vat.js",
  "fiscal/fiscal-payment.js",
  "fiscal/fiscal-numbering.js",
  "fiscal/fiscal-print.js",
  "fiscal/fiscal-receipt-guard.js",
  "fiscal/fiscal-logo.js",
  "fiscal/fiscal-correction.js",
  "fiscal/fiscal-crypto.js",
  "fiscal/fiscal-qr.js",
  "fiscal/fiscal-offline.js",
  "fiscal/fiscal-audit.js",
  "fiscal/fiscal-i18n.js",
  "fiscal/fiscal-receipts-list.js",
  "fiscal/fiscal-main.js",
  "fiscal/atk-model-builder.js",
  "fiscal/license-guard.js",
  "license.js",
  "integrity-check.js",
  "security-alert.js",
  "package-tier-map.js",
  "business-types/hospitality/hospitality-config.js",
  "ai/ai-config.js",
  "ai/ai-receipt-scan.js",
  "ai/ai-waiter-rating.js",
  "ai/ai-stock-predict.js",
  "ai/ai-weekly-report.js",
  "ai/ai-assistant.js",
  "ai/ai-token-billing.js",
  "ai/ai-admin-dashboard.js",
  "cloud-sync.js",
  "cloud-auto-sync.js",
  "cloud-health.js",
  "cloud-failure-log.js",
  "receipt-print.js",
  "receipt-text.js",
  "receipt-html.js",
  "close-table-print.js",
  "waiter-shift-html.js",
  "shift-report-html.js",
  "kitchen-ticket-html.js",
  "menu-groups.js",
  "print-routing.js",
  "cloud-server-url.js",
  "online-orders-watcher.js",
  "register-mode.js",
  "ditari-report.js",
  "export-print-html.js",
  "purchase-print-html.js",
  "purchase-cloud-pull.js",
  "purchase-pack-math.js",
  "kontabilisti-html.js",
  "kontabilisti-atk.js",
  "kontabilisti-excel.js",
  "kontabilisti-pdf.js",
  "table-qr-service.js",
  "hotel-qr-service.js",
  "reservation-sync.js",
  "promotion-service.js",
  "menu-stock-photos.js",
  "service-stock-photos.js",
  "barcode-lookup.js",
  "ai-cloud.js",
  "shift-close-email.js",
  "version-config.js",
  "package-tier.js",
  "region-config.js",
  "i18n.js",
  "locales/fr-map.js",
  "app.js",
  "public/js/app.js",
  "public/js/i18n-client.js",
  "public/js/cloud-status.js",
  "public/js/menu-pos.js",
  "public/js/order-alarm-sound.js",
  "public/js/waiter-calculator.js",
  "public/js/fiscal-payment-modal.js",
  "public/js/fiscal-offline-status.js",
  "public/js/kontabilisti-atk-ui.js",
];

/** Skedarë që DUHEN të mbeten të lexueshëm (SQL/fiscal write-once / self-test / entry). */
const NEVER_OBFUSCATE = new Set([
  "fiscal-db.js",
  "fiscal-self-test.js",
  // DB in-process + entry async whenReady — mos e ofusko
  "database.js",
  "db-engine.js",
  "db-crypto.js",
  "hotel-backup.js",
  "disk-monitor.js",
  "main.js",
]);

const OBFUSCATE_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.85,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.25,
  identifierNamesGenerator: "hexadecimal",
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  debugProtection: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ["base64", "rc4"],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.9,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  target: "node",
  seed: 0x4b414645,
  reservedNames: [
    "^require$",
    "^module$",
    "^exports$",
    "^__dirname$",
    "^__filename$",
    "^__scheduleFactoryResetRelaunch$",
    // Fiscal cross-module API (transformObjectKeys + per-file obfuscation)
    "^fiscalReceiptUpdate$",
    "^deleteTestFiscalReceipts$",
    "^initFiscalDB$",
    "^generateFiscalQR$",
    "^buildQrPayload$",
    "^printFiscalBundle$",
    "^signReceipt$",
    "^generateNUIKF$",
    "^generateFiscalReceipt$",
    "^validateReceiptBeforePrint$",
    "^assertGeneratedReceiptText$",
    "^RECEIPT_FORMAT_HASH$",
    "^logFiscalAction$",
    "^runFiscalSelfTest$",
    "^runFiscalSelfTestBattery$",
  ],
  reservedStrings: [
    "startOnlineOrdersWatcher",
    "stopOnlineOrdersWatcher",
    "getOnlineOrdersSnapshot",
    "getSnapshot",
    "refreshOnlineOrders",
    "persistAcknowledged",
    // Factory reset — must match across main.js / server.js / license.js after separate obfuscation
    "__scheduleFactoryResetRelaunch",
    "factory-reset-pending",
    "/api/admin/factory-reset",
    "force_factory_reset",
    "force_factory_reset_at",
    "ack-factory-reset",
    "RIVENDOS",
    "HOTEL_FACTORY_RESET_AT",
    "RevolutionInvest",
    // Fiscal exports — duhet të përputhen mes skedarëve të obfuscuar veç e veç
    "fiscalReceiptUpdate",
    "deleteTestFiscalReceipts",
    "initFiscalDB",
    "getFiscalDbPath",
    "RECEIPT_UPDATE_ALLOWED",
    "generateFiscalQR",
    "buildQrPayload",
    "printFiscalBundle",
    "signReceipt",
    "generateNUIKF",
    "generateFiscalReceipt",
    "validateReceiptBeforePrint",
    "assertGeneratedReceiptText",
    "RECEIPT_FORMAT_HASH",
    "logFiscalAction",
    "runFiscalSelfTest",
    "runFiscalSelfTestBattery",
    "sent_to_atk",
    "sent_at",
    "atk_response_json",
    "WRITE-ONCE",
  ],
};

function copyRecursive(src, dest, skip = new Set()) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (skip.has(path.basename(src))) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry), skip);
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function obfuscateFile(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATE_OPTIONS);
  fs.writeFileSync(filePath, result.getObfuscatedCode(), "utf8");
}

function collectJsFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "build") continue;
      collectJsFiles(p, base, out);
      continue;
    }
    if (!name.endsWith(".js")) continue;
    if (NEVER_OBFUSCATE.has(name)) continue;
    out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

/** Hiq komente HTML + sourceMappingURL nga public (UI mbetet funksional). */
function hardenPublicAssets(dir) {
  const publicDir = path.join(dir, "public");
  if (!fs.existsSync(publicDir)) return;
  function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      const lower = name.toLowerCase();
      if (lower.endsWith(".html") || lower.endsWith(".htm")) {
        let html = fs.readFileSync(p, "utf8");
        const before = html.length;
        html = html.replace(/<!--[\s\S]*?-->/g, "");
        html = html.replace(/\/\/# sourceMappingURL=.*$/gm, "");
        if (html.length !== before) {
          fs.writeFileSync(p, html, "utf8");
          console.log("  ✓ harden html:", path.relative(dir, p));
        }
      } else if (lower.endsWith(".js")) {
        let js = fs.readFileSync(p, "utf8");
        const next = js.replace(/\/\/# sourceMappingURL=.*$/gm, "");
        if (next !== js) fs.writeFileSync(p, next, "utf8");
      }
    }
  }
  console.log("Harden public HTML/JS (pa source maps / komente)...");
  walk(publicDir);
}

function rimraf(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Instaluesit e vjetër (Setup X.exe) — ruhen për rollback, nuk fshihen nga build i ri. */
function isPreservedInstaller(name) {
  return name.includes(" Setup ") && (name.endsWith(".exe") || name.endsWith(".exe.blockmap"));
}

function installerVersion(name) {
  const m = String(name || "").match(/ Setup (\d+\.\d+\.\d+)\./);
  return m ? m[1] : null;
}

function listPreservedInstallers(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(isPreservedInstaller);
}

function backupPreservedInstallers(srcDir, backupDir) {
  rimraf(backupDir);
  const names = listPreservedInstallers(srcDir);
  if (!names.length) return [];
  fs.mkdirSync(backupDir, { recursive: true });
  for (const name of names) {
    fs.copyFileSync(path.join(srcDir, name), path.join(backupDir, name));
  }
  return names;
}

function restorePreservedInstallers(backupDir, destDir, currentVersion) {
  if (!fs.existsSync(backupDir)) return [];
  fs.mkdirSync(destDir, { recursive: true });
  const restored = [];
  for (const name of fs.readdirSync(backupDir)) {
    if (!isPreservedInstaller(name)) continue;
    const v = installerVersion(name);
    if (v && currentVersion && v === currentVersion) continue;
    fs.copyFileSync(path.join(backupDir, name), path.join(destDir, name));
    restored.push(name);
  }
  rimraf(backupDir);
  return restored;
}

/**
 * Shënues në dist/ — vetëm Setup. Folderi Electron i hapur NUK është dorëzim.
 */
function writeDistReadme(dir, version, setupName) {
  const lines = [
    "REVOLUTION HOTEL - INSTALUESI",
    "",
    `Versioni: ${version}`,
    `Ndertuar: ${new Date().toLocaleString("sq-AL")}`,
    "",
    `Kliko dy here: ${setupName}`,
    "Pas instalimit, ne Desktop del vetem ikona.",
    "Open file location = vetem Start.cmd.",
    "Folderi i vartet Program Files eshte i fshehur.",
    "",
    "MOS hap / mos shpërnda folderin me .dll (win-unpacked).",
    "Ai folder thyen mbrojtjen kunder vjedhjes.",
    "",
  ];
  try {
    fs.writeFileSync(path.join(dir, "LEXO-MUA.txt"), lines.join("\r\n"), "utf8");
  } catch {
    /* ignore */
  }
}

/** dist/ duhet të ketë vetëm Setup.exe (+ LEXO-MUA) — hiq DLL/Electron. */
function purgeOpenElectronFromDist(dir) {
  if (!fs.existsSync(dir)) return;
  const killExact = new Set([
    "locales",
    "resources",
    "chrome_100_percent.pak",
    "chrome_200_percent.pak",
    "d3dcompiler_47.dll",
    "dxcompiler.dll",
    "dxil.dll",
    "ffmpeg.dll",
    "icudtl.dat",
    "libEGL.dll",
    "libGLESv2.dll",
    "LICENSE.electron.txt",
    "LICENSES.chromium.html",
    "resources.pak",
    "snapshot_blob.bin",
    "v8_context_snapshot.bin",
    "vk_swiftshader.dll",
    "vk_swiftshader_icd.json",
    "vulkan-1.dll",
  ]);
  for (const name of fs.readdirSync(dir)) {
    if (name === "LEXO-MUA.txt") continue;
    if (/Setup/i.test(name) && name.endsWith(".exe")) continue;
    if (/Setup/i.test(name) && name.endsWith(".blockmap")) continue;
    if (killExact.has(name) || name.endsWith(".dll") || name.endsWith(".pak") || name.endsWith(".bin") || name.endsWith(".dat") || /\.exe$/i.test(name)) {
      try {
        fs.rmSync(path.join(dir, name), { recursive: true, force: true });
        console.log("  - hequr nga dist (jo dorëzim):", name);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Hiq README, .md, backup, salt scripts nga folderi i mbrojtur para asar. */
function stripSensitiveFromProtectedBuild(dir) {
  const killNames = new Set([
    "README.md",
    "README.txt",
    "CLAUDE.md",
    "PROTECTED-FUNCTIONS.md",
    "FISCAL-REQUIREMENTS.md",
    ".env",
    ".env.example",
    ".cursorrules",
  ]);
  const killExt = new Set([".md", ".map", ".ts", ".tsx"]);
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (name === "node_modules" || name === "dist") continue;
        walk(p);
        continue;
      }
      const ext = path.extname(name).toLowerCase();
      if (killNames.has(name) || killExt.has(ext)) {
        try {
          fs.unlinkSync(p);
          console.log("  − stripped:", path.relative(dir, p));
        } catch {
          /* ignore */
        }
      }
    }
  }
  console.log("Pastrim dokumentesh / burimi nga .protected-build...");
  walk(dir);
  // build/installer.nsh + hotel-lock.ps1 DUHEN në disk për electron-builder,
  // por nuk hyjnë në app.asar (shih package.json files: !build/*.ps1 / !build/*.nsh).
}

function prepareProtectedBuild() {
  if (!fs.existsSync(appDir)) {
    console.error("App folder nuk u gjet:", appDir);
    process.exit(1);
  }

  console.log(`\n🔒 Përgatit build të mbrojtur për ${appName}...\n`);

  rimraf(outDir);
  const skipDirs = new Set([
    "node_modules",
    "dist",
    "disthotel",
    "distkafe",
    ".protected-build",
    ".source-backup",
    ".dist-installers-backup",
    "tools",
    "tests",
    "usb-package",
    "veracrypt-deploy",
    "scripts",
    ".git",
  ]);
  copyRecursive(appDir, outDir, skipDirs);

  // Hiq dokumente / burim që nuk duhen në Setup (mbrojtje)
  stripSensitiveFromProtectedBuild(outDir);

  const builtVersion = JSON.parse(fs.readFileSync(path.join(outDir, "package.json"), "utf8")).version;
  fs.writeFileSync(path.join(outDir, "BUILD_VERSION.txt"), `${builtVersion}\n`, "utf8");
  console.log(`Build version: ${builtVersion}`);

  hardenPublicAssets(outDir);

  // Obfusko TË GJITHË JS në app (plus lista e njohur), përveç NEVER_OBFUSCATE
  const fromWalk = collectJsFiles(outDir);
  const fromList = OBFUSCATE_FILES.filter((rel) => fs.existsSync(path.join(outDir, rel)));
  const allJs = Array.from(new Set([...fromList, ...fromWalk])).sort();
  console.log(`Obfuskim i skedarëve JS (${allJs.length})...`);
  for (const rel of allJs) {
    const target = path.join(outDir, rel);
    if (!fs.existsSync(target)) {
      console.warn("  skip (mungon):", rel);
      continue;
    }
    if (NEVER_OBFUSCATE.has(path.basename(rel))) {
      console.log("  · leave clear:", rel);
      continue;
    }
    obfuscateFile(target);
    console.log("  ✓", rel);
  }

  console.log("\nInstalim node_modules në build...");
  // Duhet edhe electron (devDependency) — electron-builder kërkon version fikse të instaluar.
  execSync("npm install", { cwd: outDir, stdio: "inherit" });

  return builtVersion;
}

const builtVersion = prepareProtectedBuild();

if (prepareOnly) {
  console.log(`\n✅ Prepare-only: ${outDir} gati për electron-builder.\n`);
  process.exit(0);
}

/**
 * Dorëzim klienti = Setup NSIS.
 * Folderi Electron i hapur (DLL) NUK publikohet në dist/ Desktop.
 * Për staging të brendshëm: --portable-internal
 */
const distDest = path.join(root, "dist");
const appDistDest = path.join(appDir, "dist");
cleanDistBeforeBuild(appDistDest, "Revolution HOTEL");

rimraf(path.join(outDir, "dist"));

if (portableInternal) {
  console.log("\n📦 electron-builder (--portable-internal, JO për Desktop/USB)...\n");
  execSync("npx electron-builder --win --x64 --dir", { cwd: outDir, stdio: "inherit" });
  const EXE_NAME = "Revolution HOTEL.exe";
  const unpacked = path.join(outDir, "dist", "win-unpacked");
  const portableSrc = fs.existsSync(unpacked) ? unpacked : path.join(outDir, "dist");
  if (!fs.existsSync(path.join(portableSrc, EXE_NAME))) {
    console.error(`\n❌ Build i paplotë: mungon "${EXE_NAME}".`);
    process.exit(1);
  }
  const internalDest = path.join(root, ".portable-internal");
  rimraf(internalDest);
  copyRecursive(portableSrc, internalDest);
  console.log(`\n⚠️  Portable INTERNAL (JO dorëzim): ${internalDest}\\${EXE_NAME}`);
  console.log("   Për klientin: npm run build:hotel → Setup + Launch.\n");
} else {
  console.log("\n📦 electron-builder (NSIS Setup — dorëzim i mbrojtur)...\n");
  execSync("npx electron-builder --win nsis --x64", { cwd: outDir, stdio: "inherit" });

  const builderDist = path.join(outDir, "dist");
  const setups = fs.existsSync(builderDist)
    ? fs.readdirSync(builderDist).filter((n) => /Setup/i.test(n) && n.endsWith(".exe"))
    : [];
  if (!setups.length) {
    console.error("\n❌ Nuk u gjet Setup.exe — dist ekzistues NUK u prek me folder të hapur.");
    process.exit(1);
  }

  fs.mkdirSync(distDest, { recursive: true });
  fs.mkdirSync(appDistDest, { recursive: true });
  purgeOpenElectronFromDist(distDest);
  purgeOpenElectronFromDist(appDistDest);

  for (const name of setups) {
    fs.copyFileSync(path.join(builderDist, name), path.join(distDest, name));
    fs.copyFileSync(path.join(builderDist, name), path.join(appDistDest, name));
    console.log(`  ✓ Setup: ${name}`);
  }
  finalizeDistDelivery({
    distDir: appDistDest,
    projectId: "HOTEL",
    projectPrefix: "Revolution HOTEL",
  });
  writeDistReadme(distDest, builtVersion, setups[0]);
  writeDistReadme(appDistDest, builtVersion, setups[0]);
  console.log(`\n✅ Setup i mbrojtur gati (v${builtVersion}): ${path.join(distDest, setups[0])}`);
  console.log("   Pas instalimit: Desktop ikona → Start.cmd; Program Files i fshehur.\n");
}

console.log("\nPastrim .protected-build...");
rimraf(outDir);
console.log("Done.\n");
