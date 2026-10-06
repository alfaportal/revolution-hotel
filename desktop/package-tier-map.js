/**
 * Revolution HOTEL — 3 pako: pako_1 (Bazik), pako_2 (Standard), pako_3 (Premium).
 */

const PACKAGE_TIERS = Object.freeze(["pako_1", "pako_2", "pako_3"]);

const TIER_LABELS = Object.freeze({
  pako_1: "Pako 1 — Bazik",
  pako_2: "Pako 2 — Standard",
  pako_3: "Pako 3 — Premium",
});

/** Lexim i vjetër DB — vetëm derisa të migrohet. */
const LEGACY_READ = Object.freeze({
  pako_3: "pako_1",
  pako_4: "pako_2",
  pako_2: "pako_3",
  pako_5: "pako_3",
  pako_premium: "pako_3",
});

function normalizeTierKey(tier) {
  return String(tier || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "_");
}

function normalizeHotelTier(tier) {
  const t = normalizeTierKey(tier);
  if (PACKAGE_TIERS.includes(t)) return t;
  return LEGACY_READ[t] || "pako_1";
}

function toNewTier(tier) {
  return normalizeHotelTier(tier);
}

function toLegacyTier(tier) {
  return normalizeHotelTier(tier);
}

function isAiPackage(tier) {
  return normalizeHotelTier(tier) === "pako_3";
}

function isRemovedBasic(_tier) {
  return false;
}

function labelForTier(tier) {
  return TIER_LABELS[normalizeHotelTier(tier)] || TIER_LABELS.pako_1;
}

function labelForLegacyTier(tier) {
  return labelForTier(tier);
}

function bakedNewTier() {
  try {
    const pkg = require("./package-tier");
    if (pkg && pkg.tier) return normalizeHotelTier(pkg.tier);
  } catch {
    /* ignore */
  }
  return null;
}

module.exports = {
  PACKAGE_TIERS,
  TIER_LABELS,
  normalizeTierKey,
  normalizeHotelTier,
  toNewTier,
  toLegacyTier,
  bakedNewTier,
  isAiPackage,
  isRemovedBasic,
  labelForTier,
  labelForLegacyTier,
};
