/** Cloud: njoftime sigurie nga POS (licence fail / DevTools / urgent). */

const crypto = require("crypto");
const { getSupabase } = require("../lib/supabase");
const {
  isEmailConfigured,
  sendKafeneSecurityAlertEmail,
} = require("./emailService");

const DEFAULT_NOTIFY = "revolutioninvest05@gmail.com";

/** Duhet të përputhet me KAFENE/security-alert.js getAlertHmacSecret(). */
function getAlertHmacSecret() {
  const fromEnv = process.env.SECURITY_ALERT_HMAC_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const bytes = [
    91, 88, 70, 18, 41, 33, 90, 44, 58, 200, 210, 199, 240, 145, 130, 255, 220, 200, 190, 170, 80, 99,
    70, 100, 20, 15, 50, 110, 40, 70, 30, 90, 200, 180, 160, 140,
  ];
  return Buffer.from(bytes.map((x, i) => x ^ ((i * 11 + 37) & 0xff))).toString("utf8");
}

function verifyAlertSig(body) {
  const type = String(body?.type || "");
  const hardware_id = String(body?.hardware_id || "");
  const ts = Number(body?.ts) || 0;
  const sig = String(body?.alert_sig || "");
  if (!type || !hardware_id || !ts || !sig) return false;
  /* max 48h clock skew */
  if (Math.abs(Date.now() - ts) > 48 * 60 * 60 * 1000) return false;
  const expect = crypto
    .createHmac("sha256", getAlertHmacSecret())
    .update(`${type}|${hardware_id}|${ts}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expect, "utf8"));
  } catch {
    return sig === expect;
  }
}

async function ensureSecurityEventsTable() {
  const db = getSupabase();
  try {
    const { error } = await db.from("license_security_events").select("id").limit(1);
    if (!error) return true;
  } catch {
    /* try create */
  }
  try {
    await db.rpc("exec_sql", {
      query: `
        CREATE TABLE IF NOT EXISTS license_security_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_type TEXT NOT NULL,
          hardware_id TEXT NOT NULL DEFAULT '',
          count_24h INTEGER NOT NULL DEFAULT 0,
          urgent BOOLEAN NOT NULL DEFAULT false,
          attempt_key_hash TEXT,
          app_version TEXT,
          hostname TEXT,
          platform TEXT,
          build_fingerprint TEXT,
          watermark_ok BOOLEAN,
          message TEXT,
          payload_json JSONB,
          client_ip TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_license_security_hw_created
          ON license_security_events (hardware_id, created_at DESC);
      `,
    });
  } catch {
    /* migration file is source of truth — insert may still work if table exists */
  }
  return true;
}

async function insertSecurityEvent(row) {
  const db = getSupabase();
  const { error } = await db.from("license_security_events").insert(row);
  if (error) {
    /* tabela mund të mungojë — mos e blloko emailin */
    console.warn("[security-alert] insert:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Pranon alert nga POS, ruan log, dërgon email te Naseri.
 */
async function handleSecurityAlert(body, { clientIp } = {}) {
  if (!verifyAlertSig(body)) {
    return { ok: false, gabim: "Nënshkrim i pavlefshëm.", code: "BAD_SIG" };
  }

  const type = String(body.type || "unknown").slice(0, 64);
  const hardware_id = String(body.hardware_id || "").trim().slice(0, 64);
  if (!hardware_id) {
    return { ok: false, gabim: "Mungon hardware_id.", code: "NO_HW" };
  }

  const allowed = new Set([
    "license_activate_failed",
    "license_activate_urgent",
    "devtools_attempt",
  ]);
  if (!allowed.has(type)) {
    return { ok: false, gabim: "Lloji i alertit i panjohur.", code: "BAD_TYPE" };
  }

  await ensureSecurityEventsTable();

  const count_24h = Number(body.count_24h) || 0;
  const urgent = !!body.urgent || type === "license_activate_urgent";
  const row = {
    event_type: type,
    hardware_id,
    count_24h,
    urgent,
    attempt_key_hash: body.attempt_key_hash ? String(body.attempt_key_hash).slice(0, 64) : null,
    app_version: body.app_version ? String(body.app_version).slice(0, 32) : null,
    hostname: body.hostname ? String(body.hostname).slice(0, 120) : null,
    platform: body.platform ? String(body.platform).slice(0, 32) : null,
    build_fingerprint: body.build_fingerprint
      ? String(body.build_fingerprint).slice(0, 64)
      : null,
    watermark_ok: body.watermark_ok !== false,
    message: body.message ? String(body.message).slice(0, 500) : null,
    payload_json: {
      at: body.at || null,
      watermark: body.watermark || null,
      ts: body.ts || null,
    },
    client_ip: clientIp || null,
  };

  await insertSecurityEvent(row);

  const to =
    String(body.notify_email || "").trim().toLowerCase() ||
    process.env.SECURITY_NOTIFY_EMAIL?.trim()?.toLowerCase() ||
    DEFAULT_NOTIFY;

  let email_ok = false;
  let email_error = null;
  if (isEmailConfigured()) {
    try {
      await sendKafeneSecurityAlertEmail({
        to,
        type,
        hardwareId: hardware_id,
        count24h: count_24h,
        urgent,
        attemptKeyHash: row.attempt_key_hash,
        appVersion: row.app_version,
        hostname: row.hostname,
        platform: row.platform,
        buildFingerprint: row.build_fingerprint,
        watermarkOk: row.watermark_ok,
        message: row.message,
        at: body.at || new Date().toISOString(),
      });
      email_ok = true;
    } catch (e) {
      email_error = e.message || String(e);
      console.warn("[security-alert] email:", email_error);
    }
  } else {
    email_error = "RESEND_API_KEY mungon";
  }

  return {
    ok: true,
    logged: true,
    email_ok,
    email_error,
    urgent,
  };
}

module.exports = {
  handleSecurityAlert,
  verifyAlertSig,
  getAlertHmacSecret,
};
