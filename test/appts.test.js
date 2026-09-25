// The tactical half of the store's app: the appointment board with one-tap
// outcomes written into the rep's own record, the confirmation queue and
// nudges to reps' phones, fresh leads waiting with a nudge, manager-set
// targets that the rep's own app adopts, and the morning huddle.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001", U2 = "00000000-0000-4000-8000-000000000002";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const pageAs = async (token, email, leads = []) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(({ token, email, leads }) => {
    const ids = { t: "00000000-0000-4000-8000-000000000001", t2: "00000000-0000-4000-8000-000000000002", tm: "00000000-0000-4000-8000-000000000003" };
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: token, refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: ids[token], email } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, settings: { salesperson: "Sam", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", goalUnits: 12, goalAppointments: 30 } }));
  }, { token, email, leads });
  return p;
};
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "O'Regan's Nissan Halifax", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
await rpc("t2", "join_store", { code: st.code, display_name: "Dana" });
const now = new Date(); const iso = (d) => d.toISOString(); const day = (n, h = 10) => { const d = new Date(now); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d; }; const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const seed = (user_id, rows) => fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id, rows }) });
await seed(U1, [
  { id: "l1", collection: "leads", data: { id: "l1", name: "Fresh Lead", phone: "9025551111", stage: "new", vehicleInterest: "2026 Nissan Rogue SV", source: "Web", createdAt: iso(new Date(now.getTime() - 3 * 3600000)) } },
  { id: "tm1", collection: "appointments", data: { id: "tm1", leadId: "l1", customerName: "Tomorrow Unconfirmed", type: "test drive", when: ymd(day(1)) + "T11:00", status: "scheduled", createdAt: iso(day(-1)) } },
  { id: "td1", collection: "appointments", data: { id: "td1", customerName: "Later Today", when: ymd(now) + "T23:45", status: "scheduled", confirmed: true, createdAt: iso(day(-2)) } },
  { id: "ns1", collection: "appointments", data: { id: "ns1", customerName: "Missed Us", when: ymd(day(-3)) + "T14:00", status: "scheduled", outcome: "no_show", createdAt: iso(day(-5)) } },
  { id: "ul1", collection: "appointments", data: { id: "ul1", customerName: "Unlogged Past", when: ymd(day(-2)) + "T09:00", status: "scheduled", confirmed: true, createdAt: iso(day(-4)) } },
]);
await seed(U2, [
  { id: "tm2", collection: "appointments", data: { id: "tm2", customerName: "Dana Tomorrow", when: ymd(day(1)) + "T15:00", status: "scheduled", confirmed: true, createdAt: iso(day(-1)) } },
]);

// --- The board.
const mgr = await pageAs("tm", "mgr@e.com");
await mgr.goto(APP + "/#/appointments");
await mgr.waitForFunction(() => document.body.classList.contains("management") && document.querySelectorAll(".ap-row").length > 0, null, { timeout: 20000 });
const board = await mgr.evaluate(() => ({
  tabs: [...document.querySelectorAll(".tabbar .tab-label")].map((n) => n.textContent.trim()),
  stats: [...document.querySelectorAll(".stat")].map((s) => s.textContent.replace(/\s+/g, " ").trim()),
  queue: document.querySelector(".ap-queue")?.textContent.replace(/\s+/g, " ").trim(),
  chips: [...document.querySelectorAll("[data-tab]")].map((n) => n.textContent.trim()),
  today: [...document.querySelectorAll(".ap-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
}));
console.log("board:", JSON.stringify(board, null, 1));
if (board.tabs.join() !== "Home,Appts,Insights,Team,Settings") fail("the Appts tab is missing: " + board.tabs.join());
if (!board.stats.some((s) => /^1 ?Today · 1 still to come/.test(s)) || !board.stats.some((s) => /^1 ?Tomorrow's not yet confirmed/.test(s)) || !board.stats.some((s) => /^1 ?No-shows/.test(s))) fail("the board's numbers are wrong: " + JSON.stringify(board.stats));
if (!/Confirm tomorrow: 1 appointment unconfirmed/.test(board.queue || "")) fail("no confirmation queue: " + board.queue);
if (board.chips.join() !== "Today 1,Tomorrow 2,This week 0,No-shows 1,Unlogged 1") fail("the chips are wrong: " + board.chips.join());
if (!board.today.some((t) => /23:45 · Later Today.*Parm.*Confirmed/.test(t))) fail("today's row is wrong: " + JSON.stringify(board.today));

// Nudge the reps to confirm: one push, to Parm only (Dana's is confirmed).
await mgr.click('[data-act="nudge-queue"]');
await mgr.waitForTimeout(500);
let nudges = await (await fetch(APP + "/__nudges")).json();
console.log("nudges:", JSON.stringify(nudges));
if (nudges.length !== 1 || nudges[0].to !== U1 || !/Confirm tomorrow's appointment/.test(nudges[0].title) || !/11:00 Tomorrow Unconfirmed/.test(nudges[0].body)) fail("the confirm nudge is wrong: " + JSON.stringify(nudges));

// Mark tomorrow's as confirmed, then the unlogged one as showed: written into the rep's record.
await mgr.click('[data-tab="tomorrow"]');
await mgr.click('.ap-row[data-id="tm1"]');
await mgr.waitForSelector("#ap-confirmed");
await mgr.check("#ap-confirmed");
await mgr.waitForTimeout(300);
await mgr.keyboard.press("Escape");
await mgr.waitForTimeout(200);
const afterConfirm = await mgr.evaluate(() => ({ queue: !!document.querySelector(".ap-queue"), row: document.querySelector('.ap-row[data-id="tm1"]')?.textContent.replace(/\s+/g, " ").trim() }));
if (afterConfirm.queue || !/Confirmed/.test(afterConfirm.row || "")) fail("confirming didn't take on the board: " + JSON.stringify(afterConfirm));
await mgr.click('[data-tab="unlogged"]');
await mgr.click('.ap-row[data-id="ul1"]');
await mgr.waitForSelector('.modal [data-o="showed"]');
await mgr.click('.modal [data-o="showed"]');
await mgr.waitForTimeout(400);
const recs = await (await fetch(APP + "/__records")).json();
const tm1 = recs.find((r) => r.id === "tm1" && r.user_id === U1), ul1 = recs.find((r) => r.id === "ul1" && r.user_id === U1);
console.log("rep's records:", JSON.stringify([tm1 && tm1.data.confirmed, ul1 && ul1.data.outcome]));
if (!tm1 || tm1.data.confirmed !== true || !ul1 || ul1.data.outcome !== "showed") fail("the marks didn't land in the rep's records");
const unloggedNow = await mgr.evaluate(() => document.querySelector('[data-tab="unlogged"]')?.textContent.trim());
if (unloggedNow !== "Unlogged 0") fail("the unlogged count didn't drop: " + unloggedNow);

// A rep can't mark another rep's appointment through the database.
const forged = await rpc("t2", "manager_update_appointment", { member: U1, appt_id: "td1", patch: { outcome: "sold" } });
if (!forged.message || !/only a manager/.test(forged.message)) fail("a rep could mark another rep's appointment: " + JSON.stringify(forged));

// --- Home: fresh leads waiting, nudge, huddle.
await mgr.click('.tabbar [data-route="/"]');
await mgr.waitForFunction(() => /Fresh leads waiting/.test(document.body.textContent) && document.querySelector("[data-nudge]"), null, { timeout: 15000 });
const home = await mgr.evaluate(() => ({ waiting: [...document.querySelectorAll("[data-nudge]")].map((b) => b.closest(".row").textContent.replace(/\s+/g, " ").trim()), huddle: document.querySelector("#mg-huddle")?.textContent }));
console.log("waiting:", JSON.stringify(home.waiting), "\nhuddle:", home.huddle);
if (!home.waiting.some((w) => /Fresh Lead 3 h.*Parm.*Web/.test(w))) fail("the fresh lead isn't waiting with its age: " + JSON.stringify(home.waiting));
if (!/O'Regan's Nissan Halifax/.test(home.huddle || "") || !/Today: 23:45 Later Today \(Parm\)/.test(home.huddle) || !/Parm — /.test(home.huddle)) fail("the huddle is wrong: " + home.huddle);
await mgr.click("[data-nudge]");
await mgr.waitForTimeout(400);
nudges = await (await fetch(APP + "/__nudges")).json();
if (nudges.length !== 2 || !/Fresh Lead has been waiting 3 h/.test(nudges[1].title) || nudges[1].url !== "./#/leads/l1") fail("the lead nudge is wrong: " + JSON.stringify(nudges[1]));

// --- Targets: the manager sets Parm's month; the board plans on it; Parm's app adopts it.
await mgr.click('.tabbar [data-route="/team"]');
await mgr.waitForSelector('[data-target="' + U1 + '"]');
await mgr.click('[data-target="' + U1 + '"]');
await mgr.waitForSelector("#tg-units");
await mgr.fill("#tg-units", "15");
await mgr.fill("#tg-appts", "40");
await mgr.click('.modal [data-act="save"]');
await mgr.waitForFunction((U1) => /15u · 40a/.test(document.querySelector('[data-target="' + U1 + '"]')?.textContent || ""), U1, { timeout: 15000 });
const rep = await pageAs("t", "p@e.com", [{ id: "x", name: "Someone", phone: "9025550000", stage: "working", vehicleInterest: "Rogue", createdAt: "x", updatedAt: "x" }]);
await rep.goto(APP + "/#/goals");
await rep.waitForFunction(async () => { const s = await import("/js/store.js"); return s.getSettings().goalUnits === 15 && s.getSettings().goalAppointments === 40; }, null, { timeout: 15000 });
await rep.evaluate(() => { location.hash = "#/"; }); await rep.waitForTimeout(300);
await rep.evaluate(() => { location.hash = "#/goals"; }); await rep.waitForTimeout(500);
const goals = await rep.evaluate(() => document.body.textContent.includes("Targets set by your manager"));
if (!goals) fail("the rep's Goals page doesn't say the targets came from the manager");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nappts.test.js FAILED" : "\nappts.test.js passed");
})();
