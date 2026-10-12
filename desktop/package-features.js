/**
 * Pako 1–4 — kontroll i veçorive (fsheh/çaktivizo, mos fshi kod).
 * Default pa tier / pa licencë → Pako 4 (si më parë).
 */
const {
  toNewTier,
  labelForTier,
  normalizeTierKey,
  toLegacyTier,
  NEW_TO_LEGACY,
  isNewTierKey,
  TIER_LABELS,
} = require("./package-tier-map");

const PACKAGE_DENIED_MSG = "Nuk përfshihet në pakon tuaj";

const DEFAULT_NEW_TIER = "pako_4";
const DEFAULT_LEGACY_TIER = "pako_5";

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

/** Tab-e admin Pako 3 — Full (QR, cloud, rezervime) pa Kontabilist / AI; Licenca vetëm tab kryesor. */
const PAKO3_ADMIN_PANELS = new Set([
  ...PAKO2_ADMIN_PANELS,
  "rezervime",
  "qr-tavolinat",
]);

/** Pako 4 — të gjitha modulet admin (pa fshehje package CSS). */
const PAKO4_ADMIN_PANELS = new Set([
  ...PAKO3_ADMIN_PANELS,
  "kontabilisti",
  "ai",
]);

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

function effectiveNewTier(rawTier) {
  const t = normalizeTierKey(rawTier);
  if (!t) return DEFAULT_NEW_TIER;
  return toNewTier(t);
}

function effectiveLegacyTier(rawTier) {
  const t = normalizeTierKey(rawTier);
  if (!t) return DEFAULT_LEGACY_TIER;
  return toLegacyTier(t);
}

/** "1" | "pako_1" → pako_1 (test UI / settings). */
function parseTestNewTier(value) {
  const s = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "_");
  if (/^pako_[1-4]$/.test(s)) return s;
  if (/^[1-4]$/.test(s)) return `pako_${s}`;
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

/** Veçoritë sipas numërimit të ri pako_1…pako_4 (për licencë ose test). */
function featuresForNewTier(newTier) {
  const nt = parseTestNewTier(newTier) || normalizeTierKey(newTier);
  if (!/^pako_[1-4]$/.test(nt)) {
    return featuresForNewTier(DEFAULT_NEW_TIER);
  }
  const legacyTier = NEW_TO_LEGACY[nt] || DEFAULT_LEGACY_TIER;
  const label = isNewTierKey(nt) ? TIER_LABELS[nt] || "Pako 1" : labelForTier(nt);
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
      testOverride: false,
    };
  }
  if (nt === "pako_3") {
    return {
      newTier: nt,
      legacyTier,
      label,
      qrTables: true,
      cloudSync: true,
      cloudWaiterPhone: true,
      purchases: true,
      stock: true,
      promotions: true,
      diary: true,
      accountant: false,
      ai: false,
      testOverride: false,
    };
  }
  if (nt === "pako_4") {
    return {
      newTier: nt,
      legacyTier,
      label,
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
  return featuresForNewTier(DEFAULT_NEW_TIER);
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
