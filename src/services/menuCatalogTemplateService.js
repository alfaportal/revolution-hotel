const { MENU_CATALOG, getCatalogFlatMap, normMenuName } = require("../data/menuCatalogTemplate");
const { fetchImageAsDataUrl } = require("../lib/fetchImageDataUrl");
const { validateImageDataUrl } = require("../lib/imageDataUrl");
const { addMenuItem, listOwnerMenu } = require("./menuService");

async function listCatalogForOwner(clientId) {
  const menu = await listOwnerMenu(clientId);
  const existing = new Set((menu.items || []).map(i => normMenuName(i.name)));

  const categories = MENU_CATALOG.map(cat => ({
    id: cat.id,
    name: cat.name,
    items: cat.items.map(item => ({
      slug: item.slug,
      name: item.name,
      category: item.category,
      defaultPrice: item.defaultPrice,
      photoUrl: item.photoUrl,
      inMenu: existing.has(normMenuName(item.name)),
    })),
  }));

  return {
    categories,
    menuCount: menu.items?.length || 0,
  };
}

async function addItemsFromCatalog(clientId, selections) {
  const list = Array.isArray(selections) ? selections : [];
  if (!list.length) throw new Error("Zgjidhni të paktën një artikull nga katalogu.");

  const flat = getCatalogFlatMap();
  const menu = await listOwnerMenu(clientId);
  const existing = new Set((menu.items || []).map(i => normMenuName(i.name)));

  const added = [];
  const skipped = [];
  const errors = [];

  for (const sel of list) {
    const slug = String(sel.slug || "").trim();
    const template = flat.get(slug);
    if (!template) {
      errors.push({ slug, reason: "Nuk u gjet në katalog" });
      continue;
    }
    if (existing.has(normMenuName(template.name))) {
      skipped.push(template.name);
      continue;
    }

    const price = Math.max(0, Number(sel.price ?? template.defaultPrice) || 0);
    let photo = "";
    if (template.photoUrl) {
      try {
        photo = await fetchImageAsDataUrl(template.photoUrl);
        if (photo) {
          photo = validateImageDataUrl(photo, {
            maxBytes: 512_000,
            maxChars: 700_000,
            label: "Fotoja e artikullit",
          });
        }
      } catch {
        photo = "";
      }
    }

    try {
      const result = await addMenuItem(clientId, {
        name: template.name,
        category: template.category,
        price,
        photo,
      });
      added.push(result.item);
      existing.add(normMenuName(template.name));
    } catch (e) {
      errors.push({ slug, name: template.name, reason: e.message });
    }
  }

  if (!added.length && !skipped.length) {
    throw new Error(errors[0]?.reason || "Asnjë artikull nuk u shtua.");
  }

  const synced_at = added.length ? (await listOwnerMenu(clientId)).synced_at : menu.synced_at;

  return {
    added,
    skipped,
    errors,
    synced_at,
    count: added.length,
  };
}

module.exports = {
  listCatalogForOwner,
  addItemsFromCatalog,
};
