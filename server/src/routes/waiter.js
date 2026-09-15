const express = require("express");
const { resolveKitchenClient } = require("../middleware/kitchenAuth");
const { requirePackageFeature } = require("../middleware/packageTier");
const {
  getWaiterBootstrap,
  loginWaiterWithPin,
  submitWaiterOrder,
  cancelWaiterOrder,
  closeWaiterTable,
} = require("../services/waiterService");

const { getKitchenMenuItemPhoto } = require("../services/menuService");
const { verifyKasaSessionToken } = require("../lib/kasaSession");
const { getWaiterById } = require("../services/waiterPinService");
const { sendShiftCloseEmailForClient } = require("../services/shiftCloseEmailService");

const router = express.Router();

function extractWaiterToken(req) {
  return String(req.query.w || req.body?.web_token || "").trim().toLowerCase();
}

router.get("/:slug/menu/:itemId/photo", resolveKitchenClient, requirePackageFeature("waiter"), async (req, res) => {
  try {
    const photo = await getKitchenMenuItemPhoto(req.kitchenClient.id, req.params.itemId);
    if (!photo) return res.status(404).end();
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.type(photo.mime).send(photo.buffer);
  } catch (e) {
    res.status(404).end();
  }
});

router.post("/:slug/orders/cancel", resolveKitchenClient, requirePackageFeature("waiter"), async (req, res) => {
  try {
    const result = await cancelWaiterOrder(req.kitchenClient.id, req.body);
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.get("/:slug/bootstrap", resolveKitchenClient, requirePackageFeature("waiter"), async (req, res) => {
  try {
    const data = await getWaiterBootstrap(req.kitchenClient.id, {
      kitchenSlug: req.kitchenClient.kitchen_slug,
      channel: "waiter",
      webToken: extractWaiterToken(req),
    });
    res.json({ ok: true, ...data, kitchen_slug: req.kitchenClient.kitchen_slug });
  } catch (e) {
    res.status(404).json({ ok: false, gabim: e.message });
  }
});

router.post("/:slug/login", resolveKitchenClient, requirePackageFeature("waiter"), async (req, res) => {
  try {
    const waiter = await loginWaiterWithPin(req.kitchenClient.id, req.body?.pin, extractWaiterToken(req) || null);
    res.json({ ok: true, waiter });
  } catch (e) {
    res.status(401).json({ ok: false, gabim: e.message });
  }
});

/**
 * Fallback për KAFENE (kur license online-orders dështon).
 * Kthen të gjitha porositë mobile përfshi WEB-WAITER — POS i importon dhe printon.
 * PRANO nga telefoni mbetet i bllokuar (POST accept → 403).
 */
router.get("/:slug/online-orders/pending", resolveKitchenClient, requirePackageFeature("waiter"), async (req, res) => {
  try {
    const {
      listBarMobileOrderedForPos,
      listPendingOnlineOrders,
    } = require("../services/onlineOrdersService");
    const allOrders = await listBarMobileOrderedForPos(req.kitchenClient.id);
    const pending = await listPendingOnlineOrders(req.kitchenClient.id);
    res.json({
      ok: true,
      pending: pending.length,
      has_pending: pending.length > 0,
      // KAFENE fetchOnlineOrdersViaKitchen përdor `orders` si all_orders
      orders: allOrders,
      all_orders: allOrders,
      connected: true,
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      gabim: e.message,
      pending: 0,
      has_pending: false,
      orders: [],
      all_orders: [],
    });
  }
});

router.post("/:slug/online-orders/accept", resolveKitchenClient, requirePackageFeature("waiter"), (req, res) => {
  res.status(403).json({
    ok: false,
    gabim: "Porositë online pranohen vetëm nga kasa (KAFENE desktop).",
  });
});

router.post("/:slug/kasa-session", resolveKitchenClient, requirePackageFeature("waiter"), async (req, res) => {
  try {
    const token = String(req.body?.session_token || "").trim();
    const parsed = verifyKasaSessionToken(token, req.kitchenClient.id);
    if (!parsed?.waiterId) {
      return res.status(401).json({ ok: false, gabim: "Sesioni i kasës ka skaduar. Shkruani PIN-in." });
    }
    const waiter = await getWaiterById(req.kitchenClient.id, parsed.waiterId);
    if (!waiter) {
      return res.status(401).json({ ok: false, gabim: "Kamarieri nuk u gjet." });
    }
    res.json({ ok: true, waiter });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

async function postWaiterOrder(req, res) {
  try {
    const { getWaiterByWebToken } = require("../services/waiterPinService");
    const body = { ...(req.body || {}) };
    const token = extractWaiterToken(req);
    if (token) {
      const fromToken = await getWaiterByWebToken(req.kitchenClient.id, token);
      if (fromToken?.id) {
        if (!body.waiter_id) body.waiter_id = fromToken.id;
        if (!body.waiter_name) body.waiter_name = fromToken.name;
      }
    }
    const result = await submitWaiterOrder(req.kitchenClient.id, body);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || "Porosia nuk u dërgua." });
  }
}

router.post("/:slug/orders", resolveKitchenClient, requirePackageFeature("waiter"), postWaiterOrder);
router.post("/:slug/order", resolveKitchenClient, requirePackageFeature("waiter"), postWaiterOrder);

router.post("/:slug/orders/close", resolveKitchenClient, requirePackageFeature("waiter"), async (req, res) => {
  try {
    const { getWaiterByWebToken } = require("../services/waiterPinService");
    const body = { ...(req.body || {}) };
    const token = extractWaiterToken(req);
    if (token) {
      const fromToken = await getWaiterByWebToken(req.kitchenClient.id, token);
      if (fromToken?.id) {
        if (!body.waiter_id) body.waiter_id = fromToken.id;
        if (!body.waiter_name) body.waiter_name = fromToken.name;
      }
    }
    const result = await closeWaiterTable(req.kitchenClient.id, body);
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/** Raport ditor te pronari pas mbylljes së ndërrimit (thirret nga KAFENE, fire-and-forget). */
router.post("/:slug/shift-close-email", resolveKitchenClient, requirePackageFeature("waiter"), async (req, res) => {
  try {
    const result = await sendShiftCloseEmailForClient(req.kitchenClient, req.body || {});
    res.json(result);
  } catch (e) {
    console.warn("[shift-close-email]", e.message);
    res.status(500).json({ ok: false, gabim: e.message || "Email dështoi." });
  }
});

module.exports = router;
