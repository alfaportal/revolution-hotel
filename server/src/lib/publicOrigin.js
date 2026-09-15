/** URL publike e aplikacionit (domain prod) dhe kontakt mbështetjeje. */

const DEFAULT_PUBLIC_ORIGIN = "https://revolution-pos.com";
const DEFAULT_SUPPORT_PHONE = "+383 48707880";
const DEFAULT_SUPPORT_EMAIL = "revolutioninvest05@gmail.com";
/** Fallback i fundit nëse GitHub API / cache dështon. */
const DEFAULT_SETUP_DOWNLOAD_URL =
  "https://github.com/alfaportal/revolution-pos-server/releases/download/setup-v1.0.247/KAFENE-Setup.exe";
const DEFAULT_SETUP_VERSION = "1.0.247";
/** Link Setup (admin / email / SMS) — default 7 ditë. */
const DEFAULT_SETUP_LINK_TTL_HOURS = 168;

const {
  cachedSetupDownloadUrl,
  cachedSetupVersion,
  kickSetupReleaseRefresh,
} = require("./setupReleaseMeta");

function getPublicAppOrigin() {
  const raw = process.env.PUBLIC_APP_ORIGIN?.trim();
  return (raw || DEFAULT_PUBLIC_ORIGIN).replace(/\/+$/, "");
}

function getSupportPhone() {
  // Numri zyrtar publik — mos lejo numër të vjetër nga env (p.sh. 44555294).
  const fromEnv = (
    process.env.SUPPORT_PHONE?.trim() ||
    process.env.TRIAL_SUPPORT_PHONE?.trim() ||
    ""
  );
  if (fromEnv && !fromEnv.replace(/\D/g, "").includes("44555294")) {
    return fromEnv;
  }
  return DEFAULT_SUPPORT_PHONE;
}

function getSupportPhoneDigits() {
  return getSupportPhone().replace(/\D/g, "");
}

function getSupportEmail() {
  const fromEnv = process.env.SUPPORT_EMAIL?.trim() || "";
  // Mos lejo email fiktiv info@revolution-pos.com
  if (fromEnv && !/info@revolution/i.test(fromEnv)) {
    return fromEnv;
  }
  return DEFAULT_SUPPORT_EMAIL;
}

function isSetupDownloadPinned() {
  const v = String(process.env.SETUP_DOWNLOAD_PINNED || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function envPlanSetupUrl(plan) {
  const key = String(plan || "").toLowerCase();
  const byPlan = {
    p1:
      process.env.SETUP_DOWNLOAD_P1_URL?.trim() ||
      process.env.SETUP_DOWNLOAD_STANDARD_URL?.trim() ||
      "",
    p2:
      process.env.SETUP_DOWNLOAD_P2_URL?.trim() ||
      process.env.SETUP_DOWNLOAD_PRO_URL?.trim() ||
      "",
    p3:
      process.env.SETUP_DOWNLOAD_P3_URL?.trim() ||
      process.env.SETUP_DOWNLOAD_FULL_URL?.trim() ||
      "",
    p4:
      process.env.SETUP_DOWNLOAD_P4_URL?.trim() ||
      process.env.SETUP_DOWNLOAD_FULL_URL?.trim() ||
      "",
  };
  return byPlan[key] || "";
}

function pinnedOrEnvFallbackUrl() {
  const fallbackRaw =
    process.env.SETUP_DOWNLOAD_URL?.trim() || DEFAULT_SETUP_DOWNLOAD_URL;
  return /KAFENE-Setup\.exe$/i.test(fallbackRaw)
    ? fallbackRaw
    : DEFAULT_SETUP_DOWNLOAD_URL;
}

/** URL për shkarkim Setup — auto nga GitHub latest (ose pin via env). */
function getSetupDownloadUrl(plan) {
  const planEnv = envPlanSetupUrl(plan);
  if (planEnv) {
    if (/github\.com\/.+\/releases\/download\//i.test(planEnv) && !/\.exe$/i.test(planEnv)) {
      /* ignore bad plan URL */
    } else {
      return planEnv;
    }
  }

  if (isSetupDownloadPinned()) {
    return pinnedOrEnvFallbackUrl();
  }

  /* Auto: release i fundit nga restaurant-system (cache). */
  kickSetupReleaseRefresh();
  const auto = cachedSetupDownloadUrl(plan);
  if (auto) return auto;

  return pinnedOrEnvFallbackUrl();
}

/** Versioni i Setup që shfaqet në webfaqe (p.sh. 1.0.231). */
function getSetupVersion() {
  if (isSetupDownloadPinned()) {
    const fromEnv = process.env.SETUP_VERSION?.trim();
    if (fromEnv) return fromEnv.replace(/^v/i, "");
  } else {
    kickSetupReleaseRefresh();
    const autoVer = cachedSetupVersion();
    if (autoVer) return autoVer.replace(/^v/i, "");
    const fromEnv = process.env.SETUP_VERSION?.trim();
    if (fromEnv) return fromEnv.replace(/^v/i, "");
  }
  const url = getSetupDownloadUrl();
  const m =
    String(url).match(/setup-v?(\d+\.\d+\.\d+)/i) ||
    String(url).match(/\/v?(\d+\.\d+\.\d+)\//) ||
    String(url).match(/(\d+\.\d+\.\d+)/);
  return (m && m[1]) || DEFAULT_SETUP_VERSION;
}

function getPublicAppConfig() {
  let setup_email = false;
  let setup_sms = false;
  try {
    const { setupLinkChannelsStatus } = require("../services/setupLinkRequestService");
    const ch = setupLinkChannelsStatus();
    setup_email = !!ch.email;
    setup_sms = !!ch.sms;
  } catch {
    /* ignore */
  }
  return {
    public_origin: getPublicAppOrigin(),
    support_phone: getSupportPhone(),
    support_phone_digits: getSupportPhoneDigits(),
    support_email: getSupportEmail(),
    setup_version: getSetupVersion(),
    /* Download publik — pa login / pa WhatsApp (aktivizimi mbetet manual) */
    setup_requires_token: false,
    setup_download_configured: true,
    setup_via_email: setup_email,
    setup_via_sms: setup_sms,
    setup_download_url: `${getPublicAppOrigin()}/api/public/setup-download`,
    setup_downloads: null,
  };
}

module.exports = {
  DEFAULT_PUBLIC_ORIGIN,
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SETUP_DOWNLOAD_URL,
  DEFAULT_SETUP_VERSION,
  DEFAULT_SETUP_LINK_TTL_HOURS,
  getPublicAppOrigin,
  getSupportPhone,
  getSupportPhoneDigits,
  getSupportEmail,
  getSetupDownloadUrl,
  getSetupVersion,
  getPublicAppConfig,
  isSetupDownloadPinned,
};
