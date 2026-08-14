/**
 * SSR meta për faqet e marketingut (Google nuk lexon vetëm JS).
 * Nuk prek dizajnin — vetëm <title> / description / og:* në HTML.
 */
const fs = require("fs");
const path = require("path");
const { getPublicAppOrigin } = require("../lib/publicOrigin");
const { injectIntoShell } = require("./seoPublicPageHtml");
const { listBlogArticles } = require("./seoSitemapService");

const SITE_INDEX = path.join(__dirname, "../../public/site/index.html");

const PAGES = {
  "/": {
    title: "Revolution POS — Sistemi modern POS për restorante, kafene, furra, hotele | Kosovë",
    description:
      "Revolution POS — sistem modern POS për restorante, kafene, furra dhe hotele në Kosovë. Menu dixhitale, kamarier, kuzhinë dhe raporte.",
    hash: "ballina",
  },
  "/pse-ne": {
    title: "Pse ne — Revolution POS | Kosovë",
    description:
      "Pse restorantet, kafenetë, furrat dhe hotelet zgjedhin Revolution POS — një sistem, të gjitha pikat e shitjes.",
    hash: "shtyllat",
  },
  "/si-ta-ngarkoni": {
    title: "Si ta ngarkoni — Revolution POS",
    description:
      "Si ta shkarkoni dhe instaloni Revolution POS në Windows. Setup zyrtar nga revolution-pos.com.",
    hash: "si-ta-ngarkoni",
  },
  "/si-funksionon": {
    title: "Si funksionon — Revolution POS",
    description:
      "Si funksionon Revolution POS: kasa, kamarier, kuzhinë (KDS) dhe paneli i pronarit.",
    hash: "si-funksionon",
  },
  "/pakot": {
    title: "Pakot — Revolution POS",
    description:
      "Pakot e Revolution POS për çdo madhësi biznesi — nga kasa bazë deri te sistemi i plotë.",
    hash: "pakot",
  },
  "/blog": {
    title: "Blog — Revolution POS",
    description:
      "Këshilla për restorante, kafene dhe POS — stoku, meny dixhitale, raporte dhe teknologji.",
    hash: "artikuj",
  },
  "/kontakt": {
    title: "Kontakti — Revolution POS",
    description:
      "Kontaktoni Revolution POS — WhatsApp, telefon dhe mbështetje për restorante në Kosovë.",
    hash: "kontakt",
  },
  "/privacy": {
    title: "Privatësia — Revolution POS",
    description: "Politika e privatësisë së Revolution POS.",
    hash: null,
  },
  "/terms": {
    title: "Kushtet — Revolution POS",
    description: "Kushtet e përdorimit të Revolution POS.",
    hash: null,
  },
  "/pajisjet": {
    title: "Pajisjet — Revolution POS",
    description:
      "Pajisjet e rekomanduara për Revolution POS: printer termik, ekran, sirtar dhe skaner.",
    hash: "pajisjet",
  },
};

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pageMeta(pathname) {
  const origin = getPublicAppOrigin();
  const clean = String(pathname || "/").replace(/\/+$/, "") || "/";

  if (clean.startsWith("/blog/") && clean.length > 6) {
    const slug = decodeURIComponent(clean.slice(6));
    const article = listBlogArticles().find((a) => a.slug === slug);
    const title = article
      ? `${article.title} — Revolution POS`
      : "Blog — Revolution POS";
    const description = article
      ? article.title
      : "Artikull nga blogu i Revolution POS.";
    return {
      title,
      description,
      canonical: `${origin}/blog/${encodeURIComponent(slug)}`,
      hash: null,
    };
  }

  const spec = PAGES[clean] || PAGES["/"];
  return {
    title: spec.title,
    description: spec.description,
    canonical: `${origin}${clean === "/" ? "/" : clean}`,
    hash: spec.hash || null,
  };
}

function renderMarketingHtml(pathname) {
  const origin = getPublicAppOrigin();
  const meta = pageMeta(pathname);
  const shell = fs.readFileSync(SITE_INDEX, "utf8");
  const hashScript = meta.hash
    ? `\n  <script>if(!location.hash){try{history.replaceState(null,"","/#${meta.hash}");}catch(e){}}</script>`
    : "";
  const injection = `
  <meta name="description" content="${escapeAttr(meta.description)}">
  <link rel="canonical" href="${escapeAttr(meta.canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Revolution POS">
  <meta property="og:title" content="${escapeAttr(meta.title)}">
  <meta property="og:description" content="${escapeAttr(meta.description)}">
  <meta property="og:url" content="${escapeAttr(meta.canonical)}">
  <meta property="og:image" content="${escapeAttr(`${origin}/logo-source.png`)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(meta.title)}">
  <meta name="twitter:description" content="${escapeAttr(meta.description)}">${hashScript}`;
  return injectIntoShell(shell, { title: meta.title, injection, addFooter: false });
}

module.exports = {
  PAGES,
  pageMeta,
  renderMarketingHtml,
};
