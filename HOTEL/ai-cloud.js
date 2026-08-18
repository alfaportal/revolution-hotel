/**
 * Thirrje AI te serveri cloud (Revolution POS) — kërkon licencë + internet.
 */
const cloudHealth = require("./cloud-health");

/**
 * Master switch për AI në HOTEL.
 * Cloud hotel — FIKUR. AI aktivizohet kur hoteli lidhet me cloud-in e vet.
 */
const AI_ENABLED = false;
const AI_DISABLED_MSG = "AI do të aktivizohet kur hoteli të lidhet me cloud";

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

function getAiCloudConfig(_db) {
  /* Hotel: pa cloud AI / pa çelës hotel. */
  return { serverUrl: "", celesi: "" };
}

async function requestJson(method, _baseUrl, path, payload, headers = {}) {
  const res = await cloudHealth.requestJsonWithFallback(method, path, payload, {
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
  const { toNewTier } = require("./package-tier-map");
  const n = toNewTier(tier);
  /* Kontabilisti vetëm Pako 3 Full + Pako 4 AI — JO Pako 1–2 */
  return n === "pako_3" || n === "pako_4";
}

function localFeaturesForTier(tier) {
  const { isAiPackage, bakedNewTier } = require("./package-tier-map");
  /* Prefero pakën nga heartbeat/cloud — jo bake — që UI ndryshon pa restart */
  try {
    const eapp = electronApp();
    if (eapp) {
      const license = require("./license");
      const rec = license.readActivationRecord(eapp);
      if (rec?.features && typeof rec.features === "object") {
        const ai =
          typeof rec.features.ai === "boolean"
            ? !!rec.features.ai
            : isAiPackage(rec.package_tier || tier);
        const accountant =
          typeof rec.features.accountant === "boolean"
            ? !!rec.features.accountant
            : accountantForTier(rec.package_tier || tier);
        if (!AI_ENABLED) return { ai: false, accountant };
        return { ai, accountant };
      }
      if (rec?.package_tier) {
        return {
          ai: AI_ENABLED && isAiPackage(rec.package_tier),
          accountant: accountantForTier(rec.package_tier),
        };
      }
    }
  } catch {
    /* ignore */
  }
  if (tier) {
    return {
      ai: AI_ENABLED && isAiPackage(tier),
      accountant: accountantForTier(tier),
    };
  }
  const baked = bakedNewTier();
  if (baked) {
    return {
      ai: AI_ENABLED && baked === "pako_4",
      accountant: baked === "pako_3" || baked === "pako_4",
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
    return {
      ok: false,
      enabled: false,
      configured: false,
      package_ai: false,
      gabim: err.message || "Nuk u lidh me serverin AI.",
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

/** Owner AI routes — autentifikim me license key (i njëjti si scan). */
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
  localFeaturesForTier,
  fetchAiStatus,
  scanMenuFromCloud,
  scanInvoiceFromCloud,
  fetchAiUsageFromCloud,
  fetchOwnerAi,
  postOwnerAi,
};
