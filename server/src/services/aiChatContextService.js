const { getClientById } = require("./salesService");
const {
  buildDailyReportPayload,
  getTodayReport,
  getZonedParts,
} = require("./aiDailyReportService");
const { getSuggestionsByDate } = require("./supplySuggestionService");
const { computeWaiterRefuseStats } = require("./aiWaiterRatingService");
const { buildStockPredictPayload } = require("./aiStockPredictService");

async function buildOwnerChatContext(clientId, { category = "general" } = {}) {
  const today = getZonedParts().date;
  const client = await getClientById(clientId).catch(() => null);
  const cat = String(category || "general").toLowerCase();

  const [payload, aiReport, supplySuggestions] = await Promise.all([
    buildDailyReportPayload(clientId, today).catch(() => null),
    getTodayReport(clientId).catch(() => null),
    getSuggestionsByDate(clientId, today).catch(() => []),
  ]);

  const base = {
    business_name: client?.emri || "",
    date: today,
    category: cat,
    sales_today: payload?.sales
      ? {
          total_revenue: payload.sales.total_revenue,
          order_count: payload.sales.order_count,
          by_payment: payload.sales.by_payment,
        }
      : null,
    top_items: (payload?.top_items || []).slice(0, 5),
    profit_estimate: payload?.profit || null,
    low_stock: payload?.low_stock || null,
    ai_daily_report: aiReport?.summary_text || null,
    supply_suggestions: (supplySuggestions || []).slice(0, 8).map((s) => ({
      name: s.item_name,
      order_quantity: s.order_quantity,
      unit: s.unit,
      supplier: s.last_supplier || "",
    })),
  };

  if (cat === "kamarieret" || cat === "waiters" || cat === "general") {
    const waiters = await computeWaiterRefuseStats(clientId, { days: 14 }).catch(() => null);
    if (waiters) {
      base.waiter_ratings = {
        totals: waiters.totals,
        top: (waiters.waiters || []).slice(0, 8),
      };
    }
  }

  if (cat === "stoku" || cat === "stock" || cat === "general") {
    const stock = await buildStockPredictPayload(clientId, { days: 30 }).catch(() => null);
    if (stock) {
      base.stock_predict = {
        critical_items: (stock.critical_items || []).slice(0, 10),
        top_sold: (stock.top_sold || []).slice(0, 5),
      };
    }
  }

  if (cat === "shitjet" || cat === "sales") {
    base.focus = "sales";
  }

  return base;
}

module.exports = {
  buildOwnerChatContext,
};
