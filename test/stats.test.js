// The statistics, from a made-up event log: speed to lead, pushes, the
// follow-up steps, the welcome's timing, confirmations, the manager's
// taps, the agent, when things happen, discipline — and the sentences,
// which say nothing below their thresholds.
const assert = require("assert");
(async () => {
const S = await import("../js/stats.js");
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const T0 = new Date("2026-10-05T13:00:00").getTime();
const MIN = 60000, H = 3600000, D = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const ev = [];
const add = (kind, at, extra = {}) => ev.push({ kind, at: iso(at), by: "rep", prompt: "", ...extra });

// Ten leads for Parm (fast) and ten for Dana (slow); each gets a welcome at a
// different delay; half reply; appointments on some, confirmed on half,
// outcomes on all past ones.
for (let i = 0; i < 10; i++) {
  const arrive = T0 + i * D + (i % 3) * H;                 // different hours of the day
  add("lead_new", arrive, { leadId: "p" + i, rep: "U1", meta: { source: "Web" } });
  add("text_out", arrive + (3 + i) * MIN, { leadId: "p" + i, rep: "U1", prompt: "intro" }); // 3..12 min
  if (i % 2 === 0) add("text_in", arrive + 40 * MIN, { leadId: "p" + i, rep: "U1", by: "customer" });
  add("text_out", arrive + 2 * D, { leadId: "p" + i, rep: "U1", prompt: "value" });
  if (i < 6) add("appt_set", arrive + 2 * D + 20 * MIN, { leadId: "p" + i, rep: "U1", meta: { apptId: "ap" + i, when: iso(arrive + 4 * D).slice(0, 16) } });
  if (i < 3) add("appt_confirmed", arrive + 3 * D, { leadId: "p" + i, rep: "U1", meta: { apptId: "ap" + i } });
  if (i < 6) add(i < 3 || i === 4 ? "appt_showed" : "appt_no_show", arrive + 4 * D + H, { leadId: "p" + i, rep: "U1", meta: { apptId: "ap" + i } });
}
for (let i = 0; i < 10; i++) {
  const arrive = T0 + i * D + 5 * H;
  add("logged", arrive, { leadId: "d" + i, rep: "U2" });
  add("text_out", arrive + (90 + i * 10) * MIN, { leadId: "d" + i, rep: "U2", prompt: "intro" }); // 90..180 min
  if (i % 5 === 0) add("text_in", arrive + 3 * H, { leadId: "d" + i, rep: "U2", by: "customer" });
}
// Pushes: twelve received, eight opened, five acted on.
for (let i = 0; i < 12; i++) {
  const at = T0 + i * D + 9 * H;
  add("push_received", at, { prompt: "lead:p" + i, rep: "U1" });
  if (i < 8) add("push_open", at + 4 * MIN, { prompt: "lead:p" + i, rep: "U1", meta: { action: i < 2 ? "showed" : "" } });
  if (i < 5) add("call", at + 10 * MIN, { leadId: "p" + i, rep: "U1", meta: { outcome: "reached" } });
}
// The manager's taps: seven nudges, four followed by an appointment inside a day.
for (let i = 0; i < 7; i++) {
  const at = T0 + i * D + 11 * H;
  add("mgr_nudge", at, { leadId: "d" + i, by: "manager", rep: "U3", meta: { rep: "U2" } });
  if (i < 4) add("appt_set", at + 3 * H, { leadId: "d" + i, rep: "U2", meta: { apptId: "dp" + i } });
}
// The agent: seven confirmation texts, five of those showed; nine hand-outs, six worked, three booked.
for (let i = 0; i < 7; i++) { const at = T0 + i * D + 17 * H; add("text_out", at, { leadId: "p" + i, by: "agent", prompt: "manager-confirm", rep: "U1" }); if (i < 5) add("appt_showed", at + 20 * H, { leadId: "p" + i, rep: "U1", meta: { apptId: "ac" + i } }); }
for (let i = 0; i < 9; i++) { const at = T0 + i * D + 8 * H; add("task_handed", at, { leadId: "h" + i, by: "agent", prompt: "reach", rep: "U2" }); if (i < 6) add("call", at + 5 * H, { leadId: "h" + i, rep: "U2" }); if (i < 3) add("appt_set", at + 2 * D, { leadId: "h" + i, rep: "U2", meta: { apptId: "hp" + i } }); }

const now = T0 + 14 * D;
const appts = [...Array(6)].map((_, i) => ({ id: "ap" + i, when: iso(T0 + i * D + 4 * D).slice(0, 16), status: "scheduled", outcome: i < 5 ? "showed" : "" }));
const s = S.allStats(S.inWindow(ev, { now, days: 28 }), { appointments: appts, now });
console.log(JSON.stringify({ speed: { n: s.speed.n, med: s.speed.medianMin, w10: s.speed.within10Pct, reps: s.speed.byRep }, pushes: s.pushes, steps: s.steps.steps, welcome: s.welcome, confirm: s.confirm, taps: s.taps, agent: s.agent, disc: s.discipline, peak: s.when.peak }, null, 1));

// Speed: 20 leads; Parm's median 7.5 → 8 (3..12), Dana's 135; the store's within-10 is Parm's 8 of 10.
if (s.speed.n !== 20 || s.speed.within10Pct !== 40) fail("speed to lead counts are wrong: " + JSON.stringify([s.speed.n, s.speed.within10Pct]));
if (s.speed.byRep[0].rep !== "U1" || s.speed.byRep[0].medianMin !== 8 || s.speed.byRep[1].rep !== "U2" || s.speed.byRep[1].medianMin !== 135) fail("speed by rep is wrong: " + JSON.stringify(s.speed.byRep));
// Pushes: 12 received, 8 opened (67%), 5 acted (42%), opened 4 min after landing.
if (s.pushes.received !== 12 || s.pushes.opened !== 8 || s.pushes.acted !== 5 || s.pushes.openPct !== 67 || s.pushes.actPct !== 42 || s.pushes.medianOpenMin !== 4) fail("the push read is wrong: " + JSON.stringify(s.pushes));
// Steps: intro sent 20 (Parm 10, Dana 10), replied 7 of 20 = 35%, booked 4 inside a day (Dana's d0..d3, after the manager's nudges); value sent 10, booked 6 of 10.
const intro = s.steps.steps.find((x) => x.step === "intro"), value = s.steps.steps.find((x) => x.step === "value");
if (!intro || intro.n !== 20 || intro.replyPct !== 35 || intro.bookPct !== 20 || !value || value.n !== 10 || value.bookPct !== 60) fail("the step read is wrong: " + JSON.stringify(s.steps.steps));
if (!s.steps.best || s.steps.best.step !== "value" || s.steps.worst.step !== "intro") fail("best and worst step are wrong: " + JSON.stringify([s.steps.best, s.steps.worst]));
// Welcome timing: Parm's ten inside an hour (5 replies = 50%), Dana's: 90..110 → one-to-two (3: 90,100,110; replies at i=0 → 33%), 120+ → after two hours (7; reply at i=5 → 14%).
const wb = s.welcome.buckets;
if (s.welcome.n !== 20 || wb[0].n !== 10 || wb[0].replyPct !== 50 || wb[1].n !== 3 || wb[2].n !== 7 || wb[2].replyPct !== 14) fail("the welcome timing read is wrong: " + JSON.stringify(s.welcome));
// Confirmations: three confirmed, all showed; three unconfirmed (ap3..5), one showed (ap4) = 33%.
// The agent's ac* appointments have a showed but no set inside the window, so they don't count.
if (s.confirm.confirmed.n !== 3 || s.confirm.confirmed.showPct !== 100 || s.confirm.unconfirmed.n !== 3 || s.confirm.unconfirmed.showPct !== 33) fail("the confirmation read is wrong: " + JSON.stringify(s.confirm));
// Taps: 7 nudges, 4 booked = 57%.
if (s.taps.n !== 7 || s.taps.booked !== 4 || s.taps.pct !== 57 || s.taps.kinds[0].label !== "Nudges") fail("the taps read is wrong: " + JSON.stringify(s.taps));
// The agent: 7 confirms, 5 showed (71%); 9 hand-outs, 6 worked (67%), 3 booked (33%).
if (s.agent.confirm.n !== 7 || s.agent.confirm.showedPct !== 71 || s.agent.handed.n !== 9 || s.agent.handed.workedPct !== 67 || s.agent.handed.bookedPct !== 33) fail("the agent read is wrong: " + JSON.stringify(s.agent));
// Discipline: 5 of 6 past appointments marked (83%); 20 leads arrived, all touched.
if (s.discipline.pastN !== 6 || s.discipline.outcomesPct !== 83 || s.discipline.leadsN !== 20 || s.discipline.touchedPct !== 100) fail("the discipline read is wrong: " + JSON.stringify(s.discipline));

// The sentences, for the manager with names, and for Parm alone.
const lines = S.insights(s, { who: "manager", names: { U1: "Parm", U2: "Dana" } });
console.log(lines.map((l) => l.key + ": " + l.text).join("\n"));
const has = (k) => lines.find((l) => l.key === k);
if (!has("speed") || !/First contact takes \d+ min at the median; 40% of leads hear from us inside ten minutes\./.test(has("speed").text)) fail("the speed sentence is wrong");
if (!has("speed-gap") || !/^Parm answers a new lead in 8 min; Dana in 135\.$/.test(has("speed-gap").text)) fail("the speed gap sentence is wrong: " + JSON.stringify(has("speed-gap")));
if (!has("pushes") || !/67% of the pushes get opened and 42% lead to something done inside half an hour, 4 min after they land\./.test(has("pushes").text)) fail("the push sentence is wrong: " + JSON.stringify(has("pushes")));
if (!has("steps") || !/The "value" text books 60% of the time; "intro" 20%\./.test(has("steps").text)) fail("the steps sentence is wrong: " + JSON.stringify(has("steps")));
if (has("confirm")) fail("three of each is below the confirmation sentence's bar of six");
if (!has("taps") || !/57% of your taps had an appointment set within a day; nudges work best at 57%\./.test(has("taps").text)) fail("the taps sentence is wrong: " + JSON.stringify(has("taps")));
if (!has("agent-confirm") || !has("agent-handed")) fail("the agent sentences are missing");
if (has("outcomes")) fail("83% marked shouldn't be flagged (the bar is 80)");
// The rep's own: no taps line, no by-rep gap, "Your" wording.
const mine = S.insights(S.allStats(S.inWindow(ev.filter((e) => e.rep === "U1"), { now, days: 28 }), { appointments: appts, now }), { who: "rep" });
if (mine.some((l) => l.key === "taps" || l.key === "speed-gap")) fail("the rep's sentences carry the manager's");
if (!mine.some((l) => /^Your first contact takes 8 min at the median; 80% of your leads hear from you inside ten minutes\./.test(l.text))) fail("the rep's speed sentence is wrong: " + JSON.stringify(mine));
// Too little says nothing.
if (S.insights(S.allStats(ev.slice(0, 6), {})).length) fail("six events produced a sentence");

console.log(process.exitCode ? "\nstats.test.js FAILED" : "\nstats.test.js passed");
})().catch((e) => { console.error(e); process.exit(1); });
