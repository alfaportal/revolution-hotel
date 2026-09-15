const { getSupabase } = require("../db");
const { matchMenuItemForOrder } = require("./stockService");
const { ensureInventorySchema } = require("../lib/ensureInventorySchema");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_UNITS = new Set(["kg", "l", "copë"]);

function roundQty(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function mapIngredient(row) {
  const quantity = roundQty(row.quantity);
  const min_quantity = roundQty(row.min_quantity);
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    name: String(row.name || "").trim(),
    unit: row.unit,
    quantity,
    min_quantity,
    cost_per_unit: roundQty(row.cost_per_unit),
    last_supplier: String(row.last_supplier || "").trim(),
    last_supplier_email: String(row.last_supplier_email || "").trim(),
    created_at: row.created_at,
    below_minimum: quantity < min_quantity,
    at_or_below_minimum: quantity <= min_quantity,
  };
}

function validateUnit(unit) {
  const u = String(unit || "").trim();
  if (!VALID_UNITS.has(u)) {
    throw new Error("Njësia duhet të jetë kg, l ose copë.");
  }
  return u;
}

function normalizeScanUnit(unit) {
  const u = String(unit || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (/^(kg|kilogram|kilogramë|kilo|g|gr|gram)$/.test(u)) return "kg";
  if (/^(l|lt|liter|litër|litra|ml)$/.test(u)) return "l";
  return "copë";
}

function normalizeIngredientName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function findIngredientByName(ingredients, name) {
  const target = normalizeIngredientName(name);
  if (!target) return null;
  const exact = ingredients.find(i => normalizeIngredientName(i.name) === target);
  if (exact) return exact;
  const tokens = target.split(/\s+/).filter(t => t.length >= 3);
  let best = null;
  let bestScore = 0;
  for (const i of ingredients) {
    const n = normalizeIngredientName(i.name);
    if (!n) continue;
    let score = 0;
    if (n.includes(target) || target.includes(n)) score = Math.min(n.length, target.length);
    const overlap = tokens.filter(t => n.includes(t));
    if (overlap.length) score = Math.max(score, overlap.join("").length + overlap.length * 3);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 4 ? best : null;
}

async function ensureInventoryReady() {
  await ensureInventorySchema();
}

function isMissingInventoryTableError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  if (code === "42p01") return true;
  if (msg.includes("does not exist") && msg.includes("ingredient")) return true;
  if (msg.includes("could not find the table") && msg.includes("ingredient")) return true;
  if (msg.includes("schema cache") && msg.includes("ingredient")) return true;
  return false;
}

async function withInventorySchema(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingInventoryTableError(err)) throw err;
    const ok = await ensureInventorySchema();
    if (!ok) {
      throw new Error(
        "Tabelat e inventarit mungojnë. Vendosni DATABASE_URL në Railway ose ekzekutoni supabase/migrations/025_inventory.sql në Supabase.",
      );
    }
    return fn();
  }
}

async function listIngredients(clientId) {
  await ensureInventoryReady();
  return withInventorySchema(async () => {
    const db = getSupabase();
    const { data, error } = await db
      .from("ingredients")
      .select("*")
      .eq("restaurant_id", clientId)
      .order("name");
    if (error) throw error;
    return (data || []).map(mapIngredient);
  });
}

async function listInventoryAlerts(clientId) {
  const items = await listIngredients(clientId);
  return items.filter(i => i.below_minimum);
}

async function createIngredient(clientId, body) {
  await ensureInventoryReady();
  return withInventorySchema(async () => {
    const name = String(body?.name || "").trim();
    if (!name) throw new Error("Emri i përbërësit është i detyrueshëm.");
    if (name.length > 120) throw new Error("Emri është shumë i gjatë.");

    const unit = validateUnit(body?.unit || "copë");
    const quantity = roundQty(Math.max(0, Number(body?.quantity) || 0));
    const min_quantity = roundQty(Math.max(0, Number(body?.min_quantity) || 0));
    const cost_per_unit = roundQty(Math.max(0, Number(body?.cost_per_unit) || 0));

    const db = getSupabase();
    const { data, error } = await db
      .from("ingredients")
      .insert({
        restaurant_id: clientId,
        name,
        unit,
        quantity,
        min_quantity,
        cost_per_unit,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapIngredient(data);
  });
}

async function updateIngredient(clientId, ingredientId, body) {
  await ensureInventoryReady();
  return withInventorySchema(async () => {
    const id = String(ingredientId || "").trim();
    if (!UUID_RE.test(id)) throw new Error("ID përbërësi nuk është i vlefshëm.");

    const db = getSupabase();
    const { data: existing, error: findErr } = await db
      .from("ingredients")
      .select("*")
      .eq("id", id)
      .eq("restaurant_id", clientId)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!existing) throw new Error("Përbërësi nuk u gjet.");

    const patch = {};
    if (body?.name != null) {
      const name = String(body.name).trim();
      if (!name) throw new Error("Emri nuk mund të jetë bosh.");
      patch.name = name.slice(0, 120);
    }
    if (body?.unit != null) patch.unit = validateUnit(body.unit);
    if (body?.min_quantity != null) {
      patch.min_quantity = roundQty(Math.max(0, Number(body.min_quantity) || 0));
    }
    if (body?.cost_per_unit != null) {
      patch.cost_per_unit = roundQty(Math.max(0, Number(body.cost_per_unit) || 0));
    }
    if (body?.quantity != null) {
      patch.quantity = roundQty(Math.max(0, Number(body.quantity) || 0));
    }
    if (body?.add_quantity != null) {
      const add = roundQty(Number(body.add_quantity) || 0);
      if (add <= 0) throw new Error("Sasia e furnizimit duhet të jetë pozitive.");
      patch.quantity = roundQty(Math.max(0, Number(existing.quantity) + add));
    }
    if (body?.last_supplier != null) {
      patch.last_supplier = String(body.last_supplier).trim().slice(0, 200) || null;
    }
    if (body?.last_supplier_email != null) {
      patch.last_supplier_email = String(body.last_supplier_email).trim().slice(0, 200) || null;
    }

    if (!Object.keys(patch).length) throw new Error("Nuk ka fusha për përditësim.");

    const { data, error } = await db
      .from("ingredients")
      .update(patch)
      .eq("id", id)
      .eq("restaurant_id", clientId)
      .select("*")
      .single();
    if (error) throw error;
    const mapped = mapIngredient(data);
    if (mapped.at_or_below_minimum && mapped.min_quantity > 0) {
      const { maybeNotifyIngredientLowStock } = require("./pushNotificationService");
      maybeNotifyIngredientLowStock(clientId, mapped).catch(err =>
        console.warn("[inventory] notify:", err.message),
      );
    }
    return mapped;
  });
}

async function deductIngredientsForOrder(clientId, orderItems) {
  const items = Array.isArray(orderItems) ? orderItems : [];
  if (!items.length) return { deducted: [] };

  await ensureInventoryReady();

  return withInventorySchema(async () => {
    const db = getSupabase();
    const { data: menuRows, error: menuErr } = await db
      .from("pos_menu_items")
      .select("id, local_id, name, price")
      .eq("client_id", clientId);
    if (menuErr) throw menuErr;
    if (!menuRows?.length) return { deducted: [] };

    const menuIds = new Set();
    const orderLines = [];
    for (const orderItem of items) {
      const row = matchMenuItemForOrder(menuRows, orderItem);
      if (!row) continue;
      const qty = Math.max(1, Number(orderItem.quantity) || 1);
      menuIds.add(row.id);
      orderLines.push({ menu_item_id: row.id, menu_name: row.name, order_qty: qty });
    }
    if (!menuIds.size) return { deducted: [] };

    const { data: recipes, error: recipeErr } = await db
      .from("menu_ingredients")
      .select("menu_item_id, ingredient_id, quantity_used")
      .in("menu_item_id", [...menuIds]);
    if (recipeErr) throw recipeErr;
    if (!recipes?.length) return { deducted: [] };

    const recipeByMenu = new Map();
    for (const r of recipes) {
      if (!recipeByMenu.has(r.menu_item_id)) recipeByMenu.set(r.menu_item_id, []);
      recipeByMenu.get(r.menu_item_id).push(r);
    }

    const deductMap = new Map();
    for (const line of orderLines) {
      const rows = recipeByMenu.get(line.menu_item_id) || [];
      for (const r of rows) {
        const used = roundQty(Number(r.quantity_used) * line.order_qty);
        if (used <= 0) continue;
        deductMap.set(r.ingredient_id, roundQty((deductMap.get(r.ingredient_id) || 0) + used));
      }
    }
    if (!deductMap.size) return { deducted: [] };

    const ingredientIds = [...deductMap.keys()];
    const { data: ingredients, error: ingErr } = await db
      .from("ingredients")
      .select("id, name, quantity, unit, min_quantity")
      .eq("restaurant_id", clientId)
      .in("id", ingredientIds);
    if (ingErr) throw ingErr;

    const deducted = [];
    for (const ing of ingredients || []) {
      const deductQty = deductMap.get(ing.id) || 0;
      if (deductQty <= 0) continue;
      const prev = roundQty(ing.quantity);
      const next = roundQty(Math.max(0, prev - deductQty));
      const { error: updErr } = await db
        .from("ingredients")
        .update({ quantity: next })
        .eq("id", ing.id)
        .eq("restaurant_id", clientId);
      if (updErr) {
        console.warn("[inventory] update failed:", updErr.message);
        continue;
      }
      deducted.push({
        id: ing.id,
        name: ing.name,
        unit: ing.unit,
        quantity: deductQty,
        remaining: next,
      });

      if (roundQty(next) <= roundQty(ing.min_quantity) && roundQty(ing.min_quantity) > 0) {
        const { maybeNotifyIngredientLowStock } = require("./pushNotificationService");
        maybeNotifyIngredientLowStock(clientId, {
          id: ing.id,
          name: ing.name,
          unit: ing.unit,
          quantity: next,
          min_quantity: ing.min_quantity,
        }).catch(err => console.warn("[inventory] notify:", err.message));
      }
    }

    return { deducted };
  }).catch((err) => {
    if (isMissingInventoryTableError(err)) {
      console.warn("[inventory] deduct skipped — tabelat mungojnë:", err.message);
      return { deducted: [] };
    }
    throw err;
  });
}

async function applyInvoiceScanItems(clientId, body) {
  const list = Array.isArray(body?.items) ? body.items : [];
  if (!list.length) throw new Error("Nuk ka artikuj për import.");

  const supplier = String(body?.supplier || "").trim();
  const supplierEmail = String(body?.supplier_email || body?.supplierEmail || "").trim();
  const invoice_number = String(body?.invoice_number || "").trim();
  const invoice_date = body?.invoice_date || null;

  // 1) Radhë për POS desktop — Stoku / Blerjet / Kontabilisti (burimi i vërtetë për kafene).
  let pos_queue = null;
  try {
    const { enqueuePendingPurchase } = require("./posPendingPurchaseService");
    pos_queue = await enqueuePendingPurchase(clientId, {
      supplier,
      invoice_number,
      invoice_date,
      items: list,
      supplier_nui: body?.supplier_nui,
      supplier_vat: body?.supplier_vat,
      vat_rate: body?.vat_rate,
      purchase_kind: body?.purchase_kind,
      source: String(body?.source || "ai_invoice_scan").slice(0, 64),
    });
  } catch (err) {
    console.warn("[inventory] pos pending purchase queue failed:", err.message);
    throw new Error(
      `Nuk u dërgua te POS: ${err.message}. Stoku / Blerjet / Kontabilisti nuk u përditësuan.`,
    );
  }

  // 2) Opsionale: përbërësit (inventory) — nuk duhet të bllokojë regjistrimin te POS.
  const applied = [];
  const created = [];
  const updated = [];
  try {
    await ensureInventoryReady();
    let ingredients = await listIngredients(clientId);

    for (const raw of list) {
      const name = String(raw?.name || "").trim();
      const quantity = roundQty(Math.max(0, Number(raw?.quantity) || 0));
      const unit = validateUnit(normalizeScanUnit(raw?.unit));
      const unit_price = roundQty(
        Math.max(0, Number(raw?.unit_price ?? raw?.price ?? raw?.cost_per_unit) || 0),
      );
      const createIfMissing = raw?.create_if_missing !== false;

      if (!name || quantity <= 0) continue;

      let ingredient = null;
      const ingredientId = String(raw?.ingredient_id || "").trim();
      if (UUID_RE.test(ingredientId)) {
        ingredient = ingredients.find(i => i.id === ingredientId) || null;
      }
      if (!ingredient) {
        ingredient = findIngredientByName(ingredients, name);
      }

      if (!ingredient && createIfMissing) {
        ingredient = await createIngredient(clientId, {
          name,
          unit,
          quantity,
          min_quantity: 0,
          cost_per_unit: unit_price,
        });
        ingredients.push(ingredient);
        created.push({ id: ingredient.id, name: ingredient.name, quantity, unit });
      } else if (ingredient) {
        const patch = { add_quantity: quantity };
        if (unit_price > 0) patch.cost_per_unit = unit_price;
        if (supplier) patch.last_supplier = supplier;
        if (supplierEmail) patch.last_supplier_email = supplierEmail;
        ingredient = await updateIngredient(clientId, ingredient.id, patch);
        const idx = ingredients.findIndex(i => i.id === ingredient.id);
        if (idx >= 0) ingredients[idx] = ingredient;
        updated.push({ id: ingredient.id, name: ingredient.name, quantity, unit });
      }

      if (ingredient) {
        applied.push({
          ingredient_id: ingredient.id,
          name: ingredient.name,
          quantity,
          unit,
          unit_price,
        });
      }
    }
  } catch (err) {
    console.warn("[inventory] ingredient apply (secondary) failed:", err.message);
  }

  const itemCount = Number(pos_queue?.item_count) || list.filter((r) => {
    const name = String(r?.name || "").trim();
    const quantity = Number(r?.quantity) || 0;
    return name && quantity > 0;
  }).length;

  return {
    supplier,
    supplier_email: supplierEmail,
    invoice_number,
    applied_count: applied.length || itemCount,
    created_count: created.length,
    updated_count: updated.length,
    applied,
    created,
    updated,
    pos_queue,
    pos_pending: !!pos_queue?.id,
  };
}

module.exports = {
  listIngredients,
  listInventoryAlerts,
  createIngredient,
  updateIngredient,
  deductIngredientsForOrder,
  applyInvoiceScanItems,
  mapIngredient,
};
