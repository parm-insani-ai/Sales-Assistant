// Advanced statistics on the screen: under the manager's "+", every rep's
// log read together, with the sentences at the top; under the rep's "+",
// their own. The window chips re-read without a reload.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "Store", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
// Parm's log: twelve leads answered inside ten minutes, each confirmed and shown or not.
const D = 86400000, MIN = 60000;
const now = Date.now();
const rows = [];
let n = 0;
const push = (kind, at, extra) => rows.push({ id: "ev" + (++n), collection: "events", data: { id: "ev" + n, kind, at: new Date(at).toISOString(), by: "rep", prompt: "", ...extra } });
for (let i = 0; i < 12; i++) {
  const arrive = now - (i + 1) * D;
  push("lead_new", arrive, { leadId: "l" + i, name: "Lead " + i, meta: { source: "Web" } });
  push("text_out", arrive + (2 + i % 5) * MIN, { leadId: "l" + i, prompt: "intro" });
  push("appt_set", arrive + 3 * 3600000, { leadId: "l" + i, meta: { apptId: "a" + i, when: new Date(arrive + D).toISOString().slice(0, 16) } });
  if (i % 2 === 0) push("appt_confirmed", arrive + 5 * 3600000, { leadId: "l" + i, meta: { apptId: "a" + i } });
  push(i % 2 === 0 || i % 3 === 0 ? "appt_showed" : "appt_no_show", arrive + D + 3600000, { leadId: "l" + i, meta: { apptId: "a" + i } });
}
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows }) });

const mgr = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
mgr.on("pageerror", (e) => errs.push(e.message));
await mgr.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "tm", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000003", email: "mgr@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
});
// From the "+".
await mgr.goto(APP + "/#/");
await mgr.waitForSelector("#quick-add", { timeout: 20000 });
await mgr.waitForFunction(() => document.body.classList.contains("management"), null, { timeout: 20000 });
await mgr.click("#quick-add");
await mgr.waitForFunction(() => [...document.querySelectorAll(".modal .qa-label")].some((x) => x.textContent.trim() === "Advanced statistics"), null, { timeout: 10000 }).catch(() => fail("Advanced statistics isn't under the manager's +"));
await mgr.evaluate(() => [...document.querySelectorAll(".modal .qa-tile")].find((t) => t.querySelector(".qa-label").textContent.trim() === "Advanced statistics").click());
await mgr.waitForFunction(() => location.hash === "#/stats" && document.querySelector(".st-say") && !/reading…/.test(document.querySelector(".st-count")?.textContent || ""), null, { timeout: 30000 });
const page = await mgr.evaluate(() => ({
  title: document.querySelector("#view .hero-title")?.textContent.trim(),
  count: document.querySelector(".st-count")?.textContent.trim(),
  lines: [...document.querySelectorAll(".st-line")].map((l) => l.dataset.key + ": " + l.textContent.replace(/\s+/g, " ").trim()),
  sections: [...document.querySelectorAll("#view .section-title")].map((n) => n.textContent.replace(/\s+/g, " ").trim().split(" ·")[0]),
  speed: document.querySelector(".st-sec")?.textContent.replace(/\s+/g, " ").trim(),
}));
console.log("stats:", JSON.stringify(page, null, 1));
// 12 leads × (new, text, set, outcome) + 6 confirmations = 54.
if (page.title !== "Advanced statistics" || page.count !== "54 events") fail("the page didn't read the store's log: " + JSON.stringify([page.title, page.count]));
if (page.sections.join("|") !== "What the numbers say|Speed to lead|Pushes|Which follow-up step books|Welcome timing|Confirmations and showing|Your taps|The agent|When things happen|Discipline") fail("the sections are wrong: " + page.sections.join(" | "));
if (!page.lines.some((l) => /^speed: ● ?First contact takes \d min at the median; 100% of leads hear from us inside ten minutes\./.test(l))) fail("the speed sentence isn't at the top: " + JSON.stringify(page.lines));
if (!page.lines.some((l) => /^confirm: ● ?Confirmed appointments show 100% of the time; unconfirmed, \d+%\./.test(l))) fail("the confirmation sentence isn't at the top: " + JSON.stringify(page.lines));
if (!/Parm\s*12\s*\d\s*100%/.test(page.speed || "")) fail("speed to lead doesn't show Parm's row: " + page.speed);
// Seven days: fewer leads, the speed read says what it needs.
await mgr.click('[data-days="7"]');
await mgr.waitForFunction(() => /7 days/.test(document.querySelector("#view .section-title")?.textContent || ""), null, { timeout: 5000 });
const week = await mgr.evaluate(() => document.querySelector(".st-sec")?.textContent.replace(/\s+/g, " ").trim());
if (!/Needs 8 leads with a first contact to read; has 6\./.test(week || "")) fail("the seven-day window didn't re-read: " + week);

// The rep's own, from their phone's log.
const rep = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
rep.on("pageerror", (e) => errs.push(e.message));
await rep.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t4", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000004", email: "r@e.com" } }));
  const ev = []; const D = 86400000, now = Date.now();
  for (let i = 0; i < 9; i++) { const at = now - (i + 1) * D; ev.push({ id: "x" + i, kind: "lead_new", leadId: "q" + i, name: "Q" + i, by: "rep", prompt: "", at: new Date(at).toISOString() }, { id: "y" + i, kind: "call", leadId: "q" + i, by: "rep", prompt: "", at: new Date(at + 20 * 60000).toISOString() }); }
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], events: ev, settings: { salesperson: "Rae", cloudAutoSync: false } }));
});
await rep.goto(APP + "/#/stats");
await rep.waitForFunction(() => document.querySelector(".st-say") && document.querySelector(".st-line"), null, { timeout: 20000 }).catch(() => fail("the rep's statistics page didn't draw a sentence"));
const mine = await rep.evaluate(() => ({ mg: document.body.classList.contains("management"), lines: [...document.querySelectorAll(".st-line")].map((l) => l.textContent.replace(/\s+/g, " ").trim()), taps: [...document.querySelectorAll("#view .section-title")].some((n) => /Your taps/.test(n.textContent)) }));
console.log("rep:", JSON.stringify(mine));
if (mine.mg || mine.taps) fail("the rep's page is the manager's");
if (!mine.lines.some((l) => /Your first contact takes 20 min at the median; 0% of your leads hear from you inside ten minutes\./.test(l))) fail("the rep's own sentence is wrong: " + JSON.stringify(mine.lines));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nstatsui.test.js FAILED" : "\nstatsui.test.js passed");
})();
