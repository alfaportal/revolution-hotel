/**
 * Mbush barcode VETËM për produkte të paketuara me match të sigurt.
 * node scripts/fill-missing-barcodes.mjs [--dry-run]
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js");

const dryRun = process.argv.includes("--dry-run");
const dbPath =
  process.env.HOTEL_DB ||
  path.join(process.env.APPDATA || "", "Revolution HOTEL", "restaurant.db");

/** Barkode të njohura (EAN) për marka të zakonshme — match sipas emrit. */
const CURATED = [
  { re: /^(coca[\s-]?cola|coca cola|koka kola)$/i, barcode: "5449000000996", label: "Coca-Cola" },
  { re: /^(coca[\s-]?cola zero|coca cola zero)$/i, barcode: "5449000131805", label: "Coca-Cola Zero" },
  { re: /^fanta(\s+portokall|\s+orange)?$/i, barcode: "5449000011527", label: "Fanta" },
  { re: /^sprite$/i, barcode: "5449000000859", label: "Sprite" },
  { re: /^pepsi$/i, barcode: "4060800103446", label: "Pepsi" },
  { re: /^red\s*bull$/i, barcode: "9002490100070", label: "Red Bull" },
  { re: /^monster(\s+energy)?$/i, barcode: "5060639127557", label: "Monster" },
  { re: /^heineken$/i, barcode: "8712000022671", label: "Heineken" },
  { re: /^corona(\s+extra)?$/i, barcode: "7501064191110", label: "Corona Extra" },
  { re: /^tuborg$/i, barcode: "5740700401022", label: "Tuborg" },
  { re: /^lasko$/i, barcode: "3830001710991", label: "Lasko" },
  { re: /^(schweppes|schweppes tonic)$/i, barcode: "5449000023605", label: "Schweppes" },
  { re: /^(ice\s*tea|iced?\s*tea)$/i, barcode: "5449000235831", label: "Ice Tea" },
  { re: /^(nestea|lipton ice tea)$/i, barcode: "5449000235831", label: "Ice Tea" },
  { re: /^(ujë|uje|water|eau)\s*(0[.,]?5|05|0\.5)?\s*l?$/i, barcode: "5942163000010", label: "Ujë 0.5L" },
  { re: /^(ujë|uje)\s*(1[.,]?5|15|1\.5)\s*l$/i, barcode: "5942163000027", label: "Ujë 1.5L" },
  { re: /^nutella$/i, barcode: "3017620422003", label: "Nutella" },
  { re: /^(chips|çips|cips)$/i, barcode: "5998025001010", label: "Chips" },
  { re: /^(snickers)$/i, barcode: "5000159461122", label: "Snickers" },
  { re: /^(twix)$/i, barcode: "5000159557221", label: "Twix" },
  { re: /^(kitkat|kit kat)$/i, barcode: "3800020417647", label: "KitKat" },
  { re: /^(mars)$/i, barcode: "5000159407236", label: "Mars" },
  { re: /^(bounty)$/i, barcode: "5000159421465", label: "Bounty" },
];

/** Emra lokale / gatime — MOS kërko OFF (nuk kanë EAN të vlefshëm të produktit). */
const SKIP_RE =
  /kafe|espresso|cappuccino|kapucin|macchiato|makiato|latte|americano|caj|çaj|byrek|baklava|tiramisu|kroasan|akullore|glace|neskafe|revani|burger|hamburger|pizza|pasta|pâtes|wrap|nugget|hot\s*dog|shawarma|doner|döner|kebab|sandwich|sandui|salat|salade|supë|soupe|biftek|steak|pilet|poulet|mish|riz|oriz|patate|frites|pancake|omlet|omlette|toast|bruschett|raki|mojito|margarita|spritz|cuba\s*libre|gin\s*tonic|whisky|whiskey|tequila|tekil|rum\b|vodka|birra\s+draft|pression|draft|smoothie|milkshake|frappe|affogato|limonat|lemonade/i;

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function curatedBarcode(name) {
  const n = norm(name);
  for (const c of CURATED) {
    if (c.re.test(n) || c.re.test(name.trim())) {
      return { barcode: c.barcode, label: c.label, source: "curated" };
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchOffStrict(name) {
  const q = String(name || "").trim();
  if (q.length < 2 || SKIP_RE.test(q)) return null;
  // Vetëm emra që duken si markë e paketuar (1–3 fjalë, pa «me», «sauce», etj.)
  const words = q.split(/\s+/);
  if (words.length > 3) return null;

  const url =
    "https://world.openfoodfacts.org/cgi/search.pl?" +
    new URLSearchParams({
      search_terms: q,
      search_simple: "1",
      action: "process",
      json: "1",
      page_size: "6",
      tagtype_0: "states",
      tag_contains_0: "contains",
      tag_0: "en:complete",
    }).toString();

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "RevolutionHOTEL/1.0 (fill-barcodes-strict)",
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const products = Array.isArray(data?.products) ? data.products : [];
  const qn = norm(q);

  for (const p of products) {
    const code = String(p.code || "").trim();
    if (!/^\d{8,14}$/.test(code)) continue;
    const pname = norm(p.product_name || p.product_name_en || "");
    const brands = norm(p.brands || "");
    if (!pname) continue;
    // Match i fortë: emri i menusë ≈ emri OFF ose brand
    if (pname === qn || pname.startsWith(qn + " ") || brands.split(",").some((b) => b.trim() === qn)) {
      return {
        barcode: code,
        label: p.product_name || p.product_name_en || "",
        source: "off-strict",
      };
    }
    // Marka e njohur në fillim: "Heineken Lager" për "Heineken"
    if (pname.startsWith(qn) && qn.length >= 4) {
      return {
        barcode: code,
        label: p.product_name || p.product_name_en || "",
        source: "off-prefix",
      };
    }
  }
  return null;
}

if (!fs.existsSync(dbPath)) {
  console.error("DB mungon:", dbPath);
  process.exit(1);
}

const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(dbPath));
const cols = (db.exec("PRAGMA table_info(menu_items)")[0]?.values || []).map((v) => v[1]);
if (!cols.includes("barcode")) {
  console.error("Kolona barcode mungon — hap POS një herë (1.0.244) pastaj riprovo.");
  process.exit(1);
}

const rows = (db.exec(
  `SELECT id, name, category, COALESCE(barcode,'') AS barcode FROM menu_items ORDER BY name, id`,
)[0]?.values || []).map((v) => ({ id: v[0], name: v[1], category: v[2], barcode: String(v[3] || "").trim() }));

const without = rows.filter((r) => !r.barcode);
console.log("DB:", dbPath);
console.log("TOTAL", rows.length, "| me barcode", rows.length - without.length, "| pa", without.length);
console.log(dryRun ? "MODE dry-run" : "MODE write");
console.log("MBYLL Revolution HOTEL para se të shkruhet DB.\n");

/** cache sipas emrit të normalizuar */
const cache = new Map();
let filled = 0;
let skipped = 0;

for (const r of without) {
  const key = norm(r.name);
  let hit = cache.has(key) ? cache.get(key) : undefined;
  if (hit === undefined) {
    hit = curatedBarcode(r.name);
    if (!hit && !SKIP_RE.test(r.name)) {
      try {
        hit = await searchOffStrict(r.name);
        await sleep(300);
      } catch {
        hit = null;
      }
    }
    if (!hit) hit = null;
    cache.set(key, hit);
  }

  if (!hit) {
    skipped += 1;
    continue;
  }

  process.stdout.write(`#${r.id} ${r.name} → ${hit.barcode} (${hit.label})\n`);
  if (!dryRun) {
    db.run(
      "UPDATE menu_items SET barcode = ? WHERE id = ? AND (barcode IS NULL OR TRIM(COALESCE(barcode,'')) = '')",
      [hit.barcode, r.id],
    );
  }
  filled += 1;
}

if (!dryRun && filled > 0) {
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  console.log("\nDB u ruajt.");
}

const after = (db.exec(
  `SELECT COUNT(*) FROM menu_items WHERE TRIM(COALESCE(barcode,'')) != ''`,
)[0]?.values || [[0]])[0][0];

console.log("\nU mbushën rreshta:", filled);
console.log("U anashkaluan (pa EAN të sigurt):", skipped);
console.log("Artikuj me barcode tani:", after);
db.close();
