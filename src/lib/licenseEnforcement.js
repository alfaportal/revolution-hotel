const { isExpired } = require("./licenseDates");

function isTrialActive(license) {
  if (!license?.trial_ends_at) return false;
  return new Date(license.trial_ends_at).getTime() > Date.now();
}

function isLicenseUsable(license) {
  if (!license) {
    return { ok: false, code: "NOT_FOUND", message: "Liçenca nuk u gjet." };
  }
  if (license.statusi === "revokuar") {
    return { ok: false, code: "REVOKED", message: "Liçenca është revokuar." };
  }
  if (license.statusi === "pezulluar") {
    return { ok: false, code: "SUSPENDED", message: "Liçenca është pezulluar." };
  }
  if (license.statusi === "skaduar") {
    return { ok: false, code: "EXPIRED", message: "Liçenca ka skaduar." };
  }
  if (isTrialActive(license)) {
    return { ok: true };
  }
  if (isExpired(license.data_skadimit)) {
    return { ok: false, code: "EXPIRED", message: "Liçenca ka skaduar." };
  }
  return { ok: true };
}

function assertLicenseUsable(license) {
  const check = isLicenseUsable(license);
  if (!check.ok) {
    const err = new Error(check.message);
    err.code = check.code;
    throw err;
  }
  return license;
}

module.exports = {
  isTrialActive,
  isLicenseUsable,
  assertLicenseUsable,
};
