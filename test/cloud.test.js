// "I clean wiped the application off my home page, resaved it, signed in. All
// of the leads I imported are still not there. There's only 61 leads."
//
// The uninstall did what it should: local storage went with it. The failure
// was that the cloud only ever held 61 — 2,923 imported customers had lived
// on that phone alone. Two defects combined to make that possible:
//
//   Signing out emptied the push queue. sync.disable() → setSyncTracking(false)
//   → state.outbox = {}. Every change waiting to reach the cloud, discarded.
//
//   The cloud was seeded exactly once per install. signOut() cleared the auth
//   session but not viniva:sync, so on re-sign-in `initializedFor` still matched
//   and pushAll() never ran again — only the (now empty) queue was pushed.
//
// So the property to hold is not "sync pushes the queue" but: after a sync,
// the cloud holds everything the device holds, however the rows got there.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const USER = "00000000-0000-4000-8000-000000000001";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await fetch(APP + "/__reset");

const session = () => ({ access_token: "t", refresh_token: "r",
  expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: USER, email: "p@e.com" } });
const cloudLeads = async () => (await (await fetch(APP + "/__records")).json()).filter((r) => r.collection === "leads" && !r.deleted).length;

// ---- Install A: the phone as it was.
const ctxA = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const a = await ctxA.newPage();
const errs = []; a.on("pageerror", (e) => errs.push(e.message));
await a.addInitScript((sess) => {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("viniva:auth", JSON.stringify(sess));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: Array.from({ length: 61 }, (_, i) => ({ id: "old_" + i, name: "Old Customer " + i, stage: "working", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" })),
    settings: { salesperson: "Parm", cloudAutoSync: true, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" },
  }));
}, session());
await a.goto(APP + "/#/");
await a.evaluate(async () => { const s = await import("/js/store.js"); await s.ready; });

// Signed in at boot: the first sync seeds the cloud with the 61.
await a.evaluate(async () => { const sync = await import("/js/sync.js"); await sync.syncNow(); });
console.log("after first sync, cloud leads:", await cloudLeads());
if (await cloudLeads() !== 61) fail("the seed didn't reach the cloud");

// Sign out. Then import a book while signed out — tracking is off, nothing is
// queued. This is the sequence that orphaned the real import.
await a.evaluate(async () => {
  const backend = await import("/js/backend.js"); const sync = await import("/js/sync.js");
  await backend.signOut(); sync.disable();
});
const imported = await a.evaluate(async () => {
  const store = await import("/js/store.js");
  store.bulk(() => { for (let i = 0; i < 3000; i++) store.create("leads", { name: "Imported " + i, phone: "902555" + String(1000 + i).slice(-4), stage: "new" }); });
  await store.flush();
  return { local: store.all("leads").length, queued: store.getOutbox().length };
});
console.log("imported while signed out:", JSON.stringify(imported));

// Sign back in as the same person, sync. Before the fix: initializedFor still
// matched, the queue was empty, nothing went up.
await a.evaluate(async (sess) => {
  localStorage.setItem("viniva:auth", JSON.stringify(sess));
  const sync = await import("/js/sync.js");
  sync.enable(); await sync.syncNow();
}, session());
const cloudAfter = await cloudLeads();
console.log("after re-sign-in and sync, cloud leads:", cloudAfter);
if (cloudAfter !== 3061) fail(`the cloud holds ${cloudAfter} leads; the phone holds 3061 — rows exist on one device only`);

// Signing out must not throw away a queue that hasn't gone up yet.
const kept = await a.evaluate(async () => {
  const store = await import("/js/store.js"); const sync = await import("/js/sync.js");
  store.create("leads", { name: "Queued Just Before Sign-out", stage: "new" });
  const before = store.getOutbox().length;
  sync.disable();
  return { before, after: store.getOutbox().length };
});
console.log("queue across sign-out:", JSON.stringify(kept));
if (kept.before && kept.after !== kept.before) fail("signing out emptied the push queue");

// ---- Install B: delete the app, put it back, sign in. Everything must return.
await ctxA.close();
const ctxB = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctxB.newPage();
p.on("pageerror", (e) => errs.push(e.message));
await p.addInitScript((sess) => {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("viniva:auth", JSON.stringify(sess));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
    settings: { salesperson: "Parm", cloudAutoSync: true, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
}, session());
await p.goto(APP + "/#/");
const restored = await p.evaluate(async () => {
  const s = await import("/js/store.js"); await s.ready;
  const sync = await import("/js/sync.js");
  sync.enable(); await sync.syncNow();
  return { leads: s.all("leads").length, imported: s.all("leads").filter((l) => /^Imported/.test(l.name)).length };
});
console.log("fresh install after sign-in:", JSON.stringify(restored));
if (restored.leads < 3061) fail(`a fresh install got ${restored.leads} leads back, not 3061`);
if (restored.imported !== 3000) fail(`only ${restored.imported} of the 3000 imported customers came back`);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ncloud.test.js FAILED" : "\ncloud.test.js passed");
})();
