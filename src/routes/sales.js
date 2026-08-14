const express = require("express");
const { licenseApiKeyOptional } = require("../middleware/auth");
const { syncSaleFromPos, updateActiveSaleFromPos, freeTableFromPos } = require("../services/salesService");

const router = express.Router();

/**
 * POST /api/v1/sales/sync
 * POS Electron dërgon shitje në kohë reale (zakonisht closed)
 */
router.post("/sync", licenseApiKeyOptional, async (req, res) => {
  try {
    const { sale, receipt } = await syncSaleFromPos(req.body);
    res.status(201).json({ ok: true, sale, receipt });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/sales/update
 * Përditëson porosinë aktive (ordered / cancelled) — tavolinat live
 */
router.post("/update", licenseApiKeyOptional, async (req, res) => {
  try {
    const sale = await updateActiveSaleFromPos(req.body);
    res.json({ ok: true, sale });
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

/**
 * POST /api/v1/sales/table-free
 * POS raporton tavolinë të lirë — mbyll të gjitha porositë aktive cloud për atë tavolinë
 */
router.post("/table-free", licenseApiKeyOptional, async (req, res) => {
  try {
    const result = await freeTableFromPos(req.body);
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

module.exports = router;
