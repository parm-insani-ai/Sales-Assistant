// Minimal, dependency-free CSV parser. Handles quoted fields, embedded commas,
// quoted newlines, and escaped double-quotes ("") per RFC 4180. Also tolerates
// a UTF-8 BOM and CRLF line endings, which spreadsheet exports often include.

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { pushField(); i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { pushField(); pushRow(); i++; continue; }
    field += c; i++;
  }
  // Flush the trailing field/row if the file doesn't end in a newline.
  if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }

  // Drop fully-empty trailing rows.
  while (rows.length && rows[rows.length - 1].every((x) => x.trim() === "")) rows.pop();
  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0].map((h) => h.trim());
  const objects = rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, idx) => { o[h] = (r[idx] ?? "").trim(); });
    return o;
  });
  return { headers, rows: objects };
}

// Normalize a header for fuzzy matching: lowercase, strip non-alphanumerics.
export function normalizeHeader(h) {
  return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Given the CSV headers and a set of {field, aliases[]} targets, guess a mapping
// of target field -> csv header (or "" if none found). A column is claimed by at
// most one field, and exact matches win over fuzzy ones — so "First Name" is
// claimed by firstName before the generic `name` field can grab it as a substring.
export function autoMap(headers, targets) {
  const norm = headers.map((h) => ({ raw: h, n: normalizeHeader(h) }));
  const used = new Set();
  const map = {};
  targets.forEach((t) => { map[t.field] = ""; });

  // Phase 1: exact normalized matches across all targets.
  targets.forEach((t) => {
    for (const alias of t.aliases) {
      const an = normalizeHeader(alias);
      const exact = norm.find((h) => !used.has(h.raw) && h.n === an);
      if (exact) { map[t.field] = exact.raw; used.add(exact.raw); return; }
    }
  });

  // Phase 2: fuzzy (substring) matches for anything still unmapped.
  targets.forEach((t) => {
    if (map[t.field]) return;
    for (const alias of t.aliases) {
      const an = normalizeHeader(alias);
      const partial = norm.find((h) => !used.has(h.raw) && h.n && (h.n.includes(an) || an.includes(h.n)));
      if (partial) { map[t.field] = partial.raw; used.add(partial.raw); return; }
    }
  });
  return map;
}

// Parse a date out of a messy cell into ISO YYYY-MM-DD. Handles ISO, US
// M/D/Y (and 2-digit years), and anything Date can parse. Returns "" if unknown.
export function parseDateLoose(v) {
  if (!v) return "";
  const s = String(v).trim();
  const pad = (n) => String(n).padStart(2, "0");
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)))
    return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    let y = Number(m[3]);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return `${y}-${pad(m[1])}-${pad(m[2])}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return "";
}

// Parse a number out of a messy cell like "$32,995.00" or "12,345 mi".
export function parseNumber(v) {
  if (v == null) return null;
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}
