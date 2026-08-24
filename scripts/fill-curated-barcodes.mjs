/**
 * Mbush barcode VETËM për marka të paketuara (lista e sigurt).
 * node scripts/fill-curated-barcodes.mjs
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js");

const dbPath =
  process.env.HOTEL_DB ||
  path.join(process.env.APPDATA || "", "Revolution HOTEL", "restaurant.db");

const CURATED = [
  [/coca[-\s]?cola(?!\s*zero)/i, "5449000000996", "Coca-Cola"],
  [/coca[-\s]?cola\s*zero/i, "5449000131805", "Coca-Cola Zero"],
  [/^fanta\b/i, "5449000011527", "Fanta"],
  [/^sprite\b/i, "5449000000859", "Sprite"],
  [/^pepsi\b/i, "4060800103446", "Pepsi"],
  [/^red\s*bull\b/i, "9002490100070", "Red Bull"],
  [/^monster\b/i, "5060639127557", "Monster"],
  [/^heineken\b/i, "8712000022671", "Heineken"],
  [/^corona\b/i, "7501064191110", "Corona Extra"],
  [/^tuborg\b/i, "5740700401022", "Tuborg"],
  [/^lasko\b/i, "3830001710991", "Lasko"],
  [/^schweppes\b/i, "5449000023605", "Schweppes"],
  [/^ice[d]?\s*tea\b/i, "5449000235831", "Ice Tea"],
  [/^lipton\b/i, "8711000522103", "Lipton"],
  [/^nestea\b/i, "5449000235831", "Nestea"],
  [/^nutella\b/i, "3017620422003", "Nutella"],
  [/^snickers\b/i, "5000159461122", "Snickers"],
  [/^twix\b/i, "5000159557221", "Twix"],
  [/^kit\s*kat\b/i, "3800020417647", "KitKat"],
  [/^mars\b/i, "5000159407236", "Mars"],
  [/^bounty\b/i, "5000159421465", "Bounty"],
  [/^ajvar\b/i, "3850104022517", "Ajvar"],
];

if (!fs.existsSync(dbPath)) {
  console.error("DB mungon:", dbPath);
  process.exit(1);
}

const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(dbPath));
const cols = (db.exec("PRAGMA table_info(menu_items)")[0]?.values || []).map((v) => v[1]);
if (!cols.includes("barcode")) {
  console.error("Kolona barcode mungon — hap POS 1.0.244 një herë pastaj riprovo.");
  process.exit(1);
}

const rows = (
  db.exec("SELECT id, name, COALESCE(barcode, '') FROM menu_items")[0]?.values || []
).map((v) => ({ id: v[0], name: v[1], bc: String(v[2] || "").trim() }));

let filled = 0;
let already = 0;
let left = 0;
const examples = [];

for (const r of rows) {
  if (r.bc) {
    already += 1;
    continue;
  }
  let hit = null;
  for (const [re, barcode, label] of CURATED) {
    if (re.test(String(r.name).trim())) {
      hit = { barcode, label };
      break;
    }
  }
  if (!hit) {
    left += 1;
    continue;
  }
  db.run(
    "UPDATE menu_items SET barcode = ? WHERE id = ? AND (barcode IS NULL OR TRIM(COALESCE(barcode, '')) = '')",
    [hit.barcode, r.id],
  );
  filled += 1;
  if (examples.length < 40) {
    examples.push(`#${r.id} ${r.name} → ${hit.barcode} (${hit.label})`);
  }
}

fs.writeFileSync(dbPath, Buffer.from(db.export()));
const withBc = db.exec(
  "SELECT COUNT(*) FROM menu_items WHERE TRIM(COALESCE(barcode, '')) != ''",
)[0].values[0][0];

console.log("DB:", dbPath);
console.log("TOTAL:", rows.length);
console.log("kishin barcode:", already);
console.log("u mbushën tani:", filled);
console.log("mbeten pa (gatime lokale / pa EAN të sigurt):", left);
console.log("me barcode pas update:", withBc);
console.log("---");
for (const e of examples) console.log(e);
db.close();
