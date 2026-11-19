// A verified outcome for every interaction: a dial link opens one; back in
// the app the question is up; the answer runs the session's paperwork at the
// call's time. Left open, it's on Home and at the top of the Log's To-dos
// with its quick answers; "Didn't call" takes it off; a text asks Sent.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message + " @ " + String(e.stack || "").split("\n").slice(1, 3).join(" | ")));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", importedAt: "2026-01-01T00:00:00.000Z", stage: "delivered", source: "Import" };
  const leads = [];
  for (let i = 1; i <= 5; i++) leads.push({ id: "o" + i, name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), email: `owner${i}@example.com`, vehicleInterest: "2019 Nissan Rogue SV", currentPayment: 420, payoff: 12000, currentValue: 19000, currentApr: 7.9, purchaseDate: "2020-03-10", ...x });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles: [], settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, dailyProspects: 6, enforceConsent: false, hoursTo: 23 } }));
  // Headless Chromium has nowhere to send a tel: link; the tap still counts.
  window.__dialed = [];
  document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest('a[href^="tel:"],a[href^="sms:"],a[href^="mailto:"]'); if (a) { window.__dialed.push(a.getAttribute("href")); e.preventDefault(); e.__testPrevented = true; } }, false);
});
// --- The customer's page: Call opens an interaction (no outcome yet).
await p.goto(APP + "/#/leads/o1");
await p.waitForSelector('.lead-head [data-act="call"]', { timeout: 30000 }).catch(() => fail("the customer's page didn't open"));
await p.click('.lead-head [data-act="call"]'); await p.waitForTimeout(400);
let s = await p.evaluate(async () => { const st = await import("/js/store.js"); const V = await import("/js/verify.js"); const calls = st.all("calls").filter((c) => c.leadId === "o1"); return { n: calls.length, open: calls.filter(V.isOpen).length, via: calls[0] && calls[0].via, last: st.get("leads", "o1").lastContacted, pending: !!localStorage.getItem("viniva:verify-pending"), dialed: window.__dialed.length }; });
console.log("tapped call:", JSON.stringify(s));
if (s.n !== 1 || s.open !== 1 || s.via !== "call" || !s.last || !s.pending || !s.dialed) fail("the tap opens one interaction with the question armed: " + JSON.stringify(s));

// --- Back in the app: the question. Spoke → Interested: the session's paperwork, at the call's time.
const asked = await p.evaluate(async () => { const V = await import("/js/verify.js"); return V.checkPending({ minAway: 0 }); });
await p.waitForSelector(".modal-verify .vf-sheet", { timeout: 5000 }).catch(() => fail("the question didn't open"));
s = await p.evaluate(() => ({ title: (document.querySelector(".modal") || document.body).textContent.replace(/\s+/g, " ").slice(0, 80), keys: [...document.querySelectorAll(".modal .vf-steps [data-key]")].map((b) => b.dataset.key) }));
console.log("asked:", asked, JSON.stringify(s));
if (!asked || !/How did it go with Owner/.test(s.title) || s.keys.join() !== "spoke,voicemail,no_answer,wrong_number,none") fail("the call's question, its answers: " + JSON.stringify(s));
await p.click('.modal [data-key="spoke"]'); await p.waitForTimeout(150);
s = await p.evaluate(() => [...document.querySelectorAll(".modal .vf-steps [data-key]")].map((b) => b.dataset.key));
if (s.join() !== "appointment,callback,interested,not_now,not_interested,bought_elsewhere,reached,back") fail("Spoke asks how it went: " + s.join());
await p.fill(".modal .vf-note", "wants to see the SV numbers");
await p.click('.modal [data-key="interested"]'); await p.waitForTimeout(500);
s = await p.evaluate(async () => { const st = await import("/js/store.js"); const calls = st.all("calls").filter((c) => c.leadId === "o1"); const l = st.get("leads", "o1"); const tasks = st.all("tasks").filter((t) => t.leadId === "o1" && !t.done); return { modal: !!document.querySelector(".modal-verify"), n: calls.length, outcome: calls[0] && calls[0].outcome, conv: calls[0] && calls[0].conversationOutcome, verified: !!(calls[0] && calls[0].verifiedAt), notes: calls[0] && calls[0].notes, lastConv: l.lastConversationOutcome, tasks: tasks.map((t) => t.intent), pending: !!localStorage.getItem("viniva:verify-pending") }; });
console.log("interested:", JSON.stringify(s));
if (s.modal || s.n !== 1 || s.outcome !== "reached" || s.conv !== "interested" || !s.verified || s.notes !== "wants to see the SV numbers" || s.lastConv !== "interested" || !s.tasks.includes("time") || s.pending) fail("one verified record, the two-times text queued: " + JSON.stringify(s));

// --- Left open: on Home under Right now, and at the top of To-dos with the quick answers.
await p.evaluate(async () => { const st = await import("/js/store.js"); const ago = (h) => new Date(Date.now() - h * 3600000).toISOString(); st.create("calls", { leadId: "o2", dir: "out", via: "call", at: ago(2), outcome: "", notes: "" }); st.update("leads", "o2", { lastContacted: ago(2) }); st.create("calls", { leadId: "o3", dir: "out", via: "call", at: ago(26), outcome: "", notes: "" }); st.update("leads", "o3", { lastContacted: ago(26) }); });
await p.goto(APP + "/#/"); await p.waitForSelector(".nudge-slot", { timeout: 20000 }); await p.waitForTimeout(700);
s = await p.evaluate(() => [...document.querySelectorAll(".nudge-row .row-title")].map((n) => n.textContent.trim()));
console.log("home:", JSON.stringify(s));
if (!s.some((t) => /How did the call with Owner 02 Example go\?/.test(t)) || !s.some((t) => /Owner 03/.test(t))) fail("the open ones are on Home: " + JSON.stringify(s));
await p.evaluate(() => { const r = [...document.querySelectorAll(".nudge-row")].find((n) => /Owner 02/.test(n.textContent)); r.click(); });
await p.waitForSelector(".modal-verify", { timeout: 5000 }).catch(() => fail("the Home row opens the question"));
await p.click('.modal [data-key="voicemail"]'); await p.waitForTimeout(500);
s = await p.evaluate(async () => { const st = await import("/js/store.js"); const c = st.all("calls").filter((x) => x.leadId === "o2"); return { n: c.length, outcome: c[0] && c[0].outcome, tasks: st.all("tasks").filter((t) => t.leadId === "o2" && !t.done && t.sequence).length, home: [...document.querySelectorAll(".nudge-row .row-title")].map((n) => n.textContent.trim()).filter((t) => /Owner 02/.test(t)).length }; });
console.log("voicemail from home:", JSON.stringify(s));
if (s.n !== 1 || s.outcome !== "voicemail" || s.tasks !== 1 || s.home) fail("a message: the next attempt queued, the row gone: " + JSON.stringify(s));

await p.evaluate(() => { try { sessionStorage.setItem("viniva:log:open", "todos"); } catch {} location.hash = "#/log"; });
await p.waitForSelector(".vf-card .vf-row", { timeout: 10000 }).catch(() => fail("To-dos should lead with the open one"));
s = await p.evaluate(() => ({ rows: [...document.querySelectorAll(".vf-card .vf-row .row-title")].map((n) => n.textContent.trim()), count: document.querySelector('[data-count="todos"]')?.textContent, quick: [...document.querySelectorAll(".vf-card .vf-row [data-q]")].map((b) => b.dataset.q) }));
console.log("todos:", JSON.stringify(s));
if (s.rows.join() !== "Owner 03 Example" || Number(s.count) !== 1 || s.quick.join() !== "spoke,voicemail,no_answer") fail("the Log's To-dos: the open one, counted, with its quick answers: " + JSON.stringify(s));
// Didn't call: the record goes and the last contact rolls back.
await p.click(".vf-card .vf-row .row-title"); await p.waitForSelector(".modal-verify", { timeout: 5000 });
await p.click('.modal [data-key="none"]'); await p.waitForTimeout(400);
s = await p.evaluate(async () => { const st = await import("/js/store.js"); return { n: st.all("calls").filter((x) => x.leadId === "o3").length, last: st.get("leads", "o3").lastContacted, card: !document.querySelector(".vf-card").hidden, count: document.querySelector('[data-count="todos"]')?.textContent }; });
console.log("didn't call:", JSON.stringify(s));
if (s.n !== 0 || s.last !== null || s.card || Number(s.count) !== 0) fail("Didn't call takes it off and rolls the last contact back: " + JSON.stringify(s));

// --- A text opened in the phone's app asks the one thing: sent?
await p.evaluate(async () => { const V = await import("/js/verify.js"); V.openInteraction("o4", "text"); });
await p.evaluate(async () => { const V = await import("/js/verify.js"); return V.checkPending({ minAway: 0 }); });
await p.waitForSelector(".modal-verify", { timeout: 5000 }).catch(() => fail("the text's question"));
s = await p.evaluate(() => [...document.querySelectorAll(".modal .vf-steps [data-key]")].map((b) => b.dataset.key));
if (s.join() !== "sent,none") fail("a text asks Sent / Didn't send: " + s.join());
await p.click('.modal [data-key="sent"]'); await p.waitForTimeout(400);
s = await p.evaluate(async () => { const st = await import("/js/store.js"); const c = st.all("calls").filter((x) => x.leadId === "o4"); const l = st.get("leads", "o4"); return { n: c.length, via: c[0] && c[0].via, outcome: c[0] && c[0].outcome, logged: c[0] && c[0].logged, lastVia: l.lastContactVia }; });
console.log("sent:", JSON.stringify(s));
if (s.n !== 1 || s.via !== "text" || s.outcome !== "reached" || !s.logged || s.lastVia !== "text") fail("Sent puts the text on their file: " + JSON.stringify(s));

// --- The calling session's own dial is left alone (it asks its own outcome).
s = await p.evaluate(async () => { const S = await import("/js/session.js"); S.startSession(["o5"], { name: "test" }); location.hash = "#/session"; await new Promise((r) => setTimeout(r, 1200)); const a = document.querySelector(".cs-dial"); return { dial: !!a, noverify: a && a.dataset.noverify === "1" }; });
if (!s.dial || !s.noverify) fail("the session's dial carries data-noverify: " + JSON.stringify(s));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nverify.test.js FAILED" : "\nverify.test.js passed");
})();
