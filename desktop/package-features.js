/**
 * Pako 1–3 — kontroll i veçorive (fsheh/çaktivizo, mos fshi kod).
 * Default pa tier / pa licencë → Pako 3 (Premium).
 */
const {
  toNewTier,
  labelForTier,
  normalizeTierKey,
  toLegacyTier,
  TIER_LABELS,
  PACKAGE_TIERS,
} = require("./package-tier-map");

const PACKAGE_DENIED_MSG = "Nuk përfshihet në pakon tuaj";

const DEFAULT_NEW_TIER = "pako_3";
const DEFAULT_LEGACY_TIER = "pako_3";

/** Tab-e kryesore admin për Pako 1 (numërim i ri). */
const PAKO1_ADMIN_PANELS = new Set([
  "pasqyra",
  "menuja",
  "stafi",
  "tavolinat",
  "fiskalizimi",
  "kuponet-fiskale",
  "bllokim-i-letrës",
  "cilësimet",
  "audit-fiskal",
  "raportet",
  "licenca-admin",
]);

/** Tab-e admin për Pako 2 = Pako 1 + Blerjet, Stoku, Promocione, Ditari. */
const PAKO2_ADMIN_PANELS = new Set([
  ...PAKO1_ADMIN_PANELS,
  "blerjet",
  "stoku",
  "promocione",
  "ditari",
]);

/** Pako 3 — Full (QR, cloud, rezervime, Kontabilisti, AI). */
const PAKO3_ADMIN_PANELS = new Set([
  ...PAKO2_ADMIN_PANELS,
  "rezervime",
  "qr-tavolinat",
  "kontabilisti",
  "ai",
]);

/** Alias — i njëjti set si Pako 3 (nuk ka Pako 4). */
const PAKO4_ADMIN_PANELS = PAKO3_ADMIN_PANELS;

function rawTierFromRuntime() {
  try {
    const electron = require("electron");
    const app = electron.app;
    if (app) {
      const license = require("./license");
      const raw = license.getActivationPackageTier(app);
      if (raw) return raw;
    }
  } catch {
    /* dev / node */
  }
  try {
    const VERSION = require("./version-config");
    return String(VERSION.packageTier || "").trim();
  } catch {
    return "";
  }
}

/** pako_4 / pako_5 (legacy) → pako_3 — nuk ekziston Pako 4 si produkt. */
function coerceProductTier(newTier) {
  const t = String(newTier || "").trim().toLowerCase();
  if (t === "pako_4" || t === "pako_5" || t === "pako_premium") return "pako_3";
  return t;
}

function effectiveNewTier(rawTier) {
  const t = normalizeTierKey(rawTier);
  if (!t) return DEFAULT_NEW_TIER;
  return coerceProductTier(toNewTier(t));
}

function effectiveLegacyTier(rawTier) {
  const t = normalizeTierKey(rawTier);
  if (!t) return DEFAULT_LEGACY_TIER;
  return coerceProductTier(toLegacyTier(t));
}

/** "1" | "pako_1" → pako_1 (test UI / settings). Vetëm 1–3. */
function parseTestNewTier(value) {
  const s = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "_");
  if (/^pako_[1-3]$/.test(s)) return s;
  if (s === "pako_4" || s === "pako_5" || s === "pako_premium") return "pako_3";
  if (/^[1-3]$/.test(s)) return `pako_${s}`;
  if (s === "4" || s === "5") return "pako_3";
  return "";
}

/** Override i përkohshëm: ENV KAFENE_TEST_PAKO=1 ose settings.package_test_override */
function readTestOverrideNewTier() {
  const fromEnv = parseTestNewTier(process.env.KAFENE_TEST_PAKO);
  if (fromEnv) return fromEnv;
  try {
    const db = require("./database");
    const fromDb = parseTestNewTier(db.getSetting("package_test_override", ""));
    if (fromDb) return fromDb;
  } catch {
    /* ignore */
  }
  return "";
}

/** Veçoritë sipas pako_1…pako_3. */
function featuresForNewTier(newTier) {
  let nt = parseTestNewTier(newTier) || normalizeTierKey(newTier);
  nt = coerceProductTier(nt);
  if (!PACKAGE_TIERS.includes(nt)) {
    return featuresForNewTier(DEFAULT_NEW_TIER);
  }
  const legacyTier = coerceProductTier(toLegacyTier(nt));
  const label = TIER_LABELS[nt] || labelForTier(nt);
  if (nt === "pako_1") {
    return {
      newTier: nt,
      legacyTier,
      label,
      qrTables: false,
      cloudSync: false,
      cloudWaiterPhone: false,
      testOverride: false,
    };
  }
  if (nt === "pako_2") {
    return {
      newTier: nt,
      legacyTier,
      label,
      qrTables: false,
      cloudSync: false,
      cloudWaiterPhone: false,
      purchases: true,
      stock: true,
      promotions: true,
      diary: true,
      accountant: false,
      ai: false,
      testOverride: false,
    };
  }
  /* pako_3 — Premium (Kontabilisti + AI përfshihen) */
  return {
    newTier: "pako_3",
    legacyTier,
    label: TIER_LABELS.pako_3 || label,
    qrTables: true,
    cloudSync: true,
    cloudWaiterPhone: true,
    purchases: true,
    stock: true,
    promotions: true,
    diary: true,
    accountant: true,
    ai: true,
    testOverride: false,
  };
}

/**
 * @param {string} [rawTier] — legacy ose new tier nga licenca
 */
function packageFeatures(rawTier) {
  const test = readTestOverrideNewTier();
  if (test) {
    const pf = featuresForNewTier(test);
    return { ...pf, testOverride: true };
  }
  const raw =
    rawTier != null && String(rawTier).trim() ? String(rawTier).trim() : rawTierFromRuntime();
  const newTier = effectiveNewTier(raw);
  const base = featuresForNewTier(newTier);
  return {
    ...base,
    legacyTier: effectiveLegacyTier(raw),
  };
}

function getRuntimeFeatures() {
  return packageFeatures(rawTierFromRuntime());
}

function applySettingsPackagePayload(payload, queryPako) {
  const qTest = parseTestNewTier(queryPako);
  if (qTest) {
    const pf = featuresForNewTier(qTest);
    payload.packageTier = pf.legacyTier;
    payload.newPackageTier = pf.newTier;
    payload.packageLabel = pf.label;
    payload.packageGates = {
      qr: pf.qrTables,
      cloud: pf.cloudSync,
      cloud_waiter: pf.cloudWaiterPhone,
    };
    payload.packageFeatures = { ...(payload.packageFeatures || {}) };
    if (typeof pf.accountant === "boolean") payload.packageFeatures.accountant = pf.accountant;
    if (typeof pf.ai === "boolean") payload.packageFeatures.ai = pf.ai;
    payload.packageTestMode = true;
    payload.packageTestSource = "query_pako";
    return payload;
  }
  const pf = packageFeatures(null);
  if (!payload.newPackageTier) payload.newPackageTier = pf.newTier;
  if (!payload.packageTier) payload.packageTier = pf.legacyTier;
  if (!payload.packageLabel) payload.packageLabel = pf.label;
  if (!payload.packageFeatures || typeof payload.packageFeatures !== "object") {
    payload.packageFeatures = {};
  }
  if (pf.newTier === "pako_3") {
    payload.packageFeatures.accountant = true;
    payload.packageFeatures.ai = !!pf.ai;
  }
  return payload;
}

function isPako1(rawTier) {
  return effectiveNewTier(rawTier) === "pako_1";
}

function assertPackageFeature(feature) {
  return (req, res, next) => {
    const f = getRuntimeFeatures();
    const allowed =
      feature === "qr"
        ? f.qrTables
        : feature === "cloud"
          ? f.cloudSync
          : true;
    if (!allowed) {
      return res.status(403).json({ ok: false, gabim: PACKAGE_DENIED_MSG });
    }
    next();
  };
}

module.exports = {
  PACKAGE_DENIED_MSG,
  DEFAULT_NEW_TIER,
  DEFAULT_LEGACY_TIER,
  PAKO1_ADMIN_PANELS,
  PAKO2_ADMIN_PANELS,
  PAKO3_ADMIN_PANELS,
  PAKO4_ADMIN_PANELS,
  rawTierFromRuntime,
  effectiveNewTier,
  effectiveLegacyTier,
  parseTestNewTier,
  readTestOverrideNewTier,
  featuresForNewTier,
  packageFeatures,
  getRuntimeFeatures,
  applySettingsPackagePayload,
  isPako1,
  assertPackageFeature,
};
