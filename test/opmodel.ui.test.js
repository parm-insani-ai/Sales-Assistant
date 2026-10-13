// The operating model on the screens: Admin sets the store's targets and
// ratios and each rep's share, writes the month to the reps' phones, and
// Home leads with the month's math — the chain, where each number should
// be today against where it is, ups by source, and each rep's day.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const now = new Date();
const iso = (d) => d.toISOString();
const ago = (min) => new Date(now.getTime() - min * 60000);
const pad = (n) => String(n).padStart(2, "0");
const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "Store", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
await rpc("t2", "join_store", { code: st.code, display_name: "Dana" });
// Parm's month so far: four customers logged (three dealer-site ups, a walk-in), two sold, three appointments set.
const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
const l = (id, name, source) => ({ id, collection: "leads", data: { id, name, phone: "902555" + id.padStart(4, "0"), stage: "working", source, loggedAt: iso(ago(2000)), ...x } });
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  l("1", "Ann Up", "Dealer Site"), l("2", "Bo Up", "Dealer Site"), l("3", "Cy Up", "Dealer Site"), l("4", "Di Walk", "Walk-in"),
  { id: "s1", collection: "sales", data: { id: "s1", leadId: "1", customerName: "Ann Up", saleDate: month + "-02", newUsed: "New", ...x } },
  { id: "s2", collection: "sales", data: { id: "s2", leadId: "2", customerName: "Bo Up", saleDate: month + "-03", newUsed: "Used", ...x } },
  { id: "a1", collection: "appointments", data: { id: "a1", leadId: "3", customerName: "Cy Up", when: month + "-28T10:00", status: "scheduled", confirmed: true, createdAt: iso(ago(3000)) } },
  { id: "a2", collection: "appointments", data: { id: "a2", leadId: "4", customerName: "Di Walk", when: month + "-28T11:00", status: "scheduled", confirmed: true, createdAt: iso(ago(2500)) } },
  { id: "a3", collection: "appointments", data: { id: "a3", leadId: "1", customerName: "Ann Up", when: month + "-28T12:00", status: "scheduled", confirmed: true, createdAt: iso(ago(2200)) } },
] }) });

const mgr = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
mgr.on("pageerror", (e) => errs.push(e.message));
await mgr.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "tm", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000003", email: "mgr@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
});

// --- Admin: the targets, the ratios, each rep's share.
await mgr.goto(APP + "/#/team");
await mgr.waitForSelector(".plan-card #pl-new", { timeout: 20000 });
const defaults = await mgr.evaluate(() => ({ n: document.querySelector("#pl-new").value, u: document.querySelector("#pl-used").value, line: document.querySelector(".plan-card .small.muted").textContent.replace(/\s+/g, " ").trim(), rows: [...document.querySelectorAll(".plan-alloc-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()) }));
console.log("admin:", JSON.stringify(defaults));
if (defaults.n !== "50" || defaults.u !== "30" || !/^80 units → 194 customers spoken with \([\d.]+ a selling day\) → 112 appointments set \([\d.]+ a day\) for 67 shows → 193 ups at the year's mix\.$/.test(defaults.line)) fail("the defaults aren't the store's: " + JSON.stringify(defaults));
if (defaults.rows.length !== 3 || !defaults.rows.some((r) => /^Parm/.test(r)) || !defaults.rows.some((r) => /^Sam \(manager\)/.test(r))) fail("every member isn't in the allocation: " + JSON.stringify(defaults.rows));
// Parm carries 30; Sam, the manager, carries none; Dana gets the rest.
await mgr.fill('[data-alloc="' + U1 + '"]', "30");
await mgr.fill('[data-alloc="00000000-0000-4000-8000-000000000003"]', "0");
await mgr.fill("#pl-cnew", "40");
// The dealer-site channel gets the store's own appointment target; the rest keep the preset.
await mgr.evaluate(() => { document.querySelector(".plan-channels").open = true; });
const preset = await mgr.evaluate(() => document.querySelector('[data-atgt="dealer_site"]').placeholder);
if (preset !== "33") fail("the dealer-site preset isn't the model's: " + preset);
await mgr.fill('[data-atgt="dealer_site"]', "40");
await mgr.click('[data-act="plan-write"]');
await mgr.waitForFunction(() => /set for the month/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => fail("writing the month to the reps didn't report"));
const targets = await rpc("tm", "targets_for_store", { store: st.id, target_month: month });
console.log("targets:", JSON.stringify(targets));
const tp = targets.find((t) => t.user_id === U1), td = targets.find((t) => t.user_id === "00000000-0000-4000-8000-000000000002");
if (!tp || tp.goal_units !== 30 || !td || td.goal_units !== 50 || targets.some((t) => t.user_id === "00000000-0000-4000-8000-000000000003")) fail("the reps' months weren't written from the allocation: " + JSON.stringify(targets));
const saved = await rpc("tm", "store_config_get", { store: st.id });
if (!saved.plan || saved.plan.closingNew !== 40 || saved.plan.alloc[U1] !== 30 || !saved.plan.apptTargets || saved.plan.apptTargets.dealer_site !== 40 || "facebook" in saved.plan.apptTargets) fail("the plan wasn't saved to the store: " + JSON.stringify(saved.plan));

// --- Home: the month's math.
await mgr.goto(APP + "/#/");
await mgr.waitForFunction(() => document.querySelector(".mg-math") && document.querySelector(".mg-today"), null, { timeout: 30000 });
const home = await mgr.evaluate(() => ({
  head: document.querySelector(".mg-math .strong").textContent.replace(/\s+/g, " ").trim() + " · " + document.querySelector(".mg-math-head .small.muted").textContent.replace(/\s+/g, " ").trim(),
  line: document.querySelector(".mg-math-how .small.muted").textContent.replace(/\s+/g, " ").trim(),
  pace: [...document.querySelectorAll(".mg-pace")].map((n) => `${n.dataset.k}: ${n.dataset.have} / ${n.dataset.want} · ${n.querySelector(".mg-pace-read").textContent.trim()}`),
  need: document.querySelector(".mg-math-need").textContent.replace(/\s+/g, " ").trim(),
  lever: [...document.querySelectorAll(".mg-math-how .small")].map((n) => n.textContent).find((t) => /The lever/.test(t))?.replace(/\s+/g, " ").trim(),
  src: [...document.querySelectorAll(".mg-src")].map((n) => n.dataset.src + ": " + n.querySelector(".mg-src-name").textContent.trim() + " " + n.querySelector(".mg-src-n").textContent.replace(/\s+/g, " ").trim() + " " + (n.querySelector(".mg-src-set")?.textContent.trim() || "")),
  parm: [...document.querySelectorAll(".mg-today-rep")].map((r) => r.textContent.replace(/\s+/g, " ").trim()).find((t) => /^Parm/.test(t)),
  first: document.querySelector("#view .card")?.className,
}));
console.log("home:", JSON.stringify(home, null, 1));
if (!/^[A-Z][a-z]+ · 80 units · 50 new · 30 used · selling day \d+ of \d+ · /.test(home.head)) fail("the head is wrong: " + home.head);
if (!/At 4\d\.\d% closing, 80 units is 1\d\d customers spoken with/.test(home.line)) fail("the chain line is wrong: " + home.line);
if (home.pace.length !== 3 || !/^Units: 2 \/ [\d.]+ · \d+ (behind pace|ahead)|^Units: 2 \/ [\d.]+ · on pace/.test(home.pace[0]) || !/^Customers spoken with: 4 \/ [\d.]+ · /.test(home.pace[1]) || !/^Appointments set: 3 \/ [\d.]+ · /.test(home.pace[2])) fail("the pace rows don't carry the month so far: " + JSON.stringify(home.pace));
if (!/^From here: 78 more units needs \d+ customers and \d+ appointments a day across the floor, \d+ selling days? left\.$/.test(home.need)) fail("the from-here read is wrong: " + home.need);
if (!/closes at 72% against 42% for the mix/.test(home.lever || "")) fail("the lever line is wrong: " + home.lever);
if (!home.src.some((s) => /^dealer_site: Dealer site 3 of \d+ 2 of 40 booked\*$/.test(s)) || !home.src.some((s) => /^lot: Lot 1 of \d+ 1 of \d+ booked$/.test(s))) fail("ups by source don't carry booked against the channel's target: " + JSON.stringify(home.src));
if (!/30 units this month · [\d.]+ customers and [\d.]+ appointments a day/.test(home.parm || "")) fail("Parm's row doesn't carry the plan's day: " + home.parm);
if (!/mg-math/.test(home.first || "")) fail("the month's math isn't the first card: " + home.first);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nopmodel.ui.test.js FAILED" : "\nopmodel.ui.test.js passed");
})();
