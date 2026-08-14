/** Thirrje e përbashkët Anthropic Messages API (tekst). */

const { trimEnv } = require("./env");

function getAnthropicTextConfig() {
  const apiKey = trimEnv("ANTHROPIC_API_KEY");
  return {
    ready: !!apiKey,
    apiKey,
    model: trimEnv("ANTHROPIC_MODEL") || "claude-sonnet-4-6",
    maxTokens: Math.min(8192, Math.max(512, Number(process.env.AI_REPORT_MAX_TOKENS) || 2048)),
  };
}

async function anthropicText({ system, prompt, temperature = 0.35, maxTokens }) {
  const config = getAnthropicTextConfig();
  if (!config.ready) {
    throw new Error("Kërkohet ANTHROPIC_API_KEY në environment.");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      system: system || "Je asistent i Revolution POS. Përgjigju në shqip.",
      messages: [{ role: "user", content: String(prompt || "") }],
      max_tokens: maxTokens || config.maxTokens,
      temperature,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `Anthropic gabim (${res.status})`);
  }

  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (!text) throw new Error("AI nuk ktheu përgjigje.");

  const tokensUsed =
    Number(data.usage?.input_tokens || 0) + Number(data.usage?.output_tokens || 0);

  return {
    text,
    tokensUsed,
    provider: "anthropic",
    model: config.model,
  };
}

module.exports = { getAnthropicTextConfig, anthropicText };
