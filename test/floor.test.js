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
    riskTitle: title("Appointments at risk"), risk: [...document.querySelectorAll(".mg-risk-row")].map((r) => r.dataset.kind + ": " + r.textContent.replace(/\s+/g, " ").trim()),
    riskDraft: document.querySelector('.mg-risk-row[data-kind="unconfirmed"] [data-mtext]')?.dataset.draft,
    svcTitle: title("In the service drive"), svc: txt(".mg-service"),
    playsTitle: title("Today's plays"), plays: txt(".mg-plays"),
    welcomeTitle: title("Welcomed today"), welcome: txt(".mg-welcome"),
  };
});
let f = await read();
console.log("floor:", JSON.stringify(f, null, 1));
const order = ["Waiting on a reply", "Appointments at risk", "Today on the floor", "In the service drive", "Today's plays", "Welcomed today", "Fresh leads waiting", "Who to reach out to", "Today's huddle", "Needs a word", "Today's appointments"];
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

// --- Nudge the rep about Dana: a push with the wait on it.
await mgr.click(".mg-wait [data-wnudge]");
await mgr.waitForFunction(async () => (await (await fetch("/__nudges")).json()).length > 0, null, { timeout: 8000 });
const nudges = await (await fetch(APP + "/__nudges")).json();
if (!/Dana Muise is waiting on you/.test(nudges[0].title) || !/40 min/.test(nudges[0].body) || nudges[0].url !== "./#/inbox/l1") fail("the waiting nudge is wrong: " + JSON.stringify(nudges[0]));

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

// --- Text Ken to confirm, from the at-risk card, with the draft.
await mgr.click('.mg-risk-row[data-kind="unconfirmed"] [data-mtext]');
await mgr.waitForSelector("#mt-body");
const draftInBox = await mgr.evaluate(() => document.querySelector("#mt-body").value);
if (!/Just confirming your test drive/.test(draftInBox)) fail("the confirmation draft isn't in the box: " + draftInBox);
await mgr.click('.modal [data-act="send"]');
await mgr.waitForFunction(async () => (await (await fetch("/__mtexts")).json()).length === 2, null, { timeout: 8000 });

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nfloor.test.js FAILED" : "\nfloor.test.js passed");
})();
