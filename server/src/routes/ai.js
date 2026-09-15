const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { isAiPaused, isAiEnabled } = require("../lib/aiConfig");
const { aiStaffAuth, optionalAiStaffAuth, licenseApiKeyOptional } = require("../middleware/aiAuth");
const { handleMenuScanUpload } = require("../middleware/menuScanUpload");
const { extractMenuScanImage } = require("../lib/menuScanImage");
const { trackAiUsage, resolveRestaurantId } = require("../middleware/trackAiUsage");
const { requireAiPackage } = require("../middleware/requireAiPackage");
const { sendStaffChat } = require("../services/aiChatService");
const { scanMenuFromImage } = require("../services/aiMenuScanService");
const { scanInvoiceFromImage } = require("../services/aiInvoiceScanService");
const { getAiUsageForRestaurant } = require("../services/aiUsageReportService");

const router = express.Router();

const AI_PAUSED_MSG = "AI është i ndalur për momentin. Provoni përsëri më vonë.";

const { getClientById } = require("../services/salesService");
const { clientHasFeature } = require("../lib/packages");

router.get("/status", licenseApiKeyOptional, optionalAiStaffAuth, asyncHandler(async (req, res) => {
  const restaurantId = resolveRestaurantId(req);
  let packageAi = false;
  let client = null;
  if (restaurantId) {
    client = await getClientById(restaurantId).catch(() => null);
    packageAi = clientHasFeature(client, "ai");
  }
  res.json({
    enabled: isAiEnabled() && packageAi,
    paused: isAiPaused(),
    configured: isAiEnabled(),
    package_ai: packageAi,
    package_tier: client?.package_tier || null,
  });
}));

router.post(
  "/chat",
  licenseApiKeyOptional,
  aiStaffAuth,
  requireAiPackage,
  asyncHandler(async (req, res) => {
    if (isAiPaused()) {
      return res.status(503).json({ ok: false, gabim: AI_PAUSED_MSG });
    }
    const restaurantId = resolveRestaurantId(req);
    if (!restaurantId) {
      return res.status(403).json({ ok: false, gabim: "Restoranti nuk u identifikua." });
    }

    const { message, history } = req.body || {};
    const result = await sendStaffChat({ message, history });

    await trackAiUsage(restaurantId, "chat", result.tokensUsed);

    res.json({
      ok: true,
      reply: result.reply,
      usage: {
        tokens_used: result.tokensUsed,
        provider: result.provider,
        model: result.model,
      },
    });
  }),
);

router.post(
  "/scan-menu",
  licenseApiKeyOptional,
  handleMenuScanUpload,
  aiStaffAuth,
  requireAiPackage,
  asyncHandler(async (req, res) => {
    if (isAiPaused()) {
      return res.status(503).json({ ok: false, gabim: AI_PAUSED_MSG });
    }
    const restaurantId = resolveRestaurantId(req);
    if (!restaurantId) {
      return res.status(403).json({ ok: false, gabim: "Restoranti nuk u identifikua." });
    }

    const image = extractMenuScanImage(req);
    const result = await scanMenuFromImage(image);

    await trackAiUsage(restaurantId, "scan_menu", result.tokensUsed);

    res.json({
      ok: true,
      items: result.items,
      usage: {
        tokens_used: result.tokensUsed,
        provider: result.provider,
        model: result.model,
      },
    });
  }),
);

router.post(
  "/scan-invoice",
  licenseApiKeyOptional,
  handleMenuScanUpload,
  aiStaffAuth,
  requireAiPackage,
  asyncHandler(async (req, res) => {
    if (isAiPaused()) {
      return res.status(503).json({ ok: false, gabim: AI_PAUSED_MSG });
    }
    const restaurantId = resolveRestaurantId(req);
    if (!restaurantId) {
      return res.status(403).json({ ok: false, gabim: "Restoranti nuk u identifikua." });
    }

    const image = extractMenuScanImage(req);
    let result;
    try {
      result = await scanInvoiceFromImage(image);
    } catch (err) {
      if (err && err.code === "NOT_STOCK_INVOICE") {
        return res.status(422).json({
          ok: false,
          gabim: err.message || "Dokumenti nuk është faturë blerjeje stoku.",
          document_type: err.document_type || "unknown",
          code: "NOT_STOCK_INVOICE",
        });
      }
      throw err;
    }

    await trackAiUsage(restaurantId, "scan_invoice", result.tokensUsed);

    res.json({
      ok: true,
      supplier: result.supplier,
      supplier_nui: result.supplier_nui || "",
      supplier_vat: result.supplier_vat || "",
      vat_rate: result.vat_rate != null ? result.vat_rate : 18,
      purchase_kind: result.purchase_kind || "goods",
      invoice_number: result.invoice_number,
      invoice_date: result.invoice_date || "",
      items: result.items,
      document_type: result.document_type || "stock_purchase",
      classification: result.classification || null,
      totals_check: result.totals_check || null,
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
      usage: {
        tokens_used: result.tokensUsed,
        provider: result.provider,
        model: result.model,
      },
    });
  }),
);

/** Pronari / POS — sa tokena ka harxhuar lokali (muaji aktual). */
router.get(
  "/usage",
  licenseApiKeyOptional,
  optionalAiStaffAuth,
  asyncHandler(async (req, res) => {
    const restaurantId = resolveRestaurantId(req);
    if (!restaurantId) {
      return res.status(403).json({ ok: false, gabim: "Restoranti nuk u identifikua." });
    }
    const month = req.query.month || undefined;
    const usage = await getAiUsageForRestaurant(restaurantId, { month });
    res.json(usage);
  }),
);

/** POS / license-key: lista e refuzimeve (pa AI package — e njëjta e dhënë si paneli i pronarit) */
router.get(
  "/refused-orders",
  licenseApiKeyOptional,
  aiStaffAuth,
  asyncHandler(async (req, res) => {
    const restaurantId = resolveRestaurantId(req);
    if (!restaurantId) {
      return res.status(403).json({ ok: false, gabim: "Restoranti nuk u identifikua." });
    }
    const { listRefusedOrders } = require("../services/orderRefusalService");
    const result = await listRefusedOrders(restaurantId, {
      from: req.query.from,
      to: req.query.to,
      limit: Number(req.query.limit) || 100,
    });
    res.json(result);
  }),
);

/** POS / license-key: vlerësim kamarierësh */
router.get(
  "/waiter-rating",
  licenseApiKeyOptional,
  aiStaffAuth,
  requireAiPackage,
  asyncHandler(async (req, res) => {
    const restaurantId = resolveRestaurantId(req);
    const { analyzeWaiterRatings, computeWaiterRefuseStats } = require("../services/aiWaiterRatingService");
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    if (String(req.query.analyze || "") === "1") {
      return res.json(
        await analyzeWaiterRatings(restaurantId, {
          days,
          force: String(req.query.force || "") === "1",
        }),
      );
    }
    const stats = await computeWaiterRefuseStats(restaurantId, { days });
    res.json({ ok: true, ...stats });
  }),
);

router.post(
  "/waiter-rating/analyze",
  licenseApiKeyOptional,
  aiStaffAuth,
  requireAiPackage,
  asyncHandler(async (req, res) => {
    const restaurantId = resolveRestaurantId(req);
    const { analyzeWaiterRatings } = require("../services/aiWaiterRatingService");
    res.json(
      await analyzeWaiterRatings(restaurantId, {
        days: Math.min(90, Math.max(7, Number(req.body?.days) || 30)),
        force: !!req.body?.force,
      }),
    );
  }),
);

router.get(
  "/stock-predict",
  licenseApiKeyOptional,
  aiStaffAuth,
  requireAiPackage,
  asyncHandler(async (req, res) => {
    try {
      const restaurantId = resolveRestaurantId(req);
      const { buildStockPredictPayload, generateStockPredict } = require("../services/aiStockPredictService");
      const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
      if (String(req.query.analyze || "") === "1") {
        const client = await getClientById(restaurantId);
        return res.json(
          await generateStockPredict(restaurantId, client?.emri || "", {
            days,
            sendEmail: String(req.query.email || "") === "1",
          }),
        );
      }
      res.json({ ok: true, ...(await buildStockPredictPayload(restaurantId, { days })) });
    } catch (e) {
      console.error("[ai/stock-predict]", e.message || e);
      res.status(400).json({ ok: false, gabim: e.message || "Nuk ka të dhëna stoku" });
    }
  }),
);

router.post(
  "/stock-predict/analyze",
  licenseApiKeyOptional,
  aiStaffAuth,
  requireAiPackage,
  asyncHandler(async (req, res) => {
    try {
      const restaurantId = resolveRestaurantId(req);
      const client = await getClientById(restaurantId);
      const { generateStockPredict } = require("../services/aiStockPredictService");
      res.json(
        await generateStockPredict(restaurantId, client?.emri || "", {
          days: Math.min(90, Math.max(7, Number(req.body?.days) || 30)),
          sendEmail: req.body?.send_email !== false,
        }),
      );
    } catch (e) {
      console.error("[ai/stock-predict/analyze]", e.message || e);
      res.status(400).json({ ok: false, gabim: e.message || "Nuk ka të dhëna stoku" });
    }
  }),
);

router.get(
  "/weekly-reports",
  licenseApiKeyOptional,
  aiStaffAuth,
  requireAiPackage,
  asyncHandler(async (req, res) => {
    try {
      const restaurantId = resolveRestaurantId(req);
      const { listWeeklyReports } = require("../services/aiWeeklyReportService");
      const reports = await listWeeklyReports(restaurantId, {
        limit: Number(req.query.limit) || 12,
      });
      res.json({ ok: true, reports });
    } catch (e) {
      console.error("[ai/weekly-reports]", e.message || e);
      res.status(400).json({ ok: false, gabim: e.message || "Nuk ka shitje për analizë" });
    }
  }),
);

router.post(
  "/weekly-reports/generate",
  licenseApiKeyOptional,
  aiStaffAuth,
  requireAiPackage,
  asyncHandler(async (req, res) => {
    try {
      const restaurantId = resolveRestaurantId(req);
      const client = await getClientById(restaurantId);
      if (!client) {
        return res.status(404).json({ ok: false, gabim: "Klienti nuk u gjet." });
      }
      const {
        generateWeeklyReportForClient,
        mondayOf,
        addDays,
      } = require("../services/aiWeeklyReportService");
      const { getZonedParts } = require("../services/aiDailyReportService");
      const today = getZonedParts().date;
      const weekStart =
        String(req.body?.week_start || "").trim() || addDays(mondayOf(today), -7);
      res.json(
        await generateWeeklyReportForClient(client, weekStart, {
          sendEmail: !!req.body?.send_email,
          force: !!req.body?.force,
        }),
      );
    } catch (e) {
      console.error("[ai/weekly-reports/generate]", e.message || e);
      res.status(400).json({ ok: false, gabim: e.message || "Nuk ka shitje për analizë" });
    }
  }),
);

router.post(
  "/owner-chat",
  licenseApiKeyOptional,
  aiStaffAuth,
  requireAiPackage,
  asyncHandler(async (req, res) => {
    if (isAiPaused()) {
      return res.status(503).json({ ok: false, gabim: AI_PAUSED_MSG });
    }
    const restaurantId = resolveRestaurantId(req);
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ ok: false, gabim: "Mungon mesazhi." });
    const category = String(req.body?.category || "general").trim() || "general";
    const { sendOwnerChat } = require("../services/aiChatService");
    const { buildOwnerChatContext } = require("../services/aiChatContextService");
    const context = await buildOwnerChatContext(restaurantId, { category });
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const result = await sendOwnerChat({ message, history, context });
    await trackAiUsage(restaurantId, "chat", result.tokensUsed);
    res.json({
      ok: true,
      reply: result.reply,
      category,
      usage: {
        tokens_used: result.tokensUsed,
        provider: result.provider,
        model: result.model,
      },
    });
  }),
);

module.exports = router;
