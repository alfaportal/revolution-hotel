/**
 * Log i dështimeve cloud — ruhet lokalisht në SQLite (settings).
 */
const LOG_KEY = "cloud_failure_log";
const MAX_ENTRIES = 200;

function readLog(db) {
  try {
    const raw = db.getSetting(LOG_KEY, "[]");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeLog(db, entries) {
  db.setSetting(LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
}

function appendCloudFailure(db, entry) {
  if (!db?.setSetting) return null;
  const row = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...entry,
  };
  const log = readLog(db);
  log.push(row);
  writeLog(db, log);
  return row;
}

function listCloudFailures(db, limit = 50) {
  const log = readLog(db);
  return log.slice(-Math.max(1, Math.min(limit, MAX_ENTRIES))).reverse();
}

function clearCloudFailures(db) {
  writeLog(db, []);
}

module.exports = {
  appendCloudFailure,
  listCloudFailures,
  clearCloudFailures,
};
