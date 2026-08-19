const crypto = require("crypto");
const { getSupabase } = require("../db");
const { getPublicAppOrigin } = require("./publicOrigin");

const PUNETORI_TOKEN_RE = /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]{6}$/;
const PUNETORI_UI_ROLES = new Set(["waiter", "receptionist", "housekeeping"]);

function slugifyNamePart(value) {
  const base = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "staf";
}

function splitFullName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { emri: "punonjes", mbiemri: "staf" };
  if (parts.length === 1) return { emri: slugifyNamePart(parts[0]), mbiemri: slugifyNamePart(parts[0]) };
  return {
    emri: slugifyNamePart(parts[0]),
    mbiemri: slugifyNamePart(parts.slice(1).join(" ")),
  };
}

function generatePunetoriToken(fullName) {
  const { emri, mbiemri } = splitFullName(fullName);
  const random6 = crypto.randomBytes(3).toString("hex");
  return `${emri}-${mbiemri}-${random6}`;
}

function normalizePunetoriToken(raw) {
  return String(raw || "").trim().toLowerCase();
}

function isPunetoriTokenFormat(token) {
  return PUNETORI_TOKEN_RE.test(normalizePunetoriToken(token));
}

function punetoriUiRole(role) {
  const r = String(role || "waiter").trim().toLowerCase();
  return PUNETORI_UI_ROLES.has(r) ? r : null;
}

function buildPunetoriUrl(baseUrl, webToken) {
  const base = String(baseUrl || getPublicAppOrigin()).replace(/\/+$/, "");
  const token = normalizePunetoriToken(webToken);
  if (!token) return "";
  return `${base}/hotel/punetori/${encodeURIComponent(token)}`;
}

async function ensureStaffPunetoriToken(clientId, staffId, staffName) {
  const db = getSupabase();
  const { data: row, error: findErr } = await db
    .from("pos_staff")
    .select("id, name, web_token")
    .eq("id", staffId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!row) return null;

  const name = String(staffName || row.name || "").trim();
  if (row.web_token && isPunetoriTokenFormat(row.web_token)) return row.web_token;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const web_token = generatePunetoriToken(name);
    const { data, error } = await db
      .from("pos_staff")
      .update({ web_token })
      .eq("id", staffId)
      .eq("client_id", clientId)
      .select("web_token")
      .maybeSingle();
    if (!error && data?.web_token) return data.web_token;
    if (error && !String(error.message || "").includes("unique")) throw error;
  }

  const { data: again } = await db
    .from("pos_staff")
    .select("web_token")
    .eq("id", staffId)
    .maybeSingle();
  return again?.web_token || null;
}

async function ensureAllStaffPunetoriTokens(clientId, staffRows = []) {
  await Promise.all(
    (staffRows || []).map(s => ensureStaffPunetoriToken(clientId, s.id, s.name)),
  );
}

async function getStaffByPunetoriToken(webToken) {
  const token = normalizePunetoriToken(webToken);
  if (!token) return null;
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_staff")
    .select("id, name, role, active, pin_hash, web_token, client_id")
    .eq("web_token", token)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id || data.active === false) return null;
  if (!punetoriUiRole(data.role)) return null;
  return data;
}

module.exports = {
  PUNETORI_UI_ROLES,
  generatePunetoriToken,
  normalizePunetoriToken,
  isPunetoriTokenFormat,
  punetoriUiRole,
  buildPunetoriUrl,
  ensureStaffPunetoriToken,
  ensureAllStaffPunetoriTokens,
  getStaffByPunetoriToken,
};
