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
  if (url.pathname === "/auth/v1/token") {
    // Any refresh or password grant succeeds and yields a long-lived token for
    // a fixed test user, so a test can drive the real sign-in button.
    return json(res, 200, { access_token: "t", refresh_token: "r", expires_in: 3600 * 24,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } });
  }

  // --- records table (PostgREST shape) ---
  // Keyed (user_id, id) exactly like the real primary key — the collection is
  // NOT part of it, which is how config/"me" and prefs/"me" collided for real.
  // The user comes from the bearer token: "t2" is a second account, any other
  // token is the fixed test user — so a test can sign two accounts into one
  // phone and check they never see each other's rows.
  if (url.pathname === "/rest/v1/records") {
    const uid = /^Bearer t2$/.test(String(req.headers["authorization"] || "").trim())
      ? "00000000-0000-4000-8000-000000000002" : "00000000-0000-4000-8000-000000000001";
    const key = (id) => uid + "|" + id;
    const mine = () => [...records.values()].filter((r) => r.user_id === uid);
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
      for (const [k, v] of url.searchParams) {
        if (k === "updated_at" && v.startsWith("gt.")) rows = rows.filter((r) => r.updated_at > v.slice(3));
        if (k === "collection" && v.startsWith("eq.")) rows = rows.filter((r) => r.collection === v.slice(3));
        if (k === "deleted" && v.startsWith("eq.")) rows = rows.filter((r) => String(r.deleted) === v.slice(3));
      }
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
      // Canned diagnosis, so the Settings readout can be exercised against the
      // shapes a real misconfiguration produces.
      if (msg.smscheck) return json(res, 200, checkReply);
      if (msg.sms) {
        if (failNextSend) { failNextSend = false; return json(res, 502, { error: "carrier rejected the message" }); }
        sent.push(msg.sms);
        return json(res, 200, { sent: true, id: msg.sms.id, sid: "SM" + sent.length });
      }
      // The Claude relay: return a canned draft in the real response shape.
      if (Array.isArray(msg.messages)) {
        return json(res, 200, { content: [{ type: "text", text: draft }], stop_reason: "end_turn" });
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
    records.clear(); pushes.length = 0;
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
