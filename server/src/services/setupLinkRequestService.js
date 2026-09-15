/**
 * Kërkesë publike për link Setup (email / SMS) — me rate-limit.
 * SMS: Vonage opsional; pa të — njoftim te admin (email/Telegram) për dërgim me numër Kosove.
 */
const {
  createSetupDownloadToken,
  isSetupDownloadConfigured,
} = require("../lib/setupDownloadAuth");
const { getPublicAppOrigin, getSetupVersion } = require("../lib/publicOrigin");
const {
  deliverEmail,
  isEmailConfigured,
  resolveAdminNotifyEmail,
} = require("./emailService");
const { sendSms, isSmsConfigured } = require("./smsService");

const IP_WINDOW_MS = 60 * 60 * 1000;
const IP_MAX = 5;
const DEST_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEST_MAX = 5;
const { DEFAULT_SETUP_LINK_TTL_HOURS } = require("../lib/publicOrigin");
const TOKEN_TTL_HOURS = DEFAULT_SETUP_LINK_TTL_HOURS;

/** @type {Map<string, number[]>} */
const hitsByKey = new Map();

function prune(timestamps, windowMs) {
  const cutoff = Date.now() - windowMs;
  return timestamps.filter((t) => t > cutoff);
}

function allowHit(key, windowMs, max) {
  const prev = prune(hitsByKey.get(key) || [], windowMs);
  if (prev.length >= max) {
    hitsByKey.set(key, prev);
    return false;
  }
  prev.push(Date.now());
  hitsByKey.set(key, prev);
  return true;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

/**
 * Vetëm numra të Kosovës (+383).
 * Pranon: +38348…, 38348…, 048…, 48…
 */
function normalizeKosovoPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("383")) {
    /* ok */
  } else if (d.startsWith("0") && d.length >= 9) {
    d = `383${d.slice(1)}`;
  } else if (d.length === 8 || d.length === 9) {
    /* 48xxxxxx / 049xxxxxx */
    d = `383${d}`;
  } else {
    return "";
  }
  if (!d.startsWith("383") || d.length < 11 || d.length > 12) return "";
  return `+${d}`;
}

function isSmsChannelAvailable() {
  /* Pa Vonage: admin merr njoftim dhe dërgon SMS nga numri i Kosovës */
  return isSmsConfigured() || isEmailConfigured();
}

function buildSetupUrl(plan = "") {
  const token = createSetupDownloadToken({ ttlHours: TOKEN_TTL_HOURS, plan });
  const origin = getPublicAppOrigin();
  const qs = new URLSearchParams({ t: token });
  if (plan) qs.set("plan", String(plan).toLowerCase());
  return `${origin}/api/public/setup-download?${qs.toString()}`;
}

async function sendSetupLinkEmail({ to, url, lang = "sq" }) {
  const version = getSetupVersion();
  const en = lang === "en";
  const subject = en
    ? `Official Revolution POS Setup download (v${version})`
    : `Link zyrtar Setup Revolution POS (v${version})`;
  const text = en
    ? [
        "Your official protected Setup download link:",
        "",
        url,
        "",
        `Version: v${version}`,
        `Expires in about ${TOKEN_TTL_HOURS} hours.`,
        "",
        "Do not share this link publicly. Download only on your PC.",
      ].join("\n")
    : [
        "Linku juaj zyrtar i mbrojtur për shkarkim Setup:",
        "",
        url,
        "",
        `Versioni: v${version}`,
        `Skadon për rreth ${TOKEN_TTL_HOURS} orë.`,
        "",
        "Mos e shpërndani publikisht. Shkarkoni vetëm në kompjuterin tuaj.",
      ].join("\n");
  const html = en
    ? `<p>Your official protected <strong>Setup</strong> download link:</p>
       <p><a href="${url}">Download Setup v${version}</a></p>
       <p style="color:#666;font-size:13px">Expires in about ${TOKEN_TTL_HOURS} hours. Do not share publicly.</p>`
    : `<p>Linku juaj zyrtar i mbrojtur për <strong>Setup</strong>:</p>
       <p><a href="${url}">Shkarko Setup v${version}</a></p>
       <p style="color:#666;font-size:13px">Skadon për rreth ${TOKEN_TTL_HOURS} orë. Mos e shpërndani publikisht.</p>`;
  return deliverEmail({ to, subject, text, html });
}

async function notifyAdminToSmsKosovo({ phone, url, lang = "sq" }) {
  const version = getSetupVersion();
  const to = resolveAdminNotifyEmail();
  const smsBody =
    lang === "en"
      ? `Revolution POS Setup v${version}: ${url} (~${TOKEN_TTL_HOURS}h)`
      : `Revolution POS Setup v${version}: ${url} (skadon ~${TOKEN_TTL_HOURS}h)`;
  const subject = `SMS Setup → ${phone}`;
  const text = [
    "Klienti kërkoi Setup me SMS (numër Kosove).",
    "",
    `Dërgo SMS te: ${phone}`,
    "",
    "Teksti i SMS:",
    smsBody,
    "",
    `(Pa Vonage — dërgo nga telefoni yt +383.)`,
  ].join("\n");
  const html = `
    <p><strong>Klienti kërkoi Setup me SMS</strong> (numër Kosove).</p>
    <p>Dërgo SMS te: <a href="sms:${phone}?body=${encodeURIComponent(smsBody)}"><strong>${phone}</strong></a></p>
    <p>Teksti:</p>
    <pre style="white-space:pre-wrap;background:#f1f5f9;padding:12px;border-radius:8px">${smsBody}</pre>
    <p style="color:#666;font-size:13px">Pa Vonage — dërgo nga telefoni yt i Kosovës.</p>
  `;
  await deliverEmail({ to, subject, text, html });

  try {
    const { isTelegramConfigured, sendTelegramMessage } = require("./telegramService");
    const chatId =
      process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() ||
      process.env.TELEGRAM_NOTIFY_CHAT_ID?.trim() ||
      "";
    if (chatId && isTelegramConfigured()) {
      await sendTelegramMessage(
        chatId,
        `📱 Setup SMS → ${phone}\n${smsBody}`,
      );
    }
  } catch (e) {
    console.warn("[setup-link] telegram admin:", e.message || e);
  }
}

/**
 * @param {{ channel: 'email'|'sms', email?: string, phone?: string, plan?: string, lang?: string, ip?: string }} opts
 */
async function requestSetupLink(opts = {}) {
  const channel = String(opts.channel || "").toLowerCase();
  const lang = opts.lang === "en" ? "en" : "sq";
  const plan = String(opts.plan || "").trim().toLowerCase().slice(0, 8);
  const ip = String(opts.ip || "unknown").slice(0, 64);

  if (!isSetupDownloadConfigured()) {
    const err = new Error(
      lang === "en"
        ? "Setup download is not configured on the server."
        : "Shkarkimi i Setup nuk është i konfiguruar në server.",
    );
    err.code = "SETUP_SECRET_MISSING";
    throw err;
  }

  if (channel !== "email" && channel !== "sms") {
    const err = new Error(
      lang === "en" ? "Choose email or SMS." : "Zgjidhni email ose SMS.",
    );
    err.code = "BAD_CHANNEL";
    throw err;
  }

  if (!allowHit(`ip:${ip}`, IP_WINDOW_MS, IP_MAX)) {
    const err = new Error(
      lang === "en"
        ? "Too many requests from this network. Try again later."
        : "Shumë kërkesa nga kjo rrjetë. Provoni më vonë.",
    );
    err.code = "RATE_LIMIT";
    throw err;
  }

  const url = buildSetupUrl(plan);

  if (channel === "email") {
    if (!isEmailConfigured()) {
      const err = new Error(
        lang === "en"
          ? "Email is not available right now. Use SMS or WhatsApp."
          : "Emaili nuk është i disponueshëm tani. Përdorni SMS ose WhatsApp.",
      );
      err.code = "EMAIL_OFF";
      throw err;
    }
    const email = String(opts.email || "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      const err = new Error(
        lang === "en" ? "Enter a valid email." : "Vendosni një email të vlefshëm.",
      );
      err.code = "BAD_EMAIL";
      throw err;
    }
    if (!allowHit(`email:${email}`, DEST_WINDOW_MS, DEST_MAX)) {
      const err = new Error(
        lang === "en"
          ? "Too many emails to this address today. Try again tomorrow."
          : "Shumë email te kjo adresë sot. Provoni nesër.",
      );
      err.code = "RATE_LIMIT";
      throw err;
    }
    await sendSetupLinkEmail({ to: email, url, lang });
    return {
      ok: true,
      channel: "email",
      message:
        lang === "en"
          ? "Setup link sent to your email. Check inbox (and spam)."
          : "Linku i Setup u dërgua në email. Kontrolloni inbox (dhe spam).",
    };
  }

  /* ——— SMS (vetëm +383) ——— */
  if (!isSmsChannelAvailable()) {
    const err = new Error(
      lang === "en"
        ? "SMS is not available right now. Use email or WhatsApp."
        : "SMS nuk është i disponueshëm tani. Përdorni email ose WhatsApp.",
    );
    err.code = "SMS_OFF";
    throw err;
  }

  const phone = normalizeKosovoPhone(opts.phone);
  if (!phone) {
    const err = new Error(
      lang === "en"
        ? "Enter a Kosovo mobile number (+383…)."
        : "Vendosni numër celular të Kosovës (+383… ose 04x…).",
    );
    err.code = "BAD_PHONE";
    throw err;
  }
  if (!allowHit(`sms:${phone}`, DEST_WINDOW_MS, DEST_MAX)) {
    const err = new Error(
      lang === "en"
        ? "Too many SMS to this number today. Try again tomorrow."
        : "Shumë SMS te ky numër sot. Provoni nesër.",
    );
    err.code = "RATE_LIMIT";
    throw err;
  }

  const smsText =
    lang === "en"
      ? `Revolution POS Setup v${getSetupVersion()}: ${url} (expires ~${TOKEN_TTL_HOURS}h)`
      : `Revolution POS Setup v${getSetupVersion()}: ${url} (skadon ~${TOKEN_TTL_HOURS}h)`;

  if (isSmsConfigured()) {
    await sendSms(phone, smsText);
    return {
      ok: true,
      channel: "sms",
      message:
        lang === "en"
          ? "Setup link sent by SMS."
          : "Linku i Setup u dërgua me SMS.",
    };
  }

  /* Pa Vonage: njoftim te admin — dërgon SMS nga telefoni i Kosovës */
  await notifyAdminToSmsKosovo({ phone, url, lang });
  return {
    ok: true,
    channel: "sms",
    relay: "admin",
    message:
      lang === "en"
        ? "Request received. You will get the Setup link by SMS on your Kosovo number shortly."
        : "Kërkesa u pranua. Linku i Setup do t’ju vijë me SMS në numrin tuaj të Kosovës së shpejti.",
  };
}

function setupLinkChannelsStatus() {
  return {
    email: isEmailConfigured(),
    sms: isSmsChannelAvailable(),
    sms_auto: isSmsConfigured(),
    download_configured: isSetupDownloadConfigured(),
  };
}

module.exports = {
  requestSetupLink,
  setupLinkChannelsStatus,
  normalizeKosovoPhone,
  TOKEN_TTL_HOURS,
};
