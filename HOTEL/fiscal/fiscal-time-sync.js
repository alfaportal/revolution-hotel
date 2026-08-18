/**
 * fiscal/fiscal-time-sync.js — Sinkronizimi i orës (online & offline).
 * HOTEL: pa HTTP te ATK — vetëm servera publikë (Google/Cloudflare).
 */
const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");
const { isFiscalEnabled } = require("./fiscal-config");
const { getKeysDir } = require("./fiscal-crypto");

const TIME_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MAX_WALL_JUMP_MS = 5 * 60 * 1000;

let _timeSyncTimer = null;
let _cachedState = null;
let _runtimeLoaded = false;

function getSqlite() {
  const database = require("../database");
  if (!database || !database.db) {
    throw new Error("Databaza nuk është e gatshme");
  }
  return database.db;
}

function ensureTimeSyncColumns(sqlite) {
  for (const colSql of [
    `ALTER TABLE fiscal_settings ADD COLUMN fiscal_clock_last_sync_utc INTEGER`,
    `ALTER TABLE fiscal_settings ADD COLUMN fiscal_clock_sync_mono_ns TEXT`,
    `ALTER TABLE fiscal_settings ADD COLUMN fiscal_clock_sync_wall_ms INTEGER`,
    `ALTER TABLE fiscal_settings ADD COLUMN fiscal_clock_offset_ms INTEGER`,
    `ALTER TABLE fiscal_settings ADD COLUMN fiscal_clock_hmac TEXT`,
    `ALTER TABLE fiscal_settings ADD COLUMN fiscal_clock_source TEXT`,
    `ALTER TABLE fiscal_settings ADD COLUMN fiscal_clock_offline_anchor_utc INTEGER`,
    `ALTER TABLE fiscal_settings ADD COLUMN fiscal_clock_updated_at TEXT`,
  ]) {
    try {
      sqlite.prepare(colSql).run();
    } catch {
      /* already exists */
    }
  }
}

function getTimeSyncSecret() {
  const keysDir = getKeysDir();
  const secretPath = path.join(keysDir, ".fiscal-time-sync-secret");
  try {
    if (fs.existsSync(secretPath)) {
      return fs.readFileSync(secretPath);
    }
    fs.mkdirSync(keysDir, { recursive: true });
    const secret = crypto.randomBytes(32);
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
  } catch (e) {
    console.warn("[fiscal-time-sync] secret:", e.message);
    return crypto.createHash("sha256").update(String(keysDir)).digest();
  }
}

function statePayload(state) {
  return [
    state.last_sync_utc_ms ?? "",
    state.sync_mono_ns ?? "",
    state.sync_wall_ms ?? "",
    state.persisted_offset_ms ?? "",
    state.offline_anchor_utc ?? "",
    state.last_sync_source ?? "",
  ].join("|");
}

function computeStateHmac(state) {
  return crypto.createHmac("sha256", getTimeSyncSecret()).update(statePayload(state)).digest("hex");
}

function verifyStateHmac(state) {
  if (!state || !state.integrity_hmac) return false;
  const expected = computeStateHmac(state);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(String(state.integrity_hmac), "hex")
    );
  } catch {
    return false;
  }
}

function readClockRow() {
  const sqlite = getSqlite();
  ensureTimeSyncColumns(sqlite);
  return sqlite.prepare(`SELECT * FROM fiscal_settings WHERE id = 1`).get();
}

function rowToState(row) {
  if (!row) return null;
  return {
    last_sync_utc_ms:
      row.fiscal_clock_last_sync_utc != null ? Number(row.fiscal_clock_last_sync_utc) : null,
    sync_mono_ns: row.fiscal_clock_sync_mono_ns != null ? String(row.fiscal_clock_sync_mono_ns) : null,
    sync_wall_ms: row.fiscal_clock_sync_wall_ms != null ? Number(row.fiscal_clock_sync_wall_ms) : null,
    persisted_offset_ms:
      row.fiscal_clock_offset_ms != null ? Number(row.fiscal_clock_offset_ms) : null,
    offline_anchor_utc:
      row.fiscal_clock_offline_anchor_utc != null
        ? Number(row.fiscal_clock_offline_anchor_utc)
        : null,
    last_sync_source: row.fiscal_clock_source != null ? String(row.fiscal_clock_source) : null,
    updated_at: row.fiscal_clock_updated_at != null ? String(row.fiscal_clock_updated_at) : null,
    integrity_hmac: row.fiscal_clock_hmac != null ? String(row.fiscal_clock_hmac) : null,
  };
}

function loadClockState(force = false) {
  if (_runtimeLoaded && !force && _cachedState) return _cachedState;
  try {
    const state = rowToState(readClockRow());
    if (!state) {
      _cachedState = null;
      _runtimeLoaded = true;
      return null;
    }
    if (state.integrity_hmac && !verifyStateHmac(state)) {
      console.warn("[fiscal-time-sync] HMAC i pavlefshëm — gjendja e orës refuzohet");
      _cachedState = { tampered: true };
      _runtimeLoaded = true;
      return _cachedState;
    }
    _cachedState = state;
    _runtimeLoaded = true;
    return state;
  } catch (e) {
    console.warn("[fiscal-time-sync] load:", e.message);
    _cachedState = null;
    _runtimeLoaded = true;
    return null;
  }
}

function saveClockState(state) {
  const sqlite = getSqlite();
  ensureTimeSyncColumns(sqlite);
  const payload = {
    last_sync_utc_ms: state.last_sync_utc_ms,
    sync_mono_ns: state.sync_mono_ns,
    sync_wall_ms: state.sync_wall_ms,
    persisted_offset_ms: state.persisted_offset_ms,
    offline_anchor_utc: state.offline_anchor_utc ?? null,
    last_sync_source: state.last_sync_source ?? null,
  };
  payload.integrity_hmac = computeStateHmac(payload);
  sqlite
    .prepare(
      `UPDATE fiscal_settings SET
        fiscal_clock_last_sync_utc = ?,
        fiscal_clock_sync_mono_ns = ?,
        fiscal_clock_sync_wall_ms = ?,
        fiscal_clock_offset_ms = ?,
        fiscal_clock_offline_anchor_utc = ?,
        fiscal_clock_source = ?,
        fiscal_clock_hmac = ?,
        fiscal_clock_updated_at = datetime('now','localtime')
      WHERE id = 1`
    )
    .run(
      payload.last_sync_utc_ms,
      payload.sync_mono_ns,
      payload.sync_wall_ms,
      payload.persisted_offset_ms,
      payload.offline_anchor_utc,
      payload.last_sync_source,
      payload.integrity_hmac
    );
  _cachedState = { ...payload };
  _runtimeLoaded = true;
  return _cachedState;
}

function httpHeadTime(hostname, { httpsMode = true, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const mod = httpsMode ? https : http;
    const req = mod.request(
      {
        hostname,
        servername: hostname,
        path: "/",
        method: "HEAD",
        timeout: timeoutMs,
        rejectUnauthorized: false,
      },
      (res) => {
        res.resume();
        const dateHdr = res.headers.date || res.headers.Date;
        if (!dateHdr) {
          resolve(null);
          return;
        }
        const ms = Date.parse(String(dateHdr));
        if (!Number.isFinite(ms)) {
          resolve(null);
          return;
        }
        resolve({ ms, source: hostname });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

async function fetchServerTimeMs() {
  const hosts = ["www.google.com", "time.cloudflare.com"];
  const seen = new Set();
  for (const host of hosts) {
    const h = String(host || "").trim();
    if (!h || seen.has(h)) continue;
    seen.add(h);
    const hit = await httpHeadTime(h);
    if (hit && Number.isFinite(hit.ms)) return hit;
  }
  return null;
}

function detectWallTamper(state) {
  if (!state || !state.sync_wall_ms || !state.persisted_offset_ms) return false;
  const expectedWall = state.last_sync_utc_ms - state.persisted_offset_ms;
  const drift = Math.abs(Date.now() - expectedWall);
  return drift > MAX_WALL_JUMP_MS;
}

function getFiscalNowMs() {
  if (!isFiscalEnabled()) return Date.now();

  const state = loadClockState();
  if (!state || state.tampered || !state.last_sync_utc_ms) {
    return Date.now();
  }

  if (state.sync_mono_ns) {
    try {
      const monoNow = process.hrtime.bigint();
      const monoAtSync = BigInt(state.sync_mono_ns);
      const elapsedMs = Number((monoNow - monoAtSync) / 1000000n);
      if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
        return state.last_sync_utc_ms + elapsedMs;
      }
    } catch {
      /* fallback */
    }
  }

  if (state.persisted_offset_ms != null) {
    return Date.now() + Number(state.persisted_offset_ms);
  }

  return Date.now();
}

function getFiscalNow() {
  return new Date(getFiscalNowMs());
}

function formatFiscalParts(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return {
    fiscal_date: `${dd}.${mm}.${yyyy}`,
    fiscal_time: `${hh}:${mi}`,
    iso: d.toISOString(),
  };
}

function getFiscalTodayParts() {
  if (isFiscalEnabled() && !_timeSyncTimer) {
    startFiscalTimeSyncMonitor();
  }
  return formatFiscalParts(getFiscalNow());
}

function getFiscalLocalYmd() {
  const d = getFiscalNow();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function syncClockFromNetwork() {
  if (!isFiscalEnabled()) return { ok: false, skipped: true, reason: "fiscal_off" };

  const hit = await fetchServerTimeMs();
  if (!hit) {
    return { ok: false, error: "Nuk u mor ora nga serveri" };
  }

  const wallMs = Date.now();
  const monoNs = process.hrtime.bigint();
  const prev = loadClockState();
  const next = {
    last_sync_utc_ms: hit.ms,
    sync_mono_ns: monoNs.toString(),
    sync_wall_ms: wallMs,
    persisted_offset_ms: hit.ms - wallMs,
    offline_anchor_utc: null,
    last_sync_source: hit.source,
  };
  saveClockState(next);

  const driftMs = Math.abs(hit.ms - wallMs);
  console.log(
    "[fiscal-time-sync] sync OK source=",
    hit.source,
    "drift_ms=",
    driftMs
  );

  try {
    const { logFiscalAction } = require("./fiscal-audit");
    logFiscalAction(
      "setting_changed",
      {
        code: "fiscal_clock_sync",
        source: hit.source,
        drift_ms: driftMs,
        trusted_utc: new Date(hit.ms).toISOString(),
      },
      "SYSTEM",
      "TIME_SYNC"
    );
  } catch {
    /* */
  }

  return { ok: true, source: hit.source, drift_ms: driftMs, trusted_utc_ms: hit.ms };
}

function markOfflineClockAnchor() {
  if (!isFiscalEnabled()) return null;
  const state = loadClockState();
  if (!state || state.tampered) return null;
  const anchorMs = getFiscalNowMs();
  const next = { ...state, offline_anchor_utc: anchorMs };
  delete next.integrity_hmac;
  saveClockState(next);
  return anchorMs;
}

function clearOfflineClockAnchor() {
  const state = loadClockState();
  if (!state || state.tampered) return;
  const next = { ...state, offline_anchor_utc: null };
  delete next.integrity_hmac;
  saveClockState(next);
}

function getTimeSyncStatus() {
  const state = loadClockState();
  const trustedMs = getFiscalNowMs();
  const wallMs = Date.now();
  return {
    enabled: isFiscalEnabled(),
    synced: !!(state && state.last_sync_utc_ms && !state.tampered),
    tampered: !!(state && state.tampered),
    last_sync_utc: state?.last_sync_utc_ms ? new Date(state.last_sync_utc_ms).toISOString() : null,
    last_sync_source: state?.last_sync_source || null,
    offline_anchor_utc: state?.offline_anchor_utc
      ? new Date(state.offline_anchor_utc).toISOString()
      : null,
    trusted_now_utc: new Date(trustedMs).toISOString(),
    wall_now_utc: new Date(wallMs).toISOString(),
    drift_ms: trustedMs - wallMs,
    wall_tamper_suspected: state ? detectWallTamper(state) : false,
    monitor_running: !!_timeSyncTimer,
    atk_http: "BLOCKED_HOTEL",
  };
}

async function runTimeSyncTick() {
  if (!isFiscalEnabled()) return;
  const hit = await fetchServerTimeMs();
  if (hit) {
    await syncClockFromNetwork();
  }
}

function startFiscalTimeSyncMonitor() {
  if (_timeSyncTimer) return true;
  if (!isFiscalEnabled()) {
    console.log("[fiscal-time-sync] monitor: fiscal OFF — nuk niset");
    return false;
  }

  loadClockState(true);
  console.log("[fiscal-time-sync] monitor nisur (interval", TIME_SYNC_INTERVAL_MS / 1000, "s)");
  runTimeSyncTick().catch((e) => console.warn("[fiscal-time-sync] tick:", e.message));

  _timeSyncTimer = setInterval(() => {
    if (!isFiscalEnabled()) return;
    runTimeSyncTick().catch((e) => console.warn("[fiscal-time-sync] tick:", e.message));
  }, TIME_SYNC_INTERVAL_MS);

  if (typeof _timeSyncTimer.unref === "function") {
    _timeSyncTimer.unref();
  }
  return true;
}

function stopFiscalTimeSyncMonitor() {
  if (_timeSyncTimer) {
    clearInterval(_timeSyncTimer);
    _timeSyncTimer = null;
  }
}

module.exports = {
  TIME_SYNC_INTERVAL_MS,
  getFiscalNow,
  getFiscalNowMs,
  getFiscalTodayParts,
  getFiscalLocalYmd,
  formatFiscalParts,
  syncClockFromNetwork,
  fetchServerTimeMs,
  markOfflineClockAnchor,
  clearOfflineClockAnchor,
  getTimeSyncStatus,
  startFiscalTimeSyncMonitor,
  stopFiscalTimeSyncMonitor,
  loadClockState,
};
