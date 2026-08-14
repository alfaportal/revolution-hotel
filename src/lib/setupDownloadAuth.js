/**
 * Setup Windows — shkarkim VETËM me token të nënshkruar (jo publik i hapur).
 */
const crypto = require("crypto");
const { trimEnv } = require("./env");

function setupDownloadSecret() {
  return (
    trimEnv("SETUP_DOWNLOAD_SECRET") ||
    trimEnv("LICENSE_HMAC_SECRET") ||
    trimEnv("JWT_SECRET") ||
    ""
  );
}

function isSetupDownloadConfigured() {
  return Boolean(setupDownloadSecret());
}

const { DEFAULT_SETUP_LINK_TTL_HOURS } = require("./publicOrigin");

/**
 * Token i vlefshëm për `ttlHours` (default 7 ditë = 168h).
 * Format: base64url(expMs.hmac)
 */
function createSetupDownloadToken({ ttlHours = DEFAULT_SETUP_LINK_TTL_HOURS, plan = "" } = {}) {
  const secret = setupDownloadSecret();
  if (!secret) {
    const err = new Error("SETUP_DOWNLOAD_SECRET mungon në server.");
    err.code = "SETUP_SECRET_MISSING";
    throw err;
  }
  const hours = Math.min(720, Math.max(1, Number(ttlHours) || DEFAULT_SETUP_LINK_TTL_HOURS));
  const exp = Date.now() + hours * 60 * 60 * 1000;
  const planKey = String(plan || "").trim().toLowerCase().slice(0, 8);
  const payload = `${exp}.${planKey || "any"}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
  return Buffer.from(`${payload}.${sig}`, "utf8").toString("base64url");
}

function verifySetupDownloadToken(token) {
  const secret = setupDownloadSecret();
  if (!secret) return { ok: false, reason: "not_configured" };
  const raw = String(token || "").trim();
  if (!raw) return { ok: false, reason: "missing" };
  let decoded;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const parts = decoded.split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };
  const [expStr, planKey, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return { ok: false, reason: "expired" };
  const payload = `${expStr}.${planKey}`;
  const expect = crypto.createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    plan: planKey === "any" ? "" : planKey,
    expires_at: new Date(exp).toISOString(),
  };
}

module.exports = {
  setupDownloadSecret,
  isSetupDownloadConfigured,
  createSetupDownloadToken,
  verifySetupDownloadToken,
};
