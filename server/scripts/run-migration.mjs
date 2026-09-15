/**
 * Run a SQL migration file against Supabase/Postgres.
 * Usage: npm run sql:run -- 008_owner_password_reset.sql
 * Requires DATABASE_URL in .env or environment (Supabase → Settings → Database → URI).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

if (existsSync(envPath)) {
  loadEnv({ path: envPath });
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
  if (url.startsWith("postgres") && !/[?&]sslmode=/.test(url)) {
    url += url.includes("?") ? "&sslmode=require" : "?sslmode=require";
  }
  return url;
}

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("Usage: npm run sql:run -- <migration.sql>");
  process.exit(1);
}

const sqlPath = path.isAbsolute(fileArg)
  ? fileArg
  : path.join(root, "supabase", "migrations", fileArg);

const url = normalizeDatabaseUrl(process.env.DATABASE_URL);
if (!url) {
  console.error("DATABASE_URL is not set (.env or environment)");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
const pool = new pg.Pool({
  connectionString: url,
  connectionTimeoutMillis: 20_000,
});

async function main() {
  let host = "?";
  try {
    const normalized = url.replace(/^postgresql:/, "https:").replace(/^postgres:/, "https:");
    host = new URL(normalized).hostname;
  } catch {
    /* ignore */
  }

  console.log(`Running SQL: ${path.basename(sqlPath)} (host ${host})`);
  await pool.query(sql);

  if (/021_package_tiers/i.test(path.basename(sqlPath))) {
    const { rows: tiers } = await pool.query(`
      SELECT package_tier, COUNT(*)::int AS n
      FROM clients
      GROUP BY package_tier
      ORDER BY package_tier
    `);
    const { rows: chk } = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'clients_package_tier_check'
    `);
    console.log("OK — package_tier counts:", tiers.map(r => `${r.package_tier}=${r.n}`).join(", ") || "(none)");
    console.log("OK — constraint:", chk[0]?.def || "(missing)");
    return;
  }

  const { rows } = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'owner_password_resets'
    ORDER BY ordinal_position
  `);
  console.log(
    "OK — owner_password_resets columns:",
    rows.map((r) => r.column_name).join(", ") || "(table missing)",
  );
}

main()
  .catch((err) => {
    console.error("Failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => pool.end());
