const express = require("express");
const { licenseApiKeyOptional } = require("../middleware/auth");
const { validateLicense, getLicenseAccessLinks, reportHardwareId } = require("../services/licenseService");
const { verifyMasterPin, verifyDailyEmergencyCode, isMasterPinConfigured } = require("../lib/emergencyPin");
const { logAdminActivity } = require("../services/activityLogService");
const { verifyWaiterPin, listWaitersForOwner } = require("../services/waiterPinService");
const { getClientById } = require("../services/salesService");
const { getPublicAppOrigin } = require("../lib/publicOrigin");
const { ensureKitchenCredentials, enrichWaitersWithWebLinks } = require("../lib/kitchenAccess");
const { createKasaSessionToken } = require("../lib/kasaSession");
const {
  listOwnerReservations,
  createOwnerReservation,
  updateOwnerReservationStatus,
  getMaxTableNumber,
} = require("../services/reservationService");
const { acknowledgeBarOrders, cancelBarOrders } = require("../services/kdsService");
const {
  listPendingOnlineOrders,
  listBarMobileOrderedForPos,
  countPendingOnlineOrders,
  refusePendingOnlineOrder,
} = require("../services/onlineOrdersService");
const {
  listClosedWebWaiterSalesForPos,
  listAllClosedSalesForPosRebuild,
} = require("../services/salesService");

const router = express.Router();

function clientIp(req) {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || req.ip || "";
}

/** Licencë pa kontroll app_type — porositë online janë për klientin, jo për modulin POS. */
async function resolveLicenseClient(req) {
  const { celesi, license_key, device_id, hostname } = req.body;
  const key = celesi || license_key;
  if (!key) {
    return { error: { status: 400, body: { ok: false, gabim: "Mungon çelësi i licencës." } } };
  }

  const licenseResult = await validateLicense({
    celesi: key,
    device_id,
    hostname,
    client_ip: clientIp(req),
  });
  if (!licenseResult.valid) {
    return {
      error: {
        status: 403,
        body: { ok: false, gabim: licenseResult.message || "Liçenca nuk është aktive." },
      },
    };
  }
  return { clientId: licenseResult.client_id };
}

/**
 * POST /api/v1/license/validate
 */
router.post("/validate", licenseApiKeyOptional, async (req, res) => {
  try {
    const {
      celesi,
      license_key,
      device_id,
      app_type,
      hostname,
      hardware_id,
      contact_email,
      activation_email,
    } = req.body;
    const key = celesi || license_key;
    if (!key) {
      return res.status(400).json({ valid: false, gabim: "Mungon çelësi i licencës." });
    }

    const result = await validateLicense({
      celesi: key,
      device_id,
      app_type,
      hostname,
      hardware_id,
      contact_email: contact_email || activation_email,
      activation_email,
      client_ip: clientIp(req),
    });

    const status = result.valid ? 200 : 403;
    res.status(status).json(result);
  } catch (e) {
    res.status(500).json({ valid: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/report-hardware
 * POS dërgon Hardware ID 16 — admini e sheh te Licencat dhe Gjenero funksionon me një shtypje.
 */
router.post("/report-hardware", licenseApiKeyOptional, async (req, res) => {
  try {
    const { device_id, hardware_id, celesi, license_key, contact_email, activation_email } =
      req.body || {};
    const result = await reportHardwareId({
      device_id,
      hardware_id,
      celesi: celesi || license_key,
      contact_email: contact_email || activation_email,
      activation_email,
    });
    if (!result.ok) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message || String(e) });
  }
});

/**
 * POST /api/v1/license/access-links — linket e plota për POS (kamarier, KDS, kiosk, website)
 */
router.post("/access-links", licenseApiKeyOptional, async (req, res) => {
  try {
    const { celesi, license_key, device_id, app_type, hostname } = req.body;
    const key = celesi || license_key;
    if (!key) {
      return res.status(400).json({ ok: false, valid: false, gabim: "Mungon çelësi i licencës." });
    }

    const result = await getLicenseAccessLinks({
      celesi: key,
      device_id,
      app_type,
      hostname,
      client_ip: clientIp(req),
    });

    const status = result.valid ? 200 : 403;
    res.status(status).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, valid: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/heartbeat — POS kontrollon çdo ≤60s për bllokim / force logout
 */
router.post("/heartbeat", licenseApiKeyOptional, async (req, res) => {
  try {
    const { celesi, license_key, device_id, app_type, hostname, hardware_id } = req.body;
    const key = celesi || license_key;
    if (!key) {
      return res.status(400).json({ ok: false, valid: false, gabim: "Mungon çelësi i licencës." });
    }

    let result = await validateLicense({
      celesi: key,
      device_id,
      app_type,
      hostname,
      hardware_id,
      client_ip: clientIp(req),
    });

    // Admini ndryshoi çelësin në cloud — gjej licencën sipas device_id dhe kthe çelësin e ri
    if (!result.valid && result.code === "NOT_FOUND" && device_id) {
      const { findLicenseByDeviceId } = require("../services/licenseService");
      const byDevice = await findLicenseByDeviceId(device_id);
      if (byDevice && byDevice.celesi) {
        result = await validateLicense({
          celesi: byDevice.celesi,
          device_id,
          app_type,
          hostname,
          hardware_id,
          client_ip: clientIp(req),
        });
        if (result.valid) {
          result.celesi_updated = byDevice.celesi;
          result.celesi = byDevice.celesi;
        }
      }
    }

    if (result.valid && result.celesi && String(result.celesi).toUpperCase() !== String(key).toUpperCase()) {
      result.celesi_updated = result.celesi;
    }

    if (!result.valid && (result.code === "NOT_FOUND" || result.code === "REVOKED" || result.code === "EXPIRED")) {
      result.force_factory_reset = true;
      result.force_logout = true;
    }

    res.status(result.valid ? 200 : 403).json({
      ok: result.valid,
      ...result,
      server_time: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, valid: false, gabim: e.message });
  }
});

/** true vetëm nëse latest > current (semver i thjeshtë). */
function isNewerSetupVersion(latestRaw, currentRaw) {
  const parse = (v) =>
    String(v || "")
      .replace(/^v/i, "")
      .trim()
      .split(/[.+-]/)
      .map((p) => parseInt(p, 10))
      .filter((n) => Number.isFinite(n));
  const a = parse(latestRaw);
  const b = parse(currentRaw);
  if (!a.length || !b.length) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/**
 * POST /api/v1/license/update-info — update VETËM nëse licenca është valide.
 * Kthen link shkarkimi me token (jo URL publike e hapur).
 */
router.post("/update-info", licenseApiKeyOptional, async (req, res) => {
  try {
    const { celesi, license_key, device_id, current_version } = req.body || {};
    const key = celesi || license_key;
    if (!key) {
      return res.status(400).json({ ok: false, gabim: "Mungon çelësi i licencës." });
    }
    const result = await validateLicense({
      celesi: key,
      device_id,
      client_ip: clientIp(req),
    });
    if (!result.valid) {
      return res.status(403).json({ ok: false, update_available: false, gabim: result.message });
    }

    const {
      getSetupVersion,
      getPublicAppOrigin,
    } = require("../lib/publicOrigin");
    const {
      createSetupDownloadToken,
      isSetupDownloadConfigured,
    } = require("../lib/setupDownloadAuth");

    const latest = getSetupVersion();
    const current = String(current_version || "").replace(/^v/i, "").trim();
    /* Vetëm kur cloud ka version MË TË RI — kurrë downgrade (p.sh. 239 → 238). */
    const updateAvailable = isNewerSetupVersion(latest, current);

    let download_url = null;
    if (updateAvailable && isSetupDownloadConfigured()) {
      const { DEFAULT_SETUP_LINK_TTL_HOURS } = require("../lib/publicOrigin");
      const token = createSetupDownloadToken({ ttlHours: DEFAULT_SETUP_LINK_TTL_HOURS });
      const origin = getPublicAppOrigin();
      download_url = `${origin}/api/public/setup-download?t=${encodeURIComponent(token)}`;
    }

    res.json({
      ok: true,
      update_available: updateAvailable,
      latest_version: latest,
      current_version: current || null,
      download_url,
      message: updateAvailable
        ? "Ka version të ri — shkarkoni vetëm nga linku zyrtar."
        : "Jeni në versionin e fundit.",
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/ack-factory-reset — POS konfirmon që e ka marrë urdhrin e rivendosjes
 */
router.post("/ack-factory-reset", licenseApiKeyOptional, async (req, res) => {
  try {
    const { celesi, license_key, hardware_id } = req.body || {};
    const key = celesi || license_key;
    if (!key) {
      return res.status(400).json({ ok: false, gabim: "Mungon çelësi i licencës." });
    }
    const { ackFactoryResetByKey } = require("../services/licenseService");
    const result = await ackFactoryResetByKey(key, hardware_id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/emergency-code-request — kamarieri «Harruat PIN?» → email te pronari.
 * Body: { celesi|license_key, device_id?, waiter_name? } — kodi NUK kthehet në JSON.
 */
router.post("/emergency-code-request", licenseApiKeyOptional, async (req, res) => {
  try {
    const { requestEmergencyCodeEmail } = require("../services/emergencyCodeEmailService");
    const result = await requestEmergencyCodeEmail(req.body || {});
    res.json(result);
  } catch (e) {
    const status =
      e.code === "RATE_LIMIT" || e.code === "DAILY_LIMIT"
        ? 429
        : e.code === "LICENSE_INVALID" || e.code === "NO_LICENSE"
          ? 403
          : e.code === "EMAIL_NOT_CONFIGURED" || e.code === "NOT_CONFIGURED"
            ? 503
            : e.code === "NO_OWNER_EMAIL"
              ? 400
              : 500;
    res.status(status).json({
      ok: false,
      sent: false,
      gabim: e.message,
      code: e.code || null,
      message: "Kodi u dërgua te pronari juaj — kontaktoni pronarin.",
    });
  }
});

/**
 * POST /api/v1/license/emergency-unlock — Master PIN (online) ose kod ditor (offline backup)
 * Body: { master_pin?, emergency_code?, device_id, app_type?, hostname? }
 */
router.post("/emergency-unlock", licenseApiKeyOptional, async (req, res) => {
  try {
    const { master_pin, emergency_code, device_id, app_type, hostname } = req.body;
    const pinOk = verifyMasterPin(master_pin);
    const codeInput = String(emergency_code || "").trim() || String(master_pin || "").trim();
    const codeOk = verifyDailyEmergencyCode(codeInput);

    if (!pinOk && !codeOk) {
      return res.status(403).json({
        valid: false,
        code: "EMERGENCY_DENIED",
        message: "PIN ose kodi emergjence i gabuar.",
      });
    }

    if (!isMasterPinConfigured() && !codeOk) {
      return res.status(503).json({
        valid: false,
        code: "NOT_CONFIGURED",
        message: "MASTER_EMERGENCY_PIN nuk është konfiguruar në server.",
      });
    }

    await logAdminActivity({
      actorEmail: "emergency@pos",
      action: pinOk ? "emergency_unlock_pin" : "emergency_unlock_code",
      targetType: "device",
      targetId: String(device_id || "").trim().toUpperCase(),
      targetLabel: hostname || "",
      details: { app_type: app_type || null, method: pinOk ? "pin" : "daily_code" },
    });

    const until = new Date();
    until.setHours(23, 59, 59, 999);

    res.json({
      valid: true,
      emergency: true,
      message: "Hapje emergjence e autorizuar.",
      valid_until: until.toISOString(),
      device_id: String(device_id || "").trim().toUpperCase(),
    });
  } catch (e) {
    res.status(500).json({ valid: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/kasa-pin — PIN kamarieri (4 shifra) ose emergjencë
 */
router.post("/kasa-pin", licenseApiKeyOptional, async (req, res) => {
  try {
    const { celesi, license_key, device_id, app_type, hostname, pin } = req.body;
    const key = celesi || license_key;
    const pinStr = String(pin || "").trim();
    if (!key) {
      return res.status(400).json({ valid: false, gabim: "Mungon çelësi i licencës." });
    }
    if (!pinStr) {
      return res.status(400).json({ valid: false, gabim: "Vendosni PIN-in." });
    }

    const licenseResult = await validateLicense({
      celesi: key,
      device_id,
      app_type,
      hostname,
      client_ip: clientIp(req),
    });
    if (!licenseResult.valid) {
      return res.status(403).json({
        valid: false,
        gabim: licenseResult.message || "Liçenca nuk është aktive.",
      });
    }

    const clientId = licenseResult.client_id;
    if (/^\d{4}$/.test(pinStr)) {
      try {
        const waiter = await verifyWaiterPin(clientId, pinStr);
        return res.json({
          valid: true,
          role: "waiter",
          waiter,
          session_token: createKasaSessionToken(clientId, waiter.id),
        });
      } catch {
        /* vazhdo te emergjenca */
      }
    }

    const pinOk = verifyMasterPin(pinStr);
    const codeOk = verifyDailyEmergencyCode(pinStr.replace(/\D/g, ""));
    if (pinOk || codeOk) {
      return res.json({
        valid: true,
        role: "admin",
        message: "Hapje e autorizuar.",
      });
    }

    return res.status(403).json({ valid: false, gabim: "PIN i gabuar." });
  } catch (e) {
    res.status(500).json({ valid: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/waiters-list — kamarierët me PIN për kasën desktop
 */
router.post("/waiters-list", licenseApiKeyOptional, async (req, res) => {
  try {
    const { celesi, license_key, device_id, app_type, hostname } = req.body;
    const key = celesi || license_key;
    if (!key) {
      return res.status(400).json({ ok: false, gabim: "Mungon çelësi i licencës." });
    }

    const licenseResult = await validateLicense({
      celesi: key,
      device_id,
      app_type,
      hostname,
      client_ip: clientIp(req),
    });
    if (!licenseResult.valid) {
      return res.status(403).json({
        ok: false,
        gabim: licenseResult.message || "Liçenca nuk është aktive.",
      });
    }

    const waiters = await listWaitersForOwner(licenseResult.client_id);
    let client = await getClientById(licenseResult.client_id);
    if (client) client = await ensureKitchenCredentials(client);
    const base = getPublicAppOrigin();
    const active = (waiters || []).filter(w => w.active !== false && w.has_pin);
    res.json({
      ok: true,
      waiters: enrichWaitersWithWebLinks(base, client, active),
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/waiter-login — PIN + (ops.) id kamarieri
 */
router.post("/waiter-login", licenseApiKeyOptional, async (req, res) => {
  try {
    const { celesi, license_key, device_id, app_type, hostname, pin, waiter_id, staff_id } = req.body;
    const key = celesi || license_key;
    const pinStr = String(pin || "").trim();
    const wantedId = String(waiter_id || staff_id || "").trim();
    if (!key) {
      return res.status(400).json({ ok: false, gabim: "Mungon çelësi i licencës." });
    }
    if (!/^\d{4}$/.test(pinStr)) {
      return res.status(400).json({ ok: false, gabim: "PIN duhet të jetë 4 shifra." });
    }

    const licenseResult = await validateLicense({
      celesi: key,
      device_id,
      app_type,
      hostname,
      client_ip: clientIp(req),
    });
    if (!licenseResult.valid) {
      return res.status(403).json({
        ok: false,
        gabim: licenseResult.message || "Liçenca nuk është aktive.",
      });
    }

    const waiter = await verifyWaiterPin(licenseResult.client_id, pinStr);
    if (wantedId && String(waiter.id) !== wantedId) {
      return res.status(403).json({ ok: false, gabim: "PIN i gabuar." });
    }

    res.json({ ok: true, valid: true, role: "waiter", waiter });
  } catch (e) {
    res.status(403).json({ ok: false, gabim: e.message || "PIN i gabuar." });
  }
});

/**
 * POST /api/v1/license/waiter-closed-sales — porosi WEB-WAITER të mbyllura (sync pazari lokal)
 */
router.post("/waiter-closed-sales", licenseApiKeyOptional, async (req, res) => {
  try {
    const resolved = await resolveLicenseClient(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }
    const rebuild = req.body.rebuild === true || req.body.rebuild === "true";
    const since = String(req.body.since || req.body.closed_after || "").trim();
    const sales = rebuild
      ? await listAllClosedSalesForPosRebuild(resolved.clientId)
      : await listClosedWebWaiterSalesForPos(resolved.clientId, since);
    console.log(
      "[license/waiter-closed-sales] client=",
      resolved.clientId,
      rebuild ? "rebuild=all-closed" : `since=${since || "(all)"}`,
      "count=",
      sales.length,
    );
    res.json({ ok: true, sales, count: sales.length });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/pending-online-orders — numri i porosive kiosk/online
 */
router.post("/pending-online-orders", licenseApiKeyOptional, async (req, res) => {
  try {
    const resolved = await resolveLicenseClient(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const pending = await countPendingOnlineOrders(resolved.clientId);
    res.json({ ok: true, pending, has_pending: pending > 0 });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/online-orders — listë porosish banak (për ekranin e hyrjes POS)
 */
router.post("/online-orders", licenseApiKeyOptional, async (req, res) => {
  try {
    const resolved = await resolveLicenseClient(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const allOrders = await listBarMobileOrderedForPos(resolved.clientId);
    const orders = await listPendingOnlineOrders(resolved.clientId);
    res.json({
      ok: true,
      pending: orders.length,
      has_pending: orders.length > 0,
      orders,
      all_orders: allOrders,
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/online-orders/acknowledge — shëno porositë e banakut si të marra (ndalon alarmin)
 */
router.post("/online-orders/acknowledge", licenseApiKeyOptional, async (req, res) => {
  try {
    const resolved = await resolveLicenseClient(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const rawIds = Array.isArray(req.body.order_ids)
      ? req.body.order_ids
      : (req.body.order_id ? [req.body.order_id] : []);
    const pin = String(req.body.pin || req.body.waiter_pin || "").trim();

    let handler = null;
    if (pin) {
      handler = await verifyWaiterPin(resolved.clientId, pin);
    } else {
      return res.status(400).json({
        ok: false,
        gabim: "Vendosni PIN-in e kamarierit që e pranon porosinë.",
      });
    }

    const result = await acknowledgeBarOrders(resolved.clientId, rawIds, {
      waiterId: handler.id,
      waiterName: handler.name,
    });
    if (!result.count) {
      return res.json({
        ok: false,
        acknowledged: 0,
        order_ids: [],
        accepted_by: handler.name,
        gabim: "Porosia nuk u shënua në cloud — provoni përsëri ose kontrolloni migrimin e bazës.",
      });
    }
    res.json({
      ok: true,
      acknowledged: result.count,
      order_ids: result.ids,
      accepted_by: handler.name,
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/online-orders/refuse — REFUZO me grace 2 min (QR, Takeaway, Delivery)
 */
router.post("/online-orders/refuse", licenseApiKeyOptional, async (req, res) => {
  try {
    const resolved = await resolveLicenseClient(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const rawIds = Array.isArray(req.body.order_ids)
      ? req.body.order_ids
      : (req.body.order_id ? [req.body.order_id] : []);
    const orderId = String(req.body.order_id || rawIds[0] || "").trim();
    const pin = String(req.body.pin || req.body.waiter_pin || "").trim();
    const reason = String(req.body.reason || req.body.refuse_reason || "").trim();

    if (!orderId) {
      return res.status(400).json({ ok: false, gabim: "Zgjidhni porosinë." });
    }

    const result = await refusePendingOnlineOrder(resolved.clientId, orderId, { pin, reason });
    console.log("[online-orders/refuse] OK", {
      clientId: resolved.clientId,
      orderId,
      refused_by: result.refused_by,
      status: result.status,
      refuse_reason: result.refuse_reason || reason,
    });
    res.json(result);
  } catch (e) {
    console.error("[online-orders/refuse] FAIL", { error: e.message });
    const status = e.code === "MISSING_PIN" || e.code === "MISSING_ORDER" ? 400 : 500;
    res.status(status).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/online-orders/cancel — anulo porosi në pritje (pa pranuar / pa faturë)
 */
router.post("/online-orders/cancel", licenseApiKeyOptional, async (req, res) => {
  try {
    const resolved = await resolveLicenseClient(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const rawIds = Array.isArray(req.body.order_ids)
      ? req.body.order_ids
      : (req.body.order_id ? [req.body.order_id] : []);

    const result = await cancelBarOrders(resolved.clientId, rawIds, { reason: "license/online-orders/cancel" });
    if (!result.count) {
      if (result.skipped_grace?.length) {
        console.log("[online-orders/cancel] grace skip", {
          clientId: resolved.clientId,
          skipped_grace: result.skipped_grace,
        });
        return res.json({
          ok: true,
          cancelled: 0,
          order_ids: [],
          skipped_grace: result.skipped_grace,
          message: "Porosia në grace period pas REFUZO — mbetet aktive për kamarierët e tjerë.",
        });
      }
      return res.json({
        ok: false,
        cancelled: 0,
        order_ids: [],
        gabim: "Porosia nuk u anulua në cloud — provoni përsëri.",
      });
    }
    res.json({
      ok: true,
      cancelled: result.count,
      order_ids: result.ids,
      skipped_grace: result.skipped_grace || [],
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

router.post("/reservations/list", licenseApiKeyOptional, async (req, res) => {
  try {
    const resolved = await resolveLicenseClient(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }
    const { date, from, to } = req.body || {};
    const reservations = await listOwnerReservations(resolved.clientId, { date, from, to });
    const table_count = await getMaxTableNumber(resolved.clientId);
    res.json({ ok: true, reservations, table_count });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/reservations/create", licenseApiKeyOptional, async (req, res) => {
  try {
    const resolved = await resolveLicenseClient(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }
    const reservation = await createOwnerReservation(resolved.clientId, req.body);
    res.status(201).json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/reservations/update", licenseApiKeyOptional, async (req, res) => {
  try {
    const resolved = await resolveLicenseClient(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }
    const id = req.body?.reservation_id || req.body?.id;
    const reservation = await updateOwnerReservationStatus(
      resolved.clientId,
      id,
      req.body?.status,
    );
    res.json({ ok: true, reservation });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/refused-orders — lista e refuzimeve për panelin e pronarit (POS)
 */
router.post("/refused-orders", licenseApiKeyOptional, async (req, res) => {
  try {
    const resolved = await resolveLicenseClient(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }
    const { listRefusedOrders } = require("../services/orderRefusalService");
    const result = await listRefusedOrders(resolved.clientId, {
      from: req.body?.from || req.query?.from,
      to: req.body?.to || req.query?.to,
      limit: Number(req.body?.limit || req.query?.limit) || 100,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/license/security-alert — KAFENE: licence fail / DevTools / urgent
 * Auth: HMAC alert_sig (pa nevojë për licencë aktive — dështon para aktivizimit).
 */
router.post("/security-alert", async (req, res) => {
  try {
    const { handleSecurityAlert } = require("../services/licenseSecurityAlertService");
    const result = await handleSecurityAlert(req.body || {}, { clientIp: clientIp(req) });
    if (!result.ok) {
      return res.status(403).json(result);
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message || String(e) });
  }
});

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "revolution-pos-license",
    emergency_pin_configured: isMasterPinConfigured(),
  });
});

module.exports = router;
