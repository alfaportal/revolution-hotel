const express = require("express");
const { trimEnv } = require("../lib/env");
const { validateLicense } = require("../services/licenseService");
const { isTelegramConfigured, sendTelegramMessage } = require("../services/telegramService");
const { isTelegramBotPaused, botPauseUntilLabel } = require("../lib/botPause");
const { appendSystemFailure } = require("../services/systemFailureLog");

const router = express.Router();

const recentAlerts = new Map();
const ALERT_DEDUPE_MS = 5 * 60 * 1000;

function clientIp(req) {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || req.ip || "";
}

function getAlertChatId() {
  return trimEnv("TELEGRAM_ALERT_CHAT_ID") || trimEnv("TELEGRAM_SUPER_ADMIN_CHAT_ID");
}

async function notifySuperAdmin(text) {
  if (isTelegramBotPaused()) {
    console.log("[system] Telegram alert skipped — BOT pauzuar deri", botPauseUntilLabel());
    return false;
  }
  const chatId = getAlertChatId();
  if (!isTelegramConfigured() || !chatId) {
    console.warn("[system] Telegram alert skipped — TELEGRAM_BOT_TOKEN ose TELEGRAM_ALERT_CHAT_ID mungon.");
    return false;
  }
  await sendTelegramMessage(chatId, text);
  return true;
}

function shouldSendAlert(key) {
  const now = Date.now();
  const last = recentAlerts.get(key) || 0;
  if (now - last < ALERT_DEDUPE_MS) return false;
  recentAlerts.set(key, now);
  return true;
}

/**
 * POST /api/v1/system/outage-alert
 * POS raporton offline/online — njofton Super Admin (Telegram).
 */
router.post("/outage-alert", async (req, res) => {
  try {
    const { celesi, license_key, device_id, event, message, servers_tried, active_server } = req.body || {};
    const key = celesi || license_key;
    let clientLabel = "POS i panjohur";

    if (key) {
      const licenseResult = await validateLicense({
        celesi: key,
        device_id,
        client_ip: clientIp(req),
      }).catch(() => ({ valid: false }));

      if (licenseResult?.valid) {
        clientLabel = licenseResult.client_name || licenseResult.client_id || clientLabel;
      }
    }

    const eventKey = `${event || "unknown"}:${clientLabel}:${device_id || "nodevice"}`;
    if (shouldSendAlert(eventKey)) {
      const tried = Array.isArray(servers_tried)
        ? servers_tried.map(s => `${s.url || s.server || "?"} (${s.error || (s.db_ok ? "OK" : "fail")})`).join("\n")
        : "";
      const lines = [
        event === "cloud_online" ? "✅ KAFENE — cloud rilidhur" : "🚨 KAFENE — cloud offline",
        `Klienti: ${clientLabel}`,
        device_id ? `Pajisja: ${device_id}` : "",
        active_server ? `Server aktiv: ${active_server}` : "",
        message ? `Mesazh: ${message}` : "",
        tried ? `Serverët e provuar:\n${tried}` : "",
        `Koha: ${new Date().toISOString()}`,
      ].filter(Boolean);
      appendSystemFailure({
        source: "kafene",
        event: event || "outage",
        message: `${clientLabel} — ${event || "outage"}`,
        detail: { device_id, active_server, servers_tried },
      });
      await notifySuperAdmin(lines.join("\n"));
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

module.exports = {
  router,
  notifySuperAdmin,
  shouldSendAlert,
};
