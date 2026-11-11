// The calling session. Start calling on today's batch opens one customer at
// a time with the read, a script in the salesperson's voice, the objections,
// the number, and the outcomes. Each outcome does its paperwork: Spoke logs
// the contact (and asks for the note); Left a message logs the attempt and
// puts a text tomorrow and a call in three days on the queue; No answer logs
// it and sets a retry for the other half of the day; Not interested parks
// them six months without putting them on the log; Wrong number retires the
// number from every list; Appointment opens the booking form. The summary
// at the end has the numbers, and the batch block offers to carry on.
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
  const models = ["2019 Nissan Rogue SV", "2018 Nissan Murano SL", "2020 Nissan Sentra S", "2021 Nissan Kicks SR"];
  const leads = [];
  for (let i = 0; i < 12; i++) leads.push({ id: "o" + i, name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), vehicleInterest: models[i % 4],
    currentPayment: 380 + i * 5, payoff: 12000 + i * 100, currentValue: 20000 + i * 100, currentApr: i % 5 === 0 ? 11.9 : 5.9, purchaseDate: "2021-03-10", ...x });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles: [
    { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", ...x },
  ], settings: { salesperson: "Parm Shokar", dealership: "O'Regan's Nissan", cloudAutoSync: false, dailyProspects: 6, taxRate: 14, docFee: 699, defaultApr: 7.9, defaultTerm: 72, dealMatchBand: 150 } }));
});
await p.goto(APP + "/#/leads");
await p.waitForSelector(".today-block", { timeout: 30000 }).catch(() => fail("Best now didn't open on today's batch"));
await p.waitForTimeout(600);

// --- The batch block offers the session.
const start = await p.evaluate(() => document.querySelector('[data-act="start-session"]')?.textContent.trim());
console.log("batch block:", start);
if (!/Start calling/.test(start || "")) fail("today's batch should offer Start calling: " + start);
await p.click('[data-act="start-session"]');
await p.waitForSelector(".cs-card", { timeout: 10000 }).catch(() => fail("the session didn't open"));
await p.waitForTimeout(300);

const card = () => p.evaluate(() => ({
  hash: location.hash,
  progress: document.querySelector(".cs-progress")?.textContent.replace(/\s+/g, " ").trim(),
  name: document.querySelector(".cs-name")?.textContent.trim(),
  reasons: [...document.querySelectorAll(".cs-reason")].map((r) => r.textContent.trim()),
  opener: document.querySelector(".cs-line")?.textContent.trim(),
  ask: document.querySelector(".cs-ask")?.textContent.trim(),
  objections: document.querySelectorAll(".cs-obj-row").length,
  dial: document.querySelector(".cs-dial")?.getAttribute("href"),
  outcomes: [...document.querySelectorAll("[data-outcome]")].map((b) => b.dataset.outcome),
  back: document.getElementById("topbar-back")?.hidden === false,
}));
let c = await card();
console.log("first up:", JSON.stringify({ progress: c.progress, name: c.name, reasons: c.reasons, objections: c.objections, dial: c.dial }));
console.log("  say:", c.opener, "|", c.ask);
if (c.hash !== "#/session" || !/1 of 6/.test(c.progress || "")) fail("the session should open on the first of six: " + JSON.stringify(c));
if (!c.name || !c.reasons.length) fail("the card should carry who and why");
if (!/^Hi Owner, it's Parm at O'Regan's Nissan\./.test(c.opener || "") || /\$|%/.test(c.opener || "")) fail("the opener should be in the rep's voice with no figure: " + c.opener);
if (!c.ask || c.objections < 3) fail("the ask and the objections should be there: " + JSON.stringify({ ask: c.ask, objections: c.objections }));
if (!/^tel:/.test(c.dial || "")) fail("the Call button should dial: " + c.dial);
if (c.outcomes.slice().sort().join() !== "appointment,no_answer,not_interested,reached,voicemail,wrong_number") fail("the six outcomes: " + c.outcomes.join());
if (!c.back) fail("the session should have a way back");
const first = c.name;
const idOf = (name) => p.evaluate(async (name) => (await import("/js/store.js")).all("leads").find((l) => l.name === name)?.id, name);
const firstId = await idOf(first);

// --- Left a message: the attempt is logged, a text tomorrow and a call in
// three days are on the queue, and the next customer is up.
await p.click('[data-outcome="voicemail"]'); await p.waitForTimeout(500);
let after = await p.evaluate(async (id) => { const st = await import("/js/store.js"); const l = st.get("leads", id); return { out: l.lastContactOutcome, fu: l.followUp, logged: !!l.loggedAt, calls: st.all("calls").filter((x) => x.leadId === id).map((x) => x.outcome), tasks: st.all("tasks").filter((t) => t.leadId === id && !t.done).map((t) => ({ title: t.title, due: t.due, channel: t.channel, from: t.from })).sort((a, b) => a.due.localeCompare(b.due)) }; }, firstId);
console.log("voicemail:", JSON.stringify(after));
if (after.out !== "voicemail" || after.logged || after.calls.join() !== "voicemail") fail("a message left should be an attempt, not a log entry: " + JSON.stringify(after));
// (No texting consent on this book — the next of six is a call tomorrow.)
if (after.tasks.length !== 1 || after.tasks[0].channel !== "call" || !/^Call Owner again — attempt 2 of 6/.test(after.tasks[0].title)) fail("a voicemail should put the next of six on the queue: " + JSON.stringify(after.tasks));
const d1 = new Date(); d1.setDate(d1.getDate() + 1);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
c = await card();
if (!/2 of 6/.test(c.progress || "") || c.name === first) fail("the next customer should be up: " + JSON.stringify({ progress: c.progress, name: c.name }));

// --- No answer: logged, a retry tomorrow in the other half of the day.
const secondId = await idOf(c.name);
await p.click('[data-outcome="no_answer"]'); await p.waitForTimeout(500);
after = await p.evaluate(async (id) => { const st = await import("/js/store.js"); const l = st.get("leads", id); return { out: l.lastContactOutcome, tasks: st.all("tasks").filter((t) => t.leadId === id && !t.done).map((t) => t.title) }; }, secondId);
console.log("no answer:", JSON.stringify(after));
if (after.out !== "no_answer" || after.tasks.length !== 1 || !/Call Owner again — attempt 2 of 6 · (try the|they tend to pick up) (mornings|afternoons|around midday|evenings)/.test(after.tasks[0])) fail("no answer should set one retry at the other half of the day: " + JSON.stringify(after));

// --- Back and forth. ‹ Back twice lands on the first, their answer lit and
// said; another outcome changes it (the message's follow-ups go, a retry
// comes); Undo clears it; the answer given again stands. Then on to the
// next one without an answer.
await p.click('[data-act="prev"]'); await p.waitForTimeout(200);
await p.click('[data-act="prev"]'); await p.waitForTimeout(300);
let lit = await p.evaluate(() => ({ name: document.querySelector(".cs-name")?.textContent.trim(), picked: document.querySelector(".cs-out-picked")?.dataset.outcome, recorded: document.querySelector(".cs-recorded")?.textContent.replace(/\s+/g, " ").trim(), chips: [...document.querySelectorAll(".cs-chip")].map((c) => [...c.classList].filter((k) => k !== "cs-chip").join(" ")), now: document.querySelector(".cs-chip-now")?.textContent.trim() }));
console.log("back on the first:", JSON.stringify(lit));
if (lit.name !== first || lit.picked !== "voicemail" || !/Recorded: Left a message/.test(lit.recorded || "")) fail("going back should show the first with their answer lit: " + JSON.stringify(lit));
if (lit.chips.length !== 6 || !/cs-chip-later/.test(lit.chips[0]) || !/cs-chip-later/.test(lit.chips[1]) || !/cs-chip-now/.test(lit.chips[0])) fail("the strip should show each person's state: " + JSON.stringify(lit.chips));
await p.click('[data-outcome="no_answer"]'); await p.waitForTimeout(500);
let changed = await p.evaluate(async (id) => { const st = await import("/js/store.js"); const l = st.get("leads", id); return { out: l.lastContactOutcome, calls: st.all("calls").filter((x) => x.leadId === id).map((x) => x.outcome), tasks: st.all("tasks").filter((t) => t.leadId === id && !t.done).map((t) => t.title), progress: document.querySelector(".cs-progress")?.textContent.replace(/\s+/g, " ").trim() }; }, firstId);
console.log("changed to no answer:", JSON.stringify(changed));
if (changed.out !== "no_answer" || changed.calls.join() !== "no_answer" || changed.tasks.length !== 1 || !/^Call Owner again — attempt 2 of 6/.test(changed.tasks[0])) fail("changing the answer should take the message's paperwork back and do the new one: " + JSON.stringify(changed));
if (!/3 of 6/.test(changed.progress || "")) fail("after a change the next one without an answer is up: " + changed.progress);
await p.click('.cs-chip[data-go="0"]'); await p.waitForTimeout(300);
await p.click('[data-act="undo"]'); await p.waitForTimeout(400);
const cleared = await p.evaluate(async (id) => { const st = await import("/js/store.js"); const l = st.get("leads", id); return { out: l.lastContactOutcome, last: l.lastContacted, calls: st.all("calls").filter((x) => x.leadId === id).length, tasks: st.all("tasks").filter((t) => t.leadId === id && !t.done).length, picked: document.querySelector(".cs-out-picked")?.dataset.outcome || null, name: document.querySelector(".cs-name")?.textContent.trim() }; }, firstId);
console.log("undone:", JSON.stringify(cleared));
if (cleared.name !== first || cleared.out || cleared.last || cleared.calls || cleared.tasks || cleared.picked) fail("Undo should clear the answer and its paperwork: " + JSON.stringify(cleared));
await p.click('[data-outcome="voicemail"]'); await p.waitForTimeout(500);
const again = await p.evaluate(async (id) => { const st = await import("/js/store.js"); return { calls: st.all("calls").filter((x) => x.leadId === id).map((x) => x.outcome), tasks: st.all("tasks").filter((t) => t.leadId === id && !t.done).length, progress: document.querySelector(".cs-progress")?.textContent.replace(/\s+/g, " ").trim() }; }, firstId);
if (again.calls.join() !== "voicemail" || again.tasks !== 1 || !/3 of 6/.test(again.progress || "")) fail("the answer given again should stand, and the third be up: " + JSON.stringify(again));

// --- Not interested: a contact, parked six months, not on the log.
c = await card(); const thirdId = await idOf(c.name);
await p.click('[data-outcome="not_interested"]'); await p.waitForTimeout(500);
after = await p.evaluate(async (id) => { const st = await import("/js/store.js"); const l = st.get("leads", id); return { out: l.lastContactOutcome, snoozed: l.prospectSnoozedUntil, logged: !!l.loggedAt, ni: !!l.notInterestedAt }; }, thirdId);
console.log("not interested:", JSON.stringify(after));
const inSix = new Date(); inSix.setDate(inSix.getDate() + 170);
if (after.out !== "reached" || after.logged || !after.ni || !after.snoozed || new Date(after.snoozed) < inSix) fail("not interested should park them for six months off the log: " + JSON.stringify(after));

// --- Wrong number: off every list; the card says so.
c = await card(); const fourthId = await idOf(c.name);
await p.click('[data-outcome="wrong_number"]'); await p.waitForTimeout(500);
after = await p.evaluate(async (id) => { const st = await import("/js/store.js"); const pr = await import("/js/prospects.js"); const l = st.get("leads", id); return { bad: !!l.badPhone, eligible: pr.eligible(l), calls: st.all("calls").filter((x) => x.leadId === id).map((x) => x.outcome) }; }, fourthId);
console.log("wrong number:", JSON.stringify(after));
if (!after.bad || after.eligible || after.calls.join() !== "wrong_number") fail("a wrong number should retire the customer from the lists: " + JSON.stringify(after));

// --- Spoke: logged as a conversation (on the log), the note panel opens;
// cancelling it moves on.
c = await card(); const fifthId = await idOf(c.name);
if (!/5 of 6/.test(c.progress || "")) fail("should be on the fifth: " + c.progress);
await p.click('[data-outcome="reached"]'); await p.waitForTimeout(400);
const note = await p.evaluate(() => ({ panel: !!document.querySelector(".cs-slot-panel .note-panel"), picked: document.querySelector(".cs-out-picked")?.dataset.outcome }));
console.log("spoke:", JSON.stringify(note));
if (!note.panel || note.picked !== "reached") fail("Spoke should log and open the note panel: " + JSON.stringify(note));
after = await p.evaluate(async (id) => { const st = await import("/js/store.js"); const l = st.get("leads", id); return { out: l.lastContactOutcome, logged: !!l.loggedAt }; }, fifthId);
if (after.out !== "reached" || !after.logged) fail("Spoke should put them on the log: " + JSON.stringify(after));
await p.click('.cs-slot-panel .note-panel [data-act="cancel"]'); await p.waitForTimeout(400);
c = await card();
if (!/6 of 6/.test(c.progress || "")) fail("after the note the last customer should be up: " + c.progress);

// --- Appointment: the booking form opens; booking carries the session on.
const sixthId = await idOf(c.name);
await p.click('[data-outcome="appointment"]'); await p.waitForTimeout(500);
const form = await p.evaluate(() => ({ modal: !!document.querySelector(".modal-backdrop"), name: document.querySelector('.modal [name="customerName"]')?.value }));
console.log("appointment:", JSON.stringify(form));
if (!form.modal || !form.name) fail("Appointment should open the booking form for them: " + JSON.stringify(form));
await p.click('.modal button[type="submit"]'); await p.waitForTimeout(900);
after = await p.evaluate(async (id) => { const st = await import("/js/store.js"); return { appts: st.all("appointments").filter((a) => a.leadId === id).length, logged: !!st.get("leads", id).loggedAt }; }, sixthId);
if (after.appts !== 1 || !after.logged) fail("the appointment should be booked and the contact logged: " + JSON.stringify(after));

// --- Everyone answered: the summary, with the session still open to go
// back through; End session closes it.
await p.waitForSelector(".cs-summary", { timeout: 5000 }).catch(() => fail("the summary should follow the last answer"));
const openSum = await p.evaluate(() => ({ head: document.querySelector(".cs-summary .strong")?.textContent.trim(), review: !!document.querySelector('[data-act="review"]'), finish: !!document.querySelector('[data-act="finish"]') }));
if (openSum.head !== "Everyone's answered" || !openSum.review || !openSum.finish) fail("the summary over an open session should offer the way back and the end: " + JSON.stringify(openSum));
await p.click('[data-act="review"]'); await p.waitForTimeout(300);
if (!(await p.evaluate(() => !!document.querySelector(".cs-card")))) fail("Go back through them should show a customer again");
await p.click('[data-act="end"]'); await p.waitForTimeout(300);
await p.click('[data-act="finish"]'); await p.waitForTimeout(300);
if ((await p.evaluate(() => document.querySelector(".cs-summary .strong")?.textContent.trim())) !== "Session done") fail("End session should close it");
const sum = await p.evaluate(() => ({ stats: [...document.querySelectorAll(".cs-stat")].map((s) => `${s.querySelector(".cs-stat-n").textContent.trim()} ${s.querySelector(".cs-stat-l").textContent.trim()}`), text: document.querySelector(".cs-summary")?.textContent.replace(/\s+/g, " ") }));
console.log("summary:", JSON.stringify(sum.stats));
if (sum.stats[0] !== "6 dials" || sum.stats[1] !== "3 reached" || sum.stats[2] !== "1 appointment") fail("the summary should count the session: " + JSON.stringify(sum.stats));
if (!/1 message left · 1 no answer · 1 not interested · 1 wrong number/.test(sum.text || "")) fail("the summary should break the misses down: " + sum.text);
const ev = await p.evaluate(async () => { const st = await import("/js/store.js"); return st.all("events").filter((e) => /^session_/.test(e.kind)).map((e) => e.kind); });
if (ev.filter((k) => k === "session_outcome").length !== 8 || !ev.includes("session_start") || !ev.includes("session_end")) fail("every answer, changed ones too, should be on the event log: " + ev.join());
const live = await p.evaluate(async () => { const st = await import("/js/store.js"); return st.all("events").filter((e) => e.kind === "session_outcome" && !(e.meta && e.meta.undone)).length; });
if (live !== 6) fail("the answers taken back should be marked undone, leaving six that count: " + live);

// --- Back on Outreach: the batch moved on (five reached or parked, the
// wrong number gone), and a fresh session is offered for the rest tomorrow.
await p.click('[data-act="back"]'); await p.waitForTimeout(800);
const block = await p.evaluate(() => ({ head: document.querySelector(".today-block .strong")?.textContent.trim(), start: document.querySelector('[data-act="start-session"]')?.textContent.trim() || null }));
console.log("back on Outreach:", JSON.stringify(block));
if (!/All 6 tried today · 3 spoken with/.test(block.head || "") || block.start) fail("with the batch worked through there's nothing to call, and the block says how many were real conversations: " + JSON.stringify(block));

// --- Continue: a session left open comes back where it was.
await p.evaluate(async () => { const st = await import("/js/store.js"); st.update("leads", "o10", { lastProspectedAt: null, firstProspectedAt: null }); st.update("leads", "o11", { lastProspectedAt: null, firstProspectedAt: null }); const s = await import("/js/session.js"); s.startSession(["o10", "o11"]); });
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/session"; }); await p.waitForTimeout(600);
c = await card();
if (!/1 of 2/.test(c.progress || "")) fail("a session started should come back where it was: " + c.progress);
await p.click('[data-act="next"]'); await p.waitForTimeout(300);
c = await card();
console.log("after Next:", c.progress, c.name);
if (!/2 of 2/.test(c.progress || "") || c.name !== "Owner 11 Example") fail("Next should bring the next one up: " + JSON.stringify({ progress: c.progress, name: c.name }));
await p.click('[data-act="next"]'); await p.waitForTimeout(300);
c = await card();
if (!/1 of 2/.test(c.progress || "")) fail("Next past the end comes round to the first: " + c.progress);
await p.click('[data-act="prev"]'); await p.waitForTimeout(300);
c = await card();
if (!/2 of 2/.test(c.progress || "")) fail("Back from the first comes round to the last: " + c.progress);
await p.click('[data-act="end"]'); await p.waitForTimeout(300);
if (!(await p.evaluate(() => !!document.querySelector(".cs-summary") && !!document.querySelector('[data-act="finish"]')))) fail("End should show the summary over the open session");
await p.click('[data-act="finish"]'); await p.waitForTimeout(300);
if (!(await p.evaluate(() => /Session done/.test(document.querySelector(".cs-summary")?.textContent || "")))) fail("End session should close it");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nsession.test.js FAILED" : "\nsession.test.js passed");
})();
