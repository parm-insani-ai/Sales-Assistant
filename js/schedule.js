// When, exactly. Every move the app makes gets a date AND a clock time, set
// inside the salesperson's business hours (Settings → App), so the list
// reads "Thu 10:30 AM — call Ann again" rather than "Thursday".
//
// Times are local, written as "YYYY-MM-DDTHH:MM" (what a datetime field
// holds); toReadyAt() turns one into the UTC instant the queue and the
// server's sweep compare against.

import * as store from "./store.js";

const pad = (n) => String(n).padStart(2, "0");
export function localISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function dateOf(atLocal) { return String(atLocal || "").slice(0, 10); }
export function toReadyAt(atLocal) { const d = new Date(atLocal); return isNaN(d) ? null : d.toISOString(); }

function hours() {
  const s = store.getSettings();
  return {
    from: Number(s.hoursFrom ?? 9),
    to: Number(s.hoursTo ?? 18),
    days: Array.isArray(s.hoursDays) && s.hoursDays.length ? s.hoursDays : [1, 2, 3, 4, 5, 6],
  };
}
const workday = (d, h) => h.days.includes(d.getDay());
function nextWorkday(d, h) {
  const x = new Date(d);
  x.setDate(x.getDate() + 1);
  let guard = 0;
  while (!workday(x, h) && guard++ < 14) x.setDate(x.getDate() + 1);
  return x;
}

// A clock time on a given day; a day off rolls to the next working day.
export function slotOn(dateISO, hh, mm = 0) {
  const h = hours();
  let d = new Date(String(dateISO).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) d = new Date();
  let guard = 0;
  while (!workday(d, h) && guard++ < 14) d = nextWorkday(d, h);
  d.setHours(hh, mm, 0, 0);
  return localISO(d);
}

// Soon: a few minutes from now if that's inside hours, otherwise the next
// working morning, half an hour into the day.
export function slotSoon(minutes = 30, now = new Date()) {
  const h = hours();
  const d = new Date(now.getTime() + minutes * 60000);
  if (workday(d, h) && d.getHours() >= h.from && d.getHours() < h.to) return localISO(d);
  const x = workday(d, h) && d.getHours() < h.from ? new Date(d) : nextWorkday(d, h);
  x.setHours(h.from, 30, 0, 0);
  return localISO(x);
}

// A clock time n days from now (0 = today), never in the past: today's slot
// that has already gone becomes "soon".
export function slotDaysAhead(n, hh, mm = 0, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + n);
  const at = slotOn(localISO(d).slice(0, 10), hh, mm);
  return new Date(at) <= now ? slotSoon(30, now) : at;
}

// A clock time some days before a date (a visit), never in the past.
export function slotBefore(dateISO, daysBefore, hh, mm = 0, now = new Date()) {
  const d = new Date(String(dateISO).slice(0, 10) + "T00:00:00");
  d.setDate(d.getDate() - daysBefore);
  const at = slotOn(localISO(d).slice(0, 10), hh, mm);
  return new Date(at) <= now ? slotSoon(30, now) : at;
}

// The same clock time, on another date.
export function sameTimeOn(atLocal, dateISO) {
  const t = String(atLocal || "").slice(11, 16) || "10:00";
  return `${String(dateISO).slice(0, 10)}T${t}`;
}
