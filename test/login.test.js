// The front door. Signed out, the app is one word and one box; signed in, the
// door isn't there. Email in the box, then the password in the same place,
// then Home. Signing out puts the door back.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
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
    appDrawn: !!document.querySelector("#view .hero"),
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

// --- Something that isn't an email doesn't get past the box.
await p.keyboard.type("parm");
await p.keyboard.press("Enter");
await p.waitForTimeout(100);
d = await door();
console.log("  not an email:", JSON.stringify({ boxType: d.boxType, note: d.note }));
if (d.boxType !== "email") fail("a non-email moved on to the password");
if (!d.note) fail("no word about why it didn't move on");

// --- Email, then the same spot asks for the password.
await p.evaluate(() => { const i = document.querySelector('#login [name="email"]'); i.value = ""; });
await p.keyboard.type("p@e.com");
await p.keyboard.press("Enter");
await p.waitForTimeout(100);
d = await door();
console.log("  after the email:", JSON.stringify({ boxes: d.boxes, boxType: d.boxType, note: d.note }));
if (d.boxes !== 1) fail(`${d.boxes} boxes showing on the password step`);
if (d.boxType !== "password") fail("the box didn't become the password box");
if (!/p@e\.com/.test(d.note || "")) fail("the email you typed isn't shown on the password step");

// --- Password, Enter, and the app is there.
await p.keyboard.type("secret");
await p.keyboard.press("Enter");
await p.waitForTimeout(700);
d = await door();
const sess = await p.evaluate(() => JSON.parse(localStorage.getItem("entoa:auth") || "null"));
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

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nlogin.test.js FAILED" : "\nlogin.test.js passed");
})();
