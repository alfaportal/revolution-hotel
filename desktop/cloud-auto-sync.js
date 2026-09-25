/**
 * Sync automatik me cloud — pa butona manualë.
 * - Health check çdo 10s (cloud-health)
 * - Lidhje cloud (checkConnection) çdo 5 min
 * - Shitje telefon/web-waiter çdo 5 min
 * - Staff / fjalëkalim admin çdo 4 orë
 * - Modalitet arkë nga cloud çdo 12 orë
 * - Menu e plotë çdo 3 min ose pas ndryshimeve
 */
const cloudSync = require("./cloud-sync");
const cloudHealth = require("./cloud-health");
const registerMode = require("./register-mode");

const CONNECTION_CHECK_MS = 5 * 60 * 1000;
const CLOSED_WAITER_SALES_MS = 5 * 60 * 1000;
const OWNER_ADMIN_PASSWORD_MS = 4 * 60 * 60 * 1000;
const STAFF_PUSH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const REGISTER_MODE_MS = 12 * 60 * 60 * 1000;
const CATALOG_AUTO_MS = 180000;
const CATALOG_DEBOUNCE_MS = 5000;
const STARTUP_BURST_MS = 4000;

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
let connectionTimer = null;
let closedWaiterTimer = null;
let ownerPasswordTimer = null;
let staffPushTimer = null;
let registerModeTimer = null;
let catalogTimer = null;
let catalogDebounceTimer = null;
let catalogPushInFlight = false;
let connectionCheckInFlight = false;
let waiterClosedSyncInFlight = false;
let registerModeFetchInFlight = false;
let ownerPasswordSyncInFlight = false;
let staffPushInFlight = false;
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

function canRunCloudSideJobs(db) {
  if (!db || !cloudSync.isCloudConfigured(db)) return false;
  const health = cloudHealth.getHealthStatus();
  if (!health.online) return false;
  if (lastStatus.connected) return true;
  return hasCachedKitchenAccess(db);
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
    syncing: !!connectionCheckInFlight && !operational,
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

async function runConnectionCheck(db) {
  if (!db) return { connected: false };
  if (connectionCheckInFlight) return lastStatus;

  connectionCheckInFlight = true;
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
    connectionCheckInFlight = false;
    return { connected: false };
  }

  applyStatus({ configured: true });

  if (!health.online) {
    applyStatus({ connected: false, message: health.message });
    connectionCheckInFlight = false;
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
      } else {
        console.warn("[cloud] Licencë jo e lidhur:", status.message || "—");
      }
    }

    return status;
  } catch (err) {
    applyStatus({ connected: false, message: err.message || "Sync dështoi." });
    return { connected: false };
  } finally {
    connectionCheckInFlight = false;
  }
}

async function runLicenseCheck(db) {
  return runConnectionCheck(db);
}

async function runClosedWaiterSalesSync(db) {
  if (!canRunCloudSideJobs(db)) return;
  if (waiterClosedSyncInFlight) return;
  waiterClosedSyncInFlight = true;
  try {
    const r = await cloudSync.syncClosedWebWaiterSales(db);
    if (r?.imported) {
      console.log("[cloud/sync] syncClosedWebWaiterSales imported:", JSON.stringify(r));
    }
  } catch (err) {
    console.warn("[cloud/sync] syncClosedWebWaiterSales error:", err.message);
  } finally {
    waiterClosedSyncInFlight = false;
  }
}

async function runOwnerAdminPasswordSync(db) {
  if (!canRunCloudSideJobs(db)) return;
  if (ownerPasswordSyncInFlight) return;
  ownerPasswordSyncInFlight = true;
  try {
    await cloudSync.syncOwnerAdminPasswordFromCloud(db);
  } catch (err) {
    console.warn("[cloud/sync] owner admin password:", err.message);
  } finally {
    ownerPasswordSyncInFlight = false;
  }
}

async function runStaffPushSync(db) {
  if (!canRunCloudSideJobs(db)) return;
  if (staffPushInFlight) return;
  staffPushInFlight = true;
  try {
    await cloudSync.pushStaffAsync(db);
  } catch {
    /* ignore */
  } finally {
    staffPushInFlight = false;
  }
}

async function runRegisterModeSync(db) {
  if (!canRunCloudSideJobs(db)) return;
  if (registerModeFetchInFlight) return;
  registerModeFetchInFlight = true;
  try {
    const state = await cloudSync.fetchRegisterModeFromCloud(db);
    if (state) registerMode.cacheCloudRegisterMode(db, state);
  } catch {
    /* ignore */
  } finally {
    registerModeFetchInFlight = false;
  }
}

function runAllSideSyncJobs(db) {
  runClosedWaiterSalesSync(db).catch(() => {});
  runOwnerAdminPasswordSync(db).catch(() => {});
  runStaffPushSync(db).catch(() => {});
  runRegisterModeSync(db).catch(() => {});
}

function startPeriodicJob(db, fn, intervalMs) {
  return setInterval(() => {
    fn(db).catch(() => {});
  }, intervalMs);
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
  const status = await runConnectionCheck(db);
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

function armCloudPeriodicJobs(db) {
  connectionTimer = startPeriodicJob(db, runConnectionCheck, CONNECTION_CHECK_MS);
  closedWaiterTimer = startPeriodicJob(db, runClosedWaiterSalesSync, CLOSED_WAITER_SALES_MS);
  ownerPasswordTimer = startPeriodicJob(db, runOwnerAdminPasswordSync, OWNER_ADMIN_PASSWORD_MS);
  staffPushTimer = startPeriodicJob(db, runStaffPushSync, STAFF_PUSH_INTERVAL_MS);
  registerModeTimer = startPeriodicJob(db, runRegisterModeSync, REGISTER_MODE_MS);
}

function runStartupBurst(db) {
  runConnectionCheck(db)
    .then(status => {
      if (status?.connected) runAllSideSyncJobs(db);
      return runCatalogPush(db, { force: true });
    })
    .catch(() => {});
}

function runReconnectBurst(db) {
  runConnectionCheck(db)
    .then(status => {
      if (status?.connected) runAllSideSyncJobs(db);
      return runCatalogPush(db, { force: true });
    })
    .catch(() => {});
}

function startCloudAutoSync(db) {
  if (!db || started) return;
  started = true;
  boundDb = db;

  cloudHealth.onReconnect(() => {
    runReconnectBurst(db);
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
    runStartupBurst(db);
    armCloudPeriodicJobs(db);
  }, STARTUP_BURST_MS);

  catalogTimer = setInterval(() => {
    runCatalogPush(db).catch(() => {});
  }, CATALOG_AUTO_MS);
}

module.exports = {
  CONNECTION_CHECK_MS,
  CLOSED_WAITER_SALES_MS,
  OWNER_ADMIN_PASSWORD_MS,
  STAFF_PUSH_INTERVAL_MS,
  REGISTER_MODE_MS,
  CATALOG_AUTO_MS,
  CATALOG_DEBOUNCE_MS,
  getStatus,
  runFullSync,
  runLicenseCheck,
  runConnectionCheck,
  runCatalogPush,
  scheduleCatalogPush,
  pushCatalogDebounced,
  startCloudAutoSync,
};
