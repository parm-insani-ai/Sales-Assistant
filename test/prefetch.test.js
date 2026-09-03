// A link preview fired on delivery must not read as the customer engaging —
// but a genuine fast open, or any second open, must still count.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  await p.addInitScript((d) => {
    localStorage.setItem("sales-assistant:v1", JSON.stringify({
      leads: [{ id: "L1", name: "Ann Lee", phone: "9025551111", stage: "working",
        vehicleInterest: "2023 Nissan Rogue", lastCampaignAt: d.sent, createdAt: "x", updatedAt: "x" }],
      links: [
        // Preview: one open, 20s after the text went out.
        { id: "prev", kind: "invite", opens: 1, createdAt: d.made, lastOpenAt: d.plus20, meta: { leadId: "L1", label: "preview" } },
        // Real: one open, 6 minutes after.
        { id: "real", kind: "invite", opens: 1, createdAt: d.made, lastOpenAt: d.plus6m, meta: { leadId: "L1", label: "real" } },
        // Preview then a genuine return visit — must count.
        { id: "back", kind: "invite", opens: 2, createdAt: d.made, lastOpenAt: d.plus20, meta: { leadId: "L1", label: "returned" } },
      ],
      settings: { salesperson: "Parm", cloudAutoSync: false },
    }));
  }, {
    made: iso(now - 30 * 60000),   // link minted half an hour ago
    sent: iso(now - 10 * 60000),   // text went out ten minutes ago
    plus20: iso(now - 10 * 60000 + 20000),      // +20s  → delivery preview
    plus6m: iso(now - 10 * 60000 + 6 * 60000),  // +6min → the customer
  });
  await p.goto("http://127.0.0.1:8137/#/");
  await p.waitForSelector(".plays-slot");
  const r = await p.evaluate(async () => {
    const plays = await import("./js/plays.js");
    const store = await import("./js/store.js");
    const by = (id) => store.all("links").find((l) => l.id === id);
    return {
      preview: plays.isLikelyPrefetch(by("prev")),
      real: plays.isLikelyPrefetch(by("real")),
      returned: plays.isLikelyPrefetch(by("back")),
      hotPlays: plays.getPlays(40).filter((x) => x.kind === "hotlink").map((x) => x.title),
    };
  });
  console.log(JSON.stringify(r, null, 1));
  if (!r.preview) throw new Error("FAIL: delivery preview not filtered");
  if (r.real) throw new Error("FAIL: a genuine open 6 min later was filtered");
  if (r.returned) throw new Error("FAIL: a second open must re-arm the signal");
  if (r.hotPlays.some((t) => /preview/.test(t))) throw new Error("FAIL: preview reached the queue");
  if (!r.hotPlays.some((t) => /real|returned/.test(t))) throw new Error("FAIL: real opens missing from the queue");
  if (errs.length) throw new Error("FAIL: page errors — " + errs.join(" | "));
  console.log("PREFETCH FILTER PASS");
  await b.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
