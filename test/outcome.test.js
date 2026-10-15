// One-tap outcomes. The function pushes "Did Dana show?" an hour after an
// appointment with two buttons; each button is a hash — #/calendar/<id>/showed
// or /no_show — that lands the outcome and draws the appointment. The plain
// tap opens the appointment's page with the same buttons. Sold from the push
// logs the sale once. The hash loses the action so a reload doesn't repeat it.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await fetch(APP + "/__reset");
const pad = (n) => String(n).padStart(2, "0");
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const twoHoursAgo = local(new Date(Date.now() - 2 * 3600000));
await p.addInitScript(([when]) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Test", phone: "9025551111", stage: "appointment", ...x }],
    appointments: [
      { id: "a1", leadId: "a", customerName: "Dana Test", type: "test drive", when, status: "scheduled", confirmed: true, ...x },
      { id: "a2", leadId: "a", customerName: "Dana Test", type: "appointment", when, status: "scheduled", confirmed: true, ...x },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false, goalUnits: 10 },
  }));
}, [twoHoursAgo]);

const read = () => p.evaluate(async () => {
  const s = await import("/js/store.js");
  return { hash: location.hash, a1: s.get("appointments", "a1").outcome, a2: s.get("appointments", "a2").outcome, status: document.querySelector("#view .kv .v:last-child") && [...document.querySelectorAll("#view .kv")].map((n) => n.textContent.replace(/\s+/g, " ").trim()).find((t) => /^Status/.test(t)), sales: s.all("sales").length, lead: s.get("leads", "a").stage };
});

// The "Showed" button on the push.
await p.goto(APP + "/#/calendar/a1/showed");
await p.waitForFunction(() => /Showed/.test(document.querySelector("#view")?.textContent || ""), null, { timeout: 15000 }).catch(() => fail("the appointment page didn't draw after the showed button"));
let r = await read();
console.log("showed:", JSON.stringify(r));
if (r.a1 !== "showed" || r.hash !== "#/calendar/a1" || !/Status ?Showed/.test(r.status || "")) fail("the showed button didn't land, or the hash kept the action: " + JSON.stringify(r));

// Reloading the page at the stripped hash changes nothing.
await p.reload();
await p.waitForFunction(() => /Showed/.test(document.querySelector("#view")?.textContent || ""), null, { timeout: 15000 });
r = await read();
if (r.a1 !== "showed") fail("a reload undid the outcome: " + JSON.stringify(r));

// The "No-show" button on another appointment's push.
await p.goto(APP + "/#/calendar/a2/no_show");
await p.waitForFunction(() => /No-show/.test(document.querySelector("#view")?.textContent || "") && location.hash === "#/calendar/a2", null, { timeout: 15000 }).catch(() => fail("the no-show button didn't land"));
r = await read();
console.log("no-show:", JSON.stringify(r));
if (r.a2 !== "no_show" || r.a1 !== "showed") fail("the no-show button marked the wrong thing: " + JSON.stringify(r));

// Sold from the push logs the sale once and moves the customer.
await p.goto(APP + "/#/calendar/a1/sold");
await p.waitForFunction(() => location.hash === "#/calendar/a1" && /Sold/.test(document.querySelector("#view")?.textContent || ""), null, { timeout: 15000 }).catch(() => fail("the sold button didn't land"));
r = await read();
console.log("sold:", JSON.stringify(r));
if (r.a1 !== "sold" || r.sales !== 1 || r.lead !== "sold") fail("sold from the push didn't log the sale and move the customer: " + JSON.stringify(r));
await p.goto(APP + "/#/calendar/a1/sold");
await p.waitForTimeout(600);
r = await read();
if (r.sales !== 1) fail("a second sold tap logged a second sale: " + JSON.stringify(r));

// The in-app nudge for an unlogged appointment opens the appointment itself.
const nudge = await p.evaluate(async () => {
  const s = await import("/js/store.js"); const n = await import("/js/nudges.js");
  s.update("appointments", "a2", { outcome: "" });
  return n.getNudges({ limit: 20 }).filter((x) => x.kind === "outcome").map((x) => x.route);
});
console.log("nudge routes:", JSON.stringify(nudge));
if (nudge.length && !nudge.includes("/calendar/a2")) fail("the outcome nudge doesn't open the appointment: " + JSON.stringify(nudge));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\noutcome.test.js FAILED" : "\noutcome.test.js passed");
})();
