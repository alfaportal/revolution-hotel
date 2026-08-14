/* Revolution POS — Service Worker (waiter + static assets) */
const CACHE_NAME = "ri-pos-offline-v16";

const PRECACHE_URLS = [
  "/logo-source.png",
  "/css/staff-brand.css",
  "/css/waiter.css",
  "/css/menu-pos.css",
  "/js/offlineQueue.js",
  "/js/menuCatalog.js",
  "/js/menu-pos.js",
  "/js/waiter-calculator.js",
];

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/css/")
    || pathname.startsWith("/js/")
    || pathname.startsWith("/icons/")
    || pathname === "/logo-source.png"
  );
}

function isWaiterDocument(pathname) {
  return /^\/waiter\/[^/]+/.test(pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Forco aktivizimin e SW të ri (pas deploy) pa pritur mbylljen e tab-ave
self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const clone = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url.pathname)) {
    if (url.pathname.startsWith("/js/")) {
      event.respondWith(fetch(request));
      return;
    }
    event.respondWith(networkFirst(request));
    return;
  }

  if (isWaiterDocument(url.pathname) && request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isWaiterDocument(url.pathname) || url.pathname.startsWith("/owner/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).catch(() => caches.match(request))),
    );
  }
});
