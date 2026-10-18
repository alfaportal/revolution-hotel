/**
 * NJË program — jo «dy programe».
 * Burimi i punës: SQLite në PC (kamarier/recepsion). Pasqyrë e njëjtë: cloud (pronari, zilja, KDS).
 * Outbound sync: i njëjti si KAFENE (cloud-sync.js) — pa bllokim nga ky skedar.
 *
 * Këtu fiket vetëm POLL/UI inbound te stafi (mos e ngarko ekranin me cloud).
 * PRANO, artikuj, pagesë, tavolina, PMS — gjithmonë outbound kur ka licencë.
 */
/** Role që mund të lexojë cloud nga UI (poll). Të tjerët punojnë POS — sync vazhdon në background. */
const CLOUD_ENABLED_SESSION_ROLES = new Set(["admin"]);
const CLOUD_ROLES = CLOUD_ENABLED_SESSION_ROLES;

/** Kill-switch global — stafi nuk sheh dhe nuk thërret cloud. */
/** Si KAFENE — pa kill-switch global; stafi + admin përdorin të njëjtin rrjedhë cloud. */
const STAFF_CLOUD_FEATURES_DISABLED = false;

function isStaffCloudFeaturesDisabled() {
  return STAFF_CLOUD_FEATURES_DISABLED;
}

function isCloudEnabledForSession(session) {
  if (!STAFF_CLOUD_FEATURES_DISABLED) return true;
  const role = String(session?.role || "").trim().toLowerCase();
  return CLOUD_ENABLED_SESSION_ROLES.has(role);
}

function jsonStaffCloudDisabled(res, extra = {}) {
  return res.json({
    ok: false,
    disabled: true,
    cloud_ok: false,
    gabim: "Cloud është çaktivizuar për këtë rol.",
    ...extra,
  });
}

/** PMS / housekeeping / rezervime — i njëjti urë POS↔cloud si porositë. */
function allowBackgroundCloudPush(_reason) {
  return allowPosOutboundSalesSync();
}

/**
 * POS → cloud për porosi/tavolina (pronari telefon, KDS).
 * Kill-switch stafi fshin vetëm poll/UI inbound — nuk ndalon sync outbound.
 */
function allowPosOutboundSalesSync() {
  return true;
}

module.exports = {
  CLOUD_ROLES,
  CLOUD_ENABLED_SESSION_ROLES,
  STAFF_CLOUD_FEATURES_DISABLED,
  isStaffCloudFeaturesDisabled,
  isCloudEnabledForSession,
  jsonStaffCloudDisabled,
  allowBackgroundCloudPush,
  allowPosOutboundSalesSync,
};
