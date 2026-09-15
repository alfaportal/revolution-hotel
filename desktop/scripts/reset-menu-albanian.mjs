/**
 * Rivendos menynë lokale në seed shqip (pa frëngjisht/dyfishime).
 * Ruajt barcode + stok kur gjen përputhje (emër shqip ose përkthim FR).
 *
 * node scripts/reset-menu-albanian.mjs [--dry-run]
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js");
const VERSION = require("../version-config");
const frMap = require("../locales/fr-map");

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

const seed = Array.isArray(VERSION.menuSeedRaw) ? VERSION.menuSeedRaw : VERSION.menuSeed;
if (!seed?.length) {
  console.error("menuSeed bosh");
  process.exit(1);
}

/** Emra të vjetër (EN/IT) → emër i ri në seed (kur i kemi riemëruar) */
const OLD_TO_NEW = {
  "Espresso Doppio": "Espresso i dyfishtë",
  "Kafe Americane": "Kafe amerikane",
  "Flat White": "Flat white",
  "Kafe Turke": "Kafe turke",
  "Irish Coffee": "Kafe irlandeze",
  "Tonic Water": "Ujë tonik",
  "Ginger Ale": "Xhinxher ale",
  Soda: "Sodë",
  "Iced Coffee": "Kafe e ftohtë",
  "Iced Latte": "Latte e ftohtë",
  "Cold Brew": "Kafe e ftohtë e ngadalshme",
  "Iced Mocha": "Mocha e ftohtë",
  "Iced Tea": "Çaj i ftohtë",
  Lemonadë: "Limonadë",
  "Smoothie banana": "Smoothie banane",
  "Smoothie strawberry": "Smoothie luleshtrydhe",
  "Milkshake vanilj": "Milkshake vanilje",
  "Milkshake strawberry": "Milkshake luleshtrydhe",
  Whisky: "Uiski",
  Gin: "Xhin",
  "Gin Tonic": "Xhin tonik",
  Tequila: "Tekilë",
  "Omelette klasike": "Omeletë klasike",
  "Omelette me djathë": "Omeletë me djathë",
  "Omelette me perime": "Omeletë me perime",
  Pancakes: "Pankejk",
  "French Toast": "Bukë franceze",
  Croissant: "Krosan",
  "Croissant me çokollatë": "Krosan me çokollatë",
  "Croissant me djathë": "Krosan me djathë",
  "Fruit Bowl": "Tas me fruta",
  "Mëngjes anglisht": "Mëngjes anglez",
  "Caesar Salad": "Sallatë Cezar",
  Caprese: "Sallatë Kapreze",
  "Sallatë tonno": "Sallatë tune",
  "Sallatë Niçoise": "Sallatë Nisuaz",
  "Sallatë quinoa": "Sallatë kuinoa",
  Coleslaw: "Sallatë lakre",
  "Supë leng mishi": "Supë lëng mishi",
  "Supë lakre (Goulash)": "Supë lakre (gullash)",
  Margherita: "Pizza Margarita",
  Pepperoni: "Pizza peperoni",
  "Quattro Formaggi": "Pizza katër djathëra",
  Capricciosa: "Pizza Kapriçoza",
  Prosciutto: "Pizza proshutë",
  Tonno: "Pizza tune",
  Vegetariane: "Pizza vegjetariane",
  "BBQ Chicken": "Pizza pule BBQ",
  Diavola: "Pizza Diavola",
  Calzone: "Pizza Kalcone",
  "Pizza Bianca": "Pizza e bardhë",
  Cheeseburger: "Hamburger me djathë",
  "Double Burger": "Hamburger i dyfishtë",
  "Chicken Burger": "Hamburger pule",
  "Veggie Burger": "Hamburger vegjetarian",
  "BBQ Burger": "Hamburger BBQ",
  "Crispy Chicken": "Pule krogante",
  Nuggets: "Nagets",
  "Hot Dog": "Hot dog",
  "Doner kebab": "Döner kebab",
  "Döner kebab": "Döner kebab",
  Shawarma: "Shaurma",
  "Club Sandwich": "Sanduiç klub",
  "Sandwich tunë": "Sanduiç tune",
  "Sandwich pule": "Sanduiç pule",
  Bagel: "Bejëll",
  Bruschetta: "Brusketa",
  "Spaghetti Bolognese": "Spageti Bolonjeze",
  "Spaghetti Carbonara": "Spageti Karbonara",
  "Penne Arrabiata": "Pene Arabiata",
  "Fettuccine Alfredo": "Fetuçine Alfredo",
  Lasagna: "Lazanja",
  Gnocchi: "Njoki",
  "Pasta Pesto": "Pasta me pesto",
  "Steak viçi": "Stek viçi",
  "Cotoletta (shnicël)": "Shnicël",
  "Rib-eye": "Ribaj",
  Ćevapi: "Qebapa",
  Pljeskavica: "Pljeskavicë",
  "Fish & Chips": "Peshk me patate",
  "Onion Rings": "Unaza qepësh",
  "Mozzarella Sticks": "Shkopinj mozzarella",
  "Salcë tartare": "Salcë tartar",
  Tiramisù: "Tiramisu",
  Cheesecake: "Tortë djathi",
  "Crème Brûlée": "Krem brûle",
  Brownie: "Brauni",
  Cookies: "Biskota",
  "Torte çokollatë": "Tortë çokollatë",
  "Torte frutash": "Tortë frutash",
  Trilece: "Trileçe",
  Waffle: "Vaflë",
  "Crêpe me Nutella": "Krep me Nutella",
  "Crêpe me fruta": "Krep me fruta",
  "Akullore vanilj": "Akullore vanilje",
  "Fruit Salad": "Sallatë frutash",
  "Nuggets me patate": "Nagets me patate",
  "Mini burger": "Mini hamburger",
  "Pancakes me Nutella": "Pankejk me Nutella",
};

/** fr → sq (vetëm për emra produktesh që janë në seed) */
const frToSq = new Map();
const seedByNorm = new Map();
for (const it of seed) {
  seedByNorm.set(norm(it.name), it);
}
for (const [sq, fr] of Object.entries(frMap)) {
  const target = OLD_TO_NEW[sq] || sq;
  if (!seedByNorm.has(norm(target))) continue;
  frToSq.set(norm(fr), seedByNorm.get(norm(target)).name);
}
for (const [oldName, newName] of Object.entries(OLD_TO_NEW)) {
  if (seedByNorm.has(norm(newName))) frToSq.set(norm(oldName), newName);
}

if (!fs.existsSync(dbPath)) {
  console.error("DB mungon:", dbPath);
  process.exit(1);
}

const bak = dbPath + ".bak-menu-sq-" + Date.now();
fs.copyFileSync(dbPath, bak);
console.log("Backup:", bak);

const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(dbPath));

const rows = (
  db.exec(
    `SELECT id, name, category, price, active,
      COALESCE(stock_qty,0), COALESCE(barcode,''), COALESCE(vat_category,'18'),
      COALESCE(low_stock_threshold,0), COALESCE(photo,''), COALESCE(sort_order,0)
     FROM menu_items`,
  )[0]?.values || []
).map((v) => ({
  id: v[0],
  name: String(v[1] || ""),
  category: String(v[2] || ""),
  price: Number(v[3]) || 0,
  active: Number(v[4]) !== 0,
  stock_qty: Number(v[5]) || 0,
  barcode: String(v[6] || "").trim(),
  vat_category: String(v[7] || "18"),
  low_stock_threshold: Number(v[8]) || 0,
  photo: String(v[9] || ""),
  sort_order: Number(v[10]) || 0,
}));

console.log("TOTAL para:", rows.length);
console.log("SEED shqip:", seed.length);

/** seedKey → best local row to keep/merge */
const keepForSeed = new Map();
const usedIds = new Set();

function score(row, seedItem) {
  let s = 0;
  if (norm(row.name) === norm(seedItem.name)) s += 100;
  if (norm(row.category) === norm(seedItem.category)) s += 20;
  if (row.active) s += 10;
  if (row.barcode) s += 8;
  if (row.stock_qty > 0) s += 5;
  if (row.price > 0) s += 2;
  s -= row.id * 0.0001;
  return s;
}

function resolveSeedName(rowName) {
  const n = norm(rowName);
  if (seedByNorm.has(n)) return seedByNorm.get(n).name;
  if (frToSq.has(n)) return frToSq.get(n);
  return null;
}

for (const row of rows) {
  const sqName = resolveSeedName(row.name);
  if (!sqName) continue;
  const seedItem = seedByNorm.get(norm(sqName));
  if (!seedItem) continue;
  const key = norm(seedItem.name);
  const prev = keepForSeed.get(key);
  if (!prev || score(row, seedItem) > score(prev, seedItem)) {
    keepForSeed.set(key, row);
  }
}

// Merge stock/barcode from all matches into keeper
const mergeExtra = new Map(); // seedKey → {stock, barcode}
for (const row of rows) {
  const sqName = resolveSeedName(row.name);
  if (!sqName) continue;
  const key = norm(sqName);
  const keeper = keepForSeed.get(key);
  if (!keeper) continue;
  if (!mergeExtra.has(key)) mergeExtra.set(key, { stock: 0, barcode: keeper.barcode || "" });
  const m = mergeExtra.get(key);
  if (row.id !== keeper.id) m.stock += row.stock_qty;
  if (!m.barcode && row.barcode) m.barcode = row.barcode;
}
for (const [key, keeper] of keepForSeed) {
  const m = mergeExtra.get(key);
  if (!m) continue;
  keeper.stock_qty = (Number(keeper.stock_qty) || 0) + (m.stock || 0);
  if (!keeper.barcode && m.barcode) keeper.barcode = m.barcode;
  usedIds.add(keeper.id);
}

const toDelete = rows.filter((r) => !usedIds.has(r.id)).map((r) => r.id);
const missingSeed = seed.filter((it) => !keepForSeed.has(norm(it.name)));

console.log("Mbaj (seed match):", keepForSeed.size);
console.log("Fshi (FR/dup/extra):", toDelete.length);
console.log("Shto (mungojnë):", missingSeed.length);

if (dryRun) {
  console.log("\nShembuj fshirje:");
  for (const id of toDelete.slice(0, 30)) {
    const r = rows.find((x) => x.id === id);
    console.log(`  #${id} ${r.category} / ${r.name}`);
  }
  console.log("\nDRY-RUN — asgjë nuk u ndryshua.");
  db.close();
  process.exit(0);
}

db.run("BEGIN");
try {
  // Update keepers to exact Albanian seed name/category
  const upd = db.prepare(
    `UPDATE menu_items SET name=?, category=?, stock_qty=?, barcode=?, sort_order=? WHERE id=?`,
  );
  let sort = 0;
  for (const it of seed) {
    const key = norm(it.name);
    const keeper = keepForSeed.get(key);
    if (!keeper) continue;
    const bc = keeper.barcode || null;
    upd.run([it.name, it.category, keeper.stock_qty, bc, sort++, keeper.id]);
    upd.reset();
  }
  upd.free();

  const del = db.prepare("DELETE FROM menu_items WHERE id = ?");
  for (const id of toDelete) {
    del.run([id]);
    del.reset();
  }
  del.free();

  // Ensure categories exist
  const catRows = (db.exec("SELECT name FROM categories")[0]?.values || []).map((v) => String(v[0]));
  const catSet = new Set(catRows.map((c) => c.toLowerCase()));
  const insCat = db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)");
  let catSort = catRows.length;
  for (const it of seed) {
    if (!catSet.has(it.category.toLowerCase())) {
      insCat.run([it.category, catSort++]);
      insCat.reset();
      catSet.add(it.category.toLowerCase());
    }
  }
  insCat.free();

  const ins = db.prepare(
    `INSERT INTO menu_items (name, category, price, active, vat_category, sort_order, barcode, stock_qty)
     VALUES (?, ?, ?, 1, '18', ?, NULL, 0)`,
  );
  for (const it of missingSeed) {
    ins.run([it.name, it.category, Number(it.price) || 0, sort++]);
    ins.reset();
  }
  ins.free();

  db.run("COMMIT");
} catch (e) {
  db.run("ROLLBACK");
  console.error("Gabim:", e.message);
  process.exit(1);
}

fs.writeFileSync(dbPath, Buffer.from(db.export()));
const after = db.exec("SELECT COUNT(*) FROM menu_items")[0].values[0][0];
console.log("\nTOTAL pas:", after, "(seed =", seed.length + ")");
console.log("DB u ruajt. Hap Revolution HOTEL.");
db.close();
