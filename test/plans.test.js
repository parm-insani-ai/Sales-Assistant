// The follow-up plans on their own page: the index lists every cadence —
// six by situation, three by rule — with its line; a plan opens into its
// timeline by day; an edit changes what a new customer's plan creates;
// nurture follows the first month; reset puts the default back. The
// missed-call attempts and the conversation outcomes are editable too, and
// the session reads them.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, autoCadence: true, enforceConsent: false } }));
});

// Settings hands the plans to their page.
await p.goto(APP + "/#/settings");
await p.waitForSelector('[data-fold="plan"]', { timeout: 30000 }).catch(() => fail("Settings didn't draw"));
await p.evaluate(() => { const d = document.querySelector('[data-fold="plan"]'); if (d && !d.open) d.open = true; });
await p.waitForSelector('[data-fold="plan"] [data-act="open-plans"]', { timeout: 5000 }).catch(() => fail("Settings should offer the plans page"));
await p.click('[data-fold="plan"] [data-act="open-plans"]');
await p.waitForSelector(".fp-row", { timeout: 8000 }).catch(() => fail("the plans page didn't open"));
let idx = await p.evaluate(() => ({ hash: location.hash, rows: [...document.querySelectorAll(".fp-row")].map((r) => ({ k: r.dataset.planRow, text: r.textContent.replace(/\s+/g, " ").trim() })) }));
console.log("index:", JSON.stringify(idx.rows.map((r) => r.k)));
if (idx.hash !== "#/plans" || idx.rows.map((r) => r.k).join() !== "inbound,showroom,visit,noshow,delivered,owner,nurture,attempts,outcomes,appt,care") fail("eleven plans on the index: " + JSON.stringify(idx));
if (!/14 touches over 30 days/.test(idx.rows[0].text) || !/6 attempts over about 6 days, then 60 days' rest/.test(idx.rows[7].text) || !/Call back 7 days · not now 180 days/.test(idx.rows[8].text) || !/5 touches over 180 days/.test(idx.rows[4].text) || !/Service every 6 months · winter tires from Oct 15 · summer tires from Apr 15/.test(idx.rows[10].text)) fail("each row carries its line: " + JSON.stringify(idx.rows.map((r) => r.text)));

// A plan's page: chips, the timeline by day, the steps as before.
await p.click('.fp-row[data-plan-row="inbound"]'); await p.waitForSelector(".plan-editor .plan-chips", { timeout: 8000 }).catch(() => fail("the plan editor didn't draw"));
await p.waitForTimeout(200);
const read = () => p.evaluate(() => ({
  hash: location.hash,
  chips: [...document.querySelectorAll(".plan-chips [data-plan]")].map((b) => ({ k: b.dataset.plan, on: b.classList.contains("btn-primary") })),
  steps: [...document.querySelectorAll(".plan-editor .plan-step label")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
  days: [...document.querySelectorAll(".plan-editor .fp-day-label")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
  edited: !!document.querySelector(".plan-editor .fp-head .badge"),
  reset: !!document.querySelector('.plan-editor [data-act="reset-plan"]'),
}));
let c = await read();
console.log("inbound:", JSON.stringify({ chips: c.chips.map((x) => x.k + (x.on ? "*" : "")), n: c.steps.length, first: c.steps.slice(0, 4), days: c.days.slice(0, 3) }));
if (c.hash !== "#/plans/inbound" || c.chips.map((x) => x.k).slice(0, 7).join() !== "inbound,showroom,visit,noshow,delivered,owner,nurture" || !c.chips[0].on) fail("the plan's page, inbound lit: " + JSON.stringify(c.chips));
if (c.steps.length !== 14 || !/^2 min · Call/.test(c.steps[0]) || !/^5 min · Text/.test(c.steps[1]) || !/^20 min · Call/.test(c.steps[2]) || !/^60 min · Email/.test(c.steps[3]) || !/Day 1 · 10:30 · Call/.test(c.steps[4])) fail("the inbound plan's first month, timed: " + JSON.stringify(c.steps.slice(0, 5)));
if (!/^Day 0/.test(c.days[0]) || c.days[1] !== "Day 1") fail("the timeline groups by day: " + JSON.stringify(c.days));
if (c.edited || c.reset) fail("the default plan isn't marked edited");

// Showroom (a chip switches the page): the welcome text at five minutes, then the month.
await p.click('.plan-chips [data-plan="showroom"]'); await p.waitForSelector('.plan-chips [data-plan="showroom"].btn-primary', { timeout: 5000 }); await p.waitForTimeout(200);
c = await read();
if (c.hash !== "#/plans/showroom" || c.steps.length !== 9 || !/^5 min · Text/.test(c.steps[0]) || !/Day 30/.test(c.steps[8])) fail("the showroom plan's first month: " + JSON.stringify(c.steps));
await p.click('.plan-chips [data-plan="nurture"]'); await p.waitForSelector('.plan-chips [data-plan="nurture"].btn-primary', { timeout: 5000 }); await p.waitForTimeout(200);
c = await read();
if (c.steps.length !== 11 || !/^Day 60 · Call/.test(c.steps[0]) || !/^Day 365 · Text/.test(c.steps[10])) fail("nurture: " + JSON.stringify(c.steps.slice(0, 2)));

// Edit the showroom plan: take the day-10 nudge off, add a day-3 text with a time. A new walk-in's plan follows.
await p.click('.plan-chips [data-plan="showroom"]'); await p.waitForSelector('.plan-chips [data-plan="showroom"].btn-primary', { timeout: 5000 }); await p.waitForTimeout(200);
await p.evaluate(() => { const rows = [...document.querySelectorAll(".plan-editor .plan-step")]; const r = rows.find((x) => /Day 10/.test(x.textContent)); r.querySelector("[data-del]").click(); });
await p.waitForTimeout(200);
await p.click('.plan-editor [data-act="add-step"]'); await p.waitForSelector('.modal input[name="label"]', { timeout: 5000 });
await p.fill('.modal input[name="day"]', "3");
await p.fill('.modal input[name="time"]', "14:45");
await p.selectOption('.modal select[name="channel"]', "text");
await p.selectOption('.modal select[name="intent"]', "fresh");
await p.fill('.modal input[name="label"]', "Day-three text — a unit that just landed");
await p.click(".modal button[type=submit]"); await p.waitForTimeout(300);
c = await read();
console.log("edited showroom:", JSON.stringify({ n: c.steps.length, edited: c.edited, reset: c.reset, day3: c.steps.find((s) => /Day 3/.test(s)) }));
if (c.steps.length !== 9 || !c.edited || !c.reset || !c.steps.some((s) => /^Day 3 · 14:45 · Text — Day-three text — a unit that just landed · Something new/.test(s)) || c.steps.some((s) => /Day 10/.test(s))) fail("the edit shows: " + JSON.stringify(c.steps));
const made = await p.evaluate(async () => {
  const st = await import("/js/store.js"); const cd = await import("/js/cadence.js");
  const l = st.create("leads", { name: "Walk In", phone: "9025550777", stage: "new", source: "Walk-in", vehicleInterest: "2026 Nissan Rogue SV" });
  if (!cd.hasCadence(l.id)) cd.startCadence(l.id);
  const steps = cd.planSteps(l.id).map((t) => ({ due: t.due, at: t.at, ch: t.channel, intent: t.intent, title: t.title }));
  const saved = st.getSettings().plans.showroom.map((s) => s.label);
  return { n: steps.length, day3: steps.find((t) => /just landed/.test(t.title)), nudge: steps.some((t) => /anything changed/.test(t.title)), nurture: steps.filter((t) => t.intent === "nurture").length, saved };
});
console.log("walk-in plan:", JSON.stringify({ n: made.n, day3: made.day3, nudge: made.nudge, nurture: made.nurture }));
if (made.n !== 20 || !made.day3 || !/T14:45/.test(made.day3.at || "") || made.day3.ch !== "text" || made.day3.intent !== "fresh" || made.nudge || made.nurture !== 11) fail("a new walk-in gets the edited plan plus nurture: " + JSON.stringify(made));

// Reset: the default is back, and the Edited mark goes.
await p.click('.plan-editor [data-act="reset-plan"]'); await p.waitForTimeout(300);
await p.evaluate(() => { const b = [...document.querySelectorAll(".modal button")].find((x) => /^Reset$/.test(x.textContent.trim())); if (b) b.click(); }); await p.waitForTimeout(300);
c = await read();
if (c.steps.length !== 9 || c.edited || !c.steps.some((s) => /Day 10/.test(s)) || c.steps.some((s) => /just landed/.test(s))) fail("reset puts the default back: " + JSON.stringify(c.steps));
const plansLeft = await p.evaluate(async () => { const st = await import("/js/store.js"); return Object.keys(st.getSettings().plans || {}); });
if (plansLeft.length) fail("a reset plan leaves no override: " + JSON.stringify(plansLeft));

// The owner plan is the sequence that was always in Settings; editing it saves to the same place.
await p.click('.plan-chips [data-plan="owner"]'); await p.waitForSelector('.plan-chips [data-plan="owner"].btn-primary', { timeout: 5000 }); await p.waitForTimeout(200);
c = await read();
if (c.steps.length !== 8 || !/^Day 0 · Call/.test(c.steps[0])) fail("the owner plan: " + JSON.stringify(c.steps.slice(0, 2)));
await p.evaluate(() => document.querySelector(".plan-editor .plan-step [data-del]").click()); await p.waitForTimeout(200);
const owner = await p.evaluate(async () => { const st = await import("/js/store.js"); return st.getSettings().cadence.length; });
if (owner !== 7) fail("the owner plan saves to settings.cadence: " + owner);

// --- Missed call: the attempts, editable; the session reads them.
await p.click('.plan-chips [data-plan="attempts"]'); await p.waitForSelector('.plan-editor[data-kind="attempts"]', { timeout: 5000 }); await p.waitForTimeout(200);
c = await read();
console.log("attempts:", JSON.stringify(c.steps));
if (c.steps.length !== 5 || !/^After miss 1 · Text · same day, 2 hours on · asking when's good/.test(c.steps[0]) || !/^After miss 5 · Call · in 2 days · a part of the day not yet tried/.test(c.steps[4])) fail("the five attempts after a miss, in words: " + JSON.stringify(c.steps));
// Take the fourth off; the round is five; rest 45 days.
await p.evaluate(() => document.querySelectorAll('.plan-editor[data-kind="attempts"] [data-del]')[3].click()); await p.waitForTimeout(250);
await p.fill('.plan-editor [data-f="rest"]', "45"); await p.evaluate(() => { const i = document.querySelector('.plan-editor [data-f="rest"]'); i.dispatchEvent(new Event("change", { bubbles: true })); }); await p.waitForTimeout(300);
let att = await p.evaluate(async () => { const cd = await import("/js/cadence.js"); const st = await import("/js/store.js"); return { total: cd.attemptsTotal(), rest: cd.restDays(), saved: st.getSettings().attemptPlan, edited: !!document.querySelector(".plan-editor .fp-head .badge"), line: document.querySelector(".plan-editor .fp-meta")?.textContent }; });
console.log("attempts edited:", JSON.stringify(att));
if (att.total !== 5 || att.rest !== 45 || !att.saved || att.saved.steps.length !== 4 || !att.edited || !/5 attempts over about 5 days, then 45 days' rest/.test(att.line)) fail("the attempts save and the total follows: " + JSON.stringify(att));
// Add one: a text in 3 days with two times.
await p.click('.plan-editor [data-act="add-step"]'); await p.waitForSelector('.modal select[name="channel"]', { timeout: 5000 });
await p.selectOption('.modal select[name="channel"]', "text"); await p.fill('.modal input[name="days"]', "3"); await p.selectOption('.modal select[name="intent"]', "time");
await p.click(".modal button[type=submit]"); await p.waitForTimeout(300);
c = await read();
if (c.steps.length !== 5 || !/^After miss 5 · Text · in 3 days · two times to catch them/.test(c.steps[4])) fail("an added attempt: " + JSON.stringify(c.steps));
// The session's scheduling reads the rows: five misses on someone → the fifth row (the new text), the sixth attempt.
const sched = await p.evaluate(async () => {
  const st = await import("/js/store.js"); const S = await import("/js/session.js");
  const l = st.create("leads", { name: "Missed Often", phone: "9025550788", stage: "delivered", source: "Import", currentPayment: 400, payoff: 9000, purchaseDate: "2020-01-01", smsConsent: true });
  const now = Date.now();
  for (let i = 5; i >= 1; i--) st.create("calls", { leadId: l.id, dir: "out", via: "call", at: new Date(now - i * 86400000).toISOString(), outcome: "no_answer", notes: "", logged: true });
  const r = S.scheduleNextAttempt(l.id);
  return { n: r.n, task: r.task ? { ch: r.task.channel, intent: r.task.intent, due: r.task.due, of: r.task.of, attempt: r.task.attempt } : null, line: r.line };
});
console.log("scheduled:", JSON.stringify(sched));
if (!sched.task || sched.task.ch !== "text" || sched.task.intent !== "time" || sched.task.of !== 6 || sched.task.attempt !== 6) fail("the session schedules by the edited rows: " + JSON.stringify(sched));
await p.click('.plan-editor [data-act="reset-plan"]'); await p.waitForTimeout(200);
await p.evaluate(() => { const b = [...document.querySelectorAll(".modal button")].find((x) => /^Reset$/.test(x.textContent.trim())); if (b) b.click(); }); await p.waitForTimeout(300);
att = await p.evaluate(async () => { const cd = await import("/js/cadence.js"); return { total: cd.attemptsTotal(), rest: cd.restDays(), def: cd.attemptPlanIsDefault() }; });
if (att.total !== 6 || att.rest !== 60 || !att.def) fail("reset: the six are back: " + JSON.stringify(att));

// --- After a conversation: the days, editable; the session reads them.
await p.click('.plan-chips [data-plan="outcomes"]'); await p.waitForSelector('.plan-editor[data-kind="outcomes"] input[name="notNowDays"]', { timeout: 5000 });
await p.fill('.plan-editor input[name="notNowDays"]', "90"); await p.fill('.plan-editor input[name="callbackDays"]', "3");
await p.click('.plan-editor .fp-form button[type=submit]'); await p.waitForTimeout(300);
const rules = await p.evaluate(async () => {
  const cd = await import("/js/cadence.js"); const st = await import("/js/store.js"); const S = await import("/js/session.js");
  const l = st.create("leads", { name: "Not Yet", phone: "9025550799", stage: "delivered", source: "Import", currentPayment: 400, payoff: 9000, purchaseDate: "2020-01-01" });
  const r = S.recordOutcome(l.id, "not_now", { session: false });
  const until = st.get("leads", l.id).prospectSnoozedUntil;
  const days = Math.round((new Date(until + "T12:00:00") - new Date()) / 86400000);
  const cb = S.recordOutcome(st.create("leads", { name: "Call Me", phone: "9025550711", stage: "delivered", source: "Import", purchaseDate: "2020-01-01" }).id, "callback", { session: false });
  const cbDays = Math.round((new Date(cb.tasks[0].due + "T12:00:00") - new Date()) / 86400000);
  return { rules: cd.outcomeRules(), days, cbDays, edited: !!document.querySelector(".plan-editor .fp-head .badge"), line: document.querySelector(".plan-editor .fp-meta")?.textContent };
});
console.log("outcome rules:", JSON.stringify(rules));
if (rules.rules.notNowDays !== 90 || rules.rules.callbackDays !== 3 || Math.abs(rules.days - 90) > 1 || Math.abs(rules.cbDays - 3) > 1 || !rules.edited || !/Call back 3 days · not now 90 days/.test(rules.line)) fail("not now parks for the days set; call back lands on the day set: " + JSON.stringify(rules));

// --- Appointment booked: the timings.
await p.click('.plan-chips [data-plan="appt"]'); await p.waitForSelector('.plan-editor[data-kind="appt"] input[name="apptConfirmAm"]', { timeout: 5000 });
await p.fill('.plan-editor input[name="apptConfirmAm"]', "15:30");
await p.click('.plan-editor .fp-form button[type=submit]'); await p.waitForTimeout(300);
const ap = await p.evaluate(async () => { const A = await import("/js/apptplan.js"); return { am: A.apptPresets().confirmAm, line: document.querySelector(".plan-editor .fp-meta")?.textContent }; });
if (ap.am !== "15:30" || !/Confirmation 15:30/.test(ap.line)) fail("the appointment timings save: " + JSON.stringify(ap));

// The + offers it under Tools.
await p.click("#quick-add"); await p.waitForSelector(".modal .qa-tile", { timeout: 8000 });
const tile = await p.evaluate(() => [...document.querySelectorAll(".modal .qa-tile")].map((t) => t.textContent.trim()).includes("Follow-up plans"));
if (!tile) fail("the + should offer Follow-up plans under Tools");
await p.evaluate(() => { const t = [...document.querySelectorAll(".modal .qa-tile")].find((x) => x.textContent.trim() === "Follow-up plans"); t.click(); });
await p.waitForSelector(".fp-row", { timeout: 8000 }).catch(() => fail("the + tile opens the plans"));

// The Queue's head offers the plans too.
await p.evaluate(() => { try { sessionStorage.setItem("viniva:log:open", "queue"); } catch {} location.hash = "#/log"; });
await p.waitForSelector('.log-panel[data-panel="queue"] [data-act="plans"]', { timeout: 8000 }).catch(() => fail("the Queue should link to the plans"));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nplans.test.js FAILED" : "\nplans.test.js passed");
})();
