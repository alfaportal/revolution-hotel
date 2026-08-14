const { trimEnv } = require("../lib/env");

function getTelegramBotToken() {
  return trimEnv("TELEGRAM_BOT_TOKEN");
}

function isTelegramConfigured() {
  return Boolean(getTelegramBotToken());
}

async function callTelegramApi(method, body = {}) {
  const token = getTelegramBotToken();
  if (!token) {
    throw new Error("Telegram nuk është i konfiguruar (TELEGRAM_BOT_TOKEN).");
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.description || `Telegram gabim (${res.status})`);
  }
  return data;
}

async function sendTelegramMessage(chatId, text) {
  const chat = String(chatId || "").trim();
  if (!chat) throw new Error("Mungon Telegram Chat ID.");

  return callTelegramApi("sendMessage", {
    chat_id: chat,
    text: String(text || "").slice(0, 4000),
    disable_web_page_preview: true,
  });
}

module.exports = {
  getTelegramBotToken,
  isTelegramConfigured,
  callTelegramApi,
  sendTelegramMessage,
};
