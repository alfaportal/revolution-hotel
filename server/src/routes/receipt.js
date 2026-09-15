const express = require("express");
const { licenseApiKeyOptional } = require("../middleware/auth");
const { findLicenseByKey, normalizeKey } = require("../services/licenseService");
const { assertLicenseUsable } = require("../lib/licenseEnforcement");
const { formatReceiptBundle, getBusinessProfile } = require("../services/receiptService");

const router = express.Router();

async function resolveClientId(body) {
  const celesi = normalizeKey(body.celesi || body.license_key);
  if (!celesi) throw new Error("Mungon çelësi i licencës.");
  const license = await findLicenseByKey(celesi);
  assertLicenseUsable(license);
  return license.client_id;
}

/** POST /api/v1/receipt/format — POS merr tekst + ESC/POS për printer termal */
router.post("/format", licenseApiKeyOptional, async (req, res) => {
  try {
    const clientId = req.body.client_id || await resolveClientId(req.body);
    const bundle = await formatReceiptBundle(clientId, req.body);
    res.json({ ok: true, ...bundle });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/** GET /api/v1/receipt/profile?celesi=... — header biznesi për faturë */
router.get("/profile", licenseApiKeyOptional, async (req, res) => {
  try {
    const celesi = normalizeKey(req.query.celesi || req.query.license_key);
    if (!celesi) {
      return res.status(400).json({ ok: false, gabim: "Mungon çelësi i licencës." });
    }
    const license = await findLicenseByKey(celesi);
    assertLicenseUsable(license);
    const profile = await getBusinessProfile(license.client_id);
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

module.exports = router;
