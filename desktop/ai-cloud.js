/**
 * Thirrje AI te serveri cloud (Revolution HOTEL) — kërkon licencë + internet.
 */
const cloudHealth = require("./cloud-health");
const { hotelCloudApiPath } = require("./cloud-server-url");

/**
 * Master switch për AI në HOTEL (gate: Pako 3 — Premium / pako_3).
 */
const AI_ENABLED = true;
const AI_DISABLED_MSG = "AI kërkon internet dhe çelësin e licencës (Pako 3 — Premium).";

function normalizeKey(k) {
  return String(k || "").trim().toUpperCase().replace(/\s+/g, "");
}

function electronApp() {
  try {
    return require("electron").app;
  } catch {
    return null;
  }
}

function getAiCloudConfig(db) {
  const license = require("./license");
  const eapp = electronApp();
  const settingsKey = db.getSetting("cloud_license_key", "");
  const fileKey = eapp ? license.readStoredLicense(eapp) : "";
  const celesi = normalizeKey(settingsKey || fileKey);
  return { serverUrl: cloudHealth.getActiveServerUrl(), celesi };
}

async function requestJson(method, _baseUrl, path, payload, headers = {}) {
  const apiPath = hotelCloudApiPath(path);
  const res = await cloudHealth.requestJsonWithFallback(method, apiPath, payload, {
    timeoutMs: 120000,
    headers: { Accept: "application/json", ...headers },
  });
  let parsed = {};
  try {
    parsed = JSON.parse(res.data || "{}");
  } catch {
    parsed = { gabim: res.data || `HTTP ${res.status}` };
  }
  if (res.status >= 400) {
    const err = new Error(parsed.gabim || parsed.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = parsed.code || null;
    throw err;
  }
  return parsed;
}

function accountantForTier(tier) {
  const { normalizeHotelTier } = require("./package-tier-map");
  return normalizeHotelTier(tier) === "pako_3";
}

function localFeaturesForTier(tier) {
  const { isAiPackage, bakedNewTier, normalizeHotelTier } = require("./package-tier-map");
  const norm = (t) => normalizeHotelTier(t);
  try {
    const eapp = electronApp();
    if (eapp) {
      const license = require("./license");
      const rec = license.readActivationRecord(eapp);
      if (rec?.features && typeof rec.features === "object") {
        const pkg = norm(rec.package_tier || tier);
        const ai =
          typeof rec.features.ai === "boolean"
            ? !!rec.features.ai
            : isAiPackage(pkg);
        const accountant =
          typeof rec.features.accountant === "boolean"
            ? !!rec.features.accountant
            : accountantForTier(pkg);
        if (!AI_ENABLED) return { ai: false, accountant };
        return { ai, accountant };
      }
      if (rec?.package_tier) {
        const pkg = norm(rec.package_tier);
        return {
          ai: AI_ENABLED && isAiPackage(pkg),
          accountant: accountantForTier(pkg),
        };
      }
    }
  } catch {
    /* ignore */
  }
  if (tier) {
    const pkg = norm(tier);
    return {
      ai: AI_ENABLED && isAiPackage(pkg),
      accountant: accountantForTier(pkg),
    };
  }
  const baked = bakedNewTier();
  if (baked) {
    return {
      ai: AI_ENABLED && baked === "pako_3",
      accountant: baked === "pako_3",
    };
  }
  return { ai: false, accountant: false };
}

async function fetchAiStatus(db) {
  if (!AI_ENABLED) {
    return {
      ok: true,
      enabled: false,
      paused: true,
      configured: false,
      package_ai: false,
      gabim: AI_DISABLED_MSG,
    };
  }
  const { serverUrl, celesi } = getAiCloudConfig(db);
  if (!celesi) {
    return {
      ok: true,
      enabled: false,
      configured: false,
      package_ai: false,
      gabim: "Mungon çelësi i licencës.",
    };
  }
  try {
    const data = await requestJson("GET", serverUrl, "/api/ai/status", null, {
      "X-License-Key": celesi,
    });
    return {
      ok: true,
      enabled: !!data.enabled,
      paused: !!data.paused,
      configured: !!data.configured,
      package_ai: !!data.package_ai,
      package_tier: data.package_tier || null,
    };
  } catch (err) {
    const msg =
      err.code === "PACKAGE_AI_REQUIRED"
        ? "Pakoja e licencës nuk përfshin AI. Te Super Admin zgjidhni «Pako 3 — Premium» (pako_3)."
        : err.message || "Nuk u lidh me serverin AI.";
    return {
      ok: false,
      enabled: false,
      configured: false,
      package_ai: false,
      gabim: msg,
    };
  }
}

async function scanMenuFromCloud(db, { photo }) {
  if (!AI_ENABLED) {
    const err = new Error(AI_DISABLED_MSG);
    err.status = 503;
    throw err;
  }
  const { serverUrl, celesi } = getAiCloudConfig(db);
  if (!celesi) throw new Error("Vendosni çelësin e licencës (Admin → Licenca ose Cloud).");
  if (!String(photo || "").trim()) throw new Error("Mungon foto e menusë.");

  const data = await requestJson(
    "POST",
    serverUrl,
    "/api/ai/scan-menu",
    { photo: String(photo).trim() },
    { "X-License-Key": celesi },
  );
  if (!data.ok) throw new Error(data.gabim || "Skanimi dështoi.");
  return {
    items: Array.isArray(data.items) ? data.items : [],
    usage: data.usage || {},
  };
}

async function scanInvoiceFromCloud(db, { photo }) {
  if (!AI_ENABLED) {
    const err = new Error(AI_DISABLED_MSG);
    err.status = 503;
    throw err;
  }
  const { serverUrl, celesi } = getAiCloudConfig(db);
  if (!celesi) throw new Error("Vendosni çelësin e licencës (Admin → Licenca ose Cloud).");
  if (!String(photo || "").trim()) throw new Error("Mungon foto e faturës.");

  const data = await requestJson(
    "POST",
    serverUrl,
    "/api/ai/scan-invoice",
    { photo: String(photo).trim() },
    { "X-License-Key": celesi },
  );
  if (!data.ok) throw new Error(data.gabim || "Skanimi i faturës dështoi.");
  return {
    supplier: data.supplier || "",
    supplier_nui: data.supplier_nui || "",
    supplier_vat: data.supplier_vat || "",
    vat_rate: data.vat_rate != null ? Number(data.vat_rate) : 18,
    purchase_kind: data.purchase_kind || "goods",
    invoice_number: data.invoice_number || "",
    invoice_date: data.invoice_date || "",
    items: Array.isArray(data.items) ? data.items : [],
    document_type: data.document_type || "stock_purchase",
    classification: data.classification || null,
    totals_check: data.totals_check || null,
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    usage: data.usage || {},
  };
}

async function fetchAiUsageFromCloud(db, { month } = {}) {
  if (!AI_ENABLED) {
    return { ok: true, tokens_total: 0, cost_eur_total: 0, calls: 0 };
  }
  const { serverUrl, celesi } = getAiCloudConfig(db);
  if (!celesi) throw new Error("Mungon çelësi i licencës.");
  const q = month ? `?month=${encodeURIComponent(month)}` : "";
  const data = await requestJson("GET", serverUrl, `/api/ai/usage${q}`, null, {
    "X-License-Key": celesi,
  });
  return data;
}

function buildQuery(query = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function fetchOwnerAi(db, path, { query } = {}) {
  if (!AI_ENABLED) {
    const err = new Error(AI_DISABLED_MSG);
    err.status = 503;
    throw err;
  }
  const { serverUrl, celesi } = getAiCloudConfig(db);
  if (!celesi) throw new Error("Vendosni çelësin e licencës.");
  const data = await requestJson("GET", serverUrl, `${path}${buildQuery(query)}`, null, {
    "X-License-Key": celesi,
  });
  return data;
}

async function postOwnerAi(db, path, body = {}) {
  if (!AI_ENABLED) {
    const err = new Error(AI_DISABLED_MSG);
    err.status = 503;
    throw err;
  }
  const { serverUrl, celesi } = getAiCloudConfig(db);
  if (!celesi) throw new Error("Vendosni çelësin e licencës.");
  const data = await requestJson("POST", serverUrl, path, body, {
    "X-License-Key": celesi,
  });
  return data;
}

module.exports = {
  AI_ENABLED,
  AI_DISABLED_MSG,
  getAiCloudConfig,
  requestJson,
  accountantForTier,
  localFeaturesForTier,
  fetchAiStatus,
  scanMenuFromCloud,
  scanInvoiceFromCloud,
  fetchAiUsageFromCloud,
  fetchOwnerAi,
  postOwnerAi,
};
