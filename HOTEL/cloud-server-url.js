/**
 * Revolution HOTEL — URL publike cloud (revolution-pos.com/hotel/{slug}/…).
 * Vetëm formati i linkut — serveri cloud i pranon rrugët më vonë.
 */
const PUBLIC_HOTEL_ORIGIN = "https://revolution-pos.com";

const PRIMARY_CLOUD_SERVER = PUBLIC_HOTEL_ORIGIN;
const BACKUP_CLOUD_SERVERS = [];
const PUBLIC_CLOUD_SERVER = PUBLIC_HOTEL_ORIGIN;
const CLOUD_SERVER_URLS = [PUBLIC_HOTEL_ORIGIN];
const BACKUP_CLOUD_SERVER = "";
const DEFAULT_CLOUD_SERVER = PUBLIC_HOTEL_ORIGIN;

function trimTrailingSlash(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function normalizeSlug(slugOrOpts) {
  if (slugOrOpts && typeof slugOrOpts === "object") {
    return String(
      slugOrOpts.kitchen_slug
      || slugOrOpts.client_id
      || slugOrOpts.cloud_client_id
      || "",
    ).trim();
  }
  return String(slugOrOpts || "").trim();
}

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

function normalizeCloudServerUrl(url) {
  const trimmed = trimTrailingSlash(url);
  if (trimmed && !isLocalOrPrivateServerUrl(trimmed)) return trimmed;
  return PUBLIC_HOTEL_ORIGIN;
}

/** Baza publike — https://revolution-pos.com kur ka slug, bosh përndryshe. */
function getPublicCloudServerUrl(slug) {
  return normalizeSlug(slug) ? PUBLIC_HOTEL_ORIGIN : "";
}

function getCloudServerCandidates() {
  return [PUBLIC_HOTEL_ORIGIN];
}

function appendExtraQuery(params, extraQuery) {
  const extra = String(extraQuery || "").trim().replace(/^\?/, "");
  if (!extra) return;
  for (const part of extra.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) {
      params.set(part, "");
    } else {
      params.set(part.slice(0, eq), part.slice(eq + 1));
    }
  }
}

/**
 * https://revolution-pos.com/hotel/{slug}/{role}?key={key}
 * kiosk / menu — pa key (kur key bosh).
 */
function buildAccessLink(_baseUrl, slug, key, role, extraQuery = "") {
  const s = normalizeSlug(slug);
  if (!s) return "";
  const origin = getPublicCloudServerUrl(s);
  const r = String(role || "").trim().toLowerCase();
  if (!r) return "";

  const rolesWithoutKey = new Set(["kiosk", "menu", "public_menu"]);
  const pathSlug = encodeURIComponent(s);
  const pathRole = encodeURIComponent(r === "public_menu" ? "menu" : r);
  let url = `${origin}/hotel/${pathSlug}/${pathRole}`;

  const params = new URLSearchParams();
  const k = String(key || "").trim();
  if (k && !rolesWithoutKey.has(r)) params.set("key", k);
  appendExtraQuery(params, extraQuery);
  const qs = params.toString();
  if (qs) url += `?${qs}`;
  return url;
}

function resolveCloudAccessCredentials(slugOrOpts, key) {
  if (slugOrOpts && typeof slugOrOpts === "object") {
    return {
      slug: normalizeSlug(slugOrOpts),
      key: String(slugOrOpts.kitchen_key || key || "").trim(),
    };
  }
  return {
    slug: normalizeSlug(slugOrOpts),
    key: String(key || "").trim(),
  };
}

/** Linqe staf / mysafir — format hotel/{slug}/… */
function buildCloudAccessLinks(_baseUrl, slugOrOpts, key) {
  const { slug: s, key: accessKey } = resolveCloudAccessCredentials(slugOrOpts, key);
  if (!s) {
    return {
      waiter: "",
      waiter_url: "",
      bar: "",
      bar_url: "",
      kitchen: "",
      kitchen_url: "",
      kiosk: "",
      kiosk_url: "",
      public_menu: "",
      public_page_url: "",
      public_order: "",
    };
  }

  const waiter = buildAccessLink(_baseUrl, s, accessKey, "waiter");
  const bar = buildAccessLink(_baseUrl, s, accessKey, "bar");
  const kitchen = buildAccessLink(_baseUrl, s, accessKey, "kitchen");
  const kiosk = buildAccessLink(_baseUrl, s, "", "kiosk");
  const public_menu = buildAccessLink(_baseUrl, s, "", "menu");

  return {
    waiter,
    waiter_url: waiter,
    bar,
    bar_url: bar,
    kitchen,
    kitchen_url: kitchen,
    kiosk,
    kiosk_url: kiosk,
    public_menu,
    public_page_url: public_menu,
    public_order: public_menu,
  };
}

function buildWaiterKdsUrl(slug, key, webToken) {
  const s = normalizeSlug(slug);
  if (!s) return "";
  const token = String(webToken || "").trim();
  const extra = token ? `w=${encodeURIComponent(token)}` : "";
  return buildAccessLink(null, s, key, "waiter", extra);
}

/** https://revolution-pos.com/hotel/{slug}/waiter/{token}?key={key} */
function buildWaiterPersonalUrl(slug, key, webToken) {
  const s = normalizeSlug(slug);
  const k = String(key || "").trim();
  const token = String(webToken || "").trim();
  if (!s || !token) return "";
  const origin = getPublicCloudServerUrl(s);
  const params = new URLSearchParams();
  if (k) params.set("key", k);
  const qs = params.toString();
  return `${origin}/hotel/${encodeURIComponent(s)}/waiter/${encodeURIComponent(token)}${qs ? `?${qs}` : ""}`;
}

module.exports = {
  PRIMARY_CLOUD_SERVER,
  BACKUP_CLOUD_SERVER,
  BACKUP_CLOUD_SERVERS,
  PUBLIC_CLOUD_SERVER,
  CLOUD_SERVER_URLS,
  DEFAULT_CLOUD_SERVER,
  PUBLIC_HOTEL_ORIGIN,
  isLocalOrPrivateServerUrl,
  normalizeCloudServerUrl,
  getPublicCloudServerUrl,
  getCloudServerCandidates,
  buildAccessLink,
  buildCloudAccessLinks,
  buildWaiterKdsUrl,
  buildWaiterPersonalUrl,
  trimTrailingSlash,
  normalizeSlug,
};
