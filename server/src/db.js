const { createClient } = require("@supabase/supabase-js");
const { getSupabaseConfig } = require("./lib/env");
const { formatError, logRouteError } = require("./lib/errors");

let supabase = null;

function getSupabase() {
  if (supabase) return supabase;

  const { url, key } = getSupabaseConfig();

  if (!url || !key) {
    throw new Error(
      "Mungojnë SUPABASE_URL ose SUPABASE_SERVICE_ROLE_KEY në environment variables.",
    );
  }

  supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabase;
}

async function testSupabaseConnection() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return {
      ok: false,
      error: "Mungojnë SUPABASE_URL ose SUPABASE_SERVICE_ROLE_KEY",
      url_set: !!url,
      key_set: !!key,
    };
  }

  try {
    const db = getSupabase();
    const { error } = await db.from("clients").select("id", { count: "exact", head: true });
    if (error) {
      logRouteError("supabase:test", error);
      return {
        ok: false,
        error: formatError(error),
        code: error.code,
        details: error.details,
        hint: error.hint,
      };
    }
    return { ok: true, url: url.replace(/\/+$/, ""), key_length: key.length };
  } catch (e) {
    logRouteError("supabase:test", e);
    return { ok: false, error: formatError(e) };
  }
}

module.exports = { getSupabase, testSupabaseConnection };
