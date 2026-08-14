const { getSupabase } = require("../db");
const { AI_FEATURES, FEATURE_LABELS, roundMoney } = require("../lib/aiPricing");

function parseMonthParam(monthStr) {
  const raw = String(monthStr || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1;

  if (month < 1 || month > 12) {
    throw new Error("Muaji duhet të jetë në format YYYY-MM (01–12).");
  }

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function emptyBreakdown() {
  const breakdown = {};
  for (const feature of AI_FEATURES) {
    breakdown[feature] = { calls: 0, tokens: 0, cost_eur: 0 };
  }
  return breakdown;
}

function mergeBreakdown(target, source) {
  for (const feature of AI_FEATURES) {
    const src = source?.[feature] || {};
    target[feature].calls += Number(src.calls) || 0;
    target[feature].tokens += Number(src.tokens) || 0;
    target[feature].cost_eur += Number(src.cost_eur) || 0;
  }
}

function finalizeBreakdown(breakdown) {
  for (const feature of AI_FEATURES) {
    breakdown[feature].cost_eur = roundMoney(breakdown[feature].cost_eur);
  }
  return breakdown;
}

async function listAiUsageSummary({ month } = {}) {
  const range = parseMonthParam(month);
  const db = getSupabase();

  const { data: logs, error: logsError } = await db
    .from("ai_usage_logs")
    .select("restaurant_id, feature, feature_type, tokens_used, cost_eur, cost_usd, clients ( id, emri, ai_monthly_token_limit )")
    .gte("created_at", range.startIso)
    .lt("created_at", range.endIso);

  if (logsError) {
    if (logsError.code === "42P01" || /ai_usage_logs/.test(logsError.message || "")) {
      return {
        month: range.month,
        rows: [],
        totals: { calls: 0, tokens_total: 0, cost_eur_total: 0, breakdown: emptyBreakdown() },
        table_missing: true,
      };
    }
    throw logsError;
  }

  const byRestaurant = new Map();

  for (const row of logs || []) {
    const id = row.restaurant_id;
    if (!id) continue;

    let entry = byRestaurant.get(id);
    if (!entry) {
      entry = {
        restaurant_id: id,
        local_name: row.clients?.emri || id,
        token_limit: row.clients?.ai_monthly_token_limit ?? null,
        calls: 0,
        tokens_total: 0,
        cost_eur_total: 0,
        breakdown: emptyBreakdown(),
      };
      byRestaurant.set(id, entry);
    }

    const feature = row.feature || (row.feature_type === "ocr" ? "scan_menu" : "chat");
    const tokens = Number(row.tokens_used) || 0;
    const costEur = Number(row.cost_eur);
    const resolvedCostEur = Number.isFinite(costEur)
      ? costEur
      : roundMoney((Number(row.cost_usd) || 0) * 0.92);

    entry.calls += 1;
    entry.tokens_total += tokens;
    entry.cost_eur_total += resolvedCostEur;

    if (entry.breakdown[feature]) {
      entry.breakdown[feature].calls += 1;
      entry.breakdown[feature].tokens += tokens;
      entry.breakdown[feature].cost_eur += resolvedCostEur;
    }
  }

  const rows = [...byRestaurant.values()]
    .map((row) => {
      finalizeBreakdown(row.breakdown);
      row.cost_eur_total = roundMoney(row.cost_eur_total);
      row.tokens_remaining =
        row.token_limit != null && row.token_limit > 0
          ? Math.max(0, row.token_limit - row.tokens_total)
          : null;
      return row;
    })
    .sort((a, b) => a.local_name.localeCompare(b.local_name, "sq"));

  const totals = {
    calls: 0,
    tokens_total: 0,
    cost_eur_total: 0,
    breakdown: emptyBreakdown(),
  };

  for (const row of rows) {
    totals.calls += row.calls;
    totals.tokens_total += row.tokens_total;
    totals.cost_eur_total += row.cost_eur_total;
    mergeBreakdown(totals.breakdown, row.breakdown);
  }
  totals.cost_eur_total = roundMoney(totals.cost_eur_total);
  finalizeBreakdown(totals.breakdown);

  return { month: range.month, rows, totals, table_missing: false };
}

function aiUsageRowsToCsv(rows) {
  const featureHeaders = AI_FEATURES.flatMap((f) => [
    `${f} calls`,
    `${f} tokens`,
    `${f} EUR`,
  ]);
  const header = [
    "Lokal",
    "Total Calls",
    "Total Tokens",
    "Total EUR",
    "Limit Tokens",
    "Tokens mbetur",
    ...featureHeaders,
  ].join(",");

  const lines = rows.map((row) => {
    const name = String(row.local_name || "").replace(/"/g, '""');
    const featureCells = AI_FEATURES.flatMap((f) => {
      const item = row.breakdown?.[f] || {};
      return [item.calls || 0, item.tokens || 0, (item.cost_eur || 0).toFixed(6)];
    });
    return [
      `"${name}"`,
      row.calls || 0,
      row.tokens_total || 0,
      (row.cost_eur_total || 0).toFixed(6),
      row.token_limit ?? "",
      row.tokens_remaining ?? "",
      ...featureCells,
    ].join(",");
  });

  return `${header}\n${lines.join("\n")}\n`;
}

function aiUsageDetailRowsToCsv(rows) {
  const header = "Lokal,Feature,Feature Label,Calls,Tokens,Kosto EUR";
  const detailLines = [];
  for (const row of rows) {
    const name = String(row.local_name || "").replace(/"/g, '""');
    for (const feature of AI_FEATURES) {
      const item = row.breakdown?.[feature];
      if (!item || !item.calls) continue;
      detailLines.push(
        `"${name}",${feature},"${FEATURE_LABELS[feature]}",${item.calls},${item.tokens},${item.cost_eur.toFixed(6)}`,
      );
    }
  }
  return `${header}\n${detailLines.join("\n")}\n`;
}

async function getAiUsageForRestaurant(restaurantId, { month } = {}) {
  const summary = await listAiUsageSummary({ month });
  const id = String(restaurantId || "").trim();
  const row = (summary.rows || []).find((r) => String(r.restaurant_id) === id);
  if (!row) {
    return {
      ok: true,
      month: summary.month,
      restaurant_id: id,
      calls: 0,
      tokens_total: 0,
      cost_eur_total: 0,
      token_limit: null,
      tokens_remaining: null,
      breakdown: emptyBreakdown(),
      table_missing: !!summary.table_missing,
    };
  }
  return {
    ok: true,
    month: summary.month,
    restaurant_id: row.restaurant_id,
    local_name: row.local_name,
    calls: row.calls,
    tokens_total: row.tokens_total,
    cost_eur_total: row.cost_eur_total,
    token_limit: row.token_limit,
    tokens_remaining: row.tokens_remaining,
    breakdown: row.breakdown,
    table_missing: !!summary.table_missing,
  };
}

module.exports = {
  parseMonthParam,
  listAiUsageSummary,
  getAiUsageForRestaurant,
  aiUsageRowsToCsv,
  aiUsageDetailRowsToCsv,
  FEATURE_LABELS,
};
