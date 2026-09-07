// What needs attention right now, as opposed to what's on today's list.
//
// The play sheet thinks in days. Nothing watched the clock, so the two things
// that decay fastest in a salesperson's day — a customer waiting on a reply,
// an appointment about to start that nobody confirmed — were only findable by
// going and looking for them.
//
// The rules that matter here are the ones that keep this from becoming a second
// to-do list: a nudge has to be time-critical, have one obvious action, and
// disappear on its own once handled. These check exactly that.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 },
  colorScheme: "dark", serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

const mins = (n) => new Date(Date.now() - n * 60000).toISOString();
// Appointments are stored as local wall-clock with no zone.
const wall = (offsetMin) => {
  const d = new Date(Date.now() + offsetMin * 60000);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

await p.addInitScript(([justNow, waiting, longWait, soon, later, passed, tomorrow]) => {
  localStorage.setItem("entoa:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "a", name: "Ann Lee", phone: "9025551111", stage: "working", createdAt: "x", updatedAt: "x" },
      { id: "c", name: "Cy Poe", phone: "9025553333", stage: "appointment", createdAt: "x", updatedAt: "x" },
      // Quiet for a week, mid-negotiation — the deal is cooling.
      { id: "d", name: "Dee Marsh", phone: "9025554444", stage: "negotiating",
        lastContacted: new Date(Date.now() - 7 * 86400000).toISOString(), createdAt: "x", updatedAt: "x" },
      // Quiet for a week too, but not in a stage where silence costs anything.
      { id: "e", name: "Ed Roy", phone: "9025555555", stage: "lost",
        lastContacted: new Date(Date.now() - 7 * 86400000).toISOString(), createdAt: "x", updatedAt: "x" },
    ],
    texts: [
      // Just landed — inside a normal reply time, must not nag.
      { id: "t1", leadId: "a", dir: "in", body: "is the Rogue still there?", at: justNow, read: false, createdAt: "x", updatedAt: "x" },
      // Waiting a while — this is the one that matters.
      { id: "t2", leadId: "c", dir: "in", body: "what time works for saturday", at: longWait, read: false, createdAt: "x", updatedAt: "x" },
      // Already answered.
      { id: "t3", leadId: "d", dir: "in", body: "thanks!", at: waiting, read: true, createdAt: "x", updatedAt: "x" },
    ],
    appointments: [
      { id: "ap1", customerName: "Cy Poe", leadId: "c", when: soon, status: "scheduled", confirmed: false, createdAt: "x", updatedAt: "x" },
      { id: "ap2", customerName: "Far Off", when: later, status: "scheduled", confirmed: false, createdAt: "x", updatedAt: "x" },
      { id: "ap3", customerName: "Already Confirmed", when: soon, status: "scheduled", confirmed: true, createdAt: "x", updatedAt: "x" },
      { id: "ap4", customerName: "Gone By", when: passed, status: "scheduled", createdAt: "x", updatedAt: "x" },
    ],
    deliveries: [
      { id: "dl1", customerName: "Hal Ives", when: tomorrow, done: false,
        checklist: [{ label: "Plates & registration", done: false }, { label: "Detail", done: true }], createdAt: "x", updatedAt: "x" },
      { id: "dl2", customerName: "All Ready", when: tomorrow, done: false,
        checklist: [{ label: "Detail", done: true }], createdAt: "x", updatedAt: "x" },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false, smsFrom: "+19025550123" },
  }));
}, [mins(2), mins(40), mins(95), wall(45), wall(60 * 8), wall(-120), (() => {
  const d = new Date(Date.now() + 86400000);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
})()]);

await p.goto(APP + "/#/");
await p.waitForTimeout(800);

const list = await p.evaluate(async () => {
  const m = await import("/js/nudges.js");
  return m.getNudges({ limit: 20 }).map((n) => ({ kind: n.kind, key: n.key, urgency: n.urgency, title: n.title, sub: n.sub, route: n.route }));
});
console.log("nudges:");
list.forEach((n) => console.log(`  [${n.urgency}] ${n.kind}: ${n.title}`));
const kinds = list.map((n) => n.kind);
const has = (k, t) => list.some((n) => n.kind === k && (!t || new RegExp(t, "i").test(n.title)));

// --- A reply that's been waiting is the most urgent thing in the app.
if (!has("reply", "Cy")) fail("a customer waiting 95 minutes on a reply isn't surfaced");
if (has("reply", "Ann")) fail("a text that arrived 2 minutes ago is already nagging — that's noise");
if (has("reply", "Dee")) fail("an already-read message is being treated as unanswered");
const reply = list.find((n) => n.kind === "reply");
if (reply.route !== "/inbox/c") fail("the reply nudge doesn't go to the conversation: " + reply.route);
if (list[0].kind !== "reply" && list[0].kind !== "confirm")
  fail("something less urgent than a waiting customer sorted to the top: " + list[0].kind);

// --- An appointment inside the window, and only that one.
if (!has("confirm", "Cy Poe")) fail("an unconfirmed appointment 45 minutes out isn't surfaced");
if (has("confirm", "Far Off")) fail("an appointment 8 hours away is being treated as urgent");
if (has("confirm", "Already Confirmed")) fail("a confirmed appointment is being asked about");

// --- Urgency has to climb as the appointment approaches, or the ordering is
// decoration rather than judgement.
const near = await p.evaluate(async () => {
  const m = await import("/js/nudges.js");
  const at = (offsetMin) => {
    const d = new Date(Date.now() + offsetMin * 60000);
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const store = await import("/js/store.js");
  store.update("appointments", "ap1", { when: at(20) });
  const n = m.getNudges({ limit: 20 }).find((x) => x.kind === "confirm");
  store.update("appointments", "ap1", { when: at(45) });
  return n ? n.urgency : null;
});
const at45 = list.find((n) => n.kind === "confirm").urgency;
console.log(`\nconfirm urgency: ${at45} at 45 min out, ${near} at 20 min out`);
if (!(near > at45)) fail("an appointment getting closer doesn't get more urgent");

// --- The rest.
if (!has("outcome", "Gone By")) fail("an appointment that's been and gone with no outcome isn't asked about");
if (!has("prep", "Hal Ives")) fail("tomorrow's delivery with prep left isn't flagged");
if (has("prep", "All Ready")) fail("a delivery that's fully prepped is being flagged anyway");
if (!has("cold", "Dee Marsh")) fail("a negotiating customer silent for a week isn't surfaced");
if (has("cold", "Ed Roy")) fail("a lost lead is being chased as if the deal were live");

// --- Handling something makes it go away on its own. That's the rule that
// keeps this from turning into a list you have to maintain.
const after = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  const m = await import("/js/nudges.js");
  store.markThreadRead("c");
  store.update("appointments", "ap1", { confirmed: true });
  return m.getNudges({ limit: 20 }).map((n) => n.kind);
});
console.log("after answering and confirming:", JSON.stringify(after));
if (after.includes("reply")) fail("reading the thread didn't clear the reply nudge");
if (after.includes("confirm")) fail("confirming the appointment didn't clear its nudge");

// --- And it's on Home, above the day's queue.
const home = await p.$eval(".nudge-slot", (n) => n.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
console.log("\nHome strip:", home.slice(0, 120));
if (!/Right now/.test(home)) fail("nothing is surfaced on the dashboard");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nnudges.test.js FAILED" : "\nnudges.test.js passed");
})();
