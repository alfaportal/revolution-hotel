/**
 * Dërgim on-demand i kodit emergjence te email i pronarit
 * (kur kamarieri shtyp «Harruat PIN-in?» në POS).
 * Kodi NUK kthehet në përgjigje HTTP / NUK shfaqet në panel.
 */
const { getSupabase } = require("../db");
const { validateLicense } = require("./licenseService");
const { getDailyEmergencyCode, isMasterPinConfigured } = require("../lib/emergencyPin");
const { isEmailConfigured, sendOwnerEmergencyCodeEmail } = require("./emailService");
const { logAdminActivity } = require("./activityLogService");

const MIN_INTERVAL_MS = 2 * 60 * 1000;
const MAX_PER_DAY = 12;
/** @type {Map<string, { lastAt: number, day: string, count: number }>} */
const rateByClient = new Map();

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function checkRateLimit(clientId) {
  const id = String(clientId || "");
  const now = Date.now();
  const day = utcDay();
  const prev = rateByClient.get(id);
  if (!prev || prev.day !== day) {
    rateByClient.set(id, { lastAt: 0, day, count: 0 });
  }
  const st = rateByClient.get(id);
  if (st.lastAt && now - st.lastAt < MIN_INTERVAL_MS) {
    const err = new Error("Prisni pak minuta para se të kërkoni kod të ri.");
    err.code = "RATE_LIMIT";
    throw err;
  }
  if (st.count >= MAX_PER_DAY) {
    const err = new Error("U arrit limiti ditor i kërkesave për kod emergjence.");
    err.code = "DAILY_LIMIT";
    throw err;
  }
}

function markSent(clientId) {
  const id = String(clientId || "");
  const day = utcDay();
  const prev = rateByClient.get(id) || { lastAt: 0, day, count: 0 };
  if (prev.day !== day) {
    rateByClient.set(id, { lastAt: Date.now(), day, count: 1 });
    return;
  }
  rateByClient.set(id, {
    lastAt: Date.now(),
    day,
    count: (prev.count || 0) + 1,
  });
}

async function resolveOwnerEmail(clientId) {
  const db = getSupabase();
  const { data, error } = await db
    .from("users")
    .select("email, emri")
    .eq("client_id", clientId)
    .eq("roli", "client_admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  let email = String(data?.email || "").trim().toLowerCase();
  let ownerName = String(data?.emri || "").trim();
  if (!email) {
    const { data: client } = await db
      .from("clients")
      .select("email, emri")
      .eq("id", clientId)
      .maybeSingle();
    email = String(client?.email || "").trim().toLowerCase();
    if (!ownerName) ownerName = String(client?.emri || "").trim();
  }
  return { email: email || null, ownerName: ownerName || "" };
}

/**
 * @param {{ celesi?: string, license_key?: string, device_id?: string, app_type?: string, hostname?: string, waiter_name?: string }} body
 */
async function requestEmergencyCodeEmail(body = {}) {
  if (!isMasterPinConfigured()) {
    const err = new Error("Kodi emergjence nuk është i konfiguruar në server.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  if (!isEmailConfigured()) {
    const err = new Error("Emaili nuk është i konfiguruar (RESEND_API_KEY).");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }

  const key = String(body.celesi || body.license_key || "").trim();
  if (!key) {
    const err = new Error("Mungon çelësi i licencës.");
    err.code = "NO_LICENSE";
    throw err;
  }

  const licenseResult = await validateLicense({
    celesi: key,
    device_id: body.device_id,
    app_type: body.app_type,
    hostname: body.hostname,
  });
  if (!licenseResult.valid || !licenseResult.client_id) {
    const err = new Error(licenseResult.message || "Licenca nuk është aktive.");
    err.code = "LICENSE_INVALID";
    throw err;
  }

  const clientId = licenseResult.client_id;
  checkRateLimit(clientId);

  const { email, ownerName } = await resolveOwnerEmail(clientId);
  if (!email) {
    const err = new Error("Nuk u gjet email i pronarit për këtë lokal.");
    err.code = "NO_OWNER_EMAIL";
    throw err;
  }

  const code = getDailyEmergencyCode();
  if (!code) {
    const err = new Error("Kodi emergjence nuk u gjenerua.");
    err.code = "NO_CODE";
    throw err;
  }

  const clientName =
    licenseResult.client_name ||
    licenseResult.clients?.emri ||
    "Lokali juaj";

  await sendOwnerEmergencyCodeEmail({
    to: email,
    ownerName,
    clientName,
    code,
    waiterName: String(body.waiter_name || "").trim(),
    validForDate: utcDay(),
  });

  markSent(clientId);

  try {
    await logAdminActivity({
      actorEmail: email,
      action: "emergency_code_emailed",
      targetType: "client",
      targetId: clientId,
      targetLabel: clientName,
      details: {
        device_id: String(body.device_id || "").trim().toUpperCase() || null,
        waiter_name: String(body.waiter_name || "").trim() || null,
        /* mos ruaj kodin në log */
      },
    });
  } catch {
    /* optional */
  }

  return {
    ok: true,
    sent: true,
    message: "Kodi u dërgua te pronari juaj — kontaktoni pronarin.",
  };
}

module.exports = {
  requestEmergencyCodeEmail,
  resolveOwnerEmail,
};
