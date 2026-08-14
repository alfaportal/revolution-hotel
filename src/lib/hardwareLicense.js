/**
 * Hardware LICENSE_KEY — i njëjti algoritëm si:
 *   KAFENE/tools/generate-license.js
 *   KAFENE/fiscal/license-guard.js (getSecretSalt)
 *
 * trial:  SHA256(HARDWARE_ID + SECRET_SALT + "|trial")
 * annual: SHA256(HARDWARE_ID + SECRET_SALT + "|annual|" + YYYYMMDD)
 * legacy: SHA256(HARDWARE_ID + SECRET_SALT) — vetëm për compat
 */
const crypto = require("crypto");

/** Duhet të përputhet me generate-license.js / license-guard.js */
const SECRET_SALT =
  process.env.KAFENE_HW_LICENSE_SALT || "KAFENE-HWLOCK-2026-NASER-9f4c2a7b";
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
 * @param {string} hardwareIdInput — HARDWARE_ID nga ekrani i klientit
 * @param {{ licenseType?: string }} [opts] — 'trial' | 'annual' (default annual)
 * @returns {{ licenseKey: string, licenseType: string, expiresAt: string|null, expiresYmd: string|null, trialDays?: number }}
 */
function generateHardwareLicenseKey(hardwareIdInput, opts = {}) {
  const id = normalizeHardwareId(hardwareIdInput);
  if (id.length < 16) {
    throw new Error(
      "HARDWARE_ID duhet 16 shenja hex (XXXX-XXXX-XXXX-XXXX) nga ekrani «Aktivizo KAFENE». Jo Device ID me 12 shenja.",
    );
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

  const hash = crypto
    .createHash("sha256")
    .update(material)
    .digest("hex")
    .toUpperCase();
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

module.exports = {
  SECRET_SALT,
  TRIAL_DAYS,
  ANNUAL_DAYS,
  normalizeHardwareId,
  formatGrouped16,
  generateHardwareLicenseKey,
  annualExpiresYmdFromToday,
};
