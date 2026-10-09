/**
 * Linke WiFi stafi — përdoret nga cloud-sync (pa importuar server.js).
 */
const os = require("os");
const { urlTipiSegment } = require("./cloud-server-url");

function lanInterfaceKind(ifName) {
  const n = String(ifName || "").toLowerCase();
  if (/wi-?fi|wireless|wlan|wifi/.test(n)) return "wifi";
  if (/ethernet|local area connection|\beth\b/.test(n)) return "ethernet";
  return "other";
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
  const slug = String(
    db.getSetting("cloud_slug", "")
    || settings.kitchen_slug
    || settings.cloud_client_id
    || "",
  )
    .trim()
    .toLowerCase();
  return { tipi, slug, rawTipi };
}

function localStaffPathSuffix(db, role, code) {
  const { tipi, slug } = resolveLocalVenueSegments(db);
  if (!slug) return null;
  const seg = role === "recepsion" ? "recepsion" : "kamarier";
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

/** Payload për sync te cloud (owner panel). */
function buildStaffLocalLinksSyncPayload(db) {
  const kamarier = getLocalWaiterUrl(db) || "";
  const recepsion = getLocalRecepsionUrl(db) || "";
  return {
    local_waiter_url: kamarier,
    local_recepsion_url: recepsion,
    local_lan_ip: pickLanIPv4Address() || "",
    local_server_port: getLocalServerPort(),
    local_waiter_hostname_urls: getLocalWaiterHostnamePanelUrls(db),
    local_staff_wifi: { kamarier, recepsion },
    synced_at: new Date().toISOString(),
  };
}

module.exports = {
  buildStaffLocalLinksSyncPayload,
};
