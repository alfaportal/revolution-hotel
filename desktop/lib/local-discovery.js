/**
 * mDNS / Bonjour — POS reklamohet në WiFi (_http._tcp).
 * Hostname: revolution-hotel.local
 */
const os = require("os");
const { sanitizeLanHostname } = require("../local-staff-links");

let activeService = null;
let activeResponder = null;
let lastOptsKey = "";

function discoveryOptsKey(opts) {
  const o = opts || {};
  return `${Number(o.port) || 0}|${String(o.slug || "").trim()}|${String(o.hostname || "").trim()}`;
}

function stopLocalDiscovery() {
  try {
    if (activeService) {
      const svc = activeService;
      activeService = null;
      Promise.resolve(svc.destroy?.()).catch(() => {});
    }
  } catch (err) {
    console.warn("[mdns] stop:", err?.message || err);
  }
  try {
    if (activeResponder) {
      activeResponder.destroy?.();
      activeResponder = null;
    }
  } catch {
    /* ignore */
  }
}

function startLocalDiscovery(opts = {}) {
  const port = Number(opts.port) || 3001;
  const slug = String(opts.slug || "").trim();
  const hostname = String(opts.hostname || "revolution-hotel").trim() || "revolution-hotel";
  const key = discoveryOptsKey({ port, slug, hostname });
  const forceRestart = opts.force === true;
  if (!forceRestart && key === lastOptsKey && activeService) return { ok: true, already: true };

  stopLocalDiscovery();
  lastOptsKey = key;

  let ciao;
  try {
    ciao = require("@homebridge/ciao");
  } catch (err) {
    console.warn("[mdns] @homebridge/ciao mungon:", err?.message || err);
    return { ok: false, reason: "ciao_missing" };
  }

  try {
    activeResponder = ciao.getResponder();
    const serviceName = slug
      ? `Revolution-HOTEL-${slug}`.slice(0, 63)
      : "Revolution-HOTEL";
    activeService = activeResponder.createService({
      name: serviceName,
      type: "http",
      port,
      hostname,
      txt: {
        app: "revolution-hotel",
        slug: slug || "hotel",
        path: slug ? `/hotel/${slug}/kamarier` : "/login.html",
      },
    });
    activeService.on("name-change", (name) => {
      console.log("[mdns] emri shërbimit:", name);
    });
    activeService.advertise();
    const pc = sanitizeLanHostname(os.hostname());
    console.log(
      `[mdns] POS në WiFi: http://${hostname}.local:${port}`
      + (pc ? ` (ose http://${pc}.local:${port})` : ""),
    );
    return { ok: true, service_name: serviceName, hostname: `${hostname}.local`, port };
  } catch (err) {
    console.warn("[mdns] advertise dështoi:", err?.message || err);
    stopLocalDiscovery();
    return { ok: false, reason: err?.message || "advertise_failed" };
  }
}

function restartLocalDiscovery(opts) {
  lastOptsKey = "";
  return startLocalDiscovery({ ...(opts || {}), force: true });
}

// TODO: BLE discovery — Web Bluetooth pairing për URL POS (prioritet i ulët).

module.exports = {
  startLocalDiscovery,
  restartLocalDiscovery,
  stopLocalDiscovery,
};
