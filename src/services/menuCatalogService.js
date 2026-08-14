const { getSupabase } = require("../db");
const { isVisibleOnWebMenu, isOutOfStock } = require("../lib/stockHelpers");
const { getCatalogFlatMap, normMenuName } = require("../data/menuCatalogTemplate");
const {
  normalizeStockPhotoPath,
  stockPhotoFilePayload,
} = require("../lib/menuStockPhoto");

/** FR → SQ for waiter phone / QR / takeaway display only (POS catalog untouched). */
let _menuFrToSq = null;
let _menuFrToSqLower = null;
function menuFrToSqMap() {
  if (!_menuFrToSq) {
    try {
      _menuFrToSq = require("../data/menuFrToSq.json");
    } catch {
      _menuFrToSq = {};
    }
    _menuFrToSqLower = {};
    for (const [fr, sq] of Object.entries(_menuFrToSq)) {
      _menuFrToSqLower[fr.toLowerCase()] = sq;
    }
  }
  return _menuFrToSq;
}
function toSqMenuLabel(raw) {
  const s = String(raw || "").trim();
  if (!s) return s;
  const map = menuFrToSqMap();
  if (map[s]) return map[s];
  const lower = _menuFrToSqLower[s.toLowerCase()];
  if (lower) return lower;
  // Accent-insensitive fallback (e.g. vegetarien ≈ végétarien)
  const folded = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const [fr, sq] of Object.entries(map)) {
    const frFold = fr
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (frFold === folded) return sq;
  }
  return s;
}

let _catalogPhotoByName = null;
let _seedStockByName = null;

function foldKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ë/g, "e")
    .replace(/ç/g, "c");
}

function seedStockPhotoByName(name) {
  if (!_seedStockByName) {
    try {
      _seedStockByName = require("../data/menuStockPhotoMap.json");
    } catch {
      _seedStockByName = {};
    }
  }
  const raw = String(name || "").trim();
  if (!raw) return "";
  const sq = toSqMenuLabel(raw);
  const candidates = [
    normMenuName(raw),
    normMenuName(sq),
    normMenuName(raw.replace(/^(pizzas?|pica)\s+/i, "")),
    normMenuName(sq.replace(/^(pizzas?|pica)\s+/i, "")),
  ];
  for (const c of candidates) {
    if (c && _seedStockByName[c]) return _seedStockByName[c];
  }
  const foldedWanted = new Set(candidates.map(foldKey).filter(Boolean));
  for (const [k, v] of Object.entries(_seedStockByName)) {
    if (foldedWanted.has(foldKey(k))) return v;
  }
  return "";
}

function catalogPhotoByName(name) {
  const seed = seedStockPhotoByName(name);
  if (seed) return seed;
  if (!_catalogPhotoByName) {
    _catalogPhotoByName = new Map();
    for (const item of getCatalogFlatMap().values()) {
      if (item.photoUrl) {
        _catalogPhotoByName.set(normMenuName(item.name), item.photoUrl);
      }
    }
  }
  const raw = String(name || "").trim();
  return (
    _catalogPhotoByName.get(normMenuName(raw)) ||
    _catalogPhotoByName.get(normMenuName(toSqMenuLabel(raw))) ||
    ""
  );
}

/** Attach has_photo + photo_url for QR / takeaway / waiter clients. */
function resolveClientStockPhoto(item, row) {
  return (
    catalogPhotoByName(item?.name) ||
    catalogPhotoByName(row?.name) ||
    catalogPhotoByName(toSqMenuLabel(row?.name)) ||
    ""
  );
}

function attachClientPhoto(item, row, { slug = "", channel = "menu" } = {}) {
  const photo = String(row?.photo || "").trim();
  const templatePhoto = resolveClientStockPhoto(item, row);

  // Always prefer local studio stock when we have a matching file (broken https/API blobs are common).
  if (templatePhoto && stockPhotoFilePayload(templatePhoto)) {
    return { ...item, has_photo: true, photo_url: templatePhoto };
  }

  const stockPath = normalizeStockPhotoPath(photo);
  if (stockPath && stockPhotoFilePayload(photo)) {
    return { ...item, has_photo: true, photo_url: stockPath };
  }
  if (/^https?:\/\//i.test(photo)) {
    return { ...item, has_photo: true, photo_url: photo };
  }
  if (photo && slug) {
    return {
      ...item,
      has_photo: true,
      photo_url: `/api/${channel}/${encodeURIComponent(slug)}/menu/${item.id}/photo`,
    };
  }
  return { ...item, has_photo: false, photo_url: null };
}

function buildMenuCategories(dbCategories, menuItems) {
  const fromDb = (dbCategories || []).map(c => String(c.name || "").trim()).filter(Boolean);
  const fromMenu = [
    ...new Set((menuItems || []).map(m => String(m.category || "").trim()).filter(Boolean)),
  ];
  if (!fromDb.length) return fromMenu;
  const seen = new Set(fromDb);
  const merged = [...fromDb];
  for (const name of fromMenu) {
    if (!seen.has(name)) {
      seen.add(name);
      merged.push(name);
    }
  }
  return merged;
}

function mapMenuItemForWeb(row, photoOpts = {}) {
  const item = {
    id: row.local_id,
    name: toSqMenuLabel(row.name),
    category: toSqMenuLabel(row.category),
    price: Number(row.price),
    description: toSqMenuLabel(String(row.description || "").trim()) || String(row.description || "").trim(),
  };
  return attachClientPhoto(item, row, photoOpts);
}

function mapMenuItemForShop(row, photoOpts = {}) {
  const outOfStock = isOutOfStock(row);
  const compareAt = row.compare_at_price != null ? Number(row.compare_at_price) : null;
  const price = Number(row.price);
  const onSale = compareAt != null && compareAt > price;
  const item = {
    id: row.local_id,
    name: toSqMenuLabel(row.name),
    description: toSqMenuLabel(String(row.description || "").trim()) || String(row.description || "").trim(),
    sku: String(row.sku || "").trim(),
    category: toSqMenuLabel(row.category),
    price,
    compare_at_price: compareAt,
    on_sale: onSale,
    out_of_stock: outOfStock,
    sold_out_label: outOfStock ? "Mbaroi" : null,
  };
  return attachClientPhoto(item, row, photoOpts);
}

function mapMenuItemForKitchen(row, { slug, channel = "waiter" } = {}) {
  return mapMenuItemForWeb(row, { slug, channel });
}

function mapMenuItemForPos(row) {
  const photo = String(row.photo || "").trim();
  const outOfStock = isOutOfStock(row);
  return {
    local_id: row.local_id,
    name: row.name,
    category: String(row.category || "").trim(),
    price: Number(row.price),
    active: row.active !== false,
    has_photo: Boolean(photo),
    photo: photo || null,
    track_stock: Boolean(row.track_stock),
    stock_quantity: row.stock_quantity != null ? Number(row.stock_quantity) : null,
    stock_alert_threshold: Number(row.stock_alert_threshold) || 5,
    out_of_stock: outOfStock,
    sold_out_label: outOfStock ? "Mbaroi" : null,
  };
}

function sortMenuRowsLikePos(rows) {
  /* Match desktop POS (Windows SQLite/NLS): en-like name order — Çaj after Americano, before Cappuccino. */
  return [...(rows || [])].sort((a, b) => {
    const ca = String(a.category || "");
    const cb = String(b.category || "");
    const catCmp = ca.localeCompare(cb, "en");
    if (catCmp !== 0) return catCmp;
    const nameCmp = String(a.name || "").localeCompare(String(b.name || ""), "en");
    if (nameCmp !== 0) return nameCmp;
    return (Number(a.local_id) || 0) - (Number(b.local_id) || 0);
  });
}

async function loadMenuCatalogRows(clientId, { activeOnly = false } = {}) {
  const db = getSupabase();
  let menuQuery = db
    .from("pos_menu_items")
    .select(
      "local_id, name, category, price, active, photo, track_stock, stock_quantity, stock_alert_threshold, description, sku, compare_at_price",
    )
    .eq("client_id", clientId)
    .order("local_id");
  if (activeOnly) menuQuery = menuQuery.eq("active", true);

  const [{ data: settings }, { data: categories }, { data: menu }, { data: staff }, { data: areas }] =
    await Promise.all([
      db.from("pos_settings").select("*").eq("client_id", clientId).maybeSingle(),
      db.from("pos_categories").select("name, sort_order").eq("client_id", clientId).order("sort_order"),
      menuQuery,
      db
        .from("pos_staff")
        .select("name, role, active, source")
        .eq("client_id", clientId)
        .order("name"),
      db
        .from("pos_areas")
        .select("name, table_count, sort_order, active")
        .eq("client_id", clientId)
        .order("sort_order"),
    ]);

  return { settings, categories, menu: sortMenuRowsLikePos(menu), staff, areas };
}

async function getClientMenuCatalog(clientId, { activeOnly = true, kitchenSlug = "", channel = "kiosk" } = {}) {
  const { settings, categories, menu, staff } = await loadMenuCatalogRows(clientId, { activeOnly });
  const mapItem = row =>
    kitchenSlug
      ? mapMenuItemForKitchen(row, { slug: kitchenSlug, channel })
      : mapMenuItemForWeb(row);
  const mappedMenu = (menu || []).filter(row => !activeOnly || isVisibleOnWebMenu(row)).map(mapItem);
  const sqCategories = (categories || []).map((c) => ({
    ...c,
    name: toSqMenuLabel(c.name),
  }));
  return {
    restaurant_name: settings?.restaurant_name || "",
    table_count: Math.min(30, Math.max(1, Number(settings?.table_count) || 10)),
    synced_at: settings?.synced_at || null,
    categories: buildMenuCategories(sqCategories, mappedMenu),
    menu: mappedMenu,
    staff: (staff || []).map(s => s.name),
  };
}

async function getClientShopCatalog(clientId, { activeOnly = true, pageSlug = "" } = {}) {
  const { settings, categories, menu } = await loadMenuCatalogRows(clientId, { activeOnly });
  const mapItem = row => mapMenuItemForShop(row, { slug: pageSlug, channel: "s" });
  const mappedProducts = (menu || []).filter(row => !activeOnly || isVisibleOnWebMenu(row)).map(mapItem);
  const sqCategories = (categories || []).map((c) => ({
    ...c,
    name: toSqMenuLabel(c.name),
  }));
  return {
    shop_name: settings?.restaurant_name || "",
    synced_at: settings?.synced_at || null,
    categories: buildMenuCategories(sqCategories, mappedProducts),
    products: mappedProducts,
  };
}

async function getCatalogForPos(clientId) {
  const { settings, categories, menu, staff, areas } = await loadMenuCatalogRows(clientId, { activeOnly: false });
  return {
    client_id: clientId,
    restaurant_name: settings?.restaurant_name || "",
    address: settings?.address || "",
    phone: settings?.phone || "",
    nui: settings?.nui || "",
    tvsh_nr: settings?.tvsh_nr || "",
    receipt_width_mm: settings?.receipt_width_mm || 80,
    table_count: Math.min(30, Math.max(1, Number(settings?.table_count) || 10)),
    synced_at: settings?.synced_at || null,
    areas: (areas || []).map(a => ({
      name: a.name,
      table_count: Number(a.table_count) || 0,
      sort_order: Number(a.sort_order) || 0,
      active: a.active !== false,
    })),
    categories: (categories || []).map(c => ({
      name: c.name,
      sort_order: Number(c.sort_order) || 0,
    })),
    menu_items: (menu || []).map(mapMenuItemForPos),
    staff: (staff || []).map(s => ({
      name: s.name,
      role: s.role || "waiter",
      active: s.active !== false,
      source: s.source || "owner",
    })),
  };
}

module.exports = {
  buildMenuCategories,
  mapMenuItemForWeb,
  mapMenuItemForShop,
  mapMenuItemForKitchen,
  getClientMenuCatalog,
  getClientShopCatalog,
  getCatalogForPos,
};
