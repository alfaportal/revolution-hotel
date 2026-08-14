const { trimEnv } = require("./env");

function stripeSecret() {
  return trimEnv("STRIPE_SECRET_KEY") || null;
}

function stripePublishableKey() {
  return (
    trimEnv("STRIPE_PUBLISHABLE_KEY") ||
    trimEnv("VITE_STRIPE_PUBLISHABLE_KEY") ||
    null
  );
}

function stripeWebhookSecret() {
  return trimEnv("STRIPE_WEBHOOK_SECRET") || null;
}

function paymentsConfigured() {
  return Boolean(stripeSecret());
}

/**
 * Çmime vjetore (€) — VETËM server / Stripe (JO publike në webfaqe).
 * Pako 1=150, 2=180, 3=220, 4=250 (Pako 4 vetëm me leje manuale).
 */
function packagePriceEur(plan) {
  const map = {
    p1: Number(trimEnv("STRIPE_PRICE_PAKO_1_EUR")) || 150,
    p2: Number(trimEnv("STRIPE_PRICE_PAKO_2_EUR")) || 180,
    p3: Number(trimEnv("STRIPE_PRICE_PAKO_3_EUR")) || 220,
    p4: Number(trimEnv("STRIPE_PRICE_PAKO_4_EUR")) || 250,
  };
  return Math.max(1, map[plan] || 150);
}

/**
 * plan marketing → cloud package_tier (legacy IDs).
 * p1 Standard→pako_3, p2 Pro→pako_4, p3 Full→pako_2
 */
function planToPackageTier(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "p2" || p === "pro") return "pako_4";
  if (p === "p3" || p === "full") return "pako_2";
  return "pako_3";
}

function planLabel(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "p2") return "Pako 2 — Pro (1 vit)";
  if (p === "p3") return "Pako 3 — Full (1 vit)";
  return "Pako 1 — Standard (1 vit)";
}

function normalizeCheckoutPlan(plan) {
  const p = String(plan || "").toLowerCase().trim();
  if (p === "p1" || p === "p2" || p === "p3") return p;
  if (p === "standard" || p === "pako_1") return "p1";
  if (p === "pro" || p === "pako_2") return "p2";
  if (p === "full" || p === "pako_3") return "p3";
  return null;
}

module.exports = {
  stripeSecret,
  stripePublishableKey,
  stripeWebhookSecret,
  paymentsConfigured,
  packagePriceEur,
  planToPackageTier,
  planLabel,
  normalizeCheckoutPlan,
};
