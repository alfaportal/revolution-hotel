/**
 * SSE lokal — /api/local-events (token në query). Rilidhet me backoff eksponencial.
 */
(function (global) {
  const RECONNECT_MS_MIN = 2000;
  const RECONNECT_MS_MAX = 30000;
  const EVENT_TYPES = [
    "order-new",
    "order-status",
    "order-accepted",
    "order-refused",
    "room-status",
    "room-assigned",
    "table-update",
    "guest-order",
    "shift-closed",
  ];

  const handlers = new Map();
  let es = null;
  let closed = false;
  let onReconnectCb = null;
  let reconnectTimer = null;
  let reconnectBackoffMs = RECONNECT_MS_MIN;
  let sseErrorHandling = false;

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

  function resetReconnectBackoff() {
    reconnectBackoffMs = RECONNECT_MS_MIN;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (closed) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = reconnectBackoffMs;
    reconnectBackoffMs = Math.min(reconnectBackoffMs * 2, RECONNECT_MS_MAX);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openStream();
    }, delay);
  }

  async function handleSseError() {
    if (sseErrorHandling) return;
    sseErrorHandling = true;
    try {
      if (typeof global.HotelStaffAutoConnect?.onSseDisconnected === "function") {
        await global.HotelStaffAutoConnect.onSseDisconnected();
      }
    } catch {
      /* ignore */
    } finally {
      sseErrorHandling = false;
      if (!closed) scheduleReconnect();
    }
  }

  function connect(onReconnect) {
    if (onReconnect) onReconnectCb = onReconnect;
    closed = false;
    resetReconnectBackoff();
    openStream();
    if (typeof global.addEventListener === "function") {
      global.addEventListener("staff-pos-reconnected", () => {
        if (!closed) {
          resetReconnectBackoff();
          openStream();
        }
      });
    }
    return { close: disconnect };
  }

  function disconnect() {
    closed = true;
    resetReconnectBackoff();
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
      global.LanStatus?.refresh?.();
      scheduleReconnect();
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
      resetReconnectBackoff();
      global.__localStaffEventsConnected = true;
      global.LanStatus?.refresh?.();
      global.StaffOfflineRetryQueue?.processQueue?.();
      if (typeof global.HotelStaffAutoConnect?.setUi === "function") {
        global.HotelStaffAutoConnect.setUi("hidden");
      }
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
      global.LanStatus?.refresh?.();
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      es = null;
      void handleSseError();
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

  /** Kur LAN (SSE + health) është OK, zgjat intervalin e polling fallback. */
  function fallbackIntervalMs(fastMs, slowMs) {
    const fast = Number(fastMs) || 8000;
    const slow = Number(slowMs) || 30000;
    if (typeof global.LanStatus?.isLanConnected === "function") {
      return global.LanStatus.isLanConnected() ? Math.max(slow, 30000) : fast;
    }
    return isConnected() ? Math.max(slow, 30000) : fast;
  }

  function isLanConnected() {
    if (typeof global.LanStatus?.isLanConnected === "function") {
      return global.LanStatus.isLanConnected();
    }
    return isConnected();
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
    isLanConnected,
    fallbackIntervalMs,
  };
})(typeof window !== "undefined" ? window : globalThis);
