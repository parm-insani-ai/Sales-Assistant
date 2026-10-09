// The Floor's working cards: customers waiting on a reply (nudge the rep,
// or answer as the manager), appointments at risk (unconfirmed inside a
// day, no-shows to rebook), customers in the service drive today with the
// app's read, each rep's plays from the night read and how many they've
// reached, and who was logged today without a welcome.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const pageAs = async (token, email) => {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(({ token, email }) => {
    const ids = { t: "00000000-0000-4000-8000-000000000001", tm: "00000000-0000-4000-8000-000000000003" };
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: token, refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: ids[token], email } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", defaultApr: 7.9, defaultTerm: 84, dealMatchBand: 150 } }));
  }, { token, email });
  return p;
};
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "O'Regan's Nissan Halifax", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });

const now = new Date();
const iso = (d) => d.toISOString();
const ago = (min) => new Date(now.getTime() - min * 60000);
const pad = (n) => String(n).padStart(2, "0");
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const today = local(now).slice(0, 10);
const in3h = new Date(now.getTime() + 3 * 3600000), yday = new Date(now.getTime() - 20 * 3600000);
const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  { id: "l1", collection: "leads", data: { id: "l1", name: "Dana Muise", phone: "9025551111", stage: "working", vehicleInterest: "2023 Nissan Rogue SV", ...x } },
  { id: "l2", collection: "leads", data: { id: "l2", name: "Ken Boudreau", phone: "9025552222", stage: "appointment", vehicleInterest: "Pathfinder", ...x } },
  { id: "l3", collection: "leads", data: { id: "l3", name: "Nick Noshow", phone: "9025553333", stage: "working", vehicleInterest: "Kicks", ...x } },
  // In the service drive today, with equity and a lease ending: worth a walk-over.
  { id: "l4", collection: "leads", data: { id: "l4", name: "Sue Service", phone: "9025554444", stage: "delivered", vehicleInterest: "2021 Nissan Rogue SV", serviceAppt: today + "T10:30", currentPayment: 540, payoff: 12000, currentValue: 21000, leaseEnd: new Date(now.getTime() + 60 * 86400000).toISOString().slice(0, 10), purchaseDate: "2021-06-01", currentTerm: 60, ...x } },
  // Logged today, no text yet.
  { id: "l5", collection: "leads", data: { id: "l5", name: "Wes Walkin", phone: "9025555555", stage: "new", vehicleInterest: "Sentra", createdAt: iso(ago(50)), loggedAt: iso(ago(50)), updatedAt: iso(ago(50)) } },
  { id: "x1", collection: "texts", data: { id: "x1", leadId: "l1", dir: "out", body: "Hi Dana, the SV is in.", at: iso(ago(1500)), read: true } },
  { id: "x2", collection: "texts", data: { id: "x2", leadId: "l1", dir: "in", body: "Great, can I see it Saturday?", at: iso(ago(40)), read: false } },
  { id: "ap1", collection: "appointments", data: { id: "ap1", leadId: "l2", customerName: "Ken Boudreau", type: "test drive", when: local(in3h), status: "scheduled", confirmed: false, createdAt: iso(ago(300)) } },
  { id: "ap2", collection: "appointments", data: { id: "ap2", leadId: "l3", customerName: "Nick Noshow", type: "appointment", when: local(yday), status: "scheduled", outcome: "no_show", createdAt: iso(ago(3000)) } },
  // Two texts drafted on Parm's phone and not sent: Wes's welcome (ready 90 min ago) and a follow-up to Dana.
  { id: "tt1", collection: "tasks", data: { id: "tt1", leadId: "l5", cadence: true, channel: "text", intent: "intro", step: 1, of: 13, title: "Text Wes — Welcome text", due: today, readyAt: iso(ago(90)), done: false } },
  { id: "tt2", collection: "tasks", data: { id: "tt2", leadId: "l1", cadence: true, channel: "text", intent: "value", step: 3, of: 13, title: "Text Dana — Value text", due: today, readyAt: iso(ago(30)), done: false } },
  { id: "tt3", collection: "tasks", data: { id: "tt3", leadId: "l1", cadence: true, channel: "call", step: 4, of: 13, title: "Call Dana — Check-in", due: today, readyAt: iso(ago(20)), done: false } },
  { id: "agentplays:" + today, collection: "agentplays", data: { id: "agentplays:" + today, date: today, summary: "Two to move today.", plays: [
    { customer: "Dana Muise", leadId: "l1", action: "text", title: "Answer Dana about Saturday", why: "She asked to come in." },
    { customer: "Ken Boudreau", leadId: "l2", action: "confirm", title: "Confirm Ken's test drive", why: "Not confirmed yet." },
  ], ...x } },
] }) });

const mgr = await pageAs("tm", "mgr@e.com");
await mgr.goto(APP + "/#/floor");
const settled = () => mgr.waitForFunction(() => document.querySelector(".mg-waiting") && !/reading…|Reading every rep/.test(document.querySelector("#view").textContent), null, { timeout: 20000 });
await settled();
const read = () => mgr.evaluate(() => {
  const txt = (sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, " ").trim() || "";
  const title = (name) => [...document.querySelectorAll("#view .section-title")].map((n) => n.textContent.replace(/\s+/g, " ").trim()).find((t) => t.startsWith(name)) || "";
  return {
    titles: [...document.querySelectorAll("#view .section-title")].map((n) => n.textContent.replace(/\s+/g, " ").trim().split(" ·")[0]),
    waitingTitle: title("Waiting on a reply"), waiting: txt(".mg-waiting"),
    dueTitle: title("Texts waiting to go"), due: txt(".mg-due"),
    riskTitle: title("Appointments at risk"), risk: [...document.querySelectorAll(".mg-risk-row")].map((r) => r.dataset.kind + ": " + r.textContent.replace(/\s+/g, " ").trim()),
    riskDraft: document.querySelector('.mg-risk-row[data-kind="unconfirmed"] [data-mtext]')?.dataset.draft,
    svcTitle: title("In the service drive"), svc: txt(".mg-service"),
    playsTitle: title("Today's plays"), plays: txt(".mg-plays"),
    welcomeTitle: title("Welcomed today"), welcome: txt(".mg-welcome"),
  };
});
let f = await read();
console.log("floor:", JSON.stringify(f, null, 1));
const order = ["Waiting on a reply", "Texts waiting to go", "Appointments at risk", "Today on the floor", "In the service drive", "Today's plays", "Welcomed today", "Fresh leads waiting", "Who to reach out to", "Today's huddle", "Needs a word", "Today's appointments"];
const at = order.map((s) => f.titles.indexOf(s));
if (at.some((i, k) => i < 0 || (k && i < at[k - 1]))) fail("the Floor's cards aren't in order: " + f.titles.join(" | "));
if (!/1 · longest first/.test(f.waitingTitle) || !/Dana Muise 40 min.*Parm · texted: “Great, can I see it Saturday\?”.*Reply/.test(f.waiting)) fail("Dana isn't shown waiting on a reply: " + f.waiting);
if (!/1 unconfirmed · 1 to rebook/.test(f.riskTitle)) fail("the at-risk count is wrong: " + f.riskTitle);
if (!f.risk.some((r) => /^unconfirmed: Ken Boudreau (today|tomorrow) \d\d:\d\d.*Parm · test drive · not confirmed.*Text/.test(r))) fail("Ken's unconfirmed test drive isn't at risk: " + JSON.stringify(f.risk));
if (!f.risk.some((r) => /^noshow: Nick Noshow no-show.*Parm · .* · not rebooked.*Text/.test(r))) fail("Nick's no-show isn't listed to rebook: " + JSON.stringify(f.risk));
if (!/^Hi Ken, it's Sam at O'Regan's Nissan Halifax\. Just confirming your test drive (today|tomorrow) \d\d:\d\d with Parm — reply YES/.test(f.riskDraft || "")) fail("the confirmation draft is wrong: " + f.riskDraft);
if (!/1 today and tomorrow/.test(f.svcTitle) || !/Sue Service.*today 10:30.*2021 Nissan Rogue SV · Parm/.test(f.svc) || !/Send/.test(f.svc)) fail("Sue isn't in the service drive card with a Send: " + f.svc);
if (!/0 of 2 reached/.test(f.playsTitle) || !/Parm 0 of 2 reached.*Two to move today\..*Dana Muise: Answer Dana about Saturday.*Ken Boudreau: Confirm Ken's test drive/.test(f.plays)) fail("Parm's plays aren't shown: " + f.plays);
if (!/1 logged · 0 welcomed/.test(f.welcomeTitle) || !/Wes Walkin.*Parm · Sentra · no text yet.*Welcome now/.test(f.welcome)) fail("Wes isn't waiting for a welcome: " + f.welcome);

if (!/2 drafted, not sent/.test(f.dueTitle) || !/Parm 2 texts ready.*oldest waiting 2 h · Wes \(welcome\), Dana.*Nudge/.test(f.due)) fail("the texts Parm hasn't sent aren't on the Floor: " + f.due);
await mgr.click(".mg-due [data-dnudge]");
await mgr.waitForFunction(async () => (await (await fetch("/__nudges")).json()).length > 0, null, { timeout: 8000 });
const dueNudge = (await (await fetch(APP + "/__nudges")).json())[0];
if (!/2 texts are ready to send/.test(dueNudge.title) || !/2 h/.test(dueNudge.body)) fail("the nudge about unsent texts is wrong: " + JSON.stringify(dueNudge));
await fetch(APP + "/__reset_nudges").catch(() => null);

// --- Nudge the rep about Dana: a push with the wait on it.
await mgr.click(".mg-wait [data-wnudge]");
await mgr.waitForFunction(async () => (await (await fetch("/__nudges")).json()).some((n) => /Dana Muise is waiting/.test(n.title)), null, { timeout: 8000 });
const nudges = (await (await fetch(APP + "/__nudges")).json()).filter((n) => /Dana Muise is waiting/.test(n.title));
if (!nudges[0] || !/Dana Muise is waiting on you/.test(nudges[0].title) || !/40 min/.test(nudges[0].body) || nudges[0].url !== "./#/inbox/l1") fail("the waiting nudge is wrong: " + JSON.stringify(nudges[0]));

// --- Reply as the manager: no figures, then sent, filed, and Dana no longer waiting.
await mgr.click(".mg-wait [data-mreply]");
await mgr.waitForSelector("#mt-body");
await mgr.fill("#mt-body", "Saturday works — and it's $300 a month.");
await mgr.click('.modal [data-act="send"]');
await mgr.waitForTimeout(400);
let mtexts = await (await fetch(APP + "/__mtexts")).json();
if (mtexts.length) fail("a text with a dollar amount in it was sent");
if (!(await mgr.$("#mt-body"))) fail("the sheet closed on a refused text");
await mgr.fill("#mt-body", "Saturday works, Dana — come by any time after ten and ask for Parm.");
await mgr.click('.modal [data-act="send"]');
await mgr.waitForFunction(async () => (await (await fetch("/__mtexts")).json()).length === 1, null, { timeout: 8000 });
mtexts = await (await fetch(APP + "/__mtexts")).json();
if (mtexts[0].rep !== U1 || mtexts[0].leadId !== "l1" || mtexts[0].to !== "9025551111") fail("the manager's text didn't go to Dana through Parm's book: " + JSON.stringify(mtexts[0]));
await mgr.waitForFunction(() => /Every customer who wrote has been answered/.test(document.querySelector(".mg-waiting")?.textContent || ""), null, { timeout: 15000 }).catch(() => fail("after the reply, Dana is still shown waiting"));
f = await read();
if (!/1 of 2 reached/.test(f.playsTitle)) fail("answering Dana didn't count as reaching the play about her: " + f.playsTitle);

// --- The service drive: hand Sue to Parm.
await mgr.click(".mg-service [data-hand]");
await mgr.waitForFunction(() => /Sent/.test(document.querySelector(".mg-service [data-hand]")?.textContent || ""), null, { timeout: 8000 });
const task = await mgr.evaluate(async (U1) => { const bk = await import("/js/backend.js"); return (await bk.readRecords(U1, "tasks")).map((r) => r.data).find((t) => t.leadId === "l4"); }, U1);
if (!task || !/Sue Service/.test(task.title)) fail("handing Sue over didn't put a to-do in Parm's book: " + JSON.stringify(task));

// --- Welcome Wes now.
await mgr.click(".mg-welcome [data-welcome]");
await mgr.waitForFunction(async () => (await (await fetch("/__welcomes")).json()).length === 1, null, { timeout: 8000 });
const w = (await (await fetch(APP + "/__welcomes")).json())[0];
if (w.rep !== U1 || w.leadId !== "l5") fail("the welcome didn't go to Wes: " + JSON.stringify(w));
await mgr.waitForFunction(() => /1 logged · 1 welcomed/.test([...document.querySelectorAll("#view .section-title")].map((n) => n.textContent.replace(/\s+/g, " ")).join(" ")), null, { timeout: 15000 }).catch(() => fail("after the welcome, Wes still counts as unwelcomed"));

// --- A draft the agent held for a waiting customer: the Floor's button
// sends it, and the push's link opens the sheet on it.
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  { id: "l6", collection: "leads", data: { id: "l6", name: "Ira Inbound", phone: "9025556666", stage: "working", vehicleInterest: "Frontier", ...x } },
  { id: "x6", collection: "texts", data: { id: "x6", leadId: "l6", dir: "in", body: "Is the Frontier still there?", at: iso(ago(25)), read: false } },
] }) });
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: "00000000-0000-4000-8000-000000000003", rows: [
  { id: "reply:l6", collection: "agentdrafts", data: { id: "reply:l6", rep: U1, repName: "Parm", leadId: "l6", name: "Ira Inbound", body: "Hi Ira, Sam here, the sales manager — it is, and Parm can have it out front for you. Does this afternoon or tomorrow morning suit?", at: iso(ago(1)) } },
] }) });
await mgr.evaluate(async () => { const s = await import("/js/sync.js"); await s.syncNow(); sessionStorage.removeItem("viniva:team-board"); });
await mgr.goto(APP + "/#/floor/reply-l6");
await mgr.waitForSelector("#mt-body", { timeout: 20000 }).catch(() => fail("the push's link didn't open the sheet on the held draft"));
const heldBox = await mgr.evaluate(() => ({ title: document.querySelector(".modal h2")?.textContent.trim(), body: document.querySelector("#mt-body")?.value }));
console.log("held draft:", JSON.stringify(heldBox));
if (heldBox.title !== "Text Ira Inbound" || !/Parm can have it out front/.test(heldBox.body || "")) fail("the sheet didn't open on Ira with the agent's draft: " + JSON.stringify(heldBox));
await mgr.keyboard.press("Escape");
await mgr.waitForFunction(() => !document.querySelector(".modal"), null, { timeout: 5000 });
await mgr.evaluate(() => sessionStorage.removeItem("viniva:team-board"));
await mgr.goto(APP + "/#/floor");
await settled();
await mgr.waitForFunction(() => [...document.querySelectorAll(".mg-wait [data-mreply]")].some((x) => x.dataset.mreply === "l6"), null, { timeout: 20000 }).catch(() => fail("Ira isn't on the waiting card"));
const sendDraft = await mgr.evaluate(() => { const b = [...document.querySelectorAll(".mg-wait [data-mreply]")].find((x) => x.dataset.mreply === "l6"); return b ? { label: b.textContent.trim(), draft: b.dataset.draft } : null; });
if (!sendDraft || sendDraft.label !== "Send draft" || !/out front/.test(sendDraft.draft || "")) fail("Ira's row doesn't offer the held draft: " + JSON.stringify(sendDraft));
await mgr.evaluate(() => [...document.querySelectorAll(".mg-wait [data-mreply]")].find((x) => x.dataset.mreply === "l6").click());
await mgr.waitForSelector("#mt-body");
await mgr.click('.modal [data-act="send"]');
await mgr.waitForFunction(async () => (await (await fetch("/__mtexts")).json()).some((m) => m.leadId === "l6"), null, { timeout: 8000 });
const gone = await mgr.evaluate(async () => { const s = await import("/js/store.js"); return !s.get("agentdrafts", "reply:l6"); });
if (!gone) fail("sending the held draft didn't clear it from the manager's phone");

// --- Text Ken to confirm, from the at-risk card, with the draft.
await mgr.click('.mg-risk-row[data-kind="unconfirmed"] [data-mtext]');
await mgr.waitForSelector("#mt-body");
const draftInBox = await mgr.evaluate(() => document.querySelector("#mt-body").value);
if (!/Just confirming your test drive/.test(draftInBox)) fail("the confirmation draft isn't in the box: " + draftInBox);
await mgr.click('.modal [data-act="send"]');
await mgr.waitForFunction(async () => (await (await fetch("/__mtexts")).json()).length === 2, null, { timeout: 8000 });

// --- Nothing waiting: the card says, per rep, what the board read — so a
// rep's phone showing a text the Floor doesn't is answered on the page.
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  { id: "tt1", collection: "tasks", data: { id: "tt1", leadId: "l5", cadence: true, channel: "text", intent: "intro", step: 1, of: 13, title: "Text Wes — Welcome text", due: today, readyAt: iso(ago(90)), done: true } },
  { id: "tt2", collection: "tasks", data: { id: "tt2", leadId: "l1", cadence: true, channel: "text", intent: "value", step: 3, of: 13, title: "Text Dana — Value text", due: today, readyAt: iso(ago(30)), done: true } },
  // Still in its hold: ready in ten minutes.
  { id: "tt4", collection: "tasks", data: { id: "tt4", leadId: "l6", cadence: true, channel: "text", intent: "intro", step: 1, of: 13, title: "Text Ira — Welcome text", due: today, readyAt: iso(ago(-10)), done: false } },
] }) });
await mgr.evaluate(() => sessionStorage.removeItem("viniva:team-board"));
await mgr.goto(APP + "/#/floor");
await settled();
const readDue = () => mgr.evaluate(() => ({ title: [...document.querySelectorAll("#view .section-title")].map((n) => n.textContent.replace(/\s+/g, " ").trim()).find((t) => t.startsWith("Texts waiting to go")), held: [...document.querySelectorAll(".mg-held-rep")].map((n) => n.textContent.replace(/\s+/g, " ").trim()), lines: [...document.querySelectorAll(".mg-due-found")].map((n) => n.textContent.replace(/\s+/g, " ").trim()) }));
let found = await readDue();
console.log("held:", JSON.stringify(found));
const inTen = new Date(now.getTime() + 10 * 60000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "\\s");
// The welcome in its hold is on the Floor as it is on Parm's Right now: held, with its minute.
if (!/· 1 held$/.test(found.title || "")) fail("the held welcome isn't counted: " + found.title);
if (found.held.length !== 1 || !new RegExp("^Parm 1 text held ?sends " + inTen + " · Ira \\(welcome\\)$").test(found.held[0])) fail("the held welcome isn't on the card: " + JSON.stringify(found.held));
if (found.lines.length) fail("the what-was-read lines show while a text is held: " + JSON.stringify(found.lines));
// Nothing drafted at all: the card says what it read from each rep's phone.
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  { id: "tt4", collection: "tasks", data: { id: "tt4", leadId: "l6", cadence: true, channel: "text", intent: "intro", step: 1, of: 13, title: "Text Ira — Welcome text", due: today, readyAt: iso(ago(-60)), done: false } },
] }) });
await mgr.evaluate(() => sessionStorage.removeItem("viniva:team-board"));
await mgr.reload();
await settled();
found = await readDue();
console.log("found:", JSON.stringify(found));
const inHour = new Date(now.getTime() + 60 * 60000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "\\s");
if (!/· none$/.test(found.title || "")) fail("with every text sent the card still counts some: " + found.title);
if (found.lines.length !== 1 || !new RegExp("^Parm · synced .* · 1 planned, next ready " + inHour + "$").test(found.lines[0])) fail("the empty card doesn't say what it read from Parm's phone: " + JSON.stringify(found.lines));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nfloor.test.js FAILED" : "\nfloor.test.js passed");
})();
