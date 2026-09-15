/**
 * Mapimi i pakove të reja ↔ ID legacy (i njëjti me KAFENE/package-tier-map.js).
 *
 * E RE                          CLOUD / LEGACY ID
 * ─────                         ─────────────────
 * pako_1  (Pako 1)              pako_3  Standard
 * pako_2  (Pako 2)              pako_4  Pro
 * pako_3  (Pako 3, pa AI)       pako_2  (ripërdorur; Full pa AI)
 * pako_4  (Pako 4 + AI)         pako_5
 */

const NEW_TIERS = Object.freeze(["pako_1", "pako_2", "pako_3", "pako_4"]);

const ADMIN_LEGACY_ORDER = Object.freeze(["pako_3", "pako_4", "pako_2", "pako_5"]);

const NEW_TO_LEGACY = Object.freeze({
  pako_1: "pako_3",
  pako_2: "pako_4",
  pako_3: "pako_2",
  pako_4: "pako_5",
});

const LEGACY_TO_NEW = Object.freeze({
  pako_3: "pako_1",
  pako_4: "pako_2",
  pako_2: "pako_3",
  pako_5: "pako_4",
});

const TIER_LABELS_NEW = Object.freeze({
  pako_1: "Pako 1",
  pako_2: "Pako 2",
  pako_3: "Pako 3",
  pako_4: "Pako 4 (AI)",
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
  return normalizeTierKey(tier) === "pako_5" || toNewTier(tier) === "pako_4";
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
