"use strict";

const INGREDIENT_UNITS = Object.freeze(["kg", "l", "copë"]);

function roundQty(n) {
  return Math.round(Number(n) * 1000000) / 1000000;
}

function roundMoney4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function roundMoney2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function normalizeUnit(raw) {
  const u = String(raw || "copë").trim().toLowerCase();
  if (u === "cope" || u === "copë" || u === "piece" || u === "pcs") return "copë";
  if (u === "kg" || u === "kilogram") return "kg";
  if (u === "l" || u === "liter" || u === "litër") return "l";
  return INGREDIENT_UNITS.includes(u) ? u : "copë";
}

function createIngredientsRecipesApi(db) {
  const sqlite = db.db;

  function listIngredients(activeOnly = false) {
    const rows = sqlite.prepare(`
      SELECT id, name, unit, stock_qty, avg_cost_per_unit, min_stock_qty, active,
             created_at, updated_at
      FROM ingredients
      ${activeOnly ? "WHERE active = 1" : ""}
      ORDER BY name COLLATE NOCASE ASC
    `).all();
    return rows.map(enrichIngredientRow);
  }

  function enrichIngredientRow(row) {
    if (!row) return null;
    const stock = Number(row.stock_qty) || 0;
    const min = Number(row.min_stock_qty) || 0;
    return {
      ...row,
      stock_qty: roundQty(stock),
      avg_cost_per_unit: roundMoney4(row.avg_cost_per_unit),
      min_stock_qty: roundQty(min),
      low_stock: stock <= min,
      negative_stock: stock < 0,
    };
  }

  function getIngredient(id) {
    const row = sqlite.prepare("SELECT * FROM ingredients WHERE id = ?").get(Number(id));
    return enrichIngredientRow(row);
  }

  function findIngredientByName(name) {
    const n = String(name || "").trim();
    if (!n) return null;
    const row = sqlite
      .prepare("SELECT * FROM ingredients WHERE lower(trim(name)) = lower(?) LIMIT 1")
      .get(n);
    return enrichIngredientRow(row);
  }

  function createIngredient({ name, unit, stock_qty, avg_cost_per_unit, min_stock_qty, active }) {
    const nm = String(name || "").trim();
    if (!nm) throw new Error("Emri i përbërësit mungon");
    if (findIngredientByName(nm)) throw new Error(`Përbërësi «${nm}» ekziston`);
    const u = normalizeUnit(unit);
    const stock = roundQty(stock_qty ?? 0);
    const avg = roundMoney4(Math.max(0, Number(avg_cost_per_unit) || 0));
    const min = roundQty(Math.max(0, Number(min_stock_qty) || 0));
    const act = active === false || active === 0 ? 0 : 1;
    const r = sqlite.prepare(`
      INSERT INTO ingredients (name, unit, stock_qty, avg_cost_per_unit, min_stock_qty, active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(nm, u, stock, avg, min, act);
    return getIngredient(r.lastInsertRowid);
  }

  function updateIngredient(id, patch = {}) {
    const row = getIngredient(id);
    if (!row) throw new Error("Përbërësi nuk u gjet");
    const nm = patch.name != null ? String(patch.name).trim() : row.name;
    if (!nm) throw new Error("Emri i përbërësit mungon");
    if (patch.name != null) {
      const dup = sqlite
        .prepare(
          "SELECT id FROM ingredients WHERE lower(trim(name)) = lower(?) AND id <> ? LIMIT 1",
        )
        .get(nm, row.id);
      if (dup) throw new Error(`Emri «${nm}» përdoret nga përbërës tjetër`);
    }
    const u = patch.unit != null ? normalizeUnit(patch.unit) : row.unit;
    const stock =
      patch.stock_qty != null ? roundQty(patch.stock_qty) : Number(row.stock_qty) || 0;
    const avg =
      patch.avg_cost_per_unit != null
        ? roundMoney4(Math.max(0, Number(patch.avg_cost_per_unit) || 0))
        : Number(row.avg_cost_per_unit) || 0;
    const min =
      patch.min_stock_qty != null
        ? roundQty(Math.max(0, Number(patch.min_stock_qty) || 0))
        : Number(row.min_stock_qty) || 0;
    const act =
      patch.active === false || patch.active === 0
        ? 0
        : patch.active === true || patch.active === 1
          ? 1
          : row.active ? 1 : 0;
    sqlite.prepare(`
      UPDATE ingredients
      SET name = ?, unit = ?, stock_qty = ?, avg_cost_per_unit = ?, min_stock_qty = ?, active = ?,
          updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(nm, u, stock, avg, min, act, row.id);
    return getIngredient(row.id);
  }

  function deleteIngredient(id) {
    const pid = Number(id);
    const row = getIngredient(pid);
    if (!row) throw new Error("Përbërësi nuk u gjet");
    const used = sqlite
      .prepare("SELECT 1 FROM menu_recipe_lines WHERE ingredient_id = ? LIMIT 1")
      .get(pid);
    if (used) {
      throw new Error(
        "Nuk mund ta fshish «" + row.name + "»: përdoret në receta. Hiqe nga recetat së pari.",
      );
    }
    let hasPurchase = false;
    try {
      hasPurchase = !!sqlite
        .prepare("SELECT 1 FROM purchase_invoice_items WHERE ingredient_id = ? LIMIT 1")
        .get(pid);
    } catch {
      /* kolona mund të mungojë në DB shumë të vjetër */
    }
    if (hasPurchase) {
      throw new Error(
        "Nuk mund ta fshish «" + row.name + "»: ka blerje të regjistruara (Blerjet).",
      );
    }
    const stock = Number(row.stock_qty) || 0;
    if (Math.abs(stock) > 0.000001) {
      throw new Error(
        "Nuk mund ta fshish «" + row.name + "»: stoku nuk është zero ("
          + roundQty(stock) + " " + row.unit + ").",
      );
    }
    sqlite.prepare("DELETE FROM ingredients WHERE id = ?").run(pid);
    return { id: pid, name: row.name };
  }

  function listRecipeLinesForMenuItem(menuItemId) {
    const mid = Number(menuItemId);
    if (!mid) return [];
    return sqlite.prepare(`
      SELECT mrl.id, mrl.menu_item_id, mrl.ingredient_id, mrl.quantity_used,
             i.name AS ingredient_name, i.unit AS ingredient_unit,
             i.stock_qty, i.avg_cost_per_unit, i.min_stock_qty
      FROM menu_recipe_lines mrl
      INNER JOIN ingredients i ON i.id = mrl.ingredient_id
      WHERE mrl.menu_item_id = ?
      ORDER BY i.name COLLATE NOCASE ASC
    `).all(mid);
  }

  function menuItemHasRecipe(menuItemId) {
    const mid = Number(menuItemId);
    if (!mid) return false;
    const row = sqlite
      .prepare("SELECT 1 AS n FROM menu_recipe_lines WHERE menu_item_id = ? LIMIT 1")
      .get(mid);
    return !!row;
  }

  function setMenuItemRecipe(menuItemId, lines) {
    const mid = Number(menuItemId);
    const menu = typeof db.getMenuItemById === "function" ? db.getMenuItemById(mid) : null;
    if (!menu) throw new Error("Artikulli i menusë nuk u gjet");
    const list = Array.isArray(lines) ? lines : [];
    const normalized = [];
    const seen = new Set();
    for (const raw of list) {
      const iid = Number(raw.ingredient_id);
      const q = Number(raw.quantity_used);
      if (!iid || !(q > 0)) continue;
      if (seen.has(iid)) throw new Error("Përbërësi i dyfishuar në recetë");
      seen.add(iid);
      const ing = getIngredient(iid);
      if (!ing) throw new Error("Përbërësi nuk u gjet");
      normalized.push({ ingredient_id: iid, quantity_used: roundQty(q) });
    }
    sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM menu_recipe_lines WHERE menu_item_id = ?").run(mid);
      const ins = sqlite.prepare(`
        INSERT INTO menu_recipe_lines (menu_item_id, ingredient_id, quantity_used)
        VALUES (?, ?, ?)
      `);
      for (const ln of normalized) {
        ins.run(mid, ln.ingredient_id, ln.quantity_used);
      }
    })();
    return getMenuItemRecipeBundle(mid);
  }

  function computeRecipePortionCost(menuItemId) {
    const lines = listRecipeLinesForMenuItem(menuItemId);
    if (!lines.length) return null;
    let cost = 0;
    for (const ln of lines) {
      cost += Number(ln.quantity_used) * (Number(ln.avg_cost_per_unit) || 0);
    }
    return roundMoney4(cost);
  }

  function getMenuItemRecipeBundle(menuItemId) {
    const mid = Number(menuItemId);
    const menu =
      typeof db.getMenuItemById === "function" ? db.getMenuItemById(mid) : null;
    const lines = listRecipeLinesForMenuItem(mid).map((ln) => ({
      id: ln.id,
      ingredient_id: ln.ingredient_id,
      ingredient_name: ln.ingredient_name,
      ingredient_unit: ln.ingredient_unit,
      quantity_used: roundQty(ln.quantity_used),
      line_cost: roundMoney4(Number(ln.quantity_used) * (Number(ln.avg_cost_per_unit) || 0)),
    }));
    const sellPrice = Number(menu?.price) || 0;
    const portion_cost = lines.length ? computeRecipePortionCost(mid) : null;
    let portions_available = null;
    if (lines.length) {
      portions_available = Infinity;
      for (const ln of listRecipeLinesForMenuItem(mid)) {
        const need = Number(ln.quantity_used);
        if (!(need > 0)) continue;
        const have = Number(ln.stock_qty) || 0;
        portions_available = Math.min(portions_available, Math.floor(have / need));
      }
      if (!Number.isFinite(portions_available)) portions_available = 0;
    }
    const profit_per_portion =
      portion_cost != null ? roundMoney2(sellPrice - portion_cost) : null;
    return {
      menu_item_id: mid,
      has_recipe: lines.length > 0,
      lines,
      sell_price: roundMoney2(sellPrice),
      portion_cost: portion_cost != null ? roundMoney2(portion_cost) : null,
      profit_per_portion,
      portions_available:
        portions_available != null ? Math.max(0, portions_available) : null,
    };
  }

  function changeIngredientStock(ingredientId, delta, context) {
    const id = Number(ingredientId);
    const d = roundQty(delta);
    if (!id || !Number.isFinite(d) || d === 0) return null;
    const row = sqlite.prepare("SELECT * FROM ingredients WHERE id = ?").get(id);
    if (!row) throw new Error("Përbërësi nuk u gjet");
    const before = Number(row.stock_qty) || 0;
    const after = roundQty(before + d);
    sqlite.prepare(`
      UPDATE ingredients SET stock_qty = ?, updated_at = datetime('now','localtime') WHERE id = ?
    `).run(after, id);
    const min = Number(row.min_stock_qty) || 0;
    const tag = context || "adjust";
    console.log(
      `[ingredient-stock] ${tag} id=${id} name=${row.name} delta=${d} before=${before} after=${after}`,
    );
    if (after < 0) {
      console.warn(`[ingredient-stock] ALERT negative stok «${row.name}» (${after} ${row.unit})`);
    } else if (after <= min) {
      console.warn(
        `[ingredient-stock] ALERT low «${row.name}» (${after} ${row.unit}, min ${min})`,
      );
    }
    return { id, name: row.name, stock_before: before, stock_after: after, unit: row.unit };
  }

  function applyIngredientPurchaseDelta(ingredientId, qty, unitPrice) {
    const id = Number(ingredientId);
    const q = roundQty(qty);
    if (!id || !Number.isFinite(q) || q === 0) {
      throw new Error("Përbërës ose sasi e pavlefshme për blerje");
    }
    const row = sqlite.prepare("SELECT * FROM ingredients WHERE id = ?").get(id);
    if (!row) throw new Error("Përbërësi nuk u gjet");
    const price = roundMoney4(Math.max(0, Number(unitPrice) || 0));
    const oldStock = Number(row.stock_qty) || 0;
    const oldAvg = Number(row.avg_cost_per_unit) || 0;
    const newStock = roundQty(oldStock + q);
    let newAvg = oldAvg;
    if (q > 0) {
      if (newStock > 0) {
        newAvg = roundMoney4((oldStock * oldAvg + q * price) / newStock);
      } else {
        newAvg = price;
      }
    }
    sqlite.prepare(`
      UPDATE ingredients
      SET stock_qty = ?, avg_cost_per_unit = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(newStock, newAvg, id);
    console.log(
      `[ingredient-stock] purchase id=${id} qty=${q} unit_price=${price} stock ${oldStock}->${newStock} avg ${oldAvg}->${newAvg}`,
    );
    return getIngredient(id);
  }

  function applySaleStockMovement(items, mode) {
    const list = items || [];
    if (!list.length) return { moved: [] };
    const menu = typeof db.getMenuItems === "function" ? db.getMenuItems(false) : [];
    const byId = new Map(menu.map((m) => [Number(m.id), m]));
    const byName = new Map(menu.map((m) => [String(m.name || "").trim().toLowerCase(), m]));
    const resolve =
      typeof db.resolveMenuItemIdForStock === "function"
        ? db.resolveMenuItemIdForStock.bind(db)
        : null;
    const moved = [];
    for (const it of list) {
      const menuItemId = resolve ? resolve(it, byId, byName) : null;
      const qty = Number(it?.quantity ?? it?.qty ?? it?.sasia) || 0;
      if (!menuItemId || !(qty > 0)) continue;
      if (menuItemHasRecipe(menuItemId)) {
        const lines = listRecipeLinesForMenuItem(menuItemId);
        const sign = mode === "restore" ? 1 : -1;
        for (const ln of lines) {
          const used = roundQty(Number(ln.quantity_used) * qty);
          if (!(used > 0)) continue;
          const r = changeIngredientStock(ln.ingredient_id, sign * used, mode);
          if (r) moved.push({ type: "ingredient", ...r, menu_item_id: menuItemId, sold_qty: qty });
        }
      } else if (mode === "restore") {
        if (typeof db.increaseMenuItemStock === "function") {
          db.increaseMenuItemStock(menuItemId, qty);
          moved.push({ type: "menu", menu_item_id: menuItemId, qty });
        }
      } else if (typeof db._decrementMenuItemStockNoRecipe === "function") {
        db._decrementMenuItemStockNoRecipe([it], byId, byName);
        moved.push({ type: "menu", menu_item_id: menuItemId, qty });
      }
    }
    return { moved };
  }

  function listLowStockIngredients() {
    return listIngredients(true).filter((i) => i.low_stock || i.negative_stock);
  }

  function deleteMenuItemRecipeLines(menuItemId) {
    sqlite.prepare("DELETE FROM menu_recipe_lines WHERE menu_item_id = ?").run(Number(menuItemId));
  }

  return {
    INGREDIENT_UNITS,
    normalizeUnit,
    listIngredients,
    getIngredient,
    findIngredientByName,
    createIngredient,
    updateIngredient,
    deleteIngredient,
    listRecipeLinesForMenuItem,
    menuItemHasRecipe,
    setMenuItemRecipe,
    getMenuItemRecipeBundle,
    computeRecipePortionCost,
    applyIngredientPurchaseDelta,
    changeIngredientStock,
    applySaleStockMovement,
    listLowStockIngredients,
    deleteMenuItemRecipeLines,
  };
}

module.exports = { createIngredientsRecipesApi, INGREDIENT_UNITS, normalizeUnit };
