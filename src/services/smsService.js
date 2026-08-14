const { trimEnv } = require("../lib/env");
const { isSmsPaused, botPauseUntilLabel } = require("../lib/botPause");

function getVonageConfig() {
  return {
    apiKey: trimEnv("VONAGE_API_KEY") || trimEnv("NEXMO_API_KEY"),
    apiSecret: trimEnv("VONAGE_API_SECRET") || trimEnv("NEXMO_API_SECRET"),
    from: trimEnv("VONAGE_FROM") || trimEnv("NEXMO_FROM") || "RevolutionPOS",
  };
}

function isSmsConfigured() {
  if (isSmsPaused()) return false;
  const cfg = getVonageConfig();
  return Boolean(cfg.apiKey && cfg.apiSecret);
}

function normalizePhone(number) {
  let n = String(number || "").trim().replace(/[\s()-]/g, "");
  if (!n) return "";
  if (n.startsWith("00")) n = `+${n.slice(2)}`;
  if (!n.startsWith("+")) n = `+${n}`;
  return n;
}

async function sendSms(to, text) {
  if (isSmsPaused()) {
    console.log("[sms] pauzuar deri", botPauseUntilLabel());
    return { status: "paused" };
  }
  const cfg = getVonageConfig();
  if (!cfg.apiKey || !cfg.apiSecret) {
    throw new Error("SMS nuk është i konfiguruar (VONAGE_API_KEY / VONAGE_API_SECRET).");
  }
  const phone = normalizePhone(to);
  if (!phone) throw new Error("Numri i telefonit mungon ose është i pavlefshëm.");

  const body = new URLSearchParams({
    api_key: cfg.apiKey,
    api_secret: cfg.apiSecret,
    to: phone.replace("+", ""),
    from: cfg.from.slice(0, 11),
    text: String(text || "").slice(0, 1500),
  });

  const res = await fetch("https://rest.nexmo.com/sms/json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json().catch(() => ({}));
  const msg = data.messages?.[0];
  if (!res.ok || !msg || msg.status !== "0") {
    throw new Error(msg?.["error-text"] || data["error-text"] || `Vonage gabim (${res.status})`);
  }
  return msg;
}

module.exports = {
  getVonageConfig,
  isSmsConfigured,
  isSmsPaused,
  sendSms,
  normalizePhone,
};
