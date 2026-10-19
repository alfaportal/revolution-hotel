/**
 * Rend kategorish për QR / POS / takeaway — i njëjti si cloud KAFENE (pijet e nxehta para).
 */
const { isDrinkCategory } = require("../menu-groups");

const DRINKS_FIRST = Object.freeze([
  "Pije të nxehta",
  "Pije të ftohta",
  "Pije joalkoolike",
  "Alkool",
  "Birra",
  "Vera",
]);

const DEFAULT_FOOD_ORDER = Object.freeze([
  "Mëngjes",
  "Salata",
  "Supa",
  "Pizza",
  "Hamburger / Fast Food",
  "Sanduiç / Toast",
  "Pasta",
  "Mish",
  "Peshk / Fruta deti",
  "Pjata tradicionale",
  "Shoqërime",
  "Ëmbëlsira",
  "Meny për fëmijë",
]);

function catKey(name) {
  return String(name || "").trim().toLowerCase();
}

function kafeneGuestCategoryTemplate() {
  const seen = new Set();
  const out = [];
  for (const n of [...DRINKS_FIRST, ...DEFAULT_FOOD_ORDER]) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function categorySortScore(name, rankMap, rankByKey) {
  const n = String(name || "").trim();
  if (!n) return 99999;
  if (rankMap.has(n)) return rankMap.get(n);
  const k = catKey(n);
  if (rankByKey.has(k)) return rankByKey.get(k);
  if (isDrinkCategory(n)) return 2000;
  return 6000;
}

/** Rendit emrat e kategorive për menu mysafir (QR, takeaway, publike, POS tabs). */
function sortMenuCategoryNames(names) {
  const template = kafeneGuestCategoryTemplate();
  const rankMap = new Map(template.map((n, i) => [n, i]));
  const rankByKey = new Map(template.map((n, i) => [catKey(n), i]));
  const list = [...new Set((names || []).map((n) => String(n || "").trim()).filter(Boolean))];
  list.sort((a, b) => {
    const sa = categorySortScore(a, rankMap, rankByKey);
    const sb = categorySortScore(b, rankMap, rankByKey);
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b, "sq");
  });
  return list;
}

/** Template KAFENE + kategori që kanë artikuj (pa case). */
function mergeMenuCategoriesForGuest(dbOrderedNames, menuItems) {
  const presentList = [
    ...new Set((menuItems || []).map((m) => String(m.category || "").trim()).filter(Boolean)),
  ];
  if (!presentList.length) return [];
  const presentByKey = new Map(presentList.map((n) => [catKey(n), n]));
  const candidates = [];
  const seenKeys = new Set();
  for (const raw of dbOrderedNames || []) {
    const name = String(raw?.name ?? raw ?? "").trim();
    const hit = presentByKey.get(catKey(name));
    if (hit && !seenKeys.has(catKey(hit))) {
      seenKeys.add(catKey(hit));
      candidates.push(hit);
    }
  }
  for (const c of presentList) {
    if (!seenKeys.has(catKey(c))) {
      seenKeys.add(catKey(c));
      candidates.push(c);
    }
  }
  return sortMenuCategoryNames(candidates);
}

/** SQLite sort_order si template KAFENE (panel + cloud sync). */
function buildCategoryReorderList(existingNames) {
  const cats = (existingNames || []).map((n) => String(n || "").trim()).filter(Boolean);
  if (!cats.length) return [];
  const sorted = sortMenuCategoryNames(cats);
  return sorted;
}

function sortMenuItemsForGuestDisplay(items, categoryOrder) {
  const rank = new Map((categoryOrder || []).map((name, i) => [catKey(name), i]));
  const catRank = (cat) => {
    const k = catKey(cat);
    return rank.has(k) ? rank.get(k) : 99999;
  };
  return [...(items || [])].sort(
    (a, b) =>
      catRank(a.category) - catRank(b.category) ||
      (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
      (Number(a.id) || 0) - (Number(b.id) || 0),
  );
}

module.exports = {
  DRINKS_FIRST,
  kafeneGuestCategoryTemplate,
  sortMenuCategoryNames,
  mergeMenuCategoriesForGuest,
  buildCategoryReorderList,
  sortMenuItemsForGuestDisplay,
};
