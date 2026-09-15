/**
 * fiscal/fiscal-local-env.js — profil ekzekutimi lokal për Revolution HOTEL.
 * HOTEL nuk dërgon kuponë te ATK (ATK_COMMUNICATION_FORBIDDEN); ky modul
 * dokumenton dhe vendos env për testim lokal / self-test.
 */
const ATK_HOST_RE =
  /(?:^|\.)((?:fi|e)?fiskalizimi(?:-test)?\.atk-ks\.org)$/i;

function envTruthy(name) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function hostnameFromUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).hostname.toLowerCase();
  } catch {
    /* */
  }
  return raw.replace(/:\d+$/, "").toLowerCase();
}

/** Host i serverit ATK / fiskalizimi (TEST ose PROD). */
function isAtkHost(input) {
  const host = hostnameFromUrl(input);
  if (!host) return false;
  return ATK_HOST_RE.test(host) || /atk-ks\.org$/i.test(host);
}

function isFiscalLocalRun() {
  const direct = envTruthy("FISCAL_LOCAL_RUN") ?? envTruthy("FISCAL_LOCAL_TEST");
  if (direct === true) return true;
  if (direct === false) return false;
  return false;
}

function applyFiscalLocalRunEnvironment() {
  process.env.FISCAL_LOCAL_RUN = process.env.FISCAL_LOCAL_RUN || "1";
  if (process.env.ATK_TEST_MODE == null || String(process.env.ATK_TEST_MODE).trim() === "") {
    process.env.ATK_TEST_MODE = "0";
  }
  if (process.env.FISCAL_TEST_MODE == null || String(process.env.FISCAL_TEST_MODE).trim() === "") {
    process.env.FISCAL_TEST_MODE = process.env.ATK_TEST_MODE;
  }
}

function getLocalRunStatus() {
  const {
    isAtkAutoSendEnabled,
    isAtkCommunicationForbidden,
  } = require("./fiscal-offline");
  let fiscalEnabled = false;
  let settings = null;
  try {
    settings = require("./fiscal-config").getFiscalSettings();
    fiscalEnabled = !!settings.fiscal_enabled;
  } catch {
    /* */
  }
  return {
    fiscal_local_run: isFiscalLocalRun(),
    atk_auto_send: isAtkAutoSendEnabled(),
    atk_transmission_blocked: isAtkCommunicationForbidden(),
    fiscal_enabled: fiscalEnabled,
    fiscal_persistence: "sqlite",
    atk_http: "BLOCKED (HOTEL — vetëm moduli SEF dërgon te ATK)",
    settings_summary: settings
      ? {
          nui: settings.taxpayer_nui,
          unit: settings.unit_name,
          language: settings.language,
        }
      : null,
  };
}

module.exports = {
  ATK_HOST_RE,
  isFiscalLocalRun,
  isAtkHost,
  applyFiscalLocalRunEnvironment,
  getLocalRunStatus,
};
