const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const VERSION = require("./version-config");

function localeLayoutLabels() {
  let fr = false;
  try {
    fr = require("./i18n").isFrench();
  } catch {
    fr = false;
  }
  return {
    mainZone: fr ? "Principale" : "Kryesore",
    onlineZone: fr ? "Commandes en ligne" : "Porosi online",
    tablePrefix: fr ? "Table " : "Tavolina ",
  };
}

function isOnlineOrdersZoneName(name) {
  const n = String(name || "").trim().toLowerCase();
  return n === "porosi online" || n === "commandes en ligne";
}

function localizeDefaultLayoutNames() {
  let fr = false;
  try {
    fr = require("./i18n").isFrench();
  } catch {
    fr = false;
  }
  if (!fr || !sqlite) return;
  try {
    sqlite.prepare("UPDATE table_zones SET name = 'Principale' WHERE name = 'Kryesore'").run();
    sqlite.prepare("UPDATE table_zones SET name = 'Commandes en ligne' WHERE name = 'Porosi online'").run();
    const rows = sqlite.prepare("SELECT id, number, display_name FROM tables").all();
    const upd = sqlite.prepare("UPDATE tables SET display_name = ? WHERE id = ?");
    for (const r of rows) {
      const dn = String(r.display_name || "").trim();
      if (/^Tavolina\s+\d+$/i.test(dn)) upd.run(`Table ${r.number}`, r.id);
    }
  } catch (e) {
    console.warn("localizeDefaultLayoutNames:", e.message);
  }
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "restaurant.db");

function resolveAsarRoots() {
  const dir = String(__dirname || "");
  // Kujdes: "app.asar.unpacked".includes("app.asar") === true — mos e përdor includes të thjeshtë
  const inAsar =
    dir.endsWith(`${path.sep}app.asar`) ||
    dir.includes(`${path.sep}app.asar${path.sep}`) ||
    dir.endsWith("/app.asar") ||
    dir.includes("/app.asar/");
  if (inAsar || (typeof process.resourcesPath === "string" && process.resourcesPath)) {
    const resources =
      typeof process.resourcesPath === "string" && process.resourcesPath
        ? process.resourcesPath
        : path.join(dir.split(/app\.asar/)[0]);
    return {
      resourcesPath: resources,
      asarRoot: path.join(resources, "app.asar"),
      unpackedRoot: path.join(resources, "app.asar.unpacked"),
    };
  }
  return {
    resourcesPath: "",
    asarRoot: dir,
    unpackedRoot: dir,
  };
}

/** sql.js in-process në main process (pa worker threads). */
let dbReady = false;
let callDb;
let whenReady;
let inlineEngine = null;
let flushDatabase = () => {};
callDb = (msg) => {
  if (!inlineEngine) throw new Error("Database not ready — await whenReady() first");
  return inlineEngine.dispatch(msg);
};
whenReady = async () => {
  if (dbReady) return;
  const roots = resolveAsarRoots();
  const enginePath = fs.existsSync(path.join(roots.unpackedRoot, "db-engine.js"))
    ? path.join(roots.unpackedRoot, "db-engine.js")
    : path.join(__dirname, "db-engine.js");
  const { bootDatabase } = require(enginePath);
  inlineEngine = await bootDatabase({
    dbPath: DB_PATH,
    baseDir: roots.unpackedRoot || __dirname,
    resourcesPath: roots.resourcesPath || undefined,
    wasmDir: roots.unpackedRoot
      ? path.join(roots.unpackedRoot, "node_modules", "sql.js", "dist")
      : path.join(__dirname, "node_modules", "sql.js", "dist"),
  });
  flushDatabase =
    typeof inlineEngine.flushSave === "function"
      ? () => inlineEngine.flushSave()
      : () => {};
  dbReady = true;
  try {
    localizeDefaultLayoutNames();
  } catch {
    /* ignore */
  }
  try {
    ensureDefaultRooms();
  } catch {
    /* ignore — schema mund të jetë ende duke u ngarkuar */
  }
  try {
    ensureMenuVatCategories();
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try { ensureHotelServiceStockPhotos(); } catch { /* ignore */ }
    try { ensureHotelServiceCategoryPhotos(); } catch { /* ignore */ }
  }, 3000);
};

  let inTransaction = false;

  function prepare(sql) {
    return {
      get(...params) {
        return callDb({ op: "get", sql, params });
      },
      all(...params) {
        return callDb({ op: "all", sql, params });
      },
      run(...params) {
        return callDb({ op: "run", sql, params });
      },
      runMany(paramsList) {
        return callDb({ op: "runMany", sql, paramsList });
      },
    };
  }

  function exec(sql) {
    callDb({ op: "exec", sql });
  }

  function transaction(fn) {
    return () => {
      inTransaction = true;
      callDb({ op: "begin" });
      try {
        const result = fn();
        callDb({ op: "commit" });
        return result;
      } catch (err) {
        try {
          callDb({ op: "rollback" });
        } catch {
          /* ignore */
        }
        throw err;
      } finally {
        inTransaction = false;
      }
    };
  }

  const sqlite = { prepare, exec, transaction };
  const db = sqlite;

function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}

function getSetting(key, fallback = null) {
  const row = sqlite.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function reservationDateFilterSql(query = {}) {
  const { date, from, to } = query;
  if (date) return { sql: "date = ?", params: [String(date).slice(0, 10)] };
  if (from || to) {
    const fromDate = String(from || to).slice(0, 10);
    const toDate = String(to || from).slice(0, 10);
    return { sql: "date >= ? AND date <= ?", params: [fromDate, toDate] };
  }
  const today = new Date().toISOString().slice(0, 10);
  return { sql: "date = ?", params: [today] };
}

function upsertReservationLocal(row) {
  sqlite.prepare(`
    INSERT INTO reservations_local (
      id, cloud_id, customer_name, customer_phone, table_number, date, time,
      guests, notes, status, sync_status, conflict_message, pending_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(id) DO UPDATE SET
      cloud_id = excluded.cloud_id,
      customer_name = excluded.customer_name,
      customer_phone = excluded.customer_phone,
      table_number = excluded.table_number,
      date = excluded.date,
      time = excluded.time,
      guests = excluded.guests,
      notes = excluded.notes,
      status = excluded.status,
      sync_status = excluded.sync_status,
      conflict_message = excluded.conflict_message,
      pending_status = excluded.pending_status,
      updated_at = datetime('now','localtime')
  `).run(
    row.id,
    row.cloud_id || null,
    row.customer_name,
    row.customer_phone || "",
    Number(row.table_number),
    String(row.date).slice(0, 10),
    String(row.time).slice(0, 8),
    Number(row.guests) || 2,
    row.notes || "",
    row.status || "pending",
    row.sync_status || "synced",
    row.conflict_message || "",
    row.pending_status || null,
  );
}

function insertLocalReservation(row) {
  upsertReservationLocal({ ...row, sync_status: row.sync_status || "pending" });
  return row.id;
}

function getLocalReservation(id) {
  return sqlite.prepare("SELECT * FROM reservations_local WHERE id = ? OR cloud_id = ?").get(id, id);
}

function listLocalReservations(query = {}) {
  const f = reservationDateFilterSql(query);
  return sqlite.prepare(`
    SELECT * FROM reservations_local
    WHERE ${f.sql}
    ORDER BY date ASC, time ASC
  `).all(...f.params);
}

function listPendingReservationSync() {
  return sqlite.prepare(`
    SELECT * FROM reservations_local
    WHERE sync_status = 'pending' OR (pending_status IS NOT NULL AND pending_status != '' AND cloud_id IS NOT NULL)
    ORDER BY created_at ASC
  `).all();
}

function updateLocalReservationSync(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (!sets.length) return;
  sets.push("updated_at = datetime('now','localtime')");
  sqlite.prepare(`UPDATE reservations_local SET ${sets.join(", ")} WHERE id = ? OR cloud_id = ?`).run(...vals, id, id);
}

function markReservationConflict(id, message) {
  updateLocalReservationSync(id, {
    sync_status: "conflict",
    conflict_message: String(message || "Konflikt — tavolina e rezervuar nga pajisje tjetër.").slice(0, 500),
  });
}

function getTodayReservationsForTables() {
  const today = new Date().toISOString().slice(0, 10);
  return listLocalReservations({ date: today }).filter(r =>
    ["pending", "confirmed"].includes(String(r.status).toLowerCase()) &&
    String(r.sync_status) !== "conflict",
  );
}

function listPromotions() {
  return sqlite.prepare(`
    SELECT * FROM promotions ORDER BY active DESC, date_from DESC, name ASC
  `).all();
}

function getPromotion(id) {
  return sqlite.prepare("SELECT * FROM promotions WHERE id = ?").get(Number(id));
}

function validatePromotionInput(data) {
  const name = String(data?.name || "").trim();
  if (!name) throw new Error("Emri i promocionit është i detyrueshëm.");
  const discount_type = String(data?.discount_type || "percent").toLowerCase() === "fixed" ? "fixed" : "percent";
  const discount_value = Number(data?.discount_value);
  if (!Number.isFinite(discount_value) || discount_value <= 0) {
    throw new Error("Vlera e zbritjes duhet të jetë më e madhe se 0.");
  }
  if (discount_type === "percent" && discount_value > 100) {
    throw new Error("Përqindja nuk mund të jetë më shumë se 100%.");
  }
  const applies_to = ["order", "category", "product"].includes(String(data?.applies_to))
    ? String(data.applies_to)
    : "order";
  const targets = Array.isArray(data?.targets) ? data.targets : [];
  if (applies_to !== "order" && !targets.length) {
    throw new Error("Zgjidhni kategori ose produkte për promocionin.");
  }
  const date_from = String(data?.date_from || "").slice(0, 10);
  const date_to = String(data?.date_to || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_from) || !/^\d{4}-\d{2}-\d{2}$/.test(date_to)) {
    throw new Error("Datat e promocionit nuk janë të vlefshme.");
  }
  if (date_from > date_to) throw new Error("Data e fillimit nuk mund të jetë pas datës së mbarimit.");
  return {
    name,
    discount_type,
    discount_value,
    applies_to,
    targets,
    date_from,
    date_to,
    time_from: data?.time_from ? String(data.time_from).slice(0, 5) : null,
    time_to: data?.time_to ? String(data.time_to).slice(0, 5) : null,
    active: data?.active === false || data?.active === 0 ? 0 : 1,
  };
}

function createPromotion(data) {
  const v = validatePromotionInput(data);
  const r = sqlite.prepare(`
    INSERT INTO promotions (
      name, discount_type, discount_value, applies_to, target_json,
      date_from, date_to, time_from, time_to, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    v.name,
    v.discount_type,
    v.discount_value,
    v.applies_to,
    JSON.stringify(v.targets),
    v.date_from,
    v.date_to,
    v.time_from,
    v.time_to,
    v.active,
  );
  return getPromotion(r.lastInsertRowid);
}

function updatePromotion(id, data) {
  const existing = getPromotion(id);
  if (!existing) throw new Error("Promocioni nuk u gjet.");
  const merged = {
    name: data?.name !== undefined ? data.name : existing.name,
    discount_type: data?.discount_type !== undefined ? data.discount_type : existing.discount_type,
    discount_value: data?.discount_value !== undefined ? data.discount_value : existing.discount_value,
    applies_to: data?.applies_to !== undefined ? data.applies_to : existing.applies_to,
    targets: data?.targets !== undefined ? data.targets : JSON.parse(existing.target_json || "[]"),
    date_from: data?.date_from !== undefined ? data.date_from : existing.date_from,
    date_to: data?.date_to !== undefined ? data.date_to : existing.date_to,
    time_from: data?.time_from !== undefined ? data.time_from : existing.time_from,
    time_to: data?.time_to !== undefined ? data.time_to : existing.time_to,
    active: data?.active !== undefined ? data.active : !!existing.active,
  };
  const v = validatePromotionInput(merged);
  sqlite.prepare(`
    UPDATE promotions SET
      name = ?, discount_type = ?, discount_value = ?, applies_to = ?, target_json = ?,
      date_from = ?, date_to = ?, time_from = ?, time_to = ?, active = ?
    WHERE id = ?
  `).run(
    v.name,
    v.discount_type,
    v.discount_value,
    v.applies_to,
    JSON.stringify(v.targets),
    v.date_from,
    v.date_to,
    v.time_from,
    v.time_to,
    v.active,
    Number(id),
  );
  return getPromotion(id);
}

function deletePromotion(id) {
  const existing = getPromotion(id);
  if (!existing) throw new Error("Promocioni nuk u gjet.");
  sqlite.prepare("DELETE FROM promotions WHERE id = ?").run(Number(id));
  return { ok: true };
}

function setSetting(key, value) {
  sqlite.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function isSetupDone() {
  return getSetting("setup_done") === "1";
}

/** Llojet e objektit (settings.business_subtype). */
const HOTEL_BUSINESS_SUBTYPES = {
  hotel: { key: "hotel", label: "Hotel", brand: "Revolution HOTEL" },
  motel: { key: "motel", label: "Motel", brand: "Revolution MOTEL" },
  ville: { key: "ville", label: "Villë", brand: "Revolution VILLË" },
  resort: { key: "resort", label: "Resort", brand: "Revolution RESORT" },
  bujtine: { key: "bujtine", label: "Bujtinë", brand: "Revolution BUJTINË" },
};
const HOTEL_BUSINESS_TYPES = HOTEL_BUSINESS_SUBTYPES;

function normalizeBusinessSubtype(type) {
  const raw = String(type || "hotel").trim().toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (raw === "ville" || raw === "villa" || raw === "vill") return "ville";
  if (raw === "bujtine" || raw === "bujtina" || raw === "guesthouse") return "bujtine";
  if (HOTEL_BUSINESS_SUBTYPES[raw]) return raw;
  return "hotel";
}

/** Alias — kode të vjetra që përdorin business_type. */
function normalizeBusinessType(type) {
  return normalizeBusinessSubtype(type);
}

function getBusinessSubtypeInfo(type) {
  return HOTEL_BUSINESS_SUBTYPES[normalizeBusinessSubtype(type)] || HOTEL_BUSINESS_SUBTYPES.hotel;
}

function getBusinessTypeInfo(type) {
  return getBusinessSubtypeInfo(type);
}

/** Lexon llojin e ruajtur (business_subtype, fallback business_type). */
function getStoredBusinessSubtype() {
  const primary = String(getSetting("business_subtype", "") || "").trim();
  if (primary) return normalizeBusinessSubtype(primary);
  const fallback = normalizeBusinessSubtype(getSetting("business_type", "hotel"));
  try {
    if (isSetupDone()) setSetting("business_subtype", fallback);
  } catch {
    /* ignore */
  }
  return fallback;
}

/** Emri i biznesit — biz_name (fiskal/zyrtar) ose restaurant_name (legacy). */
function getBusinessName() {
  const biz = String(getSetting("biz_name", "") || "").trim();
  const rest = String(getSetting("restaurant_name", "") || "").trim();
  return biz || rest;
}

/** Titulli i dritares / UI: p.sh. "Revolution HOTEL — Hotel Marini" */
function getAppWindowTitle({ business_subtype, business_type, restaurant_name } = {}) {
  const subtype = business_subtype != null
    ? business_subtype
    : (business_type != null ? business_type : getStoredBusinessSubtype());
  const info = getBusinessSubtypeInfo(subtype);
  const name = String(
    restaurant_name != null ? restaurant_name : getBusinessName(),
  ).trim();
  if (!name) return info.brand;
  return `${info.brand} — ${info.label} ${name}`;
}

function getSettings() {
  const business_subtype = getStoredBusinessSubtype();
  const restaurant_name = getSetting("restaurant_name", "");
  const business_name = getBusinessName();
  const typeInfo = getBusinessSubtypeInfo(business_subtype);
  return {
    restaurant_name,
    business_name,
    business_subtype,
    business_type: business_subtype,
    business_type_label: typeInfo.label,
    business_subtype_label: typeInfo.label,
    app_brand: typeInfo.brand,
    window_title: getAppWindowTitle({ business_subtype, restaurant_name: business_name }),
    table_count:     getTableCount(),
    version:         getSetting("version", VERSION.versionLabel),
    setup_done:      isSetupDone(),
    biz_phone:       getSetting("biz_phone", ""),
  };
}

function getCategories() {
  return sqlite.prepare(
    "SELECT id, name, sort_order, COALESCE(active, 1) AS active FROM categories ORDER BY sort_order, name",
  ).all().map((c) => ({
    ...c,
    active: Number(c.active) !== 0 ? 1 : 0,
  }));
}

function getCategoryNames(activeOnly = false) {
  const cats = getCategories();
  return (activeOnly ? cats.filter((c) => c.active) : cats).map((c) => c.name);
}

function categoryExists(name) {
  return !!sqlite.prepare("SELECT id FROM categories WHERE name = ?").get(name);
}

function addCategory(name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Emri i kategorisë nuk mund të jetë bosh");
  const maxOrder = sqlite.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories").get().m;
  sqlite.prepare("INSERT INTO categories (name, sort_order, active) VALUES (?, ?, 1)").run(trimmed, maxOrder + 1);
}

/** Stop/Shfaq kategori — fshihet nga menuja, mbetet në admin. Artikujt ndjekin statusin. */
function toggleCategoryActive(name) {
  const cat = sqlite.prepare(
    "SELECT id, name, COALESCE(active, 1) AS active FROM categories WHERE name = ?",
  ).get(name);
  if (!cat) throw new Error("Kategoria nuk u gjet");
  const next = Number(cat.active) !== 0 ? 0 : 1;
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE categories SET active = ? WHERE id = ?").run(next, cat.id);
    sqlite.prepare("UPDATE menu_items SET active = ? WHERE category = ?").run(next, name);
  })();
  return !!next;
}

function deleteCategory(name) {
  const cat = sqlite.prepare("SELECT id FROM categories WHERE name = ?").get(name);
  if (!cat) throw new Error("Kategoria nuk u gjet");
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE menu_items SET active = 0 WHERE category = ?").run(name);
    sqlite.prepare("DELETE FROM categories WHERE id = ?").run(cat.id);
  })();
}

/** Rendit kategori sipas listës së emrave (vetëm admin / pronar). */
function reorderCategories(names) {
  const list = (Array.isArray(names) ? names : [])
    .map((n) => String(n || "").trim())
    .filter(Boolean);
  if (!list.length) throw new Error("Lista e kategorive është bosh");
  const existing = new Set(getCategories().map((c) => c.name));
  for (const name of list) {
    if (!existing.has(name)) throw new Error(`Kategoria nuk u gjet: ${name}`);
  }
  const upd = sqlite.prepare("UPDATE categories SET sort_order = ? WHERE name = ?");
  sqlite.transaction(() => {
    upd.runMany(list.map((name, i) => [i, name]));
  })();
  return getCategories();
}

/**
 * Frëngjisht / emra të prishur → shqip. Bashkon artikujt te kategoria shqipe dhe fshin duplikatet.
 * Ekzekutohet në çdo nisje (idempotent) — cloud sync mund t’i kthejë FR.
 */
const CATEGORY_TO_ALBANIAN = {
  "Boissons chaudes": "Pije të nxehta",
  "Boissons soft": "Pije joalkoolike",
  "Boissons froides": "Pije të ftohta",
  "Bières": "Birra",
  "Bieres": "Birra",
  "Vins": "Vera",
  "Alcools": "Alkool",
  "Petit-déjeuner": "Mëngjes",
  "Petit-dejeuner": "Mëngjes",
  "Petit-djeuner": "Mëngjes",
  "Salades": "Salata",
  "Soupes": "Supa",
  "Pizzas": "Pizza",
  "Burger / Fast-food": "Hamburger / Fast Food",
  "Sandwichs / Toast": "Sanduiç / Toast",
  "Sandwiçe / Toast": "Sanduiç / Toast",
  "Sandwice / Toast": "Sanduiç / Toast",
  "Pâtes": "Pasta",
  "Pates": "Pasta",
  "Viandes": "Mish",
  "Poisson / Fruits de mer": "Peshk / Fruta deti",
  "Plats traditionnels": "Pjata tradicionale",
  "Accompagnements": "Shoqërime",
  "Desserts": "Ëmbëlsira",
  "Menu enfants": "Meny për fëmijë",
  /* emra të prishur (encoding) */
  "Shoqrime": "Shoqërime",
  "Pije t nxehta": "Pije të nxehta",
  "Pije te nxehta": "Pije të nxehta",
  "Pije t ftohta": "Pije të ftohta",
  "Pije te ftohta": "Pije të ftohta",
  "Embelsira": "Ëmbëlsira",
  "Mengjes": "Mëngjes",
  "Meny per femije": "Meny për fëmijë",
};

/** Normalizo për krahasim: pa theksa, pa �/? , lower-case */
function foldCategoryKey(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/\?/g, "")
    .replace(/[^\p{L}\p{N}\s/\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const CATEGORY_FOLD_TO_ALBANIAN = (() => {
  const m = new Map();
  for (const [from, to] of Object.entries(CATEGORY_TO_ALBANIAN)) {
    m.set(foldCategoryKey(from), to);
  }
  /* çelësa shtesë për FR të prishur */
  m.set(foldCategoryKey("Boissons chaudes"), "Pije të nxehta");
  m.set(foldCategoryKey("Accompagnements"), "Shoqërime");
  m.set(foldCategoryKey("Petit dejeuner"), "Mëngjes");
  m.set(foldCategoryKey("Menu enfants"), "Meny për fëmijë");
  m.set(foldCategoryKey("Poisson Fruits de mer"), "Peshk / Fruta deti");
  /* encoding i prishur pa hapësirë (� u hoq) */
  m.set("pije tnxehta", "Pije të nxehta");
  m.set("pije tftohta", "Pije të ftohta");
  m.set("shoqrime", "Shoqërime");
  m.set("embelsira", "Ëmbëlsira");
  return m;
})();

function normalizeCategoryNameToAlbanian(name) {
  const raw = String(name || "").trim();
  if (!raw) return raw;
  if (CATEGORY_TO_ALBANIAN[raw]) return CATEGORY_TO_ALBANIAN[raw];
  const folded = foldCategoryKey(raw);
  if (CATEGORY_FOLD_TO_ALBANIAN.has(folded)) return CATEGORY_FOLD_TO_ALBANIAN.get(folded);
  /* tashmë shqip me theksa të prishur → shqip i saktë */
  for (const to of new Set(Object.values(CATEGORY_TO_ALBANIAN))) {
    if (foldCategoryKey(to) === folded && to !== raw) return to;
  }
  return raw;
}

function normalizeMenuCategoriesToAlbanian() {
  let renamed = 0;
  let merged = 0;
  let deleted = 0;
  const cats = getCategories();
  const byName = new Map(cats.map((c) => [c.name, c]));

  sqlite.transaction(() => {
    for (const cat of cats) {
      const target = normalizeCategoryNameToAlbanian(cat.name);
      if (!target || target === cat.name) continue;

      const existing = byName.get(target);
      if (existing && existing.id !== cat.id) {
        sqlite.prepare("UPDATE menu_items SET category = ? WHERE category = ?").run(target, cat.name);
        sqlite.prepare("DELETE FROM categories WHERE id = ?").run(cat.id);
        byName.delete(cat.name);
        merged += 1;
        deleted += 1;
      } else {
        try {
          sqlite.prepare("UPDATE categories SET name = ? WHERE id = ?").run(target, cat.id);
          sqlite.prepare("UPDATE menu_items SET category = ? WHERE category = ?").run(target, cat.name);
          byName.delete(cat.name);
          byName.set(target, { ...cat, name: target });
          renamed += 1;
        } catch (e) {
          /* UNIQUE — bashko te ekzistuesja */
          if (String(e.message || "").includes("UNIQUE")) {
            sqlite.prepare("UPDATE menu_items SET category = ? WHERE category = ?").run(target, cat.name);
            sqlite.prepare("DELETE FROM categories WHERE id = ?").run(cat.id);
            byName.delete(cat.name);
            merged += 1;
            deleted += 1;
          } else {
            throw e;
          }
        }
      }
    }
  })();

  setSetting("categories_albanian_v2", "1");
  return { renamed, merged, deleted };
}

function verifyAdminPassword(password) {
  return getSetting("admin_password", "") === hashPassword(password);
}

function seedMenuAndCategories() {
  const catCount = sqlite.prepare("SELECT COUNT(*) AS c FROM categories").get().c;
  if (catCount === 0) {
    const ins = sqlite.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)");
    ins.runMany(VERSION.defaultCategories.map((name, i) => [name, i]));
  }
  const menuCount = sqlite.prepare("SELECT COUNT(*) AS c FROM menu_items").get().c;
  if (menuCount === 0) {
    const insMenu = sqlite.prepare(
      "INSERT INTO menu_items (name, category, price, active, sort_order) VALUES (?, ?, ?, 1, ?)",
    );
    const sortByCat = new Map();
    const rows = [];
    for (const item of VERSION.menuSeed) {
      const s = sortByCat.get(item.category) || 0;
      rows.push([item.name, item.category, item.price, s]);
      sortByCat.set(item.category, s + 1);
    }
    insMenu.runMany(rows);
  }
}

/** Në çdo nisje: menu/kategori default nëse mungojnë (p.sh. DB me kategori por pa artikuj). */
function ensureMenuCatalog() {
  let seeded = 0;
  const beforeMenu = sqlite.prepare("SELECT COUNT(*) AS c FROM menu_items").get().c;
  const beforeCat = sqlite.prepare("SELECT COUNT(*) AS c FROM categories").get().c;
  seedMenuAndCategories();
  const afterMenu = sqlite.prepare("SELECT COUNT(*) AS c FROM menu_items").get().c;
  if (afterMenu > beforeMenu) seeded += afterMenu - beforeMenu;

  /* Artikuj me kategori që nuk ekziston te categories → krijo kategori (mos i fsheh). */
  const catNames = new Set(getCategories().map((c) => c.name));
  const orphanCats = sqlite
    .prepare(
      `SELECT DISTINCT trim(category) AS category FROM menu_items
       WHERE category IS NOT NULL AND trim(category) != ''`,
    )
    .all();
  for (const row of orphanCats) {
    const name = String(row.category || "").trim();
    if (!name || catNames.has(name)) continue;
    try {
      addCategory(name);
      catNames.add(name);
    } catch (e) {
      console.warn("ensureMenuCatalog addCategory:", name, e.message);
    }
  }

  if (seeded > 0 || (beforeCat === 0 && afterMenu > 0)) {
    console.log(`[menu] Katalog u plotësua: ${afterMenu} artikuj, ${getCategories().length} kategori`);
  }
  return seeded;
}

/**
 * Çmimet default: 4 kategoritë e pijeve nga seed (çdo nisje ku mungojnë).
 * Ushqimi zerohet vetëm një herë — pronari e rregullon te Admin → Menu.
 */
function applySeedMenuPrices() {
  const pricedCats =
    (VERSION && VERSION.SEED_PRICED_CATEGORIES) ||
    ["Pije të nxehta", "Pije joalkoolike", "Pije të ftohta", "Birra"];

  if (getSetting("menu_food_prices_zero_v1", "") !== "1") {
    const placeholders = pricedCats.map(() => "?").join(", ");
    sqlite
      .prepare(`UPDATE menu_items SET price = 0 WHERE category NOT IN (${placeholders})`)
      .run(...pricedCats);
    setSetting("menu_food_prices_zero_v1", "1");
    setSetting("menu_prices_reset_zero_v1", "1");
  }

  let applied = 0;
  for (const cat of pricedCats) {
    const stat = sqlite
      .prepare(
        `SELECT COUNT(*) AS c, SUM(CASE WHEN price > 0 THEN 1 ELSE 0 END) AS priced
         FROM menu_items WHERE category = ?`,
      )
      .get(cat);
    const forceAll = !!(stat && stat.c > 0 && Number(stat.priced) === 0);
    const upd = sqlite.prepare(
      forceAll
        ? "UPDATE menu_items SET price = ? WHERE category = ? AND name = ?"
        : "UPDATE menu_items SET price = ? WHERE category = ? AND name = ? AND (price IS NULL OR price = 0)",
    );

    for (const item of (VERSION && VERSION.menuSeed) || []) {
      if (item.category !== cat) continue;
      const price = Number(item.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      const r = upd.run(price, item.category, item.name);
      applied += Number(r.changes) || 0;
    }
  }

  if (applied > 0) {
    console.log(
      `[menu] U vendosën ${applied} çmime default (pijet: ${pricedCats.join(", ")})`,
    );
  }
  return applied;
}

function ensureMenuStockPhotos() {
  try {
    try {
      const n = normalizeMenuCategoriesToAlbanian();
      if (n && (n.renamed || n.merged)) {
        console.log("[menu] categories → shqip:", n);
      }
    } catch (e) {
      console.warn("normalizeMenuCategoriesToAlbanian:", e.message);
    }
    const fromPrices = applySeedMenuPrices();
    const menuStockPhotos = require("./menu-stock-photos");
    // Mos mbishkruaj foto ekzistuese (custom/base64) në çdo start — vetëm mungesat.
    const fromStock = menuStockPhotos.applyMissing(
      { getMenuItems, getMenuItemPhoto, setMenuItemPhoto },
      { forceAllStock: false, replaceRemote: false },
    );
    return fromPrices + fromStock;
  } catch (e) {
    console.warn("Menu stock photos:", e.message);
    return 0;
  }
}

function applyRestaurantNameIfEmpty(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;
  if (getSetting("restaurant_name", "").trim()) return false;
  setSetting("restaurant_name", trimmed);
  setSetting("biz_name", trimmed);
  return true;
}

function runSetup({
  restaurant_name,
  admin_password,
  table_count,
  business_subtype,
  business_type,
} = {}) {
  const count = Math.min(30, Math.max(1, Number(table_count) || VERSION.defaultTableCount));
  const type = normalizeBusinessSubtype(
    business_subtype != null ? business_subtype : business_type,
  );
  const name = String(restaurant_name || "").trim();

  sqlite.transaction(() => {
    setSetting("restaurant_name", name);
    setSetting("biz_name", name);
    setSetting("business_subtype", type);
    setSetting("business_type", type); /* alias për kod të vjetër */
    setSetting("admin_password", hashPassword(admin_password));
    setSetting("table_count", count);
    setSetting("version", VERSION.versionLabel);
    setSetting("setup_done", "1");

    sqlite.prepare("DELETE FROM tables").run();
    const insTable = sqlite.prepare(`
      INSERT INTO tables (number, status, display_name, zone_id, sort_order)
      VALUES (?, 'free', ?, ?, ?)
    `);
    let zoneId = sqlite.prepare("SELECT id FROM table_zones ORDER BY sort_order, id LIMIT 1").get()?.id;
    if (!zoneId) {
      const L = localeLayoutLabels();
      sqlite.prepare("INSERT INTO table_zones (name, sort_order) VALUES (?, 0)").run(L.mainZone);
      zoneId = sqlite.prepare("SELECT id FROM table_zones ORDER BY id DESC LIMIT 1").get().id;
    }
    const L = localeLayoutLabels();
    for (let i = 1; i <= count; i++) {
      insTable.run(i, `${L.tablePrefix}${i}`, zoneId, i - 1);
    }
    setSetting("table_count", count);

    seedMenuAndCategories();
  })();
  ensureMenuStockPhotos();
  ensureMenuVatCategories();
  ensureDefaultRooms();
}

function recreateTables(count) {
  const n = Math.min(30, Math.max(1, Number(count) || 1));
  sqlite.transaction(() => {
    setSetting("table_count", n);
    const activeOrders = sqlite.prepare(
      "SELECT COUNT(*) AS c FROM orders WHERE status = 'active'",
    ).get().c;
    if (activeOrders > 0) throw new Error("Ka porosi aktive. Mbyllni tavolinat fillimisht.");

    const existing = sqlite.prepare("SELECT number FROM tables ORDER BY number").all().map(t => t.number);
    const ins = sqlite.prepare("INSERT INTO tables (number, status) VALUES (?, 'free')");
    for (let i = 1; i <= n; i++) {
      if (!existing.includes(i)) ins.run(i);
    }
    sqlite.prepare("DELETE FROM tables WHERE number > ?").run(n);
  })();
}

const VAT_CATEGORIES = ["0", "8", "18"];

/** % TVSH → shkronja ATK (0→A, 8→D, 18→E). C mbetet 0% po ashtu. */
function vatLetterFromCategory(vatCategory) {
  const n = Number(vatCategory);
  if (n === 8) return "D";
  if (n === 18) return "E";
  if (n === 0) return "A";
  return "E";
}

function vatPercentFromCategory(vatCategory) {
  const raw = String(vatCategory ?? "18").trim();
  if (VAT_CATEGORIES.includes(raw)) return Number(raw);
  return 18;
}

function decorateMenuVatFields(row) {
  const cat = String(
    VAT_CATEGORIES.includes(String(row?.vat_category)) ? row.vat_category : "18"
  );
  const pct = vatPercentFromCategory(cat);
  const letter = vatLetterFromCategory(cat);
  return {
    ...row,
    vat_category: cat,
    vat_percent: pct,
    vat_rate: pct,
    vat_letter: letter,
    vat_norm: letter,
    vat_label: `${letter} · ${pct}%`,
  };
}

/** Siguro që menu_items.vat_category është vetëm 0 / 8 / 18. */
function ensureMenuVatCategories() {
  const rows = sqlite
    .prepare("SELECT id, COALESCE(vat_category, '18') AS vat_category FROM menu_items")
    .all();
  const upd = sqlite.prepare("UPDATE menu_items SET vat_category = ? WHERE id = ?");
  let fixed = 0;
  for (const r of rows) {
    const raw = String(r.vat_category ?? "18").trim();
    const next = VAT_CATEGORIES.includes(raw) ? raw : "18";
    if (next !== raw) {
      upd.run(next, r.id);
      fixed += 1;
    }
  }
  return fixed;
}

/** Bashkangjit TVSH-në e produktit në çdo rresht porosie (për kupon + raporte). */
function enrichOrderItemsWithVat(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const ids = [
    ...new Set(
      list
        .map((it) => (it?.menu_item_id != null ? Number(it.menu_item_id) : null))
        .filter((id) => id != null && Number.isFinite(id))
    ),
  ];
  const byId = new Map();
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    const rows = sqlite
      .prepare(
        `SELECT id, COALESCE(vat_category, '18') AS vat_category FROM menu_items WHERE id IN (${ph})`
      )
      .all(...ids);
    for (const r of rows) byId.set(Number(r.id), r.vat_category);
  }
  return list.map((it) => {
    const mid = it?.menu_item_id != null ? Number(it.menu_item_id) : null;
    const fromMenu = mid != null && byId.has(mid) ? byId.get(mid) : null;
    const cat = String(
      VAT_CATEGORIES.includes(String(it?.vat_category))
        ? it.vat_category
        : fromMenu != null && VAT_CATEGORIES.includes(String(fromMenu))
          ? fromMenu
          : "18"
    );
    const pct = vatPercentFromCategory(cat);
    const letter = String(it?.vat_norm || it?.vat_letter || vatLetterFromCategory(cat))
      .trim()
      .toUpperCase();
    const finalLetter = /^[A-E]$/.test(letter) ? letter : vatLetterFromCategory(cat);
    return {
      ...it,
      vat_category: cat,
      vat_percent: pct,
      vat_rate: pct,
      vat_letter: finalLetter,
      vat_norm: finalLetter,
    };
  });
}

function getMenuItems(activeOnly = true, opts = {}) {
  const includePhoto = !!(opts && opts.includePhoto);
  const photoCol = includePhoto
    ? "photo"
    : "CASE WHEN photo IS NOT NULL AND length(trim(COALESCE(photo,''))) > 0 THEN 1 ELSE 0 END AS has_photo";
  const cols = `id, name, category, price, active, ${photoCol}, COALESCE(stock_qty, 0) AS stock_qty, COALESCE(low_stock_threshold, 0) AS low_stock_threshold, COALESCE(vat_category, '18') AS vat_category, COALESCE(sort_order, 0) AS sort_order, COALESCE(barcode, '') AS barcode`;
  const sql = activeOnly
    ? `SELECT ${cols} FROM menu_items
       WHERE active = 1
         AND category IN (SELECT name FROM categories WHERE COALESCE(active, 1) = 1)
       ORDER BY category, sort_order, name`
    : `SELECT ${cols} FROM menu_items ORDER BY category, sort_order, name`;
  return sqlite.prepare(sql).all().map(r => {
    const has_photo = includePhoto
      ? Boolean(String(r.photo || "").trim())
      : Boolean(Number(r.has_photo));
    const out = decorateMenuVatFields({
      ...r,
      stock_qty: Number(r.stock_qty) || 0,
      low_stock_threshold: Number(r.low_stock_threshold) || 0,
      sort_order: Number(r.sort_order) || 0,
      barcode: String(r.barcode || "").trim(),
      has_photo,
    });
    if (!includePhoto) delete out.photo;
    return out;
  });
}

function getMenuItemById(id) {
  const row = sqlite.prepare(`
    SELECT id, name, category, price, active,
      CASE WHEN photo IS NOT NULL AND length(trim(COALESCE(photo,''))) > 0 THEN 1 ELSE 0 END AS has_photo,
      COALESCE(stock_qty, 0) AS stock_qty,
      COALESCE(low_stock_threshold, 0) AS low_stock_threshold,
      COALESCE(vat_category, '18') AS vat_category,
      COALESCE(sort_order, 0) AS sort_order,
      COALESCE(barcode, '') AS barcode
    FROM menu_items WHERE id = ?
  `).get(Number(id));
  if (!row) return null;
  const out = decorateMenuVatFields({
    ...row,
    stock_qty: Number(row.stock_qty) || 0,
    low_stock_threshold: Number(row.low_stock_threshold) || 0,
    sort_order: Number(row.sort_order) || 0,
    barcode: String(row.barcode || "").trim(),
    has_photo: Boolean(Number(row.has_photo)),
  });
  delete out.photo;
  return out;
}

/** Artikuj aktivë me stok ≤0 ose nën pragun (pragu 0 = vetëm alarm kur stoku = 0). */
function getLowStockItems() {
  return sqlite.prepare(`
    SELECT id, name, category, COALESCE(stock_qty, 0) AS stock_qty, low_stock_threshold
    FROM menu_items
    WHERE active = 1
      AND category IN (SELECT name FROM categories WHERE COALESCE(active, 1) = 1)
      AND (
      COALESCE(stock_qty, 0) <= 0
      OR (low_stock_threshold > 0 AND COALESCE(stock_qty, 0) <= low_stock_threshold)
    )
    ORDER BY COALESCE(stock_qty, 0) ASC, name ASC
  `).all().map(r => ({
    ...r,
    stock_qty: Number(r.stock_qty) || 0,
    low_stock_threshold: Number(r.low_stock_threshold) || 0,
  }));
}

function getMenuItemPhoto(id) {
  const row = sqlite.prepare("SELECT photo FROM menu_items WHERE id = ?").get(id);
  return row?.photo ? String(row.photo).trim() : "";
}

function setMenuItemPhoto(id, photo) {
  const val = photo ? String(photo).trim() : "";
  sqlite.prepare("UPDATE menu_items SET photo = ? WHERE id = ?").run(val || null, id);
}

function applySmartVatToAllMenuItems() {
  const { suggestVatFromName } = require("./vat-smart-map");
  const rows = sqlite
    .prepare("SELECT id, name, category, COALESCE(vat_category, '18') AS vat_category FROM menu_items")
    .all();
  const upd = sqlite.prepare("UPDATE menu_items SET vat_category = ? WHERE id = ?");
  let changed = 0;
  let skipped_disputed = 0;
  for (const r of rows) {
    const sug = suggestVatFromName(r.name, { category: r.category, project: "HOTEL" });
    if (sug?.disputed) {
      skipped_disputed += 1;
      continue;
    }
    const next = String(sug?.rate ?? 18);
    if (!VAT_CATEGORIES.includes(next)) continue;
    if (next !== String(r.vat_category)) {
      upd.run(next, r.id);
      changed += 1;
    }
  }
  return { total: rows.length, changed, skipped_disputed };
}

function addMenuItem({ name, category, price, vat_category, stock_qty, low_stock_threshold, barcode, auto_vat }) {
  if (!categoryExists(category)) throw new Error("Kategoria nuk ekziston");
  let vat = VAT_CATEGORIES.includes(String(vat_category)) ? String(vat_category) : null;
  // Smart mapping vetëm kur TVSH mungon (UI e plotëson para ruajtjes)
  if (vat == null) {
    try {
      const { suggestVatFromName } = require("./vat-smart-map");
      const sug = suggestVatFromName(name, { category, project: "HOTEL" });
      vat = sug ? String(sug.rate) : "18";
    } catch {
      vat = "18";
    }
  }
  if (!VAT_CATEGORIES.includes(String(vat))) vat = "18";
  const maxSort = sqlite.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS m FROM menu_items WHERE category = ?",
  ).get(category)?.m;
  const sortOrder = Number(maxSort) + 1;
  const barcodeVal = barcode != null ? String(barcode).trim() : "";
  const r = sqlite.prepare(
    "INSERT INTO menu_items (name, category, price, active, vat_category, sort_order, barcode) VALUES (?, ?, ?, 1, ?, ?, ?)",
  ).run(name.trim(), category, Number(price), vat, sortOrder, barcodeVal || null);
  const id = r.lastInsertRowid;
  if (stock_qty != null && Number.isFinite(Number(stock_qty))) {
    const sq = Math.max(0, Number(stock_qty));
    sqlite.prepare("UPDATE menu_items SET stock_qty = ? WHERE id = ?").run(sq, id);
    console.log(`[stock] set productId=${id} qty=${sq} (new product)`);
  }
  if (low_stock_threshold != null && Number.isFinite(Number(low_stock_threshold))) {
    sqlite.prepare("UPDATE menu_items SET low_stock_threshold = ? WHERE id = ?").run(
      Math.max(0, Number(low_stock_threshold)),
      id,
    );
  }
  try {
    const stock = require("./menu-stock-photos").stockPhotoForName(name.trim());
    if (stock) setMenuItemPhoto(id, stock);
  } catch {
    /* ignore */
  }
  return id;
}

/** Rendit artikujt brenda kategorisë — vetëm admin/pronar. */
function reorderMenuItems(ids) {
  const list = (Array.isArray(ids) ? ids : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!list.length) throw new Error("Lista e produkteve është bosh");
  const getRow = sqlite.prepare("SELECT id, category FROM menu_items WHERE id = ?");
  let category = null;
  for (const id of list) {
    const row = getRow.get(id);
    if (!row) throw new Error(`Produkti nuk u gjet: ${id}`);
    if (category == null) category = row.category;
    else if (row.category !== category) {
      throw new Error("Renditja lejohet vetëm brenda së njëjtës kategori");
    }
  }
  const upd = sqlite.prepare("UPDATE menu_items SET sort_order = ? WHERE id = ?");
  sqlite.transaction(() => {
    upd.runMany(list.map((id, i) => [i, id]));
  })();
  return getMenuItems(false);
}

function updateMenuPrice(id, price) {
  sqlite.prepare("UPDATE menu_items SET price = ? WHERE id = ?").run(Number(price), id);
}

function updateMenuItem(id, { name, category, price, low_stock_threshold, vat_category, stock_qty, barcode }) {
  if (category && !categoryExists(category)) throw new Error("Kategoria nuk ekziston");
  const fields = [];
  const vals = [];
  if (name != null)   { fields.push("name = ?");     vals.push(name.trim()); }
  if (category != null) { fields.push("category = ?"); vals.push(category); }
  if (price != null)  { fields.push("price = ?");    vals.push(Number(price)); }
  if (low_stock_threshold != null) {
    const t = Number(low_stock_threshold);
    if (!Number.isFinite(t) || t < 0) throw new Error("Pragu i stokut duhet të jetë 0 ose më shumë.");
    fields.push("low_stock_threshold = ?");
    vals.push(t);
  }
  if (stock_qty != null) {
    const sq = Number(stock_qty);
    if (!Number.isFinite(sq) || sq < 0) throw new Error("Stoku duhet të jetë 0 ose më shumë.");
    fields.push("stock_qty = ?");
    vals.push(sq);
  }
  if (vat_category != null) {
    if (!VAT_CATEGORIES.includes(String(vat_category))) throw new Error("Norma e TVSH-së e pavlefshme");
    fields.push("vat_category = ?");
    vals.push(String(vat_category));
  }
  if (barcode !== undefined) {
    const bc = barcode == null ? "" : String(barcode).trim();
    fields.push("barcode = ?");
    vals.push(bc || null);
  }
  if (!fields.length) return;
  vals.push(id);
  const before =
    stock_qty != null
      ? Number(
          sqlite.prepare("SELECT COALESCE(stock_qty,0) AS q FROM menu_items WHERE id = ?").get(id)?.q,
        ) || 0
      : null;
  sqlite.prepare(`UPDATE menu_items SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  if (stock_qty != null) {
    console.log(
      `[stock] set productId=${id} qty=${Number(stock_qty)} stockBefore=${before} stockAfter=${Number(stock_qty)}`,
    );
  }
}

function toggleMenuItemActive(id, active) {
  sqlite.prepare("UPDATE menu_items SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
}

function deleteMenuItemPermanent(id) {
  sqlite.prepare("DELETE FROM menu_items WHERE id = ?").run(id);
}

function getTableCount() {
  return Number(sqlite.prepare("SELECT COUNT(*) AS c FROM tables").get().c) || 0;
}

/** Tavolina fizike (pa sllotet «Porosi online» / «Commandes en ligne») — për sync me telefon/cloud. */
function getPhysicalTableCount() {
  const row = sqlite.prepare(`
    SELECT COUNT(*) AS c
    FROM tables t
    LEFT JOIN table_zones z ON z.id = t.zone_id
    WHERE z.name IS NULL
       OR lower(trim(z.name)) NOT IN ('porosi online', 'commandes en ligne')
  `).get();
  const n = Number(row?.c) || 0;
  if (n > 0) return n;
  return getTableCount();
}

function tableLabel(row) {
  const name = String(row?.display_name || "").trim();
  if (name) return name;
  return `T${row?.number || "?"}`;
}

function listTableZones() {
  return sqlite.prepare("SELECT * FROM table_zones ORDER BY sort_order ASC, id ASC").all();
}

function createTableZone(name) {
  const n = String(name || "").trim();
  if (!n) throw new Error("Emri i zonës është i detyrueshëm.");
  const maxSort = sqlite.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM table_zones").get().m;
  const r = sqlite.prepare("INSERT INTO table_zones (name, sort_order) VALUES (?, ?)").run(n, Number(maxSort) + 1);
  setSetting("table_count", getTableCount());
  return sqlite.prepare("SELECT * FROM table_zones WHERE id = ?").get(r.lastInsertRowid);
}

function updateTableZone(id, { name, sort_order } = {}) {
  const row = sqlite.prepare("SELECT * FROM table_zones WHERE id = ?").get(Number(id));
  if (!row) throw new Error("Zona nuk u gjet.");
  const nextName = name != null ? String(name).trim() : row.name;
  if (!nextName) throw new Error("Emri i zonës është i detyrueshëm.");
  sqlite.prepare("UPDATE table_zones SET name = ?, sort_order = ? WHERE id = ?").run(
    nextName,
    sort_order != null ? Number(sort_order) : row.sort_order,
    Number(id),
  );
  return sqlite.prepare("SELECT * FROM table_zones WHERE id = ?").get(Number(id));
}

function deleteTableZone(id) {
  const zoneId = Number(id);
  const row = sqlite.prepare("SELECT * FROM table_zones WHERE id = ?").get(zoneId);
  if (!row) throw new Error("Zona nuk u gjet.");
  const count = sqlite.prepare("SELECT COUNT(*) AS c FROM table_zones").get().c;
  if (count <= 1) throw new Error("Duhet të mbetet të paktën një zonë.");
  const attached = sqlite.prepare("SELECT COUNT(*) AS c FROM tables WHERE zone_id = ?").get(zoneId).c;
  if (attached > 0) throw new Error("Zona ka tavolina — zhvendosini ose fshini tavolinat fillimisht.");
  sqlite.prepare("DELETE FROM table_zones WHERE id = ?").run(zoneId);
  return { ok: true };
}

function nextTableNumber() {
  const row = sqlite.prepare("SELECT COALESCE(MAX(number), 0) AS m FROM tables").get();
  return Number(row.m) + 1;
}

/** Zona default për Restorant & Bar të hotelit (pa prekur zona ekzistuese). */
function ensureHotelFnbZones() {
  const wanted = ["Restoranti", "Bari", "Terrasa"];
  const existing = listTableZones();
  const byLower = new Map(
    existing.map((z) => [String(z.name || "").trim().toLowerCase(), z]),
  );
  /* Nëse ka vetëm «Kryesore» / «Principale», riemërto në Restoranti. */
  const onlyCafeMain =
    existing.length === 1 &&
    ["kryesore", "principale", "main"].includes(
      String(existing[0].name || "").trim().toLowerCase(),
    );
  if (onlyCafeMain) {
    updateTableZone(existing[0].id, { name: "Restoranti", sort_order: 0 });
    byLower.clear();
    byLower.set("restoranti", { ...existing[0], name: "Restoranti" });
  }
  let sort = existing.length
    ? Math.max(...existing.map((z) => Number(z.sort_order) || 0)) + 1
    : 0;
  for (let i = 0; i < wanted.length; i++) {
    const name = wanted[i];
    const key = name.toLowerCase();
    if (byLower.has(key)) continue;
    /* Aliase të zakonshme */
    const aliases = {
      restoranti: ["restaurant", "restorant"],
      bari: ["bar", "barı"],
      terrasa: ["terrace", "terrasa", "terraca", "terasa"],
    };
    const hit = (aliases[key] || []).some((a) => byLower.has(a));
    if (hit) continue;
    const r = sqlite
      .prepare("INSERT INTO table_zones (name, sort_order) VALUES (?, ?)")
      .run(name, sort++);
    byLower.set(key, { id: r.lastInsertRowid, name });
  }
  return listTableZones();
}

function createTable({ display_name, zone_id, number } = {}) {
  const label = String(display_name || "").trim();
  if (!label) throw new Error("Emri i tavolinës është i detyrueshëm.");
  const zoneId = Number(zone_id);
  const zone = sqlite.prepare("SELECT id FROM table_zones WHERE id = ?").get(zoneId);
  if (!zone) throw new Error("Zona nuk u gjet.");
  const maxSort = sqlite.prepare(`
    SELECT COALESCE(MAX(sort_order), -1) AS m FROM tables WHERE zone_id = ?
  `).get(zoneId).m;
  let num = number != null && number !== "" ? Number(number) : nextTableNumber();
  if (!Number.isFinite(num) || num < 1 || Math.floor(num) !== num) {
    throw new Error("Numri i tavolinës duhet të jetë numër i plotë ≥ 1.");
  }
  const clash = sqlite.prepare("SELECT id FROM tables WHERE number = ?").get(num);
  if (clash) throw new Error("Numri i tavolinës është i zënë.");
  const r = sqlite.prepare(`
    INSERT INTO tables (number, status, display_name, zone_id, sort_order)
    VALUES (?, 'free', ?, ?, ?)
  `).run(num, label, zoneId, Number(maxSort) + 1);
  setSetting("table_count", getTableCount());
  return getTableById(r.lastInsertRowid);
}

function getTableById(id) {
  return sqlite.prepare(`
    SELECT t.*, z.name AS zone_name, z.sort_order AS zone_sort
    FROM tables t
    LEFT JOIN table_zones z ON z.id = t.zone_id
    WHERE t.id = ?
  `).get(Number(id));
}

function updateTable(id, { display_name, zone_id, sort_order, number } = {}) {
  const row = getTableById(id);
  if (!row) throw new Error("Tavolina nuk u gjet.");
  const label = display_name != null ? String(display_name).trim() : row.display_name;
  if (!label) throw new Error("Emri i tavolinës është i detyrueshëm.");
  let zoneId = row.zone_id;
  if (zone_id != null) {
    zoneId = Number(zone_id);
    const zone = sqlite.prepare("SELECT id FROM table_zones WHERE id = ?").get(zoneId);
    if (!zone) throw new Error("Zona nuk u gjet.");
  }
  let num = row.number;
  if (number != null && number !== "") {
    num = Number(number);
    if (!Number.isFinite(num) || num < 1 || Math.floor(num) !== num) {
      throw new Error("Numri i tavolinës duhet të jetë numër i plotë ≥ 1.");
    }
    const clash = sqlite
      .prepare("SELECT id FROM tables WHERE number = ? AND id != ?")
      .get(num, Number(id));
    if (clash) throw new Error("Numri i tavolinës është i zënë.");
  }
  sqlite.prepare(`
    UPDATE tables SET display_name = ?, zone_id = ?, sort_order = ?, number = ?
    WHERE id = ?
  `).run(
    label,
    zoneId,
    sort_order != null ? Number(sort_order) : row.sort_order,
    num,
    Number(id),
  );
  setSetting("table_count", getTableCount());
  return getTableById(id);
}

function deleteTable(id) {
  const row = getTableById(id);
  if (!row) throw new Error("Tavolina nuk u gjet.");
  const active = getActiveOrderForTable(Number(id));
  if (active) throw new Error("Tavolina ka porosi aktive — mbylleni fillimisht.");
  sqlite.prepare("DELETE FROM tables WHERE id = ?").run(Number(id));
  setSetting("table_count", getTableCount());
  return { ok: true };
}

const ROOM_TYPES = Object.freeze(["Single", "Double", "Suite", "Familje"]);
const ROOM_STATUSES = Object.freeze(["free", "occupied", "dirty", "maintenance"]);
const HK_TASK_STATUSES = Object.freeze(["dirty", "in_progress", "clean", "maintenance"]);

function normalizeRoomType(type) {
  const t = String(type || "").trim();
  const hit = ROOM_TYPES.find((x) => x.toLowerCase() === t.toLowerCase());
  if (!hit) throw new Error("Lloji i dhomës duhet të jetë: Single, Double, Suite ose Familje.");
  return hit;
}

function normalizeRoomStatus(status) {
  const s = String(status || "free").trim().toLowerCase();
  if (!ROOM_STATUSES.includes(s)) {
    throw new Error("Statusi i dhomës duhet të jetë: free, occupied, dirty ose maintenance.");
  }
  return s;
}

function normalizeHkTaskStatus(status) {
  const s = String(status || "dirty").trim().toLowerCase();
  if (!HK_TASK_STATUSES.includes(s)) {
    throw new Error("Statusi i pastrimit është i pavlefshëm.");
  }
  return s;
}

function getRoomById(id) {
  return sqlite.prepare("SELECT * FROM rooms WHERE id = ?").get(Number(id)) || null;
}

function listRooms() {
  return sqlite.prepare(`
    SELECT * FROM rooms
    ORDER BY floor ASC,
      CAST(room_number AS INTEGER) ASC,
      room_number ASC
  `).all();
}

/**
 * 40 dhoma default kur tabela rooms është bosh:
 * Kati 1–4 → 101–110 … 401–410, Single, 30€/natë, free.
 */
function ensureDefaultRooms() {
  try {
    const n = Number(sqlite.prepare("SELECT COUNT(*) AS c FROM rooms").get()?.c) || 0;
    if (n > 0) return { ok: true, seeded: false, count: n };
  } catch {
    return { ok: false, seeded: false, count: 0 };
  }
  const ins = sqlite.prepare(`
    INSERT INTO rooms (room_number, floor, type, price_per_night, status)
    VALUES (?, ?, 'Single', 30, 'free')
  `);
  sqlite.transaction(() => {
    for (let floor = 1; floor <= 4; floor++) {
      for (let i = 1; i <= 10; i++) {
        const num = String(floor * 100 + i);
        try {
          ins.run(num, floor);
        } catch {
          /* ignore duplicate */
        }
      }
    }
  })();
  const count = Number(sqlite.prepare("SELECT COUNT(*) AS c FROM rooms").get()?.c) || 0;
  return { ok: true, seeded: true, count };
}

function createRoom({ room_number, floor, type, price_per_night, status } = {}) {
  const num = String(room_number ?? "").trim();
  if (!num) throw new Error("Numri i dhomës është i detyrueshëm.");
  const floorNum = Number(floor);
  if (!Number.isFinite(floorNum)) throw new Error("Kati është i detyrueshëm.");
  const roomType = normalizeRoomType(type);
  const price = Number(price_per_night);
  if (!Number.isFinite(price) || price < 0) throw new Error("Çmimi për natë është i pavlefshëm.");
  const st = normalizeRoomStatus(status == null ? "free" : status);
  const existing = sqlite.prepare("SELECT id FROM rooms WHERE room_number = ?").get(num);
  if (existing) throw new Error(`Dhoma ${num} ekziston tashmë.`);
  const r = sqlite.prepare(`
    INSERT INTO rooms (room_number, floor, type, price_per_night, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(num, Math.trunc(floorNum), roomType, price, st);
  return getRoomById(r.lastInsertRowid);
}

function updateRoom(id, { room_number, floor, type, price_per_night, status } = {}) {
  const row = getRoomById(id);
  if (!row) throw new Error("Dhoma nuk u gjet.");
  const num = room_number != null ? String(room_number).trim() : row.room_number;
  if (!num) throw new Error("Numri i dhomës është i detyrueshëm.");
  const floorNum = floor != null ? Number(floor) : Number(row.floor);
  if (!Number.isFinite(floorNum)) throw new Error("Kati është i detyrueshëm.");
  const roomType = type != null ? normalizeRoomType(type) : row.type;
  const price = price_per_night != null ? Number(price_per_night) : Number(row.price_per_night);
  if (!Number.isFinite(price) || price < 0) throw new Error("Çmimi për natë është i pavlefshëm.");
  const st = status != null ? normalizeRoomStatus(status) : row.status;
  const clash = sqlite.prepare("SELECT id FROM rooms WHERE room_number = ? AND id != ?").get(num, Number(id));
  if (clash) throw new Error(`Dhoma ${num} ekziston tashmë.`);
  sqlite.prepare(`
    UPDATE rooms
    SET room_number = ?, floor = ?, type = ?, price_per_night = ?, status = ?
    WHERE id = ?
  `).run(num, Math.trunc(floorNum), roomType, price, st, Number(id));
  return getRoomById(id);
}

function deleteRoom(id) {
  const row = getRoomById(id);
  if (!row) throw new Error("Dhoma nuk u gjet.");
  const activeGuest = getActiveGuestForRoom(id);
  if (activeGuest) throw new Error("Dhoma ka mysafir aktiv — bëni Check-out fillimisht.");
  sqlite.prepare("DELETE FROM rooms WHERE id = ?").run(Number(id));
  return { ok: true };
}

function parseHotelDate(value) {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error("Data duhet të jetë në formatin YYYY-MM-DD.");
  }
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error("Data është e pavlefshme.");
  return s;
}

function hotelNightsBetween(checkIn, checkOut) {
  const a = new Date(`${checkIn}T12:00:00`);
  const b = new Date(`${checkOut}T12:00:00`);
  const ms = b.getTime() - a.getTime();
  if (ms < 0) throw new Error("Data e daljes duhet të jetë pas datës së hyrjes.");
  const nights = Math.max(1, Math.round(ms / 86400000) || 0);
  return nights < 1 ? 1 : nights;
}

function getGuestById(id) {
  return sqlite.prepare("SELECT * FROM guests WHERE id = ?").get(Number(id)) || null;
}

function getActiveGuestForRoom(roomId) {
  return sqlite.prepare(`
    SELECT * FROM guests
    WHERE room_id = ? AND status = 'active'
    ORDER BY id DESC
    LIMIT 1
  `).get(Number(roomId)) || null;
}

function listRoomsWithGuests() {
  try {
    ensureDefaultRooms();
  } catch {
    /* ignore */
  }
  const rooms = listRooms();
  return rooms.map((room) => {
    const guest = getActiveGuestForRoom(room.id);
    if (!guest) return { ...room, active_guest: null, stay: null };
    const bill = buildGuestBill(guest, room);
    return {
      ...room,
      active_guest: guest,
      stay: {
        guest_name: guest.guest_name,
        check_in_date: guest.check_in_date,
        check_out_date: guest.check_out_date,
        persons: guest.persons,
        nights: bill.nights,
        room_total: bill.room_total,
        charges: (bill.charges || []).map((c) => ({
          id: c.id,
          description: c.description,
          amount: Number(c.amount) || 0,
        })),
        charges_total: bill.charges_total,
        total: bill.total,
      },
    };
  });
}

function checkInGuest({
  room_id,
  guest_name,
  phone,
  document_id,
  email,
  nationality,
  persons,
  check_in_date,
  check_out_date,
  deposit,
  notes,
} = {}) {
  const room = getRoomById(room_id);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  if (room.status !== "free") {
    throw new Error("Check-in lejohet vetëm për dhoma të lira.");
  }
  if (getActiveGuestForRoom(room.id)) {
    throw new Error("Dhoma ka tashmë një mysafir aktiv.");
  }
  const name = String(guest_name || "").trim();
  if (!name) throw new Error("Emri i mysafirit është i detyrueshëm.");
  const phoneVal = String(phone || "").trim();
  const docId = String(document_id || "").trim();
  const emailVal = String(email || "").trim();
  if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
    throw new Error("Email-i nuk është i vlefshëm.");
  }
  const nationalityVal = String(nationality || "").trim();
  const notesVal = String(notes || "").trim();
  let depositVal = Number(deposit);
  if (!Number.isFinite(depositVal) || depositVal < 0) depositVal = 0;
  depositVal = Math.round(depositVal * 100) / 100;
  const personsNum = Number(persons);
  if (!Number.isFinite(personsNum) || personsNum < 1) {
    throw new Error("Numri i personave duhet të jetë së paku 1.");
  }
  const inDate = parseHotelDate(check_in_date);
  const outDate = parseHotelDate(check_out_date);
  hotelNightsBetween(inDate, outDate);

  const insert = sqlite.transaction(() => {
    const r = sqlite.prepare(`
      INSERT INTO guests (
        room_id, guest_name, phone, document_id, email, nationality,
        persons, check_in_date, check_out_date, deposit, notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      Number(room.id),
      name,
      phoneVal,
      docId,
      emailVal,
      nationalityVal,
      Math.trunc(personsNum),
      inDate,
      outDate,
      depositVal,
      notesVal,
    );
    sqlite.prepare("UPDATE rooms SET status = 'occupied' WHERE id = ?").run(Number(room.id));
    return getGuestById(r.lastInsertRowid);
  });

  const guest = insert();
  return {
    guest,
    room: getRoomById(room.id),
  };
}

function listRoomChargesForGuest(guestId) {
  return sqlite.prepare(`
    SELECT * FROM room_charges
    WHERE guest_id = ?
    ORDER BY id ASC
  `).all(Number(guestId));
}

function sumRoomChargesForGuest(guestId) {
  const row = sqlite.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM room_charges
    WHERE guest_id = ?
  `).get(Number(guestId));
  return Math.round((Number(row?.total) || 0) * 100) / 100;
}

function addRoomCharge({
  guest_id, room_id, description, amount, service_id, menu_item_id, vat_category,
} = {}) {
  const guestId = Number(guest_id);
  const roomId = Number(room_id);
  if (!guestId || !roomId) throw new Error("guest_id dhe room_id janë të detyrueshëm.");
  const guest = getGuestById(guestId);
  if (!guest) throw new Error("Mysafiri nuk u gjet.");
  if (guest.status !== "active") throw new Error("Mysafiri nuk është aktiv.");
  const room = getRoomById(roomId);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  const desc = String(description || "").trim() || "Charge";
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) throw new Error("Shuma e charge është e pavlefshme.");
  let vat = VAT_CATEGORIES.includes(String(vat_category)) ? String(vat_category) : null;
  const sid = service_id != null && service_id !== "" ? Number(service_id) : null;
  const mid = menu_item_id != null && menu_item_id !== "" ? Number(menu_item_id) : null;
  if (vat == null && sid != null && Number.isFinite(sid)) {
    try {
      const svc = getHotelServiceById(sid);
      if (svc && VAT_CATEGORIES.includes(String(svc.vat_category))) vat = String(svc.vat_category);
    } catch { /* */ }
  }
  if (vat == null && mid != null && Number.isFinite(mid)) {
    try {
      const mi = sqlite
        .prepare("SELECT COALESCE(vat_category, '18') AS vat_category FROM menu_items WHERE id = ?")
        .get(mid);
      if (mi && VAT_CATEGORIES.includes(String(mi.vat_category))) vat = String(mi.vat_category);
    } catch { /* */ }
  }
  if (vat == null) vat = "18";
  const r = sqlite.prepare(`
    INSERT INTO room_charges (guest_id, room_id, description, amount, service_id, menu_item_id, vat_category)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    guestId,
    roomId,
    desc,
    Math.round(amt * 100) / 100,
    sid != null && Number.isFinite(sid) ? sid : null,
    mid != null && Number.isFinite(mid) ? mid : null,
    vat,
  );
  return sqlite.prepare("SELECT * FROM room_charges WHERE id = ?").get(r.lastInsertRowid);
}

/**
 * Ruaj porosinë e ushqimit/pijes te fatura e dhomës (rreshta për artikull).
 * @param {{ table_number?: any, source?: string, decrement_stock?: boolean }} opts
 * source="room_service" → etiketa (RS) + zbret stokun (default).
 * charge-to-room (tavolinë) → pass decrement_stock:false (stoku zbret te closeTable).
 */
function addRoomChargesFromOrderItems(guestId, roomId, items, {
  table_number,
  source,
  decrement_stock,
} = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) throw new Error("Nuk ka artikuj për t'i faturuar në dhomë.");
  const guest = getGuestById(guestId);
  if (!guest || guest.status !== "active") throw new Error("Mysafiri nuk është aktiv.");
  const room = getRoomById(roomId);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  if (Number(guest.room_id) !== Number(roomId)) {
    throw new Error("Mysafiri nuk është në këtë dhomë.");
  }

  const src = String(source || "").trim().toLowerCase();
  const isRoomService = src === "room_service" || src === "rs";
  const tableLabel = isRoomService
    ? "RS"
    : (table_number != null && table_number !== "" ? `T${table_number}` : "POS");
  const enriched = enrichOrderItemsWithVat(list);
  const created = [];
  for (const it of enriched) {
    const name = String(it.name || "Artikull").trim() || "Artikull";
    const qty = Number(it.quantity) || 1;
    const price = Number(it.price) || 0;
    const lineTotal = Math.round(qty * price * 100) / 100;
    if (lineTotal < 0) continue;
    const mid = it.menu_item_id != null ? Number(it.menu_item_id) : null;
    created.push(addRoomCharge({
      guest_id: guestId,
      room_id: roomId,
      description: `${qty}× ${name} (${tableLabel})`,
      amount: lineTotal,
      menu_item_id: mid,
      vat_category: it.vat_category || "18",
    }));
  }
  if (!created.length) throw new Error("Nuk ka artikuj për t'i faturuar në dhomë.");

  /* Stoku: Room Service / POS direkt → zbres; charge-to-room e bën closeTable. */
  const shouldDec = decrement_stock != null ? !!decrement_stock : isRoomService;
  if (shouldDec) {
    try {
      decrementMenuItemStock(list);
    } catch (err) {
      console.warn("[stock] room charge decrement:", err.message);
    }
  }
  return created;
}

function normalizeServicePriceMode(mode) {
  const m = String(mode || "fixed").trim().toLowerCase();
  if (m === "variable" || m === "room_rate" || m === "fixed") return m;
  throw new Error("Mënyra e çmimit është e pavlefshme (fixed / variable / room_rate).");
}

/** Foto reale e kategorisë; nëse baza e ka bosh, merret nga harta lokale. */
function attachCategoryStockPhoto(row) {
  if (!row) return row;
  const current = String(row.photo || "").trim();
  if (current) return { ...row, photo: current };
  try {
    const p = require("./service-stock-photos").stockPhotoForCategoryName(row.name);
    if (p) return { ...row, photo: p };
  } catch { /* */ }
  return { ...row, photo: current };
}

function listHotelServiceCategories() {
  return sqlite.prepare(`
    SELECT * FROM service_categories
    ORDER BY sort_order ASC, id ASC
  `).all().map(attachCategoryStockPhoto);
}

function getHotelServiceCategoryById(id) {
  const row = sqlite.prepare("SELECT * FROM service_categories WHERE id = ?").get(Number(id));
  return row ? attachCategoryStockPhoto(row) : null;
}

function createHotelServiceCategory({ name, icon, photo, sort_order } = {}) {
  const n = String(name || "").trim();
  if (!n) throw new Error("Emri i kategorisë është i detyrueshëm.");
  const clash = sqlite.prepare(
    "SELECT id FROM service_categories WHERE lower(name) = lower(?)",
  ).get(n);
  if (clash) throw new Error(`Kategoria «${n}» ekziston tashmë.`);
  const sort = Number.isFinite(Number(sort_order)) ? Math.trunc(Number(sort_order)) : 100;
  let ph = String(photo || "").trim();
  if (!ph) {
    try {
      ph = require("./service-stock-photos").stockPhotoForCategoryName(n) || "";
    } catch { /* */ }
  }
  const r = sqlite.prepare(`
    INSERT INTO service_categories (name, icon, photo, sort_order) VALUES (?, ?, ?, ?)
  `).run(n, String(icon || "").trim(), ph, sort);
  return getHotelServiceCategoryById(r.lastInsertRowid);
}

function updateHotelServiceCategory(id, { name, icon, photo, sort_order } = {}) {
  const row = getHotelServiceCategoryById(id);
  if (!row) throw new Error("Kategoria nuk u gjet.");
  const n = name != null ? String(name).trim() : row.name;
  if (!n) throw new Error("Emri i kategorisë është i detyrueshëm.");
  const clash = sqlite.prepare(
    "SELECT id FROM service_categories WHERE lower(name) = lower(?) AND id != ?",
  ).get(n, Number(id));
  if (clash) throw new Error(`Kategoria «${n}» ekziston tashmë.`);
  const ic = icon != null ? String(icon).trim() : row.icon;
  const ph = photo != null ? String(photo).trim() : String(row.photo || "");
  const sort = sort_order != null && Number.isFinite(Number(sort_order))
    ? Math.trunc(Number(sort_order))
    : row.sort_order;
  sqlite.prepare(`
    UPDATE service_categories SET name = ?, icon = ?, photo = ?, sort_order = ? WHERE id = ?
  `).run(n, ic, ph, sort, Number(id));
  return getHotelServiceCategoryById(id);
}

function deleteHotelServiceCategory(id) {
  const row = getHotelServiceCategoryById(id);
  if (!row) throw new Error("Kategoria nuk u gjet.");
  const used = sqlite.prepare(
    "SELECT COUNT(*) AS c FROM services WHERE category_id = ?",
  ).get(Number(id));
  if ((used?.c || 0) > 0) {
    throw new Error("Kategoria ka shërbime — zhvendosini ose fshijini së pari.");
  }
  sqlite.prepare("DELETE FROM service_categories WHERE id = ?").run(Number(id));
  return { ok: true };
}

function attachServiceStockPhoto(row) {
  if (!row) return row;
  const current = String(row.photo || "").trim();
  if (current) return { ...row, photo: current };
  try {
    const p = require("./service-stock-photos").stockPhotoForServiceName(row.name);
    if (p) return { ...row, photo: p };
  } catch { /* */ }
  return { ...row, photo: current };
}

function decorateHotelService(row) {
  if (!row) return row;
  return decorateMenuVatFields(attachServiceStockPhoto(row));
}

function applySmartVatToAllServices() {
  const { suggestVatFromName } = require("./vat-smart-map");
  const rows = sqlite
    .prepare(
      `SELECT s.id, s.name, COALESCE(s.vat_category, '18') AS vat_category,
              COALESCE(c.name, '') AS category_name
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id`,
    )
    .all();
  const upd = sqlite.prepare("UPDATE services SET vat_category = ? WHERE id = ?");
  let changed = 0;
  let skipped_disputed = 0;
  for (const r of rows) {
    const sug = suggestVatFromName(r.name, { category: r.category_name, project: "HOTEL" });
    if (sug?.disputed) {
      skipped_disputed += 1;
      continue;
    }
    const next = String(sug?.rate ?? 18);
    if (!VAT_CATEGORIES.includes(next)) continue;
    if (next !== String(r.vat_category)) {
      upd.run(next, r.id);
      changed += 1;
    }
  }
  return { total: rows.length, changed, skipped_disputed };
}

function listHotelServices({ activeOnly = false } = {}) {
  const where = activeOnly ? "WHERE s.active = 1" : "";
  return sqlite.prepare(`
    SELECT
      s.*,
      COALESCE(s.vat_category, '18') AS vat_category,
      c.name AS category_name,
      c.icon AS category_icon,
      c.sort_order AS category_sort
    FROM services s
    LEFT JOIN service_categories c ON c.id = s.category_id
    ${where}
    ORDER BY
      COALESCE(c.sort_order, 999) ASC,
      COALESCE(s.sort_order, 999) ASC,
      s.name COLLATE NOCASE ASC,
      s.id ASC
  `).all().map(decorateHotelService);
}

function listHotelServicesCatalog({ activeOnly = true } = {}) {
  const categories = listHotelServiceCategories();
  const services = listHotelServices({ activeOnly });
  const byCat = new Map(categories.map((c) => [Number(c.id), { ...c, services: [] }]));
  const uncategorized = [];
  for (const s of services) {
    const cid = Number(s.category_id);
    if (byCat.has(cid)) byCat.get(cid).services.push(s);
    else uncategorized.push(s);
  }
  const groups = categories.map((c) => byCat.get(Number(c.id))).filter((g) => g.services.length);
  if (uncategorized.length) {
    groups.push({
      id: null,
      name: "Të tjera",
      icon: "",
      photo: "/service-stock/cat-te-tjera.jpg",
      sort_order: 999,
      services: uncategorized,
    });
  }
  return { categories, services, groups };
}

function getHotelServiceById(id) {
  const row = sqlite.prepare(`
    SELECT
      s.*,
      COALESCE(s.vat_category, '18') AS vat_category,
      c.name AS category_name,
      c.icon AS category_icon
    FROM services s
    LEFT JOIN service_categories c ON c.id = s.category_id
    WHERE s.id = ?
  `).get(Number(id));
  return row ? decorateHotelService(row) : null;
}

function setHotelServicePhoto(id, photo) {
  const val = photo ? String(photo).trim() : "";
  sqlite.prepare("UPDATE services SET photo = ? WHERE id = ?").run(val, Number(id));
  return getHotelServiceById(id);
}

function setHotelServiceCategoryPhoto(id, photo) {
  const val = photo ? String(photo).trim() : "";
  sqlite.prepare("UPDATE service_categories SET photo = ? WHERE id = ?").run(val, Number(id));
  return getHotelServiceCategoryById(id);
}

/** Mbush fotot e kategorive që kanë kolonën bosh (foto custom nuk prishet). */
function ensureHotelServiceCategoryPhotos() {
  try {
    const stock = require("./service-stock-photos");
    const rows = sqlite.prepare("SELECT id, name, photo FROM service_categories").all();
    let n = 0;
    for (const cat of rows) {
      if (String(cat.photo || "").trim()) continue;
      const local = stock.stockPhotoForCategoryName(cat.name);
      if (!local) continue;
      setHotelServiceCategoryPhoto(cat.id, local);
      n++;
    }
    return n;
  } catch (e) {
    return 0;
  }
}

function ensureHotelServiceStockPhotos() {
  try {
    const stock = require("./service-stock-photos");
    /* listHotelServices tashmë bashkangjet photo fallback — lexo rreshta të papërpunuar */
    const rows = sqlite.prepare("SELECT id, name, photo FROM services").all();
    let n = 0;
    for (const item of rows) {
      const current = String(item.photo || "").trim();
      if (current) continue;
      const local = stock.stockPhotoForServiceName(item.name);
      if (!local) continue;
      setHotelServicePhoto(item.id, local);
      n++;
    }
    return n;
  } catch (e) {
    console.warn("Service stock photos:", e.message);
    return 0;
  }
}

function createHotelService({
  name, price, category_id, icon, photo, sort_order, price_mode, active, vat_category,
} = {}) {
  const n = String(name || "").trim();
  if (!n) throw new Error("Emri i shërbimit është i detyrueshëm.");
  const p = Number(price);
  if (!Number.isFinite(p) || p < 0) throw new Error("Çmimi i shërbimit është i pavlefshëm.");
  const clash = sqlite.prepare("SELECT id FROM services WHERE lower(name) = lower(?)").get(n);
  if (clash) throw new Error(`Shërbimi «${n}» ekziston tashmë.`);
  let catId = category_id != null && category_id !== "" ? Number(category_id) : null;
  let catName = "";
  if (catId != null) {
    const cat = getHotelServiceCategoryById(catId);
    if (!cat) throw new Error("Kategoria nuk u gjet.");
    catName = cat.name || "";
  }
  let vat = VAT_CATEGORIES.includes(String(vat_category)) ? String(vat_category) : null;
  if (vat == null) {
    try {
      const { suggestVatFromName } = require("./vat-smart-map");
      const sug = suggestVatFromName(n, { category: catName, project: "HOTEL" });
      vat = sug ? String(sug.rate) : "18";
    } catch {
      vat = "18";
    }
  }
  if (!VAT_CATEGORIES.includes(String(vat))) vat = "18";
  const mode = normalizeServicePriceMode(price_mode == null ? "fixed" : price_mode);
  const sort = Number.isFinite(Number(sort_order)) ? Math.trunc(Number(sort_order)) : 0;
  const act = active === false || active === 0 || active === "0" ? 0 : 1;
  let photoVal = photo != null ? String(photo || "").trim() : "";
  if (!photoVal) {
    try {
      photoVal = require("./service-stock-photos").stockPhotoForServiceName(n) || "";
    } catch { /* */ }
  }
  const r = sqlite.prepare(`
    INSERT INTO services (name, price, category_id, icon, photo, sort_order, price_mode, active, vat_category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    n,
    Math.round(p * 100) / 100,
    catId,
    String(icon || "").trim(),
    photoVal,
    sort,
    mode,
    act,
    vat,
  );
  return getHotelServiceById(r.lastInsertRowid);
}

function updateHotelService(id, {
  name, price, category_id, icon, photo, sort_order, price_mode, active, vat_category,
} = {}) {
  const row = getHotelServiceById(id);
  if (!row) throw new Error("Shërbimi nuk u gjet.");
  const n = name != null ? String(name).trim() : row.name;
  if (!n) throw new Error("Emri i shërbimit është i detyrueshëm.");
  const p = price != null ? Number(price) : Number(row.price);
  if (!Number.isFinite(p) || p < 0) throw new Error("Çmimi i shërbimit është i pavlefshëm.");
  const clash = sqlite.prepare(
    "SELECT id FROM services WHERE lower(name) = lower(?) AND id != ?",
  ).get(n, Number(id));
  if (clash) throw new Error(`Shërbimi «${n}» ekziston tashmë.`);
  let catId = row.category_id;
  if (category_id !== undefined) {
    catId = category_id != null && category_id !== "" ? Number(category_id) : null;
    if (catId != null && !getHotelServiceCategoryById(catId)) {
      throw new Error("Kategoria nuk u gjet.");
    }
  }
  const ic = icon != null ? String(icon).trim() : (row.icon || "");
  const ph = photo != null ? String(photo || "").trim() : (row.photo || "");
  const sort = sort_order != null && Number.isFinite(Number(sort_order))
    ? Math.trunc(Number(sort_order))
    : (row.sort_order || 0);
  const mode = price_mode != null
    ? normalizeServicePriceMode(price_mode)
    : normalizeServicePriceMode(row.price_mode || "fixed");
  const act = active === undefined
    ? (row.active == null ? 1 : Number(row.active) ? 1 : 0)
    : (active === false || active === 0 || active === "0" ? 0 : 1);
  let vat = row.vat_category || "18";
  if (vat_category !== undefined) {
    if (!VAT_CATEGORIES.includes(String(vat_category))) throw new Error("Norma e TVSH-së e pavlefshme");
    vat = String(vat_category);
  }
  sqlite.prepare(`
    UPDATE services
    SET name = ?, price = ?, category_id = ?, icon = ?, photo = ?, sort_order = ?, price_mode = ?, active = ?, vat_category = ?
    WHERE id = ?
  `).run(n, Math.round(p * 100) / 100, catId, ic, ph, sort, mode, act, vat, Number(id));
  return getHotelServiceById(id);
}

function deleteHotelService(id) {
  const row = getHotelServiceById(id);
  if (!row) throw new Error("Shërbimi nuk u gjet.");
  sqlite.prepare("DELETE FROM services WHERE id = ?").run(Number(id));
  return { ok: true };
}

/** Shto shërbim katalogu te room_charges e mysafirit aktiv. */
function addServiceChargeToRoom(roomId, serviceId, {
  quantity, notes, amount,
} = {}) {
  const room = getRoomById(roomId);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  if (room.status !== "occupied") {
    throw new Error("Shërbimi shtohet vetëm në dhoma të zëna.");
  }
  const guest = getActiveGuestForRoom(room.id);
  if (!guest) throw new Error("Nuk ka mysafir aktiv në këtë dhomë.");
  const svc = getHotelServiceById(serviceId);
  if (!svc) throw new Error("Shërbimi nuk u gjet.");
  if (svc.active === 0) throw new Error("Shërbimi është i çaktivizuar.");

  let qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 1) qty = 1;
  qty = Math.min(99, Math.trunc(qty));

  const mode = normalizeServicePriceMode(svc.price_mode || "fixed");
  let unit = Number(svc.price) || 0;
  if (mode === "room_rate") {
    unit = Number(room.price_per_night) || 0;
  } else if (mode === "variable") {
    unit = amount != null ? Number(amount) : Number(svc.price) || 0;
    if (!Number.isFinite(unit) || unit < 0) {
      throw new Error("Shkruani çmimin për këtë shërbim.");
    }
  } else if (amount != null && amount !== "") {
    const override = Number(amount);
    if (Number.isFinite(override) && override >= 0) unit = override;
  }

  const lineTotal = Math.round(unit * qty * 100) / 100;
  const noteTxt = String(notes || "").trim();
  let description = qty > 1 ? `${qty}× ${svc.name}` : String(svc.name);
  if (noteTxt) description += ` — ${noteTxt}`;

  const charge = addRoomCharge({
    guest_id: guest.id,
    room_id: room.id,
    description,
    amount: lineTotal,
    service_id: svc.id,
    vat_category: svc.vat_category || "18",
  });
  return { charge, guest, room, service: svc, quantity: qty, unit_price: unit };
}

function buildGuestBill(guest, room, { check_out_date, services_total, extra_services } = {}) {
  const outDate = check_out_date != null
    ? parseHotelDate(check_out_date)
    : parseHotelDate(guest.check_out_date);
  const nights = hotelNightsBetween(guest.check_in_date, outDate);
  const price = Number(room.price_per_night) || 0;
  const room_total = Math.round(nights * price * 100) / 100;
  const charges = listRoomChargesForGuest(guest.id);
  const charges_total = Math.round(
    charges.reduce((s, c) => s + (Number(c.amount) || 0), 0) * 100,
  ) / 100;
  let extra = Number(extra_services != null ? extra_services : services_total);
  if (!Number.isFinite(extra) || extra < 0) extra = 0;
  extra = Math.round(extra * 100) / 100;
  const services = Math.round((charges_total + extra) * 100) / 100;
  const total = Math.round((room_total + services) * 100) / 100;
  return {
    nights,
    price_per_night: price,
    room_total,
    charges,
    charges_total,
    extra_services: extra,
    services_total: services,
    total,
    check_in_date: guest.check_in_date,
    check_out_date: outDate,
  };
}

function getCheckoutPreview(roomId, opts = {}) {
  const room = getRoomById(roomId);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  if (room.status !== "occupied") {
    throw new Error("Check-out lejohet vetëm për dhoma të zëna.");
  }
  const guest = getActiveGuestForRoom(room.id);
  if (!guest) throw new Error("Nuk u gjet mysafir aktiv për këtë dhomë.");
  const bill = buildGuestBill(guest, room, opts);
  return { guest, room, bill };
}

function checkOutGuest(roomId, { check_out_date, services_total, extra_services } = {}) {
  const preview = getCheckoutPreview(roomId, {
    check_out_date,
    extra_services: extra_services != null ? extra_services : services_total,
  });
  const { guest, room, bill } = preview;

  const paidTotal = Math.round((Number(bill.total) || 0) * 100) / 100;
  const run = sqlite.transaction(() => {
    /* Extra checkout → room_charge që të hyjë menjëherë te Kontabilisti me TVSH */
    const extra = Number(bill.extra_services) || 0;
    if (extra > 0) {
      addRoomCharge({
        guest_id: guest.id,
        room_id: room.id,
        description: "Shërbime ekstra (check-out)",
        amount: extra,
        vat_category: "18",
      });
    }
    try {
      sqlite.prepare(`
        UPDATE guests
        SET status = 'checked_out', check_out_date = ?, total_paid = ?
        WHERE id = ?
      `).run(bill.check_out_date, paidTotal, Number(guest.id));
    } catch {
      sqlite.prepare(`
        UPDATE guests
        SET status = 'checked_out', check_out_date = ?
        WHERE id = ?
      `).run(bill.check_out_date, Number(guest.id));
    }
    sqlite.prepare("UPDATE rooms SET status = 'dirty' WHERE id = ?").run(Number(room.id));
    openHousekeepingTaskForRoom(room.id, { priority: 0 });
    return {
      guest: getGuestById(guest.id),
      room: getRoomById(room.id),
      bill,
    };
  });

  return run();
}

/** Pastruesja: E Papastër → E Lirë */
function markRoomClean(roomId) {
  return completeHousekeepingRoom(roomId);
}

function getOpenHousekeepingTaskForRoom(roomId) {
  return sqlite.prepare(`
    SELECT hk.*, s.name AS assigned_name
    FROM housekeeping_tasks hk
    LEFT JOIN staff s ON s.id = hk.assigned_to
    WHERE hk.room_id = ?
      AND hk.status IN ('dirty', 'in_progress', 'maintenance')
    ORDER BY hk.id DESC
    LIMIT 1
  `).get(Number(roomId)) || null;
}

function openHousekeepingTaskForRoom(roomId, { priority = 0, notes = "" } = {}) {
  const room = getRoomById(roomId);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  const existing = getOpenHousekeepingTaskForRoom(roomId);
  if (existing) {
    if (priority && !existing.priority) {
      sqlite.prepare("UPDATE housekeeping_tasks SET priority = 1 WHERE id = ?").run(existing.id);
    }
    return getOpenHousekeepingTaskForRoom(roomId);
  }
  const r = sqlite.prepare(`
    INSERT INTO housekeeping_tasks (room_id, assigned_to, status, priority, notes)
    VALUES (?, NULL, 'dirty', ?, ?)
  `).run(Number(roomId), priority ? 1 : 0, String(notes || "").trim());
  return sqlite.prepare(`
    SELECT hk.*, s.name AS assigned_name
    FROM housekeeping_tasks hk
    LEFT JOIN staff s ON s.id = hk.assigned_to
    WHERE hk.id = ?
  `).get(r.lastInsertRowid);
}

function syncHousekeepingPrioritiesForToday() {
  const arrivals = listTodaysRoomReservations();
  const arrivalRoomIds = new Set(arrivals.map((a) => Number(a.room_id)));
  for (const roomId of arrivalRoomIds) {
    const room = getRoomById(roomId);
    if (!room) continue;
    if (room.status === "dirty" || room.status === "maintenance") {
      openHousekeepingTaskForRoom(roomId, { priority: 1 });
    } else {
      const task = getOpenHousekeepingTaskForRoom(roomId);
      if (task) {
        sqlite.prepare("UPDATE housekeeping_tasks SET priority = 1 WHERE id = ?").run(task.id);
      }
    }
  }
  /* Ul prioritetin për dhoma pa mbërritje sot */
  const openTasks = sqlite.prepare(`
    SELECT id, room_id FROM housekeeping_tasks
    WHERE status IN ('dirty', 'in_progress', 'maintenance')
  `).all();
  for (const t of openTasks) {
    const prio = arrivalRoomIds.has(Number(t.room_id)) ? 1 : 0;
    sqlite.prepare("UPDATE housekeeping_tasks SET priority = ? WHERE id = ?").run(prio, t.id);
  }
}

function listHousekeepingStaff() {
  return sqlite.prepare(`
    SELECT id, name FROM staff WHERE active = 1 ORDER BY name COLLATE NOCASE ASC
  `).all();
}

/** Bordi i pastrimit — dhoma + task + prioritet mbërritjeje. */
function listHousekeepingBoard() {
  syncHousekeepingPrioritiesForToday();
  /* Siguro task për çdo dhomë dirty/maintenance pa task të hapur */
  for (const room of listRooms()) {
    if (room.status === "dirty" || room.status === "maintenance") {
      openHousekeepingTaskForRoom(room.id, {
        priority: 0,
      });
      if (room.status === "maintenance") {
        const t = getOpenHousekeepingTaskForRoom(room.id);
        if (t && t.status !== "maintenance") {
          sqlite.prepare("UPDATE housekeeping_tasks SET status = 'maintenance' WHERE id = ?").run(t.id);
        }
      }
    }
  }

  const arrivals = listTodaysRoomReservations();
  const arrivalByRoom = new Map(arrivals.map((a) => [Number(a.room_id), a]));
  const rooms = listRoomsWithGuests();

  const rows = rooms.map((room) => {
    const task = getOpenHousekeepingTaskForRoom(room.id);
    const arrival = arrivalByRoom.get(Number(room.id)) || null;
    let hk_status = "clean";
    if (room.status === "occupied") hk_status = "occupied";
    else if (room.status === "maintenance" || task?.status === "maintenance") hk_status = "maintenance";
    else if (task?.status === "in_progress") hk_status = "in_progress";
    else if (room.status === "dirty" || task?.status === "dirty") hk_status = "dirty";
    else hk_status = "clean";

    return {
      room_id: room.id,
      room_number: room.room_number,
      floor: room.floor,
      type: room.type,
      room_status: room.status,
      hk_status,
      priority: task ? Number(task.priority) || 0 : (arrival ? 1 : 0),
      arrival_today: Boolean(arrival),
      arrival_guest: arrival?.guest_name || null,
      assigned_to: task?.assigned_to ?? null,
      assigned_name: task?.assigned_name || null,
      notes: task?.notes || "",
      task_id: task?.id ?? null,
      task_status: task?.status || null,
      active_guest: room.active_guest
        ? { id: room.active_guest.id, guest_name: room.active_guest.guest_name }
        : null,
    };
  });

  rows.sort((a, b) => {
    const pa = (a.priority || a.arrival_today) ? 1 : 0;
    const pb = (b.priority || b.arrival_today) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const order = { dirty: 0, in_progress: 1, maintenance: 2, occupied: 3, clean: 4 };
    const oa = order[a.hk_status] ?? 9;
    const ob = order[b.hk_status] ?? 9;
    if (oa !== ob) return oa - ob;
    if (Number(a.floor) !== Number(b.floor)) return Number(a.floor) - Number(b.floor);
    return String(a.room_number).localeCompare(String(b.room_number), "sq", { numeric: true });
  });

  const counts = {
    all: rows.length,
    dirty: rows.filter((r) => r.hk_status === "dirty" || r.hk_status === "in_progress").length,
    clean: rows.filter((r) => r.hk_status === "clean").length,
    maintenance: rows.filter((r) => r.hk_status === "maintenance").length,
    occupied: rows.filter((r) => r.hk_status === "occupied").length,
    in_progress: rows.filter((r) => r.hk_status === "in_progress").length,
  };

  return { rooms: rows, counts, staff: listHousekeepingStaff() };
}

function assignHousekeepingStaff(roomId, staffId) {
  const room = getRoomById(roomId);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  if (room.status !== "dirty" && room.status !== "maintenance") {
    throw new Error("Pastruesi caktohet për dhoma të papastra ose në mirëmbajtje.");
  }
  let sid = staffId != null && staffId !== "" ? Number(staffId) : null;
  if (sid != null) {
    const staff = sqlite.prepare("SELECT id, name, active FROM staff WHERE id = ?").get(sid);
    if (!staff || !staff.active) throw new Error("Punonjësi nuk u gjet.");
  }
  const task = openHousekeepingTaskForRoom(roomId);
  sqlite.prepare("UPDATE housekeeping_tasks SET assigned_to = ? WHERE id = ?")
    .run(sid, task.id);
  return listHousekeepingBoard().rooms.find((r) => Number(r.room_id) === Number(roomId));
}

function updateHousekeepingNotes(roomId, notes) {
  const room = getRoomById(roomId);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  const task = openHousekeepingTaskForRoom(roomId);
  sqlite.prepare("UPDATE housekeeping_tasks SET notes = ? WHERE id = ?")
    .run(String(notes || "").trim(), task.id);
  return listHousekeepingBoard().rooms.find((r) => Number(r.room_id) === Number(roomId));
}

function startHousekeepingCleaning(roomId) {
  const room = getRoomById(roomId);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  if (room.status === "occupied") throw new Error("Dhoma është e zënë.");
  if (room.status === "maintenance") throw new Error("Dhoma është në mirëmbajtje — përdorni «Gati» së pari.");
  if (room.status !== "dirty") {
    sqlite.prepare("UPDATE rooms SET status = 'dirty' WHERE id = ?").run(Number(roomId));
  }
  const task = openHousekeepingTaskForRoom(roomId);
  sqlite.prepare(`
    UPDATE housekeeping_tasks SET status = 'in_progress', completed_at = NULL WHERE id = ?
  `).run(task.id);
  return listHousekeepingBoard().rooms.find((r) => Number(r.room_id) === Number(roomId));
}

function completeHousekeepingRoom(roomId) {
  const room = getRoomById(roomId);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  if (getActiveGuestForRoom(room.id)) {
    throw new Error("Dhoma ka ende mysafir aktiv.");
  }
  if (room.status === "occupied") throw new Error("Dhoma është e zënë.");
  const task = getOpenHousekeepingTaskForRoom(roomId) || openHousekeepingTaskForRoom(roomId);
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE rooms SET status = 'free' WHERE id = ?").run(Number(roomId));
    sqlite.prepare(`
      UPDATE housekeeping_tasks
      SET status = 'clean', completed_at = datetime('now','localtime')
      WHERE id = ?
    `).run(task.id);
  })();
  return getRoomById(roomId);
}

function setHousekeepingMaintenance(roomId, notes) {
  const room = getRoomById(roomId);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  if (getActiveGuestForRoom(room.id)) {
    throw new Error("Nuk mund të vendoset mirëmbajtje me mysafir aktiv.");
  }
  const task = openHousekeepingTaskForRoom(roomId);
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE rooms SET status = 'maintenance' WHERE id = ?").run(Number(roomId));
    sqlite.prepare(`
      UPDATE housekeeping_tasks
      SET status = 'maintenance',
          notes = CASE WHEN ? != '' THEN ? ELSE notes END,
          completed_at = NULL
      WHERE id = ?
    `).run(String(notes || "").trim(), String(notes || "").trim(), task.id);
  })();
  return listHousekeepingBoard().rooms.find((r) => Number(r.room_id) === Number(roomId));
}

function readyHousekeepingFromMaintenance(roomId) {
  const room = getRoomById(roomId);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  if (room.status !== "maintenance") {
    throw new Error("Vetëm dhomat në mirëmbajtje kalojnë në «Gati».");
  }
  const task = getOpenHousekeepingTaskForRoom(roomId);
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE rooms SET status = 'free' WHERE id = ?").run(Number(roomId));
    if (task) {
      sqlite.prepare(`
        UPDATE housekeeping_tasks
        SET status = 'clean', completed_at = datetime('now','localtime')
        WHERE id = ?
      `).run(task.id);
    }
  })();
  return getRoomById(roomId);
}

function listGuestsHistory({ status, from, to, limit } = {}) {
  const clauses = [];
  const params = [];
  const st = String(status || "").trim().toLowerCase();
  if (st === "active" || st === "checked_out") {
    clauses.push("g.status = ?");
    params.push(st);
  }
  if (from) {
    clauses.push("g.check_in_date >= ?");
    params.push(parseHotelDate(from));
  }
  if (to) {
    clauses.push("g.check_in_date <= ?");
    params.push(parseHotelDate(to));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  return sqlite.prepare(`
    SELECT
      g.*,
      r.room_number,
      r.floor,
      r.type AS room_type,
      r.price_per_night,
      r.status AS room_status
    FROM guests g
    LEFT JOIN rooms r ON r.id = g.room_id
    ${where}
    ORDER BY g.id DESC
    LIMIT ${lim}
  `).all(...params);
}

const ROOM_RESERVATION_STATUSES = Object.freeze([
  "pending",
  "confirmed",
  "cancelled",
  "checked_in",
]);

function normalizeReservationStatus(status, { allowCheckedIn = true } = {}) {
  const s = String(status || "confirmed").trim().toLowerCase();
  if (!ROOM_RESERVATION_STATUSES.includes(s)) {
    throw new Error("Statusi i rezervimit është i pavlefshëm.");
  }
  if (!allowCheckedIn && s === "checked_in") {
    throw new Error("Statusi checked_in vendoset vetëm nga Check-in.");
  }
  return s;
}

function getRoomReservationById(id) {
  return sqlite.prepare(`
    SELECT rv.*, r.room_number, r.floor, r.type AS room_type, r.price_per_night, r.status AS room_status
    FROM reservations rv
    LEFT JOIN rooms r ON r.id = rv.room_id
    WHERE rv.id = ?
  `).get(Number(id)) || null;
}

function datesOverlap(aIn, aOut, bIn, bOut) {
  return aIn < bOut && bIn < aOut;
}

function assertRoomReservationAvailable(roomId, checkIn, checkOut, excludeId = null) {
  const room = getRoomById(roomId);
  if (!room) throw new Error("Dhoma nuk u gjet.");
  hotelNightsBetween(checkIn, checkOut);

  const activeGuest = getActiveGuestForRoom(roomId);
  if (activeGuest) {
    if (datesOverlap(checkIn, checkOut, activeGuest.check_in_date, activeGuest.check_out_date)) {
      throw new Error(`Dhoma ${room.room_number} është e zënë nga mysafiri aktiv në këto data.`);
    }
  }

  const rows = excludeId != null
    ? sqlite.prepare(`
        SELECT id, guest_name, check_in_date, check_out_date, status
        FROM reservations
        WHERE room_id = ?
          AND status IN ('pending', 'confirmed')
          AND id != ?
      `).all(Number(roomId), Number(excludeId))
    : sqlite.prepare(`
        SELECT id, guest_name, check_in_date, check_out_date, status
        FROM reservations
        WHERE room_id = ?
          AND status IN ('pending', 'confirmed')
      `).all(Number(roomId));

  for (const row of rows) {
    if (datesOverlap(checkIn, checkOut, row.check_in_date, row.check_out_date)) {
      throw new Error(
        `Dhoma ${room.room_number} ka rezervim (${row.guest_name}) ${row.check_in_date} → ${row.check_out_date}.`,
      );
    }
  }
  return room;
}

function listRoomReservations({ status, from, to, on_date, limit } = {}) {
  const clauses = [];
  const params = [];
  const st = String(status || "").trim().toLowerCase();
  if (st === "active") {
    clauses.push("rv.status IN ('pending', 'confirmed')");
  } else if (st && ROOM_RESERVATION_STATUSES.includes(st)) {
    clauses.push("rv.status = ?");
    params.push(st);
  }
  if (on_date) {
    const d = parseHotelDate(on_date);
    clauses.push("rv.check_in_date <= ? AND rv.check_out_date > ?");
    params.push(d, d);
  } else {
    if (from) {
      clauses.push("rv.check_out_date > ?");
      params.push(parseHotelDate(from));
    }
    if (to) {
      clauses.push("rv.check_in_date <= ?");
      params.push(parseHotelDate(to));
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const lim = Math.min(500, Math.max(1, Number(limit) || 200));
  return sqlite.prepare(`
    SELECT
      rv.*,
      r.room_number,
      r.floor,
      r.type AS room_type,
      r.price_per_night,
      r.status AS room_status
    FROM reservations rv
    LEFT JOIN rooms r ON r.id = rv.room_id
    ${where}
    ORDER BY rv.check_in_date ASC, rv.id ASC
    LIMIT ${lim}
  `).all(...params);
}

function hotelTodayLocalYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function listTodaysRoomReservations(dateYmd) {
  const day = dateYmd ? parseHotelDate(dateYmd) : hotelTodayLocalYmd();
  return sqlite.prepare(`
    SELECT
      rv.*,
      r.room_number,
      r.floor,
      r.type AS room_type,
      r.price_per_night,
      r.status AS room_status
    FROM reservations rv
    LEFT JOIN rooms r ON r.id = rv.room_id
    WHERE rv.check_in_date = ?
      AND rv.status IN ('pending', 'confirmed')
    ORDER BY rv.id ASC
  `).all(day);
}

/** Rezervime aktive që mbulojnë një datë (për ngjyrën blu të dhomës). */
function listActiveReservationsOnDate(dateYmd) {
  const day = dateYmd ? parseHotelDate(dateYmd) : hotelTodayLocalYmd();
  return listRoomReservations({ on_date: day, status: "active", limit: 500 });
}

function getReservationDayStats(dateYmd) {
  const day = dateYmd ? parseHotelDate(dateYmd) : hotelTodayLocalYmd();
  const arrivals = listTodaysRoomReservations(day);
  const resDepartures = sqlite.prepare(`
    SELECT
      rv.*,
      r.room_number,
      r.floor,
      r.type AS room_type,
      r.price_per_night,
      r.status AS room_status
    FROM reservations rv
    LEFT JOIN rooms r ON r.id = rv.room_id
    WHERE rv.check_out_date = ?
      AND rv.status IN ('pending', 'confirmed')
    ORDER BY rv.id ASC
  `).all(day);
  const guestDepartures = sqlite.prepare(`
    SELECT
      g.id,
      g.guest_name,
      g.phone,
      g.email,
      g.persons,
      g.check_in_date,
      g.check_out_date,
      g.room_id,
      r.room_number,
      r.floor,
      r.type AS room_type
    FROM guests g
    LEFT JOIN rooms r ON r.id = g.room_id
    WHERE g.status = 'active'
      AND g.check_out_date = ?
    ORDER BY g.id ASC
  `).all(day);
  const arrivalPersons = arrivals.reduce((s, r) => s + (Number(r.persons) || 0), 0);
  const departurePersons =
    resDepartures.reduce((s, r) => s + (Number(r.persons) || 0), 0)
    + guestDepartures.reduce((s, r) => s + (Number(r.persons) || 0), 0);
  return {
    date: day,
    arriving_count: arrivals.length,
    arriving_persons: arrivalPersons,
    departing_count: resDepartures.length + guestDepartures.length,
    departing_persons: departurePersons,
    arrivals,
    departures: resDepartures,
    guest_departures: guestDepartures,
  };
}

/** Dhoma të lira për interval — pa overlap me rezervime/mysafirë aktivë. */
function listAvailableRoomsForDates(checkIn, checkOut, excludeReservationId = null) {
  const inDate = parseHotelDate(checkIn);
  const outDate = parseHotelDate(checkOut);
  hotelNightsBetween(inDate, outDate);
  const rooms = listRooms().filter((r) => r.status === "free");
  const available = [];
  for (const room of rooms) {
    try {
      assertRoomReservationAvailable(room.id, inDate, outDate, excludeReservationId);
      available.push(room);
    } catch {
      /* e zënë për ato data */
    }
  }
  return available;
}

function normalizeReservationExtras({ email, notes, deposit } = {}, fallback = {}) {
  const emailVal = email != null ? String(email || "").trim() : String(fallback.email || "").trim();
  if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
    throw new Error("Email-i nuk është i vlefshëm.");
  }
  const notesVal = notes != null ? String(notes || "").trim() : String(fallback.notes || "").trim();
  let depositVal = deposit != null ? Number(deposit) : Number(fallback.deposit || 0);
  if (!Number.isFinite(depositVal) || depositVal < 0) depositVal = 0;
  depositVal = Math.round(depositVal * 100) / 100;
  return { emailVal, notesVal, depositVal };
}

function createRoomReservation({
  room_id,
  guest_name,
  phone,
  email,
  check_in_date,
  check_out_date,
  persons,
  notes,
  deposit,
  status,
} = {}) {
  const name = String(guest_name || "").trim();
  if (!name) throw new Error("Emri i mysafirit është i detyrueshëm.");
  const personsNum = Number(persons);
  if (!Number.isFinite(personsNum) || personsNum < 1) {
    throw new Error("Numri i personave duhet të jetë së paku 1.");
  }
  const inDate = parseHotelDate(check_in_date);
  const outDate = parseHotelDate(check_out_date);
  const st = normalizeReservationStatus(status == null ? "confirmed" : status, {
    allowCheckedIn: false,
  });
  const { emailVal, notesVal, depositVal } = normalizeReservationExtras({ email, notes, deposit });
  assertRoomReservationAvailable(room_id, inDate, outDate, null);
  const r = sqlite.prepare(`
    INSERT INTO reservations (
      room_id, guest_name, phone, email, check_in_date, check_out_date, persons, deposit, notes, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(room_id),
    name,
    String(phone || "").trim(),
    emailVal,
    inDate,
    outDate,
    Math.trunc(personsNum),
    depositVal,
    notesVal,
    st,
  );
  return getRoomReservationById(r.lastInsertRowid);
}

function updateRoomReservation(id, {
  room_id,
  guest_name,
  phone,
  email,
  check_in_date,
  check_out_date,
  persons,
  notes,
  deposit,
  status,
} = {}) {
  const row = getRoomReservationById(id);
  if (!row) throw new Error("Rezervimi nuk u gjet.");
  if (row.status === "checked_in") throw new Error("Rezervimi është tashmë check-in.");
  if (row.status === "cancelled" && status !== "confirmed" && status !== "pending") {
    throw new Error("Rezervimi është i anuluar.");
  }
  const roomId = room_id != null ? Number(room_id) : Number(row.room_id);
  const name = guest_name != null ? String(guest_name).trim() : row.guest_name;
  if (!name) throw new Error("Emri i mysafirit është i detyrueshëm.");
  const phoneVal = phone != null ? String(phone).trim() : row.phone;
  const personsNum = persons != null ? Number(persons) : Number(row.persons);
  if (!Number.isFinite(personsNum) || personsNum < 1) {
    throw new Error("Numri i personave duhet të jetë së paku 1.");
  }
  const inDate = check_in_date != null ? parseHotelDate(check_in_date) : row.check_in_date;
  const outDate = check_out_date != null ? parseHotelDate(check_out_date) : row.check_out_date;
  const st = status != null
    ? normalizeReservationStatus(status, { allowCheckedIn: false })
    : row.status;
  const { emailVal, notesVal, depositVal } = normalizeReservationExtras(
    { email, notes, deposit },
    row,
  );
  if (st === "cancelled") {
    sqlite.prepare(`
      UPDATE reservations
      SET room_id = ?, guest_name = ?, phone = ?, email = ?, check_in_date = ?, check_out_date = ?,
          persons = ?, deposit = ?, notes = ?, status = ?
      WHERE id = ?
    `).run(
      roomId, name, phoneVal, emailVal, inDate, outDate,
      Math.trunc(personsNum), depositVal, notesVal, st, Number(id),
    );
    return getRoomReservationById(id);
  }
  assertRoomReservationAvailable(roomId, inDate, outDate, id);
  sqlite.prepare(`
    UPDATE reservations
    SET room_id = ?, guest_name = ?, phone = ?, email = ?, check_in_date = ?, check_out_date = ?,
        persons = ?, deposit = ?, notes = ?, status = ?
    WHERE id = ?
  `).run(
    roomId, name, phoneVal, emailVal, inDate, outDate,
    Math.trunc(personsNum), depositVal, notesVal, st, Number(id),
  );
  return getRoomReservationById(id);
}

function cancelRoomReservation(id) {
  return updateRoomReservation(id, { status: "cancelled" });
}

/** Kalendar: për çdo dhomë × datë → free | reserved | occupied */
function getRoomAvailabilityCalendar({ from, to } = {}) {
  const fromDate = parseHotelDate(from);
  const toDate = parseHotelDate(to);
  if (fromDate > toDate) throw new Error("Intervali i datave është i pavlefshëm.");

  const dates = [];
  {
    const cur = new Date(`${fromDate}T12:00:00`);
    const end = new Date(`${toDate}T12:00:00`);
    while (cur <= end) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, "0");
      const d = String(cur.getDate()).padStart(2, "0");
      dates.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
  }
  if (dates.length > 62) throw new Error("Kalendari maksimal është 62 ditë.");

  const rooms = listRooms();
  const reservations = listRoomReservations({ from: fromDate, to: toDate, limit: 500 })
    .filter((r) => r.status === "pending" || r.status === "confirmed");
  const activeGuests = listRoomsWithGuests()
    .filter((r) => r.active_guest)
    .map((r) => ({ room_id: r.id, ...r.active_guest, room_number: r.room_number }));

  const rows = rooms.map((room) => {
    const cells = {};
    for (const day of dates) {
      let state = "free";
      let label = "";
      const guest = activeGuests.find((g) => Number(g.room_id) === Number(room.id));
      if (guest && day >= guest.check_in_date && day < guest.check_out_date) {
        state = "occupied";
        label = guest.guest_name;
      } else {
        const res = reservations.find(
          (rv) => Number(rv.room_id) === Number(room.id)
            && day >= rv.check_in_date
            && day < rv.check_out_date,
        );
        if (res) {
          state = "reserved";
          label = res.guest_name;
        } else if (room.status === "dirty" && day === dates[0]) {
          state = "dirty";
          label = "E papastër";
        }
      }
      cells[day] = { state, label };
    }
    return {
      room_id: room.id,
      room_number: room.room_number,
      floor: room.floor,
      type: room.type,
      status: room.status,
      cells,
    };
  });

  return { from: fromDate, to: toDate, dates, rooms: rows };
}

function convertReservationToCheckIn(reservationId) {
  const rv = getRoomReservationById(reservationId);
  if (!rv) throw new Error("Rezervimi nuk u gjet.");
  if (rv.status === "cancelled") throw new Error("Rezervimi është i anuluar.");
  if (rv.status === "checked_in") throw new Error("Rezervimi është tashmë check-in.");

  const result = checkInGuest({
    room_id: rv.room_id,
    guest_name: rv.guest_name,
    phone: rv.phone,
    email: rv.email || "",
    persons: rv.persons,
    check_in_date: rv.check_in_date,
    check_out_date: rv.check_out_date,
    deposit: rv.deposit || 0,
    notes: rv.notes || "",
  });

  sqlite.prepare(`
    UPDATE reservations SET status = 'checked_in' WHERE id = ?
  `).run(Number(reservationId));

  return {
    ...result,
    reservation: getRoomReservationById(reservationId),
  };
}

function getGuestsReport({ from, to } = {}) {
  const rooms = listRoomsWithGuests();
  const roomStats = {
    free: rooms.filter((r) => r.status === "free").length,
    occupied: rooms.filter((r) => r.status === "occupied").length,
    dirty: rooms.filter((r) => r.status === "dirty").length,
    total: rooms.length,
  };
  const activeGuests = rooms.filter((r) => r.active_guest).map((r) => ({
    ...r.active_guest,
    room_number: r.room_number,
    room_type: r.type,
    price_per_night: r.price_per_night,
  }));

  let fromDate = from ? parseHotelDate(from) : null;
  let toDate = to ? parseHotelDate(to) : null;
  if (!fromDate || !toDate) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    toDate = toDate || `${y}-${m}-${d}`;
    const monthStart = `${y}-${m}-01`;
    fromDate = fromDate || monthStart;
  }

  const checkedOut = sqlite.prepare(`
    SELECT
      g.*,
      r.room_number,
      r.type AS room_type,
      r.price_per_night
    FROM guests g
    LEFT JOIN rooms r ON r.id = g.room_id
    WHERE g.status = 'checked_out'
      AND g.check_out_date >= ?
      AND g.check_out_date <= ?
    ORDER BY g.check_out_date DESC, g.id DESC
  `).all(fromDate, toDate);

  let revenueEstimate = 0;
  let nightsTotal = 0;
  for (const g of checkedOut) {
    try {
      const nights = hotelNightsBetween(g.check_in_date, g.check_out_date);
      const price = Number(g.price_per_night) || 0;
      nightsTotal += nights;
      revenueEstimate += nights * price;
    } catch {
      /* skip bad dates */
    }
  }
  revenueEstimate = Math.round(revenueEstimate * 100) / 100;

  return {
    from: fromDate,
    to: toDate,
    rooms: roomStats,
    active_count: activeGuests.length,
    active_guests: activeGuests,
    checked_out_count: checkedOut.length,
    nights_total: nightsTotal,
    revenue_estimate: revenueEstimate,
    recent_checkouts: checkedOut.slice(0, 50),
  };
}

/** Normalizon datat e raportit të hotelit (YYYY-MM-DD). */
function resolveHotelReportRange(from, to) {
  let toDate = to ? parseHotelDate(to) : hotelTodayLocalYmd();
  let fromDate = from ? parseHotelDate(from) : toDate;
  if (fromDate > toDate) {
    const tmp = fromDate;
    fromDate = toDate;
    toDate = tmp;
  }
  return { from: fromDate, to: toDate };
}

function hotelYmdAddDays(ymd, days) {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hotelDaysInclusive(fromYmd, toYmd) {
  const a = new Date(`${fromYmd}T12:00:00`);
  const b = new Date(`${toYmd}T12:00:00`);
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}

function eachHotelYmd(fromYmd, toYmd, fn) {
  let cur = fromYmd;
  while (cur <= toYmd) {
    fn(cur);
    cur = hotelYmdAddDays(cur, 1);
  }
}

function hotelIsoWeekKey(ymd) {
  const d = new Date(`${ymd}T12:00:00`);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNo = 1 + Math.round((d - week1) / 86400000 / 7);
  const y = d.getFullYear();
  return `${y}-W${String(weekNo).padStart(2, "0")}`;
}

function normalizeRoomChargeServiceName(description) {
  let s = String(description || "").trim();
  s = s.replace(/^\d+\s*[×xX]\s*/, "");
  const em = s.indexOf(" — ");
  if (em >= 0) s = s.slice(0, em);
  const hyphen = s.indexOf(" - ");
  if (hyphen >= 0 && hyphen < 80) s = s.slice(0, hyphen);
  return s.trim() || "Të tjera";
}

function guestStayOverlapsDay(guest, dayYmd) {
  const inD = String(guest.check_in_date || "");
  const outD = String(guest.check_out_date || "");
  return Boolean(inD && outD && inD <= dayYmd && outD > dayYmd);
}

function listGuestsOverlappingRange(fromYmd, toYmd) {
  return sqlite.prepare(`
    SELECT
      g.*,
      r.room_number,
      r.floor,
      r.type AS room_type,
      r.price_per_night
    FROM guests g
    LEFT JOIN rooms r ON r.id = g.room_id
    WHERE g.check_in_date <= ?
      AND g.check_out_date >= ?
    ORDER BY g.check_in_date ASC, g.id ASC
  `).all(toYmd, fromYmd);
}

function computeGuestPaidTotal(guest) {
  const stored = Number(guest.total_paid);
  const room = {
    price_per_night: Number(guest.price_per_night) || 0,
  };
  try {
    const bill = buildGuestBill(guest, room);
    /* Pas check-out: prefero totalin e ngrirë në momentin e pagesës. */
    const total_paid = (
      guest.status === "checked_out"
      && Number.isFinite(stored)
      && stored > 0
    ) ? Math.round(stored * 100) / 100 : bill.total;
    return {
      nights: bill.nights,
      room_total: bill.room_total,
      services_total: bill.services_total,
      total_paid,
    };
  } catch {
    const charges = Number(sqlite.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS t FROM room_charges WHERE guest_id = ?
    `).get(Number(guest.id))?.t) || 0;
    const fallback = (Number.isFinite(stored) && stored > 0)
      ? stored
      : charges;
    return {
      nights: 0,
      room_total: 0,
      services_total: Math.round(charges * 100) / 100,
      total_paid: Math.round(fallback * 100) / 100,
    };
  }
}

/** Raport Ocupancy — % zënie ditore + javore për periudhën. */
function getHotelOccupancyReport(from, to) {
  const range = resolveHotelReportRange(from, to);
  try { ensureDefaultRooms(); } catch { /* ignore */ }
  const roomsTotal = Math.max(1, listRooms().length);
  const guests = listGuestsOverlappingRange(range.from, range.to);

  const daily = [];
  eachHotelYmd(range.from, range.to, (day) => {
    const occupiedRoomIds = new Set();
    for (const g of guests) {
      if (guestStayOverlapsDay(g, day) && g.room_id != null) {
        occupiedRoomIds.add(Number(g.room_id));
      }
    }
    const occupied = occupiedRoomIds.size;
    const pct = Math.round((occupied / roomsTotal) * 1000) / 10;
    daily.push({
      date: day,
      occupied,
      free: Math.max(0, roomsTotal - occupied),
      rooms_total: roomsTotal,
      occupancy_pct: pct,
    });
  });

  const weekMap = new Map();
  for (const row of daily) {
    const key = hotelIsoWeekKey(row.date);
    if (!weekMap.has(key)) {
      weekMap.set(key, {
        week: key,
        days: 0,
        occupied_sum: 0,
        from: row.date,
        to: row.date,
      });
    }
    const w = weekMap.get(key);
    w.days += 1;
    w.occupied_sum += row.occupied;
    if (row.date < w.from) w.from = row.date;
    if (row.date > w.to) w.to = row.date;
  }
  const weekly = [...weekMap.values()].map((w) => {
    const avgOccupied = w.days ? w.occupied_sum / w.days : 0;
    return {
      week: w.week,
      from: w.from,
      to: w.to,
      days: w.days,
      avg_occupied: Math.round(avgOccupied * 10) / 10,
      occupancy_pct: Math.round((avgOccupied / roomsTotal) * 1000) / 10,
    };
  });

  const avgPct = daily.length
    ? Math.round((daily.reduce((s, d) => s + d.occupancy_pct, 0) / daily.length) * 10) / 10
    : 0;
  const peak = daily.reduce(
    (best, d) => (!best || d.occupancy_pct > best.occupancy_pct ? d : best),
    null,
  );

  return {
    from: range.from,
    to: range.to,
    rooms_total: roomsTotal,
    days: daily.length,
    avg_occupancy_pct: avgPct,
    peak_day: peak,
    daily,
    weekly,
  };
}

/** Raport të ardhurash — netët + shërbimet + restoranti/bari. */
function getHotelRevenueReport(from, to) {
  const range = resolveHotelReportRange(from, to);
  try { ensureDefaultRooms(); } catch { /* ignore */ }
  const guests = listGuestsOverlappingRange(range.from, range.to);

  const dailyMap = new Map();
  eachHotelYmd(range.from, range.to, (day) => {
    dailyMap.set(day, { date: day, nights: 0, services: 0, restaurant: 0, total: 0 });
  });

  for (const g of guests) {
    const price = Number(g.price_per_night) || 0;
    eachHotelYmd(range.from, range.to, (day) => {
      if (guestStayOverlapsDay(g, day)) {
        const row = dailyMap.get(day);
        if (row) row.nights += price;
      }
    });
  }

  /* Shërbime hoteli (jo ushqim/pije). Ushqimi nga charge-to-room është te daily_log. */
  const chargeRows = sqlite.prepare(`
    SELECT date(created_at) AS d, description, amount
    FROM room_charges
    WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
  `).all(range.from, range.to);
  for (const c of chargeRows) {
    const row = dailyMap.get(c.d);
    if (!row) continue;
    const amt = Number(c.amount) || 0;
    if (isRoomServiceFoodCharge(c.description)) {
      row.restaurant += amt; /* QR Room Service — vetëm te room_charges */
    } else if (!isFoodDrinkRoomCharge(c.description)) {
      row.services += amt;
    }
  }

  const restRows = sqlite.prepare(`
    SELECT date AS d, COALESCE(SUM(total), 0) AS t
    FROM daily_log
    WHERE status = 'completed'
      AND date >= ? AND date <= ?
    GROUP BY date
  `).all(range.from, range.to);
  for (const r of restRows) {
    const row = dailyMap.get(r.d);
    if (row) row.restaurant += Number(r.t) || 0;
  }

  const daily = [...dailyMap.values()].map((row) => {
    const nights = Math.round(row.nights * 100) / 100;
    const services = Math.round(row.services * 100) / 100;
    const restaurant = Math.round(row.restaurant * 100) / 100;
    return {
      date: row.date,
      nights,
      services,
      restaurant,
      total: Math.round((nights + services + restaurant) * 100) / 100,
    };
  });

  const weekMap = new Map();
  for (const row of daily) {
    const key = hotelIsoWeekKey(row.date);
    if (!weekMap.has(key)) {
      weekMap.set(key, {
        week: key,
        from: row.date,
        to: row.date,
        nights: 0,
        services: 0,
        restaurant: 0,
        total: 0,
      });
    }
    const w = weekMap.get(key);
    w.nights += row.nights;
    w.services += row.services;
    w.restaurant += row.restaurant;
    w.total += row.total;
    if (row.date < w.from) w.from = row.date;
    if (row.date > w.to) w.to = row.date;
  }
  const weekly = [...weekMap.values()].map((w) => ({
    week: w.week,
    from: w.from,
    to: w.to,
    nights: Math.round(w.nights * 100) / 100,
    services: Math.round(w.services * 100) / 100,
    restaurant: Math.round(w.restaurant * 100) / 100,
    total: Math.round(w.total * 100) / 100,
  }));

  const nights = Math.round(daily.reduce((s, d) => s + d.nights, 0) * 100) / 100;
  const services = Math.round(daily.reduce((s, d) => s + d.services, 0) * 100) / 100;
  const restaurant = Math.round(daily.reduce((s, d) => s + d.restaurant, 0) * 100) / 100;

  return {
    from: range.from,
    to: range.to,
    by_source: {
      nights,
      services,
      restaurant,
      total: Math.round((nights + services + restaurant) * 100) / 100,
    },
    daily,
    weekly,
  };
}

/** Raport mysafirësh — histori e plotë me total të paguar. */
function getHotelGuestsHistoryReport(from, to) {
  const range = resolveHotelReportRange(from, to);
  const guests = listGuestsOverlappingRange(range.from, range.to);
  const rows = guests.map((g) => {
    const paid = computeGuestPaidTotal(g);
    return {
      id: g.id,
      guest_name: g.guest_name,
      phone: g.phone || "",
      email: g.email || "",
      nationality: g.nationality || "",
      document_id: g.document_id || "",
      persons: Number(g.persons) || 1,
      room_number: g.room_number || "—",
      room_type: g.room_type || "",
      floor: g.floor,
      check_in_date: g.check_in_date,
      check_out_date: g.check_out_date,
      status: g.status,
      deposit: Number(g.deposit) || 0,
      nights: paid.nights,
      room_total: paid.room_total,
      services_total: paid.services_total,
      total_paid: paid.total_paid,
    };
  });
  rows.sort((a, b) => String(b.check_out_date).localeCompare(String(a.check_out_date))
    || Number(b.id) - Number(a.id));

  const totalPaid = Math.round(rows.reduce((s, r) => s + (Number(r.total_paid) || 0), 0) * 100) / 100;
  return {
    from: range.from,
    to: range.to,
    count: rows.length,
    total_paid: totalPaid,
    guests: rows,
  };
}

/** Raport shërbimesh — top 10 sipas të ardhurave. */
function getHotelServicesReport(from, to) {
  const range = resolveHotelReportRange(from, to);
  const charges = sqlite.prepare(`
    SELECT description, amount, created_at
    FROM room_charges
    WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
  `).all(range.from, range.to);

  const catalog = (() => {
    try {
      return listHotelServices({ activeOnly: false });
    } catch {
      try {
        return sqlite.prepare("SELECT id, name, price FROM services").all();
      } catch {
        return [];
      }
    }
  })();
  const catalogNames = catalog
    .map((s) => String(s.name || "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  const stats = new Map();
  for (const c of charges) {
    let name = normalizeRoomChargeServiceName(c.description);
    const hit = catalogNames.find((n) =>
      name.toLowerCase() === n.toLowerCase()
      || name.toLowerCase().startsWith(`${n.toLowerCase()} `)
      || name.toLowerCase().includes(n.toLowerCase()));
    if (hit) name = hit;
    if (!stats.has(name)) stats.set(name, { name, uses: 0, revenue: 0 });
    const row = stats.get(name);
    row.uses += 1;
    row.revenue += Number(c.amount) || 0;
  }

  const top = [...stats.values()]
    .map((r) => ({
      name: r.name,
      uses: r.uses,
      revenue: Math.round(r.revenue * 100) / 100,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.uses - a.uses)
    .slice(0, 10);

  const totalRevenue = Math.round(
    top.reduce((s, r) => s + r.revenue, 0) * 100,
  ) / 100;

  return {
    from: range.from,
    to: range.to,
    charge_count: charges.length,
    total_revenue: Math.round(
      [...stats.values()].reduce((s, r) => s + r.revenue, 0) * 100,
    ) / 100,
    top_services: top,
    top_revenue: totalRevenue,
  };
}

/** Raport dhomash — të ardhura, netë të zëna, ocupancy % për çdo dhomë. */
function getHotelRoomsReport(from, to) {
  const range = resolveHotelReportRange(from, to);
  try { ensureDefaultRooms(); } catch { /* ignore */ }
  const daysInPeriod = hotelDaysInclusive(range.from, range.to);
  const rooms = listRooms();
  const guests = listGuestsOverlappingRange(range.from, range.to);

  const chargeByRoom = new Map();
  const chargeRows = sqlite.prepare(`
    SELECT room_id, COALESCE(SUM(amount), 0) AS t
    FROM room_charges
    WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
    GROUP BY room_id
  `).all(range.from, range.to);
  for (const c of chargeRows) {
    chargeByRoom.set(Number(c.room_id), Number(c.t) || 0);
  }

  const rows = rooms.map((room) => {
    let nightsOccupied = 0;
    let nightsRevenue = 0;
    const price = Number(room.price_per_night) || 0;
    eachHotelYmd(range.from, range.to, (day) => {
      const stayed = guests.some(
        (g) => Number(g.room_id) === Number(room.id) && guestStayOverlapsDay(g, day),
      );
      if (stayed) {
        nightsOccupied += 1;
        nightsRevenue += price;
      }
    });
    const services = chargeByRoom.get(Number(room.id)) || 0;
    const occupancyPct = daysInPeriod
      ? Math.round((nightsOccupied / daysInPeriod) * 1000) / 10
      : 0;
    const nightsRev = Math.round(nightsRevenue * 100) / 100;
    const servicesRev = Math.round(services * 100) / 100;
    return {
      room_id: room.id,
      room_number: room.room_number,
      floor: room.floor,
      type: room.type,
      price_per_night: price,
      nights_occupied: nightsOccupied,
      days_in_period: daysInPeriod,
      occupancy_pct: occupancyPct,
      revenue_nights: nightsRev,
      revenue_services: servicesRev,
      revenue_total: Math.round((nightsRev + servicesRev) * 100) / 100,
    };
  });

  rows.sort((a, b) =>
    b.revenue_total - a.revenue_total
    || b.nights_occupied - a.nights_occupied
    || String(a.room_number).localeCompare(String(b.room_number), "sq", { numeric: true }));

  return {
    from: range.from,
    to: range.to,
    days_in_period: daysInPeriod,
    rooms_total: rooms.length,
    rooms: rows,
  };
}

/** Të gjitha raportet e hotelit për një periudhë (SQLite lokal). */
function getHotelPeriodReports(from, to) {
  const range = resolveHotelReportRange(from, to);
  return {
    from: range.from,
    to: range.to,
    occupancy: getHotelOccupancyReport(range.from, range.to),
    revenue: getHotelRevenueReport(range.from, range.to),
    guests: getHotelGuestsHistoryReport(range.from, range.to),
    services: getHotelServicesReport(range.from, range.to),
    rooms: getHotelRoomsReport(range.from, range.to),
  };
}

function normalizeGuestPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function isFoodDrinkRoomCharge(description) {
  const d = String(description || "");
  return /\(\s*T\d+\s*\)/i.test(d)
    || /\(\s*POS\s*\)/i.test(d)
    || /\(\s*RS\s*\)/i.test(d);
}

function isRoomServiceFoodCharge(description) {
  return /\(\s*RS\s*\)/i.test(String(description || ""));
}

/** Lista CRM e mysafirëve (çdo qëndrim) me kërkim + filtra datash. */
function listHotelGuestsCrm({ q, from, to, status, limit } = {}) {
  const clauses = [];
  const params = [];
  const st = String(status || "").trim().toLowerCase();
  if (st === "active" || st === "checked_out") {
    clauses.push("g.status = ?");
    params.push(st);
  }
  if (from) {
    clauses.push("g.check_in_date >= ?");
    params.push(parseHotelDate(from));
  }
  if (to) {
    clauses.push("g.check_in_date <= ?");
    params.push(parseHotelDate(to));
  }
  const query = String(q || "").trim();
  if (query) {
    const like = `%${query}%`;
    clauses.push(`(
      g.guest_name LIKE ? COLLATE NOCASE
      OR g.phone LIKE ?
      OR g.document_id LIKE ? COLLATE NOCASE
      OR g.email LIKE ? COLLATE NOCASE
      OR g.nationality LIKE ? COLLATE NOCASE
      OR r.room_number LIKE ?
    )`);
    params.push(like, like, like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const lim = Math.min(2000, Math.max(1, Number(limit) || 500));
  const rows = sqlite.prepare(`
    SELECT
      g.*,
      r.room_number,
      r.floor,
      r.type AS room_type,
      r.price_per_night
    FROM guests g
    LEFT JOIN rooms r ON r.id = g.room_id
    ${where}
    ORDER BY g.id DESC
    LIMIT ${lim}
  `).all(...params);

  return rows.map((g) => {
    const paid = computeGuestPaidTotal(g);
    return {
      id: g.id,
      guest_name: g.guest_name,
      phone: g.phone || "",
      document_id: g.document_id || "",
      email: g.email || "",
      nationality: g.nationality || "",
      persons: Number(g.persons) || 1,
      room_id: g.room_id,
      room_number: g.room_number || "—",
      room_type: g.room_type || "",
      floor: g.floor,
      check_in_date: g.check_in_date,
      check_out_date: g.check_out_date,
      status: g.status,
      deposit: Number(g.deposit) || 0,
      notes: g.notes || "",
      nights: paid.nights,
      room_total: paid.room_total,
      services_total: paid.services_total,
      total_paid: paid.total_paid,
    };
  });
}

/** Profili i mysafirit — të gjitha qëndrimet + charges + total historik. */
function getHotelGuestCrmProfile(guestId) {
  const guest = getGuestById(guestId);
  if (!guest) throw new Error("Mysafiri nuk u gjet.");

  const phone = normalizeGuestPhone(guest.phone);
  const doc = String(guest.document_id || "").trim().toLowerCase();
  const nameKey = String(guest.guest_name || "").trim().toLowerCase();

  let candidates = sqlite.prepare(`
    SELECT
      g.*,
      r.room_number,
      r.floor,
      r.type AS room_type,
      r.price_per_night
    FROM guests g
    LEFT JOIN rooms r ON r.id = g.room_id
    ORDER BY g.check_in_date DESC, g.id DESC
  `).all();

  if (phone && phone.length >= 5) {
    candidates = candidates.filter((g) => normalizeGuestPhone(g.phone) === phone);
  } else if (doc) {
    candidates = candidates.filter(
      (g) => String(g.document_id || "").trim().toLowerCase() === doc,
    );
  } else if (nameKey) {
    candidates = candidates.filter((g) => {
      const sameName = String(g.guest_name || "").trim().toLowerCase() === nameKey;
      if (!sameName) return false;
      const p = normalizeGuestPhone(g.phone);
      return !phone || !p || p === phone;
    });
  } else {
    candidates = candidates.filter((g) => Number(g.id) === Number(guest.id));
  }

  if (!candidates.some((g) => Number(g.id) === Number(guest.id))) {
    const self = sqlite.prepare(`
      SELECT
        g.*,
        r.room_number,
        r.floor,
        r.type AS room_type,
        r.price_per_night
      FROM guests g
      LEFT JOIN rooms r ON r.id = g.room_id
      WHERE g.id = ?
    `).get(Number(guest.id));
    if (self) candidates = [self, ...candidates];
  }

  const stays = [];
  const all_charges = [];
  let historical_total = 0;

  for (const g of candidates) {
    const paid = computeGuestPaidTotal(g);
    const charges = listRoomChargesForGuest(g.id).map((c) => ({
      id: c.id,
      guest_id: c.guest_id,
      room_id: c.room_id,
      room_number: g.room_number || "—",
      description: c.description,
      amount: Number(c.amount) || 0,
      created_at: c.created_at,
      kind: isFoodDrinkRoomCharge(c.description) ? "food" : "service",
    }));
    all_charges.push(...charges);
    historical_total += Number(paid.total_paid) || 0;
    stays.push({
      id: g.id,
      guest_name: g.guest_name,
      phone: g.phone || "",
      document_id: g.document_id || "",
      email: g.email || "",
      nationality: g.nationality || "",
      persons: Number(g.persons) || 1,
      room_number: g.room_number || "—",
      room_type: g.room_type || "",
      floor: g.floor,
      check_in_date: g.check_in_date,
      check_out_date: g.check_out_date,
      status: g.status,
      deposit: Number(g.deposit) || 0,
      notes: g.notes || "",
      nights: paid.nights,
      room_total: paid.room_total,
      services_total: paid.services_total,
      total_paid: paid.total_paid,
      charges,
    });
  }

  all_charges.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))
    || Number(b.id) - Number(a.id));

  return {
    guest_id: Number(guest.id),
    identity: {
      guest_name: guest.guest_name,
      phone: guest.phone || "",
      document_id: guest.document_id || "",
      email: guest.email || "",
      nationality: guest.nationality || "",
    },
    stays_count: stays.length,
    historical_total: Math.round(historical_total * 100) / 100,
    stays,
    all_charges,
  };
}

/**
 * Fatura e qëndrimit për print 80mm (aktiv ose checked_out).
 * Ndan shërbimet nga porositë ushqim/pije.
 */
function getGuestFolio(guestId, { check_out_date, extra_services, services_total } = {}) {
  const guest = getGuestById(guestId);
  if (!guest) throw new Error("Mysafiri nuk u gjet.");
  const room = getRoomById(guest.room_id) || {
    id: guest.room_id,
    room_number: "—",
    floor: null,
    type: "",
    price_per_night: 0,
    status: "free",
  };
  const bill = buildGuestBill(guest, room, {
    check_out_date,
    extra_services: extra_services != null ? extra_services : services_total,
  });
  const charges = Array.isArray(bill.charges) ? bill.charges : listRoomChargesForGuest(guest.id);
  const service_lines = [];
  const food_lines = [];
  for (const c of charges) {
    const line = {
      id: c.id,
      description: c.description || "Charge",
      amount: Math.round((Number(c.amount) || 0) * 100) / 100,
      created_at: c.created_at || null,
    };
    if (isFoodDrinkRoomCharge(c.description)) food_lines.push(line);
    else service_lines.push(line);
  }
  if (Number(bill.extra_services) > 0) {
    service_lines.push({
      id: null,
      description: "Shërbime ekstra",
      amount: Number(bill.extra_services),
      created_at: null,
    });
  }

  let hotelName = "Hotel";
  try {
    hotelName = getSetting("restaurant_name", hotelName) || hotelName;
  } catch {
    /* ignore */
  }

  return {
    hotel_name: hotelName,
    guest,
    room,
    bill,
    room_line: {
      description: `${bill.nights} netë × ${Number(bill.price_per_night || 0).toFixed(2)} €`,
      nights: bill.nights,
      price_per_night: bill.price_per_night,
      amount: bill.room_total,
    },
    service_lines,
    food_lines,
    printed_at: new Date().toISOString(),
  };
}

function getRoomFolioPreview(roomId, opts = {}) {
  const preview = getCheckoutPreview(roomId, opts);
  return getGuestFolio(preview.guest.id, {
    check_out_date: opts.check_out_date != null ? opts.check_out_date : preview.bill.check_out_date,
    extra_services: opts.extra_services != null
      ? opts.extra_services
      : (opts.services_total != null ? opts.services_total : preview.bill.extra_services),
  });
}

function getTableLayout() {
  try {
    reconcileOnlinePickupTableLabels();
  } catch (err) {
    console.warn("Online table labels:", err.message);
  }
  try {
    ensureHotelFnbZones();
  } catch (err) {
    console.warn("Hotel F&B zones:", err.message);
  }
  const zones = listTableZones();
  const tables = getTablesWithOrders();
  const assigned = new Set();
  const zonesOut = zones.map((z) => {
    const zt = tables.filter((t) => Number(t.zone_id) === Number(z.id));
    for (const t of zt) assigned.add(t.id);
    return { ...z, tables: zt };
  });
  const orphans = tables.filter((t) => !assigned.has(t.id));
  if (orphans.length) {
    if (zonesOut.length) {
      zonesOut[0] = {
        ...zonesOut[0],
        tables: [...(zonesOut[0].tables || []), ...orphans],
      };
    } else {
      const L = localeLayoutLabels();
      zonesOut.push({
        id: 0,
        name: L.mainZone || "Kryesore",
        sort_order: 0,
        tables: orphans,
      });
    }
  }
  return {
    zones: zonesOut,
    table_count: tables.length,
  };
}

function getTablesWithOrders() {
  const tables = sqlite.prepare(`
    SELECT t.*, z.name AS zone_name, z.sort_order AS zone_sort
    FROM tables t
    LEFT JOIN table_zones z ON z.id = t.zone_id
    ORDER BY COALESCE(z.sort_order, 999), z.id, t.sort_order, t.number
  `).all();
  const activeOrders = sqlite.prepare("SELECT * FROM orders WHERE status = 'active'").all();
  const orderByTable = {};
  for (const o of activeOrders) orderByTable[o.table_id] = o;

  return tables.map(t => {
    const order = orderByTable[t.id] || null;
    let itemCount = 0;
    let items = [];
    if (order) {
      items = JSON.parse(order.items_json || "[]");
      itemCount = items.reduce((s, i) => s + i.quantity, 0);
    }
    return {
      ...t,
      label: tableLabel(t),
      order,
      items,
      item_count: itemCount,
    };
  });
}

function parseOrderItems(json) {
  try {
    return JSON.parse(json || "[]");
  } catch {
    return [];
  }
}

function recordPrintedBatch(orderId, itemsJson) {
  const order = sqlite.prepare("SELECT batch_count FROM orders WHERE id = ?").get(orderId);
  if (!order) return 0;
  const batchNo = (Number(order.batch_count) || 0) + 1;
  sqlite.prepare(`
    UPDATE orders SET batch_count = ?, last_slip_items_json = ? WHERE id = ?
  `).run(batchNo, itemsJson, orderId);
  return batchNo;
}

function syncSlipSnapshot(orderId, itemsJson) {
  sqlite.prepare("UPDATE orders SET last_slip_items_json = ? WHERE id = ?").run(itemsJson, orderId);
}

function getOrderSlipDelta(order) {
  if (!order) return [];
  const { diffOrderItems } = require("./kitchen-ticket-html");
  const printed = parseOrderItems(order.last_slip_items_json);
  const current = parseOrderItems(order.items_json);
  return diffOrderItems(printed, current);
}

function getActiveOrderForTable(tableId) {
  return sqlite.prepare(
    "SELECT * FROM orders WHERE table_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
  ).get(tableId);
}

function getOrderByCloudId(cloudOrderId) {
  const id = String(cloudOrderId || "").trim();
  if (!id) return null;
  // Kontrollo çdo status (përfshirë completed) — parandalon ri-importin pas pagesës
  const direct = sqlite.prepare(
    "SELECT * FROM orders WHERE cloud_order_id = ? ORDER BY id DESC LIMIT 1",
  ).get(id);
  if (direct) return direct;
  try {
    const links = JSON.parse(getSetting("cloud_order_id_links", "{}"));
    const orderId = links[id];
    if (orderId) {
      return sqlite.prepare(
        "SELECT * FROM orders WHERE id = ? ORDER BY id DESC LIMIT 1",
      ).get(Number(orderId));
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Porosi aktive me këtë cloud_order_id — në çdo tavolinë (1 porosi = 1 ID). */
function getActiveOrderByCloudId(cloudOrderId) {
  const id = String(cloudOrderId || "").trim();
  if (!id) return null;
  const direct = sqlite.prepare(
    "SELECT * FROM orders WHERE cloud_order_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
  ).get(id);
  if (direct) return direct;
  try {
    const links = JSON.parse(getSetting("cloud_order_id_links", "{}"));
    const orderId = links[id];
    if (orderId) {
      return sqlite.prepare(
        "SELECT * FROM orders WHERE id = ? AND status = 'active'",
      ).get(Number(orderId));
    }
  } catch {
    /* ignore */
  }
  return null;
}

function isCloudOrderHandledLocally(cloudOrderId) {
  const prior = getOrderByCloudId(cloudOrderId);
  if (!prior) return false;
  const st = String(prior.status || "").toLowerCase();
  // active = në punë; completed/cancelled = tashmë mbyllur/anuluar lokalisht — mos ri-importo nga cloud
  return st === "active" || st === "completed" || st === "cancelled";
}

// Merr të gjitha cloud order ID-të të lidhura me një porosi lokale (direkt + nga links)
function getLinkedCloudOrderIds(localOrderId) {
  const id = Number(localOrderId);
  if (!id) return [];
  const ids = new Set();
  const row = sqlite.prepare("SELECT cloud_order_id FROM orders WHERE id = ?").get(id);
  if (row?.cloud_order_id) ids.add(String(row.cloud_order_id).trim());
  try {
    const links = JSON.parse(getSetting("cloud_order_id_links", "{}"));
    for (const [cloudId, localId] of Object.entries(links)) {
      if (Number(localId) === id && cloudId) ids.add(cloudId);
    }
  } catch { /* ignore */ }
  return [...ids].filter(Boolean);
}

function linkCloudOrderId(localOrderId, cloudOrderId) {
  const cloudId = String(cloudOrderId || "").trim();
  const orderId = Number(localOrderId);
  if (!cloudId || !orderId) return;
  let links = {};
  try {
    links = JSON.parse(getSetting("cloud_order_id_links", "{}"));
  } catch {
    links = {};
  }
  links[cloudId] = orderId;
  const entries = Object.entries(links).slice(-500);
  setSetting("cloud_order_id_links", JSON.stringify(Object.fromEntries(entries)));
}

/** Radha lokale e porosive QR/online — mbetet deri sa kamarieri pranon me PIN */
function loadDismissedCloudOrderIds() {
  try {
    return new Set(JSON.parse(getSetting("online_orders_local_ack_ids", "[]")));
  } catch {
    return new Set();
  }
}

function upsertPendingCloudOrders(orders) {
  try {
    const dismissed = loadDismissedCloudOrderIds();
    const now = new Date().toISOString();
    const stmt = sqlite.prepare(`
      INSERT INTO pending_cloud_orders (cloud_id, payload_json, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cloud_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        last_seen_at = excluded.last_seen_at
    `);
    for (const o of orders || []) {
      const id = String(o?.id || "").trim();
      if (!id || dismissed.has(id)) continue;
      stmt.run(id, JSON.stringify(o), now, now);
    }
  } catch (err) {
    console.warn("upsertPendingCloudOrders:", err.message);
  }
}

function listPendingCloudOrders() {
  try {
    const dismissed = loadDismissedCloudOrderIds();
    const rows = sqlite.prepare(
      "SELECT payload_json, cloud_id FROM pending_cloud_orders ORDER BY first_seen_at ASC, last_seen_at ASC",
    ).all();
    const orders = [];
    for (const row of rows) {
      const id = String(row.cloud_id || "").trim();
      if (id && dismissed.has(id)) continue;
      try {
        const parsed = JSON.parse(row.payload_json);
        if (parsed?.id) orders.push(parsed);
      } catch {
        /* skip */
      }
    }
    return orders;
  } catch (err) {
    console.warn("listPendingCloudOrders:", err.message);
    return [];
  }
}

/** cloud_id → first_seen_at (ISO) — për auto-expire 60s në panel kamarieri. */
function listPendingCloudOrderFirstSeen() {
  try {
    const rows = sqlite.prepare(
      "SELECT cloud_id, first_seen_at FROM pending_cloud_orders",
    ).all();
    const map = new Map();
    for (const row of rows || []) {
      const id = String(row.cloud_id || "").trim();
      if (id && row.first_seen_at) map.set(id, row.first_seen_at);
    }
    return map;
  } catch (err) {
    console.warn("listPendingCloudOrderFirstSeen:", err.message);
    return new Map();
  }
}

function removePendingCloudOrders(ids) {
  try {
    const stmt = sqlite.prepare("DELETE FROM pending_cloud_orders WHERE cloud_id = ?");
    for (const id of ids || []) {
      const cid = String(id || "").trim();
      if (cid) stmt.run(cid);
    }
  } catch (err) {
    console.warn("removePendingCloudOrders:", err.message);
  }
}

function mergeOrderItemsLocal(base, added) {
  const map = new Map();
  for (const it of base || []) {
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    map.set(orderItemKey(it), { ...it, quantity: qty });
  }
  for (const it of added || []) {
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    const k = orderItemKey(it);
    const prev = map.get(k);
    if (prev) prev.quantity += qty;
    else map.set(k, { ...it, quantity: qty });
  }
  return [...map.values()].filter(it => it.quantity > 0);
}

function getTableByNumber(number) {
  const n = Number(number);
  if (!Number.isFinite(n) || n <= 0) return null;
  return sqlite.prepare("SELECT * FROM tables WHERE number = ?").get(n);
}

function ensureOnlinePickupZone() {
  let zone = sqlite
    .prepare(
      "SELECT * FROM table_zones WHERE lower(trim(name)) IN ('porosi online', 'commandes en ligne') ORDER BY id LIMIT 1",
    )
    .get();
  if (!zone) {
    const L = localeLayoutLabels();
    const maxSort = sqlite.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM table_zones").get().m;
    const r = sqlite.prepare("INSERT INTO table_zones (name, sort_order) VALUES (?, ?)").run(
      L.onlineZone,
      Number(maxSort) + 1,
    );
    zone = sqlite.prepare("SELECT * FROM table_zones WHERE id = ?").get(r.lastInsertRowid);
  }
  return zone;
}

function onlineSlotNumberFromTable(row) {
  const name = String(row?.display_name || "").trim();
  const m = name.match(/^Online\s+(\d+)$/i);
  return m ? Number(m[1]) || 0 : 0;
}

function listOnlinePickupTables() {
  const zone = ensureOnlinePickupZone();
  return sqlite.prepare(
    "SELECT * FROM tables WHERE zone_id = ? ORDER BY sort_order ASC, number ASC, id ASC",
  ).all(zone.id);
}

/** Rregullon emrat Online 1, 2, 3… (heq dublikatat «Online 6»). */
function reconcileOnlinePickupTableLabels() {
  const zone = ensureOnlinePickupZone();
  const tables = sqlite.prepare(
    "SELECT * FROM tables WHERE zone_id = ? ORDER BY id ASC",
  ).all(zone.id);
  tables.forEach((t, idx) => {
    const label = `Online ${idx + 1}`;
    const sort = idx;
    if (t.display_name !== label || Number(t.sort_order) !== sort) {
      sqlite.prepare("UPDATE tables SET display_name = ?, sort_order = ? WHERE id = ?").run(label, sort, t.id);
    }
  });
}

function ensureMinimumOnlineSlots(minCount = 5) {
  const zone = ensureOnlinePickupZone();
  reconcileOnlinePickupTableLabels();
  let tables = listOnlinePickupTables();
  while (tables.length < minCount) {
    const nextNum = tables.length + 1;
    const label = `Online ${nextNum}`;
    const num = nextTableNumber();
    sqlite.prepare(`
      INSERT INTO tables (number, status, display_name, zone_id, sort_order)
      VALUES (?, 'free', ?, ?, ?)
    `).run(num, label, zone.id, nextNum - 1);
    tables = listOnlinePickupTables();
  }
  setSetting("table_count", getTableCount());
}

function nextOnlineSlotNumber(zoneId) {
  const rows = sqlite.prepare("SELECT display_name FROM tables WHERE zone_id = ?").all(zoneId);
  let max = 0;
  for (const r of rows) {
    max = Math.max(max, onlineSlotNumberFromTable(r));
  }
  return max + 1;
}

function findOnlinePickupTableBySlotIndex(slotIndex) {
  const zone = ensureOnlinePickupZone();
  const want = Math.max(1, Number(slotIndex) || 1);
  ensureMinimumOnlineSlots(Math.max(6, want));
  reconcileOnlinePickupTableLabels();
  const tables = listOnlinePickupTables();
  const byLabel = tables.find(t => onlineSlotNumberFromTable(t) === want);
  if (byLabel) return byLabel;
  if (tables[want - 1]) return tables[want - 1];
  return findFreeOnlinePickupTable();
}

function findFreeOnlinePickupTable() {
  const zone = ensureOnlinePickupZone();
  ensureMinimumOnlineSlots(5);
  const tables = listOnlinePickupTables();
  for (const t of tables) {
    if (!getActiveOrderForTable(t.id)) return t;
  }
  const slot = nextOnlineSlotNumber(zone.id);
  const label = `Online ${slot}`;
  const num = nextTableNumber();
  sqlite.prepare(`
    INSERT INTO tables (number, status, display_name, zone_id, sort_order)
    VALUES (?, 'free', ?, ?, ?)
  `).run(num, label, zone.id, slot - 1);
  setSetting("table_count", getTableCount());
  const row = sqlite.prepare("SELECT * FROM tables WHERE number = ?").get(num);
  if (!row) throw new Error("Nuk u krijua tavolina për porosi online.");
  return row;
}

function findOnlinePickupTableForWaiter(waiterName) {
  const name = String(waiterName || "").trim();
  if (!name) return null;
  const zone = ensureOnlinePickupZone();
  const tables = sqlite.prepare(
    "SELECT * FROM tables WHERE zone_id = ? ORDER BY sort_order, number",
  ).all(zone.id);
  for (const t of tables) {
    const active = getActiveOrderForTable(t.id);
    if (active && String(active.waiter_name || "").trim() === name) return t;
  }
  return null;
}

function mapCloudItemsToLocal(items) {
  const menu = getMenuItems(true);
  const byName = new Map(menu.map(m => [String(m.name || "").trim().toLowerCase(), m]));
  const byId = new Map(menu.map(m => [Number(m.id), m]));
  const mapped = (items || []).map(it => {
    const localId = it.menu_item_id ?? it.menu_id ?? it.local_id ?? it.id;
    let mi = localId != null ? byId.get(Number(localId)) : null;
    const rawName = String(it.name || it.emri || it.item_name || "").trim();
    if (!mi && rawName) mi = byName.get(rawName.toLowerCase());
    const qty = Number(it.quantity ?? it.sasia ?? 1) || 1;
    const price = Number(it.price ?? it.cmimi ?? mi?.price ?? 0);
    return {
      menu_item_id: mi?.id ?? (localId != null ? Number(localId) : null),
      name: String(rawName || mi?.name || "Artikull").trim(),
      price,
      quantity: qty,
      vat_category: mi?.vat_category,
    };
  }).filter(it => {
    const qty = Number(it.quantity) || 0;
    const name = String(it.name || "").trim();
    return qty > 0 && !!name;
  });
  return enrichOrderItemsWithVat(mapped);
}

function ensureTableExistsForNumber(tableNum) {
  const n = Number(tableNum);
  if (!n || n < 1) return null;
  const existing = getTableByNumber(n);
  if (existing) return existing;
  const zone = sqlite.prepare("SELECT id FROM table_zones ORDER BY sort_order, id LIMIT 1").get();
  const zoneId = zone?.id ?? null;
  sqlite.prepare(`
    INSERT INTO tables (number, status, display_name, zone_id, sort_order)
    VALUES (?, 'free', ?, ?, ?)
  `).run(n, `${localeLayoutLabels().tablePrefix}${n}`, zoneId, n);
  setSetting("table_count", Math.max(getTableCount(), n));
  return getTableByNumber(n);
}

function ensureTablesForPendingCloudOrders(orders) {
  let changed = false;
  for (const raw of orders || []) {
    if (!isCloudQrTableOrder(raw)) continue;
    const n = parseQrTableNumberFromCloudOrder(raw);
    if (n > 0) {
      const before = getTableByNumber(n);
      ensureTableExistsForNumber(n);
      if (!before) changed = true;
    }
  }
  return changed;
}

function parseTableNumberFromCloudOrder(cloudOrder) {
  const direct = Number(cloudOrder?.table_number) || 0;
  if (direct > 0) return direct;
  const hay = [
    cloudOrder?.customer_label,
    cloudOrder?.source_label,
    cloudOrder?.waiter_name,
  ].filter(Boolean).join(" ");
  const m = hay.match(/\bT\s*(\d+)\b/i);
  return m ? Number(m[1]) || 0 : 0;
}

function orderDeviceId(cloudOrder) {
  return String(cloudOrder?.device_id || "").trim().toUpperCase();
}

function orderTextBlob(cloudOrder) {
  return [
    cloudOrder?.source,
    cloudOrder?.source_label,
    cloudOrder?.customer_label,
    cloudOrder?.waiter_name,
  ].filter(Boolean).join(" ").toLowerCase();
}

/** Porosi nga telefoni i kamarierit — jo QR, jo takeaway POS-import */
function isCloudStaffWaiterOrder(cloudOrder) {
  return orderDeviceId(cloudOrder) === "WEB-WAITER";
}

/** Takeaway / delivery / web publike — jo tavolinë fizike me QR */
function isCloudOnlinePickupOrder(cloudOrder) {
  if (isCloudStaffWaiterOrder(cloudOrder)) return false;
  const device = orderDeviceId(cloudOrder);
  if (device === "WEB-PUBLIC") return true;
  const blob = orderTextBlob(cloudOrder);
  if (/\btakeaway\b|\bdelivery\b/.test(blob)) return true;
  const src = String(cloudOrder?.source || cloudOrder?.source_label || "").toLowerCase();
  if (src === "takeaway" || src === "delivery" || src === "online") return true;
  if (device === "WEB-KIOSK") return false;
  return (Number(cloudOrder?.table_number) || 0) <= 0
    && parseTableNumberFromCloudOrder(cloudOrder) <= 0;
}

/** Vetëm QR tavolinë — pranohet në POS (takeaway/delivery shkojnë te banaku cloud) */
function isCloudPosAcceptQueueOrder(cloudOrder) {
  return isCloudQrTableOrder(cloudOrder);
}

/** Porosi nga QR i tavolinës fizike të lokalit (T1…T20) */
function isCloudQrTableOrder(cloudOrder) {
  if (isCloudStaffWaiterOrder(cloudOrder)) return false;
  if (isCloudOnlinePickupOrder(cloudOrder)) return false;
  const device = orderDeviceId(cloudOrder);
  // Porositë nga POS lokal (device_id nuk fillon me "WEB-") nuk janë QR —
  // kamarieri i ka bërë vetë, nuk duhet pranim me PIN
  if (device && !device.startsWith("WEB-")) return false;
  if (device === "WEB-KIOSK") {
    return parseTableNumberFromCloudOrder(cloudOrder) > 0;
  }
  const blob = orderTextBlob(cloudOrder);
  if (/qr|kiosk|tavolin/i.test(blob)) {
    return parseTableNumberFromCloudOrder(cloudOrder) > 0;
  }
  return (Number(cloudOrder?.table_number) || 0) > 0;
}

function parseQrTableNumberFromCloudOrder(cloudOrder) {
  if (!isCloudQrTableOrder(cloudOrder)) return 0;
  return parseTableNumberFromCloudOrder(cloudOrder);
}

function isTableInOnlinePickupZone(tableRow) {
  if (!tableRow) return false;
  return Number(tableRow.zone_id) === Number(ensureOnlinePickupZone().id);
}

function isPhysicalVenueTable(tableRow) {
  return !!tableRow && !isTableInOnlinePickupZone(tableRow);
}

function enrichCloudOrderForWaiter(cloudOrder) {
  if (!cloudOrder?.id) return cloudOrder;
  const staff = isCloudStaffWaiterOrder(cloudOrder);
  const qr = !staff && isCloudQrTableOrder(cloudOrder);
  return {
    ...cloudOrder,
    is_staff_waiter: staff,
    is_qr_table: qr,
    is_online_pickup: !staff && !qr && isCloudOnlinePickupOrder(cloudOrder),
    qr_table_number: qr ? parseQrTableNumberFromCloudOrder(cloudOrder) : 0,
  };
}

function resolveTableForCloudOrder(cloudOrder, waiterName = "") {
  const tableNumDirect = Number(cloudOrder?.table_number) || 0;

  if (isCloudStaffWaiterOrder(cloudOrder)) {
    if (tableNumDirect <= 0) {
      throw new Error("Porosia e kamarierit (telefon) nuk ka tavolinë — nuk importohet në POS.");
    }
    const existing = getTableByNumber(tableNumDirect);
    if (existing && isPhysicalVenueTable(existing)) return existing;
    const table = ensureTableExistsForNumber(tableNumDirect);
    if (!table || !isPhysicalVenueTable(table)) {
      throw new Error(`Tavolina T${tableNumDirect} nuk u gjet.`);
    }
    return table;
  }
  if (isCloudOnlinePickupOrder(cloudOrder)) {
    const slot = Number(cloudOrder.online_slot || cloudOrder._online_slot || 0);
    if (slot >= 1) return findOnlinePickupTableBySlotIndex(slot);
    return findFreeOnlinePickupTable();
  }
  if (isCloudQrTableOrder(cloudOrder)) {
    const tableNum = parseQrTableNumberFromCloudOrder(cloudOrder);
    if (!tableNum) throw new Error("Mungon numri i tavolinës QR.");
    const existing = getTableByNumber(tableNum);
    if (existing && isPhysicalVenueTable(existing)) return existing;
    const table = ensureTableExistsForNumber(tableNum);
    if (!table || !isPhysicalVenueTable(table)) {
      throw new Error(`Tavolina T${tableNum} (lokale) nuk u gjet.`);
    }
    return table;
  }
  return findFreeOnlinePickupTable();
}

function importCloudOrderToLocal(cloudOrder, waiterName) {
  const cloudId = String(cloudOrder?.id || "").trim();
  if (!cloudId) throw new Error("Porosia nuk ka ID cloud.");

  const name = String(waiterName || "").trim();
  if (!name) throw new Error("Mungon emri i kamarierit që pranon porosinë.");

  const activeExisting = getActiveOrderByCloudId(cloudId);
  if (activeExisting) {
    const table = getTableById(activeExisting.table_id);
    if (String(activeExisting.waiter_name || "").trim() !== name) {
      sqlite.prepare("UPDATE orders SET waiter_name = ? WHERE id = ?").run(name, activeExisting.id);
    }
    linkCloudOrderId(activeExisting.id, cloudId);
    sqlite.prepare("UPDATE tables SET status = 'occupied' WHERE id = ?").run(activeExisting.table_id);
    return {
      ok: true,
      already: true,
      order_id: activeExisting.id,
      table_id: activeExisting.table_id,
      table_number: table?.number || 0,
      table_label: table ? tableLabel(table) : "",
      waiter_name: name,
    };
  }

  const rawItems = cloudOrder.items || cloudOrder.items_json || [];
  const items = mapCloudItemsToLocal(rawItems);
  if (!items.length) throw new Error("Porosia nuk ka artikuj të njohur.");

  const prior = getOrderByCloudId(cloudId);
  if (prior && String(prior.status) !== "active") {
    const priorTable = getTableById(prior.table_id);
    const priorStatus = String(prior.status || "").toLowerCase();
    return {
      ok: true,
      already: true,
      closed: priorStatus === "completed",
      cancelled: priorStatus === "cancelled",
      order_id: prior.id,
      table_id: prior.table_id,
      table_number: priorTable?.number || 0,
      table_label: priorTable ? tableLabel(priorTable) : "",
      waiter_name: prior.waiter_name || name,
    };
  }

  let table = resolveTableForCloudOrder(cloudOrder, name);
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const itemsJson = JSON.stringify(items);
  const sourceLabel = (() => {
    const raw = String(
      cloudOrder.source_label || cloudOrder.customer_label || cloudOrder.waiter_name || "",
    ).trim();
    if (isCloudStaffWaiterOrder(cloudOrder)) {
      const tn = Number(cloudOrder?.table_number) || 0;
      return tn > 0 ? (raw || `Kamarier · T${tn}`) : (raw || "Kamarier (telefon)");
    }
    if (isCloudOnlinePickupOrder(cloudOrder)) {
      return raw || "Porosi online";
    }
    const tn = parseQrTableNumberFromCloudOrder(cloudOrder);
    if (tn > 0) return raw || `QR · T${tn}`;
    return raw || "QR";
  })();
  const cloudTableNum = isCloudQrTableOrder(cloudOrder)
    ? parseQrTableNumberFromCloudOrder(cloudOrder)
    : (isCloudStaffWaiterOrder(cloudOrder) ? (Number(cloudOrder?.table_number) || 0) : 0);

  let activeOnTable = getActiveOrderForTable(table.id);
  if (activeOnTable && cloudTableNum <= 0) {
    table = findFreeOnlinePickupTable();
    activeOnTable = getActiveOrderForTable(table.id);
  }
  if (activeOnTable && cloudTableNum > 0) {
    const merged = mergeOrderItemsLocal(parseOrderItems(activeOnTable.items_json), items);
    const mergedTotal = merged.reduce((s, i) => s + i.price * i.quantity, 0);
    const label = sourceLabel || String(activeOnTable.source_label || "").trim();
    sqlite.prepare(`
      UPDATE orders SET waiter_name = ?, items_json = ?, total = ?, source_label = ?,
        cloud_order_id = COALESCE(NULLIF(cloud_order_id, ''), ?)
      WHERE id = ?
    `).run(name, JSON.stringify(merged), mergedTotal, label, cloudId, activeOnTable.id);
    linkCloudOrderId(activeOnTable.id, cloudId);
    sqlite.prepare("UPDATE tables SET status = 'occupied' WHERE id = ?").run(table.id);
    return {
      ok: true,
      already: false,
      merged: true,
      order_id: activeOnTable.id,
      table_id: table.id,
      table_number: table.number,
      table_label: tableLabel(table),
      waiter_name: name,
      total: mergedTotal,
      batch_items: items,
      total,
    };
  }

  const r = sqlite.prepare(`
    INSERT INTO orders (table_id, waiter_name, items_json, total, status, cloud_order_id, source_label)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(table.id, name, itemsJson, total, cloudId, sourceLabel);

  linkCloudOrderId(r.lastInsertRowid, cloudId);
  sqlite.prepare("UPDATE tables SET status = 'occupied' WHERE id = ?").run(table.id);

  return {
    ok: true,
    already: false,
    order_id: r.lastInsertRowid,
    table_id: table.id,
    table_number: table.number,
    table_label: tableLabel(table),
    waiter_name: name,
    total,
    batch_items: items,
  };
}

function listActiveOnlineOrders() {
  const rows = sqlite.prepare(`
    SELECT o.id, o.waiter_name, o.items_json, o.total, o.source_label, o.cloud_order_id, o.created_at,
           t.number AS table_number, t.display_name AS table_display_name, t.id AS table_id
    FROM orders o
    INNER JOIN tables t ON t.id = o.table_id
    WHERE o.status = 'active'
      AND o.cloud_order_id IS NOT NULL
      AND TRIM(o.cloud_order_id) <> ''
    ORDER BY datetime(o.created_at) DESC
    LIMIT 40
  `).all();

  return rows.map(row => {
    const items = parseOrderItems(row.items_json);
    const itemCount = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    return {
      order_id: row.id,
      table_id: row.table_id,
      table_label: tableLabel({ number: row.table_number, display_name: row.table_display_name }),
      waiter_name: row.waiter_name,
      source_label: String(row.source_label || "").trim() || "Online",
      total: Number(row.total) || 0,
      item_count: itemCount,
      created_at: row.created_at,
      cloud_order_id: row.cloud_order_id,
    };
  });
}

function findStaffById(id) {
  const n = Number(id);
  if (!n) return null;
  return sqlite.prepare("SELECT * FROM staff WHERE id = ? AND active = 1").get(n) || null;
}

function listActiveQrPublicOrdersForWaiter(waiterName) {
  const name = String(waiterName || "").trim();
  if (!name) return [];
  const rows = sqlite.prepare(`
    SELECT o.id, o.waiter_name, o.items_json, o.total, o.source_label, o.cloud_order_id, o.created_at,
           t.number AS table_number, t.display_name AS table_display_name, t.id AS table_id
    FROM orders o
    INNER JOIN tables t ON t.id = o.table_id
    WHERE o.status = 'active'
      AND LOWER(TRIM(o.waiter_name)) = LOWER(TRIM(?))
      AND (
        (o.cloud_order_id IS NOT NULL AND LENGTH(TRIM(o.cloud_order_id)) > 0)
        OR LOWER(COALESCE(o.source_label, '')) LIKE '%tavolin%'
        OR LOWER(COALESCE(o.source_label, '')) LIKE '%takeaway%'
        OR LOWER(COALESCE(o.source_label, '')) LIKE '%delivery%'
        OR LOWER(COALESCE(o.source_label, '')) LIKE '%qr%'
        OR LOWER(COALESCE(o.source_label, '')) LIKE '%online%'
      )
    ORDER BY datetime(o.created_at) DESC
    LIMIT 40
  `).all(name);

  return rows.map(row => {
    const items = parseOrderItems(row.items_json);
    const itemCount = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    return {
      order_id: row.id,
      table_id: row.table_id,
      table_label: tableLabel({ number: row.table_number, display_name: row.table_display_name }),
      waiter_name: row.waiter_name,
      source_label: String(row.source_label || "").trim() || "Online",
      total: Number(row.total) || 0,
      item_count: itemCount,
      created_at: row.created_at,
      cloud_order_id: row.cloud_order_id,
    };
  });
}

function listActiveOnlineOrdersForStaffId(staffId) {
  const staff = findStaffById(staffId);
  if (!staff) return [];
  return listActiveQrPublicOrdersForWaiter(staff.name);
}

function listActiveOnlineOrdersForWaiter(waiterName) {
  const name = String(waiterName || "").trim().toLowerCase();
  if (!name) return [];
  return listActiveOnlineOrders().filter(o =>
    String(o.waiter_name || "").trim().toLowerCase() === name,
  );
}

function sendOrder({ table_id, waiter_name, items }) {
  const table = sqlite.prepare("SELECT * FROM tables WHERE id = ?").get(table_id);
  if (!table) throw new Error("Tavolina nuk u gjet");

  const enriched = enrichOrderItemsWithVat(items);
  const total = enriched.reduce((s, i) => s + i.price * i.quantity, 0);
  const itemsJson = JSON.stringify(enriched);

  return sqlite.transaction(() => {
    const existing = getActiveOrderForTable(table_id);
    if (existing) {
      if (existing.waiter_name !== waiter_name) {
        throw new Error("Kjo tavolinë është e kamarierit: " + existing.waiter_name);
      }
      sqlite.prepare("UPDATE orders SET items_json = ?, total = ? WHERE id = ?")
        .run(itemsJson, total, existing.id);
      sqlite.prepare("UPDATE tables SET status = 'occupied' WHERE id = ?").run(table_id);
      return existing.id;
    }
    const r = sqlite.prepare(`
      INSERT INTO orders (table_id, waiter_name, items_json, total, status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(table_id, waiter_name, itemsJson, total);
    sqlite.prepare("UPDATE tables SET status = 'occupied' WHERE id = ?").run(table_id);
    return r.lastInsertRowid;
  })();
}

function normalizePaymentMethod(raw) {
  const v = String(raw || "cash").trim().toLowerCase();
  // HAPI 4 — metodat SEF (ruajtje në orders.payment_method); closeTable nuk ndryshohet
  if (
    [
      "cash",
      "debit_card",
      "credit_card",
      "bank_account",
      "voucher",
      "check",
      "sms",
    ].includes(v)
  ) {
    return v;
  }
  if (["karte", "kartë", "card", "kart"].includes(v)) return "karte";
  return "cash";
}

function paymentMethodLabel(method) {
  const m = normalizePaymentMethod(method);
  const labels = {
    cash: "Cash",
    karte: "Kartë",
    debit_card: "Debit kartelë",
    credit_card: "Kredit kartelë",
    bank_account: "Llogari bankare",
    voucher: "Vauçer",
    check: "Çek",
    sms: "SMS",
  };
  return labels[m] || "Cash";
}

function closeTable(tableId, waiterName, isAdmin = false, paymentMethod = "cash", pricing = null, opts = {}) {
  const order = getActiveOrderForTable(tableId);
  if (!order) {
    console.log(`[STATUS-CHANGE][closeTable] tableId=${tableId} nuk ka porosi aktive -> vetëm tables.status='free'`);
    sqlite.prepare("UPDATE tables SET status = 'free' WHERE id = ?").run(tableId);
    return null;
  }
  const allowAnyWaiter = !!opts.allowAnyWaiter;
  if (!isAdmin && !allowAnyWaiter && order.waiter_name !== waiterName) {
    throw new Error("Vetëm " + order.waiter_name + " ose admini mund ta mbyllë këtë tavolinë");
  }
  const method = normalizePaymentMethod(paymentMethod);
  const table = sqlite.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
  const logMeta = shiftMetaForWaiter(order.waiter_name);
  const subtotal = pricing?.subtotal != null ? Number(pricing.subtotal) : Number(order.total);
  const discountTotal = pricing?.discount_total != null ? Number(pricing.discount_total) : 0;
  const finalTotal = pricing?.total != null ? Number(pricing.total) : Number(order.total);
  const promotionId = pricing?.promotion_id ?? null;
  const promotionName = pricing?.promotion_name || "";

  console.log(`[STATUS-CHANGE][closeTable] order#${order.id} T${table?.number} waiter=${order.waiter_name} total=${finalTotal} -> orders.status='completed', tables.status='free'`);
  sqlite.transaction(() => {
    sqlite.prepare(`
      UPDATE orders SET status = 'completed', payment_method = ?, total = ? WHERE id = ?
    `).run(method, finalTotal, order.id);
    sqlite.prepare("UPDATE tables SET status = 'free' WHERE id = ?").run(tableId);
    addDailyLogEntry({
      table_number:  table.number,
      waiter_name:   order.waiter_name,
      items_json:    order.items_json,
      total:         finalTotal,
      receipt_number: null,
      payment_method: method,
      staff_id: logMeta.staff_id,
      shift_id: logMeta.shift_id,
      subtotal,
      discount_total: discountTotal,
      promotion_id: promotionId,
      promotion_name: promotionName,
      cloud_sale_id: order.cloud_order_id || null,
    });
    decrementMenuItemStock(parseOrderItems(order.items_json));
  })();
  return {
    ...order,
    status: "completed",
    payment_method: method,
    total: finalTotal,
    subtotal,
    discount_total: discountTotal,
    promotion_id: promotionId,
    promotion_name: promotionName,
  };
}

/** Mbyll një porosi specifike sipas ID-së lokale të porosisë (order.id) —
 * jo sipas "cila porosi është aktive tani në këtë table_id". Sllotet online
 * (p.sh. "Online 1") ripërdoren shpejt nga porosi të reja takeaway; nëse
 * kërkesa e mbylljes për porosinë origjinale është ende në fluturim (p.sh.
 * gjatë thirrjes në cloud), closeTable(tableId, ...) do të kapte gabimisht
 * porosinë E RE që tani zë atë tavolinë. Kjo funksion e mbyll porosinë e
 * kërkuar në mënyrë të drejtpërdrejtë, dhe e liron tavolinën VETËM nëse
 * s'ka ndonjë porosi tjetër aktive mbi të (mos vjedh tavolinën e porosisë
 * së re). Mban të njëjtin invariant si closeTable: një `daily_log` rresht
 * për çdo mbyllje, brenda së njëjtës transaksion.
 */
function closeOrderById(orderId, waiterName, isAdmin = false, paymentMethod = "cash", pricing = null, opts = {}) {
  const id = Number(orderId);
  const order = sqlite.prepare("SELECT * FROM orders WHERE id = ? AND status = 'active'").get(id);
  if (!order) return null;
  const tableId = order.table_id;
  const allowAnyWaiter = !!opts.allowAnyWaiter;
  if (!isAdmin && !allowAnyWaiter && order.waiter_name !== waiterName) {
    throw new Error("Vetëm " + order.waiter_name + " ose admini mund ta mbyllë këtë porosi");
  }
  const method = normalizePaymentMethod(paymentMethod);
  const table = sqlite.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
  const logMeta = shiftMetaForWaiter(order.waiter_name);
  const subtotal = pricing?.subtotal != null ? Number(pricing.subtotal) : Number(order.total);
  const discountTotal = pricing?.discount_total != null ? Number(pricing.discount_total) : 0;
  const finalTotal = pricing?.total != null ? Number(pricing.total) : Number(order.total);
  const promotionId = pricing?.promotion_id ?? null;
  const promotionName = pricing?.promotion_name || "";

  console.log(`[STATUS-CHANGE][closeOrderById] order#${order.id} T${table?.number} waiter=${order.waiter_name} total=${finalTotal} -> orders.status='completed'`);
  sqlite.transaction(() => {
    sqlite.prepare(`
      UPDATE orders SET status = 'completed', payment_method = ?, total = ? WHERE id = ?
    `).run(method, finalTotal, order.id);
    const stillOccupied = sqlite.prepare(
      "SELECT 1 FROM orders WHERE table_id = ? AND status = 'active' AND id != ?",
    ).get(tableId, order.id);
    if (!stillOccupied) {
      sqlite.prepare("UPDATE tables SET status = 'free' WHERE id = ?").run(tableId);
    } else {
      console.log(`[STATUS-CHANGE][closeOrderById] T${table?.number} ka porosi tjetër aktive mbi të — tables.status NUK preket (sllot i ripërdorur).`);
    }
    addDailyLogEntry({
      table_number:  table.number,
      waiter_name:   order.waiter_name,
      items_json:    order.items_json,
      total:         finalTotal,
      receipt_number: null,
      payment_method: method,
      staff_id: logMeta.staff_id,
      shift_id: logMeta.shift_id,
      subtotal,
      discount_total: discountTotal,
      promotion_id: promotionId,
      promotion_name: promotionName,
      cloud_sale_id: order.cloud_order_id || null,
    });
    decrementMenuItemStock(parseOrderItems(order.items_json));
  })();
  return {
    ...order,
    status: "completed",
    payment_method: method,
    total: finalTotal,
    subtotal,
    discount_total: discountTotal,
    promotion_id: promotionId,
    promotion_name: promotionName,
  };
}

function orderItemKey(it) {
  if (it.menu_item_id != null) return `id:${it.menu_item_id}`;
  return `n:${String(it.name || "").toLowerCase()}|${Number(it.price || 0).toFixed(2)}`;
}

function subtractOrderItems(allItems, selectedItems) {
  const map = new Map();
  for (const it of allItems || []) {
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    map.set(orderItemKey(it), { ...it, quantity: qty });
  }
  const removed = [];
  for (const sel of selectedItems || []) {
    const qty = Number(sel.quantity) || 0;
    if (qty <= 0) continue;
    const k = orderItemKey(sel);
    const prev = map.get(k);
    if (!prev || prev.quantity < qty) {
      throw new Error(`Sasia e "${sel.name || "artikullit"}" tejkalon porosinë.`);
    }
    removed.push({ ...prev, quantity: qty });
    prev.quantity -= qty;
    if (prev.quantity <= 0) map.delete(k);
  }
  if (!removed.length) throw new Error("Zgjidhni artikuj për pagesë.");
  const remaining = [...map.values()].filter(it => it.quantity > 0);
  return { remaining, removed };
}

function closeTablePartial(tableId, waiterName, paymentMethod, itemsToClose, pricing = null, opts = {}) {
  const order = getActiveOrderForTable(tableId);
  if (!order) throw new Error("Nuk ka porosi aktive për këtë tavolinë.");
  if (!opts.allowAnyWaiter && order.waiter_name !== waiterName) {
    throw new Error("Vetëm " + order.waiter_name + " mund ta ndajë këtë faturë.");
  }
  const allItems = parseOrderItems(order.items_json);
  const { remaining, removed } = subtractOrderItems(allItems, itemsToClose);
  const partialSubtotal = pricing?.subtotal != null
    ? Number(pricing.subtotal)
    : removed.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
  const discountTotal = pricing?.discount_total != null ? Number(pricing.discount_total) : 0;
  const partialTotal = pricing?.total != null
    ? Number(pricing.total)
    : partialSubtotal;
  const method = normalizePaymentMethod(paymentMethod);
  const table = sqlite.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
  const logMeta = shiftMetaForWaiter(order.waiter_name);
  const promotionId = pricing?.promotion_id ?? null;
  const promotionName = pricing?.promotion_name || "";

  return sqlite.transaction(() => {
    addDailyLogEntry({
      table_number: table.number,
      waiter_name: order.waiter_name,
      items_json: JSON.stringify(removed),
      total: partialTotal,
      receipt_number: null,
      payment_method: method,
      staff_id: logMeta.staff_id,
      shift_id: logMeta.shift_id,
      subtotal: partialSubtotal,
      discount_total: discountTotal,
      promotion_id: promotionId,
      promotion_name: promotionName,
      cloud_sale_id: order.cloud_order_id || null,
    });
    decrementMenuItemStock(removed);

    if (!remaining.length) {
      console.log(`[STATUS-CHANGE][closeTablePartial] order#${order.id} T${table?.number} waiter=${order.waiter_name} (asnjë artikull i mbetur) -> orders.status='completed', tables.status='free'`);
      sqlite.prepare(`
        UPDATE orders SET status = 'completed', payment_method = ?, items_json = '[]', total = 0
        WHERE id = ?
      `).run(method, order.id);
      sqlite.prepare("UPDATE tables SET status = 'free' WHERE id = ?").run(tableId);
      return {
        order: {
          ...order,
          status: "completed",
          items_json: "[]",
          total: 0,
          payment_method: method,
          subtotal: partialSubtotal,
          discount_total: discountTotal,
          promotion_id: promotionId,
          promotion_name: promotionName,
        },
        removed,
        partialTotal,
        tableFreed: true,
      };
    }

    const newTotal = remaining.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
    const itemsJson = JSON.stringify(remaining);
    sqlite.prepare("UPDATE orders SET items_json = ?, total = ? WHERE id = ?").run(itemsJson, newTotal, order.id);
    return {
      order: {
        ...order,
        items_json: itemsJson,
        total: newTotal,
        payment_method: method,
        subtotal: partialSubtotal,
        discount_total: discountTotal,
        promotion_id: promotionId,
        promotion_name: promotionName,
      },
      removed,
      partialTotal,
      tableFreed: false,
    };
  })();
}

function adminClearTable(tableId) {
  cancelActiveOrder(tableId);
}

/** Të gjitha porositë lokale aktive me info tavoline — për sync me cloud */
function listLocalActiveOrders() {
  return sqlite.prepare(`
    SELECT o.id, o.waiter_name, o.cloud_order_id, o.created_at, o.updated_at,
           t.id as table_id, t.number as table_number
    FROM orders o
    JOIN tables t ON t.id = o.table_id
    WHERE o.status = 'active'
  `).all();
}

/**
 * Lista e porosive aktive për recepsion:
 * — tavolina (restorant/bar)
 * — fatura dhome / Room Service (room_charges sot për mysafirë aktivë)
 */
function listActiveHotelOrdersForWaiter() {
  const tableRows = sqlite.prepare(`
    SELECT
      o.id,
      o.waiter_name,
      o.items_json,
      o.total,
      o.status,
      o.source_label,
      o.created_at,
      t.id AS table_id,
      t.number AS table_number,
      t.display_name AS table_label
    FROM orders o
    JOIN tables t ON t.id = o.table_id
    WHERE o.status = 'active'
    ORDER BY o.created_at DESC, o.id DESC
  `).all();

  const tables = tableRows.map((o, idx) => {
    let items = [];
    try {
      items = typeof o.items_json === "string" ? JSON.parse(o.items_json || "[]") : (o.items_json || []);
    } catch {
      items = [];
    }
    if (!Array.isArray(items)) items = [];
    const products = items
      .map((it) => `${Number(it.quantity) || 1}× ${it.name || "—"}`)
      .join(", ");
    const label = String(o.table_label || "").trim() || `Tavolina ${o.table_number}`;
    return {
      id: `t-${o.id}`,
      nr: idx + 1,
      kind: "table",
      source: label,
      table_id: o.table_id,
      room_id: null,
      products: products || "—",
      total: Math.round((Number(o.total) || 0) * 100) / 100,
      status: "Aktive",
      created_at: o.created_at,
      waiter_name: o.waiter_name || "",
    };
  });

  const roomRows = sqlite.prepare(`
    SELECT
      g.id AS guest_id,
      g.guest_name,
      g.room_id,
      r.room_number,
      MIN(rc.created_at) AS created_at,
      SUM(rc.amount) AS total,
      GROUP_CONCAT(rc.description, ', ') AS products
    FROM room_charges rc
    JOIN guests g ON g.id = rc.guest_id AND g.status = 'active'
    JOIN rooms r ON r.id = g.room_id
    WHERE rc.created_at >= date('now', 'localtime')
      AND rc.created_at < date('now', 'localtime', '+1 day')
    GROUP BY g.id, g.guest_name, g.room_id, r.room_number
    ORDER BY MIN(rc.created_at) DESC
  `).all();

  const rooms = roomRows.map((row, idx) => ({
    id: `r-${row.guest_id}`,
    nr: tables.length + idx + 1,
    kind: "room",
    source: `Dhoma ${row.room_number}`,
    table_id: null,
    room_id: row.room_id,
    products: String(row.products || "Room Service").trim() || "Room Service",
    total: Math.round((Number(row.total) || 0) * 100) / 100,
    status: "Në dhomë",
    created_at: row.created_at,
    waiter_name: row.guest_name || "",
  }));

  const orders = [...tables, ...rooms];
  /* Rinumerim pas bashkimit (tavolina së pari sipas orës, pastaj dhomat) */
  orders.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  orders.forEach((o, i) => { o.nr = i + 1; });
  return { orders, table_count: tables.length, room_count: rooms.length };
}

function cancelActiveOrder(tableId) {
  const order = getActiveOrderForTable(tableId);
  if (!order) throw new Error("Nuk ka porosi aktive për këtë tavolinë");
  const table = sqlite.prepare("SELECT number FROM tables WHERE id = ?").get(tableId);
  const callerLine = (new Error().stack || "").split("\n")[2]?.trim() || "?";
  console.log(`[STATUS-CHANGE][cancelActiveOrder] order#${order.id} T${table?.number} waiter=${order.waiter_name} cloud_order_id=${order.cloud_order_id || "null"} -> orders.status='cancelled', tables.status='free' | caller: ${callerLine}`);
  sqlite.transaction(() => {
    addDailyLogEntry({
      table_number:   table.number,
      waiter_name:    order.waiter_name,
      items_json:     order.items_json,
      total:          order.total,
      receipt_number: null,
      status:         "cancelled",
    });
    sqlite.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);
    sqlite.prepare("UPDATE tables SET status = 'free' WHERE id = ?").run(tableId);
  })();
  return order;
}

function getReports(dateFrom, dateTo) {
  const from = dateFrom || new Date().toISOString().slice(0, 10);
  const to   = dateTo   || from;
  const entries = sqlite.prepare(`
    SELECT * FROM daily_log
    WHERE status = 'completed'
      AND date >= ?
      AND date <= ?
    ORDER BY date ASC, time ASC
  `).all(from, to);

  const totalSales = entries.reduce((s, e) => s + Number(e.total || 0), 0);
  const totalDiscount = entries.reduce((s, e) => s + Number(e.discount_total || 0), 0);
  const orderCount = entries.length;
  const average = orderCount ? totalSales / orderCount : 0;

  const promoMap = {};
  for (const e of entries) {
    const disc = Number(e.discount_total) || 0;
    const name = String(e.promotion_name || "").trim();
    if (disc <= 0 || !name) continue;
    if (!promoMap[name]) promoMap[name] = { name, discount_total: 0, uses: 0 };
    promoMap[name].discount_total += disc;
    promoMap[name].uses += 1;
  }
  const promotionStats = Object.values(promoMap)
    .map(p => ({ ...p, discount_total: Number(p.discount_total.toFixed(2)) }))
    .sort((a, b) => b.discount_total - a.discount_total);

  const itemCounts = {};
  const itemRevenue = {};
  for (const e of entries) {
    for (const it of JSON.parse(e.items_json || "[]")) {
      const name = String(it.name || "").trim();
      if (!name) continue;
      const qty = Number(it.quantity) || 1;
      itemCounts[name] = (itemCounts[name] || 0) + qty;
      itemRevenue[name] = (itemRevenue[name] || 0) + (Number(it.price) || 0) * qty;
    }
  }
  const topItems = Object.keys(itemCounts)
    .sort((a, b) => itemCounts[b] - itemCounts[a] || itemRevenue[b] - itemRevenue[a])
    .slice(0, 15)
    .map(name => ({
      name,
      quantity: itemCounts[name],
      revenue: Number((itemRevenue[name] || 0).toFixed(2)),
    }));

  const dailyMap = new Map();
  const start = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dailyMap.set(d.toISOString().slice(0, 10), 0);
    }
  }
  for (const e of entries) {
    const day = String(e.date || "").slice(0, 10);
    if (dailyMap.has(day)) {
      dailyMap.set(day, dailyMap.get(day) + Number(e.total || 0));
    }
  }
  const dailySales = [...dailyMap.entries()].map(([date, total]) => ({ date, total }));

  return {
    totalSales,
    totalDiscount: Number(totalDiscount.toFixed(2)),
    promotionStats,
    orderCount,
    average,
    topItems,
    dailySales,
    dateFrom: from,
    dateTo: to,
  };
}

function getStaff() {
  return sqlite.prepare("SELECT id, name, pin, card_uid, active FROM staff ORDER BY name").all();
}

function getStaffForAdmin() {
  const activeTodaySet = new Set(getActiveStaffToday());
  return getStaff().map(s => {
    const shift = getOpenShift(s.id);
    let shift_label = "Pa nderrim aktiv";
    if (shift?.opened_at) {
      const opened = new Date(shift.opened_at);
      const time = opened.toLocaleTimeString("sq-AL", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      shift_label = `${time} — aktiv`;
    }
    const uid = String(s.card_uid || "").trim();
    return {
      id: s.id,
      name: s.name,
      active: !!s.active,
      has_pin: !!s.pin,
      has_card: !!uid,
      card_uid: uid,
      shift_label,
      active_today: activeTodaySet.has(s.name),
    };
  });
}

function getStaffForLogin() {
  return sqlite.prepare(
    "SELECT id, name, card_uid FROM staff WHERE active = 1 ORDER BY name",
  ).all().map(s => ({
    id: s.id,
    name: s.name,
    has_card: !!s.card_uid,
  }));
}

function findStaffByName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  return sqlite.prepare("SELECT * FROM staff WHERE name = ? AND active = 1").get(trimmed);
}

function findStaffByNameInsensitive(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  return sqlite.prepare("SELECT * FROM staff WHERE LOWER(name) = LOWER(?) AND active = 1").get(trimmed);
}

function getOpenShift(staffId) {
  const id = Number(staffId);
  if (!id) return null;
  return sqlite.prepare(`
    SELECT * FROM waiter_shifts
    WHERE staff_id = ? AND closed_at IS NULL
    ORDER BY id DESC LIMIT 1
  `).get(id);
}

function ensureOpenShift(staffId, waiterName) {
  const id = Number(staffId);
  if (!id) throw new Error("Kamarieri i panjohur.");
  const existing = getOpenShift(id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const r = sqlite.prepare(`
    INSERT INTO waiter_shifts (staff_id, waiter_name, opened_at)
    VALUES (?, ?, ?)
  `).run(id, String(waiterName || "").trim(), now);
  return sqlite.prepare("SELECT * FROM waiter_shifts WHERE id = ?").get(r.lastInsertRowid);
}

function attachCloudSaleToWaiterShift(cloudSaleId, waiterName) {
  const cloudId = String(cloudSaleId || "").trim();
  const name = String(waiterName || "").trim();
  if (!cloudId || !name) return null;
  const staff = findStaffByNameInsensitive(name);
  if (!staff) return null;
  const shift = getOpenShift(staff.id);
  if (!shift) return null;
  // Vetëm shitje PA shift (orphan) dhe brenda kohës së ndërrimit aktual
  sqlite.prepare(`
    UPDATE daily_log
    SET staff_id = ?, shift_id = ?
    WHERE cloud_sale_id = ?
      AND status = 'completed'
      AND shift_id IS NULL
      AND created_at >= ?
  `).run(staff.id, shift.id, cloudId, shift.opened_at || shift.created_at || '2000-01-01');
  return shift.id;
}

/** Vetëm shitjet e lidhura EKSPLICITISHT me këtë shift_id — asnjë supozim datë/emër. */
function computeShiftTotals(shiftId, staffId = null, waiterName = null) {
  const sid = Number(shiftId);
  const row = sqlite.prepare(`
    SELECT
      COUNT(*) AS order_count,
      COALESCE(SUM(total), 0) AS total_sales,
      COALESCE(SUM(CASE WHEN payment_method = 'karte' THEN total ELSE 0 END), 0) AS card_total,
      COALESCE(SUM(CASE WHEN payment_method != 'karte' THEN total ELSE 0 END), 0) AS cash_total,
      COALESCE(SUM(discount_total), 0) AS discount_total
    FROM daily_log
    WHERE status = 'completed' AND shift_id = ?
  `).get(sid);
  return {
    order_count: Number(row?.order_count) || 0,
    total_sales: Number(row?.total_sales) || 0,
    card_total: Number(row?.card_total) || 0,
    cash_total: Number(row?.cash_total) || 0,
    discount_total: Number(row?.discount_total) || 0,
  };
}

/** Shitje në daily_log pa shift_id (p.sh. WEB-WAITER para hapjes së ndërrimit). */
function computeOrphanDailyLogTotals(staffId, waiterName = null) {
  const id = Number(staffId);
  const wname = String(waiterName || "").trim();
  if (!id && !wname) {
    return { order_count: 0, total_sales: 0, card_total: 0, cash_total: 0, discount_total: 0 };
  }
  const parts = [];
  const params = [];
  if (id) {
    parts.push("staff_id = ?");
    params.push(id);
  }
  if (wname) {
    parts.push("(staff_id IS NULL AND LOWER(TRIM(waiter_name)) = LOWER(?))");
    params.push(wname);
    parts.push(`(
      cloud_sale_id IS NOT NULL
      AND LOWER(TRIM(waiter_name)) = LOWER(?)
    )`);
    params.push(wname);
  }
  const row = sqlite.prepare(`
    SELECT
      COUNT(*) AS order_count,
      COALESCE(SUM(total), 0) AS total_sales,
      COALESCE(SUM(CASE WHEN payment_method = 'karte' THEN total ELSE 0 END), 0) AS card_total,
      COALESCE(SUM(CASE WHEN payment_method != 'karte' THEN total ELSE 0 END), 0) AS cash_total,
      COALESCE(SUM(discount_total), 0) AS discount_total
    FROM daily_log
    WHERE shift_id IS NULL AND status = 'completed' AND (${parts.join(" OR ")})
  `).get(...params);
  return {
    order_count: Number(row?.order_count) || 0,
    total_sales: Number(row?.total_sales) || 0,
    card_total: Number(row?.card_total) || 0,
    cash_total: Number(row?.cash_total) || 0,
    discount_total: Number(row?.discount_total) || 0,
  };
}

function parseShiftLogItems(itemsJson) {
  let raw = [];
  try {
    raw = JSON.parse(itemsJson || "[]");
  } catch {
    raw = [];
  }
  return (Array.isArray(raw) ? raw : []).map(it => ({
    name: String(it.name || "").trim(),
    quantity: Number(it.quantity) || 1,
    price: Number(it.price) || 0,
  })).filter(it => it.name && it.quantity > 0);
}

function getShiftSalesDetail(shiftId) {
  const sid = Number(shiftId);
  if (!sid) {
    return {
      orders: [],
      item_summary: [],
      totals: computeShiftTotals(0),
    };
  }

  const entries = sqlite.prepare(`
    SELECT id, date, time, table_number, waiter_name, items_json, total, receipt_number,
           payment_method, discount_total, promotion_name, subtotal
    FROM daily_log
    WHERE shift_id = ? AND status = 'completed'
    ORDER BY date ASC, time ASC, id ASC
  `).all(sid);

  const orders = entries.map(e => {
    const items = parseShiftLogItems(e.items_json);
    return {
      date: e.date,
      time: e.time,
      table_number: e.table_number,
      receipt_number: e.receipt_number || "",
      payment_method: e.payment_method || "cash",
      items,
      total: Number(e.total) || 0,
      discount_total: Number(e.discount_total) || 0,
      promotion_name: e.promotion_name || "",
      subtotal: Number(e.subtotal) || null,
    };
  });

  const itemMap = new Map();
  for (const order of orders) {
    for (const it of order.items) {
      const key = it.name.toLowerCase();
      const line = it.price * it.quantity;
      const prev = itemMap.get(key);
      if (prev) {
        prev.quantity += it.quantity;
        prev.line_total = Math.round((prev.line_total + line) * 100) / 100;
      } else {
        itemMap.set(key, {
          name: it.name,
          price: it.price,
          quantity: it.quantity,
          line_total: Math.round(line * 100) / 100,
        });
      }
    }
  }

  const item_summary = [...itemMap.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "sq"));

  return {
    orders,
    item_summary,
    totals: computeShiftTotals(sid),
  };
}

/** Përmbledhje e thjeshtë ditore — vetëm artikujt e shitur sot (emri, sasia, totali)
 * dhe totali i ditës. Pa orë, tavolinë, kamarier apo rreshta transaksionesh. */
function buildDailySummaryData(dateStr) {
  const day = dateStr || new Date().toISOString().slice(0, 10);
  const entries = sqlite.prepare(`
    SELECT items_json, total FROM daily_log
    WHERE status = 'completed' AND date = ?
  `).all(day);

  const itemMap = new Map();
  let totalSales = 0;
  for (const e of entries) {
    totalSales += Number(e.total) || 0;
    for (const it of parseShiftLogItems(e.items_json)) {
      const key = it.name.toLowerCase();
      const lineTotal = it.price * it.quantity;
      const prev = itemMap.get(key);
      if (prev) {
        prev.quantity += it.quantity;
        prev.total = Math.round((prev.total + lineTotal) * 100) / 100;
      } else {
        itemMap.set(key, { name: it.name, quantity: it.quantity, total: Math.round(lineTotal * 100) / 100 });
      }
    }
  }

  const items = [...itemMap.values()].sort((a, b) => a.name.localeCompare(b.name, "sq"));

  return {
    date: day,
    items,
    total_sales: Math.round(totalSales * 100) / 100,
  };
}

/** Nderrime aktive tani (ende të hapura) — për zgjedhësin e "Raporti i Kamarierit". */
function listOpenShiftsForReports() {
  return sqlite.prepare(`
    SELECT id, staff_id, waiter_name, opened_at, opening_cash
    FROM waiter_shifts
    WHERE closed_at IS NULL OR TRIM(COALESCE(closed_at, '')) = ''
    ORDER BY opened_at ASC
  `).all();
}

/** "Raporti i Kamarierit" — gjendja e tashme e një nderrimi AKOMA TË HAPUR, e printueshme
 * në çdo kohë nga pronari pa e mbyllur nderrimin e kamarierit. */
function getOpenShiftReportData(shiftId) {
  const sid = Number(shiftId);
  const shift = sqlite.prepare(`SELECT * FROM waiter_shifts WHERE id = ?`).get(sid);
  if (!shift) throw new Error("Nderrimi nuk u gjet.");
  if (shift.closed_at) throw new Error("Ky nderrim është mbyllur tashmë — përdorni Raportin Z.");

  const totals = computeShiftTotals(shift.id, shift.staff_id, shift.waiter_name);
  const openingCash = Number(shift.opening_cash) || 0;
  const { item_summary } = getShiftSalesDetail(shift.id);

  return {
    shift_id: shift.id,
    waiter_name: shift.waiter_name,
    opened_at: shift.opened_at,
    opening_cash: openingCash,
    item_summary,
    ...totals,
    expected_closing_cash: Math.round((openingCash + (Number(totals.cash_total) || 0)) * 100) / 100,
  };
}

/** Kategoria e shitjeve për një grup shift_id-sh — sipas emrit të artikullit,
 * kundrejt kategorisë AKTUALE te menu_items (njësoj si dashboard-i). */
function getCategoryBreakdownForShiftIds(shiftIds) {
  const ids = (shiftIds || []).map(Number).filter(Boolean);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const entries = sqlite.prepare(`
    SELECT items_json FROM daily_log
    WHERE status = 'completed' AND shift_id IN (${placeholders})
  `).all(...ids);

  const menuCats = new Map(
    sqlite.prepare("SELECT name, category FROM menu_items").all().map(r => [r.name, r.category]),
  );
  const totals = {};
  for (const e of entries) {
    for (const it of parseShiftLogItems(e.items_json)) {
      const cat = menuCats.get(it.name) || "Të tjera";
      const rev = it.price * it.quantity;
      totals[cat] = (totals[cat] || 0) + rev;
    }
  }
  return Object.entries(totals)
    .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}

/** Raporti X — gjendja e TASHME e nderrimeve HAPUR, pa mbyllur asgjë. */
function buildXReportData() {
  const openShifts = sqlite.prepare(`
    SELECT ws.id, ws.staff_id, ws.waiter_name, ws.opened_at, ws.opening_cash
    FROM waiter_shifts ws
    WHERE ws.closed_at IS NULL
    ORDER BY ws.opened_at ASC
  `).all();

  const byWaiter = openShifts.map(s => {
    const t = computeShiftTotals(s.id, s.staff_id, s.waiter_name);
    return {
      shift_id: s.id,
      waiter_name: s.waiter_name,
      opened_at: s.opened_at,
      opening_cash: Number(s.opening_cash) || 0,
      ...t,
    };
  });

  const shiftIds = openShifts.map(s => s.id);
  const combined = byWaiter.reduce((acc, w) => {
    acc.order_count += w.order_count;
    acc.total_sales += w.total_sales;
    acc.cash_total += w.cash_total;
    acc.card_total += w.card_total;
    acc.discount_total += w.discount_total;
    return acc;
  }, { order_count: 0, total_sales: 0, cash_total: 0, card_total: 0, discount_total: 0 });

  return {
    generated_at: new Date().toISOString(),
    open_shift_count: openShifts.length,
    ...combined,
    by_waiter: byWaiter,
    by_category: getCategoryBreakdownForShiftIds(shiftIds),
  };
}

/** Nderrime të mbyllura, më të fundit së pari — për zgjedhësin e Raportit Z. */
function listRecentClosedShifts(limit = 30) {
  return sqlite.prepare(`
    SELECT id, staff_id, waiter_name, opened_at, closed_at, opening_cash,
           closing_cash_actual, expected_closing_cash, cash_difference, closing_reason
    FROM waiter_shifts
    WHERE closed_at IS NOT NULL
    ORDER BY closed_at DESC
    LIMIT ?
  `).all(Math.max(1, Number(limit) || 30));
}

/** Raporti Z — pamja përfundimtare e një nderrimi TASHMË TË MBYLLUR. */
function buildZReportData(shiftId) {
  const sid = Number(shiftId);
  const shift = sqlite.prepare(`
    SELECT * FROM waiter_shifts WHERE id = ?
  `).get(sid);
  if (!shift) throw new Error("Nderrimi nuk u gjet.");
  if (!shift.closed_at) throw new Error("Ky nderrim nuk është mbyllur ende.");

  const totals = computeShiftTotals(shift.id, shift.staff_id, shift.waiter_name);
  return {
    shift_id: shift.id,
    waiter_name: shift.waiter_name,
    opened_at: shift.opened_at,
    closed_at: shift.closed_at,
    opening_cash: Number(shift.opening_cash) || 0,
    closing_cash_actual: shift.closing_cash_actual != null ? Number(shift.closing_cash_actual) : null,
    expected_closing_cash: shift.expected_closing_cash != null ? Number(shift.expected_closing_cash) : null,
    cash_difference: Number(shift.cash_difference) || 0,
    closing_reason: shift.closing_reason || "",
    ...totals,
    by_waiter: [{ shift_id: shift.id, waiter_name: shift.waiter_name, opened_at: shift.opened_at, opening_cash: Number(shift.opening_cash) || 0, ...totals }],
    by_category: getCategoryBreakdownForShiftIds([shift.id]),
  };
}

/** Vendos arsyen e diferencës në arkë për një nderrim TASHMË TË MBYLLUR. */
function updateShiftClosingReason(shiftId, reason) {
  const sid = Number(shiftId);
  const shift = sqlite.prepare("SELECT id, closed_at FROM waiter_shifts WHERE id = ?").get(sid);
  if (!shift) throw new Error("Nderrimi nuk u gjet.");
  if (!shift.closed_at) throw new Error("Ky nderrim nuk është mbyllur ende.");
  const text = String(reason || "").trim().slice(0, 500);
  sqlite.prepare("UPDATE waiter_shifts SET closing_reason = ? WHERE id = ?").run(text, sid);
  return buildZReportData(sid);
}

function normalizeCashAmount(raw) {
  const n = Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Shuma e parave duhet të jetë 0 ose më shumë.");
  }
  return Math.round(n * 100) / 100;
}

function getPendingHandoverForStaff(staffId) {
  const id = Number(staffId);
  if (!id) return null;
  const row = sqlite.prepare(`
    SELECT h.*, s.closed_at AS from_shift_closed_at
    FROM shift_handovers h
    JOIN waiter_shifts s ON s.id = h.from_shift_id
    WHERE h.to_staff_id = ? AND h.status = 'pending'
    ORDER BY h.id DESC LIMIT 1
  `).get(id);
  if (!row) return null;
  return {
    ...row,
    handover_cash: Number(row.handover_cash) || 0,
    expected_cash: Number(row.expected_cash) || 0,
    closing_discrepancy: Number(row.closing_discrepancy) || 0,
  };
}

function listHandoverPeers(staffId) {
  const id = Number(staffId);
  return sqlite.prepare(`
    SELECT id, name FROM staff
    WHERE active = 1 AND id != ?
      AND (
        (pin IS NOT NULL AND TRIM(pin) <> '')
        OR (card_uid IS NOT NULL AND TRIM(card_uid) <> '')
      )
    ORDER BY name ASC
  `).all(id);
}

function getActiveTablesForWaiter(waiterName) {
  const name = String(waiterName || "").trim();
  if (!name) return [];
  return sqlite.prepare(`
    SELECT o.id AS order_id, o.table_id, t.number AS table_number, t.display_name AS table_display_name,
           o.source_label, o.cloud_order_id
    FROM orders o
    INNER JOIN tables t ON t.id = o.table_id
    WHERE o.status = 'active' AND LOWER(TRIM(o.waiter_name)) = LOWER(?)
    ORDER BY t.number ASC
  `).all(name);
}

function isCloudPickupOrder(row) {
  return !!(row?.cloud_order_id && String(row.cloud_order_id).trim());
}

function getBlockingActiveTablesForWaiter(waiterName) {
  return getActiveTablesForWaiter(waiterName);
}

function activeTableLabelsForWaiter(waiterName) {
  return getBlockingActiveTablesForWaiter(waiterName).map(row => {
    const lbl = tableLabel({ number: row.table_number, display_name: row.table_display_name });
    const src = String(row.source_label || "").trim();
    if (src && isCloudPickupOrder(row)) return `${lbl} (${src})`;
    return lbl;
  });
}

function activeTableDetailsForWaiter(waiterName) {
  return getBlockingActiveTablesForWaiter(waiterName).map(row => ({
    order_id: row.order_id,
    table_id: row.table_id,
    table_number: row.table_number,
    label: tableLabel({ number: row.table_number, display_name: row.table_display_name }),
  }));
}

/** Mbyll automatikisht porositë online/takeaway (cash) para mbylljes së ndërrimit. */
function settleCloudOrdersForShiftClose(waiterName) {
  const name = String(waiterName || "").trim();
  if (!name) return { settled: 0, errors: [] };
  const rows = getActiveTablesForWaiter(name).filter(isCloudPickupOrder);
  let settled = 0;
  const errors = [];
  for (const row of rows) {
    try {
      closeTable(row.table_id, name, false, "cash");
      settled += 1;
    } catch (e) {
      errors.push({ table_id: row.table_id, error: e.message });
    }
  }
  return { settled, errors };
}

function enrichShiftSummary(shift, totals, staff, extra = {}) {
  const openingCash = shift?.opening_cash != null ? Number(shift.opening_cash) : null;
  const cashSales = Number(totals?.cash_total) || 0;
  const expectedClosing = openingCash != null ? openingCash + cashSales : null;
  const pendingHandover = extra.pendingHandover || null;
  const hasOpenShift = !!(shift && !shift.closed_at);
  const activeLabels = extra.active_table_labels || [];
  const activeDetails = extra.active_table_details || [];
  return {
    shift,
    staff_id: staff.id,
    waiter_name: staff.name,
    active_tables: Number(totals?.active_tables) ?? activeLabels.length,
    active_table_labels: activeLabels,
    active_table_details: activeDetails,
    handover_peers_count: Number(extra.handover_peers_count) || 0,
    needs_handover_on_close: false,
    open: hasOpenShift && shift.opening_cash != null,
    needs_opening_cash: (!hasOpenShift && !pendingHandover) || (hasOpenShift && shift.opening_cash == null),
    needs_handover_acceptance: !hasOpenShift && !!pendingHandover,
    pending_handover: pendingHandover,
    opening_cash: openingCash,
    expected_closing_cash: expectedClosing,
    order_count: Number(totals?.order_count) || 0,
    total_sales: Number(totals?.total_sales) || 0,
    card_total: Number(totals?.card_total) || 0,
    cash_total: cashSales,
    discount_total: Number(totals?.discount_total) || 0,
  };
}

function openWaiterShiftWithCash(staffId, openingCash) {
  const id = Number(staffId);
  if (!id) throw new Error("Kamarieri i panjohur.");
  const staff = sqlite.prepare("SELECT id, name FROM staff WHERE id = ? AND active = 1").get(id);
  if (!staff) throw new Error("Kamarieri nuk u gjet.");
  if (getPendingHandoverForStaff(id)) {
    throw new Error("Keni një ndërrim për të pranuar — përdorni «Pranoj ndërrimin».");
  }
  const amount = normalizeCashAmount(openingCash);

  const existing = getOpenShift(id);
  if (existing) {
    if (existing.opening_cash != null) {
      throw new Error("Nderrimi është hapur tashmë.");
    }
    sqlite.prepare("UPDATE waiter_shifts SET opening_cash = ? WHERE id = ?").run(amount, existing.id);
    const shift = sqlite.prepare("SELECT * FROM waiter_shifts WHERE id = ?").get(existing.id);
    const totals = computeShiftTotals(shift.id);
    const activeLabels = activeTableLabelsForWaiter(staff.name);
    return enrichShiftSummary(shift, { ...totals, active_tables: activeLabels.length }, staff, {
      active_table_labels: activeLabels,
      handover_peers_count: listHandoverPeers(id).length,
    });
  }

  const now = new Date().toISOString();
  const r = sqlite.prepare(`
    INSERT INTO waiter_shifts (staff_id, waiter_name, opened_at, opening_cash)
    VALUES (?, ?, ?, ?)
  `).run(id, staff.name, now, amount);
  const shift = sqlite.prepare("SELECT * FROM waiter_shifts WHERE id = ?").get(r.lastInsertRowid);
  return enrichShiftSummary(shift, {
    order_count: 0, total_sales: 0, card_total: 0, cash_total: 0, discount_total: 0, active_tables: 0,
  }, staff, {
    active_table_labels: [],
    handover_peers_count: listHandoverPeers(id).length,
  });
}

function acceptShiftHandover(staffId, handoverId, openingCash) {
  const id = Number(staffId);
  const hid = Number(handoverId);
  if (!id || !hid) throw new Error("Të dhëna të pavlefshme për pranimin e ndërrimit.");
  const staff = sqlite.prepare("SELECT id, name FROM staff WHERE id = ? AND active = 1").get(id);
  if (!staff) throw new Error("Kamarieri nuk u gjet.");
  if (getOpenShift(id)) throw new Error("Keni tashmë një nderrim aktiv.");

  const handover = sqlite.prepare(`
    SELECT * FROM shift_handovers WHERE id = ? AND to_staff_id = ? AND status = 'pending'
  `).get(hid, id);
  if (!handover) throw new Error("Ndërrimi për pranim nuk u gjet ose u pranua tashmë.");

  const acceptedAmount = normalizeCashAmount(openingCash);
  const handoverCash = Number(handover.handover_cash) || 0;
  const openingDiscrepancy = Math.round((acceptedAmount - handoverCash) * 100) / 100;
  const now = new Date().toISOString();

  return sqlite.transaction(() => {
    const r = sqlite.prepare(`
      INSERT INTO waiter_shifts (staff_id, waiter_name, opened_at, opening_cash, handover_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, staff.name, now, acceptedAmount, hid);
    const newShiftId = r.lastInsertRowid;

    sqlite.prepare(`
      UPDATE shift_handovers SET
        status = 'accepted',
        accepted_at = ?,
        opening_cash_accepted = ?,
        opening_discrepancy = ?,
        to_shift_id = ?
      WHERE id = ?
    `).run(now, acceptedAmount, openingDiscrepancy, newShiftId, hid);

    const shift = sqlite.prepare("SELECT * FROM waiter_shifts WHERE id = ?").get(newShiftId);
    return enrichShiftSummary(shift, {
      order_count: 0, total_sales: 0, card_total: 0, cash_total: 0, discount_total: 0, active_tables: 0,
    }, staff, {
      active_table_labels: [],
      handover_peers_count: listHandoverPeers(id).length,
      accepted_handover: {
        ...handover,
        opening_cash_accepted: acceptedAmount,
        opening_discrepancy: openingDiscrepancy,
      },
    });
  })();
}

function getWaiterShiftSummary(staffId) {
  const id = Number(staffId);
  if (!id) return null;
  const staff = sqlite.prepare("SELECT id, name FROM staff WHERE id = ? AND active = 1").get(id);
  if (!staff) return null;

  const pendingHandover = getPendingHandoverForStaff(id);
  const shift = getOpenShift(id);
  const peersCount = listHandoverPeers(id).length;
  const activeLabels = activeTableLabelsForWaiter(staff.name);
  const activeDetails = activeTableDetailsForWaiter(staff.name);

  const dbgWithShift = shift
    ? sqlite.prepare(`
      SELECT COUNT(*) AS n,
        COALESCE(SUM(CASE WHEN payment_method != 'karte' THEN total ELSE 0 END), 0) AS cash
      FROM daily_log
      WHERE status = 'completed' AND shift_id = ?
    `).get(shift.id)
    : { n: 0, cash: 0 };
  const dbgOrphanStaff = sqlite.prepare(`
    SELECT COUNT(*) AS n,
      COALESCE(SUM(CASE WHEN payment_method != 'karte' THEN total ELSE 0 END), 0) AS cash
    FROM daily_log
    WHERE status = 'completed' AND shift_id IS NULL AND staff_id = ?
  `).get(id);
  const dbgOrphanName = sqlite.prepare(`
    SELECT COUNT(*) AS n,
      COALESCE(SUM(CASE WHEN payment_method != 'karte' THEN total ELSE 0 END), 0) AS cash
    FROM daily_log
    WHERE status = 'completed' AND shift_id IS NULL AND staff_id IS NULL
      AND LOWER(TRIM(waiter_name)) = LOWER(?)
  `).get(staff.name);
  const dbgRecent = sqlite.prepare(`
    SELECT id, table_number, waiter_name, staff_id, shift_id, total, payment_method, cloud_sale_id, date, time
    FROM daily_log
    WHERE status = 'completed'
      AND (staff_id = ? OR LOWER(TRIM(waiter_name)) = LOWER(?))
    ORDER BY id DESC
    LIMIT 5
  `).all(id, staff.name);

  if (!shift) {
    const totals = computeOrphanDailyLogTotals(id, staff.name);
    const summary = enrichShiftSummary(null, { ...totals, active_tables: activeLabels.length }, staff, {
      pendingHandover,
      active_table_labels: activeLabels,
      active_table_details: activeDetails,
      handover_peers_count: peersCount,
    });
    console.log(
      "[shift/api] getWaiterShiftSummary (pa nderrim) staff=", staff.name,
      "staff_id=", id,
      "cash_total=", totals.cash_total,
      "opening_cash=", summary.opening_cash,
      "kpi-arke=", (Number(summary.opening_cash) || 0) + (Number(summary.cash_total) || 0),
      "| daily_log shift_id=NULL",
      "| me_shift_id: n=", dbgWithShift.n, "cash=", dbgWithShift.cash,
      "| orphan staff_id: n=", dbgOrphanStaff.n, "cash=", dbgOrphanStaff.cash,
      "| orphan waiter_name: n=", dbgOrphanName.n, "cash=", dbgOrphanName.cash,
      "| recent=", JSON.stringify(dbgRecent),
    );
    return summary;
  }
  const totals = computeShiftTotals(shift.id, staff.id, staff.name);
  const summary = enrichShiftSummary(shift, { ...totals, active_tables: activeLabels.length }, staff, {
    pendingHandover,
    active_table_labels: activeLabels,
    active_table_details: activeDetails,
    handover_peers_count: peersCount,
  });
  console.log(
    "[shift/api] getWaiterShiftSummary staff=", staff.name,
    "staff_id=", id,
    "shift_id=", shift.id,
    "cash_total=", totals.cash_total,
    "opening_cash=", shift.opening_cash,
    "kpi-arke (opening+cash)=", (Number(shift.opening_cash) || 0) + (Number(totals.cash_total) || 0),
    "→ UI cash_total=", summary.cash_total,
    "→ UI opening_cash=", summary.opening_cash,
    "→ UI kpi-arke=", (Number(summary.opening_cash) || 0) + (Number(summary.cash_total) || 0),
    "| daily_log me shift_id=", shift.id, ": n=", dbgWithShift.n, "cash=", dbgWithShift.cash,
    "| orphan staff_id=", id, ": n=", dbgOrphanStaff.n, "cash=", dbgOrphanStaff.cash,
    "| orphan waiter_name=", staff.name, ": n=", dbgOrphanName.n, "cash=", dbgOrphanName.cash,
    "| recent daily_log=", JSON.stringify(dbgRecent),
  );
  return summary;
}

function closeWaiterShift(staffId, actualClosingCash, handoverToStaffId) {
  const id = Number(staffId);
  if (!id) throw new Error("Kamarieri i panjohur.");
  const staff = sqlite.prepare("SELECT id, name FROM staff WHERE id = ? AND active = 1").get(id);
  if (!staff) throw new Error("Kamarieri nuk u gjet.");
  const shift = getOpenShift(id);
  if (!shift) throw new Error("Nuk ka nderrim aktiv.");
  if (shift.opening_cash == null) {
    throw new Error("Plotësoni fillimisht paratë e nisjes.");
  }

  let toStaffId = Number(handoverToStaffId) || 0;
  let toStaff = null;
  if (toStaffId === id) toStaffId = 0;
  if (toStaffId) {
    toStaff = sqlite.prepare("SELECT id, name FROM staff WHERE id = ? AND active = 1").get(toStaffId);
    if (!toStaff) throw new Error("Kamarieri që merr ndërrimin nuk u gjet.");
    if (getOpenShift(toStaffId)) {
      throw new Error(`${toStaff.name} ka ende nderrim aktiv — mbylleni fillimisht.`);
    }
    if (getPendingHandoverForStaff(toStaffId)) {
      throw new Error(`${toStaff.name} ka tashmë një ndërrim për pranim.`);
    }
  }

  const activeLabels = activeTableLabelsForWaiter(staff.name);
  if (activeLabels.length > 0) {
    throw new Error(`Mbyllni fillimisht tavolinat dhe pagesat: ${activeLabels.join(", ")}.`);
  }

  const totals = computeShiftTotals(shift.id);
  const opening = Number(shift.opening_cash) || 0;
  const actual = normalizeCashAmount(actualClosingCash);
  const expected = opening + (Number(totals.cash_total) || 0);
  const difference = Math.round((actual - expected) * 100) / 100;
  const closedAt = new Date().toISOString();

  return sqlite.transaction(() => {
    sqlite.prepare(`
      UPDATE waiter_shifts SET
        closed_at = ?,
        closing_cash_actual = ?,
        expected_closing_cash = ?,
        cash_difference = ?,
        cash_sales_total = ?,
        card_sales_total = ?,
        order_count_total = ?,
        total_sales = ?,
        discount_total = ?,
        handed_over_to_staff_id = ?
      WHERE id = ?
    `).run(
      closedAt,
      actual,
      expected,
      difference,
      Number(totals.cash_total) || 0,
      Number(totals.card_total) || 0,
      Number(totals.order_count) || 0,
      Number(totals.total_sales) || 0,
      Number(totals.discount_total) || 0,
      toStaff?.id || null,
      shift.id,
    );

    let handover = null;
    if (toStaff) {
      const handoverIns = sqlite.prepare(`
        INSERT INTO shift_handovers (
          from_shift_id, from_staff_id, from_waiter_name,
          to_staff_id, to_waiter_name,
          handover_cash, expected_cash, closing_discrepancy,
          status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        shift.id, staff.id, staff.name,
        toStaff.id, toStaff.name,
        actual, expected, difference,
        closedAt,
      );

      sqlite.prepare("UPDATE waiter_shifts SET handover_id = ? WHERE id = ?")
        .run(handoverIns.lastInsertRowid, shift.id);

      handover = sqlite.prepare("SELECT * FROM shift_handovers WHERE id = ?").get(handoverIns.lastInsertRowid);
    }

    const closedShift = sqlite.prepare("SELECT * FROM waiter_shifts WHERE id = ?").get(shift.id);

    return {
      shift: closedShift,
      handover,
      staff_id: staff.id,
      waiter_name: staff.name,
      handed_over_to_staff_id: toStaff?.id || null,
      handed_over_to_name: toStaff?.name || "",
      opening_cash: opening,
      expected_closing_cash: expected,
      closing_cash_actual: actual,
      cash_difference: difference,
      discount_total: Number(totals.discount_total) || 0,
      ...totals,
    };
  })();
}

function listShiftReports({ from, to, staff_id } = {}) {
  let sql = `
    SELECT ws.*,
      h.to_waiter_name AS handed_over_to_name,
      h.handover_cash,
      h.closing_discrepancy AS handover_closing_discrepancy,
      h.opening_cash_accepted,
      h.opening_discrepancy AS handover_opening_discrepancy,
      h.status AS handover_status,
      h.accepted_at AS handover_accepted_at
    FROM waiter_shifts ws
    LEFT JOIN shift_handovers h ON h.from_shift_id = ws.id
    WHERE ws.closed_at IS NOT NULL
  `;
  const params = [];
  if (from) {
    sql += " AND date(ws.closed_at) >= date(?)";
    params.push(from);
  }
  if (to) {
    sql += " AND date(ws.closed_at) <= date(?)";
    params.push(to);
  }
  if (staff_id) {
    sql += " AND ws.staff_id = ?";
    params.push(Number(staff_id));
  }
  sql += " ORDER BY ws.closed_at DESC, ws.id DESC LIMIT 500";
  return sqlite.prepare(sql).all(...params).map(row => ({
    ...row,
    opening_cash: row.opening_cash != null ? Number(row.opening_cash) : 0,
    closing_cash_actual: row.closing_cash_actual != null ? Number(row.closing_cash_actual) : null,
    expected_closing_cash: row.expected_closing_cash != null ? Number(row.expected_closing_cash) : null,
    cash_difference: row.cash_difference != null ? Number(row.cash_difference) : null,
    cash_sales_total: Number(row.cash_sales_total) || 0,
    card_sales_total: Number(row.card_sales_total) || 0,
    order_count_total: Number(row.order_count_total) || 0,
    total_sales: Number(row.total_sales) || 0,
    discount_total: Number(row.discount_total) || 0,
    handed_over_to_name: row.handed_over_to_name || null,
    handover_cash: row.handover_cash != null ? Number(row.handover_cash) : null,
    handover_status: row.handover_status || null,
  }));
}

function shiftMetaForWaiter(waiterName) {
  const staff = findStaffByName(waiterName);
  if (!staff) return { staff_id: null, shift_id: null };
  const shift = getOpenShift(staff.id);
  if (!shift || shift.opening_cash == null) {
    if (getPendingHandoverForStaff(staff.id)) {
      throw new Error("Pranoni ndërrimin për të vazhduar.");
    }
    throw new Error("Filloni nderrimin me paratë e nisjes.");
  }
  return { staff_id: staff.id, shift_id: shift.id };
}

function validatePin(pin) {
  const p = String(pin ?? "").trim();
  if (!/^\d{4}$/.test(p)) throw new Error("PIN duhet të jetë 4 shifra");
  return p;
}

function pinInUse(pin, excludeId = null) {
  const row = excludeId != null
    ? sqlite.prepare("SELECT id FROM staff WHERE pin = ? AND id != ?").get(pin, excludeId)
    : sqlite.prepare("SELECT id FROM staff WHERE pin = ?").get(pin);
  return !!row;
}

function addStaff(name, pin) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Shkruani emrin e kamarierit");
  const p = validatePin(pin);
  if (pinInUse(p)) throw new Error("Ky PIN përdoret tashmë");
  sqlite.prepare("INSERT INTO staff (name, pin, active) VALUES (?, ?, 1)").run(trimmed, p);
}

function updateStaffPin(id, pin) {
  const p = validatePin(pin);
  if (pinInUse(p, id)) throw new Error("Ky PIN përdoret tashmë");
  const row = sqlite.prepare("SELECT id FROM staff WHERE id = ?").get(id);
  if (!row) throw new Error("Kamarieri nuk u gjet");
  sqlite.prepare("UPDATE staff SET pin = ? WHERE id = ?").run(p, id);
}

function findStaffByPin(pin) {
  const p = validatePin(pin);
  return sqlite.prepare("SELECT * FROM staff WHERE pin = ? AND active = 1").get(p);
}

function normalizeCardUid(uid) {
  return String(uid ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function validateCardUid(uid) {
  const u = normalizeCardUid(uid);
  if (u.length < 4) throw new Error("Kartela nuk u lexua saktë");
  if (u.length > 64) throw new Error("Kodi i kartelës është shumë i gjatë");
  return u;
}

function cardUidInUse(cardUid, excludeId = null) {
  const u = normalizeCardUid(cardUid);
  const row = excludeId != null
    ? sqlite.prepare("SELECT id FROM staff WHERE card_uid = ? AND id != ?").get(u, excludeId)
    : sqlite.prepare("SELECT id FROM staff WHERE card_uid = ?").get(u);
  return !!row;
}

function updateStaffCard(id, cardUid) {
  const u = validateCardUid(cardUid);
  if (cardUidInUse(u, id)) throw new Error("Kjo kartelë përdoret tashmë");
  const row = sqlite.prepare("SELECT id FROM staff WHERE id = ?").get(id);
  if (!row) throw new Error("Kamarieri nuk u gjet");
  sqlite.prepare("UPDATE staff SET card_uid = ? WHERE id = ?").run(u, id);
}

function clearStaffCard(id) {
  const row = sqlite.prepare("SELECT id FROM staff WHERE id = ?").get(id);
  if (!row) throw new Error("Kamarieri nuk u gjet");
  sqlite.prepare("UPDATE staff SET card_uid = NULL WHERE id = ?").run(id);
}

function findStaffByCard(cardUid) {
  const u = validateCardUid(cardUid);
  return sqlite.prepare("SELECT * FROM staff WHERE card_uid = ? AND active = 1").get(u);
}

function deleteStaff(id) {
  sqlite.prepare("DELETE FROM staff WHERE id = ?").run(id);
}

function getActiveStaffToday() {
  const today = new Date().toISOString().slice(0, 10);
  return sqlite.prepare(`
    SELECT DISTINCT waiter_name AS name FROM orders
    WHERE date(created_at) = date(?)
    ORDER BY waiter_name
  `).all(today).map(r => r.name);
}

function updateSettings({
  restaurant_name,
  admin_password,
  business_subtype,
  business_type,
  biz_name,
} = {}) {
  const nameRaw =
    restaurant_name != null ? restaurant_name : biz_name != null ? biz_name : null;
  if (nameRaw != null) {
    const name = String(nameRaw).trim();
    setSetting("restaurant_name", name);
    setSetting("biz_name", name);
  }
  const subtypeRaw = business_subtype != null ? business_subtype : business_type;
  if (subtypeRaw != null) {
    const type = normalizeBusinessSubtype(subtypeRaw);
    setSetting("business_subtype", type);
    setSetting("business_type", type);
  }
  if (admin_password) setSetting("admin_password", hashPassword(admin_password));
  setSetting("table_count", getTableCount());
}

const { DEFAULT_CLOUD_SERVER, normalizeCloudServerUrl, getPublicCloudServerUrl } = require("./cloud-server-url");

function getCloudSettings() {
  const license = require("./license");
  return {
    cloud_server_url: "",
    cloud_license_key: "",
    kitchen_slug: "",
    kitchen_key: "",
    cloud_client_id: "",
    cloud_client_name: "",
    device_id: license.getMachineId(),
  };
}

function updateCloudSettings(_opts) {
  try {
    sqlite.prepare("DELETE FROM settings WHERE key = ?").run("cloud_license_key");
  } catch {
    /* ignore */
  }
}

function updateKitchenAccess(_opts) {
  for (const k of ["kitchen_slug", "kitchen_key", "cloud_client_id", "cloud_client_name"]) {
    try {
      sqlite.prepare("DELETE FROM settings WHERE key = ?").run(k);
    } catch {
      /* ignore */
    }
  }
}

function exportReportText(dateFrom, dateTo) {
  const rep = getReports(dateFrom, dateTo);
  const name = getSetting("restaurant_name", VERSION.versionLabel);
  let txt = `RAPORTI — ${name}\n`;
  txt += `Periudha: ${rep.dateFrom} deri ${rep.dateTo}\n`;
  txt += `${"=".repeat(40)}\n`;
  txt += `Shitjet totale: ${rep.totalSales.toFixed(2)} €\n`;
  txt += `Porosi te perfunduara: ${rep.orderCount}\n\n`;
  txt += `Artikujt me te shitur:\n`;
  for (const it of rep.topItems) {
    const rev = it.revenue != null ? ` (${Number(it.revenue).toFixed(2)} €)` : "";
    txt += `  - ${it.name}: ${it.quantity} copë${rev}\n`;
  }
  txt += `\nGjeneruar: ${new Date().toLocaleString("sq-AL")}\n`;
  return txt;
}

function exportMenuText() {
  const name = getSetting("restaurant_name", VERSION.versionLabel);
  const cats = getCategoryNames();
  const items = getMenuItems(false);
  let txt = `MENU — ${name}\n`;
  txt += `Versioni: ${getSetting("version", VERSION.versionLabel)}\n`;
  txt += `${"=".repeat(40)}\n\n`;
  for (const cat of cats) {
    const catItems = items.filter(i => i.category === cat);
    if (!catItems.length) continue;
    txt += `[ ${cat} ]\n`;
    for (const it of catItems) {
      const status = it.active ? "" : " (joaktiv)";
      txt += `  ${it.name} — ${it.price.toFixed(2)} €${status}\n`;
    }
    txt += "\n";
  }
  txt += `Gjeneruar: ${new Date().toLocaleString("sq-AL")}\n`;
  return txt;
}

function getPurchaseStats30Days() {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  const from = d.toISOString().slice(0, 10);
  const row = sqlite.prepare(`
    SELECT
      COUNT(*) AS invoice_count,
      COALESCE(SUM(total), 0) AS total_spent,
      COUNT(DISTINCT supplier) AS supplier_count
    FROM purchase_invoices
    WHERE date(invoice_date) >= date(?)
  `).get(from);
  return {
    invoiceCount: Number(row?.invoice_count) || 0,
    totalSpent: Number(row?.total_spent) || 0,
    supplierCount: Number(row?.supplier_count) || 0,
    fromDate: from,
  };
}

function listPurchases({ from, to, supplier } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = from || "1970-01-01";
  const toDate = to || today;
  let sql = `
    SELECT * FROM purchase_invoices
    WHERE date(invoice_date) >= date(?) AND date(invoice_date) <= date(?)
  `;
  const params = [fromDate, toDate];
  if (supplier && String(supplier).trim()) {
    sql += " AND supplier LIKE ?";
    params.push(`%${String(supplier).trim()}%`);
  }
  sql += " ORDER BY invoice_date DESC, id DESC";
  return sqlite.prepare(sql).all(...params);
}

function getPurchaseInvoice(id) {
  const inv = sqlite.prepare("SELECT * FROM purchase_invoices WHERE id = ?").get(Number(id));
  if (!inv) return null;
  const items = sqlite.prepare(`
    SELECT * FROM purchase_invoice_items WHERE invoice_id = ? ORDER BY id
  `).all(inv.id);
  return { ...inv, items };
}

/** Gjen menu_item_id nga rreshti i porosisë (menu_item_id / menu_id / emër) — për stok. */
function resolveMenuItemIdForStock(it, byId, byName) {
  let menuItemId = it?.menu_item_id != null ? Number(it.menu_item_id) : NaN;
  if (Number.isFinite(menuItemId) && menuItemId > 0 && byId.has(menuItemId)) {
    return menuItemId;
  }
  // Mos përdor it.id — mund të jetë id rreshti porosie, jo produkti.
  const alt = it?.menu_id ?? it?.local_id;
  if (alt != null) {
    const n = Number(alt);
    if (Number.isFinite(n) && n > 0 && byId.has(n)) return n;
  }
  const name = String(it?.name || it?.emri || it?.item_name || "")
    .trim()
    .toLowerCase();
  if (name && byName.has(name)) return Number(byName.get(name).id);
  if (name) {
    for (const [n, m] of byName) {
      if (n.includes(name) || name.includes(n)) return Number(m.id);
    }
  }
  return null;
}

/**
 * Zbret stokun për artikujt e shitur (porosi e mbyllur/paguar).
 * Thirret nga closeTable / closeTablePartial / importClosedWebWaiterSaleFromCloud.
 * Nëse mungon menu_item_id, përpiqet me emër (për porosi cloud / JSON të vjetër).
 */
function decrementMenuItemStock(items) {
  const menu = getMenuItems(false);
  const byId = new Map(menu.map((m) => [Number(m.id), m]));
  const byName = new Map(menu.map((m) => [String(m.name || "").trim().toLowerCase(), m]));
  const dec = sqlite.prepare(`
    UPDATE menu_items SET stock_qty = MAX(0, COALESCE(stock_qty, 0) - ?) WHERE id = ?
  `);
  const getQty = sqlite.prepare(
    "SELECT COALESCE(stock_qty, 0) AS stock_qty FROM menu_items WHERE id = ?",
  );
  for (const it of items || []) {
    const menuItemId = resolveMenuItemIdForStock(it, byId, byName);
    const qty = Number(it?.quantity ?? it?.qty ?? it?.sasia) || 0;
    if (!menuItemId || qty <= 0) {
      console.warn(
        "[stock] SKIP decrement — mungon productId ose qty<=0",
        JSON.stringify({
          menu_item_id: it?.menu_item_id,
          id: it?.id,
          name: it?.name,
          quantity: it?.quantity,
        }),
      );
      continue;
    }
    const stockBefore = Number(getQty.get(menuItemId)?.stock_qty) || 0;
    dec.run(qty, menuItemId);
    const stockAfter = Number(getQty.get(menuItemId)?.stock_qty) || 0;
    console.log(
      `[stock] decrement productId=${menuItemId} qty=${qty} stockBefore=${stockBefore} stockAfter=${stockAfter}`,
    );
    if (stockAfter <= 0) {
      const name = byId.get(menuItemId)?.name || String(menuItemId);
      console.warn(`[stock] ALERT stoku=0 për «${name}» (productId=${menuItemId})`);
    }
  }
}

/** Shton stok (blerje / rregullim manual). */
function increaseMenuItemStock(menuItemId, qty) {
  const id = Number(menuItemId);
  const q = Number(qty);
  if (!id || !(q > 0)) throw new Error("Produkt ose sasi e pavlefshme për stok.");
  const row = sqlite.prepare("SELECT id, name, COALESCE(stock_qty,0) AS stock_qty FROM menu_items WHERE id = ?").get(id);
  if (!row) throw new Error("Produkti nuk u gjet");
  const stockBefore = Number(row.stock_qty) || 0;
  sqlite.prepare(`UPDATE menu_items SET stock_qty = COALESCE(stock_qty, 0) + ? WHERE id = ?`).run(q, id);
  const stockAfter = stockBefore + q;
  console.log(
    `[stock] increase productId=${id} qty=${q} stockBefore=${stockBefore} stockAfter=${stockAfter}`,
  );
  return { id, name: row.name, stock_qty: stockAfter, stockBefore };
}

/** Data e faturës së fundit (blerje + rregullime) — për rend kronologjik. */
function getLatestPurchaseInvoiceDate() {
  const row = sqlite
    .prepare(`SELECT MAX(date(invoice_date)) AS d FROM purchase_invoices`)
    .get();
  return row?.d ? String(row.d).slice(0, 10) : null;
}

/** Shton/ul stok nga blerje ose rregullim (qty mund të jetë negative te rregullimi). */
function applyPurchaseStockDelta(menuItemId, qty) {
  const id = Number(menuItemId);
  const q = Number(qty);
  if (!id || !Number.isFinite(q) || q === 0) {
    throw new Error("Produkt ose sasi e pavlefshme për stok.");
  }
  if (q > 0) return increaseMenuItemStock(id, q);
  const abs = Math.abs(q);
  const row = sqlite
    .prepare("SELECT id, name, COALESCE(stock_qty,0) AS stock_qty FROM menu_items WHERE id = ?")
    .get(id);
  if (!row) throw new Error("Produkti nuk u gjet");
  const stockBefore = Number(row.stock_qty) || 0;
  sqlite
    .prepare(`UPDATE menu_items SET stock_qty = MAX(0, COALESCE(stock_qty, 0) - ?) WHERE id = ?`)
    .run(abs, id);
  const stockAfter = Math.max(0, stockBefore - abs);
  console.log(
    `[stock] adjust-decrease productId=${id} qty=${abs} stockBefore=${stockBefore} stockAfter=${stockAfter}`,
  );
  return { id, name: row.name, stock_qty: stockAfter, stockBefore };
}

/**
 * Regjistron faturë blerjeje (ose rregullim).
 * - Faturë normale: data nuk mund të jetë para faturës së fundit; sasia > 0.
 * - Rregullim (status=adjustment / allow_backdate): lejon data të vjetra dhe sasi ±.
 * Shkruan në purchase_invoices → shfaqet te Blerjet + Kontabilisti + bilanci.
 */
function normalizePurchaseVatRate(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 18;
  if (n === 0 || n === 8 || n === 18) return n;
  if (n <= 0) return 0;
  if (n <= 8) return 8;
  return 18;
}

/** Normë TVSH për rresht blerjeje: payload → katalog → header fature. */
function resolvePurchaseLineVatRate(raw, menuVatCategory, headerFallback) {
  if (raw?.vat_rate != null && raw.vat_rate !== "") {
    return normalizePurchaseVatRate(raw.vat_rate);
  }
  if (menuVatCategory != null && menuVatCategory !== "") {
    return normalizePurchaseVatRate(menuVatCategory);
  }
  return normalizePurchaseVatRate(headerFallback);
}

/** Header: normë e vetme, ose -1 kur rreshtat kanë norma të ndryshme (mixed). */
function resolvePurchaseInvoiceHeaderVatRate(lineRates) {
  const rates = (lineRates || []).map((r) => normalizePurchaseVatRate(r));
  if (!rates.length) return 18;
  const unique = [...new Set(rates)];
  return unique.length === 1 ? unique[0] : -1;
}

function normalizePurchaseKind(v) {
  const k = String(v || "goods").trim().toLowerCase();
  if (k === "invest" || k === "investment" || k === "investime") return "invest";
  if (k === "expense" || k === "shpenzim") return "expense";
  return "goods";
}

function createPurchaseInvoice({
  supplier,
  invoice_number,
  invoice_date,
  items,
  status,
  allow_backdate,
  notes,
  supplier_nui,
  supplier_vat,
  vat_rate,
  purchase_kind,
} = {}) {
  const sup = String(supplier || "").trim();
  if (!sup) throw new Error("Shkruani emrin e furnizuesit");
  const lines = Array.isArray(items) ? items : [];
  if (!lines.length) throw new Error("Shtoni të paktën një artikull");
  const nuiStored = String(supplier_nui || "").trim().slice(0, 64);
  const vatIdStored = String(supplier_vat || "").trim().slice(0, 64);
  const headerFallbackRate = normalizePurchaseVatRate(vat_rate);
  const kindStored = normalizePurchaseKind(purchase_kind);

  const isAdjustment =
    String(status || "").toLowerCase() === "adjustment" || allow_backdate === true;
  const docStatus = isAdjustment ? "adjustment" : "completed";

  const normalized = [];
  for (const raw of lines) {
    const menuItemId = raw.menu_item_id ? Number(raw.menu_item_id) : null;
    const qty = Number(raw.quantity);
    const unitPrice = Number(raw.unit_price);
    if (!menuItemId) throw new Error("Zgjidhni produktin për çdo rresht");
    if (!Number.isFinite(qty) || qty === 0) {
      throw new Error(isAdjustment ? "Sasia nuk mund të jetë 0" : "Sasia duhet të jetë më e madhe se 0");
    }
    if (!isAdjustment && !(qty > 0)) throw new Error("Sasia duhet të jetë më e madhe se 0");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Çmimi nuk mund të jetë negativ");
    const menuRow = sqlite
      .prepare("SELECT id, name, COALESCE(vat_category, '18') AS vat_category FROM menu_items WHERE id = ?")
      .get(menuItemId);
    if (!menuRow) throw new Error("Produkti nuk u gjet");
    const lineVatRate = resolvePurchaseLineVatRate(raw, menuRow.vat_category, headerFallbackRate);
    normalized.push({
      menu_item_id: menuRow.id,
      product_name: menuRow.name,
      quantity: qty,
      unit_price: unitPrice,
      line_total: Math.round(qty * unitPrice * 100) / 100,
      vat_rate: lineVatRate,
    });
  }

  const rateStored = resolvePurchaseInvoiceHeaderVatRate(normalized.map((it) => it.vat_rate));

  const invDate = String(invoice_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invDate)) {
    throw new Error("Data e faturës është e pavlefshme");
  }
  const invNum = String(invoice_number || "").trim();
  const noteTxt = String(notes || "").trim();

  if (!isAdjustment) {
    const latest = getLatestPurchaseInvoiceDate();
    if (latest && invDate < latest) {
      throw new Error(
        `Nuk mund të regjistroni faturë me datë para faturës së fundit (${latest}). ` +
          `Përdorni butonin «Rregullimi i faturës» për korrigjime / fatura të vjetra.`,
      );
    }
  }

  if (invNum) {
    const dup = sqlite
      .prepare(
        `SELECT id FROM purchase_invoices
         WHERE lower(trim(supplier)) = lower(?) AND trim(invoice_number) = ?
         LIMIT 1`,
      )
      .get(sup, invNum);
    if (dup) {
      throw new Error(
        `Fatura «${invNum}» për «${sup}» ekziston tashmë (ID ${dup.id}). Nuk dublikohet.`,
      );
    }
  }

  const total = normalized.reduce((s, it) => s + it.line_total, 0);
  const supplierStored = noteTxt && isAdjustment ? `${sup}` : sup;
  const numberStored =
    invNum ||
    (isAdjustment ? `RRG-${Date.now()}` : `BL-${Date.now()}`);

  return sqlite.transaction(() => {
    const r = sqlite
      .prepare(
        `
      INSERT INTO purchase_invoices (
        supplier, invoice_number, invoice_date, total, status,
        supplier_nui, supplier_vat, vat_rate, purchase_kind
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        noteTxt && isAdjustment ? `${supplierStored} · ${noteTxt}`.slice(0, 200) : supplierStored,
        numberStored,
        invDate,
        total,
        docStatus,
        nuiStored,
        vatIdStored,
        rateStored,
        kindStored,
      );
    const invoiceId = r.lastInsertRowid;
    const ins = sqlite.prepare(`
      INSERT INTO purchase_invoice_items
        (invoice_id, menu_item_id, product_name, quantity, unit_price, line_total, vat_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const it of normalized) {
      ins.run(
        invoiceId,
        it.menu_item_id,
        it.product_name,
        it.quantity,
        it.unit_price,
        it.line_total,
        it.vat_rate,
      );
      if (kindStored === "goods") {
        applyPurchaseStockDelta(it.menu_item_id, it.quantity);
      } else {
        console.log(`[stock] skip purchase stock — kind=${kindStored}`);
      }
    }
    const saved = getPurchaseInvoice(invoiceId);
    if (!saved || !saved.items?.length) {
      throw new Error("Ruajtja e faturës dështoi — rifreskoni dhe provoni sërish.");
    }
    return saved;
  })();
}

/** Alias i qartë për rregullime (data e vjetër / sasi ±). */
function createPurchaseAdjustment(payload) {
  return createPurchaseInvoice({
    ...payload,
    status: "adjustment",
    allow_backdate: true,
  });
}

/**
 * Fshin faturën e blerjes dhe kthen stokun (anulon efektin e blerjes).
 * Përdoret për faturë të gabuar AI / test.
 */
function deletePurchaseInvoice(id) {
  const invoiceId = Number(id);
  if (!invoiceId) throw new Error("ID e faturës e pavlefshme");
  const inv = getPurchaseInvoice(invoiceId);
  if (!inv) throw new Error("Fatura nuk u gjet");
  const kind = normalizePurchaseKind(inv.purchase_kind);

  return sqlite.transaction(() => {
    for (const it of inv.items || []) {
      const mid = Number(it.menu_item_id);
      const qty = Number(it.quantity);
      if (!mid || !Number.isFinite(qty) || qty === 0) continue;
      if (kind === "goods") {
        applyPurchaseStockDelta(mid, -qty);
      } else {
        console.log(`[stock] skip purchase stock — kind=${kind}`);
      }
    }
    sqlite.prepare("DELETE FROM purchase_invoice_items WHERE invoice_id = ?").run(invoiceId);
    sqlite.prepare("DELETE FROM purchase_invoices WHERE id = ?").run(invoiceId);
    return { ok: true, id: invoiceId, supplier: inv.supplier, invoice_number: inv.invoice_number };
  })();
}

const EXPENSE_CATEGORIES = ["qera", "pastrim", "sherbime", "paga", "papritur", "tjeter"];

function addExpense({ expense_date, vendor_name, description, category, amount, entered_by, vendor_nui, vat_rate }) {
  const date = String(expense_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const vendor = String(vendor_name || "").trim();
  if (!vendor) throw new Error("Shkruani emrin e firmës");
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error("Shuma duhet të jetë më e madhe se 0");
  const cat = EXPENSE_CATEGORIES.includes(String(category)) ? String(category) : "tjeter";
  const rate = normalizePurchaseVatRate(vat_rate == null || vat_rate === "" ? 18 : vat_rate);
  try {
    const r = sqlite.prepare(`
      INSERT INTO expenses (expense_date, vendor_name, description, category, amount, entered_by, vendor_nui, vat_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(date, vendor, String(description || "").trim(), cat, amt, String(entered_by || "").trim(), String(vendor_nui || "").trim(), rate);
    return r.lastInsertRowid;
  } catch {
    try {
      const r = sqlite.prepare(`
        INSERT INTO expenses (expense_date, vendor_name, description, category, amount, entered_by, vendor_nui)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(date, vendor, String(description || "").trim(), cat, amt, String(entered_by || "").trim(), String(vendor_nui || "").trim());
      return r.lastInsertRowid;
    } catch {
      const r = sqlite.prepare(`
        INSERT INTO expenses (expense_date, vendor_name, description, category, amount, entered_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(date, vendor, String(description || "").trim(), cat, amt, String(entered_by || "").trim());
      return r.lastInsertRowid;
    }
  }
}

function listExpenses({ from, to } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = from || "1970-01-01";
  const toDate = to || today;
  return sqlite.prepare(`
    SELECT * FROM expenses
    WHERE date(expense_date) >= date(?) AND date(expense_date) <= date(?)
    ORDER BY expense_date DESC, id DESC
  `).all(fromDate, toDate);
}

function deleteExpense(id) {
  sqlite.prepare("DELETE FROM expenses WHERE id = ?").run(Number(id));
}

/**
 * Computes VAT per line item using each item's own vat_category (menu_items),
 * falling back to the global tvsh_percent rate for items with no menu_item_id
 * (deleted/renamed products) — same "back VAT out of the gross" approach as
 * calcFiscalTotals, so per-item and order-level totals never disagree.
 */
function computeItemsVat(items, fallbackPercent, saleMeta = null) {
  const promotionService = require("./promotion-service");
  const prepared = promotionService.prepareItemsForVatLedger(
    items,
    saleMeta || {},
    module.exports,
  );
  const ids = [
    ...new Set(
      prepared
        .map((it) =>
          it?.menu_item_id != null ? Number(it.menu_item_id) : null,
        )
        .filter((id) => id != null),
    ),
  ];
  const rateById = new Map();
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = sqlite
      .prepare(
        `SELECT id, COALESCE(vat_category, '18') AS vat_category FROM menu_items WHERE id IN (${placeholders})`,
      )
      .all(...ids);
    for (const r of rows) rateById.set(r.id, Number(r.vat_category));
  }
  const { buildSaleVatBuckets } = require("./kontabilisti-atk");
  return buildSaleVatBuckets(prepared, {
    targetTotal: saleMeta?.total,
    fallbackPercent: Number(fallbackPercent) || 18,
    rateByMenuId: rateById,
  });
}

/** Shuma e tatimit nga vat_breakdown_json (A+B+C+D+E) — kolona vat_amount NUK ekziston. */
function sumVatBreakdownJson(raw) {
  try {
    const o = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
    const total = ["A", "B", "C", "D", "E"].reduce(
      (s, k) => s + (Number(o[k] ?? o[k.toLowerCase()]) || 0),
      0
    );
    return Math.round(total * 100) / 100;
  } catch {
    return 0;
  }
}

function normalizeSefFiscalLedgerRow(fr) {
  if (!fr) return fr;
  return {
    ...fr,
    vat_amount: sumVatBreakdownJson(fr.vat_breakdown_json),
  };
}

/** Overlay SEF: NUIKF + shkronja TVSH + tatimi real — pa ndryshuar logjikën bazë. */
function loadSefFiscalLedgerMaps() {
  const byReceipt = new Map();
  const bySaleId = new Map();
  try {
    const { isFiscalEnabled } = require("./fiscal/fiscal-config");
    if (!isFiscalEnabled()) return { sefOn: false, byReceipt, bySaleId };
  } catch {
    return { sefOn: false, byReceipt, bySaleId };
  }
  try {
    const rows = sqlite.prepare(`
      SELECT fr.id, fr.nuikf, fr.vat_breakdown_json, fr.items_json, fr.sale_id,
             r.receipt_number AS local_receipt_number
      FROM fiscal_receipts fr
      LEFT JOIN receipts r ON r.order_id = fr.sale_id
    `).all();
    for (const fr of rows || []) {
      const row = normalizeSefFiscalLedgerRow(fr);
      if (row.sale_id != null) bySaleId.set(Number(row.sale_id), row);
      if (row.local_receipt_number) byReceipt.set(String(row.local_receipt_number), row);
    }
    // Lidhje edhe përmes orders.fiscal_receipt_id
    try {
      const viaOrder = sqlite.prepare(`
        SELECT fr.id, fr.nuikf, fr.vat_breakdown_json, fr.items_json, fr.sale_id,
               r.receipt_number AS local_receipt_number, o.id AS order_id
        FROM orders o
        INNER JOIN fiscal_receipts fr ON fr.id = o.fiscal_receipt_id
        LEFT JOIN receipts r ON r.order_id = o.id
        WHERE o.fiscal_receipt_id IS NOT NULL
      `).all();
      for (const fr of viaOrder || []) {
        const row = normalizeSefFiscalLedgerRow(fr);
        if (fr.order_id != null) bySaleId.set(Number(fr.order_id), row);
        if (row.sale_id != null) bySaleId.set(Number(row.sale_id), row);
        if (row.local_receipt_number) byReceipt.set(String(row.local_receipt_number), row);
      }
    } catch {
      /* kolona fiscal_receipt_id mund të mungojë në DB të vjetër */
    }
    return { sefOn: true, byReceipt, bySaleId };
  } catch {
    return { sefOn: false, byReceipt, bySaleId };
  }
}

function sefVatLetterLabelFromItemsJson(itemsJson) {
  try {
    const items = JSON.parse(itemsJson || "[]");
    if (!Array.isArray(items) || !items.length) return "E";
    const letters = [
      ...new Set(
        items
          .map((it) =>
            String(it.vat_letter || it.vat_norm || "")
              .trim()
              .toUpperCase()
          )
          .filter((l) => /^[A-E]$/.test(l))
      ),
    ].sort();
    if (!letters.length) return "E";
    if (letters.length === 1) return letters[0];
    return letters.join("/");
  } catch {
    return "E";
  }
}

function sefRateFromLetter(letter) {
  const key = String(letter || "E").trim().toUpperCase();
  if (key === "D") return 8;
  if (key === "E") return 18;
  return 0;
}

/** Bucket-e TVSH nga kupon fiskal (items + vat_breakdown) — për librin ATK. */
function bucketsFromFiscalReceipt(fr, fallbackTotal) {
  const { VAT_RATES, VAT_LETTERS, round2, calculateVatBreakdown, calculateVatTaxBreakdown } =
    require("./fiscal/fiscal-vat");
  let items = [];
  try {
    items = JSON.parse(fr?.items_json || "[]");
  } catch {
    items = [];
  }
  const grossByLetter = calculateVatBreakdown(items) || { A: 0, B: 0, C: 0, D: 0, E: 0 };
  let taxByLetter = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  try {
    const o = typeof fr?.vat_breakdown_json === "string"
      ? JSON.parse(fr.vat_breakdown_json || "{}")
      : fr?.vat_breakdown_json || {};
    for (const L of VAT_LETTERS) {
      taxByLetter[L] = round2(Number(o[L] ?? o[L.toLowerCase()]) || 0);
    }
  } catch {
    /* */
  }
  const taxSum = round2(VAT_LETTERS.reduce((s, L) => s + (taxByLetter[L] || 0), 0));
  if (taxSum <= 0 && items.length) {
    const calc = calculateVatTaxBreakdown(items, {
      totalAmount: fallbackTotal != null ? Number(fallbackTotal) : undefined,
    });
    if (calc?.tax) taxByLetter = calc.tax;
  }

  // Ruaj A/B/C veç e veç (mos i bashko te rate 0) — secila shkon te kutia ATK e vet
  const buckets = [];
  for (const L of VAT_LETTERS) {
    const rate = Number(VAT_RATES[L]) || 0;
    const g = Number(grossByLetter[L]) || 0;
    const v = Number(taxByLetter[L]) || 0;
    if (g <= 0 && v <= 0) continue;
    buckets.push({
      letter: L,
      rate,
      gross: round2(g),
      vat: round2(v),
      net: round2(g - v),
    });
  }
  try {
    const { normalizeVatBuckets } = require("./kontabilisti-atk");
    return normalizeVatBuckets(
      buckets,
      fallbackTotal != null ? fallbackTotal : buckets.reduce((s, b) => s + b.gross, 0),
    );
  } catch {
    return buckets;
  }
}

function sefTaxFromDailyItems(items, saleMeta = null) {
  try {
    const fiscal = getFiscalSettings();
    const buckets = computeItemsVat(
      items,
      fiscal.tvsh_percent || 18,
      saleMeta,
    );
    const { round2 } = require("./fiscal/fiscal-vat");
    const letters = [
      ...new Set(
        buckets.filter((b) => (Number(b.gross) || 0) > 0).map((b) => b.letter),
      ),
    ].sort();
    return {
      vat_amount: round2(buckets.reduce((s, b) => s + (Number(b.vat) || 0), 0)),
      vat_rate: letters.length <= 1 ? letters[0] || "E" : letters.join("/"),
      vat_buckets: buckets,
    };
  } catch {
    return null;
  }
}

function overlaySefFiscalOnLedgerRow(row, entry, maps) {
  if (!maps?.sefOn) return row;
  let fr = null;
  if (row.receipt_number && maps.byReceipt.has(String(row.receipt_number))) {
    fr = maps.byReceipt.get(String(row.receipt_number));
  }
  if (!fr && entry?.receipt_number && maps.byReceipt.has(String(entry.receipt_number))) {
    fr = maps.byReceipt.get(String(entry.receipt_number));
  }
  // sale_id përmes receipts.order_id
  if (!fr && row.receipt_number) {
    try {
      const rec = sqlite
        .prepare("SELECT order_id FROM receipts WHERE receipt_number = ? LIMIT 1")
        .get(String(row.receipt_number));
      if (rec?.order_id != null && maps.bySaleId.has(Number(rec.order_id))) {
        fr = maps.bySaleId.get(Number(rec.order_id));
      }
    } catch {
      /* */
    }
  }

  if (fr) {
    const buckets = bucketsFromFiscalReceipt(fr, row.total);
    const vatAmount = buckets.reduce((s, b) => s + (Number(b.vat) || 0), 0);
    return {
      ...row,
      receipt_number: fr.nuikf || row.receipt_number,
      vat_rate: sefVatLetterLabelFromItemsJson(fr.items_json),
      vat_amount: Number(vatAmount.toFixed(2)) || Number(Number(fr.vat_amount || 0).toFixed(2)),
      vat_buckets: buckets,
    };
  }

  // Fiscal ON por pa kupon fiskal: shkronjë + tatim real (jo 0.00 / jo "18%")
  const pctMatch = String(row.vat_rate || "").match(/^(\d+(?:\.\d+)?)%$/);
  if (pctMatch) {
    const pct = Number(pctMatch[1]);
    const letter = pct === 8 ? "D" : pct === 18 ? "E" : pct === 0 ? "A" : null;
    if (letter) {
      return { ...row, vat_rate: letter };
    }
  }
  if (Number(row.vat_amount) === 0 && Number(row.total) > 0) {
    let items = [];
    try {
      items = JSON.parse(entry?.items_json || "[]");
    } catch {
      items = [];
    }
    const computed = sefTaxFromDailyItems(items, {
      subtotal: entry?.subtotal,
      discount_total: entry?.discount_total,
      total: entry?.total,
      promotion_id: entry?.promotion_id,
    });
    if (computed) {
      return {
        ...row,
        vat_rate: computed.vat_rate,
        vat_amount: computed.vat_amount,
        vat_buckets: computed.vat_buckets || row.vat_buckets,
      };
    }
  }
  return row;
}

/** Ndërton vat_buckets për një shumë bruto (shërbim / netë / charge) — për Kontabilisti ATK. */
function ledgerVatFromGross(gross, vatCategory) {
  const amt = Number(gross) || 0;
  const cat = VAT_CATEGORIES.includes(String(vatCategory)) ? String(vatCategory) : "18";
  const rate = vatPercentFromCategory(cat);
  const letter = vatLetterFromCategory(cat);
  try {
    const { splitGross, normalizeVatBuckets } = require("./kontabilisti-atk");
    const split = splitGross(amt, rate);
    const buckets = normalizeVatBuckets(
      [{ letter, rate, gross: split.gross, net: split.net, vat: split.vat }],
      amt,
    );
    const vatAmount = buckets.reduce((s, b) => s + (Number(b.vat) || 0), 0);
    return {
      vat_rate: `${rate}%`,
      vat_amount: Number(vatAmount.toFixed(2)),
      vat_buckets: buckets,
      vat_category: cat,
      vat_letter: letter,
    };
  } catch {
    const net = rate > 0 ? amt / (1 + rate / 100) : amt;
    const vat = amt - net;
    return {
      vat_rate: `${rate}%`,
      vat_amount: Number(vat.toFixed(2)),
      vat_buckets: [{
        letter,
        rate,
        gross: Number(amt.toFixed(2)),
        net: Number(net.toFixed(2)),
        vat: Number(vat.toFixed(2)),
      }],
      vat_category: cat,
      vat_letter: letter,
    };
  }
}

/** Gjej TVSH për room_charge (kolona, shërbimi, menu, ose default 18%). */
function resolveRoomChargeVatCategory(c) {
  if (VAT_CATEGORIES.includes(String(c?.vat_category))) return String(c.vat_category);
  if (c?.service_id != null) {
    try {
      const svc = getHotelServiceById(c.service_id);
      if (svc && VAT_CATEGORIES.includes(String(svc.vat_category))) return String(svc.vat_category);
    } catch { /* */ }
  }
  if (c?.menu_item_id != null) {
    try {
      const mi = sqlite
        .prepare("SELECT COALESCE(vat_category, '18') AS vat_category FROM menu_items WHERE id = ?")
        .get(Number(c.menu_item_id));
      if (mi && VAT_CATEGORIES.includes(String(mi.vat_category))) return String(mi.vat_category);
    } catch { /* */ }
  }
  const desc = String(c?.description || "").trim();
  if (desc) {
    try {
      const bare = desc
        .replace(/^\d+\s*[×x]\s*/i, "")
        .replace(/\s*—\s*.*$/, "")
        .replace(/\s*\([^)]*\)\s*$/, "")
        .trim();
      if (bare) {
        const svc = sqlite
          .prepare("SELECT COALESCE(vat_category, '18') AS vat_category FROM services WHERE lower(name) = lower(?)")
          .get(bare);
        if (svc && VAT_CATEGORIES.includes(String(svc.vat_category))) return String(svc.vat_category);
      }
    } catch { /* */ }
  }
  return "18";
}

function getSalesLedger({ from, to } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = from || today;
  const toDate = to || today;
  const fiscal = getFiscalSettings();
  const sefMaps = loadSefFiscalLedgerMaps();
  const entries = sqlite.prepare(`
    SELECT * FROM daily_log
    WHERE status = 'completed'
      AND date >= ? AND date <= ?
    ORDER BY date ASC, time ASC
  `).all(fromDate, toDate);

  const rows = entries.map(e => {
    const items = JSON.parse(e.items_json || "[]");
    const itemsSummary = items
      .map(it => `${String(it.name || "").trim()} x${Number(it.quantity) || 1}`)
      .join(", ");
    const saleMeta = {
      subtotal: e.subtotal,
      discount_total: e.discount_total,
      total: e.total,
      promotion_id: e.promotion_id,
    };
    const vatBuckets = computeItemsVat(items, fiscal.tvsh_percent || 18, saleMeta);
    const vatAmount = vatBuckets.reduce((s, b) => s + b.vat, 0);
    const rates = [...new Set(vatBuckets.filter(b => b.gross > 0).map(b => b.rate))];
    const vatRateLabel = rates.length <= 1
      ? `${rates[0] ?? 18}%`
      : "Mikse";
    const row = {
      id: e.id,
      date: e.date,
      time: e.time,
      receipt_number: e.receipt_number || "",
      items: itemsSummary,
      total: Number(e.total) || 0,
      vat_rate: vatRateLabel,
      vat_amount: Number(vatAmount.toFixed(2)),
      vat_buckets: vatBuckets.map((b) => ({
        letter: b.letter || (Number(b.rate) <= 0 ? "A" : Number(b.rate) <= 8 ? "D" : "E"),
        rate: Number(b.rate) || 0,
        gross: Number(Number(b.gross).toFixed(2)),
        net: Number(Number(b.net).toFixed(2)),
        vat: Number(Number(b.vat).toFixed(2)),
      })),
      payment_method: e.payment_method || "",
      buyer_name: "",
      buyer_fiscal: "",
      buyer_vat: "",
      source: "restaurant",
    };
    return overlaySefFiscalOnLedgerRow(row, e, sefMaps);
  });

  /* Hotel: netët (check-out) + shërbime + Room Service QR — së bashku me restorantin. */
  try {
    const checkouts = sqlite.prepare(`
      SELECT
        g.id, g.guest_name, g.check_out_date, g.total_paid,
        g.check_in_date, g.status,
        r.room_number, r.price_per_night
      FROM guests g
      LEFT JOIN rooms r ON r.id = g.room_id
      WHERE g.status = 'checked_out'
        AND date(g.check_out_date) >= date(?)
        AND date(g.check_out_date) <= date(?)
      ORDER BY g.check_out_date ASC, g.id ASC
    `).all(fromDate, toDate);

    for (const g of checkouts) {
      const paid = computeGuestPaidTotal(g);
      const roomAmt = Number(paid.room_total) || 0;
      if (roomAmt > 0) {
        const nightVat = ledgerVatFromGross(roomAmt, "18");
        rows.push({
          id: `hotel-night-${g.id}`,
          date: g.check_out_date,
          time: "12:00:00",
          receipt_number: `DH-${g.id}`,
          items: `Netë dhoma ${g.room_number || "—"} — ${g.guest_name || ""} (${paid.nights || 0} netë)`,
          total: roomAmt,
          vat_rate: nightVat.vat_rate,
          vat_amount: nightVat.vat_amount,
          vat_buckets: nightVat.vat_buckets,
          payment_method: "hotel",
          buyer_name: g.guest_name || "",
          buyer_fiscal: "",
          buyer_vat: "",
          source: "rooms",
        });
      }
    }

    const hotelCharges = sqlite.prepare(`
      SELECT rc.*, r.room_number, g.guest_name
      FROM room_charges rc
      LEFT JOIN rooms r ON r.id = rc.room_id
      LEFT JOIN guests g ON g.id = rc.guest_id
      WHERE date(rc.created_at) >= date(?) AND date(rc.created_at) <= date(?)
      ORDER BY rc.created_at ASC, rc.id ASC
    `).all(fromDate, toDate);

    for (const c of hotelCharges) {
      const amt = Number(c.amount) || 0;
      if (amt <= 0) continue;
      const food = isFoodDrinkRoomCharge(c.description);
      const rs = isRoomServiceFoodCharge(c.description);
      /* Ushqim nga tavolina (T#) është tashmë te daily_log — mos e dyfisho.
         Room Service (RS) dhe shërbimet (spa, etj.) po. */
      if (food && !rs) continue;
      const created = String(c.created_at || "");
      const datePart = created.slice(0, 10) || fromDate;
      const timePart = created.includes(" ") ? created.split(" ")[1] : "12:00:00";
      const vat = ledgerVatFromGross(amt, resolveRoomChargeVatCategory(c));
      rows.push({
        id: `hotel-charge-${c.id}`,
        date: datePart,
        time: timePart,
        receipt_number: rs ? `RS-${c.id}` : `SH-${c.id}`,
        items: `${c.description || "Shërbim"} · Dh. ${c.room_number || "—"} · ${c.guest_name || ""}`,
        total: amt,
        vat_rate: vat.vat_rate,
        vat_amount: vat.vat_amount,
        vat_buckets: vat.vat_buckets,
        payment_method: rs ? "room_service" : "hotel_service",
        buyer_name: c.guest_name || "",
        buyer_fiscal: "",
        buyer_vat: "",
        source: rs ? "room_service" : "services",
      });
    }
  } catch (err) {
    console.warn("[kontabilisti] hotel ledger merge:", err.message);
  }

  rows.sort((a, b) => {
    const da = `${a.date || ""} ${a.time || ""}`;
    const db_ = `${b.date || ""} ${b.time || ""}`;
    return da.localeCompare(db_) || String(a.id).localeCompare(String(b.id));
  });
  return rows;
}

function getVatReport({ month } = {}) {
  const m = /^\d{4}-\d{2}$/.test(String(month)) ? String(month) : new Date().toISOString().slice(0, 7);
  const fromDate = `${m}-01`;
  const toDate = `${m}-31`;
  const byRate = new Map([
    ["0", { rate: "0", gross: 0, net: 0, vat: 0 }],
    ["8", { rate: "8", gross: 0, net: 0, vat: 0 }],
    ["18", { rate: "18", gross: 0, net: 0, vat: 0 }],
  ]);
  /* Restorant + hotel (netë, shërbime, Room Service) — njësoj si libri i shitjes */
  for (const row of getSalesLedger({ from: fromDate, to: toDate })) {
    const buckets = Array.isArray(row.vat_buckets) ? row.vat_buckets : [];
    if (!buckets.length && Number(row.total) > 0) {
      const fallback = ledgerVatFromGross(row.total, "18");
      for (const b of fallback.vat_buckets) {
        const key = String(b.rate);
        if (!byRate.has(key)) byRate.set(key, { rate: key, gross: 0, net: 0, vat: 0 });
        const bucket = byRate.get(key);
        bucket.gross += Number(b.gross) || 0;
        bucket.net += Number(b.net) || 0;
        bucket.vat += Number(b.vat) || 0;
      }
      continue;
    }
    for (const b of buckets) {
      const key = String(b.rate);
      if (!byRate.has(key)) byRate.set(key, { rate: key, gross: 0, net: 0, vat: 0 });
      const bucket = byRate.get(key);
      bucket.gross += Number(b.gross) || 0;
      bucket.net += Number(b.net) || 0;
      bucket.vat += Number(b.vat) || 0;
    }
  }
  const rows = [...byRate.values()].map(r => ({
    rate: r.rate,
    gross: Number(r.gross.toFixed(2)),
    net: Number(r.net.toFixed(2)),
    vat: Number(r.vat.toFixed(2)),
  }));
  const totals = rows.reduce((t, r) => ({
    gross: t.gross + r.gross,
    net: t.net + r.net,
    vat: t.vat + r.vat,
  }), { gross: 0, net: 0, vat: 0 });
  return { month: m, rows, totals };
}

function csvEsc(val) {
  const s = val == null ? "" : String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportSalesLedgerCsv({ from, to } = {}) {
  const rows = getSalesLedger({ from, to });
  const lines = ["Data,Nr. faturës,Artikujt,Shuma,Norma TVSH,TVSh,Mënyra e pagesës"];
  for (const r of rows) {
    lines.push([
      r.date, r.receipt_number, r.items, r.total.toFixed(2), r.vat_rate, r.vat_amount.toFixed(2), r.payment_method,
    ].map(csvEsc).join(","));
  }
  return lines.join("\n");
}

function exportExpensesCsv({ from, to } = {}) {
  const rows = listExpenses({ from, to });
  const lines = ["Data,Emri i firmës,Përshkrimi,Kategoria,Shuma,Regjistroi"];
  for (const r of rows) {
    lines.push([
      r.expense_date, r.vendor_name, r.description, r.category, Number(r.amount).toFixed(2), r.entered_by,
    ].map(csvEsc).join(","));
  }
  return lines.join("\n");
}

function exportVatReportCsv({ month } = {}) {
  const report = getVatReport({ month });
  const lines = ["Norma,Shitjet neto,TVSh e mbledhur,Shitjet bruto"];
  for (const r of report.rows) {
    lines.push([`${r.rate}%`, r.net.toFixed(2), r.vat.toFixed(2), r.gross.toFixed(2)].map(csvEsc).join(","));
  }
  lines.push(["TOTALI", report.totals.net.toFixed(2), report.totals.vat.toFixed(2), report.totals.gross.toFixed(2)].map(csvEsc).join(","));
  return lines.join("\n");
}

/**
 * Lista e blerjeve (stok) për Kontabilistin — një rresht për artikull.
 * Funksion i ri; nuk ndryshon listPurchases / getPurchaseInvoice.
 */
function listPurchasesLedger({ from, to } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = from || "1970-01-01";
  const toDate = to || today;
  return sqlite.prepare(`
    SELECT
      i.id AS invoice_id,
      i.invoice_date AS date,
      i.supplier,
      i.invoice_number,
      i.total AS invoice_total,
      i.status AS status,
      COALESCE(it.product_name, '—') AS product_name,
      COALESCE(it.quantity, 0) AS quantity,
      COALESCE(it.unit_price, 0) AS unit_price,
      COALESCE(it.line_total, i.total) AS line_total
    FROM purchase_invoices i
    LEFT JOIN purchase_invoice_items it ON it.invoice_id = i.id
    WHERE date(i.invoice_date) >= date(?) AND date(i.invoice_date) <= date(?)
    ORDER BY i.invoice_date DESC, i.id DESC, it.id ASC
  `).all(fromDate, toDate).map((r) => ({
    invoice_id: r.invoice_id,
    date: r.date,
    supplier: r.supplier,
    invoice_number: r.invoice_number || "",
    invoice_total: Number(r.invoice_total) || 0,
    status: r.status || "completed",
    product_name: r.product_name,
    quantity: Number(r.quantity) || 0,
    unit_price: Number(r.unit_price) || 0,
    line_total: Number(r.line_total) || 0,
  }));
}

function exportPurchasesLedgerCsv({ from, to } = {}) {
  const rows = listPurchasesLedger({ from, to });
  const lines = ["Data,Furnitori,Nr. faturës,Artikulli,Sasia,Çmimi,Totali rreshti,Totali fature"];
  for (const r of rows) {
    lines.push([
      r.date,
      r.supplier,
      r.invoice_number,
      r.product_name,
      r.quantity,
      r.unit_price.toFixed(2),
      r.line_total.toFixed(2),
      r.invoice_total.toFixed(2),
    ].map(csvEsc).join(","));
  }
  return lines.join("\n");
}

/**
 * Bilanci i kontabilistit: SHITJET − BLERJET − SHPENZIMET = FITIMI.
 * Lexon të dhënat ekzistuese — nuk ndryshon getSalesLedger / listExpenses / listPurchases.
 */
function getKontabilistiBilanc({ from, to } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = from || today;
  const toDate = to || today;
  const salesRows = getSalesLedger({ from: fromDate, to: toDate });
  const purchaseInvoices = listPurchases({ from: fromDate, to: toDate });
  const expenseRows = listExpenses({ from: fromDate, to: toDate });
  const sales_total = salesRows.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const purchases_total = purchaseInvoices.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const expenses_total = expenseRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const profit = sales_total - purchases_total - expenses_total;
  return {
    from: fromDate,
    to: toDate,
    sales_total: Number(sales_total.toFixed(2)),
    purchases_total: Number(purchases_total.toFixed(2)),
    expenses_total: Number(expenses_total.toFixed(2)),
    profit: Number(profit.toFixed(2)),
    sales_count: salesRows.length,
    purchases_count: purchaseInvoices.length,
    expenses_count: expenseRows.length,
  };
}

function exportKontabilistiBilancCsv({ from, to } = {}) {
  const b = getKontabilistiBilanc({ from, to });
  const lines = [
    "Periudha,Shitjet,Blerjet,Shpenzimet,Fitimi",
    [
      `${b.from} — ${b.to}`,
      b.sales_total.toFixed(2),
      b.purchases_total.toFixed(2),
      b.expenses_total.toFixed(2),
      b.profit.toFixed(2),
    ].map(csvEsc).join(","),
    "",
    "Formula,SHITJET - BLERJET - SHPENZIMET = FITIMI",
  ];
  return lines.join("\n");
}

/* ─── ATK Kontabilisti (libra zyrtare) ─── */
const atk = require("./kontabilisti-atk");

function listPurchaseInvoicesForAtk({ from, to } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = from || today;
  const toDate = to || today;
  const invoices = sqlite.prepare(`
    SELECT id, supplier, invoice_number, invoice_date, total, status,
           COALESCE(supplier_nui, '') AS supplier_nui,
           COALESCE(supplier_vat, '') AS supplier_vat,
           COALESCE(vat_rate, 18) AS vat_rate,
           COALESCE(purchase_kind, 'goods') AS purchase_kind
    FROM purchase_invoices
    WHERE date(invoice_date) >= date(?) AND date(invoice_date) <= date(?)
    ORDER BY invoice_date ASC, id ASC
  `).all(fromDate, toDate);
  if (!invoices.length) return [];

  const ids = invoices.map((i) => i.id);
  const placeholders = ids.map(() => "?").join(",");
  const itemRows = sqlite.prepare(`
    SELECT invoice_id, line_total, COALESCE(vat_rate, 18) AS vat_rate
    FROM purchase_invoice_items
    WHERE invoice_id IN (${placeholders})
    ORDER BY id ASC
  `).all(...ids);
  const itemsByInvoice = new Map();
  for (const it of itemRows) {
    if (!itemsByInvoice.has(it.invoice_id)) itemsByInvoice.set(it.invoice_id, []);
    itemsByInvoice.get(it.invoice_id).push({
      line_total: Number(it.line_total) || 0,
      vat_rate: normalizePurchaseVatRate(it.vat_rate),
    });
  }

  return invoices.map((r) => {
    const hdr = Number(r.vat_rate);
    return {
      id: r.id,
      supplier: r.supplier,
      invoice_number: r.invoice_number || "",
      invoice_date: r.invoice_date,
      date: r.invoice_date,
      total: Number(r.total) || 0,
      status: r.status || "completed",
      supplier_nui: r.supplier_nui || "",
      supplier_vat: r.supplier_vat || "",
      vat_rate: hdr === -1 ? -1 : hdr >= 0 ? hdr : 18,
      purchase_kind: r.purchase_kind || "goods",
      items: itemsByInvoice.get(r.id) || [],
    };
  });
}

function getAtkSalesVatBook({ from, to } = {}) {
  const sales = getSalesLedger({ from, to });
  const rows = atk.buildSalesVatBook(sales);
  return { from, to, rows, totals: atk.sumSalesVatBoxes(rows) };
}

function getAtkPurchaseVatBook({ from, to } = {}) {
  const invoices = listPurchaseInvoicesForAtk({ from, to });
  const expenses = listExpenses({ from, to });
  const rows = atk.buildPurchaseVatBook(invoices, expenses);
  return { from, to, rows, totals: atk.sumPurchaseVatBoxes(rows) };
}

function getAtkSalesQuarterly({ from, to } = {}) {
  const sales = getSalesLedger({ from, to });
  return { from, to, rows: atk.buildSalesQuarterlyBook(sales) };
}

function getAtkPurchaseQuarterly({ from, to } = {}) {
  const invoices = listPurchaseInvoicesForAtk({ from, to });
  const expenses = listExpenses({ from, to });
  return { from, to, rows: atk.buildPurchaseQuarterlyBook(invoices, expenses) };
}

function getAtkVatDeclaration({ from, to, month } = {}) {
  let fromDate = from;
  let toDate = to;
  if (month && /^\d{4}-\d{2}$/.test(String(month))) {
    fromDate = `${month}-01`;
    const [y, m] = String(month).split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    toDate = `${month}-${String(last).padStart(2, "0")}`;
  }
  const salesBook = getAtkSalesVatBook({ from: fromDate, to: toDate });
  const purchaseBook = getAtkPurchaseVatBook({ from: fromDate, to: toDate });
  const decl = atk.buildVatDeclaration(salesBook.totals, purchaseBook.totals);
  return {
    from: fromDate,
    to: toDate,
    month: month || null,
    ...decl,
    sales_totals: salesBook.totals,
    purchase_totals: purchaseBook.totals,
  };
}

function listAtkPayroll({ year_month } = {}) {
  const ym = String(year_month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return [];
  return sqlite.prepare(`
    SELECT * FROM atk_payroll WHERE year_month = ? ORDER BY last_name ASC, first_name ASC, id ASC
  `).all(ym);
}

function upsertAtkPayroll(row) {
  const computed = atk.computePayrollRow(row || {});
  const ym = String(computed.year_month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error("Muaji i pagave mungon (YYYY-MM)");
  if (!(Number(computed.gross_salary) > 0)) throw new Error("Bruto paga duhet > 0");
  if (computed.id) {
    sqlite.prepare(`
      UPDATE atk_payroll SET
        year_month=?, first_name=?, last_name=?, individual_number=?,
        gross_salary=?, employee_pension=?, employer_pension=?,
        employee_supplement=?, employer_supplement=?,
        primary_job=?, include_contributions=?, apply_wage_tax=?
      WHERE id=?
    `).run(
      ym, computed.first_name || "", computed.last_name || "", computed.individual_number || "",
      computed.gross_salary, computed.employee_pension, computed.employer_pension,
      computed.employee_supplement, computed.employer_supplement,
      computed.primary_job ? 1 : 0, computed.include_contributions ? 1 : 0, computed.apply_wage_tax ? 1 : 0,
      Number(computed.id),
    );
    return Number(computed.id);
  }
  const r = sqlite.prepare(`
    INSERT INTO atk_payroll (
      year_month, first_name, last_name, individual_number,
      gross_salary, employee_pension, employer_pension,
      employee_supplement, employer_supplement,
      primary_job, include_contributions, apply_wage_tax
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    ym, computed.first_name || "", computed.last_name || "", computed.individual_number || "",
    computed.gross_salary, computed.employee_pension, computed.employer_pension,
    computed.employee_supplement, computed.employer_supplement,
    computed.primary_job ? 1 : 0, computed.include_contributions ? 1 : 0, computed.apply_wage_tax ? 1 : 0,
  );
  return Number(r.lastInsertRowid);
}

function deleteAtkPayroll(id) {
  sqlite.prepare("DELETE FROM atk_payroll WHERE id = ?").run(Number(id));
}

function getAtkPayrollBundle({ year_month } = {}) {
  const rows = listAtkPayroll({ year_month });
  return {
    year_month,
    rows,
    withholding: atk.buildWithholdingTaxFromPayroll(rows),
  };
}

function listAtkRent({ year_month } = {}) {
  const ym = String(year_month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return [];
  return sqlite.prepare(`
    SELECT * FROM atk_rent WHERE year_month = ? ORDER BY party_name ASC, id ASC
  `).all(ym).map((r) => atk.computeRentRow(r));
}

function upsertAtkRent(row) {
  const computed = atk.computeRentRow(row || {});
  const ym = String(computed.year_month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error("Muaji i qerasë mungon (YYYY-MM)");
  if (!String(computed.party_name || "").trim()) throw new Error("Emri i pronarit / firmës mungon");
  if (computed.id) {
    sqlite.prepare(`
      UPDATE atk_rent SET
        year_month=?, nui=?, party_name=?, interest=?, royalties=?, lottery=?,
        rent_gross=?, non_resident_entertainment=?, non_resident_services=?,
        special_payments=?, area_m2=?, monthly_rent=?, country=?
      WHERE id=?
    `).run(
      ym, computed.nui || "", computed.party_name || "",
      computed.interest, computed.royalties, computed.lottery,
      computed.rent_gross, computed.non_resident_entertainment, computed.non_resident_services,
      computed.special_payments, computed.area_m2, computed.monthly_rent, computed.country || "Kosovë",
      Number(computed.id),
    );
    return Number(computed.id);
  }
  const r = sqlite.prepare(`
    INSERT INTO atk_rent (
      year_month, nui, party_name, interest, royalties, lottery,
      rent_gross, non_resident_entertainment, non_resident_services,
      special_payments, area_m2, monthly_rent, country
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    ym, computed.nui || "", computed.party_name || "",
    computed.interest, computed.royalties, computed.lottery,
    computed.rent_gross, computed.non_resident_entertainment, computed.non_resident_services,
    computed.special_payments, computed.area_m2, computed.monthly_rent, computed.country || "Kosovë",
  );
  return Number(r.lastInsertRowid);
}

function deleteAtkRent(id) {
  sqlite.prepare("DELETE FROM atk_rent WHERE id = ?").run(Number(id));
}

function getAtkRentBundle({ year_month } = {}) {
  const rows = listAtkRent({ year_month });
  return {
    year_month,
    rows,
    form: atk.buildRentWithholdingForm(rows),
  };
}

function getAtkQuarterlyForm({ from, to, prior_year_tax } = {}) {
  const bilanc = getKontabilistiBilanc({ from, to });
  return {
    from: bilanc.from,
    to: bilanc.to,
    ...atk.buildQuarterlyInstallment({
      income: bilanc.sales_total,
      expenses: bilanc.purchases_total + bilanc.expenses_total,
      priorYearTax: Number(prior_year_tax) || 0,
    }),
  };
}

function getMenuStockValue() {
  try {
    const row = sqlite.prepare(`
      SELECT COALESCE(SUM(COALESCE(stock_qty,0) * COALESCE(price,0)), 0) AS v
      FROM menu_items WHERE active = 1
    `).get();
    return Number(row?.v) || 0;
  } catch {
    return 0;
  }
}

/** Stoku i fillimit të vitit = stoku i mbyllur i vitit të kaluar (cilësim). */
function getAtkOpeningStock(year) {
  const y = Number(year) || new Date().getFullYear();
  return {
    year: y,
    prior_year: y - 1,
    stock_start: Number(getSetting(`atk_stock_end_${y - 1}`, "0")) || 0,
    stock_end_current: getMenuStockValue(),
  };
}

function setAtkOpeningStock(year, amount) {
  const y = Number(year) || new Date().getFullYear();
  const v = Number(amount);
  if (!Number.isFinite(v) || v < 0) throw new Error("Vlera e stokut duhet ≥ 0");
  setSetting(`atk_stock_end_${y - 1}`, String(Number(v.toFixed(2))));
  return getAtkOpeningStock(y);
}

function getAtkAnnualStatements({ year } = {}) {
  const y = Number(year) || new Date().getFullYear();
  const from = `${y}-01-01`;
  const to = `${y}-12-31`;
  const bilanc = getKontabilistiBilanc({ from, to });
  const payroll = sqlite.prepare(`
    SELECT COALESCE(SUM(gross_salary),0) AS w FROM atk_payroll
    WHERE year_month >= ? AND year_month <= ?
  `).get(`${y}-01`, `${y}-12`);
  const fiscal = getFiscalSettings();
  const stockEnd = getMenuStockValue();
  // Stoku i fillimit = stoku i fundit i vitit të kaluar (ruajtur), ose 0
  const stockStart = Number(getSetting(`atk_stock_end_${y - 1}`, "0")) || 0;
  try {
    setSetting(`atk_stock_end_${y}`, String(Number(stockEnd.toFixed(2))));
  } catch {
    /* */
  }
  const prevFrom = `${y - 1}-01-01`;
  const prevTo = `${y - 1}-12-31`;
  const prevBilanc = getKontabilistiBilanc({ from: prevFrom, to: prevTo });
  const prevPayroll = sqlite.prepare(`
    SELECT COALESCE(SUM(gross_salary),0) AS w FROM atk_payroll
    WHERE year_month >= ? AND year_month <= ?
  `).get(`${y - 1}-01`, `${y - 1}-12`);
  const prevStockEnd = Number(getSetting(`atk_stock_end_${y - 1}`, "0")) || stockStart;
  const prevStockStart = Number(getSetting(`atk_stock_end_${y - 2}`, "0")) || 0;
  const prevCogs = atk.money(prevStockStart + prevBilanc.purchases_total - prevStockEnd);
  const prevWages = Number(prevPayroll?.w) || 0;
  const prevGross = atk.money(prevBilanc.sales_total - prevCogs);
  const prevOp = atk.money(prevGross - prevBilanc.expenses_total - prevWages);
  const prevTax = atk.money(Math.max(0, prevOp) * 0.1);
  const prevNet = atk.money(prevOp - prevTax);
  const result = atk.buildAnnualStatements({
    year: y,
    bizName: fiscal.biz_name,
    nui: fiscal.biz_fiscal_number,
    address: [fiscal.biz_address, fiscal.biz_city].filter(Boolean).join(", "),
    sales: bilanc.sales_total,
    purchases: bilanc.purchases_total,
    expenses: bilanc.expenses_total,
    stockStart,
    stockEnd,
    wages: Number(payroll?.w) || 0,
    priorYear: {
      sales: prevBilanc.sales_total,
      cogs: prevCogs,
      grossProfit: prevGross,
      expenses: prevBilanc.expenses_total,
      wages: prevWages,
      operating: prevOp,
      profitBeforeTax: prevOp,
      tax: prevTax,
      netProfit: prevNet,
      stockEnd: prevStockEnd,
      cash: Number(getSetting(`atk_cash_end_${y - 1}`, "0")) || prevNet,
    },
  });
  try {
    setSetting(`atk_cash_end_${y}`, String(Number(result.totals?.cash || 0).toFixed(2)));
  } catch {
    /* */
  }
  return result;
}

function exportAtkSalesVatCsv(q) {
  return atk.exportSalesVatBookCsv(getAtkSalesVatBook(q).rows);
}
function exportAtkPurchaseVatCsv(q) {
  return atk.exportPurchaseVatBookCsv(getAtkPurchaseVatBook(q).rows);
}
function exportAtkSalesQuarterlyCsv(q) {
  return atk.exportSalesQuarterlyCsv(getAtkSalesQuarterly(q).rows);
}
function exportAtkPurchaseQuarterlyCsv(q) {
  return atk.exportPurchaseQuarterlyCsv(getAtkPurchaseQuarterly(q).rows);
}

function getFiscalSettings() {
  return {
    biz_name:             getSetting("biz_name", ""),
    biz_fiscal_number:    getSetting("biz_fiscal_number", ""),
    biz_vat_number:       getSetting("biz_vat_number", ""),
    biz_address:          getSetting("biz_address", ""),
    biz_city:             getSetting("biz_city", ""),
    biz_phone:            getSetting("biz_phone", ""),
    biz_cashier_operator: getSetting("biz_cashier_operator", ""),
    biz_register_number:  getSetting("biz_register_number", "Arka-01"),
    biz_footer:           getSetting("biz_footer", "Ju faleminderit për vizitën!"),
    tvsh_enabled:         getSetting("tvsh_enabled", "0") === "1",
    tvsh_percent:         Number(getSetting("tvsh_percent", "18")),
  };
}

function updateFiscalSettings(data) {
  const map = {
    biz_name:             "biz_name",
    biz_fiscal_number:    "biz_fiscal_number",
    biz_vat_number:       "biz_vat_number",
    biz_address:          "biz_address",
    biz_city:             "biz_city",
    biz_phone:            "biz_phone",
    biz_cashier_operator: "biz_cashier_operator",
    biz_register_number:  "biz_register_number",
    biz_footer:           "biz_footer",
    tvsh_enabled:         "tvsh_enabled",
    tvsh_percent:         "tvsh_percent",
  };
  for (const [key, settingKey] of Object.entries(map)) {
    if (data[key] === undefined) continue;
    if (key === "tvsh_enabled") {
      setSetting(settingKey, data[key] ? "1" : "0");
    } else {
      setSetting(settingKey, String(data[key]).trim());
    }
  }
}

function calcFiscalTotals(orderTotal, tvshEnabled, tvshPercent) {
  const total = Number(orderTotal) || 0;
  if (!tvshEnabled) {
    return { subtotal: total, vat: 0, total };
  }
  // orderTotal is the tax-inclusive amount already charged/recorded in orders.total
  // and daily_log.total — back the VAT out of it instead of adding it on top, or the
  // printed "TOTALI" would no longer match what was actually collected and reconciled.
  const rate = Number(tvshPercent) / 100;
  const subtotal = total / (1 + rate);
  const vat = total - subtotal;
  return { subtotal, vat, total };
}

function getNextReceiptNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const prefix = `${y}${m}${d}`;
  const last = sqlite.prepare(`
    SELECT receipt_number FROM receipts
    WHERE receipt_number LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(`${prefix}-%`);
  let seq = 1;
  if (last) {
    const part = last.receipt_number.split("-")[1];
    seq = parseInt(part, 10) + 1;
  }
  return `${prefix}-${String(seq).padStart(6, "0")}`;
}

function createReceipt(orderId) {
  const order = sqlite.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!order) throw new Error("Porosia nuk u gjet");
  // Idempotency: nëse receipt ekziston tashmë, ktheje atë (mos krijo të dyfishtë)
  const existing = sqlite.prepare(
    "SELECT * FROM receipts WHERE order_id = ? ORDER BY id DESC LIMIT 1"
  ).get(orderId);
  if (existing) {
    return { ...existing, order };
  }
  const receipt_number = getNextReceiptNumber();
  const r = sqlite.prepare(`
    INSERT INTO receipts (order_id, receipt_number, printed_at)
    VALUES (?, ?, datetime('now','localtime'))
  `).run(orderId, receipt_number);
  return {
    id:              r.lastInsertRowid,
    order_id:        orderId,
    receipt_number,
    printed_at:      new Date().toISOString(),
    order,
  };
}

function addDailyLogEntry({
  table_number,
  waiter_name,
  items_json,
  total,
  receipt_number,
  payment_method = "cash",
  status = "completed",
  staff_id = null,
  shift_id = null,
  subtotal = null,
  discount_total = 0,
  promotion_id = null,
  promotion_name = "",
  cloud_sale_id = null,
  date = null,
  time = null,
}) {
  const ts = date && time
    ? { d: date, t: time }
    : sqlite.prepare(`
    SELECT date('now','localtime') AS d, time('now','localtime') AS t
  `).get();
  const method = normalizePaymentMethod(payment_method);
  const logStatus = status === "cancelled" ? "cancelled" : "completed";
  const gross = subtotal != null ? Number(subtotal) : Number(total);
  const disc = Number(discount_total) || 0;
  console.log(
    "DAILY_LOG INSERT",
    table_number,
    total,
    cloud_sale_id ? String(cloud_sale_id).trim() : null,
    new Error().stack,
  );
  sqlite.prepare(`
    INSERT INTO daily_log (
      date, time, table_number, waiter_name, items_json, total, receipt_number, status,
      payment_method, staff_id, shift_id, subtotal, discount_total, promotion_id, promotion_name,
      cloud_sale_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ts.d,
    ts.t,
    table_number,
    waiter_name,
    items_json,
    total,
    receipt_number || null,
    logStatus,
    method,
    staff_id != null ? Number(staff_id) : null,
    shift_id != null ? Number(shift_id) : null,
    gross,
    disc,
    promotion_id != null ? Number(promotion_id) : null,
    String(promotion_name || ""),
    cloud_sale_id ? String(cloud_sale_id).trim() : null,
  );
}

const CLOUD_WAITER_CLOSED_SINCE_KEY = "cloud_waiter_closed_last_closed_at";

function closedAtLocalParts(iso) {
  const raw = String(iso || "").trim();
  if (!raw) {
    const ts = sqlite.prepare("SELECT date('now','localtime') AS d, time('now','localtime') AS t").get();
    return { date: ts.d, time: ts.t };
  }
  // Konverto ISO (zakonisht UTC) në orë lokale — slice i stringut UTC thyehte dedup (+2h).
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) {
    const dt = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return {
      date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
      time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`,
    };
  }
  const date = raw.slice(0, 10);
  const time = raw.length >= 19 ? raw.slice(11, 19) : "12:00:00";
  return { date, time };
}

function isCloudWaiterSaleImported(cloudSaleId) {
  const id = String(cloudSaleId || "").trim();
  if (!id) return false;
  const row = sqlite.prepare("SELECT id FROM daily_log WHERE cloud_sale_id = ? LIMIT 1").get(id);
  return !!row;
}

function timeToDailyLogSeconds(timeStr) {
  const m = String(timeStr || "").trim().match(/^(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * 1 porosi = 1 pagesë — cloud UUID, ose e njëjta tavolinë + total + datë.
 * Dritarja e vjetër 60s dështonte kur cloud closed_at ishte UTC dhe daily_log lokale (+1/+2h).
 */
function findExistingDailyLogForCloudImport({ cloudId, tableNum, total, date, time }) {
  const id = String(cloudId || "").trim();
  if (id) {
    const byCloud = sqlite.prepare(
      "SELECT id, cloud_sale_id FROM daily_log WHERE cloud_sale_id = ? AND status = 'completed' LIMIT 1",
    ).get(id);
    if (byCloud) return byCloud;
  }
  const num = Number(tableNum) || 0;
  const d = String(date || "").trim();
  if (!num || !d) return null;
  const targetSec = timeToDailyLogSeconds(time);
  const rows = sqlite.prepare(`
    SELECT id, time, cloud_sale_id FROM daily_log
    WHERE status = 'completed'
      AND table_number = ?
      AND ABS(total - ?) < 0.01
      AND date = ?
    ORDER BY id ASC
  `).all(num, Number(total) || 0, d);
  if (!rows.length) return null;

  // Prefero rreshtin lokal pa UUID (për ta lidhur), pastaj të njëjtin UUID.
  let orphan = null;
  let nearTime = null;
  for (const row of rows) {
    const existing = String(row.cloud_sale_id || "").trim();
    if (id && existing === id) return row;
    if (!existing && !orphan) orphan = row;
    if (
      !nearTime &&
      Math.abs(timeToDailyLogSeconds(row.time) - targetSec) <= 3 * 3600 + 120
    ) {
      nearTime = row;
    }
  }
  if (orphan) return orphan;
  // E njëjta T+total+datë me UUID tjetër = porosi tjetër — mos e trajto si duplikat.
  if (rows.every((r) => String(r.cloud_sale_id || "").trim())) return null;
  return nearTime || rows[0];
}

function logMetaForCloudWaiterSale(waiterName, saleClosedAt) {
  const name = String(waiterName || "").trim();
  const staff = findStaffByNameInsensitive(name);
  if (!staff) {
    console.warn("[daily_log/sync] kamarieri nuk u gjet lokalisht:", name);
    return { staff_id: null, shift_id: null };
  }
  const shift = getOpenShift(staff.id);
  if (!shift) {
    console.warn("[daily_log/sync] nuk ka nderrim aktiv për", staff.name, "(staff_id=", staff.id, ")");
    return { staff_id: staff.id, shift_id: null };
  }
  // Nëse shitja u mbyll PARA hapjes së ndërrimit, mos e lidh me ndërrimin aktual
  const shiftStart = shift.opened_at || shift.created_at || "";
  const closedAt = String(saleClosedAt || "").trim();
  const shiftStartMs = shiftStart ? new Date(shiftStart).getTime() : NaN;
  const closedAtMs = closedAt ? new Date(closedAt).getTime() : NaN;
  const isOldSale = Number.isFinite(shiftStartMs) && Number.isFinite(closedAtMs)
    ? closedAtMs < shiftStartMs
    : (closedAt && shiftStart && closedAt < shiftStart);
  if (isOldSale) {
    console.log("[daily_log/sync] shitje e vjetër (", closedAt, "<", shiftStart, ") — shift_id=NULL");
    return { staff_id: staff.id, shift_id: null };
  }
  console.log("[daily_log/sync] shift_id=", shift.id, "staff=", staff.name, "opening_cash=", shift.opening_cash);
  return { staff_id: staff.id, shift_id: shift.id };
}

function normalizeCloudSaleItems(raw) {
  const items = mapCloudItemsToLocal(Array.isArray(raw) ? raw : []);
  if (items.length) return items;
  return (Array.isArray(raw) ? raw : []).map(it => ({
    name: String(it.name || it.emri || "").trim(),
    quantity: Number(it.quantity ?? it.sasia ?? 1) || 1,
    price: Number(it.price ?? it.cmimi ?? 0) || 0,
  })).filter(it => it.name && it.quantity > 0);
}

function finalizeLocalTableAfterCloudSaleClose(cloudId, tableNum, method, total) {
  const localOrder = getOrderByCloudId(cloudId);
  if (localOrder) {
    console.log(`[STATUS-CHANGE][finalizeLocalTableAfterCloudSaleClose] cloudId=${cloudId} match-by-cloud-id order#${localOrder.id} T${tableNum} -> orders.status='completed', tables.status='free'`);
    sqlite.prepare(`
      UPDATE orders SET status = 'completed', payment_method = ?, total = ? WHERE id = ?
    `).run(method, total, localOrder.id);
    sqlite.prepare("UPDATE tables SET status = 'free' WHERE id = ?").run(localOrder.table_id);
    return;
  }
  if (tableNum <= 0) return;
  const table = getTableByNumber(tableNum);
  if (!table) return;
  const active = getActiveOrderForTable(table.id);
  // Mbyll/liro vetëm nëse porosia aktive lokale është VETË e lidhur me cloud
  // (mirror i një porosie online) — kurrë një porosi thjesht lokale (dine-in),
  // përndryshe një shitje e mbyllur në cloud për të njëjtin numër tavoline do
  // të "vidhte" dhe zhdukte porosinë lokale të një kamarieri tjetër.
  if (active && isCloudPickupOrder(active)) {
    console.log(`[STATUS-CHANGE][finalizeLocalTableAfterCloudSaleClose] cloudId=${cloudId} match-by-table-number T${tableNum} cloud-linked order#${active.id} -> orders.status='completed', tables.status='free'`);
    sqlite.prepare(`
      UPDATE orders SET status = 'completed', payment_method = ?, total = ? WHERE id = ?
    `).run(method, total, active.id);
    sqlite.prepare("UPDATE tables SET status = 'free' WHERE id = ?").run(table.id);
    return;
  }
  if (active) {
    console.log(`[STATUS-CHANGE][finalizeLocalTableAfterCloudSaleClose] cloudId=${cloudId} T${tableNum} SKIP — porosi LOKALE (jo-cloud) aktive order#${active.id} waiter=${active.waiter_name}, NUK preket`);
  }
  if (!active) {
    console.log(`[STATUS-CHANGE][finalizeLocalTableAfterCloudSaleClose] cloudId=${cloudId} T${tableNum} nuk ka porosi aktive -> vetëm tables.status='free'`);
    sqlite.prepare("UPDATE tables SET status = 'free' WHERE id = ?").run(table.id);
  }
}

/** Importon porosi WEB-WAITER të mbyllura nga cloud në daily_log (pazari i ndërrimit). */
function importClosedWebWaiterSaleFromCloud(sale, opts = {}) {
  const cloudId = String(sale?.id || "").trim();
  if (!cloudId) {
    console.warn("[daily_log/sync] SKIP: pa cloud id");
    return { ok: false, reason: "no_id" };
  }
  const waiterName = String(sale.waiter_name || "").trim();
  if (isCloudWaiterSaleImported(cloudId)) {
    console.log("[daily_log/sync] SKIP tashmë importuar:", cloudId);
    return { ok: true, skipped: true, cloud_sale_id: cloudId };
  }

  if (!waiterName) {
    console.warn("[daily_log/sync] SKIP", cloudId, ": pa waiter_name");
    return { ok: false, reason: "no_waiter", cloud_sale_id: cloudId };
  }

  const items = normalizeCloudSaleItems(sale.items || sale.items_json);
  if (!items.length) {
    console.warn("[daily_log/sync] SKIP", cloudId, ": pa artikuj (waiter=", waiterName, ")");
    return { ok: false, reason: "no_items", cloud_sale_id: cloudId };
  }

  const total = Number(sale.total) || items.reduce((s, i) => s + i.price * i.quantity, 0);
  const tableNum = Number(sale.table_number) || 0;
  const method = normalizePaymentMethod(sale.payment_method);
  const { date, time } = closedAtLocalParts(sale.closed_at);

  const dupLog = findExistingDailyLogForCloudImport({ cloudId, tableNum, total, date, time });
  if (dupLog) {
    if (cloudId && !String(dupLog.cloud_sale_id || "").trim()) {
      sqlite.prepare("UPDATE daily_log SET cloud_sale_id = ? WHERE id = ?").run(cloudId, dupLog.id);
    }
    finalizeLocalTableAfterCloudSaleClose(cloudId, tableNum, method, total);
    console.log("[daily_log/sync] SKIP duplikat daily_log T" + tableNum, total.toFixed(2), cloudId);
    return {
      ok: true,
      skipped: true,
      duplicate: true,
      cloud_sale_id: cloudId,
    };
  }

  const logMeta = logMetaForCloudWaiterSale(waiterName, sale.closed_at);
  
  // Nëse shitja osht para ndërrimit aktual, mos e fut në daily_log fare
  if (!logMeta.shift_id && logMeta.staff_id) {
    console.log("[daily_log/sync] SKIP shitje e vjetër (para ndërrimit):", cloudId, sale.closed_at);
    return { ok: true, skipped: true, reason: "before_shift", cloud_sale_id: cloudId };
  }
  
  const itemsJson = JSON.stringify(items);

  console.log(
    "[daily_log/sync] INSERT daily_log:",
    cloudId,
    "T" + tableNum,
    waiterName,
    method,
    total.toFixed(2),
    "shift_id=" + (logMeta.shift_id ?? "NULL"),
  );

  sqlite.transaction(() => {
    addDailyLogEntry({
      table_number: tableNum,
      waiter_name: waiterName,
      items_json: itemsJson,
      total,
      receipt_number: sale.receipt_number || null,
      payment_method: method,
      staff_id: logMeta.staff_id,
      shift_id: logMeta.shift_id,
      subtotal: total,
      cloud_sale_id: cloudId,
      date,
      time,
    });
    if (!opts.skipStockDecrement) {
      decrementMenuItemStock(items);
    }

    finalizeLocalTableAfterCloudSaleClose(cloudId, tableNum, method, total);
  })();

  const effectiveShiftId = logMeta.shift_id;

  const totals = effectiveShiftId
    ? computeShiftTotals(effectiveShiftId, logMeta.staff_id, waiterName)
    : computeOrphanDailyLogTotals(logMeta.staff_id, waiterName);
  console.log(
    "[daily_log/sync] pas INSERT cash_total=", totals.cash_total,
    "total_sales=", totals.total_sales,
    "shift_id=", effectiveShiftId ?? "NULL",
  );

  return {
    ok: true,
    imported: true,
    cloud_sale_id: cloudId,
    shift_id: effectiveShiftId,
    cash_total: totals.cash_total,
    total_sales: totals.total_sales,
  };
}

function countDailyLogEntries() {
  const row = sqlite.prepare("SELECT COUNT(*) AS n FROM daily_log").get();
  return Number(row?.n) || 0;
}

/** Fshin daily_log dhe ri-importon nga lista e porosive closed të cloud (1 UUID = 1 rresht). */
function rebuildDailyLogFromCloudSales(sales) {
  const rows = Array.isArray(sales) ? sales : [];
  sqlite.prepare("DELETE FROM daily_log").run();

  const seenCloudIds = new Set();
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const sale of rows) {
    const cloudId = String(sale?.id || "").trim();
    if (!cloudId) {
      failed += 1;
      continue;
    }
    if (seenCloudIds.has(cloudId)) {
      skipped += 1;
      continue;
    }
    seenCloudIds.add(cloudId);
    const result = importClosedWebWaiterSaleFromCloud(sale, { skipStockDecrement: true });
    if (result?.imported) imported += 1;
    else if (result?.skipped) skipped += 1;
    else failed += 1;
  }

  const totals = sqlite.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
    FROM daily_log WHERE status = 'completed'
  `).get();

  return {
    ok: true,
    imported,
    skipped,
    failed,
    fetched: rows.length,
    daily_log_count: Number(totals?.n) || 0,
    total_sales: Number(totals?.total) || 0,
  };
}

function getCloudWaiterClosedSyncSince() {
  return String(getSetting(CLOUD_WAITER_CLOSED_SINCE_KEY, "") || "").trim();
}

function setCloudWaiterClosedSyncSince(closedAt) {
  const val = String(closedAt || "").trim();
  if (!val) return;
  setSetting(CLOUD_WAITER_CLOSED_SINCE_KEY, val);
}

function normalizeDatetimeInput(value, fallbackTime = "00:00:00") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parts = raw.split(/\s+/);
  const date = parts[0];
  let time = parts[1] || fallbackTime;
  if (/^\d{2}:\d{2}$/.test(time)) time += ":00";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return raw;
  return `${date} ${time}`;
}

function ditariDateRange(period) {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  if (period === "java") {
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 6);
    return {
      fromDatetime: `${fromDate.toISOString().slice(0, 10)} 00:00:00`,
      toDatetime: `${to} 23:59:59`,
      dateFrom: fromDate.toISOString().slice(0, 10),
      dateTo: to,
      timeFrom: "00:00:00",
      timeTo: "23:59:59",
      label: "Kjo javë",
    };
  }
  if (period === "muaj") {
    const from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    return {
      fromDatetime: `${from} 00:00:00`,
      toDatetime: `${to} 23:59:59`,
      dateFrom: from,
      dateTo: to,
      timeFrom: "00:00:00",
      timeTo: "23:59:59",
      label: "Ky muaj",
    };
  }
  return {
    fromDatetime: `${to} 00:00:00`,
    toDatetime: `${to} 23:59:59`,
    dateFrom: to,
    dateTo: to,
    timeFrom: "00:00:00",
    timeTo: "23:59:59",
    label: "Sot",
  };
}

function resolveDitariRange(opts = {}) {
  if (opts.fromDatetime && opts.toDatetime) {
    const fromDatetime = normalizeDatetimeInput(opts.fromDatetime, "00:00:00");
    const toDatetime = normalizeDatetimeInput(opts.toDatetime, "23:59:59");
    const [dateFrom, timeFrom = "00:00:00"] = fromDatetime.split(/\s+/);
    const [dateTo, timeTo = "23:59:59"] = toDatetime.split(/\s+/);
    return {
      fromDatetime,
      toDatetime,
      dateFrom,
      dateTo,
      timeFrom,
      timeTo,
      label: `${dateFrom} ${timeFrom} — ${dateTo} ${timeTo}`,
    };
  }
  return ditariDateRange(opts.period || "sot");
}

function logActivity({ user_name, user_role, action, detail = "" }) {
  sqlite.prepare(`
    INSERT INTO activity_log (user_name, user_role, action, detail)
    VALUES (?, ?, ?, ?)
  `).run(
    String(user_name || "—"),
    String(user_role || "—"),
    String(action || "—"),
    detail ? String(detail) : null,
  );
}

function getActivityLog(fromDatetime, toDatetime) {
  return sqlite.prepare(`
    SELECT id, created_at, user_name, user_role, action, detail
    FROM activity_log
    WHERE datetime(created_at) >= datetime(?)
      AND datetime(created_at) <= datetime(?)
    ORDER BY datetime(created_at) DESC
  `).all(fromDatetime, toDatetime);
}

function getDitari(opts = {}) {
  const range = resolveDitariRange(opts);
  const entries = sqlite.prepare(`
    SELECT * FROM daily_log
    WHERE datetime(date || ' ' || time) >= datetime(?)
      AND datetime(date || ' ' || time) <= datetime(?)
    ORDER BY datetime(date || ' ' || time) DESC
  `).all(range.fromDatetime, range.toDatetime);

  const parsed = entries.map(e => ({
    ...e,
    items: JSON.parse(e.items_json || "[]"),
    artikujt: JSON.parse(e.items_json || "[]")
      .map(i => `${i.quantity}× ${i.name}`)
      .join(", "),
    payment_label: paymentMethodLabel(e.payment_method),
  }));

  const completed = parsed.filter(e => e.status !== "cancelled");
  const totalSales = completed.reduce((s, e) => s + e.total, 0);
  const totalCash = completed
    .filter(e => normalizePaymentMethod(e.payment_method) === "cash")
    .reduce((s, e) => s + e.total, 0);
  const totalKarte = completed
    .filter(e => normalizePaymentMethod(e.payment_method) === "karte")
    .reduce((s, e) => s + e.total, 0);
  const tablesServed = new Set(completed.map(e => e.table_number)).size;
  const activity = getActivityLog(range.fromDatetime, range.toDatetime);

  return {
    period: opts.period || "custom",
    periodLabel: range.label,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    timeFrom: range.timeFrom,
    timeTo: range.timeTo,
    fromDatetime: range.fromDatetime,
    toDatetime: range.toDatetime,
    today: new Date().toLocaleDateString("sq-AL"),
    totalSales,
    totalCash,
    totalKarte,
    orderCount: completed.length,
    tablesServed,
    entries: parsed,
    activity,
  };
}

/** Pasqyra e hotelit — KPI + mbërritje/largime/pastrim nga SQLite lokal. */
function getDashboardOverview() {
  try {
    ensureDefaultRooms();
  } catch {
    /* ignore */
  }

  const today = hotelTodayLocalYmd();
  const rooms = listRooms();
  const roomsTotal = rooms.length;
  const occupied = rooms.filter((r) => r.status === "occupied").length;
  const free = rooms.filter((r) => r.status === "free").length;
  const dirty = rooms.filter((r) => r.status === "dirty").length;
  const maintenance = rooms.filter((r) => r.status === "maintenance").length;
  const occupancyPct = roomsTotal
    ? Math.round((occupied / roomsTotal) * 1000) / 10
    : 0;

  const activeGuests = sqlite.prepare(`
    SELECT
      g.id,
      g.guest_name,
      g.phone,
      g.persons,
      g.check_in_date,
      g.check_out_date,
      g.room_id,
      r.room_number,
      r.floor,
      r.type AS room_type,
      r.price_per_night
    FROM guests g
    LEFT JOIN rooms r ON r.id = g.room_id
    WHERE g.status = 'active'
    ORDER BY g.check_out_date ASC, g.id ASC
  `).all();

  const activeGuestCount = activeGuests.length;
  const activePersons = activeGuests.reduce((s, g) => s + (Number(g.persons) || 0), 0);

  /* Të ardhurat e netëve për sot: mysafirë aktivë me qëndrim që mbulon natën e sotme */
  const nightsRevenue = activeGuests.reduce((sum, g) => {
    const inD = String(g.check_in_date || "");
    const outD = String(g.check_out_date || "");
    if (inD && outD && inD <= today && outD > today) {
      return sum + (Number(g.price_per_night) || 0);
    }
    return sum;
  }, 0);

  let servicesRevenue = 0;
  let roomServiceFood = 0;
  const todayCharges = sqlite.prepare(`
    SELECT description, amount FROM room_charges
    WHERE created_at >= ? AND created_at < date(?, '+1 day')
  `).all(today, today);
  for (const c of todayCharges) {
    const amt = Number(c.amount) || 0;
    if (isRoomServiceFoodCharge(c.description)) roomServiceFood += amt;
    else if (!isFoodDrinkRoomCharge(c.description)) servicesRevenue += amt;
  }

  const restaurantRevenue = (Number(sqlite.prepare(`
    SELECT COALESCE(SUM(total), 0) AS t
    FROM daily_log
    WHERE date = ? AND status = 'completed'
  `).get(today)?.t) || 0) + roomServiceFood;

  const dailyRevenueTotal =
    Math.round((nightsRevenue + servicesRevenue + restaurantRevenue) * 100) / 100;

  const dayStats = getReservationDayStats(today);
  const reservationsToday =
    Number(dayStats.arriving_count || 0) + Number(dayStats.departing_count || 0);

  const arrivals = (dayStats.arrivals || []).map((r) => ({
    id: r.id,
    guest_name: r.guest_name,
    phone: r.phone || "",
    persons: Number(r.persons) || 0,
    room_number: r.room_number || "—",
    room_type: r.room_type || "",
    floor: r.floor,
    check_in_date: r.check_in_date,
    check_out_date: r.check_out_date,
    status: r.status,
    notes: r.notes || "",
    deposit: Number(r.deposit) || 0,
  }));

  const departures = [
    ...(dayStats.guest_departures || []).map((g) => ({
      id: g.id,
      source: "guest",
      guest_name: g.guest_name,
      phone: g.phone || "",
      persons: Number(g.persons) || 0,
      room_number: g.room_number || "—",
      room_type: g.room_type || "",
      floor: g.floor,
      check_in_date: g.check_in_date,
      check_out_date: g.check_out_date,
    })),
    ...(dayStats.departures || []).map((r) => ({
      id: r.id,
      source: "reservation",
      guest_name: r.guest_name,
      phone: r.phone || "",
      persons: Number(r.persons) || 0,
      room_number: r.room_number || "—",
      room_type: r.room_type || "",
      floor: r.floor,
      check_in_date: r.check_in_date,
      check_out_date: r.check_out_date,
    })),
  ];

  let dirtyRooms = [];
  try {
    const board = listHousekeepingBoard();
    dirtyRooms = (board.rooms || [])
      .filter((r) => ["dirty", "in_progress", "maintenance"].includes(r.hk_status))
      .map((r) => {
        let urgency = "normal";
        let urgency_label = "Normale";
        if (r.hk_status === "maintenance") {
          urgency = "maintenance";
          urgency_label = "Mirëmbajtje";
        } else if (r.priority || r.arrival_today) {
          urgency = "urgent";
          urgency_label = "Urgjente";
        } else if (r.hk_status === "in_progress") {
          urgency = "progress";
          urgency_label = "Në pastrim";
        }
        return {
          room_id: r.room_id,
          room_number: r.room_number,
          floor: r.floor,
          type: r.type,
          hk_status: r.hk_status,
          priority: Number(r.priority) || 0,
          arrival_today: Boolean(r.arrival_today),
          arrival_guest: r.arrival_guest || null,
          assigned_name: r.assigned_name || null,
          notes: r.notes || "",
          urgency,
          urgency_label,
        };
      });
  } catch {
    dirtyRooms = rooms
      .filter((r) => r.status === "dirty" || r.status === "maintenance")
      .map((r) => ({
        room_id: r.id,
        room_number: r.room_number,
        floor: r.floor,
        type: r.type,
        hk_status: r.status,
        priority: 0,
        arrival_today: false,
        arrival_guest: null,
        assigned_name: null,
        notes: "",
        urgency: r.status === "maintenance" ? "maintenance" : "normal",
        urgency_label: r.status === "maintenance" ? "Mirëmbajtje" : "Normale",
      }));
  }

  return {
    today,
    rooms_total: roomsTotal,
    occupied,
    free,
    dirty,
    maintenance,
    active_guests: activeGuestCount,
    active_persons: activePersons,
    reservations_today: reservationsToday,
    arrivals_count: Number(dayStats.arriving_count || 0),
    departures_count: Number(dayStats.departing_count || 0),
    occupancy_pct: occupancyPct,
    daily_revenue: {
      nights: Math.round(nightsRevenue * 100) / 100,
      services: Math.round(servicesRevenue * 100) / 100,
      restaurant: Math.round(restaurantRevenue * 100) / 100,
      total: dailyRevenueTotal,
    },
    arrivals,
    departures,
    dirty_rooms: dirtyRooms,
    /* fusha të vjetra (kompatibilitet i lehtë) */
    totalSales: dailyRevenueTotal,
    orderCount: reservationsToday,
    average: 0,
    salesByHour: [],
    dailyLast30: [],
    byCategory: [],
    topProducts: [],
    lowStockItems: [],
    lowStockCount: 0,
  };
}

function exportDitariText(opts = {}) {
  const d = getDitari(opts);
  const name = getSetting("restaurant_name", VERSION.versionLabel);
  let txt = `DITARI — ${name}\n`;
  txt += `Periudha: ${d.periodLabel}\n`;
  txt += `Nga: ${d.dateFrom} ${d.timeFrom}\n`;
  txt += `Deri: ${d.dateTo} ${d.timeTo}\n`;
  txt += `${"=".repeat(50)}\n`;
  txt += `Shitjet totale: ${d.totalSales.toFixed(2)} €\n`;
  txt += `  Cash: ${d.totalCash.toFixed(2)} €\n`;
  txt += `  Kartë: ${d.totalKarte.toFixed(2)} €\n`;
  txt += `Porosi: ${d.orderCount}\n`;
  txt += `Tavolina te sherbyera: ${d.tablesServed}\n\n`;
  for (const e of d.entries) {
    const prefix = e.status === "cancelled" ? "[ANULLUAR] " : "";
    txt += `${prefix}${e.date} ${e.time} | T${e.table_number} | ${e.waiter_name} | ${e.payment_label} | ${e.artikujt} | ${e.total.toFixed(2)} € | ${e.status === "cancelled" ? "Anulluar" : e.status}\n`;
  }
  txt += `\nTOTALI: ${d.totalSales.toFixed(2)} €\n`;
  txt += `\nGjeneruar: ${new Date().toLocaleString("sq-AL")}\n`;
  return txt;
}

function getVersionInfo() {
  let appBrand = "Revolution HOTEL";
  try {
    appBrand = require("./region-config").appName || appBrand;
  } catch {
    /* dev */
  }
  return {
    version:           VERSION.versionLabel,
    app_version:       VERSION.appVersion || "",
    app_brand:         appBrand,
    defaultTableCount: VERSION.defaultTableCount,
    packageTier:       VERSION.packageTier,
    packageLabel:      VERSION.packageLabel,
  };
}

  module.exports = {
    db,
    DB_PATH,
    whenReady,
    flushDatabase,
    isSetupDone,
    getSettings,
    getBusinessName,
    getAppWindowTitle,
    getBusinessTypeInfo,
    normalizeBusinessType,
    getVersionInfo,
    verifyAdminPassword,
    runSetup,
    getCategories,
    getCategoryNames,
    addCategory,
    toggleCategoryActive,
    deleteCategory,
    reorderCategories,
    normalizeMenuCategoriesToAlbanian,
    getMenuItems,
    getMenuItemById,
    getLowStockItems,
    getMenuItemPhoto,
    setMenuItemPhoto,
    ensureMenuStockPhotos,
    ensureMenuCatalog,
    ensureMenuVatCategories,
    enrichOrderItemsWithVat,
    vatLetterFromCategory,
    vatPercentFromCategory,
    addMenuItem,
    applySmartVatToAllMenuItems,
    updateMenuPrice,
    updateMenuItem,
    toggleMenuItemActive,
    reorderMenuItems,
    deleteMenuItemPermanent,
    getTablesWithOrders,
    getTableLayout,
    getTableCount,
    getPhysicalTableCount,
    tableLabel,
    listTableZones,
    ensureHotelFnbZones,
    createTableZone,
    updateTableZone,
    deleteTableZone,
    createTable,
    updateTable,
    deleteTable,
    listRooms,
    listRoomsWithGuests,
    ensureDefaultRooms,
    getRoomById,
    createRoom,
    updateRoom,
    deleteRoom,
    getActiveGuestForRoom,
    getGuestById,
    checkInGuest,
    getCheckoutPreview,
    checkOutGuest,
    markRoomClean,
    listHousekeepingBoard,
    listHousekeepingStaff,
    assignHousekeepingStaff,
    updateHousekeepingNotes,
    startHousekeepingCleaning,
    completeHousekeepingRoom,
    setHousekeepingMaintenance,
    readyHousekeepingFromMaintenance,
    openHousekeepingTaskForRoom,
    listRoomChargesForGuest,
    sumRoomChargesForGuest,
    addRoomCharge,
    addRoomChargesFromOrderItems,
    listHotelServices,
    listHotelServicesCatalog,
    listHotelServiceCategories,
    getHotelServiceCategoryById,
    createHotelServiceCategory,
    updateHotelServiceCategory,
    deleteHotelServiceCategory,
    getHotelServiceById,
    createHotelService,
    updateHotelService,
    deleteHotelService,
    applySmartVatToAllServices,
    setHotelServicePhoto,
    ensureHotelServiceStockPhotos,
  ensureHotelServiceCategoryPhotos,
  setHotelServiceCategoryPhoto,
    addServiceChargeToRoom,
    listGuestsHistory,
    listHotelGuestsCrm,
    getHotelGuestCrmProfile,
    getGuestFolio,
    getRoomFolioPreview,
    getGuestsReport,
    getHotelOccupancyReport,
    getHotelRevenueReport,
    getHotelGuestsHistoryReport,
    getHotelServicesReport,
    getHotelRoomsReport,
    getHotelPeriodReports,
    listRoomReservations,
    listTodaysRoomReservations,
    listActiveReservationsOnDate,
    getReservationDayStats,
    listAvailableRoomsForDates,
    getRoomReservationById,
    createRoomReservation,
    updateRoomReservation,
    cancelRoomReservation,
    getRoomAvailabilityCalendar,
    convertReservationToCheckIn,
    getTableById,
    getTableByNumber,
    getOrderByCloudId,
    getActiveOrderByCloudId,
    isCloudOrderHandledLocally,
    getLinkedCloudOrderIds,
    upsertPendingCloudOrders,
    listPendingCloudOrders,
    listPendingCloudOrderFirstSeen,
    removePendingCloudOrders,
    importCloudOrderToLocal,
    parseTableNumberFromCloudOrder,
    isCloudQrTableOrder,
    isCloudPosAcceptQueueOrder,
    isCloudOnlinePickupOrder,
    isCloudStaffWaiterOrder,
    parseQrTableNumberFromCloudOrder,
    isPhysicalVenueTable,
    isTableInOnlinePickupZone,
    findOnlinePickupTableBySlotIndex,
    enrichCloudOrderForWaiter,
    importClosedWebWaiterSaleFromCloud,
    rebuildDailyLogFromCloudSales,
    countDailyLogEntries,
    getCloudWaiterClosedSyncSince,
    setCloudWaiterClosedSyncSince,
    isCloudWaiterSaleImported,
    ensureTablesForPendingCloudOrders,
    listActiveOnlineOrders,
    listActiveOnlineOrdersForWaiter,
    listActiveQrPublicOrdersForWaiter,
    listActiveOnlineOrdersForStaffId,
    findStaffById,
    getActiveOrderForTable,
    sendOrder,
    parseOrderItems,
    recordPrintedBatch,
    syncSlipSnapshot,
    getOrderSlipDelta,
    closeTable,
    closeOrderById,
    closeTablePartial,
    subtractOrderItems,
    orderItemKey,
    normalizePaymentMethod,
    paymentMethodLabel,
    adminClearTable,
    listLocalActiveOrders,
    listActiveHotelOrdersForWaiter,
    cancelActiveOrder,
    getReports,
    getStaff,
    getStaffForAdmin,
    getStaffForLogin,
    addStaff,
    updateStaffPin,
    findStaffByPin,
    updateStaffCard,
    clearStaffCard,
    findStaffByCard,
    deleteStaff,
    findStaffByName,
    findStaffByNameInsensitive,
    ensureOpenShift,
    getOpenShift,
    openWaiterShiftWithCash,
    getWaiterShiftSummary,
    closeWaiterShift,
    acceptShiftHandover,
    getPendingHandoverForStaff,
    listHandoverPeers,
    listShiftReports,
    getShiftSalesDetail,
    buildDailySummaryData,
    buildXReportData,
    listRecentClosedShifts,
    buildZReportData,
    listOpenShiftsForReports,
    getOpenShiftReportData,
    updateShiftClosingReason,
    normalizeCashAmount,
    shiftMetaForWaiter,
    getActiveStaffToday,
    applyRestaurantNameIfEmpty,
    updateSettings,
    getCloudSettings,
    updateCloudSettings,
    updateKitchenAccess,
    getFiscalSettings,
    updateFiscalSettings,
    calcFiscalTotals,
    createReceipt,
    getDitari,
    getDashboardOverview,
    exportDitariText,
    logActivity,
    getActivityLog,
    resolveDitariRange,
    exportReportText,
    exportMenuText,
    getPurchaseStats30Days,
    listPurchases,
    getPurchaseInvoice,
    getLatestPurchaseInvoiceDate,
    createPurchaseInvoice,
    createPurchaseAdjustment,
    deletePurchaseInvoice,
    increaseMenuItemStock,
    decrementMenuItemStock,
    addExpense,
    listExpenses,
    deleteExpense,
    getSalesLedger,
    getVatReport,
    exportSalesLedgerCsv,
    exportExpensesCsv,
    exportVatReportCsv,
    listPurchasesLedger,
    exportPurchasesLedgerCsv,
    getKontabilistiBilanc,
    exportKontabilistiBilancCsv,
    getAtkSalesVatBook,
    getAtkPurchaseVatBook,
    getAtkSalesQuarterly,
    getAtkPurchaseQuarterly,
    getAtkVatDeclaration,
    listAtkPayroll,
    upsertAtkPayroll,
    deleteAtkPayroll,
    getAtkPayrollBundle,
    listAtkRent,
    upsertAtkRent,
    deleteAtkRent,
    getAtkRentBundle,
    getAtkQuarterlyForm,
    getAtkAnnualStatements,
    getAtkOpeningStock,
    setAtkOpeningStock,
    exportAtkSalesVatCsv,
    exportAtkPurchaseVatCsv,
    exportAtkSalesQuarterlyCsv,
    exportAtkPurchaseQuarterlyCsv,
    listPurchaseInvoicesForAtk,
    getSetting,
    setSetting,
    upsertReservationLocal,
    insertLocalReservation,
    getLocalReservation,
    listLocalReservations,
    listPendingReservationSync,
    updateLocalReservationSync,
    markReservationConflict,
    getTodayReservationsForTables,
    listPromotions,
    getPromotion,
    createPromotion,
    updatePromotion,
    deletePromotion,
  };
