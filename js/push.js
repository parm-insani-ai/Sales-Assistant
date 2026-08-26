// Push subscription management — the switch that turns entoa from an
// assistant into an agent. Once enabled, the phone's push subscription is
// saved to the cloud (collection "push") where the Supabase function can
// reach it: the morning play sheet, "your link just got opened", and "a
// customer just booked" all arrive as real notifications, even with the
// app closed. iPhone requires the app to be installed to the Home Screen
// (iOS 16.4+); enabling must happen from a tap.

import * as store from "./store.js";
import * as backend from "./backend.js";
import * as sync from "./sync.js";

const agentUrl = () => (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// iOS only exposes push to installed (standalone) web apps.
export function needsInstall() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  return ios && !standalone;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function b64uToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Stable device id for the subscription record, so re-subscribing on the
// same phone updates one row instead of piling up new ones.
function deviceId() {
  let id = localStorage.getItem("entoa:device");
  if (!id) {
    id = "dev_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    localStorage.setItem("entoa:device", id);
  }
  return id;
}

// The function serves its VAPID public key so the app never hardcodes it.
async function fetchServerKey() {
  const res = await fetch(agentUrl() + "?push=cfg");
  if (!res.ok) throw new Error("The function doesn't have the push update yet — re-paste its code and deploy.");
  const j = await res.json();
  if (!j.publicKey) throw new Error("Add the VAPID keys to the function's secrets first (Settings → Notifications has the steps).");
  return j.publicKey;
}

// Ask permission, subscribe, and save the subscription to the cloud.
// Must be called from a user gesture. Throws plain-language messages.
export async function enablePush() {
  if (!pushSupported()) {
    throw new Error(needsInstall()
      ? "Add entoa to your Home Screen first (Share → Add to Home Screen) — iPhone only allows notifications for installed apps."
      : "This browser doesn't support push notifications.");
  }
  if (!backend.isSignedIn()) throw new Error("Sign in to Cloud sync first — notifications travel through it.");
  if (!agentUrl()) throw new Error("Set up the agent function first (Settings → Voice agent).");

  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications were declined — enable them for entoa in iOS Settings, then try again.");

  const key = await fetchServerKey();
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
  }
  const id = deviceId();
  const existing = store.get("push", id);
  const data = { sub: sub.toJSON(), ua: navigator.userAgent.slice(0, 120) };
  if (existing) store.update("push", id, data);
  else store.create("push", { id, ...data });
  sync.syncNow();
  return true;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) await sub.unsubscribe().catch(() => {});
  const id = deviceId();
  if (store.get("push", id)) store.remove("push", id);
  sync.syncNow();
}

export async function pushEnabled() {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  return !!(await currentSubscription());
}

// Ask the function to send a test notification to every registered device.
export async function sendTestPush() {
  const user = backend.currentUser();
  if (!user) throw new Error("Sign in to Cloud sync first.");
  const res = await fetch(agentUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ testpush: { u: user.id } }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `Test failed (${res.status})`);
  return j.sent || 0;
}
