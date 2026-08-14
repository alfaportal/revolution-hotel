const { getSupabase } = require("../db");
const { isAiPaused } = require("../lib/aiConfig");
const { anthropicText } = require("../lib/anthropicText");
const { insertAiUsageLog } = require("./aiUsageService");
const { listIngredients, listInventoryAlerts } = require("./inventoryService");
const { getOwnerReport, normalizeItems } = require("./salesService");
const { resolveOwnerEmail } = require("./stockService");
const { isEmailConfigured, sendLowStockCriticalEmail } = require("./emailService");
const { getZonedParts } = require("./aiDailyReportService");
const { analyzeLowStockIngredients } = require("./supplySuggestionService");

function roundQty(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function dateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Parashikim stoku nga shitjet 30-ditore + inventari aktual.
 */
async function buildStockPredictPayload(clientId, { days = 30 } = {}) {
  const to = getZonedParts().date;
  const from = dateDaysAgo(days);
  const [report, ingredients, alerts, lowStock] = await Promise.all([
    getOwnerReport(clientId, from, to).catch(() => null),
    listIngredients(clientId).catch(() => []),
    listInventoryAlerts(clientId).catch(() => []),
    analyzeLowStockIngredients(clientId).catch(() => []),
  ]);

  const soldByName = new Map();
  for (const order of report?.orders || []) {
    for (const item of normalizeItems(order.items_json)) {
      const key = String(item.name || "").trim().toLowerCase();
      if (!key) continue;
      const prev = soldByName.get(key) || { name: item.name, quantity: 0, revenue: 0 };
      prev.quantity += Number(item.quantity) || 0;
      prev.revenue += (Number(item.quantity) || 0) * (Number(item.price) || 0);
      soldByName.set(key, prev);
    }
  }

  const topSold = [...soldByName.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 25)
    .map((r) => ({
      name: r.name,
      quantity_30d: roundQty(r.quantity),
      avg_per_day: roundQty(r.quantity / Math.max(1, days)),
      revenue_30d: Math.round(r.revenue * 100) / 100,
    }));

  const critical = (ingredients || [])
    .map((ing) => {
      const qty = roundQty(ing.quantity);
      const min = roundQty(ing.min_quantity);
      const matched = topSold.find(
        (t) => t.name.toLowerCase().includes(String(ing.name || "").toLowerCase()) ||
          String(ing.name || "").toLowerCase().includes(t.name.toLowerCase()),
      );
      const burn = matched ? matched.avg_per_day : 0;
      const days_left = burn > 0 ? Math.round((qty / burn) * 10) / 10 : qty <= min && min > 0 ? 0 : null;
      const recommend_order =
        min > 0 && qty <= min
          ? roundQty(Math.max(min - qty, min))
          : burn > 0 && days_left != null && days_left < 3
            ? roundQty(burn * 7)
            : 0;
      return {
        ingredient_id: ing.id,
        name: ing.name,
        unit: ing.unit,
        current_quantity: qty,
        min_quantity: min,
        avg_daily_use: burn,
        days_left,
        recommend_order,
        critical: (min > 0 && qty <= min) || (days_left != null && days_left <= 2),
      };
    })
    .filter((r) => r.critical || r.recommend_order > 0)
    .sort((a, b) => (a.days_left ?? 99) - (b.days_left ?? 99));

  return {
    days,
    from,
    to,
    sales_total: report?.total ?? report?.totals?.total ?? 0,
    order_count: (report?.orders || []).length,
    top_sold: topSold.slice(0, 10),
    critical_items: critical,
    low_stock_ingredients: lowStock,
    alert_count: (alerts || []).length,
  };
}

async function generateStockPredict(clientId, clientName = "", { days = 30, sendEmail = true } = {}) {
  if (isAiPaused()) throw new Error("AI është i ndalur për momentin.");

  const payload = await buildStockPredictPayload(clientId, { days });
  const hasStock = (payload.critical_items || []).length > 0 || (payload.low_stock_ingredients || []).length > 0;
  const hasSales = Number(payload.order_count) > 0 || (payload.top_sold || []).length > 0;
  if (!hasStock && !hasSales) {
    return {
      ok: true,
      no_data: true,
      ...payload,
      analysis_text:
        "Nuk ka të dhëna stoku ose shitjesh për analizë. Shtoni inventar / mbyllni disa porosi, pastaj provo përsëri.",
      tokens_used: 0,
      usage: { tokens_used: 0 },
    };
  }

  let ai;
  try {
    ai = await anthropicText({
      system:
        "Je këshilltar stoku për Revolution POS. Shkruaj në shqip, pa markdown. " +
        "Trego cilat produkte po mbarojnë, sa duhet porositur, dhe prioritetet.",
      prompt:
        `Analizo stokun dhe shitjet e ${days} ditëve për ${clientName || "lokalin"}:\n` +
        JSON.stringify(payload, null, 2),
      temperature: 0.3,
    });
  } catch (err) {
    const msg = String(err.message || err);
    if (/ANTHROPIC_API_KEY/i.test(msg)) {
      throw new Error("ANTHROPIC_API_KEY mungon në Railway. Vendoseni te Variables dhe ridëploy.");
    }
    throw new Error(`Analiza AI dështoi: ${msg}`);
  }

  await insertAiUsageLog({
    restaurantId: clientId,
    feature: "stock_predict",
    tokensUsed: ai.tokensUsed,
  }).catch((e) => console.warn("[stock-predict] usage log:", e.message));

  let emailResult = null;
  const critical = payload.critical_items.filter((c) => c.critical);
  if (sendEmail && critical.length && isEmailConfigured()) {
    const to = await resolveOwnerEmail(clientId).catch(() => null);
    if (to) {
      emailResult = await sendLowStockCriticalEmail({
        to,
        clientName,
        items: critical.slice(0, 15),
        analysisText: ai.text,
      }).catch((err) => ({ error: err.message }));
    }
  }

  return {
    ok: true,
    ...payload,
    analysis_text: ai.text,
    tokens_used: ai.tokensUsed,
    usage: { tokens_used: ai.tokensUsed, model: ai.model, provider: ai.provider },
    email: emailResult,
  };
}

module.exports = {
  buildStockPredictPayload,
  generateStockPredict,
};
