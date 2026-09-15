const { getAnthropicVisionConfig } = require("../lib/aiVisionConfig");
const { isAiPaused } = require("../lib/aiConfig");

const SCAN_PROMPT =
  "Analizo këtë foto të menusë së restorantit/kafenesë. " +
  "Ekstrakto të gjithë artikujt e dukshëm me emër dhe çmim. " +
  "Përgjigju VETËM me JSON valid (pa markdown, pa shpjegim) në këtë format:\n" +
  '{"items":[{"name":"Emri i artikullit","price":12.5}]}';

function parsePrice(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }
  const cleaned = String(value ?? "")
    .replace(/\s/g, "")
    .replace(/[^\d.,-]/g, "")
    .replace(/,/g, ".");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function normalizeMenuItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  const seen = new Set();
  const items = [];

  for (const entry of rawItems) {
    const name = String(entry?.name ?? entry?.title ?? entry?.item ?? "").trim();
    const price = parsePrice(entry?.price ?? entry?.cmimi ?? entry?.amount);
    if (!name || price == null || price < 0) continue;

    const key = `${name.toLowerCase()}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ name, price });
  }

  return items;
}

function extractJsonPayload(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("AI nuk ktheu përgjigje.");

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("AI nuk ktheu JSON valid për artikujt e menusë.");
  }
}

async function scanMenuFromImage({ mime, base64 }) {
  if (isAiPaused()) {
    throw new Error("AI është i ndalur për momentin. Provoni përsëri më vonë.");
  }
  const config = getAnthropicVisionConfig();
  if (!config.ready) {
    throw new Error("Skanimi i menusë kërkon ANTHROPIC_API_KEY në environment.");
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
      max_tokens: config.maxTokens,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mime,
                data: base64,
              },
            },
            {
              type: "text",
              text: SCAN_PROMPT,
            },
          ],
        },
      ],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `Anthropic Vision gabim (${res.status})`);
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const payload = extractJsonPayload(text);
  const items = normalizeMenuItems(payload.items ?? payload.menu ?? payload);

  if (!items.length) {
    throw new Error("Nuk u gjetën artikuj në foto. Provoni një foto më të qartë të menusë.");
  }

  const tokensUsed =
    Number(data.usage?.input_tokens || 0) + Number(data.usage?.output_tokens || 0);

  return {
    items,
    tokensUsed,
    model: config.model,
    provider: "anthropic",
  };
}

module.exports = { scanMenuFromImage };
