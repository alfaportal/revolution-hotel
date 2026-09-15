const { getSupabase } = require("../db");
const { findLicenseByKey, normalizeKey } = require("./licenseService");
const { assertLicenseUsable } = require("../lib/licenseEnforcement");
const { normalizeItems, syncSaleFromPos } = require("./salesService");
const { computeItemsVat } = require("../lib/vatCategories");
const { enrichItemsWithVatCategory } = require("./menuService");

async function getFiscalSettings(clientId) {
  const db = getSupabase();
  const { data: settings } = await db
    .from("pos_settings")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  const { data: client } = await db
    .from("clients")
    .select("emri, adresa, telefoni, nui")
    .eq("id", clientId)
    .maybeSingle();

  return {
    business_name: settings?.restaurant_name || client?.emri || "",
    address: settings?.address || client?.adresa || "",
    phone: settings?.phone || client?.telefoni || "",
    nui: settings?.nui || "",
    tvsh_nr: settings?.tvsh_nr || "",
    fiscal_nr: settings?.fiscal_nr || settings?.tvsh_nr || settings?.nui || "",
    fiscal_com_port: settings?.fiscal_com_port || "",
    fiscal_enabled: settings?.fiscal_enabled !== false,
    fiscal_operator_name: settings?.fiscal_operator_name || "",
    fiscal_device_model: settings?.fiscal_device_model || "",
    pef_serial_number: settings?.pef_serial_number || "",
    default_vat_category: "A",
  };
}

async function updateFiscalSettings(clientId, body) {
  const db = getSupabase();
  const patch = {};
  if (body.fiscal_nr != null) patch.fiscal_nr = String(body.fiscal_nr).trim();
  if (body.fiscal_com_port != null) patch.fiscal_com_port = String(body.fiscal_com_port).trim();
  if (body.fiscal_enabled != null) patch.fiscal_enabled = Boolean(body.fiscal_enabled);
  if (body.fiscal_operator_name != null) {
    patch.fiscal_operator_name = String(body.fiscal_operator_name).trim();
  }
  if (body.fiscal_device_model != null) {
    patch.fiscal_device_model = String(body.fiscal_device_model).trim();
  }
  if (body.pef_serial_number != null) {
    patch.pef_serial_number = String(body.pef_serial_number).trim();
  }
  if (body.tvsh_nr != null) patch.tvsh_nr = String(body.tvsh_nr).trim();
  if (body.nui != null) patch.nui = String(body.nui).trim();

  if (!Object.keys(patch).length) throw new Error("Nuk ka fusha për përditësim.");

  const { data, error } = await db
    .from("pos_settings")
    .upsert({
      client_id: clientId,
      restaurant_name: body.restaurant_name || "",
      table_count: 10,
      synced_at: new Date().toISOString(),
      ...patch,
    })
    .select()
    .single();
  if (error) throw error;
  return getFiscalSettings(clientId);
}

async function resolveLicense(body) {
  const celesi = normalizeKey(body.celesi || body.license_key);
  if (!celesi) throw new Error("Mungon çelësi i licencës.");
  const license = await findLicenseByKey(celesi);
  assertLicenseUsable(license);
  return license;
}

/**
 * POS thërret pas pagesës:
 * - register_connected=true + fiscal_result → kupon fiskal i printuar
 * - register_connected=false / manual=true → pagesë manuale me warning
 */
async function processFiscalPayment(body) {
  const license = await resolveLicense(body);
  const clientId = license.client_id;
  const settings = await getFiscalSettings(clientId);
  const items = normalizeItems(body.items);
  if (!items.length) throw new Error("Mungon lista e artikujve.");

  const cashGiven = Number(body.cash_given ?? body.para_te_gatshme ?? body.total) || 0;
  const total = Number(body.total) || items.reduce((s, i) => s + i.price * i.quantity, 0);
  const vatItems = await enrichItemsWithVatCategory(clientId, items);
  const vat = computeItemsVat(vatItems, body.default_vat_category || "A");

  const fiscalResult = body.fiscal_result || {};
  const registerConnected = body.register_connected !== false
    && fiscalResult.register_connected !== false
    && Boolean(body.fiscal_printed || fiscalResult.printed);

  const manual = Boolean(body.manual) || !registerConnected || !settings.fiscal_enabled;
  let warning = null;

  if (!settings.fiscal_enabled) {
    warning = "Arka fiskale është çaktivizuar në settings — pagesë manuale.";
  } else if (!settings.fiscal_com_port && !registerConnected) {
    warning = "COM port i arkës fiskale nuk është konfiguruar — pagesë manuale.";
  } else if (!registerConnected) {
    warning = "Arka fiskale nuk është e lidhur — pagesë manuale e regjistruar.";
  }

  const status = manual ? "manual" : "printed";
  const now = new Date().toISOString();
  const db = getSupabase();

  const { sale } = await syncSaleFromPos({
    ...body,
    celesi: license.celesi,
    device_id: body.device_id || license.device_id,
    items,
    total,
    status: "closed",
    closed_at: now,
    receipt_number: body.receipt_number || fiscalResult.coupon_nr || "",
  });

  const receiptRow = {
    client_id: clientId,
    sale_order_id: sale?.id || null,
    local_order_id: String(body.local_order_id || sale?.local_order_id || ""),
    device_id: String(body.device_id || license.device_id || "").trim().toUpperCase(),
    fiscal_nr: settings.fiscal_nr,
    coupon_nr: String(fiscalResult.coupon_nr || body.coupon_nr || sale?.receipt_number || ""),
    serial_nr: String(fiscalResult.serial_nr || body.serial_nr || ""),
    total_gross: vat.totalGross,
    total_net: vat.totalNet,
    total_vat: vat.totalVat,
    cash_given: cashGiven,
    payment_method: String(body.payment_method || "cash").toLowerCase(),
    vat_breakdown: vat.breakdown,
    items_json: items,
    status,
    com_port: settings.fiscal_com_port,
    register_connected: !manual,
    raw_response: fiscalResult,
    printed_at: now,
  };

  const { data: fiscalReceipt, error: fiscalErr } = await db
    .from("fiscal_receipts")
    .insert(receiptRow)
    .select()
    .single();
  if (fiscalErr) throw fiscalErr;

  const paymentStatus = manual ? "manual" : "paid";
  if (sale?.id) {
    await db
      .from("sales_orders")
      .update({
        payment_status: paymentStatus,
        paid_at: now,
        fiscal_receipt_id: fiscalReceipt.id,
      })
      .eq("id", sale.id);
  }

  return {
    ok: true,
    payment_status: paymentStatus,
    fiscal_receipt: fiscalReceipt,
    sale,
    warning,
    register_connected: !manual,
    settings: {
      fiscal_nr: settings.fiscal_nr,
      fiscal_com_port: settings.fiscal_com_port,
      business_name: settings.business_name,
    },
  };
}

function suggestComPorts(current) {
  const cur = String(current || "").trim().toUpperCase();
  const alts = [];
  for (let n = 1; n <= 8 && alts.length < 3; n += 1) {
    const label = `COM${n}`;
    if (label !== cur) alts.push(label);
  }
  return alts;
}

async function getFiscalDiagnostics(clientId) {
  const settings = await getFiscalSettings(clientId);
  const db = getSupabase();
  const { data: lastReceipt } = await db
    .from("fiscal_receipts")
    .select("register_connected, com_port, printed_at, status")
    .eq("client_id", clientId)
    .order("printed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const com = String(settings.fiscal_com_port || "").trim();
  const issues = [];
  if (!settings.fiscal_enabled) {
    issues.push("Arka fiskale është çaktivizuar në settings.");
  }
  if (!com) {
    issues.push("Porti COM nuk është konfiguruar.");
  } else if (!/^COM\d+$/i.test(com)) {
    issues.push("Formati i portit COM duket i pavlefshëm (p.sh. COM3).");
  }

  let server_status = "unknown";
  if (lastReceipt?.printed_at) {
    const ageMs = Date.now() - new Date(lastReceipt.printed_at).getTime();
    if (ageMs <= 7 * 24 * 60 * 60 * 1000) {
      server_status = lastReceipt.register_connected ? "connected" : "disconnected";
    }
  }

  return {
    fiscal_enabled: settings.fiscal_enabled,
    fiscal_com_port: com,
    server_status,
    last_receipt: lastReceipt
      ? {
          register_connected: lastReceipt.register_connected,
          com_port: lastReceipt.com_port || "",
          printed_at: lastReceipt.printed_at,
          status: lastReceipt.status,
        }
      : null,
    issues,
    com_port_suggestions: suggestComPorts(com),
  };
}

/** Payload që POS Electron përdor për të dërguar komandë në COM port */
async function getFiscalPrintPayload(body) {
  const license = await resolveLicense(body);
  const settings = await getFiscalSettings(license.client_id);
  const items = normalizeItems(body.items);
  const vatItems = await enrichItemsWithVatCategory(license.client_id, items);
  const vat = computeItemsVat(vatItems, body.default_vat_category || "A");

  return {
    ok: true,
    settings,
    payload: {
      business_name: settings.business_name,
      fiscal_nr: settings.fiscal_nr,
      nui: settings.nui,
      tvsh_nr: settings.tvsh_nr,
      com_port: settings.fiscal_com_port,
      operator: settings.fiscal_operator_name,
      items,
      total_gross: vat.totalGross,
      total_net: vat.totalNet,
      total_vat: vat.totalVat,
      vat_breakdown: vat.breakdown,
      cash_given: Number(body.cash_given) || vat.totalGross,
      currency: "EUR",
      footer: "RKS MF — KUPON FISKAL",
    },
    warning: !settings.fiscal_com_port
      ? "Konfiguroni COM port në settings para printimit fiskal."
      : null,
  };
}

module.exports = {
  getFiscalSettings,
  updateFiscalSettings,
  getFiscalDiagnostics,
  processFiscalPayment,
  getFiscalPrintPayload,
};
