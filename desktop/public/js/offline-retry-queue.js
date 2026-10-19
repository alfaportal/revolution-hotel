/**
 * Radhë offline — DËRGO porosi + PRANO/REFUZO online (localStorage, retry pas LAN).
 */
(function offlineRetryQueue(global) {
  if (typeof global === "undefined") return;

  const LS_ORDERS = "pending_orders";
  const LS_ACTIONS = "pending_order_actions";
  const MAX_AGE_MS = 2 * 60 * 60 * 1000;
  let processing = false;
  const handlers = {
    onOrderSent: null,
    onActionDone: null,
  };

  function readList(key) {
    try {
      const raw = global.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeList(key, list) {
    try {
      global.localStorage.setItem(key, JSON.stringify(list || []));
    } catch {
      /* storage full */
    }
    updateBadge();
  }

  function newId() {
    try {
      if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    } catch {
      /* ignore */
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function isNetworkError(err) {
    if (!err) return false;
    const name = String(err.name || "");
    if (name === "TypeError") return true;
    const msg = String(err.message || "").toLowerCase();
    return (
      msg.includes("serveri lokal nuk përgjigjet")
      || msg.includes("failed to fetch")
      || msg.includes("networkerror")
      || msg.includes("load failed")
      || msg.includes("network request failed")
      || msg.includes("aborted")
    );
  }

  function sessionHeaders() {
    const headers = { "Content-Type": "application/json" };
    try {
      const u = typeof global.lexoSesionin === "function" ? global.lexoSesionin() : null;
      if (u?.token) headers["X-Session-Token"] = String(u.token);
    } catch {
      /* ignore */
    }
    return headers;
  }

  async function postJson(path, body) {
    const res = await global.fetch(path, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify(body),
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function ensureToastEl() {
    let el = document.getElementById("offline-queue-toast");
    if (el) return el;
    if (typeof document === "undefined") return null;
    el = document.createElement("div");
    el.id = "offline-queue-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.style.cssText =
      "position:fixed;z-index:99991;left:50%;transform:translateX(-50%);bottom:3.25rem;"
      + "max-width:min(92vw,22rem);padding:0.65rem 1rem;border-radius:12px;font:600 0.82rem/1.35 system-ui,sans-serif;"
      + "color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.35);opacity:0;pointer-events:none;transition:opacity .2s";
    document.body.appendChild(el);
    return el;
  }

  let toastTimer = null;
  function showToast(message, kind) {
    const el = ensureToastEl();
    if (!el || !message) return;
    const colors = {
      warn: { bg: "#ea580c", border: "#fdba74" },
      ok: { bg: "#15803d", border: "#86efac" },
      info: { bg: "#1e293b", border: "#64748b" },
    };
    const c = colors[kind] || colors.info;
    el.style.background = c.bg;
    el.style.border = `1px solid ${c.border}`;
    el.textContent = message;
    el.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.opacity = "0";
    }, kind === "ok" ? 3500 : 5000);
  }

  function ensureBadge() {
    let el = document.getElementById("offline-queue-badge");
    if (el) return el;
    if (typeof document === "undefined") return null;
    el = document.createElement("div");
    el.id = "offline-queue-badge";
    el.hidden = true;
    el.style.cssText =
      "position:fixed;z-index:99989;left:max(0.5rem,env(safe-area-inset-left));bottom:2.65rem;"
      + "padding:0.25rem 0.55rem;border-radius:999px;font:700 0.7rem/1.2 system-ui,sans-serif;"
      + "color:#fff;background:#ea580c;border:1px solid #fdba74;box-shadow:0 2px 8px rgba(0,0,0,.25)";
    document.body.appendChild(el);
    return el;
  }

  function updateBadge() {
    const n = getPendingCount();
    const el = ensureBadge();
    if (!el) return;
    if (n <= 0) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = n === 1 ? "1 porosi në pritje" : `${n} në pritje`;
  }

  function getPendingCount() {
    return readList(LS_ORDERS).length + readList(LS_ACTIONS).length;
  }

  function clearExpired(maxAgeMs) {
    const maxAge = Number(maxAgeMs) || MAX_AGE_MS;
    const now = Date.now();
    let dropped = 0;
    for (const key of [LS_ORDERS, LS_ACTIONS]) {
      const next = [];
      for (const entry of readList(key)) {
        const ts = Number(entry.timestamp || entry.ts || 0);
        if (ts > 0 && now - ts > maxAge) {
          dropped += 1;
          continue;
        }
        next.push(entry);
      }
      writeList(key, next);
    }
    if (dropped > 0) {
      showToast(`${dropped} porosi/veprime të vjetra u hoqën (>2 orë)`, "warn");
    }
  }

  function enqueue(type, payload) {
    const entry = {
      id: newId(),
      timestamp: Date.now(),
      type: String(type || "").trim(),
      payload: payload && typeof payload === "object" ? payload : {},
    };
    if (type === "order_send") {
      const list = readList(LS_ORDERS);
      list.push(entry);
      writeList(LS_ORDERS, list);
    } else if (type === "online_accept" || type === "online_refuse") {
      const list = readList(LS_ACTIONS);
      list.push(entry);
      writeList(LS_ACTIONS, list);
    }
    updateBadge();
    return entry.id;
  }

  function enqueueOrder(body) {
    return enqueue("order_send", { body });
  }

  function enqueueAction(kind, body) {
    const type = kind === "refuse" ? "online_refuse" : "online_accept";
    return enqueue(type, { body });
  }

  async function processOrders() {
    const remaining = [];
    for (const entry of readList(LS_ORDERS)) {
      const body = entry.payload?.body || entry.body;
      if (!body || body.table_id == null) continue;
      try {
        const { res, data } = await postJson("/api/orders", body);
        if (res.ok) {
          showToast("Porosia u dërgua me sukses", "ok");
          try {
            handlers.onOrderSent?.({
              table_id: body.table_id,
              items: body.items,
              waiter_name: body.waiter_name,
              data,
            });
          } catch {
            /* ignore */
          }
          try {
            global.dispatchEvent(new CustomEvent("staff-offline-order-sent", { detail: { body, data } }));
          } catch {
            /* ignore */
          }
          continue;
        }
        if (res.status === 400 || res.status === 409) {
          showToast(data.gabim || data.error || "Porosia u hoq nga pritja (konflikt)", "warn");
          continue;
        }
        remaining.push(entry);
      } catch {
        remaining.push(entry);
      }
    }
    writeList(LS_ORDERS, remaining);
  }

  async function processActions() {
    const remaining = [];
    for (const entry of readList(LS_ACTIONS)) {
      const body = entry.payload?.body || entry.body;
      const type = entry.type || entry.payload?.type;
      const path = type === "online_refuse"
        ? "/api/waiter/online-orders/refuse"
        : "/api/waiter/online-orders/accept";
      if (!body) continue;
      try {
        const { res, data } = await postJson(path, body);
        if (res.ok && data?.ok !== false) {
          try {
            handlers.onActionDone?.({ type, body, data });
          } catch {
            /* ignore */
          }
          try {
            global.dispatchEvent(new CustomEvent("staff-offline-action-done", { detail: { type, body, data } }));
          } catch {
            /* ignore */
          }
          continue;
        }
        if (res.status === 404 || res.status === 409) {
          continue;
        }
        if (res.status === 400) {
          showToast(data.gabim || "Veprimi u hoq nga pritja", "warn");
          continue;
        }
        remaining.push(entry);
      } catch {
        remaining.push(entry);
      }
    }
    writeList(LS_ACTIONS, remaining);
  }

  async function processQueue() {
    if (processing) return;
    processing = true;
    try {
      clearExpired(MAX_AGE_MS);
      await processOrders();
      await processActions();
    } finally {
      processing = false;
      updateBadge();
    }
  }

  function registerHandlers(h) {
    if (!h || typeof h !== "object") return;
    if (typeof h.onOrderSent === "function") handlers.onOrderSent = h.onOrderSent;
    if (typeof h.onActionDone === "function") handlers.onActionDone = h.onActionDone;
  }

  function hookReconnect() {
    global.addEventListener("staff-lan-status-changed", (ev) => {
      if (ev?.detail?.connected) void processQueue();
    });
    global.addEventListener("staff-pos-reconnected", () => {
      void processQueue();
    });
  }

  global.StaffOfflineRetryQueue = {
    enqueue,
    enqueueOrder,
    enqueueAction,
    processQueue,
    getPendingCount,
    clearExpired,
    isNetworkError,
    showToast,
    registerHandlers,
    updateBadge,
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        updateBadge();
        hookReconnect();
      });
    } else {
      updateBadge();
      hookReconnect();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
