/**
 * Pagesë bankare për licencë.
 * RREGULL: fatura PDF + email VETËM pasi Super Admin konfirmon pagesën.
 */
const crypto = require("crypto");
const { getSupabase } = require("../db");
const {
  packagePriceEur,
  planToPackageTier,
  planLabel,
  normalizeCheckoutPlan,
} = require("../lib/stripeConfig");
const { getBankTransferPublic } = require("../lib/bankTransferConfig");
const { createClient, createLicense } = require("./licenseService");
const { assertClientTipi, appTypeFromClientTipi } = require("../utils/businessTipi");
const { buildLicenseInvoicePdf } = require("./licenseInvoicePdfService");
const {
  isEmailConfigured,
  deliverEmail,
  resolveSupportPhone,
} = require("./emailService");

function newToken() {
  return crypto.randomUUID();
}

function metaOf(row) {
  const m = row?.metadata_json;
  if (m && typeof m === "object" && !Array.isArray(m)) return m;
  if (typeof m === "string") {
    try {
      return JSON.parse(m) || {};
    } catch {
      return {};
    }
  }
  return {};
}

async function insertPendingPayment(row) {
  const db = getSupabase();
  const { data, error } = await db
    .from("license_stripe_payments")
    .insert(row)
    .select("*")
    .single();
  if (error) {
    if (/license_stripe_payments/i.test(error.message || "")) {
      const err = new Error(
        "Tabela license_stripe_payments mungon. Ekzekutoni supabase/migrations/056_license_stripe_payments.sql",
      );
      err.code = "MISSING_TABLE";
      throw err;
    }
    throw error;
  }
  return data;
}

async function updatePaymentByToken(token, patch) {
  const db = getSupabase();
  const { data, error } = await db
    .from("license_stripe_payments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("token", token)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findByToken(token) {
  const db = getSupabase();
  const { data, error } = await db
    .from("license_stripe_payments")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function invoiceNoFor(row) {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const short = String(row.token || "").replace(/-/g, "").slice(0, 6).toUpperCase();
  return `INV-BANK-${d}-${short}`;
}

/**
 * Klienti dërgon kërkesë — status pending. NUK lëshohet faturë këtu.
 */
async function createBankTransferRequest(body) {
  const plan = normalizeCheckoutPlan(body.plan || body.package || body.package_plan);
  if (!plan) {
    const err = new Error("Zgjidhni Pako 1, 2 ose 3.");
    err.code = "INVALID_PLAN";
    throw err;
  }

  const ownerName = String(body.emri || body.owner_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.telefoni || body.phone || "").trim();
  const businessName = String(body.emri_biznesit || body.business_name || "").trim();
  const tipi = assertClientTipi(body.tipi || "restorant");
  const bankKey = String(body.bank || "raiffeisen").trim().slice(0, 40);

  if (!ownerName || !businessName || !email || !email.includes("@")) {
    const err = new Error("Emri, biznesi dhe email janë të detyrueshme.");
    err.code = "VALIDATION";
    throw err;
  }

  const packageTier = planToPackageTier(plan);
  const priceEur = packagePriceEur(plan);
  const token = newToken();
  const bank = getBankTransferPublic();

  const row = await insertPendingPayment({
    token,
    status: "pending",
    package_plan: plan,
    package_tier: packageTier,
    amount_cents: Math.round(priceEur * 100),
    currency: "eur",
    business_name: businessName,
    owner_name: ownerName,
    email,
    phone,
    tipi,
    metadata_json: {
      source: "revolution-pos-website",
      payment_method: "bank",
      bank_key: bankKey,
      bank_account: bank.account,
      bank_name: bank.bank,
      invoice_issued: false,
    },
  });

  return {
    token: row.token,
    plan,
    amountEur: priceEur,
    bank_transfer: bank,
    message:
      "Kërkesa u regjistrua. Kryeni transferin. Fatura e rregullt (PDF me vulë/datë) dërgohet me email VETËM pasi të konfirmojmë pagesën në bankë.",
  };
}

async function listBankPayments({ status } = {}) {
  const db = getSupabase();
  let q = db
    .from("license_stripe_payments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data || []).filter((r) => metaOf(r).payment_method === "bank");
  return rows.map((r) => {
    const meta = metaOf(r);
    return {
      token: r.token,
      status: r.status,
      plan: r.package_plan,
      plan_label: planLabel(r.package_plan),
      amount_eur: Number(r.amount_cents || 0) / 100,
      business_name: r.business_name,
      owner_name: r.owner_name,
      email: r.email,
      phone: r.phone,
      tipi: r.tipi,
      bank_key: meta.bank_key || "raiffeisen",
      invoice_issued: Boolean(meta.invoice_issued || meta.invoice_sent_at),
      invoice_number: meta.invoice_number || null,
      invoice_sent_at: meta.invoice_sent_at || null,
      paid_at: r.paid_at,
      created_at: r.created_at,
      client_id: r.client_id,
      license_id: r.license_id,
    };
  });
}

async function sendInvoiceEmail({ to, businessName, invoiceNo, pdfBuffer, licenseKey, amountEur }) {
  if (!isEmailConfigured()) {
    throw new Error("Emaili nuk është i konfiguruar (RESEND_API_KEY).");
  }
  const phone = resolveSupportPhone();
  const subject = `Faturë ${invoiceNo} — Revolution Invest POS`;
  const text = [
    `Përshëndetje${businessName ? ` ${businessName}` : ""},`,
    "",
    "Pagesa juaj bankare u konfirmua.",
    `Bashkangjitur: fatura e rregullt PDF (${invoiceNo}) — e nënshkruar / vulosur me datë.`,
    licenseKey ? `Çelësi i licencës: ${licenseKey}` : "",
    `Shuma: ${Number(amountEur).toFixed(2)} EUR`,
    "",
    `Mbështetje: ${phone}`,
    "Revolution Invest SH.P.K.",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <p>Përshëndetje${businessName ? ` <strong>${businessName}</strong>` : ""},</p>
    <p>Pagesa juaj bankare <strong>u konfirmua</strong>.</p>
    <p>Bashkangjitur gjeni <strong>faturën e rregullt në PDF</strong> (nënshkrim, vulë dhe datë).</p>
    ${licenseKey ? `<p>Çelësi i licencës: <strong style="letter-spacing:1px">${licenseKey}</strong></p>` : ""}
    <p>Shuma: <strong>${Number(amountEur).toFixed(2)} EUR</strong></p>
    <p style="color:#64748b;font-size:13px">Mbështetje: ${phone}<br>Revolution Invest SH.P.K.</p>
  `;

  return deliverEmail({
    to,
    subject,
    text,
    html,
    attachments: [
      {
        filename: `${invoiceNo}.pdf`,
        content: pdfBuffer.toString("base64"),
      },
    ],
  });
}

/**
 * VETËM Super Admin. Pa konfirmim → pa faturë.
 * Një buton: konfirmo pagesën + lësho PDF + email.
 */
async function confirmBankPaymentAndIssueInvoice(token, { adminEmail } = {}) {
  const row = await findByToken(String(token || "").trim());
  if (!row) {
    const err = new Error("Kërkesa e pagesës nuk u gjet.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const meta = metaOf(row);
  if (meta.payment_method !== "bank") {
    const err = new Error("Ky rresht nuk është pagesë bankare.");
    err.code = "NOT_BANK";
    throw err;
  }

  // RREGULL: pa status paid nga konfirmimi — nuk lëshohet faturë nga jashtë
  if (row.status === "paid" && meta.invoice_issued) {
    return {
      ok: true,
      already: true,
      invoice_number: meta.invoice_number,
      invoice_sent_at: meta.invoice_sent_at,
      client_id: row.client_id,
      license_id: row.license_id,
    };
  }

  if (row.status !== "pending" && !(row.status === "paid" && !meta.invoice_issued)) {
    const err = new Error(`Statusi aktual «${row.status}» — nuk mund të lëshohet faturë.`);
    err.code = "INVALID_STATUS";
    throw err;
  }

  if (row.status === "pending" && !adminEmail) {
    // adminEmail opsional por konfirmimi vjen vetëm nga admin route
  }

  let clientId = row.client_id;
  let licenseId = row.license_id;
  let licenseKey = meta.license_key || null;

  if (row.status === "pending" || !clientId || !licenseId) {
    const packageTier = row.package_tier || planToPackageTier(row.package_plan);
    const tipi = assertClientTipi(row.tipi || "restorant");
    const appType = appTypeFromClientTipi(tipi);

    const client = await createClient({
      emri: row.business_name || "Biznes i ri",
      tipi,
      package_tier: packageTier,
      email: row.email,
      telefoni: row.phone || null,
    });

    const license = await createLicense({
      client_id: client.id,
      app_type: appType,
      muaj: 12,
    });

    clientId = client.id;
    licenseId = license.id;
    licenseKey = license.celesi || null;

    await updatePaymentByToken(row.token, {
      status: "paid",
      paid_at: new Date().toISOString(),
      client_id: clientId,
      license_id: licenseId,
      metadata_json: {
        ...meta,
        payment_method: "bank",
        confirmed_by: adminEmail || "super_admin",
        confirmed_at: new Date().toISOString(),
        license_key: licenseKey,
        invoice_issued: false,
      },
    });
  }

  const fresh = await findByToken(row.token);
  const freshMeta = metaOf(fresh);
  if (freshMeta.invoice_issued) {
    return {
      ok: true,
      already: true,
      invoice_number: freshMeta.invoice_number,
      client_id: clientId,
      license_id: licenseId,
    };
  }

  const invoiceNo = invoiceNoFor(fresh);
  const invoiceDate = new Date().toISOString().slice(0, 10);
  const amountEur = Number(fresh.amount_cents || 0) / 100;
  const pdfBuffer = buildLicenseInvoicePdf({
    invoiceNo,
    invoiceDate,
    businessName: fresh.business_name,
    ownerName: fresh.owner_name,
    email: fresh.email,
    planLabel: planLabel(fresh.package_plan),
    amountEur,
    paymentMethod: "Transfer bankar (Kosovë)",
    licenseKey,
  });

  await sendInvoiceEmail({
    to: fresh.email,
    businessName: fresh.business_name,
    invoiceNo,
    pdfBuffer,
    licenseKey,
    amountEur,
  });

  const sentAt = new Date().toISOString();
  await updatePaymentByToken(row.token, {
    status: "paid",
    paid_at: fresh.paid_at || sentAt,
    client_id: clientId,
    license_id: licenseId,
    metadata_json: {
      ...freshMeta,
      payment_method: "bank",
      confirmed_by: adminEmail || freshMeta.confirmed_by || "super_admin",
      invoice_issued: true,
      invoice_number: invoiceNo,
      invoice_date: invoiceDate,
      invoice_sent_at: sentAt,
      license_key: licenseKey,
    },
  });

  return {
    ok: true,
    invoice_number: invoiceNo,
    invoice_sent_at: sentAt,
    email: fresh.email,
    client_id: clientId,
    license_id: licenseId,
    celesi: licenseKey,
  };
}

module.exports = {
  createBankTransferRequest,
  listBankPayments,
  confirmBankPaymentAndIssueInvoice,
  findByToken,
};
