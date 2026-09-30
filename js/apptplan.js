// What every appointment comes with the moment it's booked — preset, so
// nothing has to be remembered:
//
//   for the customer  a confirmation text (held for your OK on Log, like
//                     every text the app writes), timed by the appointment:
//                     a morning appointment gets it the afternoon before
//                     (4pm), an afternoon or evening one gets it that
//                     morning (9am); booked too late for that, it's ready
//                     right away;
//   for you           a reminder the morning of (8:30) and one an hour
//                     before, as notifications.
//
// They're tasks on the appointment (apptId), so confirming the appointment
// clears the confirmation text, an outcome clears the lot, and deleting
// or moving the appointment takes them with it. The wording lives in
// Settings (apptConfirmText / apptReminderText) with the defaults below;
// {first} {me} {dealership} {type} {day} {time} {vehicle} fill in.

import * as store from "./store.js";
import { apptType } from "./store.js";
import { localISO, toReadyAt } from "./schedule.js";

export const DEFAULTS = {
  apptConfirmText: "Hi {first}, it's {me} at {dealership} — just confirming your {type} {day} at {time}{vehicleLine}. Reply YES to confirm, or let me know if another time works better.",
  apptRemindMin: 60,
  apptMorning: "08:30",     // your morning-of reminder
  apptConfirmAm: "16:00",   // a morning appointment: the text goes the afternoon before
  apptConfirmPm: "09:00",   // an afternoon/evening one: the morning of
  apptNoon: 12,             // where morning ends
};
const hhmm = (v, d) => (/^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : d);
export function apptPresets() {
  const s = store.getSettings();
  return {
    confirm: String(s.apptConfirmText || DEFAULTS.apptConfirmText),
    remindMin: Number(s.apptRemindMin) > 0 ? Number(s.apptRemindMin) : DEFAULTS.apptRemindMin,
    morning: hhmm(s.apptMorning, DEFAULTS.apptMorning),
    confirmAm: hhmm(s.apptConfirmAm, DEFAULTS.apptConfirmAm),
    confirmPm: hhmm(s.apptConfirmPm, DEFAULTS.apptConfirmPm),
    noon: Number(s.apptNoon) > 0 ? Number(s.apptNoon) : DEFAULTS.apptNoon,
  };
}

// When the confirmation text goes: the afternoon before a morning
// appointment, the morning of an afternoon one — or now, if that moment
// has already passed by the time it's booked.
export function confirmSlot(at, p = apptPresets(), now = new Date()) {
  const d = new Date(at);
  const [h, m] = (d.getHours() < p.noon ? p.confirmAm : p.confirmPm).split(":").map(Number);
  if (d.getHours() < p.noon) d.setDate(d.getDate() - 1);
  d.setHours(h, m, 0, 0);
  return d <= now ? new Date(now) : d;
}

const pad = (n) => String(n).padStart(2, "0");
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
export function wall(atLocal) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(atLocal || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "today", "tomorrow", "Thursday", "Thursday, Oct 9" — as you'd say it.
export function dayWord(d, now = new Date()) {
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff > 1 && diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}
const timeWord = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function fields(a, now = new Date()) {
  const s = store.getSettings();
  const d = wall(a.when) || new Date(a.when);
  const t = apptType(a.type);
  const vehicle = String(a.vehicle || "").trim();
  return {
    first: first(a.customerName) || "there", name: a.customerName || "", me: first(s.salesperson) || "me", dealership: s.dealership || "the dealership",
    type: String(t.label || "appointment").toLowerCase(), day: isNaN(d) ? "" : dayWord(d, now), time: isNaN(d) ? "" : timeWord(d),
    vehicle, vehicleLine: vehicle ? ` — I'll have the ${vehicle} ready` : "",
  };
}
export function fill(tpl, f) {
  return String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (k in f ? f[k] : m)).replace(/\ba (appointment)\b/g, "an $1").replace(/\s+([,.!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

// The appointment's preset tasks (any state).
export function planTasks(apptId) {
  return store.all("tasks").filter((t) => t.apptId === apptId && t.apptPlan);
}

/**
 * Preset everything for one appointment. Idempotent: nothing is added twice.
 * Returns how many were created.
 */
export function planAppointment(apptId, { now = new Date() } = {}) {
  const a = store.get("appointments", apptId);
  if (!a || a.status === "canceled" || a.outcome) return 0;
  if (planTasks(apptId).length) return 0;
  const at = wall(a.when);
  if (!at || at <= now) return 0;
  const f = fields(a, now);
  const p = apptPresets();
  const msUntil = at - now;
  const date = dayKey(at);
  const label = `${f.name || "customer"} — ${f.type} ${f.day} ${f.time}`;
  let n = 0;
  store.bulk(() => {
    const mk = (rec) => { store.create("tasks", { done: false, priority: "high", leadId: a.leadId || null, apptId, ...rec }); n++; };
    // The text to the customer needs someone to text. Its words are as of
    // the moment it goes ("tomorrow", "today"), not the moment it's booked.
    if (a.leadId) {
      const sendAt = confirmSlot(at, p, now);
      const fs = fields(a, sendAt);
      const when = localISO(sendAt);
      mk({ apptPlan: "confirm", channel: "text", title: `Text ${fs.first} — confirm the ${fs.type} ${fs.day} at ${fs.time}`, due: when.slice(0, 10), at: when, readyAt: toReadyAt(when), body: fill(p.confirm, fs) });
    }
    // Reminders for you: the morning of, and an hour before.
    if (date > dayKey(now)) {
      mk({ apptPlan: "remind-morning", channel: "reminder", remindAt: `${date}T${p.morning}`, due: date, notifiedAt: null, title: `${label}${f.vehicle ? ` · ${f.vehicle}` : ""}` });
    }
    if (msUntil > p.remindMin * 60e3) {
      const before = new Date(at.getTime() - p.remindMin * 60e3);
      mk({ apptPlan: "remind-hour", channel: "reminder", remindAt: localISO(before), due: dayKey(before), notifiedAt: null, title: `${f.name || "Customer"} in ${p.remindMin === 60 ? "an hour" : `${p.remindMin} min`} (${f.time})${f.vehicle ? ` — have the ${f.vehicle} out front` : ""}` });
    }
  });
  return n;
}

// The appointment moved: the open presets are redone for the new time.
export function replanAppointment(apptId) {
  store.bulk(() => planTasks(apptId).filter((t) => !t.done).forEach((t) => store.remove("tasks", t.id)));
  return planAppointment(apptId);
}
// The appointment is gone: so are its open presets.
export function unplanAppointment(apptId) {
  let n = 0;
  store.bulk(() => planTasks(apptId).filter((t) => !t.done).forEach((t) => { store.remove("tasks", t.id); n++; }));
  return n;
}
// Confirmed: the confirmation text has done its job.
export function onAppointmentConfirmed(apptId) {
  planTasks(apptId).filter((t) => !t.done && t.apptPlan === "confirm").forEach((t) => store.update("tasks", t.id, { done: true, doneAt: new Date().toISOString() }));
}
// Showed, no-show or sold: nothing left to remind anyone about.
export function onAppointmentOutcome(apptId) {
  planTasks(apptId).filter((t) => !t.done).forEach((t) => store.update("tasks", t.id, { done: true, doneAt: new Date().toISOString() }));
}
export function markPlanTaskDone(taskId) {
  const t = store.get("tasks", taskId);
  if (t && !t.done) store.update("tasks", taskId, { done: true, doneAt: new Date().toISOString() });
}

// Every upcoming appointment gets its presets — the ones booked before
// this existed, and the ones that arrived by sync (a self-serve booking).
export function ensurePlans(now = new Date()) {
  let n = 0;
  store.all("appointments").forEach((a) => {
    if (a.status !== "scheduled" || a.outcome) return;
    const at = wall(a.when);
    if (!at || at <= now) return;
    if (!planTasks(a.id).length) n += planAppointment(a.id, { now });
  });
  return n;
}

// The presets as a status line each, for the appointment's page and list.
export function planStatus(apptId, now = new Date()) {
  const ROLE = { confirm: "Confirmation text", "remind-text": "Reminder text", "remind-morning": "Your reminder, morning of", "remind-hour": "Your reminder, an hour before" };
  const ORDER = ["confirm", "remind-text", "remind-morning", "remind-hour"];
  return planTasks(apptId).sort((x, y) => ORDER.indexOf(x.apptPlan) - ORDER.indexOf(y.apptPlan)).map((t) => {
    const when = wall(t.remindAt || t.at);
    const ready = !when || when <= now;
    return {
      task: t, role: t.apptPlan, label: ROLE[t.apptPlan] || t.title, text: t.channel === "text",
      done: !!t.done, ready,
      when: when ? `${dayWord(when, now)} ${timeWord(when)}` : "",
      state: t.done ? (t.channel === "text" ? "sent" : "done") : ready ? (t.channel === "text" ? "ready to send" : "due") : "scheduled",
    };
  });
}
