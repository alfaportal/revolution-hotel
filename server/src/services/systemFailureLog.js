const MAX_ENTRIES = 200;

const entries = [];

function appendSystemFailure({ source = "system", event = "failure", message = "", detail = null } = {}) {
  const row = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    source: String(source || "system"),
    event: String(event || "failure"),
    message: String(message || "").slice(0, 500),
    detail: detail != null ? detail : undefined,
  };
  entries.push(row);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  return row;
}

function listSystemFailures(limit = 20) {
  const n = Math.max(1, Math.min(limit, MAX_ENTRIES));
  return entries.slice(-n).reverse();
}

module.exports = {
  appendSystemFailure,
  listSystemFailures,
};
