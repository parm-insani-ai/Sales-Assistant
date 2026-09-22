// Nothing is "saved" by a button. Every action lands on the device the
// moment it's taken and reaches the cloud within a breath — and the top bar
// says so. A logged contact survives an immediate reload, an immediate
// close, and a sync round trip to a fresh install.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
await fetch(APP + "/__reset");
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const FAR = Math.floor(Date.now() / 1000) + 86400;
const seed = ({ far }) => {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: far, user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "lead_ann", name: "Ann Example", phone: "9025550111", stage: "new", createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" }],
    settings: { salesperson: "Parm", cloudAutoSync: true, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
};
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.addInitScript(seed, { far: FAR });
await p.goto(APP + "/#/leads");
await p.waitForTimeout(1500);

const slide = async (name) => {
  const card = p.locator(".swipe-card", { hasText: name }).first();
  const box = await card.boundingBox();
  const y = box.y + box.height / 2;
  await p.mouse.move(box.x + box.width - 30, y);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width - 120, y, { steps: 6 });
  await p.mouse.move(box.x + box.width - 260, y, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(350);
};

// --- Log a contact through the tray, then reload straight away.
await slide("Ann Example");
await p.click(".swipe-wrap:has-text('Ann Example') .swipe-act-ok");
await p.waitForTimeout(300);
await p.click(".swipe-wrap:has-text('Ann Example') .swipe-act:has-text('Text')");
// The bar says it was saved.
await p.waitForTimeout(200);
const bar = await p.evaluate(() => document.querySelector("#save-state")?.textContent.trim() || null);
console.log("top bar after the tap:", JSON.stringify(bar));
if (!bar || !/Saved|Synced|Saving|Syncing/.test(bar)) fail(`the top bar doesn't say the action was saved (${JSON.stringify(bar)})`);
await p.reload();
await p.waitForTimeout(800);
const afterReload = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  return { via: store.get("leads", "lead_ann").lastContactVia, calls: store.callsFor("lead_ann").length };
});
console.log("after an immediate reload:", JSON.stringify(afterReload));
if (afterReload.via !== "text" || afterReload.calls !== 1) fail("the contact didn't survive an immediate reload");

// --- Log another and close the page in the same instant.
await p.evaluate(async () => { const store = await import("/js/store.js"); store.logContact("lead_ann", { via: "call" }); });
await p.close();
const p2 = await ctx.newPage();
await p2.addInitScript(seed, { far: FAR });
await p2.goto(APP + "/#/leads");
await p2.waitForTimeout(800);
const afterClose = await p2.evaluate(async () => {
  const store = await import("/js/store.js");
  return { via: store.get("leads", "lead_ann").lastContactVia, calls: store.callsFor("lead_ann").length };
});
console.log("after closing the page at once:", JSON.stringify(afterClose));
if (afterClose.via !== "call" || afterClose.calls !== 2) fail("the contact logged just before closing was lost");

// --- The cloud has it within a breath, without anyone pressing anything.
await p2.evaluate(async () => { const store = await import("/js/store.js"); store.logContact("lead_ann", { via: "email" }); });
await p2.waitForTimeout(1800);
const cloud = (await (await fetch(APP + "/__records")).json()).filter((r) => r.collection === "calls").length;
const synced = await p2.evaluate(() => document.querySelector("#save-state")?.textContent.trim() || null);
console.log("cloud contact records after 1.8s:", cloud, "· bar:", JSON.stringify(synced));
if (cloud < 3) fail(`the cloud holds ${cloud} contact records — the last one hasn't gone up`);
if (!/Synced/.test(synced || "")) fail(`the bar doesn't say Synced (${JSON.stringify(synced)})`);

// --- A fresh install pulls it all back.
const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p3 = await ctx2.newPage();
await p3.addInitScript(seed, { far: FAR });
await p3.goto(APP + "/#/leads/lead_ann");
await p3.waitForTimeout(2500);
const fresh = await p3.evaluate(async () => {
  const store = await import("/js/store.js");
  return { via: store.get("leads", "lead_ann")?.lastContactVia, calls: store.callsFor("lead_ann").length,
    row: [...document.querySelectorAll(".kv")].find((k) => /Last contacted/.test(k.textContent))?.querySelector(".v").textContent.trim() };
});
console.log("on a fresh install:", JSON.stringify(fresh));
if (fresh.via !== "email" || fresh.calls !== 3) fail("a fresh install didn't get the contacts back from the cloud");
if (!/email/.test(fresh.row || "")) fail("the page doesn't show the last contact on the fresh install");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nautosave.test.js FAILED" : "\nautosave.test.js passed");
})();
