const { findLicenseByKey, normalizeKey } = require("./licenseService");
const { assertLicenseUsable } = require("../lib/licenseEnforcement");
const { getSupabase } = require("../db");
const { withPgTransaction } = require("../lib/pgPool");
const { getCatalogForPos } = require("./menuCatalogService");
const { hashPin, generateWebToken } = require("./waiterPinService");

function extractMenuItems(body) {
  if (Array.isArray(body.menu_items)) return body.menu_items;
  if (Array.isArray(body.menu)) return body.menu;
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.artikuj)) return body.artikuj;
  return [];
}

function extractCategories(body) {
  return Array.isArray(body.categories) ? body.categories : [];
}

function extractStaff(body) {
  if (Array.isArray(body.staff)) return body.staff;
  if (Array.isArray(body.kamarieret)) return body.kamarieret;
  return [];
}

function normStaffName(name) {
  return String(name || "").trim().toLowerCase();
}

function parseStaffPin(staffRow) {
  const raw = String(staffRow.pin || staffRow.pin_code || staffRow.kodi || "").trim();
  return /^\d{4}$/.test(raw) ? raw : null;
}

function mapIncomingStaff(staff) {
  return staff
    .map(s => ({
      name: String(s.name || s.emri || "").trim(),
      active: s.active !== false && s.active !== 0,
      pin: parseStaffPin(s),
    }))
    .filter(s => s.name);
}

function buildMenuRow(clientId, m, i, photoByLocalId, stockByLocalId) {
  const localId = Number(m.local_id ?? m.id ?? i + 1) || i + 1;
  const prevStock = stockByLocalId.get(localId) || {};
  const trackStock =
    m.track_stock != null ? Boolean(m.track_stock) : Boolean(prevStock.track_stock);
  const stockQty =
    m.stock_quantity != null
      ? Math.max(0, Math.floor(Number(m.stock_quantity) || 0))
      : prevStock.stock_quantity;
  const stockThreshold =
    m.stock_alert_threshold != null
      ? Math.max(0, Math.floor(Number(m.stock_alert_threshold) || 0))
      : prevStock.stock_alert_threshold ?? 5;
  return {
    client_id: clientId,
    local_id: localId,
    name: String(m.name || m.emri || "").trim(),
    category: String(m.category || m.kategoria || "").trim(),
    price: Number(m.price ?? m.cmimi ?? 0) || 0,
    active: m.active !== false && m.active !== 0,
    // Prefero foton nga POS; nëse mungon, ruaj foton e mëparshme cloud (mos e fshi).
    photo: String(m.photo || "").trim() || photoByLocalId.get(localId) || "",
    description: String(m.description || "").trim().slice(0, 2000),
    sku: String(m.sku || "").trim().slice(0, 64),
    track_stock: trackStock,
    stock_quantity: trackStock ? (stockQty ?? 0) : null,
    stock_alert_threshold: stockThreshold,
  };
}

function buildMenuRows(clientId, menuItems, photoByLocalId, stockByLocalId) {
  return menuItems
    .map((m, i) => buildMenuRow(clientId, m, i, photoByLocalId, stockByLocalId))
    .filter(m => m.name);
}

async function syncStaffFromPos(db, clientId, staff) {
  const incoming = mapIncomingStaff(staff);
  if (!incoming.length) return 0;

  const { data: existingWaiters, error: loadErr } = await db
    .from("pos_staff")
    .select("id, name, pin_hash, web_token, source, active")
    .eq("client_id", clientId)
    .eq("role", "waiter");
  if (loadErr) throw loadErr;

  const byName = new Map();
  for (const w of existingWaiters || []) {
    byName.set(normStaffName(w.name), w);
  }

  const incomingNames = new Set(incoming.map(s => normStaffName(s.name)));
  let staffCount = 0;

  for (const s of incoming) {
    const existing = byName.get(normStaffName(s.name));
    if (existing) {
      const patch = { active: s.active };
      if (s.pin) {
        patch.pin_hash = await hashPin(s.pin);
        if (!existing.web_token) patch.web_token = generateWebToken();
      }
      const { error } = await db.from("pos_staff").update(patch).eq("id", existing.id);
      if (error) throw error;
      staffCount += 1;
      continue;
    }

    const row = {
      client_id: clientId,
      name: s.name,
      role: "waiter",
      source: "pos",
      active: s.active,
    };
    if (s.pin) {
      row.pin_hash = await hashPin(s.pin);
      row.web_token = generateWebToken();
    }
    const { error } = await db.from("pos_staff").insert(row);
    if (error) throw error;
    staffCount += 1;
  }

  for (const w of existingWaiters || []) {
    if (w.source !== "pos") continue;
    if (incomingNames.has(normStaffName(w.name))) continue;
    const { error } = await db.from("pos_staff").delete().eq("id", w.id);
    if (error) throw error;
  }

  return staffCount;
}

async function syncStaffFromPosPg(client, clientId, staff) {
  const incoming = mapIncomingStaff(staff);
  if (!incoming.length) return 0;

  const { rows: existingWaiters } = await client.query(
    `SELECT id, name, pin_hash, web_token, source, active FROM pos_staff WHERE client_id = $1 AND role = 'waiter'`,
    [clientId],
  );

  const byName = new Map();
  for (const w of existingWaiters || []) {
    byName.set(normStaffName(w.name), w);
  }

  const incomingNames = new Set(incoming.map(s => normStaffName(s.name)));
  let staffCount = 0;

  for (const s of incoming) {
    const existing = byName.get(normStaffName(s.name));
    if (existing) {
      if (s.pin) {
        const pin_hash = await hashPin(s.pin);
        const web_token = existing.web_token || generateWebToken();
        await client.query(
          `UPDATE pos_staff SET active = $1, pin_hash = $2, web_token = COALESCE(web_token, $3) WHERE id = $4`,
          [s.active, pin_hash, web_token, existing.id],
        );
      } else {
        await client.query(`UPDATE pos_staff SET active = $1 WHERE id = $2`, [s.active, existing.id]);
      }
      staffCount += 1;
      continue;
    }

    if (s.pin) {
      const pin_hash = await hashPin(s.pin);
      await client.query(
        `INSERT INTO pos_staff (client_id, name, active, role, source, pin_hash, web_token) VALUES ($1, $2, $3, 'waiter', 'pos', $4, $5)`,
        [clientId, s.name, s.active, pin_hash, generateWebToken()],
      );
    } else {
      await client.query(
        `INSERT INTO pos_staff (client_id, name, active, role, source) VALUES ($1, $2, $3, 'waiter', 'pos')`,
        [clientId, s.name, s.active],
      );
    }
    staffCount += 1;
  }

  for (const w of existingWaiters || []) {
    if (w.source !== "pos") continue;
    if (incomingNames.has(normStaffName(w.name))) continue;
    await client.query(`DELETE FROM pos_staff WHERE id = $1`, [w.id]);
  }

  return staffCount;
}

async function resolveLicense(body) {
  const celesi = normalizeKey(body.celesi || body.license_key);
  if (!celesi) throw new Error("Mungon çelësi i licencës.");
  const license = await findLicenseByKey(celesi);
  assertLicenseUsable(license);
  return license;
}

async function syncCatalogFromPosSupabase(license, body) {
  const clientId = license.client_id;
  const db = getSupabase();

  const restaurantName = String(body.restaurant_name || "").trim();
  const tableCount = Math.min(30, Math.max(1, Number(body.table_count) || 10));
  const address = String(body.address || body.adresa || "").trim();
  const phone = String(body.phone || body.telefoni || "").trim();
  const nui = String(body.nui || "").trim();
  const tvshNr = String(body.tvsh_nr || body.tvsh || "").trim();
  const receiptWidth = [58, 80].includes(Number(body.receipt_width_mm))
    ? Number(body.receipt_width_mm)
    : 80;
  const fiscalNr = String(body.fiscal_nr || "").trim();
  const fiscalCom = String(body.fiscal_com_port || body.fiscal_com || "").trim();
  const fiscalOperator = String(body.fiscal_operator_name || "").trim();
  const fiscalModel = String(body.fiscal_device_model || "").trim();
  const now = new Date().toISOString();

  const settingsRow = {
    client_id: clientId,
    restaurant_name: restaurantName,
    address,
    phone,
    nui,
    tvsh_nr: tvshNr,
    receipt_width_mm: receiptWidth,
    table_count: tableCount,
    synced_at: now,
  };
  if (fiscalNr) settingsRow.fiscal_nr = fiscalNr;
  if (fiscalCom) settingsRow.fiscal_com_port = fiscalCom;
  if (fiscalOperator) settingsRow.fiscal_operator_name = fiscalOperator;
  if (fiscalModel) settingsRow.fiscal_device_model = fiscalModel;
  if (body.fiscal_enabled != null) settingsRow.fiscal_enabled = Boolean(body.fiscal_enabled);

  await db.from("pos_settings").upsert(settingsRow);

  const categories = extractCategories(body);
  let catCount = 0;
  let categoriesPreserved = false;
  if (categories.length) {
    await db.from("pos_categories").delete().eq("client_id", clientId);
    const catRows = categories
      .map((c, i) => ({
        client_id: clientId,
        name: String(c.name || c).trim(),
        sort_order: Number(c.sort_order ?? i) || i,
      }))
      .filter(c => c.name);
    catCount = catRows.length;
    if (catRows.length) {
      const { error } = await db.from("pos_categories").insert(catRows);
      if (error) throw error;
    }
  } else {
    const { count, error } = await db
      .from("pos_categories")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId);
    if (error) throw error;
    catCount = count || 0;
    categoriesPreserved = true;
  }

  const menuItems = extractMenuItems(body);
  const { data: existingMenu } = await db
    .from("pos_menu_items")
    .select("local_id, photo, track_stock, stock_quantity, stock_alert_threshold")
    .eq("client_id", clientId);
  const photoByLocalId = new Map(
    (existingMenu || [])
      .filter(row => String(row.photo || "").trim())
      .map(row => [Number(row.local_id), row.photo]),
  );
  const stockByLocalId = new Map(
    (existingMenu || []).map(row => [
      Number(row.local_id),
      {
        track_stock: Boolean(row.track_stock),
        stock_quantity: row.stock_quantity != null ? Number(row.stock_quantity) : null,
        stock_alert_threshold: Number(row.stock_alert_threshold) || 5,
      },
    ]),
  );
  let menuCount = 0;
  let menuPreserved = false;
  if (menuItems.length) {
    await db.from("pos_menu_items").delete().eq("client_id", clientId);
    const menuRows = buildMenuRows(clientId, menuItems, photoByLocalId, stockByLocalId);
    menuCount = menuRows.length;
    if (menuRows.length) {
      const { error } = await db.from("pos_menu_items").insert(menuRows);
      if (error) throw error;
    }
  } else {
    menuCount = (existingMenu || []).length;
    menuPreserved = menuCount > 0;
    if (!menuPreserved) {
      console.warn(`[pos-sync] ${clientId}: sync pa menu_items — menuja mbetet bosh. Dërgoni artikuj nga POS.`);
    } else {
      console.warn(`[pos-sync] ${clientId}: sync pa menu_items — menuja ekzistuese u ruajt (${menuCount} artikuj).`);
    }
  }

  const staffCount = await syncStaffFromPos(db, clientId, extractStaff(body));

  return {
    client_id: clientId,
    restaurant_name: restaurantName,
    table_count: tableCount,
    categories: catCount,
    menu_items: menuCount,
    staff: staffCount,
    menu_preserved: menuPreserved,
    categories_preserved: categoriesPreserved,
    synced_at: now,
    transactional: false,
  };
}

async function syncCatalogFromPosTransactional(license, body) {
  const clientId = license.client_id;
  const restaurantName = String(body.restaurant_name || "").trim();
  const tableCount = Math.min(30, Math.max(1, Number(body.table_count) || 10));
  const address = String(body.address || body.adresa || "").trim();
  const phone = String(body.phone || body.telefoni || "").trim();
  const nui = String(body.nui || "").trim();
  const tvshNr = String(body.tvsh_nr || body.tvsh || "").trim();
  const receiptWidth = [58, 80].includes(Number(body.receipt_width_mm))
    ? Number(body.receipt_width_mm)
    : 80;
  const fiscalNr = String(body.fiscal_nr || "").trim();
  const fiscalCom = String(body.fiscal_com_port || body.fiscal_com || "").trim();
  const fiscalOperator = String(body.fiscal_operator_name || "").trim();
  const fiscalModel = String(body.fiscal_device_model || "").trim();
  const now = new Date().toISOString();

  const categories = extractCategories(body);
  const menuItems = extractMenuItems(body);
  const staff = extractStaff(body);

  const catRows = categories
    .map((c, i) => ({
      name: String(c.name || c).trim(),
      sort_order: Number(c.sort_order ?? i) || i,
    }))
    .filter(c => c.name);

  return withPgTransaction(async client => {
    const { rows: existingMenuRows } = await client.query(
      `SELECT local_id, photo, track_stock, stock_quantity, stock_alert_threshold FROM pos_menu_items WHERE client_id = $1`,
      [clientId],
    );
    const photoByLocalId = new Map(
      (existingMenuRows || [])
        .filter(row => String(row.photo || "").trim())
        .map(row => [Number(row.local_id), row.photo]),
    );
    const stockByLocalId = new Map(
      (existingMenuRows || []).map(row => [
        Number(row.local_id),
        {
          track_stock: Boolean(row.track_stock),
          stock_quantity: row.stock_quantity != null ? Number(row.stock_quantity) : null,
          stock_alert_threshold: Number(row.stock_alert_threshold) || 5,
        },
      ]),
    );

    const resolvedMenuRows =
      menuItems.length > 0
        ? buildMenuRows(clientId, menuItems, photoByLocalId, stockByLocalId)
        : [];

    await client.query(
      `INSERT INTO pos_settings (client_id, restaurant_name, address, phone, nui, tvsh_nr, receipt_width_mm, table_count, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (client_id) DO UPDATE SET
         restaurant_name = EXCLUDED.restaurant_name,
         address = EXCLUDED.address,
         phone = EXCLUDED.phone,
         nui = EXCLUDED.nui,
         tvsh_nr = EXCLUDED.tvsh_nr,
         receipt_width_mm = EXCLUDED.receipt_width_mm,
         table_count = EXCLUDED.table_count,
         synced_at = EXCLUDED.synced_at`,
      [clientId, restaurantName, address, phone, nui, tvshNr, receiptWidth, tableCount, now],
    );

    if (fiscalNr || fiscalCom || fiscalOperator || fiscalModel || body.fiscal_enabled != null) {
      await client.query(
        `UPDATE pos_settings SET
           fiscal_nr = COALESCE(NULLIF($2, ''), fiscal_nr),
           fiscal_com_port = COALESCE(NULLIF($3, ''), fiscal_com_port),
           fiscal_operator_name = COALESCE(NULLIF($4, ''), fiscal_operator_name),
           fiscal_device_model = COALESCE(NULLIF($5, ''), fiscal_device_model),
           fiscal_enabled = COALESCE($6, fiscal_enabled)
         WHERE client_id = $1`,
        [
          clientId,
          fiscalNr,
          fiscalCom,
          fiscalOperator,
          fiscalModel,
          body.fiscal_enabled != null ? Boolean(body.fiscal_enabled) : null,
        ],
      );
    }

    let categoriesPreserved = false;
    let catCount = catRows.length;
    if (catRows.length) {
      await client.query(`DELETE FROM pos_categories WHERE client_id = $1`, [clientId]);
      for (const c of catRows) {
        await client.query(
          `INSERT INTO pos_categories (client_id, name, sort_order) VALUES ($1, $2, $3)`,
          [clientId, c.name, c.sort_order],
        );
      }
    } else {
      const { rows: catExisting } = await client.query(
        `SELECT COUNT(*)::int AS c FROM pos_categories WHERE client_id = $1`,
        [clientId],
      );
      catCount = catExisting[0]?.c || 0;
      categoriesPreserved = catCount > 0;
    }

    let menuCount = resolvedMenuRows.length;
    let menuPreserved = false;
    if (resolvedMenuRows.length) {
      await client.query(`DELETE FROM pos_menu_items WHERE client_id = $1`, [clientId]);
      for (const m of resolvedMenuRows) {
        await client.query(
          `INSERT INTO pos_menu_items (client_id, local_id, name, category, price, active, photo, description, sku, track_stock, stock_quantity, stock_alert_threshold)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            clientId,
            m.local_id,
            m.name,
            m.category,
            m.price,
            m.active,
            m.photo,
            m.description,
            m.sku,
            m.track_stock,
            m.stock_quantity,
            m.stock_alert_threshold,
          ],
        );
      }
    } else {
      menuCount = existingMenuRows.length;
      menuPreserved = menuCount > 0;
      if (!menuPreserved) {
        console.warn(`[pos-sync] ${clientId}: sync pa menu_items — menuja mbetet bosh. Dërgoni artikuj nga POS.`);
      } else {
        console.warn(`[pos-sync] ${clientId}: sync pa menu_items — menuja ekzistuese u ruajt (${menuCount} artikuj).`);
      }
    }

    const staffCount = await syncStaffFromPosPg(client, clientId, staff);

    return {
      client_id: clientId,
      restaurant_name: restaurantName,
      table_count: tableCount,
      categories: catCount,
      menu_items: menuCount,
      staff: staffCount,
      menu_preserved: menuPreserved,
      categories_preserved: categoriesPreserved,
      synced_at: now,
      transactional: true,
    };
  });
}

async function syncStaffOnlyFromPos(body) {
  const license = await resolveLicense(body);
  const db = getSupabase();
  const staffCount = await syncStaffFromPos(db, license.client_id, extractStaff(body));
  return { staff: staffCount, client_id: license.client_id };
}

async function syncCatalogFromPos(body) {
  const license = await resolveLicense(body);
  if (process.env.DATABASE_URL) {
    try {
      const txResult = await syncCatalogFromPosTransactional(license, body);
      if (txResult) return txResult;
    } catch (err) {
      console.warn("[pos-sync] transactional catalog sync failed, fallback:", err.message);
    }
  }
  return syncCatalogFromPosSupabase(license, body);
}

async function pullCatalogForLicense(body) {
  const license = await resolveLicense(body);
  return getCatalogForPos(license.client_id);
}

module.exports = { syncCatalogFromPos, syncStaffOnlyFromPos, pullCatalogForLicense };
