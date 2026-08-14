const express = require("express");
const { authOwner, ownerOnly } = require("../middleware/auth");
const {
  getOwnerStats,
  getOwnerStatsForGroup,
  listOwnerOrders,
  getOwnerOrderFilters,
  getOwnerReport,
  getClientById,
  getLiveTablesForOwner,
  voidOwnerOrder,
} = require("../services/salesService");
const {
  EXPENSE_CATEGORIES,
  listOwnerExpenses,
  createOwnerExpense,
  updateOwnerExpense,
  deleteOwnerExpense,
} = require("../services/ownerExpenseService");
const {
  getOwnerLicenseView,
  verifyOwnerLicenseKey,
} = require("../services/licenseService");
const {
  buildDailyZReport,
  buildDailyXReport,
  buildPeriodicReport,
  saveDailyZReport,
  setOpeningFloat,
  listZReportHistory,
  zReportToCsv,
  zReportToHtml,
} = require("../services/zReportService");
const { getFiscalSettings, updateFiscalSettings, getFiscalDiagnostics } = require("../services/fiscalService");
const {
  getRegisterSwitchState,
  setRegisterMode,
} = require("../services/registerSwitchService");
const {
  listOwnerMenu,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getOwnerMenuItemPhoto,
} = require("../services/menuService");
const { listOwnerActivity } = require("../services/ownerAuditService");
const {
  listCatalogForOwner,
  addItemsFromCatalog,
} = require("../services/menuCatalogTemplateService");
const {
  listStockForOwner,
  getStockSummary,
  updateStockSettings,
  restockItem,
} = require("../services/stockService");
const {
  listVenue,
  addArea,
  updateArea,
  deleteArea,
  addStaff,
  updateStaff,
  deleteStaff,
} = require("../services/venueService");
const {
  listWaitersForOwner,
  addWaiterWithPin,
  updateWaiterWithPin,
  deleteWaiterWithPin,
  ensureWaiterWebToken,
  getWaiterById,
} = require("../services/waiterPinService");
const { buildTablesFromAreas } = require("../lib/tableLayout");
const { getAssignmentState, setWaiterTables } = require("../services/waiterTablesService");
const { ensureKitchenCredentials, buildClientWebLinks, buildWaiterUrl, buildWaiterKitchenUrl } = require("../lib/kitchenAccess");
const { featuresForTier } = require("../lib/packages");
const { listKioskQrCodes, listTableQrMeta, getTableQrCode, getTableQrPng, qrPrintHtml, singleQrPrintHtml, tableMenuUrl } = require("../services/kioskQrService");
const {
  getOwnerPublicPageSettings,
  updateOwnerPublicPageSettings,
  updateOwnerKitchenSlug,
  getOwnerPublicPageQr,
  getOwnerPublicPageQrPng,
} = require("../services/publicPageService");
const { getPublicAppOrigin } = require("../lib/publicOrigin");
const {
  listOwnerReservations,
  createOwnerReservation,
  updateOwnerReservationStatus,
  getMaxTableNumber,
} = require("../services/reservationService");
const {
  listIngredients,
  listInventoryAlerts,
  createIngredient,
  updateIngredient,
  applyInvoiceScanItems,
} = require("../services/inventoryService");
const { requireAiPackage } = require("../middleware/requireAiPackage");
const {
  listReportsForClient,
  getReportByDate,
  getTodayReport,
  generateDailyReportForClient,
  getZonedParts,
  getProfitForecastForClient,
} = require("../services/aiDailyReportService");
const {
  getSuggestionsByDate,
  generateForClient,
  sendSupplierEmail,
} = require("../services/supplySuggestionService");
const { sendOwnerChat } = require("../services/aiChatService");
const { buildOwnerChatContext } = require("../services/aiChatContextService");
const {
  listChatHistory,
  appendChatMessage,
  clearChatHistory,
} = require("../services/aiChatHistoryService");
const { trackAiUsage } = require("../middleware/trackAiUsage");
const {
  getNotificationSettings,
  saveNotificationSettings,
  getNotificationCapabilities,
} = require("../services/notificationSettingsService");
const { sendTestNotification } = require("../services/pushNotificationService");
const {
  listLocationsForUser,
  buildOwnerAuthContext,
  listGroupClientIds,
  getUserRow,
} = require("../services/ownerGroupService");
const { issueOwnerSession } = require("../lib/ownerSession");

const router = express.Router();

const { subscribe: subscribeTableEvents } = require("../services/kdsEvents");
const { verifyToken } = require("../middleware/auth");

/** SSE — rifreskim i menjëhershëm i tavolinave live (token në query për EventSource) */
router.get("/tables/events", (req, res) => {
  const header = req.headers.authorization || "";
  const cookie = req.cookies?.owner_token;
  const queryToken = typeof req.query?.token === "string" ? req.query.token.trim() : "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (cookie || queryToken);
  if (!token) return res.status(401).end();
  try {
    const user = verifyToken(token);
    if (user.roli !== "client_admin" || !user.client_id) {
      return res.status(403).end();
    }
    subscribeTableEvents(user.client_id, res);
  } catch {
    res.status(401).end();
  }
});

router.use(authOwner, ownerOnly);

router.get("/locations", async (req, res) => {
  try {
    const data = await listLocationsForUser(req.user.sub, req.user.client_id);
    res.json({
      ok: true,
      ...data,
      view_all: !!req.user.view_all,
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.post("/switch-location", async (req, res) => {
  try {
    const user = await getUserRow(req.user.sub);
    if (!user) {
      return res.status(403).json({ gabim: "Llogaria e pronarit nuk u gjet." });
    }

    const viewAll = req.body?.view_all === true;
    const rawClientId = req.body?.client_id;
    const clientId =
      rawClientId != null && String(rawClientId).trim()
        ? String(rawClientId).trim()
        : req.user.client_id;

    const authPayload = await buildOwnerAuthContext(user, { clientId, viewAll });
    const token = issueOwnerSession(res, authPayload);
    const loc = await listLocationsForUser(user.id, authPayload.client_id);

    res.json({
      ok: true,
      token,
      user: authPayload,
      ...loc,
      view_all: authPayload.view_all,
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/client", async (req, res) => {
  try {
    if (req.user.view_all && req.user.owner_group_id) {
      const loc = await listLocationsForUser(req.user.sub, req.user.client_id);
      const count = loc.locations?.length || 0;
      const primary = loc.locations?.[0];
      const features = featuresForTier(primary?.package_tier);
      return res.json({
        ok: true,
        view_all: true,
        location_count: count,
        locations: loc.locations,
        client: {
          emri: count > 1 ? `Të gjitha lokalet (${count})` : primary?.emri || "Paneli i pronarit",
          tipi: primary?.tipi || "",
          adresa: "",
        },
        features,
        links: {},
        waiter_url: null,
        kitchen_url: null,
        bar_url: null,
      });
    }

    let client = await getClientById(req.user.client_id);
    if (client) {
      client = await ensureKitchenCredentials(client);
    }
    const base = getPublicAppOrigin();
    const features = featuresForTier(client?.package_tier);
    const built = buildClientWebLinks(base, client, client?.package_tier);
    const links = {
      waiter: built.waiter_url || null,
      kitchen: built.kitchen_url || null,
      bar: built.bar_url || null,
      kiosk: built.kiosk_url || null,
      public_page: built.public_page_url || null,
    };
    res.json({
      ok: true,
      view_all: false,
      client: client
        ? {
            emri: client.emri,
            tipi: client.tipi,
            adresa: client.adresa,
            telefoni: client.telefoni,
            email: client.email,
            package_tier: client.package_tier,
          }
        : null,
      features,
      links,
      waiter_url: links.waiter || null,
      kitchen_url: links.kitchen || null,
      bar_url: links.bar || null,
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.get("/stats", async (req, res) => {
  try {
    let stats;
    if (req.user.view_all && req.user.owner_group_id) {
      const ids = await listGroupClientIds(req.user.owner_group_id);
      stats = await getOwnerStatsForGroup(ids);
    } else {
      stats = await getOwnerStats(req.user.client_id);
    }
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.get("/orders/filters", async (req, res) => {
  try {
    const filters = await getOwnerOrderFilters(req.user.client_id);
    res.json({ ok: true, ...filters });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.get("/orders", async (req, res) => {
  try {
    const orders = await listOwnerOrders(req.user.client_id, {
      limit: req.query.limit,
      waiter: req.query.waiter,
      table: req.query.table,
    });
    res.json({ ok: true, orders });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.post("/orders/:id/void", async (req, res) => {
  try {
    const result = await voidOwnerOrder(req.user.client_id, req.params.id, {
      reason: req.body?.reason,
      note: req.body?.note,
      actorEmail: req.user.email,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/tables/live", async (req, res) => {
  try {
    const live = await getLiveTablesForOwner(req.user.client_id);
    res.json({ ok: true, ...live });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.get("/reports", async (req, res) => {
  try {
    const report = await getOwnerReport(
      req.user.client_id,
      req.query.from,
      req.query.to,
    );
    res.json({ ok: true, report });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.get("/audit-log", async (req, res) => {
  try {
    const entries = await listOwnerActivity(req.user.client_id, {
      limit: Number(req.query.limit) || 100,
      action: req.query.action || "",
    });
    res.json({ ok: true, entries });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.get("/expenses", async (req, res) => {
  try {
    const expenses = await listOwnerExpenses(req.user.client_id, {
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
    });
    res.json({ ok: true, expenses, categories: EXPENSE_CATEGORIES });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.post("/expenses", async (req, res) => {
  try {
    const expense = await createOwnerExpense(req.user.client_id, req.body, req.user.email);
    res.status(201).json({ ok: true, expense });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.patch("/expenses/:id", async (req, res) => {
  try {
    const expense = await updateOwnerExpense(req.user.client_id, req.params.id, req.body, req.user.email);
    res.json({ ok: true, expense });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.delete("/expenses/:id", async (req, res) => {
  try {
    const result = await deleteOwnerExpense(req.user.client_id, req.params.id, req.user.email);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/license", async (req, res) => {
  try {
    res.json({
      ok: true,
      ...(await getOwnerLicenseView(req.user.client_id, { userId: req.user.sub })),
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.put("/license", async (req, res) => {
  try {
    const { license_key } = req.body || {};
    const view = await verifyOwnerLicenseKey(req.user.client_id, license_key, {
      userId: req.user.sub,
    });
    res.json({
      ok: true,
      ...view,
      info: "Çelësi u verifikua. Për aktivizim të plotë, vendoseni të njëjtin çelës te POS: Admin → Licenca (në kompjuterin e restorantit).",
    });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/fiscal/settings", async (req, res) => {
  try {
    const settings = await getFiscalSettings(req.user.client_id);
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.get("/fiscal/diagnostics", async (req, res) => {
  try {
    const diagnostics = await getFiscalDiagnostics(req.user.client_id);
    res.json({ ok: true, diagnostics });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.patch("/fiscal/settings", async (req, res) => {
  try {
    const settings = await updateFiscalSettings(req.user.client_id, req.body);
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/register-switch", async (req, res) => {
  try {
    const state = await getRegisterSwitchState(req.user.client_id);
    res.json({ ok: true, ...state });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.put("/register-switch/mode", async (req, res) => {
  try {
    const state = await setRegisterMode(req.user.client_id, req.body?.mode, req.user.email);
    res.json({ ok: true, ...state });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/x-report", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const report = await buildDailyXReport(req.user.client_id, date);
    res.json({ ok: true, report });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.get("/x-report/export", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const format = String(req.query.format || "csv").toLowerCase();
    const report = await buildDailyXReport(req.user.client_id, date);

    if (format === "html" || format === "pdf") {
      const html = zReportToHtml(report);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="x-report-${date}.html"`);
      return res.send(html);
    }

    const csv = zReportToCsv(report);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="x-report-${date}.csv"`);
    res.send("\uFEFF" + csv);
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.get("/z-report", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const report = await buildDailyZReport(req.user.client_id, date);
    res.json({ ok: true, report });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.post("/z-report/close", async (req, res) => {
  try {
    const date = req.body?.date || new Date().toISOString().slice(0, 10);
    const report = await saveDailyZReport(req.user.client_id, date, {
      close: true,
      closing_cash_actual: req.body?.closing_cash_actual,
      cash_difference_reason: req.body?.cash_difference_reason,
    });
    res.json({ ok: true, report });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.put("/z-report/opening-float", async (req, res) => {
  try {
    const date = req.body?.date || new Date().toISOString().slice(0, 10);
    const report = await setOpeningFloat(req.user.client_id, date, req.body?.opening_float);
    res.json({ ok: true, report });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/z-report/history", async (req, res) => {
  try {
    const history = await listZReportHistory(req.user.client_id, Number(req.query.limit) || 60);
    res.json({ ok: true, history });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.get("/z-report/export", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const format = String(req.query.format || "csv").toLowerCase();
    const report = await buildDailyZReport(req.user.client_id, date);

    if (format === "html" || format === "pdf") {
      const html = zReportToHtml(report);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="z-report-${date}.html"`);
      return res.send(html);
    }

    const csv = zReportToCsv(report);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="z-report-${date}.csv"`);
    res.send("\uFEFF" + csv);
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.get("/periodic-report", async (req, res) => {
  try {
    const from = req.query.from || req.query.from_date;
    const to = req.query.to || req.query.to_date;
    const report = await buildPeriodicReport(req.user.client_id, from, to);
    res.json({ ok: true, report });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/periodic-report/export", async (req, res) => {
  try {
    const from = req.query.from || req.query.from_date;
    const to = req.query.to || req.query.to_date;
    const format = String(req.query.format || "csv").toLowerCase();
    const report = await buildPeriodicReport(req.user.client_id, from, to);
    const slug = `${report.from_date}_${report.to_date}`;

    if (format === "html" || format === "pdf") {
      const html = zReportToHtml(report);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="periodic-report-${slug}.html"`);
      return res.send(html);
    }

    const csv = zReportToCsv(report);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="periodic-report-${slug}.csv"`);
    res.send("\uFEFF" + csv);
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/menu", async (req, res) => {
  try {
    const menu = await listOwnerMenu(req.user.client_id);
    res.json({ ok: true, ...menu });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.post("/menu", async (req, res) => {
  try {
    const result = await addMenuItem(req.user.client_id, req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

/** Open Food Facts — USB barcode scanner (numra + Enter) → emër produkti. */
router.get("/menu/barcode-lookup/:code", async (req, res) => {
  try {
    const { lookupOpenFoodFacts } = require("../lib/barcodeLookup");
    const result = await lookupOpenFoodFacts(req.params.code);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(502).json({
      ok: false,
      found: false,
      gabim: e.message || "Open Food Facts nuk u përgjigj",
    });
  }
});

router.get("/menu/catalog", async (req, res) => {
  try {
    const catalog = await listCatalogForOwner(req.user.client_id);
    res.json({ ok: true, ...catalog });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.post("/menu/from-catalog", async (req, res) => {
  try {
    const result = await addItemsFromCatalog(req.user.client_id, req.body.items);
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/menu/:id/photo", async (req, res) => {
  try {
    const photo = await getOwnerMenuItemPhoto(req.user.client_id, req.params.id);
    if (!photo) {
      return res.status(404).type("text/plain").send("Not found");
    }
    res.setHeader("Cache-Control", "private, max-age=300");
    res.type(photo.mime).send(photo.buffer);
  } catch (e) {
    res.status(400).type("text/plain").send(e.message);
  }
});

router.patch("/menu/:id", async (req, res) => {
  try {
    const result = await updateMenuItem(req.user.client_id, req.params.id, req.body, req.user.email);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.delete("/menu/:id", async (req, res) => {
  try {
    const result = await deleteMenuItem(req.user.client_id, req.params.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/stock", async (req, res) => {
  try {
    const stock = await listStockForOwner(req.user.client_id);
    res.json({ ok: true, ...stock });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.get("/stock/summary", async (req, res) => {
  try {
    const summary = await getStockSummary(req.user.client_id);
    res.json({ ok: true, summary });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.patch("/stock/:id", async (req, res) => {
  try {
    const result = await updateStockSettings(req.user.client_id, req.params.id, req.body);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.post("/stock/:id/restock", async (req, res) => {
  try {
    const add = req.body.add ?? req.body.quantity ?? req.body.qty;
    const result = await restockItem(req.user.client_id, req.params.id, add);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/ingredients", async (req, res) => {
  try {
    const ingredients = await listIngredients(req.user.client_id);
    res.json({ ok: true, ingredients });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.post("/ingredients", async (req, res) => {
  try {
    const ingredient = await createIngredient(req.user.client_id, req.body);
    res.status(201).json({ ok: true, ingredient });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.patch("/ingredients/:id", async (req, res) => {
  try {
    const ingredient = await updateIngredient(req.user.client_id, req.params.id, req.body);
    res.json({ ok: true, ingredient });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/inventory/alerts", async (req, res) => {
  try {
    const alerts = await listInventoryAlerts(req.user.client_id);
    res.json({ ok: true, alerts, count: alerts.length });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.post("/inventory/apply-invoice-scan", requireAiPackage, async (req, res) => {
  try {
    const result = await applyInvoiceScanItems(req.user.client_id, req.body || {});
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/**
 * Blerje MANUALE nga telefon/panel — pa AI skanim.
 * Pronari shënon faturën → radhë POS → stok + Blerjet + Kontabilisti në desktop.
 */
router.post("/purchases", async (req, res) => {
  try {
    const { enqueuePendingPurchase } = require("../services/posPendingPurchaseService");
    const body = req.body || {};
    const pos_queue = await enqueuePendingPurchase(req.user.client_id, {
      supplier: body.supplier,
      invoice_number: body.invoice_number,
      invoice_date: body.invoice_date,
      items: body.items,
      supplier_nui: body.supplier_nui,
      supplier_vat: body.supplier_vat,
      vat_rate: body.vat_rate,
      purchase_kind: body.purchase_kind,
      source: "manual_purchase",
    });
    res.status(201).json({
      ok: true,
      pos_pending: true,
      queued: pos_queue,
      message:
        "Blerja u dërgua te POS. Stoku, Blerjet dhe Kontabilisti përditësohen automatikisht në desktop.",
    });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.get("/ai-reports", requireAiPackage, async (req, res) => {
  try {
    const limit = Math.min(90, Number(req.query.limit) || 30);
    const reports = await listReportsForClient(req.user.client_id, { limit });
    res.json({ ok: true, reports, today: getZonedParts().date });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.get("/ai-reports/profit-forecast", requireAiPackage, async (req, res) => {
  try {
    const client = await getClientById(req.user.client_id);
    const forecast = await getProfitForecastForClient(req.user.client_id, client?.emri || "");
    res.json({ ok: true, profit_forecast: forecast, today: getZonedParts().date });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/ai-reports/profit-forecast/refresh", requireAiPackage, async (req, res) => {
  try {
    const client = await getClientById(req.user.client_id);
    const { buildProfitForecast } = require("../services/profitForecastService");
    const forecast = await buildProfitForecast(req.user.client_id, client?.emri || "");
    const today = getZonedParts().date;
    if (forecast.tokens_used > 0) {
      await trackAiUsage(req.user.client_id, "profit_forecast", forecast.tokens_used);
    }
    const existing = await getReportByDate(req.user.client_id, today);
    if (existing) {
      const db = require("../db").getSupabase();
      await db
        .from("ai_daily_reports")
        .update({ profit_forecast: forecast })
        .eq("restaurant_id", req.user.client_id)
        .eq("report_date", today);
    }
    res.json({ ok: true, profit_forecast: forecast });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.get("/ai-reports/today", requireAiPackage, async (req, res) => {
  try {
    const report = await getTodayReport(req.user.client_id);
    if (!report) {
      return res.status(404).json({ ok: false, gabim: "Ende nuk ka raport për sot." });
    }
    res.json({ ok: true, report });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.get("/ai-reports/:date", requireAiPackage, async (req, res) => {
  try {
    const date = String(req.params.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, gabim: "Data e pavlefshme." });
    }
    const report = await getReportByDate(req.user.client_id, date);
    if (!report) {
      return res.status(404).json({ ok: false, gabim: "Nuk ka raport për këtë datë." });
    }
    res.json({ ok: true, report });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/ai-reports/generate", requireAiPackage, async (req, res) => {
  try {
    const client = await getClientById(req.user.client_id);
    const date = String(req.body?.date || getZonedParts().date).slice(0, 10);
    const force = !!req.body?.force;
    const sendEmail = req.body?.send_email !== false;
    const result = await generateDailyReportForClient(client, date, { sendEmail, force });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.get("/supply-suggestions", requireAiPackage, async (req, res) => {
  try {
    const date = String(req.query.date || getZonedParts().date).slice(0, 10);
    const suggestions = await getSuggestionsByDate(req.user.client_id, date);
    const aiSummary = suggestions.find(s => s.ai_summary)?.ai_summary || "";
    res.json({
      ok: true,
      suggestions,
      date,
      today: getZonedParts().date,
      ai_summary: aiSummary,
      email_sent: suggestions.some(s => s.email_sent_at),
    });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/supply-suggestions/generate", requireAiPackage, async (req, res) => {
  try {
    const client = await getClientById(req.user.client_id);
    const date = String(req.body?.date || getZonedParts().date).slice(0, 10);
    const force = !!req.body?.force;
    const result = await generateForClient(client, date, { force });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/supply-suggestions/send-email", requireAiPackage, async (req, res) => {
  try {
    const client = await getClientById(req.user.client_id);
    const result = await sendSupplierEmail(client.id, client, {
      suggestionDate: String(req.body?.date || getZonedParts().date).slice(0, 10),
      supplierName: req.body?.supplier_name || req.body?.supplier || "",
      to: req.body?.to || req.body?.email || "",
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/** Lista e porosive të refuzuara (arsye + kamarier) — pa AI package */
router.get("/refused-orders", async (req, res) => {
  try {
    const { listRefusedOrders } = require("../services/orderRefusalService");
    const result = await listRefusedOrders(req.user.client_id, {
      from: req.query.from,
      to: req.query.to,
      limit: Number(req.query.limit) || 100,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.get("/ai-waiter-rating", requireAiPackage, async (req, res) => {
  try {
    const { analyzeWaiterRatings, computeWaiterRefuseStats } = require("../services/aiWaiterRatingService");
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    if (String(req.query.analyze || "") === "1") {
      const result = await analyzeWaiterRatings(req.user.client_id, {
        days,
        force: String(req.query.force || "") === "1",
      });
      return res.json(result);
    }
    const stats = await computeWaiterRefuseStats(req.user.client_id, { days });
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/ai-waiter-rating/analyze", requireAiPackage, async (req, res) => {
  try {
    const { analyzeWaiterRatings } = require("../services/aiWaiterRatingService");
    const days = Math.min(90, Math.max(7, Number(req.body?.days) || 30));
    const result = await analyzeWaiterRatings(req.user.client_id, {
      days,
      force: !!req.body?.force,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.get("/ai-stock-predict", requireAiPackage, async (req, res) => {
  try {
    const { buildStockPredictPayload, generateStockPredict } = require("../services/aiStockPredictService");
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    if (String(req.query.analyze || "") === "1") {
      const client = await getClientById(req.user.client_id);
      const result = await generateStockPredict(req.user.client_id, client?.emri || "", {
        days,
        sendEmail: String(req.query.email || "") === "1",
      });
      return res.json(result);
    }
    const payload = await buildStockPredictPayload(req.user.client_id, { days });
    res.json({ ok: true, ...payload });
  } catch (e) {
    console.error("[owner/ai-stock-predict]", e.message || e);
    res.status(400).json({ ok: false, gabim: e.message || "Nuk ka të dhëna stoku" });
  }
});

router.post("/ai-stock-predict/analyze", requireAiPackage, async (req, res) => {
  try {
    const { generateStockPredict } = require("../services/aiStockPredictService");
    const client = await getClientById(req.user.client_id);
    const days = Math.min(90, Math.max(7, Number(req.body?.days) || 30));
    const result = await generateStockPredict(req.user.client_id, client?.emri || "", {
      days,
      sendEmail: req.body?.send_email !== false,
    });
    res.json(result);
  } catch (e) {
    console.error("[owner/ai-stock-predict/analyze]", e.message || e);
    res.status(400).json({ ok: false, gabim: e.message || "Nuk ka të dhëna stoku" });
  }
});

router.get("/ai-weekly-reports", requireAiPackage, async (req, res) => {
  try {
    const { listWeeklyReports } = require("../services/aiWeeklyReportService");
    const reports = await listWeeklyReports(req.user.client_id, {
      limit: Number(req.query.limit) || 12,
    });
    res.json({ ok: true, reports });
  } catch (e) {
    console.error("[owner/ai-weekly-reports]", e.message || e);
    res.status(400).json({ ok: false, gabim: e.message || "Nuk ka shitje për analizë" });
  }
});

router.post("/ai-weekly-reports/generate", requireAiPackage, async (req, res) => {
  try {
    const {
      generateWeeklyReportForClient,
      mondayOf,
      addDays,
    } = require("../services/aiWeeklyReportService");
    const client = await getClientById(req.user.client_id);
    if (!client) {
      return res.status(404).json({ ok: false, gabim: "Klienti nuk u gjet." });
    }
    const today = getZonedParts().date;
    const weekStart =
      String(req.body?.week_start || "").trim() || addDays(mondayOf(today), -7);
    const result = await generateWeeklyReportForClient(client, weekStart, {
      sendEmail: !!req.body?.send_email,
      force: !!req.body?.force,
    });
    res.json(result);
  } catch (e) {
    console.error("[owner/ai-weekly-reports/generate]", e.message || e);
    res.status(400).json({ ok: false, gabim: e.message || "Nuk ka shitje për analizë" });
  }
});

router.get("/ai-assistant/history", requireAiPackage, async (req, res) => {
  try {
    const messages = await listChatHistory(req.user.client_id, { limit: 40 });
    res.json({ ok: true, messages });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.delete("/ai-assistant/history", requireAiPackage, async (req, res) => {
  try {
    await clearChatHistory(req.user.client_id);
    res.json({ ok: true, cleared: true });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/ai-assistant/chat", requireAiPackage, async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({ ok: false, gabim: "Mungon mesazhi." });
    }

    const clientId = req.user.client_id;
    const category = String(req.body?.category || "general").trim() || "general";
    const [historyRows, context] = await Promise.all([
      listChatHistory(clientId, { limit: 20 }),
      buildOwnerChatContext(clientId, { category }),
    ]);

    const history = historyRows.map(row => ({
      role: row.role,
      content: row.content,
    }));

    await appendChatMessage(clientId, "user", message, 0);

    const result = await sendOwnerChat({ message, history, context });

    await appendChatMessage(clientId, "assistant", result.reply, result.tokensUsed);
    await trackAiUsage(clientId, "chat", result.tokensUsed);

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
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.get("/notification-settings", requireAiPackage, async (req, res) => {
  try {
    const settings = await getNotificationSettings(req.user.client_id);
    res.json({ ok: true, settings, capabilities: getNotificationCapabilities() });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.put("/notification-settings", requireAiPackage, async (req, res) => {
  try {
    const settings = await saveNotificationSettings(req.user.client_id, req.body || {});
    res.json({ ok: true, settings, capabilities: getNotificationCapabilities() });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/notification-settings/test", requireAiPackage, async (req, res) => {
  try {
    const result = await sendTestNotification(req.user.client_id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.get("/venue", async (req, res) => {
  try {
    const venue = await listVenue(req.user.client_id);
    res.json({ ok: true, ...venue });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.post("/venue/areas", async (req, res) => {
  try {
    const result = await addArea(req.user.client_id, req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.patch("/venue/areas/:id", async (req, res) => {
  try {
    const result = await updateArea(req.user.client_id, req.params.id, req.body);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.delete("/venue/areas/:id", async (req, res) => {
  try {
    const result = await deleteArea(req.user.client_id, req.params.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.post("/venue/staff", async (req, res) => {
  try {
    const result = await addStaff(req.user.client_id, req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.patch("/venue/staff/:id", async (req, res) => {
  try {
    const result = await updateStaff(req.user.client_id, req.params.id, req.body);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.delete("/venue/staff/:id", async (req, res) => {
  try {
    const result = await deleteStaff(req.user.client_id, req.params.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/waiters", async (req, res) => {
  try {
    let client = await getClientById(req.user.client_id);
    if (client) client = await ensureKitchenCredentials(client);
    const base = getPublicAppOrigin();
    const waiters = await listWaitersForOwner(req.user.client_id);
    const shared_waiter_url = client ? buildWaiterUrl(base, client, "") : "";

    // Lista e tavolinave (numra virtualë nga hapësirat) + caktimet aktuale.
    const venue = await listVenue(req.user.client_id);
    const layout = buildTablesFromAreas(venue.areas, venue.table_count, null);
    const tables = layout.tables.map(t => ({ number: t.number, area_name: t.area_name }));
    const assignState = await getAssignmentState(req.user.client_id);

    res.json({
      ok: true,
      waiters: waiters.map(w => ({
        ...w,
        waiter_url: client && w.web_token
          ? buildWaiterUrl(base, client, w.web_token)
          : shared_waiter_url,
        kds_url: client && w.web_token ? buildWaiterKitchenUrl(base, client, w.web_token) : "",
        assigned_tables: assignState.byWaiter.get(w.id) || [],
      })),
      shared_waiter_url,
      tables,
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

// Cakto (ose rikakto) tavolinat për një kamarier.
router.put("/waiters/:id/tables", async (req, res) => {
  try {
    const waiter = await getWaiterById(req.user.client_id, req.params.id);
    if (!waiter) {
      res.status(404).json({ gabim: "Kamarieri nuk u gjet." });
      return;
    }
    const assigned_tables = await setWaiterTables(
      req.user.client_id,
      req.params.id,
      req.body?.tables,
    );
    res.json({ ok: true, assigned_tables });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

async function enrichWaiterForOwner(clientId, waiter) {
  let client = await getClientById(clientId);
  if (client) client = await ensureKitchenCredentials(client);
  const base = getPublicAppOrigin();
  let token = waiter.web_token || null;
  if (!token && waiter.id && waiter.has_pin !== false) {
    token = await ensureWaiterWebToken(clientId, waiter.id);
  }
  const shared = client ? buildWaiterUrl(base, client, "") : "";
  return {
    ...waiter,
    web_token: token || waiter.web_token || null,
    waiter_url: client && token ? buildWaiterUrl(base, client, token) : shared,
    kds_url: client && token ? buildWaiterKitchenUrl(base, client, token) : "",
  };
}

router.post("/waiters", async (req, res) => {
  try {
    const result = await addWaiterWithPin(req.user.client_id, req.body);
    const waiter = await enrichWaiterForOwner(req.user.client_id, result.waiter);
    res.status(201).json({ ok: true, waiter, synced_at: result.synced_at });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.patch("/waiters/:id", async (req, res) => {
  try {
    const result = await updateWaiterWithPin(req.user.client_id, req.params.id, req.body);
    const waiter = await enrichWaiterForOwner(req.user.client_id, result.waiter);
    res.json({ ok: true, waiter, synced_at: result.synced_at });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.delete("/waiters/:id", async (req, res) => {
  try {
    const result = await deleteWaiterWithPin(req.user.client_id, req.params.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/kiosk/qrs", async (req, res) => {
  try {
    const base = getPublicAppOrigin();
    const data = await listKioskQrCodes(req.user.client_id, base);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/tables/qr", async (req, res) => {
  try {
    const base = getPublicAppOrigin();
    const data = await listTableQrMeta(req.user.client_id, base);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/kiosk/qrs/print", async (req, res) => {
  try {
    const base = getPublicAppOrigin();
    const client = await getClientById(req.user.client_id);
    const data = await listKioskQrCodes(req.user.client_id, base);
    const html = qrPrintHtml(data.tables, client?.emri || "");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) {
    res.status(400).send(`<pre>${e.message}</pre>`);
  }
});

router.get("/kiosk/qrs/:table/png", async (req, res) => {
  try {
    const base = getPublicAppOrigin();
    const table = req.params.table;
    const client = await getClientById(req.user.client_id);
    const png = await getTableQrPng(req.user.client_id, base, table);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="qr-tavolina-${table}.png"`);
    res.send(png);
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/kiosk/qrs/:table/print", async (req, res) => {
  try {
    const base = getPublicAppOrigin();
    const client = await getClientById(req.user.client_id);
    const data = await getTableQrCode(req.user.client_id, base, req.params.table);
    const html = singleQrPrintHtml(data, client?.emri || "");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) {
    res.status(400).send(`<pre>${e.message}</pre>`);
  }
});

router.get("/kiosk/qrs/:table", async (req, res) => {
  try {
    const base = getPublicAppOrigin();
    const data = await getTableQrCode(req.user.client_id, base, req.params.table);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/public-page/qr/png", async (req, res) => {
  try {
    const base = getPublicAppOrigin();
    const client = await getClientById(req.user.client_id);
    const png = await getOwnerPublicPageQrPng(req.user.client_id, base);
    const slug = client?.kitchen_slug || req.user.client_id;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="qr-faqe-${slug}.png"`);
    res.send(png);
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/public-page/qr", async (req, res) => {
  try {
    const base = getPublicAppOrigin();
    const data = await getOwnerPublicPageQr(req.user.client_id, base);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

async function saveOwnerKitchenSlug(req, res) {
  try {
    await updateOwnerKitchenSlug(req.user.client_id, req.body?.slug);
    const base = getPublicAppOrigin();
    const settings = await getOwnerPublicPageSettings(req.user.client_id, base);
    res.json({ ok: true, ...settings });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
}

router.put("/slug", saveOwnerKitchenSlug);
router.patch("/public-page/slug", saveOwnerKitchenSlug);

router.get("/public-page", async (req, res) => {
  try {
    const base = getPublicAppOrigin();
    const settings = await getOwnerPublicPageSettings(req.user.client_id, base);
    res.json({ ok: true, ...settings });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.patch("/public-page", async (req, res) => {
  try {
    await updateOwnerPublicPageSettings(req.user.client_id, req.body);
    const base = getPublicAppOrigin();
    const settings = await getOwnerPublicPageSettings(req.user.client_id, base);
    res.json({ ok: true, ...settings });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.get("/reservations", async (req, res) => {
  try {
    const rows = await listOwnerReservations(req.user.client_id, {
      date: req.query.date,
      from: req.query.from,
      to: req.query.to,
    });
    const table_count = await getMaxTableNumber(req.user.client_id);
    res.json({ ok: true, reservations: rows, table_count });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.post("/reservations", async (req, res) => {
  try {
    const reservation = await createOwnerReservation(req.user.client_id, req.body);
    res.status(201).json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

router.patch("/reservations/:id", async (req, res) => {
  try {
    const reservation = await updateOwnerReservationStatus(
      req.user.client_id,
      req.params.id,
      req.body?.status,
    );
    res.json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ gabim: e.message });
  }
});

module.exports = router;
