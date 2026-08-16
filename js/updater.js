// Auto-update: keep the installed PWA on the latest deployed version without a
// manual reinstall. Every deploy stamps sw.js with the commit hash (see the
// GitHub Actions workflow), so the browser sees a genuinely new service worker;
// this checks for it on launch/focus and reloads once the new version takes over.

export function initAutoUpdate() {
  if (!("serviceWorker" in navigator)) return;

  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    // Skip the reload on the very first install (nothing to replace yet).
    if (!hadController) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    let reg;
    try {
      // updateViaCache:"none" → the sw.js script itself is never served from the
      // HTTP cache, so a new deploy is always noticed.
      reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
    } catch { return; }

    const check = () => reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    setInterval(check, 30 * 60 * 1000); // hourly-ish safety net
    check();
  });
}

// Force an update check now. Resolves true if a new worker started installing
// (the page will auto-reload once it takes over), false if already current.
export async function checkForUpdate() {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  await reg.update().catch(() => {});
  return !!(reg.installing || reg.waiting);
}

// The deployed build id (commit hash + time), written by the deploy workflow.
// Fetched bypassing all caches so it always reflects what's actually live.
export async function getVersion() {
  try {
    const r = await fetch(`./version.json?_=${Date.now()}`, { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch {}
  return null;
}
