// Minimal, dependency-free .xlsx reader. An .xlsx file is a ZIP of XML parts;
// we read the central directory, inflate the shared-strings and first worksheet
// with the browser's DecompressionStream, and parse the cells with DOMParser.
// Returns { headers, rows } in the same shape as csv.js's parseCSV.

async function inflateRaw(u8) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser can't read .xlsx — please save the file as CSV and import that.");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

// Extract only the ZIP entries whose name matches a wanted prefix/exact name.
async function unzip(arrayBuffer, wanted) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  // Find End Of Central Directory (scan back from the end).
  let eocd = -1;
  const min = Math.max(0, bytes.length - 22 - 65536);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid .xlsx file.");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const td = new TextDecoder();
  const out = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break; // central dir header
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = td.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    const want = wanted.some((w) => (w.endsWith("/") ? name.startsWith(w) : name === w));
    if (want) {
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = bytes.subarray(dataStart, dataStart + compSize);
      out[name] = method === 0 ? comp : await inflateRaw(comp);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagName("si")).map((si) =>
    Array.from(si.getElementsByTagName("t")).map((t) => t.textContent).join(""));
}

// Column letters from a cell ref ("AB12" → zero-based index 27).
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || "");
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml, shared) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const rowEls = Array.from(doc.getElementsByTagName("row"));
  const grid = [];
  let maxCol = 0;
  rowEls.forEach((rowEl) => {
    const arr = [];
    Array.from(rowEl.getElementsByTagName("c")).forEach((c, i) => {
      const ref = c.getAttribute("r");
      const ci = ref ? colIndex(ref) : i;
      const t = c.getAttribute("t");
      let val = "";
      if (t === "s") {
        const v = c.getElementsByTagName("v")[0];
        val = v ? (shared[parseInt(v.textContent, 10)] || "") : "";
      } else if (t === "inlineStr") {
        const is = c.getElementsByTagName("t")[0];
        val = is ? is.textContent : "";
      } else {
        const v = c.getElementsByTagName("v")[0];
        val = v ? v.textContent : "";
      }
      arr[ci] = val;
      if (ci + 1 > maxCol) maxCol = ci + 1;
    });
    grid.push(arr);
  });
  return grid.map((r) => {
    const out = [];
    for (let i = 0; i < maxCol; i++) out[i] = r[i] != null ? r[i] : "";
    return out;
  });
}

export async function parseXLSX(arrayBuffer) {
  const files = await unzip(arrayBuffer, ["xl/sharedStrings.xml", "xl/worksheets/"]);
  const td = new TextDecoder();
  const shared = parseSharedStrings(files["xl/sharedStrings.xml"] ? td.decode(files["xl/sharedStrings.xml"]) : "");
  const sheetKey =
    Object.keys(files).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0] ||
    Object.keys(files).find((k) => /^xl\/worksheets\/.*\.xml$/.test(k));
  if (!sheetKey) throw new Error("No worksheet found in the .xlsx file.");
  const grid = parseSheet(td.decode(files[sheetKey]), shared);
  if (!grid.length) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => String(h == null ? "" : h).trim());
  const rows = grid.slice(1)
    .map((r) => {
      const o = {};
      headers.forEach((h, i) => { o[h] = (r[i] == null ? "" : String(r[i])).trim(); });
      return o;
    })
    .filter((o) => Object.values(o).some((v) => v !== ""));
  return { headers, rows };
}
