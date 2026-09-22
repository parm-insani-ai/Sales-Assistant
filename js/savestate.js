// The word in the top bar that says where your last action is.
//
// Nothing in viniva is saved by a button. Every action — yours or the
// agent's — lands on this phone the moment it happens and goes to the cloud
// within a second. This is the visible proof: Saving… → Saved → Syncing… →
// Synced. If either step fails, the word turns red rather than staying
// quiet, because a change you believe is saved and isn't is the worst
// thing an app like this can do to you.

import * as store from "./store.js";
import * as backend from "./backend.js";

let el = null, quiet = null;

function show(text, kind = "") {
  if (!el) return;
  el.textContent = text;
  el.className = `save-state${kind ? ` save-state-${kind}` : ""}`;
  el.hidden = false;
  clearTimeout(quiet);
  // Good news fades to a small mark after a moment; trouble stays put.
  if (kind === "ok") quiet = setTimeout(() => { el.className = "save-state save-state-quiet"; }, 2500);
}

export function initSaveState() {
  el = document.getElementById("save-state");
  if (!el) return;
  const cloud = () => backend.isConfigured() && backend.isSignedIn();
  show(cloud() ? "Synced" : "Saved", "ok");

  // Every write: on disk before the word changes to Saved.
  let pending = 0;
  store.subscribe(() => {
    pending++;
    show("Saving…");
    store.flush().then(() => {
      if (--pending > 0) return;
      const err = store.saveError();
      if (err) show("Not saved — storage error", "bad");
      else show(cloud() ? "Saved · syncing…" : "Saved", cloud() ? "" : "ok");
    });
  });

  // Every sync: the cloud's answer.
  window.addEventListener("viniva-sync", (e) => {
    const d = e.detail || {};
    if (d.status === "syncing") { if (!pending) show("Syncing…"); }
    else if (d.status === "synced") { if (!pending) show("Synced", "ok"); }
    else if (d.status === "offline") show("Offline — saved on this phone", "warn");
    else if (d.status === "error") show("Saved here, not synced", "warn");
  });
  window.addEventListener("online", () => { if (cloud()) show("Syncing…"); });
}
