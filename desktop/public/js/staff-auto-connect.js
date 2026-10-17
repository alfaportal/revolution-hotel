/**
 * Lidhje automatike POS në WiFi — stafi nuk shikon IP / gabime teknike.
 */
(function staffAutoConnect() {
  if (typeof window === "undefined" || typeof fetch !== "function") return;

  const LS_BASE = "hotel_staff_pos_base_url";
  const LS_PORT = "hotel_staff_pos_port";
  const PROBE_MS = 2800;
  const HEALTH_MS = 45000;
  const MDNS_HOSTS = ["revolution-hotel.local"];
  const SUBNET_PREFIXES = ["192.168.1", "192.168.0", "10.0.0"];

  let reconnectBusy = false;
  let statusEl = null;
  let dotEl = null;

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

  function setUi(state) {
    ensureUi();
    if (!statusEl || !dotEl) return;
    const label = document.getElementById("staff-pos-connect-label");
    if (state === "hidden") {
      statusEl.style.opacity = "0";
      if (label) label.textContent = "";
      return;
    }
    statusEl.style.opacity = "1";
    if (state === "connected") {
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

  async function probeServerInfo(base, timeoutMs) {
    const root = normalizeBase(base);
    if (!root) return null;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs || PROBE_MS);
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
      localStorage.setItem(LS_PORT, String(port));
      return { base: root, info: data, port };
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function persistBase(base) {
    const b = normalizeBase(base);
    if (b) localStorage.setItem(LS_BASE, b);
  }

  function redirectToBase(base) {
    const root = normalizeBase(base);
    if (!root) return false;
    persistBase(root);
    const here = normalizeBase(window.location.origin);
    if (root === here) {
      setUi("connected");
      return true;
    }
    const dest = `${root}${currentPathAndQuery()}`;
    window.location.replace(dest);
    return true;
  }

  async function tryCandidates(bases, portHint) {
    const seen = new Set();
    for (const raw of bases) {
      const b = normalizeBase(raw);
      if (!b || seen.has(b)) continue;
      seen.add(b);
      const hit = await probeServerInfo(b, PROBE_MS);
      if (hit) {
        const port = hit.port || portHint || parsePortFromBase(b);
        localStorage.setItem(LS_PORT, String(port));
        redirectToBase(hit.base);
        return hit;
      }
    }
    return null;
  }

  function hostnameCandidates(port) {
    const out = [];
    for (const h of MDNS_HOSTS) {
      out.push(`http://${h}:${port}`);
    }
    return out;
  }

  async function scanSubnet(port) {
    const ips = [];
    for (const prefix of SUBNET_PREFIXES) {
      for (let i = 1; i <= 254; i += 1) ips.push(`${prefix}.${i}`);
    }
    const batch = 36;
    for (let i = 0; i < ips.length; i += batch) {
      const slice = ips.slice(i, i + batch);
      const probes = slice.map((ip) => probeServerInfo(`http://${ip}:${port}`, 900));
      const results = await Promise.all(probes);
      const hit = results.find(Boolean);
      if (hit) return hit;
    }
    return null;
  }

  async function discoverPos() {
    if (reconnectBusy) return null;
    reconnectBusy = true;
    setUi("reconnecting");
    try {
      const saved = localStorage.getItem(LS_BASE) || "";
      const port = parsePortFromBase(saved || window.location.origin);
      const order = [
        saved,
        window.location.origin,
        ...hostnameCandidates(port),
      ];
      let hit = await tryCandidates(order, port);
      if (hit) return hit;

      hit = await scanSubnet(port);
      if (hit) {
        redirectToBase(hit.base);
        return hit;
      }
      setUi("reconnecting");
      return null;
    } finally {
      reconnectBusy = false;
    }
  }

  async function ensureConnected() {
    const origin = normalizeBase(window.location.origin);
    const hit = await probeServerInfo(origin, PROBE_MS);
    if (hit) {
      persistBase(hit.base);
      setUi("connected");
      return true;
    }
    const found = await discoverPos();
    return Boolean(found);
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function staffPosFetchWrapped(input, init) {
    const p = nativeFetch(input, init);
    return p.catch((err) => {
      let sameOrigin = false;
      try {
        const u = typeof input === "string" ? input : input?.url;
        const url = new URL(u, window.location.href);
        sameOrigin = url.origin === window.location.origin;
      } catch {
        sameOrigin = false;
      }
      if (sameOrigin && String(urlPath(input)).indexOf("/api/") === 0) {
        void discoverPos();
      }
      throw err;
    });
  };

  function urlPath(input) {
    try {
      const u = typeof input === "string" ? input : input?.url;
      return new URL(u, window.location.href).pathname || "";
    } catch {
      return "";
    }
  }

  window.addEventListener("online", () => {
    void ensureConnected();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void ensureConnected();
  });

  window.addEventListener("load", () => {
    void ensureConnected();
    window.setInterval(() => {
      void probeServerInfo(window.location.origin, PROBE_MS).then((hit) => {
        if (hit) persistBase(hit.base);
        else void discoverPos();
      });
    }, HEALTH_MS);
  });

  window.HotelStaffAutoConnect = {
    ensureConnected,
    discoverPos,
  };
})();
