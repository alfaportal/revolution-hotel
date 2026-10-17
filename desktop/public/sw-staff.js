/* Revolution HOTEL — PWA stafi (kamarier / recepsion / shërbimi). Network-first. */
const CACHE_NAME = "hotel-staff-role-pwa-v3";
const PRECACHE_URLS = [
  "/login.html",
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

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && isCacheableGet(url)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          if (req.mode === "navigate") {
            return caches.match("/login.html");
          }
          return undefined;
        }),
      ),
  );
});
