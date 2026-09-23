/**
 * ATK — default LOKAL (pa HTTP). Aktivizohet vetëm me HOTEL_ATK_SEND_ALLOWED=1 ose atk_send_allowed=1.
 */
const { isFiscalLocalRun } = require("./fiscal-local-env");

function isLocalPrintOnly() {
  try {
    const database = require("../database");
    const v = database.getSetting("local_print_only", "1");
    if (v === "0" || v === 0 || v === false || v === "false") return false;
    return true;
  } catch {
    return true;
  }
}

function isAtkSendAllowedByOwner() {
  if (/^1|true|yes|on$/i.test(String(process.env.HOTEL_ATK_SEND_ALLOWED || "").trim())) {
    return true;
  }
  try {
    const database = require("../database");
    return database.getSetting("atk_send_allowed", "0") === "1";
  } catch {
    return false;
  }
}

function isAtkTestMode() {
  const env = process.env.ATK_TEST_MODE ?? process.env.FISCAL_TEST_MODE;
  if (env !== undefined && env !== null && String(env).trim() !== "") {
    const v = String(env).trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }
  try {
    const database = require("../database");
    const v = database.getSetting("atk_test_mode", "0");
    return v === "1" || v === 1 || v === true || v === "true";
  } catch {
    return false;
  }
}

function isAtkTransmissionBlocked() {
  if (!isAtkSendAllowedByOwner()) return true;
  return isFiscalLocalRun();
}

function isFiscalMemoryOnly() {
  const v = process.env.FISCAL_MEMORY_ONLY;
  if (v !== undefined && v !== null && String(v).trim() !== "") {
    const s = String(v).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "on";
  }
  return false;
}

module.exports = {
  isAtkTestMode,
  isLocalPrintOnly,
  isAtkSendAllowedByOwner,
  isAtkTransmissionBlocked,
  isFiscalMemoryOnly,
};
