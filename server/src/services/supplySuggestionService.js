const { getSupabase } = require("../db");
const { getAiConfig, isAiPaused } = require("../lib/aiConfig");
const { clientHasFeature } = require("../lib/packages");
const { ensureSupplySchema } = require("../lib/ensureSupplySchema");
const { listIngredients } = require("./inventoryService");
const { resolveOwnerEmail } = require("./stockService");
const { isEmailConfigured, sendSupplySuggestionEmail } = require("./emailService");
const { getZonedParts, listEligibleClients } = require("./aiDailyReportService");

function roundQty(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function computeOrderQuantity(quantity, minQuantity) {
  const q = roundQty(quantity);
  const min = roundQty(minQuantity);
  if (min <= 0) return 0;
  if (q > min) return 0;
  const deficit = roundQty(min - q);
  return roundQty(Math.max(deficit, min));
}

function isMissingSupplyTableError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  if (code === "42p01") return true;
  if (msg.includes("supply_suggestions") && msg.includes("does not exist")) return true;
  if (msg.includes("supply_suggestions") && msg.includes("schema cache")) return true;
  return false;
}

async function ensureSupplyReady() {
  await ensureSupplySchema();
}

async function withSupplySchema(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingSupplyTableError(err)) throw err;
    const ok = await ensureSupplySchema();
    if (!ok) {
      throw new Error(
        "Tabela supply_suggestions mungon. Ekzekutoni supabase/migrations/031_supply_suggestions.sql ose vendosni DATABASE_URL.",
      );
    }
    return fn();
  }
}

function mapSuggestionRow(row) {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    suggestion_date: row.suggestion_date,
    ingredient_id: row.ingredient_id,
    item_name: row.item_name,
    unit: row.unit,
    current_quantity: roundQty(row.current_quantity),
    min_quantity: roundQty(row.min_quantity),
    order_quantity: roundQty(row.order_quantity),
    last_supplier: row.last_supplier || "",
    last_supplier_email: row.last_supplier_email || "",
    ai_summary: row.ai_summary || "",
    email_sent_at: row.email_sent_at || null,
    created_at: row.created_at,
  };
}

async function analyzeLowStockIngredients(clientId) {
  const ingredients = await listIngredients(clientId);
  return ingredients
    .filter(i => roundQty(i.quantity) <= roundQty(i.min_quantity) && roundQty(i.min_quantity) > 0)
    .map(i => ({
      ingredient_id: i.id,
      item_name: i.name,
      unit: i.unit,
      current_quantity: i.quantity,
      min_quantity: i.min_quantity,
      order_quantity: computeOrderQuantity(i.quantity, i.min_quantity),
      last_supplier: i.last_supplier || "",
      last_supplier_email: i.last_supplier_email || "",
    }))
    .filter(i => i.order_quantity > 0);
}

async function generateAiSupplySummary(clientName, items) {
  const config = getAiConfig();
  if (isAiPaused() || !config.ready || !items.length) {
    return {
      summary: items.length
        ? `${items.length} përbërës kanë nevojë për furnizim — kontrolloni listën më poshtë.`
        : "Stoku është në rregull — nuk ka nevojë për furnizim sot.",
      tokensUsed: 0,
    };
  }

  const payload = {
    restaurant: clientName || "Restorant",
    items: items.map(i => ({
      name: i.item_name,
      current: i.current_quantity,
      minimum: i.min_quantity,
      order: i.order_quantity,
      unit: i.unit,
      supplier: i.last_supplier || "—",
    })),
  };

  const prompt =
    `Analizo stokun e përbërësve dhe shkruaj 2–4 fjali në shqip për pronarin e restorantit.\n` +
    `Përmend sa artikuj duhen porositur dhe nëse ka furnizues të përsëritur. Pa markdown.\n\n` +
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
        system: "Je asistent i furnizimit për Revolution POS. Shkruan sugjerime të qarta në shqip.",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
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
          content: "Je asistent i furnizimit për Revolution POS. Shkruan sugjerime të qarta në shqip.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 512,
      temperature: 0.3,
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

async function deleteSuggestionsForDate(clientId, suggestionDate) {
  const db = getSupabase();
  const { error } = await db
    .from("supply_suggestions")
    .delete()
    .eq("restaurant_id", clientId)
    .eq("suggestion_date", suggestionDate);
  if (error) throw error;
}

async function saveSuggestions(clientId, suggestionDate, items, aiSummary) {
  if (!items.length) {
    await deleteSuggestionsForDate(clientId, suggestionDate);
    return [];
  }

  const db = getSupabase();
  await deleteSuggestionsForDate(clientId, suggestionDate);

  const rows = items.map(item => ({
    restaurant_id: clientId,
    suggestion_date: suggestionDate,
    ingredient_id: item.ingredient_id,
    item_name: item.item_name,
    unit: item.unit,
    current_quantity: item.current_quantity,
    min_quantity: item.min_quantity,
    order_quantity: item.order_quantity,
    last_supplier: item.last_supplier || null,
    last_supplier_email: item.last_supplier_email || null,
    ai_summary: aiSummary || null,
  }));

  const { data, error } = await db.from("supply_suggestions").insert(rows).select("*");
  if (error) throw error;
  return (data || []).map(mapSuggestionRow);
}

async function listSuggestionsForClient(clientId, { date, limit = 60 } = {}) {
  await ensureSupplyReady();
  return withSupplySchema(async () => {
    const db = getSupabase();
    let query = db
      .from("supply_suggestions")
      .select("*")
      .eq("restaurant_id", clientId)
      .order("item_name");

    if (date) {
      query = query.eq("suggestion_date", date);
    } else {
      query = query.order("suggestion_date", { ascending: false }).limit(Math.min(200, limit * 3));
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapSuggestionRow);
  });
}

async function getSuggestionsByDate(clientId, suggestionDate) {
  return listSuggestionsForClient(clientId, { date: suggestionDate });
}

async function getTodaySuggestions(clientId) {
  const today = getZonedParts().date;
  return getSuggestionsByDate(clientId, today);
}

async function generateForClient(client, suggestionDate, { force = false } = {}) {
  const clientId = client.id;
  const date = suggestionDate || getZonedParts().date;

  await ensureSupplyReady();

  if (!force) {
    const existing = await getSuggestionsByDate(clientId, date);
    if (existing.length) {
      return { skipped: true, suggestions: existing, date };
    }
  }

  const items = await analyzeLowStockIngredients(clientId);
  let aiSummary = "";
  let tokensUsed = 0;

  try {
    const ai = await generateAiSupplySummary(client.emri, items);
    aiSummary = ai.summary || "";
    tokensUsed = ai.tokensUsed || 0;
  } catch (err) {
    console.warn("[supplySuggestions] AI:", err.message);
    aiSummary = items.length
      ? `${items.length} përbërës nën minimum — porosit sipas listës.`
      : "Stoku është në rregull.";
  }

  const suggestions = await saveSuggestions(clientId, date, items, aiSummary);

  const { insertAiUsageLog } = require("./aiUsageService");
  if (tokensUsed > 0) {
    insertAiUsageLog({
      restaurantId: clientId,
      feature: "supply_suggestion",
      tokensUsed,
    }).catch(err => console.warn("[supplySuggestions] usage log:", err.message));
  }

  return { skipped: false, suggestions, date, ai_summary: aiSummary, tokens_used: tokensUsed };
}

async function processDailySupplySuggestions(suggestionDate) {
  if (isAiPaused()) {
    console.log("[cron] supplySuggestions: AI_PAUSED — gjenerohet pa AI të plotë.");
  }

  const date = suggestionDate || getZonedParts().date;
  const clients = await listEligibleClients();
  let generated = 0;
  let skipped = 0;

  for (const client of clients) {
    if (!clientHasFeature(client, "ai")) continue;
    try {
      const result = await generateForClient(client, date, { force: false });
      if (result.skipped) skipped += 1;
      else generated += 1;
    } catch (err) {
      console.error(`[cron] supplySuggestions client ${client.id}:`, err.message || err);
    }
  }

  console.log(
    `[cron] supplySuggestions ${date}: generated=${generated} skipped=${skipped} eligible=${clients.length}`,
  );
  return { generated, skipped, eligible: clients.length, date };
}

async function markEmailSent(clientId, suggestionDate, supplierName) {
  const db = getSupabase();
  const now = new Date().toISOString();
  let query = db
    .from("supply_suggestions")
    .update({ email_sent_at: now })
    .eq("restaurant_id", clientId)
    .eq("suggestion_date", suggestionDate);

  if (supplierName) {
    query = query.eq("last_supplier", supplierName);
  }

  const { error } = await query;
  if (error) throw error;
}

async function sendSupplierEmail(clientId, clientRow, {
  suggestionDate,
  supplierName,
  to,
} = {}) {
  const date = suggestionDate || getZonedParts().date;
  const all = await getSuggestionsByDate(clientId, date);
  if (!all.length) {
    throw new Error("Nuk ka sugjerime për këtë datë — gjeneroni listën fillimisht.");
  }

  const supplier = String(supplierName || "").trim();
  const items = supplier
    ? all.filter(s => (s.last_supplier || "—") === supplier)
    : all;

  if (!items.length) {
    throw new Error("Nuk ka artikuj për këtë furnizues.");
  }

  const recipient =
    String(to || "").trim().toLowerCase() ||
    String(items[0]?.last_supplier_email || "").trim().toLowerCase();

  if (!recipient) {
    throw new Error("Mungon email i furnizuesit — vendoseni te përbërësi ose jepeni manualisht.");
  }

  if (!isEmailConfigured()) {
    throw new Error("Emaili nuk është i konfiguruar (RESEND_API_KEY).");
  }

  const aiSummary = items.find(s => s.ai_summary)?.ai_summary || "";
  await sendSupplySuggestionEmail({
    to: recipient,
    clientName: clientRow?.emri || "",
    supplierName: supplier || items[0]?.last_supplier || "Furnizues",
    suggestionDate: date,
    summaryText: aiSummary,
    items: items.map(i => ({
      name: i.item_name,
      order_quantity: i.order_quantity,
      unit: i.unit,
      current_quantity: i.current_quantity,
      min_quantity: i.min_quantity,
    })),
  });

  await markEmailSent(clientId, date, supplier || null);

  return {
    sent: true,
    to: recipient,
    supplier: supplier || items[0]?.last_supplier || "",
    item_count: items.length,
  };
}

module.exports = {
  computeOrderQuantity,
  analyzeLowStockIngredients,
  listSuggestionsForClient,
  getSuggestionsByDate,
  getTodaySuggestions,
  generateForClient,
  processDailySupplySuggestions,
  sendSupplierEmail,
};
