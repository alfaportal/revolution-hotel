const { asyncHandler } = require("../lib/asyncHandler");
const {
  extractKitchenKey,
  verifyKitchenKey,
  getClientBySlugOrId,
  ensureKitchenCredentials,
} = require("../lib/kitchenAccess");

const resolveKitchenClient = asyncHandler(async (req, res, next) => {
  const identifier = req.params.slug || req.params.clientId;
  let client = await getClientBySlugOrId(identifier);
  if (!client) {
    return res.status(404).json({ ok: false, gabim: "Lokali nuk u gjet.", code: "NOT_FOUND" });
  }

  client = await ensureKitchenCredentials(client);
  const key = extractKitchenKey(req);

  if (!verifyKitchenKey(client, key)) {
    return res.status(403).json({
      ok: false,
      gabim: "Kodi i aksesit (key) mungon ose është i gabuar.",
      code: "KITCHEN_KEY_INVALID",
    });
  }

  req.kitchenClient = client;
  return next();
});

/** Tavolina publike — identifikohet vetëm me slug (QR pa key) */
const resolvePublicTableClient = asyncHandler(async (req, res, next) => {
  const identifier = req.params.slug || req.params.clientId;
  let client = await getClientBySlugOrId(identifier);
  if (!client) {
    return res.status(404).json({ ok: false, gabim: "Lokali nuk u gjet.", code: "NOT_FOUND" });
  }

  client = await ensureKitchenCredentials(client);
  req.kitchenClient = client;
  return next();
});

module.exports = { resolveKitchenClient, resolvePublicTableClient };
