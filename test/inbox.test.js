// Two-way texting: a reply arrives, the thread shows it, the agent drafts a
// response, and the salesperson sends it. Also the two rules that protect a
// real customer — an opt-out is honoured everywhere, and no figure is ever
// texted out.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const APP = "http://127.0.0.1:8137";

const LEADS = [
  { id: "a", name: "Ann Lee", phone: "9025551111", stage: "delivered", vehicleInterest: "2023 Nissan Rogue",
    currentPayment: 532, payoff: 19455, currentValue: 21500, createdAt: "x", updatedAt: "x" },
  { id: "s", name: "Stu Ross", phone: "9025552222", stage: "delivered", vehicleInterest: "2021 Nissan Kicks",
    payoff: 0, currentValue: 15000, smsOptOut: true, createdAt: "x", updatedAt: "x" },
];
// Ann asks the question every customer asks. Answering it with a number by
// text is exactly what must not happen.
const TEXTS = [
  { id: "t1", leadId: "a", dir: "out", body: "Hi Ann, it's Parm at O'Regan's Nissan. Worth a ten-minute look at where your Rogue sits.",
    at: "2026-09-02T14:00:00.000Z", read: true, status: "sent", createdAt: "x", updatedAt: "x" },
  { id: "t2", leadId: "a", dir: "in", body: "what's my car worth? just ballpark it",
    at: "2026-09-02T14:06:00.000Z", read: false, createdAt: "x", updatedAt: "x" },
];

(async () => {
  await fetch(APP + "/__reset");
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(([leads, texts]) => {
    localStorage.setItem("entoa:auth", JSON.stringify({
      access_token: "test-token", refresh_token: "test-refresh",
      user: { id: "00000000-0000-4000-8000-000000000001", email: "test@example.com" },
    }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({
      leads, texts,
      settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", taxRate: 14, docFee: 699,
        defaultApr: 7.9, defaultTerm: 72, cloudAutoSync: false,
        smsFrom: "+19025550123",
        agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" },
    }));
  }, [LEADS, TEXTS]);

  // --- The unread reply is visible from anywhere in the app ---
  await p.goto(APP + "/#/");
  await p.waitForSelector(".tabbar");
  const dot = await p.$eval('.tab[data-route="/comms"]', (t) => {
    const d = t.querySelector(".tab-dot");
    return d ? d.textContent.trim() : null;
  });
  console.log("unread badge on Comms tab:", dot);
  if (dot !== "1") throw new Error("FAIL: unread reply not badged on the tab, got " + dot);

  // --- Comms leads with the inbox ---
  await p.goto(APP + "/#/comms");
  await p.waitForSelector('[data-goto="/inbox"]');
  const card = await p.$eval('[data-goto="/inbox"]', (c) => c.textContent.replace(/\s+/g, " ").trim());
  console.log("comms inbox card:", card.slice(0, 90));
  if (!/1 new/.test(card)) throw new Error("FAIL: comms card doesn't surface the unread count");
  if (!/Ann/.test(card)) throw new Error("FAIL: comms card doesn't name who's waiting");

  // --- Thread list ---
  await p.goto(APP + "/#/inbox");
  await p.waitForSelector(".card .row");
  const rows = await p.$$eval(".card .row", (list) => list.map((r) => r.textContent.replace(/\s+/g, " ").trim()));
  console.log("threads:", rows.length);
  if (!rows.some((r) => /Ann Lee/.test(r) && /1 new/.test(r))) throw new Error("FAIL: Ann's unread thread is missing");

  // --- Open the thread ---
  await p.goto(APP + "/#/inbox/a");
  await p.waitForSelector(".chat");
  const bubbles = await p.$$eval(".bubble", (list) => list.map((x) => ({
    dir: x.className.includes("bubble-in") ? "in" : "out",
    body: x.querySelector(".bubble-body").textContent.trim(),
  })));
  bubbles.forEach((x) => console.log(`  ${x.dir === "in" ? "them" : "you "}: ${x.body.slice(0, 62)}`));
  if (bubbles.length !== 2) throw new Error("FAIL: expected both messages in the thread");
  if (bubbles[0].dir !== "out" || bubbles[1].dir !== "in") throw new Error("FAIL: thread is out of order");

  // Opening the thread clears the unread flag — otherwise the badge nags forever.
  await p.waitForTimeout(200);
  const stillUnread = await p.evaluate(async () => {
    const store = await import("./js/store.js");
    return store.unreadTexts().length;
  });
  console.log("unread after opening:", stillUnread);
  if (stillUnread !== 0) throw new Error("FAIL: opening the thread didn't mark it read");

  // --- The agent drafts, and the draft must never carry a figure ---
  await p.$eval('[data-act="draft"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForFunction(() => document.querySelector("#ib-text")?.value.length > 0, null, { timeout: 8000 });
  const drafted = await p.$eval("#ib-text", (t) => t.value);
  console.log("\ndrafted:", drafted);
  if (/\$\s?\d|\d+\s?%/.test(drafted)) throw new Error("FAIL: the draft quotes a figure: " + drafted);

  // --- Send it ---
  await p.$eval('[data-act="send"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(700);
  const outbox = await (await fetch(APP + "/__sent")).json();
  console.log("sent to carrier:", outbox.length, "→", (outbox[0] || {}).to);
  if (outbox.length !== 1) throw new Error("FAIL: the message never reached the carrier");
  if (outbox[0].body !== drafted) throw new Error("FAIL: what was sent isn't what was shown");
  if (outbox[0].leadId !== "a") throw new Error("FAIL: sent without the customer attached");
  const after = await p.$$eval(".bubble", (l) => l.length);
  if (after !== 3) throw new Error("FAIL: the sent message isn't in the thread, got " + after);

  // --- A failed send is recoverable, not lost ---
  await fetch(APP + "/__failnext");
  await p.$eval("#ib-text", (t) => { t.value = "One more thing —"; });
  await p.$eval('[data-act="send"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForSelector(".bubble-failed", { timeout: 6000 });
  const failedText = await p.$eval(".bubble-failed .bubble-body", (x) => x.textContent.trim());
  console.log("failed row kept its text:", JSON.stringify(failedText));
  if (failedText !== "One more thing —") throw new Error("FAIL: a failed send lost the message");

  // --- The backstop: a draft that quotes a figure is never handed over ---
  // The model is never told any numbers, so this shouldn't happen — but if it
  // invents one, it must not land in the box where a tired person taps send.
  const LEAKS = [
    "Your Rogue is worth about $21,500 today — want to come in?",
    "I can get you into a new one for around 480 a month.",
    "Rates are down to 3.99% this month, worth a look.",
  ];
  for (const leak of LEAKS) {
    await fetch(APP + "/__draft?t=" + encodeURIComponent(leak));
    await p.goto(APP + "/#/inbox/a");
    await p.waitForSelector('[data-act="draft"]');
    await p.$eval("#ib-text", (t) => { t.value = ""; });
    await p.$eval('[data-act="draft"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await p.waitForTimeout(1200);
    const box = await p.$eval("#ib-text", (t) => t.value);
    console.log(`  blocked: ${JSON.stringify(leak.slice(0, 46))} → box ${box ? "FILLED" : "left empty"}`);
    if (box) throw new Error("FAIL: a draft quoting a figure reached the compose box: " + box);
  }
  await fetch(APP + "/__draft?t=" + encodeURIComponent("Ten minutes in person and I can show you properly. Thursday at 5, or Saturday morning?"));

  // --- Opt-out is honoured in the thread and in campaigns ---
  await p.goto(APP + "/#/inbox/s");
  await p.waitForSelector("#ib-compose");
  const composeDisabled = await p.$eval("#ib-text", (t) => t.disabled);
  const optNote = await p.$eval("#ib-compose", (c) => c.textContent.replace(/\s+/g, " ").trim());
  console.log("\nopted-out compose disabled:", composeDisabled);
  if (!composeDisabled) throw new Error("FAIL: an opted-out customer can still be texted");
  if (!/opted out/i.test(optNote)) throw new Error("FAIL: no reason given for the disabled box");

  const inCampaign = await p.evaluate(async () => {
    const c = await import("./js/views/campaign.js");
    return c.buildCampaign("all", 25).map((r) => r.lead.name);
  });
  console.log("campaign includes:", inCampaign.join(", ") || "(none)");
  if (inCampaign.includes("Stu Ross")) throw new Error("FAIL: an opted-out customer is still in campaigns");

  // --- Campaign sends through the number too, or the loop stays open ---
  // Handing off to the phone's SMS app would send the reply to Parm's personal
  // messages, where the agent can't see it — the exact problem this closes.
  await p.goto(APP + "/#/specials");
  await p.waitForSelector('[data-act="seed"], .card');
  await p.$eval('[data-act="seed"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(300);
  await p.goto(APP + "/#/campaign");
  await p.waitForSelector('[data-act="build"]');
  await p.$eval('[data-act="build"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(500);
  const isButton = await p.$eval('.cm-list > .card [data-act="send"]', (x) => x.tagName);
  console.log("campaign send control:", isButton);
  if (isButton !== "BUTTON") throw new Error("FAIL: campaign still hands off to the SMS app despite a texting number");
  const before = (await (await fetch(APP + "/__sent")).json()).length;
  await p.$eval('.cm-list > .card [data-act="send"]', (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(900);
  const outbox2 = await (await fetch(APP + "/__sent")).json();
  console.log("campaign texts sent in-app:", outbox2.length - before);
  if (outbox2.length !== before + 1) throw new Error("FAIL: campaign send didn't go through the number");
  const camp = outbox2[outbox2.length - 1];
  if (/\$[\d,]/.test(camp.body)) throw new Error("FAIL: a price went out on the campaign text: " + camp.body);

  if (errs.length) throw new Error("FAIL: page errors — " + errs.join(" | "));
  console.log("\nINBOX PASS");
  await b.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
