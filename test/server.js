// Static server + a stub of the Supabase function, so the app can be driven
// end-to-end in a headless browser without touching the real backend.
//
// Lives in the repo on purpose: this and the tests beside it were previously
// kept in a scratch directory and were lost when the container recycled.
//
//   node test/server.js            # serves the app on :8137
//
// The stub covers the calls the UI actually makes: shortening a link, resolving
// one (which is also what records an "open"), and the push config probe.

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8137);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// In-memory stand-in for the links table.
const links = new Map();
// In-memory stand-in for the records table (cloud sync), and each POST's row count.
const records = new Map();
// Stores and their members, for the Team screen and the manager board; the
// admins who may create stores and appoint managers ("tm" by default).
const stores = new Map();
const admins = new Set(["00000000-0000-4000-8000-000000000003"]);
// The store's shared lot: key store|id.
const storeVehicles = new Map();
// Targets managers set, and the nudges (pushes) managers sent.
const targets = new Map();
const nudges = [];
const pushes = [];
let seq = 0;
// Texts the app asked us to send, so a test can assert what reached "Twilio".
const sent = [];
// When set, the next send fails — for exercising the failed/retry path.
let failNextSend = false;
// Canned reply for the drafting endpoint, so no real model is called.
let draft = "Happy to go through it properly — takes about ten minutes. Does Thursday at 5 work, or is Saturday morning easier?";
// What the function reports back from a setup check; tests swap this for the
// shape they want to see rendered.
let checkReply = { secrets: {}, auth: { ok: false, why: "not configured in this stub" } };

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,HEAD,OPTIONS",
      "Access-Control-Expose-Headers": "Content-Range",
    });
    return res.end();
  }

  // --- Supabase auth stubs: enough for the app to sign out and refresh ---
  if (url.pathname === "/auth/v1/logout") { res.writeHead(204, { "Access-Control-Allow-Origin": "*" }); return res.end(); }
  if (url.pathname === "/auth/v1/signup") {
    // A new account: a session straight away, like a project with email
    // confirmation off. The email decides the user, so a test can create a
    // second account and see it kept apart.
    let body = ""; req.on("data", (c) => (body += c));
    return req.on("end", () => {
      let j = {}; try { j = JSON.parse(body || "{}"); } catch {}
      const second = /2@/.test(String(j.email || ""));
      json(res, 200, { access_token: second ? "t2" : "t", refresh_token: "r", expires_in: 86400,
        user: { id: second ? "00000000-0000-4000-8000-000000000002" : "00000000-0000-4000-8000-000000000001", email: j.email || "p@e.com" } });
    });
  }
  if (url.pathname === "/auth/v1/token") {
    // Any refresh or password grant succeeds and yields a long-lived token for
    // a fixed test user, so a test can drive the real sign-in button.
    return json(res, 200, { access_token: "t", refresh_token: "r", expires_in: 3600 * 24,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } });
  }

  // Who's asking: "t2" is a second account, "tm"/"t3" a third, anything else the
  // fixed test user. The same map the records table and the rpc functions use.
  const USERS = { t: "00000000-0000-4000-8000-000000000001", t2: "00000000-0000-4000-8000-000000000002", tm: "00000000-0000-4000-8000-000000000003", t3: "00000000-0000-4000-8000-000000000003", t4: "00000000-0000-4000-8000-000000000004" };
  const bearer = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
  const callerId = USERS[bearer] || USERS.t;

  // --- stores + members, and the database functions the app calls ---
  const myStore = (uid) => {
    for (const st of stores.values()) {
      const me = st.members.find((m) => m.user_id === uid);
      if (me) return { id: st.id, name: st.name, code: st.code, role: me.role, members: st.members.slice().sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)) };
    }
    return null;
  };
  const manages = (uid, target) => { const st = myStore(uid); return !!(st && st.role === "manager" && st.members.some((m) => m.user_id === target)); };
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = url.pathname.slice("/rest/v1/rpc/".length);
    let body = "";
    req.on("data", (c) => (body += c));
    return req.on("end", () => {
      let args = {};
      try { args = JSON.parse(body || "{}"); } catch {}
      const uid = callerId, email = { [USERS.t]: "p@e.com", [USERS.t2]: "rep2@e.com", [USERS.tm]: "mgr@e.com", [USERS.t4]: "rep4@e.com" }[uid] || "";
      const fail = (m) => json(res, 400, { message: m });
      const isAdmin = admins.has(uid);
      const allStores = () => [...stores.values()].map((st) => ({ id: st.id, name: st.name, code: st.code, created_at: "x", members: st.members }));
      const withAdmin = (st) => (st ? { ...st, admin: isAdmin } : null);
      if (fn === "my_store") return json(res, 200, withAdmin(myStore(uid)));
      if (fn === "is_admin") return json(res, 200, isAdmin);
      if (fn === "admin_stores") return json(res, 200, isAdmin ? allStores() : null);
      if (fn === "create_store") {
        if (!isAdmin) return fail("only an admin can create a store");
        if (!String(args.store_name || "").trim()) return fail("the store needs a name");
        const id = "st_" + (stores.size + 1), code = "code" + (stores.size + 1) + "abc";
        const members = myStore(uid) ? [] : [{ user_id: uid, role: "manager", name: String(args.display_name || "").trim(), email, joined_at: new Date().toISOString() }];
        stores.set(id, { id, name: String(args.store_name).trim(), code, members });
        return json(res, 200, withAdmin(myStore(uid)));
      }
      if (fn === "admin_add_member") {
        if (!isAdmin) return fail("only an admin can do that");
        const st = stores.get(args.store); if (!st) return fail("no such store");
        const em = String(args.member_email || "").trim().toLowerCase();
        const who = Object.entries({ [USERS.t]: "p@e.com", [USERS.t2]: "rep2@e.com", [USERS.tm]: "mgr@e.com", [USERS.t4]: "rep4@e.com" }).find(([, e]) => e === em);
        if (!who) return fail("no account has signed up with that email yet");
        const have = st.members.find((m) => m.user_id === who[0]);
        if (have) { have.role = args.new_role; if (args.display_name) have.name = args.display_name; }
        else st.members.push({ user_id: who[0], role: args.new_role || "rep", name: String(args.display_name || "").trim(), email: em, joined_at: new Date().toISOString() });
        return json(res, 200, allStores());
      }
      if (fn === "admin_set_store") {
        if (!isAdmin) return fail("only an admin can do that");
        if (args.remove) stores.delete(args.store); else if (args.new_name) { const st = stores.get(args.store); if (st) st.name = String(args.new_name).trim(); }
        return json(res, 200, allStores());
      }
      if (fn === "join_store") {
        const st = [...stores.values()].find((x) => x.code === String(args.code || "").trim().toLowerCase());
        if (!st) return fail("no store has that invite code");
        const mine = myStore(uid); if (mine && mine.id !== st.id) return fail("you are already in another store");
        const have = st.members.find((m) => m.user_id === uid);
        if (have) { if (args.display_name) have.name = String(args.display_name).trim(); }
        else st.members.push({ user_id: uid, role: "rep", name: String(args.display_name || "").trim(), email, joined_at: new Date().toISOString() });
        return json(res, 200, myStore(uid));
      }
      if (fn === "set_my_name") { for (const st of stores.values()) st.members.forEach((m) => { if (m.user_id === uid) m.name = String(args.display_name || "").trim(); }); return json(res, 200, myStore(uid)); }
      if (fn === "set_member_role") {
        const mine = myStore(uid);
        const st = isAdmin && args.store ? stores.get(args.store) : mine ? stores.get(mine.id) : null;
        if (!st) return fail("you are not in a store");
        const target = st.members.find((m) => m.user_id === args.member); if (!target) return fail("they are not in that store");
        if (!isAdmin) {
          if (!mine || mine.role !== "manager") return fail("only a manager can do that");
          if (args.new_role !== "remove") return fail("only an admin can appoint or demote a manager");
          if (target.role === "manager") return fail("only an admin can remove a manager");
        }
        if (args.new_role === "remove") st.members = st.members.filter((m) => m.user_id !== args.member);
        else target.role = args.new_role;
        return json(res, 200, withAdmin(myStore(uid)));
      }
      // Targets a manager sets, and what a manager may write on a rep's appointment.
      if (fn === "set_target") {
        const st = [...stores.values()].find((x) => x.members.some((m) => m.user_id === args.member));
        if (!st) return fail("they are not in a store");
        const mine = myStore(uid);
        if (!isAdmin && !(mine && mine.id === st.id && mine.role === "manager")) return fail("only a manager of their store can set targets");
        targets.set(st.id + "|" + args.member + "|" + args.target_month, { user_id: args.member, month: args.target_month, goal_units: Math.max(0, args.units || 0), goal_appts: Math.max(0, args.appts || 0) });
        return json(res, 200, [...targets.values()].filter((t) => t.month === args.target_month && st.members.some((m) => m.user_id === t.user_id)));
      }
      if (fn === "targets_for_store") { const st = stores.get(args.store); return json(res, 200, st ? [...targets.values()].filter((t) => t.month === args.target_month && st.members.some((m) => m.user_id === t.user_id)) : []); }
      if (fn === "my_target") { const t = [...targets.values()].find((t) => t.user_id === uid && t.month === args.target_month); return json(res, 200, t ? { month: t.month, goal_units: t.goal_units, goal_appts: t.goal_appts } : null); }
      if (fn === "manager_update_appointment") {
        if (!isAdmin && !manages(uid, args.member)) return fail("only a manager of their store can do that");
        const row = records.get(args.member + "|" + args.appt_id);
        if (!row || row.collection !== "appointments") return fail("no such appointment");
        const p = args.patch || {};
        for (const k of ["confirmed", "outcome", "status", "managerNote"]) if (p[k] != null) row.data[k] = p[k];
        row.data.updatedAt = new Date().toISOString(); row.updated_at = row.data.updatedAt;
        return json(res, 200, row.data);
      }
      if (fn === "store_inventory") {
        const st = stores.get(args.store); const mine = myStore(uid);
        if (!st || !(isAdmin || (mine && mine.id === st.id))) return json(res, 200, []);
        return json(res, 200, [...storeVehicles.values()].filter((v) => v.store_id === st.id && (!args.since || v.updated_at > args.since)).map((v) => ({ id: v.id, data: v.data, updated_at: v.updated_at, deleted: v.deleted })));
      }
      if (fn === "set_store_inventory") {
        const st = stores.get(args.store); const mine = myStore(uid);
        if (!st || !(isAdmin || (mine && mine.id === st.id && mine.role === "manager"))) return fail("only a manager of the store can do that");
        const nowiso = new Date().toISOString(); let n = 0; const ids = new Set();
        for (const r of args.rows || []) { if (!r.id) continue; ids.add(r.id); storeVehicles.set(st.id + "|" + r.id, { store_id: st.id, id: r.id, data: r, updated_at: nowiso, deleted: false }); n++; }
        if (args.complete) for (const v of storeVehicles.values()) if (v.store_id === st.id && !ids.has(v.id) && (v.data.status || "available") !== "sold") { v.data = { ...v.data, status: "sold" }; v.updated_at = nowiso; }
        return json(res, 200, { written: n });
      }
      if (fn === "manager_add_task") {
        if (!isAdmin && !manages(uid, args.member)) return fail("only a manager of their store can do that");
        const t = args.task || {}; if (!t.title) return fail("the task needs a title");
        const id = "tsk_" + Math.random().toString(36).slice(2, 10), nowiso = new Date().toISOString();
        const data = { id, leadId: t.leadId, title: t.title, due: t.due, channel: t.channel, note: t.note, fromManager: true, setBy: uid, done: false, createdAt: nowiso, updatedAt: nowiso };
        records.set(args.member + "|" + id, { id, user_id: args.member, collection: "tasks", data, deleted: false, updated_at: nowiso });
        return json(res, 200, data);
      }
      if (fn === "leave_store") { for (const st of stores.values()) st.members = st.members.filter((m) => m.user_id !== uid); res.writeHead(204, { "Access-Control-Allow-Origin": "*" }); return res.end(); }
      return json(res, 404, { message: "no such function " + fn });
    });
  }

  // --- records table (PostgREST shape) ---
  // Keyed (user_id, id) exactly like the real primary key — the collection is
  // NOT part of it, which is how config/"me" and prefs/"me" collided for real.
  // The user comes from the bearer token: "t2" is a second account, any other
  // token is the fixed test user — so a test can sign two accounts into one
  // phone and check they never see each other's rows.
  if (url.pathname === "/rest/v1/records") {
    const uid = callerId;
    const key = (id) => uid + "|" + id;
    // Row-level security: your own rows, plus — for a manager — the rows of
    // the reps in your store. Asking for anyone else's reads as empty.
    const mine = () => {
      const want = (url.searchParams.get("user_id") || "").replace(/^eq\./, "");
      const who = want && want !== uid ? (manages(uid, want) ? want : null) : uid;
      return who ? [...records.values()].filter((r) => r.user_id === who) : [];
    };
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let rows;
        try { rows = JSON.parse(body); } catch { return json(res, 400, { message: "bad json" }); }
        if (!Array.isArray(rows)) rows = [rows];
        // Postgres refuses to touch one row twice in a single INSERT ... ON
        // CONFLICT — reproduce that, it's a real error the app has hit.
        const seen = new Set();
        for (const r of rows) {
          if (seen.has(r.id)) return json(res, 400, { message: "ON CONFLICT DO UPDATE command cannot affect row a second time" });
          seen.add(r.id);
        }
        const now = new Date().toISOString();
        for (const r of rows) {
          records.set(key(r.id), { id: r.id, user_id: uid, collection: r.collection, data: r.data || {}, deleted: !!r.deleted, updated_at: now });
        }
        pushes.push(rows.length);
        res.writeHead(201, { "Access-Control-Allow-Origin": "*" });
        return res.end();
      });
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      let rows = mine();
      // Filters the app uses.
      const cmp = (val, v) => {
        const m = /^(eq|gte|lte|gt|lt|in|is)\.(.*)$/s.exec(v); if (!m) return true;
        const [, op, arg] = m; const x = val == null ? null : String(val);
        if (op === "is") return arg === "null" ? x == null : x != null;
        if (op === "in") return arg.replace(/^\(|\)$/g, "").split(",").map((z) => z.trim()).includes(x);
        if (x == null) return false;
        return op === "eq" ? x === arg : op === "gte" ? x >= arg : op === "lte" ? x <= arg : op === "gt" ? x > arg : x < arg;
      };
      for (const [k, v] of url.searchParams) {
        if (k === "updated_at" && v.startsWith("gt.")) rows = rows.filter((r) => r.updated_at > v.slice(3));
        if (k === "collection" && v.startsWith("eq.")) rows = rows.filter((r) => r.collection === v.slice(3));
        if (k === "deleted" && v.startsWith("eq.")) rows = rows.filter((r) => String(r.deleted) === v.slice(3));
        if (k === "id") rows = rows.filter((r) => cmp(r.id, v));
        if (k.startsWith("data->>")) { const field = k.slice(7); rows = rows.filter((r) => cmp((r.data || {})[field], v)); }
      }
      const lim = Number(url.searchParams.get("limit") || 0); if (lim > 0) rows = rows.slice(0, lim);
      rows.sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
      const total = rows.length;
      // Range pagination, and Prefer: count=exact → Content-Range with the total.
      let from = 0, to = rows.length - 1;
      const range = req.headers["range"];
      if (range && /^\d+-\d+$/.test(range)) { [from, to] = range.split("-").map(Number); }
      const page = rows.slice(from, to + 1);
      const select = (url.searchParams.get("select") || "*").split(",").map((x) => x.trim());
      const shaped = select.includes("*") ? page : page.map((r) => Object.fromEntries(select.map((c) => [c, r[c]])));
      const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Range" };
      if (/count=exact/.test(req.headers["prefer"] || "")) headers["Content-Range"] = `${from}-${Math.max(from, from + page.length - 1)}/${total}`;
      res.writeHead(req.method === "HEAD" ? 200 : 200, headers);
      return res.end(req.method === "HEAD" ? undefined : JSON.stringify(shaped));
    }
  }
  // Test hooks for the records table.
  if (url.pathname === "/__records") return json(res, 200, [...records.values()]);
  // Seed rows for any user: POST { user_id, rows: [{ id, collection, data }] }.
  if (url.pathname === "/__seed" && req.method === "POST") {
    let b = ""; req.on("data", (c) => (b += c));
    return req.on("end", () => {
      let p = {}; try { p = JSON.parse(b); } catch {}
      const now = new Date().toISOString();
      (p.rows || []).forEach((r) => records.set(p.user_id + "|" + r.id, { id: r.id, user_id: p.user_id, collection: r.collection, data: r.data || {}, deleted: false, updated_at: now }));
      json(res, 200, { ok: true, n: (p.rows || []).length });
    });
  }
  if (url.pathname === "/__stores") return json(res, 200, [...stores.values()]);
  if (url.pathname === "/__nudges") return json(res, 200, nudges);
  if (url.pathname === "/__admin") { const u = url.searchParams.get("u"); if (u) admins.add(u); return json(res, 200, [...admins]); }
  if (url.pathname === "/__pushes") return json(res, 200, pushes);

  // --- Function stub ---
  if (url.pathname.startsWith("/functions/v1/")) {
    // Resolving a short link is what counts as an open.
    const code = url.searchParams.get("l");
    if (req.method === "GET" && code) {
      const row = links.get(code);
      if (!row) return json(res, 404, { error: "not found" });
      row.opens += 1;
      row.lastOpenAt = new Date().toISOString();
      if (!row.firstOpenAt) row.firstOpenAt = row.lastOpenAt;
      return json(res, 200, { payload: row.payload });
    }
    if (req.method === "GET" && url.searchParams.get("push") === "cfg") {
      return json(res, 200, { vapid: "test-key" });
    }
    let body = "";
    req.on("data", (c) => (body += c));
    return req.on("end", () => {
      let msg = {};
      try { msg = JSON.parse(body || "{}"); } catch {}
      // Like the real function: anything that acts as a person needs the
      // session's bearer token. A call without one is refused, which is how
      // a test finds a client path that forgot to send it.
      const personal = !!(msg.sms || msg.smscheck || msg.testpush || msg.shorten || msg.email || (msg.inventory && msg.inventory.u) || Array.isArray(msg.messages));
      if (personal && !/^Bearer\s+\S+/.test(String(req.headers["authorization"] || ""))) return json(res, 401, { error: "Sign in to your cloud account in Settings — this call needs your session." });
      // Canned diagnosis, so the Settings readout can be exercised against the
      // shapes a real misconfiguration produces.
      if (msg.smscheck) return json(res, 200, checkReply);
      if (msg.nudge) {
        const uid = USERS[bearer] || USERS.t;
        const st = [...stores.values()].find((x) => x.members.some((m) => m.user_id === msg.nudge.to));
        const ok = admins.has(uid) || !!(st && st.members.some((m) => m.user_id === uid && m.role === "manager"));
        if (!ok) return json(res, 403, { error: "you don't manage that rep" });
        nudges.push({ from: uid, ...msg.nudge });
        return json(res, 200, { sent: 1, errors: [] });
      }
      if (msg.sms) {
        if (failNextSend) { failNextSend = false; return json(res, 502, { error: "carrier rejected the message" }); }
        sent.push(msg.sms);
        return json(res, 200, { sent: true, id: msg.sms.id, sid: "SM" + sent.length });
      }
      // The Claude relay: return a canned draft in the real response shape.
      if (Array.isArray(msg.messages)) {
        return json(res, 200, { content: [{ type: "text", text: draft }], stop_reason: "end_turn" });
      }
      // The inventory import: pretend the store's site had three units, and
      // write them where a sync will find them.
      if (msg.inventory) {
        const uid = "00000000-0000-4000-8000-000000000001";
        const now = new Date().toISOString();
        const lot = [
          { id: "web_1N4BL4BV5RC000001", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38995, mileage: 12, color: "Gun Metallic", stock: "R2601", vin: "1N4BL4BV5RC000001", condition: "New", status: "available", source: "web", url: "https://example.test/vehicle/1", photo: "", seenAt: now, updatedAt: now, createdAt: now },
          { id: "web_5N1AT3AA0RC000002", year: 2025, make: "Nissan", model: "Kicks", trim: "SR", price: 29450, mileage: 8, color: "Blue", stock: "K2502", vin: "5N1AT3AA0RC000002", condition: "New", status: "available", source: "web", url: "https://example.test/vehicle/2", photo: "", seenAt: now, updatedAt: now, createdAt: now },
          { id: "web_JN8AT3CB0MW000003", year: 2021, make: "Nissan", model: "Rogue", trim: "SL", price: 27900, mileage: 61000, color: "White", stock: "P4411", vin: "JN8AT3CB0MW000003", condition: "Used", status: "available", source: "web", url: "https://example.test/vehicle/3", photo: "", seenAt: now, updatedAt: now, createdAt: now },
        ];
        lot.forEach((v) => records.set(uid + "|" + v.id, { id: v.id, user_id: uid, collection: "vehicles", data: v, deleted: false, updated_at: now }));
        // …and into the store's shared lot when the importer is in a store.
        const stOf = [...stores.values()].find((x) => x.members.some((m) => m.user_id === uid));
        if (stOf) lot.forEach((v) => storeVehicles.set(stOf.id + "|" + v.id, { store_id: stOf.id, id: v.id, data: v, updated_at: now, deleted: false }));
        return json(res, 200, { uid: uid.slice(0, 8), url: msg.inventory.url || "https://example.test/inventory/", pages: 2, found: 3, added: 3, updated: 0, removed: 0, skipped: 0, onFile: 3, via: { jsonld: 3 }, at: now,
          sample: lot.slice(0, 3).map((v) => ({ year: v.year, make: v.make, model: v.model, trim: v.trim, price: v.price })) });
      }
      if (msg.shorten) {
        const c = "t" + (++seq).toString(36).padStart(6, "0");
        links.set(c, {
          code: c, payload: msg.shorten.data, meta: msg.shorten.meta,
          kind: msg.shorten.kind, opens: 0, createdAt: new Date().toISOString(),
        });
        return json(res, 200, { code: c });
      }
      // Anything else the app pokes at during a test.
      return json(res, 200, { ok: true, echo: msg });
    });
  }

  // Test hooks: inspect the stub's link table, or clear it so runs don't read
  // each other's links.
  if (url.pathname === "/__links") return json(res, 200, [...links.values()]);
  if (url.pathname === "/__sent") return json(res, 200, sent);
  if (url.pathname === "/__failnext") { failNextSend = true; return json(res, 200, { ok: true }); }
  if (url.pathname === "/__draft") { draft = url.searchParams.get("t") || draft; return json(res, 200, { ok: true }); }
  if (url.pathname === "/__check") {
    if (req.method === "POST") {
      let b = ""; req.on("data", (c) => (b += c));
      return req.on("end", () => { try { checkReply = JSON.parse(b); } catch {} json(res, 200, { ok: true }); });
    }
    return json(res, 200, checkReply);
  }
  if (url.pathname === "/__reset") {
    records.clear(); pushes.length = 0; stores.clear(); targets.clear(); nudges.length = 0; storeVehicles.clear();
    links.clear(); seq = 0; sent.length = 0; failNextSend = false;
    return json(res, 200, { ok: true });
  }

  // --- Static files ---
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`test server on http://127.0.0.1:${PORT}`));
