// A phone can't be attached to a debugger. When a tap does nothing, the app
// itself has to be able to say why: every uncaught error is written down on
// the device, and Settings → Storage check shows the last of them with a
// button that copies the whole report.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
    settings: { salesperson: "Parm", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
});
await p.goto(APP + "/#/settings");
await p.waitForTimeout(600);

// Three kinds of failure: a thrown error, a rejected promise, a script that
// doesn't load.
await p.evaluate(() => {
  setTimeout(() => { throw new Error("tap did nothing: store.logContact is not a function"); }, 0);
  Promise.reject(new Error("sync fell over"));
  const s = document.createElement("script"); s.src = "./js/does-not-exist.js"; document.head.appendChild(s);
});
await p.waitForTimeout(500);
const kept = await p.evaluate(() => JSON.parse(localStorage.getItem("viniva:errors") || "[]"));
console.log("recorded:", JSON.stringify(kept.map((e) => [e.kind, e.msg, e.src.split("/").slice(-1)[0]])));
if (!kept.some((e) => e.kind === "error" && /logContact/.test(e.msg))) fail("a thrown error wasn't recorded");
if (!kept.some((e) => e.kind === "promise" && /fell over/.test(e.msg))) fail("a rejected promise wasn't recorded");
if (!kept.some((e) => e.kind === "load" && /does-not-exist/.test(e.src))) fail("a script that failed to load wasn't recorded");
if (!kept.every((e) => /^\d{4}-\d{2}-\d{2}T/.test(e.at) && typeof e.hash === "string")) fail("entries lack a time or the page they happened on");

// The Storage check shows them and offers the report.
await p.click('[data-act="storagecheck"]');
await p.waitForTimeout(300);
const panel = await p.evaluate(() => {
  const el = document.getElementById("storage-check");
  return el ? { text: el.innerText, copy: !!el.querySelector('[data-act="copy-report"]'), clear: !!el.querySelector('[data-act="clear-errors"]') } : null;
});
if (!panel) fail("the storage check didn't open");
else {
  console.log("panel shows:", JSON.stringify(panel.text.split("\n").filter((l) => /recent errors|logContact|fell over|does-not-exist/.test(l))));
  if (!/recent errors \(3\)/.test(panel.text)) fail("the panel doesn't list the three errors");
  if (!/logContact/.test(panel.text)) fail("the thrown error isn't in the panel");
  if (!panel.copy) fail("no button to copy the report");
  if (!panel.clear) fail("no button to clear the errors");
}
// Clearing empties the record without closing the panel.
await p.click('#storage-check [data-act="clear-errors"]');
await p.waitForTimeout(150);
const cleared = await p.evaluate(() => ({ left: JSON.parse(localStorage.getItem("viniva:errors") || "[]").length, open: !!document.getElementById("storage-check"),
  text: document.getElementById("storage-check")?.innerText || "" }));
console.log("after clearing:", JSON.stringify({ left: cleared.left, open: cleared.open, says: /no errors recorded/.test(cleared.text) }));
if (cleared.left !== 0) fail("clearing left errors behind");
if (!cleared.open) fail("clearing closed the panel");
if (!/no errors recorded/.test(cleared.text)) fail("the panel doesn't say the record is empty");

// Twenty is the most it keeps — the newest twenty.
await p.evaluate(() => { for (let i = 0; i < 25; i++) setTimeout(() => { throw new Error("flood " + i); }, 0); });
await p.waitForTimeout(300);
const flood = await p.evaluate(() => JSON.parse(localStorage.getItem("viniva:errors") || "[]"));
console.log("after 25 more:", flood.length, "kept, last is", JSON.stringify(flood[flood.length - 1]?.msg));
if (flood.length !== 20 || !/flood 24$/.test(flood[flood.length - 1].msg)) fail("the record doesn't keep the newest twenty");

await b.close();
console.log(process.exitCode ? "\nerrors.test.js FAILED" : "\nerrors.test.js passed");
})();
