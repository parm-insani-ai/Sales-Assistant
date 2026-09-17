// Your settings follow your account, not your phone.
//
// Sign in on a brand-new install and everything typed into Settings on the
// old one is there — through an ordinary sync, not a hand-fed record. And a
// phone that belonged to someone else's account starts clean when a
// different account signs in: their customers and their settings do not
// become yours, and yours never land in their account.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
await fetch(APP + "/__reset");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const ONE = "00000000-0000-4000-8000-000000000001";
const TWO = "00000000-0000-4000-8000-000000000002";

// Sessions carry an expiry well ahead, so the app never refreshes them — the
// stub's refresh always answers with account one, which would undo a switch.
const FAR = Math.floor(Date.now() / 1000) + 86400;
const newPhone = async (id, email, extra) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message));
  await p.addInitScript(({ id, email, far }) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: far, user: { id, email } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
      settings: { cloudAutoSync: true, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
  }, { id, email, far: FAR });
  if (extra) await p.addInitScript(extra.fn, extra.arg);
  await p.goto(APP + "/#/");
  await p.waitForTimeout(600);
  p.ctx = ctx;
  return p;
};

// What a salesperson types once and must never type twice.
const TYPED = { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", docFee: 699, taxRate: 14,
  goalUnits: 18, contactPhone: "(902) 555-0123", hoursFrom: 8, hoursTo: 19 };

// --- Phone one: type the settings, add a customer, sync.
console.log("phone one: types settings, syncs");
const one = await newPhone(ONE, "p@e.com");
await one.waitForTimeout(1200); // the first sync of the session
await one.evaluate(async (typed) => {
  const store = await import("/js/store.js"); const sync = await import("/js/sync.js");
  store.updateSettings(typed);
  store.create("leads", { id: "lead_one", name: "Only Customer", phone: "9025550100", stage: "new" });
  await sync.syncNow();
}, TYPED);
const cloud = await (await fetch(APP + "/__records")).json().catch(() => null);
const hasConfig = Array.isArray(cloud) && cloud.some((r) => r.collection === "config");
console.log("  cloud holds a settings record:", hasConfig ? "yes" : "NO");
if (!hasConfig) fail("the settings never reached the cloud");
await one.ctx.close();

// --- A brand-new install, same account: an ordinary boot and sync.
console.log("a new phone, same account:");
const two = await newPhone(ONE, "p@e.com");
await two.waitForTimeout(2500);
const back = await two.evaluate(async () => {
  const store = await import("/js/store.js");
  const s = store.getSettings();
  return { settings: s, leads: store.all("leads").length, contactEmail: s.contactEmail };
});
console.log("  " + JSON.stringify({ dealership: back.settings.dealership, docFee: back.settings.docFee, goalUnits: back.settings.goalUnits, leads: back.leads, contactEmail: back.contactEmail }));
for (const [k, v] of Object.entries(TYPED)) {
  if (JSON.stringify(back.settings[k]) !== JSON.stringify(v)) fail(`${k} didn't follow the account: ${JSON.stringify(back.settings[k])} (wanted ${JSON.stringify(v)})`);
}
if (back.leads !== 1) fail(`the customer didn't come back (${back.leads} leads)`);
if (back.contactEmail !== "p@e.com") fail(`the sign-in email wasn't adopted as the contact email (${JSON.stringify(back.contactEmail)})`);

// And the cloud copy is intact — a new install must not overwrite it with
// its own blank defaults on the way in.
const rows = await (await fetch(APP + "/__records")).json().catch(() => []);
const cfg = rows.find((r) => r.collection === "config");
console.log("  cloud settings after the new phone synced:", cfg ? JSON.stringify({ dealership: cfg.data.dealership, docFee: cfg.data.docFee }) : "GONE");
if (!cfg || cfg.data.dealership !== TYPED.dealership) fail("the new install overwrote the cloud settings with its defaults");
if (two.errs.length) { console.error("PAGE ERRORS: " + two.errs.join(" | ")); process.exitCode = 1; }

// --- Someone else signs in on that phone. Everything of account one goes;
// the phone's own wiring (which backend it talks to) stays.
console.log("a different account signs in on the same phone:");
await two.evaluate((far) => { localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t2", refresh_token: "r2", expires_at: far, user: { id: "00000000-0000-4000-8000-000000000002", email: "b@e.com" } })); }, FAR);
await two.reload();
await two.waitForTimeout(900);
const swapped = await two.evaluate(async () => {
  const store = await import("/js/store.js");
  const s = store.getSettings();
  return { leads: store.all("leads").length, dealership: s.dealership, salesperson: s.salesperson,
    owner: localStorage.getItem("viniva:owner"), backend: s.supabaseUrl, sync: localStorage.getItem("viniva:sync") };
});
console.log("  " + JSON.stringify(swapped));
if (swapped.leads !== 0) fail("the previous account's customers are still on the phone");
if (swapped.dealership || swapped.salesperson) fail("the previous account's settings are still on the phone");
if (swapped.owner !== TWO) fail(`the phone isn't stamped with the new account (${swapped.owner})`);
if (swapped.backend !== "http://127.0.0.1:8137") fail("the phone lost its backend address in the switch");
// And nothing of account one was pushed into account two's cloud.
const leaked = (await (await fetch(APP + "/__records")).json().catch(() => []))
  .filter((r) => r.user_id === TWO && r.collection === "leads");
console.log("  account one's customers in account two's cloud:", leaked.length);
if (leaked.length) fail("the switch pushed the previous account's customers into the new account");

// --- The first account comes back: their data is not on the phone any more,
// but it's still in the cloud, and a sync brings it back.
console.log("the first account signs back in:");
await two.evaluate((far) => { localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: far, user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } })); }, FAR);
await two.reload();
await two.waitForTimeout(2500);
const again = await two.evaluate(async () => {
  const store = await import("/js/store.js");
  return { leads: store.all("leads").length, dealership: store.getSettings().dealership, owner: localStorage.getItem("viniva:owner") };
});
console.log("  " + JSON.stringify(again));
if (again.leads !== 1 || again.dealership !== TYPED.dealership) fail("the first account's data didn't come back from the cloud");
if (again.owner !== ONE) fail("the phone isn't stamped with the first account again");
await two.ctx.close();

await b.close();
console.log(process.exitCode ? "\naccount.test.js FAILED" : "\naccount.test.js passed");
})();
