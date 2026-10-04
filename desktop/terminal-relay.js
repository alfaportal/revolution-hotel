/**
 * Relay cloud — Arka 2+ → Kryesore kur LAN nuk punon (revolution-hotel-server).
 * Përmbajtja kodohet AES-256-GCM me çelës të nxjerrë nga çelësi i licencës.
 */
const crypto = require("crypto");
const zlib = require("zlib");
const cloudHealth = require("./cloud-health");

const RELAY_TIMEOUT_MS = 20000;
const LAN_PROBE_TIMEOUT_MS = 2500;
const LAN_OK_TTL_MS = 60 * 1000;
const LAN_RETRY_MS = 60 * 1000;
const LAN_DEFAULT_PORT = 3001;
const PRIMARY_CLOUD_ONLINE_MS = 2 * 60 * 1000;

/** Arka 2+ — koha e fundit kur Kryesorja u pa aktiv në cloud (pull/ack/presence/snapshots). */
let masterPrimaryLastSeenAt = null;

function absorbPrimaryLastSeen(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const local = toLocalIso(parsed.primary_last_seen_at, parsed.server_time);
  if (local) masterPrimaryLastSeenAt = local;
  return local;
}

function getMasterPrimaryLastSeenAt() {
  return masterPrimaryLastSeenAt;
}

function isMasterPrimaryOnlineOnCloud(maxAgeMs = PRIMARY_CLOUD_ONLINE_MS) {
  const t = Date.parse(masterPrimaryLastSeenAt || "");
  return Number.isFinite(t) && Date.now() - t < maxAgeMs;
}

function normalizeKey(k) {
  return String(k || "").trim().toUpperCase().replace(/\s+/g, "");
}

const keyCache = new Map();
function relayKey(celesi) {
  const k = normalizeKey(celesi);
  if (!k) throw new Error("Mungon çelësi i licencës.");
  let key = keyCache.get(k);
  if (!key) {
    key = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        Buffer.from(k, "utf8"),
        Buffer.from("revolution-pos/terminal-relay", "utf8"),
        Buffer.from("v1", "utf8"),
        32,
      ),
    );
    keyCache.set(k, key);
  }
  return key;
}

function seal(obj, celesi) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", relayKey(celesi), iv);
  const plain = zlib.gzipSync(Buffer.from(JSON.stringify(obj), "utf8"));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
}

function hashOf(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

/** Koha e serverit cloud → ISO e këtij PC (edhe kur ora lokale është gabim). */
function toLocalIso(ts, serverTime, nowMs = Date.now()) {
  const t = Date.parse(ts || "");
  if (!Number.isFinite(t)) return null;
  const s = Date.parse(serverTime || "");
  const ageMs = Number.isFinite(s) ? Math.max(0, s - t) : Math.max(0, nowMs - t);
  return new Date(nowMs - ageMs).toISOString();
}

function open(envelope, celesi) {
  const s = String(envelope || "");
  if (!s.startsWith("v1:")) throw new Error("Format i panjohur.");
  const buf = Buffer.from(s.slice(3), "base64");
  if (buf.length < 29) throw new Error("Paketë e shkurtër.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", relayKey(celesi), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(plain).toString("utf8"));
}

async function relayRequest(method, apiPath, body) {
  const r = await cloudHealth.requestJsonWithFallback(method, apiPath, body, {
    timeoutMs: RELAY_TIMEOUT_MS,
  });
  let parsed = {};
  try {
    parsed = JSON.parse(r.data || "{}");
  } catch {
    parsed = {};
  }
  if (r.status >= 400 || parsed.ok === false) {
    const err = new Error(parsed.gabim || parsed.message || `HTTP ${r.status}`);
    err.code = parsed.code || `HTTP_${r.status}`;
    err.status = r.status;
    throw err;
  }
  return parsed;
}

/** Arka 2+ — dërgon rreshtat e lan_outbox te cloud. */
async function pushQueueItems({ celesi, deviceId, registerNumber, items, presence }) {
  if (!items?.length) return { ok: true, queued: 0 };
  const list = items.map((it) => ({
    kind: it.kind,
    payload: seal(it.payload, celesi),
  }));
  const body = {
    celesi,
    device_id: deviceId,
    register_number: registerNumber,
    items: list,
  };
  if (presence && typeof presence === "object") {
    body.presence = seal(presence, celesi);
  }
  const r = await relayRequest("POST", "/api/v1/terminal/relay/push", body);
  const primary_last_seen_at = absorbPrimaryLastSeen(r);
  return { ...r, primary_last_seen_at };
}

/** Kryesore — tërheq rreshtat (lease in_progress në cloud). */
async function pullQueue({ celesi, deviceId, limit = 100 }) {
  const qs = new URLSearchParams({
    celesi,
    device_id: deviceId,
    limit: String(Math.min(100, Math.max(1, Number(limit) || 100))),
  });
  const r = await relayRequest("GET", `/api/v1/terminal/relay/pull?${qs.toString()}`, null);
  const serverTime = r.server_time || null;
  const items = (r.items || []).map((row) => {
    const created_at = toLocalIso(row.created_at, serverTime) ?? row.created_at;
    try {
      return {
        ...row,
        created_at,
        body: open(row.payload, celesi),
        payload: undefined,
      };
    } catch (e) {
      return { ...row, created_at, body: null, error: e.message || "nuk u hap", payload: undefined };
    }
  });
  return { items, server_time: serverTime };
}

/** Arka 2+ — heartbeat presence (pa shitje në outbox). */
async function pushPresence({ celesi, deviceId, registerNumber, presence }) {
  if (!presence || typeof presence !== "object") {
    throw new Error("Mungon presence.");
  }
  return relayRequest("POST", "/api/v1/terminal/relay/presence", {
    celesi,
    device_id: deviceId,
    register_number: registerNumber,
    payload: seal(presence, celesi),
  });
}

/** Kryesorja ← cloud — gjendja e Arkave 2+. */
async function fetchRelayPresence({ celesi, deviceId }) {
  const qs = new URLSearchParams({ celesi, device_id: deviceId });
  const r = await relayRequest("GET", `/api/v1/terminal/relay/presence?${qs.toString()}`, null);
  const serverTime = r.server_time || null;
  const list = (r.presence || []).map((row) => {
    const updated_at = toLocalIso(row.updated_at, serverTime) ?? row.updated_at;
    try {
      return {
        ...row,
        updated_at,
        body: open(row.payload, celesi),
        payload: undefined,
      };
    } catch (e) {
      return { ...row, updated_at, body: null, error: e.message || "nuk u hap", payload: undefined };
    }
  });
  return { presence: list, server_time: serverTime };
}

/** Kryesore — konfirmon importin (processed_at në cloud). */
async function ackQueueItems({ celesi, deviceId, ids, relayAckedThrough }) {
  if (!ids?.length) return { ok: true, acked: 0 };
  const r = await relayRequest("POST", "/api/v1/terminal/relay/ack", {
    celesi,
    device_id: deviceId,
    ids,
  });
  if (relayAckedThrough && typeof relayAckedThrough === "object") {
    try {
      const db = require("./database");
      if (typeof db.setRelayAckedThrough === "function") {
        db.setRelayAckedThrough(relayAckedThrough);
      }
    } catch {
      /* ignore */
    }
  }
  return r;
}

/** Kryesorja → cloud: staff / menu / services / stock (vetëm hash i ndryshuar). */
async function publishSnapshots({ celesi, deviceId, snapshots, published, force = false }) {
  const list = [];
  const hashes = {};
  for (const [kind, data] of Object.entries(snapshots || {})) {
    if (data == null) continue;
    const hash = hashOf(data);
    hashes[kind] = hash;
    if (!force && published && published[kind] === hash) continue;
    list.push({ kind, hash, payload: seal(data, celesi) });
  }
  if (!list.length) return { published: 0, hashes };
  await relayRequest("POST", "/api/v1/terminal/relay/snapshots", {
    celesi,
    device_id: deviceId,
    snapshots: list,
  });
  return { published: list.length, hashes, kinds: list.map((x) => x.kind) };
}

/** Arka 2+ ← cloud (batch me have-hash). */
async function fetchSnapshots({ celesi, deviceId, have }) {
  const r = await relayRequest("POST", "/api/v1/terminal/relay/snapshots/fetch", {
    celesi,
    device_id: deviceId,
    have: have || {},
  });
  const serverTime = r.server_time || null;
  const out = {};
  for (const [kind, s] of Object.entries(r.snapshots || {})) {
    const updated_at = toLocalIso(s.updated_at, serverTime) ?? s.updated_at;
    try {
      out[kind] = { hash: s.hash, updated_at, data: open(s.payload, celesi) };
    } catch (e) {
      out[kind] = { hash: s.hash, updated_at, data: null, error: e.message || "nuk u hap" };
    }
  }
  const primary_last_seen_at = absorbPrimaryLastSeen(r);
  return { snapshots: out, known: r.known || {}, server_time: serverTime, primary_last_seen_at };
}

/**
 * Arka 2+ — gjen Kryesoren: .terminal-lan.json, IP të fundit që kanë punuar, adresa nga cloud (master snapshot).
 */
function createLanLocator({
  readSaved,
  writeSaved,
  getCelesi,
  readRecentHosts,
  pushRecentHost,
  defaultPort = LAN_DEFAULT_PORT,
  requestOnce = cloudHealth.requestJsonOnce,
  now = Date.now,
}) {
  const state = {
    base: null,
    host: null,
    okAt: 0,
    retryAt: 0,
    lastError: null,
    published: { hosts: [], port: null },
  };

  function portOrDefault(port, savedPort) {
    const p = Math.floor(Number(port) || 0);
    if (p >= 1) return p;
    const s = Math.floor(Number(savedPort) || 0);
    if (s >= 1) return s;
    return defaultPort;
  }

  function candidates() {
    const out = [];
    const seen = new Set();
    const saved = readSaved() || {};
    const add = (host, port) => {
      const h = String(host || "").trim();
      const p = portOrDefault(port, saved.port);
      if (!h) return;
      const k = `${h}:${p}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ host: h, port: p });
    };
    add(saved.host, saved.port);
    for (const h of readRecentHosts?.() || []) add(h, saved.port);
    const pubPort = state.published.port || saved.port;
    for (const h of state.published.hosts || []) add(h, pubPort);
    return out;
  }

  function isMasterPing(parsed) {
    if (!parsed || parsed.ok !== true) return false;
    const role = String(parsed.role || "").trim().toLowerCase();
    if (role === "arka1") return true;
    const roleCode = String(parsed.role_code || "").trim().toLowerCase();
    if (roleCode === "arka1") return true;
    const n = Math.floor(Number(parsed.register_number) || 0);
    return n === 1;
  }

  async function probe(c, celesi) {
    const base = `http://${c.host}:${c.port}`;
    const headers = { "x-license-key": celesi };
    const qs = `?celesi=${encodeURIComponent(celesi)}`;
    const r = await requestOnce("GET", base, `/api/terminal/ping${qs}`, null, LAN_PROBE_TIMEOUT_MS, headers);
    if (r.status !== 200) return false;
    let parsed = {};
    try {
      parsed = JSON.parse(r.data || "{}");
    } catch {
      parsed = {};
    }
    return isMasterPing(parsed);
  }

  async function locate() {
    const t = now();
    if (state.base && t - state.okAt < LAN_OK_TTL_MS) return state.base;
    if (!state.base && t < state.retryAt) return null;
    const celesi = getCelesi();
    if (!celesi) return null;
    const saved = readSaved() || {};
    for (const c of candidates()) {
      try {
        if (await probe(c, celesi)) {
          state.base = `http://${c.host}:${c.port}`;
          state.host = c.host;
          state.okAt = now();
          state.lastError = null;
          try {
            pushRecentHost?.(c.host, c.port);
          } catch {
            /* ignore */
          }
          if (String(saved.host || "") !== c.host || portOrDefault(saved.port, null) !== c.port) {
            try {
              writeSaved(c.host, c.port);
            } catch {
              /* ignore */
            }
          }
          return state.base;
        }
        state.lastError = `${c.host}:${c.port} nuk u përgjigj si Kryesore`;
      } catch (e) {
        state.lastError = `${c.host}:${c.port} ${e.message || e}`;
      }
    }
    state.base = null;
    state.host = null;
    state.retryAt = now() + LAN_RETRY_MS;
    return null;
  }

  return {
    locate,
    markOk() {
      if (state.base) state.okAt = now();
    },
    markFailed(err) {
      state.lastError = err ? String(err.message || err) : state.lastError;
      state.base = null;
      state.host = null;
      state.retryAt = now() + LAN_RETRY_MS;
    },
    setPublished(info) {
      const hosts = (Array.isArray(info?.lan_hosts) ? info.lan_hosts : [])
        .map((h) => String(h || "").trim())
        .filter((h) => /^(10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h));
      const port = Math.floor(Number(info?.port) || 0) || null;
      state.published = { hosts, port };
      if (!state.base) state.retryAt = 0;
    },
    status() {
      return {
        lan: !!state.base,
        host: state.host,
        last_error: state.lastError,
        published_hosts: [...(state.published.hosts || [])],
      };
    },
  };
}

async function fetchSnapshotKind({ celesi, deviceId, kind, hash }) {
  const qs = new URLSearchParams({
    celesi,
    device_id: deviceId,
    kind: String(kind || ""),
    hash: String(hash || ""),
  });
  const r = await relayRequest("GET", `/api/v1/terminal/relay/snapshots/fetch?${qs.toString()}`, null);
  const serverTime = r.server_time || null;
  const primary_last_seen_at = absorbPrimaryLastSeen(r);
  const updated_at = toLocalIso(r.updated_at, serverTime) ?? r.updated_at;
  if (!r.found || r.unchanged) {
    return {
      kind,
      unchanged: !!r.unchanged,
      hash: r.hash || hash,
      data: null,
      updated_at,
      primary_last_seen_at,
    };
  }
  try {
    return {
      kind,
      unchanged: false,
      hash: r.hash,
      data: open(r.payload, celesi),
      updated_at,
      primary_last_seen_at,
    };
  } catch (e) {
    return {
      kind,
      unchanged: false,
      hash: r.hash,
      data: null,
      error: e.message || "nuk u hap",
      updated_at,
      primary_last_seen_at,
    };
  }
}

module.exports = {
  seal,
  open,
  hashOf,
  toLocalIso,
  absorbPrimaryLastSeen,
  getMasterPrimaryLastSeenAt,
  isMasterPrimaryOnlineOnCloud,
  PRIMARY_CLOUD_ONLINE_MS,
  pushQueueItems,
  pushPresence,
  fetchRelayPresence,
  pullQueue,
  ackQueueItems,
  publishSnapshots,
  fetchSnapshots,
  fetchSnapshotKind,
  createLanLocator,
  LAN_PROBE_TIMEOUT_MS,
  LAN_OK_TTL_MS,
  LAN_RETRY_MS,
};
