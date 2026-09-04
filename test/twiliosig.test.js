// The inbound text webhook is a public URL — the function runs with "Verify
// JWT" off, because Twilio can't send a Supabase token. The Twilio signature is
// therefore the only thing standing between a stranger and writing messages
// into a salesperson's inbox. If this check is ever weakened, that door opens
// silently, so the test reads the real source rather than a copy of it.
const crypto = require("node:crypto");
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "../supabase/functions/voice-agent/index.ts");
const src = fs.readFileSync(SRC, "utf8");

// Pull twilioSigned out of the Deno module and run it here. Deno and node share
// Web Crypto, so the function is portable as long as it stays self-contained —
// which the extraction below also enforces.
const m = src.match(/async function twilioSigned\([\s\S]*?\n\}/);
if (!m) throw new Error("FAIL: twilioSigned not found in the function source — did it get renamed?");
const body = m[0].replace(/: (string|boolean|Record<string, string>|Promise<boolean>)/g, "");
const twilioSigned = eval(`(${body.replace(/^async function twilioSigned/, "async function")})`);

// Twilio's documented algorithm: the full URL, then every POST parameter
// appended in sorted key order, HMAC-SHA1 with the auth token, base64.
const ref = (url, params, token) =>
  crypto.createHmac("sha1", token)
    .update(Object.keys(params).sort().reduce((s, k) => s + k + params[k], url))
    .digest("base64");

const HOOK = "https://bgzkafhlwaldbdfehfsa.supabase.co/functions/v1/voice-agent?sms=1&u=00000000-0000-4000-8000-000000000001";
const CASES = [
  ["Twilio's own example shape", "https://mycompany.com/myapp.php?foo=1&bar=2",
    { Digits: "1234", To: "+18005551212", From: "+14158675310", Caller: "+14158675310", CallSid: "CA1234567890ABCDE" }, "12345"],
  ["a real inbound reply", HOOK,
    { From: "+19025551111", To: "+19025550123", Body: "whats it worth?", MessageSid: "SM123" }, "sekrit-auth-token"],
  ["accents and emoji in the body", "https://x.test/hook?sms=1",
    { From: "+19025551111", Body: "Arrêt — 100% sûr? 🙂" }, "tok"],
  ["an opt-out", HOOK, { From: "+19025551111", Body: "STOP", MessageSid: "SM9" }, "tok"],
];

(async () => {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { failed++; console.log("  FAIL: " + label); } };

  for (const [label, url, params, token] of CASES) {
    const good = ref(url, params, token);
    check(`${label}: a genuine signature is accepted`, await twilioSigned(url, params, good, token));
    check(`${label}: an edited body is rejected`,
      !await twilioSigned(url, { ...params, Body: String(params.Body || "") + "!" }, good, token));
    check(`${label}: an added parameter is rejected`,
      !await twilioSigned(url, { ...params, Injected: "x" }, good, token));
    check(`${label}: another account's token is rejected`, !await twilioSigned(url, params, good, "other-token"));
    check(`${label}: a different URL is rejected`, !await twilioSigned(url + "&evil=1", params, good, token));
    console.log(`  checked: ${label}`);
  }

  // Missing credentials must fail closed. An unconfigured server that accepted
  // everything would be the worst possible default.
  const url = HOOK, params = { From: "+19025551111", Body: "hi" };
  check("no signature header is rejected", !await twilioSigned(url, params, "", "tok"));
  check("no auth token configured is rejected", !await twilioSigned(url, params, ref(url, params, "tok"), ""));
  check("a garbage signature is rejected", !await twilioSigned(url, params, "not-base64-at-all", "tok"));

  // The comparison must not leak where the mismatch is.
  const real = ref(url, params, "tok");
  const flipped = real.slice(0, -1) + (real.slice(-1) === "A" ? "B" : "A");
  check("a signature differing in one byte is rejected", !await twilioSigned(url, params, flipped, "tok"));
  check("a truncated signature is rejected", !await twilioSigned(url, params, real.slice(0, -1), "tok"));

  if (failed) { console.error(`\nTWILIO SIGNATURE FAIL — ${failed} check(s)`); process.exit(1); }
  console.log("\nTWILIO SIGNATURE PASS");
})();
