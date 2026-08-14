/** Çmimet e vlerësuara AI (EUR / 1 000 tokenë — Anthropic Claude Haiku blended). */

const AI_FEATURES = [
  "scan_menu",
  "scan_invoice",
  "daily_report",
  "weekly_report",
  "chat",
  "supply_suggestion",
  "stock_predict",
  "waiter_rating",
  "profit_forecast",
];

const LEGACY_FEATURE_MAP = {
  ocr: "scan_menu",
  chat: "chat",
};

const FEATURE_LABELS = {
  scan_menu: "Skanim menu",
  scan_invoice: "Skanim fature",
  daily_report: "Raport ditor AI",
  weekly_report: "Raport javor AI",
  chat: "Chat / asistent",
  supply_suggestion: "Sugjerime furnizimi",
  stock_predict: "Parashikim stoku",
  waiter_rating: "Vlerësim kamarierësh",
  profit_forecast: "Parashikim fitimi",
};

/** EUR për 1 000 tokenë — mbishkruhet me env. */
const COST_EUR_PER_1K = {
  scan_menu: Number(process.env.AI_COST_EUR_PER_1K_SCAN) || 0.0023,
  scan_invoice: Number(process.env.AI_COST_EUR_PER_1K_SCAN) || 0.0023,
  chat: Number(process.env.AI_COST_EUR_PER_1K_CHAT) || 0.00025,
  daily_report: Number(process.env.AI_COST_EUR_PER_1K_REPORT) || 0.00025,
  weekly_report: Number(process.env.AI_COST_EUR_PER_1K_REPORT) || 0.00025,
  supply_suggestion: Number(process.env.AI_COST_EUR_PER_1K_REPORT) || 0.00025,
  stock_predict: Number(process.env.AI_COST_EUR_PER_1K_REPORT) || 0.00025,
  waiter_rating: Number(process.env.AI_COST_EUR_PER_1K_REPORT) || 0.00025,
  profit_forecast: Number(process.env.AI_COST_EUR_PER_1K_REPORT) || 0.00025,
};

const USD_TO_EUR = Number(process.env.AI_USD_TO_EUR) || 0.92;

function normalizeFeature(feature) {
  const raw = String(feature || "").trim().toLowerCase();
  const mapped = LEGACY_FEATURE_MAP[raw] || raw;
  if (!AI_FEATURES.includes(mapped)) {
    throw new Error(`feature i pavlefshëm: ${feature}. Lejohen: ${AI_FEATURES.join(", ")}.`);
  }
  return mapped;
}

/** Mbështetje për kolonën legacy feature_type (chat | ocr). */
function legacyFeatureType(feature) {
  const f = normalizeFeature(feature);
  return f === "scan_menu" || f === "scan_invoice" ? "ocr" : "chat";
}

function normalizeTokens(tokensUsed) {
  const n = Math.floor(Number(tokensUsed));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`tokens_used i pavlefshëm: ${tokensUsed}`);
  }
  return n;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function estimateCostEur(feature, tokensUsed) {
  const f = normalizeFeature(feature);
  const tokens = normalizeTokens(tokensUsed);
  const rate = COST_EUR_PER_1K[f] ?? COST_EUR_PER_1K.chat;
  return roundMoney((tokens / 1000) * rate);
}

function estimateCostUsd(feature, tokensUsed) {
  const eur = estimateCostEur(feature, tokensUsed);
  return roundMoney(eur / USD_TO_EUR);
}

/** @deprecated Përdorni normalizeFeature — mbetet për kompatibilitet. */
function normalizeFeatureType(featureType) {
  return normalizeFeature(featureType);
}

/** @deprecated Përdorni estimateCostEur */
function estimateCostUsdLegacy(featureType, tokensUsed) {
  return estimateCostUsd(featureType, tokensUsed);
}

module.exports = {
  AI_FEATURES,
  FEATURE_LABELS,
  LEGACY_FEATURE_MAP,
  COST_EUR_PER_1K,
  USD_TO_EUR,
  normalizeFeature,
  normalizeFeatureType,
  legacyFeatureType,
  normalizeTokens,
  estimateCostEur,
  estimateCostUsd,
  estimateCostUsdLegacy,
  roundMoney,
};
