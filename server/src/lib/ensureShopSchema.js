const { readFileSync } = require("node:fs");
const path = require("node:path");
const { getPgPool } = require("./pgPool");

let ensurePromise = null;

async function ensureShopSchema() {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const pool = getPgPool();
    if (!pool) {
      return false;
    }

    const sqlPath = path.join(__dirname, "../../supabase/migrations/026_shop_storefront.sql");
    const sql = readFileSync(sqlPath, "utf8");
    await pool.query(sql);
    return true;
  })().catch((err) => {
    ensurePromise = null;
    throw err;
  });

  return ensurePromise;
}

module.exports = { ensureShopSchema };
