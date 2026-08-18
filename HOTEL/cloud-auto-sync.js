/**
 * Sync automatik me cloud — pa butona manualë.
 * - Health check çdo 10s (cloud-health)
 * - Licencë / lidhje çdo 12s (lehtë — porositë QR)
 * - Menu e plotë çdo 3 min ose pas ndryshimeve (jo çdo 12s)
 */
const cloudSync = require("./cloud-sync");
const cloudHealth = require("./cloud-health");
const registerMode = require("./register-mode");

const LICENSE_CHECK_MS = 12000;
const CATALOG_AUTO_MS = 180000;
const CATALOG_DEBOUNCE_MS = 5000;

let lastStatus = {
  connected: false,
  catalog_ok: false,
  reachable: false,
  message: "",
  kitchen_slug: "",
  configured: false,
  mode: "offline",
  offline: true,
  updated_at: null,
};
let lastConnectedLog = null;
let lastCatalogAt = 0;
let licenseTimer = null;
let catalogTimer = null;
let catalogDebounceTimer = null;
let catalogPushInFlight = false;
let licenseCheckInFlight = false;
let lastStaffPushAt = 0;
const STAFF_PUSH_MS = 60000;
let waiterClosedSyncInFlight = false;
let registerModeFetchInFlight = false;
let started = false;
let boundDb = null;

function hasCachedKitchenAccess(db) {
  try {
    const target = db || boundDb;
    if (!target) return false;
    const cfg = cloudSync.getConfig(target);
    const cached = target.getCloudSettings();
    return !!(
      cfg.celesi
      && String(cached.kitchen_slug || "").trim()
      && String(cached.kitchen_key || "").trim()
    );
  } catch {
    return false;
  }
}

function getStatus(_db) {
  /* Hotel: gjithmonë offline — pa cloud hotel. */
  const msg = "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.";
  return {
    ok: true,
    server_url: "",
    active_server: "",
    public_server: "",
    mode: "offline",
    offline: true,
    offline_since: lastStatus.offline_since || new Date().toISOString(),
    backup_active: false,
    reachable: false,
    configured: false,
    has_cached_access: false,
    operational: false,
    syncing: false,
    catalog_ok: false,
    connected: false,
    owner_message: msg,
    message: msg,
    updated_at: new Date().toISOString(),
  };
}

function getPublicUrl() {
  return cloudHealth.getPublicServerUrl();
}

function applyStatus(patch) {
  lastStatus = {
    ...lastStatus,
    ...patch,
    updated_at: new Date().toISOString(),
  };
}

async function runLicenseCheck(db) {
  if (!db) return { connected: false };
  if (licenseCheckInFlight) return lastStatus;

  licenseCheckInFlight = true;
  const health = cloudHealth.getHealthStatus();
  applyStatus({
    mode: health.mode,
    offline: !health.online,
    reachable: !!health.online,
    message: health.message,
  });

  if (!cloudSync.isCloudConfigured(db)) {
    applyStatus({
      configured: false,
      connected: false,
      catalog_ok: false,
      message: "Aktivizoni licencën — cloud sync fillon automatikisht.",
    });
    licenseCheckInFlight = false;
    return { connected: false };
  }

  applyStatus({ configured: true });

  if (!health.online) {
    applyStatus({ connected: false, message: health.message });
    licenseCheckInFlight = false;
    return { connected: false };
  }

  try {
    const status = await cloudSync.checkConnection(db);
    const connected = !!status.connected;
    applyStatus({
      connected,
      kitchen_slug: status.kitchen_slug || "",
      message: status.message || (connected ? "Cloud i lidhur — porositë QR funksionojnë." : health.message),
    });

    if (lastConnectedLog !== connected) {
      lastConnectedLog = connected;
      if (connected) {
        console.log("[cloud] Licencë OK — slug:", status.kitchen_slug || "—");
        lastStaffPushAt = 0;
      } else {
        console.warn("[cloud] Licencë jo e lidhur:", status.message || "—");
      }
    }
    if (connected && Date.now() - lastStaffPushAt > STAFF_PUSH_MS) {
      lastStaffPushAt = Date.now();
      cloudSync.pushStaffAsync(db).catch(() => {});
    }

    if (connected && !waiterClosedSyncInFlight) {
      waiterClosedSyncInFlight = true;
      cloudSync.syncClosedWebWaiterSales(db)
        .then(r => {
          if (r?.imported) {
            console.log("[cloud/sync] syncClosedWebWaiterSales imported:", JSON.stringify(r));
          }
        })
        .catch(err => console.warn("[cloud/sync] syncClosedWebWaiterSales error:", err.message))
        .finally(() => {
          waiterClosedSyncInFlight = false;
        });
    }

    if (connected && !registerModeFetchInFlight) {
      registerModeFetchInFlight = true;
      cloudSync.fetchRegisterModeFromCloud(db)
        .then(state => {
          if (state) registerMode.cacheCloudRegisterMode(db, state);
        })
        .catch(() => {})
        .finally(() => {
          registerModeFetchInFlight = false;
        });
    }

    return status;
  } catch (err) {
    applyStatus({ connected: false, message: err.message || "Sync dështoi." });
    return { connected: false };
  } finally {
    licenseCheckInFlight = false;
  }
}

async function runCatalogPush(db, { force = false } = {}) {
  if (!db || catalogPushInFlight) return { ok: false };
  if (!lastStatus.connected) return { ok: false, message: "Licenca nuk është e lidhur." };

  const now = Date.now();
  if (!force && lastCatalogAt && now - lastCatalogAt < CATALOG_AUTO_MS) {
    return { ok: lastStatus.catalog_ok, skipped: true };
  }

  catalogPushInFlight = true;
  try {
    const r = await cloudSync.pushCatalogAsync(db);
    if (r.ok) lastCatalogAt = now;
    applyStatus({
      catalog_ok: !!r.ok,
      menu_items: Number(r.menu_items) || 0,
      categories: Number(r.categories) || 0,
      message: r.ok
        ? r.message || `${r.menu_items || 0} artikuj në cloud.`
        : (r.message || "Menu sync dështoi."),
    });
    if (!r.ok) console.warn("[cloud] Catalog:", r.message);
    else if (!r.skipped) console.log("[cloud] Menu sync:", r.message);
    return r;
  } catch (err) {
    applyStatus({ catalog_ok: false, message: err.message || "Menu sync dështoi." });
    return { ok: false, message: err.message };
  } finally {
    catalogPushInFlight = false;
  }
}

/** Sync i plotë — FIKUR për hotel (pa cloud hotel). */
async function runFullSync(_db) {
  applyStatus({
    configured: false,
    connected: false,
    catalog_ok: false,
    reachable: false,
    offline: true,
    mode: "offline",
    message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
  });
  return { ok: false, connected: false, ...lastStatus };
}

function scheduleCatalogPush(_db) {
  /* Hotel: pa catalog push te cloud hotel. */
  return;
}

function pushCatalogDebounced(db) {
  scheduleCatalogPush(db);
}

function startCloudAutoSync(db) {
  /* Hotel: zero sync me cloud-in e hotelit. */
  if (!db || started) return;
  started = true;
  boundDb = db;
  applyStatus({
    configured: false,
    connected: false,
    catalog_ok: false,
    reachable: false,
    offline: true,
    mode: "offline",
    message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
  });
  try {
    cloudHealth.startHealthMonitor(db);
  } catch {
    /* ignore */
  }
}

module.exports = {
  LICENSE_CHECK_MS,
  CATALOG_AUTO_MS,
  CATALOG_DEBOUNCE_MS,
  getStatus,
  runFullSync,
  runLicenseCheck,
  runCatalogPush,
  scheduleCatalogPush,
  pushCatalogDebounced,
  startCloudAutoSync,
};
