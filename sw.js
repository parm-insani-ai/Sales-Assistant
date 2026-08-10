// Service worker: cache the app shell so it loads offline and installs as a PWA.
const CACHE = "entoa-v16";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/csv.js",
  "./js/icons.js",
  "./js/voice.js",
  "./js/cadence.js",
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

// Network-first for navigations (get fresh app), cache-first for other assets,
// falling back to cache when offline.
self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request).catch(() => caches.match("./index.html"))
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
