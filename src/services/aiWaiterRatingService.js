const { getSupabase } = require("../db");
const { isAiPaused } = require("../lib/aiConfig");
const { anthropicText } = require("../lib/anthropicText");
const { insertAiUsageLog } = require("./aiUsageService");
const { getZonedParts } = require("./aiDailyReportService");
const { ensureAiExtraSchema } = require("../lib/ensureAiExtraSchema");
const { normalizeItems } = require("./salesService");

function daysAgoIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function parseRefusedIds(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function hourBucket(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCHours();
}

/**
 * Statistika refuzimesh + porosi totale për kamarierët (30 ditë default).
 */
async function computeWaiterRefuseStats(clientId, { days = 30 } = {}) {
  const db = getSupabase();
  const since = daysAgoIso(days);

  const { data: orders, error } = await db
    .from("sales_orders")
    .select(
      "id, waiter_id, waiter_name, accepted_by_waiter_id, accepted_by_waiter_name, refused_at, refused_by_waiter_ids, ordered_at, created_at, items_json, status",
    )
    .eq("client_id", clientId)
    .gte("created_at", since)
    .limit(5000);

  if (error) throw error;

  const byWaiter = new Map();

  function ensure(id, name) {
    const key = String(id || name || "unknown").trim() || "unknown";
    if (!byWaiter.has(key)) {
      byWaiter.set(key, {
        waiter_id: id || key,
        waiter_name: name || id || "I panjohur",
        total_orders: 0,
        accepted_orders: 0,
        refuse_events: 0,
        refuse_hours: {},
        refused_products: {},
      });
    }
    return byWaiter.get(key);
  }

  for (const o of orders || []) {
    const wid = o.accepted_by_waiter_id || o.waiter_id || "";
    const wname = o.accepted_by_waiter_name || o.waiter_name || "";
    if (wid || wname) {
      const row = ensure(wid, wname);
      row.total_orders += 1;
      if (o.accepted_by_waiter_id || o.accepted_by_waiter_name) row.accepted_orders += 1;
    }

    const refusedIds = parseRefusedIds(o.refused_by_waiter_ids);
    if (!refusedIds.length && !o.refused_at) continue;

    const hour = hourBucket(o.refused_at || o.ordered_at || o.created_at);
    const products = normalizeItems(o.items_json || []);

    for (const rid of refusedIds.length ? refusedIds : ["unknown"]) {
      const row = ensure(rid, rid);
      row.refuse_events += 1;
      if (hour != null) {
        row.refuse_hours[hour] = (row.refuse_hours[hour] || 0) + 1;
      }
      for (const p of products) {
        const name = p.name || "Artikull";
        row.refused_products[name] = (row.refused_products[name] || 0) + (p.quantity || 1);
      }
    }
  }

  const { listRecentRefusalReasons } = require("./orderRefusalService");
  const recentReasons = await listRecentRefusalReasons(clientId, { days, limit: 80 }).catch(() => []);
  const reasonsByWaiter = new Map();
  for (const r of recentReasons) {
    const key = String(r.waiter_name || "").trim() || "unknown";
    if (!reasonsByWaiter.has(key)) reasonsByWaiter.set(key, []);
    const arr = reasonsByWaiter.get(key);
    if (arr.length < 5) arr.push(r.reason);
  }

  const waiters = [...byWaiter.values()]
    .map((w) => {
      const refuse_rate =
        w.total_orders > 0
          ? Math.round((w.refuse_events / w.total_orders) * 1000) / 10
          : w.refuse_events > 0
            ? 100
            : 0;
      const peakHour = Object.entries(w.refuse_hours).sort((a, b) => b[1] - a[1])[0];
      const topProducts = Object.entries(w.refused_products)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, qty]) => ({ name, quantity: qty }));
      /** Vlerësim 1–10: më pak refuzime = më mirë */
      const rating = Math.max(1, Math.min(10, Math.round(10 - refuse_rate / 10)));
      const reasonKey = String(w.waiter_name || w.waiter_id || "").trim();
      return {
        waiter_id: w.waiter_id,
        waiter_name: w.waiter_name,
        total_orders: w.total_orders,
        accepted_orders: w.accepted_orders,
        refuse_events: w.refuse_events,
        refuse_rate_percent: refuse_rate,
        rating,
        peak_refuse_hour_utc: peakHour ? Number(peakHour[0]) : null,
        top_refused_products: topProducts,
        recent_refuse_reasons: reasonsByWaiter.get(reasonKey) || reasonsByWaiter.get(String(w.waiter_id || "")) || [],
      };
    })
    .sort((a, b) => b.refuse_rate_percent - a.refuse_rate_percent || b.refuse_events - a.refuse_events);

  return {
    days,
    period_end: getZonedParts().date,
    waiters,
    totals: {
      waiters: waiters.length,
      refuse_events: waiters.reduce((s, w) => s + w.refuse_events, 0),
      orders: waiters.reduce((s, w) => s + w.total_orders, 0),
    },
  };
}

async function analyzeWaiterRatings(clientId, { days = 30, force = false } = {}) {
  if (isAiPaused()) throw new Error("AI është i ndalur për momentin.");
  await ensureAiExtraSchema();

  const stats = await computeWaiterRefuseStats(clientId, { days });
  const { listRecentRefusalReasons } = require("./orderRefusalService");
  const recentReasons = await listRecentRefusalReasons(clientId, { days, limit: 40 }).catch(() => []);
  const periodEnd = stats.period_end;
  const periodStart = (() => {
    const d = new Date(`${periodEnd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  })();

  const db = getSupabase();
  if (!force) {
    const { data: cached } = await db
      .from("ai_waiter_ratings")
      .select("*")
      .eq("restaurant_id", clientId)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .maybeSingle();
    if (cached?.analysis_text) {
      return {
        ok: true,
        cached: true,
        period_start: periodStart,
        period_end: periodEnd,
        waiters: cached.ratings_json?.waiters || stats.waiters,
        totals: cached.ratings_json?.totals || stats.totals,
        analysis_text: cached.analysis_text,
        tokens_used: cached.tokens_used || 0,
      };
    }
  }

  const ai = await anthropicText({
    system:
      "Je analist i Revolution POS. Analizon performancën e kamarierëve nga refuzimet e porosive. " +
      "Shkruaj në shqip, 5–10 fjali, pa markdown. Tregoni kush refuzon më shumë, në çfarë ore, cilat produkte, " +
      "dhe arsyet tipike të refuzimit (nëse jepen).",
    prompt:
      `Analizo këto statistika të kamarierëve (refuzime vs porosi) për ${days} ditët e fundit:\n` +
      JSON.stringify({ waiters: stats.waiters.slice(0, 20), totals: stats.totals }, null, 2) +
      `\n\nArsyet e fundit të refuzimit (kamarier → arsye → artikuj):\n` +
      JSON.stringify(recentReasons.slice(0, 25), null, 2),
    temperature: 0.3,
  });

  await insertAiUsageLog({
    restaurantId: clientId,
    feature: "waiter_rating",
    tokensUsed: ai.tokensUsed,
  });

  const payload = { waiters: stats.waiters, totals: stats.totals, days };
  await db.from("ai_waiter_ratings").upsert(
    {
      restaurant_id: clientId,
      period_start: periodStart,
      period_end: periodEnd,
      ratings_json: payload,
      analysis_text: ai.text,
      tokens_used: ai.tokensUsed,
    },
    { onConflict: "restaurant_id,period_start,period_end" },
  );

  return {
    ok: true,
    cached: false,
    period_start: periodStart,
    period_end: periodEnd,
    waiters: stats.waiters,
    totals: stats.totals,
    analysis_text: ai.text,
    tokens_used: ai.tokensUsed,
    usage: { tokens_used: ai.tokensUsed, model: ai.model, provider: ai.provider },
  };
}

module.exports = {
  computeWaiterRefuseStats,
  analyzeWaiterRatings,
};
