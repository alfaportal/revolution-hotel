"use strict";
/**
 * Thyerje dhe humbje — zbrit stok, regjistro shpenzim (pa shitje / pa TVSH shitjeje).
 */
const STOCK_BREAKAGE_REASONS = ["thye", "prish", "skado", "humb", "tjeter"];

const REASON_LABELS = {
  thye: "U thye",
  prish: "U prish",
  skado: "Skadoi",
  humb: "Humbi",
  tjetër: "Tjetër",
  tjeter: "Tjetër",
};

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

const { businessYmd } = require("./lib/hotel-business-date");

function reasonLabel(code) {
  const k = String(code || "").trim().toLowerCase();
  return REASON_LABELS[k] || k || "Tjetër";
}

function normalizeReason(raw) {
  const r = String(raw || "").trim().toLowerCase();
  return STOCK_BREAKAGE_REASONS.includes(r) ? r : "tjeter";
}

function createStockBreakageLossApi(db) {
  const sqlite = db.db;

  function listPickableMenuItems() {
    return sqlite.prepare(`
      SELECT id, name, COALESCE(stock_qty, 0) AS stock_qty, category
      FROM menu_items
      WHERE active = 1
      ORDER BY category ASC, name ASC
    `).all();
  }

  function listLocalInventoryItems() {
    try {
      return sqlite.prepare(`
        SELECT id, name, COALESCE(quantity, 0) AS quantity, COALESCE(unit_cost, 0) AS unit_cost
        FROM hotel_local_inventory
        WHERE active = 1
        ORDER BY name ASC
      `).all();
    } catch {
      return [];
    }
  }

  function resolveUnitCostMenu(menuItemId) {
    const id = Number(menuItemId);
    if (!id) return 0;
    if (typeof db.getMenuItemCostForCogs === "function") {
      const c = db.getMenuItemCostForCogs(id);
      if (Number.isFinite(c) && c >= 0) return c;
    }
    const row = sqlite.prepare("SELECT COALESCE(price, 0) AS price FROM menu_items WHERE id = ?").get(id);
    return Number(row?.price) || 0;
  }

  function registerStockBreakageLoss({
    source_type,
    source_id,
    quantity,
    reason,
    note = "",
    operator_name = "",
    operator_role = "",
  }) {
    const srcType = String(source_type || "").trim().toLowerCase();
    const srcId = Number(source_id);
    const qty = Number(quantity);
    if (!["menu", "local"].includes(srcType)) throw new Error("Burimi i artikullit është i pavlefshëm.");
    if (!srcId || !Number.isFinite(qty) || qty <= 0) throw new Error("Sasia duhet të jetë më e madhe se 0.");
    const reasonNorm = normalizeReason(reason);
    const opName = String(operator_name || "Staf").trim().slice(0, 120);
    const opRole = String(operator_role || "").trim().slice(0, 40);
    const noteText = String(note || "").trim().slice(0, 500);

    return sqlite.transaction(() => {
      let itemName = "";
      let unitCost = 0;
      let stockBefore = 0;
      let stockAfter = 0;

      if (srcType === "menu") {
        const row = sqlite.prepare(`
          SELECT id, name, COALESCE(stock_qty, 0) AS stock_qty FROM menu_items WHERE id = ? AND active = 1
        `).get(srcId);
        if (!row) throw new Error("Produkti nuk u gjet.");
        stockBefore = Number(row.stock_qty) || 0;
        if (qty > stockBefore + 0.0001) {
          throw new Error(`Stoku i pamjaftueshëm (${stockBefore} copë).`);
        }
        itemName = String(row.name || "").trim();
        unitCost = resolveUnitCostMenu(srcId);
        const adj = db.adjustMenuItemStockByDelta(
          srcId,
          -qty,
          `Thyerje/humbje: ${reasonLabel(reasonNorm)}${noteText ? ` — ${noteText}` : ""}`,
          opName,
          { inTransaction: true },
        );
        stockAfter = Number(adj?.stock_qty) ?? Math.max(0, stockBefore - qty);
      } else if (srcType === "ingredient") {
        if (typeof db.getIngredient !== "function" || typeof db.updateIngredient !== "function") {
          throw new Error("Moduli përbërësve nuk është aktiv.");
        }
        const ing = db.getIngredient(srcId);
        if (!ing) throw new Error("Përbërësi nuk u gjet.");
        stockBefore = Number(ing.stock_qty) || 0;
        itemName = String(ing.name || "").trim();
        unitCost = Number(ing.avg_cost_per_unit) || 0;
        stockAfter = roundQty(stockBefore - qty);
        db.updateIngredient(srcId, { stock_qty: stockAfter });
      } else {
        const row = sqlite.prepare(`
          SELECT id, name, COALESCE(quantity, 0) AS quantity, COALESCE(unit_cost, 0) AS unit_cost
          FROM hotel_local_inventory WHERE id = ? AND active = 1
        `).get(srcId);
        if (!row) throw new Error("Artikulli i inventarit nuk u gjet.");
        stockBefore = Number(row.quantity) || 0;
        if (qty > stockBefore + 0.0001) {
          throw new Error(`Sasia në inventar është e pamjaftueshme (${stockBefore}).`);
        }
        itemName = String(row.name || "").trim();
        unitCost = Number(row.unit_cost) || 0;
        stockAfter = Math.max(0, stockBefore - qty);
        sqlite.prepare("UPDATE hotel_local_inventory SET quantity = ? WHERE id = ?").run(stockAfter, srcId);
      }

      const totalCost = roundMoney(qty * unitCost);
      const desc = `${itemName} × ${qty} — ${reasonLabel(reasonNorm)}${noteText ? `. ${noteText}` : ""}`;

      let expenseId = null;
      if (totalCost > 0) {
        expenseId = db.addExpense({
          expense_date: businessYmd(),
          vendor_name: "Humbje stoku (hotel)",
          description: desc.slice(0, 240),
          category: "humbje",
          amount: totalCost,
          entered_by: opName,
          vendor_nui: "",
          vat_rate: 0,
        });
      }

      const ins = sqlite.prepare(`
        INSERT INTO stock_breakage_loss (
          source_type, source_id, item_name, quantity, reason, note,
          operator_name, operator_role, unit_cost, total_cost, expense_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        srcType,
        srcId,
        itemName,
        qty,
        reasonNorm,
        noteText,
        opName,
        opRole,
        roundMoney(unitCost),
        totalCost,
        expenseId,
      );

      try {
        const ownerReportSync = require("./owner-report-sync");
        ownerReportSync.queueOwnerReportDates(db, [businessYmd()]);
        ownerReportSync.runOwnerReportSync(db).catch(() => {});
      } catch {
        /* offline / tests */
      }

      return {
        id: Number(ins.lastInsertRowid),
        source_type: srcType,
        source_id: srcId,
        item_name: itemName,
        quantity: qty,
        reason: reasonNorm,
        stock_before: stockBefore,
        stock_after: stockAfter,
        unit_cost: roundMoney(unitCost),
        total_cost: totalCost,
        expense_id: expenseId,
      };
    })();
  }

  function listStockBreakageLoss({ from, to, limit = 500 } = {}) {
    const today = businessYmd();
    const fromD = String(from || "1970-01-01").slice(0, 10);
    const toD = String(to || today).slice(0, 10);
    const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000);
    return sqlite.prepare(`
      SELECT * FROM stock_breakage_loss
      WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(fromD, toD, lim);
  }

  function summarizeStockBreakageLoss({ from, to } = {}) {
    const today = businessYmd();
    const fromD = String(from || today).slice(0, 10);
    const toD = String(to || today).slice(0, 10);
    const rows = sqlite.prepare(`
      SELECT reason, operator_name, SUM(quantity) AS qty, SUM(total_cost) AS total_cost, COUNT(*) AS events
      FROM stock_breakage_loss
      WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
      GROUP BY reason, operator_name
      ORDER BY total_cost DESC
    `).all(fromD, toD);
    const tot = sqlite.prepare(`
      SELECT COALESCE(SUM(total_cost), 0) AS total_cost, COALESCE(SUM(quantity), 0) AS quantity, COUNT(*) AS events
      FROM stock_breakage_loss
      WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
    `).get(fromD, toD);
    return {
      from: fromD,
      to: toD,
      total_cost: roundMoney(tot?.total_cost),
      quantity: roundMoney(tot?.quantity),
      events: Number(tot?.events) || 0,
      by_reason: aggregateByField(rows, "reason"),
      by_operator: aggregateByOperator(rows),
      rows,
    };
  }

  function aggregateByField(rows, field) {
    const map = new Map();
    for (const r of rows || []) {
      const key = String(r[field] || "").trim() || "tjeter";
      const prev = map.get(key) || { key, label: reasonLabel(key), total_cost: 0, quantity: 0, events: 0 };
      prev.total_cost += Number(r.total_cost) || 0;
      prev.quantity += Number(r.quantity) || 0;
      prev.events += Number(r.events) || 0;
      map.set(key, prev);
    }
    return [...map.values()].map((x) => ({
      ...x,
      total_cost: roundMoney(x.total_cost),
      quantity: roundMoney(x.quantity),
    }));
  }

  function aggregateByOperator(rows) {
    const map = new Map();
    for (const r of rows || []) {
      const key = String(r.operator_name || "").trim() || "—";
      const prev = map.get(key) || { operator_name: key, total_cost: 0, quantity: 0, events: 0 };
      prev.total_cost += Number(r.total_cost) || 0;
      prev.quantity += Number(r.quantity) || 0;
      prev.events += Number(r.events) || 0;
      map.set(key, prev);
    }
    return [...map.values()].map((x) => ({
      ...x,
      total_cost: roundMoney(x.total_cost),
      quantity: roundMoney(x.quantity),
    }));
  }

  function upsertLocalInventoryItem({ id, name, quantity, unit_cost, active = true }) {
    const n = String(name || "").trim();
    if (!n) throw new Error("Emri i artikullit mungon.");
    const qty = Math.max(0, Number(quantity) || 0);
    const cost = Math.max(0, Number(unit_cost) || 0);
    const act = active === false ? 0 : 1;
    const sid = Number(id);
    if (sid) {
      sqlite.prepare(`
        UPDATE hotel_local_inventory SET name = ?, quantity = ?, unit_cost = ?, active = ? WHERE id = ?
      `).run(n, qty, cost, act, sid);
      return { id: sid, name: n, quantity: qty, unit_cost: cost, active: !!act };
    }
    const r = sqlite.prepare(`
      INSERT INTO hotel_local_inventory (name, quantity, unit_cost, active) VALUES (?, ?, ?, ?)
    `).run(n, qty, cost, act);
    return { id: Number(r.lastInsertRowid), name: n, quantity: qty, unit_cost: cost, active: !!act };
  }

  return {
    STOCK_BREAKAGE_REASONS,
    REASON_LABELS,
    reasonLabel,
    listPickableMenuItems,
    listLocalInventoryItems,
    registerStockBreakageLoss,
    listStockBreakageLoss,
    summarizeStockBreakageLoss,
    upsertLocalInventoryItem,
  };
}

module.exports = {
  STOCK_BREAKAGE_REASONS,
  REASON_LABELS,
  createStockBreakageLossApi,
};
