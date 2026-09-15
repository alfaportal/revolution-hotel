const { isFoodCategory } = require("./menu-groups");

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

function resolveItemCategory(item, lookup) {
  const inline = String(item.category || item.kategoria || "").trim();
  if (inline) return inline;
  const menuId = item.menu_item_id ?? item.menu_id ?? item.local_id ?? item.id;
  if (menuId != null && lookup.byId.has(String(menuId))) {
    return lookup.byId.get(String(menuId));
  }
  const name = String(item.name || "").trim().toLowerCase();
  if (name && lookup.byName.has(name)) return lookup.byName.get(name);
  return "";
}

function isKitchenItem(item, lookup) {
  return isFoodCategory(resolveItemCategory(item, lookup));
}

function isBarItem(item, lookup) {
  const cat = resolveItemCategory(item, lookup);
  if (!cat) return true;
  return !isFoodCategory(cat);
}

function splitItemsByStation(items, db) {
  const lookup = buildCategoryLookup(db);
  const barItems = [];
  const kitchenItems = [];
  for (const it of items || []) {
    if ((Number(it.quantity) || 0) <= 0) continue;
    if (isKitchenItem(it, lookup)) kitchenItems.push(it);
    else if (isBarItem(it, lookup)) barItems.push(it);
  }
  return { barItems, kitchenItems };
}

module.exports = {
  splitItemsByStation,
  isKitchenItem,
  isBarItem,
};
