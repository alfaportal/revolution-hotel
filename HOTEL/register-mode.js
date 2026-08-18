/**
 * Modaliteti i faturës — Auto (kamarieri zgjedh), Termik, ose Fiskal.
 *
 * Dy burime, gjithmonë të dukshme, kurrë me kod të fshehtë:
 *  - LOKAL: admini e vendos te KAFENE (admin.html) — ruhet në SQLite.
 *  - CLOUD: pronari e vendos nga telefoni (paneli i tij) — KAFENE e LEXON
 *    periodikisht (cloud-auto-sync.js -> cloudSync.fetchRegisterModeFromCloud)
 *    dhe e ruan në cache lokal. KAFENE nuk shkruan kurrë te cloud për këtë.
 *
 * Nëse pronari e ka detyruar një modalitet nga telefoni (cloud mode != "auto"),
 * ai mbizotëron mbi settings-in lokal — kështu ndërrimi nga telefoni prek
 * vërtet printimin te lokali. Përndryshe vlen vendimi lokal i adminit.
 */

const MODE_KEY = "active_coupon_type";
const UPDATED_AT_KEY = "register_mode_updated_at";
const UPDATED_BY_KEY = "register_mode_updated_by";

const CLOUD_MODE_KEY = "cloud_register_mode";
const CLOUD_UPDATED_AT_KEY = "cloud_register_mode_updated_at";
const CLOUD_UPDATED_BY_KEY = "cloud_register_mode_updated_by";
const CLOUD_FETCHED_AT_KEY = "cloud_register_mode_fetched_at";

const VALID_MODES = ["auto", "thermal", "fiscal"];

function normalizeRegisterMode(raw) {
  const v = String(raw || "auto").trim().toLowerCase();
  return VALID_MODES.includes(v) ? v : "auto";
}

function getLocalRegisterModeState(db) {
  return {
    mode: normalizeRegisterMode(db.getSetting(MODE_KEY, "auto")),
    updated_at: db.getSetting(UPDATED_AT_KEY, "") || null,
    updated_by: db.getSetting(UPDATED_BY_KEY, "") || "",
  };
}

/** Vendos modalitetin LOKAL — thirret vetëm nga endpoint-i adminOnly te server.js. */
function setRegisterMode(db, mode, actorName) {
  const normalized = normalizeRegisterMode(mode);
  db.setSetting(MODE_KEY, normalized);
  db.setSetting(UPDATED_AT_KEY, new Date().toISOString());
  db.setSetting(UPDATED_BY_KEY, String(actorName || "").trim());
  return getRegisterModeState(db);
}

function getCloudRegisterModeCache(db) {
  const raw = String(db.getSetting(CLOUD_MODE_KEY, "") || "").trim();
  if (!raw) return null;
  return {
    mode: normalizeRegisterMode(raw),
    updated_at: db.getSetting(CLOUD_UPDATED_AT_KEY, "") || null,
    updated_by: db.getSetting(CLOUD_UPDATED_BY_KEY, "") || "",
    fetched_at: db.getSetting(CLOUD_FETCHED_AT_KEY, "") || null,
  };
}

/** Ruan në cache lokal modalitetin e lexuar nga cloud — thirret vetëm nga cloud-auto-sync.js. */
function cacheCloudRegisterMode(db, state) {
  db.setSetting(CLOUD_MODE_KEY, normalizeRegisterMode(state?.mode));
  db.setSetting(CLOUD_UPDATED_AT_KEY, state?.updated_at || "");
  db.setSetting(CLOUD_UPDATED_BY_KEY, state?.updated_by || "");
  db.setSetting(CLOUD_FETCHED_AT_KEY, new Date().toISOString());
}

/** Gjendja EFEKTIVE — çka po zbatohet vërtet te printimi.
 * Cloud (telefoni i pronarit) mbizotëron kur ka detyruar një modalitet;
 * përndryshe vlen vendimi lokal (admin.html). */
function getRegisterModeState(db) {
  const local = getLocalRegisterModeState(db);
  const cloud = getCloudRegisterModeCache(db);
  if (cloud && cloud.mode !== "auto") {
    return { mode: cloud.mode, updated_at: cloud.updated_at, updated_by: cloud.updated_by, source: "cloud", local, cloud };
  }
  return { ...local, source: "local", local, cloud };
}

/** Modaliteti efektiv i kuponit për një pagesë konkrete.
 * "auto" -> kamarieri zgjedh (butoni Kupon Termik/Fiskal); përndryshe detyrohet. */
function resolveEffectiveCouponType(db, requestedCouponType) {
  const state = getRegisterModeState(db);
  if (state.mode === "auto") {
    const v = String(requestedCouponType || "thermal").trim().toLowerCase();
    return v === "fiscal" ? "fiscal" : "thermal";
  }
  return state.mode;
}

module.exports = {
  normalizeRegisterMode,
  getRegisterModeState,
  getLocalRegisterModeState,
  getCloudRegisterModeCache,
  cacheCloudRegisterMode,
  setRegisterMode,
  resolveEffectiveCouponType,
};
