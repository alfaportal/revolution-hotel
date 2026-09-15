const { getSupabase } = require("../db");
const {
  normalizeFeature,
  legacyFeatureType,
  normalizeTokens,
  estimateCostEur,
  estimateCostUsd,
} = require("../lib/aiPricing");

async function insertAiUsageLog({ restaurantId, feature, featureType, tokensUsed, costUsd, costEur }) {
  const db = getSupabase();
  const normalizedFeature = normalizeFeature(feature || featureType);
  const tokens = normalizeTokens(tokensUsed);
  const row = {
    restaurant_id: String(restaurantId).trim(),
    feature: normalizedFeature,
    feature_type: legacyFeatureType(normalizedFeature),
    tokens_used: tokens,
    cost_eur: costEur != null ? costEur : estimateCostEur(normalizedFeature, tokens),
    cost_usd: costUsd != null ? costUsd : estimateCostUsd(normalizedFeature, tokens),
  };

  const { data, error } = await db.from("ai_usage_logs").insert(row).select().single();
  if (error) throw error;
  return data;
}

module.exports = {
  insertAiUsageLog,
};
