const crypto = require("crypto");
const { todayISO } = require("./licenseDates");

function getMasterEmergencyPin() {
  return String(process.env.MASTER_EMERGENCY_PIN || "").trim();
}

function isMasterPinConfigured() {
  return getMasterEmergencyPin().length >= 4;
}

function verifyMasterPin(pin) {
  const expected = getMasterEmergencyPin();
  if (!expected) return false;
  const provided = String(pin || "").trim();
  if (!provided) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return expected === provided;
  }
}

/** Kodi ditor emergjence (6 shifra, vetëm numra) — ndryshon çdo 24 orë (UTC). */
function getDailyEmergencyCode(dateStr = todayISO()) {
  const pin = getMasterEmergencyPin();
  if (!pin) return null;
  const hash = crypto
    .createHmac("sha256", `rip-emergency-v2:${pin}`)
    .update(String(dateStr))
    .digest();
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += String(hash[i] % 10);
  }
  return code;
}

function verifyDailyEmergencyCode(code, dateStr = todayISO()) {
  const expected = getDailyEmergencyCode(dateStr);
  if (!expected) return false;
  const provided = String(code || "").trim().replace(/\D/g, "");
  if (!provided) return false;
  if (provided === expected) return true;
  const yesterday = new Date(dateStr);
  yesterday.setDate(yesterday.getDate() - 1);
  const prev = getDailyEmergencyCode(yesterday.toISOString().slice(0, 10));
  return prev && provided === prev;
}

module.exports = {
  getMasterEmergencyPin,
  isMasterPinConfigured,
  verifyMasterPin,
  getDailyEmergencyCode,
  verifyDailyEmergencyCode,
};
