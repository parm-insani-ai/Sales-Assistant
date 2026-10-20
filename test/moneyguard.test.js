// No figure reaches a customer, whoever wrote it. The agent's drafts and the
// manager's texts always met this rule; a text the rep typed or dictated in
// the Inbox did not, and one went out with a trade value in it. Now every
// send path meets the same check, on the phone and in the function, and a
// refused text comes back into the box to be fixed rather than retyped.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
// The function reads the rep's specials from their cloud copy; the stub's copy is seeded the way sync would put it there.
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: "00000000-0000-4000-8000-000000000001", rows: [{ id: "sp1", collection: "specials", data: { id: "sp1", model: "Rogue", financeApr: 0, financeTerm: 60, cash: 500, expiry: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) } }] }) });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
p.on("pageerror", (e) => errs.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "l1", name: "Tyson Test", phone: "9025550100", stage: "working", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }],
    specials: [{ id: "sp1", model: "Rogue", financeApr: 0, financeTerm: 60, cash: 500, expiry: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }],
    settings: { salesperson: "Parm", dealership: "Store", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", smsFrom: "+19025550123" } }));
});
await p.goto(APP + "/#/inbox/l1");
await p.waitForSelector("#ib-text", { timeout: 20000 });
const tryText = async (body) => {
  await p.fill("#ib-text", body);
  await p.dispatchEvent("#ib-text", "input");
  await p.waitForTimeout(100);
  await p.evaluate(() => document.querySelector('.ib-compose [data-act="send"]').click());
  await p.waitForTimeout(700);
  return p.evaluate(async () => {
    const s = await import("/js/store.js");
    return { box: document.querySelector("#ib-text").value, toast: [...document.querySelectorAll(".toast, [class*=toast]")].map((t) => t.textContent.trim()).filter(Boolean).join(" | "), out: s.all("texts").filter((t) => t.dir === "out").map((t) => [t.body, t.status]) };
  });
};
// Every way of writing a figure is refused on the phone, before anything is written or sent.
for (const bad of ["Hi, good news. We've looked at your trade and it's worth $14,000. Let me know when you'd like to come in.", "We'd put your trade around 14k", "Call it fourteen thousand", "roughly 300 a month on the Kicks"]) {
  const r = await tryText(bad);
  if (r.out.length) fail("a text with a figure was written or sent: " + JSON.stringify([bad, r.out]));
  if (r.box !== bad) fail("the refused text didn't come back into the box: " + JSON.stringify([bad, r.box]));
  if (!/No figures in a text/.test(r.toast)) fail("the rep wasn't told why: " + JSON.stringify([bad, r.toast]));
}
// Advertised content goes: the 0% and the $500 are on a current special; the trade value still doesn't.
const ad = await tryText("There's 0% financing on the Rogue this month and $500 toward it — want to come see one?");
if (ad.out.length !== 1 || ad.out[0][1] !== "sent") fail("advertised content was refused: " + JSON.stringify(ad));
const mixed = await tryText("0% financing on the Rogue, and your trade is worth $14,000");
if (mixed.out.length !== 1 || !/No figures/.test(mixed.toast)) fail("a trade value beside an advertised rate got through: " + JSON.stringify(mixed));
// The same message with the figure taken out goes.
const fine = await tryText("Hi, good news. We've had a look at your trade. Let me know when you'd like to come in and we'll take it from there.");
console.log("after the clean send:", JSON.stringify(fine));
if (fine.out.length !== 2 || fine.out[1][1] !== "sent" || fine.box !== "") fail("the text with no figure didn't send: " + JSON.stringify(fine));
if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nmoneyguard.test.js FAILED" : "\nmoneyguard.test.js passed");
})();
