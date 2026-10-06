// The manager's voice assistant — the same tool-use loop as the rep's
// (agent.js), with a different brain and different hands.
//
// A rep's assistant works their own book on the phone. A manager has no
// book; what they run is the store: every rep's numbers, every customer on
// every rep's file, the calendar, the targets, the nudges. So the tools
// here read the board and the book (team.js) and write through the same
// narrow doors the manager's screens use — a nudge to a rep's phone, a
// to-do in a rep's book, a target, an appointment mark, the welcome, an
// email — and never touch a rep's records any other way. The screen follows
// the conversation: a list that comes back is put on screen, so the spoken
// answer hands over rather than reading it out.

import * as store from "./store.js";
import { navigate } from "./router.js";
import { callRelay, createAgentSession } from "./agent.js";
import { cachedStore, myStore, isManager, memberName, loadBoard, storeTotals, loadBook, cachedBook, loadInventory, nudgeRep, addRepTask, setTarget, updateRepAppointment, sendWelcomeNow, sendManagerEmail, repLead } from "./team.js";
import { findings } from "./insight.js";
import { rankBook, reachOuts, taskFor } from "./reach.js";
import { makeMatcher } from "./match.js";
import { horizonFor, horizonBook, contractsEnding, monthLabel } from "./horizon.js";
import { sendEmail } from "./email.js";
import { huddleText } from "./views/manage.js";
import { openRepSheet, openCustomerSheet } from "./views/team.js";

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const age = (iso, now) => { const m = Math.max(0, Math.round((now - new Date(iso)) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };

// ---- What the assistant reads ----

async function team() {
  const t = cachedStore() || (await myStore());
  if (!t) throw new Error("You're not in a store yet — set it up under Team");
  if (!isManager(t)) throw new Error("The store's assistant is the manager's");
  return t;
}
async function board(t) {
  const b = await loadBoard(t);
  return { board: b, stats: b.stats.filter((r) => !r.error && r.touches) };
}
let rankedCache = { at: 0, lotAt: 0, ranked: null };
async function ranked(t) {
  const [book, lot] = await Promise.all([loadBook(t), loadInventory(t).catch(() => null)]);
  const lotAt = lot ? lot.at : 0;
  if (!rankedCache.ranked || rankedCache.at !== book.at || rankedCache.lotAt !== lotAt) {
    const s = store.getSettings();
    rankedCache = { at: book.at, lotAt, ranked: rankBook(book.rows, { defaultApr: s.defaultApr, dealMatchBand: s.dealMatchBand, match: lot && lot.rows.length ? makeMatcher(lot.rows, s) : null }) };
  }
  return rankedCache.ranked;
}

// A rep, by however the manager said their name.
function findRep(t, name) {
  const q = norm(name);
  if (!q) return null;
  const members = t.members || [];
  const exact = members.find((m) => norm(memberName(m)) === q);
  if (exact) return exact;
  const first = members.filter((m) => norm(memberName(m)).split(" ")[0] === q.split(" ")[0]);
  if (first.length === 1) return first[0];
  const loose = members.filter((m) => norm(memberName(m)).includes(q) || q.includes(norm(memberName(m)).split(" ")[0]));
  return loose.length === 1 ? loose[0] : null;
}
// Customers, by name, across every rep's book — the rep narrows it.
function findCustomers(rows, name, repHint) {
  const q = norm(name);
  if (!q) return [];
  let hits = rows.filter((r) => norm(r.lead.name) === q);
  if (!hits.length) hits = rows.filter((r) => norm(r.lead.name).includes(q));
  if (!hits.length) { const first = q.split(" ")[0]; hits = rows.filter((r) => norm(r.lead.name).split(" ")[0] === first); }
  if (repHint) { const narrowed = hits.filter((r) => r.rep.user_id === repHint.user_id); if (narrowed.length) hits = narrowed; }
  return hits;
}
// One customer or a question. `rows` are ranked rows (with read and rep).
function oneCustomer(rows, name, repHint) {
  const hits = findCustomers(rows, name, repHint);
  if (hits.length === 1) return { row: hits[0] };
  if (!hits.length) return { error: `Nobody called ${name} on any rep's book` };
  const reps = [...new Set(hits.map((r) => memberName(r.rep)))];
  if (reps.length > 1) return { error: `${hits.length} customers match "${name}": ${hits.slice(0, 5).map((r) => `${r.lead.name} (${memberName(r.rep)})`).join(", ")} — which one?`, ask: true };
  // Same rep, several near-matches: the closest name wins.
  return { row: hits.sort((a, b) => norm(a.lead.name).length - norm(b.lead.name).length)[0] };
}

const slimRead = (r) => ({
  name: r.lead.name, rep: memberName(r.rep), stage: r.lead.stage, vehicle: r.lead.vehicleInterest || "", phone: r.lead.phone || "", email: r.lead.email || "",
  tier: r.tier ? r.tier.label : "", score: r.read.score, reasons: r.read.reasons.slice(0, 4), next: r.read.next ? r.read.next.label : "",
  deal: r.read.deal ? { vehicle: r.read.deal.name, monthly: Math.round(r.read.deal.monthly), delta: r.read.deal.delta != null ? Math.round(r.read.deal.delta) : null } : null,
  lastContacted: r.lead.lastContacted || "", followUp: r.lead.followUp || "", inPlay: !!r.read.inPlay, excluded: r.read.excluded || "",
});
const slimRep = (r) => ({
  rep: memberName(r.member), units: r.sales.units, goalUnits: r.goal.units, pace: r.goal.pace, gross: r.sales.gross,
  apptsSetThisMonth: r.insight ? r.insight.setThisMonth : r.appts.set, shown: r.appts.shown, sold: r.appts.sold, showRate: r.appts.showRate,
  touchesToday: r.touches.today, touchesMonth: r.touches.month, untouched: r.leads.untouched.length, overdue: r.leads.overdue.length, open: r.leads.open,
  needs: r.insight && r.insight.needs.goal ? { apptsNeeded: r.insight.needs.apptsNeeded, perDay: r.insight.needs.perDay, onTrack: r.insight.needs.onTrack } : null,
  appointmentsToday: r.appts.today.map((a) => `${String(a.when).slice(11, 16)} ${a.customerName || ""}`),
});

// ---- The tools ----

const TOOLS = [
  { name: "ask_user", description: "Ask the manager ONE short question when a required detail is genuinely missing or ambiguous (several customers match, no rep named for a target). Only when you truly can't proceed.", input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
  { name: "store_today", description: "The store's day and month: units against goal, appointments set/shown/needed to hit the goal, show rate, touches, untouched leads, today's appointments, and the top findings. Use for 'how are we doing', 'where do we stand', 'what's the number', 'are we on track'.", input_schema: { type: "object", properties: {} } },
  { name: "rep_report", description: "One rep's numbers: units and pace, appointments set/shown/sold, touches, untouched and overdue leads, what they need per day, today's appointments. Opens their sheet on screen. 'How's Parm doing?', 'what does Jordan need today?'", input_schema: { type: "object", properties: { rep: { type: "string" } }, required: ["rep"] } },
  { name: "fresh_leads", description: "New leads nobody has touched yet, across the store, with how long each has waited and whose it is — 'who's waiting', 'any leads sitting', 'untouched leads'. Leads set appointments in the first hour.", input_schema: { type: "object", properties: {} } },
  { name: "find_customers", description: "Search every rep's book by name, vehicle, phone or stage; optionally one rep's. Puts the matches on the Customers screen.", input_schema: { type: "object", properties: { query: { type: "string" }, rep: { type: "string" } }, required: ["query"] } },
  { name: "get_customer", description: "Everything on one customer, whoever's book they're on: rep, stage, vehicle, the app's read (tier, reasons, the payment match against the shared lot, the suggested next move), recent texts and emails. Opens their page. 'What's the story with Dana?', 'why is Ken worth a call?', 'has anyone talked to Sara?'", input_schema: { type: "object", properties: { name: { type: "string" }, rep: { type: "string" } }, required: ["name"] } },
  { name: "reach_outs", description: "The assistant's list: customers across the store a rep should reach out to now, best first, each with the reasons and a payment match — 'who should we be calling', 'who's got equity', 'who can we put in a car', 'work the book'. Optionally one rep's. Puts the list on screen.", input_schema: { type: "object", properties: { limit: { type: "number" }, rep: { type: "string" } } } },
  { name: "timing", description: "WHEN each customer's next vehicle starts to make sense — the month, across every rep's book: when equity clears the line as the payoff comes down, when a like-for-like on the shared lot lands at their payment, when the contract runs out, or six months before a lease ends. 'When does it make sense for Dana?', 'who opens up in the next six months?', 'who's coming up on Parm's book?'. Puts the list on the Customers screen.", input_schema: { type: "object", properties: { customer: { type: "string" }, rep: { type: "string" }, months: { type: "number", description: "with no customer: how far ahead (default 6)" } } } },
  { name: "lease_ends", description: "Every lease the store has out with when it ends, soonest first, optionally one rep's — 'when do our leases end?', 'what's coming off lease this quarter?', 'how many leases end in December?'. Puts the list on the Customers screen.", input_schema: { type: "object", properties: { rep: { type: "string" }, months: { type: "number", description: "only leases ending within this many months (default 12)" } } } },
  { name: "appointments", description: "The store's calendar: today, tomorrow, this week, recent no-shows to rebook, or past appointments with no outcome logged. Each with the rep and where it stands. Opens the board on that tab.", input_schema: { type: "object", properties: { which: { type: "string", enum: ["today", "tomorrow", "week", "noshow", "unlogged"] } } } },
  { name: "insights", description: "What the numbers say — speed to lead, untouched leads, confirmation and lead-time effects on show rate, best sources, best times, what it takes to hit the goal. 'What should we change', 'what's the biggest lever', 'why is the show rate low'. Opens Insights.", input_schema: { type: "object", properties: {} } },
  { name: "huddle", description: "The morning huddle, written from the numbers: where the store stands, what each rep needs today, the one thing the data says. 'Give me the huddle', 'what do I tell the floor'.", input_schema: { type: "object", properties: {} } },
  { name: "nudge_rep", description: "A notification on a rep's phone, from you — YOU write it, short and direct. 'Tell Parm to call his fresh lead', 'remind Jordan to confirm tomorrow'. Not for assigning work on a customer: that's assign_task.", input_schema: { type: "object", properties: { rep: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["rep", "body"] } },
  { name: "assign_task", description: "Put a to-do in a rep's book and nudge their phone. Name the customer when it's about one ('have Parm reach out to Dana about her equity' — the reasons are filled in from the customer's file when you leave the title empty). Name the rep when it isn't about a customer ('Jordan: pull the Rogue specials for Saturday').", input_schema: { type: "object", properties: { rep: { type: "string" }, customer: { type: "string" }, title: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD; today if not said" }, channel: { type: "string", enum: ["call", "message"] }, note: { type: "string" } } } },
  { name: "set_target", description: "Set a rep's target for this month: units and/or appointments. 'Parm's goal is 12 units', 'give Jordan 30 appointments this month'.", input_schema: { type: "object", properties: { rep: { type: "string" }, units: { type: "number" }, appts: { type: "number" } }, required: ["rep"] } },
  { name: "appointment_outcome", description: "Mark a customer's appointment in the rep's calendar: confirmed, showed, no-show or sold, with an optional note. 'Dana showed', 'Ken no-showed', 'the Muise appointment is confirmed'.", input_schema: { type: "object", properties: { customer: { type: "string" }, outcome: { type: "string", enum: ["confirmed", "showed", "no_show", "sold"] }, note: { type: "string" } }, required: ["customer", "outcome"] } },
  { name: "send_welcome", description: "Send the manager's welcome text to a customer a rep just logged, right now (it otherwise goes on its own an hour or two after they're logged). 'Welcome Dana now', 'send Ken the welcome'.", input_schema: { type: "object", properties: { customer: { type: "string" } }, required: ["customer"] } },
  { name: "email_customer", description: "Send a real email to a customer on any rep's book, from you as the manager — YOU write the subject and body, warm and short, no figures. It's filed on the customer's page for the rep too. Needs their email on file.", input_schema: { type: "object", properties: { customer: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["customer", "subject", "body"] } },
  { name: "email_rep", description: "Send an email to a rep. YOU write the subject and body.", input_schema: { type: "object", properties: { rep: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["rep", "subject", "body"] } },
  { name: "open_page", description: "Open a screen of the store's app.", input_schema: { type: "object", properties: { page: { type: "string", enum: ["home", "appointments", "customers", "insights", "team", "settings"] } }, required: ["page"] } },
];

const ROUTES = { home: "/", appointments: "/appointments", customers: "/customers", insights: "/insights", team: "/team", settings: "/settings" };

async function execManagerTool(name, input) {
  const t = await team();
  const now = new Date();
  const repOf = (n) => (n ? findRep(t, n) : null);
  const need = (member, n) => { if (!member) throw new Error(`No rep called ${n} on the team — the team is ${(t.members || []).map(memberName).join(", ")}`); return member; };
  switch (name) {
    case "store_today": {
      const { stats } = await board(t);
      const tot = storeTotals(stats);
      const ins = tot.insight;
      navigate("/");
      return { result: {
        store: t.name, date: ymd(now), units: tot.units, goalUnits: tot.goal, gross: tot.gross,
        apptsSetThisMonth: ins.setThisMonth, shown: ins.funnel.shown, showRate: ins.history.showRate,
        needs: ins.needs.goal ? { apptsNeeded: ins.needs.apptsNeeded, perDay: ins.needs.perDay, onTrack: ins.needs.onTrack, assumedRates: !!ins.needs.assumed } : "no unit goals set",
        touchesToday: tot.touchesToday, untouchedLeads: tot.untouched, overdueFollowUps: tot.overdue,
        appointmentsToday: tot.apptsToday.map((a) => `${String(a.when).slice(11, 16)} ${a.customerName || ""} (${memberName(a.rep)})`),
        findings: findings(ins).slice(0, 3).map((f) => f.text),
        reps: stats.map(slimRep),
      }, note: "reading the board" };
    }
    case "rep_report": {
      const m = need(repOf(input.rep), input.rep);
      const { stats } = await board(t);
      const r = stats.find((x) => x.member.user_id === m.user_id);
      if (!r) return { result: `${memberName(m)} hasn't synced anything yet` };
      openRepSheet(r, m);
      return { result: { ...slimRep(r), untouchedLeads: r.leads.untouched.slice(0, 8).map((l) => `${l.name || "Customer"} · ${age(l.createdAt, now)} waiting`), overdueLeads: r.leads.overdue.slice(0, 8).map((l) => `${l.name || "Customer"} · due ${l.followUp}`) }, note: `opening ${memberName(m)}` };
    }
    case "fresh_leads": {
      const { stats } = await board(t);
      const waiting = stats.flatMap((r) => r.leads.untouched.map((l) => ({ l, r })).concat(r.raw ? r.raw.leads.filter((l) => l.stage === "new" && !l.firstContacted && !l.lastContacted && l.createdAt && now - new Date(l.createdAt) <= DAY && now - new Date(l.createdAt) > 30 * 60000).map((l) => ({ l, r })) : []))
        .filter((x, i, arr) => arr.findIndex((y) => y.l.id === x.l.id && y.r.member.user_id === x.r.member.user_id) === i)
        .sort((a, b) => String(a.l.createdAt).localeCompare(String(b.l.createdAt)));
      navigate("/");
      return { result: { count: waiting.length, leads: waiting.slice(0, 12).map(({ l, r }) => ({ name: l.name || "Customer", rep: memberName(r.member), waiting: age(l.createdAt, now), source: l.source || "", vehicle: l.vehicleInterest || "" })) }, note: "checking for fresh leads" };
    }
    case "find_customers": {
      const R = await ranked(t);
      const m = repOf(input.rep);
      const q = norm(input.query);
      let rows = R.rows.filter((r) => [r.lead.name, r.lead.phone, r.lead.vehicleInterest, r.lead.source, r.lead.stage].map(norm).join(" ").includes(q));
      if (m) rows = rows.filter((r) => r.rep.user_id === m.user_id);
      try { sessionStorage.setItem("customers-query", JSON.stringify({ q: input.query || "", rep: m ? m.user_id : "all" })); } catch { /* the answer is spoken */ }
      navigate("/customers");
      return { result: { count: rows.length, customers: rows.slice(0, 12).map(slimRead) }, note: "searching the book" };
    }
    case "get_customer": {
      const R = await ranked(t);
      const pick = oneCustomer(R.rows, input.name, repOf(input.rep));
      if (pick.error) return { result: pick.error, note: "" };
      const r = pick.row;
      let detail = null;
      try { detail = await repLead(r.rep.user_id, r.lead.id); } catch { /* the slim row will do */ }
      openCustomerSheet(r.rep.user_id, r.lead.id);
      return { result: { ...slimRead(r), source: r.lead.source || "", added: r.lead.createdAt || "", notes: detail ? String(detail.lead.notes || "").slice(0, 400) : "",
        recentTexts: detail ? detail.texts.slice(0, 4).map((x) => `${x.dir === "in" ? "them" : x.via === "manager-welcome" ? "manager" : "rep"} (${String(x.at || x.createdAt || "").slice(0, 16)}): ${String(x.body || "").slice(0, 120)}`) : [],
        recentEmails: detail ? detail.emails.slice(0, 3).map((e) => `${e.direction === "in" ? "them" : e.via === "manager" ? "manager" : "rep"}: ${e.subject || "(no subject)"}`) : [] }, note: `opening ${r.lead.name}` };
    }
    case "reach_outs": {
      const R = await ranked(t);
      const m = repOf(input.rep);
      let rows = reachOuts(R, { limit: 100000 });
      if (m) rows = rows.filter((r) => r.rep.user_id === m.user_id);
      try { sessionStorage.setItem("customers-query", JSON.stringify({ q: "", rep: m ? m.user_id : "all", mode: "reach" })); } catch { /* fine */ }
      navigate("/customers");
      return { result: { worthACall: rows.length, top: rows.slice(0, Math.min(Number(input.limit) || 5, 12)).map(slimRead) }, note: "ranking the book" };
    }
    case "timing": {
      const R = await ranked(t);
      const m = repOf(input.rep);
      const s = store.getSettings();
      const lot = await loadInventory(t).catch(() => null);
      const hopts = { now, defaultApr: s.defaultApr, dealMatchBand: s.dealMatchBand, match: lot && lot.rows.length ? makeMatcher(lot.rows, s) : null };
      const slim = (r) => ({ customer: r.lead.name, rep: memberName(r.rep), vehicle: r.lead.vehicleInterest || "", month: r.hz.m === 0 ? "now" : r.hz.at ? monthLabel(r.hz.at) : "unknown", monthsAway: r.hz.m, why: r.hz.why, equityNow: r.hz.equityNow });
      if (input.customer) {
        const pick = oneCustomer(R.rows, input.customer, m);
        if (pick.error) return { result: pick.error, note: "" };
        const hz = horizonFor(pick.row.lead, hopts);
        openCustomerSheet(pick.row.rep.user_id, pick.row.lead.id);
        if (!hz) return { result: { customer: pick.row.lead.name, applies: false, note: "not an owner on file, or lost / just bought" }, note: "" };
        return { result: { ...slim({ ...pick.row, hz }), lease: hz.lease, paymentsLeft: hz.left, contractEnds: hz.end ? monthLabel(hz.end) : null }, note: `timing ${pick.row.lead.name}` };
      }
      const months = Number(input.months) || 6;
      let rows = horizonBook(R.rows, hopts).filter((r) => r.hz.m != null);
      if (m) rows = rows.filter((r) => r.rep.user_id === m.user_id);
      try { sessionStorage.setItem("customers-query", JSON.stringify({ q: "", rep: m ? m.user_id : "all", mode: "timing" })); } catch { /* fine */ }
      navigate("/customers");
      const within = rows.filter((r) => r.hz.m <= months);
      return { result: { readyNow: rows.filter((r) => r.hz.m === 0).length, openingWithin: months, count: within.length, customers: within.slice(0, 12).map(slim) }, note: "timing the book" };
    }
    case "lease_ends": {
      const R = await ranked(t);
      const m = repOf(input.rep);
      const months = Number(input.months) || 12;
      let list = contractsEnding(R.rows, { now, type: "lease" });
      if (m) list = list.filter((r) => r.rep.user_id === m.user_id);
      const soon = list.filter((r) => !r.end || r.end.getTime() - now.getTime() <= months * 30.44 * 86400000);
      try { sessionStorage.setItem("customers-query", JSON.stringify({ q: "", rep: m ? m.user_id : "all", mode: "leases" })); } catch { /* fine */ }
      navigate("/customers");
      const perMonth = {};
      soon.forEach((r) => { const k = r.end ? monthLabel(r.end) : "unknown"; perMonth[k] = (perMonth[k] || 0) + 1; });
      return { result: { leasesOut: list.length, endingWithin: months, count: soon.length, byMonth: perMonth, leases: soon.slice(0, 15).map((r) => ({ customer: r.lead.name, rep: memberName(r.rep), vehicle: r.lead.vehicleInterest || "", ends: r.end ? r.end.toISOString().slice(0, 10) : null, monthsLeft: r.left, past: r.past })) }, note: "listing the leases" };
    }
    case "appointments": {
      const { stats } = await board(t);
      const which = input.which || "today";
      const A = stats.flatMap((r) => (r.raw ? r.raw.appts.map((a) => ({ ...a, rep: r.member })) : [])).filter((a) => a.status !== "canceled");
      const today = ymd(now), tomorrow = ymd(now.getTime() + DAY), weekEnd = ymd(now.getTime() + 7 * DAY);
      const on = (d) => A.filter((a) => String(a.when).slice(0, 10) === d);
      const list = which === "today" ? on(today) : which === "tomorrow" ? on(tomorrow)
        : which === "week" ? A.filter((a) => { const d = String(a.when).slice(0, 10); return d > tomorrow && d <= weekEnd; })
        : which === "noshow" ? A.filter((a) => a.outcome === "no_show" && String(a.when).slice(0, 10) >= ymd(now.getTime() - 14 * DAY))
        : A.filter((a) => !a.outcome && new Date(a.when).getTime() < now.getTime() - 2 * 3600000 && String(a.when).slice(0, 10) >= ymd(now.getTime() - 14 * DAY));
      list.sort((a, b) => String(a.when).localeCompare(String(b.when)));
      try { sessionStorage.setItem("appointments-tab", which); } catch { /* fine */ }
      navigate("/appointments");
      const state = (a) => (a.outcome === "sold" ? "sold" : a.outcome === "showed" ? "showed" : a.outcome === "no_show" ? "no-show" : a.confirmed ? "confirmed" : "set, not confirmed");
      return { result: { which, count: list.length, unconfirmedTomorrow: on(tomorrow).filter((a) => !a.confirmed).length, appointments: list.slice(0, 20).map((a) => ({ when: String(a.when).slice(0, 16), customer: a.customerName || "", rep: memberName(a.rep), type: a.type || "", state: state(a), note: a.managerNote || "" })) }, note: "reading the calendar" };
    }
    case "insights": {
      const { stats } = await board(t);
      const ins = storeTotals(stats).insight;
      navigate("/insights");
      return { result: { findings: findings(ins).map((f) => f.text), showRate: ins.history.showRate, closeRate: ins.needs.closeRate, touchesPerAppointment: ins.touchesPerAppt, speedToLead: ins.speed.buckets.map((b) => `${b.label}: ${b.leads} leads, ${b.setRate != null ? b.setRate + "% set" : "—"}`), bySource: ins.sources.slice(0, 6).map((s) => `${s.source}: ${s.leads} leads, ${s.setRate != null ? s.setRate + "% set" : "—"}`) }, note: "reading the insights" };
    }
    case "huddle": {
      const { stats } = await board(t);
      const tot = storeTotals(stats);
      const rows = stats.slice().sort((a, b) => ((b.insight ? b.insight.setThisMonth : -1) - (a.insight ? a.insight.setThisMonth : -1)));
      const fx = findings(tot.insight).filter((x) => x.kind !== "needs").slice(0, 3);
      navigate("/");
      return { result: huddleText(t, tot, tot.insight, rows, fx, now), note: "writing the huddle" };
    }
    case "nudge_rep": {
      const m = need(repOf(input.rep), input.rep);
      await nudgeRep(m.user_id, { title: String(input.title || "From your manager").slice(0, 80), body: String(input.body || "").slice(0, 200), url: "./#/", tag: "voice-" + Date.now() });
      return { result: `nudged ${memberName(m)}`, note: `nudging ${memberName(m)}` };
    }
    case "assign_task": {
      let m = repOf(input.rep);
      let row = null;
      if (input.customer) {
        const R = await ranked(t);
        const pick = oneCustomer(R.rows, input.customer, m);
        if (pick.error) return { result: pick.error, note: "" };
        row = pick.row; m = row.rep;
      }
      if (!m) return { result: "Which rep is this for?", note: "" };
      const by = store.getSettings().salesperson || "your manager";
      const task = row && !input.title ? taskFor(row, { by, now }) : { leadId: row ? row.lead.id : undefined, title: `${input.title || "Follow up"}${/\(from /.test(input.title || "") ? "" : ` (from ${by})`}`, due: input.due || ymd(now), channel: input.channel || (row ? "call" : undefined), note: input.note || "", fromManager: true };
      if (input.due) task.due = input.due;
      if (input.note && !task.note) task.note = input.note;
      await addRepTask(m.user_id, task);
      try { await nudgeRep(m.user_id, { title: row ? `Reach out to ${row.lead.name || "a customer"}` : "A to-do from your manager", body: (row ? row.read.reasons.slice(0, 3).join(" · ") : task.title).slice(0, 200), url: row ? `./#/leads/${row.lead.id}` : "./#/", tag: "task-" + Date.now() }); } catch { /* the to-do is there */ }
      return { result: `to-do added for ${memberName(m)}: ${task.title}`, note: `sending to ${memberName(m)}` };
    }
    case "set_target": {
      const m = need(repOf(input.rep), input.rep);
      await setTarget(m.user_id, { units: Number(input.units) || 0, appts: Number(input.appts) || 0 });
      try { sessionStorage.removeItem("viniva:team-board"); } catch { /* fine */ }
      return { result: `target set for ${memberName(m)}: ${Number(input.units) || 0} units, ${Number(input.appts) || 0} appointments this month`, note: "setting the target" };
    }
    case "appointment_outcome": {
      const { stats } = await board(t);
      const q = norm(input.customer);
      const A = stats.flatMap((r) => (r.raw ? r.raw.appts.map((a) => ({ ...a, rep: r.member, stat: r })) : [])).filter((a) => a.status !== "canceled" && norm(a.customerName).includes(q.split(" ")[0]) && (norm(a.customerName) === q || norm(a.customerName).includes(q) || q.includes(norm(a.customerName))));
      if (!A.length) return { result: `No appointment for ${input.customer} on the store's calendar`, note: "" };
      // The one closest to now.
      A.sort((a, b) => Math.abs(new Date(a.when) - now) - Math.abs(new Date(b.when) - now));
      const a = A[0];
      const patch = input.outcome === "confirmed" ? { confirmed: true } : { outcome: input.outcome };
      if (input.note) patch.managerNote = String(input.note).slice(0, 200);
      const data = await updateRepAppointment(a.rep.user_id, a.id, patch);
      const raw = a.stat.raw.appts.find((x) => x.id === a.id); if (raw) Object.assign(raw, data);
      try { sessionStorage.removeItem("viniva:team-board"); } catch { /* fine */ }
      navigate("/appointments");
      return { result: `${a.customerName} (${memberName(a.rep)}, ${String(a.when).slice(0, 16)}) marked ${input.outcome.replace("_", "-")}`, note: "marking it" };
    }
    case "send_welcome": {
      const R = await ranked(t);
      const pick = oneCustomer(R.rows, input.customer, repOf(input.rep));
      if (pick.error) return { result: pick.error, note: "" };
      const r = await sendWelcomeNow(pick.row.rep.user_id, pick.row.lead.id);
      return { result: `welcome sent to ${pick.row.lead.name}${r.channel === "email" ? " by email" : ""}: ${r.body || ""}`, note: "sending the welcome" };
    }
    case "email_customer": {
      const R = await ranked(t);
      const pick = oneCustomer(R.rows, input.customer, repOf(input.rep));
      if (pick.error) return { result: pick.error, note: "" };
      if (!pick.row.lead.email) return { result: `${pick.row.lead.name} has no email on file`, note: "" };
      if (/\$\s?\d|\d\s?%|\bapr\b/i.test(`${input.subject} ${input.body}`)) return { result: "No figures in an email to a customer — rewrite it without the dollar amount or rate", note: "" };
      await sendManagerEmail(pick.row.rep.user_id, pick.row.lead.id, { subject: String(input.subject), text: String(input.body) });
      return { result: `emailed ${pick.row.lead.name} at ${pick.row.lead.email}; it's on their page for ${memberName(pick.row.rep)} too`, note: `emailing ${pick.row.lead.name}` };
    }
    case "email_rep": {
      const m = need(repOf(input.rep), input.rep);
      if (!m.email) return { result: `${memberName(m)} has no email on the team`, note: "" };
      await sendEmail({ to: m.email, subject: String(input.subject), text: String(input.body) });
      return { result: `emailed ${memberName(m)} at ${m.email}`, note: `emailing ${memberName(m)}` };
    }
    case "open_page": {
      navigate(ROUTES[input.page] || "/");
      return { result: `opened ${input.page}`, note: "" };
    }
    default:
      return { result: `unknown tool ${name}`, note: `⚠ I can't do "${name}" yet` };
  }
}

// ---- The brain ----

function buildSystem(t) {
  const now = new Date();
  const s = store.getSettings();
  const members = (t.members || []).map((m) => `${memberName(m)}${m.role === "manager" ? " (manager)" : ""}`);
  const book = cachedBook();
  const names = book ? [...new Set(book.rows.map((r) => String(r.lead.name || "").trim()).filter(Boolean))].slice(0, 150) : [];
  return [
    `You are viniva's hands-free assistant for the sales manager${s.salesperson ? " " + s.salesperson : ""} at ${t.name}. Today is ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()]} ${ymd(now)}, ${pad(now.getHours())}:${pad(now.getMinutes())} local.`,
    `The manager runs the store, not a book: every rep's numbers, every customer on every rep's file, the store's calendar, targets, and the reps' phones. Everything is about booking more appointments — that's where sales come from.`,
    `Understand plain, casual speech; the manager will NOT use command words. A bare remark usually implies an action: "how are we doing" → store_today; "how's Parm" → rep_report; "who's waiting" → fresh_leads; "who should we be calling" → reach_outs; "what's the story with Dana" → get_customer; "tell Jordan to confirm tomorrow" → nudge_rep; "have Parm reach out to Dana" → assign_task; "Dana showed" → appointment_outcome; "Parm's goal is twelve" → set_target; "what's tomorrow look like" → appointments tomorrow; "give me the huddle" → huddle; "what should we change" → insights; "email Ken and thank him for coming in" → email_customer; "when does it make sense for Dana" / "who opens up in the next six months" → timing; "when do our leases end" → lease_ends.`,
    `Strongly prefer ACTING on reasonable assumptions over asking. Resolve relative dates to YYYY-MM-DD. Only call ask_user when several customers match a name across different reps, or no rep can be worked out for a target or a nudge.`,
    `The team: ${members.join(", ") || "nobody yet"}. Match a rep by first name.`,
    `The app FOLLOWS you: a tool that returns a list also puts it on the manager's screen. Do NOT read a list aloud — name the top one or two and hand over to the screen ("Dana and Ken are the two to hand out; they're on screen").`,
    `Numbers matter to a manager: give the key figure plainly (units against goal, appointments needed per day, how long a lead has waited). One or two figures, not a table.`,
    `Never put a dollar amount, a payment or a rate in anything sent to a customer (email_customer, send_welcome). Figures are for the sales desk.`,
    `When finished, reply with ONE short, natural spoken sentence or two — what you did, or the answer.`,
    `What the manager says arrives as a SPEECH TRANSCRIPT and may contain recognition errors — a name spelled as ordinary words, a wrong homophone. Read for intent and repair silently against the names below. Never ask them to repeat themselves.`,
    names.length ? `Customers on the store's books (a mangled word close to one of these is almost certainly that name): ${names.join(", ")}.` : ``,
  ].filter(Boolean).join("\n");
}

// The words the speech engine should be steered toward: every customer on
// the store's books, the reps, and what they drive.
export function managerVocabulary({ limit = 400 } = {}) {
  const COMMON = new Set(["the", "and", "for", "with", "nissan", "customer", "new", "used"]);
  const names = new Set(), models = new Set();
  const add = (set, v) => String(v || "").split(/[\s/,-]+/).forEach((w) => { const t = w.replace(/[^A-Za-z'’]/g, ""); if (t.length >= 3 && !COMMON.has(t.toLowerCase())) set.add(t); });
  const t = cachedStore();
  (t && t.members || []).forEach((m) => add(names, memberName(m)));
  const book = cachedBook();
  if (book) book.rows.forEach((r) => { add(names, r.lead.name); add(models, r.lead.vehicleInterest); });
  return { names: [...names].slice(0, limit), models: [...models].slice(0, limit) };
}

export function createManagerSession() {
  return createAgentSession({
    call: async (messages) => callRelay({ system: buildSystem(await team()), tools: TOOLS, messages, max_tokens: 4096 }),
    exec: execManagerTool,
  });
}
