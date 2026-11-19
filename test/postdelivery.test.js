// After delivery: the plan's steps become the post-delivery tasks (thank-you,
// the week's call, the 30-day referral ask, three months, the first service),
// edited on the Plans page like any plan; and the Service & tires rule puts a
// service nudge and the seasonal tire swap on the Queue as occasions.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Parm Shokar", dealership: "O'Regan's Nissan", cloudAutoSync: false, reviewLink: "https://g.page/r/example/review" } }));
});
await p.goto(APP + "/#/plans/delivered");
await p.waitForSelector('.plan-editor[data-kind="delivered"] .plan-step', { timeout: 30000 }).catch(() => fail("the After delivery plan didn't open"));
let c = await p.evaluate(() => ({ steps: [...document.querySelectorAll(".plan-editor .plan-step label")].map((n) => n.textContent.replace(/\s+/g, " ").trim()), days: [...document.querySelectorAll(".fp-day-label")].map((n) => n.textContent.trim().split(" ·")[0]) }));
console.log("delivered plan:", JSON.stringify(c));
if (c.steps.length !== 5 || c.days.join() !== "Day 1,Day 7,Day 30,Day 90,Day 180" || !/Day 1 · Text — Day-after thank you — and the review ask · Thank you after delivery/.test(c.steps[0]) || !/Day 7 · Call — One-week call/.test(c.steps[1]) || !/Day 30 · Text — 30-day check-in — and the referral ask · Referral ask/.test(c.steps[2]) || !/Day 180 · Text — First service — offer to book it · Service due/.test(c.steps[4])) fail("the five steps: " + JSON.stringify(c));

// A delivery completes: the tasks follow the plan, texts with ready bodies.
let made = await p.evaluate(async () => {
  const st = await import("/js/store.js"); const C = await import("/js/connections.js");
  const l = st.create("leads", { name: "Dana Example", phone: "9025550101", stage: "sold", source: "Walk-in", vehicleInterest: "2026 Nissan Rogue SV" });
  const n = C.afterDeliveryComplete({ leadId: l.id, customerName: l.name, vehicle: "2026 Nissan Rogue SV" });
  const today = new Date(); const d = (k) => { const t = new Date(today.getFullYear(), today.getMonth(), today.getDate() + k); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
  const tasks = st.all("tasks").filter((t) => t.leadId === l.id && t.postDelivery).sort((a, b) => a.due.localeCompare(b.due));
  return { n, leadId: l.id, tasks: tasks.map((t) => ({ due: t.due, ch: t.channel, intent: t.intent, title: t.title, body: t.body, step: t.step, of: t.of, at: t.at, ready: !!t.readyAt })), expect: [d(1), d(7), d(30), d(90), d(180)] };
});
console.log("tasks:", JSON.stringify(made.tasks.map((t) => [t.due, t.ch, t.intent])));
if (made.n !== 5 || made.tasks.map((t) => t.due).join() !== made.expect.join() || made.tasks.map((t) => t.ch).join() !== "text,call,text,text,text" || made.tasks.map((t) => t.intent).join() !== "thanks,check,referral,check,service") fail("the five tasks on their days: " + JSON.stringify(made));
if (made.tasks[0].at !== made.expect[0] + "T10:15" || made.tasks[1].at !== made.expect[1] + "T11:00" || !made.tasks.every((t) => t.ready)) fail("each step at the channel's usual hour, with its ready time: " + JSON.stringify(made.tasks.map((t) => t.at)));
if (!/Congrats again on the 2026 Nissan Rogue SV/.test(made.tasks[0].body) || !/g\.page\/r\/example\/review/.test(made.tasks[0].body) || made.tasks[1].body !== "" || !/send them my way/.test(made.tasks[2].body) || !/3 months with the 2026 Nissan Rogue SV/.test(made.tasks[3].body) || !/first service/.test(made.tasks[4].body) || made.tasks[4].of !== 5) fail("ready bodies by intent, the review link on day one: " + JSON.stringify(made.tasks.map((t) => t.body)));
// A second completion for the same customer adds nothing.
const again = await p.evaluate(async (id) => { const C = await import("/js/connections.js"); return C.afterDeliveryComplete({ leadId: id, vehicle: "x" }); }, made.leadId);
if (again !== 0) fail("the plan is queued once per customer: " + again);

// Edit the plan: take the three-month text off, add a day-365 tires text. The next delivery follows.
await p.evaluate(() => { const rows = [...document.querySelectorAll(".plan-editor .plan-step")]; rows.find((x) => /Day 90/.test(x.textContent)).querySelector("[data-del]").click(); }); await p.waitForTimeout(200);
await p.click('.plan-editor [data-act="add-step"]'); await p.waitForSelector('.modal input[name="label"]', { timeout: 5000 });
await p.fill('.modal input[name="day"]', "365"); await p.selectOption('.modal select[name="channel"]', "text"); await p.selectOption('.modal select[name="intent"]', "tires"); await p.fill('.modal input[name="label"]', "One year — winter tires and a check-over");
await p.click(".modal button[type=submit]"); await p.waitForTimeout(300);
made = await p.evaluate(async () => {
  const st = await import("/js/store.js"); const C = await import("/js/connections.js");
  const l = st.create("leads", { name: "Sam Example", phone: "9025550102", stage: "sold", source: "Walk-in", vehicleInterest: "2026 Nissan Kicks SR" });
  const n = C.afterDeliveryComplete({ leadId: l.id, vehicle: "2026 Nissan Kicks SR" });
  const tasks = st.all("tasks").filter((t) => t.leadId === l.id && t.postDelivery).sort((a, b) => a.due.localeCompare(b.due));
  return { n, intents: tasks.map((t) => t.intent), last: tasks[tasks.length - 1], edited: !!document.querySelector(".plan-editor .fp-head .badge") };
});
console.log("edited:", JSON.stringify({ n: made.n, intents: made.intents, last: made.last && made.last.body }));
if (made.n !== 5 || made.intents.join() !== "thanks,check,referral,service,tires" || !/tire season/i.test(made.last.body) || !made.edited) fail("the edited plan runs for the next delivery: " + JSON.stringify(made));

// --- Service & tires: an owner delivered seven months ago with no service on file is due; the tire swap on its date.
const occ = await p.evaluate(async () => {
  const st = await import("/js/store.js"); const O = await import("/js/occasions.js"); const cd = await import("/js/cadence.js");
  const ago = (days) => { const t = new Date(Date.now() - days * 86400000); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
  const l = st.create("leads", { name: "Lee Owner", phone: "9025550103", stage: "delivered", source: "Import", vehicleInterest: "2025 Nissan Pathfinder" });
  st.create("sales", { leadId: l.id, customerName: l.name, vehicle: "2025 Nissan Pathfinder", saleDate: ago(215), deliveredAt: ago(212), frontGross: 0, backGross: 0 });
  const mine = () => O.getOccasions().filter((o) => o.lead.id === l.id).map((o) => ({ kind: o.kind, key: o.key, label: o.label, message: o.message }));
  const a = mine();
  // Their last service visit two months ago: not due now.
  st.update("leads", l.id, { lastService: ago(60) });
  const b2 = mine();
  st.update("leads", l.id, { lastService: null });
  // A visit already booked: quiet.
  st.update("leads", l.id, { serviceAppt: ago(-5) });
  const c2 = mine();
  st.update("leads", l.id, { serviceAppt: null });
  // The winter swap, set to today: on.
  const today = new Date(); const md = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  cd.saveCareRules({ winterDate: md, summerTires: false });
  const d2 = mine();
  // Acted on: gone.
  const t = d2.find((o) => o.kind === "tires"); if (t) O.markOccasion(l.id, t.key);
  const e2 = mine();
  return { a, b: b2, c: c2, d: d2, e: e2, line: (await import("/js/views/plans.js")).planLine("care") };
});
console.log("occasions:", JSON.stringify(occ));
if (!occ.a.some((o) => o.kind === "service" && /Service due/.test(o.label) && /2025 Nissan Pathfinder is coming up on a service/.test(o.message))) fail("seven months after delivery with no service on file: due: " + JSON.stringify(occ.a));
if (occ.b.some((o) => o.kind === "service")) fail("a service two months ago: not due: " + JSON.stringify(occ.b));
if (occ.c.some((o) => o.kind === "service" || o.kind === "tires")) fail("a visit booked: quiet: " + JSON.stringify(occ.c));
if (!occ.d.some((o) => o.kind === "tires" && /Winter tires/.test(o.label) && /winter tires/.test(o.message)) || occ.d.some((o) => /Summer/.test(o.label))) fail("the winter swap on its date, summer off: " + JSON.stringify(occ.d));
if (occ.e.some((o) => o.kind === "tires")) fail("acted on, it doesn't come back: " + JSON.stringify(occ.e));
if (!/Service every 6 months · winter tires from/.test(occ.line) || !/no summer-tire nudge/.test(occ.line)) fail("the care line: " + occ.line);

// The Queue carries them.
await p.evaluate(() => { try { sessionStorage.setItem("viniva:log:open", "queue"); } catch {} location.hash = "#/log"; });
await p.waitForFunction(() => /Lee Owner: Service due/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => fail("the Queue should carry the service occasion"));

// The care page saves.
await p.evaluate(() => { location.hash = "#/plans/care"; });
await p.waitForSelector('.plan-editor[data-kind="care"] input[name="serviceMonths"]', { timeout: 8000 });
await p.fill('.plan-editor input[name="serviceMonths"]', "8");
await p.click('.plan-editor .fp-form button[type=submit]'); await p.waitForTimeout(300);
const saved = await p.evaluate(async () => { const cd = await import("/js/cadence.js"); return cd.careRules().serviceMonths; });
if (saved !== 8) fail("the care page saves: " + saved);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\npostdelivery.test.js FAILED" : "\npostdelivery.test.js passed");
})();
