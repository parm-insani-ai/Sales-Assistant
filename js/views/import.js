// Spreadsheet (CSV) importer for inventory and leads. Reads a vAuto / AutoAlert
// / website / generic export, auto-maps columns, previews, then imports with
// de-duplication. No backend or credentials needed.

import * as store from "../store.js";
import { toast, emptyState } from "../components.js";
import { navigate } from "../router.js";
import { parseCSV, autoMap, parseNumber, parseDateLoose, normalizeHeader } from "../csv.js";
import { parseXLSX } from "../xlsx.js";
import { startCadence } from "../cadence.js";
import { esc, num, currency } from "../utils.js";
import { icon } from "../icons.js";

// Target field definitions per import type. `aliases` cover common export headers.
const VEHICLE_TARGETS = [
  { field: "year", label: "Year", aliases: ["year", "yr", "model year"], type: "number" },
  { field: "make", label: "Make", aliases: ["make", "manufacturer"] },
  { field: "model", label: "Model", aliases: ["model", "carline"] },
  { field: "trim", label: "Trim", aliases: ["trim", "series", "style"] },
  { field: "price", label: "Price", aliases: ["price", "internet price", "list price", "selling price", "retail price", "asking price", "sale price"], type: "number" },
  { field: "mileage", label: "Mileage", aliases: ["mileage", "miles", "odometer", "odom"], type: "number" },
  { field: "vin", label: "VIN", aliases: ["vin"] },
  { field: "stock", label: "Stock #", aliases: ["stock", "stock number", "stock no", "stocknum", "stk"] },
  { field: "color", label: "Color", aliases: ["color", "exterior color", "ext color", "exterior", "colour"] },
  { field: "transmission", label: "Transmission", aliases: ["transmission", "trans"] },
  { field: "fuelType", label: "Fuel", aliases: ["fuel", "fuel type", "engine fuel"] },
  { field: "bodyStyle", label: "Body style", aliases: ["body", "body style", "bodystyle", "type"] },
  { field: "condition", label: "Condition", aliases: ["condition", "new used", "type", "certified"] },
  { field: "notes", label: "Notes", aliases: ["notes", "comments", "description", "options", "features"] },
];

const LEAD_TARGETS = [
  { field: "name", label: "Name", aliases: ["name", "customer", "customer name", "full name", "contact"] },
  { field: "firstName", label: "First name", aliases: ["first name", "firstname", "first"] },
  { field: "lastName", label: "Last name", aliases: ["last name", "lastname", "last", "surname"] },
  { field: "phone", label: "Phone", aliases: ["phone", "phone number", "mobile", "cell", "cell phone", "primary phone"] },
  { field: "email", label: "Email", aliases: ["email", "e-mail", "email address"] },
  { field: "vehicleInterest", label: "Vehicle of interest / owned", aliases: ["vehicle", "vehicle of interest", "interest", "desired vehicle", "trade", "current vehicle", "vehicle owned", "purchased vehicle", "year make model"] },
  { field: "purchaseDate", label: "Purchase / sale date", aliases: ["purchase date", "sale date", "sold date", "delivery date", "date sold", "deal date", "contract date", "purchased", "closing date", "date of sale"] },
  { field: "leaseEnd", label: "Lease end date", aliases: ["lease end", "lease maturity", "maturity date", "lease end date", "term end", "lease expiration", "lease exp"] },
  { field: "dob", label: "Birthday", aliases: ["birthday", "birth date", "date of birth", "dob"] },
  // Financial fields (e.g. from an AutoAlert equity export) power the Deal Builder.
  { field: "currentPayment", label: "Current payment / mo", aliases: ["payment", "current payment", "monthly payment", "current pmt", "pmt", "monthly pmt", "current monthly payment"] },
  { field: "payoff", label: "Loan payoff / balance", aliases: ["payoff", "payoff amount", "balance", "loan balance", "current payoff", "amount owed", "remaining balance", "buyout"] },
  { field: "currentValue", label: "Current vehicle value", aliases: ["value", "current value", "acv", "estimated value", "trade value", "book value", "kbb", "market value", "appraised value", "wholesale value"] },
  { field: "equity", label: "Equity", aliases: ["equity", "current equity", "positive equity", "net equity"] },
  { field: "currentApr", label: "Current APR %", aliases: ["apr", "rate", "interest rate", "current rate", "current apr", "buy rate"] },
  { field: "source", label: "Source", aliases: ["source", "lead source", "origin"] },
  { field: "notes", label: "Notes", aliases: ["notes", "comments", "remarks"] },
];

export function renderImport(view) {
  const el = document.createElement("div");
  // Optional preselect (e.g. from the Leads page "Import prospects" button).
  let preType = "";
  try { preType = sessionStorage.getItem("import-type") || ""; sessionStorage.removeItem("import-type"); } catch {}

  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-act="back" style="margin-bottom:12px">← Home</button>
    <div class="card">
      <div class="strong" style="font-size:1.1rem">Import a spreadsheet</div>
      <p class="small muted">Load an <b>Excel (.xlsx)</b> or <b>CSV</b> file — an inventory export from vAuto, a customer/equity export from AutoAlert, or your own prospect list.</p>

      <div class="field">
        <label>What are you importing?</label>
        <select id="imp-type">
          <option value="vehicles" ${preType !== "leads" ? "selected" : ""}>Inventory (vehicles)</option>
          <option value="leads" ${preType === "leads" ? "selected" : ""}>Leads / prospects / past customers</option>
        </select>
        <div class="hint">Past customers with a <b>purchase date</b> fill your equity &amp; anniversary call list; an <b>AutoAlert equity export</b> (payment, payoff, value) powers the Deal Builder.</div>
      </div>

      <label class="switch" id="imp-outreach-wrap" style="margin:2px 0 14px;${preType === "leads" ? "" : "display:none"}">
        <input id="imp-outreach" type="checkbox" checked>
        <span>Automate outreach — start a follow-up plan (calls/texts) for each imported prospect</span>
      </label>

      <label class="btn btn-primary btn-block" for="imp-file">${icon("file")} Choose Excel or CSV file</label>
      <input id="imp-file" type="file" accept=".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none">
      <div class="hint">Everything stays on your device — the file isn't uploaded anywhere.</div>
    </div>
    <div id="imp-stage"></div>
  `;
  view.appendChild(el);

  el.querySelector('[data-act="back"]').addEventListener("click", () => navigate("/"));

  // Show the outreach toggle only for lead/prospect imports.
  const typeSel = el.querySelector("#imp-type");
  const outreachWrap = el.querySelector("#imp-outreach-wrap");
  typeSel.addEventListener("change", () => {
    outreachWrap.style.display = typeSel.value === "leads" ? "" : "none";
  });

  const stage = el.querySelector("#imp-stage");
  el.querySelector("#imp-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isXlsx = /\.xlsx$/i.test(file.name) || (file.type || "").includes("sheet");
    let parsed;
    try {
      parsed = isXlsx ? await parseXLSX(await file.arrayBuffer()) : parseCSV(await file.text());
    } catch (err) {
      toast(err && err.message ? err.message : "Couldn't read that file", "danger");
      return;
    }
    if (!parsed.headers.length || !parsed.rows.length) {
      stage.innerHTML = emptyState("file", "No rows found", "Make sure the sheet has a header row and at least one data row.");
      return;
    }
    showMapping(stage, typeSel.value, parsed, { outreach: () => el.querySelector("#imp-outreach")?.checked });
  });
}

function showMapping(stage, type, parsed, opts = {}) {
  const targets = type === "vehicles" ? VEHICLE_TARGETS : LEAD_TARGETS;
  const mapping = autoMap(parsed.headers, targets);
  const noneOpt = '<option value="">— none —</option>';

  stage.innerHTML = `
    <div class="section-title">Match your columns</div>
    <div class="card">
      <p class="small muted">We matched your file's columns automatically. Fix any that are wrong.</p>
      <div class="map-rows"></div>
    </div>
    <div class="section-title">Preview <span class="muted small">(first 3 rows)</span></div>
    <div class="card" id="imp-preview"></div>
    <button class="btn btn-success btn-block" data-act="run" style="margin-top:6px">Import ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"}</button>
    <div class="fab-note">Rows missing required info (${type === "vehicles" ? "make & model" : "a name"}) are skipped. Existing ${type} are updated when they match.</div>
  `;

  const mapRows = stage.querySelector(".map-rows");
  targets.forEach((t) => {
    const row = document.createElement("div");
    row.className = "field";
    row.innerHTML = `
      <label>${esc(t.label)}</label>
      <select data-field="${t.field}">
        ${noneOpt}
        ${parsed.headers.map((h) => `<option value="${esc(h)}" ${mapping[t.field] === h ? "selected" : ""}>${esc(h)}</option>`).join("")}
      </select>`;
    mapRows.appendChild(row);
  });

  const readMapping = () => {
    const m = {};
    mapRows.querySelectorAll("select[data-field]").forEach((s) => { m[s.dataset.field] = s.value; });
    return m;
  };

  const drawPreview = () => {
    const m = readMapping();
    const preview = stage.querySelector("#imp-preview");
    const rows = parsed.rows.slice(0, 3).map((r) => buildRecord(type, r, m));
    preview.innerHTML = rows.map((rec) => {
      if (type === "vehicles") {
        return `<div class="kv"><span class="k">${esc([rec.year, rec.make, rec.model, rec.trim].filter(Boolean).join(" ") || "—")}</span><span class="v mono">${rec.price != null ? currency(rec.price) : ""}${rec.mileage != null ? " · " + num(rec.mileage) + " mi" : ""}</span></div>`;
      }
      return `<div class="kv"><span class="k">${esc(rec.name || "—")}</span><span class="v small">${esc(rec.phone || rec.email || "")}</span></div>`;
    }).join("") || `<div class="muted small">Nothing to preview.</div>`;
  };
  drawPreview();
  mapRows.querySelectorAll("select").forEach((s) => s.addEventListener("change", drawPreview));

  stage.querySelector('[data-act="run"]').addEventListener("click", () => {
    const m = readMapping();
    const result = runImport(type, parsed.rows, m);
    // Automate outreach: start a follow-up cadence on each newly-created prospect.
    let outreach = 0;
    if (type === "leads" && opts.outreach && opts.outreach()) {
      result.addedIds.forEach((id) => {
        const l = store.get("leads", id);
        if (l && l.stage === "new") { startCadence(id); outreach++; }
      });
    }
    const extra = outreach ? ` · outreach started for ${outreach}` : "";
    toast(`Imported ${result.added} new, updated ${result.updated}${result.skipped ? `, skipped ${result.skipped}` : ""}${extra}`, "success");
    navigate(type === "vehicles" ? "/inventory" : "/leads");
  });
}

// Turn a raw CSV row into a typed record using the column mapping.
function buildRecord(type, row, mapping) {
  const val = (field) => (mapping[field] ? (row[mapping[field]] ?? "").trim() : "");
  if (type === "vehicles") {
    return {
      year: parseNumber(val("year")),
      make: val("make"),
      model: val("model"),
      trim: val("trim"),
      price: parseNumber(val("price")),
      mileage: parseNumber(val("mileage")),
      vin: val("vin"),
      stock: val("stock"),
      color: val("color"),
      transmission: val("transmission"),
      fuelType: val("fuelType"),
      bodyStyle: val("bodyStyle"),
      condition: val("condition") || "Used",
      notes: val("notes"),
      status: "available",
    };
  }
  // leads: combine first/last if a single name isn't provided.
  let name = val("name");
  if (!name) name = [val("firstName"), val("lastName")].filter(Boolean).join(" ");
  const purchaseDate = parseDateLoose(val("purchaseDate"));
  const currentPayment = parseNumber(val("currentPayment"));
  const payoff = parseNumber(val("payoff"));
  const equity = parseNumber(val("equity"));
  let currentValue = parseNumber(val("currentValue"));
  // If value isn't given but equity is, derive it (value = payoff + equity).
  if (currentValue == null && equity != null && payoff != null) currentValue = payoff + equity;
  const isCustomer = !!(purchaseDate || currentPayment != null);
  return {
    name,
    phone: val("phone"),
    email: val("email"),
    vehicleInterest: val("vehicleInterest"),
    source: val("source") || "Import",
    notes: val("notes"),
    purchaseDate,
    leaseEnd: parseDateLoose(val("leaseEnd")),
    dob: parseDateLoose(val("dob")),
    currentPayment,
    payoff,
    currentValue,
    currentApr: parseNumber(val("currentApr")),
    // Rows with a purchase date or current payment are existing customers (feed
    // the equity call list + Deal Builder), not new pipeline leads.
    stage: isCustomer ? "delivered" : "new",
  };
}

function runImport(type, rows, mapping) {
  let added = 0, updated = 0, skipped = 0;
  const addedIds = [];

  if (type === "vehicles") {
    const existing = store.all("vehicles");
    rows.forEach((row) => {
      const rec = buildRecord("vehicles", row, mapping);
      if (!rec.make || !rec.model) { skipped++; return; }
      // Match on VIN, else stock number.
      const match = existing.find((v) =>
        (rec.vin && v.vin && normalizeHeader(v.vin) === normalizeHeader(rec.vin)) ||
        (rec.stock && v.stock && normalizeHeader(v.stock) === normalizeHeader(rec.stock)));
      if (match) {
        // Only overwrite fields we actually have values for.
        const patch = {};
        Object.entries(rec).forEach(([k, val]) => { if (val !== "" && val != null) patch[k] = val; });
        store.update("vehicles", match.id, patch);
        updated++;
      } else {
        store.create("vehicles", rec);
        added++;
      }
    });
  } else {
    const existing = store.all("leads");
    rows.forEach((row) => {
      const rec = buildRecord("leads", row, mapping);
      if (!rec.name) { skipped++; return; }
      const digits = (p) => String(p || "").replace(/\D/g, "");
      const match = existing.find((l) =>
        (rec.phone && l.phone && digits(l.phone) === digits(rec.phone)) ||
        (rec.email && l.email && l.email.toLowerCase() === rec.email.toLowerCase()));
      if (match) {
        const patch = {};
        Object.entries(rec).forEach(([k, val]) => { if (val !== "" && val != null && k !== "stage") patch[k] = val; });
        store.update("leads", match.id, patch);
        updated++;
      } else {
        const created = store.create("leads", rec);
        addedIds.push(created.id);
        added++;
      }
    });
  }
  return { added, updated, skipped, addedIds };
}
