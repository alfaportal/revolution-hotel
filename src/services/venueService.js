const { getSupabase } = require("../db");
const { buildTablesFromAreas, MAX_TABLES } = require("../lib/tableLayout");
const { touchMenuSync } = require("./menuService");
const { getPublicAppOrigin } = require("../lib/publicOrigin");
const {
  generatePunetoriToken,
  buildPunetoriUrl,
  ensureAllStaffPunetoriTokens,
  ensureStaffPunetoriToken,
  punetoriUiRole,
} = require("../lib/punetoriToken");

const STAFF_ROLES = ["waiter", "kitchen", "receptionist", "housekeeping"];

function normalizeRole(role) {
  const r = String(role || "waiter").trim().toLowerCase();
  return STAFF_ROLES.includes(r) ? r : "waiter";
}

function roleLabel(role) {
  switch (normalizeRole(role)) {
    case "kitchen":
      return "Kuzhinier";
    case "receptionist":
      return "Recepsionist";
    case "housekeeping":
      return "Housekeeping";
    default:
      return "Kamarier";
  }
}

async function syncTableCountFromAreas(clientId) {
  const db = getSupabase();
  const { data: areas } = await db
    .from("pos_areas")
    .select("table_count, active")
    .eq("client_id", clientId);

  const activeAreas = (areas || []).filter(a => a.active !== false);
  let total = 0;
  if (activeAreas.length) {
    total = activeAreas.reduce((sum, a) => sum + Math.max(0, Number(a.table_count) || 0), 0);
    total = Math.min(MAX_TABLES, total);
  }

  if (total > 0) {
    const { data: existing } = await db
      .from("pos_settings")
      .select("client_id")
      .eq("client_id", clientId)
      .maybeSingle();
    if (existing) {
      await db.from("pos_settings").update({ table_count: total }).eq("client_id", clientId);
    }
  }
  return total;
}

async function listVenue(clientId) {
  const db = getSupabase();
  const [{ data: areas }, { data: staff }, { data: settings }] = await Promise.all([
    db
      .from("pos_areas")
      .select("id, name, table_count, sort_order, active")
      .eq("client_id", clientId)
      .order("sort_order")
      .order("name"),
    db
      .from("pos_staff")
      .select("id, name, role, active, sort_order, web_token")
      .eq("client_id", clientId)
      .order("role")
      .order("sort_order")
      .order("name"),
    db.from("pos_settings").select("table_count, synced_at").eq("client_id", clientId).maybeSingle(),
  ]);

  const activeAreas = (areas || []).filter(a => a.active !== false);
  const areaTableTotal = activeAreas.reduce((s, a) => s + (Number(a.table_count) || 0), 0);
  const staffRows = staff || [];
  await ensureAllStaffPunetoriTokens(clientId, staffRows);
  const { data: staffFresh } = await db
    .from("pos_staff")
    .select("id, name, role, active, sort_order, web_token")
    .eq("client_id", clientId)
    .order("role")
    .order("sort_order")
    .order("name");
  const base = getPublicAppOrigin();

  return {
    areas: (areas || []).map(a => ({
      id: a.id,
      name: a.name,
      table_count: Number(a.table_count) || 0,
      sort_order: Number(a.sort_order) || 0,
      active: a.active !== false,
    })),
    staff: (staffFresh || staffRows).map(s => {
      const role = normalizeRole(s.role);
      const web_token = s.web_token || null;
      return {
        id: s.id,
        name: s.name,
        role,
        role_label: roleLabel(role),
        active: s.active !== false,
        sort_order: Number(s.sort_order) || 0,
        web_token,
        punetori_url: punetoriUiRole(role) && web_token ? buildPunetoriUrl(base, web_token) : "",
      };
    }),
    table_count: areaTableTotal > 0 ? areaTableTotal : Math.min(MAX_TABLES, Number(settings?.table_count) || 10),
    synced_at: settings?.synced_at || null,
  };
}

async function addArea(clientId, body) {
  const name = String(body.name || "").trim();
  if (!name) throw new Error("Shkruani emrin e hapësirës (p.sh. Terasa).");
  const tableCount = Math.min(MAX_TABLES, Math.max(1, Number(body.table_count) || 1));
  const db = getSupabase();

  const { data: last } = await db
    .from("pos_areas")
    .select("sort_order")
    .eq("client_id", clientId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await db
    .from("pos_areas")
    .insert({
      client_id: clientId,
      name,
      table_count: tableCount,
      sort_order: (Number(last?.sort_order) || 0) + 1,
      active: true,
    })
    .select("id, name, table_count, sort_order, active")
    .single();
  if (error) throw error;

  await syncTableCountFromAreas(clientId);
  const synced_at = await touchMenuSync(clientId);
  return {
    area: {
      id: data.id,
      name: data.name,
      table_count: Number(data.table_count),
      sort_order: Number(data.sort_order),
      active: data.active !== false,
    },
    synced_at,
  };
}

async function updateArea(clientId, areaId, body) {
  const db = getSupabase();
  const { data: existing, error: findErr } = await db
    .from("pos_areas")
    .select("id")
    .eq("id", areaId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!existing) throw new Error("Hapësira nuk u gjet.");

  const patch = {};
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) throw new Error("Emri nuk mund të jetë bosh.");
    patch.name = name;
  }
  if (body.table_count != null) {
    patch.table_count = Math.min(MAX_TABLES, Math.max(1, Number(body.table_count) || 1));
  }
  if (body.active != null) patch.active = Boolean(body.active);
  if (body.sort_order != null) patch.sort_order = Number(body.sort_order) || 0;
  if (!Object.keys(patch).length) throw new Error("Nuk ka fusha për përditësim.");

  const { data, error } = await db
    .from("pos_areas")
    .update(patch)
    .eq("id", areaId)
    .eq("client_id", clientId)
    .select("id, name, table_count, sort_order, active")
    .single();
  if (error) throw error;

  await syncTableCountFromAreas(clientId);
  const synced_at = await touchMenuSync(clientId);
  return {
    area: {
      id: data.id,
      name: data.name,
      table_count: Number(data.table_count),
      sort_order: Number(data.sort_order),
      active: data.active !== false,
    },
    synced_at,
  };
}

async function deleteArea(clientId, areaId) {
  const db = getSupabase();
  const { error } = await db.from("pos_areas").delete().eq("id", areaId).eq("client_id", clientId);
  if (error) throw error;
  await syncTableCountFromAreas(clientId);
  const synced_at = await touchMenuSync(clientId);
  return { ok: true, synced_at };
}

async function addStaff(clientId, body) {
  const name = String(body.name || "").trim();
  if (!name) throw new Error("Shkruani emrin e stafit.");
  const role = normalizeRole(body.role);
  const db = getSupabase();
  const web_token = punetoriUiRole(role) ? generatePunetoriToken(name) : null;

  const { data: last } = await db
    .from("pos_staff")
    .select("sort_order")
    .eq("client_id", clientId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await db
    .from("pos_staff")
    .insert({
      client_id: clientId,
      name,
      role,
      source: "owner",
      sort_order: (Number(last?.sort_order) || 0) + 1,
      active: true,
      web_token,
    })
    .select("id, name, role, active, sort_order, web_token")
    .single();
  if (error) {
    if (String(error.message || "").includes("unique")) {
      throw new Error("Ky emër ekziston tashmë në listë.");
    }
    throw error;
  }

  const synced_at = await touchMenuSync(clientId);
  const memberRole = normalizeRole(data.role);
  const token = data.web_token || (await ensureStaffPunetoriToken(clientId, data.id, data.name));
  return {
    member: {
      id: data.id,
      name: data.name,
      role: memberRole,
      role_label: roleLabel(memberRole),
      active: data.active !== false,
      sort_order: Number(data.sort_order) || 0,
      web_token: token,
      punetori_url: punetoriUiRole(memberRole) && token ? buildPunetoriUrl(getPublicAppOrigin(), token) : "",
    },
    synced_at,
  };
}

async function updateStaff(clientId, staffId, body) {
  const db = getSupabase();
  const { data: existing, error: findErr } = await db
    .from("pos_staff")
    .select("id")
    .eq("id", staffId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!existing) throw new Error("Anëtari i stafit nuk u gjet.");

  const patch = {};
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) throw new Error("Emri nuk mund të jetë bosh.");
    patch.name = name;
  }
  if (body.role != null) patch.role = normalizeRole(body.role);
  if (body.active != null) patch.active = Boolean(body.active);
  if (!Object.keys(patch).length) throw new Error("Nuk ka fusha për përditësim.");

  const { data, error } = await db
    .from("pos_staff")
    .update(patch)
    .eq("id", staffId)
    .eq("client_id", clientId)
    .select("id, name, role, active, sort_order, web_token")
    .single();
  if (error) throw error;

  const nextRole = normalizeRole(data.role);
  let token = data.web_token || null;
  if (punetoriUiRole(nextRole)) {
    if (patch.name != null) {
      token = generatePunetoriToken(data.name);
      await db.from("pos_staff").update({ web_token: token }).eq("id", staffId).eq("client_id", clientId);
    } else if (!token || patch.role != null) {
      token = await ensureStaffPunetoriToken(clientId, staffId, data.name);
    }
  }

  const synced_at = await touchMenuSync(clientId);
  return {
    member: {
      id: data.id,
      name: data.name,
      role: nextRole,
      role_label: roleLabel(nextRole),
      active: data.active !== false,
      sort_order: Number(data.sort_order) || 0,
      web_token: token,
      punetori_url: punetoriUiRole(nextRole) && token ? buildPunetoriUrl(getPublicAppOrigin(), token) : "",
    },
    synced_at,
  };
}

async function deleteStaff(clientId, staffId) {
  const db = getSupabase();
  const { error } = await db.from("pos_staff").delete().eq("id", staffId).eq("client_id", clientId);
  if (error) throw error;
  const synced_at = await touchMenuSync(clientId);
  return { ok: true, synced_at };
}

async function loadAreasForClient(clientId) {
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_areas")
    .select("id, name, table_count, sort_order, active")
    .eq("client_id", clientId)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return data || [];
}

async function loadWaiterStaff(clientId) {
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_staff")
    .select("name, role, active")
    .eq("client_id", clientId)
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data || [])
    .filter(s => normalizeRole(s.role) === "waiter")
    .map(s => s.name);
}

module.exports = {
  STAFF_ROLES,
  roleLabel,
  listVenue,
  addArea,
  updateArea,
  deleteArea,
  addStaff,
  updateStaff,
  deleteStaff,
  loadAreasForClient,
  loadWaiterStaff,
  buildTablesFromAreas,
  syncTableCountFromAreas,
};
