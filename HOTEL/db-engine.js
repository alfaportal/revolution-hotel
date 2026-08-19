"use strict";
/**
 * sql.js in-process për Electron — pa Worker / pa Atomics.wait.
 * hotel.db ruhet i enkriptuar (AES-256-GCM + DPAPI) — shih db-crypto.js.
 */
const fs = require("fs");
const path = require("path");
const dbCrypto = require("./db-crypto");

function loadDbFileBytes(dbPath) {
  if (process.env.HOTEL_DB_PLAIN === "1") {
    const raw = fs.readFileSync(dbPath);
    if (dbCrypto.isPlainSqlite(raw)) return raw;
    throw new Error("HOTEL_DB_PLAIN=1 kërkon SQLite të hapur (plain).");
  }
  const loaded = dbCrypto.loadDatabaseBytes(dbPath);
  if (!loaded.bytes) return null;
  if (loaded.wasPlain || loaded.wasLegacy) {
    console.log(
      "[db-engine] Migrim DB → HTLENC1 (DPAPI)" +
        (loaded.wasLegacy ? " — nga RHDB1 legacy" : " — nga plain SQLite")
    );
  }
  return loaded.bytes;
}

let VERSION = { defaultCategories: ["Pije", "Ushqim", "Të tjera"] };
try {
  VERSION = require("./version-config");
} catch (_) {}

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

/** Katalog default shërbimesh hoteli — shton vetëm emrat që mungojnë (nuk mbishkruan çmimet). */
function ensureHotelServiceCatalogSeed(sqlGet, sqlRun, sqlAll) {
  let stockPhotoForCategoryName = () => "";
  try {
    stockPhotoForCategoryName = require("./service-stock-photos").stockPhotoForCategoryName;
  } catch (_) { /* */ }

  /* Kategoritë shfaqen me foto reale (/service-stock/cat-*.jpg), pa emoji. */
  const categories = [
    { name: "Rekreacion", sort: 10 },
    { name: "Wellness & Spa", sort: 20 },
    { name: "Dhomë", sort: 30 },
    { name: "Pastrim & Veshje", sort: 40 },
    { name: "Transport", sort: 50 },
    { name: "Sallat e Konferencave", sort: 55 },
    { name: "Të tjera", sort: 60 },
  ];
  for (const c of categories) {
    const photo = stockPhotoForCategoryName(c.name) || "";
    const row = sqlGet(
      "SELECT id, photo FROM service_categories WHERE lower(name) = lower(?)",
      [c.name],
    );
    if (!row) {
      sqlRun(
        "INSERT INTO service_categories (name, icon, photo, sort_order) VALUES (?, '', ?, ?)",
        [c.name, photo, c.sort],
      );
    } else {
      /* Emoji hiqet; foto custom e pronarit nuk mbishkruhet. */
      sqlRun(
        `UPDATE service_categories SET
           icon = '',
           photo = CASE WHEN TRIM(COALESCE(photo,'')) = '' THEN ? ELSE photo END,
           sort_order = ?
         WHERE id = ?`,
        [photo, c.sort, row.id],
      );
    }
  }

  const catId = (name) => {
    const r = sqlGet("SELECT id FROM service_categories WHERE lower(name) = lower(?)", [name]);
    return r ? r.id : null;
  };

  /* Emra të vjetër → emri i ri i katalogut */
  const renames = [
    ["Laundry", "Larje robash / Laundry"],
    ["Spa", "Facial"],
  ];
  for (const [from, to] of renames) {
    const old = sqlGet("SELECT id FROM services WHERE lower(name) = lower(?)", [from]);
    const neu = sqlGet("SELECT id FROM services WHERE lower(name) = lower(?)", [to]);
    if (old && !neu) {
      sqlRun("UPDATE services SET name = ? WHERE id = ?", [to, old.id]);
    }
  }

  let stockPhotoForServiceName = () => "";
  try {
    stockPhotoForServiceName = require("./service-stock-photos").stockPhotoForServiceName;
  } catch (_) { /* */ }

  const defaults = [
    ["Rekreacion", "Bazen", 5, "fixed", 10],
    ["Rekreacion", "Sauna", 8, "fixed", 20],
    ["Rekreacion", "Xhakuzi", 10, "fixed", 30],
    ["Rekreacion", "Palestra / Gym", 5, "fixed", 40],
    ["Wellness & Spa", "Masazh", 25, "fixed", 10],
    ["Wellness & Spa", "Facial", 20, "fixed", 20],
    ["Wellness & Spa", "Manikyr", 10, "fixed", 30],
    ["Wellness & Spa", "Pedikyr", 10, "fixed", 40],
    ["Dhomë", "Minibar", 3, "variable", 10],
    ["Dhomë", "Room Service", 0, "variable", 20],
    ["Dhomë", "Shtrat shtesë", 10, "fixed", 30],
    ["Dhomë", "Zgjatje qëndrimi", 0, "room_rate", 40],
    ["Pastrim & Veshje", "Larje robash / Laundry", 10, "fixed", 10],
    ["Pastrim & Veshje", "Hekurosje", 5, "fixed", 20],
    ["Pastrim & Veshje", "Pastrim i thatë", 15, "fixed", 30],
    ["Transport", "Parking", 5, "fixed", 10],
    ["Transport", "Transfer aeroport", 30, "fixed", 20],
    ["Transport", "Marrje me veturë", 20, "fixed", 30],
    ["Sallat e Konferencave", "Salla e Konferencave (ora)", 30, "fixed", 10],
    ["Sallat e Konferencave", "Salla e Konferencave (dita)", 180, "fixed", 20],
    ["Sallat e Konferencave", "Projektor", 15, "fixed", 30],
    ["Sallat e Konferencave", "Sistem zanor / Mikrofon", 20, "fixed", 40],
    ["Të tjera", "Wi-Fi Premium", 3, "fixed", 10],
    ["Të tjera", "Late check-out", 15, "fixed", 20],
    ["Të tjera", "Early check-in", 15, "fixed", 30],
  ];

  for (const [catName, name, price, mode, sort] of defaults) {
    const cid = catId(catName);
    const photo = stockPhotoForServiceName(name) || "";
    const existing = sqlGet("SELECT id, photo FROM services WHERE lower(name) = lower(?)", [name]);
    if (existing) {
      sqlRun(
        `UPDATE services SET
          category_id = COALESCE(category_id, ?),
          photo = CASE WHEN TRIM(COALESCE(photo,'')) = '' THEN ? ELSE photo END,
          price_mode = COALESCE(NULLIF(price_mode,''), ?),
          sort_order = CASE WHEN sort_order = 0 THEN ? ELSE sort_order END,
          active = COALESCE(active, 1)
        WHERE id = ?`,
        [cid, photo, mode, sort, existing.id],
      );
    } else {
      sqlRun(
        `INSERT INTO services (name, price, category_id, icon, photo, sort_order, price_mode, active)
         VALUES (?, ?, ?, '', ?, ?, ?, 1)`,
        [name, price, cid, photo, sort, mode],
      );
    }
  }

  /* Lidh shërbime të mbetura pa kategori */
  const otherId = catId("Të tjera");
  if (otherId) {
    sqlRun(
      "UPDATE services SET category_id = ? WHERE category_id IS NULL",
      [otherId],
    );
  }
}

async function bootDatabase(cfg) {
  const initSqlJs = require("sql.js");
  const dbPath = cfg.dbPath;
  const baseDir = cfg.baseDir || __dirname;
  let db;
  let inTx = false;

  let saveTimer = null;
  let savePaused = false;

  function saveDbNow() {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const plain = Buffer.from(db.export());
    /* Testet lokale mund të kërkojnë plain: HOTEL_DB_PLAIN=1 */
    if (process.env.HOTEL_DB_PLAIN === "1") {
      fs.writeFileSync(dbPath, plain);
      return;
    }
    dbCrypto.saveDatabaseBytes(dbPath, plain);
  }

  /** Debounce — db.export() sync ngrin Electron nëse thirret pas çdo SQL. */
  function saveDb() {
    if (savePaused) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        saveDbNow();
      } catch (e) {
        console.warn("[db-engine] save:", e.message);
      }
    }, 400);
  }

  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveDbNow();
  }

  function getLastInsertRowid() {
    const stmt = db.prepare("SELECT last_insert_rowid() AS id");
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return row.id;
  }

  function sqlGet(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      if (params.length) stmt.bind(params);
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }

  function sqlAll(sql, params = []) {
    const stmt = db.prepare(sql);
    const rows = [];
    try {
      if (params.length) stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function sqlRun(sql, params = []) {
    if (params.length) db.run(sql, params);
    else db.run(sql);
    const result = { lastInsertRowid: getLastInsertRowid(), changes: db.getRowsModified() };
    if (!inTx) saveDb();
    return result;
  }

  function sqlExec(sql) {
    db.exec(sql);
    if (!inTx) saveDb();
  }

function initSchema() {
  sqlExec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL,
    price      REAL NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tables (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'free'
  );

  CREATE TABLE IF NOT EXISTS table_zones (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id    INTEGER NOT NULL,
    waiter_name TEXT NOT NULL,
    items_json  TEXT NOT NULL DEFAULT '[]',
    total       REAL NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (table_id) REFERENCES tables(id)
  );

  CREATE TABLE IF NOT EXISTS staff (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL UNIQUE,
    pin      TEXT,
    card_uid TEXT,
    active   INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id        INTEGER NOT NULL,
    receipt_number  TEXT NOT NULL UNIQUE,
    printed_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS daily_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL,
    time            TEXT NOT NULL,
    table_number    INTEGER NOT NULL,
    waiter_name     TEXT NOT NULL,
    items_json      TEXT NOT NULL,
    total           REAL NOT NULL,
    receipt_number  TEXT,
    status          TEXT NOT NULL DEFAULT 'completed'
  );

  CREATE TABLE IF NOT EXISTS waiter_shifts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id     INTEGER NOT NULL,
    waiter_name  TEXT NOT NULL,
    opened_at    TEXT NOT NULL,
    closed_at    TEXT,
    FOREIGN KEY (staff_id) REFERENCES staff(id)
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    user_name  TEXT NOT NULL,
    user_role  TEXT NOT NULL,
    action     TEXT NOT NULL,
    detail     TEXT
  );

  CREATE TABLE IF NOT EXISTS purchase_invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier       TEXT NOT NULL,
    invoice_number TEXT NOT NULL DEFAULT '',
    invoice_date   TEXT NOT NULL,
    total          REAL NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'completed',
    created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS purchase_invoice_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id   INTEGER NOT NULL,
    menu_item_id INTEGER,
    product_name TEXT NOT NULL,
    quantity     REAL NOT NULL DEFAULT 0,
    unit_price   REAL NOT NULL DEFAULT 0,
    line_total   REAL NOT NULL DEFAULT 0,
    vat_rate     REAL NOT NULL DEFAULT 18,
    FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id)
  );

  CREATE TABLE IF NOT EXISTS reservations_local (
    id               TEXT PRIMARY KEY,
    cloud_id         TEXT,
    customer_name    TEXT NOT NULL,
    customer_phone   TEXT NOT NULL DEFAULT '',
    table_number     INTEGER NOT NULL,
    date             TEXT NOT NULL,
    time             TEXT NOT NULL,
    guests           INTEGER NOT NULL DEFAULT 2,
    notes            TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'pending',
    sync_status      TEXT NOT NULL DEFAULT 'pending',
    conflict_message TEXT NOT NULL DEFAULT '',
    pending_status   TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_res_local_date ON reservations_local(date);
  CREATE INDEX IF NOT EXISTS idx_res_local_sync ON reservations_local(sync_status);

  CREATE TABLE IF NOT EXISTS promotions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    discount_type  TEXT NOT NULL DEFAULT 'percent',
    discount_value REAL NOT NULL DEFAULT 0,
    applies_to     TEXT NOT NULL DEFAULT 'order',
    target_json    TEXT NOT NULL DEFAULT '[]',
    date_from      TEXT NOT NULL,
    date_to        TEXT NOT NULL,
    time_from      TEXT,
    time_to        TEXT,
    active         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    room_number     TEXT NOT NULL UNIQUE,
    floor           INTEGER NOT NULL DEFAULT 1,
    type            TEXT NOT NULL DEFAULT 'Single',
    price_per_night REAL NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'free'
  );

  CREATE TABLE IF NOT EXISTS housekeeping_tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id       INTEGER NOT NULL,
    assigned_to   INTEGER,
    status        TEXT NOT NULL DEFAULT 'dirty',
    priority      INTEGER NOT NULL DEFAULT 0,
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    completed_at  TEXT,
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (assigned_to) REFERENCES staff(id)
  );
  CREATE INDEX IF NOT EXISTS idx_hk_tasks_room ON housekeeping_tasks(room_id);
  CREATE INDEX IF NOT EXISTS idx_hk_tasks_status ON housekeeping_tasks(status);

  CREATE TABLE IF NOT EXISTS guests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id         INTEGER NOT NULL,
    guest_name      TEXT NOT NULL,
    phone           TEXT NOT NULL DEFAULT '',
    document_id     TEXT NOT NULL DEFAULT '',
    email           TEXT NOT NULL DEFAULT '',
    nationality     TEXT NOT NULL DEFAULT '',
    persons         INTEGER NOT NULL DEFAULT 1,
    check_in_date   TEXT NOT NULL,
    check_out_date  TEXT NOT NULL,
    deposit         REAL NOT NULL DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'active',
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS room_charges (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id     INTEGER NOT NULL,
    room_id      INTEGER NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    amount       REAL NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    service_id   INTEGER,
    menu_item_id INTEGER,
    vat_category TEXT NOT NULL DEFAULT '18',
    FOREIGN KEY (guest_id) REFERENCES guests(id),
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id         INTEGER NOT NULL,
    guest_name      TEXT NOT NULL,
    phone           TEXT NOT NULL DEFAULT '',
    email           TEXT NOT NULL DEFAULT '',
    check_in_date   TEXT NOT NULL,
    check_out_date  TEXT NOT NULL,
    persons         INTEGER NOT NULL DEFAULT 1,
    deposit         REAL NOT NULL DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'confirmed',
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS service_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    icon       TEXT NOT NULL DEFAULT '',
    photo      TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS services (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL UNIQUE,
    price        REAL NOT NULL DEFAULT 0,
    category_id  INTEGER,
    icon         TEXT NOT NULL DEFAULT '',
    photo        TEXT NOT NULL DEFAULT '',
    sort_order   INTEGER NOT NULL DEFAULT 0,
    price_mode   TEXT NOT NULL DEFAULT 'fixed',
    active       INTEGER NOT NULL DEFAULT 1,
    vat_category TEXT NOT NULL DEFAULT '18',
    FOREIGN KEY (category_id) REFERENCES service_categories(id)
  );

  CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date ON purchase_invoices(invoice_date);
  CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_inv ON purchase_invoice_items(invoice_id);
`);
  db.run("PRAGMA foreign_keys = ON");
  try {
    db.run("PRAGMA journal_mode = WAL");
  } catch (_) {
    /* ignore */
  }
  try {
    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_inv_supplier_number
      ON purchase_invoices(supplier, invoice_number)
      WHERE invoice_number IS NOT NULL AND trim(invoice_number) != ''
    `);
  } catch (_) {
    /* mund të ketë dublikata të vjetra — mos ndalo start */
  }
  const guestCols = sqlAll("PRAGMA table_info(guests)");
  const guestColNames = new Set(guestCols.map((c) => c.name));
  const guestMigrations = [
    ["document_id", "TEXT NOT NULL DEFAULT ''"],
    ["email", "TEXT NOT NULL DEFAULT ''"],
    ["nationality", "TEXT NOT NULL DEFAULT ''"],
    ["deposit", "REAL NOT NULL DEFAULT 0"],
    ["notes", "TEXT NOT NULL DEFAULT ''"],
    ["total_paid", "REAL NOT NULL DEFAULT 0"],
  ];
  for (const [col, decl] of guestMigrations) {
    if (!guestColNames.has(col)) {
      sqlRun(`ALTER TABLE guests ADD COLUMN ${col} ${decl}`);
    }
  }

  const reservationCols = sqlAll("PRAGMA table_info(reservations)");
  const reservationColNames = new Set(reservationCols.map((c) => c.name));
  const reservationMigrations = [
    ["email", "TEXT NOT NULL DEFAULT ''"],
    ["notes", "TEXT NOT NULL DEFAULT ''"],
    ["deposit", "REAL NOT NULL DEFAULT 0"],
  ];
  for (const [col, decl] of reservationMigrations) {
    if (!reservationColNames.has(col)) {
      sqlRun(`ALTER TABLE reservations ADD COLUMN ${col} ${decl}`);
    }
  }

  const staffCols = sqlAll("PRAGMA table_info(staff)");
  if (!staffCols.some(c => c.name === "pin")) {
    sqlRun("ALTER TABLE staff ADD COLUMN pin TEXT");
  }
  if (!staffCols.some(c => c.name === "card_uid")) {
    sqlRun("ALTER TABLE staff ADD COLUMN card_uid TEXT");
  }
  const orderCols = sqlAll("PRAGMA table_info(orders)");
  if (!orderCols.some(c => c.name === "payment_method")) {
    sqlRun("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'");
  }
  if (!orderCols.some(c => c.name === "batch_count")) {
    sqlRun("ALTER TABLE orders ADD COLUMN batch_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!orderCols.some(c => c.name === "last_slip_items_json")) {
    sqlRun("ALTER TABLE orders ADD COLUMN last_slip_items_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!orderCols.some(c => c.name === "cloud_order_id")) {
    sqlRun("ALTER TABLE orders ADD COLUMN cloud_order_id TEXT");
  }
  if (!orderCols.some(c => c.name === "source_label")) {
    sqlRun("ALTER TABLE orders ADD COLUMN source_label TEXT NOT NULL DEFAULT ''");
  }
  sqlRun("CREATE INDEX IF NOT EXISTS idx_orders_cloud_id ON orders(cloud_order_id)");
  sqlRun(`
    CREATE TABLE IF NOT EXISTS pending_cloud_orders (
      cloud_id       TEXT PRIMARY KEY,
      payload_json   TEXT NOT NULL,
      first_seen_at  TEXT NOT NULL,
      last_seen_at   TEXT NOT NULL
    )
  `);
  sqlRun("CREATE INDEX IF NOT EXISTS idx_pending_cloud_last_seen ON pending_cloud_orders(last_seen_at)");
  const logCols = sqlAll("PRAGMA table_info(daily_log)");
  if (!logCols.some(c => c.name === "payment_method")) {
    sqlRun("ALTER TABLE daily_log ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'");
  }
  if (!logCols.some(c => c.name === "staff_id")) {
    sqlRun("ALTER TABLE daily_log ADD COLUMN staff_id INTEGER");
  }
  if (!logCols.some(c => c.name === "shift_id")) {
    sqlRun("ALTER TABLE daily_log ADD COLUMN shift_id INTEGER");
  }
  if (!logCols.some(c => c.name === "subtotal")) {
    sqlRun("ALTER TABLE daily_log ADD COLUMN subtotal REAL NOT NULL DEFAULT 0");
  }
  if (!logCols.some(c => c.name === "discount_total")) {
    sqlRun("ALTER TABLE daily_log ADD COLUMN discount_total REAL NOT NULL DEFAULT 0");
  }
  if (!logCols.some(c => c.name === "promotion_id")) {
    sqlRun("ALTER TABLE daily_log ADD COLUMN promotion_id INTEGER");
  }
  if (!logCols.some(c => c.name === "promotion_name")) {
    sqlRun("ALTER TABLE daily_log ADD COLUMN promotion_name TEXT NOT NULL DEFAULT ''");
  }
  if (!logCols.some(c => c.name === "cloud_sale_id")) {
    sqlRun("ALTER TABLE daily_log ADD COLUMN cloud_sale_id TEXT");
  }
  if (!logCols.some(c => c.name === "order_id")) {
    sqlRun("ALTER TABLE daily_log ADD COLUMN order_id INTEGER");
  }
  sqlRun("CREATE INDEX IF NOT EXISTS idx_daily_log_cloud_sale ON daily_log(cloud_sale_id)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_daily_log_order_id ON daily_log(order_id)");
  try {
    sqlRun(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_log_cloud_sale_unique ON daily_log(cloud_sale_id) WHERE cloud_sale_id IS NOT NULL AND TRIM(cloud_sale_id) <> ''",
    );
  } catch {
    /* ekzistojnë duplikata — rebuild i pastron */
  }
  const catCols = sqlAll("PRAGMA table_info(categories)");
  if (!catCols.some(c => c.name === "active")) {
    sqlRun("ALTER TABLE categories ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  }
  const menuCols = sqlAll("PRAGMA table_info(menu_items)");
  if (!menuCols.some(c => c.name === "photo")) {
    sqlRun("ALTER TABLE menu_items ADD COLUMN photo TEXT");
  }
  if (!menuCols.some(c => c.name === "stock_qty")) {
    sqlRun("ALTER TABLE menu_items ADD COLUMN stock_qty REAL NOT NULL DEFAULT 0");
  }
  if (!menuCols.some(c => c.name === "low_stock_threshold")) {
    sqlRun("ALTER TABLE menu_items ADD COLUMN low_stock_threshold REAL NOT NULL DEFAULT 0");
  }
  if (!menuCols.some(c => c.name === "vat_category")) {
    sqlRun("ALTER TABLE menu_items ADD COLUMN vat_category TEXT NOT NULL DEFAULT '18'");
  }
  if (!menuCols.some(c => c.name === "sort_order")) {
    sqlRun("ALTER TABLE menu_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
    const rows = sqlAll("SELECT id, category FROM menu_items ORDER BY category, name, id");
    let prevCat = null;
    let idx = 0;
    for (const r of rows) {
      if (r.category !== prevCat) {
        prevCat = r.category;
        idx = 0;
      }
      sqlRun("UPDATE menu_items SET sort_order = ? WHERE id = ?", [idx, r.id]);
      idx += 1;
    }
  }
  if (!menuCols.some(c => c.name === "barcode")) {
    sqlRun("ALTER TABLE menu_items ADD COLUMN barcode TEXT");
  }
  const tableCols = sqlAll("PRAGMA table_info(tables)");
  if (!tableCols.some(c => c.name === "display_name")) {
    sqlRun("ALTER TABLE tables ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
  }
  if (!tableCols.some(c => c.name === "zone_id")) {
    sqlRun("ALTER TABLE tables ADD COLUMN zone_id INTEGER");
  }
  if (!tableCols.some(c => c.name === "sort_order")) {
    sqlRun("ALTER TABLE tables ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }
  const zoneCount = sqlGet("SELECT COUNT(*) AS c FROM table_zones").c;
  if (zoneCount === 0) {
    const L = localeLayoutLabels();
    /* Hotel: zona F&B — Restoranti, Bari, Terrasa */
    sqlRun("INSERT INTO table_zones (name, sort_order) VALUES (?, 0)", ["Restoranti"]);
    sqlRun("INSERT INTO table_zones (name, sort_order) VALUES (?, 1)", ["Bari"]);
    sqlRun("INSERT INTO table_zones (name, sort_order) VALUES (?, 2)", ["Terrasa"]);
    const defaultZone = sqlGet("SELECT id FROM table_zones ORDER BY sort_order, id LIMIT 1");
    if (defaultZone?.id) {
      sqlRun("UPDATE tables SET zone_id = ? WHERE zone_id IS NULL", [defaultZone.id]);
    }
    sqlRun(
      `UPDATE tables SET display_name = ? || number
       WHERE display_name IS NULL OR TRIM(display_name) = ''`,
      [L.tablePrefix],
    );
  }
  const shiftCols = sqlAll("PRAGMA table_info(waiter_shifts)");
  if (!shiftCols.some(c => c.name === "opening_cash")) {
    sqlRun("ALTER TABLE waiter_shifts ADD COLUMN opening_cash REAL");
  }
  if (!shiftCols.some(c => c.name === "closing_cash_actual")) {
    sqlRun("ALTER TABLE waiter_shifts ADD COLUMN closing_cash_actual REAL");
  }
  if (!shiftCols.some(c => c.name === "expected_closing_cash")) {
    sqlRun("ALTER TABLE waiter_shifts ADD COLUMN expected_closing_cash REAL");
  }
  if (!shiftCols.some(c => c.name === "cash_difference")) {
    sqlRun("ALTER TABLE waiter_shifts ADD COLUMN cash_difference REAL");
  }
  if (!shiftCols.some(c => c.name === "cash_sales_total")) {
    sqlRun("ALTER TABLE waiter_shifts ADD COLUMN cash_sales_total REAL");
  }
  if (!shiftCols.some(c => c.name === "card_sales_total")) {
    sqlRun("ALTER TABLE waiter_shifts ADD COLUMN card_sales_total REAL");
  }
  if (!shiftCols.some(c => c.name === "order_count_total")) {
    sqlRun("ALTER TABLE waiter_shifts ADD COLUMN order_count_total INTEGER");
  }
  if (!shiftCols.some(c => c.name === "total_sales")) {
    sqlRun("ALTER TABLE waiter_shifts ADD COLUMN total_sales REAL");
  }
  if (!shiftCols.some(c => c.name === "handed_over_to_staff_id")) {
    sqlRun("ALTER TABLE waiter_shifts ADD COLUMN handed_over_to_staff_id INTEGER");
  }
  if (!shiftCols.some(c => c.name === "handover_id")) {
    sqlRun("ALTER TABLE waiter_shifts ADD COLUMN handover_id INTEGER");
  }
  if (!shiftCols.some(c => c.name === "discount_total")) {
    sqlRun("ALTER TABLE waiter_shifts ADD COLUMN discount_total REAL");
  }
  if (!shiftCols.some(c => c.name === "closing_reason")) {
    sqlRun("ALTER TABLE waiter_shifts ADD COLUMN closing_reason TEXT NOT NULL DEFAULT ''");
  }
  sqlRun(`
    CREATE TABLE IF NOT EXISTS shift_handovers (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      from_shift_id         INTEGER NOT NULL,
      from_staff_id         INTEGER NOT NULL,
      from_waiter_name      TEXT NOT NULL,
      to_staff_id           INTEGER NOT NULL,
      to_waiter_name        TEXT NOT NULL,
      handover_cash         REAL NOT NULL,
      expected_cash         REAL NOT NULL,
      closing_discrepancy   REAL NOT NULL DEFAULT 0,
      opening_cash_accepted REAL,
      opening_discrepancy   REAL,
      status                TEXT NOT NULL DEFAULT 'pending',
      created_at            TEXT NOT NULL,
      accepted_at           TEXT,
      to_shift_id           INTEGER,
      FOREIGN KEY (from_shift_id) REFERENCES waiter_shifts(id)
    )
  `);
  sqlRun("CREATE INDEX IF NOT EXISTS idx_handover_to_pending ON shift_handovers(to_staff_id, status)");
  sqlRun(`
    CREATE TABLE IF NOT EXISTS expenses (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_date  TEXT NOT NULL,
      vendor_name   TEXT NOT NULL DEFAULT '',
      description   TEXT NOT NULL DEFAULT '',
      category      TEXT NOT NULL DEFAULT 'tjeter',
      amount        REAL NOT NULL DEFAULT 0,
      entered_by    TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);
  sqlRun("CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date)");
  sqlRun(`
    CREATE TABLE IF NOT EXISTS atk_payroll (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year_month TEXT NOT NULL,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      individual_number TEXT NOT NULL DEFAULT '',
      gross_salary REAL NOT NULL DEFAULT 0,
      employee_pension REAL NOT NULL DEFAULT 0,
      employer_pension REAL NOT NULL DEFAULT 0,
      employee_supplement REAL NOT NULL DEFAULT 0,
      employer_supplement REAL NOT NULL DEFAULT 0,
      primary_job INTEGER NOT NULL DEFAULT 1,
      include_contributions INTEGER NOT NULL DEFAULT 1,
      apply_wage_tax INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);
  sqlRun("CREATE INDEX IF NOT EXISTS idx_atk_payroll_ym ON atk_payroll(year_month)");
  sqlRun(`
    CREATE TABLE IF NOT EXISTS atk_rent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year_month TEXT NOT NULL,
      nui TEXT NOT NULL DEFAULT '',
      party_name TEXT NOT NULL DEFAULT '',
      interest REAL NOT NULL DEFAULT 0,
      royalties REAL NOT NULL DEFAULT 0,
      lottery REAL NOT NULL DEFAULT 0,
      rent_gross REAL NOT NULL DEFAULT 0,
      non_resident_entertainment REAL NOT NULL DEFAULT 0,
      non_resident_services REAL NOT NULL DEFAULT 0,
      special_payments REAL NOT NULL DEFAULT 0,
      area_m2 REAL NOT NULL DEFAULT 0,
      monthly_rent REAL NOT NULL DEFAULT 0,
      country TEXT NOT NULL DEFAULT 'Kosovë',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);
  sqlRun("CREATE INDEX IF NOT EXISTS idx_atk_rent_ym ON atk_rent(year_month)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_daily_log_date_status ON daily_log(date, status)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_orders_status_table ON orders(status, table_id)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_waiter_shifts_staff_open ON waiter_shifts(staff_id, closed_at)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_menu_items_active_cat ON menu_items(active, category)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(active)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_tables_zone ON tables(zone_id, sort_order, number)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_guests_room_status ON guests(room_id, status)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_guests_dates ON guests(check_in_date, check_out_date)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_room_charges_guest ON room_charges(guest_id)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_room_charges_room ON room_charges(room_id)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_room_charges_created ON room_charges(created_at)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_reservations_room ON reservations(room_id)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_reservations_dates ON reservations(check_in_date, check_out_date)");
  sqlRun("CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status)");
  try {
    const piCols = sqlAll("PRAGMA table_info(purchase_invoices)");
    if (!piCols.some((c) => c.name === "supplier_nui")) {
      sqlRun("ALTER TABLE purchase_invoices ADD COLUMN supplier_nui TEXT NOT NULL DEFAULT ''");
    }
    if (!piCols.some((c) => c.name === "supplier_vat")) {
      sqlRun("ALTER TABLE purchase_invoices ADD COLUMN supplier_vat TEXT NOT NULL DEFAULT ''");
    }
    if (!piCols.some((c) => c.name === "vat_rate")) {
      sqlRun("ALTER TABLE purchase_invoices ADD COLUMN vat_rate REAL NOT NULL DEFAULT 18");
    }
    if (!piCols.some((c) => c.name === "purchase_kind")) {
      sqlRun("ALTER TABLE purchase_invoices ADD COLUMN purchase_kind TEXT NOT NULL DEFAULT 'goods'");
    }
  } catch (_) { /* */ }
  try {
    const piiCols = sqlAll("PRAGMA table_info(purchase_invoice_items)");
    if (!piiCols.some((c) => c.name === "vat_rate")) {
      sqlRun("ALTER TABLE purchase_invoice_items ADD COLUMN vat_rate REAL NOT NULL DEFAULT 18");
      sqlRun(`
        UPDATE purchase_invoice_items
        SET vat_rate = COALESCE(
          (SELECT pi.vat_rate FROM purchase_invoices pi WHERE pi.id = purchase_invoice_items.invoice_id),
          18
        )
      `);
    }
  } catch (_) { /* */ }
  try {
    const exCols = sqlAll("PRAGMA table_info(expenses)");
    if (!exCols.some((c) => c.name === "vendor_nui")) {
      sqlRun("ALTER TABLE expenses ADD COLUMN vendor_nui TEXT NOT NULL DEFAULT ''");
    }
    if (!exCols.some((c) => c.name === "vat_rate")) {
      sqlRun("ALTER TABLE expenses ADD COLUMN vat_rate REAL NOT NULL DEFAULT 18");
    }
  } catch (_) { /* */ }
  const count = sqlGet("SELECT COUNT(*) AS c FROM categories").c;
  if (count === 0) {
    VERSION.defaultCategories.forEach((name, i) => {
      sqlRun("INSERT INTO categories (name, sort_order) VALUES (?, ?)", [name, i]);
    });
  }
  try {
    const svcCols = sqlAll("PRAGMA table_info(services)");
    const svcColNames = new Set(svcCols.map((c) => c.name));
    const svcMigrations = [
      ["category_id", "INTEGER"],
      ["icon", "TEXT NOT NULL DEFAULT ''"],
      ["photo", "TEXT NOT NULL DEFAULT ''"],
      ["sort_order", "INTEGER NOT NULL DEFAULT 0"],
      ["price_mode", "TEXT NOT NULL DEFAULT 'fixed'"],
      ["active", "INTEGER NOT NULL DEFAULT 1"],
      ["vat_category", "TEXT NOT NULL DEFAULT '18'"],
    ];
    for (const [col, decl] of svcMigrations) {
      if (!svcColNames.has(col)) {
        sqlRun(`ALTER TABLE services ADD COLUMN ${col} ${decl}`);
      }
    }
  } catch (_) { /* */ }

  try {
    const catCols = sqlAll("PRAGMA table_info(service_categories)");
    if (!catCols.some((c) => c.name === "photo")) {
      sqlRun("ALTER TABLE service_categories ADD COLUMN photo TEXT NOT NULL DEFAULT ''");
    }
  } catch (_) { /* */ }

  try {
    const rcCols = sqlAll("PRAGMA table_info(room_charges)");
    const rcNames = new Set(rcCols.map((c) => c.name));
    const rcMigrations = [
      ["service_id", "INTEGER"],
      ["menu_item_id", "INTEGER"],
      ["vat_category", "TEXT NOT NULL DEFAULT '18'"],
    ];
    for (const [col, decl] of rcMigrations) {
      if (!rcNames.has(col)) {
        sqlRun(`ALTER TABLE room_charges ADD COLUMN ${col} ${decl}`);
      }
    }
  } catch (_) { /* */ }

  try {
    ensureHotelServiceCatalogSeed(sqlGet, sqlRun, sqlAll);
  } catch (_) { /* */ }
  // FR: rename default Albanian zone/table labels in existing DBs
  try {
    const i18nMod = require("./i18n");
    if (i18nMod.isFrench()) {
      sqlRun("UPDATE table_zones SET name = 'Principale' WHERE name = 'Kryesore'");
      sqlRun("UPDATE table_zones SET name = 'Commandes en ligne' WHERE name = 'Porosi online'");
      const rows = sqlAll("SELECT id, number, display_name FROM tables");
      for (const r of rows) {
        const dn = String(r.display_name || "").trim();
        if (/^Tavolina\s+\d+$/i.test(dn)) {
          sqlRun("UPDATE tables SET display_name = ? WHERE id = ?", [`Table ${r.number}`, r.id]);
        }
      }
    }
  } catch {
    /* ignore */
  }

  // HAPI 1 — skema fiskale (tabela të reja; nuk prek funksionet e mbrojtura)
  try {
    const { initFiscalDB } = require("./fiscal/fiscal-db");
    initFiscalDB({
      exec: (sql) => sqlExec(sql),
      run: (sql) => sqlRun(sql),
      get: (sql, params) => sqlGet(sql, params || []),
    });
  } catch (e) {
    console.warn("[fiscal-db] initFiscalDB:", e.message);
  }
}


  const wasmCandidates = [];
  if (cfg.wasmDir) wasmCandidates.push(cfg.wasmDir);
  if (cfg.resourcesPath) {
    wasmCandidates.push(
      path.join(cfg.resourcesPath, "app.asar.unpacked", "node_modules", "sql.js", "dist"),
    );
  }
  wasmCandidates.push(path.join(baseDir, "node_modules", "sql.js", "dist"));
  wasmCandidates.push(path.join(__dirname, "node_modules", "sql.js", "dist"));

  const SQL = await initSqlJs({
    locateFile: (file) => {
      for (const dir of wasmCandidates) {
        const p = path.join(dir, file);
        if (fs.existsSync(p)) return p;
      }
      return path.join(wasmCandidates[0] || __dirname, file);
    },
  });

  if (fs.existsSync(dbPath)) {
    const bytes =
      process.env.HOTEL_DB_PLAIN === "1"
        ? fs.readFileSync(dbPath)
        : loadDbFileBytes(dbPath);
    db = new SQL.Database(bytes);
  } else {
    db = new SQL.Database();
  }

  try {
    const keysDir = path.join(path.dirname(dbPath), "fiscal-keys");
    dbCrypto.migratePlainPrivateKeys(keysDir);
  } catch (e) {
    console.warn("[db-engine] fiscal-keys migrate:", e.message);
  }
  savePaused = true;
  let schemaBefore = "";
  try {
    schemaBefore = JSON.stringify(
      sqlAll("SELECT name, type, sql FROM sqlite_master ORDER BY name"),
    );
    initSchema();
  } finally {
    savePaused = false;
  }
  const schemaAfter = JSON.stringify(
    sqlAll("SELECT name, type, sql FROM sqlite_master ORDER BY name"),
  );
  if (schemaBefore !== schemaAfter) flushSave();

  function dispatch(msg) {
    const t0 = Date.now();
    let out;
    try {
      switch (msg.op) {
        case "get":
          out = sqlGet(msg.sql, msg.params);
          break;
        case "all":
          out = sqlAll(msg.sql, msg.params);
          break;
        case "run":
          out = sqlRun(msg.sql, msg.params);
          break;
        case "runMany": {
          const list = Array.isArray(msg.paramsList) ? msg.paramsList : [];
          for (const params of list) {
            if (params && params.length) db.run(msg.sql, params);
            else db.run(msg.sql);
          }
          out = { lastInsertRowid: getLastInsertRowid(), changes: db.getRowsModified() };
          if (!inTx) saveDb();
          break;
        }
        case "exec":
          sqlExec(msg.sql);
          out = undefined;
          break;
        case "begin":
          inTx = true;
          db.run("BEGIN");
          out = undefined;
          break;
        case "commit":
          db.run("COMMIT");
          inTx = false;
          flushSave();
          out = undefined;
          break;
        case "rollback":
          db.run("ROLLBACK");
          inTx = false;
          out = undefined;
          break;
        default:
          throw new Error("Unknown db op: " + msg.op);
      }
      return out;
    } finally {
      const ms = Date.now() - t0;
      if (ms >= 100) {
        const detail = `${msg.op} ${(msg.sql || "").replace(/\s+/g, " ").slice(0, 120)}`;
        console.log(`[slow-db] ${ms}ms ${detail}`);
        try {
          fs.appendFileSync(
            path.join(path.dirname(dbPath), "slow-ops.jsonl"),
            JSON.stringify({ t: new Date().toISOString(), kind: "db", ms, detail }) + "\n",
          );
        } catch {
          /* ignore */
        }
      }
    }
  }

  return { dispatch, flushSave };
}

module.exports = { bootDatabase };
