const { getSupabase } = require("../db");
const { isAiPaused } = require("../lib/aiConfig");
const { clientHasFeature } = require("../lib/packages");
const { anthropicText } = require("../lib/anthropicText");
const { insertAiUsageLog } = require("./aiUsageService");
const { getOwnerReport } = require("./salesService");
const { resolveOwnerEmail } = require("./stockService");
const { isEmailConfigured, sendWeeklyAiReportEmail } = require("./emailService");
const { getZonedParts, listEligibleClients, aggregateTopItems } = require("./aiDailyReportService");
const { ensureAiExtraSchema } = require("../lib/ensureAiExtraSchema");

function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = d.getUTCDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function buildWeeklyPayload(clientId, weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const prevStart = addDays(weekStart, -7);
  const prevEnd = addDays(weekStart, -1);

  const [thisWeek, prevWeek] = await Promise.all([
    getOwnerReport(clientId, weekStart, weekEnd),
    getOwnerReport(clientId, prevStart, prevEnd),
  ]);

  const top = aggregateTopItems(thisWeek.orders || [], 8);
  const delta =
    prevWeek.total > 0
      ? Math.round(((thisWeek.total - prevWeek.total) / prevWeek.total) * 1000) / 10
      : null;

  return {
    week_start: weekStart,
    week_end: weekEnd,
    this_week: {
      total: thisWeek.total,
      order_count: thisWeek.order_count,
      by_day: thisWeek.by_day,
    },
    prev_week: {
      total: prevWeek.total,
      order_count: prevWeek.order_count,
    },
    change_percent: delta,
    top_items: top,
  };
}

async function generateWeeklyReportForClient(client, weekStart, { sendEmail = true, force = false } = {}) {
  if (isAiPaused()) throw new Error("AI është i ndalur për momentin.");
  await ensureAiExtraSchema();

  const clientId = client.id;
  const weekEnd = addDays(weekStart, 6);
  const db = getSupabase();

  if (!force) {
    const { data: existing } = await db
      .from("ai_weekly_reports")
      .select("*")
      .eq("restaurant_id", clientId)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (existing?.summary_text) {
      return { ok: true, cached: true, report: existing };
    }
  }

  const payload = await buildWeeklyPayload(clientId, weekStart);
  if (!Number(payload.this_week?.order_count) && !Number(payload.this_week?.total)) {
    const summary =
      "Nuk ka shitje për analizë për këtë javë. Mbyllni porosi gjatë javës, pastaj gjeneroni raportin.";
    const { data: emptyRow } = await db
      .from("ai_weekly_reports")
      .upsert(
        {
          restaurant_id: clientId,
          week_start: weekStart,
          week_end: weekEnd,
          report_json: payload,
          summary_text: summary,
          tokens_used: 0,
          email_sent_at: null,
        },
        { onConflict: "restaurant_id,week_start" },
      )
      .select("*")
      .maybeSingle();
    return {
      ok: true,
      no_data: true,
      cached: false,
      report: emptyRow || {
        week_start: weekStart,
        week_end: weekEnd,
        summary_text: summary,
        report_json: payload,
      },
    };
  }

  let ai;
  try {
    ai = await anthropicText({
      system:
        "Je analist i Revolution POS. Shkruan raporte javore profesionale në shqip për pronarë. " +
        "Përfshi: shitjet, top produkte, trend vs java e kaluar, 2–3 rekomandime. Pa markdown.",
      prompt:
        `Raport javor për ${client.emri || "lokalin"} (${weekStart} – ${weekEnd}):\n` +
        JSON.stringify(payload, null, 2),
      temperature: 0.35,
      maxTokens: 2500,
    });
  } catch (err) {
    const msg = String(err.message || err);
    if (/ANTHROPIC_API_KEY/i.test(msg)) {
      throw new Error("ANTHROPIC_API_KEY mungon në Railway. Vendoseni te Variables dhe ridëploy.");
    }
    throw new Error(`Raporti javor AI dështoi: ${msg}`);
  }

  await insertAiUsageLog({
    restaurantId: clientId,
    feature: "weekly_report",
    tokensUsed: ai.tokensUsed,
  }).catch((e) => console.warn("[weekly-report] usage log:", e.message));

  let emailSentAt = null;
  if (sendEmail && isEmailConfigured()) {
    const to = (await resolveOwnerEmail(clientId).catch(() => null)) || client.email;
    if (to) {
      const sent = await sendWeeklyAiReportEmail({
        to,
        clientName: client.emri,
        weekStart,
        weekEnd,
        summaryText: ai.text,
        payload,
      }).catch(() => null);
      if (sent && !sent.skipped && !sent.error) emailSentAt = new Date().toISOString();
    }
  }

  const { data, error } = await db
    .from("ai_weekly_reports")
    .upsert(
      {
        restaurant_id: clientId,
        week_start: weekStart,
        week_end: weekEnd,
        report_json: payload,
        summary_text: ai.text,
        tokens_used: ai.tokensUsed,
        email_sent_at: emailSentAt,
      },
      { onConflict: "restaurant_id,week_start" },
    )
    .select("*")
    .single();
  if (error) throw error;

  return {
    ok: true,
    cached: false,
    report: data,
    usage: { tokens_used: ai.tokensUsed, model: ai.model, provider: ai.provider },
  };
}

async function listWeeklyReports(clientId, { limit = 12 } = {}) {
  await ensureAiExtraSchema();
  const db = getSupabase();
  const { data, error } = await db
    .from("ai_weekly_reports")
    .select("id, week_start, week_end, summary_text, report_json, email_sent_at, tokens_used, created_at")
    .eq("restaurant_id", clientId)
    .order("week_start", { ascending: false })
    .limit(Math.min(52, Math.max(1, Number(limit) || 12)));
  if (error) {
    if (String(error.message || "").includes("ai_weekly_reports")) return [];
    throw error;
  }
  return data || [];
}

async function processAiWeeklyReports(anchorDate) {
  const today = anchorDate || getZonedParts().date;
  const weekStart = mondayOf(today);
  /* Raporti i javës së kaluar (e hënë e re → jave që sapo mbaroi) */
  const reportWeekStart = addDays(weekStart, -7);

  const clients = await listEligibleClients();
  const results = [];
  for (const client of clients) {
    if (!clientHasFeature(client, "ai")) continue;
    try {
      const r = await generateWeeklyReportForClient(client, reportWeekStart, {
        sendEmail: true,
        force: false,
      });
      results.push({ client_id: client.id, ok: true, cached: !!r.cached });
    } catch (err) {
      console.error("[weekly-report]", client.id, err.message || err);
      results.push({ client_id: client.id, ok: false, gabim: err.message });
    }
  }
  return { week_start: reportWeekStart, results };
}

module.exports = {
  mondayOf,
  addDays,
  buildWeeklyPayload,
  generateWeeklyReportForClient,
  listWeeklyReports,
  processAiWeeklyReports,
};
