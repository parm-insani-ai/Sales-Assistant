// Service worker: cache the app shell so it loads offline and installs as a PWA.
const CACHE = "viniva-v221";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/updater.js",
  "./js/login.js",
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
  "./js/config.js",
  "./js/sync.js",
  "./js/icons.js",
  "./js/voice.js",
  "./js/cadence.js",
  "./js/context.js",
  "./js/touches.js",
  "./js/account.js",
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
  "./js/prospects.js",
  "./js/assess.js",
  "./js/consent.js",
  "./js/outcomes.js",
  "./js/sms.js",
  "./js/replies.js",
  "./js/views/inbox.js",
  "./js/viewport.js",
  "./js/nudges.js",
  "./js/asr.js",
  "./js/dictate.js",
  "./js/moves.js",
  "./js/savestate.js",
  "./js/pulltorefresh.js",
];

// ---- Push: the agent's heartbeat. The Supabase function sends
// {title, body, url?, tag?}; tapping the notification opens (or focuses)
// the app at the given hash.
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || "viniva", {
    body: data.body || "",
    tag: data.tag || "viniva",
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

// Every file of this build, fetched past the browser's HTTP cache. GitHub
// Pages lets a file be reused for ten minutes, so a plain addAll right after a
// deploy could pair a new leads.js with a ten-minute-old store.js — the app
// then calls a function that isn't there and a tap does nothing. cache:
// "reload" makes the set that goes into this version's cache one build.
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// App code (HTML/JS/CSS) is served from this version's cache: one build, all
// of it, instantly, online or off. Updates arrive as a whole — the deploy
// stamps sw.js with a new name, the new worker fills a new cache from the
// network at install, and the page reloads once it takes over (updater.js).
// Code was fetched network-first before, on the theory that cache-first
// pins stale JavaScript; with the cache named per build that is no longer
// true, and network-first had a worse failure: two modules from two builds
// running together in one page. Anything not in the list (a file added
// without listing it) still goes network-first. Static assets (icons/images)
// are cache-first for instant loads.
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
      caches.open(CACHE).then((c) => c.match(request, { ignoreSearch: true })).then((hit) => {
        if (hit) return hit;
        return fetch(request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => {
            // Falling back to the app shell is right for a navigation — that's
            // SPA routing. It is very wrong for a script or stylesheet: the
            // browser gets HTML where it expected JavaScript, the module throws
            // a syntax error, and the whole app fails to start with no clue
            // why. Fail the request honestly instead — the browser reports a
            // missing script, and a reload recovers.
            if (request.mode === "navigate") return caches.match("./index.html");
            return new Response("", { status: 504, statusText: "offline and not cached" });
          });
      })
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
