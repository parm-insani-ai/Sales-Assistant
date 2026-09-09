// "I have to fill in all my information again."
//
// Reinstalling the app on iOS clears its storage. Every customer, text and
// appointment came back from the cloud untouched — and every setting was gone:
// dealership, tax rate, doc fee, the new-vehicle fees, the trade knobs, the
// default term and rate, the monthly goals, the message templates, the texting
// number, the agent URL. The one category that is expensive to re-enter by hand
// was the only category with no copy anywhere.
//
// The store said so out loud: settings were "deliberately not synced — they're
// full of this phone's own configuration". Almost none of it describes a phone.
// It describes a salesperson.
//
// And underneath that, a worse one: the Supabase URL and anon key were IN those
// settings. So a wiped install didn't just lose its configuration, it lost the
// credentials it needed to reach the backup — the data was safe in the cloud and
// the app could no longer go and get it. No amount of syncing fixes that, since
// the credentials are what sync runs on.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.goto(APP + "/#/");
await p.waitForTimeout(500);

// The settings a salesperson actually types in, and would hate to type twice.
const TYPED = {
  salesperson: "Parm", dealership: "O'Regan's Nissan Halifax",
  contactPhone: "9025550199", contactEmail: "parm@example.com",
  taxRate: 15, docFee: 799, feeFreight: 2250, avpRogue: 749,
  tradeKmPerYear: 24000, tradeRecon: 1800, tradeMarginPct: 11,
  defaultTerm: 84, defaultApr: 6.49,
  goalUnits: 16, goalCommission: 11000,
  smsFrom: "+19025550123", agentUrl: "https://example.supabase.co/functions/v1/quick-api",
  reviewLink: "https://g.page/r/example",
};

// --- What gets mirrored to the cloud.
const mirrored = await p.evaluate(async (typed) => {
  const store = await import("/js/store.js");
  store.updateSettings(typed);
  const rec = store.get("config", "me");
  return { rec, synced: store.SYNC_COLLECTIONS.includes("config") };
}, TYPED);
console.log("settings mirrored:", mirrored.rec ? Object.keys(mirrored.rec).length + " keys" : "NOTHING");
if (!mirrored.synced) fail("the settings mirror isn't in SYNC_COLLECTIONS — it never leaves the device");
if (!mirrored.rec) fail("changing settings didn't write a backup record");
else {
  for (const [k, v] of Object.entries(TYPED)) {
    if (JSON.stringify(mirrored.rec[k]) !== JSON.stringify(v)) fail(`${k} isn't in the backup (got ${JSON.stringify(mirrored.rec[k])})`);
  }
  // The credentials must NOT ride along: a stale copy landing on a working
  // device would cut it off from the account that sent it.
  if ("supabaseUrl" in mirrored.rec || "supabaseAnonKey" in mirrored.rec)
    fail("the backend credentials are being synced — a stale copy can orphan a device");
}

// --- A wiped install: keep what the cloud holds, throw away everything local,
// and see what comes back.
const backup = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  return JSON.parse(JSON.stringify(store.get("config", "me")));
});

const p2 = await ctx.newPage();
await p2.addInitScript((rec) => {
  localStorage.clear();                       // exactly what deleting the PWA does
  window.__cloudConfig = rec;                 // what the server still holds
}, backup);
await p2.goto(APP + "/#/");
await p2.waitForTimeout(600);

const gone = await p2.evaluate(async () => {
  const store = await import("/js/store.js");
  return { dealership: store.getSettings().dealership, docFee: store.getSettings().docFee };
});
console.log("\nafter the wipe:", JSON.stringify(gone));
if (gone.dealership) fail("the wipe didn't actually clear anything — the test proves nothing");

// Sync pulls the record down; adoptRemoteConfig folds it back into settings.
const restored = await p2.evaluate(async () => {
  const store = await import("/js/store.js");
  store.applyRemote("config", "me", window.__cloudConfig);
  const changed = store.adoptRemoteConfig();
  return { changed, settings: store.getSettings() };
});
console.log("restored:", restored.changed ? "yes" : "NO");
if (!restored.changed) fail("pulling the backup down changed nothing");
for (const [k, v] of Object.entries(TYPED)) {
  if (JSON.stringify(restored.settings[k]) !== JSON.stringify(v))
    fail(`${k} didn't come back: ${JSON.stringify(restored.settings[k])} (wanted ${JSON.stringify(v)})`);
}
console.log("  dealership:", restored.settings.dealership, "| docFee:", restored.settings.docFee,
  "| goals:", restored.settings.goalUnits, "| agent:", restored.settings.agentUrl ? "set" : "MISSING");

// Templates and the delivery checklist are lists, and losing a customised one
// is the same loss as losing a number.
if (!Array.isArray(restored.settings.messageTemplates) || !restored.settings.messageTemplates.length)
  fail("the message templates didn't survive");
if (!Array.isArray(restored.settings.deliveryChecklist) || !restored.settings.deliveryChecklist.length)
  fail("the delivery checklist didn't survive");

// --- Adopting is a merge, not a replace: a setting this build knows about that
// the backup predates must not be wiped out by restoring.
{
  const kept = await p2.evaluate(async () => {
    const store = await import("/js/store.js");
    store.updateSettings({ brandNewSetting: "keep me", supabaseUrl: "https://this-device.supabase.co" });
    store.applyRemote("config", "me", window.__cloudConfig);
    store.adoptRemoteConfig();
    const s = store.getSettings();
    return { brandNewSetting: s.brandNewSetting, supabaseUrl: s.supabaseUrl };
  });
  console.log("\nmerge, not replace:", JSON.stringify(kept));
  if (kept.brandNewSetting !== "keep me") fail("restoring wiped a setting the backup didn't know about");
  if (kept.supabaseUrl !== "https://this-device.supabase.co")
    fail("restoring overwrote this device's own backend credentials");
}

// --- And the lockout itself: with nothing in settings, the app still has to
// know where the account lives, or a reinstall can never reach the backup.
{
  const boot = await p2.evaluate(async () => {
    const cfgMod = await import("/js/config.js");
    const store = await import("/js/store.js");
    store.updateSettings({ supabaseUrl: "", supabaseAnonKey: "" });
    const backend = await import("/js/backend.js");
    return { defaults: cfgMod.BACKEND_DEFAULTS, configured: backend.isConfigured() };
  });
  console.log("\nbuild-time backend defaults:", JSON.stringify(boot.defaults), "→ configured:", boot.configured);
  if (typeof boot.defaults?.url !== "string" || typeof boot.defaults?.anonKey !== "string")
    fail("there's no build-time backend default — a wiped install can't find the account");
  // Filled in, a bare install reaches the account with nothing typed.
  const withDefaults = await p2.evaluate(async () => {
    const cfgMod = await import("/js/config.js");
    cfgMod.BACKEND_DEFAULTS.url = "https://example.supabase.co";
    cfgMod.BACKEND_DEFAULTS.anonKey = "anon-key";
    const backend = await import("/js/backend.js");
    return backend.isConfigured();
  });
  if (!withDefaults) fail("build-time defaults are ignored — settings are still the only source");
  console.log("  with them filled in, a bare install is configured:", withDefaults);
  if (!boot.defaults.url || !boot.defaults.anonKey)
    console.log("  NOTE: shipped empty — fill js/config.js in to make reinstalls self-healing.");
}

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nrestore.test.js FAILED" : "\nrestore.test.js passed");
})();
