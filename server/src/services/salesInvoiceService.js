const { getSupabase } = require("../db");
const { getClientById } = require("./salesService");

const BUCKET = "firm-logos";

async function getPosSettingsRow(clientId) {
  const db = getSupabase();
  const { data, error } = await db
    .from("pos_settings")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message || "pos_settings");
  return data || {};
}

/** Snapshot shitësi për faturë A4 — pos_settings + clients. NF = tvsh_nr. */
async function getSellerSnapshot(clientId) {
  const [row, client] = await Promise.all([
    getPosSettingsRow(clientId),
    getClientById(clientId),
  ]);
  const companyName = String(row.restaurant_name || client?.emri || "Hotel").trim();
  return {
    companyName,
    companyNameDisplay: companyName.toLocaleUpperCase("sq-AL"),
    nui: String(row.nui || "").trim(),
    fiscalNumber: String(row.tvsh_nr || "").trim(),
    address: String(row.address || client?.adresa || "").trim(),
    city: "",
    phone: String(row.phone || client?.telefoni || "").trim(),
    email: String(client?.email || "").trim(),
    logoUrl: String(row.company_logo_url || "").trim(),
    currency: "€",
  };
}

async function getInvoiceSettings(clientId) {
  const row = await getPosSettingsRow(clientId);
  return {
    companyLogoUrl: String(row.company_logo_url || "").trim(),
    vatEnabled: row.sales_invoice_vat_enabled === true,
    vatPercent: Number(row.sales_invoice_vat_percent) || 18,
  };
}

async function updateInvoiceSettings(clientId, body) {
  const patch = { client_id: clientId, synced_at: new Date().toISOString() };
  if (body.vatEnabled != null) patch.sales_invoice_vat_enabled = !!body.vatEnabled;
  if (body.vatPercent != null) {
    const p = Number(body.vatPercent);
    patch.sales_invoice_vat_percent = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 18;
  }
  if (body.companyLogoUrl === "") patch.company_logo_url = "";
  const db = getSupabase();
  const { error } = await db.from("pos_settings").upsert(patch);
  if (error) throw new Error(error.message || "Ruajtja dështoi");
  return getInvoiceSettings(clientId);
}

async function allocateInvoiceNumber(clientId) {
  const year = new Date().getFullYear();
  const db = getSupabase();
  const { data, error } = await db.rpc("allocate_invoice_number", {
    p_client_id: clientId,
    p_year: year,
  });
  if (error) {
    throw new Error(
      error.message || "Numri i faturës nuk u alokua. Ekzekuto migrimin 071 dhe RPC allocate_invoice_number.",
    );
  }
  const number = String(data || "").trim();
  if (!number) throw new Error("Përgjigje e pavlefshme nga Supabase.");
  return number;
}

async function uploadFirmLogo(clientId, { imageBase64, contentType, extension }) {
  const b64 = String(imageBase64 || "").trim();
  if (!b64) throw new Error("Mungon imazhi.");
  const buf = Buffer.from(b64, "base64");
  if (buf.length > 2 * 1024 * 1024) throw new Error("Logo shumë e madhe (max 2MB).");
  const ext = String(extension || "png").replace(/[^a-z0-9]/gi, "") || "png";
  const path = `${clientId}/logo.${ext}`;
  const db = getSupabase();
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, buf, {
    upsert: true,
    contentType: String(contentType || "image/png").trim(),
    cacheControl: "3600",
  });
  if (upErr) {
    throw new Error(upErr.message || "Upload dështoi. Krijo bucket-in firm-logos (public).");
  }
  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = String(pub?.publicUrl || "").trim();
  await db.from("pos_settings").upsert({
    client_id: clientId,
    company_logo_url: publicUrl,
    synced_at: new Date().toISOString(),
  });
  return publicUrl;
}

module.exports = {
  BUCKET,
  getSellerSnapshot,
  getInvoiceSettings,
  updateInvoiceSettings,
  allocateInvoiceNumber,
  uploadFirmLogo,
};
