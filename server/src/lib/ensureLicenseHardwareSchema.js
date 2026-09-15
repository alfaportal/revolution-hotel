const { getSupabase } = require("../db");

let ensured = false;

/**
 * Kolona hardware_id (16 hex) — ndryshe nga device_id (12) për terminale/cloud.
 */
async function ensureLicenseHardwareSchema() {
  if (ensured) return true;
  const db = getSupabase();
  try {
    const { error } = await db.from("licenses").select("hardware_id").limit(1);
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
      ALTER TABLE licenses
        ADD COLUMN IF NOT EXISTS hardware_id TEXT NOT NULL DEFAULT '';
      COMMENT ON COLUMN licenses.hardware_id IS
        'HARDWARE_ID 16 hex (XXXX-XXXX-XXXX-XXXX) nga POS Aktivizo — për gjenerim LICENSE_KEY. Jo device_id 12.';
    `);
    await client.end();
    ensured = true;
    return true;
  } catch (err) {
    console.warn("[ensureLicenseHardwareSchema]", err.message || err);
    return false;
  }
}

module.exports = { ensureLicenseHardwareSchema };
