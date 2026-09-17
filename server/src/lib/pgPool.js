const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const { config: loadEnv } = require("dotenv");
const pg = require("pg");

let pool = null;

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
  if (url.startsWith("postgres") && !/[?&]sslmode=/.test(url)) {
    url += url.includes("?") ? "&sslmode=require" : "?sslmode=require";
  }
  return url;
}

function getPgPool() {
  if (pool) return pool;

  const envPath = path.join(__dirname, "../../.env");
  if (existsSync(envPath)) loadEnv({ path: envPath });

  const url = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!url) return null;

  pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 20_000,
    max: 3,
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
};
