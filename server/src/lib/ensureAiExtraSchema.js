const { getSupabase } = require("../db");

let ensured = false;

async function ensureAiExtraSchema() {
  if (ensured) return true;
  const db = getSupabase();
  try {
    const { error: w } = await db.from("ai_weekly_reports").select("id").limit(1);
    const { error: r } = await db.from("ai_waiter_ratings").select("id").limit(1);
    if (!w && !r) {
      ensured = true;
      return true;
    }
  } catch {
    /* fall through */
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "";
  if (!databaseUrl) return false;

  try {
    const { Client } = require("pg");
    const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_weekly_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        week_start DATE NOT NULL,
        week_end DATE NOT NULL,
        report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        summary_text TEXT NOT NULL DEFAULT '',
        email_sent_at TIMESTAMPTZ,
        tokens_used INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (restaurant_id, week_start)
      );
      CREATE TABLE IF NOT EXISTS ai_waiter_ratings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        ratings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        analysis_text TEXT NOT NULL DEFAULT '',
        tokens_used INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (restaurant_id, period_start, period_end)
      );
    `);
    await client.end();
    ensured = true;
    return true;
  } catch (err) {
    console.warn("[ensureAiExtraSchema]", err.message || err);
    return false;
  }
}

module.exports = { ensureAiExtraSchema };
