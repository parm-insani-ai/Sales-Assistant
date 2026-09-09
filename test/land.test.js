// "Show me customers I can pitch right now."
//
// The answer came back as three names read aloud — Lynn, Gurmehar, Mark, all
// overdue, all "one tap away" — and the app never moved. The salesperson was
// told who to call and then left to go and find those three people themselves,
// which is the work they asked to be saved.
//
// Read tools narrated; only write tools navigated. These check the rule that
// fixes it: a tool that returns a LIST of things to act on also lands you on
// the screen where those things are already tappable, and lands you ON the
// list rather than at the top of a screen that contains it further down.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

const days = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const soonWall = (() => {
  const d = new Date(Date.now() + 3 * 3600000);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
})();

await p.addInitScript(([overdue, soon]) => {
  localStorage.setItem("entoa:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "a", name: "Lynn Doucet", phone: "9025551111", stage: "working", vehicleInterest: "2023 Nissan Rogue", followUp: overdue, createdAt: "x", updatedAt: "x" },
      { id: "b", name: "Gurmehar Sandhu", phone: "9025552222", stage: "working", vehicleInterest: "2024 Nissan Kicks", followUp: overdue, createdAt: "x", updatedAt: "x" },
      { id: "c", name: "Mark Feltmate", phone: "9025553333", stage: "negotiating", vehicleInterest: "2023 Nissan Frontier", followUp: overdue, createdAt: "x", updatedAt: "x" },
      { id: "d", name: "Nobody Urgent", phone: "9025554444", stage: "delivered", createdAt: "x", updatedAt: "x" },
      // Financials, so the radar has a real trade-up to find.
      { id: "e", name: "Trina Boudreau", phone: "9025555555", stage: "working", vehicleInterest: "2019 Nissan Rogue",
        currentPayment: 640, payoff: 9000, currentValue: 21000, currentApr: 6.9, createdAt: "x", updatedAt: "x" },
    ],
    vehicles: [
      { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38995, stock: "N1234", createdAt: "x", updatedAt: "x" },
      { id: "v2", year: 2026, make: "Nissan", model: "Kicks", trim: "SR", price: 29995, stock: "N1235", createdAt: "x", updatedAt: "x" },
    ],
    appointments: [
      { id: "ap1", customerName: "Lynn Doucet", leadId: "a", when: soon, status: "scheduled", type: "testdrive", createdAt: "x", updatedAt: "x" },
    ],
    tasks: [
      { id: "t1", leadId: "a", title: "Follow up with Lynn Doucet", due: overdue, channel: "message", body: "Hi Lynn — still thinking about the Rogue?", done: false, createdAt: "x", updatedAt: "x" },
      { id: "t2", leadId: "c", title: "Follow up with Mark Feltmate", due: overdue, channel: "call", done: false, createdAt: "x", updatedAt: "x" },
    ],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, smsFrom: "+19025550123" },
  }));
}, [days(-3), soonWall]);

await p.goto(APP + "/#/");
await p.waitForTimeout(700);

const run = (tool, input = {}) => p.evaluate(async ([tool, input]) => {
  const m = await import("/js/agent.js");
  const r = await m.execTool(tool, input);
  await new Promise((res) => setTimeout(res, 350));
  return { result: r.result, hash: location.hash };
}, [tool, input]);

const goto = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(300); };

// --- The exact utterance that failed. get_plays has to land on the queue.
{
  await goto("#/settings");
  const r = await run("get_plays");
  console.log("get_plays →", r.hash, "| plays:", (r.result.plays || []).length);
  if (!(r.result.plays || []).length) fail("no plays for a salesperson with three overdue follow-ups");
  if (r.hash !== "#/") fail("asking for your plays didn't take you to them: " + r.hash);

  // And onto the queue itself, which sits most of a page below the top of Home.
  const where = await p.evaluate(() => {
    const slot = document.querySelector(".plays-slot");
    const view = document.querySelector(".view");
    if (!slot || !view) return null;
    const r = slot.getBoundingClientRect(), v = view.getBoundingClientRect();
    return { top: Math.round(r.top - v.top), scrolled: Math.round(view.scrollTop), rows: slot.querySelectorAll(".play-row, .row, .card").length };
  });
  console.log("  queue:", JSON.stringify(where));
  if (!where) fail("the play sheet isn't on the screen it navigated to");
  else if (where.top > 200)
    fail(`landed ${where.top}px above the queue — the answer is off screen (scrolled ${where.scrolled})`);
}

// --- Already on Home. Setting the hash to the hash you're on fires no
// hashchange, so this used to be a total no-op: no repaint, no scroll, and the
// voice panel never docked either.
{
  await goto("#/");
  await p.evaluate(() => { document.querySelector(".view").scrollTop = 0; });
  let navigated = 0;
  await p.evaluate(() => { window.__navs = 0; window.addEventListener("entoa-navigated", () => { window.__navs++; }); });
  await run("get_plays");
  navigated = await p.evaluate(() => window.__navs);
  const scrolled = await p.evaluate(() => Math.round(document.querySelector(".view").scrollTop));
  console.log("\nalready on Home → navigations:", navigated, "| scrolled to:", scrolled);
  if (!navigated) fail("re-entering the screen you're already on announced nothing — the voice panel can't dock");
  if (scrolled <= 0) fail("it didn't scroll to the queue when you were already on Home");
}

// --- "Who's overdue?" — the leads list, filtered to the same set that was
// described, not the default list with those three buried in it.
{
  await goto("#/settings");
  const r = await run("find_customers", { needsFollowUp: true });
  console.log("\nfind_customers(needsFollowUp) →", r.hash, "| count:", r.result.count);
  if (r.hash !== "#/leads") fail("looking customers up didn't open the leads list: " + r.hash);
  const shown = await p.evaluate(() => [...document.querySelectorAll(".row-title, .lead-name")].map((n) => n.textContent.trim()));
  console.log("  on screen:", JSON.stringify(shown));
  if (!shown.some((n) => /Lynn/.test(n))) fail("the customer it named isn't on the list it opened");
  if (shown.some((n) => /Nobody Urgent/.test(n)))
    fail("the list isn't filtered to what was asked for — everyone is on it");
}

// --- A query lands filtered to the query.
{
  await goto("#/settings");
  const r = await run("find_customers", { query: "Rogue" });
  const shown = await p.evaluate(() => [...document.querySelectorAll(".row-title, .lead-name")].map((n) => n.textContent.trim()));
  console.log("\nfind_customers(query Rogue) →", r.hash, JSON.stringify(shown));
  if (!shown.some((n) => /Lynn/.test(n))) fail("the Rogue customer isn't shown");
  if (shown.some((n) => /Gurmehar/.test(n))) fail("the search wasn't applied — unrelated customers are listed");
}

// --- Other list reads land somewhere you can act.
// (/deals is a redirect: it presets the opportunity filter and hands off to
// the leads list, so that's where the radar legitimately lands.)
for (const [tool, want] of [["deal_radar", "#/leads"], ["get_tasks", "#/"], ["get_appointments", "#/calendar"]]) {
  await goto("#/settings");
  const r = await run(tool);
  const got = Object.values(r.result).find(Array.isArray) || [];
  console.log(`\n${tool} →`, r.hash, `(${got.length} rows)`);
  if (!got.length) { fail(`${tool} returned nothing — the fixture can't prove it navigates`); continue; }
  if (r.hash !== want) fail(`${tool} left you on ${r.hash}, expected ${want}`);
}

// --- And a read with NO list to show doesn't drag you anywhere. Being thrown
// onto an empty screen is worse than being told there's nothing.
{
  await goto("#/settings");
  const r = await run("get_deliveries");
  console.log("\nget_deliveries (none on file) →", r.hash);
  if (r.hash !== "#/settings") fail("an empty result navigated anyway: " + r.hash);
}
{
  await goto("#/settings");
  const r = await run("get_stats");
  console.log("get_stats →", r.hash);
  if (r.hash !== "#/settings") fail("a plain question moved the screen: " + r.hash);
}

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nland.test.js FAILED" : "\nland.test.js passed");
})();
