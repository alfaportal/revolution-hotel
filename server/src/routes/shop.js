const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { resolvePublicClient } = require("../middleware/publicAuth");
const {
  getPublicShopPage,
  buildShopManifest,
  buildShopServiceWorkerScript,
  getLogoResponse,
  getCoverResponse,
  getGalleryPhotoResponse,
  getMenuItemPhotoResponse,
} = require("../services/publicPageService");
const { submitPublicOrder } = require("../services/publicOrderService");
const { getPublicAppOrigin } = require("../lib/publicOrigin");
const { isShopStorefront } = require("../lib/storefront");

const router = express.Router();

function pageBaseUrl(_req) {
  return getPublicAppOrigin();
}

function rejectNonShop(req, res) {
  if (!isShopStorefront(req.publicClient)) {
    return res.status(404).json({
      ok: false,
      gabim: "Ky lokal nuk ka webfaqe dyqani. Përdorni /r/ slug.",
      code: "WRONG_STOREFRONT",
    });
  }
  return null;
}

router.get("/:slug", resolvePublicClient, asyncHandler(async (req, res) => {
  const wrong = rejectNonShop(req, res);
  if (wrong) return wrong;
  try {
    const page = await getPublicShopPage(req.params.slug, pageBaseUrl(req));
    if (!page) {
      return res.status(404).json({ ok: false, gabim: "Faqja e dyqanit nuk është e aktivizuar ose nuk u gjet." });
    }
    res.json({ ok: true, ...page });
  } catch (e) {
    if (e.code === "PACKAGE") {
      return res.status(403).json({ ok: false, gabim: e.message, code: "PACKAGE" });
    }
    if (e.code === "WRONG_STOREFRONT") {
      return res.status(404).json({ ok: false, gabim: e.message, code: e.code });
    }
    throw e;
  }
}));

router.post("/:slug/order", resolvePublicClient, asyncHandler(async (req, res) => {
  const wrong = rejectNonShop(req, res);
  if (wrong) return wrong;
  try {
    const result = await submitPublicOrder(req.publicClient, req.body);
    res.json(result);
  } catch (e) {
    if (e.code === "PACKAGE") {
      return res.status(403).json({ ok: false, gabim: e.message, code: "PACKAGE" });
    }
    res.status(400).json({ ok: false, gabim: e.message || "Porosia nuk u dërgua." });
  }
}));

router.get("/:slug/menu/:itemId/photo", resolvePublicClient, asyncHandler(async (req, res) => {
  const wrong = rejectNonShop(req, res);
  if (wrong) return wrong;
  const photo = await getMenuItemPhotoResponse(req.params.slug, req.params.itemId);
  if (!photo) {
    return res.status(404).type("text/plain").send("Not found");
  }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.type(photo.mime).send(photo.buffer);
}));

router.get("/:slug/logo", resolvePublicClient, asyncHandler(async (req, res) => {
  const wrong = rejectNonShop(req, res);
  if (wrong) return wrong;
  const size = Number(req.query.size) || 192;
  const logo = await getLogoResponse(req.params.slug, size);
  if (!logo) {
    return res.status(404).type("text/plain").send("Not found");
  }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.type(logo.mime).send(logo.buffer);
}));

router.get("/:slug/cover", resolvePublicClient, asyncHandler(async (req, res) => {
  const wrong = rejectNonShop(req, res);
  if (wrong) return wrong;
  const cover = await getCoverResponse(req.params.slug);
  if (!cover) {
    return res.status(404).type("text/plain").send("Not found");
  }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.type(cover.mime).send(cover.buffer);
}));

router.get("/:slug/gallery/:index", resolvePublicClient, asyncHandler(async (req, res) => {
  const wrong = rejectNonShop(req, res);
  if (wrong) return wrong;
  const photo = await getGalleryPhotoResponse(req.params.slug, req.params.index);
  if (!photo) {
    return res.status(404).type("text/plain").send("Not found");
  }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.type(photo.mime).send(photo.buffer);
}));

async function shopManifestHandler(req, res) {
  try {
    const page = await getPublicShopPage(req.params.slug, pageBaseUrl(req));
    if (!page) {
      return res.status(404).type("text/plain").send("Not found");
    }
    const manifest = buildShopManifest(page, pageBaseUrl(req));
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(manifest);
  } catch (e) {
    res.status(e.code === "PACKAGE" ? 403 : 500).type("text/plain").send(e.message);
  }
}

async function shopServiceWorkerHandler(req, res) {
  const client = req.publicClient;
  if (!client || !isShopStorefront(client)) {
    return res.status(404).type("text/plain").send("Not found");
  }
  const slug = client.kitchen_slug || client.id;
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Service-Worker-Allowed", `/s/${encodeURIComponent(slug)}/`);
  res.setHeader("Cache-Control", "no-cache");
  res.send(buildShopServiceWorkerScript(slug));
}

module.exports = {
  apiRouter: router,
  shopManifestHandler,
  shopServiceWorkerHandler,
};
