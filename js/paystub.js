// Pay-stub ingestion. Reads a pay statement PDF (ADP-style, but the
// heuristics are generic) entirely on-device — the stub never leaves the
// phone — and pulls out the numbers the reconciliation needs: pay period,
// pay date, gross, net, and commission earnings. Parsing is best-effort by
// design: whatever it finds prefills the confirm form, and the user fixes
// anything it missed.
//
// pdf.js (vendored in js/vendor/) is loaded lazily on first use, so the
// ~1.7MB library costs nothing until a stub is actually imported.

let pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("./vendor/pdf.min.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

// PDF file → plain text, lines reconstructed top-to-bottom by y position so
// label/value pairs stay on one line like they appear on paper.
export async function extractPdfText(file) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map(); // rounded y → [{x, str}]
    tc.items.forEach((it) => {
      if (!it.str || !it.str.trim()) return;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], str: it.str });
    });
    [...rows.entries()]
      .sort((a, b) => b[0] - a[0]) // PDF y grows upward
      .forEach(([, items]) => out.push(items.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ")));
  }
  await doc.destroy();
  return out.join("\n");
}

// ---- Text → numbers ----
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// First date found in a string, as YYYY-MM-DD. Handles 01/15/2026, 15/01/2026
// (day-first when the first number can't be a month), 2026-01-15, Jan 15 2026.
export function findDate(s) {
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  }
  m = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(s);
  if (m) {
    let [, a, b, y] = m;
    a = Number(a); b = Number(b);
    if (y.length === 2) y = "20" + y;
    const [mo, d] = a > 12 ? [b, a] : [a, b]; // 15/01 must be day-first
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

// First dollar amount in a string (the "current" column on ADP stubs comes
// before YTD). "1,234.56", "$1,234.56", "1234.56".
function findMoney(s) {
  const m = /\$?\s*([0-9][0-9,]*\.\d{2})/.exec(s);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

// Best-effort field extraction. Returns nulls for anything not found.
export function parseStub(text) {
  const lines = String(text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const grab = (labelRe, take = findMoney) => {
    for (const l of lines) if (labelRe.test(l)) { const v = take(l); if (v != null) return v; }
    return null;
  };

  const periodStart = grab(/period\s*(beg|start)/i, findDate);
  const periodEnd = grab(/period\s*end/i, findDate);
  const payDate = grab(/(pay|cheque|check|advice)\s*date/i, findDate);
  const net = grab(/net\s*pay/i);
  const gross = grab(/gross\s*(pay|earnings|income)?/i);
  // Commission may appear on several earning lines — sum the current column.
  let commission = 0, commLines = 0;
  for (const l of lines) {
    if (/commission|spiff|spif|bonus/i.test(l) && !/ytd\s*$/i.test(l)) {
      const v = findMoney(l);
      if (v != null) { commission += v; commLines++; }
    }
  }
  return {
    periodStart, periodEnd, payDate, gross, net,
    commission: commLines ? Math.round(commission * 100) / 100 : null,
  };
}
