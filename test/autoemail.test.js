// Automatic email failures, and which of them are worth interrupting for.
//
// A missing server secret is not an event, it's a state: the emails stay due,
// so the next launch retries, fails identically, and complains again. That's
// how a red banner ended up covering the dashboard every single time the app
// opened. A standing condition belongs next to the switch it's about, not in
// a toast.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

// A customer with a follow-up email due today, and auto-send switched on.
const seed = (emailFails) => `
  localStorage.setItem("entoa:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Ann Lee", email: "ann@example.com", phone: "9025551111",
      stage: "working", vehicleInterest: "2023 Nissan Rogue", createdAt: "x", updatedAt: "x" }],
    tasks: [{ id: "k1", leadId: "a", channel: "email", cadence: true, label: "Intro email", done: false,
      due: new Date().toISOString().slice(0, 10), createdAt: "x", updatedAt: "x" }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false,
      emailAutoSend: true, agentUrl: "${APP}/functions/v1/voice-agent" },
  }));
  localStorage.setItem("__emailfail", ${JSON.stringify(emailFails)});
`;

async function launch(emailFails) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  // Stand in for the function's email endpoint with the failure under test.
  await p.route("**/functions/v1/voice-agent", async (route) => {
    const body = route.request().postDataJSON() || {};
    if (!body.email) return route.continue();
    return route.fulfill({ status: 500, contentType: "application/json",
      body: JSON.stringify({ error: emailFails }) });
  });
  await p.addInitScript(seed(emailFails));
  const toasts = [];
  await p.goto(APP + "/#/");
  await p.waitForTimeout(1500);
  for (const t of await p.$$(".toast")) toasts.push((await t.textContent()).trim());
  return { p, ctx, toasts };
}

// --- A missing server secret must not interrupt, ever.
{
  const { p, ctx, toasts } = await launch("Server missing RESEND_API_KEY");
  console.log("first launch, missing secret — toasts:", JSON.stringify(toasts));
  if (toasts.some((t) => /RESEND_API_KEY|Auto-email/i.test(t)))
    fail("a missing server secret is shouted on the dashboard");

  // But it must still be findable — next to the switch it's about.
  await p.goto(APP + "/#/comms");
  await p.waitForTimeout(400);
  await p.$eval('[data-tab="email"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(400);
  const emailTab = await p.$eval("#c-body", (n) => n.textContent.replace(/\s+/g, " "));
  if (!/RESEND_API_KEY/.test(emailTab))
    fail("the reason nothing sends is nowhere to be found in the Email tab");
  console.log("  reported in Comms → Email ✓");
  await ctx.close();
}

// --- A real send failure is worth saying — once.
{
  const first = await launch("Ann's address was rejected by the mail server");
  console.log("\\nfirst launch, real failure — toasts:", JSON.stringify(first.toasts));
  if (!first.toasts.some((t) => /Auto-email/i.test(t)))
    fail("a genuine send failure was swallowed");
  const storage = await first.p.evaluate(() => localStorage.getItem("entoa:autoemail-warned"));
  await first.ctx.close();

  // Reopening straight away must not repeat it.
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  await p.route("**/functions/v1/voice-agent", async (route) => {
    const body = route.request().postDataJSON() || {};
    if (!body.email) return route.continue();
    return route.fulfill({ status: 500, contentType: "application/json",
      body: JSON.stringify({ error: "Ann's address was rejected by the mail server" }) });
  });
  await p.addInitScript(seed("Ann's address was rejected by the mail server") +
    `localStorage.setItem("entoa:autoemail-warned", ${JSON.stringify(storage)});`);
  await p.goto(APP + "/#/");
  await p.waitForTimeout(1500);
  const again = [];
  for (const t of await p.$$(".toast")) again.push((await t.textContent()).trim());
  console.log("second launch, same failure — toasts:", JSON.stringify(again));
  if (again.some((t) => /Auto-email/i.test(t)))
    fail("the same failure nags on every launch");
  console.log("  said once, then quiet ✓");
  await ctx.close();
}

await b.close();
console.log(process.exitCode ? "\\nautoemail.test.js FAILED" : "\\nautoemail.test.js passed");
})();
