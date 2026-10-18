/**
 * Rend kategorish për QR / takeaway / faqe publike — i njëjti koncept si KAFENE (pijet para).
 */
const VERSION = require("../version-config");
const { isDrinkCategory } = require("../menu-groups");

/** Pijet e shpejta para (si kiosk KAFENE — screenshot pronari). */
const DRINKS_FIRST = Object.freeze([
  "Pije të ftohta",
  "Pije joalkoolike",
  "Alkool",
  "Birra",
  "Vera",
  "Pije të nxehta",
]);

function kafeneGuestCategoryTemplate() {
  const base = Array.isArray(VERSION.defaultCategories) ? VERSION.defaultCategories : [];
  const seen = new Set();
  const out = [];
  for (const n of DRINKS_FIRST) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  for (const n of base) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function categorySortScore(name, rankMap) {
  const n = String(name || "").trim();
  if (!n) return 99999;
  if (rankMap.has(n)) return rankMap.get(n);
  if (isDrinkCategory(n)) return 2000;
  return 6000;
}

/** Rendit emrat e kategorive për menu mysafir (QR, takeaway, publike). */
function sortMenuCategoryNames(names) {
  const template = kafeneGuestCategoryTemplate();
  const rankMap = new Map(template.map((n, i) => [n, i]));
  const list = [...new Set((names || []).map((n) => String(n || "").trim()).filter(Boolean))];
  list.sort((a, b) => {
    const sa = categorySortScore(a, rankMap);
    const sb = categorySortScore(b, rankMap);
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b, "sq");
  });
  return list;
}

/** Si kategoriteMePorosi / stokuCategoryList — template KAFENE + kategori me artikuj. */
function mergeMenuCategoriesForGuest(dbOrderedNames, menuItems) {
  const present = new Set(
    (menuItems || []).map((m) => String(m.category || "").trim()).filter(Boolean),
  );
  if (!present.size) return [];
  const candidates = [];
  for (const raw of dbOrderedNames || []) {
    const name = String(raw?.name ?? raw ?? "").trim();
    if (name && present.has(name)) candidates.push(name);
  }
  for (const c of present) candidates.push(c);
  return sortMenuCategoryNames(candidates);
}

/** Një herë: vendos sort_order në SQLite si template KAFENE (panel + cloud sync). */
function buildCategoryReorderList(existingNames) {
  const cats = (existingNames || []).map((n) => String(n || "").trim()).filter(Boolean);
  if (!cats.length) return [];
  const template = kafeneGuestCategoryTemplate();
  const ordered = [];
  for (const t of template) {
    if (cats.includes(t)) ordered.push(t);
  }
  const rest = cats.filter((c) => !ordered.includes(c));
  rest.sort((a, b) => {
    const da = isDrinkCategory(a);
    const db = isDrinkCategory(b);
    if (da !== db) return da ? -1 : 1;
    return a.localeCompare(b, "sq");
  });
  ordered.push(...rest);
  return ordered;
}

module.exports = {
  DRINKS_FIRST,
  kafeneGuestCategoryTemplate,
  sortMenuCategoryNames,
  mergeMenuCategoriesForGuest,
  buildCategoryReorderList,
};
