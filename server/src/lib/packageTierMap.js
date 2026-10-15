/**
 * Mapimi marketing 1–3 ↔ ID legacy në DB (restorant / POS).
 * HOTEL përdor pako_1…pako_3 direkt (shih hotelPackageTier.js).
 *
 * E RE (marketing)          LEGACY ID në DB
 * pako_1  Pako 1             pako_3
 * pako_2  Pako 2             pako_4
 * pako_3  Pako 3 Premium    pako_5 (+ AI / Kontabilisti)
 */

const NEW_TIERS = Object.freeze(["pako_1", "pako_2", "pako_3"]);

const ADMIN_LEGACY_ORDER = Object.freeze(["pako_3", "pako_4", "pako_2", "pako_5"]);

const NEW_TO_LEGACY = Object.freeze({
  pako_1: "pako_3",
  pako_2: "pako_4",
  pako_3: "pako_5",
});

const LEGACY_TO_NEW = Object.freeze({
  pako_3: "pako_1",
  pako_4: "pako_2",
  pako_2: "pako_3",
  pako_5: "pako_3",
  pako_premium: "pako_3",
});

const TIER_LABELS_NEW = Object.freeze({
  pako_1: "Pako 1",
  pako_2: "Pako 2",
  pako_3: "Pako 3 — Premium",
});

function normalizeTierKey(tier) {
  return String(tier || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "_");
}

function toNewTier(tier) {
  const t = normalizeTierKey(tier);
  if (LEGACY_TO_NEW[t]) return LEGACY_TO_NEW[t];
  if (NEW_TIERS.includes(t)) return t;
  return "pako_1";
}

function toLegacyTier(tier) {
  const n = toNewTier(tier);
  return NEW_TO_LEGACY[n] || "pako_3";
}

function labelForTier(tier) {
  return TIER_LABELS_NEW[toNewTier(tier)] || "Pako 1";
}

function isAiLegacyTier(tier) {
  const t = normalizeTierKey(tier);
  return t === "pako_2" || t === "pako_5" || t === "pako_premium" || toNewTier(tier) === "pako_3";
}

module.exports = {
  NEW_TIERS,
  ADMIN_LEGACY_ORDER,
  NEW_TO_LEGACY,
  LEGACY_TO_NEW,
  TIER_LABELS_NEW,
  normalizeTierKey,
  toNewTier,
  toLegacyTier,
  labelForTier,
  isAiLegacyTier,
};
