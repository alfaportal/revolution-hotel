const express = require("express");
const { trimEnv } = require("../lib/env");
const { processTelegramUpdate } = require("../services/telegramBotService");
const { appendSystemFailure } = require("../services/systemFailureLog");
const { isTelegramBotPaused } = require("../lib/botPause");

const router = express.Router();

function verifyWebhookSecret(req) {
  const secret = trimEnv("TELEGRAM_WEBHOOK_SECRET");
  if (!secret) return true;
  return req.get("X-Telegram-Bot-Api-Secret-Token") === secret;
}

/**
 * POST /api/telegram/webhook
 * Telegram dërgon update vetëm kur vjen mesazh — zero polling.
 */
router.post("/webhook", (req, res) => {
  if (isTelegramBotPaused()) {
    return res.status(200).json({ ok: true, paused: true });
  }
  if (!verifyWebhookSecret(req)) {
    return res.status(403).json({ ok: false, gabim: "Webhook secret i pavlefshëm." });
  }

  res.status(200).json({ ok: true });

  const update = req.body;
  setImmediate(() => {
    processTelegramUpdate(update).catch(err => {
      appendSystemFailure({
        source: "telegram",
        event: "webhook_error",
        message: err.message || String(err),
      });
      console.error("[telegram-bot] webhook:", err.message || err);
    });
  });
});

module.exports = router;
