/** SSE subscribers për KDS lokal (kuzhinë / banak) — pa cloud. */

const subscribers = new Set();

function subscribe(res) {
  subscribers.add(res);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") {
    try {
      res.flushHeaders();
    } catch {
      /* ignore */
    }
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
    subscribers.delete(res);
  });
}

function notifyKitchenUpdate(payload = {}) {
  if (!subscribers.size) return;
  const data = JSON.stringify({
    type: "orders_updated",
    at: new Date().toISOString(),
    ...payload,
  });
  for (const res of subscribers) {
    try {
      res.write(`event: kitchen\ndata: ${data}\n\n`);
    } catch {
      subscribers.delete(res);
    }
  }
}

module.exports = {
  subscribe,
  notifyKitchenUpdate,
};
