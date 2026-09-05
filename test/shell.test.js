// The app shell: the behaviours that make a web page feel like an app rather
// than a document. Sideways travel, zoom, the slack under a scrolled list,
// pull-to-refresh, and the keyboard.
//
// The keyboard is the one that bit hardest. On a real iPhone, tapping the
// reply box left the tab bar and the compose row floating in the middle of the
// screen with the rest of the page drawn underneath them.
//
// The cause is that iOS doesn't shrink the layout viewport when the keyboard
// opens, so `position: fixed` and `100dvh` both keep measuring the full window.
// A headless browser has no keyboard, so the test drives the same signal iOS
// sends — a visualViewport that is suddenly much shorter than window.innerHeight
// — and checks the app moves the right things out of the way.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  colorScheme: "dark", serviceWorkers: "block", hasTouch: true })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("entoa:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Ann Lee", phone: "9025551111", stage: "working",
      vehicleInterest: "2023 Nissan Rogue", createdAt: "x", updatedAt: "x" }],
    texts: [{ id: "t1", leadId: "a", dir: "in", body: "saturday works", at: new Date().toISOString(),
      read: false, createdAt: "x", updatedAt: "x" }],
    settings: { salesperson: "Parm", cloudAutoSync: false, smsFrom: "+19025550123",
      agentUrl: "http://127.0.0.1:8137/functions/v1/voice-agent" },
  }));
});

await p.goto(APP + "/#/inbox/a");
await p.waitForTimeout(700);

// --- Sideways travel must be impossible, keyboard or not — but NOT by putting
// overflow on the root. iOS Safari responds to that by positioning `fixed`
// elements against the document instead of the viewport, which sends the tab
// bar drifting up the screen as you scroll. That shipped once; this keeps it
// from shipping again.
const overflow = await p.evaluate(() => {
  const body = getComputedStyle(document.body);
  const html = getComputedStyle(document.documentElement);
  return {
    bodyOverflow: `${body.overflowX}/${body.overflowY}`,
    htmlOverflow: `${html.overflowX}/${html.overflowY}`,
    bounce: body.overscrollBehaviorX,
    scrollable: document.getElementById("view").scrollWidth > document.getElementById("view").clientWidth,
  };
});
console.log("horizontal:", JSON.stringify(overflow));
if (overflow.bodyOverflow !== "visible/visible")
  fail("body sets overflow — that breaks fixed positioning on iOS: " + overflow.bodyOverflow);
if (overflow.htmlOverflow !== "visible/visible")
  fail("html sets overflow — that breaks fixed positioning on iOS: " + overflow.htmlOverflow);
if (overflow.bounce !== "none") fail("the horizontal rubber-band is still on");
if (overflow.scrollable) fail("something is wider than the screen — the page scrolls sideways");

// --- The tab bar stays welded to the bottom of the viewport, scrolled or not.
// This is the symptom that was reported: it floated in the middle of a
// conversation with dead space beneath it.
await p.evaluate(() => { document.getElementById("view").scrollTop = 0; });
const barTop = await p.evaluate(() => Math.round(document.querySelector(".tabbar").getBoundingClientRect().bottom));
await p.evaluate(() => { document.getElementById("view").scrollTop += 400; });
await p.waitForTimeout(200);
const barScrolled = await p.evaluate(() => ({
  bottom: Math.round(document.querySelector(".tabbar").getBoundingClientRect().bottom),
  scrolled: Math.round(document.getElementById("view").scrollTop),
  win: document.documentElement.clientHeight,
}));
console.log(`tab bar: ${barTop} at rest, ${barScrolled.bottom} after scrolling ${barScrolled.scrolled}px`);
if (barScrolled.bottom !== barScrolled.win)
  fail(`the tab bar drifted to ${barScrolled.bottom} while scrolling — it must stay at ${barScrolled.win}`);

// --- Nothing scrolls through the gap between the reply bar and the tab bar.
const gap = await p.evaluate(() => {
  const c = document.querySelector("#ib-compose");
  const t = document.querySelector(".tabbar");
  return c && t ? Math.round(t.getBoundingClientRect().top - c.getBoundingClientRect().bottom) : null;
});
console.log("gap between reply bar and tab bar:", gap);
if (gap === null) fail("no reply bar on the thread");
else if (gap > 1) fail(`a ${gap}px live gap under the reply bar — messages scroll through it`);
await p.evaluate(() => window.scrollTo(0, 0));

// --- Zoom stays locked.
const vp = await p.$eval('meta[name="viewport"]', (m) => m.content);
if (!/user-scalable=no/.test(vp) || !/maximum-scale=1/.test(vp)) fail("pinch zoom isn't locked: " + vp);
console.log("viewport:", vp.slice(0, 70));

// --- There's slack under the last row rather than a dead stop.
// Measured on a list screen: a thread supplies its own bottom edge.
await p.goto(APP + "/#/comms"); await p.waitForTimeout(500);
const pad = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".view")).paddingBottom));
const tabH = await p.evaluate(() => document.querySelector(".tabbar").getBoundingClientRect().height);
const slack = pad - tabH;
console.log(`scroll buffer: ${Math.round(pad)}px padding vs a ${Math.round(tabH)}px tab bar — ${Math.round(slack)}px of slack`);
// Bounded at both ends: enough that the page doesn't stop dead at the tab bar,
// not so much that a short list looks like it's floating above empty screen.
if (slack < 20) fail(`only ${Math.round(slack)}px of slack — the page stops dead at the tab bar`);
if (slack > 60) fail(`${Math.round(slack)}px of slack below the content — too much empty space under a short list`);
await p.goto(APP + "/#/inbox/a"); await p.waitForTimeout(500);

// --- The keyboard. The invariant is simple now and doesn't depend on which
// iOS behaviour is in play: the shell is exactly as tall as the visible area,
// so its floor IS the keyboard's lip, and the tab bar is gone while typing.
const shellState = () => p.evaluate(() => {
  const t = document.querySelector(".tabbar").getBoundingClientRect();
  const app = document.getElementById("app").getBoundingClientRect();
  const c = document.querySelector("#ib-compose")?.getBoundingClientRect();
  return {
    typing: document.body.classList.contains("typing"),
    kbOpen: document.body.classList.contains("kb-open"),
    kb: getComputedStyle(document.documentElement).getPropertyValue("--kb").trim(),
    tabVisible: t.height > 0,
    appBottom: Math.round(app.bottom),
    composeBottom: c ? Math.round(c.bottom) : null,
  };
});

const before = await shellState();
console.log("\nbefore keyboard:", JSON.stringify(before));
if (!before.tabVisible) fail("the tab bar is missing before the keyboard is even open");
if (before.appBottom !== 844) fail(`the shell ends at ${before.appBottom}, not the screen bottom`);

// Safari's shape: the layout viewport stays 844, the visual one shrinks.
await p.evaluate(() => {
  const vv = window.visualViewport;
  Object.defineProperty(vv, "height", { configurable: true, get: () => 508 });
  Object.defineProperty(vv, "offsetTop", { configurable: true, get: () => 0 });
  vv.dispatchEvent(new Event("resize"));
});
await p.waitForTimeout(400);
const safari = await shellState();
console.log("Safari-shape keyboard:", JSON.stringify(safari));
if (!safari.kbOpen) fail("the app didn't notice the keyboard opened");
if (safari.kb !== "336px") fail("the keyboard inset was measured wrong: " + safari.kb);
if (safari.tabVisible) fail("the tab bar is still on screen with the keyboard up");
if (Math.abs(safari.appBottom - 508) > 2)
  fail(`the shell ends at ${safari.appBottom}, not at the keyboard lip at 508`);
if (Math.abs(safari.composeBottom - 508) > 24)
  fail(`the reply row is at ${safari.composeBottom}, not on the keyboard lip at 508`);
console.log("  shell shrank to the visible area, tab bar gone, reply row on the lip ✓");

// --- The PWA shape, which is what kept this bug alive: iOS shrinks the layout
// viewport too, so innerHeight moves with it and a naive subtraction reads ~0.
// Focus is what has to carry it.
await p.evaluate(() => {
  const vv = window.visualViewport;
  Object.defineProperty(vv, "height", { configurable: true, get: () => 844 });
  vv.dispatchEvent(new Event("resize"));
  document.activeElement?.blur();
});
await p.waitForTimeout(300);
await p.evaluate(() => {
  Object.defineProperty(window, "innerHeight", { configurable: true, get: () => 508 });
  Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => 508 });
  document.querySelector("#ib-text").focus();
  window.visualViewport.dispatchEvent(new Event("resize"));
});
await p.waitForTimeout(400);
const pwa = await shellState();
console.log("PWA-shape keyboard:", JSON.stringify(pwa));
if (!pwa.typing) fail("a focused reply box didn't register as typing — the tab bar will stay put");
if (pwa.tabVisible) fail("the tab bar is still on screen with the keyboard up in a PWA");
if (Math.abs(pwa.appBottom - 508) > 2) fail(`the shell ends at ${pwa.appBottom}, not at 508`);

// And prove focus alone carries the tab bar: throw the measurement away
// entirely. If this fails, the layout is back to waiting on numbers that some
// iOS build will eventually report differently.
const focusOnly = await p.evaluate(() => {
  document.body.classList.remove("kb-open");
  document.documentElement.style.setProperty("--vvh", "100%");
  document.documentElement.style.setProperty("--kb", "0px");
  const t = document.querySelector(".tabbar").getBoundingClientRect();
  return { typing: document.body.classList.contains("typing"), tabVisible: t.height > 0 };
});
console.log("  with the measurement discarded:", JSON.stringify(focusOnly));
if (!focusOnly.typing) fail("the typing class went away with the measurement");
if (focusOnly.tabVisible) fail("without measurement the tab bar comes back over the keyboard");
console.log("  focus alone is enough ✓");

// --- And it all goes back when the keyboard closes.
await p.evaluate(() => {
  document.activeElement?.blur();
  Object.defineProperty(window, "innerHeight", { configurable: true, get: () => 844 });
  Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => 844 });
  window.visualViewport.dispatchEvent(new Event("resize"));
});
await p.waitForTimeout(400);
const after = await shellState();
console.log("after keyboard:", JSON.stringify(after));
if (after.typing || after.kbOpen) fail("the app thinks the keyboard is still open");
if (!after.tabVisible) fail("the tab bar didn't come back");
if (after.appBottom !== 844) fail(`the shell ends at ${after.appBottom}, not back at the screen bottom`);

// --- Pull to refresh. The browser's own is off (overscroll-behavior: none),
// so this has to be the app's, and it has to actually run a sync — inbound
// texts only reach the device on a pull.
// The refresh announces itself when the sync attempt finishes, so the gesture
// can be checked end to end without reaching into sync's internals.
await p.evaluate(() => {
  window.__synced = 0;
  window.addEventListener("entoa-refresh", () => { window.__synced++; });
});
const drag = async (from, to) => {
  await p.evaluate(([y0, y1]) => {
    const t = (y) => ({ clientX: 195, clientY: y, identifier: 1, target: document.body });
    const fire = (name, y) => document.dispatchEvent(
      new TouchEvent(name, { bubbles: true, cancelable: true,
        touches: name === "touchend" ? [] : [new Touch(t(y))],
        changedTouches: [new Touch(t(y))] }));
    fire("touchstart", y0);
    for (let y = y0; y <= y1; y += 20) fire("touchmove", y);
    fire("touchend", y1);
  }, [from, to]);
};
await p.evaluate(() => window.scrollTo(0, 0));
await drag(80, 320);
await p.waitForTimeout(200);
await p.waitForFunction(() => window.__synced > 0, null, { timeout: 5000 }).catch(() => {});
const pulled = await p.evaluate(() => ({
  spinning: !!document.querySelector(".ptr-spin") || !!document.querySelector(".ptr"),
  synced: window.__synced,
}));
console.log("\npull to refresh:", JSON.stringify(pulled));
if (!pulled.spinning) fail("pulling down showed no refresh indicator");
if (!pulled.synced) fail("pulling down didn't trigger a sync");
await p.waitForTimeout(600);

// A short tug must NOT refresh — otherwise every scroll re-syncs.
await p.evaluate(() => { window.__synced = 0; window.scrollTo(0, 0); });
await drag(80, 120);
await p.waitForTimeout(250);
const tug = await p.evaluate(() => window.__synced);
console.log("short tug triggered syncs:", tug);
if (tug) fail("a short tug refreshed — every scroll would re-sync");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nshell.test.js FAILED" : "\nshell.test.js passed");
})();
