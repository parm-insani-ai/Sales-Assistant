// The worker's copy of a build has to be the whole build. A script that isn't
// in the list isn't in the copy, and the first time the app needs it offline
// — or on a build served from the copy — it isn't there. Every script and
// stylesheet in the repo is listed, and everything listed exists.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

const src = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const list = [...src.match(/ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
const listed = new Set(list.map((p) => p.replace(/^\.\//, "")));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = [...walk(path.join(root, "js")), ...walk(path.join(root, "css"))]
  .map((f) => path.relative(root, f)).filter((f) => /\.(js|css)$/.test(f));

const unlisted = files.filter((f) => !listed.has(f));
const missing = list.filter((p) => p !== "./" && !fs.existsSync(path.join(root, p)));
console.log(`${files.length} scripts and stylesheets, ${list.length} entries in the worker's list`);
console.log("not listed:", unlisted.length ? unlisted.join(", ") : "none");
console.log("listed but missing:", missing.length ? missing.join(", ") : "none");
if (unlisted.length) fail("scripts missing from the worker's list: " + unlisted.join(", "));
if (missing.length) fail("the worker lists files that don't exist: " + missing.join(", "));
console.log(process.exitCode ? "\nassets.test.js FAILED" : "\nassets.test.js passed");
