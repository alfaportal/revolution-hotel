import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js");

const dbPath =
  process.env.HOTEL_DB ||
  path.join(process.env.APPDATA || "", "Revolution HOTEL", "restaurant.db");

const SQL = await initSqlJs();
if (!fs.existsSync(dbPath)) {
  console.log("MISS", dbPath);
  process.exit(1);
}

const db = new SQL.Database(fs.readFileSync(dbPath));
const total = db.exec("SELECT COUNT(*) FROM menu_items")[0]?.values?.[0]?.[0];
console.log("\nDB", dbPath, "total", total);
try {
  const vat = db.exec(
    "SELECT COALESCE(vat_category,'?') AS v, COUNT(*) AS c FROM menu_items GROUP BY v ORDER BY v",
  )[0]?.values || [];
  console.log("VAT buckets:");
  for (const [v, c] of vat) console.log(" ", c, v);
} catch (e) {
  console.log("vat err", e.message);
}
const norma = db.exec(
  `SELECT name, category, COALESCE(vat_category,'') , price
     FROM menu_items
     WHERE category LIKE '%NORMA%' OR category LIKE '%Norma%' OR name LIKE '%NORMA%'
     ORDER BY category, name`,
)[0]?.values || [];
console.log("NORMA-named:", norma.length);
for (const r of norma.slice(0, 40)) console.log(" ", r.join(" | "));
db.close();
