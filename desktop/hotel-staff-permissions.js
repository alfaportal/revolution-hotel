const PERMISSION_DEFS = [
  { tab_key: "pasqyra", label: "Pasqyra" },
  { tab_key: "menuja", label: "Produktet" },
  { tab_key: "importo-produkte", label: "Importo Produkte" },
  { tab_key: "promocione", label: "Promocione" },
  { tab_key: "tavolinat", label: "Tavolinat" },
  { tab_key: "rezervime", label: "Rezervime tavolinash" },
  { tab_key: "stoku", label: "Stoku" },
  { tab_key: "receta-perberesit", label: "Receptat" },
  { tab_key: "stafi", label: "Punonjësit" },
  { tab_key: "dhomat", label: "Dhomat" },
  { tab_key: "sherbimet", label: "Shërbimet" },
  { tab_key: "rezervime-dhomash", label: "Rezervimet" },
  { tab_key: "mysafiret", label: "Mysafirët" },
  { tab_key: "pastrimi", label: "Pastrimi" },
  { tab_key: "qr-tavolinat", label: "QR Kodet" },
  { tab_key: "raportet", label: "Raportet" },
  { tab_key: "raporte-avancuara", label: "Raporte të avancuara" },
  { tab_key: "faturat", label: "Faturat" },
  { tab_key: "ditari", label: "Ditari" },
  { tab_key: "ditari-hoteli", label: "Ditari i hotelit" },
  { tab_key: "fiskalizimi", label: "Fiskalizimi" },
  { tab_key: "kuponet-fiskale", label: "Kuponët fiskalë" },
  { tab_key: "audit", label: "Audit" },
  { tab_key: "paper-block", label: "Blloku i letrës" },
  { tab_key: "cilësimet", label: "Cilësimet" },
  { tab_key: "licenca", label: "Licenca" },
  { tab_key: "blerjet", label: "Blerjet" },
  { tab_key: "furnitoret", label: "Furnitorët" },
  { tab_key: "kontabilisti", label: "Kontabilisti" },
  { tab_key: "ai", label: "AI" },
];

const PERMISSION_KEYS = new Set(PERMISSION_DEFS.map((d) => d.tab_key));

const PATH_RULES = [
  ["/api/admin/rooms", ["dhomat", "rezervime-dhomash", "pastrimi"]],
  ["/api/admin/guests", ["mysafiret"]],
  ["/api/admin/services", ["sherbimet"]],
  ["/api/admin/ditari", ["ditari", "ditari-hoteli"]],
  ["/api/fiscal-paper-block", ["paper-block"]],
  ["/api/fiscal-receipts", ["kuponet-fiskale"]],
  ["/api/fiscal-audit", ["audit"]],
  ["/api/fiscal-settings", ["fiskalizimi", "cilësimet"]],
  ["/api/fiscal-config", ["fiskalizimi"]],
  ["/api/fiscal-print-mode", ["fiskalizimi", "cilësimet"]],
  ["/api/fiscal", ["fiskalizimi", "kuponet-fiskale", "paper-block", "audit"]],
  ["/api/reports", ["raportet", "raporte-avancuara", "pasqyra"]],
  ["/api/advanced-reports", ["raporte-avancuara"]],
  ["/api/ditari", ["ditari", "ditari-hoteli"]],
  ["/api/dashboard", ["pasqyra"]],
  ["/api/menu", ["menuja"]],
  ["/api/categories", ["menuja"]],
  ["/api/products/import", ["importo-produkte", "menuja"]],
  ["/api/products", ["menuja"]],
  ["/api/ingredients", ["receta-perberesit", "stoku"]],
  ["/api/recipes", ["receta-perberesit"]],
  ["/api/stock", ["stoku"]],
  ["/api/purchases", ["blerjet"]],
  ["/api/suppliers", ["furnitoret"]],
  ["/api/staff", ["stafi"]],
  ["/api/tables", ["tavolinat"]],
  ["/api/zones", ["tavolinat"]],
  ["/api/reservations", ["rezervime", "rezervime-dhomash"]],
  ["/api/promotions", ["promocione"]],
  ["/api/table-qrs", ["qr-tavolinat"]],
  ["/api/hotel-qrs", ["qr-tavolinat"]],
  ["/api/hotel-qr-venues", ["qr-tavolinat"]],
  ["/api/invoices", ["faturat"]],
  ["/api/sales-invoices", ["faturat"]],
  ["/api/license", ["licenca"]],
  ["/api/settings", ["cilësimet", "pasqyra"]],
  ["/api/ai", ["ai"]],
  ["/api/kontabilisti", ["kontabilisti"]],
  ["/api/printer", ["cilësimet", "fiskalizimi"]],
];

let sqlite = null;

function init(db) {
  sqlite = db;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS staff_tab_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      tab_key TEXT NOT NULL,
      allowed INTEGER NOT NULL DEFAULT 0,
      UNIQUE(staff_id, tab_key)
    );
  `);
}

function ensure(staffId) {
  const id = Number(staffId);
  if (!id || !sqlite) return;
  const ins = sqlite.prepare(
    `INSERT OR IGNORE INTO staff_tab_permissions (staff_id, tab_key, allowed) VALUES (?, ?, 0)`,
  );
  for (const key of PERMISSION_KEYS) ins.run(id, key);
}

function get(staffId) {
  const id = Number(staffId);
  if (!id) throw new Error("ID punonjësi mungon");
  ensure(id);
  const rows = sqlite.prepare(`SELECT tab_key, allowed FROM staff_tab_permissions WHERE staff_id = ?`).all(id);
  const byKey = new Map(rows.map((r) => [r.tab_key, Number(r.allowed) ? 1 : 0]));
  return {
    ok: true,
    staff_id: id,
    permissions: PERMISSION_DEFS.map((d) => ({
      tab_key: d.tab_key,
      label: d.label,
      allowed: byKey.get(d.tab_key) ?? 0,
    })),
  };
}

function set(staffId, items) {
  const id = Number(staffId);
  if (!id) throw new Error("ID punonjësi mungon");
  ensure(id);
  const list = Array.isArray(items) ? items : [];
  const upsert = sqlite.prepare(
    `INSERT INTO staff_tab_permissions (staff_id, tab_key, allowed)
     VALUES (?, ?, ?)
     ON CONFLICT(staff_id, tab_key) DO UPDATE SET allowed = excluded.allowed`,
  );
  const seen = new Set();
  for (const it of list) {
    const key = String(it?.tab_key || "").trim();
    if (!PERMISSION_KEYS.has(key)) throw new Error(`Leje e panjohur: ${key}`);
    seen.add(key);
    upsert.run(id, key, it?.allowed === 1 || it?.allowed === true ? 1 : 0);
  }
  for (const key of PERMISSION_KEYS) {
    if (!seen.has(key)) upsert.run(id, key, 0);
  }
  return get(id);
}

function allowedSet(staffId) {
  const id = Number(staffId);
  if (!id || !sqlite) return new Set();
  ensure(id);
  const rows = sqlite
    .prepare(`SELECT tab_key FROM staff_tab_permissions WHERE staff_id = ? AND allowed = 1`)
    .all(id);
  return new Set(rows.map((r) => r.tab_key));
}

function requestAllowed(staffId, path, method) {
  const p = String(path || "");
  const have = allowedSet(staffId);
  if (!have.size) return false;
  if ((p === "/api/settings" || p === "/api/server-info") && String(method || "GET").toUpperCase() === "GET") return true;
  const hit = PATH_RULES.find((r) => p === r[0] || p.startsWith(r[0] + "/") || p.startsWith(r[0]));
  if (!hit) return false;
  return hit[1].some((k) => have.has(k));
}

module.exports = { PERMISSION_DEFS, init, get, set, requestAllowed };
