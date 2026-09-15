const { getSupabase } = require("../db");

/** Audit log PËR KLIENT (çmime të ndryshuara, porosi/fatura të anulluara).
 * I veçantë nga admin_activity_log (ai është global, pa client_id, vetëm
 * për Super Adminin e platformës — jo për pronarët e restoranteve). */
async function logOwnerActivity(clientId, {
  actorEmail = "",
  action,
  targetType = "",
  targetId = "",
  targetLabel = "",
  details = {},
}) {
  if (!clientId || !action) return null;
  const db = getSupabase();
  const row = {
    client_id: clientId,
    actor_email: String(actorEmail || "").trim().toLowerCase(),
    action: String(action).trim(),
    target_type: String(targetType || "").trim(),
    target_id: String(targetId || "").trim(),
    target_label: String(targetLabel || "").trim().slice(0, 200),
    details: details && typeof details === "object" ? details : {},
  };
  const { data, error } = await db.from("owner_activity_log").insert(row).select().single();
  if (error) {
    console.warn("[owner-audit]", error.message);
    return null;
  }
  return data;
}

async function listOwnerActivity(clientId, { limit = 100, action = "" } = {}) {
  const db = getSupabase();
  const cap = Math.min(300, Math.max(1, Number(limit) || 100));
  let query = db
    .from("owner_activity_log")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(cap);
  if (action) query = query.eq("action", action);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

module.exports = {
  logOwnerActivity,
  listOwnerActivity,
};
