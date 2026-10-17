/**
 * Çaktivizim cloud për stafin — vetëm admin/pronar mbetet aktiv.
 * Kodi cloud mbetet; riaktivizo duke vendosur STAFF_CLOUD_FEATURES_DISABLED = false
 * ose duke shtuar role te CLOUD_ENABLED_SESSION_ROLES.
 */
/** Vetëm këto role flasin me cloud — stafi tjetër vetëm POS lokal (/api → SQLite). */
const CLOUD_ENABLED_SESSION_ROLES = new Set(["admin"]);
const CLOUD_ROLES = CLOUD_ENABLED_SESSION_ROLES;

/** Kill-switch global — stafi nuk sheh dhe nuk thërret cloud. */
const STAFF_CLOUD_FEATURES_DISABLED = true;

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

/** Push-e në background (PMS) — vetëm nga veprime admin kur stafi është off. */
function allowBackgroundCloudPush(reason) {
  if (!STAFF_CLOUD_FEATURES_DISABLED) return true;
  return String(reason || "").trim().toLowerCase().startsWith("admin-");
}

module.exports = {
  CLOUD_ROLES,
  CLOUD_ENABLED_SESSION_ROLES,
  STAFF_CLOUD_FEATURES_DISABLED,
  isStaffCloudFeaturesDisabled,
  isCloudEnabledForSession,
  jsonStaffCloudDisabled,
  allowBackgroundCloudPush,
};
