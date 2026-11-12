// The follow-up plans, one per situation, and the auto-send switch.
//   · an internet lead gets call · text · call · email in the first hour,
//     then a call and a text on day one, and a touch a month to a year
//   · a showroom visit gets the text at five minutes and the call next morning
//   · showed-no-sale replaces the plan with the visit plan
//   · a no-show starts the recovery sequence from the slot's time
//   · a plan call that rings out gets the same-day text and the retry
//   · auto-send off: nothing goes; on: the eligible texts go at their
//     moment, inside hours and consent, never to someone who just replied,
//     never past the cap; the task is ticked as sent automatically
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], vehicles: [], settings: { salesperson: "Parm", dealership: "Test Nissan", cloudAutoSync: false, dailyProspects: 10, taxRate: 14, docFee: 699, defaultApr: 7.9, defaultTerm: 72, hoursFrom: 0, hoursTo: 24, autoCadence: true, autoSend: "off", agentUrl: "https://example.invalid/fn", smsFrom: "+19025550100" } }));
  function Fake() { this.start = () => {}; this.stop = () => {}; this.abort = () => {}; }
  window.SpeechRecognition = Fake; window.webkitSpeechRecognition = Fake;
});
await p.goto(APP + "/#/");
await p.waitForTimeout(800);

const plan = (id) => p.evaluate(async (id) => { const st = await import("/js/store.js"); return st.all("tasks").filter((t) => t.leadId === id && t.cadence && !t.done).sort((a, b) => String(a.at).localeCompare(String(b.at))).map((t) => ({ ch: t.channel, intent: t.intent, due: t.due, at: t.at, kind: t.kind, title: t.title })); }, id);

// --- Internet lead: the first hour, day one, and a year.
const inbound = await p.evaluate(async () => {
  const st = await import("/js/store.js"); const c = await import("/js/cadence.js");
  const l = st.create("leads", { name: "Web Lead Example", phone: "9025550001", email: "web@example.com", vehicleInterest: "2026 Nissan Rogue SV", stage: "new", source: "Internet", consent: { basis: "express" } });
  const n = c.startCadence(l.id);
  return { id: l.id, n };
});
let steps = await plan(inbound.id);
const firstHour = steps.filter((s) => { const ms = new Date(s.at) - Date.now(); return ms < 70 * 60000; }).map((s) => s.ch).join(",");
console.log("inbound:", inbound.n, "steps; first hour:", firstHour, "| last:", steps[steps.length - 1].due);
if (firstHour !== "call,text,call,email") fail("an internet lead's first hour is call · text · call · email: " + firstHour);
const day1 = steps.filter((s) => s.due === new Date(Date.now() + 86400000).toISOString().slice(0, 10)).map((s) => s.ch).join(",");
if (day1 !== "call,text") fail("day one is a call and a text: " + day1);
if (!steps.some((s) => s.intent === "time") || steps.filter((s) => s.intent === "nurture").length < 10) fail("two times by day five, and a touch a month to a year: " + JSON.stringify(steps.map((s) => s.intent)));
const lastDue = (new Date(steps[steps.length - 1].due) - Date.now()) / 86400000;
if (lastDue < 350) fail("the plan should run a year: last step in " + Math.round(lastDue) + " days");

// --- Showroom visit: text at five minutes, the call next morning, no same-day call.
const walk = await p.evaluate(async () => {
  const st = await import("/js/store.js"); const c = await import("/js/cadence.js");
  const l = st.create("leads", { name: "Walk In Example", phone: "9025550002", vehicleInterest: "2026 Nissan Kicks SR", stage: "new", source: "Walk-in", consent: { basis: "express" } });
  c.startCadence(l.id);
  return l.id;
});
steps = await plan(walk);
const today = new Date().toISOString().slice(0, 10);
const todays = steps.filter((s) => s.due === today).map((s) => s.ch).join(",");
console.log("showroom today:", todays, "| next:", steps.find((s) => s.due > today)?.ch, steps.find((s) => s.due > today)?.at);
if (todays !== "text" || steps.find((s) => s.due > today).ch !== "call" || !/T11:00/.test(steps.find((s) => s.due > today).at)) fail("a showroom visit: the text today, the call next morning: " + JSON.stringify(steps.slice(0, 3)));

// --- Showed, didn't buy: the visit plan replaces the plan.
const visit = await p.evaluate(async (id) => {
  const st = await import("/js/store.js"); const ap = await import("/js/apptplan.js");
  const when = new Date(Date.now() - 2 * 3600000); const pad = (n) => String(n).padStart(2, "0");
  const a = st.create("appointments", { leadId: id, customerName: "Walk In Example", type: "appointment", when: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`, status: "scheduled" });
  st.update("appointments", a.id, { outcome: "showed" });
  ap.onAppointmentOutcome(a.id);
  const all = st.all("tasks").filter((t) => t.leadId === id && t.cadence);
  return { replaced: all.filter((t) => t.doneBy === "replaced").length, open: all.filter((t) => !t.done).sort((x, y) => String(x.at).localeCompare(String(y.at))).map((t) => ({ ch: t.channel, intent: t.intent, kind: t.kind, at: t.at })) };
}, walk);
console.log("visit:", visit.replaced, "replaced; first:", JSON.stringify(visit.open.slice(0, 3)));
if (!visit.replaced || visit.open[0].kind !== "visit" || visit.open[0].intent !== "visit" || visit.open[0].ch !== "text" || visit.open[1].ch !== "call" || visit.open[2].intent !== "time") fail("showed-no-sale should replace the plan: thank-you text within the hour, the call tomorrow, two times the day after: " + JSON.stringify(visit));
const firstAt = new Date(visit.open[0].at) - Date.now();
if (firstAt < 0 || firstAt > 5 * 60000) fail("the thank-you is due about now (the slot was two hours ago): " + visit.open[0].at);

// --- No-show: the recovery sequence, the old plan steps back a week.
const noshow = await p.evaluate(async (id) => {
  const st = await import("/js/store.js"); const ap = await import("/js/apptplan.js");
  const before = st.all("tasks").filter((t) => t.leadId === id && t.cadence && !t.done).map((t) => t.due).sort()[0];
  const when = new Date(Date.now() - 20 * 60000); const pad = (n) => String(n).padStart(2, "0");
  const a = st.create("appointments", { leadId: id, customerName: "Web Lead Example", type: "appointment", when: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`, status: "scheduled" });
  st.update("appointments", a.id, { outcome: "no_show" });
  ap.onAppointmentOutcome(a.id);
  const open = st.all("tasks").filter((t) => t.leadId === id && t.cadence && !t.done).sort((x, y) => String(x.at).localeCompare(String(y.at)));
  // The welcome text stays where it is (deferPlan); every other plan step steps back.
  return { before, seq: open.filter((t) => t.kind === "noshow").map((t) => ({ ch: t.channel, intent: t.intent, at: t.at })), planNext: open.filter((t) => t.kind === "plan" && !(t.intent === "intro" && t.channel === "text")).map((t) => t.due).sort()[0] };
}, inbound.id);
console.log("no-show:", JSON.stringify(noshow.seq.slice(0, 3)), "plan was", noshow.before, "now", noshow.planNext);
if (noshow.seq.length !== 5 || noshow.seq[0].intent !== "noshow" || noshow.seq[0].ch !== "text" || noshow.seq[1].ch !== "call" || noshow.seq[2].intent !== "time") fail("a no-show starts text · call · two times · call · nudge: " + JSON.stringify(noshow.seq));
if (noshow.planNext <= today) fail("the plan should step back behind the recovery: " + JSON.stringify(noshow));

// --- A plan call that rings out: the same-day text and the retry, the plan intact, no rest.
const miss = await p.evaluate(async () => {
  const st = await import("/js/store.js"); const c = await import("/js/cadence.js"); const s = await import("/js/session.js");
  const l = st.create("leads", { name: "Miss Example", phone: "9025550003", vehicleInterest: "2026 Nissan Sentra", stage: "new", source: "Walk-in", consent: { basis: "express" } });
  c.startCadence(l.id);
  // The welcome text has gone; the next plan text is days away.
  st.all("tasks").filter((t) => t.leadId === l.id && t.cadence && t.channel === "text" && t.due === new Date().toISOString().slice(0, 10)).forEach((t) => st.update("tasks", t.id, { done: true, doneBy: "text" }));
  const before = st.all("tasks").filter((t) => t.leadId === l.id && t.cadence && !t.done).length;
  st.logContact(l.id, { via: "call", outcome: "no_answer" });
  const r = s.scheduleNextAttempt(l.id);
  const now = st.all("tasks").filter((t) => t.leadId === l.id && !t.done);
  return { before, after: now.length, line: r.line, added: now.filter((t) => t.sequence).map((t) => ({ ch: t.channel, intent: t.intent })), rested: !!st.get("leads", l.id).restedAt };
});
console.log("plan miss:", JSON.stringify(miss));
if (miss.after < miss.before + 1 || !miss.added.some((t) => t.ch === "text" && t.intent === "missed") || miss.rested || !/plan carries on/.test(miss.line)) fail("a plan call that rings out adds the when's-good text and keeps the plan: " + JSON.stringify(miss));

// --- Auto-send. Off: nothing. On: the eligible go, with the reasons for the rest.
const auto = await p.evaluate(async () => {
  const st = await import("/js/store.js"); const a = await import("/js/autosend.js");
  const sent = [];
  const send = async (lead, body) => { sent.push({ to: lead.name, body }); const row = st.create("texts", { leadId: lead.id, dir: "out", body, phone: lead.phone, at: new Date().toISOString(), status: "sent" }); return { ok: true, id: row.id }; };
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const mk = (leadId, extra = {}) => st.create("tasks", { title: "Text — step", leadId, channel: "text", cadence: true, intent: "nudge", done: false, due: new Date().toISOString().slice(0, 10), at: ago(5), readyAt: ago(5), ...extra });
  const ok = st.create("leads", { name: "Ready Example", phone: "9025550010", vehicleInterest: "2026 Nissan Rogue", stage: "working", source: "Walk-in", consent: { basis: "express" } });
  // An imported owner, no enquiry, no purchase on file, no consent record: nothing to text on.
  const noConsent = st.create("leads", { name: "NoConsent Example", phone: "9025550011", vehicleInterest: "2019 Nissan Rogue", stage: "delivered", source: "Import" });
  const replied = st.create("leads", { name: "Replied Example", phone: "9025550012", vehicleInterest: "2026 Nissan Rogue", stage: "working", source: "Walk-in", consent: { basis: "express" } });
  st.create("texts", { leadId: replied.id, dir: "in", body: "yes tomorrow works", at: ago(60), status: "received" });
  const held = st.create("leads", { name: "Held Example", phone: "9025550013", vehicleInterest: "2026 Nissan Rogue", stage: "working", source: "Walk-in", consent: { basis: "express" }, autoHold: true });
  const later = st.create("leads", { name: "Later Example", phone: "9025550014", vehicleInterest: "2026 Nissan Rogue", stage: "working", source: "Walk-in", consent: { basis: "express" } });
  const t1 = mk(ok.id), t2 = mk(noConsent.id), t3 = mk(replied.id), t4 = mk(held.id);
  const t5 = mk(later.id, { at: new Date(Date.now() + 3600000).toISOString(), readyAt: new Date(Date.now() + 3600000).toISOString() });
  // An appointment confirmation with its body written.
  const t6 = st.create("tasks", { title: "Text Ready — confirm", leadId: ok.id, channel: "text", apptPlan: "confirm", apptId: "a1", body: "Hi Ready, confirming tomorrow at 10. Reply YES to confirm.", done: false, due: new Date().toISOString().slice(0, 10), at: ago(2), readyAt: ago(2) });
  st.updateSettings({ enforceConsent: true });
  // Off: nothing moves.
  const off = await a.autoSendSweep({ send });
  // On.
  st.updateSettings({ autoSend: "plan" });
  const on = await a.autoSendSweep({ send });
  const task = (id) => { const t = st.get("tasks", id); return { done: !!t.done, by: t.doneBy || "" }; };
  const why = (id) => (on.skipped.find((s) => s.taskId === id) || {}).why || "";
  // The cap.
  st.updateSettings({ autoDailyCap: 2 });
  const t7 = mk(ok.id, { intent: "fresh" });
  const capped = await a.autoSendSweep({ send });
  return { off: off.sent, on: on.sent, sent: sent.map((s) => s.to), t1: task(t1.id), t6: task(t6.id), auto: st.all("texts").filter((t) => t.auto).length, whyConsent: why(t2.id), whyReplied: why(t3.id), whyHeld: why(t4.id), later: !!st.get("tasks", t5.id).done, capped: capped.sent, whyCap: (capped.skipped.find((s) => s.taskId === t7.id) || {}).why || "" };
});
console.log("auto:", JSON.stringify(auto));
if (auto.off !== 0) fail("auto-send off sends nothing: " + JSON.stringify(auto));
if (auto.on !== 2 || !auto.t1.done || auto.t1.by !== "auto" || !auto.t6.done || auto.auto !== 2) fail("auto-send on sends the ready plan text and the confirmation, ticked as auto: " + JSON.stringify(auto));
if (!/consent/.test(auto.whyConsent) || !/replied/.test(auto.whyReplied) || !/held/.test(auto.whyHeld) || auto.later) fail("no consent, a recent reply, a held customer and a text not yet due all wait for a tap: " + JSON.stringify(auto));
if (auto.capped !== 0 || !/cap/.test(auto.whyCap)) fail("the daily cap holds: " + JSON.stringify(auto));

// --- The switch in Settings writes the setting.
await p.evaluate(() => { location.hash = "#/settings"; }); await p.waitForTimeout(700);
await p.evaluate(() => { const f = document.querySelector('[data-fold="plan"] summary, [data-fold="plan"] .fold-head, details#fold-plan summary'); if (f) f.click(); });
await p.waitForTimeout(300);
const sw = await p.evaluate(async () => { const el = document.querySelector("#s-autosend"); if (!el) return { found: false }; const was = el.checked; el.click(); el.dispatchEvent(new Event("change", { bubbles: true })); const st = await import("/js/store.js"); return { found: true, was, now: st.getSettings().autoSend }; });
console.log("switch:", JSON.stringify(sw));
if (!sw.found || sw.now !== (sw.was ? "off" : "plan")) fail("the Settings switch should flip auto-send: " + JSON.stringify(sw));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nfollowup.test.js FAILED" : "\nfollowup.test.js passed");
})();
