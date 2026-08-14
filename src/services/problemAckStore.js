const fs = require("fs");
const path = require("path");

const ACK_PATH = path.join(__dirname, "../../data/problem-acks.json");
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function readStore() {
  try {
    if (!fs.existsSync(ACK_PATH)) return { acks: {} };
    const raw = JSON.parse(fs.readFileSync(ACK_PATH, "utf8"));
    return { acks: raw?.acks && typeof raw.acks === "object" ? raw.acks : {} };
  } catch {
    return { acks: {} };
  }
}

function writeStore(store) {
  const dir = path.dirname(ACK_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ACK_PATH, JSON.stringify(store, null, 2), "utf8");
}

function prune(store) {
  const now = Date.now();
  let changed = false;
  for (const [key, row] of Object.entries(store.acks)) {
    const at = Date.parse(row?.at || "") || 0;
    if (!at || now - at > TTL_MS) {
      delete store.acks[key];
      changed = true;
    }
  }
  return changed;
}

function isProblemAcked(problemKey) {
  if (!problemKey) return false;
  const store = readStore();
  if (prune(store)) writeStore(store);
  return Boolean(store.acks[String(problemKey)]);
}

function ackProblem({ problem_key, kind, client_id, note, resolution } = {}) {
  const key = String(problem_key || "").trim();
  if (!key) {
    const err = new Error("problem_key mungon");
    err.status = 400;
    throw err;
  }
  const store = readStore();
  prune(store);
  store.acks[key] = {
    at: new Date().toISOString(),
    kind: kind || null,
    client_id: client_id || null,
    note: String(note || "").slice(0, 500) || null,
    resolution: String(resolution || "resolved").slice(0, 80),
  };
  writeStore(store);
  return store.acks[key];
}

function listAcks() {
  const store = readStore();
  if (prune(store)) writeStore(store);
  return store.acks;
}

module.exports = {
  isProblemAcked,
  ackProblem,
  listAcks,
};
