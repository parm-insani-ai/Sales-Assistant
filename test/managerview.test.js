// Every rep's activity on the manager's board: the customers they logged,
// the appointments they set, the cars they sold — as a feed for today, as
// counts on the board, and on each rep's sheet with their own sales-target
// sheet and what's coming up. Each rep shows how current their numbers are,
// and a rep in a store can't switch syncing off.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001", U2 = "00000000-0000-4000-8000-000000000002";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const pageAs = async (token, email, settings = {}) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(({ token, email, settings }) => {
    const ids = { t: "00000000-0000-4000-8000-000000000001", t2: "00000000-0000-4000-8000-000000000002", tm: "00000000-0000-4000-8000-000000000003" };
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: token, refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: ids[token], email } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", ...settings } }));
  }, { token, email, settings });
  return p;
};
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "O'Regan's Nissan Halifax", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
await rpc("t2", "join_store", { code: st.code, display_name: "Dana" });

// Parm's day, as his phone synced it.
const now = new Date();
const iso = (d) => d.toISOString();
const ago = (min) => new Date(now.getTime() - min * 60000);
const pad = (n) => String(n).padStart(2, "0");
const ymdLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 12);
// Three days ago, unless that's last month: then the 1st.
const earlier = (() => { const d = new Date(now.getTime() - 3 * 86400000); return d < monthStart ? monthStart : d; })();
const tomorrow = new Date(now.getTime() + 86400000);
const old = iso(new Date(now.getTime() - 400 * 86400000));
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  { id: "config", collection: "config", data: { id: "config", targetNew: 6, targetUsed: 4, closingNew: 40, closingUsed: 40 } },
  { id: "l1", collection: "leads", data: { id: "l1", name: "Dana Muise", phone: "9025551111", stage: "working", vehicleInterest: "2023 Nissan Rogue SV", shopping: "used", createdAt: iso(ago(60)), loggedAt: iso(ago(60)) } },
  { id: "l2", collection: "leads", data: { id: "l2", name: "Ken Boudreau", phone: "9025552222", stage: "appointment", vehicleInterest: "Pathfinder", shopping: "new", createdAt: iso(earlier), loggedAt: iso(earlier) } },
  // An owner from years back, moved over from Outreach half an hour ago.
  { id: "l3", collection: "leads", data: { id: "l3", name: "Old Owner", phone: "9025553333", stage: "delivered", vehicleInterest: "2019 Nissan Rogue", createdAt: old, loggedAt: iso(ago(30)) } },
  // Still just an owner on file: not logged.
  { id: "l4", collection: "leads", data: { id: "l4", name: "Quiet Owner", phone: "9025554444", stage: "delivered", vehicleInterest: "2018 Sentra", createdAt: old } },
  { id: "ap1", collection: "appointments", data: { id: "ap1", leadId: "l1", customerName: "Dana Muise", type: "test drive", when: ymdLocal(tomorrow) + "T15:00", status: "scheduled", createdAt: iso(ago(20)) } },
  { id: "s1", collection: "sales", data: { id: "s1", leadId: "l5", customerName: "Moe Hassan", vehicle: "2026 Nissan Frontier", saleDate: ymdLocal(now), newUsed: "New", createdAt: iso(ago(10)), frontGross: 900 } },
] }) });
const loggedTodayWant = [ago(60), earlier, ago(30)].filter((d) => ymdLocal(d) === ymdLocal(now)).length;

// --- The manager's Home.
const mgr = await pageAs("tm", "mgr@e.com");
await mgr.goto(APP + "/#/");
await mgr.waitForFunction(() => document.body.classList.contains("management") && document.querySelector(".mg-feed"), null, { timeout: 20000 });
await mgr.waitForFunction(() => /As of/.test(document.body.textContent), null, { timeout: 20000 });
const home = await mgr.evaluate(() => ({
  stats: [...document.querySelectorAll(".stat")].map((s) => s.textContent.replace(/\s+/g, " ").trim()),
  feed: [...document.querySelectorAll(".mg-feed .mg-event")].map((r) => r.dataset.kind + ": " + r.textContent.replace(/\s+/g, " ").trim()),
  reps: [...document.querySelectorAll(".team-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
}));
console.log("manager home:", JSON.stringify(home, null, 1));
if (!home.stats.some((s) => new RegExp(`^3 ?Customers logged in \\w+ · ${loggedTodayWant} today`).test(s))) fail("the store's logged-customers count is wrong: " + JSON.stringify(home.stats));
if (!home.stats.some((s) => /^33% ?Closing/.test(s))) fail("the store's closing ratio isn't 1 sold of 3 logged: " + JSON.stringify(home.stats));
const kinds = home.feed.map((f) => f.split(":")[0]);
if (kinds[0] !== "sold" || !/Sold Moe Hassan a 2026 Nissan Frontier.*Parm/.test(home.feed[0])) fail("the newest thing on the floor isn't Parm's sale: " + JSON.stringify(home.feed));
if (!home.feed.some((f) => /^appt: Set an appointment with Dana Muise for .*Parm.*test drive/.test(f))) fail("the appointment Parm set isn't in the feed: " + JSON.stringify(home.feed));
if (!home.feed.some((f) => /^logged: Logged Dana Muise.*Parm.*Rogue SV · Used/.test(f)) || !home.feed.some((f) => /^logged: Logged Old Owner/.test(f))) fail("the customers Parm logged today aren't in the feed: " + JSON.stringify(home.feed));
if (home.feed.some((f) => /Quiet Owner/.test(f))) fail("an owner who was never logged is in the feed");
const parmRow = home.reps.find((r) => /^Parm/.test(r)) || "", danaRow = home.reps.find((r) => /^Dana/.test(r)) || "";
if (!new RegExp(`${loggedTodayWant} logged today`).test(parmRow) || !/synced just now/.test(parmRow) || !/3 logged this month/.test(parmRow)) fail("Parm's row doesn't say what he logged and that he's current: " + parmRow);
if (!/1 \/ 10/.test(parmRow)) fail("Parm's own target (6 new + 4 used) isn't his goal on the board: " + parmRow);
if (!/never synced/.test(danaRow)) fail("a rep whose phone has never synced isn't flagged: " + danaRow);

// Tap the sale in the feed: nothing to open (no customer on file), so try the appointment.
await mgr.evaluate(() => document.querySelector('.mg-event[data-kind="appt"]').click());
await mgr.waitForFunction(() => /Dana Muise/.test(document.querySelector(".modal h2")?.textContent || ""), null, { timeout: 8000 }).catch(() => fail("tapping the appointment in the feed didn't open the customer"));
await mgr.keyboard.press("Escape");
await mgr.waitForTimeout(300);

// --- Parm's sheet.
await mgr.click('.team-row[data-rep="' + U1 + '"]');
await mgr.waitForSelector(".modal .rep-target");
const sheet = await mgr.evaluate(() => ({
  synced: document.querySelector(".modal .rep-synced")?.textContent.trim(),
  target: document.querySelector(".modal .rep-target")?.textContent.replace(/\s+/g, " ").trim(),
  upcoming: [...document.querySelectorAll(".modal .rep-upcoming .row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  logged: [...document.querySelectorAll(".modal .rep-logged .row-title")].map((n) => n.textContent.trim()),
}));
console.log("Parm's sheet:", JSON.stringify(sheet, null, 1));
if (!/synced just now/.test(sheet.synced || "")) fail("the sheet doesn't say how current Parm's numbers are: " + sheet.synced);
// 6 new at 40% and 4 used at 40%: 15 + 10 = 25 to speak with for 10 units.
if (!/1 \/ 10 ?Sold · 9 to go · 10% of target/.test(sheet.target || "") || !/3 \/ 25 ?Spoken with/.test(sheet.target) || !/33% ?Closing/.test(sheet.target)) fail("Parm's target sheet isn't his own numbers: " + sheet.target);
if (!/New: sold 1 of 6, spoken with 1 of 15 · Used: sold 0 of 4, spoken with 1 of 10/.test(sheet.target)) fail("the new/used split is wrong: " + sheet.target);
if (!sheet.upcoming.some((r) => /Dana Muise.*test drive/.test(r))) fail("tomorrow's appointment isn't under Coming up: " + JSON.stringify(sheet.upcoming));
if (JSON.stringify(sheet.logged.slice().sort()) !== JSON.stringify(["Dana Muise", "Ken Boudreau", "Old Owner"])) fail("the logged list isn't the three logged this month: " + JSON.stringify(sheet.logged));
if (sheet.logged[0] !== "Old Owner") fail("the logged list isn't newest first: " + JSON.stringify(sheet.logged));
await mgr.keyboard.press("Escape");

// --- A rep in a store: syncing on, and the switch locked.
const rep = await pageAs("t", "p@e.com", { cloudAutoSync: false });
await rep.goto(APP + "/#/");
await rep.waitForFunction(async () => { const s = (await import("/js/store.js")).getSettings(); return s.cloudAutoSync === true; }, null, { timeout: 15000 }).catch(() => fail("a rep in a store still has syncing off"));
await rep.evaluate(() => { location.hash = "#/settings"; });
await rep.waitForSelector("#c-auto", { state: "attached", timeout: 15000 });
const sw = await rep.evaluate(() => { const c = document.querySelector("#c-auto"); return { checked: c.checked, disabled: c.disabled, hint: /manager's board/.test(c.closest(".card, div").parentElement.textContent) }; });
console.log("rep's sync switch:", JSON.stringify(sw));
if (!sw.checked || !sw.disabled) fail("a rep in a store can switch syncing off: " + JSON.stringify(sw));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nmanagerview.test.js FAILED" : "\nmanagerview.test.js passed");
})();
