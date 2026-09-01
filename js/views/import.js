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
  // Decoy first: AutoAlert exports carry the PROPOSED deal alongside the
  // customer's current one. These columns must be claimed and dropped so the
  // fuzzy matcher can't feed "New Payment" into the current-payment field —
  // that would poison the Deal Radar. (hidden: never shown in the mapping UI.)
  { field: "_skipProposed", label: "(ignored)", hidden: true, aliases: ["new payment", "new pmt", "new monthly payment", "proposed payment", "upgrade payment", "new rate", "new apr", "new term", "new vehicle", "new year", "new make", "new model", "sale price", "delta payment", "payment difference"] },
  { field: "name", label: "Name", aliases: ["name", "customer", "customer name", "full name", "contact", "owner", "owner name", "client", "client name", "buyer", "buyer name"] },
  // (no bare "first"/"last" aliases — they fuzzy-matched service columns
  // like "Last RO" and corrupted names)
  { field: "firstName", label: "First name", aliases: ["first name", "firstname"] },
  { field: "lastName", label: "Last name", aliases: ["last name", "lastname", "surname"] },
  { field: "phone", label: "Phone", aliases: ["phone", "phone number", "mobile", "cell", "cell phone", "primary phone", "mobile phone", "best phone", "contact phone", "phone 1"] },
  { field: "phone2", label: "Phone (backup)", aliases: ["home phone", "work phone", "phone 2", "secondary phone", "alt phone", "other phone", "evening phone", "day phone"] },
  { field: "email", label: "Email", aliases: ["email", "e-mail", "email address"] },
  { field: "vehicleInterest", label: "Vehicle (one column)", aliases: ["vehicle", "vehicle of interest", "interest", "desired vehicle", "trade", "current vehicle", "vehicle owned", "purchased vehicle", "year make model", "vehicle description"] },
  // AutoAlert-style exports split the owned vehicle across columns — these
  // recombine into one vehicle string at import time.
  { field: "vehYear", label: "Vehicle year", aliases: ["year", "model year", "yr", "vehicle year", "curr year", "current year"], type: "number" },
  { field: "vehMake", label: "Vehicle make", aliases: ["make", "vehicle make", "curr make", "current make"] },
  { field: "vehModel", label: "Vehicle model", aliases: ["model", "vehicle model", "curr model", "current model"] },
  { field: "vehTrim", label: "Vehicle trim", aliases: ["trim", "series", "vehicle trim"] },
  { field: "purchaseDate", label: "Purchase / sale date", aliases: ["purchase date", "sale date", "sold date", "delivery date", "date sold", "deal date", "contract date", "purchased", "closing date", "date of sale", "date delivered", "delivered date", "orig purchase date"] },
  { field: "leaseEnd", label: "Lease end date", aliases: ["lease end", "lease maturity", "maturity date", "lease end date", "term end", "lease expiration", "lease exp", "maturity", "contract end date", "term end date"] },
  { field: "dob", label: "Birthday", aliases: ["birthday", "birth date", "date of birth", "dob", "customer birthday"] },
  // Financial fields (e.g. from an AutoAlert equity export) power the Deal Builder.
  { field: "currentPayment", label: "Current payment / mo", aliases: ["payment", "current payment", "monthly payment", "current pmt", "pmt", "monthly pmt", "current monthly payment", "curr payment", "est payment", "estimated payment"] },
  { field: "payoff", label: "Loan payoff / balance", aliases: ["payoff", "payoff amount", "balance", "loan balance", "current payoff", "amount owed", "remaining balance", "buyout", "est payoff", "estimated payoff", "payoff amt", "current balance"] },
  { field: "currentValue", label: "Current vehicle value", aliases: ["value", "current value", "acv", "estimated value", "trade value", "book value", "kbb", "market value", "appraised value", "wholesale value", "est value", "est trade value", "estimated trade value", "trade in value", "black book", "cbb", "cash value", "vehicle value"] },
  { field: "equity", label: "Equity", aliases: ["equity", "current equity", "positive equity", "net equity", "est equity", "estimated equity"] },
  { field: "currentApr", label: "Current APR %", aliases: ["apr", "rate", "interest rate", "current rate", "current apr", "buy rate", "int rate", "current int rate", "customer rate"] },
  { field: "alertType", label: "Alert / opportunity", aliases: ["alert", "alerts", "alert type", "alert types", "opportunity", "opportunity type", "flex alert", "flex alerts", "upgrade alert", "service alert", "categories", "category"] },
  { field: "priority", label: "Priority", aliases: ["priority", "alert priority", "rank", "score"] },
  { field: "dealType", label: "Deal type (lease/retail)", aliases: ["deal type", "sale type", "contract type", "finance type", "purchase type"] },
  // Service-drive columns (AutoAlert priority lists): an upcoming RO
  // appointment becomes a follow-up — meet them in the service drive.
  { field: "serviceAppt", label: "Service appointment", aliases: ["ro appt", "ro appointment", "service appt", "service appointment", "appt date", "next service", "next appt", "upcoming appt"] },
  { field: "lastService", label: "Last service visit", aliases: ["last ro", "last ro date", "last service", "last service date", "last visit", "last repair order"] },
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
    <div class="fab-note">Rows missing required info (${type === "vehicles" ? "make & model" : "a name"}) are skipped. Rows that match an existing ${type === "vehicles" ? "vehicle (by VIN or stock #)" : "customer (by phone or email)"} are <b>merged</b> into that record — so each file you import deepens the profile instead of creating duplicates.</div>
  `;

  const mapRows = stage.querySelector(".map-rows");
  targets.filter((t) => !t.hidden).forEach((t) => {
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
    const verb = type === "vehicles" ? "updated" : "enriched";
    const parts = [`${result.added} new`];
    if (result.updated) parts.push(`${result.updated} ${verb}`);
    if (result.unchanged) parts.push(`${result.unchanged} already current`);
    if (result.skipped) parts.push(`${result.skipped} skipped`);
    const extra = outreach ? ` · outreach started for ${outreach}` : "";
    toast(`Import complete — ${parts.join(", ")}${extra}`, "success");
    // Land on a filter that actually shows what was just imported — past
    // customers come in at "delivered", which the default Active filter hides.
    if (type === "leads") { try { sessionStorage.setItem("leads-filter", "all"); } catch {} }
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
  // leads: combine first/last if a single name isn't provided; flip
  // "Shokar, Parm" (the AutoAlert/DMS convention) to "Parm Shokar".
  let name = val("name");
  if (!name) name = [val("firstName"), val("lastName")].filter(Boolean).join(" ");
  const flip = /^([^,\d]+),\s*(.+)$/.exec(name);
  if (flip) name = `${flip[2].trim()} ${flip[1].trim()}`;

  // Phones: Excel loves turning them into scientific notation; and when the
  // primary column is blank for a row, fall back to the home/work column.
  const cleanPhone = (v) => {
    let s = String(v || "").trim();
    if (/e\+?\d+/i.test(s) || /^\d+\.\d+$/.test(s)) {
      const n = Number(s);
      if (isFinite(n)) s = String(Math.round(n));
    }
    return s;
  };
  const phone = cleanPhone(val("phone")) || cleanPhone(val("phone2"));

  // Vehicle: one combined column, or recombined from year/make/model/trim.
  const vehicle = val("vehicleInterest") ||
    [parseNumber(val("vehYear")), val("vehMake"), val("vehModel"), val("vehTrim")].filter(Boolean).join(" ");

  const purchaseDate = parseDateLoose(val("purchaseDate"));
  const currentPayment = parseNumber(val("currentPayment"));
  const payoff = parseNumber(val("payoff"));
  const equity = parseNumber(val("equity"));
  let currentValue = parseNumber(val("currentValue"));
  // If value isn't given but equity is, derive it (value = payoff + equity).
  if (currentValue == null && equity != null && payoff != null) currentValue = payoff + equity;

  // Alert/deal/service context lands in notes so the "why call them" travels
  // with the profile ("AutoAlert: Lease Maturity · Priority: Ultra High").
  const alertType = val("alertType");
  const dealType = val("dealType");
  const priority = val("priority");
  const serviceAppt = parseDateLoose(val("serviceAppt"));
  const lastService = parseDateLoose(val("lastService"));
  const context = [
    alertType && `AutoAlert: ${alertType}`,
    priority && `Priority: ${priority}`,
    dealType && `Deal type: ${dealType}`,
    serviceAppt && `Service appt ${serviceAppt} — meet them in the drive`,
    lastService && `Last service ${lastService}`,
  ].filter(Boolean).join(" · ");
  const notes = [context, val("notes")].filter(Boolean).join("\n");

  const isCustomer = !!(purchaseDate || currentPayment != null);
  return {
    name,
    phone,
    email: val("email"),
    vehicleInterest: vehicle,
    source: val("source") || (alertType || priority ? "AutoAlert" : "Import"),
    notes,
    purchaseDate,
    leaseEnd: parseDateLoose(val("leaseEnd")),
    dob: parseDateLoose(val("dob")),
    currentPayment,
    payoff,
    currentValue,
    currentApr: parseNumber(val("currentApr")),
    // A booked service visit is a date with the customer — surface it as a
    // follow-up so they show on the dashboard that day.
    followUp: serviceAppt || null,
    // Rows with a purchase date or current payment are existing customers (feed
    // the equity call list + Deal Builder), not new pipeline leads.
    stage: isCustomer ? "delivered" : "new",
  };
}

const digits = (p) => String(p || "").replace(/\D/g, "");

// Merge an incoming record into an existing customer, returning a patch of only
// the fields that actually change. The goal: every file you import deepens the
// same profile instead of creating a duplicate or clobbering good data.
//   · identity/contact  → fill only if we don't already have it
//   · name              → prefer the fuller version ("Ken Adams" over "Ken")
//   · money / odometer  → take the newest value (a fresh export is more current)
//   · notes             → append what's new instead of overwriting
//   · stage/followUp/id → never touched by an import
function mergeLead(existing, incoming) {
  const patch = {};
  const empty = (v) => v === "" || v == null;

  ["phone", "email", "dob", "source", "vehicleInterest", "purchaseDate", "leaseEnd", "followUp"].forEach((k) => {
    if (!empty(incoming[k]) && empty(existing[k])) patch[k] = incoming[k];
  });
  if (!empty(incoming.name) && String(incoming.name).length > String(existing.name || "").length) {
    patch.name = incoming.name;
  }
  // Upgrade a partial vehicle ("2019") to the fuller version ("2019 Rogue")
  // when the existing value is clearly a fragment of the incoming one.
  if (!empty(incoming.vehicleInterest) && !empty(existing.vehicleInterest) &&
      incoming.vehicleInterest.length > existing.vehicleInterest.length &&
      incoming.vehicleInterest.toLowerCase().includes(existing.vehicleInterest.toLowerCase())) {
    patch.vehicleInterest = incoming.vehicleInterest;
  }
  ["currentPayment", "payoff", "currentValue", "currentApr"].forEach((k) => {
    if (!empty(incoming[k])) patch[k] = incoming[k];
  });
  if (!empty(incoming.notes)) {
    const cur = String(existing.notes || "");
    if (!cur.includes(incoming.notes)) patch.notes = cur ? `${cur}\n${incoming.notes}` : incoming.notes;
  }
  return patch;
}

function runImport(type, rows, mapping) {
  let added = 0, updated = 0, skipped = 0, unchanged = 0;
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
    // Index existing customers by phone and email — and by name as a last
    // resort, because some exports (AutoAlert service/priority lists) carry
    // no contact columns at all and would otherwise duplicate on re-import.
    const byPhone = new Map();
    const byEmail = new Map();
    const byName = new Map();
    const nameKey = (n) => String(n || "").toLowerCase().replace(/[^a-z]/g, "");
    store.all("leads").forEach((l) => {
      if (l.phone) byPhone.set(digits(l.phone), l);
      if (l.email) byEmail.set(l.email.toLowerCase(), l);
      if (l.name) byName.set(nameKey(l.name), l);
    });

    rows.forEach((row) => {
      const rec = buildRecord("leads", row, mapping);
      if (!rec.name) { skipped++; return; }
      const ph = digits(rec.phone);
      const em = rec.email ? rec.email.toLowerCase() : "";
      const match = (ph && byPhone.get(ph)) || (em && byEmail.get(em)) || byName.get(nameKey(rec.name)) || null;

      if (match) {
        const patch = mergeLead(match, rec);
        if (Object.keys(patch).length) {
          store.update("leads", match.id, patch);
          Object.assign(match, patch); // keep our in-memory copy current
          updated++;
        } else {
          unchanged++;
        }
        // A newly-learned phone/email lets later rows match this same person.
        if (match.phone) byPhone.set(digits(match.phone), match);
        if (match.email) byEmail.set(match.email.toLowerCase(), match);
        if (match.name) byName.set(nameKey(match.name), match);
      } else {
        const created = store.create("leads", rec);
        addedIds.push(created.id);
        added++;
        if (ph) byPhone.set(ph, created);
        if (em) byEmail.set(em, created);
        byName.set(nameKey(created.name), created);
      }
    });
  }
  return { added, updated, skipped, unchanged, addedIds };
}
