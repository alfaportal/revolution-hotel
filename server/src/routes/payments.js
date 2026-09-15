const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const {
  paymentsConfigured,
  stripePublishableKey,
  planLabel,
} = require("../lib/stripeConfig");
const {
  createLicenseCheckoutSession,
  fulfillPaidCheckoutSession,
  confirmSessionById,
} = require("../services/stripeLicenseCheckout");
const { stripeSecret, stripeWebhookSecret } = require("../lib/stripeConfig");
const { getBankTransferPublic } = require("../lib/bankTransferConfig");
const { createBankTransferRequest } = require("../services/bankTransferPaymentService");

const router = express.Router();

router.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      stripe: paymentsConfigured(),
      stripePublishableKey: stripePublishableKey(),
      bank_transfer: getBankTransferPublic(),
      // Çmimet NUK ekspozohen publikisht — vetëm statusi i Stripe
      packages: ["p1", "p2", "p3"].map((plan) => ({
        plan,
        label: planLabel(plan),
      })),
      note: "Pako 4 (AI) vetëm me leje — kontaktoni. Çmimet me telefon/email.",
    });
  }),
);

router.get(
  "/bank-transfer",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...getBankTransferPublic() });
  }),
);

/**
 * Klienti dërgon kërkesë pagese bankare.
 * Fatura PDF NUK lëshohet këtu — vetëm pasi Super Admin konfirmon pagesën.
 */
router.post(
  "/bank-transfer/request",
  asyncHandler(async (req, res) => {
    try {
      const body = req.body || {};
      const result = await createBankTransferRequest(body);
      const bank = result.bank_transfer || getBankTransferPublic();
      const lines = [
        "🏦 Kërkesë pagese BANKARE (licencë) — Në pritje",
        `Token: ${result.token}`,
        `Pako: ${planLabel(result.plan)} (${result.plan})`,
        `Shuma: ${Number(result.amountEur).toFixed(2)} EUR`,
        `Emri: ${String(body.emri || "").trim()}`,
        `Biznesi: ${String(body.emri_biznesit || body.biznesi || "").trim()}`,
        `Email: ${String(body.email || "").trim()}`,
        `Tel: ${String(body.telefoni || "").trim() || "—"}`,
        `Llogaria: ${bank.bank} · ${bank.account} ${bank.currency}`,
        "→ Kur të shohësh pagesën në bankë: Admin → Faturimi → Konfirmo & dërgo faturë PDF",
      ];
      try {
        const { notifySuperAdmin } = require("./system");
        await notifySuperAdmin(lines.join("\n"));
      } catch (err) {
        console.warn("[bank-transfer] notify:", err.message || err);
      }
      console.log("[bank-transfer]", lines.join(" | "));
      res.status(201).json({
        ok: true,
        token: result.token,
        message: result.message,
        bank_transfer: bank,
      });
    } catch (e) {
      const code = e.code || "ERROR";
      const status =
        code === "INVALID_PLAN" || code === "VALIDATION"
          ? 400
          : code === "MISSING_TABLE"
            ? 503
            : 400;
      res.status(status).json({ ok: false, gabim: e.message || String(e), code });
    }
  }),
);

router.post(
  "/checkout",
  asyncHandler(async (req, res) => {
    try {
      const result = await createLicenseCheckoutSession(req.body || {});
      res.json({ ok: true, ...result });
    } catch (e) {
      const code = e.code || "ERROR";
      const status =
        code === "PAYMENTS_NOT_CONFIGURED"
          ? 503
          : code === "INVALID_PLAN" || code === "VALIDATION"
            ? 400
            : code === "MISSING_TABLE"
              ? 503
              : 400;
      res.status(status).json({ ok: false, gabim: e.message || String(e), code });
    }
  }),
);

router.post(
  "/confirm-session",
  asyncHandler(async (req, res) => {
    const sessionId = String(req.body?.session_id || "").trim();
    if (!sessionId.startsWith("cs_")) {
      return res.status(400).json({ ok: false, gabim: "session_id i pavlefshëm." });
    }
    try {
      const result = await confirmSessionById(sessionId);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, gabim: e.message || String(e) });
    }
  }),
);

/** Webhook — duhet raw body (shih server.js). */
async function stripeWebhookHandler(req, res) {
  const secret = stripeWebhookSecret();
  const key = stripeSecret();
  if (!secret || !key) {
    return res.status(503).end();
  }
  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string") {
    return res.status(400).end();
  }
  try {
    const Stripe = require("stripe");
    const stripe = new Stripe(key);
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    const event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    if (event.type === "checkout.session.completed") {
      await fulfillPaidCheckoutSession(event.data.object);
    }
    res.json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook]", err.message || err);
    res.status(400).end();
  }
}

module.exports = {
  router,
  stripeWebhookHandler,
};
