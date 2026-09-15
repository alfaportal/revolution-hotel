const dns = require("node:dns");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const { config: loadEnv } = require("dotenv");
const pg = require("pg");

if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

let pool = null;

function trimEnv(name) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Railway/Supabase: lidhja direkte db.*.supabase.co:5432 shpesh është IPv6-only → ENETUNREACH.
 * Rishkruaj te pooler (6543) kur SUPABASE_POOLER_HOST është vendosur ose default EU.
 */
function rewriteSupabaseDirectToPooler(url) {
  try {
    const parsed = new URL(url);
    const m = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname || "");
    if (!m) return url;

    const ref = m[1];
    const poolerHost =
      trimEnv("SUPABASE_POOLER_HOST") ||
      trimEnv("SUPABASE_DB_POOLER_HOST") ||
      "aws-0-eu-central-1.pooler.supabase.com";
    const poolerPort = trimEnv("SUPABASE_POOLER_PORT") || "6543";

    if (parsed.username === "postgres" && !parsed.username.includes(".")) {
      parsed.username = `postgres.${ref}`;
    }
    parsed.hostname = poolerHost;
    parsed.port = poolerPort;
    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizeDatabaseUrl(raw) {
  if (raw == null) return "";
  let url = String(raw).trim();
  if (!url) return "";
  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1).trim();
  }
  url = url.replace(/[&?]channel_binding=[^&]*/gi, "");
  url = url.replace(/\?&/, "?").replace(/&&/g, "&").replace(/[?&]$/, "");

  url = rewriteSupabaseDirectToPooler(url);

  if (url.startsWith("postgres") && !/[?&]sslmode=/.test(url)) {
    url += url.includes("?") ? "&sslmode=require" : "?sslmode=require";
  }
  if (url.startsWith("postgres") && !/[?&]uselibpqcompat=/.test(url)) {
    url += url.includes("?") ? "&uselibpqcompat=true" : "?uselibpqcompat=true";
  }
  return url;
}

function getDatabaseUrl() {
  const envPath = path.join(__dirname, "../../.env");
  if (existsSync(envPath)) loadEnv({ path: envPath });
  const raw = trimEnv("DATABASE_URL") || trimEnv("SUPABASE_DB_URL");
  return normalizeDatabaseUrl(raw);
}

function getPgPool() {
  if (pool) return pool;

  const url = getDatabaseUrl();
  if (!url) return null;

  pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 20_000,
    max: 3,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

async function withPgTransaction(fn) {
  const p = getPgPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getPgPool,
  withPgTransaction,
  getDatabaseUrl,
  normalizeDatabaseUrl,
};
