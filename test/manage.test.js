// The store's app: an admin or a manager without a book gets the management
// Home — the store's day added up from the reps, who needs a word, today's
// appointments, the reps by units — with Home / Team / Settings tabs and no
// rep tools. A rep keeps the salesperson's app. A manager who also sells can
// switch between the two.
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
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, settings: { salesperson: "Sam", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
  }, { token, email, leads });
  return p;
};

// The store, made by the admin through the database functions; two reps in it.
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "O'Regan's Nissan Halifax", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
await rpc("t2", "join_store", { code: st.code, display_name: "Dana" });
const now = new Date(); const iso = (d) => d.toISOString(); const day = (n) => new Date(now.getTime() + n * 86400000); const ymd = (d) => d.toISOString().slice(0, 10);
const first = ymd(new Date(now.getFullYear(), now.getMonth(), 1)).slice(0, 8) + "01";
// The seeds below are dated from today, so the totals move with the clock:
// today's 15:30 visit counts as shown-or-not only once 15:30 has passed, and
// the appointment set yesterday falls in last month on the 1st.
const todayPast = now.getHours() > 15 || (now.getHours() === 15 && now.getMinutes() >= 30);
const RATE = todayPast ? "50%" : "100%";       // ap2 showed; ap1 is past only after 15:30
const SET = day(-1).getMonth() === now.getMonth() ? 3 : 2;
const seed = (user_id, rows) => fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id, rows }) });
await seed(U1, [
  { id: "config", collection: "config", data: { id: "config", goalUnits: 12 } },
  { id: "s1", collection: "sales", data: { id: "s1", saleDate: first, frontGross: 1000, backGross: 500 } },
  { id: "s2", collection: "sales", data: { id: "s2", saleDate: ymd(now), frontGross: 700, backGross: 300 } },
  { id: "a1", collection: "activity", data: { id: "a1", type: "touch", createdAt: iso(now) } },
  { id: "ap1", collection: "appointments", data: { id: "ap1", customerName: "Fresh Lead", type: "test drive", when: ymd(now) + "T15:30", status: "scheduled", confirmed: true } },
  { id: "ap2", collection: "appointments", data: { id: "ap2", customerName: "Old Appt", when: first + "T10:00", status: "scheduled", outcome: "showed" } },
  { id: "ap3", collection: "appointments", data: { id: "ap3", customerName: "Tomorrow Guy", when: ymd(day(1)) + "T10:00", status: "scheduled", createdAt: iso(day(-1)) } },
  { id: "l1", collection: "leads", data: { id: "l1", name: "Fresh Lead", phone: "9025551111", stage: "new", vehicleInterest: "2026 Nissan Rogue SV", createdAt: iso(day(-3)) } },
]);
await seed(U2, [
  { id: "config", collection: "config", data: { id: "config", goalUnits: 10 } },
  { id: "m1", collection: "leads", data: { id: "m1", name: "Quiet Lead", phone: "9025559999", stage: "new", vehicleInterest: "Frontier", createdAt: iso(day(-2)) } },
  { id: "m2", collection: "leads", data: { id: "m2", name: "Late One", phone: "9025559998", stage: "working", vehicleInterest: "Kicks", followUp: ymd(day(-4)), createdAt: iso(day(-20)) } },
]);

// --- The admin's Home is the numbers; Floor the day; Reps the reps.
const plusTap = async (p, label) => { await p.click("#quick-add"); await p.waitForFunction((l) => [...document.querySelectorAll(".modal .qa-label")].some((n) => n.textContent.trim() === l), label, { timeout: 10000 }); await p.evaluate((l) => [...document.querySelectorAll(".modal .qa-tile")].find((t) => t.querySelector(".qa-label").textContent.trim() === l).click(), label); };
const mgr = await pageAs("tm", "mgr@e.com");
await mgr.goto(APP + "/#/");
await mgr.waitForFunction(() => document.body.classList.contains("management") && document.querySelector(".stat") && /As of/.test(document.body.textContent), null, { timeout: 20000 });
const home = await mgr.evaluate(() => ({
  title: document.querySelector(".hero-title")?.textContent.trim(),
  tabs: [...document.querySelectorAll(".tabbar .tab-label")].map((n) => n.textContent.trim()),
  stats: [...document.querySelectorAll(".stat")].map((s) => s.textContent.replace(/\s+/g, " ").trim()),
  sections: [...document.querySelectorAll("#view .section-title")].map((n) => n.textContent.trim()),
  tiles: [...document.querySelectorAll("#view .qa-label")].map((n) => n.textContent.trim()),
}));
console.log("management home:", JSON.stringify(home, null, 1));
if (home.sections.length || home.tiles.length) fail("Home should be the numbers only — no sections or tiles: " + JSON.stringify([home.sections, home.tiles]));
await mgr.click('.tabbar [data-route="/floor"]');
await mgr.waitForFunction(() => location.hash === "#/floor" && document.querySelectorAll(".mg-rep").length > 0, null, { timeout: 20000 });
Object.assign(home, await mgr.evaluate(() => ({
  floor: document.querySelector(".hero-title")?.textContent.trim(),
  word: [...document.querySelectorAll(".card .mg-rep.row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  today: [...document.querySelectorAll(".card .row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()).filter((t) => /15:30/.test(t)),
  floorSections: [...document.querySelectorAll("#view .section-title")].map((n) => n.textContent.replace(/\s+/g, " ").trim().split(" ·")[0]),
})));
console.log("floor:", JSON.stringify({ floor: home.floor, sections: home.floorSections }));
for (const s of ["Today on the floor", "Fresh leads waiting", "Who to reach out to", "Today's huddle", "Needs a word", "Today's appointments"]) if (!home.floorSections.includes(s)) fail("Floor is missing: " + s);
await mgr.click('.tabbar [data-route="/reps"]');
await mgr.waitForFunction(() => location.hash === "#/reps" && document.querySelector(".team-row"), null, { timeout: 20000 });
home.reps = await mgr.evaluate(() => [...document.querySelectorAll(".team-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));
await mgr.click('.tabbar [data-route="/"]');
await mgr.waitForFunction(() => location.hash === "#/" && document.querySelector(".mg-plan"), null, { timeout: 10000 });
if (home.title !== "O'Regan's Nissan Halifax" || home.tabs.join() !== "Home,Floor,Voice,Reps,Admin") fail("not the store's app: " + JSON.stringify([home.title, home.tabs]));
// Appointment-first: set this month (2, one of them today), what's still needed for 22 units, shown, units, touches, untouched.
if (!home.stats.some((s) => new RegExp(`^${SET} ?Appointments set in \\w+ · 1 today`).test(s)) || !home.stats.some((s) => /more to set for 22 units · \d+(\.\d)? a day/.test(s)) || !home.stats.some((s) => new RegExp(`^1 · ${RATE} ?Shown`).test(s)) || !home.stats.some((s) => /^2 \/ 22 ?Units · \$2,500 gross/.test(s)) || !home.stats.some((s) => /^2 ?Untouched new leads · 1 overdue/.test(s))) fail("the store totals are wrong: " + JSON.stringify(home.stats));
const plan = await mgr.evaluate(() => document.querySelector(".mg-plan")?.textContent.replace(/\s+/g, " ").trim());
console.log("plan:", plan);
if (!/To hit 22 units: \d+ more appointments set by month end/.test(plan || "") || !/2 sold · [12] on the calendar/.test(plan) || !/typical rates/.test(plan) || !/Parm/.test(plan) || !/Dana/.test(plan)) fail("the plan card is wrong: " + plan);
if (!home.word.some((w) => /^Parm.*1 untouched lead/.test(w)) || !home.word.some((w) => /^Dana.*1 untouched lead/.test(w)) || home.word.some((w) => /^Sam/.test(w))) fail("'needs a word' misses a rep, or nags the manager: " + JSON.stringify(home.word));
if (!home.today.some((t) => /15:30 · Fresh Lead.*Parm.*test drive.*Confirmed/.test(t))) fail("today's appointment isn't on the store's list with the rep: " + JSON.stringify(home.today));
if (!home.reps[0].startsWith("Parm") || !new RegExp(`${SET} set · 1 today · 1 shown`).test(home.reps[0]) || !/needs \d+ · [\d.]+\/day/.test(home.reps[0])) fail("the reps aren't ordered by appointments set, with what they need: " + JSON.stringify(home.reps));
// Everything else is under the "+".
await mgr.click("#quick-add");
await mgr.waitForFunction(() => /Quick actions/.test(document.querySelector(".modal")?.textContent || ""), null, { timeout: 10000 });
const plusTiles = await mgr.evaluate(() => [...document.querySelectorAll(".modal .qa-label")].map((n) => n.textContent.trim()));
for (const l of ["Welcome text", "Email a customer", "Nudge a rep", "Set targets", "Invite a rep", "Appointments", "Customers", "Timing", "Lease ends", "Insights", "Admin", "Settings", "Sales view", "Sign out"]) if (!plusTiles.includes(l)) fail("the + is missing: " + l + " in " + plusTiles.join(","));
await mgr.keyboard.press("Escape");
await mgr.waitForFunction(() => !document.querySelector(".modal"), null, { timeout: 5000 });

// --- No Refresh button: pulling down re-reads the board.
if (await mgr.$('[data-act="refresh"]')) fail("the Refresh button is still on the board");
await mgr.evaluate(() => { window.__refreshed = 0; window.addEventListener("viniva-refresh", (e) => { window.__refreshed++; window.__refreshOk = e.detail.ok; }); document.getElementById("view").scrollTop = 0; });
await mgr.evaluate(() => {
  const t = (y) => ({ clientX: 195, clientY: y, identifier: 1, target: document.body });
  const fire = (name, y) => document.dispatchEvent(new TouchEvent(name, { bubbles: true, cancelable: true, touches: name === "touchend" ? [] : [new Touch(t(y))], changedTouches: [new Touch(t(y))] }));
  fire("touchstart", 80); for (let y = 80; y <= 320; y += 20) fire("touchmove", y); fire("touchend", 320);
});
await mgr.waitForFunction(() => window.__refreshed > 0, null, { timeout: 15000 }).catch(() => fail("pulling down on the board didn't refresh"));
const pulled = await mgr.evaluate(() => ({ ok: window.__refreshOk, line: document.querySelector(".row .small.muted")?.textContent.trim() }));
console.log("pull:", JSON.stringify(pulled));
if (pulled.ok === false || !/pull down to refresh/.test(pulled.line || "")) fail("the pull didn't re-read the board: " + JSON.stringify(pulled));

// --- The "+" in the top right is the manager's: their actions, not a rep's add menu.
await mgr.click("#quick-add");
await mgr.waitForFunction(() => /Quick actions/.test(document.querySelector(".modal")?.textContent || ""), null, { timeout: 10000 });
const quick = await mgr.evaluate(() => [...document.querySelectorAll(".modal .qa-label")].map((n) => n.textContent.trim()));
console.log("quick actions:", quick.join(" · "));
if (!quick.includes("Email a customer") || !quick.includes("Nudge a rep") || !quick.includes("Welcome text") || !quick.includes("Lease ends") || quick.includes("Lead") || quick.includes("Sale")) fail("the manager's + has the wrong tiles: " + quick.join(","));
await mgr.evaluate(() => [...document.querySelectorAll(".modal .qa-tile")].find((t) => /Nudge a rep/.test(t.textContent)).click());
await mgr.waitForSelector("#nd-rep", { timeout: 10000 });
await mgr.fill("#nd-body", "Call Fresh Lead before lunch.");
await mgr.click('.modal [data-act="send"]');
await mgr.waitForFunction(() => !document.querySelector("#nd-rep"), null, { timeout: 10000 });
const quickNudges = await (await fetch(APP + "/__nudges")).json();
if (!quickNudges.some((n) => /before lunch/.test(n.body))) fail("the nudge from the + didn't send: " + JSON.stringify(quickNudges));

// --- Insights: the store, then one rep, with the math and the levers.
await plusTap(mgr, "Insights");
await mgr.waitForFunction(() => location.hash === "#/insights" && document.querySelectorAll(".irow").length > 1, null, { timeout: 15000 });
const insights = await mgr.evaluate(() => ({
  title: document.querySelector(".hero-title")?.textContent.trim(),
  sections: [...document.querySelectorAll(".section-title")].map((n) => n.textContent.replace(/\s+/g, " ").trim().split(" ·")[0]),
  rows: [...document.querySelectorAll(".irow:not(.ihead)")].map((r) => [...r.children].map((c) => c.textContent.trim()).join("|")),
  speed: [...document.querySelectorAll(".irow2")].slice(0, 4).map((r) => [...r.children].map((c) => c.textContent.trim()).join("|")),
  weeks: document.querySelectorAll(".ibars.tall .ibarv").length,
}));
console.log("insights:", JSON.stringify(insights, null, 1));
if (insights.title !== "O'Regan's Nissan Halifax") fail("insights isn't the store's: " + insights.title);
for (const s of ["What the numbers say", "What it takes", "By rep", "The funnel", "Speed to lead", "By source", "When appointments get set", "What makes them show", "Eight weeks"]) if (!insights.sections.includes(s)) fail("insights is missing: " + s + " in " + JSON.stringify(insights.sections));
if (!insights.rows.some((r) => new RegExp(`^Parm\\|${SET}\\|${RATE}\\|\\d+\\|[\\d.]+\\|`).test(r)) || !insights.rows.some((r) => /^Dana\|0\|—\|\d+\|/.test(r))) fail("the by-rep table is wrong: " + JSON.stringify(insights.rows));
if (!insights.speed.some((r) => /^Never touched\|3 leads\|/.test(r))) fail("speed to lead doesn't count the untouched leads: " + JSON.stringify(insights.speed));
if (insights.weeks !== 8) fail("the trend isn't eight weeks: " + insights.weeks);
await mgr.evaluate((U2) => { document.querySelector('.lead-chips [data-who="' + U2 + '"]').click(); }, U2);
await mgr.waitForFunction(() => document.querySelector(".hero-title")?.textContent.trim() === "Dana", null, { timeout: 5000 });
const dana = await mgr.evaluate(() => ({ takes: document.querySelector(".card .stat-grid")?.textContent.replace(/\s+/g, " ").trim(), byRep: !!document.querySelector(".irow") }));
if (!/more appointments to set/.test(dana.takes || "") || dana.byRep) fail("a rep's insights page is wrong: " + JSON.stringify(dana));
await mgr.click('.tabbar [data-route="/reps"]');
await mgr.waitForFunction(() => location.hash === "#/reps" && document.querySelector('.team-row[data-rep="' + "00000000-0000-4000-8000-000000000002" + '"]'), null, { timeout: 15000 });

// Tap a rep: their day, then a customer, read-only.
await mgr.click('.team-row[data-rep="' + U2 + '"]');
await mgr.waitForSelector(".modal [data-lead]");
const sheet = await mgr.evaluate(() => ({ title: document.querySelector(".modal h2")?.textContent.trim(), leads: [...document.querySelectorAll(".modal .rep-untouched [data-lead] .row-title, .modal .rep-overdue [data-lead] .row-title")].map((n) => n.textContent.trim()) }));
if (sheet.title !== "Dana" || sheet.leads.join() !== "Quiet Lead,Late One") fail("the rep sheet from Home is wrong: " + JSON.stringify(sheet));
await mgr.keyboard.press("Escape");

// The Admin tab is the members and admin screen, and nothing else; Customers is under the "+".
await mgr.click('.tabbar [data-route="/team"]');
await mgr.waitForSelector(".admin-store");
const adminPage = await mgr.evaluate(() => ({ greeting: document.querySelector(".hero-greeting")?.textContent.trim(), board: document.querySelectorAll(".team-row, .stat").length, members: !!document.querySelector('[data-role]'), invite: !!document.querySelector("#invite-link") }));
if (adminPage.greeting !== "Admin" || adminPage.board || !adminPage.members || !adminPage.invite) fail("the Admin page isn't just the store's admin information: " + JSON.stringify(adminPage));
await plusTap(mgr, "Customers");
await mgr.waitForFunction(() => location.hash === "#/customers", null, { timeout: 5000 });
await mgr.click('.tabbar [data-route="/"]');
await mgr.waitForFunction(() => location.hash === "#/" && document.querySelector(".stat"), null, { timeout: 10000 });

// --- A rep keeps the salesperson's app.
const rep = await pageAs("t", "p@e.com", [{ id: "x", name: "Someone", phone: "9025550000", stage: "working", vehicleInterest: "Rogue", createdAt: "x", updatedAt: "x" }]);
await rep.goto(APP + "/#/");
await rep.waitForSelector("#view .nudge-slot", { state: "attached", timeout: 20000 });
await rep.waitForTimeout(800);
const repHome = await rep.evaluate(() => ({ mg: document.body.classList.contains("management"), tabs: [...document.querySelectorAll(".tabbar .tab-label")].map((n) => n.textContent.trim()), voice: !!document.querySelector("#voice-btn") }));
console.log("rep home:", JSON.stringify(repHome));
if (repHome.mg || repHome.tabs.join() !== "Home,Outreach,Voice,Log,Comms" || !repHome.voice) fail("a rep got the store's app: " + JSON.stringify(repHome));
const repTools = await rep.evaluate(async () => { document.getElementById("quick-add").click(); await new Promise((r) => setTimeout(r, 400)); const out = [...document.querySelectorAll(".qa-label")].map((n) => n.textContent.trim()); document.querySelector(".modal-close")?.click(); return out; });
if (repTools.includes("Management view")) fail("a rep is offered the management view");

// --- A manager who also sells: sales app by default, with a switch each way.
await rpc("tm", "set_member_role", { member: U1, new_role: "manager", store: st.id });
const both = await pageAs("t", "p@e.com", [{ id: "x", name: "Someone", phone: "9025550000", stage: "working", vehicleInterest: "Rogue", createdAt: "x", updatedAt: "x" }]);
await both.goto(APP + "/#/");
// The tools live under "+"; the Management view tile depends on the store's answer about who this is.
await both.waitForFunction(async () => (await import("/js/team.js")).canManage(), null, { timeout: 15000 });
await both.evaluate(() => document.getElementById("quick-add").click());
await both.waitForFunction(() => [...document.querySelectorAll(".qa-label")].some((n) => n.textContent.trim() === "Management view"), null, { timeout: 15000 });
const stillSales = await both.evaluate(() => !document.body.classList.contains("management"));
if (!stillSales) fail("a manager with a book was switched to the store's app by default");
await both.evaluate(() => { [...document.querySelectorAll(".qa-tile")].find((t) => /Management view/.test(t.textContent)).click(); });
await both.waitForFunction(() => document.body.classList.contains("management") && document.querySelector(".hero-title"), null, { timeout: 20000 });
await both.waitForFunction(() => /As of/.test(document.body.textContent), null, { timeout: 20000 });
const switched = await both.evaluate(() => ({ title: document.querySelector(".hero-title")?.textContent.trim(), tabs: [...document.querySelectorAll(".tabbar .tab-label")].map((n) => n.textContent.trim()) }));
if (switched.title !== "O'Regan's Nissan Halifax" || switched.tabs.length !== 5) fail("the switch to the management view didn't take: " + JSON.stringify(switched));
await plusTap(both, "Sales view");
await both.waitForSelector("#view .nudge-slot", { state: "attached", timeout: 20000 });
const back = await both.evaluate(() => ({ mg: document.body.classList.contains("management"), tabs: document.querySelectorAll(".tabbar .tab").length }));
if (back.mg || back.tabs !== 5) fail("the switch back to the sales view didn't take: " + JSON.stringify(back));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nmanage.test.js FAILED" : "\nmanage.test.js passed");
})();
