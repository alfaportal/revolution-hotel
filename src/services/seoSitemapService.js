/**
 * Read-only listë e faqeve publike për sitemap + /restorante.
 * Nuk shkruan në DB. Nuk prek porosi / sync / licencë.
 */
const fs = require("fs");
const path = require("path");
const { getSupabase } = require("../db");
const { clientHasFeature } = require("../lib/packages");
const { isShopStorefront, storefrontPrefix } = require("../lib/storefront");
const { getPublicAppOrigin } = require("../lib/publicOrigin");

const ARTICLES_FILE = path.join(
  __dirname,
  "../../marketing-blog/src/data/articles.js",
);

function normalizeSlug(raw) {
  return String(raw || "").trim();
}

/**
 * @returns {Promise<Array<{
 *   slug: string,
 *   name: string,
 *   address: string,
 *   description: string,
 *   storefront: "r"|"s",
 *   path: string,
 *   url: string,
 * }>>}
 */
async function listPublicStorefronts() {
  const db = getSupabase();
  const origin = getPublicAppOrigin();

  const { data: clients, error } = await db
    .from("clients")
    .select("id, emri, adresa, tipi, package_tier, kitchen_slug")
    .not("kitchen_slug", "is", null);

  if (error) throw error;
  if (!clients?.length) return [];

  const withSlug = clients.filter((c) => normalizeSlug(c.kitchen_slug));
  if (!withSlug.length) return [];

  const ids = withSlug.map((c) => c.id);
  const { data: settingsRows, error: settingsErr } = await db
    .from("pos_settings")
    .select("client_id, public_enabled, restaurant_name, address, public_description")
    .in("client_id", ids);

  if (settingsErr) throw settingsErr;

  const settingsByClient = new Map(
    (settingsRows || []).map((row) => [row.client_id, row]),
  );

  const out = [];
  for (const client of withSlug) {
    if (!clientHasFeature(client, "website")) continue;

    const settings = settingsByClient.get(client.id);
    if (settings?.public_enabled === false) continue;

    const slug = normalizeSlug(client.kitchen_slug);
    const prefix = storefrontPrefix(client);
    const tipi = String(client.tipi || "").toLowerCase();
    const storePath = `/${prefix}/${encodeURIComponent(slug)}`;
    const name = String(settings?.restaurant_name || client.emri || slug).trim();
    const address = String(settings?.address || client.adresa || "").trim();
    const description = String(settings?.public_description || "").trim();

    out.push({
      slug,
      name,
      address,
      description,
      tipi,
      storefront: prefix,
      path: storePath,
      url: `${origin}${storePath}`,
      is_shop: isShopStorefront(client),
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, "sq"));
  return out;
}

function listBlogArticles() {
  try {
    const raw = fs.readFileSync(ARTICLES_FILE, "utf8");
    const slugs = [...raw.matchAll(/slug:\s*"([^"]+)"/g)].map((m) => m[1]);
    const titles = [...raw.matchAll(/title:\s*"([^"]+)"/g)].map((m) => m[1]);
    const unique = [];
    const seen = new Set();
    slugs.forEach((slug, i) => {
      if (seen.has(slug)) return;
      seen.add(slug);
      unique.push({ slug, title: titles[i * 2] || slug });
    });
    return unique;
  } catch (err) {
    console.warn("[seo] listBlogArticles failed:", err.message || err);
    return [];
  }
}

function marketingSitemapUrls() {
  const origin = getPublicAppOrigin();
  const pages = [
    { loc: `${origin}/`, changefreq: "weekly", priority: "1.0" },
    { loc: `${origin}/pse-ne`, changefreq: "monthly", priority: "0.8" },
    { loc: `${origin}/si-ta-ngarkoni`, changefreq: "monthly", priority: "0.8" },
    { loc: `${origin}/si-funksionon`, changefreq: "monthly", priority: "0.8" },
    { loc: `${origin}/pakot`, changefreq: "weekly", priority: "0.8" },
    { loc: `${origin}/blog`, changefreq: "weekly", priority: "0.7" },
    { loc: `${origin}/kontakt`, changefreq: "monthly", priority: "0.7" },
    { loc: `${origin}/website/manual.html`, changefreq: "monthly", priority: "0.7" },
    { loc: `${origin}/pajisjet`, changefreq: "monthly", priority: "0.6" },
    { loc: `${origin}/restorante`, changefreq: "daily", priority: "0.6" },
    { loc: `${origin}/privacy`, changefreq: "yearly", priority: "0.3" },
    { loc: `${origin}/terms`, changefreq: "yearly", priority: "0.3" },
  ];
  for (const article of listBlogArticles()) {
    pages.push({
      loc: `${origin}/blog/${encodeURIComponent(article.slug)}`,
      changefreq: "monthly",
      priority: "0.6",
    });
  }
  return pages;
}

function clientSitemapUrls(storefronts) {
  const origin = getPublicAppOrigin();
  const urls = [];
  const seen = new Set();
  function add(loc, priority = "0.8") {
    if (!loc || seen.has(loc)) return;
    seen.add(loc);
    urls.push({ loc, changefreq: "daily", priority });
  }
  for (const s of storefronts) {
    add(s.url);
    if (s.storefront === "r") {
      add(`${origin}/r/${encodeURIComponent(s.slug)}/menu`);
    }
    if (s.tipi === "furre_buke" || s.tipi === "pasticeri") {
      add(`${origin}/furra/${encodeURIComponent(s.slug)}`);
    }
    if (s.tipi === "hotel_restorant") {
      add(`${origin}/hotel/${encodeURIComponent(s.slug)}`);
    }
  }
  return urls;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function buildSitemapXml() {
  const staticUrls = marketingSitemapUrls();
  let storefronts = [];
  try {
    storefronts = await listPublicStorefronts();
  } catch (err) {
    console.warn("[seo] listPublicStorefronts failed:", err.message || err);
  }

  const urls = [...staticUrls, ...clientSitemapUrls(storefronts)];

  const body = urls
    .map(
      (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

function buildRobotsTxt() {
  const origin = getPublicAppOrigin();
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /owner/
Disallow: /admin
Disallow: /waiter/
Disallow: /kitchen/
Disallow: /bar/

Sitemap: ${origin}/sitemap.xml
`;
}

module.exports = {
  listPublicStorefronts,
  listBlogArticles,
  marketingSitemapUrls,
  buildSitemapXml,
  buildRobotsTxt,
};
