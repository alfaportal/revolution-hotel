const { readFileSync } = require("node:fs");
const path = require("node:path");
const { getPgPool } = require("./pgPool");

let ensurePromise = null;

async function ensureNotificationSchema() {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const pool = getPgPool();
    if (!pool) return false;
    const sqlPath = path.join(__dirname, "../../supabase/migrations/034_notification_settings.sql");
    await pool.query(readFileSync(sqlPath, "utf8"));
    return true;
  })().catch(err => {
    ensurePromise = null;
    throw err;
  });

  return ensurePromise;
}

module.exports = { ensureNotificationSchema };
