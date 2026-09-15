const { getSupabase } = require("../db");
const { getAiConfig, isAiPaused } = require("../lib/aiConfig");
const { clientHasFeature } = require("../lib/packages");
const { getOwnerReport, normalizeItems } = require("./salesService");
const { getStockSummary, listStockForOwner, resolveOwnerEmail } = require("./stockService");
const { listInventoryAlerts } = require("./inventoryService");
const { insertAiUsageLog } = require("./aiUsageService");
const { isEmailConfigured, sendDailyAiReportEmail } = require("./emailService");

const REPORT_TZ = process.env.REPORT_CRON_TZ || "Europe/Belgrade";

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function getZonedParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter(p => p.type !== "literal").map(p => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function aggregateTopItems(orders, limit = 5) {
  const map = new Map();
  for (const order of orders || []) {
    for (const item of normalizeItems(order.items_json)) {
      const key = item.name.toLowerCase();
      const prev = map.get(key) || {
        name: item.name,
        quantity: 0,
        revenue: 0,
      };
      prev.quantity += item.quantity;
      prev.revenue += item.quantity * item.price;
      map.set(key, prev);
    }
  }
  return [...map.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
    .map(row => ({
      name: row.name,
      quantity: row.quantity,
      revenue: roundMoney(row.revenue),
    }));
}

async function estimateDailyProfit(clientId, orders) {
  const revenue = roundMoney((orders || []).reduce((s, o) => s + Number(o.total || 0), 0));
  const db = getSupabase();

  const { data: menuRows, error: menuErr } = await db
    .from("pos_menu_items")
    .select("id, local_id, name, price")
    .eq("client_id", clientId);
  if (menuErr) return { revenue, estimated_cost: 0, profit: revenue, has_cost_data: false };

  const menuIds = new Set((menuRows || []).map(r => r.id));
  if (!menuIds.size) {
    return { revenue, estimated_cost: 0, profit: revenue, has_cost_data: false };
  }

  const { data: recipes, error: recipeErr } = await db
    .from("menu_ingredients")
    .select("menu_item_id, ingredient_id, quantity_used")
    .in("menu_item_id", [...menuIds]);
  if (recipeErr || !recipes?.length) {
    return { revenue, estimated_cost: 0, profit: revenue, has_cost_data: false };
  }

  const ingredientIds = [...new Set(recipes.map(r => r.ingredient_id))];
  const { data: ingredients, error: ingErr } = await db
    .from("ingredients")
    .select("id, cost_per_unit")
    .eq("restaurant_id", clientId)
    .in("id", ingredientIds);
  if (ingErr || !ingredients?.length) {
    return { revenue, estimated_cost: 0, profit: revenue, has_cost_data: false };
  }

  const costByIngredient = new Map(
    ingredients.map(i => [i.id, Number(i.cost_per_unit) || 0]),
  );
  const recipeByMenu = new Map();
  for (const r of recipes) {
    if (!recipeByMenu.has(r.menu_item_id)) recipeByMenu.set(r.menu_item_id, []);
    recipeByMenu.get(r.menu_item_id).push(r);
  }

  function matchMenuRow(item) {
    const name = String(item.name || "").trim().toLowerCase();
    const price = Number(item.price) || 0;
    return (menuRows || []).find(row => {
      const rowName = String(row.name || "").trim().toLowerCase();
      return rowName === name || (rowName && name.includes(rowName)) || Number(row.price) === price;
    });
  }

  let estimatedCost = 0;
  for (const order of orders || []) {
    for (const item of normalizeItems(order.items_json)) {
      const menuRow = matchMenuRow(item);
      if (!menuRow) continue;
      const recipeRows = recipeByMenu.get(menuRow.id) || [];
      for (const rec of recipeRows) {
        const unitCost = costByIngredient.get(rec.ingredient_id) || 0;
        estimatedCost += unitCost * Number(rec.quantity_used || 0) * item.quantity;
      }
    }
  }

  estimatedCost = roundMoney(estimatedCost);
  return {
    revenue,
    estimated_cost: estimatedCost,
    profit: roundMoney(revenue - estimatedCost),
    has_cost_data: estimatedCost > 0,
  };
}

async function buildDailyReportPayload(clientId, reportDate) {
  const report = await getOwnerReport(clientId, reportDate, reportDate);
  const orders = report.orders || [];
  const top_items = aggregateTopItems(orders, 5);
  const profit = await estimateDailyProfit(clientId, orders);
  const [stockSummary, menuStock, ingredientAlerts] = await Promise.all([
    getStockSummary(clientId).catch(() => null),
    listStockForOwner(clientId).catch(() => []),
    listInventoryAlerts(clientId).catch(() => []),
  ]);

  const low_menu_stock = (menuStock || [])
    .filter(i => i.track_stock && (i.stock_status === "low" || i.stock_status === "out"))
    .slice(0, 10)
    .map(i => ({
      name: i.name,
      quantity: i.stock_quantity,
      threshold: i.stock_alert_threshold,
      status: i.stock_status,
    }));

  const low_ingredients = (ingredientAlerts || []).slice(0, 10).map(i => ({
    name: i.name,
    quantity: i.quantity,
    min_quantity: i.min_quantity,
    unit: i.unit,
  }));

  return {
    report_date: reportDate,
    sales: {
      total_revenue: roundMoney(report.total),
      order_count: report.order_count,
      by_payment: summarizePayments(orders),
    },
    top_items,
    profit,
    low_stock: {
      menu_items: low_menu_stock,
      ingredients: low_ingredients,
      summary: stockSummary,
    },
  };
}

function summarizePayments(orders) {
  const map = { cash: 0, card: 0, other: 0 };
  for (const o of orders || []) {
    const method = String(o.payment_method || "other").toLowerCase();
    const total = Number(o.total) || 0;
    if (method === "cash" || method === "para") map.cash += total;
    else if (method === "card" || method === "karte") map.card += total;
    else map.other += total;
  }
  return {
    cash: roundMoney(map.cash),
    card: roundMoney(map.card),
    other: roundMoney(map.other),
  };
}

async function generateAiSummary(clientName, payload) {
  if (isAiPaused()) {
    throw new Error("AI është i ndalur për momentin.");
  }
  const config = getAiConfig();
  if (!config.ready) {
    throw new Error("Raporti AI kërkon ANTHROPIC_API_KEY ose OPENAI_API_KEY.");
  }

  const prompt =
    `Shkruaj një raport ditor të shkurtër në shqip për pronarin e ${clientName || "restorantit"}.\n` +
    `Përdor vetëm të dhënat JSON më poshtë. Strukturo: 1) përmbledhje e shitjeve, 2) top 5 artikuj, 3) stok i ulët (nëse ka), 4) fitim i vlerësuar.\n` +
    `Ton profesional, 4–8 fjali, pa markdown.\n\n` +
    JSON.stringify(payload, null, 2);

  if (config.provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        system:
          "Je analist i Revolution POS. Shkruan raporte ditore të qarta për pronarë restorantesh në shqip.",
        messages: [{ role: "user", content: prompt }],
        max_tokens: Math.min(2048, config.maxTokens * 2),
        temperature: 0.3,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Anthropic gabim (${res.status})`);
    const summary = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();
    const tokensUsed =
      Number(data.usage?.input_tokens || 0) + Number(data.usage?.output_tokens || 0);
    return { summary, tokensUsed, provider: config.provider, model: config.model };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            "Je analist i Revolution POS. Shkruan raporte ditore të qarta për pronarë restorantesh në shqip.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: Math.min(2048, config.maxTokens * 2),
      temperature: 0.3,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `OpenAI gabim (${res.status})`);
  const summary = String(data.choices?.[0]?.message?.content || "").trim();
  const tokensUsed =
    Number(data.usage?.total_tokens) ||
    Number(data.usage?.prompt_tokens || 0) + Number(data.usage?.completion_tokens || 0);
  return { summary, tokensUsed, provider: config.provider, model: config.model };
}

async function listEligibleClients() {
  const db = getSupabase();
  const today = getZonedParts().date;
  const { data: clients, error: clientErr } = await db
    .from("clients")
    .select("id, emri, email, package_tier")
    .eq("package_tier", "pako_5");
  if (clientErr) throw clientErr;

  const eligible = [];
  for (const client of clients || []) {
    if (!clientHasFeature(client, "ai")) continue;
    const { data: licenses, error: licErr } = await db
      .from("licenses")
      .select("id, statusi, data_skadimit")
      .eq("client_id", client.id)
      .eq("statusi", "aktive")
      .limit(1);
    if (licErr) continue;
    const lic = licenses?.[0];
    if (!lic) continue;
    if (lic.data_skadimit && String(lic.data_skadimit) < today) continue;
    eligible.push(client);
  }
  return eligible;
}

async function getReportByDate(clientId, reportDate) {
  const db = getSupabase();
  const { data, error } = await db
    .from("ai_daily_reports")
    .select("*")
    .eq("restaurant_id", clientId)
    .eq("report_date", reportDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function listReportsForClient(clientId, { limit = 30 } = {}) {
  const db = getSupabase();
  const { data, error } = await db
    .from("ai_daily_reports")
    .select("id, report_date, summary_text, report_json, profit_forecast, email_sent_at, tokens_used, created_at")
    .eq("restaurant_id", clientId)
    .order("report_date", { ascending: false })
    .limit(Math.min(90, Math.max(1, Number(limit) || 30)));
  if (error) throw error;
  return data || [];
}

async function saveDailyReport({
  clientId,
  reportDate,
  reportJson,
  summaryText,
  tokensUsed,
  emailSentAt,
  profitForecast,
}) {
  const db = getSupabase();
  const row = {
    restaurant_id: clientId,
    report_date: reportDate,
    report_json: reportJson,
    summary_text: summaryText,
    tokens_used: Math.max(0, Number(tokensUsed) || 0),
    email_sent_at: emailSentAt || null,
    profit_forecast: profitForecast && typeof profitForecast === "object" ? profitForecast : {},
  };
  const { data, error } = await db
    .from("ai_daily_reports")
    .upsert(row, { onConflict: "restaurant_id,report_date" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function generateDailyReportForClient(client, reportDate, { sendEmail = true, force = false } = {}) {
  const clientId = client.id;
  const existing = await getReportByDate(clientId, reportDate);
  if (existing?.summary_text && !force) {
    return { skipped: true, reason: "exists", report: existing };
  }

  const payload = await buildDailyReportPayload(clientId, reportDate);
  const { summary, tokensUsed } = await generateAiSummary(client.emri, payload);

  let profitForecast = {};
  let forecastTokens = 0;
  try {
    const { buildProfitForecast } = require("./profitForecastService");
    profitForecast = await buildProfitForecast(clientId, client.emri);
    forecastTokens = Number(profitForecast.tokens_used) || 0;
  } catch (err) {
    console.warn(`[aiDailyReport] profit forecast ${clientId}:`, err.message);
  }

  let emailSentAt = null;
  if (sendEmail && isEmailConfigured()) {
    const ownerEmail = await resolveOwnerEmail(clientId, client);
    if (ownerEmail) {
      try {
        await sendDailyAiReportEmail({
          to: ownerEmail,
          clientName: client.emri,
          reportDate,
          summaryText: summary,
          payload,
        });
        emailSentAt = new Date().toISOString();
      } catch (err) {
        console.warn(`[aiDailyReport] email ${clientId}:`, err.message);
      }
    }
  }

  const report = await saveDailyReport({
    clientId,
    reportDate,
    reportJson: payload,
    summaryText: summary,
    tokensUsed: tokensUsed + forecastTokens,
    emailSentAt,
    profitForecast,
  });

  if (tokensUsed > 0) {
    insertAiUsageLog({
      restaurantId: clientId,
      feature: "daily_report",
      tokensUsed,
    }).catch(err => console.warn("[aiDailyReport] usage log daily_report:", err.message));
  }
  if (forecastTokens > 0) {
    insertAiUsageLog({
      restaurantId: clientId,
      feature: "profit_forecast",
      tokensUsed: forecastTokens,
    }).catch(err => console.warn("[aiDailyReport] usage log profit_forecast:", err.message));
  }

  return { skipped: false, report };
}

async function processAiDailyReports(reportDate) {
  if (isAiPaused()) {
    console.log("[cron] aiDailyReports: AI_PAUSED — anashkalohet.");
    return { generated: 0, skipped: 0 };
  }

  const date = reportDate || getZonedParts().date;
  const clients = await listEligibleClients();
  let generated = 0;
  let skipped = 0;

  for (const client of clients) {
    try {
      const result = await generateDailyReportForClient(client, date, { sendEmail: true });
      if (result.skipped) skipped += 1;
      else generated += 1;
    } catch (err) {
      console.error(`[cron] aiDailyReports client ${client.id}:`, err.message || err);
    }
  }

  console.log(
    `[cron] aiDailyReports ${date}: generated=${generated} skipped=${skipped} eligible=${clients.length}`,
  );
  return { generated, skipped, eligible: clients.length, date };
}

async function getTodayReport(clientId) {
  const today = getZonedParts().date;
  return getReportByDate(clientId, today);
}

async function getProfitForecastForClient(clientId, clientName) {
  const today = getZonedParts().date;
  const existing = await getReportByDate(clientId, today);
  if (existing?.profit_forecast && Object.keys(existing.profit_forecast).length) {
    return existing.profit_forecast;
  }
  const { buildProfitForecast } = require("./profitForecastService");
  return buildProfitForecast(clientId, clientName);
}

module.exports = {
  REPORT_TZ,
  getZonedParts,
  aggregateTopItems,
  buildDailyReportPayload,
  estimateDailyProfit,
  listEligibleClients,
  listReportsForClient,
  getReportByDate,
  getTodayReport,
  getProfitForecastForClient,
  generateDailyReportForClient,
  processAiDailyReports,
};
