const { readFileSync } = require("node:fs");
const path = require("node:path");
const { getSupabase } = require("../db");
const { getPgPool } = require("./pgPool");

let ensurePromise = null;

async function ensureOrderAcceptanceSchema() {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const db = getSupabase();
    const { error: probeErr } = await db.from("sales_orders").select("accepted_at").limit(1);
    if (!probeErr) return true;

    const pool = getPgPool();
    if (!pool) {
      return false;
    }

    const sqlPath = path.join(__dirname, "../../supabase/migrations/021_order_acceptance.sql");
    const sql = readFileSync(sqlPath, "utf8");
    await pool.query(sql);
    return true;
  })().catch((err) => {
    ensurePromise = null;
    throw err;
  });

  return ensurePromise;
}

module.exports = { ensureOrderAcceptanceSchema };
