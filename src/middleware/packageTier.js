const { clientHasFeature, packageUpgradeMessage } = require("../lib/packages");

function requirePackageFeature(feature) {
  return (req, res, next) => {
    const client = req.kitchenClient || req.client;
    if (!client?.id) {
      return res.status(500).json({ ok: false, gabim: "Klienti nuk u ngarkua.", code: "INTERNAL" });
    }
    if (!clientHasFeature(client, feature)) {
      return res.status(403).json({
        ok: false,
        gabim: packageUpgradeMessage(feature),
        code: "PACKAGE_UPGRADE_REQUIRED",
        feature,
        package_tier: client.package_tier || "pako_1",
      });
    }
    return next();
  };
}

module.exports = { requirePackageFeature };
