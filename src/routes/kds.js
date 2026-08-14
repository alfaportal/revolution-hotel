const express = require("express");
const { resolveKitchenClient } = require("../middleware/kitchenAuth");
const { requirePackageFeature } = require("../middleware/packageTier");
const {
  listKitchenOrders,
  listKitchenCancelledOrders,
  listRecentlyCancelledOrders,
  markKitchenOrderReady,
  fetchOrderedSales,
  fetchRefusalGraceOrders,
  mergeOrdersById,
  filterWaiterAcceptOrders,
  filterOrdersForWaiterPolling,
  buildOnlineSlotLayout,
} = require("../services/kdsService");
const { getLiveTablesForOwner } = require("../services/salesService");
const { subscribe } = require("../services/kdsEvents");
const { getRegisterSwitchState } = require("../services/registerSwitchService");
const { getStaffBrandingForClient } = require("../lib/staffBranding");
const { getWaiterByWebToken, getWaiterById, getWaiterByName } = require("../services/waiterPinService");
const { getAssignmentState } = require("../services/waiterTablesService");

const router = express.Router();

function extractWaiterToken(req) {
  return String(req.query.w || req.body?.web_token || "").trim().toLowerCase();
}

/** Zgjidh kamarierin nga token-i personal (?w=) ose kthen null. */
async function resolveWaiterFromToken(clientId, req) {
  const token = extractWaiterToken(req);
  if (!token) return null;
  return getWaiterByWebToken(clientId, token);
}

/** Telefon (?w=), POS (?waiter_id / ?waiter_name + key). */
async function resolveWaiterForBarView(clientId, req) {
  const fromToken = await resolveWaiterFromToken(clientId, req);
  if (fromToken?.id) return fromToken;

  const qId = String(req.query.waiter_id || req.body?.waiter_id || "").trim();
  if (qId) {
    const w = await getWaiterById(clientId, qId);
    if (w) return w;
  }

  const qName = String(req.query.waiter_name || req.body?.waiter_name || "").trim();
  if (qName) {
    const w = await getWaiterByName(clientId, qName);
    if (w) return w;
  }

  return null;
}

/**
 * Filtron porositë sipas tavolinave të caktuara për kamarierin.
 * Nëse pronari nuk ka caktuar asnjë tavolinë, kthen krejt (pa filtrim).
 */
async function filterOrdersForWaiter(clientId, orders, waiterId) {
  const state = await getAssignmentState(clientId);
  if (!state.hasAny) return orders;
  const allowed = new Set(state.byWaiter.get(waiterId) || []);
  return (orders || []).filter(o => allowed.has(Number(o.table_number)));
}

router.get("/:slug/events", resolveKitchenClient, requirePackageFeature("kds"), (req, res) => {
  subscribe(req.kitchenClient.id, res);
});

router.get("/:slug/bar/tables/live", resolveKitchenClient, requirePackageFeature("kds"), async (req, res) => {
  try {
    const live = await getLiveTablesForOwner(req.kitchenClient.id);
    res.json({ ok: true, ...live });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

router.get("/:slug/bar/orders", resolveKitchenClient, requirePackageFeature("kds"), async (req, res) => {
  try {
    const client = req.kitchenClient;
    // Telefoni i kamarierit: të gjitha porositë në pritje — pa ndarje banak/kuzhinë.
    let orders = await fetchOrderedSales(client.id);
    orders = mergeOrdersById(orders, await fetchRefusalGraceOrders(client.id));
    let cancelled = await listRecentlyCancelledOrders(client.id);
    const branding = await getStaffBrandingForClient(client, req.params.slug);

    let assigned_waiter = null;
    const slotWaiter = await resolveWaiterForBarView(client.id, req);
    const online_slots = buildOnlineSlotLayout(orders, {
      waiterId: slotWaiter?.id || null,
      waiterName: slotWaiter?.name || "",
    });

    if (slotWaiter?.id) {
      assigned_waiter = { id: slotWaiter.id, name: slotWaiter.name };
      const assignState = await getAssignmentState(client.id);
      const beforeFilter = orders.length;
      orders = filterOrdersForWaiterPolling(orders, slotWaiter.id, assignState);
      orders = filterWaiterAcceptOrders(orders, slotWaiter.id);
      cancelled = await filterOrdersForWaiter(client.id, cancelled, slotWaiter.id);
      console.log("[bar/orders]", {
        waiterId: slotWaiter.id,
        waiterName: slotWaiter.name,
        beforeFilter,
        afterPolling: orders.length,
        graceOrders: orders.filter(o => o.refused_at).length,
        onlineOccupied: online_slots.filter(s => s.status !== "free").length,
        orderIds: orders.map(o => o.id),
      });
    }

    res.json({
      ok: true,
      client_name: client.emri,
      kitchen_slug: client.kitchen_slug,
      ...branding,
      orders,
      online_slots,
      online_zone_title: "POROSI ONLINE",
      cancelled,
      assigned_waiter,
    });
  } catch (e) {
    res.status(404).json({ ok: false, gabim: e.message });
  }
});

router.get("/:slug/orders", resolveKitchenClient, requirePackageFeature("kds"), async (req, res) => {
  try {
    const client = req.kitchenClient;
    // Ekrani /kitchen/ — vetëm artikuj ushqimi (jo pije të barit)
    const orders = await listKitchenOrders(client.id);
    const cancelled = await listKitchenCancelledOrders(client.id);
    const branding = await getStaffBrandingForClient(client, req.params.slug);
    res.json({
      ok: true,
      client_name: client.emri,
      kitchen_slug: client.kitchen_slug,
      ...branding,
      orders,
      cancelled,
    });
  } catch (e) {
    res.status(404).json({ ok: false, gabim: e.message });
  }
});

router.post("/:slug/orders/:orderId/accept", resolveKitchenClient, requirePackageFeature("kds"), async (req, res) => {
  try {
    const client = req.kitchenClient;
    const { acceptBarOrder } = require("../services/kdsService");

    const handler = await resolveWaiterForBarView(client.id, req);
    if (handler?.id) {
      const order = await acceptBarOrder(client.id, req.params.orderId, {
        waiterId: handler.id,
        waiterName: handler.name,
      });
      res.json({ ok: true, order, accepted_by: handler.name });
      return;
    }

    // Rrjedha e vjetër (ekran i përbashkët pa token): pranim me PIN.
    const pin = String(req.body?.pin || req.body?.waiter_pin || "").trim();
    if (!pin) {
      return res.status(400).json({
        ok: false,
        gabim: "Vendosni PIN-in e kamarierit që e pranon porosinë.",
      });
    }
    const { verifyWaiterPin } = require("../services/waiterPinService");
    const pinWaiter = await verifyWaiterPin(client.id, pin);
    const order = await acceptBarOrder(client.id, req.params.orderId, {
      waiterId: pinWaiter.id,
      waiterName: pinWaiter.name,
    });
    res.json({ ok: true, order, accepted_by: pinWaiter.name });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

// Refuzimi i porosisë nga kamarieri — 2 minuta grace për kamarierët e tjerë.
router.post("/:slug/orders/:orderId/refuse", resolveKitchenClient, requirePackageFeature("kds"), async (req, res) => {
  const orderId = req.params.orderId;
  console.log("[refuse-route] POST", {
    orderId,
    slug: req.params.slug,
    clientId: req.kitchenClient?.id,
    hasWaiterToken: Boolean(extractWaiterToken(req)),
  });
  try {
    const client = req.kitchenClient;
    const waiter = await resolveWaiterForBarView(client.id, req);
    if (!waiter?.id) {
      return res.status(400).json({ ok: false, gabim: "Mungon identifikimi i kamarierit." });
    }
    const { refuseBarOrderWithGrace } = require("../services/kdsService");
    const reason = String(req.body?.reason || req.body?.refuse_reason || "").trim();
    const order = await refuseBarOrderWithGrace(client.id, orderId, {
      waiterId: waiter.id,
      waiterName: waiter.name,
      reason,
    });
    console.log("[refuse-route] OK", {
      orderId,
      status: order.status,
      refused_at: order.refused_at,
      order_expires_at: order.order_expires_at,
      refuse_reason: order.refuse_reason || reason,
    });
    res.json({
      ok: true,
      order,
      status: order.status,
      grace_minutes: 2,
      refuse_mode: "grace_v2",
      refuse_reason: order.refuse_reason || reason || "",
    });
  } catch (e) {
    console.error("[refuse-route] FAIL", { orderId, error: e.message });
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/:slug/orders/:orderId/ready", resolveKitchenClient, requirePackageFeature("kds"), async (req, res) => {
  try {
    const client = req.kitchenClient;
    const { markKitchenOrderReady } = require("../services/kdsService");
    const order = await markKitchenOrderReady(client.id, req.params.orderId);
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

// Vetëm LEXIM — modaliteti i arkës vendoset EKSKLUZIVISHT nga pronari te
// /api/owner/register-switch/mode (JWT i pronarit). Kjo lejon POS-in lokal
// (KAFENE) ta lexojë periodikisht dhe ta zbatojë te printimi.
router.get("/:slug/register-mode", resolveKitchenClient, requirePackageFeature("kds"), async (req, res) => {
  try {
    const state = await getRegisterSwitchState(req.kitchenClient.id);
    res.json({ ok: true, ...state });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

module.exports = router;
