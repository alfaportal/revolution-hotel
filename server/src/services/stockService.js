const { getSupabase } = require("../db");
const { touchMenuSync } = require("./menuService");
const { isEmailConfigured, sendStockLowAlertEmail } = require("./emailService");
const { computeStockStatus, isVisibleOnWebMenu, isOutOfStock } = require("../lib/stockHelpers");

async function resolveOwnerEmail(clientId, clientRow) {
  const db = getSupabase();
  const { data, error } = await db
    .from("users")
    .select("email")
    .eq("client_id", clientId)
    .eq("roli", "client_admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const ownerEmail = String(data?.email || "").trim().toLowerCase();
  if (ownerEmail) return ownerEmail;
  return String(clientRow?.email || "").trim().toLowerCase() || null;
}

function mapStockItem(row) {
  return {
    id: row.id,
    local_id: row.local_id,
    name: row.name,
    category: String(row.category || "").trim(),
    price: Number(row.price),
    active: row.active !== false,
    track_stock: Boolean(row.track_stock),
    stock_quantity: row.stock_quantity != null ? Number(row.stock_quantity) : null,
    stock_alert_threshold: Number(row.stock_alert_threshold) || 5,
    stock_status: computeStockStatus(row),
  };
}

function summarizeStockItems(items) {
  let low_count = 0;
  let out_count = 0;
  let tracked_count = 0;
  for (const it of items) {
    if (!it.track_stock) continue;
    tracked_count += 1;
    if (it.stock_status === "low") low_count += 1;
    if (it.stock_status === "out") out_count += 1;
  }
  return {
    low_count,
    out_count,
    tracked_count,
    alert_count: low_count + out_count,
  };
}

function matchMenuItemForOrder(menuRows, orderItem) {
  const name = String(orderItem.name || "").trim();
  if (!name || name.startsWith("📍")) return null;

  const menuId = Number(orderItem.menu_id ?? orderItem.id ?? orderItem.local_id);
  if (Number.isFinite(menuId) && menuId > 0) {
    const byId = menuRows.find(r => Number(r.local_id) === menuId);
    if (byId) return byId;
  }

  const norm = name.toLowerCase();
  const price = Number(orderItem.price);
  const matches = menuRows.filter(r => r.name.trim().toLowerCase() === norm);
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  const byPrice = matches.find(r => Number(r.price) === price);
  return byPrice || matches[0];
}

async function clearStockAlertNotification(clientId, menuItemId) {
  const db = getSupabase();
  await db
    .from("stock_alert_notifications")
    .delete()
    .eq("client_id", clientId)
    .eq("menu_item_id", menuItemId);
}

async function maybeSendLowStockAlert(clientId, item, clientRow) {
  const db = getSupabase();
  const { data: existing } = await db
    .from("stock_alert_notifications")
    .select("id")
    .eq("client_id", clientId)
    .eq("menu_item_id", item.id)
    .maybeSingle();
  if (existing) return;

  const ownerEmail = await resolveOwnerEmail(clientId, clientRow);
  if (isEmailConfigured() && ownerEmail) {
    try {
      await sendStockLowAlertEmail({
        to: ownerEmail,
        clientName: clientRow?.emri || "",
        itemName: item.name,
        quantity: Number(item.stock_quantity),
        threshold: Number(item.stock_alert_threshold) || 5,
      });
    } catch (err) {
      console.warn("[stock] email failed:", err.message);
    }
  }

  const { error } = await db.from("stock_alert_notifications").insert({
    client_id: clientId,
    menu_item_id: item.id,
  });
  if (error && !/duplicate|unique/i.test(String(error.message || ""))) {
    console.warn("[stock] alert record failed:", error.message);
  }
}

async function listStockForOwner(clientId) {
  const db = getSupabase();
  const [{ data, error }, { data: settings }] = await Promise.all([
    db
      .from("pos_menu_items")
      .select(
        "id, local_id, name, category, price, active, track_stock, stock_quantity, stock_alert_threshold",
      )
      .eq("client_id", clientId)
      .order("category")
      .order("name"),
    db.from("pos_settings").select("synced_at").eq("client_id", clientId).maybeSingle(),
  ]);
  if (error) throw error;
  const items = (data || []).map(mapStockItem);
  return { items, summary: summarizeStockItems(items), synced_at: settings?.synced_at || null };
}

async function getStockSummary(clientId) {
  const { summary } = await listStockForOwner(clientId);
  return summary;
}

async function updateStockSettings(clientId, itemId, body) {
  const db = getSupabase();
  const { data: existing, error: findErr } = await db
    .from("pos_menu_items")
    .select("id, track_stock, stock_quantity, stock_alert_threshold, active")
    .eq("id", itemId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!existing) throw new Error("Artikulli nuk u gjet.");

  const patch = {};
  if (body.track_stock != null) patch.track_stock = Boolean(body.track_stock);
  if (body.stock_alert_threshold != null) {
    patch.stock_alert_threshold = Math.max(0, Math.floor(Number(body.stock_alert_threshold) || 0));
  }
  if (body.stock_quantity != null) {
    const q = Math.max(0, Math.floor(Number(body.stock_quantity) || 0));
    patch.stock_quantity = q;
    if (patch.track_stock !== false && (existing.track_stock || patch.track_stock)) {
      patch.active = q > 0;
    }
  }
  if (patch.track_stock === true && existing.stock_quantity == null && body.stock_quantity == null) {
    patch.stock_quantity = 0;
  }
  if (patch.track_stock === false) {
    patch.stock_quantity = null;
  }
  if (!Object.keys(patch).length) throw new Error("Nuk ka fusha për përditësim.");

  const { data, error } = await db
    .from("pos_menu_items")
    .update(patch)
    .eq("id", itemId)
    .eq("client_id", clientId)
    .select(
      "id, local_id, name, category, price, active, track_stock, stock_quantity, stock_alert_threshold",
    )
    .single();
  if (error) throw error;

  const mapped = mapStockItem(data);
  const threshold = mapped.stock_alert_threshold;
  if (mapped.track_stock && mapped.stock_quantity != null && mapped.stock_quantity > threshold) {
    await clearStockAlertNotification(clientId, itemId);
  }

  const synced_at = await touchMenuSync(clientId);
  return { item: mapped, synced_at };
}

async function restockItem(clientId, itemId, addQty) {
  const add = Math.max(0, Math.floor(Number(addQty) || 0));
  if (add <= 0) throw new Error("Shkruani sasinë për rimbushje.");

  const db = getSupabase();
  const { data: existing, error: findErr } = await db
    .from("pos_menu_items")
    .select("id, track_stock, stock_quantity, stock_alert_threshold, active")
    .eq("id", itemId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!existing) throw new Error("Artikulli nuk u gjet.");
  if (!existing.track_stock) throw new Error("Aktivizoni ndjekjen e stokut për këtë artikull.");

  const prev = Number(existing.stock_quantity) || 0;
  const next = prev + add;
  const patch = {
    stock_quantity: next,
    active: true,
    track_stock: true,
  };

  const { data, error } = await db
    .from("pos_menu_items")
    .update(patch)
    .eq("id", itemId)
    .eq("client_id", clientId)
    .select(
      "id, local_id, name, category, price, active, track_stock, stock_quantity, stock_alert_threshold",
    )
    .single();
  if (error) throw error;

  const mapped = mapStockItem(data);
  if (mapped.stock_quantity > mapped.stock_alert_threshold) {
    await clearStockAlertNotification(clientId, itemId);
  }

  const synced_at = await touchMenuSync(clientId);
  return { item: mapped, synced_at, added: add };
}

async function deductStockForOrder(clientId, orderItems) {
  const items = Array.isArray(orderItems) ? orderItems : [];
  if (!items.length) return { deducted: [] };

  const db = getSupabase();
  const { data: menuRows, error } = await db
    .from("pos_menu_items")
    .select(
      "id, local_id, name, price, active, track_stock, stock_quantity, stock_alert_threshold",
    )
    .eq("client_id", clientId)
    .eq("track_stock", true);
  if (error) throw error;
  if (!menuRows?.length) return { deducted: [] };

  const deductMap = new Map();
  for (const orderItem of items) {
    const row = matchMenuItemForOrder(menuRows, orderItem);
    if (!row) continue;
    const qty = Math.max(1, Number(orderItem.quantity) || 1);
    deductMap.set(row.id, (deductMap.get(row.id) || 0) + qty);
  }
  if (!deductMap.size) return { deducted: [] };

  const { data: clientRow } = await db
    .from("clients")
    .select("emri, email")
    .eq("id", clientId)
    .maybeSingle();

  const deducted = [];
  for (const [itemId, deductQty] of deductMap) {
    const row = menuRows.find(r => r.id === itemId);
    if (!row) continue;

    const prev = Number(row.stock_quantity) || 0;
    const next = Math.max(0, prev - deductQty);
    const threshold = Number(row.stock_alert_threshold) || 5;
    const patch = { stock_quantity: next };
    if (next <= 0) patch.active = false;

    const { error: updErr } = await db
      .from("pos_menu_items")
      .update(patch)
      .eq("id", itemId)
      .eq("client_id", clientId);
    if (updErr) {
      console.warn("[stock] update failed:", updErr.message);
      continue;
    }

    row.stock_quantity = next;
    if (next <= threshold) {
      await maybeSendLowStockAlert(clientId, row, clientRow);
    }
    if (next > threshold) {
      await clearStockAlertNotification(clientId, itemId);
    }

    deducted.push({ id: itemId, name: row.name, quantity: deductQty, remaining: next });
  }

  if (deducted.length) {
    await touchMenuSync(clientId);
  }

  return { deducted };
}

async function listStockAlertsForAdmin() {
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_menu_items")
    .select(
      "id, name, stock_quantity, stock_alert_threshold, track_stock, client_id, clients ( emri )",
    )
    .eq("track_stock", true);
  if (error) throw error;

  const byClient = new Map();
  for (const row of data || []) {
    const q = Number(row.stock_quantity);
    const threshold = Number(row.stock_alert_threshold) || 5;
    if (!Number.isFinite(q) || q > threshold) continue;

    const clientId = row.client_id;
    if (!byClient.has(clientId)) {
      byClient.set(clientId, {
        client_id: clientId,
        client_name: row.clients?.emri || "—",
        low_count: 0,
        out_count: 0,
        items: [],
      });
    }
    const entry = byClient.get(clientId);
    const status = q <= 0 ? "out" : "low";
    if (status === "out") entry.out_count += 1;
    else entry.low_count += 1;
    entry.items.push({
      menu_item_id: row.id,
      name: row.name,
      stock_quantity: q,
      stock_alert_threshold: threshold,
      status,
    });
  }

  return [...byClient.values()].sort(
    (a, b) => b.out_count + b.low_count - (a.out_count + a.low_count),
  );
}

async function countStockAlertClients() {
  const alerts = await listStockAlertsForAdmin();
  return alerts.length;
}

module.exports = {
  mapStockItem,
  listStockForOwner,
  getStockSummary,
  updateStockSettings,
  restockItem,
  deductStockForOrder,
  listStockAlertsForAdmin,
  countStockAlertClients,
  matchMenuItemForOrder,
  resolveOwnerEmail,
};
