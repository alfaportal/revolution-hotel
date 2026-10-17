/**
 * Linke WiFi stafi — përdoret nga cloud-sync (pa importuar server.js).
 */
const os = require("os");
const { urlTipiSegment, stripLegacyKitchenSlugSuffix } = require("./cloud-server-url");

function lanInterfaceKind(ifName) {
  const n = String(ifName || "").toLowerCase();
  if (/wi-?fi|wireless|wlan|wifi/.test(n)) return "wifi";
  if (/ethernet|local area connection|\beth\b/.test(n)) return "ethernet";
  return "other";
}

function listLanIPv4Addresses() {
  const ips = [];
  const seen = new Set();
  for (const [, addrs] of Object.entries(os.networkInterfaces())) {
    for (const net of addrs || []) {
      if (net.family !== "IPv4" || net.internal) continue;
      const ip = String(net.address || "").trim();
      if (!ip || ip.startsWith("169.254.")) continue;
      if (seen.has(ip)) continue;
      seen.add(ip);
      ips.push(ip);
    }
  }
  return ips;
}

function pickLanIPv4Address() {
  const candidates = [];
  for (const [ifName, addrs] of Object.entries(os.networkInterfaces())) {
    for (const net of addrs || []) {
      if (net.family !== "IPv4" || net.internal) continue;
      const ip = String(net.address || "").trim();
      if (!ip || ip.startsWith("169.254.")) continue;
      candidates.push({ ip, kind: lanInterfaceKind(ifName) });
    }
  }
  const wifi = candidates.find(c => c.kind === "wifi");
  if (wifi) return wifi.ip;
  const ethernet = candidates.find(c => c.kind === "ethernet");
  if (ethernet) return ethernet.ip;
  return candidates[0]?.ip || null;
}

function getLocalServerPort() {
  return Number(process.env.ACTUAL_PORT || process.env.PORT || 3001) || 3001;
}

function getLocalLanBaseUrl() {
  const port = getLocalServerPort();
  const ip = pickLanIPv4Address();
  return ip ? `http://${ip}:${port}`.replace(/\/+$/, "") : null;
}

function sanitizeLanHostname(name) {
  return String(name || "")
    .trim()
    .replace(/[^\w.-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function resolveLocalVenueSegments(db) {
  const settings = db.getCloudSettings();
  const rawTipi =
    db.getSetting("cloud_business_type", "")
    || settings.client_tipi
    || db.getSetting("client_tipi", "")
    || "hotel";
  const tipi = urlTipiSegment(rawTipi);
  let slug = String(
    db.getSetting("cloud_slug", "")
    || settings.kitchen_slug
    || settings.cloud_client_id
    || "",
  )
    .trim()
    .toLowerCase();
  slug = stripLegacyKitchenSlugSuffix(slug) || slug;
  return { tipi, slug, rawTipi };
}

function localStaffPathSuffix(db, role, code) {
  const { tipi, slug } = resolveLocalVenueSegments(db);
  if (!slug) return null;
  const r = String(role || "kamarier").trim().toLowerCase();
  const seg =
    r === "recepsion" ? "recepsion"
      : r === "sherbimi" || r === "pastrim" || r === "housekeeping" ? "sherbimi"
        : r === "kuzhina" || r === "kitchen" ? "kuzhina"
          : r === "banaku" || r === "bar" ? "banaku"
            : "kamarier";
  let path = `/${tipi}/${slug}/${seg}`;
  const c = String(code ?? "").trim();
  if (c && /^\d{3}$/.test(c)) path += `/${c}`;
  return path;
}

function getLocalWaiterUrl(db) {
  const base = getLocalLanBaseUrl();
  const suffix = localStaffPathSuffix(db, "kamarier");
  if (!base || !suffix) return null;
  return `${base}${suffix}`;
}

function getLocalRecepsionUrl(db) {
  const base = getLocalLanBaseUrl();
  const suffix = localStaffPathSuffix(db, "recepsion");
  if (!base || !suffix) return null;
  return `${base}${suffix}`;
}

function getLocalSherbimiUrl(db) {
  const base = getLocalLanBaseUrl();
  const suffix = localStaffPathSuffix(db, "sherbimi");
  if (!base || !suffix) return null;
  return `${base}${suffix}`;
}

function getLocalWaiterHostnamePanelUrls(db) {
  const port = getLocalServerPort();
  const staffSuffix = localStaffPathSuffix(db, "kamarier");
  const suffix = staffSuffix || "/login.html?mode=kamarier";
  const out = [];
  const pc = sanitizeLanHostname(os.hostname());
  if (pc) {
    out.push({
      id: "pc-name",
      label: `Emri i PC-së (${pc})`,
      url: `http://${pc}:${port}${suffix}`,
    });
  }
  out.push({
    id: "revolution-hotel-local",
    label: "revolution-hotel.local",
    url: `http://revolution-hotel.local:${port}${suffix}`,
  });
  return out;
}

const STAFF_LOCAL_LINKS_FP_KEY = "staff_local_links_cloud_fp";

/** Fingerprint pa synced_at — për të dërguar cloud vetëm kur ndryshon LAN. */
function staffLocalLinksFingerprint(links) {
  if (!links || typeof links !== "object") return "";
  return JSON.stringify({
    ip: String(links.local_lan_ip || "").trim(),
    port: Number(links.local_server_port) || 0,
    kamarier: String(links.local_waiter_url || links.local_staff_wifi?.kamarier || "").trim(),
    recepsion: String(links.local_recepsion_url || links.local_staff_wifi?.recepsion || "").trim(),
    sherbimi: String(links.local_sherbimi_url || links.local_staff_wifi?.sherbimi || "").trim(),
  });
}

function readStoredStaffLocalLinksFingerprint(db) {
  if (!db || typeof db.getSetting !== "function") return "";
  return String(db.getSetting(STAFF_LOCAL_LINKS_FP_KEY, "") || "").trim();
}

function storeStaffLocalLinksFingerprint(db, fp) {
  if (!db || typeof db.setSetting !== "function" || !fp) return;
  db.setSetting(STAFF_LOCAL_LINKS_FP_KEY, String(fp));
}

/** Payload për sync te cloud (owner panel). */
function buildStaffLocalLinksSyncPayload(db) {
  const kamarier = getLocalWaiterUrl(db) || "";
  const recepsion = getLocalRecepsionUrl(db) || "";
  const sherbimi = getLocalSherbimiUrl(db) || "";
  return {
    local_waiter_url: kamarier,
    local_recepsion_url: recepsion,
    local_sherbimi_url: sherbimi,
    local_lan_ip: pickLanIPv4Address() || "",
    local_server_port: getLocalServerPort(),
    local_waiter_hostname_urls: getLocalWaiterHostnamePanelUrls(db),
    local_staff_wifi: { kamarier, recepsion, sherbimi },
    synced_at: new Date().toISOString(),
  };
}

const LAN_STAFF_LINKS_WATCH_MS = 15000;
let lanStaffLinksWatchStarted = false;
let lanStaffLinksPushInFlight = false;

/**
 * Në server (pa Admin): kontrollon IP LAN; dërgon staff_local_links te cloud vetëm kur ndryshon.
 */
function startStaffLocalLinksLanWatcher(db) {
  if (lanStaffLinksWatchStarted || !db) return;
  lanStaffLinksWatchStarted = true;

  const tick = () => {
    if (lanStaffLinksPushInFlight) return;
    try {
      const cloudSync = require("./cloud-sync");
      if (!cloudSync.isCloudConfigured(db)) return;
      const payload = buildStaffLocalLinksSyncPayload(db);
      const fp = staffLocalLinksFingerprint(payload);
      if (!fp) return;
      const prev = readStoredStaffLocalLinksFingerprint(db);
      if (fp === prev) return;

      lanStaffLinksPushInFlight = true;
      cloudSync
        .pushStaffLocalLinksAsync(db, { payload, fingerprint: fp })
        .catch((err) => {
          console.warn("[lan-staff-links] cloud push:", err?.message || err);
        })
        .finally(() => {
          lanStaffLinksPushInFlight = false;
        });
    } catch (err) {
      console.warn("[lan-staff-links] watch:", err?.message || err);
    }
  };

  setTimeout(tick, 4000);
  setInterval(tick, LAN_STAFF_LINKS_WATCH_MS);
}

module.exports = {
  buildStaffLocalLinksSyncPayload,
  staffLocalLinksFingerprint,
  readStoredStaffLocalLinksFingerprint,
  storeStaffLocalLinksFingerprint,
  STAFF_LOCAL_LINKS_FP_KEY,
  pickLanIPv4Address,
  listLanIPv4Addresses,
  sanitizeLanHostname,
  getLocalServerPort,
  startStaffLocalLinksLanWatcher,
};
