// The front door. Signed out, the app is one word and one box; signed in, the
// door isn't there. Email in the box, then the password in the same place,
// then Home. Signing out puts the door back.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

// A fresh install: nothing signed in, the backend pointed at the stub.
await p.addInitScript(() => {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
    settings: { salesperson: "Parm", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(500);

const door = () => p.evaluate(() => {
  const login = document.querySelector("#login");
  const visible = login ? [...login.querySelectorAll("input")].filter((i) => !i.hidden) : [];
  return {
    shown: !!login && !login.classList.contains("login-out"),
    word: login ? login.querySelector(".login-word")?.textContent : null,
    boxes: visible.length,
    boxType: visible[0]?.type || null,
    note: login ? login.querySelector(".login-note")?.textContent.trim() : null,
    button: login ? login.querySelector(".login-go")?.textContent.trim() : null,
    appDrawn: !!document.querySelector("#view .stat-grid"),
    focused: document.activeElement?.className || null,
  };
});

// --- Signed out: the door, and nothing else.
console.log("signed out:");
let d = await door();
console.log("  " + JSON.stringify(d));
if (!d.shown) fail("no login page for a signed-out install");
if (d.word !== "viniva") fail(`the page says ${JSON.stringify(d.word)}, not "viniva"`);
if (d.boxes !== 1) fail(`${d.boxes} boxes showing — it should be exactly one`);
if (d.boxType !== "email") fail("the first box isn't for the email");
if (d.appDrawn) fail("the app rendered behind the door");
if (d.focused !== "login-box") fail("the box didn't take focus");
if (d.button !== "Continue") fail(`the button under the email box says ${JSON.stringify(d.button)}`);

// --- Something that isn't an email doesn't get past the box.
await p.keyboard.type("parm");
await p.keyboard.press("Enter");
await p.waitForTimeout(100);
d = await door();
console.log("  not an email:", JSON.stringify({ boxType: d.boxType, note: d.note }));
if (d.boxType !== "email") fail("a non-email moved on to the password");
if (!d.note) fail("no word about why it didn't move on");

// --- Email, then the button, and the same spot asks for the password.
await p.evaluate(() => { const i = document.querySelector('#login [name="email"]'); i.value = ""; });
await p.keyboard.type("p@e.com");
await p.click("#login .login-go");
await p.waitForTimeout(100);
d = await door();
console.log("  after the email:", JSON.stringify({ boxes: d.boxes, boxType: d.boxType, note: d.note, button: d.button }));
if (d.boxes !== 1) fail(`${d.boxes} boxes showing on the password step`);
if (d.boxType !== "password") fail("the box didn't become the password box");
if (!/p@e\.com/.test(d.note || "")) fail("the email you typed isn't shown on the password step");
if (d.button !== "Sign in") fail(`the button under the password box says ${JSON.stringify(d.button)}`);
if (d.focused !== "login-box") fail("the password box didn't take focus");

// --- Forgot it: a link under the password box sends a reset email to the
// address typed, with the app's own address as the way back.
{
  const link = await p.evaluate(() => document.querySelector("#login .login-forgot")?.textContent.trim());
  if (link !== "Forgot password?") fail("the password step has no way out of a forgotten password: " + JSON.stringify(link));
  await p.click("#login .login-forgot");
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => document.querySelector("#login .login-note")?.textContent.trim());
  const sent = await (await fetch(APP + "/__auth")).json();
  console.log("  forgot:", JSON.stringify({ after, sent }));
  if (!/Check p@e\.com for a link/.test(after || "")) fail("no word that the reset link was sent: " + after);
  const r = sent.find((a) => a.kind === "recover");
  if (!r || r.email !== "p@e.com" || !/^http:\/\/127\.0\.0\.1:8137\//.test(r.redirect)) fail("the reset should go to the typed email with the app as the way back: " + JSON.stringify(sent));
  await p.click("#login .login-back");
  await p.waitForTimeout(100);
  d = await door();
  if (d.boxType !== "password") fail("Back should return to the password step: " + JSON.stringify(d));
}

// --- Password, the button, and the app is there. (Enter works too — the
// not-an-email step above went through it.)
await p.keyboard.type("secret");
await p.click("#login .login-go");
await p.waitForTimeout(700);
d = await door();
const sess = await p.evaluate(() => JSON.parse(localStorage.getItem("viniva:auth") || "null"));
console.log("  after the password:", JSON.stringify({ shown: d.shown, appDrawn: d.appDrawn, user: sess?.user?.email }));
if (d.shown) fail("the door is still up after signing in");
if (!d.appDrawn) fail("the app didn't appear after signing in");
if (!sess?.access_token) fail("no session was stored");
const gone = await p.evaluate(() => !document.querySelector("#login"));
if (!gone) fail("the login element is still in the document after signing in");

// --- Reopening the app: already signed in, straight to Home.
await p.reload();
await p.waitForTimeout(600);
d = await door();
console.log("reopened, signed in:", JSON.stringify({ shown: d.shown, appDrawn: d.appDrawn }));
if (d.shown) fail("a signed-in install got the door again");
if (!d.appDrawn) fail("a signed-in install didn't open on Home");

// --- Change password, from the "+" sheet: the same cover, one box, a way to
// keep the current one; saving sends the new one with the session.
{
  await p.evaluate(() => { location.hash = "#/"; });
  await p.waitForTimeout(300);
  const changed = await p.evaluate(async () => {
    const mod = await import("/js/login.js");
    const pending = mod.showNewPassword({ email: "p@e.com", reason: "change" });
    await new Promise((r) => setTimeout(r, 100));
    const cover = document.querySelector("#login");
    const out = { shown: !!cover, button: cover?.querySelector(".login-go")?.textContent.trim(), keep: cover?.querySelector(".login-switch")?.textContent.trim(), note: cover?.querySelector(".login-note")?.textContent.trim() };
    cover.querySelector('[name="password"]').value = "abc";
    cover.querySelector(".login-go").click();
    await new Promise((r) => setTimeout(r, 100));
    out.short = cover.querySelector(".login-note").textContent.trim();
    cover.querySelector('[name="password"]').value = "newsecret1";
    cover.querySelector(".login-go").click();
    out.result = await pending;
    await new Promise((r) => setTimeout(r, 350));
    out.gone = !document.querySelector("#login");
    return out;
  });
  const saved = (await (await fetch(APP + "/__auth")).json()).find((a) => a.kind === "password");
  console.log("change password:", JSON.stringify({ ...changed, saved }));
  if (!changed.shown || changed.button !== "Save password" || !/Keep the one I have/.test(changed.keep || "") || !/p@e\.com/.test(changed.note || "")) fail("the change-password cover is wrong: " + JSON.stringify(changed));
  if (!/6\+ characters/.test(changed.short)) fail("a short password wasn't refused");
  if (changed.result !== true || !changed.gone) fail("saving should close the cover: " + JSON.stringify(changed));
  if (!saved || saved.password !== "newsecret1" || saved.bearer !== "t") fail("the new password should reach the account with its session: " + JSON.stringify(saved));
  const tile = await p.evaluate(async () => {
    document.querySelector("#quick-add").click();
    await new Promise((r) => setTimeout(r, 400));
    const labels = [...document.querySelectorAll(".modal, [role=dialog], .sheet, body")].flatMap((m) => [...m.querySelectorAll("button, .tool, .tool-tile")]).map((b) => b.textContent.trim());
    return { has: labels.some((l) => /Change password/.test(l)), signout: labels.some((l) => /Sign out/.test(l)) };
  });
  console.log("  on the + sheet:", JSON.stringify(tile));
  if (!tile.has || !tile.signout) fail("the + sheet's Account section should offer Change password beside Sign out: " + JSON.stringify(tile));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(200);
}

// --- The reset link's landing: signed in by the link, the door asks for the
// new password first, saves it, and opens the app on Home with a clean hash.
{
  const ctxR = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const r = await ctxR.newPage();
  await r.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
      settings: { salesperson: "Parm", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
  });
  await r.goto(APP + "/#access_token=t&refresh_token=r&expires_in=3600&token_type=bearer&type=recovery");
  await r.waitForSelector('#login [name="password"]', { timeout: 10000 });
  const landing = await r.evaluate(() => ({ button: document.querySelector("#login .login-go")?.textContent.trim(), boxes: [...document.querySelectorAll("#login input")].filter((i) => !i.hidden).map((i) => i.type), hash: location.hash, signedIn: !!JSON.parse(localStorage.getItem("viniva:auth") || "null")?.access_token }));
  console.log("reset link landing:", JSON.stringify(landing));
  if (landing.button !== "Save password" || landing.boxes.join() !== "password" || landing.hash !== "#/" || !landing.signedIn) fail("the reset link should land on the new-password door, signed in, with the tokens off the address: " + JSON.stringify(landing));
  await r.evaluate(() => { document.querySelector('#login [name="password"]').value = "fromthelink"; document.querySelector("#login .login-go").click(); });
  await r.waitForFunction(() => !document.querySelector("#login") && !!document.querySelector("#view .stat-grid"), null, { timeout: 10000 }).catch(() => fail("after saving, the app didn't open"));
  const viaLink = (await (await fetch(APP + "/__auth")).json()).filter((a) => a.kind === "password").pop();
  if (!viaLink || viaLink.password !== "fromthelink") fail("the password from the link's door wasn't saved: " + JSON.stringify(viaLink));
  await ctxR.close();
}

// --- A phone from before the rename: its session was stored under the old
// name. It must open on the app, not the door.
{
  const ctxOld = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const old = await ctxOld.newPage();
  await old.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("entoa:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
      user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
    localStorage.setItem("entoa:leads-filter", "active");
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
      settings: { salesperson: "Parm", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
  });
  await old.goto(APP + "/#/");
  await old.waitForTimeout(500);
  const r = await old.evaluate(() => ({
    door: !!document.querySelector("#login"),
    app: !!document.querySelector("#view .stat-grid"),
    carried: !!localStorage.getItem("viniva:auth") && localStorage.getItem("viniva:leads-filter") === "active",
    oldGone: !localStorage.getItem("entoa:auth"),
  }));
  console.log("a phone from before the rename:", JSON.stringify(r));
  if (r.door || !r.app) fail("the rename signed an existing install out");
  if (!r.carried) fail("keys stored under the old name weren't carried across");
  if (!r.oldGone) fail("the old keys were left behind");
  await ctxOld.close();
}

// --- Signing out puts the door back.
await p.evaluate(() => { location.hash = "#/settings"; });
await p.waitForTimeout(300);
const hadSignOut = await p.evaluate(() => { const b = document.querySelector('[data-c="signout"]'); if (b) b.click(); return !!b; });
await p.waitForTimeout(400);
d = await door();
console.log("signed out from Settings:", JSON.stringify({ hadSignOut, shown: d.shown, boxType: d.boxType }));
if (!hadSignOut) fail("Settings has no sign-out button");
if (!d.shown) fail("signing out didn't bring the door back");
if (d.boxType !== "email") fail("the door came back on the wrong step");

// --- The door can create an account: same two boxes, a switch underneath.
await p.click("#login .login-switch");
const sw = await p.evaluate(() => ({ text: document.querySelector("#login .login-switch")?.textContent.trim(), button: document.querySelector("#login .login-go")?.textContent.trim() }));
console.log("create mode:", JSON.stringify(sw));
if (!/Sign in/.test(sw.text || "")) fail("the switch didn't flip to create mode");
await p.evaluate(() => { document.querySelector('#login [name="email"]').value = "new2@example.com"; });
await p.click("#login .login-go");
await p.waitForTimeout(200);
const step = await p.evaluate(() => ({ button: document.querySelector("#login .login-go")?.textContent.trim(), note: document.querySelector("#login .login-note")?.textContent.trim() }));
if (step.button !== "Create account" || !/6\+ characters/.test(step.note)) fail("the password step doesn't say it's creating an account: " + JSON.stringify(step));
await p.evaluate(() => { document.querySelector('#login [name="password"]').value = "abc"; });
await p.click("#login .login-go");
await p.waitForTimeout(200);
if (!/6\+ characters/.test(await p.evaluate(() => document.querySelector("#login .login-note").textContent))) fail("a short password wasn't refused");
await p.evaluate(() => { document.querySelector('#login [name="password"]').value = "longenough"; });
await p.click("#login .login-go");
await p.waitForFunction(() => !document.querySelector("#login"), null, { timeout: 10000 });
const created = await p.evaluate(() => JSON.parse(localStorage.getItem("viniva:auth") || "{}").user);
console.log("created:", JSON.stringify(created));
if (!created || created.email !== "new2@example.com" || !/0002$/.test(created.id)) fail("creating an account from the door didn't sign the new account in: " + JSON.stringify(created));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nlogin.test.js FAILED" : "\nlogin.test.js passed");
})();
