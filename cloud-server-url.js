/**
 * Revolution HOTEL — URL publike (i njëjti format si restoranti POS).
 * Meny/QR: https://revolution-pos.com/menu/{slug}/{tavolina}
 * Stafi:   https://revolution-pos.com/waiter/{slug}?key=…
 */
const crypto = require("crypto");
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

/** Çelës LAN i qëndrueshëm kur nuk ka kitchen_key nga cloud. */
function deriveLocalAccessKey(deviceId) {
  const id = String(deviceId || "").trim() || "hotel";
  return crypto.createHash("sha256").update(`hotel-lan-${id}`).digest("hex");
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
  return `${base}/menu/${encodeURIComponent(s)}/${table}`;
}

/**
 * Stafi — /{roli}/{slug}?key=… (si restoranti, pa prefix /hotel/)
 */
function buildStaffAccessLink(baseUrl, slug, key, role, extraQuery = "") {
  const s = normalizeSlug(slug);
  const base = trimTrailingSlash(baseUrl);
  const r = String(role || "").trim().toLowerCase();
  if (!s || !base || !STAFF_ACCESS_ROLES.has(r)) return "";

  let url = `${base}/${encodeURIComponent(r)}/${encodeURIComponent(s)}`;
  const params = new URLSearchParams();
  const k = String(key || "").trim();
  if (k) params.set("key", k);
  appendExtraQuery(params, extraQuery);
  const qs = params.toString();
  if (qs) url += `?${qs}`;
  return url;
}

/** Legacy LAN /hotel/{roli}/{slug} — ridrejtim lokal. */
function buildLocalAccessLink(baseUrl, slug, key, role, extraQuery = "") {
  const s = normalizeSlug(slug);
  const base = trimTrailingSlash(baseUrl);
  if (!s || !base) return "";
  const r = String(role || "").trim().toLowerCase();
  if (!r) return "";

  if (r === "kiosk" || r === "menu" || r === "public_menu") {
    return buildPublicMenuUrl(base, s, 1);
  }
  if (STAFF_ACCESS_ROLES.has(r)) {
    return buildStaffAccessLink(base, s, key, r, extraQuery);
  }
  if (r === "room-service") {
    return `${base}/guest/room-service.html`;
  }
  if (r === "services") {
    return `${base}/guest/services.html`;
  }
  return buildStaffAccessLink(base, s, key, r, extraQuery);
}

function buildLocalAccessLinks(baseUrl, slugOrOpts, key) {
  const { slug: s, key: accessKey } = resolveCloudAccessCredentials(slugOrOpts, key);
  if (!s) {
    return {
      waiter_url: "",
      bar_url: "",
      kitchen_url: "",
      kiosk_url: "",
      public_page_url: "",
      housekeeping_url: "",
      reception_url: "",
    };
  }
  const menuUrl = buildPublicMenuUrl(baseUrl, s, 1);
  return {
    waiter_url: buildStaffAccessLink(baseUrl, s, accessKey, "waiter"),
    bar_url: buildStaffAccessLink(baseUrl, s, accessKey, "bar"),
    kitchen_url: buildStaffAccessLink(baseUrl, s, accessKey, "kitchen"),
    kiosk_url: menuUrl,
    public_page_url: menuUrl,
    housekeeping_url: buildStaffAccessLink(baseUrl, s, accessKey, "housekeeping"),
    reception_url: buildStaffAccessLink(baseUrl, s, accessKey, "reception"),
  };
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

function buildLocalWaiterPersonalUrl(baseUrl, webToken, slug, key) {
  const base = trimTrailingSlash(baseUrl);
  const t = String(webToken || "").trim();
  if (!base || !t) return "";
  const s = normalizeSlug(slug);
  if (s) {
    return buildStaffAccessLink(base, s, key, "waiter", `w=${encodeURIComponent(t)}`);
  }
  return `${base}/login.html?w=${encodeURIComponent(t)}`;
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
  trimTrailingSlash,
  normalizeSlug,
  HOTEL_ACCESS_ROLES,
  STAFF_ACCESS_ROLES,
};
