const { getSupabase } = require("../db");

const STAFF_CACHE_MS = 60_000;
const staffCache = new Map();

async function loadStaffIdSet(clientId) {
  const key = String(clientId || "");
  const cached = staffCache.get(key);
  if (cached && Date.now() - cached.at < STAFF_CACHE_MS) return cached.ids;

  const db = getSupabase();
  const { data, error } = await db
    .from("pos_staff")
    .select("id")
    .eq("client_id", clientId)
    .eq("active", true);
  if (error) throw error;

  const ids = new Set((data || []).map(row => String(row.id)));
  staffCache.set(key, { at: Date.now(), ids });
  return ids;
}

module.exports = {
  loadStaffIdSet,
};
