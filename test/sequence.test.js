// Six attempts, by rule. A miss puts the next of six on the queue — a text
// the same day where consent allows, else a call the next day in the other
// half — and the sixth miss rests them ninety days. The card says which
// attempt. A miss logged from the tray continues the same sequence. People
// who texted back go to the front of the session, and the batch block
// offers to text the batch first.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", importedAt: "2026-01-01T00:00:00.000Z", stage: "delivered", source: "Import" };
  const recent = new Date(); recent.setMonth(recent.getMonth() - 6); // bought six months ago: implied consent to text
  const bought = recent.toISOString().slice(0, 10);
  const leads = [];
  // Six owners who can be texted (bought recently), one who can't (bought years ago).
  for (let i = 0; i < 6; i++) leads.push({ id: "o" + i, name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), vehicleInterest: "2025 Nissan Rogue SV", currentPayment: 500 + i, payoff: 30000, currentValue: 34000, currentTerm: 84, purchaseDate: bought, ...x });
  leads.push({ id: "old", name: "Older Owner", phone: "9025519999", vehicleInterest: "2019 Nissan Rogue SV", currentPayment: 400, payoff: 12000, currentValue: 20000, currentTerm: 84, purchaseDate: "2021-03-10", ...x });
  // Owner 05 has been missed five times this fortnight already.
  const calls = [];
  for (let k = 1; k <= 5; k++) { const d = new Date(); d.setDate(d.getDate() - k * 2); d.setHours(11, 0, 0, 0); calls.push({ id: "m" + k, leadId: "o5", dir: "out", via: "call", at: d.toISOString(), outcome: "no_answer", ...x }); }
  // Owner 03 texted back yesterday.
  const y = new Date(); y.setDate(y.getDate() - 1);
  const texts = [{ id: "t1", leadId: "o3", dir: "in", body: "Sure, what did you have in mind?", at: y.toISOString(), ...x }];
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, calls, texts, vehicles: [{ id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", ...x }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, dailyProspects: 10, goalDaily: 2, hoursFrom: 8, hoursTo: 21, hoursDays: [0, 1, 2, 3, 4, 5, 6], taxRate: 14 } }));
});
await p.goto(APP + "/#/leads");
await p.waitForSelector(".today-block", { timeout: 30000 }).catch(() => fail("the batch should draw"));
await p.waitForTimeout(600);

// --- Text first: offered for the ones who can be texted; it hands them to Mass outreach.
const warm = await p.evaluate(() => document.querySelector('[data-act="warm-batch"]')?.textContent.trim() || null);
console.log("warm:", warm);
if (!/Text first · 6/.test(warm || "")) fail("the batch block should offer to text the six who can be texted: " + warm);

// --- Replies first: Owner 03 heads the session's queue.
const q = await p.evaluate(async () => (await import("/js/session.js")).sessionQueue().map((c) => c.lead.id));
console.log("queue:", JSON.stringify(q));
if (q[0] !== "o3") fail("the one who texted back should go first: " + JSON.stringify(q));

// --- A miss on someone who can be texted: a text the same day, attempt 2 of 6, drafted on tap.
await p.evaluate(async () => { const s = await import("/js/session.js"); s.startSession(["o0", "o5"]); });
await p.evaluate(() => { location.hash = "#/session"; }); await p.waitForTimeout(700);
const before = await p.evaluate(() => document.querySelector(".cs-when")?.textContent.trim() || null);
if (before) fail("no attempts yet, nothing to say: " + before);
await p.click('[data-outcome="no_answer"]'); await p.waitForTimeout(600);
const miss1 = await p.evaluate(async () => { const st = await import("/js/store.js"); const t = st.all("tasks").filter((t) => t.leadId === "o0" && !t.done); return { tasks: t.map((x) => ({ title: x.title, channel: x.channel, intent: x.intent, cadence: !!x.cadence, sequence: !!x.sequence, attempt: x.attempt, due: x.due })), toast: [...document.querySelectorAll(".toast")].map((n) => n.textContent).join(" | ") }; });
console.log("miss 1:", JSON.stringify(miss1));
const today = new Date(); const pad = (n) => String(n).padStart(2, "0"); const todayK = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
if (miss1.tasks.length !== 1 || miss1.tasks[0].channel !== "text" || miss1.tasks[0].intent !== "missed" || !miss1.tasks[0].cadence || !miss1.tasks[0].sequence || miss1.tasks[0].attempt !== 2 || !/attempt 2 of 6/.test(miss1.tasks[0].title)) fail("a first miss should queue a text as attempt 2 of 6, drafted like a plan step: " + JSON.stringify(miss1.tasks));
if (!(miss1.tasks[0].due === todayK || new Date(miss1.tasks[0].due) > today)) fail("the text should be the same day (or next morning when the day's over): " + miss1.tasks[0].due);
if (!/attempt 1 of 6/.test(miss1.toast)) fail("the toast should say which attempt: " + miss1.toast);

// --- The sixth miss rests them ninety days; the card said attempt 6 of 6.
const six = await p.evaluate(() => ({ name: document.querySelector(".cs-name")?.textContent.trim(), when: document.querySelector(".cs-when")?.textContent.trim() }));
console.log("sixth up:", JSON.stringify(six));
if (six.name !== "Owner 05 Example" || !/Attempt 6 of 6/.test(six.when || "")) fail("Owner 05's card should say this is attempt 6 of 6: " + JSON.stringify(six));
await p.click('[data-outcome="no_answer"]'); await p.waitForTimeout(600);
const rested = await p.evaluate(async () => { const st = await import("/js/store.js"); const l = st.get("leads", "o5"); return { snoozed: l.prospectSnoozedUntil, after: l.restedAfter, tasks: st.all("tasks").filter((t) => t.leadId === "o5" && !t.done).length, toast: [...document.querySelectorAll(".toast")].map((n) => n.textContent).join(" | ") }; });
console.log("rested:", JSON.stringify(rested));
const in80 = new Date(); in80.setDate(in80.getDate() + 80);
if (!rested.snoozed || new Date(rested.snoozed) < in80 || rested.after !== 6 || rested.tasks) fail("the sixth miss should rest them ninety days with nothing queued: " + JSON.stringify(rested));
if (!/that's six; resting them/.test(rested.toast)) fail("the toast should say so: " + rested.toast);

// --- Undo of an answer takes its sequence step back too. (Everyone's
// answered, so the summary is up: back through them first.)
if (await p.evaluate(() => !!document.querySelector('[data-act="review"]'))) { await p.click('[data-act="review"]'); await p.waitForTimeout(300); }
await p.click('.cs-chip[data-go="0"]'); await p.waitForTimeout(300);
await p.click('[data-act="undo"]'); await p.waitForTimeout(400);
const undone = await p.evaluate(async () => { const st = await import("/js/store.js"); return { tasks: st.all("tasks").filter((t) => t.leadId === "o0" && !t.done).length, calls: st.all("calls").filter((c) => c.leadId === "o0").length }; });
if (undone.tasks || undone.calls) fail("undo should take the queued text back with the call: " + JSON.stringify(undone));

// --- A miss from the tray on Outreach continues the same sequence: Owner 01,
// two misses → a call tomorrow as attempt 3 (the earlier text step replaced).
await p.evaluate(async () => { const s = await import("/js/session.js"); s.endSession(); });
await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(700);
await p.click('[data-filter="all"]'); await p.waitForTimeout(400);
const tap = async (label) => { await p.evaluate((label) => { const w = document.querySelector('.swipe-card[data-lead-id="o1"]').closest(".swipe-wrap"); [...w.querySelectorAll(".swipe-act")].find((x) => x.textContent.trim() === label).click(); }, label); await p.waitForTimeout(150); };
await tap("Contacted"); await tap("Call"); await tap("No answer"); await p.waitForTimeout(500);
let tray = await p.evaluate(async () => { const st = await import("/js/store.js"); return st.all("tasks").filter((t) => t.leadId === "o1" && !t.done).map((t) => ({ title: t.title, channel: t.channel, attempt: t.attempt })); });
console.log("tray miss 1:", JSON.stringify(tray));
if (tray.length !== 1 || tray[0].attempt !== 2 || tray[0].channel !== "text") fail("a miss from the tray should queue attempt 2: " + JSON.stringify(tray));
const line = await p.evaluate(() => document.querySelector('.swipe-card[data-lead-id="o1"] .row-contact')?.textContent.replace(/\s+/g, " ").trim());
if (!/attempt 1 of 6/.test(line || "")) fail("the card should say the attempt: " + line);
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(700);
await p.click('[data-filter="all"]'); await p.waitForTimeout(400);
await tap("Contacted"); await tap("Call"); await tap("No answer"); await p.waitForTimeout(500);
tray = await p.evaluate(async () => { const st = await import("/js/store.js"); return st.all("tasks").filter((t) => t.leadId === "o1" && !t.done).map((t) => ({ title: t.title, channel: t.channel, attempt: t.attempt })); });
console.log("tray miss 2:", JSON.stringify(tray));
if (tray.length !== 1 || tray[0].attempt !== 3 || tray[0].channel !== "call" || !/attempt 3 of 6/.test(tray[0].title)) fail("the second miss should replace the step with attempt 3, a call: " + JSON.stringify(tray));

// --- Someone in a sequence is left out of tomorrow's batch (the queue is working them).
const elig = await p.evaluate(async () => { const pr = await import("/js/prospects.js"); const st = await import("/js/store.js"); return pr.eligible(st.get("leads", "o1")); });
if (elig) fail("someone with a sequence step queued shouldn't be brought up by the batch as well");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nsequence.test.js FAILED" : "\nsequence.test.js passed");
})();
