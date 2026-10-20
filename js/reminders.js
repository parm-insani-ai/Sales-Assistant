// Reminders: a to-do with a time that taps you on the shoulder.
//
// A reminder is a task with `remindAt` (local wall-clock, "YYYY-MM-DDTHH:MM",
// the same shape appointments use) and channel "reminder". At that moment
// it becomes a notification: on this phone while the app is open (here),
// through the cloud when it isn't (the function's sweep pushes it, quiet
// hours or not — the salesperson asked for it), and a line under "Right
// now" on Home until it's ticked off.

import * as store from "./store.js";
import { toast } from "./components.js";

const MIN = 60 * 1000;
// A reminder found more than this long after its time (the app was closed;
// the cloud may already have pushed it) is marked seen rather than fired
// again on open.
const FRESH = 30 * MIN;

export function wallClock(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ""));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

export function isReminder(t) { return !!(t && t.remindAt && t.channel === "reminder"); }

// The day a to-do belongs to (YYYY-MM-DD), timed or not; "" when undated.
export function taskDay(t) {
  if (!t) return "";
  const s = isReminder(t) ? String(t.remindAt) : String(t.due || "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}
const dayKeyOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// Past its day. A timed to-do past its minute today is "now", not late —
// it's under Right now already; one from an earlier day is late.
export function isLate(t, now = Date.now()) {
  if (!t || t.done) return false;
  const day = taskDay(t);
  return !!day && day < dayKeyOf(now);
}
// How many days past its day, at least 1.
export function daysLate(t, now = Date.now()) {
  const day = taskDay(t);
  if (!day) return 0;
  const end = new Date(day + "T23:59:59").getTime();
  return Math.max(1, Math.ceil((now - end) / 86400000));
}
// Every open to-do past its day (the plan's own steps aside), oldest first.
export function lateTasks(now = Date.now()) {
  return store.all("tasks").filter((t) => !t.done && !t.cadence && isLate(t, now)).sort((a, b) => taskDay(a).localeCompare(taskDay(b)));
}

// Open reminders, soonest first.
export function reminders() {
  return store.all("tasks").filter((t) => !t.done && isReminder(t)).sort((a, b) => String(a.remindAt).localeCompare(String(b.remindAt)));
}

// The ones whose time has come and that haven't been ticked off.
export function dueReminders(now = Date.now()) {
  return reminders().filter((t) => wallClock(t.remindAt) <= now);
}

export function reminderWhen(t, now = Date.now()) {
  const at = wallClock(t.remindAt);
  if (!isFinite(at)) return "";
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const today = new Date(now); const pad = (n) => String(n).padStart(2, "0");
  const key = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  const tomorrow = new Date(now + 86400000);
  const day = key(d) === key(today) ? "Today" : key(d) === key(tomorrow) ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day} ${time}`;
}

// Ask once, from a tap (setting a reminder), so the phone will show them.
// iPhone only offers this to an installed app; declining is fine — the
// reminder still lands as a toast in the app and a line on Home.
export async function askNotifyPermission() {
  try {
    if (!("Notification" in window) || Notification.permission !== "default") return Notification.permission;
    return await Notification.requestPermission();
  } catch { return "denied"; }
}

async function show(t) {
  toast(`⏰ ${t.title}`);
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) await reg.showNotification("Reminder", { body: t.title, tag: `rem:${t.id}`, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", data: { url: "./#/today" } });
    else new Notification("Reminder", { body: t.title, tag: `rem:${t.id}` });
  } catch { /* the toast already said it */ }
}

export function checkReminders(now = Date.now()) {
  let fired = 0;
  for (const t of dueReminders(now)) {
    if (t.notifiedAt) continue;
    store.update("tasks", t.id, { notifiedAt: new Date(now).toISOString() });
    if (now - wallClock(t.remindAt) > FRESH) continue;
    show(t);
    fired++;
  }
  return fired;
}

let timer = null;
export function startReminderWatch() {
  if (timer) return;
  const tick = () => { try { checkReminders(); } catch { /* next tick */ } };
  timer = setInterval(tick, 30 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  setTimeout(tick, 1500);
}
