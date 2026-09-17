const { getSupabase } = require("../db");

let ensured = false;

async function ensureOrderRefusalSchema() {
  if (ensured) return true;
  const db = getSupabase();
  try {
    const { error } = await db.from("order_refusal_events").select("id").limit(1);
    if (!error) {
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
      ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS refuse_reason TEXT;
      CREATE TABLE IF NOT EXISTS order_refusal_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
        waiter_id TEXT NOT NULL DEFAULT '',
        waiter_name TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        table_number INTEGER,
        total NUMERIC(12,2),
        items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        device_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_order_refusal_events_client_created
        ON order_refusal_events (client_id, created_at DESC);
    `);
    await client.end();
    ensured = true;
    return true;
  } catch (err) {
    console.warn("[ensureOrderRefusalSchema]", err.message || err);
    return false;
  }
}

module.exports = { ensureOrderRefusalSchema };
