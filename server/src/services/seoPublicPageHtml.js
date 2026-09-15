/**
 * SSR meta + JSON-LD për /r/:slug dhe /s/:slug.
 * Lexon vetëm getPublic*Page — nuk prek porosi/sync.
 */
const fs = require("fs");
const path = require("path");
const { getPublicAppOrigin } = require("../lib/publicOrigin");
const {
  getPublicRestaurantPage,
  getPublicShopPage,
} = require("./publicPageService");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function absoluteUrl(maybeRelative, origin) {
  const raw = String(maybeRelative || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = String(origin || getPublicAppOrigin()).replace(/\/+$/, "");
  return `${base}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function truncate(text, max = 160) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trim()}…`;
}

function buildJsonLd(page, { storefront, origin }) {
  const isShop = storefront === "s";
  const type = isShop ? "Store" : "Restaurant";
  const url = page.public_url || `${origin}/${storefront}/${encodeURIComponent(page.slug)}`;
  const description =
    page.description ||
    (isShop
      ? `Dyqani ${page.name} — Revolution Invest POS`
      : `Restoranti ${page.name} — Revolution Invest POS`);

  const data = {
    "@context": "https://schema.org",
    "@type": type,
    name: page.name,
    description,
    url,
  };

  if (page.address) {
    data.address = {
      "@type": "PostalAddress",
      streetAddress: page.address,
    };
  }
  if (page.phone) data.telephone = page.phone;
  if (page.logo_url) data.image = absoluteUrl(page.logo_url, origin);
  if (page.maps_url) data.hasMap = page.maps_url;

  if (!isShop && Array.isArray(page.menu) && page.menu.length) {
    data.hasMenu = url;
  }

  return data;
}

const GOOGLE_SITE_VERIFICATION =
  '<meta name="google-site-verification" content="2QVw_7A49TsO9VnCz49wUW3DzlcLDyP4fqPCmoVwjUY" />';

const POWERED_FOOTER = `<footer style="text-align:center; padding:10px; font-size:12px; color:#888; margin-top:20px;">
  Powered by <a href="https://revolution-pos.com" style="color:#fff; font-weight:bold;">Revolution POS</a>
</footer>`;

function buildHeadInjection(page, { storefront, origin }) {
  const isShop = storefront === "s";
  const title = `Meny Dixhitale — ${page.name} | Revolution POS`;
  const description = truncate(
    page.description ||
      (page.address
        ? `${page.name} — ${page.address}`
        : isShop
          ? `Katalogu dixhital i ${page.name} — Revolution POS`
          : `Meny dixhitale e ${page.name} — Revolution POS`),
  );
  const canonical = page.public_url || `${origin}/${storefront}/${encodeURIComponent(page.slug)}`;
  const ogImage = absoluteUrl(page.cover_url || page.logo_url || "/logo-source.png", origin);
  const jsonLd = buildJsonLd(page, { storefront, origin });

  return {
    title,
    injection: `
  <meta name="description" content="${escapeAttr(description)}">
  <link rel="canonical" href="${escapeAttr(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Revolution POS">
  <meta property="og:title" content="${escapeAttr(title)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:url" content="${escapeAttr(canonical)}">
  <meta property="og:image" content="${escapeAttr(ogImage)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(title)}">
  <meta name="twitter:description" content="${escapeAttr(description)}">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`,
    canonical,
  };
}

function injectIntoShell(html, { title, injection, addFooter = true }) {
  let out = String(html || "");
  if (/<title>[\s\S]*?<\/title>/i.test(out)) {
    out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  } else {
    out = out.replace(/<head([^>]*)>/i, `<head$1>\n  <title>${escapeHtml(title)}</title>`);
  }

  out = out.replace(/\s*<meta\s+name=["']description["'][^>]*>/gi, "");

  if (!/<\/head>/i.test(out)) {
    throw new Error("HTML shell mungon </head>");
  }
  const verifyTag = /google-site-verification/i.test(`${out}${injection}`)
    ? ""
    : `\n  ${GOOGLE_SITE_VERIFICATION}`;
  out = out.replace(/<\/head>/i, `${verifyTag}${injection}\n</head>`);

  if (addFooter && !/<footer[\s>]/i.test(out) && /<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${POWERED_FOOTER}\n</body>`);
  }

  return out;
}

async function renderPublicStorefrontHtml({ slug, storefront }) {
  const origin = getPublicAppOrigin();
  const baseUrl = origin;
  const page =
    storefront === "s"
      ? await getPublicShopPage(slug, baseUrl)
      : await getPublicRestaurantPage(slug, baseUrl);

  if (!page) return { status: 404, html: null };

  const shellName = storefront === "s" ? "s.html" : "r.html";
  const shellPath = path.join(__dirname, "../../public", shellName);
  const shell = fs.readFileSync(shellPath, "utf8");
  const head = buildHeadInjection(page, { storefront, origin });
  const html = injectIntoShell(shell, head);

  return { status: 200, html, page };
}

function renderNotFoundHtml(kind = "restorant") {
  const label = kind === "shop" ? "Dyqani" : "Restoranti";
  return `<!DOCTYPE html>
<html lang="sq">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${label} nuk u gjet</title>
</head>
<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:1.5rem;line-height:1.5">
  <h1>${label} nuk u gjet</h1>
  <p>Faqja publike nuk është e disponueshme.</p>
  <p><a href="/restorante">← Shiko lokalet</a></p>
</body>
</html>`;
}

module.exports = {
  renderPublicStorefrontHtml,
  renderNotFoundHtml,
  buildHeadInjection,
  injectIntoShell,
  POWERED_FOOTER,
  GOOGLE_SITE_VERIFICATION,
};
