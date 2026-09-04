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

  // The handler doesn't verify req.url alone: this function runs behind a
  // proxy that can present a different scheme or host than the one Twilio
  // signed, and a mismatch drops every text with a silent 403. It tries a
  // small set of reconstructions instead — which must not become a way in.
  // Mirrors the handler's candidate builder. The real-world failure this
  // encodes: Supabase routes /functions/v1/<name> to the function but hands it
  // a path of /<name>, and downgrades the scheme — so what Twilio signed and
  // what arrives differ in two places at once.
  const candidates = (reqUrl, fwdProto, fwdHost) => {
    const out = new Set([reqUrl]);
    try {
      const u = new URL(reqUrl);
      const protos = new Set([u.protocol, "https:"]);
      if (fwdProto) protos.add(`${fwdProto}:`);
      const hosts = new Set([u.host]);
      if (fwdHost) hosts.add(fwdHost);
      const paths = new Set([u.pathname]);
      if (!u.pathname.startsWith("/functions/v1/")) paths.add(`/functions/v1${u.pathname}`);
      for (const proto of protos) for (const host of hosts) for (const path of paths) {
        out.add(`${proto}//${host}${path}${u.search}`);
        out.add(`${proto}//${host}${path}${u.search}`.replace(/:443(?=\/|$)/, ""));
      }
    } catch { /* req.url is all there is */ }
    return [...out];
  };
  const accepts = async (reqUrl, fwdProto, fwdHost, sig, token) => {
    for (const c of candidates(reqUrl, fwdProto, fwdHost)) {
      if (await twilioSigned(c, PROXY_PARAMS, sig, token)) return true;
    }
    return false;
  };
  const PROXY_PARAMS = { From: "+12262467202", To: "+19025002503", Body: "Hello", MessageSid: "SMf98743be2f72cd37bae2d37e5cbb332f" };
  const TOK = "the-auth-token";
  const sign = (u, tok) => crypto.createHmac("sha1", tok)
    .update(Object.keys(PROXY_PARAMS).sort().reduce((s, k) => s + k + PROXY_PARAMS[k], u)).digest("base64");

  // The exact pair observed in production: Twilio signed the public URL, the
  // function saw http:// with /functions/v1 stripped off the front.
  const SIGNED = "https://bgzkafhlwaldbdfehfsa.supabase.co/functions/v1/quick-api?sms=1&u=b413a741-754b-4e1b-9ada-2ef6c21fa79d";
  const SAW = "http://bgzkafhlwaldbdfehfsa.supabase.co/quick-api?sms=1&u=b413a741-754b-4e1b-9ada-2ef6c21fa79d";
  check("the real Supabase rewrite verifies (scheme downgraded AND /functions/v1 stripped)",
    await accepts(SAW, null, null, sign(SIGNED, TOK), TOK));
  check("stripped path alone verifies",
    await accepts(SIGNED.replace("/functions/v1", ""), null, null, sign(SIGNED, TOK), TOK));
  check("scheme downgrade alone verifies",
    await accepts(SIGNED.replace("https:", "http:"), null, null, sign(SIGNED, TOK), TOK));
  check("an untouched URL still verifies", await accepts(SIGNED, null, null, sign(SIGNED, TOK), TOK));
  check("a rewritten host verifies",
    await accepts("http://internal.local/quick-api?sms=1&u=b413a741-754b-4e1b-9ada-2ef6c21fa79d",
      "https", "bgzkafhlwaldbdfehfsa.supabase.co", sign(SIGNED, TOK), TOK));

  // Widening the candidate set must not widen the door.
  check("a forged forwarded-host is still rejected",
    !await accepts(SAW, "https", "evil.example.com",
      sign("https://evil.example.com/functions/v1/quick-api?sms=1&u=b413a741-754b-4e1b-9ada-2ef6c21fa79d", "attacker-token"), TOK));
  check("the wrong token is still rejected across every candidate",
    !await accepts(SAW, null, null, sign(SIGNED, TOK), "other-token"));
  check("a tampered body is still rejected across every candidate",
    !await accepts(SAW, null, null, sign(SIGNED, TOK).slice(0, -2) + "AA", TOK));
  check("a different path is still rejected",
    !await accepts(SAW, null, null, sign(SIGNED.replace("quick-api", "other-fn"), TOK), TOK));
  console.log("  checked: proxy URL reconstruction");

  if (failed) { console.error(`\nTWILIO SIGNATURE FAIL — ${failed} check(s)`); process.exit(1); }
  console.log("\nTWILIO SIGNATURE PASS");
})();
