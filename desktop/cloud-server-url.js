/**
 * Revolution HOTEL — URL publike (i njëjti format si restoranti POS).
 * Meny/QR: https://revolution-pos.com/menu/{slug}/{tavolina}
 * Stafi:   https://revolution-pos.com/hotel/{slug}/kamarier?key=…
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

const LEGACY_KITCHEN_SLUG_HEX_SUFFIX = /-[a-f0-9]{6}$/i;

function stripLegacyKitchenSlugSuffix(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s || !LEGACY_KITCHEN_SLUG_HEX_SUFFIX.test(s)) return s;
  const base = s.replace(LEGACY_KITCHEN_SLUG_HEX_SUFFIX, "");
  if (base.length < 3) return s;
  return base;
}

function normalizeSlug(slugOrOpts) {
  let raw = "";
  if (slugOrOpts && typeof slugOrOpts === "object") {
    raw = String(
      slugOrOpts.kitchen_slug
      || slugOrOpts.client_id
      || slugOrOpts.cloud_client_id
      || "",
    ).trim();
  } else {
    raw = String(slugOrOpts || "").trim();
  }
  return stripLegacyKitchenSlugSuffix(raw);
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

/** Slug unik — hotel-{emri}-{hash} (si restaurant-myvenue-c57eb7). */
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
 * QR tavolinë — https://revolution-pos.com/hotel/{slug}/menu/{tavolina}
 */
function buildPublicMenuUrl(baseUrl, slug, tableNumber = 1) {
  const base = trimTrailingSlash(baseUrl || PUBLIC_HOTEL_ORIGIN);
  const s = normalizeSlug(slug);
  if (!s || !base) return "";
  const table = Math.max(1, Number(tableNumber) || 1);
  return `${base}${HOTEL_WEB_PREFIX}/${encodeURIComponent(s)}/menu/${table}`;
}

/** Rol i brendshëm (waiter) → segment publik hotel (kamarier). */
const HOTEL_PUBLIC_STAFF_SEGMENT = {
  waiter: "kamarier",
  reception: "recepsion",
  bar: "bar",
  kitchen: "kuzhina",
  housekeeping: "sherbimi",
};

/**
 * Stafi — https://revolution-pos.com/hotel/{slug}/{roli}?key=…
 */
/** Pronari — paneli cloud (i njëjtë si distributor): https://revolution-pos.com/owner/panel */
function buildOwnerAccessLink(baseUrl, _slug, _key) {
  const base = trimTrailingSlash(baseUrl || PUBLIC_HOTEL_ORIGIN);
  if (!base) return "";
  return `${base}/owner/panel`;
}

/** Faqja publike e hotelit — https://revolution-pos.com/hotel/{slug} */
function buildHotelStorefrontUrl(baseUrl, slug) {
  const s = normalizeSlug(slug);
  const base = trimTrailingSlash(baseUrl || PUBLIC_HOTEL_ORIGIN);
  if (!s || !base) return "";
  return `${base}${HOTEL_WEB_PREFIX}/${encodeURIComponent(s)}`;
}

/** Takeaway / porosi online — https://revolution-pos.com/hotel/{slug}/takeaway */
function buildHotelTakeawayUrl(baseUrl, slug) {
  const s = normalizeSlug(slug);
  const base = trimTrailingSlash(baseUrl || PUBLIC_HOTEL_ORIGIN);
  if (!s || !base) return "";
  return `${base}${HOTEL_WEB_PREFIX}/${encodeURIComponent(s)}/takeaway`;
}

function buildStaffAccessLink(baseUrl, slug, key, role, extraQuery = "") {
  const s = normalizeSlug(slug);
  const base = trimTrailingSlash(baseUrl);
  const r = String(role || "").trim().toLowerCase();
  if (!s || !base || !STAFF_ACCESS_ROLES.has(r)) return "";

  const publicSeg = HOTEL_PUBLIC_STAFF_SEGMENT[r] || r;
  let url = `${base}${HOTEL_WEB_PREFIX}/${encodeURIComponent(s)}/${encodeURIComponent(publicSeg)}`;
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
  if (r === "owner" || r === "pronari") {
    return buildOwnerAccessLink(origin, s, key);
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

/**
 * Licenca cloud (restaurant-server) kthen shpesh /kafene/{slug}/… — HOTEL duhet /hotel/{slug}/….
 * Përdor slug+key lokale dhe rindërto gjithmonë linket publike.
 */
function applyHotelLicenseLinks(creds = {}) {
  const slug = normalizeSlug(creds.kitchen_slug || creds.client_id || "");
  const key = String(creds.kitchen_key || "").trim();
  if (!slug || !key) {
    return { ...creds, kitchen_slug: slug || creds.kitchen_slug || "" };
  }
  const origin = PUBLIC_HOTEL_ORIGIN;
  const built = buildCloudAccessLinks(origin, { kitchen_slug: slug, kitchen_key: key, client_id: slug }, key);
  return {
    ...creds,
    client_id: slug,
    kitchen_slug: slug,
    client_tipi: "hotel",
    waiter_url: built.waiter_url,
    bar_url: built.bar_url,
    kitchen_url: built.kitchen_url,
    kiosk_url: built.kiosk_url,
    public_page_url: built.public_page_url,
    owner_url: built.owner_url,
    owner_panel_url: built.owner_panel_url,
    reception_url: built.reception_url,
    housekeeping_url: built.housekeeping_url,
    takeaway_url: built.takeaway_url,
    public_order_url: built.public_order,
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
      owner_url: "",
      owner_panel_url: "",
    };
  }

  const origin = getPublicCloudServerUrl(s) || PUBLIC_HOTEL_ORIGIN;
  const ownerLink = buildOwnerAccessLink(origin, s, accessKey);
  const menuUrl = buildPublicMenuUrl(origin, s, 1);
  const storefrontUrl = buildHotelStorefrontUrl(origin, s);
  const takeawayUrl = buildHotelTakeawayUrl(origin, s);
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
    public_page_url: storefrontUrl,
    public_order: takeawayUrl,
    takeaway_url: takeawayUrl,
    housekeeping_url: housekeeping,
    reception_url: reception,
    owner_url: ownerLink,
    owner_panel_url: ownerLink,
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

/** https://revolution-pos.com/hotel/{slug}/kamarier?key={key}&w={token} */
function buildWaiterPersonalUrl(slug, key, webToken) {
  return buildStaffPersonalUrl(slug, key, webToken, "kamarier");
}

/** Link personal cloud — kamarier ose recepsion sipas rolit lokal. */
function buildStaffPersonalUrl(slug, key, webToken, staffRole) {
  const s = normalizeSlug(slug);
  const token = String(webToken || "").trim();
  if (!s || !token) return "";
  const role = String(staffRole || "kamarier").trim().toLowerCase();
  const cloudRole =
    role === "recepsion" || role === "receptionist" || role === "reception" ? "reception" : "waiter";
  const extra = `w=${encodeURIComponent(token)}`;
  return buildAccessLink(null, s, key, cloudRole, extra);
}

function hotelGuestStaticPath(slug, fileName) {
  const raw = normalizeSlug(slug);
  const file = String(fileName || "services.html").trim();
  if (raw) {
    return `${HOTEL_WEB_PREFIX}/${encodeURIComponent(raw)}/guest/${file}`;
  }
  return `${HOTEL_WEB_PREFIX}/guest/${file}`;
}

/** Mysafir — shërbime / room service (cloud: /hotel/{slug}/guest/…). */
function buildHotelGuestPublicUrl(baseUrl, page, roomNumber = "", slug = "", venueOpts = null) {
  const base = trimTrailingSlash(baseUrl || PUBLIC_HOTEL_ORIGIN);
  const roomRaw = String(roomNumber || "").trim();
  const room = encodeURIComponent(roomRaw);
  const rawSlug = normalizeSlug(slug);
  const opts = venueOpts && typeof venueOpts === "object" ? venueOpts : {};
  const tableNum = Number(opts.tableNumber ?? opts.table_number ?? 0);
  const venueCode = encodeURIComponent(String(opts.venueCode ?? opts.venue_code ?? opts.venue ?? "").trim());
  const p = String(page || "").trim().toLowerCase();
  const legacySlugQ = rawSlug ? `slug=${encodeURIComponent(rawSlug)}` : "";
  const appendQuery = (path, params) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v != null && String(v).trim() !== "") q.set(k, String(v).trim());
    }
    if (!rawSlug && legacySlugQ) {
      const legacy = new URLSearchParams(legacySlugQ);
      for (const [k, v] of legacy) q.set(k, v);
    }
    const qs = q.toString();
    return `${base}${path}${qs ? `?${qs}` : ""}`;
  };
  if (p === "guest_menu" || p === "menu_public") {
    return appendQuery(hotelGuestStaticPath(rawSlug, "menu.html"), {});
  }
  if (p === "services") {
    if (roomRaw) {
      return appendQuery(hotelGuestStaticPath(rawSlug, "services.html"), { room: roomRaw });
    }
    if (tableNum >= 1 && venueCode) {
      return appendQuery(hotelGuestStaticPath(rawSlug, "services.html"), {
        table: String(tableNum),
        venue: String(opts.venueCode ?? opts.venue_code ?? opts.venue ?? "").trim(),
      });
    }
    return appendQuery(hotelGuestStaticPath(rawSlug, "services.html"), {});
  }
  if (p === "room-service" || p === "room_service") {
    return roomRaw
      ? appendQuery(hotelGuestStaticPath(rawSlug, "services.html"), { room: roomRaw })
      : buildHotelGuestPublicUrl(baseUrl, "services", "", slug, venueOpts);
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
  buildOwnerAccessLink,
  buildCloudAccessLinks,
  applyHotelLicenseLinks,
  buildLocalAccessLink,
  buildLocalAccessLinks,
  buildPublicMenuUrl,
  buildStaffAccessLink,
  buildHotelVenueSlug,
  slugifyVenueName,
  deriveLocalAccessKey,
  buildWaiterKdsUrl,
  buildWaiterPersonalUrl,
  buildStaffPersonalUrl,
  stripLegacyKitchenSlugSuffix,
  buildLocalWaiterPersonalUrl,
  urlTipiSegment,
  trimTrailingSlash,
  normalizeSlug,
  HOTEL_ACCESS_ROLES,
  STAFF_ACCESS_ROLES,
};
