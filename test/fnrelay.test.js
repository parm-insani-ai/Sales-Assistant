// The cloud function itself, run under Deno against a stand-in database and
// a stand-in model: who may spend the model, the daily budget, the request
// size cap, the output cap, and the night read split into one run per rep.
//
// Needs Deno. Set DENO_BIN to its path, or have `deno` on the PATH; without
// it the test says so and skips. (npm i deno puts one in node_modules/.bin.)
const http = require("http");
const { spawn, execFileSync } = require("child_process");
const path = require("path");

const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const DENO = process.env.DENO_BIN || "deno";
try { execFileSync(DENO, ["--version"], { stdio: "ignore" }); }
catch { console.log("fnrelay.test.js skipped — no Deno (set DENO_BIN)"); process.exit(0); }

const FN = path.join(__dirname, "..", "supabase", "functions", "voice-agent", "index.ts");
const MOCK = 8150;
const U1 = "00000000-0000-4000-8000-0000000000a1"; // listed by email
const U2 = "00000000-0000-4000-8000-0000000000b2"; // a stranger who made an account
const U3 = "00000000-0000-4000-8000-0000000000c3"; // in a store, not listed
const USERS = { "tok-a": { id: U1, email: "Rep@Example.com" }, "tok-b": { id: U2, email: "stranger@example.com" }, "tok-c": { id: U3, email: "member@example.com" } };
const SERVICE = "service-key-for-tests";

// --- The stand-in: Supabase auth, the REST tables, and the model.
const db = { records: [], usage: [], members: [{ user_id: U3 }], noUsageTable: false };
const model = { calls: [] };
const eqs = (u) => { const f = {}; for (const [k, v] of u.searchParams) if (/^eq\./.test(v)) f[k] = decodeURIComponent(v.slice(3)); return f; };
const match = (row, f) => Object.entries(f).every(([k, v]) => String(row[k]) === v);
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const body = b ? JSON.parse(b) : null;
    if (u.pathname === "/auth/v1/user") {
      const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      return USERS[tok] ? send(res, 200, USERS[tok]) : send(res, 401, { msg: "bad jwt" });
    }
    if (u.pathname === "/rest/v1/store_members") return send(res, 200, db.members.filter((m) => match(m, eqs(u))).slice(0, 1));
    if (u.pathname === "/rest/v1/agent_usage") {
      if (db.noUsageTable) return send(res, 404, { code: "PGRST205", message: "no such table" });
      return send(res, 200, db.usage.filter((r) => match(r, eqs(u))));
    }
    if (u.pathname === "/rest/v1/rpc/agent_add_usage") {
      if (db.noUsageTable) return send(res, 404, {});
      const row = db.usage.find((r) => r.user_id === body.p_user && r.day === body.p_day);
      if (row) { row.usd += body.p_usd; row.calls++; } else db.usage.push({ user_id: body.p_user, day: body.p_day, usd: body.p_usd, calls: 1 });
      return send(res, 200, 0);
    }
    if (u.pathname === "/rest/v1/records") {
      if (req.method === "POST") {
        const i = db.records.findIndex((r) => r.user_id === body.user_id && r.id === body.id);
        if (i >= 0) db.records[i] = body; else db.records.push(body);
        return send(res, 201, {});
      }
      const f = eqs(u); if (f.deleted) f.deleted = f.deleted === "true" ? "true" : "false";
      return send(res, 200, db.records.filter((r) => match({ ...r, deleted: String(!!r.deleted) }, f)).map((r) => ({ id: r.id, user_id: r.user_id, data: r.data })));
    }
    if (u.pathname === "/v1/messages") {
      model.calls.push(body);
      const night = (body.tools || []).some((t) => t.name === "write_plays");
      if (night) {
        const who = /- ([A-Z][a-z]+ [A-Z][a-z]+) —/.exec(body.messages[0].content);
        return send(res, 200, { model: body.model, stop_reason: "tool_use", usage: { input_tokens: 3000, output_tokens: 900 }, content: [{ type: "tool_use", id: "t1", name: "write_plays", input: { summary: "A quiet day.", plays: [{ customer: who ? who[1] : "Nobody", action: "call", title: "Call about the visit", why: "They asked to be called.", draft: "" }] } }] });
      }
      return send(res, 200, { model: body.model, stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0 }, content: [{ type: "text", text: "ok" }] });
    }
    send(res, 404, { error: "mock has no " + u.pathname });
  });
});

// --- Two copies of the function: one locked to a list, one as it ships.
const start = (port, env) => new Promise((resolve, reject) => {
  const p = spawn(DENO, ["run", "--allow-net", "--allow-env", FN], {
    env: { ...process.env, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`, SUPABASE_URL: `http://127.0.0.1:${MOCK}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK}`, SELF_URL: `http://127.0.0.1:${port}`, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; p.stdout.on("data", (d) => (log += d)); p.stderr.on("data", (d) => (log += d));
  const t0 = Date.now();
  const poll = () => fetch(`http://127.0.0.1:${port}/`, { method: "OPTIONS" }).then(() => resolve(p)).catch(() => (Date.now() - t0 > 30000 ? reject(new Error("function didn't start: " + log)) : setTimeout(poll, 200)));
  poll();
});
const post = (port, body, tok) => fetch(`http://127.0.0.1:${port}/`, { method: "POST", headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const turn = (port, tok, extra = {}) => post(port, { system: "brief", tools: [{ name: "x", description: "x", input_schema: { type: "object", properties: {} } }], messages: [{ role: "user", content: "hi" }], ...extra }, tok);

(async () => {
await new Promise((r) => mock.listen(MOCK, "127.0.0.1", r));
const LOCKED = 8151, OPEN = 8152, DEAD = 8159;
const procs = [];
try {
  procs.push(await start(LOCKED, { AGENT_EMAILS: "rep@example.com, someone@else.com" }));
  procs.push(await start(OPEN, { SELF_URL: `http://127.0.0.1:${DEAD}` })); // its per-rep calls go nowhere

  // --- Who may use it.
  const listed = await turn(LOCKED, "tok-a");
  const stranger = await turn(LOCKED, "tok-b");
  const member = await turn(LOCKED, "tok-c");
  const nobody = await turn(LOCKED, "");
  console.log("locked:", listed.status, stranger.status, stranger.body.code, member.status, nobody.status);
  if (listed.status !== 200) fail("a listed account (email case aside) was refused: " + JSON.stringify(listed));
  if (stranger.status !== 403 || stranger.body.code !== "not_allowed" || !/manager/.test(stranger.body.error)) fail("a stranger with an account got through: " + JSON.stringify(stranger));
  if (member.status !== 200) fail("a store member not on the list was refused: " + JSON.stringify(member));
  if (nobody.status !== 401) fail("no session wasn't refused: " + JSON.stringify(nobody));
  const open = await turn(OPEN, "tok-b");
  if (open.status !== 200) fail("with no list set, a signed-in account should still work: " + JSON.stringify(open));

  // --- What each call cost is counted against the person.
  const day = new Date().toISOString().slice(0, 10);
  const mine = db.usage.find((r) => r.user_id === U1 && r.day === day);
  console.log("usage:", JSON.stringify(db.usage));
  // 1000 in at $2, 20000 cache reads at $0.20, 200 out at $10, per million.
  const want = (1000 * 2 + 20000 * 0.2 + 200 * 10) / 1e6;
  if (!mine || Math.abs(mine.usd - want) > 1e-9 || mine.calls !== 1) fail(`the call wasn't counted at ${want}: ` + JSON.stringify(mine));

  // --- The output cap: generous by default, bounded at the top.
  const before = model.calls.length;
  await turn(LOCKED, "tok-a", { max_tokens: 99999 });
  await turn(LOCKED, "tok-a", {});
  const caps = model.calls.slice(before).map((c) => c.max_tokens);
  console.log("caps:", caps.join(","));
  if (caps[0] !== 8192 || caps[1] !== 4096) fail("the output cap isn't 8192 at most and 4096 by default: " + caps.join(","));

  // --- Over the day's budget: refused before the model is called.
  mine.usd = 5.01;
  const n0 = model.calls.length;
  const over = await turn(LOCKED, "tok-a");
  console.log("over budget:", over.status, over.body.error);
  if (over.status !== 429 || over.body.code !== "over_budget" || model.calls.length !== n0) fail("a person over budget still reached the model: " + JSON.stringify(over));
  const other = await turn(LOCKED, "tok-c");
  if (other.status !== 200) fail("one person's budget stopped someone else: " + JSON.stringify(other));
  db.usage.push({ user_id: U2, day, usd: 46, calls: 900 });
  const store = await turn(LOCKED, "tok-c");
  if (store.status !== 429 || !/store/.test(store.body.error)) fail("the store's total didn't stop calls: " + JSON.stringify(store));
  // Without the table, there's nowhere to count: calls go through.
  db.noUsageTable = true;
  const noTable = await turn(LOCKED, "tok-a");
  if (noTable.status !== 200) fail("with no usage table the assistant stopped working: " + JSON.stringify(noTable));
  db.noUsageTable = false; db.usage = [];

  // --- A request bigger than the app sends.
  const big = await turn(LOCKED, "tok-a", { messages: [{ role: "user", content: "x".repeat(320000) }] });
  if (big.status !== 413 || big.body.code !== "too_big") fail("an oversized request wasn't refused: " + big.status);

  // --- The night read: one run per rep, planning the day that's starting.
  const utcH = new Date().getUTCHours();
  const smallTz = (utcH - 2) * 60;   // their clock reads 2am-ish: plan today
  const lateTz = (utcH - 15) * 60;   // their clock reads 3pm-ish: plan tomorrow
  const localDate = (tz, plus) => { const d = new Date(Date.now() - tz * 60000); d.setUTCDate(d.getUTCDate() + plus); return d.toISOString().slice(0, 10); };
  const all7 = [0, 1, 2, 3, 4, 5, 6];
  const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  db.records.push(
    { id: "me", user_id: U1, collection: "prefs", data: { tzOffsetMinutes: smallTz, hoursDays: all7 } },
    { id: "me", user_id: U3, collection: "prefs", data: { tzOffsetMinutes: lateTz, hoursDays: all7 } },
    { id: "l1", user_id: U1, collection: "leads", data: { id: "l1", name: "Ken Boudreau", stage: "working", phone: "9025550001", ...x } },
    { id: "l2", user_id: U3, collection: "leads", data: { id: "l2", name: "Dana Muise", stage: "new", phone: "9025550002", ...x } },
  );
  const m0 = model.calls.length;
  const night = await post(LOCKED, { nightly: 1 });
  console.log("night:", JSON.stringify(night.body));
  const plays = db.records.filter((r) => r.collection === "agentplays");
  console.log("plays:", plays.map((r) => `${r.user_id.slice(-2)} ${r.id} → ${r.data.plays.map((p) => p.customer).join(",")}`).join(" | "));
  if (!night.body.report || !night.body.report.every((r) => r.dispatched)) fail("the store's run didn't hand each rep to their own run: " + JSON.stringify(night.body));
  const p1 = plays.find((r) => r.user_id === U1), p3 = plays.find((r) => r.user_id === U3);
  if (!p1 || p1.id !== `agentplays:${localDate(smallTz, 0)}`) fail(`a run in the small hours didn't plan the day that's starting (${localDate(smallTz, 0)}): ` + (p1 && p1.id));
  if (!p3 || p3.id !== `agentplays:${localDate(lateTz, 1)}`) fail(`a run in the afternoon didn't plan tomorrow (${localDate(lateTz, 1)}): ` + (p3 && p3.id));
  if (p1 && p1.data.plays[0].customer !== "Ken Boudreau") fail("rep one's plays aren't from rep one's book: " + JSON.stringify(p1.data.plays));
  if (model.calls.length - m0 !== 2) fail("expected one model call per rep, got " + (model.calls.length - m0));
  if (!model.calls.slice(m0).every((c) => c.max_tokens === 8192 && c.fallbacks === "default")) fail("the night call's cap or fallback is wrong");

  // Again the same day: nothing new written, nothing spent.
  const m1 = model.calls.length;
  await post(LOCKED, { nightly: 1 });
  if (model.calls.length !== m1) fail("a second night run the same day called the model again");
  // A stranger naming a rep and asking to force it: no key, no force.
  const forced = await post(LOCKED, { nightly: { u: U1, force: true } });
  if (model.calls.length !== m1 || !/already/.test(JSON.stringify(forced.body))) fail("a stranger forced a second read: " + JSON.stringify(forced.body));
  // A stranger can't pose as the store's own per-rep call.
  const posing = await post(LOCKED, { nightly: { u: U1, force: true } }, "tok-a");
  if (model.calls.length !== m1) fail("a signed-in user's token passed for the service key: " + JSON.stringify(posing.body));

  // When the per-rep call can't be made, the rep's read runs in the store's run.
  db.records = db.records.filter((r) => r.collection !== "agentplays");
  const fallback = await post(OPEN, { nightly: 1 });
  console.log("fallback:", JSON.stringify(fallback.body.report));
  if (!fallback.body.report || !fallback.body.report.every((r) => r.plays === 1)) fail("with the per-rep call unreachable, the reads didn't run in place: " + JSON.stringify(fallback.body));
} catch (e) {
  fail(String(e && e.stack || e));
} finally {
  procs.forEach((p) => p.kill());
  mock.close();
}
console.log(process.exitCode ? "\nfnrelay.test.js FAILED" : "\nfnrelay.test.js passed");
})();
