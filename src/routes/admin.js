const express = require("express");
const { authRequired, superAdminOnly } = require("../middleware/auth");
const { asyncHandler } = require("../lib/asyncHandler");
const { logRouteError } = require("../lib/errors");
const {
  listClients,
  listLicenses,
  createClient,
  createClientOnboard,
  updateClient,
  deleteClient,
  createLicense,
  updateLicense,
  deleteLicense,
  updateLicenseStatus,
  blockLicense,
  unblockLicense,
  resetLicenseDevice,
  regenerateKitchenAccess,
  requestFactoryResetForClient,
  getDashboardStats,
  generateLicenseKey,
  generateDeviceId,
  provisionLicenseDevice,
} = require("../services/licenseService");
const {
  ADMIN_PACKAGE_TIERS,
  TIER_LABELS,
  featuresForTier,
  normalizePackageTier,
} = require("../lib/packages");
const {
  generateHardwareLicenseKey,
  normalizeHardwareId,
  formatGrouped16,
} = require("../lib/hardwareLicense");

function withNormalizedPackageTier(body) {
  if (!body || typeof body !== "object") return body;
  if (!Object.prototype.hasOwnProperty.call(body, "package_tier")) return body;
  return { ...body, package_tier: normalizePackageTier(body.package_tier) };
}
const { getFiscalSettings, updateFiscalSettings } = require("../services/fiscalService");
const {
  listOwnerMenu,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
} = require("../services/menuService");
const {
  getClientAdminSettings,
  updateClientAdminSettings,
} = require("../services/clientAdminService");
const { getDailyEmergencyCode, isMasterPinConfigured } = require("../lib/emergencyPin");
const { todayISO } = require("../lib/licenseDates");
const { logAdminActivity, listAdminActivityLog, activityFromReq } = require("../services/activityLogService");
const {
  listTrialExpiryAlerts,
  countTrialExpiryAlerts,
} = require("../services/trialNotificationService");
const {
  listStockAlertsForAdmin,
  countStockAlertClients,
} = require("../services/stockService");
const {
  listOwners,
  createOwner,
  ensureOwnerForClient,
  updateOwner,
  deleteOwner,
  setOwnerActive,
  regenerateOwnerInvite,
  adminResetOwnerPassword,
} = require("../services/userService");
const { getPublicAppOrigin } = require("../lib/publicOrigin");
const { buildKitchenUrl, buildTableMenuUrl, ensureKitchenCredentials } = require("../lib/kitchenAccess");
const { getClientById } = require("../services/salesService");
const {
  listKioskQrCodes,
  listTableQrMeta,
  getTableQrCode,
  getTableQrPng,
  qrPrintHtml,
  singleQrPrintHtml,
} = require("../services/kioskQrService");
const { getSupabase } = require("../db");
const {
  listOwnerGroups,
  createOwnerGroup,
  linkClientsToGroup,
  linkClientToOwnerUser,
  getOwnerGroupDetails,
  findOwnerUserIdForClient,
} = require("../services/ownerGroupService");

function requestBaseUrl(_req) {
  return getPublicAppOrigin();
}

const router = express.Router();

router.use(authRequired, superAdminOnly);

router.get("/stats", asyncHandler(async (_req, res) => {
  const stats = await getDashboardStats();
  let trials_expiring_soon = 0;
  let stock_alert_clients = 0;
  try {
    trials_expiring_soon = await countTrialExpiryAlerts(7);
  } catch (e) {
    console.warn("[admin] trial expiry count:", e.message);
  }
  try {
    stock_alert_clients = await countStockAlertClients();
  } catch (e) {
    console.warn("[admin] stock alert count:", e.message);
  }
  res.json({ ok: true, ...stats, trials_expiring_soon, stock_alert_clients });
}));

router.get("/stock-alerts", asyncHandler(async (_req, res) => {
  const alerts = await listStockAlertsForAdmin();
  res.json({ ok: true, alerts, count: alerts.length });
}));

router.get("/trial-alerts", asyncHandler(async (req, res) => {
  const withinDays = Number(req.query.days) || 7;
  const alerts = await listTrialExpiryAlerts({ withinDays });
  res.json({ ok: true, alerts, count: alerts.length });
}));

router.get("/package-tiers", (_req, res) => {
  res.json({
    ok: true,
    tiers: ADMIN_PACKAGE_TIERS.map(id => ({
      id,
      label: TIER_LABELS[id] || id,
      features: featuresForTier(id),
    })),
  });
});

router.get("/emergency-code", (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.json({
    ok: true,
    configured: isMasterPinConfigured(),
    daily_code: isMasterPinConfigured() ? getDailyEmergencyCode() : null,
    code_version: 2,
    hint:
      "Kodi ditor 6 shifra (vetëm numra) — hap panelin e Pronarit në POS. Ndryshon automatikisht çdo 24 orë. Rifreskoni pas mesnatës ose me butonin Rifresko.",
    valid_for_date: todayISO(),
  });
});

router.get("/activity-log", asyncHandler(async (req, res) => {
  const logs = await listAdminActivityLog({ limit: req.query.limit });
  res.json({ ok: true, logs });
}));

router.get("/clients", asyncHandler(async (_req, res) => {
  const raw = await listClients();
  const clients = await Promise.all(
    raw.map(async c => {
      if (c.kitchen_slug && c.kitchen_key) return c;
      try {
        return await ensureKitchenCredentials(c);
      } catch {
        return c;
      }
    }),
  );
  res.json({ ok: true, clients });
}));

router.post("/clients", asyncHandler(async (req, res) => {
  const body = withNormalizedPackageTier(req.body);
  const { normalizeProductLine } = require("../utils/productLine");
  const productLine = normalizeProductLine(
    body?.product_line || body?.industry_type || body?.product_category,
  );
  console.log("[admin] POST /clients", {
    emri: body?.emri,
    tipi: body?.tipi,
    package_tier: body?.package_tier,
    product_line: productLine,
  });
  try {
    if (productLine === "security") {
      const { createSecurityClient } = require("../services/securityAdminBridge");
      const data = await createSecurityClient(body);
      await logAdminActivity({
        ...activityFromReq(req),
        action: "security_client_create",
        targetType: "client",
        targetId: data.client?.id,
        targetLabel: data.client?.emri,
      });
      return res.status(201).json({ ok: true, client: data.client, product_line: "security" });
    }
    const { toDbProductLine } = require("../utils/productLine");
    const client = await createClient({ ...body, product_line: toDbProductLine(productLine) });
    await logAdminActivity({
      ...activityFromReq(req),
      action: "client_create",
      targetType: "client",
      targetId: client.id,
      targetLabel: client.emri,
    });
    console.log("[admin] Klienti u krijua:", client.id);
    res.status(201).json({ ok: true, client, product_line: productLine });
  } catch (e) {
    const msg = logRouteError("admin:POST /clients", e, { body: req.body });
    res.status(400).json({ gabim: msg, code: e?.code || null });
  }
}));

router.post("/clients/onboard", asyncHandler(async (req, res) => {
  const body = withNormalizedPackageTier(req.body);
  console.log("[admin] POST /clients/onboard", {
    emri: body?.emri,
    tipi: body?.tipi,
    package_tier: body?.package_tier,
  });
  try {
    const { client, license, owner } = await createClientOnboard(body, requestBaseUrl(req));
    await logAdminActivity({
      ...activityFromReq(req),
      action: "client_onboard",
      targetType: "client",
      targetId: client.id,
      targetLabel: client.emri,
      details: {
        license_id: license.id,
        license_celesi: license.celesi,
        owner_id: owner.id,
        owner_email: owner.email,
      },
    });
    console.log("[admin] Klienti u onboard-ua:", client.id);
    res.status(201).json({ ok: true, client, license, owner });
  } catch (e) {
    const msg = logRouteError("admin:POST /clients/onboard", e, {
      body: { ...req.body, owner_password: "[redacted]" },
    });
    res.status(400).json({ gabim: msg, code: e?.code || null });
  }
}));

router.patch("/clients/:id", asyncHandler(async (req, res) => {
  try {
    const client = await updateClient(req.params.id, withNormalizedPackageTier(req.body));
    res.json({ ok: true, client });
  } catch (e) {
    const msg = logRouteError("admin:PATCH /clients", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.post("/clients/:id/ensure-owner", asyncHandler(async (req, res) => {
  try {
    const owner = await ensureOwnerForClient(
      {
        client_id: req.params.id,
        emri: req.body?.emri,
        email: req.body?.email || req.body?.owner_email,
        password: req.body?.password || req.body?.owner_password,
      },
      requestBaseUrl(req),
    );
    res.json({ ok: true, owner, info: "Pronari u lidh me lokalin." });
  } catch (e) {
    const msg = logRouteError("admin:POST /clients/:id/ensure-owner", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.get("/clients/:id/fiscal", asyncHandler(async (req, res) => {
  try {
    const settings = await getFiscalSettings(req.params.id);
    res.json({ ok: true, settings });
  } catch (e) {
    const msg = logRouteError("admin:GET /clients/:id/fiscal", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.patch("/clients/:id/fiscal", asyncHandler(async (req, res) => {
  try {
    const settings = await updateFiscalSettings(req.params.id, req.body);
    res.json({ ok: true, settings });
  } catch (e) {
    const msg = logRouteError("admin:PATCH /clients/:id/fiscal", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.get("/clients/:id/settings", asyncHandler(async (req, res) => {
  try {
    const settings = await getClientAdminSettings(req.params.id);
    res.json({ ok: true, settings });
  } catch (e) {
    const msg = logRouteError("admin:GET /clients/:id/settings", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.patch("/clients/:id/settings", asyncHandler(async (req, res) => {
  try {
    const settings = await updateClientAdminSettings(req.params.id, req.body);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "client_settings_update",
      targetType: "client",
      targetId: req.params.id,
    });
    res.json({ ok: true, settings });
  } catch (e) {
    const msg = logRouteError("admin:PATCH /clients/:id/settings", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.get("/clients/:id/menu", asyncHandler(async (req, res) => {
  try {
    const menu = await listOwnerMenu(req.params.id);
    res.json({ ok: true, ...menu });
  } catch (e) {
    const msg = logRouteError("admin:GET /clients/:id/menu", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.post("/clients/:id/menu", asyncHandler(async (req, res) => {
  try {
    const result = await addMenuItem(req.params.id, req.body);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "menu_item_create",
      targetType: "client",
      targetId: req.params.id,
      details: { name: req.body?.name },
    });
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    const msg = logRouteError("admin:POST /clients/:id/menu", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.patch("/clients/:id/menu/:itemId", asyncHandler(async (req, res) => {
  try {
    const result = await updateMenuItem(req.params.id, req.params.itemId, req.body);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "menu_item_update",
      targetType: "client",
      targetId: req.params.id,
      details: { item_id: req.params.itemId },
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    const msg = logRouteError("admin:PATCH /clients/:id/menu/:itemId", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.delete("/clients/:id/menu/:itemId", asyncHandler(async (req, res) => {
  try {
    const result = await deleteMenuItem(req.params.id, req.params.itemId);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "menu_item_delete",
      targetType: "client",
      targetId: req.params.id,
      details: { item_id: req.params.itemId },
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    const msg = logRouteError("admin:DELETE /clients/:id/menu/:itemId", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.delete("/clients/:id", asyncHandler(async (req, res) => {
  try {
    await deleteClient(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    const msg = logRouteError("admin:DELETE /clients", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.post("/clients/:id/regenerate-kitchen-access", asyncHandler(async (req, res) => {
  try {
    const base = requestBaseUrl(req);
    const client = await regenerateKitchenAccess(req.params.id);
    res.json({
      ok: true,
      client,
      kitchen_url: buildKitchenUrl(base, client, "kitchen"),
      bar_url: buildKitchenUrl(base, client, "bar"),
      waiter_url: buildKitchenUrl(base, client, "waiter"),
      kiosk_url: buildTableMenuUrl(base, client, 1),
    });
  } catch (e) {
    const msg = logRouteError("admin:POST /clients/:id/regenerate-kitchen-access", e);
    res.status(400).json({ gabim: msg });
  }
}));

/** Urdhëron POS-in e klientit: Rivendos si të re (fshin të dhënat lokale). */
router.post("/clients/:id/factory-reset", asyncHandler(async (req, res) => {
  try {
    const confirm = String(req.body?.confirm || "").trim();
    if (confirm !== "RIVENDOS") {
      return res.status(400).json({ gabim: "Duhet të shkruani saktë RIVENDOS." });
    }
    const result = await requestFactoryResetForClient(req.params.id);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "client_factory_reset",
      targetType: "client",
      targetId: req.params.id,
      details: result,
    });
    res.json({
      ok: true,
      ...result,
      message:
        "Urdhri u dërgua. POS-i (nëse është online) rivendoset brenda ~30–60 sekondave.",
    });
  } catch (e) {
    const msg = logRouteError("admin:POST /clients/:id/factory-reset", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.get("/clients/:id/tables/qr", asyncHandler(async (req, res) => {
  try {
    const base = requestBaseUrl(req);
    const data = await listTableQrMeta(req.params.id, base);
    res.json({ ok: true, ...data });
  } catch (e) {
    const msg = logRouteError("admin:GET /clients/:id/tables/qr", e);
    res.status(400).json({ ok: false, gabim: msg });
  }
}));

router.get("/clients/:id/kiosk/qrs", asyncHandler(async (req, res) => {
  try {
    const base = requestBaseUrl(req);
    const data = await listKioskQrCodes(req.params.id, base);
    res.json({ ok: true, ...data });
  } catch (e) {
    const msg = logRouteError("admin:GET /clients/:id/kiosk/qrs", e);
    res.status(400).json({ ok: false, gabim: msg });
  }
}));

router.get("/clients/:id/kiosk/qrs/print", asyncHandler(async (req, res) => {
  try {
    const base = requestBaseUrl(req);
    const client = await getClientById(req.params.id);
    const data = await listKioskQrCodes(req.params.id, base);
    const html = qrPrintHtml(data.tables, client?.emri || "");
    res.type("html").send(html);
  } catch (e) {
    const msg = logRouteError("admin:GET /clients/:id/kiosk/qrs/print", e);
    res.status(400).type("text/plain").send(msg);
  }
}));

router.get("/clients/:id/kiosk/qrs/:table/png", asyncHandler(async (req, res) => {
  try {
    const base = requestBaseUrl(req);
    const table = Number(req.params.table);
    const png = await getTableQrPng(req.params.id, base, table);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="qr-tavolina-${table}.png"`);
    res.send(png);
  } catch (e) {
    const msg = logRouteError("admin:GET /clients/:id/kiosk/qrs/:table/png", e);
    res.status(400).type("text/plain").send(msg);
  }
}));

router.get("/clients/:id/kiosk/qrs/:table/print", asyncHandler(async (req, res) => {
  try {
    const base = requestBaseUrl(req);
    const client = await getClientById(req.params.id);
    const data = await getTableQrCode(req.params.id, base, req.params.table);
    const html = singleQrPrintHtml(data, client?.emri || "");
    res.type("html").send(html);
  } catch (e) {
    const msg = logRouteError("admin:GET /clients/:id/kiosk/qrs/:table/print", e);
    res.status(400).type("text/plain").send(msg);
  }
}));

router.get("/clients/:id/kiosk/qrs/:table", asyncHandler(async (req, res) => {
  try {
    const base = requestBaseUrl(req);
    const data = await getTableQrCode(req.params.id, base, req.params.table);
    res.json({ ok: true, ...data });
  } catch (e) {
    const msg = logRouteError("admin:GET /clients/:id/kiosk/qrs/:table", e);
    res.status(400).json({ ok: false, gabim: msg });
  }
}));

router.get("/licenses", asyncHandler(async (_req, res) => {
  res.json({ ok: true, licenses: await listLicenses() });
}));

router.post("/licenses", asyncHandler(async (req, res) => {
  try {
    const license = await createLicense(req.body);
    res.status(201).json({ ok: true, license });
  } catch (e) {
    const msg = logRouteError("admin:POST /licenses", e);
    res.status(400).json({ gabim: msg, code: e?.code || null });
  }
}));

router.get("/licenses/generate-key", (_req, res) => {
  res.json({ ok: true, celesi: generateLicenseKey() });
});

router.get("/licenses/generate-device-id", (_req, res) => {
  res.json({ ok: true, device_id: generateDeviceId() });
});

/**
 * LICENSE_KEY nga HARDWARE_ID i klientit (ekrani "Aktivizo KAFENE").
 * Body: { hardwareId, licenseType?: "trial"|"annual" }
 */
router.post(
  "/licenses/generate-hardware-key",
  asyncHandler(async (req, res) => {
    const hardwareId = req.body?.hardwareId || req.body?.hardware_id || req.body?.device_id || "";
    const licenseType = req.body?.licenseType || req.body?.license_type || "annual";
    try {
      const result = generateHardwareLicenseKey(hardwareId, { licenseType });
      res.json({
        ok: true,
        licenseKey: result.licenseKey,
        celesi: result.licenseKey,
        licenseType: result.licenseType,
        expiresAt: result.expiresAt,
        expiresYmd: result.expiresYmd,
        trialDays: result.trialDays || null,
        hardwareId: formatGrouped16(normalizeHardwareId(hardwareId)),
      });
    } catch (e) {
      res.status(400).json({ ok: false, gabim: e.message || String(e) });
    }
  }),
);

router.post("/licenses/:id/provision-device", asyncHandler(async (req, res) => {
  try {
    // Super Admin: force=true (default) → gjenero ID të ri kurdo
    const force = req.body?.force !== false;
    const result = await provisionLicenseDevice(req.params.id, { force });
    res.json({ ok: true, ...result });
  } catch (e) {
    const msg = logRouteError("admin:POST /licenses/:id/provision-device", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.patch("/licenses/:id", asyncHandler(async (req, res) => {
  try {
    const license = await updateLicense(req.params.id, req.body);
    res.json({ ok: true, license });
  } catch (e) {
    const msg = logRouteError("admin:PATCH /licenses", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.delete("/licenses/:id", asyncHandler(async (req, res) => {
  try {
    await deleteLicense(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    const msg = logRouteError("admin:DELETE /licenses", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.patch("/licenses/:id/status", asyncHandler(async (req, res) => {
  const { statusi } = req.body;
  const allowed = ["aktive", "skaduar", "revokuar", "pezulluar"];
  if (!allowed.includes(statusi)) {
    return res.status(400).json({ gabim: "Status i pavlefshëm." });
  }
  const license = await updateLicenseStatus(req.params.id, statusi);
  await logAdminActivity({
    ...activityFromReq(req),
    action: statusi === "aktive" ? "license_unblock" : "license_block",
    targetType: "license",
    targetId: license.id,
    targetLabel: license.clients?.emri || license.celesi,
    details: { statusi, force_logout: statusi !== "aktive" },
  });
  res.json({ ok: true, license, force_logout: statusi !== "aktive" });
}));

router.post("/licenses/:id/block", asyncHandler(async (req, res) => {
  const license = await blockLicense(req.params.id);
  await logAdminActivity({
    ...activityFromReq(req),
    action: "license_block",
    targetType: "license",
    targetId: license.id,
    targetLabel: license.clients?.emri || license.celesi,
    details: { statusi: "pezulluar", force_logout: true },
  });
  res.json({ ok: true, license, force_logout: true, message: "POS do të shkyçet brenda ~60 sekondave." });
}));

router.post("/licenses/:id/unblock", asyncHandler(async (req, res) => {
  const license = await unblockLicense(req.params.id);
  await logAdminActivity({
    ...activityFromReq(req),
    action: "license_unblock",
    targetType: "license",
    targetId: license.id,
    targetLabel: license.clients?.emri || license.celesi,
    details: { statusi: "aktive" },
  });
  res.json({ ok: true, license });
}));

router.post("/licenses/:id/reset-device", asyncHandler(async (req, res) => {
  try {
    const license = await resetLicenseDevice(req.params.id);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "license_reset_device",
      targetType: "license",
      targetId: license.id,
      targetLabel: license.clients?.emri || license.celesi,
    });
    res.json({ ok: true, license });
  } catch (e) {
    const msg = logRouteError("admin:POST /licenses/:id/reset-device", e);
    res.status(400).json({ gabim: msg });
  }
}));

/** Alias PATCH — disa klientë/proxy e pranojnë më mirë PATCH */
router.patch("/licenses/:id/reset-device", asyncHandler(async (req, res) => {
  try {
    const license = await resetLicenseDevice(req.params.id);
    res.json({ ok: true, license });
  } catch (e) {
    const msg = logRouteError("admin:PATCH /licenses/:id/reset-device", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.get("/owners", asyncHandler(async (req, res) => {
  res.json({ ok: true, owners: await listOwners(requestBaseUrl(req)) });
}));

router.post("/owners", asyncHandler(async (req, res) => {
  console.log("[admin] POST /owners", { emri: req.body?.emri, email: req.body?.email });
  try {
    const owner = await createOwner(req.body, requestBaseUrl(req));
    console.log("[admin] Pronari u krijua:", owner.id);
    res.status(201).json({ ok: true, owner });
  } catch (e) {
    const msg = logRouteError("admin:POST /owners", e, { body: { ...req.body, password: "[redacted]" } });
    res.status(400).json({ gabim: msg, code: e?.code || null });
  }
}));

router.post("/owners/:id/invite", asyncHandler(async (req, res) => {
  try {
    const owner = await regenerateOwnerInvite(req.params.id, requestBaseUrl(req));
    await logAdminActivity({
      ...activityFromReq(req),
      action: "owner_invite_resend",
      targetType: "owner",
      targetId: owner.id,
      targetLabel: owner.email,
    });
    res.json({ ok: true, owner });
  } catch (e) {
    const msg = logRouteError("admin:POST /owners/:id/invite", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.post("/owners/:id/reset-password", asyncHandler(async (req, res) => {
  try {
    const owner = await adminResetOwnerPassword(req.params.id, requestBaseUrl(req));
    await logAdminActivity({
      ...activityFromReq(req),
      action: "owner_reset_password",
      targetType: "owner",
      targetId: owner.id,
      targetLabel: owner.email,
    });
    res.json({
      ok: true,
      owner,
      message: owner.account_status === "pending"
        ? "U dërgua email me link ftese të ri."
        : "U dërgua email me kod rivendosjeje fjalëkalimi.",
    });
  } catch (e) {
    const msg = logRouteError("admin:POST /owners/:id/reset-password", e);
    res.status(400).json({ gabim: msg, code: e?.code || null });
  }
}));

router.patch("/owners/:id", asyncHandler(async (req, res) => {
  try {
    const owner = await updateOwner(req.params.id, req.body, requestBaseUrl(req));
    res.json({ ok: true, owner });
  } catch (e) {
    const msg = logRouteError("admin:PATCH /owners", e, { body: { ...req.body, password: "[redacted]" } });
    res.status(400).json({ gabim: msg });
  }
}));

router.delete("/owners/:id", asyncHandler(async (req, res) => {
  try {
    await deleteOwner(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    const msg = logRouteError("admin:DELETE /owners", e);
    res.status(400).json({ gabim: msg });
  }
}));

router.post("/users", asyncHandler(async (req, res) => {
  console.log("[admin] POST /users (alias → owners)");
  try {
    const owner = await createOwner(req.body, requestBaseUrl(req));
    res.status(201).json({ ok: true, owner });
  } catch (e) {
    const msg = logRouteError("admin:POST /users", e);
    res.status(400).json({ gabim: msg, code: e?.code || null });
  }
}));

router.get("/users", asyncHandler(async (req, res) => {
  res.json({ ok: true, owners: await listOwners(requestBaseUrl(req)) });
}));

router.patch("/owners/:id/status", asyncHandler(async (req, res) => {
  const { aktiv } = req.body;
  if (typeof aktiv !== "boolean") {
    return res.status(400).json({ gabim: "aktiv duhet true ose false." });
  }
  const owner = await setOwnerActive(req.params.id, aktiv);
  res.json({ ok: true, owner });
}));

router.get("/owner-groups", asyncHandler(async (_req, res) => {
  const groups = await listOwnerGroups();
  const db = getSupabase();
  const enriched = await Promise.all(
    groups.map(async g => {
      const { count, error } = await db
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("owner_group_id", g.id);
      if (error) throw error;
      return { ...g, client_count: count || 0 };
    }),
  );
  res.json({ ok: true, groups: enriched });
}));

router.post("/owner-groups", asyncHandler(async (req, res) => {
  const group = await createOwnerGroup(req.body?.emri);
  await logAdminActivity({
    ...activityFromReq(req),
    action: "owner_group_create",
    targetType: "owner_group",
    targetId: group.id,
    targetLabel: group.emri,
  });
  res.status(201).json({ ok: true, group });
}));

router.get("/owner-groups/:id", asyncHandler(async (req, res) => {
  const group = await getOwnerGroupDetails(req.params.id);
  if (!group) return res.status(404).json({ gabim: "Grupi nuk u gjet." });
  res.json({ ok: true, group });
}));

router.post("/owner-groups/:id/link-clients", asyncHandler(async (req, res) => {
  const clientIds = req.body?.client_ids || req.body?.clientIds || [];
  const ownerUserId = req.body?.owner_user_id || req.body?.ownerUserId || null;
  const result = await linkClientsToGroup(req.params.id, clientIds, { ownerUserId });
  await logAdminActivity({
    ...activityFromReq(req),
    action: "owner_group_link_clients",
    targetType: "owner_group",
    targetId: req.params.id,
    targetLabel: `${clientIds.length} lokale`,
  });
  res.json({ ok: true, ...result });
}));

router.post("/clients/:id/link-owner", asyncHandler(async (req, res) => {
  const clientId = req.params.id;
  let ownerUserId = req.body?.owner_user_id || req.body?.ownerUserId || null;
  const ownerClientId = req.body?.owner_client_id || req.body?.ownerClientId || null;

  if (!ownerUserId && ownerClientId) {
    ownerUserId = await findOwnerUserIdForClient(ownerClientId);
    if (!ownerUserId) {
      return res.status(400).json({ gabim: "Lokali i zgjedhur nuk ka pronar të regjistruar." });
    }
  }
  if (!ownerUserId) {
    return res.status(400).json({ gabim: "Specifikoni pronarin ose lokalin kryesor." });
  }

  const result = await linkClientToOwnerUser(clientId, ownerUserId);
  await logAdminActivity({
    ...activityFromReq(req),
    action: "client_link_owner_group",
    targetType: "client",
    targetId: clientId,
    targetLabel: result.owner_group_id,
  });
  res.json({ ok: true, ...result });
}));

/**
 * Link zyrtar Setup (me token) — jo publik.
 * GET /api/admin/setup-download-link?ttlHours=168&plan=p1
 */
router.get(
  "/setup-download-link",
  asyncHandler(async (req, res) => {
    const {
      createSetupDownloadToken,
      isSetupDownloadConfigured,
    } = require("../lib/setupDownloadAuth");
    const {
      getPublicAppOrigin,
      getSetupVersion,
      DEFAULT_SETUP_LINK_TTL_HOURS,
    } = require("../lib/publicOrigin");
    if (!isSetupDownloadConfigured()) {
      return res.status(503).json({
        ok: false,
        gabim: "Vendosni SETUP_DOWNLOAD_SECRET (ose JWT_SECRET) në Railway.",
      });
    }
    const ttlHours = Number(req.query.ttlHours || DEFAULT_SETUP_LINK_TTL_HOURS);
    const plan = String(req.query.plan || "").trim().toLowerCase();
    const token = createSetupDownloadToken({ ttlHours, plan });
    const origin = getPublicAppOrigin();
    const qs = new URLSearchParams({ t: token });
    if (plan) qs.set("plan", plan);
    const url = `${origin}/api/public/setup-download?${qs.toString()}`;
    await logAdminActivity({
      ...activityFromReq(req),
      action: "setup_download_link",
      targetType: "setup",
      targetLabel: getSetupVersion(),
    });
    res.json({
      ok: true,
      url,
      setup_version: getSetupVersion(),
      expires_in_hours: Math.min(
        720,
        Math.max(1, ttlHours || DEFAULT_SETUP_LINK_TTL_HOURS),
      ),
    });
  }),
);

/**
 * Pagesa bankare — listë. Fatura lëshohet VETËM me confirm.
 */
router.get(
  "/bank-payments",
  asyncHandler(async (req, res) => {
    const {
      listBankPayments,
    } = require("../services/bankTransferPaymentService");
    const status = String(req.query.status || "").trim() || undefined;
    const payments = await listBankPayments({ status });
    res.json({ ok: true, payments });
  }),
);

/**
 * Konfirmo pagesën në bankë → krijo licencë + dërgo faturë PDF (vulë/datë) me email.
 * Pa këtë hap → nuk ka faturë.
 */
router.post(
  "/bank-payments/:token/confirm",
  asyncHandler(async (req, res) => {
    const {
      confirmBankPaymentAndIssueInvoice,
    } = require("../services/bankTransferPaymentService");
    const token = String(req.params.token || "").trim();
    try {
      const result = await confirmBankPaymentAndIssueInvoice(token, {
        adminEmail: req.user?.email || "super_admin",
      });
      await logAdminActivity({
        ...activityFromReq(req),
        action: "bank_payment_confirm_invoice",
        targetType: "license_payment",
        targetId: token,
        targetLabel: result.invoice_number || token,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      const code = e.code || "ERROR";
      const status =
        code === "NOT_FOUND"
          ? 404
          : code === "NOT_BANK" || code === "INVALID_STATUS"
            ? 400
            : 400;
      res.status(status).json({ ok: false, gabim: e.message || String(e), code });
    }
  }),
);

module.exports = router;
