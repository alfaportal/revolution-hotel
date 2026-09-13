/**
 * Boot licence cloud — dialog i errët, poll HW, derisa OK ose mbyllja e dialogut.
 */
const licenseGuard = require("../fiscal/license-guard");

function loadCloud() {
  return require("../license");
}

function reasonFromValidation(v, cloud, fallback = "no_license") {
  if (cloud.isRevocationCode(v?.code)) return "revoked";
  if (v?.code === "EXPIRED") return "expired";
  if (v?.code === "OFFLINE_EXPIRED") return "offline_expired";
  return fallback;
}

async function isProdLicenseSatisfied(cloud, app) {
  const claimed = await cloud.claimByHardwareFromCloud(app);
  if (claimed?.valid && (claimed.celesi || claimed.license_key)) {
    return true;
  }
  const key = cloud.readStoredLicense(app);
  if (!key) return false;
  const v = await cloud.validateLicenseOnline(key);
  if (v.valid) return true;
  if (typeof cloud.isWithinCloudOfflineWindow === "function" && cloud.isWithinCloudOfflineWindow(app)) {
    return true;
  }
  return false;
}

async function runProdLicenseDialogUntilOk(app, initialReason = "no_license") {
  const cloud = loadCloud();
  cloud.registerInstallContext(app);

  let reason = initialReason;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isProdLicenseSatisfied(cloud, app)) return true;

    const activated = await licenseGuard.promptHardwareActivation(app, { reason });
    if (!activated) return false;

    if (await isProdLicenseSatisfied(cloud, app)) return true;

    const key = cloud.readStoredLicense(app);
    const v = key ? await cloud.validateLicenseOnline(key) : { valid: false };
    reason = reasonFromValidation(v, cloud, "no_license");
  }
  return false;
}

module.exports = {
  loadCloud,
  isProdLicenseSatisfied,
  runProdLicenseDialogUntilOk,
  reasonFromValidation,
};
