/**
 * Revolution HOTEL — cloud URL (i çaktivizuar).
 * Hoteli punon VETËM me SQLite lokal derisa të ketë serverin e vet.
 * Asnjë URL kafene / cloud i jashtëm.
 */
function trimTrailingSlash(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

/** Cloud i hotelit — bosh derisa të konfigurohet serveri i vet. */
const PRIMARY_CLOUD_SERVER = "";
const BACKUP_CLOUD_SERVERS = [];
const PUBLIC_CLOUD_SERVER = "";
const CLOUD_SERVER_URLS = [];
const BACKUP_CLOUD_SERVER = "";
const DEFAULT_CLOUD_SERVER = "";

function isLocalOrPrivateServerUrl(url) {
  try {
    const raw = String(url || "").trim();
    if (!raw) return false;
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
      return true;
    }
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

function normalizeCloudServerUrl(_url) {
  return "";
}

function getPublicCloudServerUrl() {
  return "";
}

function getCloudServerCandidates() {
  return [];
}

function buildAccessLink(_baseUrl, slug, key, kind, extraQuery = "") {
  void _baseUrl;
  void slug;
  void key;
  void kind;
  void extraQuery;
  return "";
}

function buildCloudAccessLinks(_baseUrl, slug, key) {
  void _baseUrl;
  void slug;
  void key;
  return {
    bar: "",
    kitchen: "",
    waiter: "",
    kiosk: "",
    public_menu: "",
    public_order: "",
  };
}

function buildWaiterKdsUrl(slug, key, webToken) {
  void slug;
  void key;
  void webToken;
  return "";
}

function buildWaiterPersonalUrl(slug, key, webToken) {
  void slug;
  void key;
  void webToken;
  return "";
}

module.exports = {
  PRIMARY_CLOUD_SERVER,
  BACKUP_CLOUD_SERVER,
  BACKUP_CLOUD_SERVERS,
  PUBLIC_CLOUD_SERVER,
  CLOUD_SERVER_URLS,
  DEFAULT_CLOUD_SERVER,
  isLocalOrPrivateServerUrl,
  normalizeCloudServerUrl,
  getPublicCloudServerUrl,
  getCloudServerCandidates,
  buildAccessLink,
  buildCloudAccessLinks,
  buildWaiterKdsUrl,
  buildWaiterPersonalUrl,
  trimTrailingSlash,
};
