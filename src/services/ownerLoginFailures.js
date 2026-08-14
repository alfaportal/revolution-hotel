const { getSupabase } = require("../db");

/** Numërim gabimesh login pronar — ruajtje në DB (jo in-memory). */

const FAIL_THRESHOLD = 2;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const CHALLENGE_TTL_MS = 15 * 60 * 1000;
const MIN_PASSWORD = 6;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function incrementFailCount(email) {
  const db = getSupabase();
  const key = normalizeEmail(email);
  const now = Date.now();
  const windowExpires = new Date(now + FAIL_WINDOW_MS).toISOString();

  const { data: existing } = await db
    .from("owner_login_failures")
    .select("*")
    .eq("email", key)
    .maybeSingle();

  if (!existing || new Date(existing.window_expires_at).getTime() < now) {
    const { error } = await db.from("owner_login_failures").upsert({
      email: key,
      fail_count: 1,
      window_expires_at: windowExpires,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return 1;
  }

  const next = (existing.fail_count || 0) + 1;
  const { error } = await db
    .from("owner_login_failures")
    .update({
      fail_count: next,
      window_expires_at: windowExpires,
      updated_at: new Date().toISOString(),
    })
    .eq("email", key);
  if (error) throw error;
  return next;
}

async function clearFailCount(email) {
  const db = getSupabase();
  await db.from("owner_login_failures").delete().eq("email", normalizeEmail(email));
}

module.exports = {
  FAIL_THRESHOLD,
  FAIL_WINDOW_MS,
  CHALLENGE_TTL_MS,
  MIN_PASSWORD,
  normalizeEmail,
  incrementFailCount,
  clearFailCount,
};
