const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { getSupabase } = require("../db");
const { touchMenuSync } = require("./menuService");

const PIN_RE = /^\d{4}$/;

function generateWebToken() {
  return crypto.randomBytes(12).toString("hex");
}

async function ensureWaiterWebToken(clientId, waiterId) {
  const db = getSupabase();
  const { data: row, error: findErr } = await db
    .from("pos_staff")
    .select("id, web_token")
    .eq("id", waiterId)
    .eq("client_id", clientId)
    .eq("role", "waiter")
    .maybeSingle();
  if (findErr) throw findErr;
  if (!row) return null;
  if (row.web_token) return row.web_token;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const web_token = generateWebToken();
    const { data, error } = await db
      .from("pos_staff")
      .update({ web_token })
      .eq("id", waiterId)
      .eq("client_id", clientId)
      .is("web_token", null)
      .select("web_token")
      .maybeSingle();
    if (!error && data?.web_token) return data.web_token;
    if (error && !String(error.message || "").includes("unique")) throw error;
  }
  const { data: again } = await db
    .from("pos_staff")
    .select("web_token")
    .eq("id", waiterId)
    .maybeSingle();
  return again?.web_token || null;
}

async function ensureAllWaiterWebTokens(clientId) {
  const rows = await loadPinWaiters(clientId);
  await Promise.all(rows.map(w => ensureWaiterWebToken(clientId, w.id)));
}

function normalizeWebToken(raw) {
  return String(raw || "").trim().toLowerCase();
}

async function getWaiterByWebToken(clientId, webToken) {
  const token = normalizeWebToken(webToken);
  if (!token) return null;
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_staff")
    .select("id, name, role, active, pin_hash, web_token")
    .eq("client_id", clientId)
    .eq("role", "waiter")
    .eq("web_token", token)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id || data.active === false) return null;
  return data;
}

function assertPin(pin) {
  const p = String(pin || "").trim();
  if (!PIN_RE.test(p)) throw new Error("PIN duhet të jetë 4 shifra.");
  return p;
}

async function hashPin(pin) {
  return bcrypt.hash(assertPin(pin), 10);
}

async function pinMatches(pin, hash) {
  if (!hash) return false;
  try {
    return bcrypt.compare(assertPin(pin), hash);
  } catch {
    return false;
  }
}

async function loadPinWaiters(clientId, { activeOnly = false } = {}) {
  const db = getSupabase();
  let q = db
    .from("pos_staff")
    .select("id, name, role, active, pin_hash, sort_order, web_token")
    .eq("client_id", clientId)
    .eq("role", "waiter")
    .not("pin_hash", "is", null);
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q.order("sort_order").order("name");
  if (error) throw error;
  return data || [];
}

async function assertPinUnique(clientId, pin, excludeId = null) {
  const waiters = await loadPinWaiters(clientId);
  for (const w of waiters) {
    if (excludeId && w.id === excludeId) continue;
    if (await pinMatches(pin, w.pin_hash)) {
      throw new Error("Ky PIN përdoret tashmë nga një kamarier tjetër.");
    }
  }
}

function mapWaiterPublic(row) {
  return {
    id: row.id,
    name: row.name,
    active: row.active !== false,
    has_pin: Boolean(row.pin_hash),
    web_token: row.web_token || null,
  };
}

async function listWaitersForOwner(clientId) {
  await ensureAllWaiterWebTokens(clientId);
  const rows = await loadPinWaiters(clientId);
  return rows.map(mapWaiterPublic);
}

async function countWaitersWithoutPin(clientId) {
  const db = getSupabase();
  const { count, error } = await db
    .from("pos_staff")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("role", "waiter")
    .eq("active", true)
    .is("pin_hash", null);
  if (error) throw error;
  return count || 0;
}

async function verifyWaiterPin(clientId, pin, webToken = null) {
  const normalized = assertPin(pin);
  const token = normalizeWebToken(webToken);
  if (token) {
    const w = await getWaiterByWebToken(clientId, token);
    if (w) {
      if (!w.pin_hash) throw new Error("Ky kamarier nuk ka PIN. Pronari e vendos te Kamarierët.");
      if (!(await pinMatches(normalized, w.pin_hash))) {
        throw new Error(`PIN i gabuar për ${w.name}.`);
      }
      return { id: w.id, name: w.name };
    }
    // Token i vjetër/gabim — mos e blloko faqen; provo PIN si link i përbashkët.
  }
  const waiters = await loadPinWaiters(clientId, { activeOnly: true });
  if (!waiters.length) {
    const withoutPin = await countWaitersWithoutPin(clientId);
    if (withoutPin > 0) {
      throw new Error(
        "Kamarierët janë sinkronizuar nga POS por nuk kanë PIN për kyçje web. " +
          "Vendoseni PIN te paneli i pronarit (Kamarierët) ose dërgoni PIN në sync nga POS (staff[].pin)."
      );
    }
    throw new Error("Nuk ka kamarierë me PIN. Pronari i shton te Kamarierët.");
  }
  for (const w of waiters) {
    if (await pinMatches(normalized, w.pin_hash)) {
      return { id: w.id, name: w.name };
    }
  }
  throw new Error("PIN i gabuar.");
}

async function getWaiterByName(clientId, waiterName) {
  const name = String(waiterName || "").trim();
  if (!name) return null;
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_staff")
    .select("id, name, role, active")
    .eq("client_id", clientId)
    .eq("role", "waiter")
    .ilike("name", name)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return null;
  if (data.active === false) return null;
  return { id: data.id, name: data.name };
}

async function getWaiterById(clientId, waiterId) {
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_staff")
    .select("id, name, role, active")
    .eq("client_id", clientId)
    .eq("id", waiterId)
    .eq("role", "waiter")
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return null;
  if (data.active === false) return null;
  return { id: data.id, name: data.name };
}

async function resolveWaiterForOrder(clientId, waiterId, waiterName) {
  const id = String(waiterId || "").trim();
  const name = String(waiterName || "").trim();
  if (!id) throw new Error("Mungon ID e kamarierit.");
  if (!name) throw new Error("Mungon emri i kamarierit.");
  const waiter = await getWaiterById(clientId, id);
  if (!waiter) throw new Error("Kamarieri nuk u gjet ose është joaktiv.");
  if (waiter.name.toLowerCase() !== name.toLowerCase()) {
    throw new Error("Të dhënat e kamarierit nuk përputhen.");
  }
  return waiter;
}

async function addWaiterWithPin(clientId, body) {
  const name = String(body.name || "").trim();
  if (!name) throw new Error("Shkruani emrin e kamarierit.");
  const pin = assertPin(body.pin);
  await assertPinUnique(clientId, pin);

  const db = getSupabase();
  const { data: last } = await db
    .from("pos_staff")
    .select("sort_order")
    .eq("client_id", clientId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const pin_hash = await hashPin(pin);
  const web_token = generateWebToken();
  const { data, error } = await db
    .from("pos_staff")
    .insert({
      client_id: clientId,
      name,
      role: "waiter",
      source: "owner",
      pin_hash,
      web_token,
      sort_order: (Number(last?.sort_order) || 0) + 1,
      active: true,
    })
    .select("id, name, active, pin_hash, web_token")
    .single();
  if (error) {
    if (String(error.message || "").includes("unique")) {
      throw new Error("Ky emër ekziston tashmë.");
    }
    throw error;
  }

  const synced_at = await touchMenuSync(clientId);
  return { waiter: mapWaiterPublic(data), synced_at };
}

async function updateWaiterWithPin(clientId, waiterId, body) {
  const db = getSupabase();
  const { data: existing, error: findErr } = await db
    .from("pos_staff")
    .select("id, pin_hash")
    .eq("id", waiterId)
    .eq("client_id", clientId)
    .eq("role", "waiter")
    .maybeSingle();
  if (findErr) throw findErr;
  if (!existing) throw new Error("Kamarieri nuk u gjet.");

  const patch = {};
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) throw new Error("Emri nuk mund të jetë bosh.");
    patch.name = name;
  }
  if (body.active != null) patch.active = Boolean(body.active);
  if (body.pin != null) {
    const pin = assertPin(body.pin);
    await assertPinUnique(clientId, pin, waiterId);
    patch.pin_hash = await hashPin(pin);
  }
  if (!Object.keys(patch).length) throw new Error("Nuk ka fusha për përditësim.");

  const { data, error } = await db
    .from("pos_staff")
    .update(patch)
    .eq("id", waiterId)
    .eq("client_id", clientId)
    .select("id, name, active, pin_hash, web_token")
    .single();
  if (error) throw error;

  await ensureWaiterWebToken(clientId, waiterId);
  const { data: refreshed } = await db
    .from("pos_staff")
    .select("id, name, active, pin_hash, web_token")
    .eq("id", waiterId)
    .eq("client_id", clientId)
    .single();

  const synced_at = await touchMenuSync(clientId);
  return { waiter: mapWaiterPublic(refreshed || data), synced_at };
}

async function deleteWaiterWithPin(clientId, waiterId) {
  const db = getSupabase();
  const { error } = await db
    .from("pos_staff")
    .delete()
    .eq("id", waiterId)
    .eq("client_id", clientId)
    .eq("role", "waiter");
  if (error) throw error;
  const synced_at = await touchMenuSync(clientId);
  return { ok: true, synced_at };
}

module.exports = {
  listWaitersForOwner,
  verifyWaiterPin,
  resolveWaiterForOrder,
  addWaiterWithPin,
  updateWaiterWithPin,
  deleteWaiterWithPin,
  getWaiterById,
  getWaiterByName,
  getWaiterByWebToken,
  ensureWaiterWebToken,
  ensureAllWaiterWebTokens,
  hashPin,
  generateWebToken,
};
