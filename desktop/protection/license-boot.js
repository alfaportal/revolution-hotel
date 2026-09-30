/**
 * Boot licence cloud — dialog loop, ri-verifikon cloud (standard 08-license-boot).
 */
const licenseGuard = require("../fiscal/license-guard");

function loadCloud() {
  return require("../license");
}

function reasonFromValidation(v, cloud, fallback = "no_license") {
  if (cloud.isRevocationCode(v?.code)) return "revoked";
  if (v?.code === "EXPIRED") return "expired";
  if (v?.code === "OFFLINE_EXPIRED") return "offline_expired";
  if (v?.code === "OFFLINE_NEED_ACTIVATION") return "no_license";
  return fallback;
}

function allowOfflineGrace(cloud, app) {
  return (
    cloud.isWithinCloudOfflineWindow(app) &&
    !!cloud.readStoredLicense(app) &&
    cloud.hasServerConfirmedActivation(app)
  );
}

async function isProdLicenseSatisfied(cloud, app) {
  const claimed = await cloud.claimByHardwareFromCloud(app);
  if (claimed?.valid && (claimed.celesi || claimed.license_key)) {
    const key = claimed.celesi || claimed.license_key;
    try {
      await cloud.activateWithKey(app, key, {});
    } catch {
      if (!cloud.hasServerConfirmedActivation(app)) return false;
    }
    return cloud.hasServerConfirmedActivation(app);
  }
  const key = cloud.readStoredLicense(app);
  if (!key || !cloud.hasServerConfirmedActivation(app)) return false;
  const v = await cloud.validateLicenseOnline(key, { skipHardFail: true });
  if (v.valid && !v.offline) return true;
  if (!v.valid && !v.offline) return false;
  if (v.offline && v.code === "OK" && allowOfflineGrace(cloud, app)) return true;
  return false;
}

async function runProdLicenseDialogUntilOk(app, initialReason = "no_license") {
  const cloud = loadCloud();
  cloud.registerInstallContext(app);
  let reason = initialReason;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isProdLicenseSatisfied(cloud, app)) return true;
    const keyProbe = cloud.readStoredLicense(app);
    const probe = keyProbe
      ? await cloud.validateLicenseOnline(keyProbe, { skipHardFail: true })
      : { code: "OFFLINE_NEED_ACTIVATION" };
    reason = reasonFromValidation(probe, cloud, reason);
    const activated = await licenseGuard.promptHardwareActivation(app, { reason });
    if (!activated) return false;
    if (await isProdLicenseSatisfied(cloud, app)) return true;
    const keyAfter = cloud.readStoredLicense(app);
    const v = keyAfter
      ? await cloud.validateLicenseOnline(keyAfter, { skipHardFail: true })
      : { code: "OFFLINE_NEED_ACTIVATION" };
    reason = reasonFromValidation(v, cloud, reason);
  }
  return false;
}

module.exports = {
  loadCloud,
  isProdLicenseSatisfied,
  runProdLicenseDialogUntilOk,
  reasonFromValidation,
};
