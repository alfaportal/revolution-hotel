/**
 * Fatura A4 shitje — panel pronari (JWT). Numri Supabase, logo Storage, email Resend.
 */
const express = require("express");
const { deliverEmail, isEmailConfigured, buildInvoiceA4From } = require("../services/emailService");
const { renderInvoicePdf } = require("../services/salesInvoicePdfService");
const {
  getSellerSnapshot,
  getInvoiceSettings,
  updateInvoiceSettings,
  allocateInvoiceNumber,
  uploadFirmLogo,
} = require("../services/salesInvoiceService");

const router = express.Router();

router.get("/settings", async (req, res) => {
  try {
    const clientId = req.user.client_id;
    if (!clientId) {
      return res.status(403).json({ ok: false, gabim: "Mungon lokali aktiv." });
    }
    const [settings, seller] = await Promise.all([
      getInvoiceSettings(clientId),
      getSellerSnapshot(clientId),
    ]);
    res.json({ ok: true, clientId, settings, seller });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || "Gabim serveri" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const settings = await updateInvoiceSettings(req.user.client_id, req.body || {});
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || "Gabim serveri" });
  }
});

router.post("/next-number", async (req, res) => {
  try {
    const number = await allocateInvoiceNumber(req.user.client_id);
    res.json({ ok: true, number });
  } catch (e) {
    console.error("[sales-invoices/next-number]", e.message || e);
    res.status(503).json({ ok: false, gabim: e.message || "Numri nuk u alokua." });
  }
});

router.post("/upload-logo", async (req, res) => {
  try {
    const publicUrl = await uploadFirmLogo(req.user.client_id, req.body || {});
    res.json({ ok: true, publicUrl });
  } catch (e) {
    console.error("[sales-invoices/upload-logo]", e.message || e);
    res.status(503).json({ ok: false, gabim: e.message || "Upload dështoi." });
  }
});

router.post("/send-email", async (req, res) => {
  try {
    const to = String(
      req.body?.to || req.body?.guestEmail || req.body?.buyerEmail || "",
    ).trim().toLowerCase();
    const invoice = req.body?.invoice;
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ ok: false, gabim: "Email i mysafirit/klientit është i pavlefshëm." });
    }
    if (!invoice || !invoice.number) {
      return res.status(400).json({ ok: false, gabim: "Mungon fatura." });
    }
    if (!isEmailConfigured()) {
      return res.status(503).json({
        ok: false,
        gabim: "RESEND_API_KEY mungon te Railway (revolution-hotel-server).",
      });
    }
    const pdfBuffer = await renderInvoicePdf(invoice);
    const filename = `Fature-${String(invoice.number).replace(/[^\w-]/g, "_")}.pdf`;
    const sellerName = invoice.sellerSnapshot?.companyName || "Hotel";
    const subject = `Faturë ${invoice.number} — ${sellerName}`;
    const text = `Faturë shitje nr. ${invoice.number} nga ${sellerName}.`;
    const data = await deliverEmail({
      to,
      from: buildInvoiceA4From(sellerName, "Hotel"),
      subject,
      text,
      html: `<p>${text}</p>`,
      attachments: [{
        filename,
        content: pdfBuffer.toString("base64"),
      }],
    });
    res.json({ ok: true, to, resendId: data?.id || null });
  } catch (e) {
    console.error("[sales-invoices/send-email]", e.message || e);
    res.status(503).json({ ok: false, gabim: e.message || "Email nuk u dërgua." });
  }
});

module.exports = router;
