const { getSupabase } = require("../db");
const { ensureAiChatSchema } = require("../lib/ensureAiChatSchema");

function mapRow(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    tokens_used: Number(row.tokens_used) || 0,
    created_at: row.created_at,
  };
}

function isMissingTableError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  if (code === "42p01") return true;
  if (msg.includes("ai_chat_history") && msg.includes("does not exist")) return true;
  if (msg.includes("ai_chat_history") && msg.includes("schema cache")) return true;
  return false;
}

async function withSchema(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    const ok = await ensureAiChatSchema();
    if (!ok) {
      throw new Error(
        "Tabela ai_chat_history mungon. Ekzekutoni supabase/migrations/032_ai_chat_history.sql.",
      );
    }
    return fn();
  }
}

async function listChatHistory(clientId, { limit = 40 } = {}) {
  await ensureAiChatSchema();
  return withSchema(async () => {
    const db = getSupabase();
    const cap = Math.min(100, Math.max(1, Number(limit) || 40));
    const { data, error } = await db
      .from("ai_chat_history")
      .select("id, role, content, tokens_used, created_at")
      .eq("restaurant_id", clientId)
      .order("created_at", { ascending: false })
      .limit(cap);

    if (error) throw error;

    return (data || []).reverse().map(mapRow);
  });
}

async function appendChatMessage(clientId, role, content, tokensUsed = 0) {
  await ensureAiChatSchema();
  return withSchema(async () => {
    const text = String(content || "").trim();
    if (!text) throw new Error("Mesazhi bosh.");
    const db = getSupabase();
    const { data, error } = await db
      .from("ai_chat_history")
      .insert({
        restaurant_id: clientId,
        role: role === "assistant" ? "assistant" : "user",
        content: text.slice(0, 12000),
        tokens_used: Math.max(0, Math.floor(Number(tokensUsed) || 0)),
      })
      .select("id, role, content, tokens_used, created_at")
      .single();
    if (error) throw error;
    return mapRow(data);
  });
}

async function clearChatHistory(clientId) {
  await ensureAiChatSchema();
  return withSchema(async () => {
    const db = getSupabase();
    const { error } = await db.from("ai_chat_history").delete().eq("restaurant_id", clientId);
    if (error) throw error;
    return { cleared: true };
  });
}

module.exports = {
  listChatHistory,
  appendChatMessage,
  clearChatHistory,
};
