/**
 * SEO routes — robots.txt, sitemap.xml, /restorante.
 * Nuk prek porosi, sync, ose licencë.
 */
const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { buildRobotsTxt, buildSitemapXml } = require("../services/seoSitemapService");
const { renderDirectoryHtml } = require("../services/seoDirectoryHtml");

const router = express.Router();

router.get(
  "/robots.txt",
  (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.type("text/plain; charset=utf-8").send(buildRobotsTxt());
  },
);

router.get(
  "/sitemap.xml",
  asyncHandler(async (_req, res) => {
    const xml = await buildSitemapXml();
    res.set("Cache-Control", "public, max-age=300");
    res.type("application/xml; charset=utf-8").send(xml);
  }),
);

router.get(
  ["/restorante", "/restorante/"],
  asyncHandler(async (_req, res) => {
    const html = await renderDirectoryHtml({ mode: "all" });
    res.set("Cache-Control", "public, max-age=120");
    res.type("html").send(html);
  }),
);

router.get(
  ["/dyqane", "/dyqane/"],
  asyncHandler(async (_req, res) => {
    const html = await renderDirectoryHtml({ mode: "shops" });
    res.set("Cache-Control", "public, max-age=120");
    res.type("html").send(html);
  }),
);

module.exports = router;
