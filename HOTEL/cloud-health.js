/**
 * Shëndeti i cloud-it — URL fiksuar, multi-fallback, offline, auto-reconnect, log.
 */
const http = require("http");
const https = require("https");
const {
  PRIMARY_CLOUD_SERVER,
  BACKUP_CLOUD_SERVERS,
  CLOUD_SERVER_URLS,
  PUBLIC_CLOUD_SERVER,
} = require("./cloud-server-url");

const HEALTH_CHECK_MS = 10000;
const REQUEST_TIMEOUT_MS = 8000;
const OUTAGE_ALERT_COOLDOWN_MS = 5 * 60 * 1000;

let activeServerUrl = PRIMARY_CLOUD_SERVER;
let healthTimer = null;
let healthChecksDone = 0;
let reconnectCallbacks = [];
let boundDb = null;
let lastOutageAlertAt = 0;

let lastHealth = {
  online: false,
  mode: "offline",
  server: "",
  active_server: "",
  public_server: "",
  db_ok: false,
  servers_tried: [],
  backup_tried: false,
  message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
  offline_since: null,
  checked_at: null,
};

/** Hotel: asnjë thirrje te serveri i hotelit. */
const HOTEL_CLOUD_DISABLED = true;

function bindCloudHealthDb(db) {
  boundDb = db;
}

function getPublicServerUrl() {
  return PUBLIC_CLOUD_SERVER;
}

function getActiveServerUrl() {
  return activeServerUrl;
}

function getHealthStatus() {
  return { ...lastHealth, servers: [...CLOUD_SERVER_URLS] };
}

function onReconnect(fn) {
  if (typeof fn === "function") reconnectCallbacks.push(fn);
}

function requestJsonOnce(method, baseUrl, path, payload, timeoutMs = REQUEST_TIMEOUT_MS, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(path, String(baseUrl).replace(/\/$/, "") + "/");
    } catch (e) {
      reject(e);
      return;
    }
    const body = payload != null ? JSON.stringify(payload) : "";
    const lib = url.protocol === "https:" ? https : http;
    const headers = { "Content-Type": "application/json", ...extraHeaders };
    if (body) headers["Content-Length"] = Buffer.byteLength(body);

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
        timeout: timeoutMs,
      },
      res => {
        let data = "";
        res.on("data", c => { data += c; });
        res.on("end", () => resolve({ status: res.statusCode, data, server: baseUrl }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

function logFailure(event, detail = {}) {
  if (!boundDb) return;
  try {
    const { appendCloudFailure } = require("./cloud-failure-log");
    appendCloudFailure(boundDb, { event, ...detail });
  } catch {
    /* ignore */
  }
}

async function probeServer(baseUrl) {
  const result = { url: baseUrl, health_ok: false, db_ok: false, error: "" };
  try {
    const health = await requestJsonOnce("GET", baseUrl, "/health", null, REQUEST_TIMEOUT_MS);
    result.health_ok = health.status > 0 && health.status < 500;
    if (!result.health_ok) {
      result.error = `HTTP ${health.status}`;
      return result;
    }
  } catch (err) {
    result.error = err.message || "timeout";
    return result;
  }

  try {
    const db = await requestJsonOnce("GET", baseUrl, "/health/db", null, REQUEST_TIMEOUT_MS);
    let parsed = {};
    try { parsed = JSON.parse(db.data || "{}"); } catch { /* */ }
    result.db_ok = db.status > 0 && db.status < 500 && !!parsed.ok;
    if (!result.db_ok) {
      result.error = parsed.error || parsed.gabim || "Cloud DB nuk përgjigjet";
    }
  } catch (err) {
    result.error = err.message || "health/db dështoi";
  }
  return result;
}

async function reportOutageToCloud(event, message, serversTried) {
  if (!boundDb) return;
  const now = Date.now();
  if (now - lastOutageAlertAt < OUTAGE_ALERT_COOLDOWN_MS) return;
  lastOutageAlertAt = now;

  try {
    const cloudSync = require("./cloud-sync");
    const cfg = cloudSync.getConfig(boundDb);
    if (!cfg.celesi) return;

    await requestJsonOnce(
      "POST",
      PRIMARY_CLOUD_SERVER,
      "/api/v1/system/outage-alert",
      {
        celesi: cfg.celesi,
        device_id: cfg.deviceId,
        event,
        message,
        servers_tried: serversTried,
        active_server: activeServerUrl,
      },
      REQUEST_TIMEOUT_MS,
    ).catch(() => {
      for (const url of BACKUP_CLOUD_SERVERS) {
        return requestJsonOnce(
          "POST",
          url,
          "/api/v1/system/outage-alert",
          {
            celesi: cfg.celesi,
            device_id: cfg.deviceId,
            event,
            message,
            servers_tried: serversTried,
          },
          REQUEST_TIMEOUT_MS,
        );
      }
    });
  } catch {
    /* ignore — offline */
  }
}

async function runHealthCheck() {
  if (HOTEL_CLOUD_DISABLED || !CLOUD_SERVER_URLS.length || !PRIMARY_CLOUD_SERVER) {
    lastHealth = {
      online: false,
      mode: "offline",
      server: "",
      active_server: "",
      public_server: "",
      db_ok: false,
      servers_tried: [],
      backup_tried: false,
      message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
      offline_since: lastHealth.offline_since || new Date().toISOString(),
      checked_at: new Date().toISOString(),
    };
    return;
  }

  healthChecksDone += 1;
  const wasOnline = lastHealth.online;
  const tried = [];

  for (const url of CLOUD_SERVER_URLS) {
    const probe = await probeServer(url);
    tried.push({ url, ...probe });

    if (probe.health_ok && probe.db_ok) {
      const usingBackup = url !== PRIMARY_CLOUD_SERVER;
      activeServerUrl = url;
      lastHealth = {
        online: true,
        mode: "online",
        server: url,
        active_server: url,
        public_server: PUBLIC_CLOUD_SERVER,
        db_ok: true,
        servers_tried: tried,
        backup_tried: usingBackup,
        message: usingBackup
          ? "Cloud rezervë aktiv — sync OK."
          : "Cloud i lidhur.",
        offline_since: null,
        checked_at: new Date().toISOString(),
      };

      if (!wasOnline && healthChecksDone > 1) {
        console.log("[cloud] Rilidhur — sync automatik…");
        logFailure("cloud_online", { server: url, servers_tried: tried });
        reportOutageToCloud("cloud_online", lastHealth.message, tried).catch(() => {});
        for (const cb of reconnectCallbacks) {
          try { cb(); } catch (err) { console.warn("[cloud] reconnect:", err.message); }
        }
      }
      return;
    }

    logFailure("server_probe_failed", {
      server: url,
      error: probe.error,
      health_ok: probe.health_ok,
      db_ok: probe.db_ok,
    });
  }

  lastHealth = {
    online: false,
    mode: "offline",
    server: activeServerUrl,
    active_server: activeServerUrl,
    public_server: PUBLIC_CLOUD_SERVER,
    db_ok: false,
    servers_tried: tried,
    backup_tried: true,
    message:
      "Cloud offline — POS vazhdon 100% lokalisht (SQLite). Fiskalizimi offline deri 72h (ATK). Sync automatik kur kthehet interneti.",
    offline_since: lastHealth.offline_since || new Date().toISOString(),
    checked_at: new Date().toISOString(),
  };

  if (wasOnline || healthChecksDone === 1) {
    console.warn("[cloud] Offline mode — të provuara:", tried.map(t => t.url).join(", "));
    logFailure("cloud_offline", { servers_tried: tried });
    reportOutageToCloud("cloud_offline", lastHealth.message, tried).catch(() => {});
  }
}

function startHealthMonitor(db) {
  if (db) bindCloudHealthDb(db);
  if (HOTEL_CLOUD_DISABLED || !CLOUD_SERVER_URLS.length) {
    runHealthCheck().catch(() => {});
    return;
  }
  if (healthTimer) return;
  runHealthCheck().catch(() => {});
  healthTimer = setInterval(() => {
    runHealthCheck().catch(() => {});
  }, HEALTH_CHECK_MS);
}

async function requestJsonWithFallback(method, path, payload, options = {}) {
  if (HOTEL_CLOUD_DISABLED || !CLOUD_SERVER_URLS.length || !activeServerUrl) {
    throw new Error("Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.");
  }
  const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;
  const extraHeaders = options.headers || {};
  const order = [activeServerUrl, ...CLOUD_SERVER_URLS.filter(u => u !== activeServerUrl)].filter(Boolean);
  if (!order.length) {
    throw new Error("Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.");
  }
  let lastErr = null;

  for (const baseUrl of order) {
    try {
      const res = await requestJsonOnce(method, baseUrl, path, payload, timeoutMs, extraHeaders);
      if (res.status < 500 || method === "GET") {
        activeServerUrl = baseUrl;
        if (!lastHealth.online) {
          lastHealth.online = true;
          lastHealth.mode = "online";
          lastHealth.server = baseUrl;
          lastHealth.active_server = baseUrl;
          lastHealth.db_ok = true;
        }
        return res;
      }
      lastErr = new Error(`HTTP ${res.status}`);
      logFailure("api_http_error", { server: baseUrl, path, status: res.status });
    } catch (err) {
      lastErr = err;
      logFailure("api_request_failed", { server: baseUrl, path, error: err.message });
    }
  }

  throw lastErr || new Error("Cloud nuk përgjigjet — POS vazhdon lokalisht.");
}

module.exports = {
  HEALTH_CHECK_MS,
  bindCloudHealthDb,
  getPublicServerUrl,
  getActiveServerUrl,
  getHealthStatus,
  onReconnect,
  startHealthMonitor,
  runHealthCheck,
  requestJsonWithFallback,
  requestJsonOnce,
};
