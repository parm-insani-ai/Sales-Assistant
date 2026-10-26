// Copies the web app into native/www, the folder the native shell bundles.
//
// The PWA at the repo root is the product; the iPhone app is the same files
// inside a native window. Nothing is transformed here — the same index.html,
// js/ and css/ the browser gets. The service worker is left out: a WKWebView
// can't run one (Apple limits service workers to apps with the browser
// entitlement), and the shell has no use for it — the app's own updater
// notices and simply skips registration when it isn't in a browser.
//
// CAP_SERVER_URL=https://entoa.ai  makes the shell load the live site instead
// of the bundled copy (the native bridge still works). Useful during the
// TestFlight pilot: every web deploy reaches the phones without a new build.
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "native/www");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const FILES = ["index.html", "book.html", "compare.html", "manifest.json", "version.json"];
const DIRS = ["css", "js", "icons"];
for (const f of FILES) if (existsSync(resolve(root, f))) cpSync(resolve(root, f), resolve(out, f));
for (const d of DIRS) cpSync(resolve(root, d), resolve(out, d), { recursive: true });

// The shell's config: bundled by default, the live site when asked.
const cfgPath = resolve(root, "capacitor.config.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const live = (process.env.CAP_SERVER_URL || "").trim();
if (live) cfg.server = { url: live, allowNavigation: [new URL(live).hostname] };
else delete cfg.server;
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

console.log(`native/www: ${FILES.length} files + ${DIRS.join(", ")}${live ? ` · shell loads ${live}` : " · bundled"}`);
