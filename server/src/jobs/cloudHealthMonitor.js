const { testSupabaseConnection } = require("../db");
const { notifySuperAdmin, shouldSendAlert } = require("../routes/system");
const { appendSystemFailure } = require("../services/systemFailureLog");

let lastDbOk = null;

async function runCloudHealthCheck() {
  const result = await testSupabaseConnection();
  const ok = !!result.ok;

  if (lastDbOk === null) {
    lastDbOk = ok;
    if (!ok) {
      console.warn("[health] Supabase nuk përgjigjet në start:", result.error || result.gabim);
    }
    return { ok, changed: false };
  }

  if (ok === lastDbOk) {
    return { ok, changed: false };
  }

  lastDbOk = ok;
  const key = ok ? "supabase_recovered" : "supabase_down";

  if (shouldSendAlert(key)) {
    const text = ok
      ? "✅ Supabase — databaza u rikthye.\nRailway cache/sync vazhdon normalisht."
      : [
          "🚨 Supabase — databaza nuk përgjigjet!",
          result.error || result.gabim || "health/db dështoi",
          "Railway vazhdon me cache lokal ku është e mundur.",
          `Koha: ${new Date().toISOString()}`,
        ].join("\n");
    appendSystemFailure({
      source: "health",
      event: ok ? "supabase_recovered" : "supabase_down",
      message: ok ? "Supabase u rikthye" : (result.error || result.gabim || "Supabase down"),
    });
    await notifySuperAdmin(text).catch(err => {
      console.error("[health] Telegram:", err.message || err);
    });
  }

  console.log(ok ? "[health] Supabase OK" : "[health] Supabase DOWN");
  return { ok, changed: true };
}

function startCloudHealthMonitor() {
  const INTERVAL_MS = 5 * 60 * 1000;
  runCloudHealthCheck().catch(err => {
    console.error("[health] cloudHealthMonitor:", err.message || err);
  });
  setInterval(() => {
    runCloudHealthCheck().catch(err => {
      console.error("[health] cloudHealthMonitor:", err.message || err);
    });
  }, INTERVAL_MS);
  console.log("  ⏰ Health monitor Supabase: çdo 5 min (+ Telegram nëse bie)");
}

module.exports = {
  runCloudHealthCheck,
  startCloudHealthMonitor,
};
