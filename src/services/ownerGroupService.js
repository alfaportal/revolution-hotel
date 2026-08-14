const { getSupabase } = require("../db");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingGroupSchemaError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  if (code === "42p01") return true;
  if (msg.includes("owner_group") && msg.includes("does not exist")) return true;
  if (msg.includes("owner_group") && msg.includes("schema cache")) return true;
  return false;
}

async function getClientRow(clientId) {
  const db = getSupabase();
  const { data, error } = await db.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureUserInGroup(userId, ownerGroupId) {
  const db = getSupabase();
  const { error } = await db.from("owner_group_members").upsert(
    { owner_group_id: ownerGroupId, user_id: userId },
    { onConflict: "owner_group_id,user_id", ignoreDuplicates: true },
  );
  if (error && !isMissingGroupSchemaError(error)) throw error;
}

async function ensureGroupForClient(clientId) {
  const id = String(clientId || "").trim();
  if (!UUID_RE.test(id)) return null;

  const client = await getClientRow(id);
  if (!client) return null;
  if (client.owner_group_id) return client.owner_group_id;

  const db = getSupabase();
  const { data: group, error: gErr } = await db
    .from("owner_groups")
    .insert({ emri: String(client.emri || "Grup").trim() || "Grup" })
    .select("id")
    .single();
  if (gErr) {
    if (isMissingGroupSchemaError(gErr)) return null;
    throw gErr;
  }

  const { error: uErr } = await db
    .from("clients")
    .update({ owner_group_id: group.id })
    .eq("id", id);
  if (uErr) throw uErr;

  const { data: owners } = await db
    .from("users")
    .select("id")
    .eq("client_id", id)
    .eq("roli", "client_admin");
  for (const o of owners || []) {
    await ensureUserInGroup(o.id, group.id);
  }

  return group.id;
}

async function getUserRow(userId) {
  const db = getSupabase();
  const { data, error } = await db
    .from("users")
    .select("id, emri, email, client_id, roli")
    .eq("id", userId)
    .eq("roli", "client_admin")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function resolveOwnerGroupForUser(userId, fallbackClientId) {
  const user = await getUserRow(userId);
  const homeClientId = user?.client_id || fallbackClientId;
  if (!homeClientId) return null;
  return ensureGroupForClient(homeClientId);
}

async function listGroupClientIds(ownerGroupId) {
  if (!ownerGroupId) return [];
  const db = getSupabase();
  const { data, error } = await db
    .from("clients")
    .select("id")
    .eq("owner_group_id", ownerGroupId)
    .order("emri");
  if (error) {
    if (isMissingGroupSchemaError(error)) return [];
    throw error;
  }
  return (data || []).map(r => r.id);
}

async function listLocationsForUser(userId, activeClientId) {
  const user = await getUserRow(userId);
  if (!user) return { locations: [], multi_location: false, owner_group_id: null };

  const ownerGroupId = await resolveOwnerGroupForUser(userId, user.client_id);
  if (!ownerGroupId) {
    const client = user.client_id ? await getClientRow(user.client_id) : null;
    const locations = client
      ? [
          {
            id: client.id,
            emri: client.emri,
            tipi: client.tipi,
            adresa: client.adresa || "",
          },
        ]
      : [];
    return {
      locations,
      multi_location: false,
      owner_group_id: null,
      active_client_id: activeClientId || user.client_id,
    };
  }

  await ensureUserInGroup(userId, ownerGroupId);
  const db = getSupabase();
  const { data, error } = await db
    .from("clients")
    .select("id, emri, tipi, adresa, package_tier")
    .eq("owner_group_id", ownerGroupId)
    .order("emri");
  if (error) throw error;

  const locations = (data || []).map(c => ({
    id: c.id,
    emri: c.emri,
    tipi: c.tipi,
    adresa: c.adresa || "",
    package_tier: c.package_tier || "",
  }));

  return {
    locations,
    multi_location: locations.length > 1,
    owner_group_id: ownerGroupId,
    active_client_id: activeClientId || user.client_id,
  };
}

async function userCanAccessClient(userId, clientId) {
  const user = await getUserRow(userId);
  if (!user) return false;
  if (user.client_id === clientId) return true;

  const client = await getClientRow(clientId);
  if (!client?.owner_group_id) return false;

  const db = getSupabase();
  const { data, error } = await db
    .from("owner_group_members")
    .select("id")
    .eq("user_id", userId)
    .eq("owner_group_id", client.owner_group_id)
    .maybeSingle();
  if (error) {
    if (isMissingGroupSchemaError(error)) return user.client_id === clientId;
    throw error;
  }
  return !!data;
}

async function buildOwnerAuthContext(user, { clientId, viewAll } = {}) {
  const { normalizePackageTier } = require("../lib/packages");
  const ownerGroupId = await resolveOwnerGroupForUser(user.id, user.client_id);
  let activeClientId = clientId || user.client_id;
  let aggregateView = !!viewAll;

  if (activeClientId && !(await userCanAccessClient(user.id, activeClientId))) {
    throw new Error("Nuk keni akses në këtë lokale.");
  }

  if (aggregateView && ownerGroupId) {
    const ids = await listGroupClientIds(ownerGroupId);
    if (ids.length <= 1) aggregateView = false;
  } else {
    aggregateView = false;
  }

  if (!activeClientId && ownerGroupId) {
    const ids = await listGroupClientIds(ownerGroupId);
    activeClientId = ids[0] || user.client_id;
  }

  let package_tier = "pako_1";
  if (activeClientId) {
    const db = getSupabase();
    const { data: clientRow } = await db
      .from("clients")
      .select("package_tier")
      .eq("id", activeClientId)
      .maybeSingle();
    package_tier = normalizePackageTier(clientRow?.package_tier);
  }

  return {
    sub: user.id,
    email: user.email,
    emri: user.emri,
    roli: user.roli,
    client_id: activeClientId,
    owner_group_id: ownerGroupId || null,
    view_all: aggregateView,
    package_tier,
  };
}

async function listOwnerGroups() {
  const db = getSupabase();
  const { data, error } = await db.from("owner_groups").select("id, emri, created_at").order("emri");
  if (error) {
    if (isMissingGroupSchemaError(error)) return [];
    throw error;
  }
  return data || [];
}

async function createOwnerGroup(emri) {
  const name = String(emri || "").trim();
  if (!name) throw new Error("Emri i grupit është i detyrueshëm.");
  const db = getSupabase();
  const { data, error } = await db.from("owner_groups").insert({ emri: name }).select("*").single();
  if (error) throw error;
  return data;
}

async function linkClientsToGroup(ownerGroupId, clientIds, { ownerUserId } = {}) {
  const groupId = String(ownerGroupId || "").trim();
  if (!UUID_RE.test(groupId)) throw new Error("Grupi nuk është i vlefshëm.");

  const ids = [...new Set((clientIds || []).map(String).filter(id => UUID_RE.test(id)))];
  if (!ids.length) throw new Error("Zgjidhni të paktën një lokale.");

  const db = getSupabase();
  const { error } = await db.from("clients").update({ owner_group_id: groupId }).in("id", ids);
  if (error) throw error;

  if (ownerUserId && UUID_RE.test(String(ownerUserId))) {
    await ensureUserInGroup(ownerUserId, groupId);
  }

  return { owner_group_id: groupId, client_ids: ids };
}

async function linkClientToOwnerUser(clientId, ownerUserId) {
  const user = await getUserRow(ownerUserId);
  if (!user) throw new Error("Pronari nuk u gjet.");

  const homeGroupId = await ensureGroupForClient(user.client_id);
  if (!homeGroupId) throw new Error("Grupi i pronarit nuk u krijua.");

  await ensureUserInGroup(user.id, homeGroupId);
  return linkClientsToGroup(homeGroupId, [clientId], { ownerUserId: user.id });
}

async function getOwnerGroupDetails(ownerGroupId) {
  if (!ownerGroupId) return null;
  const db = getSupabase();
  const { data: group, error } = await db
    .from("owner_groups")
    .select("id, emri, created_at")
    .eq("id", ownerGroupId)
    .maybeSingle();
  if (error) {
    if (isMissingGroupSchemaError(error)) return null;
    throw error;
  }
  if (!group) return null;
  const { data: clients, error: cErr } = await db
    .from("clients")
    .select("id, emri, tipi, adresa")
    .eq("owner_group_id", ownerGroupId)
    .order("emri");
  if (cErr) throw cErr;
  return { ...group, clients: clients || [] };
}

async function findOwnerUserIdForClient(clientId) {
  const id = String(clientId || "").trim();
  if (!UUID_RE.test(id)) return null;
  const db = getSupabase();
  const { data, error } = await db
    .from("users")
    .select("id")
    .eq("client_id", id)
    .eq("roli", "client_admin")
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

module.exports = {
  ensureGroupForClient,
  listLocationsForUser,
  userCanAccessClient,
  buildOwnerAuthContext,
  listGroupClientIds,
  listOwnerGroups,
  createOwnerGroup,
  linkClientsToGroup,
  linkClientToOwnerUser,
  resolveOwnerGroupForUser,
  getUserRow,
  getOwnerGroupDetails,
  findOwnerUserIdForClient,
};
