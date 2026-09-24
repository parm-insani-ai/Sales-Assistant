// The store and the manager board: a manager creates the store, reps join by
// the invite link, and the board reads each rep's records — touches,
// appointments, units against goal, untouched leads, overdue follow-ups —
// down to a customer's page, read-only. A rep sees the team and nothing of
// another rep's book.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001", U2 = "00000000-0000-4000-8000-000000000002", UM = "00000000-0000-4000-8000-000000000003";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");

const pageAs = async (token, email, extra = {}) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(({ token, email, extra }) => {
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: token, refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: { t: "00000000-0000-4000-8000-000000000001", t2: "00000000-0000-4000-8000-000000000002", tm: "00000000-0000-4000-8000-000000000003" }[token], email } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: extra.name || "", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
  }, { token, email, extra });
  return p;
};

// --- 1. The manager creates the store.
const mgr = await pageAs("tm", "mgr@e.com", { name: "Sam Manager" });
await mgr.goto(APP + "/#/team");
await mgr.waitForSelector('[data-act="create"]');
await mgr.fill("#st-name", "O'Regan's Nissan Halifax");
await mgr.click('[data-act="create"]');
await mgr.waitForSelector("#invite-link");
const invite = await mgr.evaluate(() => document.querySelector("#invite-link").textContent.trim());
console.log("invite:", invite);
const code = (invite.match(/#\/join\/([a-z0-9]+)$/) || [])[1];
if (!code) fail("no invite code in the link: " + invite);
const first = await mgr.evaluate(() => ({ title: document.querySelector(".hero-title")?.textContent.trim(), members: document.querySelectorAll(".badge").length, reps: document.querySelectorAll("[data-rep]").length }));
if (first.title !== "O'Regan's Nissan Halifax") fail("the store isn't named: " + JSON.stringify(first));

// --- 2. Two reps join: one through the invite link, one by typing the code.
const rep1 = await pageAs("t", "p@e.com", { name: "Parm" });
await rep1.goto(APP + "/#/join/" + code);
await rep1.waitForFunction(() => location.hash === "#/team" && /on the team/.test(document.body.textContent), null, { timeout: 15000 });
const rep2 = await pageAs("t2", "rep2@e.com", { name: "Dana Rep" });
await rep2.goto(APP + "/#/team");
await rep2.waitForSelector("#st-code");
await rep2.fill("#st-code", code);
await rep2.click('[data-act="join"]');
await rep2.waitForFunction(() => /on the team/.test(document.body.textContent), null, { timeout: 15000 });
const repView = await rep1.evaluate(() => ({ board: document.querySelectorAll("[data-rep]").length, invite: !!document.querySelector("#invite-link"), members: [...document.querySelectorAll(".card .row-title")].map((n) => n.textContent.trim()) }));
console.log("rep sees:", JSON.stringify(repView));
if (repView.board || repView.invite) fail("a rep can see the board or the invite link");
if (!repView.members.some((m) => /Sam Manager/.test(m)) || !repView.members.some((m) => /Parm/.test(m))) fail("the rep doesn't see the members: " + JSON.stringify(repView.members));

// --- 3. The reps' books, as their phones would have synced them.
const now = new Date();
const iso = (d) => d.toISOString();
const day = (n) => new Date(now.getTime() + n * 86400000);
const ymd = (d) => d.toISOString().slice(0, 10);
const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1)).slice(0, 8) + "01";
const inMonth = (d) => ymd(d) >= monthStart ? d : now; // near the 1st, keep everything inside this month
const seed = (user_id, rows) => fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id, rows }) });
await seed(U1, [
  { id: "l1", collection: "leads", data: { id: "l1", name: "Fresh Lead", phone: "9025551111", stage: "new", vehicleInterest: "2026 Nissan Rogue SV", source: "Web", notes: "Wants AWD, budget ~550/mo", createdAt: iso(day(-3)) } },
  { id: "l2", collection: "leads", data: { id: "l2", name: "Touched Lead", phone: "9025552222", stage: "new", vehicleInterest: "Kicks", lastContacted: iso(day(-1)), createdAt: iso(day(-3)) } },
  { id: "l3", collection: "leads", data: { id: "l3", name: "Late Follow", phone: "9025553333", stage: "working", vehicleInterest: "2024 Sentra SR", followUp: ymd(day(-2)), createdAt: iso(day(-30)), currentPayment: 420, paymentsLeft: 30 } },
  { id: "l4", collection: "leads", data: { id: "l4", name: "Brand New", phone: "9025554444", stage: "new", vehicleInterest: "Pathfinder", createdAt: iso(now) } },
  { id: "l5", collection: "leads", data: { id: "l5", name: "Delivered One", phone: "9025555555", stage: "delivered", vehicleInterest: "Rogue", createdAt: iso(day(-90)) } },
  { id: "a1", collection: "activity", data: { id: "a1", type: "touch", createdAt: iso(now) } },
  { id: "a2", collection: "activity", data: { id: "a2", type: "text", createdAt: iso(now) } },
  { id: "a3", collection: "activity", data: { id: "a3", type: "touch", createdAt: iso(inMonth(day(-5))) } },
  { id: "ap1", collection: "appointments", data: { id: "ap1", leadId: "l3", customerName: "Late Follow", type: "appointment", when: iso(inMonth(day(-4))).slice(0, 16), status: "scheduled", outcome: "showed" } },
  { id: "ap2", collection: "appointments", data: { id: "ap2", leadId: "l1", customerName: "Fresh Lead", type: "test drive", when: ymd(now) + "T15:30", status: "scheduled", confirmed: true } },
  { id: "ap3", collection: "appointments", data: { id: "ap3", leadId: "l5", customerName: "Delivered One", type: "appointment", when: iso(inMonth(day(-10))).slice(0, 16), status: "scheduled", outcome: "sold" } },
  { id: "s1", collection: "sales", data: { id: "s1", leadId: "l5", customerName: "Delivered One", vehicle: "2026 Rogue SV", saleDate: ymd(inMonth(day(-10))), frontGross: 1200, backGross: 800 } },
  { id: "s2", collection: "sales", data: { id: "s2", customerName: "Walk In", vehicle: "2025 Kicks", saleDate: ymd(now), frontGross: 500, backGross: 900 } },
  { id: "config", collection: "config", data: { id: "config", goalUnits: 12, goalAppointments: 30, dailyTouchGoal: 20 } },
  { id: "x1", collection: "texts", data: { id: "x1", leadId: "l1", dir: "out", body: "Hi, it's Parm at O'Regan's — the Rogue SV you asked about is here.", at: iso(day(-2)) } },
  { id: "x2", collection: "texts", data: { id: "x2", leadId: "l1", dir: "in", body: "Great, can I see it Saturday?", at: iso(day(-1)) } },
]);
await seed(U2, [
  { id: "m1", collection: "leads", data: { id: "m1", name: "Quiet Lead", phone: "9025559999", stage: "new", vehicleInterest: "Frontier", createdAt: iso(day(-2)) } },
  { id: "c2", collection: "config", data: { id: "c2", goalUnits: 10 } },
]);

// --- 4. The board.
await mgr.reload();
await mgr.waitForSelector("[data-rep]");
await mgr.waitForFunction(() => [...document.querySelectorAll(".team-row")].every((r) => !/Reading/.test(r.textContent)), null, { timeout: 15000 });
const board = await mgr.evaluate(() => ({
  totals: [...document.querySelectorAll(".stat")].map((s) => s.textContent.replace(/\s+/g, " ").trim()),
  rows: [...document.querySelectorAll(".team-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
}));
console.log("board:", JSON.stringify(board, null, 1));
const parm = board.rows.find((r) => /^Parm/.test(r)) || "";
if (!/2 touches today · 3 this month · 1 appt today/.test(parm)) fail("Parm's touches are wrong: " + parm);
if (!/2 \/ 12/.test(parm) || !/pace/.test(parm)) fail("Parm's units against goal are wrong: " + parm);
if (!/3 set/.test(parm) || !/2 shown/.test(parm) || !/1 untouched/.test(parm) || !/1 overdue/.test(parm)) fail("Parm's cells are wrong: " + parm);
const dana = board.rows.find((r) => /^Dana Rep/.test(r)) || "";
if (!/0 touches today/.test(dana) || !/0 \/ 10/.test(dana) || !/1 untouched/.test(dana)) fail("Dana's row is wrong: " + dana);
if (!board.rows[0].startsWith("Parm")) fail("the rep with the most units isn't first: " + board.rows[0]);
if (!board.totals.some((t) => /^2 \/ (22|34) ?Units this month/.test(t)) || !board.totals.some((t) => /^2 ?Untouched leads/.test(t))) fail("the store totals are wrong: " + JSON.stringify(board.totals));

// --- 5. Open a rep, then a customer, read-only.
await mgr.click('[data-rep="' + U1 + '"]');
await mgr.waitForSelector(".modal [data-lead]");
const repSheet = await mgr.evaluate(() => ({
  title: document.querySelector(".modal h2")?.textContent.trim(),
  untouched: [...document.querySelectorAll(".modal [data-lead]")].map((n) => n.querySelector(".row-title").textContent.trim()),
  today: document.querySelector(".modal")?.textContent.includes("Today's appointments"),
}));
console.log("rep sheet:", JSON.stringify(repSheet));
if (repSheet.title !== "Parm" || !repSheet.today) fail("the rep sheet isn't Parm's day: " + JSON.stringify(repSheet));
if (repSheet.untouched.join() !== "Fresh Lead,Late Follow") fail("the lists behind the numbers are wrong: " + repSheet.untouched.join(", "));
await mgr.click('.modal [data-lead="l1"]');
await mgr.waitForFunction(() => document.querySelectorAll(".modal").length === 2, null, { timeout: 10000 });
const cust = await mgr.evaluate(() => { const m = document.querySelectorAll(".modal")[1]; return { title: m.querySelector("h2").textContent.trim(), text: m.textContent.replace(/\s+/g, " ") }; });
console.log("customer:", cust.title, "·", cust.text.slice(0, 160));
if (cust.title !== "Fresh Lead" || !/\(902\) 555-1111/.test(cust.text) || !/Wants AWD/.test(cust.text) || !/Great, can I see it Saturday/.test(cust.text) || !/Read-only/.test(cust.text)) fail("the customer page isn't complete: " + cust.text.slice(0, 300));

// --- 6. A rep can't read another rep; a manager can.
const cross = await rep1.evaluate(async (U2) => { const bk = await import("/js/backend.js"); return (await bk.readRecords(U2, "leads")).length; }, U2);
const mgrRead = await mgr.evaluate(async (U2) => { const bk = await import("/js/backend.js"); return (await bk.readRecords(U2, "leads")).length; }, U2);
console.log("rep reads another rep:", cross, "· manager reads a rep:", mgrRead);
if (cross !== 0 || mgrRead !== 1) fail("row access is wrong: rep " + cross + ", manager " + mgrRead);

// --- 7. Roles: make Dana a manager, then a rep leaves.
await mgr.keyboard.press("Escape"); await mgr.keyboard.press("Escape");
await mgr.waitForTimeout(200);
await mgr.click('[data-role="' + U2 + '"]');
await mgr.waitForSelector('.modal [data-r="manager"]');
await mgr.click('.modal [data-r="manager"]');
await mgr.waitForFunction(() => document.querySelectorAll(".badge-sold").length >= 2, null, { timeout: 10000 });
await rep2.reload();
await rep2.waitForSelector("[data-rep]", { timeout: 15000 });
const danaBoard = await rep2.evaluate(() => document.querySelectorAll("[data-rep]").length);
if (danaBoard < 2) fail("a promoted manager doesn't get the board: " + danaBoard);
await rep1.click('[data-act="leave"]');
await rep1.waitForSelector('.modal [data-act="ok"]');
await rep1.click('.modal [data-act="ok"]');
await rep1.waitForSelector('[data-act="create"]', { timeout: 10000 });
const after = await (await fetch(APP + "/__stores")).json();
if (after[0].members.some((m) => m.user_id === U1)) fail("leaving didn't take");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nteam.test.js FAILED" : "\nteam.test.js passed");
})();
