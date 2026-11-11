// Reach the book, end to end on the phone: the six attempts are calls with
// two texts that ask for a time; a callback due comes before a stranger in
// the session; a reply stops the chase; "Spoke" asks how it went and each
// answer does its paperwork; the batch keeps a share for people never
// spoken with; the Outreach cut, the query field, the Coach card and the
// assistant's answer all read the same count.
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
  const models = ["2019 Nissan Rogue SV", "2018 Nissan Murano SL", "2020 Nissan Sentra S", "2021 Nissan Kicks SR", "2016 Nissan Pathfinder SL", "2022 Nissan Frontier PRO-4X"];
  const leads = [];
  // Twenty with a reason (equity, a rate), and twenty with nothing the read
  // can score — no payment, no value — who still deserve a conversation.
  for (let i = 0; i < 20; i++) leads.push({ id: "r" + i, name: `Reason ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), vehicleInterest: models[i % 6], currentPayment: 380 + i * 5, payoff: 12000, currentValue: 21000, currentApr: 9.9, currentTerm: 84, purchaseDate: "2021-03-10", ...x });
  for (let i = 0; i < 20; i++) leads.push({ id: "u" + i, name: `Quiet ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(20000 + i), vehicleInterest: models[i % 6], purchaseDate: "2019-06-01", ...x, importedAt: `2025-0${1 + (i % 9)}-01T00:00:00.000Z` });
  const DAY = 86400000, now = Date.now();
  const ago = (d, h = 10) => { const t = new Date(now - d * DAY); t.setHours(h, 0, 0, 0); return t.toISOString(); };
  // r0 was spoken with last week; r1 had a message left yesterday with a call queued for today; u0 texted back.
  const calls = [
    { id: "c1", leadId: "r0", dir: "out", via: "call", at: ago(6), outcome: "reached", logged: true, ...x },
    { id: "c2", leadId: "r1", dir: "out", via: "call", at: ago(1, 9), outcome: "voicemail", logged: true, ...x },
  ];
  const texts = [
    { id: "t1", leadId: "u0", dir: "out", at: ago(3), body: "Hi, when's a good time?", ...x },
    { id: "t2", leadId: "u0", dir: "in", at: ago(2), body: "Tomorrow after 4 works", ...x },
    { id: "t3", leadId: "r1", dir: "out", at: ago(1, 11), body: "Just tried you", ...x },
  ];
  const today = new Date().toISOString().slice(0, 10);
  const tasks = [
    { id: "k1", leadId: "r1", title: "Call Reason again — attempt 3 of 6 · try the afternoons", due: today, done: false, channel: "call", intent: "retry", sequence: true, attempt: 3, of: 6, from: "session", createdAt: ago(1, 9), updatedAt: ago(1, 9) },
    { id: "k2", leadId: "u0", title: "Call Quiet again — attempt 2 of 6", due: today, done: false, channel: "call", intent: "retry", sequence: true, attempt: 2, of: 6, from: "session", createdAt: ago(3), updatedAt: ago(3) },
  ];
  leads.find((l) => l.id === "r0").lastContacted = ago(6); leads.find((l) => l.id === "r0").lastContactOutcome = "reached"; leads.find((l) => l.id === "r0").lastContactVia = "call";
  leads.find((l) => l.id === "r1").lastContacted = ago(1, 9); leads.find((l) => l.id === "r1").lastContactOutcome = "voicemail"; leads.find((l) => l.id === "r1").lastContactVia = "call";
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, calls, texts, tasks, vehicles: [
    { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", ...x },
  ], settings: { salesperson: "Parm", cloudAutoSync: false, dailyProspects: 10, taxRate: 14, docFee: 699, defaultApr: 7.9, defaultTerm: 72, hoursFrom: 9, hoursTo: 18, enforceConsent: false } }));
  function Fake() { this.start = () => {}; this.stop = () => {}; this.abort = () => {}; }
  window.SpeechRecognition = Fake; window.webkitSpeechRecognition = Fake;
});
await p.goto(APP + "/#/");
await p.waitForTimeout(900);

// --- A reply is a conversation: u0's open attempt is gone, the reply is on the file.
const absorbed = await p.evaluate(async () => {
  const s = await import("/js/store.js"); const c = await import("/js/coverage.js");
  return { k2: !!s.get("tasks", "k2"), reply: s.get("leads", "u0").lastReplyAt || null, state: c.reachState("u0").state, r1: c.reachState("r1").state, r0: c.reachState("r0").state, u5: c.reachState("u5").state };
});
console.log("absorbed:", JSON.stringify(absorbed));
if (absorbed.k2 || !absorbed.reply || absorbed.state !== "spoken") fail("a text back should stop the chase and count as a conversation: " + JSON.stringify(absorbed));
if (absorbed.r1 !== "due" || absorbed.r0 !== "spoken" || absorbed.u5 !== "untouched") fail("states: " + JSON.stringify(absorbed));

// --- The count, three ways: coverage(), the assistant, the Coach card.
const cov = await p.evaluate(async () => { const c = await import("/js/coverage.js"); const x = c.coverage(); return { spoken: x.spoken, reachable: x.reachable, pct: x.pct, week: x.week, due: x.due, untouched: x.untouched, line: c.coverageLine(x) }; });
console.log("coverage:", JSON.stringify(cov));
if (cov.spoken !== 2 || cov.reachable !== 40 || cov.pct !== 5 || cov.week !== 2 || cov.due !== 1 || cov.untouched < 35) fail("the count: " + JSON.stringify(cov));
const said = await p.evaluate(async () => { const m = await import("/js/agent.js"); return (await m.execTool("book_coverage", {})).result; });
console.log("assistant:", said.answer);
if (!/^Spoken with 2 of 40 reachable customers, 5 percent\. 2 conversations this week\./.test(said.answer) || said.callbacksDue !== 1) fail("the assistant's answer: " + JSON.stringify({ a: said.answer, due: said.callbacksDue }));
await p.evaluate(() => { location.hash = "#/coach"; }); await p.waitForTimeout(900);
const card = await p.evaluate(() => { const c = document.querySelector(".rb-card"); return c ? { pct: c.querySelector(".rb-pct")?.textContent, text: c.textContent.replace(/\s+/g, " ").trim() } : null; });
console.log("coach:", JSON.stringify(card));
if (!card || card.pct !== "5%" || !/2 of 40 reachable/.test(card.text)) fail("Coach should carry the Reach the book card: " + JSON.stringify(card));

// --- The batch keeps a share for people never spoken with, and the session puts the callback due first.
const batch = await p.evaluate(async () => { const pr = await import("/js/prospects.js"); const s = await import("/js/session.js"); const picks = pr.getProspects(); const q = s.sessionQueue(); return { picks: picks.map((c) => c.lead.id), coverage: picks.filter((c) => c.coverage).length, queue: q.map((c) => c.lead.id), callbacks: q.filter((c) => c.callback).map((c) => c.lead.id), progress: pr.pickProgress() }; });
console.log("batch:", JSON.stringify(batch));
if (batch.picks.length !== 10 || batch.coverage < 3 || !batch.picks.some((id) => /^u/.test(id))) fail("a share of the batch should be people never spoken with: " + JSON.stringify(batch));
if (batch.callbacks.join() !== "r1" || batch.queue[0] !== "r1") fail("the callback due should lead the session: " + JSON.stringify(batch));
if (batch.progress.untouched < 25 || batch.progress.behind < batch.progress.untouched) fail("the block should say how many are never spoken with: " + JSON.stringify(batch.progress));

// --- Six attempts on a stranger: call-heavy, the texts ask for a time, then rest.
const seq = await p.evaluate(async () => {
  const s = await import("/js/session.js"); const st = await import("/js/store.js");
  const id = "u7";
  s.startSession([id], { name: "test" });
  const steps = [];
  const DAY = 86400000;
  for (let i = 0; i < 6; i++) {
    const now = new Date(Date.now() + i * 2 * DAY); now.setHours(10 + i, 0, 0, 0);
    const r = s.recordOutcome(id, i % 2 ? "voicemail" : "no_answer", { now });
    const t = r && r.tasks[0];
    steps.push({ n: s.attemptCount(id, now), line: r && r.line, channel: t ? t.channel : null, intent: t ? t.intent : null, why: t && t.why ? t.why.length : 0 });
    // Each recorded outcome replaces the one before in the session; clear the
    // session's memory so the next miss is a new attempt, not a change.
    s.endSession(); s.startSession([id], { name: "test" });
  }
  const l = st.get("leads", id);
  return { steps, rested: !!l.restedAt, until: l.prospectSnoozedUntil || null };
});
console.log("sequence:", JSON.stringify(seq.steps.map((s) => [s.n, s.channel, s.intent, s.why])), "rested:", seq.rested, seq.until);
const chans = seq.steps.map((s) => s.channel).join(",");
if (chans !== "text,call,call,text,call,") fail("the round should be call · text · call · call · text · call, then rest: " + chans);
if (seq.steps[0].intent !== "missed" || seq.steps[3].intent !== "time" || seq.steps[3].why < 1) fail("the two texts ask for a time, the second with two times in it: " + JSON.stringify(seq.steps));
if (!seq.rested || !seq.until) fail("after six, rest: " + JSON.stringify(seq));
if (!/rest/.test(seq.steps[5].line)) fail("the sixth miss says so: " + seq.steps[5].line);

// --- "Spoke": how it went goes on the file, each with its paperwork.
const spoke = await p.evaluate(async () => {
  const s = await import("/js/session.js"); const st = await import("/js/store.js"); const c = await import("/js/coverage.js");
  s.endSession(); s.startSession(["u8", "u9", "u10", "u11"], { name: "test" });
  const out = {};
  // Callback next week: a high-priority call on the queue, the follow-up set, the conversation on the file.
  let r = s.recordOutcome("u8", "callback", { when: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) + "T10:00" });
  out.callback = { line: r.line, task: r.tasks[0] && { channel: r.tasks[0].channel, intent: r.tasks[0].intent, priority: r.tasks[0].priority }, lead: (({ lastConversationOutcome, followUp, lastContactOutcome }) => ({ lastConversationOutcome, followUp, lastContactOutcome }))(st.get("leads", "u8")), state: c.reachState("u8").state, rec: st.all("calls").find((x) => x.leadId === "u8").conversationOutcome };
  // Interested: a text with two times, today; stage moves to working.
  r = s.recordOutcome("u9", "interested");
  out.interested = { task: r.tasks[0] && { channel: r.tasks[0].channel, intent: r.tasks[0].intent, why: (r.tasks[0].why || []).length }, stage: st.get("leads", "u9").stage, outcome: st.get("leads", "u9").lastConversationOutcome };
  // Not now: six months, a check-back dated.
  r = s.recordOutcome("u10", "not_now");
  out.notNow = { snoozed: st.get("leads", "u10").prospectSnoozedUntil, task: r.tasks[0] && r.tasks[0].intent, state: c.reachState("u10").state };
  // Bought elsewhere: a year off, a conversation all the same.
  r = s.recordOutcome("u11", "bought_elsewhere");
  out.bought = { snoozed: st.get("leads", "u11").prospectSnoozedUntil, outcome: st.get("leads", "u11").lastConversationOutcome, state: c.reachState("u11").state };
  out.summary = s.summarize();
  return out;
});
console.log("spoke:", JSON.stringify(spoke));
if (spoke.callback.task.channel !== "call" || spoke.callback.task.intent !== "callback" || spoke.callback.task.priority !== "high" || spoke.callback.lead.lastConversationOutcome !== "callback" || !spoke.callback.lead.followUp || spoke.callback.state !== "spoken" || spoke.callback.rec !== "callback") fail("callback paperwork: " + JSON.stringify(spoke.callback));
// A past customer stays a past customer (delivered); only an open lead moves to working.
if (spoke.interested.task.channel !== "text" || spoke.interested.task.intent !== "time" || spoke.interested.task.why !== 2 || spoke.interested.stage !== "delivered" || spoke.interested.outcome !== "interested") fail("interested paperwork: " + JSON.stringify(spoke.interested));
if (!spoke.notNow.snoozed || spoke.notNow.task !== "checkback" || spoke.notNow.state !== "spoken") fail("not-now paperwork: " + JSON.stringify(spoke.notNow));
if (!spoke.bought.snoozed || spoke.bought.outcome !== "bought_elsewhere" || spoke.bought.state !== "spoken") fail("bought-elsewhere paperwork: " + JSON.stringify(spoke.bought));
if (spoke.summary.reached !== 4 || spoke.summary.callbacks !== 1 || spoke.summary.interested !== 1) fail("the summary counts every conversation as reached: " + JSON.stringify(spoke.summary));

// --- The session screen: Spoke opens "How did it go?"; a callback lands on the file.
await p.evaluate(async () => { const s = await import("/js/session.js"); s.endSession(); s.startSession(["u12"], { name: "test" }); location.hash = "#/session"; });
await p.waitForSelector(".cs-outcomes", { timeout: 8000 }).catch(() => fail("the session screen should open"));
await p.click('.cs-outcomes [data-outcome="reached"]');
await p.waitForSelector(".cs-how", { timeout: 4000 }).catch(() => fail("Spoke should ask how it went"));
let how = await p.evaluate(() => [...document.querySelectorAll(".cs-how [data-how]")].map((b) => b.dataset.how).join(","));
console.log("how:", how);
if (how !== "appointment,callback,interested,not_now,not_interested,bought_elsewhere") fail("the conversation outcomes: " + how);
await p.click('.cs-how [data-how="callback"]');
await p.waitForTimeout(200);
await p.click('.cs-how [data-when="week"]');
await p.waitForTimeout(400);
const filed = await p.evaluate(async () => { const st = await import("/js/store.js"); const l = st.get("leads", "u12"); return { outcome: l.lastConversationOutcome, task: !!st.all("tasks").find((t) => t.leadId === "u12" && t.intent === "callback" && !t.done), note: !!document.querySelector(".cs-how .note-panel") }; });
console.log("filed:", JSON.stringify(filed));
if (filed.outcome !== "callback" || !filed.task || !filed.note) fail("the callback should be on the file with the note panel up: " + JSON.stringify(filed));

// --- Outreach: the "Never spoken with" and "Callback due" cuts; the query field agrees.
await p.evaluate(async () => { const s = await import("/js/session.js"); s.endSession(); sessionStorage.setItem("leads-filter", "all"); location.hash = "#/leads"; });
await p.waitForSelector('.cut-row [data-cut="unspoken"]', { timeout: 8000 }).catch(() => fail("the Never spoken with cut should be on the row"));
const cuts = await p.evaluate(() => ({ unspoken: Number(document.querySelector('.cut-row [data-cut="unspoken"] .cut-count')?.textContent), callback: Number(document.querySelector('.cut-row [data-cut="callback"] .cut-count')?.textContent) }));
const q = await p.evaluate(async () => { const m = await import("/js/agent.js"); const a = (await m.execTool("query_customers", { where: [{ field: "spokenWith", op: "is", value: false }, { field: "reachState", op: "isnt", value: "unreachable" }], show: false, measure: { op: "count" } })).result; const d = (await m.execTool("query_customers", { where: [{ field: "reachState", op: "is", value: "due" }], show: false, measure: { op: "count" } })).result; return { unspoken: a.count, due: d.count }; });
console.log("cuts:", JSON.stringify(cuts), "query:", JSON.stringify(q));
if (!cuts.unspoken || cuts.unspoken !== q.unspoken) fail(`the cut (${cuts.unspoken}) and the query (${q.unspoken}) should agree on who's never been spoken with`);
if (cuts.callback !== q.due || q.due < 1) fail(`callbacks due: cut ${cuts.callback}, query ${q.due}`);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nreachbook.test.js FAILED" : "\nreachbook.test.js passed");
})();
