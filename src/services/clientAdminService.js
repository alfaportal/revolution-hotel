const { getSupabase } = require("../db");
const { getFiscalSettings, updateFiscalSettings } = require("./fiscalService");

async function getClientAdminSettings(clientId) {
  const db = getSupabase();
  const { data: settings } = await db
    .from("pos_settings")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  const fiscal = await getFiscalSettings(clientId);

  return {
    restaurant_name: settings?.restaurant_name || fiscal.business_name || "",
    address: settings?.address || fiscal.address || "",
    phone: settings?.phone || fiscal.phone || "",
    nui: settings?.nui || fiscal.nui || "",
    tvsh_nr: settings?.tvsh_nr || fiscal.tvsh_nr || "",
    receipt_width_mm: settings?.receipt_width_mm === 58 ? 58 : 80,
    table_count: Math.min(30, Math.max(1, Number(settings?.table_count) || 10)),
    synced_at: settings?.synced_at || null,
    fiscal_nr: fiscal.fiscal_nr || "",
    fiscal_com_port: fiscal.fiscal_com_port || "",
    fiscal_enabled: fiscal.fiscal_enabled !== false,
    fiscal_operator_name: fiscal.fiscal_operator_name || "",
    fiscal_device_model: fiscal.fiscal_device_model || "",
  };
}

async function updateClientAdminSettings(clientId, body) {
  const db = getSupabase();
  const now = new Date().toISOString();
  const posPatch = {};
  if (body.restaurant_name != null) posPatch.restaurant_name = String(body.restaurant_name).trim();
  if (body.address != null) posPatch.address = String(body.address).trim();
  if (body.phone != null) posPatch.phone = String(body.phone).trim();
  if (body.nui != null) posPatch.nui = String(body.nui).trim();
  if (body.tvsh_nr != null) posPatch.tvsh_nr = String(body.tvsh_nr).trim();
  if (body.receipt_width_mm != null) {
    posPatch.receipt_width_mm = Number(body.receipt_width_mm) === 58 ? 58 : 80;
  }
  if (body.table_count != null) {
    posPatch.table_count = Math.min(30, Math.max(1, Number(body.table_count) || 10));
  }

  if (Object.keys(posPatch).length) {
    posPatch.synced_at = now;
    const { error } = await db.from("pos_settings").upsert({
      client_id: clientId,
      table_count: posPatch.table_count ?? 10,
      receipt_width_mm: posPatch.receipt_width_mm ?? 80,
      ...posPatch,
    });
    if (error) throw error;
  }

  const fiscalBody = {};
  if (body.fiscal_nr != null) fiscalBody.fiscal_nr = body.fiscal_nr;
  if (body.fiscal_com_port != null) fiscalBody.fiscal_com_port = body.fiscal_com_port;
  if (body.fiscal_enabled != null) fiscalBody.fiscal_enabled = body.fiscal_enabled;
  if (body.fiscal_operator_name != null) fiscalBody.fiscal_operator_name = body.fiscal_operator_name;
  if (body.fiscal_device_model != null) fiscalBody.fiscal_device_model = body.fiscal_device_model;
  if (body.nui != null) fiscalBody.nui = body.nui;
  if (body.tvsh_nr != null) fiscalBody.tvsh_nr = body.tvsh_nr;
  if (body.restaurant_name != null) fiscalBody.restaurant_name = body.restaurant_name;

  if (Object.keys(fiscalBody).length) {
    await updateFiscalSettings(clientId, fiscalBody);
  }

  return getClientAdminSettings(clientId);
}

module.exports = {
  getClientAdminSettings,
  updateClientAdminSettings,
};
