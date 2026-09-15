/**
 * Stripe Checkout për licenca — i njëjti model si KetuJemi (session + webhook).
 * Nuk kopjon sekretet: vendosi STRIPE_* në Railway nga llogaria jote Stripe / KetuJemi.
 */
const crypto = require("crypto");
const { getSupabase } = require("../db");
const { getPublicAppOrigin } = require("../lib/publicOrigin");
const {
  stripeSecret,
  paymentsConfigured,
  packagePriceEur,
  planToPackageTier,
  planLabel,
  normalizeCheckoutPlan,
} = require("../lib/stripeConfig");
const { createClient, createLicense } = require("./licenseService");
const { assertClientTipi, appTypeFromClientTipi } = require("../utils/businessTipi");

function newToken() {
  return crypto.randomUUID();
}

async function getStripe() {
  const secret = stripeSecret();
  if (!secret) throw new Error("PAYMENTS_NOT_CONFIGURED");
  const Stripe = require("stripe");
  return new Stripe(secret);
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

async function findBySessionId(sessionId) {
  const db = getSupabase();
  const { data, error } = await db
    .from("license_stripe_payments")
    .select("*")
    .eq("stripe_session_id", sessionId)
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

/**
 * @param {{ plan, emri, email, telefoni, emri_biznesit, tipi }} body
 */
async function createLicenseCheckoutSession(body) {
  if (!paymentsConfigured()) {
    const err = new Error("Stripe nuk është i konfiguruar (STRIPE_SECRET_KEY).");
    err.code = "PAYMENTS_NOT_CONFIGURED";
    throw err;
  }

  const plan = normalizeCheckoutPlan(body.plan || body.package || body.package_plan);
  if (!plan) {
    const err = new Error("Zgjidhni Pako 1, 2 ose 3. Pako 4 (AI) blihet me kontakt.");
    err.code = "INVALID_PLAN";
    throw err;
  }

  const ownerName = String(body.emri || body.owner_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.telefoni || body.phone || "").trim();
  const businessName = String(body.emri_biznesit || body.business_name || "").trim();
  const tipi = assertClientTipi(body.tipi || "restorant");

  if (!ownerName) throw Object.assign(new Error("Emri është i detyrueshëm."), { code: "VALIDATION" });
  if (!email || !email.includes("@")) {
    throw Object.assign(new Error("Email i vlefshëm është i detyrueshëm."), { code: "VALIDATION" });
  }
  if (!businessName) {
    throw Object.assign(new Error("Emri i biznesit është i detyrueshëm."), { code: "VALIDATION" });
  }

  const packageTier = planToPackageTier(plan);
  const priceEur = packagePriceEur(plan);
  const amountCents = Math.round(priceEur * 100);
  const token = newToken();
  const origin = getPublicAppOrigin();

  await insertPendingPayment({
    token,
    status: "pending",
    package_plan: plan,
    package_tier: packageTier,
    amount_cents: amountCents,
    currency: "eur",
    business_name: businessName,
    owner_name: ownerName,
    email,
    phone,
    tipi,
    metadata_json: { source: "revolution-pos-website" },
  });

  const stripe = await getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: "eur",
          unit_amount: amountCents,
          product_data: {
            name: `Revolution POS — ${planLabel(plan)}`,
            description: "Licencë vjetore (1 vit) + Setup Windows. Pagesë me kartë.",
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}/#si-ta-merrni?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#pakot?payment=cancelled`,
    client_reference_id: token,
    metadata: {
      payment_token: token,
      package_plan: plan,
      package_tier: packageTier,
      business_name: businessName.slice(0, 200),
      owner_name: ownerName.slice(0, 200),
      email,
      phone: phone.slice(0, 40),
      tipi,
    },
  });

  if (!session.url) {
    throw Object.assign(new Error("Stripe session dështoi."), { code: "STRIPE_SESSION_FAILED" });
  }

  await updatePaymentByToken(token, { stripe_session_id: session.id });

  return {
    url: session.url,
    token,
    sessionId: session.id,
    plan,
    amountEur: priceEur,
  };
}

/** Pas pagesës — krijo klient + licencë 12 muaj (një herë). */
async function fulfillPaidCheckoutSession(session) {
  if (!session || session.payment_status === "unpaid") return { ok: false, reason: "unpaid" };

  const token =
    session.metadata?.payment_token ||
    session.client_reference_id ||
    "";
  let row = token ? await findByToken(token) : null;
  if (!row && session.id) row = await findBySessionId(session.id);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "paid" && row.license_id) {
    return { ok: true, already: true, client_id: row.client_id, license_id: row.license_id };
  }

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

  const pi =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

  await updatePaymentByToken(row.token, {
    status: "paid",
    paid_at: new Date().toISOString(),
    client_id: client.id,
    license_id: license.id,
    stripe_session_id: session.id || row.stripe_session_id,
    stripe_payment_intent: pi,
  });

  return {
    ok: true,
    client_id: client.id,
    license_id: license.id,
    celesi: license.celesi || null,
  };
}

async function confirmSessionById(sessionId) {
  const stripe = await getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  return fulfillPaidCheckoutSession(session);
}

module.exports = {
  paymentsConfigured,
  createLicenseCheckoutSession,
  fulfillPaidCheckoutSession,
  confirmSessionById,
  findByToken,
  findBySessionId,
};
