"use strict";

/** SSE i unifikuar për stafin lokal (WiFi/LAN) — pa cloud. */

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

function emit(type, data = {}) {
  const eventType = String(type || "").trim();
  if (!eventType || !subscribers.size) return;
  const payload = JSON.stringify({
    type: eventType,
    data: data && typeof data === "object" && !Array.isArray(data) ? data : {},
    timestamp: new Date().toISOString(),
  });
  for (const res of subscribers) {
    try {
      res.write(`event: ${eventType}\ndata: ${payload}\n\n`);
    } catch {
      subscribers.delete(res);
    }
  }
}

module.exports = {
  subscribe,
  emit,
};
