const { getSupabase } = require("../db");

async function logAdminActivity({
  actorUserId = null,
  actorEmail = "",
  action,
  targetType = "",
  targetId = "",
  targetLabel = "",
  details = {},
}) {
  if (!action) return null;
  const db = getSupabase();
  const row = {
    actor_user_id: actorUserId || null,
    actor_email: String(actorEmail || "").trim().toLowerCase(),
    action: String(action).trim(),
    target_type: String(targetType || "").trim(),
    target_id: String(targetId || "").trim(),
    target_label: String(targetLabel || "").trim().slice(0, 200),
    details: details && typeof details === "object" ? details : {},
  };

  const { data, error } = await db.from("admin_activity_log").insert(row).select().single();
  if (error) {
    console.warn("[activity-log]", error.message);
    return null;
  }
  return data;
}

async function listAdminActivityLog({ limit = 100 } = {}) {
  const db = getSupabase();
  const cap = Math.min(200, Math.max(1, Number(limit) || 100));
  const { data, error } = await db
    .from("admin_activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(cap);
  if (error) throw error;
  return data || [];
}

function activityFromReq(req) {
  return {
    actorUserId: req.user?.id || null,
    actorEmail: req.user?.email || "",
  };
}

module.exports = {
  logAdminActivity,
  listAdminActivityLog,
  activityFromReq,
};
