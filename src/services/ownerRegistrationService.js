const crypto = require("crypto");
const { createClient, createLicense } = require("./licenseService");
const { createOwner } = require("./userService");
const { assertClientTipi, appTypeFromClientTipi } = require("../utils/businessTipi");

function isOwnerRegistrationEnabled() {
  return Boolean(String(process.env.OWNER_REGISTRATION_CODE || "").trim());
}

function verifyRegistrationCode(code) {
  const expected = String(process.env.OWNER_REGISTRATION_CODE || "").trim();
  if (!expected) {
    const err = new Error("Regjistrimi me kod nuk është aktiv. Kontaktoni Revolution Invest.");
    err.code = "REGISTRATION_DISABLED";
    throw err;
  }
  const given = String(code || "").trim();
  if (!given) {
    const err = new Error("Shkruani kodin e regjistrimit.");
    err.code = "INVALID_CODE";
    throw err;
  }
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const err = new Error("Kodi i regjistrimit është i gabuar.");
    err.code = "INVALID_CODE";
    throw err;
  }
}

async function registerOwnerWithCode(body, baseUrl) {
  verifyRegistrationCode(body.registration_code);

  const ownerEmri = String(body.emri || "").trim();
  const ownerEmail = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "").trim();
  const bizEmri = String(body.emri_biznesit || body.emri_biznesi || "").trim();
  const tipi = assertClientTipi(body.tipi || "restorant");

  if (!ownerEmri) throw new Error("Emri i pronarit është i detyrueshëm.");
  if (!ownerEmail) throw new Error("Email i pronarit është i detyrueshëm.");
  if (!password || password.length < 6) {
    throw new Error("Fjalëkalimi min. 6 karaktere.");
  }
  if (!bizEmri) throw new Error("Emri i biznesit është i detyrueshëm.");

  const appType = appTypeFromClientTipi(tipi);

  let client = null;
  let license = null;
  try {
    client = await createClient({
      emri: bizEmri,
      tipi,
      package_tier: body.package_tier || "pako_3",
      email: ownerEmail,
    });

    license = await createLicense({
      client_id: client.id,
      app_type: appType,
      muaj: 12,
    });

    const owner = await createOwner(
      {
        client_id: client.id,
        emri: ownerEmri,
        email: ownerEmail,
        password,
      },
      baseUrl,
    );

    return { client, license, owner };
  } catch (e) {
    if (license?.id) {
      try {
        const { deleteLicense } = require("./licenseService");
        await deleteLicense(license.id);
      } catch {
        /* best effort */
      }
    }
    if (client?.id) {
      try {
        const { deleteClient } = require("./licenseService");
        await deleteClient(client.id);
      } catch {
        /* best effort */
      }
    }
    throw e;
  }
}

module.exports = {
  isOwnerRegistrationEnabled,
  registerOwnerWithCode,
};
