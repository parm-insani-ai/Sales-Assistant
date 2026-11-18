// The follow-up plans in Settings: six plans to pick from, each listing its
// touches; an edit changes what a new customer's plan creates; nurture
// follows the first month; reset puts the default back.
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
await p.goto(APP + "/#/settings");
await p.waitForSelector('[data-fold="plan"]', { timeout: 30000 }).catch(() => fail("Settings didn't draw"));
await p.evaluate(() => { const d = document.querySelector('[data-fold="plan"]'); if (d && !d.open) d.open = true; });
await p.waitForSelector(".plan-editor .plan-chips", { timeout: 5000 }).catch(() => fail("the plan editor didn't draw"));
await p.waitForTimeout(200);

const read = () => p.evaluate(() => ({
  chips: [...document.querySelectorAll(".plan-chips [data-plan]")].map((b) => ({ k: b.dataset.plan, on: b.classList.contains("btn-primary") })),
  steps: [...document.querySelectorAll(".plan-editor .plan-step label")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
  edited: !!document.querySelector(".plan-editor .badge"),
  reset: !!document.querySelector('.plan-editor [data-act="reset-plan"]'),
}));
let c = await read();
console.log("inbound:", JSON.stringify({ chips: c.chips.map((x) => x.k + (x.on ? "*" : "")), n: c.steps.length, first: c.steps.slice(0, 4) }));
if (c.chips.map((x) => x.k).join() !== "inbound,showroom,visit,noshow,owner,nurture" || !c.chips[0].on) fail("six plans, inbound first: " + JSON.stringify(c.chips));
if (c.steps.length !== 14 || !/^2 min · Call/.test(c.steps[0]) || !/^5 min · Text/.test(c.steps[1]) || !/^20 min · Call/.test(c.steps[2]) || !/^60 min · Email/.test(c.steps[3]) || !/Day 1 · 10:30 · Call/.test(c.steps[4])) fail("the inbound plan's first month, timed: " + JSON.stringify(c.steps.slice(0, 5)));
if (c.edited || c.reset) fail("the default plan isn't marked edited");

// Showroom: the welcome text at five minutes, then the month (nurture not listed here — it follows).
await p.click('.plan-chips [data-plan="showroom"]'); await p.waitForTimeout(200);
c = await read();
if (c.steps.length !== 9 || !/^5 min · Text/.test(c.steps[0]) || !/Day 30/.test(c.steps[8])) fail("the showroom plan's first month: " + JSON.stringify(c.steps));
// Nurture: eleven monthly touches.
await p.click('.plan-chips [data-plan="nurture"]'); await p.waitForTimeout(200);
c = await read();
if (c.steps.length !== 11 || !/^Day 60 · Call/.test(c.steps[0]) || !/^Day 365 · Text/.test(c.steps[10])) fail("nurture: " + JSON.stringify(c.steps.slice(0, 2)));

// Edit the showroom plan: take the day-10 nudge off, add a day-3 text with a time. A new walk-in's plan follows.
await p.click('.plan-chips [data-plan="showroom"]'); await p.waitForTimeout(200);
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

// Reset: the default is back, and the chip's Edited mark goes.
await p.click('.plan-editor [data-act="reset-plan"]'); await p.waitForTimeout(300);
await p.evaluate(() => { const b = [...document.querySelectorAll(".modal button")].find((x) => /^Reset$/.test(x.textContent.trim())); if (b) b.click(); }); await p.waitForTimeout(300);
c = await read();
if (c.steps.length !== 9 || c.edited || !c.steps.some((s) => /Day 10/.test(s)) || c.steps.some((s) => /just landed/.test(s))) fail("reset puts the default back: " + JSON.stringify(c.steps));
const plansLeft = await p.evaluate(async () => { const st = await import("/js/store.js"); return Object.keys(st.getSettings().plans || {}); });
if (plansLeft.length) fail("a reset plan leaves no override: " + JSON.stringify(plansLeft));

// The owner plan is the sequence that was always in Settings; editing it saves to the same place.
await p.click('.plan-chips [data-plan="owner"]'); await p.waitForTimeout(200);
c = await read();
if (c.steps.length !== 8 || !/^Day 0 · Call/.test(c.steps[0])) fail("the owner plan: " + JSON.stringify(c.steps.slice(0, 2)));
await p.evaluate(() => document.querySelector(".plan-editor .plan-step [data-del]").click()); await p.waitForTimeout(200);
const owner = await p.evaluate(async () => { const st = await import("/js/store.js"); return st.getSettings().cadence.length; });
if (owner !== 7) fail("the owner plan saves to settings.cadence: " + owner);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nplans.test.js FAILED" : "\nplans.test.js passed");
})();
