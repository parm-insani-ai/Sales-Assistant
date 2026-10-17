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
const db = { records: [], usage: [], stores: [{ id: "s1", name: "O'Regan's Nissan Halifax" }], members: [{ user_id: U3, store_id: "s1", role: "manager", name: "Sam", email: "member@example.com" }, { user_id: U1, store_id: "s1", role: "rep", name: "Parm", email: "rep@example.com" }], noUsageTable: false };
const twilio = { sent: [] }, push = { got: [] };
db.config = []; // store_config rows: { store_id, data }
db.targets = []; // store_targets rows
db.pool = []; // store_customers rows
// VAPID keys and a subscription key pair, so the function's pushes go to this mock.
const crypto = require("crypto");
const ecPair = () => { const kp = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }); const pub = kp.publicKey.export({ format: "jwk" }), priv = kp.privateKey.export({ format: "jwk" }); return { pub: Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]).toString("base64url"), priv: Buffer.from(priv.d, "base64url").toString("base64url") }; };
const VAPID = ecPair(), SUBKEY = ecPair();
const model = { calls: [] };
const eqs = (u) => { const f = {}; for (const [k, v] of u.searchParams) if (/^eq\./.test(v)) f[k] = decodeURIComponent(v.slice(3)); return f; };
const match = (row, f) => Object.entries(f).every(([k, v]) => String(row[k]) === v);
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    let body = null; try { body = b ? JSON.parse(b) : null; } catch { body = null; } // Twilio posts a form
    if (u.pathname === "/auth/v1/user") {
      const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      return USERS[tok] ? send(res, 200, USERS[tok]) : send(res, 401, { msg: "bad jwt" });
    }
    if (u.pathname === "/rest/v1/store_members") return send(res, 200, db.members.filter((m) => match(m, eqs(u))));
    if (u.pathname === "/rest/v1/stores") return send(res, 200, db.stores.filter((m) => match(m, eqs(u))));
    if (u.pathname === "/rest/v1/store_config") {
      if (req.method === "POST") { const i = db.config.findIndex((c) => c.store_id === body.store_id); if (i >= 0) db.config[i].data = body.data; else db.config.push(body); return send(res, 201, {}); }
      return send(res, 200, db.config.filter((m) => match(m, eqs(u))));
    }
    if (u.pathname === "/rest/v1/store_targets") {
      if (req.method === "POST") { for (const t of (Array.isArray(body) ? body : [body])) { const i = db.targets.findIndex((x) => x.store_id === t.store_id && x.user_id === t.user_id && x.month === t.month); if (i >= 0) db.targets[i] = t; else db.targets.push(t); } return send(res, 201, {}); }
      return send(res, 200, db.targets.filter((m) => match(m, eqs(u))));
    }
    if (u.pathname === "/rest/v1/store_customers") {
      const f = eqs(u); if (f.deleted) f.deleted = f.deleted === "true" ? "true" : "false";
      if (req.method === "PATCH") { db.pool.filter((c) => match({ ...c, deleted: String(!!c.deleted) }, f)).forEach((c) => Object.assign(c, body)); return send(res, 204, {}); }
      return send(res, 200, db.pool.filter((c) => match({ ...c, deleted: String(!!c.deleted) }, f)).map((c) => ({ id: c.id, data: c.data, status: c.status })));
    }
    if (u.pathname === "/rest/v1/admins") return send(res, 200, []);
    if (/^\/2010-04-01\/Accounts\/[^/]+\/Messages\.json$/.test(u.pathname)) { twilio.sent.push(Object.fromEntries(new URLSearchParams(b))); return send(res, 201, { sid: "SM" + twilio.sent.length }); }
    if (u.pathname.startsWith("/push/")) { push.got.push(u.pathname); res.writeHead(201); return res.end(); }
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
      // data->>field filters, as PostgREST reads them.
      const inData = Object.entries(f).filter(([k]) => k.startsWith("data->>")); for (const [k] of inData) delete f[k];
      const lim = Number(u.searchParams.get("limit") || 0);
      let rows = db.records.filter((r) => match({ ...r, deleted: String(!!r.deleted) }, f) && inData.every(([k, v]) => String((r.data || {})[k.slice(7)]) === v));
      if (lim > 0) rows = rows.slice(0, lim);
      return send(res, 200, rows.map((r) => ({ id: r.id, user_id: r.user_id, data: r.data })));
    }
    if (u.pathname === "/v1/messages") {
      model.calls.push(body);
      const night = (body.tools || []).some((t) => t.name === "write_plays");
      if (night) {
        const who = /- ([A-Z][a-z]+ [A-Z][a-z]+) —/.exec(body.messages[0].content);
        return send(res, 200, { model: body.model, stop_reason: "tool_use", usage: { input_tokens: 3000, output_tokens: 900 }, content: [{ type: "tool_use", id: "t1", name: "write_plays", input: { summary: "A quiet day.", plays: [{ customer: who ? who[1] : "Nobody", action: "call", title: "Call about the visit", why: "They asked to be called.", draft: "" }] } }] });
      }
      // The manager's reply draft: a figure for a customer called Money, a proper reply otherwise.
      const sys = Array.isArray(body.system) ? body.system.map((b) => b.text || "").join(" ") : String(body.system || "");
      if (/drafting ONE text message from/.test(sys)) {
        const asked = String((body.messages[0] || {}).content || "");
        const text = /Money/.test(asked) ? "It'd be about $300 a month, come by." : "Hi Dana, Sam here, the sales manager — Saturday works. Come by any time after ten and ask for Parm.";
        return send(res, 200, { model: body.model, stop_reason: "end_turn", usage: { input_tokens: 800, output_tokens: 60 }, content: [{ type: "text", text }] });
      }
      return send(res, 200, { model: body.model, stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0 }, content: [{ type: "text", text: "ok" }] });
    }
    send(res, 404, { error: "mock has no " + u.pathname });
  });
});

// --- Two copies of the function: one locked to a list, one as it ships.
const start = async (port, env) => {
  // A function left running by an earlier crashed run would answer in this
  // one's place, with last time's code. Refuse to start on a busy port.
  const busy = await fetch(`http://127.0.0.1:${port}/`, { method: "OPTIONS" }).then(() => true).catch(() => false);
  if (busy) throw new Error(`port ${port} is already in use — kill the stray function process (pkill -f "deno run")`);
  return new Promise((resolve, reject) => {
  // --allow-sys: web-push reads the system's certificate store to push.
  const p = spawn(DENO, ["run", "--allow-net", "--allow-env", "--allow-sys", FN], {
    env: { ...process.env, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`, SUPABASE_URL: `http://127.0.0.1:${MOCK}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK}`, SELF_URL: `http://127.0.0.1:${port}`,
      TWILIO_ACCOUNT_SID: "AC" + "0".repeat(32), TWILIO_AUTH_TOKEN: "0".repeat(32), TWILIO_FROM: "+15550001111", TWILIO_API_URL: `http://127.0.0.1:${MOCK}`, VAPID_PUBLIC_KEY: VAPID.pub, VAPID_PRIVATE_KEY: VAPID.priv, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; p.stdout.on("data", (d) => (log += d)); p.stderr.on("data", (d) => (log += d));
  p.getLog = () => log;
  const t0 = Date.now();
  const poll = () => fetch(`http://127.0.0.1:${port}/`, { method: "OPTIONS" }).then(() => resolve(p)).catch(() => (Date.now() - t0 > 30000 ? reject(new Error("function didn't start: " + log)) : setTimeout(poll, 200)));
  poll();
  });
};
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

  // --- The manager's text to a rep's customer: from the store's number,
  // filed in the rep's thread, the customer's waiting texts marked read.
  db.records.push(
    { id: "c1", user_id: U1, collection: "leads", data: { id: "c1", name: "Dana Muise", phone: "9025551111", stage: "working" } },
    { id: "in1", user_id: U1, collection: "texts", data: { id: "in1", leadId: "c1", dir: "in", body: "Can I come Saturday?", at: new Date(Date.now() - 20 * 60000).toISOString(), read: false } },
  );
  const mt = (tok, body) => post(LOCKED, { mtext: { rep: U1, leadId: "c1", body } }, tok);
  const stranger2 = await mt("tok-b", "Hi Dana");
  const money = await mt("tok-c", "Hi Dana, it's $300 a month");
  const sent = await mt("tok-c", "Hi Dana, Saturday works — ask for Parm.");
  console.log("mtext:", stranger2.status, money.status, sent.status, JSON.stringify(sent.body));
  if (stranger2.status !== 403) fail("a stranger texted a rep's customer: " + JSON.stringify(stranger2));
  if (money.status !== 400 || !/figures/.test(money.body.error)) fail("a text with a dollar amount in it wasn't refused: " + JSON.stringify(money));
  if (sent.status !== 200 || !sent.body.sent) fail("the manager's text didn't send: " + JSON.stringify(sent));
  const filed = db.records.find((r) => r.user_id === U1 && r.collection === "texts" && r.data.via === "manager");
  const inbound = db.records.find((r) => r.id === "in1");
  if (twilio.sent.length !== 1 || twilio.sent[0].To !== "9025551111" || !/Saturday works/.test(twilio.sent[0].Body)) fail("the text didn't go to Dana through Twilio: " + JSON.stringify(twilio.sent));
  if (!filed || filed.data.leadId !== "c1" || filed.data.dir !== "out" || filed.data.by !== "Sam") fail("the manager's text isn't filed in the rep's thread as the manager's: " + JSON.stringify(filed));
  if (!inbound.data.read) fail("Dana's waiting text wasn't marked read after the manager answered it");

  // --- The managers' sweep: the floor's problems, pushed to the manager, each once.
  db.records.push(
    { id: "push1", user_id: U3, collection: "push", data: { id: "push1", sub: { endpoint: `http://127.0.0.1:${MOCK}/push/u3`, keys: { p256dh: SUBKEY.pub, auth: crypto.randomBytes(16).toString("base64url") } } } },
    { id: "c2", user_id: U1, collection: "leads", data: { id: "c2", name: "Fresh Lead", phone: "9025552222", stage: "new", createdAt: new Date(Date.now() - 45 * 60000).toISOString() } },
    { id: "c3", user_id: U1, collection: "leads", data: { id: "c3", name: "Ken Boudreau", phone: "9025553333", stage: "appointment" } },
    { id: "in2", user_id: U1, collection: "texts", data: { id: "in2", leadId: "c3", dir: "in", body: "Running late", at: new Date(Date.now() - 25 * 60000).toISOString(), read: false } },
    { id: "ap1", user_id: U1, collection: "appointments", data: { id: "ap1", leadId: "c3", customerName: "Ken Boudreau", when: new Date(Date.now() + 60 * 60000).toISOString().slice(0, 16), status: "scheduled", confirmed: false } },
    // A welcome text drafted on Parm's phone two hours ago and not sent.
    { id: "tt1", user_id: U1, collection: "tasks", data: { id: "tt1", leadId: "c2", cadence: true, channel: "text", intent: "intro", title: "Text Fresh — Welcome text", readyAt: new Date(Date.now() - 120 * 60000).toISOString(), done: false } },
  );
  // The manager's clock: UTC, open all day, no quiet hours (the night-read
  // section above gave this row an afternoon zone).
  const mePrefs = db.records.find((r) => r.user_id === U3 && r.collection === "prefs");
  mePrefs.data = { tzOffsetMinutes: 0, hoursFrom: 0, hoursTo: 24, hoursDays: [0, 1, 2, 3, 4, 5, 6], quietFrom: 0, quietTo: 0 };
  const sweep = await post(LOCKED, { sweep: 1 });
  console.log("sweep:", JSON.stringify(sweep.body.managers));
  const mg = (sweep.body.managers || []).find((m) => m.manager === U3.slice(0, 8)) || {};
  // What the sweep decided to send is the check; the push itself goes
  // through web-push, which speaks TLS to the push service and so can't
  // reach this plain mock (that path is exercised by the reps' sweep in
  // production every ten minutes).
  const kinds = (mg.sent || []).map((k) => k.split(":")[1]).sort().join(",");
  if (mg.candidates !== 4 || kinds !== "confirm,lead,reply,texts") { fail("the manager wasn't sent the three things on the floor: " + JSON.stringify(mg)); console.log("function log:\n" + procs[0].getLog().slice(-1500)); }
  const again = await post(LOCKED, { sweep: 1 });
  const mg2 = (again.body.managers || []).find((m) => m.manager === U3.slice(0, 8)) || {};
  if ((mg2.sent || []).length !== 0) fail("the same three were sent again on the next sweep: " + JSON.stringify(mg2));

  // --- The store's agent. Hours set to 0 so everything is due now; the
  // rep's and the manager's clocks are UTC, open all week.
  // The store's plan: 80 units, Parm carrying 20; the review day is today
  // so the reviewer and the be-back list run in this pass.
  db.config.push({ store_id: "s1", data: { welcome: { manager: "Sam" }, agent: { confirmHour: 0, noShowHour: 0, huddleHour: 0, recapHour: 0, handoutN: 2 }, plan: { targetNew: 50, targetUsed: 30, alloc: { [U1]: 20 }, reviewDow: new Date().getUTCDay() } } });
  const dayN = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
  db.records.push(
    // Tomorrow, unconfirmed: the agent confirms it. Yesterday's no-show: a text and a rebook.
    { id: "c4", user_id: U1, collection: "leads", data: { id: "c4", name: "Tam Tomorrow", phone: "9025554444", stage: "appointment" } },
    { id: "ap2", user_id: U1, collection: "appointments", data: { id: "ap2", leadId: "c4", customerName: "Tam Tomorrow", type: "test drive", when: dayN(1) + "T14:30", status: "scheduled", confirmed: false } },
    { id: "c5", user_id: U1, collection: "leads", data: { id: "c5", name: "Nick Noshow", phone: "9025555555", stage: "working" } },
    { id: "ap3", user_id: U1, collection: "appointments", data: { id: "ap3", leadId: "c5", customerName: "Nick Noshow", when: dayN(-1) + "T10:00", status: "scheduled", outcome: "no_show" } },
    // The owner book: a lease ending, equity, one with nothing going on, one in service today.
    { id: "o1", user_id: U1, collection: "leads", data: { id: "o1", name: "Lee Lease", phone: "9025556001", stage: "delivered", leaseEnd: dayN(60), purchaseDate: "2023-01-01" } },
    { id: "o2", user_id: U1, collection: "leads", data: { id: "o2", name: "Eve Equity", phone: "9025556002", stage: "delivered", currentValue: 21000, payoff: 12000, purchaseDate: "2024-01-01" } },
    { id: "o3", user_id: U1, collection: "leads", data: { id: "o3", name: "Quiet Owner", phone: "9025556003", stage: "delivered", purchaseDate: "2025-06-01" } },
    { id: "o4", user_id: U1, collection: "leads", data: { id: "o4", name: "Sue Service", phone: "9025556004", stage: "delivered", serviceAppt: dayN(0) + "T10:30", purchaseDate: "2020-01-01" } },
    // Waiting on a reply: the agent drafts one for the manager; a figure is refused.
    { id: "c6", user_id: U1, collection: "leads", data: { id: "c6", name: "Money Mike", phone: "9025556006", stage: "working" } },
    { id: "in3", user_id: U1, collection: "texts", data: { id: "in3", leadId: "c6", dir: "in", body: "What would my payment be?", at: new Date(Date.now() - 30 * 60000).toISOString(), read: false } },
    // The converter: an internet up thirty hours old with nothing booked (the manager gets a time-ask to send);
    // one answered five hours ago without an ask (the rep is told to ask).
    { id: "c7", user_id: U1, collection: "leads", data: { id: "c7", name: "Ida Internet", phone: "9025557007", stage: "new", source: "Dealer Site", vehicleInterest: "2026 Rogue", createdAt: hoursAgo(30), lastContacted: hoursAgo(29), firstContacted: hoursAgo(29) } },
    { id: "c8", user_id: U1, collection: "leads", data: { id: "c8", name: "Ivy Web", phone: "9025557008", stage: "new", source: "O'Regan's Website", createdAt: hoursAgo(5), lastContacted: hoursAgo(4), firstContacted: hoursAgo(4) } },
    { id: "out8", user_id: U1, collection: "texts", data: { id: "out8", leadId: "c8", dir: "out", body: "Hi Ivy, thanks for reaching out about the Kicks — it's here.", at: hoursAgo(4), read: true } },
    // The rep has notifications on, so their own sweep runs in this pass (the push itself can't complete against this plain mock).
    { id: "push-rep", user_id: U1, collection: "push", data: { id: "push-rep", sub: { endpoint: `http://127.0.0.1:${MOCK}/push/u1`, keys: { p256dh: SUBKEY.pub, auth: "YXV0aHNlY3JldDE2Ynl0ZXM" } }, createdAt: new Date().toISOString() } },
    // The event log for the statistician: ten leads answered inside ten minutes over the last fortnight.
    ...[...Array(10)].flatMap((_, i) => { const at = Date.now() - (i + 1) * 86400000; return [
      { id: "sev" + i + "a", user_id: U1, collection: "events", data: { id: "sev" + i + "a", kind: "lead_new", leadId: "sl" + i, name: "Lead " + i, by: "rep", prompt: "", at: new Date(at).toISOString() } },
      { id: "sev" + i + "b", user_id: U1, collection: "events", data: { id: "sev" + i + "b", kind: "text_out", leadId: "sl" + i, name: "Lead " + i, by: "rep", prompt: "intro", at: new Date(at + (3 + i % 4) * 60000).toISOString() } },
    ]; }),
    // An appointment two hours gone with no outcome: the rep is asked "Did Olive show?" with two buttons.
    { id: "ap4", user_id: U1, collection: "appointments", data: { id: "ap4", customerName: "Olive Outcome", type: "test drive", when: new Date(Date.now() - 2 * 60 * 60000).toISOString().slice(0, 16), status: "scheduled", confirmed: true } },
    // The be-backs: logged five days ago, still working, quiet for four.
    { id: "c9", user_id: U1, collection: "leads", data: { id: "c9", name: "Una Unsold", phone: "9025557009", stage: "working", vehicleInterest: "Sentra", loggedAt: hoursAgo(120), lastContacted: hoursAgo(96) } },
  );
  // The store's book: Parm's own book has two worth a call, the plan asks for twelve, so the
  // dispatcher deals from the pool — Pat (equity) and Lia (lease), not Eve, whom Parm already has by phone.
  db.pool.push(
    { store_id: "s1", id: "ph:9025558001", data: { id: "ph:9025558001", name: "Pat Pool", phone: "9025558001", stage: "delivered", currentValue: 24000, payoff: 11000, purchaseDate: "2023-05-01" }, status: "new", deleted: false },
    { store_id: "s1", id: "ph:9025558002", data: { id: "ph:9025558002", name: "Lia Lease", phone: "9025558002", stage: "delivered", leaseEnd: dayN(45), purchaseDate: "2023-01-01" }, status: "new", deleted: false },
    { store_id: "s1", id: "ph:9025556002", data: { id: "ph:9025556002", name: "Eve Equity", phone: "9025556002", stage: "delivered", currentValue: 21000, payoff: 12000, purchaseDate: "2024-01-01" }, status: "new", deleted: false },
    { store_id: "s1", id: "ph:9025558003", data: { id: "ph:9025558003", name: "Nobody Special", phone: "9025558003", stage: "delivered", purchaseDate: "2026-01-01" }, status: "new", deleted: false },
  );
  const repPrefs = db.records.find((r) => r.user_id === U1 && r.collection === "prefs");
  repPrefs.data = { tzOffsetMinutes: 0, hoursFrom: 0, hoursTo: 24, hoursDays: [0, 1, 2, 3, 4, 5, 6], quietFrom: 0, quietTo: 0 };
  twilio.sent.length = 0;
  // Ken's appointment an hour out (the sweep section's) is tomorrow's once
  // the clock is near midnight, and the agent would confirm it first; it's
  // confirmed by hand here so Tam's is the one this section watches.
  { const ap = db.records.find((r) => r.user_id === U1 && r.id === "ap1"); if (ap) ap.data.confirmed = true; }
  // An earlier sweep in this run sends the day's huddle at the default hour
  // once the clock is past eight; this section tests the send itself.
  db.records.filter((r) => r.user_id === U3 && r.collection === "nudgelog").forEach((r) => { const sent = (r.data && r.data.sent) || {}; Object.keys(sent).forEach((k) => { if (/^agent:(huddle|recap):/.test(k)) delete sent[k]; }); });
  const ag = await post(LOCKED, { sweep: 1 });
  const agentRep = (ag.body.agent || []).find((x) => x.store === "O'Regan's Nissan Halifax") || {};
  const mgrRep = (ag.body.managers || []).find((m) => m.manager === U3.slice(0, 8)) || {};
  console.log("agent:", JSON.stringify(agentRep), "\nmanagers:", JSON.stringify(mgrRep));
  const texts = (uid) => db.records.filter((r) => r.user_id === uid && r.collection === "texts" && !r.deleted).map((r) => r.data);
  const tasks = (uid) => db.records.filter((r) => r.user_id === uid && r.collection === "tasks" && !r.deleted).map((r) => r.data);
  const conf = twilio.sent.find((t) => /Just confirming your test drive tomorrow at 2:30 pm with Parm/.test(t.Body));
  // The event log carries the agent's text, in the app's shape: who, what, which customer, prompted by what.
  const evConf = db.records.find((r) => r.user_id === U1 && r.collection === "events" && r.data && r.data.kind === "text_out" && r.data.prompt === "manager-confirm");
  if (!evConf || evConf.data.by !== "agent" || evConf.data.leadId !== "c4" || !evConf.data.at) fail("the agent's confirmation text isn't in the event log: " + JSON.stringify(evConf));
  if (!conf || conf.To !== "9025554444" || agentRep.confirmed !== 1) fail("tomorrow's unconfirmed appointment wasn't confirmed: " + JSON.stringify([twilio.sent, agentRep]));
  if (!texts(U1).some((t) => t.via === "manager-confirm" && t.leadId === "c4")) fail("the confirmation isn't filed in the rep's thread");
  const ns = twilio.sent.find((t) => /Sorry we missed you yesterday — Parm would love to get you in/.test(t.Body));
  if (!ns || ns.To !== "9025555555" || agentRep.noShows !== 1) fail("yesterday's no-show wasn't chased: " + JSON.stringify(twilio.sent));
  if (!tasks(U1).some((t) => t.kind === "rebook" && t.leadId === "c5" && /Rebook Nick Noshow/.test(t.title))) fail("no rebook to-do on the rep's list: " + JSON.stringify(tasks(U1)));
  const hand = tasks(U1).filter((t) => t.kind === "reach");
  const dealt = tasks(U1).filter((t) => t.kind === "reach" && /Pat Pool|Lia Lease/.test(t.title));
  const poolLeads = db.records.filter((r) => r.user_id === U1 && r.collection === "leads" && r.data.storeCustomerId).map((r) => r.data);
  if (agentRep.pool !== 2 || dealt.length !== 2 || poolLeads.length !== 2 || !poolLeads.every((l) => l.importedAt && l.handedBy === "agent") || !db.pool.filter((c) => /8001|8002/.test(c.id)).every((c) => c.status === "assigned" && c.assigned_to === U1) || db.pool.find((c) => /6002/.test(c.id)).status !== "new") fail("the dispatcher didn't deal from the store's book, or dealt the wrong ones: " + JSON.stringify([agentRep.pool, dealt.map((t) => t.title), poolLeads.map((l) => l.name), db.pool.map((c) => [c.id, c.status])]));
  if (agentRep.handouts !== 4 || hand.length !== 4 || !hand.some((t) => t.leadId === "o1" && /Lease ends in 2 mo/.test(t.title)) || !hand.some((t) => t.leadId === "o2" && /\$9,?000 equity/.test(t.title)) || hand.some((t) => t.leadId === "o3")) fail("the morning's hand-outs are wrong: " + JSON.stringify(hand));
  if (!tasks(U1).some((t) => t.kind === "service" && t.leadId === "o4" && /In service today: Sue Service/.test(t.title))) fail("the customer in the service drive wasn't handed over: " + JSON.stringify(tasks(U1)));
  if (!(agentRep.huddles || []).some((k) => /^agent:huddle:/.test(k))) fail("the huddle wasn't sent: " + JSON.stringify(agentRep));
  // The statistician: on the review day the store's sentences go to the manager and Parm's own to Parm.
  if (!(agentRep.stats || []).some((k) => /^stats:\d{4}-\d{2}-\d{2}$/.test(k)) || !(agentRep.stats || []).some((k) => new RegExp("^stats:.*:" + U1.slice(0, 8) + "$").test(k))) fail("the statistician didn't run for the store and for Parm: " + JSON.stringify(agentRep.stats));
  if (!(agentRep.statsText || []).some((x) => /^First contact takes \d min at the median; 100% of leads hear from us inside ten minutes\./.test(x))) fail("the statistician's sentence is wrong: " + JSON.stringify(agentRep.statsText));
  // The planner wrote the month to Parm from the allocation; the dispatcher sized the hand-outs to the plan (capped at twelve).
  const monthKey = new Date().toISOString().slice(0, 7);
  const parmT = db.targets.find((t) => t.user_id === U1 && t.month === monthKey);
  if (!(agentRep.review || []).includes("plan:" + monthKey) || !parmT || parmT.goal_units !== 20 || !(parmT.goal_appts > 0)) fail("the planner didn't set Parm's month: " + JSON.stringify([agentRep.review, db.targets]));
  const sized = agentRep.plan && agentRep.plan.contactsDay && agentRep.plan.contactsDay[U1];
  if (!sized || sized.n !== 12 || sized.base < 10) fail("the dispatcher didn't size Parm's hand-outs to the plan: " + JSON.stringify(agentRep.plan));
  if (!(agentRep.review || []).some((k) => /^review:/.test(k)) || !(agentRep.review || []).some((k) => /^bebacks:/.test(k))) fail("the reviewer or the be-back list didn't run on the review day: " + JSON.stringify(agentRep.review));
  // The converter: the manager holds a time-ask for Ida; the rep was told to ask Ivy.
  const askDraft = db.records.find((r) => r.user_id === U3 && r.collection === "agentdrafts" && r.id === "reply:c7");
  if (!(mgrRep.sent || []).includes("mgr:unbooked:c7") || !askDraft || askDraft.data.kind !== "ask" || !/Parm mentioned you were looking at the 2026 Rogue/.test(askDraft.data.body)) fail("the unbooked internet up didn't get the manager's time-ask: " + JSON.stringify([mgrRep.sent, askDraft && askDraft.data]));
  // Every test account shares the same first eight characters, so the rep's
  // report is the one carrying the key.
  const repReports = Array.isArray(ag.body.report) ? ag.body.report : [];
  if (!repReports.some((x) => (x.keys || []).includes("ask:c8"))) fail("the rep wasn't told to ask Ivy for a time: " + JSON.stringify(repReports));
  // One-tap outcomes: the appointment two hours gone is a candidate (it comes after the fresh lead, the ready text and the time-ask, so the second sweep sends it); the one in an hour and yesterday's no-show never are.
  const repKeys = repReports.flatMap((x) => x.keys || []);
  if (repKeys.includes("outcome:ap1") || repKeys.includes("outcome:ap3")) fail("an outcome was asked about too early or twice: " + JSON.stringify(repKeys));
  // The reply drafts: Dana's (from the earlier mtext section she's answered, so it's Money Mike waiting) — a figure, refused: plain push, no draft held.
  const drafts = db.records.filter((r) => r.user_id === U3 && r.collection === "agentdrafts" && !r.deleted).map((r) => r.data);
  if (drafts.some((d) => d.leadId === "c6")) fail("a draft with a figure in it was held for the manager: " + JSON.stringify(drafts));
  if (!(mgrRep.sent || []).includes("mgr:reply:in3") || (mgrRep.drafted || []).includes("mgr:reply:in3")) fail("the waiting customer with the refused draft didn't get the plain push: " + JSON.stringify(mgrRep));
  // A customer whose draft is clean: held under the manager, and the push carries it.
  db.records.push(
    { id: "c7", user_id: U1, collection: "leads", data: { id: "c7", name: "Dana Draft", phone: "9025556007", stage: "working", vehicleInterest: "Rogue SV" } },
    { id: "in4", user_id: U1, collection: "texts", data: { id: "in4", leadId: "c7", dir: "in", body: "Can I come Saturday?", at: new Date(Date.now() - 30 * 60000).toISOString(), read: false } },
  );
  const ag2 = await post(LOCKED, { sweep: 1 });
  const mgrRep2 = (ag2.body.managers || []).find((m) => m.manager === U3.slice(0, 8)) || {};
  const held = db.records.find((r) => r.user_id === U3 && r.collection === "agentdrafts" && r.id === "reply:c7" && !r.deleted);
  console.log("draft:", JSON.stringify(mgrRep2), held && held.data.body);
  if (!held || !/Saturday works/.test(held.data.body) || held.data.rep !== U1) fail("the clean draft wasn't held for the manager: " + JSON.stringify(held));
  if (!(mgrRep2.drafted || []).includes("mgr:reply:in4")) fail("the push for the drafted reply wasn't marked drafted: " + JSON.stringify(mgrRep2));
  const agentRep2 = (ag2.body.agent || []).find((x) => x.store === "O'Regan's Nissan Halifax") || {};
  if (agentRep2.confirmed || agentRep2.noShows || agentRep2.handouts || (agentRep2.huddles || []).length) fail("the agent did the day's work twice: " + JSON.stringify(agentRep2));
  // The manager sends it: the held draft is spent.
  const sendHeld = await post(LOCKED, { mtext: { rep: U1, leadId: "c7", body: held.data.body } }, "tok-c");
  const spent = db.records.find((r) => r.user_id === U3 && r.collection === "agentdrafts" && r.id === "reply:c7");
  if (sendHeld.status !== 200 || !spent || !spent.deleted) fail("sending the held draft didn't spend it: " + JSON.stringify([sendHeld.status, spent]));

  // One-tap outcomes: with the customers waiting on replies answered, the
  // next sweep asks whether Olive showed; the appointment in an hour and
  // yesterday's no-show are never asked about.
  db.records.forEach((r) => { if (r.user_id === U1 && r.collection === "texts" && r.data && r.data.dir === "in") r.data.read = true; });
  const ag3 = await post(LOCKED, { sweep: 1 });
  const repKeys3 = (Array.isArray(ag3.body.report) ? ag3.body.report : []).flatMap((x) => x.keys || []);
  console.log("sweep 3:", JSON.stringify(repKeys3));
  if (!repKeys3.includes("outcome:ap4") || repKeys3.includes("outcome:ap1") || repKeys3.includes("outcome:ap3")) fail("the rep wasn't asked whether Olive showed: " + JSON.stringify([repKeys, repKeys3]));

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
process.on("exit", () => procs.forEach((p) => { try { p.kill(); } catch { /* gone */ } }));
console.log(process.exitCode ? "\nfnrelay.test.js FAILED" : "\nfnrelay.test.js passed");
})();
