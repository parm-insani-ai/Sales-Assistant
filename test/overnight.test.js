// The night read, on the phone: the record the function writes overnight
// (collection "agentplays", one per day) leads the day's queue, each play
// with its reason, and a text play carries the draft into the one-tap Text
// button — reviewed in the conversation before it sends, like every text.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
await p.addInitScript(([today]) => {
  try { localStorage.setItem("viniva:log:tab", "queue"); } catch {} // these tests read the queue chip
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "dana", name: "Dana Muise", phone: "9025551002", stage: "working", vehicleInterest: "Nissan Kicks", ...x },
      { id: "ken", name: "Ken Boudreau", phone: "9025551001", stage: "appointment", vehicleInterest: "Rogue SV", ...x },
      { id: "moe", name: "Moe Hassan", phone: "", stage: "negotiating", vehicleInterest: "Frontier", ...x },
    ],
    agentplays: [
      { id: "agentplays:" + today, date: today, summary: "Two to chase, one to shore up.", at: "2026-09-01T05:00:00.000Z", ...x, plays: [
        { customer: "Dana Muise", leadId: "dana", action: "text", title: "Reply about Saturday", why: "She asked Thursday whether Saturday morning works and nobody answered.", draft: "Hi Dana, Saturday morning works — 10 suit you? I'll have the Kicks out front." },
        { customer: "Ken Boudreau", leadId: "ken", action: "confirm", title: "Confirm Thursday at 4", why: "Booked a week ago, never confirmed.", draft: "" },
        { customer: "Moe Hassan", leadId: "moe", action: "call", title: "Get a number", why: "Mid-deal with no phone on file.", draft: "" },
      ] },
      // Yesterday's read is history, not today's queue.
      { id: "agentplays:2026-01-01", date: "2026-01-01", summary: "", at: "2026-01-01T05:00:00.000Z", ...x, plays: [{ customer: "Dana Muise", leadId: "dana", action: "text", title: "Old play", why: "stale", draft: "stale" }] },
    ],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, smsFrom: "+19025550123" },
  }));
}, [today]);

await p.goto(APP + "/#/log");
await p.waitForSelector(".plays-slot .pl-card", { timeout: 10000 }).catch(() => fail("the queue never painted"));
const rows = await p.evaluate(() => [...document.querySelectorAll(".plays-slot .pl-card")].map((r) => ({
  title: r.querySelector(".strong")?.textContent || "", sub: r.querySelector(".small")?.textContent || "",
  btn: r.querySelector("button.btn, a.btn")?.textContent.trim() || "", href: r.querySelector("a.btn")?.getAttribute("href") || "",
})));
console.log("queue:", JSON.stringify(rows.slice(0, 4), null, 1));
const night = rows.filter((r) => /Overnight read/.test(r.sub));
if (night.length !== 3) fail(`today's three overnight plays should be on the queue, got ${night.length}`);
if (rows.some((r) => /Old play/.test(r.title))) fail("yesterday's read is on today's queue");
if (!/^Dana Muise: Reply about Saturday$/.test(rows[0].title) || !/She asked Thursday/.test(rows[0].sub)) fail("the night read's first play should lead the queue with its reason: " + JSON.stringify(rows[0]));
if (rows[0].btn !== "Text" || !/^sms:/.test(rows[0].href) || !/Saturday%20morning%20works|Saturday morning works/.test(decodeURIComponent(rows[0].href))) fail("a text play should carry its draft into the Text button: " + JSON.stringify(rows[0]));
const ken = rows.find((r) => /Ken Boudreau/.test(r.title));
if (!ken || ken.btn !== "Appointments") fail("a confirm play with no draft opens the appointments: " + JSON.stringify(ken));
const moe = rows.find((r) => /Moe Hassan/.test(r.title));
if (!moe || moe.btn !== "Add number") fail("a call play with no phone opens the customer to add one: " + JSON.stringify(moe));

// The agent's play sheet sees them too, and the sync list carries the collection.
const agent = await p.evaluate(async () => {
  const pl = await import("/js/plays.js"); const s = await import("/js/store.js");
  return { top: pl.getPlays(3).map((x) => x.kind), synced: s.SYNC_COLLECTIONS.includes("agentplays") };
});
if (agent.top[0] !== "overnight" || !agent.synced) fail("the overnight plays should rank first and the collection should sync: " + JSON.stringify(agent));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\novernight.test.js FAILED" : "\novernight.test.js passed");
})();
