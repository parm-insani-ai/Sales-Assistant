// Outreach's Contacted chip says what came of the openers: sent, replied,
// booked over the last four weeks, read from the thread and the calendar,
// with the full readout in Coach one tap away. Nothing sent yet reads as
// a promise, not a zero.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const DAY = 86400000;
const page = async (seed) => {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
  p.on("pageerror", (e) => fail("page error: " + e.message));
  await p.addInitScript((s) => {
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
    localStorage.setItem("viniva:leads-filter", "contacted");
    localStorage.setItem("sales-assistant:v1", JSON.stringify(s));
  }, seed);
  await p.goto(APP + "/#/leads");
  await p.waitForFunction(() => document.querySelector(".lead-outcomes"), null, { timeout: 15000 });
  return p;
};
const now = Date.now();
const iso = (t) => new Date(t).toISOString();
const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const leads = [
  { id: "a", name: "Ann Owner", phone: "9025551111", stage: "delivered", vehicleInterest: "2021 Rogue", lastContacted: iso(now - 3 * DAY), ...x },
  { id: "b", name: "Bo Owner", phone: "9025552222", stage: "delivered", vehicleInterest: "2020 Kicks", lastContacted: iso(now - 2 * DAY), ...x },
  { id: "c", name: "Cy Owner", phone: "9025553333", stage: "delivered", vehicleInterest: "2019 Sentra", lastContacted: iso(now - 1 * DAY), ...x },
];

// --- Three openers in the window: one got a reply, one booked, one nothing.
const p = await page({
  leads,
  outreach: [
    { id: "o1", leadId: "a", kind: "prospect", at: iso(now - 3 * DAY), ...x },
    { id: "o2", leadId: "b", kind: "prospect", at: iso(now - 2 * DAY), ...x },
    { id: "o3", leadId: "c", kind: "plan", at: iso(now - 1 * DAY), ...x },
    { id: "o0", leadId: "a", kind: "prospect", at: iso(now - 40 * DAY), ...x }, // outside the window
  ],
  texts: [{ id: "t1", leadId: "a", dir: "in", body: "Sure, when?", at: iso(now - 2 * DAY), ...x }],
  appointments: [{ id: "ap1", leadId: "b", when: iso(now + 2 * DAY).slice(0, 16), status: "scheduled", createdAt: iso(now - 1 * DAY) }],
  settings: { salesperson: "Parm", cloudAutoSync: false },
});
const line = await p.evaluate(() => ({ text: document.querySelector(".lead-outcomes").textContent.replace(/\s+/g, " ").trim(), href: document.querySelector(".lead-outcomes a")?.getAttribute("href") }));
console.log("contacted line:", JSON.stringify(line));
if (!/^Last 4 weeks: 3 texts sent · 1 replied · 1 booked\./.test(line.text)) fail("the outcomes line doesn't add up the openers: " + line.text);
if (line.href !== "#/coach" || !/What's working/.test(line.text)) fail("the line doesn't lead to the readout: " + JSON.stringify(line));
// The link lands on the readout.
await p.click(".lead-outcomes a");
await p.waitForFunction(() => location.hash === "#/coach" && /What's working/.test(document.body.textContent), null, { timeout: 10000 });
const coach = await p.evaluate(() => document.querySelector(".worked-card")?.textContent.replace(/\s+/g, " ").trim().slice(0, 160));
console.log("coach:", coach);
if (!coach || !/3 opener/.test(coach)) fail("Coach's readout doesn't show the same three openers: " + coach);
// The other chips don't carry it.
await p.goBack();
await p.waitForFunction(() => location.hash === "#/leads", null, { timeout: 5000 });
await p.click('[data-filter="all"]');
await p.waitForTimeout(300);
if (await p.$(".lead-outcomes")) fail("the outcomes line is on a chip other than Contacted");
await p.context().close();

// --- Nothing sent yet: a promise, no zeros, no link.
const q = await page({ leads, settings: { salesperson: "Parm", cloudAutoSync: false } });
const empty = await q.evaluate(() => ({ text: document.querySelector(".lead-outcomes").textContent.trim(), link: !!document.querySelector(".lead-outcomes a") }));
console.log("nothing sent:", JSON.stringify(empty));
if (!/tracked/.test(empty.text) || /0 texts/.test(empty.text) || empty.link) fail("with nothing sent the line should explain, not count: " + JSON.stringify(empty));
await q.context().close();

await b.close();
console.log(process.exitCode ? "\noutcomesline.test.js FAILED" : "\noutcomesline.test.js passed");
})();
