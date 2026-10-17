/* Revolution HOTEL — service worker stafi (LAN). Network-first, cache fallback. */
const CACHE_NAME = "hotel-staff-pwa-v1";
const PRECACHE_URLS = [
  "/login",
  "/login.html",
  "/waiter.html",
  "/recepcion.html",
  "/manifest.json",
  "/css/style.css",
  "/js/pwa-staff-register.js",
];

function isCacheableGet(url) {
  const p = url.pathname.toLowerCase();
  if (p.endsWith(".html") || p === "/login" || p === "/waiter" || p === "/recepcion") return true;
  if (p.startsWith("/css/") || p.startsWith("/js/")) return true;
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((path) =>
            cache.add(new Request(path, { cache: "reload" })),
          ),
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
            return caches.match("/login.html").then((login) => login || caches.match("/login"));
          }
          return undefined;
        }),
      ),
  );
});
