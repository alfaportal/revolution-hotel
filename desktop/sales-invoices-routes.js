"use strict";

const svc = require("./sales-invoices-service");
const { renderInvoicePdf } = require("./sales-invoice-pdf");
const { deliverEmail, isEmailConfigured, buildInvoiceA4From } = require("./sales-invoice-email");

function registerSalesInvoiceRoutes(app, { auth, adminOnly, waiterOnly }) {
  const admin = [auth, adminOnly];
  const waiter = [auth, waiterOnly];

  app.get("/api/admin/sales-invoices/settings", ...admin, (_req, res) => {
    try {
      res.json({
        ok: true,
        settings: svc.getInvoiceSettings(),
        seller: svc.getSellerSnapshot(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, gabim: e.message });
    }
  });

  app.put("/api/admin/sales-invoices/settings", ...admin, (req, res) => {
    try {
      res.json({ ok: true, settings: svc.updateInvoiceSettings(req.body || {}) });
    } catch (e) {
      res.status(400).json({ ok: false, gabim: e.message });
    }
  });

  app.post("/api/admin/sales-invoices/upload-logo", ...admin, (req, res) => {
    try {
      const url = svc.saveLogoBase64(req.body?.imageBase64, req.body?.contentType);
      res.json({ ok: true, publicUrl: url });
    } catch (e) {
      res.status(400).json({ ok: false, gabim: e.message });
    }
  });

  app.get("/api/admin/sales-invoices", ...admin, (req, res) => {
    try {
      res.json({
        ok: true,
        invoices: svc.listInvoices({
          q: req.query.q,
          status: req.query.status,
        }),
      });
    } catch (e) {
      res.status(500).json({ ok: false, gabim: e.message });
    }
  });

  app.get("/api/admin/sales-invoices/:id", ...admin, (req, res) => {
    try {
      const inv = svc.getInvoiceById(req.params.id);
      if (!inv) return res.status(404).json({ ok: false, gabim: "Nuk u gjet." });
      res.json({ ok: true, invoice: inv });
    } catch (e) {
      res.status(500).json({ ok: false, gabim: e.message });
    }
  });

  app.post("/api/admin/sales-invoices/next-number", ...admin, (_req, res) => {
    try {
      res.json({ ok: true, number: svc.allocateInvoiceNumber() });
    } catch (e) {
      res.status(503).json({ ok: false, gabim: e.message });
    }
  });

  app.post("/api/admin/sales-invoices/prefill", ...admin, (req, res) => {
    try {
      const data = svc.prefillFromSale(req.body || {});
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(400).json({ ok: false, gabim: e.message });
    }
  });

  app.post("/api/admin/sales-invoices", ...admin, (req, res) => {
    try {
      const inv = svc.saveInvoice(req.body || {});
      res.status(201).json({ ok: true, invoice: inv });
    } catch (e) {
      res.status(400).json({ ok: false, gabim: e.message });
    }
  });

  app.put("/api/admin/sales-invoices/:id", ...admin, (req, res) => {
    try {
      const inv = svc.saveInvoice(req.body || {}, { id: req.params.id });
      res.json({ ok: true, invoice: inv });
    } catch (e) {
      res.status(400).json({ ok: false, gabim: e.message });
    }
  });

  app.delete("/api/admin/sales-invoices/:id", ...admin, (req, res) => {
    try {
      res.json(svc.deleteInvoice(req.params.id));
    } catch (e) {
      res.status(400).json({ ok: false, gabim: e.message });
    }
  });

  app.post("/api/admin/sales-invoices/send-email", ...admin, async (req, res) => {
    try {
      const to = String(req.body?.to || req.body?.guestEmail || "").trim().toLowerCase();
      const invoice = req.body?.invoice || svc.buildInvoiceDocFromPayload(req.body || {});
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return res.status(400).json({ ok: false, gabim: "Email i pavlefshëm." });
      }
      if (!invoice?.number) {
        return res.status(400).json({ ok: false, gabim: "Mungon fatura." });
      }
      if (!isEmailConfigured()) {
        return res.status(503).json({ ok: false, gabim: "Nuk mund të dërgohet email." });
      }
      const pdfBuffer = await renderInvoicePdf(invoice);
      const filename = `Fature-${String(invoice.number).replace(/[^\w-]/g, "_")}.pdf`;
      const sellerName =
        invoice.sellerSnapshot?.companyName || svc.getSellerSnapshot().companyName || "Hotel";
      const data = await deliverEmail({
        to,
        from: buildInvoiceA4From(sellerName, "Hotel"),
        subject: `Faturë ${invoice.number} — ${sellerName}`,
        text: `Faturë shitje nr. ${invoice.number} nga ${sellerName}.`,
        html: `<p>Faturë shitje nr. ${invoice.number} nga ${sellerName}.</p>`,
        attachments: [{ filename, content: pdfBuffer.toString("base64") }],
      });
      res.json({ ok: true, to, resendId: data?.id || null });
    } catch (e) {
      const msg = String(e?.message || "");
      res.status(503).json({
        ok: false,
        gabim: msg === "Nuk mund të dërgohet email." ? msg : msg || "Nuk mund të dërgohet email.",
      });
    }
  });

  app.post("/api/waiter/sales-invoices/prefill", ...waiter, (req, res) => {
    try {
      const data = svc.prefillFromSale(req.body || {});
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(400).json({ ok: false, gabim: e.message });
    }
  });

  app.post("/api/waiter/sales-invoices/next-number", ...waiter, (_req, res) => {
    try {
      res.json({ ok: true, number: svc.allocateInvoiceNumber() });
    } catch (e) {
      res.status(503).json({ ok: false, gabim: e.message });
    }
  });

  app.post("/api/waiter/sales-invoices/send-email", ...waiter, async (req, res) => {
    try {
      const to = String(req.body?.to || "").trim().toLowerCase();
      const invoice = req.body?.invoice;
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return res.status(400).json({ ok: false, gabim: "Email i pavlefshëm." });
      }
      if (!invoice?.number) {
        return res.status(400).json({ ok: false, gabim: "Mungon fatura." });
      }
      if (!isEmailConfigured()) {
        return res.status(503).json({ ok: false, gabim: "Nuk mund të dërgohet email." });
      }
      const pdfBuffer = await renderInvoicePdf(invoice);
      const filename = `Fature-${String(invoice.number).replace(/[^\w-]/g, "_")}.pdf`;
      const sellerName =
        invoice.sellerSnapshot?.companyName || svc.getSellerSnapshot().companyName || "Hotel";
      const data = await deliverEmail({
        to,
        from: buildInvoiceA4From(sellerName, "Hotel"),
        subject: `Faturë ${invoice.number} — ${sellerName}`,
        text: `Faturë shitje nr. ${invoice.number}.`,
        html: `<p>Faturë shitje nr. ${invoice.number}.</p>`,
        attachments: [{ filename, content: pdfBuffer.toString("base64") }],
      });
      res.json({ ok: true, to, resendId: data?.id || null });
    } catch (e) {
      const msg = String(e?.message || "");
      res.status(503).json({
        ok: false,
        gabim: msg === "Nuk mund të dërgohet email." ? msg : msg || "Nuk mund të dërgohet email.",
      });
    }
  });
}

module.exports = { registerSalesInvoiceRoutes };
