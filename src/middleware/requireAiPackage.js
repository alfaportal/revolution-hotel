const { getClientById } = require("../services/salesService");
const { clientHasFeature, packageUpgradeMessage } = require("../lib/packages");
const { assertAiTokenLimit } = require("../services/aiTokenLimitService");
const { resolveRestaurantId } = require("./trackAiUsage");

async function requireAiPackage(req, res, next) {
  try {
    const restaurantId = resolveRestaurantId(req);
    if (!restaurantId) {
      return res.status(403).json({ ok: false, gabim: "Restoranti nuk u identifikua." });
    }
    const client = await getClientById(restaurantId);
    if (!client) {
      return res.status(404).json({ ok: false, gabim: "Klienti nuk u gjet." });
    }
    if (!clientHasFeature(client, "ai")) {
      return res.status(403).json({
        ok: false,
        gabim: packageUpgradeMessage("ai"),
        code: "PACKAGE_UPGRADE_REQUIRED",
        feature: "ai",
        package_tier: client.package_tier || "pako_1",
      });
    }

    try {
      await assertAiTokenLimit(restaurantId);
    } catch (limitErr) {
      if (limitErr.code === "AI_TOKEN_LIMIT_EXCEEDED") {
        return res.status(403).json({
          ok: false,
          gabim: limitErr.message,
          code: limitErr.code,
          tokens_used: limitErr.tokens_used,
          tokens_limit: limitErr.tokens_limit,
        });
      }
      throw limitErr;
    }

    req.client = client;
    return next();
  } catch (e) {
    console.error("[requireAiPackage]", e.message || e);
    return res.status(400).json({
      ok: false,
      gabim: e.message || "Gabim gjatë kontrollit të paketës AI.",
    });
  }
}

module.exports = { requireAiPackage };
