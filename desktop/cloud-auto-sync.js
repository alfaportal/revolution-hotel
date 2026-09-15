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

function getStatus(db) {
  const health = cloudHealth.getHealthStatus();
  let server_url = getPublicUrl();
  try {
    server_url = cloudSync.getConfig(db || boundDb).publicServerUrl || server_url;
  } catch {
    /* ignore */
  }
  const configured = lastStatus.configured || cloudSync.isCloudConfigured(db || boundDb);
  const cachedAccess = hasCachedKitchenAccess(db);
  const operational = !!lastStatus.connected
    || (!!health.online && configured && cachedAccess);
  return {
    ok: true,
    server_url,
    active_server: health.active_server,
    public_server: health.public_server,
    mode: health.mode,
    offline: !health.online,
    offline_since: health.offline_since,
    backup_active: health.backup_tried && health.server === health.active_server,
    reachable: !!health.online,
    configured,
    has_cached_access: cachedAccess,
    operational,
    syncing: !!licenseCheckInFlight && !operational,
    owner_message: lastStatus.message || health.message,
    ...lastStatus,
    connected: operational,
    message: lastStatus.message || health.message,
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

/** Sync i plotë — butoni «Sinkronizo gjithçka». */
async function runFullSync(db) {
  if (!db) return { ok: false, message: "DB mungon." };
  const status = await runLicenseCheck(db);
  if (!status?.connected) return { ...lastStatus, message: lastStatus.message };

  const full = await cloudSync.fullCloudSync(db);
  applyStatus({
    connected: !!full.connected,
    catalog_ok: !!full.catalog_ok,
    menu_items: Number(full.menu_items) || 0,
    categories: Number(full.categories) || 0,
    message: full.message || lastStatus.message,
    kitchen_slug: full.kitchen_slug || "",
  });
  if (full.catalog_ok) lastCatalogAt = Date.now();
  return full;
}

function scheduleCatalogPush(db) {
  if (!db) return;
  if (catalogDebounceTimer) clearTimeout(catalogDebounceTimer);
  catalogDebounceTimer = setTimeout(() => {
    catalogDebounceTimer = null;
    runCatalogPush(db, { force: true }).catch(() => {});
  }, CATALOG_DEBOUNCE_MS);
}

function pushCatalogDebounced(db) {
  scheduleCatalogPush(db);
}

function startCloudAutoSync(db) {
  if (!db || started) return;
  started = true;
  boundDb = db;

  cloudHealth.onReconnect(() => {
    runLicenseCheck(db)
      .then(() => runCatalogPush(db, { force: true }))
      .catch(() => {});
    try {
      cloudSync.reconcileAllTablesWithCloud(db);
    } catch {
      /* ignore */
    }
    try {
      const reservationSync = require("./reservation-sync");
      reservationSync.syncPendingReservations(db).catch(() => {});
    } catch {
      /* ignore */
    }
  });

  cloudHealth.startHealthMonitor(db);

  setTimeout(() => {
    runLicenseCheck(db)
      .then(() => runCatalogPush(db, { force: true }))
      .catch(() => {});
  }, 4000);

  licenseTimer = setInterval(() => {
    runLicenseCheck(db).catch(() => {});
  }, LICENSE_CHECK_MS);

  catalogTimer = setInterval(() => {
    runCatalogPush(db).catch(() => {});
  }, CATALOG_AUTO_MS);
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
