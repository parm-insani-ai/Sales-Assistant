// The outreach loop: segment a list of owners, let the engine pick each one's
// replacement vehicle and message, mint personal invite links, and send.
//
// The load-bearing rule: no pricing may reach the customer. This test asserts
// it on both the drafted text and the invite page payload.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const APP = "http://127.0.0.1:8137";

(async () => {
  await fetch(APP + "/__reset"); // links accumulate in the stub across runs
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => {
    // Shortening requires a signed-in cloud account; stub one so links mint.
    localStorage.setItem("entoa:auth", JSON.stringify({
      access_token: "test-token", refresh_token: "test-refresh",
      user: { id: "00000000-0000-4000-8000-000000000001", email: "test@example.com" },
    }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({
      leads: [
        { id: "a", name: "Ann Lee", phone: "9025551111", stage: "delivered", vehicleInterest: "2023 Nissan Rogue",
          currentPayment: 532, payoff: 19455, currentValue: 21500, createdAt: "x", updatedAt: "x" },
        { id: "c", name: "Cy Poe", phone: "9025553333", stage: "delivered", vehicleInterest: "2019 Nissan Frontier",
          payoff: 0, currentValue: 22775, createdAt: "x", updatedAt: "x" },
        { id: "n", name: "No Phone", stage: "delivered", vehicleInterest: "2020 Nissan Kicks",
          currentValue: 12000, payoff: 0, createdAt: "x", updatedAt: "x" },
      ],
      settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", taxRate: 14, docFee: 699,
        defaultApr: 7.9, defaultTerm: 72, cloudAutoSync: false,
        // Signed-in cloud + function URL are what let links be shortened.
        agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" },
    }));
  });

  await p.goto(APP + "/#/specials");
  await p.waitForSelector('[data-act="seed"], .card');
  await p.$eval('[data-act="seed"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(300);

  await p.goto(APP + "/#/campaign");
  await p.waitForSelector("#cm-seg");
  const segs = await p.$$eval("#cm-seg option", (o) => o.map((x) => x.textContent.trim()));
  console.log("segments:", segs.join(" · "));

  await p.$eval('[data-act="build"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(500);
  const cards = await p.$$eval(".cm-list > .card", (list) => list.map((c) => ({
    title: c.querySelector(".row-title").textContent.trim(),
    pitch: c.querySelector(".row-sub").textContent.replace(/\s+/g, " ").trim(),
    body: c.querySelector(".small.muted").textContent.trim(),
    href: c.querySelector('[data-act="send"]').getAttribute("href"),
  })));
  console.log(`\n${cards.length} drafted:`);
  cards.forEach((c) => console.log(`  ${c.pitch}\n    ${c.body.replace(/\n+/g, " ⏎ ").slice(0, 150)}`));

  if (!cards.length) throw new Error("FAIL: campaign built nothing");
  // Someone with no phone can't be texted, so they must not be in the batch.
  if (cards.some((c) => /No Phone/.test(c.title))) throw new Error("FAIL: unreachable customer in the batch");
  // Every row must name a real replacement vehicle.
  cards.forEach((c) => {
    if (!/→/.test(c.pitch)) throw new Error("FAIL: row has no pitch vehicle: " + c.pitch);
  });
  // THE RULE: no pricing in the outgoing text.
  cards.forEach((c) => {
    if (/\$[\d,]/.test(c.body)) throw new Error("FAIL: a price reached the customer text: " + c.body);
    if (/\{\w+\}/.test(c.body)) throw new Error("FAIL: unresolved placeholder: " + c.body);
    if (!/^sms:/.test(c.href || "")) throw new Error("FAIL: send button is not an sms link");
    // Nor may it promise one. "Want me to send you the number?" is a text the
    // desk rule will never let us send — the ask has to be the appointment.
    if (/send (you )?(the |a )?(number|figure|quote|payment)|text (you )?the (number|figure)/i.test(c.body))
      throw new Error("FAIL: text promises to send a figure: " + c.body);
  });

  // Prepare mints a personal link per row.
  await p.$eval('[data-act="prep"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(1200);
  const withLinks = await p.$$eval(".cm-list > .card", (list) => list.map((c) => ({
    body: c.querySelector(".small.muted").textContent.trim(),
    href: c.querySelector('[data-act="send"]').getAttribute("href"),
  })));
  const linked = withLinks.filter((c) => /compare\.html\?l=/.test(c.body));
  console.log(`\nlinks minted: ${linked.length}/${withLinks.length}`);
  if (linked.length !== withLinks.length) throw new Error("FAIL: not every row got an invite link");
  withLinks.forEach((c) => {
    if (/\$[\d,]/.test(c.body)) throw new Error("FAIL: price appeared once linked: " + c.body);
  });

  // The invite page itself must carry the comparison and no pricing.
  const stub = await (await fetch(APP + "/__links")).json();
  const invite = stub.find((l) => l.kind === "invite");
  if (!invite) throw new Error("FAIL: no invite link stored");
  const payload = invite.payload;
  console.log("\ninvite headline:", payload.h);
  console.log("invite note    :", String(payload.m).slice(0, 90) + "…");
  console.log("invite columns :", payload.v.map((v) => v.name).join(" vs "));
  const flat = JSON.stringify(payload);
  if (/\$[\d,]{3,}/.test(flat)) throw new Error("FAIL: pricing found in the invite payload");
  if (/payment|apr|monthly|lease cash|msrp/i.test(JSON.stringify(payload.r)))
    throw new Error("FAIL: a money row is in the comparison table");
  // A same-model repeat shows one column (comparing a Rogue with a Rogue is
  // noise); anything else must be a real side-by-side.
  const same = /vs/.test(payload.v.map((v) => v.name).join(" vs ")) === false;
  if (payload.v.length < 2 && !same) throw new Error("FAIL: invite should compare their car with the pick");
  if (payload.r.some((l) => /price|msrp|payment|apr|cash/i.test(l)))
    throw new Error("FAIL: a money row survived: " + payload.r.join(", "));
  if (!payload.h || !/picked/i.test(payload.h)) throw new Error("FAIL: invite is not personalised");

  // Sending stamps the customer so the 3-week guard and cadence can see it.
  await p.$eval('.cm-list > .card [data-act="send"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(300);
  const stamped = await p.evaluate(async () => {
    const store = await import("./js/store.js");
    return store.all("leads").filter((l) => l.lastCampaignAt).map((l) => l.name);
  });
  console.log("\nstamped as sent:", stamped.join(", ") || "(none)");
  if (!stamped.length) throw new Error("FAIL: sending did not stamp the customer");

  // Rebuilding must now skip the person just contacted.
  await p.$eval('[data-act="build"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(400);
  const after = await p.$$eval(".cm-list > .card .row-title", (n) => n.map((x) => x.textContent.trim()));
  console.log("after rebuild:", after.join(", ") || "(empty)");
  if (after.some((n) => stamped.includes(n))) throw new Error("FAIL: a just-texted customer came back in the batch");

  if (errs.length) throw new Error("FAIL: page errors — " + errs.join(" | "));
  console.log("\nCAMPAIGN PASS");
  await b.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
