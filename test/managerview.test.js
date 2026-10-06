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

// --- The manager's Home: the numbers. Floor: the feed. Reps: the rows.
const mgr = await pageAs("tm", "mgr@e.com");
await mgr.goto(APP + "/#/");
await mgr.waitForFunction(() => document.body.classList.contains("management") && document.querySelector(".stat") && /As of/.test(document.body.textContent), null, { timeout: 20000 });
const home = { stats: await mgr.evaluate(() => [...document.querySelectorAll(".stat")].map((s) => s.textContent.replace(/\s+/g, " ").trim())) };
await mgr.click('.tabbar [data-route="/floor"]');
await mgr.waitForFunction(() => document.querySelector(".mg-feed .mg-event"), null, { timeout: 20000 });
home.feed = await mgr.evaluate(() => [...document.querySelectorAll(".mg-feed .mg-event")].map((r) => r.dataset.kind + ": " + r.textContent.replace(/\s+/g, " ").trim()));
const toReps = async () => { await mgr.click('.tabbar [data-route="/reps"]'); await mgr.waitForFunction(() => document.querySelector(".team-row"), null, { timeout: 20000 }); };
await toReps();
home.reps = await mgr.evaluate(() => [...document.querySelectorAll(".team-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));
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
await mgr.click('.tabbar [data-route="/floor"]');
await mgr.waitForFunction(() => document.querySelector('.mg-event[data-kind="appt"]'), null, { timeout: 20000 });
await mgr.evaluate(() => document.querySelector('.mg-event[data-kind="appt"]').click());
await mgr.waitForFunction(() => /Dana Muise/.test(document.querySelector(".modal h2")?.textContent || ""), null, { timeout: 8000 }).catch(() => fail("tapping the appointment in the feed didn't open the customer"));
await mgr.keyboard.press("Escape");
await mgr.waitForTimeout(300);

// --- Parm's sheet, from Reps.
await toReps();
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

// --- Reps → Logged: everyone logged this month across the store, with the
// follow-up plan and where it stands. Dana has a plan with step 3 due today;
// Ken's plan is done; Old Owner never got one.
const todayK = ymdLocal(now);
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  { id: "t1", collection: "tasks", data: { id: "t1", leadId: "l1", cadence: true, step: 1, of: 13, channel: "text", due: todayK, done: true, title: "Text Dana — Welcome text" } },
  { id: "t2", collection: "tasks", data: { id: "t2", leadId: "l1", cadence: true, step: 2, of: 13, channel: "call", due: todayK, done: true, title: "Call Dana — Intro call" } },
  { id: "t3", collection: "tasks", data: { id: "t3", leadId: "l1", cadence: true, step: 3, of: 13, channel: "text", due: todayK, done: false, title: "Text Dana — Value text" } },
  { id: "t4", collection: "tasks", data: { id: "t4", leadId: "l1", cadence: true, step: 4, of: 13, channel: "call", due: ymdLocal(new Date(now.getTime() + 2 * 86400000)), done: false, title: "Call Dana — Check-in" } },
  { id: "t5", collection: "tasks", data: { id: "t5", leadId: "l2", cadence: true, step: 1, of: 2, channel: "text", due: ymdLocal(earlier), done: true, title: "Text Ken" } },
  { id: "t6", collection: "tasks", data: { id: "t6", leadId: "l2", cadence: true, step: 2, of: 2, channel: "call", due: ymdLocal(earlier), done: true, title: "Call Ken" } },
] }) });
await mgr.goto(APP + "/#/reps");
await mgr.waitForSelector("[data-chip]", { timeout: 20000 });
// Pull-to-refresh is a touch gesture; a fresh read is what a reload does here.
await mgr.evaluate(() => sessionStorage.removeItem("viniva:team-board"));
await mgr.reload();
await mgr.waitForFunction(() => document.querySelector('[data-chip="logged"] .seg-count')?.textContent.trim() === "3", null, { timeout: 20000 });
await mgr.click('[data-chip="logged"]');
await mgr.waitForSelector(".mg-logged-row", { timeout: 10000 });
const loggedTab = await mgr.evaluate(() => [...document.querySelectorAll(".mg-logged-row")].map((r) => ({ name: r.querySelector(".row-title").textContent.trim(), sub: r.querySelector(".row-sub").textContent.replace(/\s+/g, " ").trim(), plan: r.querySelector(".mg-plan-line").textContent.replace(/\s+/g, " ").trim(), stage: r.querySelector(".badge").textContent.trim() })));
console.log("logged chip:", JSON.stringify(loggedTab, null, 1));
if (loggedTab.map((r) => r.name).join() !== "Old Owner,Dana Muise,Ken Boudreau") fail("the logged list isn't everyone logged this month, newest first: " + loggedTab.map((r) => r.name).join());
const dRow = loggedTab.find((r) => r.name === "Dana Muise") || {}, kRow = loggedTab.find((r) => r.name === "Ken Boudreau") || {}, oRow = loggedTab.find((r) => r.name === "Old Owner") || {};
if (!/^Plan step 3 of 13 · text today/.test(dRow.plan || "")) fail("Dana's plan status is wrong: " + dRow.plan);
if (!/Follow-up plan done · 2 of 2/.test(kRow.plan || "")) fail("Ken's finished plan isn't shown as done: " + kRow.plan);
if (!/No follow-up plan/.test(oRow.plan || "")) fail("a customer with no plan isn't flagged: " + oRow.plan);
if (!/Parm · 2023 Nissan Rogue SV · Used · logged today/.test(dRow.sub || "")) fail("the logged row doesn't say who, what and when: " + dRow.sub);
if (dRow.stage !== "Working" || kRow.stage !== "Appointment") fail("the stage badges are wrong: " + JSON.stringify([dRow.stage, kRow.stage]));
// The chip is remembered; a tap on a row opens the customer.
await mgr.click(".mg-logged-row");
await mgr.waitForFunction(() => /Old Owner/.test(document.querySelector(".modal h2")?.textContent || ""), null, { timeout: 8000 }).catch(() => fail("tapping a logged customer didn't open them"));
await mgr.keyboard.press("Escape");
await mgr.goto(APP + "/#/");
await mgr.goto(APP + "/#/reps");
await mgr.waitForSelector(".mg-logged-row", { timeout: 10000 }).catch(() => fail("the Logged chip wasn't remembered"));
await mgr.click('[data-chip="reps"]');
await mgr.waitForSelector(".team-row", { timeout: 10000 });

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
