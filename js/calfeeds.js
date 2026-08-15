// External calendar feeds. Each feed is a subscription (.ics) URL from Apple,
// Outlook or Google. Browsers can't fetch those cross-origin, so requests go
// through a small proxy (a Supabase Edge Function — see supabase/functions).
// Parsed events are cached in localStorage so the calendar stays instant and
// works offline; this module exposes them for the grid + dashboard to merge in.

import * as store from "./store.js";
import { parseICS } from "./ics.js";

const CACHE_KEY = "entoa:calfeeds:cache"; // { [feedId]: { at, events:[...] } }

export function getFeeds() {
  return (store.getSettings().calendarFeeds || []).filter((f) => f && f.url);
}
export function getProxyUrl() {
  return (store.getSettings().calendarProxyUrl || "").trim().replace(/\/+$/, "");
}
export function feedsConfigured() {
  return !!getProxyUrl() && getFeeds().length > 0;
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}
function saveCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
}

// Synchronous: normalized external events from cache, shaped like the app's own
// events so the calendar/dashboard can render them the same way.
export function getExternalEvents() {
  const cache = loadCache();
  const out = [];
  getFeeds().filter((f) => f.enabled !== false).forEach((f) => {
    const c = cache[f.id];
    if (!c || !c.events) return;
    c.events.forEach((e, i) => out.push({
      id: `ext_${f.id}_${e.uid || i}_${e.whenISO}`,
      title: e.title || "(busy)",
      when: e.whenISO,
      end: e.endISO || null,
      allDay: !!e.allDay,
      location: e.location || "",
      external: true,
      source: f.name || "Calendar",
    }));
  });
  return out;
}

export function lastFeedSync() {
  const times = Object.values(loadCache()).map((x) => x && x.at).filter(Boolean).sort();
  return times.length ? times[times.length - 1] : null;
}
export function externalEventCount() {
  return Object.values(loadCache()).reduce((a, x) => a + ((x && x.events && x.events.length) || 0), 0);
}

// Fetch + parse every enabled feed through the proxy. Returns { errors, at }.
export async function refreshFeeds() {
  const proxy = getProxyUrl();
  if (!proxy) throw new Error("Add your calendar proxy URL first");
  const feeds = getFeeds().filter((f) => f.enabled !== false);
  if (!feeds.length) throw new Error("Add at least one calendar feed");

  const cache = loadCache();
  const errors = [];
  const now = new Date();
  const rangeStart = new Date(now); rangeStart.setMonth(rangeStart.getMonth() - 1);
  const rangeEnd = new Date(now); rangeEnd.setMonth(rangeEnd.getMonth() + 12);

  for (const f of feeds) {
    try {
      const res = await fetch(`${proxy}?url=${encodeURIComponent(f.url)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${f.name || "Feed"}: HTTP ${res.status}`);
      const text = await res.text();
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error(`${f.name || "Feed"}: not a calendar feed`);
      const events = parseICS(text, { rangeStart, rangeEnd });
      cache[f.id] = { at: now.toISOString(), events };
    } catch (err) {
      errors.push(err && err.message ? err.message : String(err));
    }
  }
  // Drop cache entries for feeds that no longer exist.
  const ids = new Set(feeds.map((f) => f.id));
  Object.keys(cache).forEach((k) => { if (!ids.has(k)) delete cache[k]; });

  saveCache(cache);
  window.dispatchEvent(new CustomEvent("entoa-calfeeds", { detail: { at: now.toISOString(), errors } }));
  return { errors, at: now.toISOString() };
}

// Refresh in the background if the cache is stale (older than `maxAgeMin`).
export function refreshIfStale(maxAgeMin = 30) {
  if (!feedsConfigured()) return;
  const last = lastFeedSync();
  const stale = !last || (Date.now() - new Date(last).getTime()) > maxAgeMin * 60000;
  if (stale && navigator.onLine !== false) refreshFeeds().catch(() => {});
}
