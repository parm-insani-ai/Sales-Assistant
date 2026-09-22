// One place every test gets its browser from. Chromium by default, from the
// pre-installed copy; VINIVA_BROWSER=webkit runs the same tests in WebKit —
// Safari's engine — which is the one the phone actually uses and the one a
// Linux sandbox can't run. On a Mac: npx playwright install webkit, then
//   VINIVA_BROWSER=webkit node test/contacted.test.js
const fs = require("fs");
const pw = require("/opt/node22/lib/node_modules/playwright");

async function launch(opts = {}) {
  const which = (process.env.VINIVA_BROWSER || "chromium").toLowerCase();
  if (which === "webkit") return pw.webkit.launch(opts);
  if (which === "firefox") return pw.firefox.launch(opts);
  const exe = "/opt/pw-browsers/chromium";
  return pw.chromium.launch(fs.existsSync(exe) ? { executablePath: exe, ...opts } : opts);
}

module.exports = { launch, devices: pw.devices };
