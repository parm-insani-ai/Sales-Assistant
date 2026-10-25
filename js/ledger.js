// The ledger: every commitment the app knows about, as one kind of thing.
//
// A to-do, a reminder, a follow-up date on a customer, a stock watch whose
// unit has landed, a customer waiting on a reply, an appointment hours away
// that nobody has confirmed — six places, six rules for "done", and the one
// who forgets is the one the system went quiet on. Here they are one list
// with one due time each, and one rule: nothing stays overdue quietly. An
// item past its time is reminded again two hours on, again in the next
// digest (the function's midday and morning pushes), and after the third
// time the app stops reminding and asks, on Home: tomorrow, next week, or
// drop it. The reminders themselves go out from the function (pushes) and
// show under Right now (nudges.js); the count of how many times is kept in
// `pokes`, synced, so the phone and the function agree.

import * as store from "./store.js";
import { isReminder, wallClock } from "./reminders.js";
import { describeWant } from "./watch.js";

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
export const REPOKE_MS = 2 * HOUR;       // reminded again this long after
export const ASK_AFTER = 3;              // reminders before the app asks
export const REPLY_GRACE_MIN = 12;       // a reply older than this is waiting
const CONFIRM_WINDOW_MIN = 180;          // unconfirmed appointment this close

const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = (v) => { const s = String(v || ""); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const d = new Date(s); return isNaN(d) ? "" : dayKey(d); };
const localMs = (day, hm) => { const d = new Date(`${day}T${hm}:00`); return isNaN(d) ? NaN : d.getTime(); };
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "them";

/**
 * Every open commitment, soonest due first.
 *   { key, kind, title, sub, leadId, due (ms), route }
 * kind: task | reminder | followup | watch | reply | confirm
 */
export function commitments(now = Date.now()) {
  const out = [];
  const today = dayKey(new Date(now));
  const leads = store.all("leads");
  const leadById = (id) => leads.find((l) => l.id === id) || null;

  // To-dos and reminders. The follow-up plan's own steps are the queue's
  // (they have their one-tap action there) and are left out.
  for (const t of store.all("tasks")) {
    // The follow-up plan's steps and the appointment plan's are the queue's
    // and the appointment's; the appointment itself is below.
    if (t.done || t.cadence || t.apptId) continue;
    let due = Infinity;
    if (isReminder(t)) due = wallClock(t.remindAt);
    else if (t.due) due = localMs(dayOf(t.due), "23:59");
    if (!isFinite(due)) continue;
    const lead = t.leadId ? leadById(t.leadId) : null;
    out.push({ key: `task:${t.id}`, kind: isReminder(t) ? "reminder" : "task", title: String(t.title || "To-do"), sub: lead ? lead.name : "", leadId: t.leadId || null, due, route: "/log", id: t.id });
  }
  // A follow-up date on a customer: due at nine that morning, open until
  // they've been reached that day or the date is moved.
  for (const l of leads) {
    const day = dayOf(l.followUp);
    if (!day || day > today) continue;
    if (l.lastContacted && dayOf(l.lastContacted) >= day) continue;
    if (["sold", "lost"].includes(l.stage)) continue;
    out.push({ key: `fu:${l.id}:${day}`, kind: "followup", title: `Follow up with ${first(l.name)}`, sub: `${l.name}${l.vehicleInterest ? " · " + l.vehicleInterest : ""}`, leadId: l.id, due: localMs(day, "09:00"), route: l.phone ? `/inbox/${l.id}` : `/leads/${l.id}`, id: l.id });
  }
  // A vehicle a customer was waiting for has landed.
  for (const w of store.all("watches")) {
    if (w.done || !w.matchedVehicleId) continue;
    const lead = leadById(w.leadId);
    if (!lead) continue;
    out.push({ key: `watch:${w.id}`, kind: "watch", title: `Tell ${first(lead.name)} their ${describeWant(w.want)} is in`, sub: w.matched ? w.matched.label : "", leadId: lead.id, due: new Date(w.matchedAt).getTime() || now, route: lead.phone ? `/inbox/${lead.id}` : `/leads/${lead.id}`, id: w.id });
  }
  // A customer waiting on a reply.
  const oldest = new Map();
  (store.unreadTexts ? store.unreadTexts() : []).forEach((t) => {
    if (!t.leadId) return;
    const at = new Date(t.at || t.createdAt).getTime();
    const cur = oldest.get(t.leadId);
    if (!cur || at < cur) oldest.set(t.leadId, at);
  });
  for (const [leadId, at] of oldest) {
    if (now - at < REPLY_GRACE_MIN * MIN) continue;
    const lead = leadById(leadId);
    out.push({ key: `reply:${leadId}`, kind: "reply", title: `Reply to ${first(lead ? lead.name : "")}`, sub: lead ? lead.name : "", leadId, due: at + REPLY_GRACE_MIN * MIN, route: `/inbox/${leadId}`, id: leadId });
  }
  // An appointment close enough to confirm.
  for (const a of store.all("appointments")) {
    if (a.status !== "scheduled" || a.confirmed || a.outcome || !a.when) continue;
    const at = wallClock(a.when);
    if (!isFinite(at)) continue;
    const mins = (at - now) / MIN;
    if (mins <= 0 || mins > CONFIRM_WINDOW_MIN) continue;
    out.push({ key: `confirm:${a.id}`, kind: "confirm", title: `Confirm ${first(a.customerName)} for ${String(a.when).slice(11, 16)}`, sub: a.customerName || "", leadId: a.leadId || null, due: at - CONFIRM_WINDOW_MIN * MIN, route: a.leadId ? `/inbox/${a.leadId}` : "/calendar", id: a.id });
  }
  return out.sort((a, b) => a.due - b.due);
}

// ---- Pokes: how many times each commitment has been reminded ----
const pokeId = (key) => `poke:${key}`;
export function pokeFor(key) { return store.get("pokes", pokeId(key)) || null; }
function upsertPoke(key, patch) {
  const cur = pokeFor(key);
  if (cur) store.update("pokes", cur.id, patch);
  else store.create("pokes", { id: pokeId(key), key, count: 0, lastAt: null, firstAt: new Date().toISOString(), snoozedUntil: null, ...patch });
}
// Seen overdue on the phone: the moment it fell due counts as the first
// reminder (the function pushed it, or Right now showed it). Re-pokes are
// the function's, when it pushes again; the phone only reads them.
export function noteOverdue(now = Date.now()) {
  const nowISO = new Date(now).toISOString();
  let n = 0;
  for (const c of commitments(now)) {
    if (c.due > now) continue;
    const p = pokeFor(c.key);
    if (!p) { upsertPoke(c.key, { count: 1, lastAt: new Date(c.due).toISOString(), firstAt: nowISO }); n++; }
  }
  return n;
}
// Overdue, reminded enough times (or a full day without an answer), and not
// snoozed: the ones Home stops reminding about and asks about instead.
export function stale(now = Date.now()) {
  return commitments(now).filter((c) => {
    if (c.due > now) return false;
    const p = pokeFor(c.key);
    if (p && p.snoozedUntil && new Date(p.snoozedUntil).getTime() > now) return false;
    const count = p ? Number(p.count) || 0 : 0;
    return count >= ASK_AFTER || now - c.due >= DAY;
  }).map((c) => ({ ...c, pokes: pokeFor(c.key) }));
}

// The answer to "still open?": tomorrow, next week, or drop it.
export function resolve(key, choice, now = new Date()) {
  const c = commitments(now.getTime()).find((x) => x.key === key) || null;
  const days = choice === "nextweek" ? 7 : 1;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const targetDay = dayKey(target);
  const kind = c ? c.kind : String(key).split(":")[0];
  const id = c ? c.id : String(key).split(":")[1];
  const nowISO = now.toISOString();
  if (kind === "task" || kind === "reminder") {
    const t = store.get("tasks", id);
    if (t) {
      if (choice === "drop") store.update("tasks", t.id, { done: true, doneBy: "dropped", doneAt: nowISO });
      else {
        const hm = (/T(\d{2}:\d{2})/.exec(String(t.remindAt || "")) || [])[1];
        store.update("tasks", t.id, { due: targetDay, remindAt: hm ? `${targetDay}T${hm}` : t.remindAt || null, notifiedAt: null });
      }
    }
  } else if (kind === "followup" || kind === "fu") {
    const l = store.get("leads", id);
    if (l) store.update("leads", l.id, { followUp: choice === "drop" ? "" : targetDay });
  } else if (kind === "watch") {
    if (choice === "drop") store.update("watches", id, { done: true, doneAt: nowISO, doneBy: "dropped" });
  } else if (kind === "reply") {
    if (choice === "drop" && store.markThreadRead) store.markThreadRead(id);
  }
  // Moved: the count starts again, and nothing nags until the new day.
  // Dropped: the poke goes with it.
  const p = pokeFor(key);
  if (choice === "drop") { if (p) store.remove("pokes", p.id); }
  else upsertPoke(key, { count: 0, lastAt: null, snoozedUntil: new Date(target.getTime() + 9 * HOUR).toISOString() });
  return { key, choice, movedTo: choice === "drop" ? null : targetDay };
}

// Today in one line: due, done, overdue — for Home, the pulse and the manager.
export function ledgerSummary(now = Date.now()) {
  const today = dayKey(new Date(now));
  const open = commitments(now);
  const dueToday = open.filter((c) => dayKey(new Date(c.due)) === today).length;
  const overdue = open.filter((c) => c.due <= now && dayKey(new Date(c.due)) < today).length;
  const doneToday = store.all("tasks").filter((t) => t.done && !t.cadence && dayOf(t.doneAt || t.updatedAt) === today).length;
  const asking = stale(now).length;
  return { open: open.length, dueToday, overdue, doneToday, asking };
}
