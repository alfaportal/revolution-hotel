const express = require("express");
const { authRequired, superAdminOnly } = require("../middleware/auth");
const { asyncHandler } = require("../lib/asyncHandler");
const { listAiUsageSummary, aiUsageRowsToCsv, aiUsageDetailRowsToCsv } = require("../services/aiUsageReportService");
const { buildAiUsageInvoicePdf } = require("../services/aiBillingPdfService");
const { getClientById } = require("../services/salesService");
const { packageLabel } = require("../lib/packages");
const {
  generateHardwareLicenseKey,
  normalizeHardwareId,
  formatGrouped16,
} = require("../lib/hardwareLicense");
const {
  getOverview,
  getClientsGrouped,
  getClientDetail,
  getLicensesView,
  getAiUsageDashboard,
  getProblemsReport,
  ackProblem,
  getSettings,
  getSettingsAsync,
  updateSettingsAsync,
  listBillingInvoices,
  listBillingInvoicesAsync,
  createBillingInvoice,
  updateBillingInvoiceStatus,
  buildBillingInvoicePdf,
  PRODUCT_LINES,
} = require("../services/superAdminDashboardService");
const {
  createSecurityClient,
  updateSecurityClient,
  deleteSecurityClient,
  issueSecurityLicense,
  setSecurityLicenseStatus,
  deleteSecurityLicense,
  getSecurityClientDetail,
  setSecurityClientPassword,
  requestSecurityPasswordReset,
  updateSecurityLicense,
} = require("../services/securityAdminBridge");
const { normalizeProductLine } = require("../utils/productLine");
const { homeProduct } = require("../lib/productSupabase");
const {
  blockLicense,
  unblockLicense,
  updateLicense,
  updateLicenseStatus,
  updateClient,
  deleteLicense,
  deleteClient,
  revokeLicenseRemote,
  reactivateLicenseRemote,
  requestWipeDataForLicense,
} = require("../services/licenseService");
const {
  setOwnerPasswordForClient,
  sendPasswordResetForClient,
} = require("../services/userService");
const { sendOwnerPasswordResetEmail, isEmailConfigured } = require("../services/emailService");
const { addMonthsISO, todayISO } = require("../lib/licenseDates");
const { logAdminActivity, activityFromReq } = require("../services/activityLogService");
const { getPublicAppOrigin } = require("../lib/publicOrigin");

const router = express.Router();

router.use(authRequired, superAdminOnly);

/**
 * Gjenero LICENSE_KEY nga HARDWARE_ID i klientit (telefoni i Super Admin).
 * Body: { hardwareId, licenseType?: "trial"|"annual" }
 * → { licenseKey, licenseType, expiresAt, ... }
 */
router.post(
  "/generate-license-key",
  asyncHandler(async (req, res) => {
    const hardwareId = req.body?.hardwareId || req.body?.hardware_id || "";
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

router.get(
  "/ai-usage",
  asyncHandler(async (req, res) => {
    const summary = await listAiUsageSummary({ month: req.query.month });

    if (String(req.query.format || "").toLowerCase() === "csv") {
      const csv =
        String(req.query.detail || "").toLowerCase() === "1"
          ? aiUsageDetailRowsToCsv(summary.rows)
          : aiUsageRowsToCsv(summary.rows);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ai-usage-${summary.month}.csv"`,
      );
      return res.send(csv);
    }

    res.json({
      ok: true,
      month: summary.month,
      rows: summary.rows,
      totals: summary.totals,
      table_missing: summary.table_missing || false,
    });
  }),
);

/** Faturë PDF për një klient (tokenë AI të muajit). */
router.get(
  "/ai-usage/invoice-pdf",
  asyncHandler(async (req, res) => {
    const restaurantId = String(req.query.restaurant_id || "").trim();
    if (!restaurantId) {
      return res.status(400).json({ ok: false, gabim: "Mungon restaurant_id." });
    }
    const summary = await listAiUsageSummary({ month: req.query.month });
    const row = (summary.rows || []).find((r) => String(r.restaurant_id) === restaurantId);
    const client = await getClientById(restaurantId).catch(() => null);
    const pdf = buildAiUsageInvoicePdf({
      clientName: row?.local_name || client?.emri || restaurantId,
      month: summary.month,
      tokensTotal: row?.tokens_total || 0,
      costEur: row?.cost_eur_total || 0,
      calls: row?.calls || 0,
      packageTier: packageLabel(client?.package_tier),
      invoiceNo: `AI-${summary.month}-${String(restaurantId).slice(0, 8)}`,
      breakdown: row?.breakdown || {},
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ai-invoice-${summary.month}-${String(restaurantId).slice(0, 8)}.pdf"`,
    );
    res.send(pdf);
  }),
);

// ---- Desktop Super Admin dashboard (/admin/dashboard) — endpoint-e të reja ----

router.get(
  "/dashboard/products",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, products: PRODUCT_LINES });
  }),
);

router.get(
  "/dashboard/overview",
  asyncHandler(async (req, res) => {
    const product = req.query.product || req.query.industry || "all";
    res.json({ ok: true, ...(await getOverview({ product })) });
  }),
);

router.get(
  "/dashboard/clients",
  asyncHandler(async (req, res) => {
    const product = req.query.product || req.query.industry || homeProduct();
    res.json({ ok: true, ...(await getClientsGrouped({ product })) });
  }),
);

router.get(
  "/dashboard/clients/:id",
  asyncHandler(async (req, res) => {
    const raw = String(req.query.product || req.query.industry || homeProduct()).toLowerCase();
    const product = normalizeProductLine(raw);
    const preferSecurity = product === "security";
    const tryOrder = preferSecurity
      ? ["security", "kafene", "market", "hotel"]
      : product === "market" || product === "hotel"
        ? [product, "kafene", "security"]
        : ["kafene", "market", "hotel", "security"];
    let lastErr = null;
    for (const line of tryOrder) {
      try {
        if (line === "security") {
          const detail = await getSecurityClientDetail(req.params.id);
          return res.json({ ok: true, ...detail, product_line: "security" });
        }
        const detail = await getClientDetail(req.params.id, line);
        return res.json({ ok: true, ...detail, product_line: line });
      } catch (e) {
        lastErr = e;
      }
    }
    const err = lastErr || new Error("Klienti nuk u gjet");
    err.status = 404;
    throw err;
  }),
);

/** Master Admin — vendos fjalëkalim të ri për pronarin e klientit */
router.post(
  "/dashboard/clients/:id/set-password",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "").trim();
    const product = normalizeProductLine(
      req.body?.product_line || req.query.product || homeProduct(),
    );
    const password = req.body?.password || req.body?.new_password;
    if (product === "security") {
      const data = await setSecurityClientPassword(id, password);
      await logAdminActivity({
        ...activityFromReq(req),
        action: "security_password_set",
        targetType: "client",
        targetId: id,
      }).catch(() => {});
      return res.json({ ok: true, ...data, product_line: "security" });
    }
    const result = await setOwnerPasswordForClient(id, password, {
      email: req.body?.email,
      emri: req.body?.emri,
      baseUrl: getPublicAppOrigin(),
    });
    await logAdminActivity({
      ...activityFromReq(req),
      action: "owner_password_set",
      targetType: "client",
      targetId: id,
      details: { created: result.created, owners: (result.owners || []).map((o) => o.email) },
    }).catch(() => {});
    res.json({ ok: true, ...result, product_line: "kafene" });
  }),
);

/** Master Admin — dërgo kod rivendosjeje me email */
router.post(
  "/dashboard/clients/:id/send-password-reset",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "").trim();
    const product = normalizeProductLine(
      req.body?.product_line || req.query.product || homeProduct(),
    );
    if (product === "security") {
      const data = await requestSecurityPasswordReset(id);
      // Nëse SecureTrack nuk dërgoi email, dërgo nga POS (Resend)
      if (data?.email && data?.code && !data.email_sent) {
        if (!isEmailConfigured()) {
          throw Object.assign(
            new Error("Emaili nuk është i konfiguruar. Vendosni RESEND_API_KEY në Railway (POS)."),
            { code: "EMAIL_NOT_CONFIGURED" },
          );
        }
        await sendOwnerPasswordResetEmail({ to: data.email, code: data.code });
        data.email_sent = true;
        data.code = undefined; // mos e kthe kodin te klienti admin UI (opsionale — e fshehim)
      }
      await logAdminActivity({
        ...activityFromReq(req),
        action: "security_password_reset_email",
        targetType: "client",
        targetId: id,
        targetLabel: data?.email,
      }).catch(() => {});
      return res.json({
        ok: true,
        message: `Kodi i rivendosjes u dërgua te ${data.email}`,
        email: data.email,
        product_line: "security",
      });
    }
    const result = await sendPasswordResetForClient(id, getPublicAppOrigin());
    await logAdminActivity({
      ...activityFromReq(req),
      action: "owner_password_reset_email",
      targetType: "client",
      targetId: id,
      details: { sent: result.sent },
    }).catch(() => {});
    res.json({
      ok: true,
      message: `Kodi / ftesa u dërgua te: ${(result.sent || []).map((s) => s.email).join(", ")}`,
      ...result,
      product_line: "kafene",
    });
  }),
);

/**
 * Master Admin — ruaj klient (+ licenca) pa kufizime.
 * Body: { product_line?, emri, email, telefoni, …, licenses?: [{ id, celesi, hardware_id, device_id, statusi, data_skadimit }] }
 */
router.patch(
  "/dashboard/clients/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "").trim();
    const product = normalizeProductLine(
      req.body?.product_line || req.query.product || homeProduct(),
    );
    const body = req.body || {};
    const licPatches = Array.isArray(body.licenses) ? body.licenses : [];

    if (product === "security") {
      const data = await updateSecurityClient(id, body);
      const client = data.client || data;
      const licenses = [];
      const license_errors = [];
      for (const lp of licPatches) {
        if (!lp?.id) continue;
        try {
          const updated = await updateSecurityLicense(lp.id, {
            statusi: lp.statusi || lp.status,
            license_key: lp.celesi || lp.license_key,
            hardware_id: lp.hardware_id,
            expires_at: lp.data_skadimit || lp.expires_at,
          });
          licenses.push(updated.license || updated);
        } catch (licErr) {
          license_errors.push({ id: lp.id, gabim: licErr.message || "Gabim licence" });
        }
      }
      await logAdminActivity({
        ...activityFromReq(req),
        action: "security_client_update",
        targetType: "client",
        targetId: id,
        targetLabel: client?.emri || body.emri,
      }).catch(() => {});
      return res.json({
        ok: true,
        client,
        licenses,
        license_errors,
        product_line: "security",
      });
    }

    // Kafene / POS — ruaj klientin GJITHMONË; licencat veç e veç (një gabim licence mos e prish klientin)
    const client = await updateClient(id, { ...body, product_line: product });
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
        if (lp.device_id != null && String(lp.device_id).trim()) {
          patch.device_id = lp.device_id;
        }
        if (lp.statusi != null && String(lp.statusi).trim()) patch.statusi = lp.statusi;
        if (lp.data_skadimit != null && String(lp.data_skadimit).trim()) {
          patch.data_skadimit = lp.data_skadimit;
        }
        if (lp.max_terminals != null) patch.max_terminals = lp.max_terminals;
        if (!Object.keys(patch).length) continue;
        const license = await updateLicense(lp.id, patch);
        licenses.push(license);
      } catch (licErr) {
        license_errors.push({ id: lp.id, gabim: licErr.message || "Gabim licence" });
      }
    }

    await logAdminActivity({
      ...activityFromReq(req),
      action: "client_update",
      targetType: "client",
      targetId: client.id,
      targetLabel: client.emri,
      details: {
        licenses_updated: licenses.map((l) => l.id),
        license_errors,
      },
    }).catch(() => {});

    res.json({
      ok: true,
      client,
      licenses,
      license_errors,
      product_line: product === "hotel" || product === "market" ? product : "kafene",
    });
  }),
);

/** Fshi krejt klientin (+ licencat) — Super Admin, POS ose Security */
router.delete(
  "/dashboard/clients/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || "").trim();
    const product = normalizeProductLine(
      req.query.product || req.body?.product_line || homeProduct(),
    );
    if (product === "security") {
      const data = await deleteSecurityClient(id);
      await logAdminActivity({
        ...activityFromReq(req),
        action: "security_client_delete",
        targetType: "client",
        targetId: id,
        targetLabel: data?.emri,
      }).catch(() => {});
      return res.json({ ok: true, ...(data && typeof data === "object" ? data : {}), product_line: "security" });
    }
    await deleteClient(id, product);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "client_delete",
      targetType: "client",
      targetId: id,
    }).catch(() => {});
    res.json({ ok: true, product_line: "kafene" });
  }),
);

/** Master Admin — patch i lirë i çdo fushe licence */
router.patch(
  "/dashboard/licenses/:id",
  asyncHandler(async (req, res) => {
    const license = await updateLicense(req.params.id, req.body || {});
    await logAdminActivity({
      ...activityFromReq(req),
      action: "license_update",
      targetType: "license",
      targetId: license.id,
      targetLabel: license.celesi,
    }).catch(() => {});
    res.json({ ok: true, license });
  }),
);

router.get(
  "/dashboard/licenses",
  asyncHandler(async (req, res) => {
    const product = req.query.product || req.query.industry || homeProduct();
    res.json({ ok: true, ...(await getLicensesView({ product })) });
  }),
);

/** Krijo klient (+ licencë 16-shenja) në një kërkesë — kafene lokal / security upstream */
router.post(
  "/dashboard/clients",
  asyncHandler(async (req, res) => {
    const product = normalizeProductLine(
      req.body?.product_line || req.body?.industry_type || req.query.product,
    );
    const {
      generateHardwareLicenseKey,
      normalizeHardwareId,
      formatGrouped16,
    } = require("../lib/hardwareLicense");

    const wantLicense = req.body?.issue_license !== false && req.body?.issue_license !== "false";
    let celesi = String(req.body?.celesi || req.body?.license_key || "").trim();
    let hardwareId = String(req.body?.hardware_id || req.body?.hardwareId || "").trim();
    const licenseType =
      String(req.body?.license_type || req.body?.licenseType || "annual").toLowerCase() === "trial"
        ? "trial"
        : "annual";
    let dataSkadimit = req.body?.data_skadimit || null;
    let trialEndsAt = req.body?.trial_ends_at || null;
    let expiresAt = req.body?.expires_at || null;

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

    if (product === "security") {
      const data = await createSecurityClient(req.body || {});
      let license = null;
      if (wantLicense) {
        try {
          const issued = await issueSecurityLicense({
            client_id: data.client?.id,
            max_terminals: req.body?.max_terminals || 1,
            expires_at: expiresAt || dataSkadimit || null,
            license_key: celesi || undefined,
            celesi: celesi || undefined,
          });
          license = issued.license || issued;
        } catch (e) {
          console.warn("[super] security license issue:", e.message);
          const err = new Error(e.message || "Licenca Security dështoi");
          err.status = e.status || 400;
          throw err;
        }
      }
      await logAdminActivity({
        ...activityFromReq(req),
        action: "security_client_create",
        targetType: "client",
        targetId: data.client?.id,
        targetLabel: data.client?.emri,
        details: { license_key: license?.license_key || celesi || null },
      }).catch(() => {});
      return res.status(201).json({
        ok: true,
        client: data.client,
        license,
        hardware_id: hardwareId || null,
        product_line: "security",
      });
    }

    const { createClient, createLicense } = require("../services/licenseService");
    const { normalizeClientTipi, MARKET_TIPI, HOTEL_TIPI } = require("../utils/businessTipi");
    let tipi = normalizeClientTipi(req.body?.tipi || "restorant");
    if (product === "hotel") {
      tipi = HOTEL_TIPI.includes(tipi) ? tipi : "hotel";
    } else if (product === "furra") tipi = tipi === "pasticeri" ? "pasticeri" : "furre_buke";
    else if (product === "market") {
      tipi = MARKET_TIPI.includes(tipi) ? tipi : "minimarket";
    } else if (["furre_buke", "pasticeri", ...HOTEL_TIPI, ...MARKET_TIPI].includes(tipi)) {
      tipi = "restorant";
    }
    const client = await createClient({
      ...(req.body || {}),
      tipi,
      product_line: product === "hotel" || product === "market" ? product : "kafene",
    });
    let license = null;
    if (wantLicense) {
      try {
        license = await createLicense({
          client_id: client.id,
          app_type: product === "market" ? "market" : req.body?.app_type,
          product_line: product === "hotel" || product === "market" ? product : "kafene",
          license_type: licenseType,
          muaj: licenseType === "trial" ? 1 : req.body?.muaj || 12,
          max_terminals: req.body?.max_terminals || 1,
          celesi: celesi || undefined,
          hardware_id: hwHex.length === 16 ? hardwareId : undefined,
          data_skadimit: dataSkadimit || undefined,
          // annual → null (jo 3 muaj “trial” të rremë)
          trial_ends_at: licenseType === "trial" ? (trialEndsAt || undefined) : null,
        });
      } catch (e) {
        console.warn("[super] kafene license issue:", e.message);
        const err = new Error(e.message || "Licenca dështoi");
        err.status = 400;
        throw err;
      }
    }
    await logAdminActivity({
      ...activityFromReq(req),
      action: "client_create",
      targetType: "client",
      targetId: client.id,
      targetLabel: client.emri,
      details: {
        license_id: license?.id,
        license_celesi: license?.celesi || celesi || null,
        hardware_id: hardwareId || null,
      },
    }).catch(() => {});
    res.status(201).json({
      ok: true,
      client,
      license,
      hardware_id: hardwareId || null,
      product_line: product === "hotel" || product === "market" ? product : "kafene",
    });
  }),
);

router.post(
  "/dashboard/security/licenses/:id/status",
  asyncHandler(async (req, res) => {
    const license = await setSecurityLicenseStatus(req.params.id, req.body?.statusi || req.body?.status);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "security_license_status",
      targetType: "license",
      targetId: req.params.id,
      details: { status: req.body?.statusi || req.body?.status },
    }).catch(() => {});
    res.json({ ok: true, license: license.license || license });
  }),
);

/** Fshi krejt licencën (Super Admin) — POS */
router.delete(
  "/dashboard/licenses/:id",
  asyncHandler(async (req, res) => {
    await deleteLicense(req.params.id);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "license_delete",
      targetType: "license",
      targetId: req.params.id,
    }).catch(() => {});
    res.json({ ok: true });
  }),
);

/** Fshi krejt licencën Security (bridge → SecureTrack) */
router.delete(
  "/dashboard/security/licenses/:id",
  asyncHandler(async (req, res) => {
    const data = await deleteSecurityLicense(req.params.id);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "security_license_delete",
      targetType: "license",
      targetId: req.params.id,
    }).catch(() => {});
    res.json({ ok: true, ...(data && typeof data === "object" ? data : {}) });
  }),
);

router.post(
  "/dashboard/licenses/:id/block",
  asyncHandler(async (req, res) => {
    const license = await blockLicense(req.params.id);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "license_block",
      targetType: "license",
      targetId: license.id,
      targetLabel: license.celesi,
    }).catch(() => {});
    res.json({ ok: true, license });
  }),
);

router.post(
  "/dashboard/licenses/:id/unblock",
  asyncHandler(async (req, res) => {
    const license = await unblockLicense(req.params.id);
    await logAdminActivity({
      ...activityFromReq(req),
      action: "license_unblock",
      targetType: "license",
      targetId: license.id,
      targetLabel: license.celesi,
    }).catch(() => {});
    res.json({ ok: true, license });
  }),
);

/** Çaktivizo menjëherë (REVOKED) — heartbeat mbyll POS. */
router.post(
  "/dashboard/licenses/:id/revoke",
  asyncHandler(async (req, res) => {
    const result = await revokeLicenseRemote(req.params.id, {
      hardwareId: req.body?.hardware_id || req.body?.hardwareId,
      reason: req.body?.reason,
      actor: req.user,
    });
    await logAdminActivity({
      ...activityFromReq(req),
      action: "license_revoke",
      targetType: "license",
      targetId: result.license.id,
      targetLabel: result.license.celesi,
      details: { hardware_id: result.hardware_id, reason: req.body?.reason || "" },
    }).catch(() => {});
    res.json({ ok: true, ...result });
  }),
);

/** Riaktivizo pas çaktivizimit. */
router.post(
  "/dashboard/licenses/:id/reactivate",
  asyncHandler(async (req, res) => {
    const result = await reactivateLicenseRemote(req.params.id, {
      hardwareId: req.body?.hardware_id || req.body?.hardwareId,
      reason: req.body?.reason,
      actor: req.user,
    });
    await logAdminActivity({
      ...activityFromReq(req),
      action: "license_reactivate",
      targetType: "license",
      targetId: result.license.id,
      targetLabel: result.license.celesi,
      details: { hardware_id: result.hardware_id, reason: req.body?.reason || "" },
    }).catch(() => {});
    res.json({ ok: true, ...result });
  }),
);

/**
 * Fshi të dhënat lokale te POS (factory reset) — NUK çaktivizon licencën.
 * Body: { confirm: "FSHI TE DHENAT", reason?, hardware_id? }
 */
router.post(
  "/dashboard/licenses/:id/wipe-data",
  asyncHandler(async (req, res) => {
    const result = await requestWipeDataForLicense(req.params.id, {
      hardwareId: req.body?.hardware_id || req.body?.hardwareId,
      reason: req.body?.reason,
      confirm: req.body?.confirm,
      actor: req.user,
    });
    await logAdminActivity({
      ...activityFromReq(req),
      action: "license_wipe_data",
      targetType: "license",
      targetId: result.license_id,
      targetLabel: result.hardware_id || result.license_id,
      details: { hardware_id: result.hardware_id, reason: req.body?.reason || "" },
    }).catch(() => {});
    res.json({ ok: true, ...result });
  }),
);

/** Zgjat licencën me N muaj (nga sot ose nga data_skadimit nëse ende aktive). */
router.post(
  "/dashboard/licenses/:id/extend",
  asyncHandler(async (req, res) => {
    const months = Math.max(1, Math.min(36, Number(req.body?.months) || 12));
    const { getSupabase } = require("../db");
    const db = getSupabase();
    const { data: lic, error } = await db
      .from("licenses")
      .select("id, celesi, data_skadimit, statusi")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error || !lic) return res.status(404).json({ ok: false, gabim: "Licenca nuk u gjet." });
    const base =
      lic.data_skadimit && String(lic.data_skadimit) > todayISO()
        ? String(lic.data_skadimit)
        : todayISO();
    const data_skadimit = addMonthsISO(base, months);
    await updateLicense(lic.id, { data_skadimit });
    const license = await updateLicenseStatus(lic.id, "aktive");
    await logAdminActivity({
      ...activityFromReq(req),
      action: "license_extend",
      targetType: "license",
      targetId: license.id,
      targetLabel: license.celesi,
      details: { months, data_skadimit },
    }).catch(() => {});
    res.json({ ok: true, license, data_skadimit, months });
  }),
);

router.get(
  "/dashboard/ai-usage",
  asyncHandler(async (req, res) => {
    res.json({ ok: true, ...(await getAiUsageDashboard({ month: req.query.month })) });
  }),
);

/** Raportet = VETËM probleme (jo shitje). */
router.get(
  "/dashboard/reports",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...(await getProblemsReport()) });
  }),
);

router.get(
  "/dashboard/problems",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...(await getProblemsReport()) });
  }),
);

/** Shëno problem si të zgjidhur (pa prekur ID/email/çelës — ato te Klientët). */
router.post(
  "/dashboard/problems/ack",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const row = ackProblem({
      problem_key: body.problem_key,
      kind: body.kind,
      client_id: body.client_id || body.id || null,
      note: body.note,
      resolution: body.resolution,
    });
    res.json({ ok: true, ack: row });
  }),
);

router.get(
  "/dashboard/billing/invoices",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, invoices: await listBillingInvoicesAsync() });
  }),
);

router.post(
  "/dashboard/billing/invoices",
  asyncHandler(async (req, res) => {
    const invoice = await createBillingInvoice(req.body || {});
    res.status(201).json({ ok: true, invoice });
  }),
);

router.patch(
  "/dashboard/billing/invoices/:id",
  asyncHandler(async (req, res) => {
    const invoice = updateBillingInvoiceStatus(req.params.id, req.body?.status);
    res.json({ ok: true, invoice });
  }),
);

router.get(
  "/dashboard/billing/invoices/:id/pdf",
  asyncHandler(async (req, res) => {
    const all = await listBillingInvoicesAsync();
    const inv = all.find((x) => x.id === req.params.id) || listBillingInvoices().find((x) => x.id === req.params.id);
    if (!inv) return res.status(404).json({ ok: false, gabim: "Fatura nuk u gjet" });
    const pdf = buildBillingInvoicePdf(inv);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${inv.id}.pdf"`);
    res.send(pdf);
  }),
);

router.get(
  "/dashboard/settings",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, settings: await getSettingsAsync() });
  }),
);

router.put(
  "/dashboard/settings",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const settings = await updateSettingsAsync({
      ...body,
      _prices_are_marketing: true,
      package_prices_ui: body.package_prices_ui || body.package_prices || undefined,
    });
    res.json({ ok: true, settings });
  }),
);

module.exports = router;
