const REGION = (() => {
  try {
    return require("./region-config");
  } catch {
    return { locale: "sq", region: "ks" };
  }
})();

let FR_MAP = null;

function isFrench() {
  return String(REGION.locale || "").toLowerCase() === "fr";
}

function loadFrMap() {
  if (FR_MAP) return FR_MAP;
  try {
    FR_MAP = require("./locales/fr-map");
  } catch {
    FR_MAP = {};
  }
  return FR_MAP;
}

/**
 * Translate Albanian → French (locale=fr).
 * EXACT match only — never substring (avoids Dilni→Déconnexionni).
 */
function t(text) {
  if (!isFrench()) return text;
  const raw = String(text ?? "");
  if (!raw) return raw;
  const map = loadFrMap();
  if (Object.prototype.hasOwnProperty.call(map, raw)) return map[raw];
  const trimmed = raw.trim();
  if (trimmed !== raw && Object.prototype.hasOwnProperty.call(map, trimmed)) {
    return raw.replace(trimmed, map[trimmed]);
  }
  return raw;
}

function localeInfo() {
  return {
    region: REGION.region || "ks",
    locale: REGION.locale || "sq",
    appName: REGION.appName || "Revolution HOTEL",
    htmlLang: REGION.htmlLang || (isFrench() ? "fr" : "sq"),
    isFrench: isFrench(),
    map: isFrench() ? loadFrMap() : {},
  };
}

module.exports = { t, isFrench, localeInfo, REGION };
