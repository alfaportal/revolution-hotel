const express = require("express");
const { licenseApiKeyOptional } = require("../middleware/auth");
const {
  getFiscalSettings,
  processFiscalPayment,
  getFiscalPrintPayload,
} = require("../services/fiscalService");
const { findLicenseByKey, normalizeKey } = require("../services/licenseService");
const { assertLicenseUsable } = require("../lib/licenseEnforcement");

const router = express.Router();

/** GET /api/v1/fiscal/settings?celesi=... — POS lexon konfigurimin e arkës */
router.get("/settings", licenseApiKeyOptional, async (req, res) => {
  try {
    const celesi = normalizeKey(req.query.celesi || req.query.license_key);
    if (!celesi) {
      return res.status(400).json({ ok: false, gabim: "Mungon çelësi i licencës." });
    }
    const license = await findLicenseByKey(celesi);
    assertLicenseUsable(license);
    const settings = await getFiscalSettings(license.client_id);
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/** POST /api/v1/fiscal/print-payload — POS merr payload për COM port */
router.post("/print-payload", licenseApiKeyOptional, async (req, res) => {
  try {
    const result = await getFiscalPrintPayload(req.body);
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/fiscal/pay
 * Pas printimit në COM port (ose manual), POS regjistron pagesën.
 * Body: { celesi, device_id, items, total, cash_given, fiscal_result: { printed, coupon_nr, serial_nr }, manual? }
 */
router.post("/pay", licenseApiKeyOptional, async (req, res) => {
  try {
    const result = await processFiscalPayment(req.body);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

module.exports = router;
