// Advanced statistics: what the event log says about how the store runs.
//
// Everything here is a pure read of events — {kind, leadId, name, by,
// prompt, at, meta, rep?} as store.js logs them (rep is added when a
// manager's page merges every member's log). Each read returns its sample
// size with its numbers and says "not enough yet" below a threshold, so a
// manager never acts on three data points. insights() turns the reads into
// sentences, for the page and for the agent's weekly push; the function
// carries the same reads in TypeScript (statsCore in index.ts).

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const t = (e) => new Date(e.at).getTime();
const byAt = (a, b) => t(a) - t(b);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
export function median(xs) { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); }
const p75 = (xs) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.75))]; };
const isContact = (e) => (e.kind === "text_out" || e.kind === "call" || e.kind === "email_out") && e.by !== "customer";
const isAct = (e) => isContact(e) || e.kind === "appt_set" || e.kind === "task_done" || e.kind === "logged" || e.kind === "lead_new";
const groupByLead = (events) => { const m = new Map(); for (const e of events) { if (!e.leadId) continue; if (!m.has(e.leadId)) m.set(e.leadId, []); m.get(e.leadId).push(e); } for (const v of m.values()) v.sort(byAt); return m; };
const firstAfter = (list, from, pred, within) => list.find((e) => t(e) >= from && t(e) - from <= within && pred(e)) || null;
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
const minutes = (ms) => Math.round(ms / MIN);

// Keep a window of events (ms) — the page offers 7, 28 and 90 days.
export function inWindow(events, { now = Date.now(), days = 28 } = {}) {
  const from = now - days * DAY;
  return events.filter((e) => { const x = t(e); return isFinite(x) && x >= from && x <= now + DAY; });
}

// 1. Speed to lead: from a lead's arrival (lead_new, else logged) to the
//    first text, call or email — the median, the share inside ten minutes,
//    by hour of arrival and by rep.
export function speedToLead(events) {
  const leads = groupByLead(events);
  const rows = [];
  for (const [leadId, list] of leads) {
    const arrive = list.find((e) => e.kind === "lead_new") || list.find((e) => e.kind === "logged");
    if (!arrive) continue;
    const first = firstAfter(list, t(arrive), isContact, 7 * DAY);
    if (!first) continue;
    rows.push({ leadId, rep: first.rep || arrive.rep || "", min: minutes(t(first) - t(arrive)), hour: new Date(arrive.at).getHours() });
  }
  const mins = rows.map((r) => r.min);
  const within10 = rows.filter((r) => r.min <= 10).length;
  const byHour = []; for (let h = 0; h < 24; h++) { const xs = rows.filter((r) => r.hour === h).map((r) => r.min); if (xs.length) byHour.push({ hour: h, label: hourLabel(h), n: xs.length, medianMin: median(xs) }); }
  const reps = [...new Set(rows.map((r) => r.rep).filter(Boolean))].map((rep) => { const xs = rows.filter((r) => r.rep === rep); return { rep, n: xs.length, medianMin: median(xs.map((r) => r.min)), within10Pct: pct(xs.filter((r) => r.min <= 10).length, xs.length) }; }).sort((a, b) => a.medianMin - b.medianMin);
  return { n: rows.length, medianMin: median(mins), p75Min: p75(mins), within10Pct: pct(within10, rows.length), byHour, byRep: reps };
}

// 2. Pushes: received → opened (same tag, inside a day) → an act inside
//    half an hour of opening.
export function pushEffect(events) {
  const received = events.filter((e) => e.kind === "push_received").sort(byAt);
  const opened = events.filter((e) => e.kind === "push_open").sort(byAt);
  const acts = events.filter(isAct).sort(byAt);
  let openN = 0, actN = 0; const openMins = [], actMins = []; const byTag = new Map();
  const usedOpens = new Set();
  for (const r of received) {
    const tag = String(r.prompt || "").split(":")[0] || "other";
    const row = byTag.get(tag) || { tag, received: 0, opened: 0, acted: 0 }; row.received++; byTag.set(tag, row);
    const o = opened.find((x) => !usedOpens.has(x) && x.prompt === r.prompt && t(x) >= t(r) && t(x) - t(r) <= DAY);
    if (!o) continue;
    usedOpens.add(o); openN++; row.opened++; openMins.push(minutes(t(o) - t(r)));
    const a = acts.find((x) => t(x) >= t(o) && t(x) - t(o) <= 30 * MIN && (!o.rep || !x.rep || x.rep === o.rep));
    if (a) { actN++; row.acted++; actMins.push(minutes(t(a) - t(o))); }
  }
  return { received: received.length, opened: openN, acted: actN, openPct: pct(openN, received.length), actPct: pct(actN, received.length), medianOpenMin: median(openMins), medianActMin: median(actMins), byTag: [...byTag.values()].sort((a, b) => b.received - a.received) };
}

// 3. Which follow-up step books: the rep's texts by their step (the
//    prompt: intro, value, check-in…), then a reply inside a day and an
//    appointment set inside a day.
export function stepEffect(events) {
  const leads = groupByLead(events);
  const steps = new Map();
  for (const list of leads.values()) {
    for (const e of list) {
      if (e.kind !== "text_out" || e.by !== "rep") continue;
      const step = String(e.prompt || "other") || "other";
      const row = steps.get(step) || { step, n: 0, replied: 0, booked: 0 }; row.n++; steps.set(step, row);
      if (firstAfter(list, t(e), (x) => x.kind === "text_in", DAY)) row.replied++;
      if (firstAfter(list, t(e), (x) => x.kind === "appt_set", DAY)) row.booked++;
    }
  }
  const rows = [...steps.values()].map((r) => ({ ...r, replyPct: pct(r.replied, r.n), bookPct: pct(r.booked, r.n) })).sort((a, b) => b.n - a.n);
  const enough = rows.filter((r) => r.n >= 8);
  const best = enough.slice().sort((a, b) => b.bookPct - a.bookPct)[0] || null, worst = enough.slice().sort((a, b) => a.bookPct - b.bookPct)[0] || null;
  return { steps: rows, n: rows.reduce((a, r) => a + r.n, 0), best, worst };
}

// 4. The welcome's timing: how long after the customer was logged the
//    welcome went, in three buckets, against a reply inside a day and an
//    appointment inside two.
export function welcomeTiming(events) {
  const leads = groupByLead(events);
  const buckets = [{ label: "inside an hour", lo: 0, hi: 60 }, { label: "one to two hours", lo: 60, hi: 120 }, { label: "after two hours", lo: 120, hi: Infinity }].map((b) => ({ ...b, n: 0, replied: 0, booked: 0 }));
  let n = 0;
  for (const list of leads.values()) {
    const logged = list.find((e) => e.kind === "logged") || list.find((e) => e.kind === "lead_new");
    const w = logged && list.find((e) => e.kind === "text_out" && /^(intro|welcome)$/.test(String(e.prompt || "")) && t(e) >= t(logged));
    if (!logged || !w) continue;
    const delay = minutes(t(w) - t(logged));
    const b = buckets.find((x) => delay >= x.lo && delay < x.hi); if (!b) continue;
    n++; b.n++;
    if (firstAfter(list, t(w), (x) => x.kind === "text_in", DAY)) b.replied++;
    if (firstAfter(list, t(w), (x) => x.kind === "appt_set", 2 * DAY)) b.booked++;
  }
  return { n, buckets: buckets.map((b) => ({ label: b.label, n: b.n, replyPct: pct(b.replied, b.n), bookPct: pct(b.booked, b.n) })) };
}

// 5. Confirmation and showing: per appointment, confirmed or not, and
//    whether it showed (showed or sold) once it had an outcome.
export function confirmEffect(events) {
  const appts = new Map();
  for (const e of events) {
    const id = e.meta && e.meta.apptId; if (!id || !/^appt_/.test(e.kind)) continue;
    const a = appts.get(id) || { id, set: false, confirmed: false, outcome: "" }; appts.set(id, a);
    if (e.kind === "appt_set") a.set = true;
    if (e.kind === "appt_confirmed") a.confirmed = true;
    if (e.kind === "appt_showed" || e.kind === "appt_sold") a.outcome = "showed";
    if (e.kind === "appt_no_show") a.outcome = a.outcome || "no_show";
  }
  // Only appointments set inside the window: an older one's confirmation may sit outside it.
  const done = [...appts.values()].filter((a) => a.set && a.outcome);
  const c = done.filter((a) => a.confirmed), u = done.filter((a) => !a.confirmed);
  const show = (xs) => ({ n: xs.length, showPct: pct(xs.filter((a) => a.outcome === "showed").length, xs.length) });
  return { n: done.length, confirmed: show(c), unconfirmed: show(u) };
}

// 6. The manager's taps: a nudge, a text from the store, a hand-off, a
//    welcome — and an appointment set for that customer inside a day.
const TAP_LABEL = { mgr_nudge: "Nudges", mgr_text: "Texts from the store", mgr_handoff: "Hand-offs", mgr_welcome: "Welcomes", mgr_draft: "Drafts sent" };
export function tapEffect(events) {
  const leads = groupByLead(events);
  const kinds = new Map(); let n = 0, booked = 0;
  for (const list of leads.values()) {
    for (const e of list) {
      if (!/^mgr_/.test(e.kind)) continue;
      const row = kinds.get(e.kind) || { kind: e.kind, label: TAP_LABEL[e.kind] || e.kind.slice(4), n: 0, booked: 0 }; row.n++; n++; kinds.set(e.kind, row);
      if (firstAfter(list, t(e), (x) => x.kind === "appt_set", DAY)) { row.booked++; booked++; }
    }
  }
  const rows = [...kinds.values()].map((r) => ({ ...r, pct: pct(r.booked, r.n) })).sort((a, b) => b.n - a.n);
  return { n, booked, pct: pct(booked, n), kinds: rows, best: rows.filter((r) => r.n >= 5).sort((a, b) => b.pct - a.pct)[0] || null };
}

// 7. The agent: its confirmation texts and whether the appointment showed;
//    its no-show texts and whether a new appointment followed inside a
//    week; its hand-outs and whether the rep worked them inside two days
//    and booked inside a week.
export function agentEffect(events) {
  const leads = groupByLead(events);
  const confirm = { n: 0, showed: 0 }, noshow = { n: 0, rebooked: 0 }, handed = { n: 0, worked: 0, booked: 0 };
  for (const list of leads.values()) {
    for (const e of list) {
      if (e.kind === "text_out" && e.by === "agent" && e.prompt === "manager-confirm") {
        confirm.n++;
        if (firstAfter(list, t(e), (x) => x.kind === "appt_showed" || x.kind === "appt_sold", 3 * DAY)) confirm.showed++;
      } else if (e.kind === "text_out" && e.by === "agent" && e.prompt === "manager-noshow") {
        noshow.n++;
        if (firstAfter(list, t(e), (x) => x.kind === "appt_set", 7 * DAY)) noshow.rebooked++;
      } else if (e.kind === "task_handed") {
        handed.n++;
        if (firstAfter(list, t(e), (x) => isContact(x) && x.by === "rep", 2 * DAY)) handed.worked++;
        if (firstAfter(list, t(e), (x) => x.kind === "appt_set", 7 * DAY)) handed.booked++;
      }
    }
  }
  return { confirm: { n: confirm.n, showedPct: pct(confirm.showed, confirm.n) }, noshow: { n: noshow.n, rebookedPct: pct(noshow.rebooked, noshow.n) }, handed: { n: handed.n, workedPct: pct(handed.worked, handed.n), bookedPct: pct(handed.booked, handed.n) } };
}

// 8. When things happen: ups logged, appointments set and shows, by hour
//    and by day of the week.
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function whenThings(events) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: hourLabel(h), logged: 0, set: 0, showed: 0 }));
  const days = DOW.map((label, dow) => ({ dow, label, logged: 0, set: 0, showed: 0 }));
  let n = 0;
  for (const e of events) {
    const k = e.kind === "logged" || e.kind === "lead_new" ? "logged" : e.kind === "appt_set" ? "set" : e.kind === "appt_showed" || e.kind === "appt_sold" ? "showed" : "";
    if (!k) continue;
    const d = new Date(e.at); if (isNaN(d)) continue;
    n++; hours[d.getHours()][k]++; days[d.getDay()][k]++;
  }
  const top = (k) => hours.slice().sort((a, b) => b[k] - a[k])[0];
  const topDay = (k) => days.slice().sort((a, b) => b[k] - a[k])[0];
  return { n, hours, days, peak: { logged: top("logged"), set: top("set"), loggedDay: topDay("logged"), setDay: topDay("set") } };
}

// 9. Discipline: the log is only as true as the habits. Past appointments
//    with an outcome marked; leads that got a first contact at all.
export function discipline(events, { appointments = [], now = Date.now() } = {}) {
  const past = appointments.filter((a) => a.status !== "canceled" && a.when && new Date(a.when).getTime() < now - 2 * HOUR);
  const marked = past.filter((a) => a.outcome).length;
  const leads = groupByLead(events);
  let arrived = 0, touched = 0;
  for (const list of leads.values()) {
    const arrive = list.find((e) => e.kind === "lead_new" || e.kind === "logged"); if (!arrive) continue;
    arrived++; if (firstAfter(list, t(arrive), isContact, 7 * DAY)) touched++;
  }
  return { pastN: past.length, outcomesPct: pct(marked, past.length), leadsN: arrived, touchedPct: pct(touched, arrived) };
}

export function allStats(events, { appointments = [], now = Date.now() } = {}) {
  return { speed: speedToLead(events), pushes: pushEffect(events), steps: stepEffect(events), welcome: welcomeTiming(events), confirm: confirmEffect(events), taps: tapEffect(events), agent: agentEffect(events), when: whenThings(events), discipline: discipline(events, { appointments, now }) };
}

// The sentences. Thresholds keep them honest: nothing is said from a
// handful. `who` is "manager" (the store) or "rep" (you); `names` maps a
// rep id to a first name for the manager's by-rep lines.
export function insights(s, { who = "manager", names = {} } = {}) {
  const out = [];
  const you = who === "rep";
  const nm = (id) => names[id] || "a rep";
  if (s.speed && s.speed.n >= 8 && s.speed.medianMin != null) {
    out.push({ key: "speed", priority: 90, text: `${you ? "Your first contact" : "First contact"} takes ${s.speed.medianMin} min at the median; ${s.speed.within10Pct}% ${you ? "of your leads hear from you" : "of leads hear from us"} inside ten minutes.` });
    if (!you && s.speed.byRep.length >= 2) { const f = s.speed.byRep[0], sl = s.speed.byRep[s.speed.byRep.length - 1]; if (f.n >= 5 && sl.n >= 5 && sl.medianMin >= 2 * Math.max(1, f.medianMin)) out.push({ key: "speed-gap", priority: 85, text: `${nm(f.rep)} answers a new lead in ${f.medianMin} min; ${nm(sl.rep)} in ${sl.medianMin}.` }); }
  }
  if (s.pushes && s.pushes.received >= 10) out.push({ key: "pushes", priority: 70, text: `${s.pushes.openPct}% of ${you ? "your" : "the"} pushes get opened and ${s.pushes.actPct}% lead to something done inside half an hour${s.pushes.medianOpenMin != null ? `, ${s.pushes.medianOpenMin} min after they land` : ""}.` });
  if (s.steps && s.steps.best && s.steps.worst && s.steps.best.step !== s.steps.worst.step) out.push({ key: "steps", priority: 80, text: `The "${s.steps.best.step}" text books ${s.steps.best.bookPct}% of the time; "${s.steps.worst.step}" ${s.steps.worst.bookPct}%.` });
  if (s.welcome) { const b = s.welcome.buckets.filter((x) => x.n >= 6); if (b.length >= 2) { const a = b[0], z = b[b.length - 1]; out.push({ key: "welcome", priority: 75, text: `Welcomes sent ${a.label} get ${a.replyPct}% replies and book ${a.bookPct}%; ${z.label}, ${z.replyPct}% and ${z.bookPct}%.` }); } }
  if (s.confirm && s.confirm.confirmed.n >= 6 && s.confirm.unconfirmed.n >= 6) out.push({ key: "confirm", priority: 88, text: `Confirmed appointments show ${s.confirm.confirmed.showPct}% of the time; unconfirmed, ${s.confirm.unconfirmed.showPct}%.` });
  if (!you && s.taps && s.taps.n >= 6) out.push({ key: "taps", priority: 72, text: `${s.taps.pct}% of your taps had an appointment set within a day${s.taps.best ? `; ${s.taps.best.label.toLowerCase()} work best at ${s.taps.best.pct}%` : ""}.` });
  if (s.agent) {
    if (s.agent.confirm.n >= 6) out.push({ key: "agent-confirm", priority: 60, text: `The agent's confirmation texts: ${s.agent.confirm.showedPct}% of those appointments showed.` });
    if (s.agent.handed.n >= 8) out.push({ key: "agent-handed", priority: 62, text: `Of the agent's hand-outs, ${s.agent.handed.workedPct}% were worked inside two days and ${s.agent.handed.bookedPct}% booked inside a week.` });
  }
  if (s.when && s.when.n >= 20 && s.when.peak.logged && s.when.peak.set) out.push({ key: "when", priority: 50, text: `Most ups are logged around ${s.when.peak.logged.label}${s.when.peak.loggedDay ? ` and on ${s.when.peak.loggedDay.label}s` : ""}; most appointments get set around ${s.when.peak.set.label}.` });
  if (s.discipline) {
    if (s.discipline.pastN >= 5 && s.discipline.outcomesPct != null && s.discipline.outcomesPct < 80) out.push({ key: "outcomes", priority: 95, text: `Only ${s.discipline.outcomesPct}% of past appointments have an outcome marked — the show rate is only as true as this.` });
    if (s.discipline.leadsN >= 8 && s.discipline.touchedPct != null && s.discipline.touchedPct < 90) out.push({ key: "touched", priority: 92, text: `${100 - s.discipline.touchedPct}% of ${you ? "your" : ""} leads this period never got a first text or call.` });
  }
  return out.sort((a, b) => b.priority - a.priority);
}
