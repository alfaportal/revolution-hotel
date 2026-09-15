/* PWA vetëm për pronarët — scope /owner/ */
const CACHE_NAME = "ri-pos-owner-v8";
const PRECACHE = [
  "/hotel/owner/manifest.json",
  "/hotel/icons/icon-192.png",
  "/hotel/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

function shouldCache(pathname) {
  /* Mos cache HTML/JS të panelit — laptiopi mbante version të vjetër. */
  if (pathname === "/hotel/owner/panel" || pathname === "/hotel/owner/login") return false;
  if (pathname.startsWith("/hotel/js/")) return false;
  if (pathname.startsWith("/hotel/css/")) return false;
  return (
    pathname.startsWith("/hotel/owner/") ||
    pathname.startsWith("/hotel/icons/")
  );
}

function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response.ok && shouldCache(new URL(request.url).pathname)) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }
      return response;
    })
    .catch(() => caches.match(request));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    !url.pathname.startsWith("/hotel/owner/")
    && !url.pathname.startsWith("/hotel/icons/")
    && !url.pathname.startsWith("/hotel/css/")
    && !url.pathname.startsWith("/hotel/js/")
  ) {
    return;
  }
  if (url.pathname.startsWith("/hotel/api/")) return;

  /* HTML / CSS / JS — gjithmonë nga rrjeti */
  if (
    url.pathname === "/hotel/owner/panel"
    || url.pathname === "/hotel/owner/login"
    || url.pathname.startsWith("/hotel/css/")
    || url.pathname.startsWith("/hotel/js/")
    || request.mode === "navigate"
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
