/* PWA vetëm për pronarët — scope /owner/ */
const CACHE_NAME = "ri-pos-owner-v8";
const PRECACHE = [
  "/owner/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
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
  if (pathname === "/owner/panel" || pathname === "/owner/login") return false;
  if (pathname.startsWith("/js/")) return false;
  if (pathname.startsWith("/css/")) return false;
  return (
    pathname.startsWith("/owner/") ||
    pathname.startsWith("/icons/")
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
    !url.pathname.startsWith("/owner/")
    && !url.pathname.startsWith("/icons/")
    && !url.pathname.startsWith("/css/")
    && !url.pathname.startsWith("/js/")
  ) {
    return;
  }
  if (url.pathname.startsWith("/api/")) return;

  /* HTML / CSS / JS — gjithmonë nga rrjeti */
  if (
    url.pathname === "/owner/panel"
    || url.pathname === "/owner/login"
    || url.pathname.startsWith("/css/")
    || url.pathname.startsWith("/js/")
    || request.mode === "navigate"
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
