"use strict";

const { businessYmd, addBusinessDays } = require("./lib/hotel-business-date");

function roundQty(n) {
  return Math.round(Number(n) * 1000000) / 1000000;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parseOrderItems(json) {
  try {
    const p = typeof json === "string" ? JSON.parse(json || "[]") : json;
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function createIngredientStockCountApi(db) {
  const sqlite = db.db;

  function listCountTargets() {
    const ingredients =
      typeof db.listIngredients === "function" ? db.listIngredients(true) : [];
    const menu = typeof db.getMenuItems === "function" ? db.getMenuItems(false) : [];
    const hasRecipe =
      typeof db.getMenuItemRecipeBundle === "function"
        ? (id) => db.getMenuItemRecipeBundle(id).has_recipe
        : () => false;

    const ingRows = ingredients.map((i) => ({
      target_type: "ingredient",
      target_id: Number(i.id),
      name: i.name,
      unit: i.unit,
      system_qty: roundQty(i.stock_qty),
      avg_cost_per_unit: roundMoney(i.avg_cost_per_unit),
    }));

    const menuRows = [];
    for (const m of menu) {
      if (!m.active && m.active !== 1) continue;
      if (hasRecipe(m.id)) continue;
      menuRows.push({
        target_type: "menu",
        target_id: Number(m.id),
        name: m.name,
        unit: "copë",
        system_qty: roundQty(m.stock_qty),
        avg_cost_per_unit:
          typeof db.getMenuItemCostForCogs === "function"
            ? roundMoney(db.getMenuItemCostForCogs(m.id))
            : 0,
      });
    }
    return [...ingRows, ...menuRows].sort((a, b) =>
      a.name.localeCompare(b.name, "sq"),
    );
  }

  function getLastCountLineBefore(targetType, targetId, beforeDate) {
    return sqlite
      .prepare(
        `
      SELECT scl.*, s.counted_at
      FROM stock_count_lines scl
      INNER JOIN stock_count_sessions s ON s.id = scl.session_id
      WHERE scl.target_type = ? AND scl.target_id = ?
        AND date(s.counted_at) < date(?)
      ORDER BY s.counted_at DESC, scl.id DESC
      LIMIT 1
    `,
      )
      .get(String(targetType), Number(targetId), String(beforeDate).slice(0, 10));
  }

  function getOpeningQty(targetType, targetId, fromDate) {
    const prev = getLastCountLineBefore(targetType, targetId, fromDate);
    if (prev) return roundQty(prev.counted_qty);
    if (targetType === "ingredient") {
      const ing =
        typeof db.getIngredient === "function" ? db.getIngredient(targetId) : null;
      return roundQty(ing?.stock_qty ?? 0);
    }
    const row = sqlite
      .prepare("SELECT COALESCE(stock_qty,0) AS q FROM menu_items WHERE id = ?")
      .get(Number(targetId));
    return roundQty(row?.q ?? 0);
  }

  function getClosingQty(targetType, targetId, toDate) {
    const row = sqlite
      .prepare(
        `
      SELECT scl.counted_qty, s.counted_at
      FROM stock_count_lines scl
      INNER JOIN stock_count_sessions s ON s.id = scl.session_id
      WHERE scl.target_type = ? AND scl.target_id = ?
        AND date(s.counted_at) <= date(?)
      ORDER BY s.counted_at DESC, scl.id DESC
      LIMIT 1
    `,
      )
      .get(String(targetType), Number(targetId), String(toDate).slice(0, 10));
    if (row) return roundQty(row.counted_qty);
    if (targetType === "ingredient") {
      const ing =
        typeof db.getIngredient === "function" ? db.getIngredient(targetId) : null;
      return roundQty(ing?.stock_qty ?? 0);
    }
    const m = sqlite
      .prepare("SELECT COALESCE(stock_qty,0) AS q FROM menu_items WHERE id = ?")
      .get(Number(targetId));
    return roundQty(m?.q ?? 0);
  }

  function sumIngredientPurchases(ingredientId, from, to) {
    const rows = sqlite
      .prepare(
        `
      SELECT COALESCE(SUM(pii.quantity), 0) AS q
      FROM purchase_invoice_items pii
      INNER JOIN purchase_invoices pi ON pi.id = pii.invoice_id
      WHERE pii.ingredient_id = ?
        AND COALESCE(pi.purchase_kind, 'goods') = 'goods'
        AND date(pi.invoice_date) >= date(?)
        AND date(pi.invoice_date) <= date(?)
    `,
      )
      .all(Number(ingredientId), from, to);
    return roundQty(rows[0]?.q ?? 0);
  }

  function sumIngredientBreakage(ingredientId, from, to) {
    try {
      const row = sqlite
        .prepare(
          `
        SELECT COALESCE(SUM(quantity), 0) AS q
        FROM stock_breakage_loss
        WHERE source_type = 'ingredient' AND source_id = ?
          AND date(created_at) >= date(?) AND date(created_at) <= date(?)
      `,
        )
        .get(Number(ingredientId), from, to);
      return roundQty(row?.q ?? 0);
    } catch {
      return 0;
    }
  }

  function aggregateExpectedIngredientUsage(from, to) {
    const menu = typeof db.getMenuItems === "function" ? db.getMenuItems(false) : [];
    const byId = new Map(menu.map((m) => [Number(m.id), m]));
    const byName = new Map(
      menu.map((m) => [String(m.name || "").trim().toLowerCase(), m]),
    );
    const resolve =
      typeof db.resolveMenuItemIdForStock === "function"
        ? db.resolveMenuItemIdForStock.bind(db)
        : null;
    const usage = new Map();

    const entries = sqlite
      .prepare(
        `
      SELECT items_json FROM daily_log
      WHERE status = 'completed'
        AND date(date) >= date(?) AND date(date) <= date(?)
        AND NOT (
          UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'CO-%'
          OR UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'RC-%'
          OR UPPER(TRIM(COALESCE(receipt_number, ''))) LIKE 'SVC-%'
        )
    `,
      )
      .all(from, to);

    for (const e of entries) {
      for (const it of parseOrderItems(e.items_json)) {
        const menuItemId = resolve ? resolve(it, byId, byName) : null;
        const qty = Number(it.quantity) || 1;
        if (!menuItemId || !(qty > 0)) continue;
        const lines =
          typeof db.listRecipeLinesForMenuItem === "function"
            ? db.listRecipeLinesForMenuItem(menuItemId)
            : [];
        for (const ln of lines) {
          const iid = Number(ln.ingredient_id);
          const used = roundQty(Number(ln.quantity_used) * qty);
          if (!iid || !(used > 0)) continue;
          usage.set(iid, roundQty((usage.get(iid) || 0) + used));
        }
      }
    }
    return usage;
  }

  function submitStockCount({ lines, operator_name, operator_role, note } = {}) {
    const list = Array.isArray(lines) ? lines : [];
    if (!list.length) throw new Error("Shtoni të paktën një rresht numërimi.");

    const opName = String(operator_name || "Staf").trim().slice(0, 120);
    const opRole = String(operator_role || "").trim().slice(0, 40);
    const noteTxt = String(note || "").trim().slice(0, 500);

    return sqlite.transaction(() => {
      const insS = sqlite.prepare(`
        INSERT INTO stock_count_sessions (operator_name, operator_role, note, status)
        VALUES (?, ?, ?, 'completed')
      `);
      const sid = insS.run(opName, opRole, noteTxt).lastInsertRowid;

      const insL = sqlite.prepare(`
        INSERT INTO stock_count_lines (
          session_id, target_type, target_id, name, unit,
          system_qty, counted_qty, diff_qty, unit_cost, diff_value
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const outLines = [];
      for (const raw of list) {
        const targetType =
          raw.target_type === "menu" || raw.target_type === "ingredient"
            ? raw.target_type
            : raw.ingredient_id
              ? "ingredient"
              : "menu";
        const targetId = Number(
          raw.target_id ?? raw.ingredient_id ?? raw.menu_item_id,
        );
        const counted = roundQty(raw.counted_qty ?? raw.quantity_counted);
        if (!targetId || !Number.isFinite(counted)) continue;

        let name = String(raw.name || "").trim();
        let unit = String(raw.unit || "").trim();
        let systemQty = 0;
        let unitCost = 0;

        if (targetType === "ingredient") {
          const ing =
            typeof db.getIngredient === "function" ? db.getIngredient(targetId) : null;
          if (!ing) throw new Error(`Përbërësi #${targetId} nuk u gjet`);
          name = name || ing.name;
          unit = unit || ing.unit;
          systemQty = roundQty(ing.stock_qty);
          unitCost = roundMoney(ing.avg_cost_per_unit);
          const diff = roundQty(counted - systemQty);
          if (Math.abs(diff) > 0.000001) {
            if (typeof db.updateIngredient === "function") {
              db.updateIngredient(targetId, { stock_qty: counted });
            }
          }
        } else {
          const row = sqlite
            .prepare(
              "SELECT id, name, COALESCE(stock_qty,0) AS stock_qty FROM menu_items WHERE id = ?",
            )
            .get(targetId);
          if (!row) throw new Error(`Produkti #${targetId} nuk u gjet`);
          if (
            typeof db.getMenuItemRecipeBundle === "function" &&
            db.getMenuItemRecipeBundle(targetId).has_recipe
          ) {
            throw new Error(`«${row.name}» ka recetë — numëroni përbërësit, jo artikullin.`);
          }
          name = name || row.name;
          unit = unit || "copë";
          systemQty = roundQty(row.stock_qty);
          unitCost =
            typeof db.getMenuItemCostForCogs === "function"
              ? roundMoney(db.getMenuItemCostForCogs(targetId))
              : 0;
          const diff = roundQty(counted - systemQty);
          if (Math.abs(diff) > 0.000001 && typeof db.setMenuItemStockAbsolute === "function") {
            db.setMenuItemStockAbsolute(
              targetId,
              counted,
              `Numërim stoku${noteTxt ? `: ${noteTxt}` : ""}`,
              opName,
            );
          }
        }

        const diffQty = roundQty(counted - systemQty);
        const diffValue = roundMoney(diffQty * unitCost);
        insL.run(
          sid,
          targetType,
          targetId,
          name,
          unit,
          systemQty,
          counted,
          diffQty,
          unitCost,
          diffValue,
        );
        outLines.push({
          target_type: targetType,
          target_id: targetId,
          name,
          unit,
          system_qty: systemQty,
          counted_qty: counted,
          diff_qty: diffQty,
          unit_cost: unitCost,
          diff_value: diffValue,
        });
      }

      if (!outLines.length) throw new Error("Asnjë rresht i vlefshëm numërimi.");

      const session = sqlite
        .prepare("SELECT * FROM stock_count_sessions WHERE id = ?")
        .get(sid);

      try {
        const ownerReportSync = require("./owner-report-sync");
        const day = businessYmd();
        ownerReportSync.queueOwnerReportDates(db, [day]);
        ownerReportSync.runOwnerReportSync(db).catch(() => {});
      } catch {
        /* tests */
      }

      return { session, lines: outLines };
    })();
  }

  function getLatestStockCountSummary() {
    const session = sqlite
      .prepare(
        `
      SELECT * FROM stock_count_sessions
      ORDER BY counted_at DESC, id DESC LIMIT 1
    `,
      )
      .get();
    if (!session) return null;
    const lines = sqlite
      .prepare(
        `
      SELECT * FROM stock_count_lines WHERE session_id = ? ORDER BY name COLLATE NOCASE
    `,
      )
      .all(session.id);
    return {
      session_id: session.id,
      counted_at: session.counted_at,
      operator_name: session.operator_name,
      operator_role: session.operator_role,
      note: session.note,
      lines: lines.map((l) => ({
        target_type: l.target_type,
        target_id: l.target_id,
        name: l.name,
        unit: l.unit,
        system_qty: roundQty(l.system_qty),
        counted_qty: roundQty(l.counted_qty),
        diff_qty: roundQty(l.diff_qty),
        unit_cost: roundMoney(l.unit_cost),
        diff_value: roundMoney(l.diff_value),
      })),
    };
  }

  function buildConsumptionVarianceReport({ from, to } = {}) {
    const today = businessYmd();
    const fromD = String(from || addBusinessDays(today, -6)).slice(0, 10);
    const toD = String(to || today).slice(0, 10);
    const expectedMap = aggregateExpectedIngredientUsage(fromD, toD);
    const ingredients =
      typeof db.listIngredients === "function" ? db.listIngredients() : [];

    const rows = [];
    for (const ing of ingredients) {
      const iid = Number(ing.id);
      const opening = getOpeningQty("ingredient", iid, fromD);
      const closing = getClosingQty("ingredient", iid, toD);
      const purchases = sumIngredientPurchases(iid, fromD, toD);
      const breakage = sumIngredientBreakage(iid, fromD, toD);
      const actual_used = roundQty(opening + purchases - closing - breakage);
      const expected_used = roundQty(expectedMap.get(iid) || 0);
      const variance_qty = roundQty(actual_used - expected_used);
      const unitCost = roundMoney(ing.avg_cost_per_unit);
      const variance_value = roundMoney(variance_qty * unitCost);
      const variance_pct =
        expected_used > 0.0001
          ? roundMoney((variance_qty / expected_used) * 100)
          : actual_used > 0.0001
            ? 100
            : 0;
      rows.push({
        ingredient_id: iid,
        name: ing.name,
        unit: ing.unit,
        period_from: fromD,
        period_to: toD,
        opening_qty: opening,
        purchases_qty: purchases,
        closing_qty: closing,
        breakage_qty: breakage,
        actual_used_qty: actual_used,
        expected_used_qty: expected_used,
        variance_qty,
        variance_value,
        variance_pct,
        avg_cost_per_unit: unitCost,
      });
    }
    rows.sort(
      (a, b) =>
        Math.abs(b.variance_value) - Math.abs(a.variance_value) ||
        Math.abs(b.variance_qty) - Math.abs(a.variance_qty),
    );
    return { from: fromD, to: toD, items: rows };
  }

  function buildIngredientsSnapshot(dbRef, reportDate) {
    const date = String(reportDate || businessYmd()).slice(0, 10);
    const ingredients =
      typeof dbRef.listIngredients === "function" ? dbRef.listIngredients() : [];
    const weekVar = buildConsumptionVarianceReport({
      from: addBusinessDays(date, -6),
      to: date,
    });
    const lastCount = getLatestStockCountSummary();
    const menuRecipes = [];
    const menu = typeof dbRef.getMenuItems === "function" ? dbRef.getMenuItems(false) : [];
    for (const m of menu) {
      if (!m.active && m.active !== 1) continue;
      const bundle =
        typeof dbRef.getMenuItemRecipeBundle === "function"
          ? dbRef.getMenuItemRecipeBundle(m.id)
          : null;
      if (!bundle?.has_recipe) continue;
      menuRecipes.push({
        menu_item_id: m.id,
        name: m.name,
        sell_price: bundle.sell_price,
        portion_cost: bundle.portion_cost,
        profit_per_portion: bundle.profit_per_portion,
        portions_available: bundle.portions_available,
        lines: (bundle.lines || []).map((l) => ({
          ingredient_id: l.ingredient_id,
          ingredient_name: l.ingredient_name,
          quantity_used: l.quantity_used,
          unit: l.ingredient_unit,
        })),
      });
    }

    const ingredientRows = ingredients.map((ing) => {
      const bundleLines = menuRecipes.flatMap((r) =>
        (r.lines || [])
          .filter((l) => Number(l.ingredient_id) === Number(ing.id))
          .map((l) => ({ menu_name: r.name, qty: l.quantity_used })),
      );
      let portions = null;
      if (typeof dbRef.getMenuItemRecipeBundle === "function") {
        for (const r of menuRecipes) {
          const line = (r.lines || []).find(
            (l) => Number(l.ingredient_id) === Number(ing.id),
          );
          if (line && Number(line.quantity_used) > 0) {
            const p = Math.floor(Number(ing.stock_qty) / Number(line.quantity_used));
            portions = portions == null ? p : Math.min(portions, p);
          }
        }
      }
      return {
        id: ing.id,
        name: ing.name,
        unit: ing.unit,
        stock_qty: roundQty(ing.stock_qty),
        avg_cost_per_unit: roundMoney(ing.avg_cost_per_unit),
        min_stock_qty: roundQty(ing.min_stock_qty),
        below_minimum: ing.low_stock || ing.below_minimum,
        negative_stock: ing.negative_stock,
        portions_available: portions,
        used_in_recipes: bundleLines.slice(0, 8),
      };
    });

    let weak_profit_items = [];
    try {
      const { buildSalesByItemForDay } = require("./owner-report-analytics");
      weak_profit_items = (buildSalesByItemForDay(dbRef, date) || [])
        .filter((r) => r.quantity_sold > 0 && r.gross_profit_pct < 15)
        .slice(0, 10)
        .map((r) => ({
          name: r.name,
          quantity_sold: r.quantity_sold,
          gross_profit_pct: r.gross_profit_pct,
          gross_profit: r.gross_profit,
        }));
    } catch {
      weak_profit_items = [];
    }

    return {
      ingredients: ingredientRows,
      menu_recipes: menuRecipes,
      consumption_variance_week: weekVar,
      last_stock_count: lastCount,
      weak_profit_items,
    };
  }

  return {
    listCountTargets,
    submitStockCount,
    getLatestStockCountSummary,
    buildConsumptionVarianceReport,
    buildIngredientsSnapshot,
    aggregateExpectedIngredientUsage,
  };
}

module.exports = { createIngredientStockCountApi };
