// Service worker: cache the app shell so it loads offline and installs as a PWA.
const CACHE = "entoa-v146";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/updater.js",
  "./js/agent.js",
  "./js/csv.js",
  "./js/xlsx.js",
  "./js/xlsxwrite.js",
  "./js/ics.js",
  "./js/calfeeds.js",
  "./js/email.js",
  "./js/connections.js",
  "./js/msmail.js",
  "./js/occasions.js",
  "./js/specs.js",
  "./js/shortlink.js",
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
  "./js/views/campaign.js",
  "./js/views/spiffs.js",
  "./js/views/specials.js",
  "./js/views/compare.js",
  "./js/views/comms.js",
  "./js/views/soldlog.js",
  "./js/views/coach.js",
  "./js/views/pay.js",
  "./js/paystub.js",
  "./js/push.js",
  "./js/plays.js",
  "./js/sms.js",
  "./js/replies.js",
  "./js/views/inbox.js",
];

// ---- Push: the agent's heartbeat. The Supabase function sends
// {title, body, url?, tag?}; tapping the notification opens (or focuses)
// the app at the given hash.
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || "entoa", {
    body: data.body || "",
    tag: data.tag || "entoa",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: { url: data.url || "./#/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./#/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});

// Lets the app ask which build is actually being served. The deploy workflow
// rewrites CACHE to the commit hash, so this is the running code's identity —
// as opposed to version.json, which is fetched past every cache and describes
// what's deployed rather than what's running.
self.addEventListener("message", (e) => {
  if (e.data === "version" && e.ports && e.ports[0]) e.ports[0].postMessage(CACHE);
});

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
  // Never intercept cross-origin APIs (Graph mail, calendar feeds, Supabase) —
  // caching authorized responses would be wrong, and a failed passthrough here
  // would mask the real network error.
  if (!sameOrigin && request.mode !== "navigate") return;
  const isCode = request.mode === "navigate" || (sameOrigin && /\.(js|css|html)$/.test(url.pathname));

  if (isCode) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(request).then((c) => {
            if (c) return c;
            // Falling back to the app shell is right for a navigation — that's
            // SPA routing. It is very wrong for a script or stylesheet: the
            // browser gets HTML where it expected JavaScript, the module throws
            // a syntax error, and the whole app fails to start with no clue
            // why. That bites hardest right after a release adds a module an
            // older cache has never seen. Fail the request honestly instead —
            // the browser reports a missing script, and a reload recovers.
            if (request.mode === "navigate") return caches.match("./index.html");
            return new Response("", { status: 504, statusText: "offline and not cached" });
          })
        )
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
