// "I want to be able to use voice to add a customer and their contact
// information, but also add context to their profile — 'Parm is looking for a
// Rogue, loves the SV moonroof and is open to new and used, wants to be at a
// $30k price range.' From there a follow-up cadence should be triggered
// automatically. The app should know how to set it up without the salesperson
// doing anything but giving permission before sending."
//
// So the properties: nothing said about a customer is lost; the plan starts
// by itself and is shaped like a plan that works; every text in it is written
// from the customer's context and put in front of the salesperson to send;
// no figure ever reaches a draft; and the plan steps back when the customer
// replies or an appointment is booked.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const AGENT = APP + "/functions/v1/voice-agent";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

// The agent, stubbed: records every prompt it is given and answers with a
// draft. `mode` switches what it says back.
const prompts = [];
let mode = "good";
let smsSends = 0;
await p.route("**/functions/v1/voice-agent", async (route) => {
  const body = route.request().postDataJSON() || {};
  if (body.sms) { smsSends++; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sent: true, sid: "SM1" }) }); }
  prompts.push(body);
  const text = mode === "money" ? "Hi Parm, the Rogue SV you liked is $30,000 — want to come see it?"
    : "Hi Parm, it's Jordan. I've got you down for a Rogue SV with the moonroof, new or used — I'll line one up for you to see this week.";
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn" }) });
});

await p.addInitScript((agent) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "j@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
    settings: { salesperson: "Jordan Reid", dealership: "O'Regan's Nissan", cloudAutoSync: false,
      supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: agent, smsFrom: "+19025550123" } }));
}, AGENT);
await p.goto(APP + "/#/");
await p.evaluate(async () => { const s = await import("/js/store.js"); await s.ready; });

const SAID = "Parm is looking for a Rogue, loves the SV moonroof and is open to new and used. He wants to be at a $30k price range.";

// --- 1. Adding a customer by voice, with everything that was said.
console.log("voice add, with context:");
const added = await p.evaluate(async (said) => {
  const agent = await import("/js/agent.js");
  const store = await import("/js/store.js");
  const r = await agent.execTool("create_lead", { name: "Parm Gill", phone: "9025551234", vehicle: "Nissan Rogue",
    trim: "SV", features: ["moonroof"], newUsed: "either", budget: "thirty", notes: said });
  const lead = store.all("leads").find((l) => l.name === "Parm Gill");
  const tasks = store.all("tasks").filter((t) => t.leadId === lead.id && t.cadence).sort((a, b) => a.step - b.step);
  const today = new Date().toISOString().slice(0, 10);
  const dayOf = (iso) => Math.round((new Date(iso + "T00:00:00Z") - new Date(today + "T00:00:00Z")) / 86400000);
  return { result: r.result, profile: lead.profile, notes: lead.notes, vehicle: lead.vehicleInterest,
    plan: tasks.map((t) => ({ day: dayOf(t.due), ch: t.channel, intent: t.intent, of: t.of, done: !!t.done })) };
}, SAID);
console.log("  " + JSON.stringify({ profile: added.profile, vehicle: added.vehicle }));
console.log("  notes:", JSON.stringify(added.notes));
console.log("  plan:", added.plan.map((s) => `${s.day}${s.ch[0]}`).join(" "));
if (added.profile?.trim !== "SV") fail("the trim wasn't captured");
if (!added.profile?.features?.includes("moonroof")) fail("the moonroof wasn't captured");
if (added.profile?.newUsed !== "either") fail("open to new or used wasn't captured");
if (added.profile?.budget !== 30000) fail(`'thirty' for a car should be 30000, got ${added.profile?.budget}`);
if (!added.notes.includes(SAID)) fail("the sentence as spoken isn't on the record");
if (!/^\d{4}-\d{2}-\d{2} — /.test(added.notes)) fail("the note isn't dated");
if (!/plan started/i.test(added.result)) fail("the agent isn't told the plan started: " + added.result);
if (!/nothing sends on its own|OK/.test(added.result)) fail("the agent isn't told sends wait for approval");
const days = added.plan.map((s) => s.day);
if (JSON.stringify(days) !== JSON.stringify([0, 0, 1, 2, 4, 7, 10, 14, 21, 30, 45, 60, 90])) fail(`the plan's shape is ${JSON.stringify(days)}`);
if (added.plan.filter((s) => s.day <= 7).length < 6) fail("fewer than six touches in the first week");
if (added.plan[0].ch !== "text" || added.plan[0].intent !== "intro") fail("the first step isn't the intro text");
if (!added.plan.every((s) => s.of === 13)) fail("steps don't know the plan's length");

// --- 2. The first text is on Home, drafted from the context, held for a tap.
console.log("\nHome — the first text:");
// The day-zero steps are timed (five minutes, two hours). Move the clock on
// rather than wait: every timed step's moment has now passed.
await p.evaluate(async () => {
  const store = await import("/js/store.js");
  const lead = store.all("leads").find((l) => l.name === "Parm Gill");
  store.all("tasks").filter((t) => t.leadId === lead.id && t.readyAt)
    .forEach((t) => store.update("tasks", t.id, { readyAt: new Date(Date.now() - 60000).toISOString() }));
});
await p.evaluate(() => { location.hash = "#/settings"; }); await p.waitForTimeout(100);
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(400);
const home = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".plays-slot .row")].map((r) => ({ title: r.querySelector(".strong")?.textContent, sub: r.querySelector(".small")?.textContent, btn: r.querySelector("button.btn, a.btn")?.textContent.trim() }));
  return rows.filter((r) => /Parm/.test(r.title || ""));
});
console.log("  " + JSON.stringify(home));
const intro = home.find((r) => /Welcome text/.test(r.title));
if (!intro) fail("the intro text isn't on the day's queue");
if (intro && intro.btn !== "Review") fail(`the intro text's button says ${JSON.stringify(intro?.btn)}, not Review`);
if (!home.some((r) => /Intro call/.test(r.title) && r.btn === "Call")) fail("the intro call isn't on the queue as a call");

await p.evaluate(() => document.querySelector("[data-play-draft]").click());
await p.waitForTimeout(600);
const opened = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  return { hash: location.hash, compose: document.querySelector(".ib-compose textarea")?.value || "",
    sentOut: store.all("texts").filter((t) => t.dir === "out").length };
});
console.log("  after Review:", JSON.stringify({ hash: opened.hash, compose: opened.compose.slice(0, 60) + "…", sentOut: opened.sentOut }));
if (!/^#\/inbox\//.test(opened.hash)) fail("Review didn't open the conversation");
if (!/moonroof/.test(opened.compose)) fail("the draft isn't in the compose box");
if (opened.sentOut || smsSends) fail("something was sent without the salesperson's tap");
// The function also answers link-shortening on the same URL; find the draft.
const sys = String((prompts.find((q) => /follow-up text/.test(String(q.system || ""))) || {}).system || "");
if (!/moonroof/.test(sys) || !/SV/.test(sys) || !/either/.test(sys)) fail("the drafter wasn't given the customer's context");
if (/30,?000|\$30|30k/.test(sys)) fail("the customer's budget was handed to the drafter as a figure");
if (!/looking for a Rogue/.test(sys)) fail("the drafter wasn't given the notes as spoken");

// Sending it completes the plan step; nothing else does.
const sent = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const sms = await import("/js/sms.js");
  const lead = store.all("leads").find((l) => l.name === "Parm Gill");
  const r = await sms.sendText(lead, document.querySelector(".ib-compose textarea").value);
  const steps = store.all("tasks").filter((t) => t.leadId === lead.id && t.cadence);
  return { ok: r.ok, doneTexts: steps.filter((t) => t.done && t.channel === "text").length, open: steps.filter((t) => !t.done).length, lastContacted: !!store.get("leads", lead.id).lastContacted };
});
console.log("  after the tap:", JSON.stringify(sent));
if (!sent.ok) fail("the send failed");
if (sent.doneTexts !== 1 || sent.open !== 12) fail(`sending should complete exactly the due text step (done texts ${sent.doneTexts}, open ${sent.open})`);
if (!sent.lastContacted) fail("sending didn't stamp last-contacted");

// --- 3. A figure in a draft never gets through.
console.log("\nmoney backstop:");
mode = "money";
const backstop = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const touches = await import("/js/touches.js");
  const lead = store.all("leads").find((l) => l.name === "Parm Gill");
  const task = store.all("tasks").find((t) => t.leadId === lead.id && t.cadence && t.intent === "value");
  return touches.draftTouch(lead, task);
});
mode = "good";
console.log("  " + JSON.stringify(backstop));
if (/\$|30,?000/.test(backstop.body)) fail("a dollar figure reached the draft");
if (backstop.via !== "template") fail("the fallback should have been the template once the agent kept quoting");
if (!/Rogue/.test(backstop.body) || !/moonroof/.test(backstop.body)) fail("the template draft isn't written from the context");

// --- 4. More context later merges; it doesn't overwrite or restart.
console.log("\nadd_context:");
const more = await p.evaluate(async () => {
  const agent = await import("/js/agent.js"); const store = await import("/js/store.js");
  const r = await agent.execTool("add_context", { customer: "Parm", features: ["heated seats", "Moonroof"], timeline: "before the baby comes in November", notes: "Parm's wife is due in November so he wants it sorted before then" });
  const lead = store.all("leads").find((l) => l.name === "Parm Gill");
  return { result: r.result, features: lead.profile.features, timeline: lead.profile.timeline, lines: lead.notes.split("\n").length,
    open: store.all("tasks").filter((t) => t.leadId === lead.id && t.cadence && !t.done).length };
});
console.log("  " + JSON.stringify(more));
if (JSON.stringify(more.features) !== JSON.stringify(["moonroof", "heated seats"])) fail(`features should merge without duplicates: ${JSON.stringify(more.features)}`);
if (!/November/.test(more.timeline)) fail("the timeline wasn't captured");
if (more.lines !== 2) fail(`the notes should have two dated lines, have ${more.lines}`);
if (more.open !== 12) fail("adding context restarted or duplicated the plan");

// --- 5. A reply from the customer puts the next texts on hold.
console.log("\ncustomer replies:");
const held = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const cadence = await import("/js/cadence.js");
  const lead = store.all("leads").find((l) => l.name === "Parm Gill");
  const now = new Date().toISOString();
  store.create("texts", { leadId: lead.id, dir: "in", body: "Thanks! Is the SV available in grey?", phone: lead.phone, at: now, read: false });
  const before = store.all("tasks").filter((t) => t.leadId === lead.id && t.cadence && !t.done).map((t) => [t.step, t.due]);
  const moved = cadence.adaptToReplies();
  const again = cadence.adaptToReplies();
  const after = store.all("tasks").filter((t) => t.leadId === lead.id && t.cadence && !t.done).map((t) => [t.step, t.due, t.channel]);
  const hold = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  return { moved, again, hold, before: before.slice(0, 4), after: after.slice(0, 4) };
});
console.log("  " + JSON.stringify(held));
if (!held.moved) fail("nothing moved when the customer replied");
if (held.again) fail("a second pass moved steps again — it isn't idempotent");
const earlyTexts = held.after.filter(([, due, ch]) => ch === "text" && due < held.hold);
if (earlyTexts.length) fail(`text steps still due inside the hold: ${JSON.stringify(earlyTexts)}`);
if (!held.after.some(([, , ch]) => ch === "call" && held.before.some(([s]) => s))) fail("calls should be left where they were");

// --- 6. An appointment on the books pauses the plan until it's been.
console.log("\nappointment booked:");
const appt = await p.evaluate(async () => {
  const agent = await import("/js/agent.js"); const store = await import("/js/store.js");
  const when = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10) + "T14:00";
  await agent.execTool("book_appointment", { customer: "Parm Gill", when });
  const lead = store.all("leads").find((l) => l.name === "Parm Gill");
  const steps = store.all("tasks").filter((t) => t.leadId === lead.id && t.cadence && !t.done);
  return { stage: lead.stage, day: when.slice(0, 10), before: steps.filter((t) => t.due <= when.slice(0, 10)).length, deferred: steps.filter((t) => t.deferredFor === "appointment").length };
});
console.log("  " + JSON.stringify(appt));
if (appt.stage !== "appointment") fail("booking didn't move the stage");
if (appt.before) fail(`${appt.before} plan steps still land before the appointment`);
if (!appt.deferred) fail("no step was deferred for the appointment");

// --- 7. The customer's page shows the context and the plan.
console.log("\ncustomer page:");
const page = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  const lead = store.all("leads").find((l) => l.name === "Parm Gill");
  location.hash = "#/leads/" + lead.id;
  await new Promise((r) => setTimeout(r, 300));
  const text = document.querySelector("#view").textContent;
  return { context: /Context/.test(text) && /moonroof/.test(text) && /Open to either/.test(text) && /\$30,000/.test(text),
    plan: /Follow-up plan/.test(text) && /of 13/.test(text), addBtn: !!document.querySelector('[data-act="add-context"]') };
});
console.log("  " + JSON.stringify(page));
if (!page.context) fail("the context card is missing what was said");
if (!page.plan) fail("the plan card isn't showing the plan");
if (!page.addBtn) fail("there's no way to add context by hand");

// --- 8. Offline (no agent): the sentence still lands on the record.
console.log("\noffline parse:");
const offline = await p.evaluate(async () => {
  const voice = await import("/js/voice.js");
  const cmd = voice.parseCommand("add customer Dana Lee looking for a Kicks, wants red, budget is tight");
  return cmd;
});
console.log("  " + JSON.stringify(offline));
if (offline.action !== "lead" || offline.name !== "Dana Lee") fail("the offline parser didn't get the customer");
if (!/wants red/.test(offline.notes || "")) fail("the offline parser dropped what was said");

// --- 10. Five minutes after a customer is added, their welcome text is ready:
// on the "right now" list, on the queue, and at the address a push opens.
console.log("\nthe five-minute welcome text:");
const five = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const cadence = await import("/js/cadence.js");
  const nudges = await import("/js/nudges.js"); const plays = await import("/js/plays.js");
  const lead = store.create("leads", { name: "Nadia Ross", phone: "9025559876", stage: "new", source: "Voice", vehicleInterest: "Nissan Kicks" });
  cadence.startCadence(lead.id);
  const steps = store.all("tasks").filter((t) => t.leadId === lead.id && t.cadence).sort((a, b) => a.step - b.step);
  const created = Date.now();
  const readyIn = (t) => Math.round((new Date(t.readyAt).getTime() - created) / 60000);
  const at = (mins) => created + mins * 60000;
  const mine = (list) => list.filter((n) => /Nadia/.test(n.title));
  return {
    text: { readyIn: readyIn(steps[0]), label: steps[0].title }, call: { readyIn: readyIn(steps[1]) },
    nudgeAt1: mine(nudges.getNudges({ now: at(1) })).length,
    nudgeAt6: mine(nudges.getNudges({ now: at(6) })).map((n) => ({ title: n.title, taskId: !!n.taskId, urgency: n.urgency })),
    queueNow: plays.getPlays(40).filter((p) => /Nadia/.test(p.title) && /text/i.test(p.title)).length,
    taskId: steps[0].id, leadId: lead.id,
  };
});
console.log("  " + JSON.stringify(five));
if (five.text.readyIn !== 5) fail(`the welcome text is ready in ${five.text.readyIn} minutes, not 5`);
if (!/coming in/.test(five.text.label)) fail("the welcome text isn't framed as thanks for coming in");
if (five.nudgeAt1) fail("the welcome text was pushed before its five minutes were up");
if (!five.nudgeAt6.length) fail("no 'welcome text is ready' after five minutes");
if (five.nudgeAt6.length && (!five.nudgeAt6[0].taskId || five.nudgeAt6[0].urgency < 85)) fail("the ready text isn't a tappable, urgent nudge");
if (five.queueNow) fail("the welcome text is on the day's queue before its minute");

// The push notification's address: /review/<task> drafts it and opens it.
await p.evaluate((id) => { location.hash = "#/review/" + id; }, five.taskId);
await p.waitForTimeout(700);
const viaPush = await p.evaluate(() => ({ hash: location.hash, compose: document.querySelector(".ib-compose textarea")?.value || "" }));
console.log("  via the push address:", JSON.stringify({ hash: viaPush.hash, compose: viaPush.compose.slice(0, 50) + "…" }));
if (!/^#\/inbox\//.test(viaPush.hash)) fail("the push address didn't open the conversation");
if (!viaPush.compose) fail("the push address didn't put a draft in the box");

// --- 11. An internet enquiry is a race: call, text, call inside the hour.
const inbound = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const cadence = await import("/js/cadence.js"); const touches = await import("/js/touches.js");
  const lead = store.create("leads", { name: "Omar Haddad", phone: "9025550001", stage: "new", source: "Internet", vehicleInterest: "Nissan Frontier" });
  cadence.startCadence(lead.id);
  const steps = store.all("tasks").filter((t) => t.leadId === lead.id && t.cadence).sort((a, b) => a.step - b.step);
  const created = Date.now();
  const first = steps.slice(0, 3).map((t) => `${t.channel}@${Math.round((new Date(t.readyAt).getTime() - created) / 60000)}`);
  const intro = steps.find((t) => t.channel === "text");
  return { first, total: steps.length, template: touches.templateTouch(lead, intro) };
});
console.log("\ninternet enquiry, first hour:", JSON.stringify(inbound.first), "of", inbound.total);
if (inbound.first.join(" ") !== "call@2 text@5 call@20") fail(`an internet lead's first hour should be call, text, call — got ${inbound.first.join(" ")}`);
if (!/reaching out/.test(inbound.template)) fail("an internet lead's welcome text says 'coming in' — they haven't been in");

// --- 12. Business hours travel to the server with the prefs.
const prefs = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  store.updateSettings({ hoursFrom: 8, hoursTo: 19, hoursDays: [1, 2, 3, 4, 5] });
  store.publishPrefs();
  return store.get("prefs", "me");
});
console.log("\nprefs:", JSON.stringify({ hoursFrom: prefs.hoursFrom, hoursTo: prefs.hoursTo, hoursDays: prefs.hoursDays }));
if (prefs.hoursFrom !== 8 || prefs.hoursTo !== 19 || JSON.stringify(prefs.hoursDays) !== "[1,2,3,4,5]") fail("business hours don't reach the server's prefs row");
const fnSrc = await (await fetch(APP + "/supabase/functions/voice-agent/index.ts")).text();
if (!/inBusinessHours/.test(fnSrc) || !/touch:\$\{t\.id\}/.test(fnSrc) || !/#\/review\//.test(fnSrc)) fail("the server sweep doesn't push ready texts inside business hours");

// --- 9. A sale retires the plan.
const sold = await p.evaluate(async () => {
  const agent = await import("/js/agent.js"); const store = await import("/js/store.js");
  await agent.execTool("update_lead", { name: "Parm Gill", stage: "sold" });
  const lead = store.all("leads").find((l) => l.name === "Parm Gill");
  return store.all("tasks").filter((t) => t.leadId === lead.id && t.cadence && !t.done).length;
});
console.log("\nafter the sale, open plan steps:", sold);
if (sold) fail("the plan kept running after the sale");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ncontext.test.js FAILED" : "\ncontext.test.js passed");
})();
