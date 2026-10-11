"use strict";

/**
 * WebSocket lokal për kamarierët — upgrade në të njëjtin HTTP server.
 * Pa paketën `ws` → noop (mbetet polling).
 */
const { URL } = require("url");

let WebSocketServer = null;
try {
  WebSocketServer = require("ws").WebSocketServer;
} catch {
  /* dev / paketim pa ws */
}

/** @type {{ broadcast: (type: string, extra?: object) => void } | null} */
let activeHub = null;

function broadcastWaiterRealtime(type, extra) {
  try {
    activeHub?.broadcast?.(type, extra);
  } catch {
    /* ignore */
  }
}

function attachWaiterWebSocket(httpServer, { getSession, pathname = "/api/waiter/ws" } = {}) {
  const noop = {
    broadcast: () => {},
    clientCount: () => 0,
  };
  if (!WebSocketServer || !httpServer || typeof getSession !== "function") {
    console.warn("[waiter-ws] WebSocket i çaktivizuar (mungon ws ose serveri).");
    activeHub = noop;
    return noop;
  }

  const clients = new Set();
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    let pathnameOk = false;
    try {
      const u = new URL(req.url || "", "http://127.0.0.1");
      pathnameOk = u.pathname === pathname;
      if (!pathnameOk) return;

      const token = String(u.searchParams.get("token") || "").trim();
      const session = getSession(token);
      if (!session || session.role !== "kamarier") {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        ws._waiterSession = session;
        clients.add(ws);
        ws.on("close", () => clients.delete(ws));
        ws.on("error", () => clients.delete(ws));
        try {
          ws.send(JSON.stringify({ type: "hello", t: Date.now() }));
        } catch {
          clients.delete(ws);
        }
      });
    } catch {
      if (pathnameOk) socket.destroy();
    }
  });

  function broadcast(type, extra) {
    const payload =
      extra && typeof extra === "object" && !Array.isArray(extra)
        ? { type, t: Date.now(), ...extra }
        : { type, t: Date.now() };
    const msg = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState !== 1) {
        clients.delete(ws);
        continue;
      }
      try {
        ws.send(msg);
      } catch {
        clients.delete(ws);
      }
    }
  }

  const hub = {
    broadcast,
    clientCount: () => clients.size,
  };
  activeHub = hub;
  console.log(`[waiter-ws] aktiv — ${pathname}`);
  return hub;
}

module.exports = {
  attachWaiterWebSocket,
  broadcastWaiterRealtime,
};
