"use strict";
/**
 * Dërgon përmbledhjet ditore te cloud — pas mbyllje ndërrimi, check-out, çdo 5 min (sot), radhë offline.
 */
const cloudHealth = require("./cloud-health");
const cloudSync = require("./cloud-sync");
const { hotelCloudApiPath } = require("./cloud-server-url");
const { buildOwnerDailySnapshot, snapshotFingerprint } = require("./owner-report-snapshot");
const { businessYmd } = require("./lib/hotel-business-date");

const PENDING_KEY = "owner_report_pending_dates";
const HASHES_KEY = "owner_report_sync_hashes";
const SYNC_TIMEOUT_MS = 45000;
const OWNER_REPORT_SYNC_MS = 5 * 60 * 1000;

let syncInFlight = false;

function readJsonSetting(db, key, fallback) {
  try {
    const raw = db.getSetting(key, "");
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonSetting(db, key, value) {
  db.setSetting(key, JSON.stringify(value));
}

function todayIso() {
  return businessYmd();
}

function normalizeDate(d) {
  return String(d || "").trim().slice(0, 10);
}

function queueOwnerReportDates(db, dates) {
  if (!db) return;
  const pending = new Set(readJsonSetting(db, PENDING_KEY, []));
  for (const d of dates || []) {
    const day = normalizeDate(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) pending.add(day);
  }
  writeJsonSetting(db, PENDING_KEY, [...pending]);
}

function queueOwnerReportToday(db) {
  queueOwnerReportDates(db, [todayIso()]);
}

function clearPendingDate(db, date) {
  const day = normalizeDate(date);
  const pending = readJsonSetting(db, PENDING_KEY, []).filter((d) => d !== day);
  writeJsonSetting(db, PENDING_KEY, pending);
}

function getHashMap(db) {
  return readJsonSetting(db, HASHES_KEY, {});
}

function setHashForDate(db, date, hash) {
  const map = getHashMap(db);
  map[normalizeDate(date)] = hash;
  writeJsonSetting(db, HASHES_KEY, map);
}

function requestSync(payload, db) {
  cloudSync.ensureAutoCloudConfig?.(db);
  const cfg = cloudSync.getConfig(db);
  const body = {
    celesi: cfg.celesi,
    license_key: cfg.celesi,
    summaries: [payload],
  };
  return cloudHealth.requestJsonWithFallback(
    "POST",
    hotelCloudApiPath("/api/v1/hotel/owner-daily-reports/sync"),
    body,
    { timeoutMs: SYNC_TIMEOUT_MS },
  );
}

async function pushOwnerDailySnapshot(db, reportDate, { force = false } = {}) {
  if (!db || !cloudSync.isCloudConfigured(db)) {
    return { ok: false, skipped: true, reason: "cloud_not_configured" };
  }
  const date = normalizeDate(reportDate) || todayIso();
  const snapshot = buildOwnerDailySnapshot(db, date);
  const prevHash = getHashMap(db)[date];
  if (!force && prevHash && prevHash === snapshot.fingerprint) {
    return { ok: true, skipped: true, reason: "unchanged", report_date: date };
  }

  const r = await requestSync(
    {
      report_date: date,
      computed_at: snapshot.computed_at,
      content_hash: snapshot.fingerprint,
      payload: snapshot,
    },
    db,
  );
  let parsed = {};
  try {
    parsed = JSON.parse(r.data || "{}");
  } catch {
    parsed = {};
  }
  if (r.status >= 400 || parsed.ok === false) {
    queueOwnerReportDates(db, [date]);
    const err = new Error(parsed.gabim || parsed.message || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  setHashForDate(db, date, snapshot.fingerprint);
  clearPendingDate(db, date);
  return { ok: true, report_date: date, synced: true };
}

async function runOwnerReportSync(db, { includeToday = true } = {}) {
  if (!db || syncInFlight) return { ok: false, skipped: true };
  try {
    const license = require("./license");
    if (license.terminalRegisterNumber() >= 2) {
      return { ok: true, skipped: true, reason: "secondary_register" };
    }
  } catch {
    /* ignore */
  }
  if (!cloudSync.isCloudConfigured(db)) return { ok: false, skipped: true };
  const health = cloudHealth.getHealthStatus?.();
  if (health && !health.online) {
    return { ok: false, offline: true };
  }

  syncInFlight = true;
  const results = [];
  try {
    const dates = new Set(readJsonSetting(db, PENDING_KEY, []));
    if (includeToday) dates.add(todayIso());

    for (const date of [...dates].sort()) {
      try {
        const snap = buildOwnerDailySnapshot(db, date);
        const prev = getHashMap(db)[date];
        const force = dates.has(date) && readJsonSetting(db, PENDING_KEY, []).includes(date);
        if (!force && prev === snap.fingerprint && date !== todayIso()) {
          clearPendingDate(db, date);
          continue;
        }
        const r = await pushOwnerDailySnapshot(db, date, {
          force: force || date !== todayIso() || prev !== snap.fingerprint,
        });
        results.push(r);
      } catch (err) {
        console.warn("[owner-report-sync]", date, err.message || err);
        queueOwnerReportDates(db, [date]);
      }
    }
    return { ok: true, results };
  } finally {
    syncInFlight = false;
  }
}

module.exports = {
  OWNER_REPORT_SYNC_MS,
  queueOwnerReportDates,
  queueOwnerReportToday,
  pushOwnerDailySnapshot,
  runOwnerReportSync,
  buildOwnerDailySnapshot,
  snapshotFingerprint,
};
