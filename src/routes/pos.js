const express = require("express");
const { licenseApiKeyOptional } = require("../middleware/auth");
const { syncCatalogFromPos, syncStaffOnlyFromPos, pullCatalogForLicense } = require("../services/posSyncService");
const {
  listPendingPurchasesForLicense,
  markPendingPurchaseApplied,
} = require("../services/posPendingPurchaseService");

const router = express.Router();

function catalogLicenseBody(req) {
  return {
    celesi:
      req.query.celesi ||
      req.query.license_key ||
      req.body?.celesi ||
      req.body?.license_key ||
      req.headers["x-license-key"],
  };
}

router.get("/catalog", licenseApiKeyOptional, async (req, res) => {
  try {
    const catalog = await pullCatalogForLicense(catalogLicenseBody(req));
    res.json({ ok: true, ...catalog });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/catalog/sync", licenseApiKeyOptional, async (req, res) => {
  try {
    const result = await syncCatalogFromPos(req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/staff/sync", licenseApiKeyOptional, async (req, res) => {
  try {
    const result = await syncStaffOnlyFromPos(req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/** Fatura blerjeje nga telefon/AI — POS i tërheq dhe i regjistron lokalisht. */
router.get("/pending-purchases", licenseApiKeyOptional, async (req, res) => {
  try {
    const result = await listPendingPurchasesForLicense(catalogLicenseBody(req));
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/pending-purchases/applied", licenseApiKeyOptional, async (req, res) => {
  try {
    const result = await markPendingPurchaseApplied({
      ...catalogLicenseBody(req),
      ...req.body,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

module.exports = router;
