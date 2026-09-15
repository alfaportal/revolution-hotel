const { asyncHandler } = require("../lib/asyncHandler");
const { getClientBySlugOrId } = require("../lib/kitchenAccess");

const resolvePublicClient = asyncHandler(async (req, res, next) => {
  const identifier = req.params.slug;
  const client = await getClientBySlugOrId(identifier);
  if (!client) {
    return res.status(404).json({ ok: false, gabim: "Restoranti nuk u gjet.", code: "NOT_FOUND" });
  }
  req.publicClient = client;
  return next();
});

module.exports = { resolvePublicClient };
