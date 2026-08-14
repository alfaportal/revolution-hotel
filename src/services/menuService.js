const { getSupabase } = require("../db");
const { buildMenuCategories } = require("./menuCatalogService");
const { validateImageDataUrl } = require("../lib/imageDataUrl");
const { normalizeVatCategory } = require("../lib/vatCategories");
const { logOwnerActivity } = require("./ownerAuditService");

const MAX_MENU_PHOTO_BYTES = 512_000;
const MAX_MENU_PHOTO_CHARS = 700_000;

function validateMenuPhotoInput(photo) {
  return validateImageDataUrl(photo, {
    maxBytes: MAX_MENU_PHOTO_BYTES,
    maxChars: MAX_MENU_PHOTO_CHARS,
    label: "Fotoja e artikullit",
  });
}

function mapOwnerMenuItem(row) {
  return {
    id: row.id,
    local_id: row.local_id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    vat_category: normalizeVatCategory(row.vat_category),
    active: row.active !== false,
    barcode: String(row.barcode || "").trim(),
    has_photo: Boolean(String(row.photo || "").trim()),
  };
}

const MENU_ITEM_SELECT = "id, local_id, name, category, price, vat_category, active, barcode, photo";

async function touchMenuSync(clientId) {
  const db = getSupabase();
  const now = new Date().toISOString();
  const { data: existing } = await db
    .from("pos_settings")
    .select("client_id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (existing) {
    await db.from("pos_settings").update({ synced_at: now }).eq("client_id", clientId);
  } else {
    await db.from("pos_settings").insert({
      client_id: clientId,
      table_count: 10,
      receipt_width_mm: 80,
      synced_at: now,
    });
  }
  return now;
}

async function ensureCategory(clientId, categoryName) {
  const name = String(categoryName || "").trim();
  if (!name) throw new Error("Zgjidhni kategorinë.");
  const db = getSupabase();
  const { data: existing } = await db
    .from("pos_categories")
    .select("id")
    .eq("client_id", clientId)
    .eq("name", name)
    .maybeSingle();
  if (existing) return name;

  const { data: last } = await db
    .from("pos_categories")
    .select("sort_order")
    .eq("client_id", clientId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (Number(last?.sort_order) || 0) + 1;
  const { error } = await db.from("pos_categories").insert({
    client_id: clientId,
    name,
    sort_order: sortOrder,
  });
  if (error) throw error;
  return name;
}

/** Rikthen artikujt e shitjes me vat_category të AKTUALIT të menusë (jo atë
 * që dërgoi klienti, i cili s'e mban fare këtë fushë) — pa këtë, çdo shitje
 * do llogaritej me kategorinë e paracaktuar (A/18%), pavarësisht cilësimit
 * real të artikullit. Përputhet me local_id (menu_id), pastaj me emrin. */
async function enrichItemsWithVatCategory(clientId, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return list;
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_menu_items")
    .select("local_id, name, vat_category")
    .eq("client_id", clientId);
  if (error || !data) return list;

  const byLocalId = new Map(data.map(r => [Number(r.local_id), r.vat_category]));
  const byName = new Map(data.map(r => [String(r.name || "").trim().toLowerCase(), r.vat_category]));

  return list.map(it => {
    if (it.vat_category) return it;
    const menuId = Number(it.menu_id ?? it.id ?? it.local_id);
    const cat = (Number.isFinite(menuId) && byLocalId.has(menuId))
      ? byLocalId.get(menuId)
      : byName.get(String(it.name || "").trim().toLowerCase());
    return cat ? { ...it, vat_category: cat } : it;
  });
}

async function nextLocalId(clientId) {
  const db = getSupabase();
  const { data } = await db
    .from("pos_menu_items")
    .select("local_id")
    .eq("client_id", clientId)
    .order("local_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (Number(data?.local_id) || 0) + 1;
}

async function listOwnerMenu(clientId) {
  const db = getSupabase();
  const [{ data: items }, { data: categories }, { data: settings }] = await Promise.all([
    db
      .from("pos_menu_items")
      .select(MENU_ITEM_SELECT)
      .eq("client_id", clientId)
      .order("category")
      .order("name"),
    db
      .from("pos_categories")
      .select("name, sort_order")
      .eq("client_id", clientId)
      .order("sort_order"),
    db.from("pos_settings").select("synced_at").eq("client_id", clientId).maybeSingle(),
  ]);

  const catNames = buildMenuCategories(
    (categories || []).map(c => ({ name: c.name })),
    items || [],
  );

  return {
    items: (items || []).map(mapOwnerMenuItem),
    categories: catNames,
    synced_at: settings?.synced_at || null,
  };
}

async function addMenuItem(clientId, body) {
  const name = String(body.name || "").trim();
  if (!name) throw new Error("Shkruani emrin e artikullit.");
  const category = await ensureCategory(clientId, body.category);
  const price = Math.max(0, Number(body.price) || 0);
  const localId = await nextLocalId(clientId);
  const db = getSupabase();

  const barcode = body.barcode != null ? String(body.barcode).trim() : "";
  const row = {
    client_id: clientId,
    local_id: localId,
    name,
    category,
    price,
    vat_category: normalizeVatCategory(body.vat_category),
    active: true,
    barcode: barcode || null,
  };
  if (Object.prototype.hasOwnProperty.call(body, "photo") && body.photo) {
    row.photo = validateMenuPhotoInput(body.photo);
  }

  const { data, error } = await db
    .from("pos_menu_items")
    .insert(row)
    .select(MENU_ITEM_SELECT)
    .single();
  if (error) throw error;

  const synced_at = await touchMenuSync(clientId);
  return {
    item: mapOwnerMenuItem(data),
    synced_at,
  };
}

async function getKitchenMenuItemPhoto(clientId, localId) {
  const db = getSupabase();
  const idNum = Number(localId);
  if (!idNum) return null;
  const { data, error } = await db
    .from("pos_menu_items")
    .select("photo")
    .eq("client_id", clientId)
    .eq("local_id", idNum)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data?.photo) return null;
  const { stockPhotoFilePayload } = require("../lib/menuStockPhoto");
  const stock = stockPhotoFilePayload(data.photo);
  if (stock) return stock;
  const { imageBufferFromDataUrl, imageMimeFromDataUrl } = require("../lib/imageDataUrl");
  const buffer = imageBufferFromDataUrl(data.photo, MAX_MENU_PHOTO_BYTES);
  const mime = imageMimeFromDataUrl(data.photo, MAX_MENU_PHOTO_BYTES);
  if (!buffer || !mime) return null;
  return { buffer, mime };
}

async function getOwnerMenuItemPhoto(clientId, itemId) {
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_menu_items")
    .select("photo")
    .eq("id", itemId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.photo) return null;
  const { stockPhotoFilePayload } = require("../lib/menuStockPhoto");
  const stock = stockPhotoFilePayload(data.photo);
  if (stock) return stock;
  const { imageBufferFromDataUrl, imageMimeFromDataUrl } = require("../lib/imageDataUrl");
  const buffer = imageBufferFromDataUrl(data.photo, MAX_MENU_PHOTO_BYTES);
  const mime = imageMimeFromDataUrl(data.photo, MAX_MENU_PHOTO_BYTES);
  if (!buffer || !mime) return null;
  return { buffer, mime };
}

async function updateMenuItem(clientId, itemId, body, actorEmail = "") {
  const db = getSupabase();
  const { data: existing, error: findErr } = await db
    .from("pos_menu_items")
    .select("id, name, price")
    .eq("id", itemId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!existing) throw new Error("Artikulli nuk u gjet.");

  const patch = {};
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) throw new Error("Emri nuk mund të jetë bosh.");
    patch.name = name;
  }
  if (body.category != null) {
    patch.category = await ensureCategory(clientId, body.category);
  }
  if (body.price != null) {
    patch.price = Math.max(0, Number(body.price) || 0);
  }
  if (body.vat_category != null) {
    patch.vat_category = normalizeVatCategory(body.vat_category);
  }
  if (body.barcode !== undefined) {
    const bc = body.barcode == null ? "" : String(body.barcode).trim();
    patch.barcode = bc || null;
  }
  if (body.active != null) {
    patch.active = Boolean(body.active);
  }
  if (Object.prototype.hasOwnProperty.call(body, "photo")) {
    if (body.photo === null || body.photo === "") {
      patch.photo = "";
    } else {
      patch.photo = validateMenuPhotoInput(body.photo);
    }
  }
  if (!Object.keys(patch).length) throw new Error("Nuk ka fusha për përditësim.");

  const { data, error } = await db
    .from("pos_menu_items")
    .update(patch)
    .eq("id", itemId)
    .eq("client_id", clientId)
    .select(MENU_ITEM_SELECT)
    .single();
  if (error) throw error;

  if (patch.price != null && Number(existing.price) !== Number(patch.price)) {
    await logOwnerActivity(clientId, {
      actorEmail,
      action: "menu_price_change",
      targetType: "menu_item",
      targetId: itemId,
      targetLabel: existing.name,
      details: { old_price: Number(existing.price), new_price: Number(patch.price) },
    });
  }

  const synced_at = await touchMenuSync(clientId);
  return {
    item: mapOwnerMenuItem(data),
    synced_at,
  };
}

async function deleteMenuItem(clientId, itemId) {
  const db = getSupabase();
  const { error } = await db
    .from("pos_menu_items")
    .delete()
    .eq("id", itemId)
    .eq("client_id", clientId);
  if (error) throw error;
  const synced_at = await touchMenuSync(clientId);
  return { ok: true, synced_at };
}

module.exports = {
  listOwnerMenu,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getOwnerMenuItemPhoto,
  getKitchenMenuItemPhoto,
  touchMenuSync,
  enrichItemsWithVatCategory,
};
