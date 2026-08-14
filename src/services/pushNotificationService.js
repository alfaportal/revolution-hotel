const { getSupabase } = require("../db");
const { clientHasFeature } = require("../lib/packages");
const { getClientById } = require("./salesService");
const { listInventoryAlerts } = require("./inventoryService");
const { buildDailyReportPayload } = require("./aiDailyReportService");
const { getZonedParts, listEligibleClients } = require("./aiDailyReportService");
const { getNotificationSettings } = require("./notificationSettingsService");
const { sendTelegramMessage, isTelegramConfigured } = require("./telegramService");
const { sendSms, isSmsConfigured } = require("./smsService");
const { isTelegramBotPaused, isSmsPaused } = require("../lib/botPause");
const { ensureNotificationSchema } = require("../lib/ensureNotificationSchema");

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatMoney(n) {
  return `${Number(n || 0).toFixed(2)} EUR`;
}

async function clientCanNotify(clientId) {
  const client = await getClientById(clientId);
  if (!client || !clientHasFeature(client, "ai")) return null;
  return client;
}

async function deliverOwnerMessage(settings, text) {
  const results = { telegram: false, sms: false, errors: [], paused: false };

  if (isTelegramBotPaused() && isSmsPaused()) {
    results.paused = true;
    console.log("[notify] BOT/SMS pauzuar — njoftimi anashkalohet.");
    return results;
  }

  if (settings.telegram_chat_id && isTelegramConfigured() && !isTelegramBotPaused()) {
    try {
      await sendTelegramMessage(settings.telegram_chat_id, text);
      results.telegram = true;
    } catch (err) {
      results.errors.push(`Telegram: ${err.message}`);
    }
  }

  if (settings.sms_number && isSmsConfigured() && !isSmsPaused()) {
    try {
      await sendSms(settings.sms_number, text);
      results.sms = true;
    } catch (err) {
      results.errors.push(`SMS: ${err.message}`);
    }
  }

  if (!results.telegram && !results.sms) {
    if (isTelegramBotPaused() || isSmsPaused()) {
      results.paused = true;
      return results;
    }
    if (!settings.telegram_chat_id && !settings.sms_number) {
      throw new Error("Vendosni Telegram Chat ID ose numrin SMS.");
    }
    throw new Error(results.errors.join(" · ") || "Nuk u dërgua asnjë njoftim.");
  }

  return results;
}

async function markIngredientNotified(clientId, ingredientId) {
  await ensureNotificationSchema();
  const db = getSupabase();
  const { error } = await db.from("ingredient_alert_notifications").upsert(
    {
      restaurant_id: clientId,
      ingredient_id: ingredientId,
      notified_at: new Date().toISOString(),
    },
    { onConflict: "restaurant_id,ingredient_id" },
  );
  if (error && !/duplicate|unique/i.test(String(error.message || ""))) {
    console.warn("[notify] ingredient alert record:", error.message);
  }
}

async function clearIngredientNotification(clientId, ingredientId) {
  await ensureNotificationSchema();
  const db = getSupabase();
  await db
    .from("ingredient_alert_notifications")
    .delete()
    .eq("restaurant_id", clientId)
    .eq("ingredient_id", ingredientId);
}

async function wasIngredientNotified(clientId, ingredientId) {
  await ensureNotificationSchema();
  const db = getSupabase();
  const { data } = await db
    .from("ingredient_alert_notifications")
    .select("id")
    .eq("restaurant_id", clientId)
    .eq("ingredient_id", ingredientId)
    .maybeSingle();
  return Boolean(data);
}

async function maybeNotifyIngredientLowStock(clientId, ingredient) {
  try {
    const client = await clientCanNotify(clientId);
    if (!client) return { skipped: true, reason: "package" };

    const qty = Number(ingredient.quantity);
    const min = Number(ingredient.min_quantity);
    if (!Number.isFinite(min) || min <= 0) return { skipped: true, reason: "no_min" };
    if (qty > min) {
      await clearIngredientNotification(clientId, ingredient.id);
      return { skipped: true, reason: "above_min" };
    }

    const settings = await getNotificationSettings(clientId);
    if (!settings.notify_low_stock) return { skipped: true, reason: "disabled" };

    if (await wasIngredientNotified(clientId, ingredient.id)) {
      return { skipped: true, reason: "already_sent" };
    }

    const text =
      `⚠️ Stok i ulët — ${client.emri || "Restorant"}\n` +
      `Përbërësi: ${ingredient.name}\n` +
      `Sasia: ${qty} ${ingredient.unit} (minimum: ${min})\n` +
      `Revolution POS`;

    const result = await deliverOwnerMessage(settings, text);
    await markIngredientNotified(clientId, ingredient.id);
    return { sent: true, ...result };
  } catch (err) {
    console.warn(`[notify] low stock ${clientId}:`, err.message);
    return { error: err.message };
  }
}

function buildDailyReportMessage(clientName, reportDate, payload, alerts) {
  const sales = payload?.sales || {};
  const profit = payload?.profit || {};
  const lowLines = (alerts || [])
    .slice(0, 5)
    .map(a => `• ${a.name}: ${a.quantity}/${a.min_quantity} ${a.unit}`)
    .join("\n");

  return (
    `📊 Raporti ditor — ${clientName || "Restorant"}\n` +
    `Data: ${reportDate}\n\n` +
    `Shitje: ${formatMoney(sales.total_revenue)} (${sales.order_count || 0} porosi)\n` +
    `Fitim i vlerësuar: ${formatMoney(profit.profit ?? sales.total_revenue)}\n\n` +
    (lowLines ? `Stok i ulët:\n${lowLines}\n\n` : "Stoku i përbërësve: OK\n\n") +
    `Revolution POS`
  );
}

async function markDailyReportSent(clientId, reportDate) {
  await ensureNotificationSchema();
  const db = getSupabase();
  await db.from("daily_report_notifications").upsert(
    {
      restaurant_id: clientId,
      report_date: reportDate,
      sent_at: new Date().toISOString(),
    },
    { onConflict: "restaurant_id,report_date" },
  );
}

async function wasDailyReportSent(clientId, reportDate) {
  await ensureNotificationSchema();
  const db = getSupabase();
  const { data } = await db
    .from("daily_report_notifications")
    .select("restaurant_id")
    .eq("restaurant_id", clientId)
    .eq("report_date", reportDate)
    .maybeSingle();
  return Boolean(data);
}

async function sendDailyReportNotification(clientId, reportDate) {
  const client = await clientCanNotify(clientId);
  if (!client) return { skipped: true, reason: "package" };

  const settings = await getNotificationSettings(clientId);
  if (!settings.notify_daily_report) return { skipped: true, reason: "disabled" };

  if (await wasDailyReportSent(clientId, reportDate)) {
    return { skipped: true, reason: "already_sent" };
  }

  const [payload, alerts] = await Promise.all([
    buildDailyReportPayload(clientId, reportDate),
    listInventoryAlerts(clientId).catch(() => []),
  ]);

  const text = buildDailyReportMessage(client.emri, reportDate, payload, alerts);
  const result = await deliverOwnerMessage(settings, text);
  await markDailyReportSent(clientId, reportDate);
  return { sent: true, ...result };
}

async function processMorningDailyReportNotifications(runDate) {
  const today = runDate || getZonedParts().date;
  const yesterday = addDays(today, -1);
  const clients = await listEligibleClients();

  let sent = 0;
  let skipped = 0;

  for (const client of clients) {
    try {
      const result = await sendDailyReportNotification(client.id, yesterday);
      if (result.sent) sent += 1;
      else skipped += 1;
    } catch (err) {
      console.error(`[notify] daily report ${client.id}:`, err.message);
    }
  }

  console.log(
    `[cron] dailyReportNotify ${yesterday}: sent=${sent} skipped=${skipped} eligible=${clients.length}`,
  );
  return { sent, skipped, report_date: yesterday, eligible: clients.length };
}

async function sendTestNotification(clientId) {
  const client = await clientCanNotify(clientId);
  if (!client) throw new Error("Njoftimet kërkojnë Pako 5 (AI Profesionale).");

  const settings = await getNotificationSettings(clientId);
  const text =
    `✅ Test njoftimi — ${client.emri || "Restorant"}\n` +
    `Telegram dhe/ose SMS funksionojnë.\nRevolution POS`;

  return deliverOwnerMessage(settings, text);
}

module.exports = {
  maybeNotifyIngredientLowStock,
  sendDailyReportNotification,
  processMorningDailyReportNotifications,
  sendTestNotification,
  deliverOwnerMessage,
};
