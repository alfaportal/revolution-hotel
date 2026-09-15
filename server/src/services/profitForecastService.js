const { getAiConfig, isAiPaused } = require("../lib/aiConfig");
const { getOwnerReport } = require("./salesService");

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function getReportHelpers() {
  return require("./aiDailyReportService");
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : 0;
  return roundMoney(((c - p) / p) * 100);
}

function groupOrdersByDay(orders) {
  const map = new Map();
  for (const o of orders || []) {
    const day = String(o.closed_at || "").slice(0, 10);
    if (!day) continue;
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(o);
  }
  return map;
}

async function summarizePeriod(clientId, from, to) {
  const report = await getOwnerReport(clientId, from, to);
  const { estimateDailyProfit } = getReportHelpers();
  const profit = await estimateDailyProfit(clientId, report.orders || []);
  return {
    from,
    to,
    revenue: roundMoney(report.total),
    profit: profit.profit,
    orders: report.order_count,
    has_cost_data: profit.has_cost_data,
  };
}

function linearTrendForecast(dailySeries, horizonDays) {
  const points = (dailySeries || []).filter(p => Number.isFinite(Number(p.profit)));
  if (!points.length) {
    return { profit: 0, revenue: 0, daily_avg_profit: 0 };
  }

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumRev = 0;

  points.forEach((p, i) => {
    const y = Number(p.profit) || 0;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumX2 += i * i;
    sumRev += Number(p.revenue) || 0;
  });

  const denom = n * sumX2 - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  const avgProfit = sumY / n;
  const avgRev = sumRev / n;

  let forecastProfit = 0;
  let forecastRev = 0;
  for (let h = 1; h <= horizonDays; h += 1) {
    const idx = n - 1 + h;
    const projected = Math.max(0, intercept + slope * idx);
    forecastProfit += projected > 0 ? projected : avgProfit;
    forecastRev += avgRev;
  }

  return {
    profit: roundMoney(forecastProfit),
    revenue: roundMoney(forecastRev),
    daily_avg_profit: roundMoney(avgProfit),
    trend_slope: roundMoney(slope),
  };
}

async function generateForecastAiSummary(clientName, payload) {
  if (isAiPaused()) {
    return {
      summary:
        `Fitimi i javës së ardhshme vlerësohet ~${payload.forecast?.next_week?.profit ?? 0} EUR, ` +
        `muajit ~${payload.forecast?.next_month?.profit ?? 0} EUR (bazuar në trend 30-ditor).`,
      tokensUsed: 0,
    };
  }

  const config = getAiConfig();
  if (!config.ready) {
    return {
      summary: "Parashikimi numerik u llogarit — aktivizoni AI për përmbledhje tekstuale.",
      tokensUsed: 0,
    };
  }

  const prompt =
    `Shkruaj parashikimin e fitimit në shqip për pronarin e ${clientName || "restorantit"}.\n` +
    `Përfshij: trendin 30-ditor, krahasimin këtë javë vs javën e kaluar, këtë muaj vs muajin e kaluar, ` +
    `dhe parashikimin për javën dhe muajin e ardhshëm.\n` +
    `3–6 fjali, ton profesional, pa markdown. Përdor vetëm JSON-në më poshtë.\n\n` +
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
        system: "Je analist financiar i Revolution POS. Shkruan parashikime fitimi të qarta në shqip.",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 768,
        temperature: 0.35,
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
    return { summary, tokensUsed };
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
          content: "Je analist financiar i Revolution POS. Shkruan parashikime fitimi të qarta në shqip.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 768,
      temperature: 0.35,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `OpenAI gabim (${res.status})`);
  const summary = String(data.choices?.[0]?.message?.content || "").trim();
  const tokensUsed =
    Number(data.usage?.total_tokens) ||
    Number(data.usage?.prompt_tokens || 0) + Number(data.usage?.completion_tokens || 0);
  return { summary, tokensUsed };
}

async function buildProfitForecast(clientId, clientName) {
  const { getZonedParts, estimateDailyProfit } = getReportHelpers();
  const today = getZonedParts().date;
  const from30 = addDays(today, -29);

  const report30 = await getOwnerReport(clientId, from30, today);
  const byDay = groupOrdersByDay(report30.orders);

  const dailySeries = [];
  for (let i = 0; i < 30; i += 1) {
    const date = addDays(from30, i);
    const dayOrders = byDay.get(date) || [];
    const profit = await estimateDailyProfit(clientId, dayOrders);
    dailySeries.push({
      date,
      revenue: profit.revenue,
      profit: profit.profit,
      orders: dayOrders.length,
    });
  }

  const thisWeekFrom = addDays(today, -6);
  const prevWeekFrom = addDays(today, -13);
  const prevWeekTo = addDays(today, -7);

  const monthParts = today.split("-");
  const thisMonthFrom = `${monthParts[0]}-${monthParts[1]}-01`;
  const prevMonthEnd = addDays(thisMonthFrom, -1);
  const prevMonthParts = prevMonthEnd.split("-");
  const prevMonthFrom = `${prevMonthParts[0]}-${prevMonthParts[1]}-01`;

  const [thisWeek, prevWeek, thisMonth, prevMonth] = await Promise.all([
    summarizePeriod(clientId, thisWeekFrom, today),
    summarizePeriod(clientId, prevWeekFrom, prevWeekTo),
    summarizePeriod(clientId, thisMonthFrom, today),
    summarizePeriod(clientId, prevMonthFrom, prevMonthEnd),
  ]);

  const nextWeek = linearTrendForecast(dailySeries, 7);
  const nextMonth = linearTrendForecast(dailySeries, 30);

  const comparison = {
    this_week: thisWeek,
    prev_week: {
      ...prevWeek,
      profit_change_pct: pctChange(thisWeek.profit, prevWeek.profit),
      revenue_change_pct: pctChange(thisWeek.revenue, prevWeek.revenue),
    },
    this_month: thisMonth,
    prev_month: {
      ...prevMonth,
      profit_change_pct: pctChange(thisMonth.profit, prevMonth.profit),
      revenue_change_pct: pctChange(thisMonth.revenue, prevMonth.revenue),
    },
  };

  const forecast = {
    next_week: { ...nextWeek, horizon_days: 7 },
    next_month: { ...nextMonth, horizon_days: 30 },
  };

  const basePayload = {
    generated_at: new Date().toISOString(),
    history_days: 30,
    daily_series: dailySeries,
    comparison,
    forecast,
  };

  let aiSummary = "";
  let tokensUsed = 0;
  try {
    const ai = await generateForecastAiSummary(clientName, basePayload);
    aiSummary = ai.summary || "";
    tokensUsed = ai.tokensUsed || 0;
  } catch (err) {
    console.warn("[profitForecast] AI:", err.message);
    aiSummary =
      `Këtë javë fitimi vlerësohet ${thisWeek.profit} EUR (vs ${prevWeek.profit} EUR javën e kaluar). ` +
      `Parashikim javi: ~${nextWeek.profit} EUR, muaji: ~${nextMonth.profit} EUR.`;
  }

  return {
    ...basePayload,
    ai_summary: aiSummary,
    tokens_used: tokensUsed,
  };
}

module.exports = {
  buildProfitForecast,
  pctChange,
  linearTrendForecast,
};
