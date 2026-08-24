#!/usr/bin/env node
/**
 * GJENERUESI I LICENCËS — VETËM PËR NASERIN
 *
 * Rrjedha:
 *   1. Klienti instalon → sheh HARDWARE_ID → ta dërgon Naserit
 *   2. Naseri: node tools/generate-license.js [HARDWARE_ID] [--type trial|annual]
 *   3. Naseri ia dërgon LICENSE_KEY klientit
 *   4. Klienti e fut → programi hapet
 *
 * Tipet:
 *   trial  — 7 ditë nga aktivizimi i parë (e njëjta Hardware ID nuk merr trial të dytë)
 *   annual — 1 vit nga sot (data e skadimit në çelës)
 *
 * MOS e kopjo në USB. MOS e përfshi në build (exclude tools).
 *
 * LICENSE_KEY: XXXX-XXXX-XXXX-XXXX (16 karaktere A-Z/0-9)
 */

const crypto = require("crypto");

/** I njëjti SECRET_SALT si në fiscal/license-guard.js (getSecretSalt). */
const SECRET_SALT = "HOTEL-HWLOCK-2026-NASER-9f4c2a7b";
const TRIAL_DAYS = 7;
const ANNUAL_DAYS = 365;

function normalizeHardwareId(input) {
  return String(input || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toUpperCase()
    .slice(0, 16);
}

function formatGrouped16(raw16) {
  const hex = String(raw16 || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .padEnd(16, "0")
    .slice(0, 16);
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

function toYmd(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function ymdToEndOfDayIso(ymd) {
  const s = String(ymd || "").replace(/\D/g, "");
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, day, 23, 59, 59, 999)).toISOString();
}

function annualExpiresYmdFromToday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ANNUAL_DAYS);
  return toYmd(d);
}

/**
 * @param {string} hardwareIdInput
 * @param {{ licenseType?: string }} [opts]
 * @returns {{ licenseKey: string, licenseType: string, expiresAt: string|null, expiresYmd: string|null, trialDays?: number }}
 */
function generateLicenseKey(hardwareIdInput, opts = {}) {
  const id = normalizeHardwareId(hardwareIdInput);
  if (id.length < 16) {
    throw new Error("HARDWARE_ID duhet të ketë 16 karaktere hex (formati XXXX-XXXX-XXXX-XXXX).");
  }
  const licenseType =
    String(opts.licenseType || opts.type || "annual")
      .trim()
      .toLowerCase() === "trial"
      ? "trial"
      : "annual";

  let material = id + SECRET_SALT;
  let expiresYmd = null;
  let expiresAt = null;

  if (licenseType === "trial") {
    material = id + SECRET_SALT + "|trial";
  } else {
    expiresYmd = annualExpiresYmdFromToday();
    material = id + SECRET_SALT + "|annual|" + expiresYmd;
    expiresAt = ymdToEndOfDayIso(expiresYmd);
  }

  const hash = crypto.createHash("sha256").update(material).digest("hex").toUpperCase();
  const licenseKey = formatGrouped16(hash.slice(0, 16));
  const out = {
    licenseKey,
    licenseType,
    expiresAt,
    expiresYmd,
  };
  if (licenseType === "trial") out.trialDays = TRIAL_DAYS;
  return out;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let hardwareId = null;
  let licenseType = "annual";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") return { help: true };
    if (a === "--type" || a === "-t") {
      licenseType = String(args[++i] || "").toLowerCase();
      continue;
    }
    if (a.startsWith("--type=")) {
      licenseType = a.slice("--type=".length).toLowerCase();
      continue;
    }
    if (!a.startsWith("-") && !hardwareId) {
      hardwareId = a;
    }
  }
  if (licenseType !== "trial" && licenseType !== "annual") {
    throw new Error("--type duhet të jetë trial ose annual.");
  }
  return { hardwareId, licenseType, help: false };
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (e) {
    console.error("[GABIM]", e.message || e);
    process.exit(1);
  }

  if (parsed.help || !parsed.hardwareId) {
    console.log("");
    console.log("Përdorimi: node tools/generate-license.js [HARDWARE_ID] [--type trial|annual]");
    console.log("Shembull:  node tools/generate-license.js A1B2-C3D4-E5F6-7890 --type trial");
    console.log("Shembull:  node tools/generate-license.js A1B2-C3D4-E5F6-7890 --type annual");
    console.log("");
    console.log("  trial  = 7 ditë nga aktivizimi");
    console.log("  annual = 1 vit nga sot (default)");
    console.log("");
    process.exit(parsed.help ? 0 : 1);
  }

  try {
    const normalized = normalizeHardwareId(parsed.hardwareId);
    const result = generateLicenseKey(normalized, { licenseType: parsed.licenseType });
    console.log("");
    console.log("================================");
    console.log("Revolution HOTEL — Hardware License");
    console.log("================================");
    console.log("HARDWARE_ID:", formatGrouped16(normalized));
    console.log("LICENSE_TYPE:", result.licenseType);
    console.log("LICENSE_KEY:", result.licenseKey);
    if (result.licenseType === "trial") {
      console.log("VALIDITY:   ", `${TRIAL_DAYS} ditë nga aktivizimi`);
    } else {
      console.log("EXPIRES_AT: ", result.expiresAt);
      console.log("EXPIRES_YMD:", result.expiresYmd);
    }
    console.log("================================");
    console.log("Jepja klientit LICENSE_KEY (rreshti i mësipërm).");
    console.log("");
  } catch (e) {
    console.error("[GABIM]", e.message || e);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  generateLicenseKey,
  normalizeHardwareId,
  formatGrouped16,
  TRIAL_DAYS,
  ANNUAL_DAYS,
};
