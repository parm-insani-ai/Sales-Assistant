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
let seq = 0;

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
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

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
  if (url.pathname === "/__reset") { links.clear(); seq = 0; return json(res, 200, { ok: true }); }

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
