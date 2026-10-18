/**
 * Lidhje automatike POS në rrjet lokal (LAN ose Wi‑Fi) — telefon/tablet nuk mbeten te IP e vjetër.
 * Electron / PC (127.0.0.1): nuk skanon — POS është në të njëjtën makinë.
 */
(function staffAutoConnect() {
  if (typeof window === "undefined" || typeof fetch !== "function") return;

  const LS_BASE = "hotel_staff_pos_base_url";
  const LS_PORT = "hotel_staff_pos_port";
  const LS_STATIC_IP = "hotel_staff_pos_static_ip";
  const DISCOVERY_MAX_MS = 5000;
  const MDNS_HOSTS = ["revolution-hotel.local"];
  const MDNS_CANONICAL_HOST = "revolution-hotel.local";
  const SUBNET_PREFIXES = ["192.168.1", "192.168.0", "10.0.0"];
  const SCAN_BATCH = 20;
  const GATEWAY_IPS = ["192.168.1.1", "192.168.0.1", "10.0.0.1"];
  const HEALTH_MS = 45000;
  const MSG_NOT_FOUND = "POS nuk u gjet — kontrolloni LAN ose Wi‑Fi (i njëjti rrjet).";

  // TODO: UDP broadcast for native app discovery (port 41567 — server.js lan-pos-udp-beacon)

  let reconnectBusy = false;
  let statusEl = null;
  let dotEl = null;
  let overlayEl = null;

  function hostLower() {
    return String(window.location.hostname || "").trim().toLowerCase();
  }

  /** POS desktop (Electron) — serveri është në të njëjtën makinë, jo skanim WiFi. */
  function isLoopbackPos() {
    const h = hostLower();
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  }

  function isPrivateLanHost(host) {
    const h = String(host || "").trim();
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    return false;
  }

  /** Skanim IP/.local vetëm për telefon/tablet në LAN/Wi‑Fi — jo për app të instaluar. */
  function shouldRunNetworkDiscovery() {
    return !isLoopbackPos();
  }

  function normalizeBase(url) {
    const s = String(url || "").trim().replace(/\/+$/, "");
    if (!s || !/^https?:\/\//i.test(s)) return "";
    return s;
  }

  function parsePortFromBase(base) {
    try {
      const p = new URL(base).port;
      if (p) return Number(p) || 3001;
    } catch {
      /* ignore */
    }
    const stored = Number(localStorage.getItem(LS_PORT) || "");
    return stored > 0 ? stored : 3001;
  }

  function currentPathAndQuery() {
    return `${window.location.pathname || "/"}${window.location.search || ""}`;
  }

  function ensureUi() {
    if (statusEl) return;
    const wrap = document.createElement("div");
    wrap.id = "staff-pos-connect-ui";
    wrap.setAttribute("aria-live", "polite");
    wrap.style.cssText =
      "position:fixed;z-index:99999;top:0.65rem;right:0.65rem;display:flex;align-items:center;gap:0.45rem;"
      + "font:600 0.78rem/1.2 system-ui,sans-serif;color:#fff;background:rgba(20,24,32,0.82);"
      + "padding:0.35rem 0.55rem;border-radius:999px;pointer-events:none;opacity:0;transition:opacity .2s";
    dotEl = document.createElement("span");
    dotEl.style.cssText =
      "width:0.55rem;height:0.55rem;border-radius:50%;background:#22c55e;flex-shrink:0";
    const label = document.createElement("span");
    label.id = "staff-pos-connect-label";
    label.textContent = "";
    wrap.appendChild(dotEl);
    wrap.appendChild(label);
    document.documentElement.appendChild(wrap);
    statusEl = wrap;
  }

  function ensureOverlay() {
    if (overlayEl) return;
    overlayEl = document.createElement("div");
    overlayEl.id = "staff-pos-search-overlay";
    overlayEl.setAttribute("role", "status");
    overlayEl.setAttribute("aria-live", "polite");
    overlayEl.style.cssText =
      "position:fixed;inset:0;z-index:99998;display:none;align-items:center;justify-content:center;"
      + "background:rgba(8,10,14,0.92);color:#e8eaed;font:600 1rem/1.4 system-ui,sans-serif;text-align:center;padding:1.5rem";
    overlayEl.innerHTML =
      '<div><div style="width:2.5rem;height:2.5rem;border:3px solid rgba(255,255,255,.15);'
      + "border-top-color:#22c55e;border-radius:50%;animation:rh-pos-spin .75s linear infinite;margin:0 auto 1rem\"></div>"
      + '<p id="staff-pos-search-text">Duke kërkuar POS-in…</p></div>';
    const style = document.createElement("style");
    style.textContent = "@keyframes rh-pos-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(style);
    document.documentElement.appendChild(overlayEl);
  }

  function showSearchOverlay(show, text) {
    ensureOverlay();
    if (!overlayEl) return;
    const t = document.getElementById("staff-pos-search-text");
    if (t && text) t.textContent = text;
    overlayEl.style.display = show ? "flex" : "none";
    const finderMsg = document.getElementById("staff-finder-msg");
    if (finderMsg && text) finderMsg.textContent = text;
  }

  function setUi(state, text) {
    ensureUi();
    if (!statusEl || !dotEl) return;
    const label = document.getElementById("staff-pos-connect-label");
    if (state === "hidden") {
      statusEl.style.opacity = "0";
      if (label) label.textContent = "";
      showSearchOverlay(false);
      return;
    }
    if (state === "searching") {
      showSearchOverlay(true, text || "Duke kërkuar POS-in…");
      statusEl.style.opacity = "1";
      dotEl.style.background = "#f97316";
      if (label) label.textContent = text || "Duke kërkuar POS-in…";
      return;
    }
    statusEl.style.opacity = "1";
    if (state === "connected") {
      showSearchOverlay(false, "POS u gjet!");
      dotEl.style.background = "#22c55e";
      if (label) label.textContent = "";
      window.setTimeout(() => setUi("hidden"), 2200);
      return;
    }
    if (state === "reconnecting") {
      dotEl.style.background = "#f97316";
      if (label) label.textContent = "Duke u lidhur…";
    }
  }

  function persistFromServerInfo(info, port) {
    const p = Number(info?.port || info?.local_server_port || port) || 3001;
    localStorage.setItem(LS_PORT, String(p));
    const staticIp = String(info?.staff_pos_static_ip || localStorage.getItem(LS_STATIC_IP) || "").trim();
    if (info?.staff_pos_static_ip != null) {
      localStorage.setItem(LS_STATIC_IP, staticIp);
    }
    const primary = normalizeBase(info?.primary_url || info?.base_url || "");
    if (primary) localStorage.setItem(LS_BASE, primary);
  }

  function preferredRedirectBase(info, port) {
    const fromInfo = normalizeBase(info?.primary_url || info?.base_url || "");
    if (fromInfo) return fromInfo;
    const staticIp = String(info?.staff_pos_static_ip || localStorage.getItem(LS_STATIC_IP) || "").trim();
    if (staticIp) return normalizeBase(`http://${staticIp}:${port}`);
    return normalizeBase(`http://${MDNS_CANONICAL_HOST}:${port}`);
  }

  async function probeServerInfo(base, timeoutMs) {
    const root = normalizeBase(base);
    if (!root) return null;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs || 1500);
    try {
      const res = await fetch(`${root}/api/server-info`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== "object") return null;
      const port = Number(data.port || data.local_server_port) || parsePortFromBase(root);
      persistFromServerInfo(data, port);
      return { base: root, info: data, port };
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function notifyReconnected() {
    try {
      window.dispatchEvent(new CustomEvent("staff-pos-reconnected"));
    } catch {
      /* ignore */
    }
  }

  function redirectToBase(hit) {
    if (!hit) return false;
    const port = hit.port || parsePortFromBase(hit.base);
    const root = preferredRedirectBase(hit.info, port);
    if (!root) return false;
    localStorage.setItem(LS_BASE, root);
    const here = normalizeBase(window.location.origin);
    if (here === root) {
      setUi("connected", "POS u gjet!");
      notifyReconnected();
      return true;
    }
    window.location.replace(`${root}${currentPathAndQuery()}`);
    return true;
  }

  function hostnameCandidates(port) {
    const out = [];
    for (const h of MDNS_HOSTS) {
      out.push(`http://${h}:${port}`);
    }
    try {
      const pc = String(window.location.hostname || "").trim();
      if (pc && pc.endsWith(".local") && !MDNS_HOSTS.includes(pc)) {
        out.push(`http://${pc}:${port}`);
      }
    } catch {
      /* ignore */
    }
    return out;
  }

  function subnetPrefixesForScan() {
    const prefixes = [];
    const sources = [
      localStorage.getItem(LS_BASE) || "",
      window.location.href,
    ];
    for (const src of sources) {
      const m = String(src).match(/https?:\/\/(\d+\.\d+\.\d+)\.\d+/);
      if (m && m[1] && !prefixes.includes(m[1])) prefixes.push(m[1]);
    }
    for (const p of SUBNET_PREFIXES) {
      if (!prefixes.includes(p)) prefixes.push(p);
    }
    return prefixes;
  }

  function buildScanIpList(port) {
    const ips = [];
    const staticIp = String(localStorage.getItem(LS_STATIC_IP) || "").trim();
    if (staticIp) ips.push(staticIp);
    for (const gw of GATEWAY_IPS) {
      if (!ips.includes(gw)) ips.push(gw);
    }
    const prefixes = subnetPrefixesForScan();
    for (const prefix of prefixes) {
      for (let i = 1; i <= 254; i += 1) {
        const ip = `${prefix}.${i}`;
        if (!ips.includes(ip)) ips.push(ip);
      }
    }
    return ips.map((ip) => `http://${ip}:${port}`);
  }

  async function raceDiscovery(port) {
    const saved = normalizeBase(localStorage.getItem(LS_BASE) || "");
    const staticIp = String(localStorage.getItem(LS_STATIC_IP) || "").trim();
    const staticBase = staticIp ? normalizeBase(`http://${staticIp}:${port}`) : "";

    const immediate = [
      { base: saved, ms: 1500, label: "Duke provuar lidhjen e ruajtur…" },
      ...hostnameCandidates(port).map((b) => ({ base: b, ms: 2000, label: "Duke provuar .local…" })),
      ...(staticBase ? [{ base: staticBase, ms: 1500, label: "Duke provuar IP statike…" }] : []),
      { base: normalizeBase(window.location.origin), ms: 1200, label: "Duke provuar adresën aktuale…" },
    ];

    setUi("searching", "Duke provuar .local…");

    return new Promise((resolve) => {
      let done = false;
      const finish = (hit) => {
        if (done) return;
        done = true;
        window.clearTimeout(maxTimer);
        resolve(hit || null);
      };

      const maxTimer = window.setTimeout(() => finish(null), DISCOVERY_MAX_MS);

      for (const item of immediate) {
        if (!item.base) continue;
        probeServerInfo(item.base, item.ms).then((hit) => {
          if (hit) {
            setUi("searching", "POS u gjet!");
            finish(hit);
          }
        });
      }

      const scanBases = buildScanIpList(port);
      let scanIdx = 0;
      const runScanBatch = () => {
        if (done) return;
        if (scanIdx >= scanBases.length) return;
        setUi("searching", "Duke skanuar rrjetin…");
        const slice = scanBases.slice(scanIdx, scanIdx + SCAN_BATCH);
        scanIdx += SCAN_BATCH;
        for (const base of slice) {
          probeServerInfo(base, 1000).then((hit) => {
            if (hit) {
              setUi("searching", "POS u gjet!");
              finish(hit);
            }
          });
        }
        if (!done && scanIdx < scanBases.length) {
          window.setTimeout(runScanBatch, 0);
        }
      };
      window.setTimeout(runScanBatch, 80);
    });
  }

  async function discoverPos() {
    if (!shouldRunNetworkDiscovery()) {
      setUi("hidden");
      return null;
    }
    if (reconnectBusy) return null;
    reconnectBusy = true;
    setUi("searching", "Duke kërkuar POS-in…");
    try {
      const port = parsePortFromBase(
        localStorage.getItem(LS_BASE) || window.location.origin,
      );
      const hit = await raceDiscovery(port);
      if (hit) {
        redirectToBase(hit);
        return hit;
      }
      setUi("searching", MSG_NOT_FOUND);
      return null;
    } finally {
      reconnectBusy = false;
    }
  }

  async function ensureConnected() {
    const origin = normalizeBase(window.location.origin);
    const probeMs = isLoopbackPos() ? 3500 : 1500;
    const hit = await probeServerInfo(origin, probeMs);
    if (hit) {
      persistFromServerInfo(hit.info, hit.port);
      setUi("connected", "POS u gjet!");
      return true;
    }
    if (!shouldRunNetworkDiscovery()) {
      setUi("hidden");
      return false;
    }
    if (isPrivateLanHost(hostLower())) {
      const port = parsePortFromBase(origin || localStorage.getItem(LS_BASE) || "");
      const staticIp = String(localStorage.getItem(LS_STATIC_IP) || "").trim();
      if (staticIp) {
        const staticHit = await probeServerInfo(`http://${staticIp}:${port}`, 2000);
        if (staticHit) {
          redirectToBase(staticHit);
          return true;
        }
      }
    }
    const found = await discoverPos();
    return Boolean(found);
  }

  function shouldTriggerDiscovery(input) {
    try {
      const u = typeof input === "string" ? input : input?.url;
      const url = new URL(u, window.location.href);
      if (url.origin !== window.location.origin) return false;
      const path = url.pathname || "";
      return path.indexOf("/api/") === 0;
    } catch {
      return false;
    }
  }

  function isLikelyNetworkFailure(err) {
    if (!err) return false;
    const name = String(err.name || "");
    if (name === "AbortError") return false;
    if (name === "TypeError") return true;
    const msg = String(err.message || "").toLowerCase();
    return (
      msg.includes("failed to fetch")
      || msg.includes("networkerror")
      || msg.includes("load failed")
      || msg.includes("network request failed")
    );
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function staffPosFetchWrapped(input, init) {
    const p = nativeFetch(input, init);
    return p.catch((err) => {
      if (shouldTriggerDiscovery(input) && isLikelyNetworkFailure(err)) {
        void ensureConnected();
      }
      throw err;
    });
  };

  window.addEventListener("online", () => {
    void ensureConnected();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void ensureConnected();
  });

  window.addEventListener("load", () => {
    const port = parsePortFromBase(window.location.origin);
    if (!localStorage.getItem(LS_BASE)) {
      localStorage.setItem(LS_BASE, normalizeBase(`http://${MDNS_CANONICAL_HOST}:${port}`));
    }
    void ensureConnected();
    window.setInterval(() => {
      const probeMs = isLoopbackPos() ? 3500 : 1500;
      void probeServerInfo(window.location.origin, probeMs).then((hit) => {
        if (hit) {
          persistFromServerInfo(hit.info, hit.port);
          setUi("connected");
          return;
        }
        if (shouldRunNetworkDiscovery()) {
          void ensureConnected();
        } else {
          setUi("hidden");
        }
      });
    }, HEALTH_MS);
  });

  window.HotelStaffAutoConnect = {
    ensureConnected,
    discoverPos,
  };
})();
