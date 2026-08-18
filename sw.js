// Service worker: cache the app shell so it loads offline and installs as a PWA.
const CACHE = "entoa-v49";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/updater.js",
  "./js/agent.js",
  "./js/csv.js",
  "./js/xlsx.js",
  "./js/ics.js",
  "./js/calfeeds.js",
  "./js/backend.js",
  "./js/sync.js",
  "./js/icons.js",
  "./js/voice.js",
  "./js/cadence.js",
  "./js/demo.js",
  "./icons/icon.svg",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./js/app.js",
  "./js/router.js",
  "./js/store.js",
  "./js/utils.js",
  "./js/components.js",
  "./js/views/dashboard.js",
  "./js/views/leads.js",
  "./js/views/inventory.js",
  "./js/views/calculator.js",
  "./js/views/deliveries.js",
  "./js/views/tasks.js",
  "./js/views/settings.js",
  "./js/views/messages.js",
  "./js/views/calendar.js",
  "./js/views/goals.js",
  "./js/views/marketplace.js",
  "./js/views/import.js",
  "./js/views/dealer.js",
  "./js/views/prospecting.js",
  "./js/views/referrals.js",
  "./js/views/dealbuilder.js",
  "./js/views/tools.js",
  "./js/views/spiffs.js",
  "./js/views/specials.js",
  "./js/views/compare.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// App code (HTML/JS/CSS) is fetched network-first so updates land on the next
// reload — a cache-first strategy here would pin stale JavaScript in the PWA.
// Static assets (icons/images) stay cache-first for instant loads. Both fall
// back to cache when offline.
self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCode = request.mode === "navigate" || (sameOrigin && /\.(js|css|html)$/.test(url.pathname));

  if (isCode) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match("./index.html")))
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
    })
  );
});
