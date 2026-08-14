const { trimEnv } = require("./env");

/**
 * Pauzë BOT (Telegram alerts + SMS) — e zgjatur derisa ta hapësh me
 * TELEGRAM_BOT_PAUSED=0 / BOT_PAUSED=0 në Railway.
 */
const DEFAULT_BOT_PAUSE_UNTIL = "2026-12-31T23:59:59+02:00";

/**
 * @param {"SMS_PAUSED"|"TELEGRAM_BOT_PAUSED"|"BOT_PAUSED"} envKey
 */
function isBotChannelPaused(envKey) {
  const forced = String(trimEnv(envKey) || trimEnv("BOT_PAUSED") || "").toLowerCase();
  if (forced === "0" || forced === "false" || forced === "off") return false;
  if (forced === "1" || forced === "true" || forced === "on") return true;
  const untilRaw =
    trimEnv("BOT_PAUSED_UNTIL") ||
    trimEnv("SMS_PAUSED_UNTIL") ||
    trimEnv("TELEGRAM_BOT_PAUSED_UNTIL") ||
    DEFAULT_BOT_PAUSE_UNTIL;
  const until = Date.parse(untilRaw);
  return Number.isFinite(until) && Date.now() < until;
}

function isSmsPaused() {
  return isBotChannelPaused("SMS_PAUSED");
}

function isTelegramBotPaused() {
  return isBotChannelPaused("TELEGRAM_BOT_PAUSED");
}

function botPauseUntilLabel() {
  return (
    trimEnv("BOT_PAUSED_UNTIL") ||
    trimEnv("SMS_PAUSED_UNTIL") ||
    trimEnv("TELEGRAM_BOT_PAUSED_UNTIL") ||
    DEFAULT_BOT_PAUSE_UNTIL
  );
}

module.exports = {
  DEFAULT_BOT_PAUSE_UNTIL,
  isSmsPaused,
  isTelegramBotPaused,
  botPauseUntilLabel,
};
