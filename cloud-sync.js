/**
 * Dërgon shitjet te Revolution HOTEL Server (online).
 * Fire-and-forget — nuk bllokon POS-in nëse serveri është offline.
 */
const http = require("http");
const https = require("https");
const cloudHealth = require("./cloud-health");
const {
  PUBLIC_CLOUD_SERVER,
  getPublicCloudServerUrl,
} = require("./cloud-server-url");

const SERVER_URL = PUBLIC_CLOUD_SERVER;

function normalizeKey(k) {
  return String(k || "").trim().toUpperCase().replace(/\s+/g, "");
}

function electronApp() {
  try {
    return require("electron").app;
  } catch {
    return null;
  }
}

/** Hotel: pa cloud hotel — mos auto-mbush çelës / URL. */
function ensureAutoCloudConfig(_db) {
  return;
}

function getConfig(db) {
  const license = require("./license");
  const VERSION = require("./version-config");

  return {
    serverUrl: "",
    publicServerUrl: getPublicCloudServerUrl(),
    celesi: "",
    deviceId: license.getMachineId(),
    appType: VERSION.appType || "hotel",
  };
}

function requestJson(method, _baseUrl, path, payload, options = {}) {
  return cloudHealth.requestJsonWithFallback(method, path, payload, options);
}

function normalizeItems(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map(it => ({
      name: String(it.name || it.emri || "").trim(),
      quantity: Number(it.quantity ?? it.sasia ?? 1) || 1,
      price: Number(it.price ?? it.cmimi ?? 0) || 0,
    }))
    .filter(it => it.name);
}

function resolveTableNumber(db, order, table_number) {
  if (table_number != null && table_number !== "") return Number(table_number) || 0;
  if (order?.table_number != null) return Number(order.table_number) || 0;
  if (order?.table_id) {
    try {
      const row = db.db.prepare("SELECT number FROM tables WHERE id = ?").get(order.table_id);
      return row?.number || 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

function resolveClosedAt(order, closed_at) {
  if (closed_at) return closed_at;
  if (order?.closed_at) return order.closed_at;
  if (order?.printed_at) return order.printed_at;
  return new Date().toISOString();
}

function parseCloudJson(data) {
  try {
    return JSON.parse(data || "{}");
  } catch {
    return {};
  }
}

function extractCloudCredentials(parsed) {
  return {
    client_id: parsed.client_id || "",
    client_name: parsed.client_name || "",
    kitchen_slug: parsed.kitchen_slug || "",
    kitchen_key: parsed.kitchen_key || "",
    waiter_url: parsed.waiter_url || "",
    kitchen_url: parsed.kitchen_url || "",
    bar_url: parsed.bar_url || "",
    kiosk_url: parsed.kiosk_url || "",
    public_page_url: parsed.public_page_url || "",
    package_tier: parsed.package_tier || "",
  };
}

function readCachedKitchenAccess(db) {
  const cached = db.getCloudSettings();
  const kitchen_slug = String(cached.kitchen_slug || "").trim();
  const kitchen_key = String(cached.kitchen_key || "").trim();
  return {
    client_id: cached.cloud_client_id || "",
    client_name: cached.cloud_client_name || "",
    kitchen_slug,
    kitchen_key,
    has_access: !!(kitchen_slug && kitchen_key),
  };
}

function operationalCloudStatus(db, health, cfg, message) {
  const cached = readCachedKitchenAccess(db);
  if (!health.online || !cfg.celesi || !cached.has_access) return null;
  return {
    ok: true,
    connected: true,
    operational: true,
    links_stale: true,
    message: message || "Cloud aktiv — porositë QR dhe sync funksionojnë.",
    client_id: cached.client_id,
    client_name: cached.client_name,
    kitchen_slug: cached.kitchen_slug,
    kitchen_key: cached.kitchen_key,
  };
}

async function checkConnection(_db) {
  /* Hotel: pa cloud — mos thirr rrjetin. */
  return {
    connected: false,
    offline: true,
    message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
    kitchen_slug: "",
    links_ready: false,
  };
}

/** Porosi e importuar nga cloud (telefon/QR) — mos krijo rresht të ri me device_id të POS-it. */
function orderMirrorsRemoteCloud(order) {
  return !!(order?.cloud_order_id && String(order.cloud_order_id).trim());
}

function applyFiscalCloseFields(payload, opts = {}) {
  if (opts.fiscal_skip === true || opts.fiscalSkip === true) {
    payload.fiscal_skip = true;
  }
  const raw = opts.coupon_type ?? opts.couponType;
  if (raw != null && String(raw).trim() !== "") {
    payload.coupon_type = String(raw).trim().toLowerCase();
  }
  return payload;
}

function buildSalePayload(db, order, opts = {}) {
  const cfg = getConfig(db);
  if (!cfg.celesi || !order) return null;

  const {
    table_number = 0,
    receipt_number = "",
    closed_at = "",
    status = "closed",
    ordered_at = "",
    payment_method = "",
  } = opts;

  const rawItems = (() => {
    try {
      return JSON.parse(order.items_json || "[]");
    } catch {
      return [];
    }
  })();
  const items = normalizeItems(rawItems);
  const tbl = resolveTableNumber(db, order, table_number);
  const saleStatus = status || "closed";
  const now = new Date().toISOString();
  const orderedAt =
    ordered_at ||
    order.created_at ||
    (saleStatus === "ordered" ? now : "");
  const closedAt = saleStatus === "closed" ? resolveClosedAt(order, closed_at) : "";

  const payload = {
    celesi: cfg.celesi,
    device_id: cfg.deviceId,
    local_order_id: String(order.id),
    table_number: tbl,
    waiter_name: String(order.waiter_name || "").trim(),
    items,
    total: Number(order.total) || 0,
    receipt_number: receipt_number || "",
    status: saleStatus,
    payment_method: db.normalizePaymentMethod(order.payment_method || payment_method),
  };
  if (orderedAt) payload.ordered_at = orderedAt;
  if (closedAt) payload.closed_at = closedAt;
  if (saleStatus === "closed") applyFiscalCloseFields(payload, opts);

  return { cfg, payload };
}

function pushSale(db, order, opts = {}) {
  if (orderMirrorsRemoteCloud(order)) return;
  const built = buildSalePayload(db, order, opts);
  if (!built) return;

  requestJson("POST", built.cfg.serverUrl, "/api/v1/sales/sync", built.payload)
    .then(r => {
      if (r.status >= 400) {
        console.warn("Cloud sync:", r.status, r.data?.slice?.(0, 120));
      } else {
        console.log("Cloud sync OK:", built.payload.local_order_id);
      }
    })
    .catch(err => {
      console.warn("Cloud sync dështoi:", err.message);
    });
}

/** Porosi aktive — update menjëherë për tavolinat live të pronarit */
function pushActiveOrderUpdate(db, order, { table_number = 0, ordered_at = "" } = {}) {
  if (orderMirrorsRemoteCloud(order)) return;
  const built = buildSalePayload(db, order, {
    table_number,
    status: "ordered",
    ordered_at: ordered_at || order.created_at || new Date().toISOString(),
  });
  if (!built) return;

  requestJson("POST", built.cfg.serverUrl, "/api/v1/sales/update", built.payload)
    .then(r => {
      if (r.status >= 400) {
        console.warn("Cloud update:", r.status, r.data?.slice?.(0, 120));
      } else {
        console.log("Cloud update OK: T", built.payload.table_number);
      }
    })
    .catch(err => {
      console.warn("Cloud update dështoi:", err.message);
    });
}

/** Sinkronizon tavolinat me cloud: dërgon të zënat + liron të lirat (pa prekur QR në pritje lokale). */
const LOCAL_ACK_KEY = "online_orders_local_ack_ids";

function loadLocalAckIds(db) {
  try {
    return new Set(JSON.parse(db.getSetting(LOCAL_ACK_KEY, "[]")));
  } catch {
    return new Set();
  }
}

function parseTableNumFromPendingOrder(o) {
  const direct = Number(o?.table_number) || 0;
  if (direct > 0) return direct;
  const hay = `${o?.customer_label || ""} ${o?.source_label || ""} ${o?.waiter_name || ""}`;
  const m = hay.match(/\bT\s*(\d+)\b/i);
  return m ? Number(m[1]) || 0 : 0;
}

function getProtectedPendingTableNumbers(db) {
  const acked = loadLocalAckIds(db);
  const nums = new Set();
  for (const o of db.listPendingCloudOrders?.() || []) {
    const id = String(o?.id || "").trim();
    if (!id || acked.has(id)) continue;
    if (typeof db.isCloudOrderHandledLocally === "function" && db.isCloudOrderHandledLocally(id)) {
      continue;
    }
    if (typeof db.isCloudQrTableOrder === "function" && !db.isCloudQrTableOrder(o)) continue;
    const n = typeof db.parseQrTableNumberFromCloudOrder === "function"
      ? db.parseQrTableNumberFromCloudOrder(o)
      : parseTableNumFromPendingOrder(o);
    if (n > 0) nums.add(n);
  }
  return nums;
}

function reconcileAllTablesWithCloud(db) {
  if (!isCloudConfigured(db)) return;
  try {
    const tables = db.getTablesWithOrders();
    const protectedNums = getProtectedPendingTableNumbers(db);
    for (const t of tables) {
      const num = Number(t.number);
      if (!num) continue;
      if (t.order) {
        if (!orderMirrorsRemoteCloud(t.order)) {
          pushActiveOrderUpdate(db, t.order, {
            table_number: num,
            ordered_at: t.order.created_at,
          });
        }
        continue;
      }
      if (protectedNums.has(num)) continue;
      // Mos dërgo table-free automatikisht — fshinte porositë e kamarierit (telefon) dhe QR në cloud
    }
  } catch (err) {
    console.warn("Cloud table reconcile:", err.message);
  }
}

function pushTableFree(db, tableNumber) {
  const cfg = getConfig(db);
  const num = Number(tableNumber);
  if (!cfg.celesi || !num) return;

  requestJson("POST", cfg.serverUrl, "/api/v1/sales/table-free", {
    celesi: cfg.celesi,
    device_id: cfg.deviceId,
    table_number: num,
  })
    .then(r => {
      if (r.status >= 400) {
        console.warn("Cloud table-free:", r.status, r.data?.slice?.(0, 120));
      }
    })
    .catch(err => {
      console.warn("Cloud table-free dështoi:", err.message);
    });
}

/** @deprecated — përdor reconcileAllTablesWithCloud */
function pushAllActiveTables(db) {
  reconcileAllTablesWithCloud(db);
}

function pushTableCancelled(db, tableId) {
  const order = db.getActiveOrderForTable(tableId);
  if (!order || orderMirrorsRemoteCloud(order)) return;
  const tables = db.getTablesWithOrders();
  const t = tables.find(x => x.id === Number(tableId));
  const built = buildSalePayload(db, order, {
    table_number: t?.number || 0,
    status: "cancelled",
    ordered_at: order.created_at,
  });
  if (!built) return;

  requestJson("POST", built.cfg.serverUrl, "/api/v1/sales/update", {
    ...built.payload,
    status: "cancelled",
    items: [],
    total: 0,
  })
    .then(r => {
      if (r.status >= 400) console.warn("Cloud cancel:", r.status, r.data?.slice?.(0, 120));
    })
    .catch(err => console.warn("Cloud cancel dështoi:", err.message));
}

/** Hotel: zero cloud derisa të ketë serverin e vet. */
function isCloudConfigured(_db) {
  return false;
}

function getBarScreenUrl(db) {
  const cached = db.getCloudSettings();
  const slug = cached.kitchen_slug || cached.cloud_client_id || "";
  const key = cached.kitchen_key || "";
  const { buildAccessLink } = require("./cloud-server-url");
  return buildAccessLink(getPublicCloudServerUrl(), slug, key, "bar");
}

function buildCatalogPayload(db) {
  const cfg = getConfig(db);
  const settings = db.getSettings();
  const categories = db.getCategories().map((c, i) => ({
    name: c.name,
    sort_order: c.sort_order ?? i,
  }));
  const menu_items = db.getMenuItems(false, { includePhoto: true }).map(m => {
    const threshold = Number(m.low_stock_threshold) || 0;
    return {
      local_id: m.id,
      name: m.name,
      category: m.category,
      price: m.price,
      active: !!m.active,
      photo: String(m.photo || "").trim(),
      description: String(m.description || "").trim().slice(0, 2000),
      // "Tracked" lidhet me të njëjtin prag që përdor edhe paneli i kamarierit
      // (menu-pos.js) — nëse pronari s'ka vendosur prag, stoku s'gjurmohet.
      track_stock: threshold > 0,
      stock_quantity: Number(m.stock_qty) || 0,
      stock_alert_threshold: threshold,
    };
  });
  const staff = db.getStaff().map(s => ({
    name: s.name,
    active: !!s.active,
    pin: String(s.pin || "").trim(),
  }));

  return {
    cfg,
    payload: {
      celesi: cfg.celesi,
      device_id: cfg.deviceId,
      restaurant_name: settings.restaurant_name || "",
      // Vetëm tavolina fizike — sllotet «Porosi online» nuk duhet të fryjnë numrin në telefon.
      table_count:
        typeof db.getPhysicalTableCount === "function"
          ? db.getPhysicalTableCount()
          : settings.table_count || 10,
      categories,
      menu_items,
      staff,
    },
  };
}

/**
 * Sjell në SQLite lokale kategoritë/artikujt që ekzistojnë në cloud (pos_categories/
 * pos_menu_items) por jo lokalisht — p.sh. u shtuan direkt në cloud, jo nga paneli lokal.
 * Përputhja bëhet me emër (jo local_id, sepse rreshtat e shtuar direkt në cloud nuk kanë
 * local_id real). Duhet të vrapojë PARA pushCatalogAsync, sepse push-i bën DELETE+INSERT të
 * plotë të pos_categories/pos_menu_items në cloud — pa këtë hap, artikujt e shtuar direkt në
 * cloud do të fshiheshin nga push-i i radhës.
 */
async function pullNewCatalogItemsFromCloud(db) {
  try {
    if (!isCloudConfigured(db)) return { categories: 0, items: 0 };
    const cfg = getConfig(db);
    const path = `/api/v1/pos/catalog?celesi=${encodeURIComponent(cfg.celesi)}`;
    const r = await requestJson("GET", cfg.serverUrl, path);
    if (r.status >= 400) return { categories: 0, items: 0 };
    let parsed = {};
    try {
      parsed = JSON.parse(r.data || "{}");
    } catch {
      return { categories: 0, items: 0 };
    }

    let i18n;
    try {
      i18n = require("./i18n");
    } catch {
      i18n = { isFrench: () => false };
    }
    const sqLocale = !i18n.isFrench();

    /** fr → sq (për të mos importuar dyfishime frënge te POS shqip) */
    const frToSq = new Map();
    const frNameSet = new Set();
    if (sqLocale) {
      try {
        const frMap = require("./locales/fr-map");
        for (const [sq, fr] of Object.entries(frMap || {})) {
          const fk = String(fr || "").trim().toLowerCase();
          if (!fk) continue;
          frNameSet.add(fk);
          if (!frToSq.has(fk)) frToSq.set(fk, String(sq).trim());
        }
      } catch {
        /* ignore */
      }
    }

    function looksFrenchMenuName(name) {
      const n = String(name || "");
      if (/[àâäéèêëïîôùûüçœæ]/i.test(n)) return true;
      return /\b(café|thé|chocolat|bière|salade|jus|pression|glace|frites|soupe|pâtes|croissant|omelette|fromage|poulet|végétarien|classique|allongé|américain|menthe|camomille|noir|burger|sandwich|toast)\b/i.test(
        n,
      );
    }

    const localCategoryNames = new Set(
      db.getCategories().map(c => String(c.name || "").trim().toLowerCase()),
    );
    let categoriesAdded = 0;
    for (const c of parsed.categories || []) {
      const name = String(c.name || "").trim();
      if (!name || localCategoryNames.has(name.toLowerCase())) continue;
      // KS/AL: mos shto kategori frënge nga cloud
      if (sqLocale && (frNameSet.has(name.toLowerCase()) || looksFrenchMenuName(name))) continue;
      db.addCategory(name);
      localCategoryNames.add(name.toLowerCase());
      categoriesAdded++;
    }

    const itemKey = (name, category) =>
      `${String(name || "").trim().toLowerCase()}|${String(category || "").trim().toLowerCase()}`;
    const localItemKeys = new Set(db.getMenuItems(false).map(m => itemKey(m.name, m.category)));
    // edhe vetëm emri (pa kategori) — për të kapur FR/SQ të njëjtit produkt
    const localNamesOnly = new Set(
      db.getMenuItems(false).map(m => String(m.name || "").trim().toLowerCase()).filter(Boolean),
    );
    let itemsAdded = 0;
    let itemsSkippedFr = 0;
    for (const m of parsed.menu_items || []) {
      let name = String(m.name || "").trim();
      const category = String(m.category || "").trim();
      if (!name || !category) continue;

      if (sqLocale) {
        const frKey = name.toLowerCase();
        const sqName = frToSq.get(frKey);
        if (sqName) {
          // ekziston tashmë shqip → mos shto versionin FR
          if (localNamesOnly.has(sqName.toLowerCase()) || localItemKeys.has(itemKey(sqName, category))) {
            itemsSkippedFr++;
            continue;
          }
          // mos importo emrin FR — nëse mungon, shto vetëm shqip
          name = sqName;
        } else if (frNameSet.has(frKey) || looksFrenchMenuName(name)) {
          itemsSkippedFr++;
          continue;
        }
      }

      const key = itemKey(name, category);
      if (localItemKeys.has(key) || localNamesOnly.has(name.toLowerCase())) continue;
      if (!localCategoryNames.has(category.toLowerCase())) {
        if (sqLocale && (frNameSet.has(category.toLowerCase()) || looksFrenchMenuName(category))) {
          itemsSkippedFr++;
          continue;
        }
        db.addCategory(category);
        localCategoryNames.add(category.toLowerCase());
      }
      const id = db.addMenuItem({ name, category, price: Number(m.price) || 0, vat_category: "18" });
      if (m.active === false) db.toggleMenuItemActive(id, false);
      const photo = String(m.photo || "").trim();
      if (photo) db.setMenuItemPhoto(id, photo);
      localItemKeys.add(key);
      localNamesOnly.add(name.toLowerCase());
      itemsAdded++;
    }

    if (categoriesAdded || itemsAdded || itemsSkippedFr) {
      console.log(
        `Katalog nga cloud: +${categoriesAdded} kategori, +${itemsAdded} artikuj` +
          (itemsSkippedFr ? `, u anashkaluan ${itemsSkippedFr} FR (locale shqip)` : "") +
          ".",
      );
    }
    return { categories: categoriesAdded, items: itemsAdded };
  } catch (err) {
    console.warn("Pull new catalog items:", err.message);
    return { categories: 0, items: 0 };
  }
}

async function pushCatalogAsync(db) {
  if (!isCloudConfigured(db)) {
    return { ok: false, message: "Cloud nuk është konfiguruar." };
  }
  try {
    await pullNewCatalogItemsFromCloud(db);
    const { cfg, payload } = buildCatalogPayload(db);
    const localCount = payload.menu_items?.length || 0;
    if (!localCount) {
      return { ok: false, message: "Menuja lokale është bosh — shtoni artikuj te Menuja." };
    }
    const r = await requestJson(
      "POST",
      cfg.serverUrl,
      "/api/v1/pos/catalog/sync",
      payload,
      { timeoutMs: 45000 },
    );
    let parsed = {};
    try { parsed = JSON.parse(r.data || "{}"); } catch { /* */ }
    if (r.status >= 400) {
      const msg = parsed.gabim || parsed.message || `HTTP ${r.status}`;
      console.warn("Catalog sync:", msg);
      return { ok: false, message: msg, menu_items: 0, categories: 0 };
    }
    const menuItems = Number(parsed.menu_items) || localCount;
    const categories = Number(parsed.categories) || (payload.categories?.length || 0);
    const staffSynced = Number(parsed.staff) || 0;
    const localStaffWithPin = (payload.staff || []).filter(s => /^\d{4}$/.test(String(s.pin || ""))).length;
    console.log(`Catalog sync OK — ${menuItems} artikuj, ${categories} kategori, ${staffSynced} kamarierë cloud`);
    if (localStaffWithPin && !staffSynced) {
      console.warn("[cloud] Kujdes: kamarierët me PIN nuk u sinkronizuan te cloud — pranimi i porosive QR dështon.");
    }
    return {
      ok: true,
      menu_items: menuItems,
      categories,
      staff: staffSynced,
      staff_local_with_pin: localStaffWithPin,
      message: staffSynced
        ? `${menuItems} artikuj, ${staffSynced} kamarierë në cloud.`
        : `${menuItems} artikuj u dërguan te cloud.${localStaffWithPin ? " Sinkronizoni kamarierët (Admin → Cloud)." : ""}`,
    };
  } catch (err) {
    console.warn("Catalog sync dështoi:", err.message);
    return { ok: false, message: err.message, menu_items: 0, categories: 0 };
  }
}

function pushCatalog(db) {
  pushCatalogAsync(db).catch(() => {});
}

async function pullMenuPhotosFromCloud(db) {
  try {
    if (!isCloudConfigured(db)) return { updated: 0 };
    const cfg = getConfig(db);
    const path = `/api/v1/pos/catalog?celesi=${encodeURIComponent(cfg.celesi)}`;
    const r = await requestJson("GET", cfg.serverUrl, path);
    if (r.status >= 400) return { updated: 0 };
    let parsed = {};
    try {
      parsed = JSON.parse(r.data || "{}");
    } catch {
      return { updated: 0 };
    }
    const remote = parsed.menu_items || [];
    const localById = new Map(db.getMenuItems(false).map(m => [m.id, m]));
    let updated = 0;
    for (const m of remote) {
      const id = Number(m.local_id);
      const photo = String(m.photo || "").trim();
      if (!id || !photo) continue;
      const local = localById.get(id);
      if (!local) continue;
      const localPhoto = String(local.photo || "").trim();
      if (localPhoto === photo) continue;
      // Mos prish foto lokale custom — merre cloud vetëm nëse lokale mungon,
      // ose lokale është stock dhe cloud është foto reale (data/https).
      if (localPhoto) {
        const localIsStock = localPhoto.startsWith("/menu-stock/");
        const cloudIsCustom = photo.startsWith("data:") || /^https?:\/\//i.test(photo);
        if (!(localIsStock && cloudIsCustom)) continue;
      }
      db.setMenuItemPhoto(id, photo);
      updated++;
    }
    if (updated) console.log(`Menu photos pulled: ${updated}`);
    return { updated };
  } catch (err) {
    console.warn("Menu photo pull:", err.message);
    return { updated: 0 };
  }
}

function syncCatalogToCloud(db) {
  try {
    if (!isCloudConfigured(db)) return;
    pushCatalog(db);
    pullMenuPhotosFromCloud(db).catch(() => {});
  } catch (err) {
    console.warn("Catalog sync:", err.message);
  }
}

/**
 * Sinkronizim i plotë: lidhja → slug/linket → menu/staff/tavolina → foto → gjendja tavolinave.
 * Përdoret në nisje, ruajtje cloud dhe butonin «Sinkronizo gjithçka».
 */
async function fullCloudSync(_db) {
  return {
    ok: false,
    connected: false,
    catalog_ok: false,
    message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
    kitchen_slug: "",
  };
}

/** Vendos emrin e biznesit nga licenca (Super Admin) vetëm nëse lokalisht është bosh. */
async function syncRestaurantIdentityFromCloud(db) {
  try {
    if ((db.getSettings().restaurant_name || "").trim()) {
      return { applied: false };
    }
    const status = await checkConnection(db);
    const name = (status.client_name || "").trim();
    if (!status.connected || !name) {
      return { applied: false, client_name: name || "" };
    }
    const applied = db.applyRestaurantNameIfEmpty(name);
    if (applied) console.log("Emri i biznesit nga licenca:", name);
    return { applied, client_name: name };
  } catch (err) {
    console.warn("Identity sync:", err.message);
    return { applied: false };
  }
}

function isCloudOrderAccepted(o) {
  if (!o) return false;
  if (o.accepted_at) return true;
  if (String(o.accepted_by_waiter_name || "").trim()) return true;
  const handler = String(o.accepted_by || "").trim();
  const customer = String(o.customer_label || "").trim();
  if (handler && handler !== customer) return true;
  return false;
}

function isLoginPendingCloudOrder(db, o) {
  if (!o?.id) return false;
  if (isCloudOrderAccepted(o)) return false;
  if (typeof db?.isCloudStaffWaiterOrder === "function" && db.isCloudStaffWaiterOrder(o)) return false;
  if (typeof db?.isCloudPosAcceptQueueOrder === "function" && db.isCloudPosAcceptQueueOrder(o)) return true;
  if (typeof db?.isCloudOnlinePickupOrder === "function" && db.isCloudOnlinePickupOrder(o)) return true;
  const device = String(o?.device_id || "").trim().toUpperCase();
  return device === "WEB-PUBLIC";
}

function isPosWaiterNotifyOrder(db, o) {
  if (!isLoginPendingCloudOrder(db, o)) return false;
  if (typeof db?.isCloudOrderHandledLocally === "function" && db.isCloudOrderHandledLocally(o.id)) return false;
  return true;
}

function isBarOnlyNotifyOrder(db, o) {
  if (!o?.id) return false;
  if (isCloudOrderAccepted(o)) return false;
  if (typeof db?.isCloudStaffWaiterOrder === "function" && db.isCloudStaffWaiterOrder(o)) return false;
  if (isPosWaiterNotifyOrder(db, o)) return false;
  if (typeof db?.isCloudOnlinePickupOrder === "function" && db.isCloudOnlinePickupOrder(o)) return true;
  const device = String(o?.device_id || "").trim().toUpperCase();
  return device === "WEB-PUBLIC";
}

function filterLoginNotifyOrders(db, payload) {
  if (!payload) return payload;
  const rawPending = Array.isArray(payload.orders) && payload.orders.length
    ? payload.orders
    : (payload.all_orders || []).filter(o => !isCloudOrderAccepted(o));
  const orders = rawPending.filter(o => isLoginPendingCloudOrder(db, o));
  const barOrders = rawPending.filter(o => isBarOnlyNotifyOrder(db, o));
  const total = orders.length + barOrders.length;
  return {
    ...payload,
    orders,
    pending: orders.length,
    has_pending: total > 0,
    has_new: !!payload.has_new || total > 0,
    bar_pending: barOrders.length,
    bar_orders: barOrders,
  };
}

function buildLoginNotifyFromOrders(db, orders, snapMeta = {}) {
  const pool = (orders || []).filter(o => !isCloudOrderAccepted(o));
  const filtered = pool.filter(o => isLoginPendingCloudOrder(db, o));
  const barOrders = pool.filter(o => isBarOnlyNotifyOrder(db, o));
  const totalPending = filtered.length + barOrders.length;
  return {
    ok: snapMeta.ok !== false,
    connected: !!snapMeta.connected,
    pending: filtered.length,
    has_pending: totalPending > 0,
    has_new: !!snapMeta.has_new || totalPending > 0,
    orders: filtered,
    bar_pending: barOrders.length,
    bar_orders: barOrders,
    message: snapMeta.message || "",
  };
}

async function fetchLoginOrderNotify(db) {
  return filterLoginNotifyOrders(db, await fetchOnlineOrders(db));
}

function filterPosAcceptOrders(db, payload) {
  if (!payload || typeof db?.isCloudPosAcceptQueueOrder !== "function") return payload;
  const orders = (payload.orders || []).filter(o => db.isCloudPosAcceptQueueOrder(o));
  return {
    ...payload,
    orders,
    pending: orders.length,
    has_pending: orders.length > 0,
  };
}

async function fetchOnlineOrdersViaKitchen(db) {
  const cfg = getConfig(db);
  const { slug, key } = getKitchenAccess(db);
  if (!cfg.serverUrl || !slug || !key) return null;

  try {
    const q = `?key=${encodeURIComponent(key)}`;
    const res = await requestJson(
      "GET",
      cfg.serverUrl,
      `/api/waiter/${encodeURIComponent(slug)}/online-orders/pending${q}`,
      null,
      { timeoutMs: 12000 },
    );
    const parsed = parseCloudJson(res.data);
    if (res.status < 400 && parsed.ok !== false) {
      const orders = Array.isArray(parsed.orders) ? parsed.orders : [];
      return {
        ok: true,
        connected: true,
        pending: Number(parsed.pending) || orders.length,
        has_pending: !!parsed.has_pending || orders.length > 0,
        orders,
        all_orders: orders,
        via_kitchen: true,
      };
    }
  } catch {
    /* provo licencën */
  }
  return null;
}

async function fetchOnlineOrders(_db) {
  // Hotel cloud sync is local-only; never hit the network for online orders.
  return {
    ok: true,
    connected: false,
    pending: 0,
    has_pending: false,
    orders: [],
    all_orders: [],
    message: "Cloud i hotelit nuk është konfiguruar — punon vetëm SQLite lokal.",
  };
}

async function pushStaffAsync(db) {
  if (!isCloudConfigured(db)) {
    return { ok: false, message: "Cloud nuk është konfiguruar." };
  }
  const { cfg, payload } = buildCatalogPayload(db);
  const localWithPin = (payload.staff || []).filter(s => /^\d{4}$/.test(String(s.pin || ""))).length;
  if (!localWithPin) {
    return { ok: false, skipped: true, message: "Nuk ka kamarierë me PIN lokalisht." };
  }
  try {
    const r = await requestJson(
      "POST",
      cfg.serverUrl,
      "/api/v1/pos/staff/sync",
      {
        celesi: cfg.celesi,
        device_id: cfg.deviceId,
        staff: payload.staff,
      },
      { timeoutMs: 15000 },
    );
    let parsed = {};
    try { parsed = JSON.parse(r.data || "{}"); } catch { /* */ }
    if (r.status >= 400) {
      return { ok: false, message: parsed.gabim || parsed.message || `HTTP ${r.status}` };
    }
    const staffSynced = Number(parsed.staff) || 0;
    if (localWithPin && !staffSynced) {
      console.warn("[cloud] PIN-et e kamarierëve nuk u dërguan te cloud.");
    } else if (staffSynced) {
      console.log(`[cloud] ${staffSynced} kamarier(ë) me PIN u sinkronizuan.`);
    }
    return { ok: staffSynced > 0, staff: staffSynced, staff_local_with_pin: localWithPin };
  } catch (err) {
    return { ok: false, message: err.message || "Staff sync dështoi." };
  }
}

async function fetchPendingOnlineCount(db) {
  const data = await fetchOnlineOrders(db);
  return {
    pending: data.pending || 0,
    has_pending: !!data.has_pending,
    connected: !!data.connected,
  };
}

function getKitchenAccess(db) {
  if (!db) return { slug: "", key: "" };
  return {
    slug: String(db.getSetting("kitchen_slug", "") || "").trim(),
    key: String(db.getSetting("kitchen_key", "") || "").trim(),
  };
}

/** Lexon modalitetin e arkës të vendosur nga pronari te paneli i tij (telefon) — vetëm LEXIM. */
async function fetchRegisterModeFromCloud(db) {
  const cfg = getConfig(db);
  const { slug, key } = getKitchenAccess(db);
  if (!cfg.serverUrl || !slug || !key) return null;

  try {
    const res = await requestJson(
      "GET",
      cfg.serverUrl,
      `/api/kds/${encodeURIComponent(slug)}/register-mode?key=${encodeURIComponent(key)}`,
      null,
      { timeoutMs: 10000 },
    );
    const parsed = parseCloudJson(res.data);
    if (res.status < 400 && parsed.ok !== false) {
      return {
        mode: parsed.mode,
        updated_at: parsed.updated_at || null,
        updated_by: parsed.updated_by || "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function acknowledgeOnlineOrdersViaKds(db, orderIds, pin = "") {
  const cfg = getConfig(db);
  const { slug, key } = getKitchenAccess(db);
  const ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!cfg.serverUrl || !slug || !key || !ids.length) {
    return { ok: false, acknowledged: 0, order_ids: [], message: "Mungon kitchen slug/key." };
  }

  const acked = [];
  let lastAcceptedBy = "";
  for (const orderId of ids) {
    try {
      const q = `?key=${encodeURIComponent(key)}`;
      const res = await requestJson(
        "POST",
        cfg.serverUrl,
        `/api/kds/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}/accept${q}`,
        { pin: String(pin || "").trim() },
      );
      const parsed = parseCloudJson(res.data);
      if (res.status < 400 && parsed.ok) {
        acked.push(orderId);
        if (parsed.accepted_by) lastAcceptedBy = parsed.accepted_by;
      }
    } catch {
      /* provo porosinë tjetër */
    }
  }

  return {
    ok: acked.length > 0,
    connected: true,
    acknowledged: acked.length,
    order_ids: acked,
    accepted_by: lastAcceptedBy,
    message: acked.length ? "" : "Banaku nuk pranoi porositë.",
  };
}

async function refuseOnlineOrder(db, orderId, pin = "", reason = "") {
  const cfg = getConfig(db);
  if (!cfg.celesi || !cfg.serverUrl) {
    return { ok: false, connected: false, refused: 0, message: "Pa lidhje cloud." };
  }

  const id = String(orderId || "").trim();
  if (!id) {
    return { ok: false, connected: true, refused: 0, message: "Mungon porosia." };
  }

  const pinTrim = String(pin || "").trim();
  if (!pinTrim) {
    return { ok: false, connected: true, refused: 0, message: "Mungon PIN-i i kamarierit." };
  }

  try {
    const res = await requestJson("POST", cfg.serverUrl, "/api/v1/license/online-orders/refuse", {
      celesi: cfg.celesi,
      device_id: cfg.deviceId,
      order_id: id,
      pin: pinTrim,
      reason: String(reason || "").trim(),
    });
    const parsed = parseCloudJson(res.data);
    if (res.status < 400 && parsed.ok && (Number(parsed.refused) || parsed.refuse_mode === "grace_v2")) {
      return {
        ok: true,
        connected: true,
        refused: Number(parsed.refused) || 1,
        order_id: parsed.order_id || id,
        order: parsed.order || null,
        refuse_mode: parsed.refuse_mode || "grace_v2",
        grace_minutes: Number(parsed.grace_minutes) || 2,
        refused_by: parsed.refused_by || "",
        refuse_reason: parsed.refuse_reason || String(reason || "").trim(),
      };
    }
    return {
      ok: false,
      connected: true,
      refused: 0,
      message: parsed.gabim || parsed.message || "Nuk u refuzua porosia në cloud.",
    };
  } catch (err) {
    return {
      ok: false,
      connected: false,
      refused: 0,
      message: err.message || "Pa internet.",
    };
  }
}

/** Lista e porosive të refuzuara (cloud) — paneli i pronarit. */
async function listRefusedOrders(db, { from, to, limit = 100 } = {}) {
  const cfg = getConfig(db);
  if (!cfg.celesi || !cfg.serverUrl) {
    return { ok: false, connected: false, orders: [], stats: { today: 0, week: 0, month: 0 }, message: "Pa lidhje cloud." };
  }
  try {
    const res = await requestJson("POST", cfg.serverUrl, "/api/v1/license/refused-orders", {
      celesi: cfg.celesi,
      device_id: cfg.deviceId,
      from: from || undefined,
      to: to || undefined,
      limit,
    });
    const parsed = parseCloudJson(res.data);
    if (res.status < 400 && parsed && (parsed.ok || Array.isArray(parsed.orders))) {
      return {
        ok: true,
        connected: true,
        from: parsed.from,
        to: parsed.to,
        orders: parsed.orders || [],
        stats: parsed.stats || { today: 0, week: 0, month: 0 },
      };
    }
    return {
      ok: false,
      connected: true,
      orders: [],
      stats: { today: 0, week: 0, month: 0 },
      message: parsed.gabim || parsed.message || "Nuk u lexuan refuzimet.",
    };
  } catch (err) {
    return {
      ok: false,
      connected: false,
      orders: [],
      stats: { today: 0, week: 0, month: 0 },
      message: err.message || "Pa internet.",
    };
  }
}

async function cancelOnlineOrders(db, orderIds) {
  const cfg = getConfig(db);
  if (!cfg.celesi || !cfg.serverUrl) {
    return { ok: false, connected: false, cancelled: 0, message: "Pa lidhje cloud." };
  }

  const ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) {
    return { ok: true, connected: true, cancelled: 0, order_ids: [] };
  }

  try {
    const res = await requestJson("POST", cfg.serverUrl, "/api/v1/license/online-orders/cancel", {
      celesi: cfg.celesi,
      device_id: cfg.deviceId,
      order_ids: ids,
    });
    const parsed = parseCloudJson(res.data);
    if (!parsed.ok && res.status < 400) {
      // noop — parsed below
    }
    if (res.status < 400 && parsed.ok && (Number(parsed.cancelled) || 0) > 0) {
      return {
        ok: true,
        connected: true,
        cancelled: Number(parsed.cancelled) || ids.length,
        order_ids: parsed.order_ids || ids,
      };
    }
    return {
      ok: false,
      connected: true,
      cancelled: 0,
      message: parsed.gabim || parsed.message || "Nuk u anulua porosia në cloud.",
    };
  } catch (err) {
    return {
      ok: false,
      connected: false,
      cancelled: 0,
      message: err.message || "Pa internet.",
    };
  }
}

async function acknowledgeOnlineOrders(db, orderIds, pin = "") {
  const cfg = getConfig(db);
  if (!cfg.celesi || !cfg.serverUrl) {
    return { ok: false, connected: false, acknowledged: 0, message: "Pa lidhje cloud." };
  }

  const ids = [...new Set((orderIds || []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) {
    return { ok: true, connected: true, acknowledged: 0, order_ids: [] };
  }

  const pinTrim = String(pin || "").trim();

  try {
    const res = await requestJson("POST", cfg.serverUrl, "/api/v1/license/online-orders/acknowledge", {
      celesi: cfg.celesi,
      device_id: cfg.deviceId,
      order_ids: ids,
      pin: pinTrim,
    });
    const parsed = parseCloudJson(res.data);
    if (res.status < 400 && parsed.ok && (Number(parsed.acknowledged) || 0) > 0) {
      return {
        ok: true,
        connected: true,
        acknowledged: Number(parsed.acknowledged) || ids.length,
        order_ids: parsed.order_ids || ids,
        accepted_by: parsed.accepted_by || "",
      };
    }

    const viaKds = await acknowledgeOnlineOrdersViaKds(db, ids, pinTrim);
    if (viaKds.ok) return viaKds;

    return {
      ok: false,
      connected: true,
      acknowledged: 0,
      message: parsed.gabim || parsed.message || viaKds.message || "Nuk u shënuan porositë.",
    };
  } catch (err) {
    const viaKds = await acknowledgeOnlineOrdersViaKds(db, ids, pinTrim);
    if (viaKds.ok) return viaKds;
    return {
      ok: false,
      connected: false,
      acknowledged: 0,
      message: err.message || "Pa internet.",
    };
  }
}

async function fetchReceiptFormat(db, body) {
  const cfg = getConfig(db);
  if (!cfg.serverUrl) {
    throw new Error("Mungon Server URL.");
  }
  if (!cfg.celesi) {
    throw new Error("Mungon çelësi i licencës.");
  }

  const res = await requestJson("POST", cfg.serverUrl, "/api/v1/receipt/format", {
    celesi: cfg.celesi,
    ...body,
  });

  let parsed = {};
  try {
    parsed = JSON.parse(res.data || "{}");
  } catch {
    parsed = {};
  }

  if (res.status >= 400 || parsed.ok === false) {
    throw new Error(parsed.gabim || `Serveri nuk ktheu faturë (HTTP ${res.status}).`);
  }

  return parsed;
}

async function licenseCloudPost(db, path, body = {}) {
  const cfg = getConfig(db);
  if (!cfg.serverUrl) throw new Error("Mungon Server URL cloud.");
  if (!cfg.celesi) throw new Error("Mungon çelësi i licencës.");

  const payload = {
    celesi: cfg.celesi,
    device_id: cfg.deviceId,
    app_type: cfg.appType,
    ...body,
  };

  const res = await requestJson("POST", cfg.serverUrl, path, payload);
  const parsed = parseCloudJson(res.data);
  if (res.status >= 400 || parsed.ok === false) {
    throw new Error(parsed.gabim || parsed.message || `Gabim cloud (HTTP ${res.status}).`);
  }
  return parsed;
}

/** Rindërton daily_log nga të gjitha porositë closed në cloud (fshirje + import i plotë). */
async function rebuildRegisterFromCloud(db) {
  if (!isCloudConfigured(db)) {
    throw new Error("Cloud nuk është konfiguruar — aktivizoni licencën.");
  }
  if (typeof db.rebuildDailyLogFromCloudSales !== "function") {
    throw new Error("Rindërtimi i arkës nuk mbështetet në këtë version.");
  }
  const parsed = await licenseCloudPost(db, "/api/v1/license/waiter-closed-sales", { rebuild: true });
  const sales = Array.isArray(parsed.sales) ? parsed.sales : [];
  console.log("[register/rebuild] cloud ktheu", sales.length, "porosi closed");
  const result = db.rebuildDailyLogFromCloudSales(sales);
  console.log("[register/rebuild] daily_log:", result);
  return result;
}

/** Merr porosi WEB-WAITER të mbyllura nga cloud dhe i shton në daily_log (pazari i kamarierit). */
async function syncClosedWebWaiterSales(db) {
  if (!isCloudConfigured(db)) {
    console.log("[cloud/sync] syncClosedWebWaiterSales skip: cloud nuk është konfiguruar");
    return { ok: false, imported: 0, message: "Cloud nuk është konfiguruar." };
  }
  if (typeof db.importClosedWebWaiterSaleFromCloud !== "function") {
    console.warn("[cloud/sync] syncClosedWebWaiterSales skip: importClosedWebWaiterSaleFromCloud mungon");
    return { ok: false, imported: 0, message: "Importi lokal mungon." };
  }

  let since = typeof db.getCloudWaiterClosedSyncSince === "function"
    ? db.getCloudWaiterClosedSyncSince() || ""
    : "";
  // Nëse s'ka cursor, mos merr shitje të vjetra — fillo nga sot
  if (!since) {
    since = new Date().toISOString().slice(0, 10) + "T00:00:00";
  }
  console.log("[cloud/sync] GET /api/v1/license/waiter-closed-sales since=" + since);

  try {
    const body = { since };
    const parsed = await licenseCloudPost(db, "/api/v1/license/waiter-closed-sales", body);
    const sales = Array.isArray(parsed.sales) ? parsed.sales : [];
    console.log("[cloud/sync] server ktheu", sales.length, "porosi WEB-WAITER closed");
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let maxClosedAt = since;
    for (const sale of sales) {
      const result = db.importClosedWebWaiterSaleFromCloud(sale);
      if (result?.imported) imported += 1;
      else if (result?.skipped) skipped += 1;
      else failed += 1;
      const ca = String(sale.closed_at || "").trim();
      if (ca && ca > maxClosedAt) maxClosedAt = ca;
    }
    if (maxClosedAt && typeof db.setCloudWaiterClosedSyncSince === "function") {
      db.setCloudWaiterClosedSyncSince(maxClosedAt);
    }
    if (imported || failed || sales.length) {
      console.log("[cloud/sync] përmbledhje:", { fetched: sales.length, imported, skipped, failed });
    }
    return { ok: true, imported, skipped, failed, fetched: sales.length };
  } catch (err) {
    console.warn("[cloud/sync] Sync WEB-WAITER closed dështoi:", err.message);
    return { ok: false, imported: 0, message: err.message };
  }
}

async function listCloudReservations(db, query = {}) {
  return licenseCloudPost(db, "/api/v1/license/reservations/list", query);
}

async function createCloudReservation(db, body) {
  return licenseCloudPost(db, "/api/v1/license/reservations/create", body);
}

async function updateCloudReservationStatus(db, reservationId, status) {
  return licenseCloudPost(db, "/api/v1/license/reservations/update", {
    reservation_id: reservationId,
    status,
  });
}

/**
 * Krahason porositë lokale aktive me gjendjen e cloud.
 * Nëse cloud tregon tavolinën si të lirë por lokali e ka të zënë (porosi > 3min),
 * anulo lokalisht për të çliruar tavolinën e ngrirë.
 */
/**
 * Sinkronizon gjendjen e tavolinave midis cloud dhe lokal.
 *
 * Drejtim 1 (cloud → lokal): porosi lokale aktive me cloud_order_id që nuk
 *   ekzistojnë më te cloud (cancelled/closed) → anulohen lokalisht.
 *
 * Drejtim 2 (lokal → cloud): tavolina të lira lokalisht por cloud i ka si të
 *   zëna me porosinë e këtij POS (device_id match) → lirojini në cloud me
 *   pushTableFree, sepse close/cancel lokal ndoshta nuk e ka dërguar sinjal.
 */
async function syncLocalCancelledFromCloud(db) {
  if (!isCloudConfigured(db)) return;
  const cfg = getConfig(db);
  const localDeviceId = String(cfg.deviceId || "").trim().toUpperCase();

  try {
    const cloudData = await fetchLiveCloudTables(db);
    if (!cloudData || !Array.isArray(cloudData.tables)) return;

    const now = Date.now();
    const GRACE_MS = 30_000; // 30 sekonda — mjafton pas nisjes

    // --- Drejtim 2: cloud occupied me POS-in tonë, por lokalisht e lirë ---
    // Kjo rregullon "Duke u sinkronizuar..." — tavolina është e lirë lokalisht
    // por cloud ka ende porosi active nga ky POS (ndoshta close pa pushTableFree).
    const localTables = db.getTablesWithOrders();
    const localOccupied = new Set(
      localTables.filter(t => t.order).map(t => Number(t.number)),
    );

    for (const ct of cloudData.tables) {
      if (ct.status !== "occupied") continue;
      const tNum = Number(ct.number);
      if (!tNum) continue;
      if (localOccupied.has(tNum)) continue; // lokalisht e zënë gjithashtu → OK

      // Lokalisht e lirë, cloud e ka si të zënë
      const cloudDevice = String(ct.device_id || ct.order?.device_id || "")
        .trim()
        .toUpperCase();

      // Nëse porosia cloud u krijua nga ky POS → e lirojmë në cloud
      if (localDeviceId && cloudDevice === localDeviceId) {
        pushTableFree(db, tNum);
        console.log(
          `[sync] T${tNum} lirohet cloud — POS lokale e ka mbyllur pa njoftuar`,
        );
      }
    }

    // --- Drejtim 1: porosi lokale aktive pa pasur match në cloud ---
    // Kjo rregullon rastin kur cloud anuloi porosinë por lokalisht mbeti active.
    const activeOrders = db.listLocalActiveOrders();
    if (!activeOrders.length) return;

    // Mblidh IDs e porosive cloud aktive (status=ordered/ready)
    const cloudOrderedIds = new Set(
      cloudData.tables
        .filter(t => t.status === "occupied")
        .map(t => String(t.order?.id || t.id || ""))
        .filter(Boolean),
    );

    let pendingCloudCloseImport = false;
    for (const order of activeOrders) {
      const tableNum = Number(order.table_number);
      if (!tableNum) continue;
      const ageMs = now - new Date(order.created_at || 0).getTime();
      if (ageMs < GRACE_MS) continue;
      if (!order.cloud_order_id) continue;
      const cId = String(order.cloud_order_id).trim();
      if (cloudOrderedIds.has(cId)) continue;
      pendingCloudCloseImport = true;
      break;
    }
    if (pendingCloudCloseImport) {
      await syncClosedWebWaiterSales(db);
    }

    for (const order of activeOrders) {
      const tableNum = Number(order.table_number);
      if (!tableNum) continue;
      const ageMs = now - new Date(order.created_at || 0).getTime();
      if (ageMs < GRACE_MS) continue; // tepër e re — lëre të vendoset

      if (!order.cloud_order_id) continue; // nuk ka ID cloud → nuk mund krahasojmë

      const cId = String(order.cloud_order_id).trim();
      if (cloudOrderedIds.has(cId)) continue; // ekziston ende në cloud → OK

      // Porosia cloud u anulua/mbyll, por lokalisht është ende aktive → anulo
      try {
        console.log(
          `[STATUS-CHANGE][cloud-sync.syncLocalCancelledFromCloud] T${tableNum} order.id=${order.id} ` +
          `cloud_order_id=${cId} ageMs=${ageMs} nuk ekziston më në cloud -> cancelActiveOrder()`,
        );
        db.cancelActiveOrder(order.table_id);
        console.log(
          `[sync] T${tableNum} u anulua lokalisht — cloud_order_id ${cId} nuk ekziston`,
        );
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.warn("[syncLocalCancelledFromCloud]", err.message);
  }
}

async function fetchReadyTableOrders(db) {
  const cfg = getConfig(db);
  const { slug, key } = getKitchenAccess(db);
  if (!cfg.serverUrl || !slug || !key) return [];
  try {
    const res = await requestJson(
      "GET",
      cfg.serverUrl,
      `/api/kds/${encodeURIComponent(slug)}/bar/orders/ready?key=${encodeURIComponent(key)}`,
      null,
      { timeoutMs: 8000 },
    );
    const parsed = parseCloudJson(res.data);
    if (res.status < 400 && parsed.ok) return parsed.orders || [];
    return [];
  } catch {
    return [];
  }
}

async function fetchOnlineSlotLayout(db, { waiterId = "", waiterName = "", unfiltered = false } = {}) {
  const cfg = getConfig(db);
  const { slug, key } = getKitchenAccess(db);
  if (!cfg.serverUrl || !slug || !key) return [];
  try {
    const params = new URLSearchParams({ key });
    if (!unfiltered) {
      const wid = String(waiterId || "").trim();
      const wname = String(waiterName || "").trim();
      if (wid) params.set("waiter_id", wid);
      if (wname) params.set("waiter_name", wname);
    }
    const res = await requestJson(
      "GET",
      cfg.serverUrl,
      `/api/kds/${encodeURIComponent(slug)}/bar/orders?${params.toString()}`,
      null,
      { timeoutMs: 10000 },
    );
    const parsed = parseCloudJson(res.data);
    if (res.status >= 400 || parsed.ok === false) return [];
    return Array.isArray(parsed.online_slots) ? parsed.online_slots : [];
  } catch {
    return [];
  }
}

async function fetchActiveBarOrdersByTable(db) {
  const cfg = getConfig(db);
  const { slug, key } = getKitchenAccess(db);
  if (!cfg.serverUrl || !slug || !key) return new Map();
  try {
    const res = await requestJson(
      "GET",
      cfg.serverUrl,
      `/api/kds/${encodeURIComponent(slug)}/bar/orders?key=${encodeURIComponent(key)}`,
      null,
      { timeoutMs: 10000 },
    );
    const parsed = parseCloudJson(res.data);
    if (res.status >= 400 || parsed.ok === false) return new Map();
    const byTable = new Map();
    for (const o of parsed.orders || []) {
      const n = Number(o.table_number) || 0;
      if (n >= 1 && !byTable.has(n)) byTable.set(n, o);
    }
    return byTable;
  } catch {
    return new Map();
  }
}

async function resolveCloudOrderPayload(db, order) {
  if (!order || String(order.id || "").trim()) return order || {};
  const tNum = Number(order.table_number) || 0;
  const localId = String(order.local_order_id || "").trim();
  const device = String(order.device_id || "").trim().toUpperCase();
  if (!tNum && !localId) return order;

  try {
    const barByTable = await fetchActiveBarOrdersByTable(db);
    if (tNum >= 1) {
      const hit = barByTable.get(tNum);
      if (hit?.id) {
        return {
          ...order,
          ...hit,
          table_number: Number(hit.table_number) || tNum,
        };
      }
    }
    if (localId) {
      for (const o of barByTable.values()) {
        const oDev = String(o.device_id || "").trim().toUpperCase();
        if (String(o.local_order_id || "").trim() === localId
          && (!device || !oDev || oDev === device)) {
          return { ...order, ...o };
        }
      }
    }
  } catch {
    /* offline */
  }
  return order;
}

async function enrichLiveCloudTables(db, live) {
  if (!live?.tables?.length) return live;
  const byTable = new Map();
  try {
    const barByTable = await fetchActiveBarOrdersByTable(db);
    for (const [n, o] of barByTable) byTable.set(n, o);
  } catch {
    /* offline */
  }
  try {
    const online = await fetchOnlineOrders(db);
    for (const o of [...(online.all_orders || []), ...(online.orders || [])]) {
      const n = Number(o.table_number) || 0;
      if (n >= 1 && !byTable.has(n)) byTable.set(n, o);
    }
  } catch {
    /* offline */
  }

  live.tables = live.tables.map(t => {
    if (t.status !== "occupied" || !t.order) return t;
    const full = byTable.get(Number(t.number));
    if (!full) return t;
    return {
      ...t,
      order: {
        ...t.order,
        id: full.id || t.order.id || null,
        device_id: full.device_id || t.order.device_id || "",
        local_order_id: full.local_order_id || t.order.local_order_id || null,
        waiter_name: full.customer_label || full.waiter_name || t.order.waiter_name || "",
        items: full.items || t.order.items || [],
        total: full.total != null ? full.total : t.order.total,
      },
    };
  });
  return live;
}

async function ensureCloudTableImported(db, tableNumber, waiterName) {
  const table = db.getTableByNumber(Number(tableNumber));
  if (!table) return null;

  let active = db.getActiveOrderForTable(table.id);
  if (active) return active;

  const live = await fetchLiveCloudTables(db);
  const cloudTable = (live?.tables || []).find(
    t => Number(t.number) === Number(tableNumber) && t.status === "occupied",
  );
  if (!cloudTable?.order) return null;

  let order = { ...cloudTable.order, table_number: Number(tableNumber) || cloudTable.order.table_number };
  order = await resolveCloudOrderPayload(db, order);
  if (!order.id) {
    try {
      const online = await fetchOnlineOrders(db);
      const full = (online.all_orders || []).find(o => Number(o.table_number) === Number(tableNumber));
      if (full) {
        order = {
          ...order,
          ...full,
          waiter_name: full.customer_label || full.waiter_name || order.waiter_name,
        };
      }
    } catch {
      /* offline */
    }
  }

  const cloudId = String(order.id || "").trim();
  const activeExisting = db.getActiveOrderByCloudId(cloudId);
  if (activeExisting) {
    db.db.prepare("UPDATE tables SET status = 'occupied' WHERE id = ?").run(activeExisting.table_id);
    return db.getActiveOrderForTable(activeExisting.table_id);
  }

  if (!cloudId) return null;

  const canonicalNum = Number(order.table_number) || 0;
  if (canonicalNum > 0 && canonicalNum !== Number(tableNumber)) {
    return null;
  }

  try {
    db.importCloudOrderToLocal(order, waiterName);
  } catch (err) {
    console.warn("[cloud] ensureCloudTableImported:", err.message);
    const recovered = db.getActiveOrderByCloudId(cloudId);
    if (recovered) {
      db.db.prepare("UPDATE tables SET status = 'occupied' WHERE id = ?").run(recovered.table_id);
      return db.getActiveOrderForTable(recovered.table_id);
    }
    return null;
  }
  return db.getActiveOrderForTable(table.id);
}

async function resolveCloudOrderById(db, cloudId) {
  const id = String(cloudId || "").trim();
  if (!id) return null;
  try {
    const barByTable = await fetchActiveBarOrdersByTable(db);
    for (const o of barByTable.values()) {
      if (String(o.id) === id) return o;
    }
  } catch {
    /* offline */
  }
  try {
    const online = await fetchOnlineOrders(db);
    for (const o of [...(online.all_orders || []), ...(online.orders || [])]) {
      if (String(o.id) === id) return o;
    }
  } catch {
    /* offline */
  }
  const pending = db.listPendingCloudOrders?.() || [];
  return pending.find(p => String(p.id) === id) || null;
}

async function closeCloudTableOrdersForPayment(db, tableNumber, opts = {}) {
  const cfg = getConfig(db);
  const num = Number(tableNumber);
  if (!cfg.celesi || !cfg.serverUrl || !num) return { closed: 0 };

  const targets = new Map();
  const addTarget = (o) => {
    if (!o) return;
    const deviceId = String(o.device_id || cfg.deviceId || "").trim().toUpperCase();
    const localOrderId = String(o.local_order_id || "").trim();
    if (!deviceId || !localOrderId) return;
    const key = `${deviceId}|${localOrderId}`;
    if (!targets.has(key)) targets.set(key, o);
  };

  try {
    const live = await fetchLiveCloudTables(db);
    const ct = (live?.tables || []).find(t => Number(t.number) === num && t.status === "occupied");
    if (ct?.order) addTarget(ct.order);
  } catch {
    /* ignore */
  }

  try {
    const online = await fetchOnlineOrders(db);
    for (const o of [...(online.all_orders || []), ...(online.orders || [])]) {
      if (Number(o.table_number) === num) addTarget(o);
    }
  } catch {
    /* ignore */
  }

  for (const cloudId of opts.cloud_order_ids || []) {
    const hit = await resolveCloudOrderById(db, cloudId);
    if (hit) addTarget(hit);
  }

  const items = normalizeItems(opts.items || []);
  const now = opts.closed_at || new Date().toISOString();
  let closed = 0;

  for (const o of targets.values()) {
    const deviceId = String(o.device_id || cfg.deviceId).trim().toUpperCase();
    const localOrderId = String(o.local_order_id || "").trim();
    const closeItems = items.length ? items : normalizeItems(o.items || o.items_json || []);
    const payload = {
      celesi: cfg.celesi,
      device_id: deviceId,
      local_order_id: localOrderId,
      table_number: num,
      waiter_name: String(opts.waiter_name || o.waiter_name || o.customer_label || "").trim(),
      items: closeItems,
      total: opts.total != null ? Number(opts.total) : Number(o.total) || 0,
      receipt_number: String(opts.receipt_number || ""),
      status: "closed",
      payment_method: db.normalizePaymentMethod(opts.payment_method || "cash"),
      closed_at: now,
      ordered_at: o.ordered_at || o.created_at || now,
    };
    applyFiscalCloseFields(payload, opts);
    try {
      const res = await requestJson(
        "POST",
        cfg.serverUrl,
        "/api/v1/sales/sync",
        payload,
        { timeoutMs: 12000 },
      );
      if (res.status < 400) closed += 1;
      else console.warn("[cloud] close table sale:", res.status, res.data?.slice?.(0, 120));
    } catch (err) {
      console.warn("[cloud] close table sale:", err.message);
    }
  }

  pushTableFree(db, num);
  return { closed };
}

async function closeCloudOnlineOrderById(db, opts = {}) {
  const orderId = String(opts.order_id || opts.cloud_order_id || "").trim();
  if (!orderId) throw new Error("Mungon ID e porosisë cloud.");
  const cfg = getConfig(db);
  const { slug, key } = getKitchenAccess(db);
  if (!cfg.serverUrl || !slug || !key) throw new Error("Cloud nuk është i konfiguruar.");

  const items = normalizeItems(opts.items || []);
  const payload = {
    order_id: orderId,
    table_number: 0,
    payment_method: db.normalizePaymentMethod(opts.payment_method || "cash"),
    waiter_name: String(opts.waiter_name || "").trim(),
    items,
  };
  if (opts.waiter_id) payload.waiter_id = opts.waiter_id;
  applyFiscalCloseFields(payload, opts);

  const res = await requestJson(
    "POST",
    cfg.serverUrl,
    `/api/waiter/${encodeURIComponent(slug)}/orders/close?key=${encodeURIComponent(key)}`,
    payload,
    { timeoutMs: 12000, headers: { "x-kitchen-key": key } },
  );
  const parsed = parseCloudJson(res.data);
  if (res.status >= 400 || parsed.ok === false) {
    throw new Error(parsed.gabim || `Cloud close HTTP ${res.status}`);
  }
  return parsed;
}

async function fetchLiveCloudTables(db) {
  ensureKdsEventsListener(db);
  const cfg = getConfig(db);
  const { slug, key } = getKitchenAccess(db);
  if (!cfg.serverUrl || !slug || !key) return null;
  try {
    const res = await requestJson(
      "GET",
      cfg.serverUrl,
      `/api/kds/${encodeURIComponent(slug)}/bar/tables/live?key=${encodeURIComponent(key)}`,
      null,
      { timeoutMs: 8000 },
    );
    const parsed = parseCloudJson(res.data);
    if (res.status < 400 && parsed.ok) {
      if (Array.isArray(parsed.tables)) {
        parsed.tables = parsed.tables.map(t => {
          const num = Number(t.number);
          if (num >= 1 && sseFreedTableNums.has(num) && t.status === "occupied") {
            return { ...t, status: "free", order: null };
          }
          return t;
        });
        for (const t of parsed.tables) {
          const num = Number(t.number);
          if (num >= 1 && t.status === "free") sseFreedTableNums.delete(num);
        }
      }
      return enrichLiveCloudTables(db, parsed);
    }
    return null;
  } catch {
    return null;
  }
}

let kdsEventsReq = null;
let kdsEventsBuffer = "";
let kdsEventsDbRef = null;
let kdsEventsReconnectTimer = null;
/** Tavolina të lira nga SSE — mos shfaq "Duke u sinkronizuar" derisa cloud të përditësohet. */
const sseFreedTableNums = new Set();
let closedWebWaiterSyncTimer = null;

function scheduleClosedWebWaiterSync(db) {
  if (!db || closedWebWaiterSyncTimer) return;
  closedWebWaiterSyncTimer = setTimeout(() => {
    closedWebWaiterSyncTimer = null;
    syncClosedWebWaiterSales(db).catch(err =>
      console.warn("[cloud/sse] syncClosedWebWaiterSales:", err.message),
    );
  }, 400);
}

function freeLocalTableFromCloudEvent(db, tableNumber) {
  const num = Number(tableNumber);
  if (!num || !db?.db) return;
  const table = db.db.prepare("SELECT id FROM tables WHERE number = ?").get(num);
  if (!table?.id) return;

  const activeOrders = db.db.prepare(
    "SELECT id, cloud_order_id, waiter_name, total FROM orders WHERE table_id = ? AND status IN ('active', 'ordered')",
  ).all(table.id);
  const localOnly = activeOrders.filter(o => !String(o.cloud_order_id || "").trim());
  const cloudLinked = activeOrders.filter(o => String(o.cloud_order_id || "").trim());

  if (localOnly.length) {
    console.log(
      `[STATUS-CHANGE][cloud-sync.freeLocalTableFromCloudEvent] T${num} SKIP — ` +
      `${localOnly.length} porosi LOKALE (jo-cloud) aktive, NUK preket:`,
      JSON.stringify(localOnly),
    );
    return;
  }

  if (cloudLinked.length) {
    console.log(
      `[STATUS-CHANGE][cloud-sync.freeLocalTableFromCloudEvent] T${num} anulon porosi cloud id(s)=` +
      cloudLinked.map(o => o.id).join(","),
    );
    for (const o of cloudLinked) {
      db.db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(o.id);
    }
  } else {
    console.log(`[STATUS-CHANGE][cloud-sync.freeLocalTableFromCloudEvent] T${num} nuk ka porosi aktive — vetëm normalizim tavoline`);
  }
  console.log(`[STATUS-CHANGE][cloud-sync.freeLocalTableFromCloudEvent] T${num} -> tables.status='free'`);
  db.db.prepare("UPDATE tables SET status = 'free' WHERE id = ?").run(table.id);
}

function handleKdsKitchenSsePayload(db, payload) {
  if (!payload) return;
  const status = String(payload.status || "").trim().toLowerCase();
  const num = Number(payload.table_number);
  console.log(`[STATUS-CHANGE][cloud-sync.handleKdsKitchenSsePayload] SSE event:`, JSON.stringify(payload));
  const remoteIds = [
    ...(Array.isArray(payload.order_ids) ? payload.order_ids : []),
    ...(payload.order_id ? [payload.order_id] : []),
  ].map(id => String(id || "").trim()).filter(Boolean);

  if (remoteIds.length && (status === "accepted" || status === "cancelled" || status === "closed")) {
    try {
      const watcher = require("./online-orders-watcher");
      if (typeof watcher.purgeRemoteHandledOrderIds === "function") {
        watcher.purgeRemoteHandledOrderIds(db, remoteIds);
      }
    } catch (err) {
      console.warn("[cloud/sse] purge pending:", err.message);
    }
  }

  if (status === "closed" && num >= 1) {
    // Mbyllje nga telefon: printo faturën PARA se freeLocal ta anulojë porosinë.
    // Nëse paneli e mbylli tashmë (completed) → printClosing no-op, pa dyfishim.
    const { printClosingReceiptIfActiveCloudOrder } = require("./close-table-print");
    void Promise.resolve(printClosingReceiptIfActiveCloudOrder(db, num, {
      paymentMethod: payload.payment_method,
      fiscal_skip: payload.fiscal_skip,
      coupon_type: payload.coupon_type,
    }))
      .catch(err => console.warn("[cloud/sse] closing print:", err.message || err))
      .finally(() => {
        freeLocalTableFromCloudEvent(db, num);
        sseFreedTableNums.add(num);
        scheduleClosedWebWaiterSync(db);
        console.log(`[cloud/sse] T${num} u mbyll (status=closed) — lokal + arka sync`);
      });
  } else if (status === "free" && num >= 1) {
    freeLocalTableFromCloudEvent(db, num);
    sseFreedTableNums.add(num);
    scheduleClosedWebWaiterSync(db);
    console.log(`[cloud/sse] T${num} u lirua (status=free)`);
  } else if (status === "closed" || status === "free") {
    scheduleClosedWebWaiterSync(db);
  }
}

function stopKdsEventsListener() {
  if (kdsEventsReconnectTimer) {
    clearTimeout(kdsEventsReconnectTimer);
    kdsEventsReconnectTimer = null;
  }
  if (kdsEventsReq) {
    kdsEventsReq.destroy();
    kdsEventsReq = null;
  }
  kdsEventsBuffer = "";
}

function scheduleKdsEventsReconnect(delayMs = 5000) {
  if (kdsEventsReconnectTimer) return;
  stopKdsEventsListener();
  kdsEventsReconnectTimer = setTimeout(() => {
    kdsEventsReconnectTimer = null;
    if (kdsEventsDbRef) connectKdsEventsListener(kdsEventsDbRef);
  }, delayMs);
}

function connectKdsEventsListener(db) {
  if (!isCloudConfigured(db)) return;
  const cfg = getConfig(db);
  const { slug, key } = getKitchenAccess(db);
  if (!cfg.serverUrl || !slug || !key) return;
  if (kdsEventsReq) return;

  kdsEventsDbRef = db;
  kdsEventsBuffer = "";

  const path = `/api/kds/${encodeURIComponent(slug)}/events?key=${encodeURIComponent(key)}`;
  let url;
  try {
    url = new URL(path, String(cfg.serverUrl).replace(/\/$/, "") + "/");
  } catch {
    scheduleKdsEventsReconnect();
    return;
  }

  const lib = url.protocol === "https:" ? https : http;
  const req = lib.request(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: "GET",
      headers: { Accept: "text/event-stream", Connection: "keep-alive" },
    },
    res => {
      if (res.statusCode !== 200) {
        scheduleKdsEventsReconnect();
        return;
      }
      res.setEncoding("utf8");
      res.on("data", chunk => {
        kdsEventsBuffer += chunk;
        const parts = kdsEventsBuffer.split("\n\n");
        kdsEventsBuffer = parts.pop() || "";
        for (const block of parts) {
          if (!block.trim() || block.trimStart().startsWith(":")) continue;
          let eventName = "message";
          let dataLine = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
          }
          if (eventName !== "kitchen" || !dataLine) continue;
          try {
            handleKdsKitchenSsePayload(db, JSON.parse(dataLine));
          } catch {
            /* ignore */
          }
        }
      });
      res.on("end", () => scheduleKdsEventsReconnect());
      res.on("error", () => scheduleKdsEventsReconnect());
    },
  );
  req.on("error", () => scheduleKdsEventsReconnect());
  req.end();
  kdsEventsReq = req;
}

function ensureKdsEventsListener(db) {
  if (!db || kdsEventsReq) return;
  connectKdsEventsListener(db);
}

module.exports = {
  SERVER_URL,
  DEFAULT_SERVER: SERVER_URL,
  ensureAutoCloudConfig,
  getConfig,
  isCloudConfigured,
  getBarScreenUrl,
  checkConnection,
  fetchReceiptFormat,
  fetchRegisterModeFromCloud,
  fetchOnlineOrders,
  fetchLoginOrderNotify,
  buildLoginNotifyFromOrders,
  isCloudOrderAccepted,
  fetchPendingOnlineCount,
  acknowledgeOnlineOrders,
  refuseOnlineOrder,
  listRefusedOrders,
  cancelOnlineOrders,
  orderMirrorsRemoteCloud,
  resolveCloudOrderById,
  pushSale,
  pushActiveOrderUpdate,
  pushAllActiveTables,
  reconcileAllTablesWithCloud,
  pushTableFree,
  pushTableCancelled,
  pushCatalog,
  pushCatalogAsync,
  pushStaffAsync,
  syncCatalogToCloud,
  fullCloudSync,
  pullMenuPhotosFromCloud,
  pullNewCatalogItemsFromCloud,
  syncRestaurantIdentityFromCloud,
  listCloudReservations,
  createCloudReservation,
  updateCloudReservationStatus,
  syncLocalCancelledFromCloud,
  fetchReadyTableOrders,
  fetchLiveCloudTables,
  ensureCloudTableImported,
  resolveCloudOrderPayload,
  fetchActiveBarOrdersByTable,
  fetchOnlineSlotLayout,
  closeCloudOnlineOrderById,
  closeCloudTableOrdersForPayment,
  rebuildRegisterFromCloud,
  syncClosedWebWaiterSales,
};
