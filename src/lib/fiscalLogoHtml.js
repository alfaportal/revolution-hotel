/**
 * Logo fiskale RKS/MF për raportet HTML (web print / export).
 * Përdor base64 inline që printimi nga about:blank të funksionojë.
 */
const fs = require("fs");
const path = require("path");

const LOGO_PATH = path.join(__dirname, "../../public/assets/logo_rks_mf.png");

let cachedDataUri = null;

function getLogoDataUri() {
  if (cachedDataUri) return cachedDataUri;
  try {
    if (fs.existsSync(LOGO_PATH)) {
      const b64 = fs.readFileSync(LOGO_PATH).toString("base64");
      cachedDataUri = `data:image/png;base64,${b64}`;
      return cachedDataUri;
    }
  } catch (e) {
    console.warn("[fiscalLogoHtml] logo read:", e.message);
  }
  return null;
}

/** Blok HTML — logo + vijë mbyllëse (para timestamp). */
function getFiscalLogoHtmlFooter() {
  const dataUri = getLogoDataUri();
  const divider = '<hr class="fiscal-logo-divider" />';
  if (dataUri) {
    return (
      `${divider}` +
      `<div class="fiscal-logo-wrap">` +
      `<img src="${dataUri}" alt="Logo fiskale RKS MF" width="160" height="80" class="fiscal-logo-img" />` +
      `</div>`
    );
  }
  return (
    `${divider}` +
    `<div class="fiscal-logo-fallback">` +
    `<div><strong>Logo Fiskale</strong></div>` +
    `<div>RKS</div>` +
    `<div>MF</div>` +
    `</div>`
  );
}

const FISCAL_LOGO_CSS = `
.fiscal-logo-wrap{text-align:center;margin:24px 0 8px}
.fiscal-logo-img{max-width:160px;height:auto;display:inline-block}
.fiscal-logo-fallback{text-align:center;font-weight:bold;line-height:1.5;margin:24px 0 8px;font-size:14px}
.fiscal-logo-divider{border:none;border-top:2px solid #111;margin:20px 0 0}
`;

module.exports = {
  LOGO_PATH,
  getLogoDataUri,
  getFiscalLogoHtmlFooter,
  FISCAL_LOGO_CSS,
};
