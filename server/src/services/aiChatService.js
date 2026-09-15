const { getAiConfig, isAiPaused } = require("../lib/aiConfig");
const { trimEnv } = require("../lib/env");

const SYSTEM_PROMPT =
  "Je asistent i Revolution Invest POS për restorante dhe kafene në shqip. " +
  "Ndihmo stafin me menu, porosi, raporte dhe përdorimin e sistemit. " +
  "Përgjigju shkurt, qartë dhe praktik.";

const OWNER_SYSTEM_PROMPT =
  "Je Asistenti AI i Revolution POS për pronarin e restorantit. " +
  "Përgjigju vetëm në shqip, me ton profesional dhe miqësor. " +
  "Përdor kontekstin e biznesit (shitjet e sotme, stoku, raportet) kur përgjigjesh. " +
  "Nëse të dhënat mungojnë, thuaj qartë. Mos trillosh numra — përdor vetëm JSON-në e dhënë.";

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-12)
    .map((entry) => ({
      role: entry?.role === "assistant" ? "assistant" : "user",
      content: String(entry?.content || "").trim(),
    }))
    .filter((entry) => entry.content);
}

function normalizeMessage(message) {
  const text = String(message || "").trim();
  if (!text) throw new Error("Mungon mesazhi.");
  if (text.length > 4000) throw new Error("Mesazhi është shumë i gjatë (max 4000 karaktere).");
  return text;
}

async function openaiChat(config, message, history) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: config.maxTokens,
      temperature: 0.4,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI gabim (${res.status})`);
  }

  const reply = String(data.choices?.[0]?.message?.content || "").trim();
  if (!reply) throw new Error("AI nuk ktheu përgjigje.");

  const tokensUsed =
    Number(data.usage?.total_tokens) ||
    Number(data.usage?.prompt_tokens || 0) + Number(data.usage?.completion_tokens || 0);

  return { reply, tokensUsed, provider: "openai", model: config.model };
}

async function anthropicChat(config, message, history) {
  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      system: SYSTEM_PROMPT,
      messages,
      max_tokens: config.maxTokens,
      temperature: 0.4,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `Anthropic gabim (${res.status})`);
  }

  const reply = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!reply) throw new Error("AI nuk ktheu përgjigje.");

  const tokensUsed =
    Number(data.usage?.input_tokens || 0) + Number(data.usage?.output_tokens || 0);

  return { reply, tokensUsed, provider: "anthropic", model: config.model };
}

function getOwnerChatConfig() {
  if (isAiPaused()) {
    throw new Error("AI është i ndalur për momentin. Provoni përsëri më vonë.");
  }
  const anthropicKey = trimEnv("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    throw new Error("Asistenti AI kërkon ANTHROPIC_API_KEY në environment.");
  }
  return {
    provider: "anthropic",
    ready: true,
    apiKey: anthropicKey,
    model: trimEnv("ANTHROPIC_MODEL") || "claude-sonnet-4-6",
    maxTokens: Math.min(8192, Math.max(256, Number(process.env.AI_CHAT_MAX_TOKENS) || 2048)),
  };
}

function buildOwnerSystemPrompt(context) {
  const ctx = context && typeof context === "object" ? context : {};
  return (
    `${OWNER_SYSTEM_PROMPT}\n\n` +
    `Konteksti i biznesit për ${ctx.business_name || "lokalin"} (${ctx.date || "sot"}):\n` +
    `${JSON.stringify(ctx, null, 2)}`
  );
}

async function sendOwnerChat({ message, history = [], context = {} }) {
  const config = getOwnerChatConfig();
  const normalizedMessage = normalizeMessage(message);
  const normalizedHistory = normalizeHistory(history);
  const system = buildOwnerSystemPrompt(context);

  const messages = [
    ...normalizedHistory.map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: normalizedMessage },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      system,
      messages,
      max_tokens: config.maxTokens,
      temperature: 0.35,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `Anthropic gabim (${res.status})`);
  }

  const reply = (data.content || [])
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("")
    .trim();

  if (!reply) throw new Error("AI nuk ktheu përgjigje.");

  const tokensUsed =
    Number(data.usage?.input_tokens || 0) + Number(data.usage?.output_tokens || 0);

  return { reply, tokensUsed, provider: "anthropic", model: config.model };
}

async function sendStaffChat({ message, history = [] }) {
  if (isAiPaused()) {
    throw new Error("AI është i ndalur për momentin. Provoni përsëri më vonë.");
  }
  const config = getAiConfig();
  if (!config.ready) {
    throw new Error(
      "AI chat nuk është aktiv. Vendos OPENAI_API_KEY ose ANTHROPIC_API_KEY në environment.",
    );
  }

  const normalizedMessage = normalizeMessage(message);
  const normalizedHistory = normalizeHistory(history);

  if (config.provider === "anthropic") {
    return anthropicChat(config, normalizedMessage, normalizedHistory);
  }
  return openaiChat(config, normalizedMessage, normalizedHistory);
}

module.exports = { sendStaffChat, sendOwnerChat, buildOwnerSystemPrompt };
