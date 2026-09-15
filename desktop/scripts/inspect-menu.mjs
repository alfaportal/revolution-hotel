/**
 * Liston menyen: total, duplikata, emra jo-shqip (heuristikë).
 * node scripts/inspect-menu.mjs
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js");

const dbPath =
  process.env.HOTEL_DB ||
  path.join(process.env.APPDATA || "", "Revolution HOTEL", "restaurant.db");

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(dbPath));
const rows = (
  db.exec(
    "SELECT id, name, category, active, price, COALESCE(barcode,'') FROM menu_items ORDER BY category, name, id",
  )[0]?.values || []
).map((v) => ({
  id: v[0],
  name: v[1],
  category: v[2],
  active: v[3],
  price: v[4],
  barcode: v[5],
}));

console.log("DB:", dbPath);
console.log("TOTAL:", rows.length);

const byName = new Map();
for (const r of rows) {
  const k = norm(r.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(r);
}
const dups = [...byName.entries()].filter(([, a]) => a.length > 1);
console.log("UNIQUE:", byName.size, "DUP_GROUPS:", dups.length);
for (const [, a] of dups.slice(0, 40)) {
  console.log(`  ${a.length}x  "${a[0].name}"  [${a.map((x) => x.id).join(",")}]  cat=${a.map((x) => x.category).join("|")}`);
}

const cats = new Map();
for (const r of rows) cats.set(r.category, (cats.get(r.category) || 0) + 1);
console.log("\nCATEGORIES:");
for (const [c, n] of [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${n}\t${c}`);
}

// Print all names for review
console.log("\n--- ALL NAMES ---");
for (const r of rows) {
  console.log(`${r.id}\t${r.category}\t${r.name}`);
}
db.close();
