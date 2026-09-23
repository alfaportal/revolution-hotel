/**
 * HOTEL — bllokon HTTP te ATK derisa onboarding të përfundojë (si BIZNES).
 * Pas «Lidhu me ATK» + atk_send_allowed → lejo dërgimin (fiscal-boot / fiscal-test-mode-store).
 */
const { isAtkTransmissionBlocked, isAtkSendAllowedByOwner } = require("./fiscal-test-mode-store");

function isAtkCommunicationForbidden() {
  return isAtkTransmissionBlocked();
}

/** Auto-dërgim offline queue — vetëm pas onboarding (atk_send_allowed + FISCAL_LOCAL_RUN=0). */
function isAtkAutoSendEnabled() {
  if (isAtkTransmissionBlocked()) return false;
  try {
    const database = require("../database");
    const dbVal = database.getSetting("atk_auto_send");
    if (dbVal != null) {
      return dbVal === "1" || dbVal === 1 || dbVal === true || dbVal === "true";
    }
  } catch {
    /* */
  }
  const env = process.env.ATK_AUTO_SEND;
  if (env !== undefined && env !== null && String(env).trim() !== "") {
    const s = String(env).trim().toLowerCase();
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  }
  return isAtkSendAllowedByOwner();
}

function blockAtkCommunicationResult(context) {
  return {
    sent: false,
    forbidden: isAtkCommunicationForbidden(),
    blocked: true,
    skipped: true,
    error:
      "ATK i bllokuar — plotësoni fushat e fiskalizimit dhe shtypni «Lidhu me ATK» para dërgimit të kuponëve.",
    context: context || "atk",
  };
}

module.exports = {
  isAtkCommunicationForbidden,
  isAtkAutoSendEnabled,
  blockAtkCommunicationResult,
};
