/**
 * Revolution HOTEL — një Setup (Pako 4). Pako 3/4 ndryshohen nga telefoni (cloud).
 *
 * E RE (newTier)                CLOUD / LEGACY ID
 * ──────────────                ─────────────────
 * pako_3  (Pako — pa AI)                  pako_2
 * pako_4  (Pako AI)                       pako_5
 */

const LEGACY_BASIC = "pako_2";

const NEW_TIERS = Object.freeze(["pako_1", "pako_2", "pako_3", "pako_4"]);

/** Radha e butonave në Super Admin (ID legacy që ruhen në DB). */
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

const TIER_LABELS = Object.freeze({
  pako_1: "Pako",
  pako_2: "Pako",
  pako_3: "Pako",
  pako_4: "Pako AI",
});

function normalizeTierKey(tier) {
  return String(tier || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "_");
}

function isNewTierKey(tier) {
  return NEW_TIERS.includes(normalizeTierKey(tier));
}

/**
 * Normalizo në numërimin e ri (pako_1…pako_4).
 * Stringjet pako_2…pako_5 trajtohen si LEGACY (cloud/UI e vjetër).
 */
function toNewTier(tier) {
  const t = normalizeTierKey(tier);
  if (LEGACY_TO_NEW[t]) return LEGACY_TO_NEW[t];
  if (isNewTierKey(t)) return t;
  return "pako_1";
}

/** Lexo newTier nga package-tier.js i bake-uar (nëse ekziston). */
function bakedNewTier() {
  try {
    const pkg = require("./package-tier");
    if (pkg && pkg.newTier) return normalizeTierKey(pkg.newTier);
    if (pkg && pkg.ai === true) return "pako_4";
  } catch {
    /* ignore */
  }
  return null;
}

/** Për API/cloud që ende pret pako_2…pako_5. */
function toLegacyTier(tier) {
  const n = toNewTier(tier);
  return NEW_TO_LEGACY[n] || "pako_3";
}

/**
 * AI vetëm Pako 4 (newTier=pako_4 ose ai:true në package-tier).
 * Pa bake: cloud pako_5 = AI.
 */
function isAiPackage(tier) {
  const t = normalizeTierKey(tier);
  if (t === "pako_4" || t === "pako_5") return true;
  if (t === "pako_1" || t === "pako_2" || t === "pako_3") return false;
  const baked = bakedNewTier();
  if (baked) return baked === "pako_4";
  try {
    const pkg = require("./package-tier");
    if (pkg && pkg.ai === true) return true;
    if (pkg && pkg.ai === false) return false;
  } catch {
    /* ignore */
  }
  return false;
}

function isRemovedBasic(tier) {
  return normalizeTierKey(tier) === LEGACY_BASIC;
}

function labelForTier(tier) {
  return TIER_LABELS[toNewTier(tier)] || "Pako";
}

function labelForLegacyTier(legacyTier) {
  return labelForTier(legacyTier);
}

module.exports = {
  NEW_TIERS,
  ADMIN_LEGACY_ORDER,
  NEW_TO_LEGACY,
  LEGACY_TO_NEW,
  TIER_LABELS,
  normalizeTierKey,
  isNewTierKey,
  toNewTier,
  toLegacyTier,
  bakedNewTier,
  isAiPackage,
  isRemovedBasic,
  labelForTier,
  labelForLegacyTier,
};
