/**
 * HOTEL — ndalim absolut i komunikimit me ATK (HTTP kuponë / PosCoupon).
 * Nuk anashkalohet me env, settings, FISCAL_LOCAL_RUN, paper-block, E2E, etj.
 */
const ATK_COMMUNICATION_FORBIDDEN = true;

function isAtkCommunicationForbidden() {
  return ATK_COMMUNICATION_FORBIDDEN === true;
}

/** Gjithmonë false te HOTEL — vetëm moduli SEF (jashtë ky program) dërgon te ATK. */
function isAtkAutoSendEnabled() {
  return false;
}

function blockAtkCommunicationResult(context) {
  return {
    sent: false,
    forbidden: true,
    blocked: true,
    skipped: true,
    error: "HOTEL: komunikimi me ATK i ndaluar — asnjë kupon nuk dërgohet te ATK",
    context: context || "atk",
  };
}

module.exports = {
  ATK_COMMUNICATION_FORBIDDEN,
  isAtkCommunicationForbidden,
  isAtkAutoSendEnabled,
  blockAtkCommunicationResult,
};
