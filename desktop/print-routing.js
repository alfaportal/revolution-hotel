const {
  isDrinkCategory,
  isDrinkItemName,
  isKitchenRouteItem,
} = require("./menu-groups");

function buildCategoryLookup(db) {
  const byId = new Map();
  const byName = new Map();
  for (const row of db.getMenuItems(false) || []) {
    const cat = String(row.category || "").trim();
    if (!cat) continue;
    byId.set(String(row.id), cat);
    byName.set(String(row.name || "").trim().toLowerCase(), cat);
  }
  return { byId, byName };
}

function buildCategoryRouteMap(db) {
  const map = new Map();
  for (const c of db.getCategories() || []) {
    const name = String(c.name || "").trim();
    if (!name) continue;
    const route = String(c.route || "bar").trim().toLowerCase();
    map.set(name, route === "kitchen" ? "kitchen" : "bar");
  }
  return map;
}

function resolveItemCategory(item, lookup) {
  const inline = String(item.category || item.kategoria || "").trim();
  if (inline) return inline;
  const menuId = item.menu_item_id ?? item.menu_id ?? item.local_id ?? item.id;
  if (menuId != null && lookup.byId.has(String(menuId))) {
    return lookup.byId.get(String(menuId));
  }
  const name = String(item.name || item.emri || "").trim().toLowerCase();
  if (name && lookup.byName.has(name)) return lookup.byName.get(name);
  return "";
}

/** Kuzhinë kur kategoria ka route=kitchen; përndryshe bar (fallback heuristik). */
function isKitchenItem(item, lookup, routeByCategory) {
  const name = String(item?.name || item?.emri || "");
  const cat = resolveItemCategory(item, lookup);
  if (cat && routeByCategory && routeByCategory.has(cat)) {
    return routeByCategory.get(cat) === "kitchen";
  }
  return isKitchenRouteItem(name, cat);
}

/** Pije + unknown → bar. */
function isBarItem(item, lookup, routeByCategory) {
  return !isKitchenItem(item, lookup, routeByCategory);
}

function splitItemsByStation(items, db) {
  const lookup = buildCategoryLookup(db);
  const routeByCategory = buildCategoryRouteMap(db);
  const barItems = [];
  const kitchenItems = [];
  for (const it of items || []) {
    if ((Number(it.quantity) || 0) <= 0) continue;
    if (isKitchenItem(it, lookup, routeByCategory)) kitchenItems.push(it);
    else barItems.push(it);
  }
  return { barItems, kitchenItems };
}

module.exports = {
  splitItemsByStation,
  isKitchenItem,
  isBarItem,
  isDrinkCategory,
  isDrinkItemName,
  buildCategoryRouteMap,
};
