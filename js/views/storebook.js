// The store's owner book, loaded by a manager: a CSV or Excel export of
// every customer the dealership has — the DMS owner list, an AutoAlert
// equity export, a lease-end report — read with the same column matching
// as the rep-side import, then written to the store's book in chunks. From
// there the Customers page ranks them with the reasons and hands them out.

import { esc } from "../utils.js";
import { icon } from "../icons.js";
import { openModal, toast } from "../components.js";
import { parseCSV, autoMap, normalizeHeader } from "../csv.js";
import { parseXLSX } from "../xlsx.js";
import { buildRecord, LEAD_TARGETS } from "./import.js";
import { uploadStoreBook } from "../team.js";

const CHUNK = 400;
const digits = (p) => String(p || "").replace(/\D/g, "");

// A customer's id in the book: the VIN when the export carries one, else
// the phone, else the name and the vehicle — so a second upload of the
// same list updates rather than doubles.
export function bookId(rec) {
  const vin = String(rec.vin || "").trim().toUpperCase();
  if (vin.length >= 11) return "vin:" + vin;
  const ph = digits(rec.phone);
  if (ph.length >= 7) return "ph:" + ph.slice(-10);
  const nm = String(rec.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  return nm ? "nm:" + nm + "|" + String(rec.vehicleInterest || "").trim().toLowerCase() : "";
}

// Parse a file into book rows, with the mapping the import would use.
export async function rowsFromFile(file) {
  const isXlsx = /\.xlsx$/i.test(file.name) || (file.type || "").includes("sheet");
  const parsed = isXlsx ? await parseXLSX(await file.arrayBuffer()) : parseCSV(await file.text());
  if (!parsed.headers.length) throw new Error(`No column headings in ${file.name}`);
  const mapping = autoMap(parsed.headers, LEAD_TARGETS);
  // The lead importer doesn't carry a VIN; the book keys on it when the
  // export has one, so it's read straight from the column.
  const vinCol = parsed.headers.find((h) => /^vin(no|number)?$/.test(normalizeHeader(h))) || parsed.headers.find((h) => /\bvin\b/i.test(h)) || "";
  const out = [];
  let skipped = 0;
  for (const row of parsed.rows) {
    const rec = buildRecord("leads", row, mapping);
    if (vinCol && row[vinCol]) rec.vin = String(row[vinCol]).trim().toUpperCase();
    // Where they came from, in the rep's book: the export's own source when
    // it names one, else the store's book.
    if (!rec.source || /^import$/i.test(rec.source)) rec.source = "Owner book";
    const id = rec.name ? bookId(rec) : "";
    if (!id) { skipped++; continue; }
    out.push({ ...rec, id });
  }
  return { rows: out, skipped, headers: parsed.headers, mapping };
}

export function openStoreBookUpload(team, onDone) {
  let picked = null, parsed = null, busy = false;
  const close = openModal("Load the owner book", (closeModal) => {
    const el = document.createElement("div");
    el.className = "sb-upload";
    const draw = () => {
      el.innerHTML = `
        <div class="small muted">A CSV or Excel export of the store's customers — the DMS owner list, an AutoAlert equity export, a lease-end report. The columns are matched the way the rep-side import matches them: name, phone, vehicle, purchase date, payment, payoff, value, lease end, rate, term, kilometres, service dates. Everyone lands in the store's book, ranked with the reasons they're worth a call, and is handed to a rep from there — nobody is contacted twice.</div>
        <label class="btn btn-primary btn-block" style="margin-top:10px">${icon("file")} ${picked ? esc(picked.name) : "Choose the file"}<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden data-file></label>
        ${parsed ? `<div class="card" style="margin-top:10px"><div class="strong">${parsed.rows.length.toLocaleString()} customers read${parsed.skipped ? ` · ${parsed.skipped} rows without a name skipped` : ""}</div>
          <div class="small muted" style="margin-top:4px">Matched: ${esc(Object.entries(parsed.mapping).filter(([k, v]) => v && !/^_/.test(k)).map(([k, v]) => `${k} ← ${v}`).join(", ").slice(0, 400))}</div>
          <div class="small muted" style="margin-top:4px">${parsed.rows.filter((r) => r.purchaseDate || r.currentPayment != null).length.toLocaleString()} owners with a purchase date or a payment · ${parsed.rows.filter((r) => r.leaseEnd).length.toLocaleString()} with a lease end · ${parsed.rows.filter((r) => r.phone).length.toLocaleString()} with a phone</div>
          <button class="btn btn-primary btn-block" data-act="go" style="margin-top:10px" ${busy ? "disabled" : ""}>${busy ? "Loading…" : `Load ${parsed.rows.length.toLocaleString()} into the store's book`}</button>
          <div class="hint">A customer already in the book keeps their status and their rep and takes the newer fields. Texting an owner still needs their consent on file; the app won't text anyone marked do-not-contact.</div></div>` : ""}`;
      el.querySelector("[data-file]").addEventListener("change", async (e) => {
        const f = e.target.files[0]; if (!f) return;
        picked = f; parsed = null; draw();
        try { parsed = await rowsFromFile(f); } catch (err) { toast(err && err.message ? err.message : "Couldn't read that file", "danger"); }
        draw();
      });
      const go = el.querySelector('[data-act="go"]');
      if (go) go.addEventListener("click", async () => {
        busy = true; draw();
        let written = 0, unassigned = 0;
        try {
          for (let i = 0; i < parsed.rows.length; i += CHUNK) {
            const r = await uploadStoreBook(team, parsed.rows.slice(i, i + CHUNK));
            written += Number(r.written) || 0; unassigned = Number(r.unassigned) || unassigned;
            const b = el.querySelector('[data-act="go"]'); if (b) b.textContent = `Loading… ${Math.min(i + CHUNK, parsed.rows.length).toLocaleString()} of ${parsed.rows.length.toLocaleString()}`;
          }
          toast(`${written.toLocaleString()} in the store's book · ${unassigned.toLocaleString()} not yet handed out`, "success");
          closeModal();
          if (onDone) onDone();
        } catch (err) { toast(err && err.message ? err.message : "Couldn't load the book", "danger"); busy = false; draw(); }
      });
    };
    draw();
    return el;
  }, { focus: false });
  return close;
}
