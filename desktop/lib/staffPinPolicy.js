/** Gjatësia e PIN-it sipas rolit — restorant 4 (legacy 6), recepsion/pastrim 6. */

const RESTAURANT_ROLES = new Set(["kamarier", "waiter", "kitchen", "kuzhina", "bar", "banak"]);
const SIX_DIGIT_ROLES = new Set(["recepsion", "receptionist", "housekeeping", "pastrim", "pastrimi", "sherbimi"]);

function normalizeStaffRoleKey(raw) {
  const r = String(raw || "kamarier").trim().toLowerCase();
  if (r === "recepsion" || r === "receptionist" || r === "recepsionist") return "recepsion";
  if (SIX_DIGIT_ROLES.has(r)) return r === "recepsion" ? "recepsion" : "housekeeping";
  return "kamarier";
}

function loginModeForStaffRole(staffRole) {
  const k = normalizeStaffRoleKey(staffRole);
  return k === "recepsion" || k === "housekeeping" ? "recepsion" : "kamarier";
}

function pinDigitsForStaffRole(staffRole) {
  const k = normalizeStaffRoleKey(staffRole);
  if (k === "recepsion" || k === "housekeeping") return 6;
  return 4;
}

function pinDigitsForLoginMode(loginMode) {
  return String(loginMode || "").trim().toLowerCase() === "recepsion" ? 6 : 4;
}

/** Pranon 6 shifra për restorant vetëm legacy (pa ndryshuar DB pa OK të Naserit). */
function acceptsStaffPin(pin, staffRole) {
  const p = String(pin ?? "").trim();
  const k = normalizeStaffRoleKey(staffRole);
  if (k === "recepsion" || k === "housekeeping") {
    return /^\d{6}$/.test(p);
  }
  return /^\d{4}$/.test(p) || /^\d{6}$/.test(p);
}

function acceptsLoginPin(pin, loginMode) {
  const mode = String(loginMode || "kamarier").trim().toLowerCase();
  const p = String(pin ?? "").trim();
  if (mode === "recepsion") return /^\d{6}$/.test(p);
  return /^\d{4}$/.test(p) || /^\d{6}$/.test(p);
}

function validateNewStaffPin(pin, staffRole) {
  const p = String(pin ?? "").trim();
  const need = pinDigitsForStaffRole(staffRole);
  if (need === 6) {
    if (!/^\d{6}$/.test(p)) throw new Error("PIN duhet të jetë 6 shifra");
    return p;
  }
  if (!/^\d{4}$/.test(p)) throw new Error("PIN duhet të jetë 4 shifra (restorant / kuzhinë / bar)");
  return p;
}

/** Kur PIN nuk ndryshohet — prano legacy 6 për kamarier; vetëm PIN i ri/ndryshuar kërkon 4 (restorant). */
function validateStaffPinChange(pin, staffRole, previousPin) {
  const p = String(pin ?? "").trim();
  const prev = previousPin == null ? "" : String(previousPin).trim();
  if (prev && p === prev && acceptsStaffPin(p, staffRole)) return p;
  return validateNewStaffPin(p, staffRole);
}

function isStaffPinSyncable(pin) {
  const p = String(pin ?? "").trim();
  return /^\d{4}$|^\d{6}$/.test(p);
}

function wrongZoneMessage(staffRole, loginMode) {
  const staffZone = loginModeForStaffRole(staffRole);
  const mode = String(loginMode || "kamarier").trim().toLowerCase();
  if (staffZone === mode) return null;
  if (staffZone === "recepsion") {
    return "Ky PIN është për Recepsionin — kliko Ndërro.";
  }
  return "Ky PIN është për Restorantin — kliko Ndërro.";
}

module.exports = {
  RESTAURANT_ROLES,
  normalizeStaffRoleKey,
  loginModeForStaffRole,
  pinDigitsForStaffRole,
  pinDigitsForLoginMode,
  acceptsStaffPin,
  acceptsLoginPin,
  validateNewStaffPin,
  validateStaffPinChange,
  isStaffPinSyncable,
  wrongZoneMessage,
};
