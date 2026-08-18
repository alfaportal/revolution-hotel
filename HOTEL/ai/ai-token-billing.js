/**
 * AI faturimi — FIKUR për hotel (pa cloud / pa tokena kafene).
 */
function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function getUsageSummary(_db, { month } = {}) {
  const m = month || currentMonth();
  return {
    ok: true,
    enabled: false,
    month: m,
    lokal_id: null,
    calls: 0,
    tokens_total: 0,
    cost_eur_total: 0,
    token_limit: null,
    tokens_remaining: null,
    breakdown: {},
    gabim: "AI do të aktivizohet kur hoteli të lidhet me cloud",
  };
}

function formatUsageLine(_summary) {
  return "AI do të aktivizohet kur hoteli të lidhet me cloud";
}

module.exports = {
  currentMonth,
  getUsageSummary,
  formatUsageLine,
  init() {
    /* no-op */
  },
};
