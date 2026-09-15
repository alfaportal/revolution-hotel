const { getSupabase } = require("../db");
const { notifyVenueSettingsUpdate } = require("./kdsEvents");

const VALID_MODES = ["auto", "thermal", "fiscal"];

function normalizeRegisterMode(raw) {
  const v = String(raw || "auto").trim().toLowerCase();
  return VALID_MODES.includes(v) ? v : "auto";
}

async function loadRegisterRow(clientId) {
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_settings")
    .select("active_coupon_type, register_mode_updated_at, register_mode_updated_by")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data || {};
}

async function getRegisterSwitchState(clientId) {
  const row = await loadRegisterRow(clientId);
  return {
    mode: normalizeRegisterMode(row.active_coupon_type),
    updated_at: row.register_mode_updated_at || null,
    updated_by: row.register_mode_updated_by || "",
  };
}

/** Ndryshim i dukshëm i modalitetit të arkës — vetëm pronari, nga PUT /api/owner/register-switch/mode. */
async function setRegisterMode(clientId, mode, actorEmail) {
  const normalized = normalizeRegisterMode(mode);
  const now = new Date().toISOString();
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_settings")
    .upsert(
      {
        client_id: clientId,
        active_coupon_type: normalized,
        register_mode_updated_at: now,
        register_mode_updated_by: String(actorEmail || "").trim(),
      },
      { onConflict: "client_id" },
    )
    .select("active_coupon_type, register_mode_updated_at, register_mode_updated_by")
    .single();
  if (error) throw error;

  const state = {
    mode: normalizeRegisterMode(data.active_coupon_type),
    updated_at: data.register_mode_updated_at || now,
    updated_by: data.register_mode_updated_by || "",
  };

  notifyVenueSettingsUpdate(clientId, {
    type: "register_mode_changed",
    mode: state.mode,
  });

  return state;
}

module.exports = {
  normalizeRegisterMode,
  getRegisterSwitchState,
  setRegisterMode,
};
