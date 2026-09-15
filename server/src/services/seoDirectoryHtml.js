/**
 * HTML për directory publik /restorante (dhe /dyqane).
 * Vetëm lista e lokalëve publikë — pa të dhëna operacionale.
 */
const { getPublicAppOrigin } = require("../lib/publicOrigin");
const { listPublicStorefronts } = require("./seoSitemapService");
const { GOOGLE_SITE_VERIFICATION } = require("./seoPublicPageHtml");

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

async function renderDirectoryHtml({ mode = "all" } = {}) {
  const origin = getPublicAppOrigin();
  let items = [];
  try {
    items = await listPublicStorefronts();
  } catch (err) {
    console.warn("[seo] directory list failed:", err.message || err);
  }

  if (mode === "restaurants") items = items.filter((i) => i.storefront === "r");
  if (mode === "shops") items = items.filter((i) => i.storefront === "s");

  const title =
    mode === "shops"
      ? "Dyqanet — Revolution POS"
      : "Restorantet — Revolution POS";
  const heading =
    mode === "shops" ? "Dyqanet publike" : "Restorantet dhe lokalet publike";
  const description =
    mode === "shops"
      ? "Lista e dyqaneve me faqe publike në Revolution POS."
      : "Lista e restoranteve dhe lokaleve me faqe publike në Revolution POS.";
  const canonicalPath = mode === "shops" ? "/dyqane" : "/restorante";
  const canonical = `${origin}${canonicalPath}`;

  const listHtml = items.length
    ? `<ul class="dir-list">
${items
  .map((item) => {
    const kind = item.storefront === "s" ? "Dyqan" : "Restorant";
    const addr = item.address
      ? `<span class="dir-addr">${escapeHtml(item.address)}</span>`
      : "";
    const desc = item.description
      ? `<p class="dir-desc">${escapeHtml(item.description.slice(0, 160))}</p>`
      : "";
    return `  <li class="dir-item">
    <a href="${escapeAttr(item.path)}">
      <span class="dir-kind">${kind}</span>
      <strong class="dir-name">${escapeHtml(item.name)}</strong>
      ${addr}
      ${desc}
    </a>
  </li>`;
  })
  .join("\n")}
</ul>`
    : `<p class="dir-empty">Nuk ka lokale publike të listuara për momentin.</p>`;

  return `<!DOCTYPE html>
<html lang="sq">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${GOOGLE_SITE_VERIFICATION}
  <meta name="description" content="${escapeAttr(description)}">
  <link rel="canonical" href="${escapeAttr(canonical)}">
  <meta property="og:site_name" content="Revolution POS">
  <meta property="og:title" content="${escapeAttr(title)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:url" content="${escapeAttr(canonical)}">
  <meta property="og:type" content="website">
  <style>
    :root { color-scheme: light; }
    body { margin:0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background:#f5f6f8; color:#111827; line-height:1.5; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
    header { margin-bottom: 1.5rem; }
    .brand { font-size: 0.85rem; font-weight: 700; color:#2563eb; text-decoration:none; }
    h1 { margin: 0.5rem 0 0.35rem; font-size: 1.65rem; letter-spacing:-0.02em; }
    .lead { margin:0; color:#6b7280; }
    .dir-list { list-style:none; margin:1.5rem 0 0; padding:0; display:grid; gap:0.75rem; }
    .dir-item a { display:block; background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:1rem 1.1rem; text-decoration:none; color:inherit; box-shadow:0 6px 18px rgba(15,23,42,.05); }
    .dir-item a:hover { border-color:#93c5fd; }
    .dir-kind { display:inline-block; font-size:0.7rem; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#2563eb; margin-bottom:0.35rem; }
    .dir-name { display:block; font-size:1.05rem; }
    .dir-addr { display:block; margin-top:0.25rem; color:#6b7280; font-size:0.9rem; }
    .dir-desc { margin:0.45rem 0 0; color:#4b5563; font-size:0.9rem; }
    .dir-empty { margin-top:1.5rem; color:#6b7280; }
    footer { margin-top:2rem; font-size:0.85rem; color:#9ca3af; }
    footer a { color:#2563eb; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/">Revolution POS</a>
      <h1>${escapeHtml(heading)}</h1>
      <p class="lead">${escapeHtml(description)}</p>
    </header>
    ${listHtml}
    <footer>
      <p><a href="/">← Faqja kryesore</a></p>
    </footer>
  </div>
</body>
</html>`;
}

module.exports = { renderDirectoryHtml };
