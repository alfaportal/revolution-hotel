/**
 * ATK_TEST_MODE — mjedisi TEST; HTTP bllokohet vetëm me FISCAL_LOCAL_RUN=1.
 */
const { isFiscalLocalRun, isAtkHost } = require("./fiscal-local-env");

function isAtkTestMode() {
  const env = process.env.ATK_TEST_MODE ?? process.env.FISCAL_TEST_MODE;
  if (env !== undefined && env !== null && String(env).trim() !== "") {
    const v = String(env).trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }
  try {
    const database = require("../database");
    const v = database.getSetting("atk_test_mode", "1");
    return v === "1" || v === 1 || v === true || v === "true";
  } catch {
    return true;
  }
}

function isAtkTransmissionBlocked() {
  return isFiscalLocalRun();
}

function isFiscalMemoryOnly() {
  return false;
}

module.exports = {
  isFiscalLocalRun,
  isAtkHost,
  isAtkTestMode,
  isAtkTransmissionBlocked,
  isFiscalMemoryOnly,
};
