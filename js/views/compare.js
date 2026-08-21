// Side-by-side vehicle comparison — AutoTrader-style, feature by feature.
// Line up Nissans against their cross-shops from the built-in vehicle database
// (~50 vehicles across every segment), your own inventory, or a manual entry —
// then send the whole comparison to a customer as a branded web page (text or
// email) that ends in your booking link.

import * as store from "../store.js";
import { openModal, buildForm, toast, emptyState } from "../components.js";
import { currency, esc, num } from "../utils.js";
import { icon } from "../icons.js";
import { SPEC_LIBRARY, SPEC_DISCLAIMER } from "../specs.js";
import { bookingLink } from "./settings.js";
import * as backend from "../backend.js";

// Unified spec rows. `best` picks a winner across columns: "low" (price, fuel)
// or "high" (power, cargo, towing, seats).
const ROWS = [
  { key: "price", label: "Price / MSRP", best: "low", num: (v) => Number(v.price ?? v.msrp) || null,
    get: (v) => v.price != null && v.price !== "" ? currency(v.price) : v.msrp ? `from ${currency(v.msrp)}` : "—" },
  { key: "engine", label: "Engine", get: (v) => v.engine || "—" },
  { key: "hp", label: "Horsepower", best: "high", num: (v) => Number(v.hp) || null, get: (v) => v.hp ? `${v.hp} hp` : "—" },
  { key: "torque", label: "Torque", best: "high", num: (v) => Number(v.torque) || null, get: (v) => v.torque ? `${v.torque} lb-ft` : "—" },
  { key: "trans", label: "Transmission", get: (v) => v.trans || v.transmission || "—" },
  { key: "fuel", label: "Fuel (combined)", best: "low", num: (v) => Number(v.fuel) || null,
    get: (v) => v.fuel ? `${v.fuel} L/100km` : (v.fuelType || "—") },
  { key: "fuelcity", label: "Fuel (city)", best: "low", num: (v) => Number(v.fuelCity) || null,
    get: (v) => v.fuelCity ? `${v.fuelCity} L/100km` : "—" },
  { key: "fuelhwy", label: "Fuel (highway)", best: "low", num: (v) => Number(v.fuelHwy) || null,
    get: (v) => v.fuelHwy ? `${v.fuelHwy} L/100km` : "—" },
  { key: "fuelreq", label: "Fuel type", get: (v) => v.fuelReq || "—" },
  { key: "range", label: "Electric range", best: "high", num: (v) => Number(v.range) || null,
    get: (v) => v.range ? `~${num(v.range)} km` : "—" },
  { key: "tank", label: "Fuel tank", best: "high", num: (v) => Number(v.tank) || null,
    get: (v) => v.tank ? `${v.tank} L` : "—" },
  { key: "drive", label: "Drivetrain", get: (v) => v.drive || v.drivetrain || "—" },
  { key: "clearance", label: "Ground clearance", best: "high", num: (v) => Number(v.clearance) || null,
    get: (v) => v.clearance ? `${v.clearance} mm` : "—" },
  { key: "length", label: "Length", get: (v) => v.length ? `${num(v.length)} mm` : "—" },
  { key: "seats", label: "Seats", best: "high", num: (v) => Number(v.seats) || null, get: (v) => v.seats || "—" },
  { key: "cargo", label: "Cargo (seats up)", best: "high", num: (v) => Number(v.cargo) || null, get: (v) => v.cargo ? `${num(v.cargo)} L` : "—" },
  { key: "cargomax", label: "Cargo (seats folded)", best: "high", num: (v) => Number(v.cargoMax) || null, get: (v) => v.cargoMax ? `${num(v.cargoMax)} L` : "—" },
  { key: "tow", label: "Towing", best: "high", num: (v) => Number(v.tow) || null, get: (v) => v.tow ? `${num(v.tow)} lb` : "—" },
  { key: "carplay", label: "CarPlay / Android Auto", get: (v) => v.carplay || "—" },
  { key: "heated", label: "Heated seats / wheel", get: (v) => v.heated || "—" },
  { key: "screen", label: "Screen", get: (v) => v.screen || "—" },
  { key: "adas", label: "Driver assistance", get: (v) => v.adas || "—" },
  { key: "warranty", label: "Warranty", get: (v) => v.warranty || "—" },
  { key: "mileage", label: "Mileage", get: (v) => v.mileage != null && v.mileage !== "" ? `${num(v.mileage)} km` : "—" },
  { key: "features", label: "Key features", get: (v) => v.features || v.notes || "—" },
];

function vehName(v) {
  if (v.label) return v.label;
  const n = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
  return n || "Vehicle";
}

// Rows worth showing for this set (skip all-dash rows like Mileage for new cars).
function activeRows(selected) {
  return ROWS.filter((r) => selected.some((v) => r.get(v) !== "—"));
}

// Per-row winning column index (only meaningful with 2+ contenders).
function winners(selected) {
  const w = {};
  if (selected.length < 2) return w;
  ROWS.forEach((r) => {
    if (!r.best) return;
    let bi = -1, bv = null;
    selected.forEach((v, i) => {
      const n = r.num(v);
      if (n == null) return;
      if (bv == null || (r.best === "low" ? n < bv : n > bv)) { bv = n; bi = i; }
    });
    // Only crown a winner when it actually beats someone.
    const vals = selected.map((v) => r.num(v)).filter((n) => n != null);
    if (bi >= 0 && vals.length >= 2 && new Set(vals).size > 1) w[r.key] = bi;
  });
  return w;
}

export function renderCompare(view) {
  const selected = []; // working set of vehicles being compared

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="section-title" style="margin-top:2px">Compare vehicles</div>
    <div id="cmp-table"></div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn-primary btn-block" data-act="add">${icon("plus")} Add vehicle</button>
      <button class="btn btn-ghost btn-block" data-act="share" disabled>${icon("upload")} Send to customer</button>
    </div>
    <div class="fab-note">${esc(SPEC_DISCLAIMER)}</div>
  `;
  view.appendChild(el);

  const tableWrap = el.querySelector("#cmp-table");
  const shareBtn = el.querySelector('[data-act="share"]');

  const draw = () => {
    if (!selected.length) {
      tableWrap.innerHTML = emptyState("compare", "Nothing to compare yet", "Add a Nissan and the vehicle your customer is cross-shopping.");
      shareBtn.disabled = true;
      return;
    }
    shareBtn.disabled = false;
    const rows = activeRows(selected);
    const win = winners(selected);

    // One grid, row-major, so every spec row shares one height and labels
    // always line up with their values.
    const cells = [];
    cells.push(`<div class="cmp-cell cmp-lcell cmp-hcell"></div>`);
    selected.forEach((v, i) => cells.push(
      `<div class="cmp-cell cmp-hcell"><span>${esc(vehName(v))}</span><button class="cmp-x" data-remove="${i}" aria-label="Remove">&times;</button></div>`));
    rows.forEach((r, ri) => {
      const last = ri === rows.length - 1 ? " cmp-last" : "";
      cells.push(`<div class="cmp-cell cmp-lcell${last}">${esc(r.label)}</div>`);
      selected.forEach((v, i) => {
        const isBest = win[r.key] === i;
        cells.push(`<div class="cmp-cell${isBest ? " cmp-best" : ""}${last}">${esc(r.get(v))}${isBest ? ' <span class="cmp-tag">best</span>' : ""}</div>`);
      });
    });
    tableWrap.innerHTML = `
      <div class="cmp-scroll">
        <div class="cmp-grid" style="grid-template-columns: 106px repeat(${selected.length}, minmax(150px, 170px))">
          ${cells.join("")}
        </div>
      </div>`;

    tableWrap.querySelectorAll("[data-remove]").forEach((b) =>
      b.addEventListener("click", () => { selected.splice(Number(b.dataset.remove), 1); draw(); }));
  };

  el.querySelector('[data-act="add"]').addEventListener("click", () =>
    openVehiclePicker((v) => { selected.push(v); draw(); }));

  shareBtn.addEventListener("click", () => openShare(selected));

  draw();
}

// ---------- Picker: spec library (searchable), inventory, AI, manual ----------
function openVehiclePicker(onPick) {
  const inv = store.all("vehicles").filter((v) => v.status !== "sold");
  openModal("Add a vehicle", (close) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="searchbar" style="margin-bottom:10px"><input type="search" id="cmp-q" placeholder="Search ${SPEC_LIBRARY.length} vehicles — RAV4, Forester, Telluride…"></div>
      <div id="cmp-lib"></div>
      <div class="btn-row" style="margin:12px 0 4px">
        <button class="btn btn-ghost btn-block" id="cmp-manual">${icon("edit")} Enter a vehicle manually</button>
      </div>
      ${inv.length ? `<div class="section-title">From your inventory</div><div id="cmp-inv"></div>` : ""}
    `;

    const lib = wrap.querySelector("#cmp-lib");
    const drawLib = (q = "") => {
      const query = q.trim().toLowerCase();
      // Default view leads with the Nissan lineup; search spans the whole DB.
      const list = query
        ? SPEC_LIBRARY.filter((v) => `${v.label} ${v.make}`.toLowerCase().includes(query)).slice(0, 14)
        : SPEC_LIBRARY.filter((v) => v.make === "Nissan");
      lib.innerHTML = "";
      list.forEach((v) => {
        const btn = document.createElement("button");
        btn.className = "btn btn-ghost btn-block";
        btn.style.cssText = "justify-content:space-between;margin-bottom:8px;text-align:left";
        btn.innerHTML = `<span>${v.make === "Nissan" ? icon("car") + " " : ""}${esc(v.label)}</span><span class="mono small muted">from ${esc(currency(v.msrp))}</span>`;
        btn.addEventListener("click", () => { close(); onPick({ ...v }); });
        lib.appendChild(btn);
      });
      if (!list.length) lib.innerHTML = `<div class="muted small" style="text-align:center;margin:8px 0">Not in the database — enter it manually below.</div>`;
    };
    drawLib();
    wrap.querySelector("#cmp-q").addEventListener("input", (e) => drawLib(e.target.value));

    wrap.querySelector("#cmp-manual").addEventListener("click", () => { close(); openCustomForm(onPick); });

    const invBox = wrap.querySelector("#cmp-inv");
    if (invBox) inv.forEach((v) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-ghost btn-block";
      btn.style.cssText = "justify-content:space-between;margin-bottom:8px;text-align:left";
      btn.innerHTML = `<span>${esc(vehName(v))}</span><span class="mono small muted">${v.price != null && v.price !== "" ? esc(currency(v.price)) : ""}</span>`;
      btn.addEventListener("click", () => { close(); onPick({ ...v }); });
      invBox.appendChild(btn);
    });
    return wrap;
  });
}

function openCustomForm(onPick) {
  openModal("Enter a vehicle", (close) => {
    const { element } = buildForm(
      [
        { name: "label", label: "Vehicle", required: true, placeholder: "2024 Honda CR-V EX" },
        { name: "msrp", label: "Price / MSRP", type: "number", inputmode: "decimal", half: true, placeholder: "35000" },
        { name: "hp", label: "Horsepower", type: "number", inputmode: "numeric", half: true, placeholder: "190" },
        { name: "engine", label: "Engine", half: true, placeholder: "1.5L turbo" },
        { name: "torque", label: "Torque (lb-ft)", type: "number", inputmode: "numeric", half: true, placeholder: "225" },
        { name: "trans", label: "Transmission", half: true, placeholder: "CVT / 8-speed" },
        { name: "fuel", label: "Fuel L/100km", type: "number", inputmode: "decimal", half: true, placeholder: "7.9" },
        { name: "drive", label: "Drivetrain", half: true, placeholder: "AWD" },
        { name: "seats", label: "Seats", type: "number", inputmode: "numeric", half: true, placeholder: "5" },
        { name: "cargo", label: "Cargo (L)", type: "number", inputmode: "numeric", half: true, placeholder: "1100" },
        { name: "tow", label: "Towing (lb)", type: "number", inputmode: "numeric", half: true, placeholder: "1500" },
        { name: "warranty", label: "Warranty", placeholder: "3 yr/60,000 km" },
        { name: "features", label: "Key features", type: "textarea", placeholder: "Safety suite, screens, the stuff they care about…" },
      ],
      { submitLabel: "Add to comparison", onSubmit: (data) => { onPick(data); close(); } }
    );
    return element;
  });
}

// ---------- Sharing: a branded web page (plus plain-text fallback) ----------
function compareLink(selected) {
  const s = store.getSettings();
  let book = "";
  try { if (backend.currentUser() && (s.agentUrl || "").trim()) book = bookingLink(); } catch {}
  const rows = activeRows(selected);
  const payload = {
    n: s.salesperson || "", d: s.dealership || "", b: book,
    v: selected.map((v) => ({ name: vehName(v), cells: rows.map((r) => r.get(v)) })),
    r: rows.map((r) => r.label),
    w: winners(selected),
    k: rows.map((r) => r.key),
  };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const base = location.origin + location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
  return `${base}/compare.html?c=${b64}`;
}

function comparisonText(selected) {
  const rows = activeRows(selected);
  const lines = ["Here's the side-by-side we talked about:", ""];
  selected.forEach((v) => {
    lines.push(`• ${vehName(v)}`);
    rows.forEach((r) => { const val = r.get(v); if (val !== "—") lines.push(`   ${r.label}: ${val}`); });
    lines.push("");
  });
  lines.push(SPEC_DISCLAIMER);
  return lines.join("\n").trim();
}

function openShare(selected) {
  if (!selected.length) return;
  const link = compareLink(selected);
  const s = store.getSettings();
  const first = (s.salesperson || "").split(" ")[0];
  const intro = `Hi! ${first ? `It's ${first} — ` : ""}here's the side-by-side comparison we talked about:\n\n${link}`;
  openModal("Send the comparison", (close) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="small muted" style="margin-bottom:12px">The customer gets a clean web page with the full feature-by-feature table${compareHasBooking(link) ? " — ending with a button to book their visit" : ""}.</div>
      <a class="btn btn-primary btn-block" style="margin-bottom:10px" href="sms:?&body=${encodeURIComponent(intro)}">${icon("message")} Text it</a>
      <a class="btn btn-primary btn-block" style="margin-bottom:10px" href="mailto:?subject=${encodeURIComponent("Your vehicle comparison")}&body=${encodeURIComponent(intro + "\n\n" + comparisonText(selected))}">${icon("mail")} Email it</a>
      <button class="btn btn-ghost btn-block" style="margin-bottom:10px" id="sh-copy">${icon("file")} Copy the link</button>
      <button class="btn btn-ghost btn-block" id="sh-copytext">Copy as plain text</button>
    `;
    wrap.querySelector("#sh-copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link); toast("Link copied", "success"); close(); } catch { toast("Couldn't copy", "danger"); }
    });
    wrap.querySelector("#sh-copytext").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(comparisonText(selected)); toast("Copied", "success"); close(); } catch { toast("Couldn't copy", "danger"); }
    });
    return wrap;
  });
}

function compareHasBooking(link) {
  try { return JSON.parse(decodeURIComponent(escape(atob(link.split("?c=")[1].replace(/-/g, "+").replace(/_/g, "/"))))).b; }
  catch { return false; }
}
