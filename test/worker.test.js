// A fresh install gets its background worker. The boot waits at the sign-in
// door for as long as it takes to type a password — long past the page's
// load event — and the worker must still end up registered, because
// notifications can't be turned on without one. Runs with service workers
// allowed (Chromium permits them on 127.0.0.1).
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

const regState = (p) => p.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { registered: false };
  const ready = await Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise((res) => setTimeout(() => res(false), 6000)),
  ]);
  return { registered: true, ready, active: !!reg.active };
});

// --- Signed out: the door is up for a while before anyone signs in.
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
      settings: { salesperson: "Parm", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
  });
  await p.goto(APP + "/#/");
  // Long enough that the load event is well behind us.
  await p.waitForTimeout(1500);
  const door = await p.evaluate(() => !!document.querySelector("#login"));
  const atDoor = await regState(p);
  console.log("at the door:", JSON.stringify({ door, ...atDoor }));
  if (!door) fail("the door isn't up — this run doesn't reproduce the case");
  if (!atDoor.registered) fail("the worker wasn't registered while the door was up");
  if (!atDoor.ready) fail("the worker never became active while the door was up");

  // Sign in the slow way, then look again.
  await p.click("#login .login-box");
  await p.keyboard.type("p@e.com");
  await p.click("#login .login-go");
  await p.waitForTimeout(150);
  await p.keyboard.type("secret");
  await p.click("#login .login-go");
  await p.waitForTimeout(800);
  const after = await regState(p);
  const app = await p.evaluate(() => !!document.querySelector("#view .hero"));
  console.log("after signing in:", JSON.stringify({ app, ...after }));
  if (!app) fail("the app didn't open after signing in");
  if (!after.registered || !after.ready) fail("no active worker after signing in");

  // Reopened with the worker in control: the app comes up from the worker's
  // own copy of this build, and says which build that is.
  const expect = /const CACHE = "([^"]+)"/.exec(require("fs").readFileSync(__dirname + "/../sw.js", "utf8"))[1];
  await p.reload();
  await p.waitForTimeout(900);
  const served = await p.evaluate(async () => {
    const { runningVersion } = await import("./js/updater.js");
    const keys = await caches.keys();
    const c = await caches.open(keys[0] || "none");
    const cached = (await c.keys()).map((r) => new URL(r.url).pathname);
    return { controlled: !!navigator.serviceWorker.controller, app: !!document.querySelector("#view .hero"),
      running: await runningVersion(), caches: keys, hasLogin: cached.some((u) => /\/js\/login\.js$/.test(u)), n: cached.length };
  });
  console.log("reopened under the worker:", JSON.stringify(served));
  if (!served.controlled) fail("the worker isn't controlling the page after a reload");
  if (!served.app) fail("the app didn't draw when served by the worker");
  if (served.running !== expect) fail(`the worker reports build ${served.running}, sw.js says ${expect}`);
  if (served.caches.length !== 1 || served.caches[0] !== expect) fail(`caches on disk: ${served.caches.join(", ")} — wanted only ${expect}`);
  if (!served.hasLogin) fail("the sign-in page's script isn't in the worker's copy of the build");
  if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
  await ctx.close();
}

// --- The Notifications button on a device whose worker is missing entirely:
// it registers one itself rather than waiting for one that isn't coming.
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
      user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
      settings: { salesperson: "Parm", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
  });
  await p.goto(APP + "/#/settings");
  await p.waitForTimeout(800);
  // Pull the rug: unregister whatever the boot set up.
  await p.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  });
  const gone = await p.evaluate(async () => !(await navigator.serviceWorker.getRegistration()));
  // Reach the same path the button takes, minus the permission prompt and the
  // server key: the module's registration step must make a worker appear.
  const r = await p.evaluate(async () => {
    const { registerWorker } = await import("./js/updater.js");
    const before = !!(await navigator.serviceWorker.getRegistration());
    await registerWorker();
    const ready = await Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise((res) => setTimeout(() => res(false), 6000)),
    ]);
    return { before, ready };
  });
  console.log("worker pulled, then re-registered on demand:", JSON.stringify({ gone, ...r }));
  if (!gone) fail("couldn't remove the worker for this step");
  if (r.before) fail("a worker was still there after unregistering");
  if (!r.ready) fail("registering on demand didn't produce an active worker");
  await ctx.close();
}

await b.close();
console.log(process.exitCode ? "\nworker.test.js FAILED" : "\nworker.test.js passed");
})();
