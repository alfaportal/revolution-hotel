const { insertAiUsageLog } = require("../services/aiUsageService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveRestaurantId(req) {
  return (
    req.user?.client_id ||
    req.kitchenClient?.id ||
    req.publicClient?.id ||
    req.client?.id ||
    req.license?.client_id ||
    null
  );
}

function isValidRestaurantId(restaurantId) {
  return typeof restaurantId === "string" && UUID_RE.test(restaurantId.trim());
}

/**
 * Regjistron një thirrje AI në ai_usage_logs (mos e ndal operacionin nëse dështon logu).
 * @param {string} restaurantId
 * @param {import('../lib/aiPricing').AI_FEATURES[number]|'chat'|'ocr'} feature
 * @param {number} tokensUsed
 */
async function trackAiUsage(restaurantId, feature, tokensUsed, options = {}) {
  if (!isValidRestaurantId(restaurantId)) {
    console.warn("[ai-usage] restaurant_id mungon ose është i pavlefshëm");
    return null;
  }

  try {
    return await insertAiUsageLog({
      restaurantId: restaurantId.trim(),
      feature: options.feature || feature,
      tokensUsed,
      costUsd: options.costUsd,
      costEur: options.costEur,
    });
  } catch (err) {
    console.warn("[ai-usage]", err.message);
    return null;
  }
}

async function trackAiUsageFromReq(req, feature, tokensUsed, options = {}) {
  const restaurantId = options.restaurantId || resolveRestaurantId(req);
  return trackAiUsage(restaurantId, feature, tokensUsed, options);
}

module.exports = {
  trackAiUsage,
  trackAiUsageFromReq,
  resolveRestaurantId,
};
