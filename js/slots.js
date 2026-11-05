// Two real times to offer.
//
// "Would ten minutes this week be worth your while" books less than "I've
// got tomorrow at 10:30 or Thursday at 4 — which is better?" The ask is two
// open times from this rep's own calendar inside the next two days (an
// appointment set further out shows worse), inside their working hours,
// clear of anything already booked — the first in the morning and the
// second in the late afternoon when the day allows, so the customer has a
// real choice and not two of the same.

import * as store from "./store.js";
import { localISO } from "./schedule.js";

const DAY = 86400000;
const LEAD_MIN = 90;          // not inside the next hour and a half
const WITHIN_DAYS = 2;        // two days out, at most
const CLEAR_MIN = 45;         // this far from anything already booked
const CANDIDATES = [[10, 30], [11, 30], [14, 0], [16, 0], [17, 0], [15, 0], [13, 0]];

function hours() {
  const s = store.getSettings();
  return { from: Number(s.hoursFrom ?? 9), to: Number(s.hoursTo ?? 18), days: Array.isArray(s.hoursDays) && s.hoursDays.length ? s.hoursDays : [1, 2, 3, 4, 5, 6] };
}
const taken = () => store.all("appointments").filter((a) => a.status !== "canceled" && !a.outcome).map((a) => new Date(a.when).getTime()).filter((t) => isFinite(t));

/** Two open times, soonest first: [{ at (local ISO), when (Date), label, half }]. */
export function openSlots(now = new Date(), { count = 2 } = {}) {
  const h = hours();
  const busy = taken();
  const earliest = now.getTime() + LEAD_MIN * 60000;
  const out = [];
  for (let d = 0; d <= WITHIN_DAYS && out.length < count; d++) {
    const day = new Date(now); day.setDate(day.getDate() + d); day.setHours(0, 0, 0, 0);
    if (!h.days.includes(day.getDay())) continue;
    const slots = CANDIDATES
      .map(([hh, mm]) => { const t = new Date(day); t.setHours(hh, mm, 0, 0); return t; })
      .filter((t) => t.getHours() >= h.from && t.getHours() < h.to && t.getTime() >= earliest)
      .filter((t) => !busy.some((b) => Math.abs(b - t.getTime()) < CLEAR_MIN * 60000))
      .sort((a, b) => a - b);
    for (const t of slots) {
      const half = t.getHours() < 13 ? "am" : "pm";
      // A second slot on the same day is the other half of it; otherwise
      // the next day's first.
      if (out.length && out[out.length - 1].day === d && out[out.length - 1].half === half) continue;
      out.push({ at: localISO(t), when: t, half, day: d, label: label(t, now) });
      if (out.length >= count) break;
    }
  }
  return out;
}

/** "today at 4:00", "tomorrow at 10:30", "Thursday at 4:00". */
export function label(t, now = new Date()) {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(t).setHours(0, 0, 0, 0) - d0.getTime()) / DAY);
  const day = days === 0 ? "today" : days === 1 ? "tomorrow" : new Date(t).toLocaleDateString("en-CA", { weekday: "long" });
  const time = new Date(t).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }).replace(/\s?[ap]\.?m\.?/i, (m) => m.trim().toLowerCase().replace(/\./g, ""));
  return `${day} at ${time}`;
}

/** The ask, with two times in it; or the plain ask when the calendar is full. */
export function askLine(slots) {
  if (!slots || slots.length < 2) return slots && slots.length === 1 ? `I've got ${slots[0].label} — would that work?` : `Would ten minutes this week to see what it looks like be worth your while — no pressure either way?`;
  return `I've got ${slots[0].label} or ${slots[1].label} — which is better for you?`;
}
