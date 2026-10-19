/**
 * SSE lokal — /api/local-events (token në query). Rilidhet pas 2s.
 */
(function (global) {
  const RECONNECT_MS = 2000;
  const EVENT_TYPES = [
    "order-new",
    "order-status",
    "order-accepted",
    "order-refused",
    "room-status",
    "room-assigned",
    "table-update",
    "guest-order",
  ];

  const handlers = new Map();
  let es = null;
  let closed = false;
  let onReconnectCb = null;

  function readToken() {
    try {
      const path = String(global.location?.pathname || "").toLowerCase();
      const kdsRole = path.includes("kitchen") ? "kuzhina" : path.includes("bar") ? "banaku" : "";
      if (kdsRole && typeof global.KdsStationSession !== "undefined") {
        const kds = global.KdsStationSession.restoreToSessionStorage(kdsRole);
        if (kds?.token) return String(kds.token);
      }
      if (typeof lexoSesionin === "function") {
        const u = lexoSesionin();
        if (u?.token) return String(u.token);
      }
      const u = JSON.parse(sessionStorage.getItem("rh_user") || "null");
      return u?.token ? String(u.token) : "";
    } catch {
      return "";
    }
  }

  function dispatch(type, envelope) {
    const set = handlers.get(type);
    if (set) {
      for (const fn of set) {
        try {
          fn(envelope);
        } catch {
          /* ignore */
        }
      }
    }
    const any = handlers.get("*");
    if (any) {
      for (const fn of any) {
        try {
          fn(type, envelope);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function parseEnvelope(ev) {
    try {
      return JSON.parse(String(ev.data || "{}"));
    } catch {
      return { type: ev.type, data: {}, timestamp: "" };
    }
  }

  function connect(onReconnect) {
    if (onReconnect) onReconnectCb = onReconnect;
    closed = false;
    openStream();
    if (typeof global.addEventListener === "function") {
      global.addEventListener("staff-pos-reconnected", () => {
        if (!closed) openStream();
      });
    }
    return { close: disconnect };
  }

  function disconnect() {
    closed = true;
    if (es) {
      try {
        es.close();
      } catch {
        /* ignore */
      }
      es = null;
    }
    global.__localStaffEventsConnected = false;
  }

  function openStream() {
    if (closed) return;
    const token = readToken();
    if (!token || typeof EventSource === "undefined") {
      global.__localStaffEventsConnected = false;
      setTimeout(openStream, RECONNECT_MS);
      return;
    }
    if (es) {
      try {
        es.close();
      } catch {
        /* ignore */
      }
    }
    const url = `/api/local-events?token=${encodeURIComponent(token)}`;
    es = new EventSource(url);
    es.onopen = () => {
      global.__localStaffEventsConnected = true;
      if (typeof onReconnectCb === "function") {
        try {
          onReconnectCb();
        } catch {
          /* ignore */
        }
      }
    };
    for (const t of EVENT_TYPES) {
      es.addEventListener(t, (ev) => dispatch(t, parseEnvelope(ev)));
    }
    es.onerror = () => {
      global.__localStaffEventsConnected = false;
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      es = null;
      if (typeof global.HotelStaffAutoConnect?.discoverPos === "function") {
        void global.HotelStaffAutoConnect.discoverPos().then((hit) => {
          if (hit && !closed) setTimeout(openStream, RECONNECT_MS);
        });
      }
      if (!closed) setTimeout(openStream, RECONNECT_MS);
    };
  }

  function on(type, fn) {
    const key = String(type || "").trim();
    if (!key || typeof fn !== "function") return () => {};
    if (!handlers.has(key)) handlers.set(key, new Set());
    handlers.get(key).add(fn);
    return () => handlers.get(key)?.delete(fn);
  }

  function isConnected() {
    return !!global.__localStaffEventsConnected;
  }

  /** Kur SSE është aktiv, zgjat intervalin e polling fallback. */
  function fallbackIntervalMs(fastMs, slowMs) {
    const fast = Number(fastMs) || 8000;
    const slow = Number(slowMs) || 30000;
    return isConnected() ? Math.max(slow, 30000) : fast;
  }

  if (typeof navigator !== "undefined" && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", (ev) => {
      if (ev.data?.type === "STAFF_POS_RUN_DISCOVER" && global.HotelStaffAutoConnect?.discoverPos) {
        void global.HotelStaffAutoConnect.discoverPos();
      }
    });
  }

  global.LocalStaffEvents = {
    connect,
    disconnect,
    on,
    isConnected,
    fallbackIntervalMs,
  };
})(typeof window !== "undefined" ? window : globalThis);
