const { getSupabase } = require("../db");
const { ensureNotificationSchema } = require("../lib/ensureNotificationSchema");
const { isTelegramConfigured } = require("./telegramService");
const { isSmsConfigured } = require("./smsService");

function mapSettings(row) {
  return {
    restaurant_id: row.restaurant_id,
    telegram_chat_id: String(row.telegram_chat_id || "").trim(),
    sms_number: String(row.sms_number || "").trim(),
    notify_low_stock: row.notify_low_stock !== false,
    notify_daily_report: row.notify_daily_report !== false,
    updated_at: row.updated_at,
  };
}

function defaultSettings(restaurantId) {
  return {
    restaurant_id: restaurantId,
    telegram_chat_id: "",
    sms_number: "",
    notify_low_stock: true,
    notify_daily_report: true,
    updated_at: null,
  };
}

async function withSchema(fn) {
  await ensureNotificationSchema();
  try {
    return await fn();
  } catch (err) {
    const msg = String(err?.message || err || "").toLowerCase();
    if (msg.includes("notification_settings") && msg.includes("does not exist")) {
      await ensureNotificationSchema();
      return fn();
    }
    throw err;
  }
}

async function getNotificationSettings(clientId) {
  return withSchema(async () => {
    const db = getSupabase();
    const { data, error } = await db
      .from("notification_settings")
      .select("*")
      .eq("restaurant_id", clientId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return defaultSettings(clientId);
    return mapSettings(data);
  });
}

async function saveNotificationSettings(clientId, body) {
  return withSchema(async () => {
    const db = getSupabase();
    const row = {
      restaurant_id: clientId,
      telegram_chat_id: body?.telegram_chat_id != null
        ? String(body.telegram_chat_id).trim() || null
        : undefined,
      sms_number: body?.sms_number != null ? String(body.sms_number).trim() || null : undefined,
      notify_low_stock: body?.notify_low_stock !== undefined ? !!body.notify_low_stock : undefined,
      notify_daily_report:
        body?.notify_daily_report !== undefined ? !!body.notify_daily_report : undefined,
      updated_at: new Date().toISOString(),
    };

    Object.keys(row).forEach(k => {
      if (row[k] === undefined) delete row[k];
    });

    const { data, error } = await db
      .from("notification_settings")
      .upsert(row, { onConflict: "restaurant_id" })
      .select("*")
      .single();
    if (error) throw error;
    return mapSettings(data);
  });
}

function getNotificationCapabilities() {
  return {
    telegram_configured: isTelegramConfigured(),
    sms_configured: isSmsConfigured(),
  };
}

module.exports = {
  getNotificationSettings,
  saveNotificationSettings,
  getNotificationCapabilities,
  defaultSettings,
};
