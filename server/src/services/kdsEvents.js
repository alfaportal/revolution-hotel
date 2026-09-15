/** SSE subscribers për KDS — njoftim kur ndryshon radha e kuzhinës. */

const subscribers = new Map();

function subscribe(clientId, res) {
  const id = String(clientId);
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id).add(res);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") {
    try { res.flushHeaders(); } catch { /* ignore */ }
  }
  res.write(": connected\n\n");

  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  res.on("close", () => {
    clearInterval(heartbeat);
    subscribers.get(id)?.delete(res);
    if (subscribers.get(id)?.size === 0) subscribers.delete(id);
  });
}

function notifyKitchenUpdate(clientId, payload = {}) {
  const id = String(clientId);
  const set = subscribers.get(id);
  if (!set?.size) return;
  const data = JSON.stringify({ type: "orders_updated", at: new Date().toISOString(), ...payload });
  for (const res of set) {
    try {
      res.write(`event: kitchen\ndata: ${data}\n\n`);
    } catch {
      set.delete(res);
    }
  }
}

/** Njoftim SSE për cilësime venue (p.sh. ndërrim arke fiskale/termike). */
function notifyVenueSettingsUpdate(clientId, payload = {}) {
  const id = String(clientId);
  const set = subscribers.get(id);
  if (!set?.size) return;
  const data = JSON.stringify({ at: new Date().toISOString(), ...payload });
  for (const res of set) {
    try {
      res.write(`event: settings\ndata: ${data}\n\n`);
    } catch {
      set.delete(res);
    }
  }
}

module.exports = {
  subscribe,
  notifyKitchenUpdate,
  notifyVenueSettingsUpdate,
};
