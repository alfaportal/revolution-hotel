/**
 * Bridge për POS Master Admin (revolution-restaurant-server).
 * Auth: x-admin-secret — pa JWT.
 */
const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const {
  getOverview,
  getClientsGrouped,
  getClientDetail,
  getLicensesView,
} = require("../services/superAdminDashboardService");
const {
  createClient,
  createLicense,
  updateClient,
  updateLicense,
  deleteClient,
  deleteLicense,
  revokeLicenseRemote,
} = require("../services/licenseService");
const {
  generateHardwareLicenseKey,
  normalizeHardwareId,
  formatGrouped16,
} = require("../lib/hardwareLicense");
const { normalizeClientTipi, HOTEL_TIPI } = require("../utils/businessTipi");
const { logAdminActivity, activityFromReq } = require("../services/activityLogService");

const router = express.Router();
const HOTEL_PRODUCT = "hotel";

function bridgeSecrets() {
  return new Set(
    [process.env.HOTEL_ADMIN_SECRET, process.env.SUPER_ADMIN_SECRET, process.env.ADMIN_SECRET]
      .map((s) => String(s || "").trim())
      .filter(Boolean),
  );
}

function bridgeSecretAuth(req, res, next) {
  const secrets = bridgeSecrets();
  if (!secrets.size) {
    return res.status(503).json({
      ok: false,
      gabim: "Bridge secret nuk është konfiguruar (HOTEL_ADMIN_SECRET / SUPER_ADMIN_SECRET / ADMIN_SECRET).",
      code: "BRIDGE_SECRET_MISSING",
    });
  }
  const provided = String(req.get("x-admin-secret") || req.body?.secret || "").trim();
  if (!provided || !secrets.has(provided)) {
    return res.status(401).json({ ok: false, gabim: "Unauthorized", code: "ADMIN_AUTH" });
  }
  next();
}

router.use(bridgeSecretAuth);

router.get(
  "/dashboard/overview",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...(await getOverview({ product: HOTEL_PRODUCT })) });
  }),
);

router.get(
  "/dashboard/clients",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...(await getClientsGrouped({ product: HOTEL_PRODUCT })) });
  }),
);

router.get(
  "/dashboard/licenses",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...(await getLicensesView({ product: HOTEL_PRODUCT })) });
  }),
);

router.get(
  "/dashboard/clients/:id",
  asyncHandler(async (req, res) => {
    const detail = await getClientDetail(req.params.id, HOTEL_PRODUCT);
    res.json({ ok: true, ...detail, product_line: HOTEL_PRODUCT });
  }),
);

router.post(
  "/dashboard/clients",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const wantLicense = body.issue_license !== false && body.issue_license !== "false";
    let celesi = String(body.celesi || body.license_key || "").trim();
    let hardwareId = String(body.hardware_id || body.hardwareId || "").trim();
    const licenseType =
      String(body.license_type || body.licenseType || "annual").toLowerCase() === "trial"
        ? "trial"
        : "annual";
    let dataSkadimit = body.data_skadimit || null;
    let trialEndsAt = body.trial_ends_at || null;
    let expiresAt = body.expires_at || null;

    const hwHex = normalizeHardwareId(hardwareId);
    if (wantLicense && hwHex.length === 16) {
      hardwareId = formatGrouped16(hwHex);
      if (!celesi) {
        const gen = generateHardwareLicenseKey(hwHex, { licenseType });
        celesi = gen.licenseKey;
        if (gen.expiresAt) {
          expiresAt = gen.expiresAt;
          dataSkadimit = String(gen.expiresAt).slice(0, 10);
        }
        if (gen.licenseType === "trial") {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() + (gen.trialDays || 7));
          trialEndsAt = d.toISOString();
          dataSkadimit = trialEndsAt.slice(0, 10);
        }
      }
    }

    let tipi = normalizeClientTipi(body.tipi || "hotel");
    tipi = HOTEL_TIPI.includes(tipi) ? tipi : "hotel";

    const client = await createClient({
      ...body,
      tipi,
      product_line: HOTEL_PRODUCT,
    });

    let license = null;
    if (wantLicense) {
      license = await createLicense({
        client_id: client.id,
        app_type: body.app_type,
        product_line: HOTEL_PRODUCT,
        license_type: licenseType,
        muaj: licenseType === "trial" ? 1 : body.muaj || 12,
        max_terminals: Math.min(4, Math.max(1, Number(body.max_terminals) || 1)),
        celesi: celesi || undefined,
        hardware_id: hwHex.length === 16 ? hardwareId : undefined,
        data_skadimit: dataSkadimit || undefined,
        trial_ends_at: licenseType === "trial" ? trialEndsAt || undefined : null,
      });
    }

    await logAdminActivity({
      ...activityFromReq(req),
      action: "hotel_bridge_client_create",
      targetType: "client",
      targetId: client.id,
      targetLabel: client.emri,
      details: {
        license_id: license?.id,
        license_celesi: license?.celesi || celesi || null,
        hardware_id: hardwareId || null,
        product_line: HOTEL_PRODUCT,
        bridge: true,
      },
    }).catch(() => {});

    res.status(201).json({
      ok: true,
      client,
      license,
      license_key: license?.celesi || celesi || null,
      celesi: license?.celesi || celesi || null,
      hardware_id: hardwareId || null,
      product_line: HOTEL_PRODUCT,
    });
  }),
);

router.patch(
  "/dashboard/clients/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "").trim();
    const body = { ...(req.body || {}), product_line: HOTEL_PRODUCT };
    const licPatches = Array.isArray(body.licenses) ? body.licenses : [];

    const client = await updateClient(id, body);
    const licenses = [];
    const license_errors = [];
    for (const lp of licPatches) {
      if (!lp?.id) continue;
      try {
        const patch = {};
        const key = String(lp.celesi || lp.license_key || "").trim();
        if (key) patch.celesi = key;
        if (lp.hardware_id != null || lp.hardwareId != null) {
          const hw = String(lp.hardware_id || lp.hardwareId || "").trim();
          if (hw) patch.hardware_id = hw;
        }
        if (lp.device_id != null && String(lp.device_id).trim()) patch.device_id = lp.device_id;
        if (lp.statusi != null && String(lp.statusi).trim()) patch.statusi = lp.statusi;
        if (lp.data_skadimit != null && String(lp.data_skadimit).trim()) {
          patch.data_skadimit = lp.data_skadimit;
        }
        if (lp.max_terminals != null) {
          patch.max_terminals = Math.min(4, Math.max(1, Number(lp.max_terminals) || 1));
        }
        if (!Object.keys(patch).length) continue;
        licenses.push(await updateLicense(lp.id, patch));
      } catch (licErr) {
        license_errors.push({ id: lp.id, gabim: licErr.message || "Gabim licence" });
      }
    }

    await logAdminActivity({
      ...activityFromReq(req),
      action: "hotel_bridge_client_update",
      targetType: "client",
      targetId: client.id,
      targetLabel: client.emri,
      details: { licenses_updated: licenses.map((l) => l.id), license_errors, bridge: true },
    }).catch(() => {});

    res.json({
      ok: true,
      client,
      licenses,
      license_errors,
      product_line: HOTEL_PRODUCT,
    });
  }),
);

router.delete(
  "/dashboard/clients/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "").trim();
    await deleteClient(id, HOTEL_PRODUCT);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "hotel_bridge_client_delete",
      targetType: "client",
      targetId: id,
      details: { product_line: HOTEL_PRODUCT, bridge: true },
    }).catch(() => {});
    res.json({ ok: true, product_line: HOTEL_PRODUCT });
  }),
);

router.delete(
  "/dashboard/licenses/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "").trim();
    await deleteLicense(id);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "hotel_bridge_license_delete",
      targetType: "license",
      targetId: id,
      details: { product_line: HOTEL_PRODUCT, bridge: true },
    }).catch(() => {});
    res.json({ ok: true, product_line: HOTEL_PRODUCT });
  }),
);

router.post(
  "/dashboard/licenses/:id/revoke",
  asyncHandler(async (req, res) => {
    const result = await revokeLicenseRemote(req.params.id, {
      hardwareId: req.body?.hardware_id || req.body?.hardwareId,
      reason: req.body?.reason || "Revokuar nga Super Admin (POS bridge)",
      actor: { email: "pos-bridge@revolution-pos.com", bridge: true },
    });
    await logAdminActivity({
      ...activityFromReq(req),
      action: "hotel_bridge_license_revoke",
      targetType: "license",
      targetId: result.license?.id || req.params.id,
      targetLabel: result.license?.celesi,
      details: {
        hardware_id: result.hardware_id,
        reason: req.body?.reason || "",
        product_line: HOTEL_PRODUCT,
        bridge: true,
      },
    }).catch(() => {});
    res.json({ ok: true, ...result, product_line: HOTEL_PRODUCT });
  }),
);

module.exports = router;
