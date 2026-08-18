/**
 * Fshin duplikatat e menu_items — mbetet 1 rresht për emër (+ kategori).
 * Preferon: aktiv, me barcode, me çmim > 0, id më të vogël.
 * node scripts/dedupe-menu-items.mjs [--dry-run]
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js");
const dryRun = process.argv.includes("--dry-run");

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

function score(row) {
  let s = 0;
  if (Number(row.active) === 1) s += 100;
  if (String(row.barcode || "").trim()) s += 50;
  if (Number(row.price) > 0) s += 20;
  if (Number(row.stock_qty) > 0) s += 5;
  // prefer older/smaller id as stable
  s -= Number(row.id) * 0.0001;
  return s;
}

if (!fs.existsSync(dbPath)) {
  console.error("DB mungon:", dbPath);
  process.exit(1);
}

// Backup
const bak = dbPath + ".bak-dedupe-" + Date.now();
fs.copyFileSync(dbPath, bak);
console.log("Backup:", bak);

const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(dbPath));

const cols = (db.exec("PRAGMA table_info(menu_items)")[0]?.values || []).map((v) => v[1]);
const hasBarcode = cols.includes("barcode");
const hasStock = cols.includes("stock_qty");

const sql = `SELECT id, name, category, price, active
  ${hasBarcode ? ", COALESCE(barcode,'') AS barcode" : ", '' AS barcode"}
  ${hasStock ? ", COALESCE(stock_qty,0) AS stock_qty" : ", 0 AS stock_qty"}
  FROM menu_items ORDER BY id`;

const rows = (db.exec(sql)[0]?.values || []).map((v) => ({
  id: v[0],
  name: v[1],
  category: v[2],
  price: Number(v[3]) || 0,
  active: v[4],
  barcode: v[5],
  stock_qty: Number(v[6]) || 0,
}));

console.log("TOTAL para:", rows.length);

/** key = emër i normalizuar (pa kategori) — si në UI që sheh 6× Aperol Spritz */
const groups = new Map();
for (const r of rows) {
  const key = norm(r.name);
  if (!key) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const toDelete = [];
let keepCount = 0;
const sample = [];

for (const [key, list] of groups) {
  if (list.length === 1) {
    keepCount += 1;
    continue;
  }
  list.sort((a, b) => score(b) - score(a));
  const keep = list[0];
  keepCount += 1;
  const dels = list.slice(1);
  for (const d of dels) toDelete.push(d.id);
  if (sample.length < 15) {
    sample.push(
      `"${keep.name}" → mbaj #${keep.id}, fshi ${dels.map((d) => "#" + d.id).join(", ")} (${list.length}×)`,
    );
  }
}

console.log("Emra unik:", groups.size);
console.log("Mbahen:", keepCount);
console.log("Fshihen duplikata:", toDelete.length);
console.log("---");
for (const s of sample) console.log(s);

if (dryRun) {
  console.log("\nDRY-RUN — asgjë nuk u fshi.");
  db.close();
  process.exit(0);
}

if (!toDelete.length) {
  console.log("Nuk ka duplikata.");
  db.close();
  process.exit(0);
}

// Check FK refs — order_items might reference menu_item_id
const tables = (db.exec(
  "SELECT name FROM sqlite_master WHERE type='table'",
)[0]?.values || []).map((v) => v[0]);

db.run("BEGIN");
try {
  const del = db.prepare("DELETE FROM menu_items WHERE id = ?");
  for (const id of toDelete) {
    del.bind([id]);
    del.step();
    del.reset();
  }
  del.free();
  db.run("COMMIT");
} catch (e) {
  db.run("ROLLBACK");
  console.error("Gabim:", e.message);
  process.exit(1);
}

fs.writeFileSync(dbPath, Buffer.from(db.export()));
const after = db.exec("SELECT COUNT(*) FROM menu_items")[0].values[0][0];
console.log("\nTOTAL pas:", after);
console.log("DB u ruajt. Rinis Revolution HOTEL.");
db.close();
