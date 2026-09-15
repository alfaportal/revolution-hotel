const { verifyToken, licenseApiKeyOptional } = require("./auth");
const { findLicenseByKey, normalizeKey } = require("../services/licenseService");
const { assertLicenseUsable } = require("../lib/licenseEnforcement");

function extractOwnerToken(req) {
  const header = req.headers.authorization || "";
  const cookie = req.cookies?.owner_token;
  return header.startsWith("Bearer ") ? header.slice(7) : cookie;
}

function extractLicenseKey(req) {
  return (
    req.body?.license_key ||
    req.body?.celesi ||
    req.headers["x-license-key"] ||
    ""
  );
}

/** Autentifikon stafin: token pronari ose çelës licence POS. */
async function aiStaffAuth(req, res, next) {
  const ownerToken = extractOwnerToken(req);
  if (ownerToken) {
    try {
      const user = verifyToken(ownerToken);
      if (user.roli === "client_admin" && user.client_id) {
        req.user = user;
        req.license = { client_id: user.client_id };
        return next();
      }
    } catch {
      /* provo licence key */
    }
  }

  const rawKey = extractLicenseKey(req);
  const celesi = normalizeKey(rawKey);
  if (!celesi) {
    return res.status(401).json({ ok: false, gabim: "Kërkohet autentifikim (token pronari ose licence key)." });
  }

  try {
    const license = await findLicenseByKey(celesi);
    assertLicenseUsable(license);
    req.license = license;
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, gabim: e.message || "Licencë e pavlefshme." });
  }
}

/** Ngarkon kontekstin e klientit nëse ka token/çelës — pa kërkuar autentifikim. */
async function optionalAiStaffAuth(req, _res, next) {
  const ownerToken = extractOwnerToken(req);
  if (ownerToken) {
    try {
      const user = verifyToken(ownerToken);
      if (user.roli === "client_admin" && user.client_id) {
        req.user = user;
        req.license = { client_id: user.client_id };
        return next();
      }
    } catch {
      /* provo licence key */
    }
  }

  const celesi = normalizeKey(extractLicenseKey(req));
  if (celesi) {
    try {
      const license = await findLicenseByKey(celesi);
      assertLicenseUsable(license);
      req.license = license;
    } catch {
      /* status pa licencë të vlefshme */
    }
  }
  return next();
}

module.exports = { aiStaffAuth, optionalAiStaffAuth, licenseApiKeyOptional };
