/* Revolution HOTEL — PWA stafi (kamarier / recepsion / shërbimi). Network-first + finder offline. */
const CACHE_NAME = "hotel-staff-role-pwa-v4";
const PRECACHE_URLS = [
  "/login.html",
  "/staff-pos-finder.html",
  "/waiter.html",
  "/kasa-recepcion.html",
  "/sherbimi.html",
  "/recepcion.html",
  "/manifest-kamarier.json",
  "/manifest-recepsion.json",
  "/manifest-sherbimi.json",
  "/icon-192.png",
  "/css/style.css",
  "/css/login-modern.css",
  "/css/login-staff-wifi.css",
  "/css/waiter-modern.css",
  "/css/pos-truffle.css",
  "/js/pwa-staff-register.js",
  "/js/staff-auto-connect.js",
  "/kitchen.html",
  "/bar.html",
];

function isCacheableGet(url) {
  const p = url.pathname.toLowerCase();
  if (/^\/[a-z0-9-]+\/[a-z0-9-]+\/(kamarier|recepsion|sherbimi|kuzhina|banaku)(?:\/\d{3})?\/?$/.test(p)) return true;
  if (p.endsWith(".html") || p.startsWith("/manifest-") || p === "/icon-192.png") return true;
  if (p.startsWith("/css/") || p.startsWith("/js/")) return true;
  return false;
}

function isStaffApiPath(pathname) {
  const p = String(pathname || "");
  return p.startsWith("/api/") || p.startsWith("/hotel/api/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((path) => cache.add(new Request(path, { cache: "reload" }))),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function openFinderPage() {
  const cache = await caches.open(CACHE_NAME);
  const finder = await cache.match("/staff-pos-finder.html");
  if (finder) return finder;
  const login = await cache.match("/login.html");
  if (login) return login;
  return undefined;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (isStaffApiPath(url.pathname)) {
    event.respondWith(
      fetch(req).catch(() =>
        Response.json(
          { ok: false, gabim: "pos_offline", staff_auto_connect: true },
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && isCacheableGet(url)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          const finder = await openFinderPage();
          if (finder) return finder;
        }
        return undefined;
      }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "STAFF_POS_DISCOVER") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "STAFF_POS_RUN_DISCOVER" });
        }
      }),
    );
  }
});
