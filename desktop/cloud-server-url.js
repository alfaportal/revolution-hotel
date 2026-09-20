/**
 * Revolution HOTEL — URL publike (i njëjti format si restoranti POS).
 * Meny/QR: https://revolution-pos.com/menu/{slug}/{tavolina}
 * Stafi:   https://revolution-pos.com/waiter/{slug}?key=…
 */
const crypto = require("crypto");
const PUBLIC_HOTEL_ORIGIN = "https://revolution-pos.com";

/** Prefix publik — revolution-pos.com/hotel/* (proxy te revolution-hotel-server). */
const HOTEL_WEB_PREFIX = "/hotel";

/** Rrugë API/health në hub — https://revolution-pos.com/hotel/api/... */
function hotelCloudApiPath(apiPath) {
  const p = String(apiPath || "").trim();
  if (!p) return HOTEL_WEB_PREFIX;
  if (p === HOTEL_WEB_PREFIX || p.startsWith(`${HOTEL_WEB_PREFIX}/`)) return p;
  const normalized = p.startsWith("/") ? p : `/${p}`;
  return `${HOTEL_WEB_PREFIX}${normalized}`;
}

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

function slugifyVenueName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "hotel";
}

/** Segment URL publik/lokal — hotel/{slug}/kamarier|recepsion */
function urlTipiSegment(tipi) {
  const normalized = String(tipi || "hotel").toLowerCase().trim();
  if (normalized === "hotel" || normalized.startsWith("hotel")) return "hotel";
  return String(normalized)
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    || "hotel";
}

/** Slug unik — hotel-{emri}-{hash} (si restaurant-naser-c57eb7). */
function buildHotelVenueSlug(name, deviceId) {
  let base = slugifyVenueName(name);
  if (!base || base === "hotel") {
    base = "hotel";
  } else if (!base.startsWith("hotel-")) {
    base = `hotel-${base}`;
  }
  base = base.replace(/^hotel-hotel-/, "hotel-");
  const id = String(deviceId || "").trim();
  const suffix = id
    ? crypto.createHash("sha256").update(id).digest("hex").slice(0, 6)
    : "local";
  return `${base}-${suffix}`;
}

/**
 * @deprecated Çelësi vjen nga cloud (kitchen_key pas validimit), jo LAN.
 */
function deriveLocalAccessKey(_deviceId) {
  return "";
}

const HOTEL_ACCESS_ROLES = new Set([
  "waiter", "bar", "kitchen", "housekeeping", "reception",
  "kiosk", "menu", "public_menu", "room-service", "services",
]);

const STAFF_ACCESS_ROLES = new Set([
  "waiter", "bar", "kitchen", "housekeeping", "reception",
]);

/**
 * Meny publike / QR — si restoranti: /menu/{slug}/{tavolina}
 * https://revolution-pos.com/menu/restaurant-naser-c57eb7/1
 */
function buildPublicMenuUrl(baseUrl, slug, tableNumber = 1) {
  const base = trimTrailingSlash(baseUrl || PUBLIC_HOTEL_ORIGIN);
  const s = normalizeSlug(slug);
  if (!s || !base) return "";
  const table = Math.max(1, Number(tableNumber) || 1);
  return `${base}${HOTEL_WEB_PREFIX}/menu/${encodeURIComponent(s)}/${table}`;
}

/**
 * Stafi — /{roli}/{slug}?key=… (si restoranti, pa prefix /hotel/)
 */
function buildStaffAccessLink(baseUrl, slug, key, role, extraQuery = "") {
  const s = normalizeSlug(slug);
  const base = trimTrailingSlash(baseUrl);
  const r = String(role || "").trim().toLowerCase();
  if (!s || !base || !STAFF_ACCESS_ROLES.has(r)) return "";

  let url = `${base}${HOTEL_WEB_PREFIX}/${encodeURIComponent(r)}/${encodeURIComponent(s)}`;
  const params = new URLSearchParams();
  const k = String(key || "").trim();
  if (k) params.set("key", k);
  appendExtraQuery(params, extraQuery);
  const qs = params.toString();
  if (qs) url += `?${qs}`;
  return url;
}

/** @deprecated Përdor buildAccessLink / buildCloudAccessLinks (vetëm revolution-pos.com/hotel). */
function buildLocalAccessLink(_baseUrl, slug, key, role, extraQuery = "") {
  return buildAccessLink(null, slug, key, role, extraQuery);
}

/** @deprecated Përdor buildCloudAccessLinks. */
function buildLocalAccessLinks(_baseUrl, slugOrOpts, key) {
  return buildCloudAccessLinks(null, slugOrOpts, key);
}

function buildAccessLink(_baseUrl, slug, key, role, extraQuery = "") {
  const s = normalizeSlug(slug);
  if (!s) return "";
  const origin = getPublicCloudServerUrl(s) || PUBLIC_HOTEL_ORIGIN;
  const r = String(role || "").trim().toLowerCase();
  if (!r) return "";

  if (r === "kiosk" || r === "menu" || r === "public_menu") {
    return buildPublicMenuUrl(origin, s, 1);
  }
  return buildStaffAccessLink(origin, s, key, r, extraQuery);
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

/** Linqe staf + meny publike — format restoranti. */
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
      housekeeping_url: "",
      reception_url: "",
    };
  }

  const origin = getPublicCloudServerUrl(s) || PUBLIC_HOTEL_ORIGIN;
  const menuUrl = buildPublicMenuUrl(origin, s, 1);
  const waiter = buildStaffAccessLink(origin, s, accessKey, "waiter");
  const bar = buildStaffAccessLink(origin, s, accessKey, "bar");
  const kitchen = buildStaffAccessLink(origin, s, accessKey, "kitchen");
  const housekeeping = buildStaffAccessLink(origin, s, accessKey, "housekeeping");
  const reception = buildStaffAccessLink(origin, s, accessKey, "reception");

  return {
    waiter,
    waiter_url: waiter,
    bar,
    bar_url: bar,
    kitchen,
    kitchen_url: kitchen,
    kiosk: menuUrl,
    kiosk_url: menuUrl,
    public_menu: menuUrl,
    public_page_url: menuUrl,
    public_order: menuUrl,
    housekeeping_url: housekeeping,
    reception_url: reception,
  };
}

/** @deprecated Përdor buildWaiterPersonalUrl. */
function buildLocalWaiterPersonalUrl(_baseUrl, webToken, slug, key) {
  return buildWaiterPersonalUrl(slug, key, webToken);
}

function buildWaiterKdsUrl(slug, key, webToken) {
  const s = normalizeSlug(slug);
  if (!s) return "";
  const token = String(webToken || "").trim();
  const extra = token ? `w=${encodeURIComponent(token)}` : "";
  return buildAccessLink(null, s, key, "waiter", extra);
}

/** https://revolution-pos.com/waiter/{slug}?key={key}&w={token} */
function buildWaiterPersonalUrl(slug, key, webToken) {
  const s = normalizeSlug(slug);
  const token = String(webToken || "").trim();
  if (!s || !token) return "";
  const extra = `w=${encodeURIComponent(token)}`;
  return buildAccessLink(null, s, key, "waiter", extra);
}

/** Mysafir — shërbime / room service (cloud; hotel-server duhet t’i servojë statiket). */
function buildHotelGuestPublicUrl(baseUrl, page, roomNumber = "", slug = "") {
  const base = trimTrailingSlash(baseUrl || PUBLIC_HOTEL_ORIGIN);
  const room = encodeURIComponent(String(roomNumber || "").trim());
  const s = encodeURIComponent(String(slug || "").trim());
  const slugQ = s ? `&slug=${s}` : "";
  const p = String(page || "").trim().toLowerCase();
  if (p === "services") {
    return room
      ? `${base}${HOTEL_WEB_PREFIX}/guest/services.html?room=${room}${slugQ}`
      : `${base}${HOTEL_WEB_PREFIX}/guest/services.html${s ? `?slug=${s}` : ""}`;
  }
  if (p === "room-service" || p === "room_service") {
    return room
      ? `${base}${HOTEL_WEB_PREFIX}/guest/room-service.html?room=${room}${slugQ}`
      : `${base}${HOTEL_WEB_PREFIX}/guest/room-service.html${s ? `?slug=${s}` : ""}`;
  }
  return "";
}

module.exports = {
  PRIMARY_CLOUD_SERVER,
  BACKUP_CLOUD_SERVER,
  BACKUP_CLOUD_SERVERS,
  PUBLIC_CLOUD_SERVER,
  CLOUD_SERVER_URLS,
  DEFAULT_CLOUD_SERVER,
  PUBLIC_HOTEL_ORIGIN,
  HOTEL_WEB_PREFIX,
  hotelCloudApiPath,
  buildHotelGuestPublicUrl,
  isLocalOrPrivateServerUrl,
  normalizeCloudServerUrl,
  getPublicCloudServerUrl,
  getCloudServerCandidates,
  buildAccessLink,
  buildCloudAccessLinks,
  buildLocalAccessLink,
  buildLocalAccessLinks,
  buildPublicMenuUrl,
  buildStaffAccessLink,
  buildHotelVenueSlug,
  slugifyVenueName,
  deriveLocalAccessKey,
  buildWaiterKdsUrl,
  buildWaiterPersonalUrl,
  buildLocalWaiterPersonalUrl,
  urlTipiSegment,
  trimTrailingSlash,
  normalizeSlug,
  HOTEL_ACCESS_ROLES,
  STAFF_ACCESS_ROLES,
};
