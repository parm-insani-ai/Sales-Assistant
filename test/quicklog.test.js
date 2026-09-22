// Logging a contact has to feel instant on a real book. The card used to
// redraw by re-reading every customer and every deal — the same work the
// Leads page does once on the way in — and on three thousand customers that
// is the pause between the tap and the card. Now the write is one batch and
// the card re-reads one customer against the book already read.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
await fetch(APP + "/__reset"); // the stub cloud keeps rows between runs
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const leads = [];
  for (let i = 0; i < 3000; i++) {
    const d = new Date(2024, 0, 1 + (i % 700));
    leads.push({ id: "lead_" + i, name: `Customer ${i}`, phone: "902555" + String(1000 + i), stage: i % 9 === 0 ? "sold" : "new",
      currentVehicle: ["2019 Rogue SV", "2020 Kicks SR", "2018 Altima SL", "2021 Pathfinder SV"][i % 4], currentPayment: 380 + (i % 200),
      paymentsLeft: i % 60, purchaseDate: d.toISOString().slice(0, 10), createdAt: d.toISOString(), updatedAt: d.toISOString() });
  }
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads,
    settings: { salesperson: "Parm", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
});
await p.goto(APP + "/#/leads");
await p.waitForTimeout(4000); // the list, and the warm read of the book

const t = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const assess = await import("/js/assess.js");
  assess.assessAll();
  // How long the full read takes, for scale.
  store.update("leads", "lead_7", { notes: "poke" }); // stale the cache
  const f0 = performance.now(); assess.assessAll(); const full = performance.now() - f0;
  // The path a tap takes: log, then one card's read.
  const l0 = performance.now(); const rec = store.logContact("lead_5", { via: "call" }); const log = performance.now() - l0;
  const q0 = performance.now(); const a = assess.assessQuick("lead_5"); const quick = performance.now() - q0;
  return { full: Math.round(full), log: Math.round(log * 10) / 10, quick: Math.round(quick * 10) / 10, has: !!a && !!rec, leads: store.all("leads").length };
});
console.log("3000 customers:", JSON.stringify(t));
if (!t.has) fail("no record or no read came back");
if (t.leads < 3000) fail("the book didn't load");
if (t.log > 40) fail(`logging took ${t.log}ms — it should be a single cheap write`);
if (t.quick > 40) fail(`one card's read took ${t.quick}ms — it should not re-read the book`);
if (t.quick * 10 > t.full && t.full > 50) fail(`the quick read (${t.quick}ms) isn't much quicker than the full one (${t.full}ms)`);

// The tap itself, on the list: from the button to the redrawn card.
const tap = await p.evaluate(() => {
  const wrap = document.querySelector(".swipe-wrap");
  const name = wrap.querySelector(".row-title").textContent;
  wrap.querySelector(".swipe-act-ok").click();                       // Contacted
  const text = [...wrap.querySelectorAll(".swipe-act")].find((b) => /Text/.test(b.textContent));
  const t0 = performance.now(); text.click(); const dt = performance.now() - t0;   // handlers run synchronously
  return { name, ms: Math.round(dt * 10) / 10, card: wrap.querySelector(".row-contact")?.textContent.trim() || "" };
});
console.log("tap to redrawn card:", JSON.stringify(tap));
if (!/^Texted/.test(tap.card)) fail("the card didn't redraw with the contact");
if (tap.ms > 60) fail(`the tap took ${tap.ms}ms to the redrawn card on 3000 customers`);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nquicklog.test.js FAILED" : "\nquicklog.test.js passed");
})();
