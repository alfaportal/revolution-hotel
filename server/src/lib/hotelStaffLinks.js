/**
 * Linqe stafi hotel — formati i desktop (revolution-pos.com/hotel/{slug}/kamarier|recepsion).
 */
const { featuresForTier } = require("./packages");

const HOTEL_WEB_PREFIX = "/hotel";

const STAFF_PUBLIC_SEGMENT = {
  waiter: "kamarier",
  reception: "recepsion",
};

function trimBase(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

function hotelUrlTipiSegment(tipi) {
  const normalized = String(tipi || "hotel").toLowerCase().trim();
  if (normalized === "hotel" || normalized.startsWith("hotel")) return "hotel";
  return String(normalized)
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    || "hotel";
}

function buildHotelStaffRoleUrl(baseUrl, slug, key, role) {
  const s = String(slug || "").trim();
  const base = trimBase(baseUrl);
  const r = String(role || "").trim().toLowerCase();
  const seg = STAFF_PUBLIC_SEGMENT[r];
  if (!s || !base || !seg) return "";
  let url = `${base}${HOTEL_WEB_PREFIX}/${encodeURIComponent(s)}/${seg}`;
  const k = String(key || "").trim();
  if (k) url += `?key=${encodeURIComponent(k)}`;
  return url;
}

function buildHotelTakeawayUrl(baseUrl, slug, tipi) {
  const s = String(slug || "").trim();
  const base = trimBase(baseUrl);
  if (!s || !base) return "";
  const t = hotelUrlTipiSegment(tipi);
  return `${base}/${t}/${encodeURIComponent(s)}/takeaway`;
}

/** Linket e plota për panelin e pronarit (cloud + lokal nga sync). */
function buildHotelOwnerStaffLinks(baseUrl, client, localSnapshot = null) {
  const slug = client?.kitchen_slug || client?.id;
  const key = client?.kitchen_key || "";
  const base = trimBase(baseUrl);
  const features = featuresForTier(client?.package_tier);
  const local = localSnapshot && typeof localSnapshot === "object" ? localSnapshot : {};

  const waiterCloud = features.waiter ? buildHotelStaffRoleUrl(base, slug, key, "waiter") : "";
  const receptionCloud = buildHotelStaffRoleUrl(base, slug, key, "reception");
  const takeaway =
    features.online_orders || features.website
      ? buildHotelTakeawayUrl(base, slug, client?.tipi)
      : buildHotelTakeawayUrl(base, slug, client?.tipi);

  const localWaiter =
    String(local.local_waiter_url || local.local_staff_wifi?.kamarier || "").trim();
  let localReception =
    String(local.local_recepsion_url || local.local_staff_wifi?.recepsion || "").trim();
  if (!localReception && localWaiter) {
    localReception = localWaiter.replace(/\/kamarier(\/\d{3})?\/?$/i, "/recepsion$1");
  }

  const hostnameUrls = Array.isArray(local.local_waiter_hostname_urls)
    ? local.local_waiter_hostname_urls.filter(e => e && e.url)
    : [];

  return {
    waiter_cloud: waiterCloud,
    waiter_wifi: localWaiter,
    reception_cloud: receptionCloud,
    reception_wifi: localReception,
    takeaway_url: takeaway,
    waiter_hostname_urls: hostnameUrls,
  };
}

module.exports = {
  buildHotelStaffRoleUrl,
  buildHotelTakeawayUrl,
  buildHotelOwnerStaffLinks,
};
