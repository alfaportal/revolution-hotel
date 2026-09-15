const { getSupabase } = require("../db");
const { getClientById } = require("./salesService");
const { parseMonthParam } = require("./aiUsageReportService");

async function getClientMonthlyTokenUsage(restaurantId, month) {
  const range = parseMonthParam(month);
  const db = getSupabase();
  const { data, error } = await db
    .from("ai_usage_logs")
    .select("tokens_used")
    .eq("restaurant_id", restaurantId)
    .gte("created_at", range.startIso)
    .lt("created_at", range.endIso);

  if (error) {
    if (error.code === "42P01" || /ai_usage_logs/.test(error.message || "")) return 0;
    throw error;
  }

  return (data || []).reduce((sum, row) => sum + (Number(row.tokens_used) || 0), 0);
}

async function assertAiTokenLimit(restaurantId) {
  const client = await getClientById(restaurantId);
  const limit = client?.ai_monthly_token_limit;
  if (limit == null || limit <= 0) {
    return { ok: true, tokens_used: 0, tokens_limit: null };
  }

  const used = await getClientMonthlyTokenUsage(restaurantId);
  if (used >= limit) {
    const err = new Error(
      `Limiti mujor i tokenëve AI (${Number(limit).toLocaleString("sq-AL")}) u arrit. Kontaktoni Revolution POS.`,
    );
    err.code = "AI_TOKEN_LIMIT_EXCEEDED";
    err.tokens_used = used;
    err.tokens_limit = limit;
    throw err;
  }

  return { ok: true, tokens_used: used, tokens_limit: limit };
}

module.exports = {
  getClientMonthlyTokenUsage,
  assertAiTokenLimit,
};
