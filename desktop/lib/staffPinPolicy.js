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
  if (k === "housekeeping") return "pastrim";
  if (k === "recepsion") return "recepsion";
  return "kamarier";
}

function pinDigitsForStaffRole(_staffRole) {
  return 4;
}

function pinDigitsForLoginMode(_loginMode) {
  return 4;
}

function pinLookupCandidates(pin) {
  const p = String(pin ?? "").trim();
  const out = [];
  if (/^\d{4}$/.test(p)) {
    out.push(p);
    out.push(p.padStart(6, "0"));
  } else if (/^\d{6}$/.test(p)) {
    out.push(p);
    if (p.startsWith("00")) out.push(p.slice(2));
  }
  return [...new Set(out)];
}

function acceptsStaffPin(pin, _staffRole) {
  const p = String(pin ?? "").trim();
  return /^\d{4}$/.test(p) || /^\d{6}$/.test(p);
}

function acceptsLoginPin(pin, _loginMode) {
  const p = String(pin ?? "").trim();
  return /^\d{4}$/.test(p) || /^\d{6}$/.test(p);
}

function validateNewStaffPin(pin, _staffRole) {
  const p = String(pin ?? "").trim();
  if (!/^\d{4}$/.test(p)) throw new Error("PIN duhet të jetë 4 shifra");
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
  let mode = String(loginMode || "kamarier").trim().toLowerCase();
  if (mode === "sherbimi" || mode === "housekeeping" || mode === "pastrimi") mode = "pastrim";
  if (staffZone === mode) return null;
  if (staffZone === "recepsion") {
    return "Ky PIN është për Recepsionin — kliko Ndërro.";
  }
  if (staffZone === "pastrim") {
    return "Ky PIN është për Pastrimin — përdorni linkun e pastrimit.";
  }
  if (mode === "pastrim" || mode === "sherbimi") {
    return "Ky PIN nuk është për Pastrimin.";
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
  pinLookupCandidates,
  wrongZoneMessage,
};
