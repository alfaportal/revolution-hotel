const express = require("express");
const { licenseApiKeyOptional } = require("../middleware/auth");
const { validateLicense } = require("../services/licenseService");
const { syncHotelRooms, syncHotelGuests } = require("../services/hotelPmsSyncService");

const router = express.Router();

function clientIp(req) {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || req.ip || "";
}

async function resolveLicenseClient(req) {
  const { celesi, license_key, device_id, hostname } = req.body || {};
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

router.post("/rooms/sync", licenseApiKeyOptional, async (req, res) => {
  try {
    const resolved = await resolveLicenseClient(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }
    const result = await syncHotelRooms(resolved.clientId, req.body?.rooms);
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

router.post("/guests/sync", licenseApiKeyOptional, async (req, res) => {
  try {
    const resolved = await resolveLicenseClient(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }
    const result = await syncHotelGuests(resolved.clientId, req.body?.guests);
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, gabim: e.message });
  }
});

module.exports = router;
