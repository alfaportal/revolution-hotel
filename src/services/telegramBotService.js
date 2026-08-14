const { trimEnv } = require("../lib/env");
const { getPublicAppOrigin } = require("../lib/publicOrigin");
const { testSupabaseConnection } = require("../db");
const { getSupabase } = require("../db");
const pkg = require("../../package.json");
const { sendTelegramMessage } = require("./telegramService");
const { appendSystemFailure, listSystemFailures } = require("./systemFailureLog");
const { buildDataExportBundle, sendDataExportEmail } = require("../jobs/weeklyDataExport");
const { isEmailConfigured } = require("./emailService");
const {
  isRailwayRestartConfigured,
  getRailwayMeta,
  restartRailwayService,
} = require("./railwayService");

const BACKUP_HEALTH_URL = trimEnv("BACKUP_HEALTH_URL") || "https://backup1.revolution-pos.com/health";
const KAFENE_ONLINE_WINDOW_MS = 10 * 60 * 1000;

function getSuperAdminIds() {
  const raw = trimEnv("TELEGRAM_SUPER_ADMIN_IDS");
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map(s => s.trim())
      .filter(Boolean),
  );
}

function isSuperAdmin(chatId) {
  const ids = getSuperAdminIds();
  if (!ids.size) return false;
  return ids.has(String(chatId || "").trim());
}

function parseCommand(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) return { command: "", args: "" };
  const [head, ...rest] = raw.split(/\s+/);
  const command = head.split("@")[0].toLowerCase();
  return { command, args: rest.join(" ").trim() };
}

async function pingUrl(url, timeoutMs = 8000) {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - start,
      error: err.message || "timeout",
    };
  }
}

async function countKafeneClientsOnline() {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - KAFENE_ONLINE_WINDOW_MS).toISOString();
  const { data, error } = await db
    .from("licenses")
    .select("id, device_id, last_validation_at, clients(emri)")
    .eq("statusi", "aktive")
    .gte("last_validation_at", cutoff);

  if (error) throw error;

  const rows = (data || []).filter(r => String(r.device_id || "").trim());
  const names = rows.map(r => r.clients?.emri || r.device_id || "?");
  return {
    online: rows.length,
    names: names.slice(0, 15),
    window_min: KAFENE_ONLINE_WINDOW_MS / 60000,
  };
}

async function buildStatusMessage() {
  const origin = getPublicAppOrigin();
  const railway = getRailwayMeta();
  const primaryPing = await pingUrl(`${origin}/health`);
  const backupPing = await pingUrl(BACKUP_HEALTH_URL);
  const supabase = await testSupabaseConnection();
  let kafene = { online: 0, names: [], window_min: KAFENE_ONLINE_WINDOW_MS / 60000 };
  try {
    kafene = await countKafeneClientsOnline();
  } catch (err) {
    kafene.error = err.message;
  }

  const lines = [
    "📊 Revolution POS — status",
    "",
    primaryPing.ok
      ? `🟢 Primary (${origin}): OK (${primaryPing.ms}ms)`
      : `🔴 Primary (${origin}): FAIL — ${primaryPing.error || `HTTP ${primaryPing.status}`}`,
    supabase.ok
      ? "🟢 Supabase: OK"
      : `🔴 Supabase: FAIL — ${supabase.error || supabase.gabim || "?"}`,
    backupPing.ok
      ? `🟢 Backup: OK (${backupPing.ms}ms)`
      : `🟡 Backup: ${backupPing.error || `HTTP ${backupPing.status}`}`,
    "",
    `🚂 Railway: ${railway.configured ? "restart i konfiguruar" : "restart nuk është konfiguruar"}`,
    railway.git_commit ? `   commit: ${String(railway.git_commit).slice(0, 8)}` : "",
    `📦 Server v${pkg.version || "?"}`,
    "",
    kafene.error
      ? `📱 KAFENE: gabim leximi (${kafene.error})`
      : `📱 KAFENE online (${kafene.window_min} min): ${kafene.online}`,
  ].filter(Boolean);

  if (kafene.names?.length) {
    lines.push(`   ${kafene.names.join(", ")}${kafene.online > kafene.names.length ? "…" : ""}`);
  }

  lines.push("", `⏱ ${new Date().toISOString()}`);
  return lines.join("\n");
}

function startHelpText() {
  return [
    "👋 Revolution POS Bot",
    "",
    "Komanda (Super Admin):",
    "/status — gjendja e sistemit",
    "/restart — restart Railway",
    "/backup — export CSV manual (email)",
    "/logs — 20 dështimet e fundit",
    "",
    "Vetëm llogaria e autorizuar mund t'i përdorë.",
  ].join("\n");
}

async function handleTelegramCommand(chatId, text) {
  if (!isSuperAdmin(chatId)) {
    await sendTelegramMessage(chatId, "⛔ Nuk keni leje. Vetëm Super Admin.");
    appendSystemFailure({
      source: "telegram",
      event: "unauthorized",
      message: `Komandë e refuzuar nga chat ${chatId}`,
      detail: { text: String(text || "").slice(0, 120) },
    });
    return;
  }

  const { command } = parseCommand(text);

  try {
    if (command === "/start" || command === "/help") {
      await sendTelegramMessage(chatId, startHelpText());
      return;
    }

    if (command === "/status") {
      await sendTelegramMessage(chatId, await buildStatusMessage());
      return;
    }

    if (command === "/restart") {
      if (!isRailwayRestartConfigured()) {
        await sendTelegramMessage(
          chatId,
          "⚠️ Restart nuk është konfiguruar.\nVendos RAILWAY_TOKEN, RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID në Railway.",
        );
        return;
      }
      await sendTelegramMessage(chatId, "🔄 Duke nisur restart Railway…");
      await restartRailwayService();
      appendSystemFailure({
        source: "telegram",
        event: "railway_restart",
        message: "Restart Railway u kërkua nga Super Admin",
        detail: { chat_id: chatId },
      });
      await sendTelegramMessage(chatId, "✅ Railway restart u nis. Shërbimi kthehet pas ~1–2 min.");
      return;
    }

    if (command === "/backup") {
      if (!isEmailConfigured()) {
        await sendTelegramMessage(
          chatId,
          "⚠️ Email nuk është konfiguruar (RESEND_API_KEY).\nBackup CSV nuk mund të dërgohet.",
        );
        return;
      }
      await sendTelegramMessage(chatId, "📦 Duke gjeneruar export CSV…");
      const bundle = await buildDataExportBundle();
      const result = await sendDataExportEmail(bundle);
      appendSystemFailure({
        source: "telegram",
        event: "manual_backup",
        message: `Export CSV manual → ${result.to}`,
        detail: { clients: result.clients, licenses: result.licenses },
      });
      await sendTelegramMessage(
        chatId,
        `✅ Backup CSV u dërgua.\nKlientë: ${result.clients}\nLicenca: ${result.licenses}\nEmail: ${result.to}`,
      );
      return;
    }

    if (command === "/logs") {
      const rows = listSystemFailures(20);
      if (!rows.length) {
        await sendTelegramMessage(chatId, "📋 Nuk ka failures të regjistruara ende.");
        return;
      }
      const body = rows
        .map((r, i) => {
          const detail = r.detail ? ` | ${JSON.stringify(r.detail).slice(0, 80)}` : "";
          return `${i + 1}. [${r.at}] ${r.source}/${r.event}: ${r.message}${detail}`;
        })
        .join("\n");
      await sendTelegramMessage(chatId, `📋 Failures (20 të fundit):\n\n${body}`.slice(0, 4000));
      return;
    }

    if (command.startsWith("/")) {
      await sendTelegramMessage(chatId, "❓ Komandë e panjohur. Përdor /start për listën.");
    }
  } catch (err) {
    appendSystemFailure({
      source: "telegram",
      event: "command_error",
      message: err.message || String(err),
      detail: { command, chat_id: chatId },
    });
    await sendTelegramMessage(chatId, `❌ Gabim: ${err.message || err}`);
  }
}

async function processTelegramUpdate(update) {
  const msg = update?.message;
  if (!msg?.text || msg.chat?.id == null) return;
  await handleTelegramCommand(msg.chat.id, msg.text);
}

module.exports = {
  getSuperAdminIds,
  isSuperAdmin,
  handleTelegramCommand,
  processTelegramUpdate,
  buildStatusMessage,
};
