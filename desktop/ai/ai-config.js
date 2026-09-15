/**
 * AI config — toggle + lidhje me package-tier-map.
 *
 * AI QASJA — 3 NIVELE:
 * 1. Admin (Naseri) në telefon — AI komplet, krejt klientët
 * 2. Pronari në panel (kompjuter) — AI me kategori (shitjet, stoku, kamarierët)
 * 3. Pronari në telefon — skanim fature + chat i thjeshtë
 */
const { isAiPackage, bakedNewTier, labelForTier } = require("../package-tier-map");
const aiCloud = require("../ai-cloud");

function isAiEnabledLocally(tier) {
  if (!aiCloud.AI_ENABLED) return false;
  return isAiPackage(tier);
}

function packageLabel(tier) {
  return labelForTier(tier);
}

function currentNewTier(tier) {
  return bakedNewTier() || require("../package-tier-map").toNewTier(tier);
}

module.exports = {
  isAiEnabledLocally,
  packageLabel,
  currentNewTier,
  init() {
    /* no-op */
  },
};
