// Side-by-side vehicle comparison — AutoTrader-style, feature by feature.
// Line up Nissans against their cross-shops from the built-in spec library,
// your own inventory, an AI-filled spec sheet for anything else, or a manual
// entry — then send the whole comparison to a customer as a branded web page
// (text or email) that ends in your booking link.

import * as store from "../store.js";
import { openModal, buildForm, toast, emptyState } from "../components.js";
import { currency, esc, num } from "../utils.js";
import { icon } from "../icons.js";
import { SPEC_LIBRARY, SPEC_DISCLAIMER } from "../specs.js";
import { agentConfigured } from "../agent.js";
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
  { key: "fuelreq", label: "Fuel type", get: (v) => v.fuelReq || "—" },
  { key: "drive", label: "Drivetrain", get: (v) => v.drive || v.drivetrain || "—" },
  { key: "clearance", label: "Ground clearance", best: "high", num: (v) => Number(v.clearance) || null,
    get: (v) => v.clearance ? `${v.clearance} mm` : "—" },
  { key: "seats", label: "Seats", best: "high", num: (v) => Number(v.seats) || null, get: (v) => v.seats || "—" },
  { key: "cargo", label: "Cargo", best: "high", num: (v) => Number(v.cargo) || null, get: (v) => v.cargo ? `${num(v.cargo)} L` : "—" },
  { key: "tow", label: "Towing", best: "high", num: (v) => Number(v.tow) || null, get: (v) => v.tow ? `${num(v.tow)} lb` : "—" },
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

    const cols = selected.map((v, i) => `
      <div class="cmp-col">
        <div class="cmp-head">
          <div class="cmp-name">${esc(vehName(v))}</div>
          <button class="cmp-x" data-remove="${i}" aria-label="Remove">&times;</button>
        </div>
        ${rows.map((r) => {
          const isBest = win[r.key] === i;
          return `<div class="cmp-cell${isBest ? " cmp-best" : ""}">${esc(r.get(v))}${isBest ? ' <span class="cmp-tag">best</span>' : ""}</div>`;
        }).join("")}
      </div>`).join("");

    tableWrap.innerHTML = `
      <div class="cmp-scroll">
        <div class="cmp-col cmp-labels">
          <div class="cmp-head"><div class="cmp-name muted small">Spec</div></div>
          ${rows.map((r) => `<div class="cmp-cell muted small">${esc(r.label)}</div>`).join("")}
        </div>
        ${cols}
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
      <div class="searchbar" style="margin-bottom:10px"><input type="search" id="cmp-q" placeholder="Search the spec library…"></div>
      <div id="cmp-lib"></div>
      <div class="btn-row" style="margin:12px 0 4px">
        ${agentConfigured() ? `<button class="btn btn-ghost btn-block" id="cmp-ai">${icon("sparkles")} Ask AI for any vehicle</button>` : ""}
        <button class="btn btn-ghost btn-block" id="cmp-manual">${icon("edit")} Enter manually</button>
      </div>
      ${inv.length ? `<div class="section-title">From your inventory</div><div id="cmp-inv"></div>` : ""}
    `;

    const lib = wrap.querySelector("#cmp-lib");
    const drawLib = (q = "") => {
      const query = q.trim().toLowerCase();
      const list = (query
        ? SPEC_LIBRARY.filter((v) => `${v.label} ${v.make}`.toLowerCase().includes(query))
        : SPEC_LIBRARY
      ).slice(0, query ? 12 : 8);
      lib.innerHTML = "";
      list.forEach((v) => {
        const btn = document.createElement("button");
        btn.className = "btn btn-ghost btn-block";
        btn.style.cssText = "justify-content:space-between;margin-bottom:8px;text-align:left";
        btn.innerHTML = `<span>${v.make === "Nissan" ? icon("car") + " " : ""}${esc(v.label)}</span><span class="mono small muted">from ${esc(currency(v.msrp))}</span>`;
        btn.addEventListener("click", () => { close(); onPick({ ...v }); });
        lib.appendChild(btn);
      });
      if (!list.length) lib.innerHTML = `<div class="muted small" style="text-align:center;margin:8px 0">Not in the library — use AI or manual entry below.</div>`;
    };
    drawLib();
    wrap.querySelector("#cmp-q").addEventListener("input", (e) => drawLib(e.target.value));

    const ai = wrap.querySelector("#cmp-ai");
    if (ai) ai.addEventListener("click", () => { close(); openAIFill(onPick); });
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

// AI spec fill: the Claude relay returns a JSON spec sheet for any vehicle.
function openAIFill(onPick) {
  openModal("AI spec sheet", (close) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="field"><label>Vehicle</label><input id="ai-name" placeholder="2025 Subaru Forester Touring"></div>
      <button class="btn btn-primary btn-block" id="ai-go">${icon("sparkles")} Fetch specs</button>
      <div class="hint" id="ai-out" style="margin-top:10px">${esc(SPEC_DISCLAIMER)}</div>
    `;
    wrap.querySelector("#ai-go").addEventListener("click", async () => {
      const name = wrap.querySelector("#ai-name").value.trim();
      const out = wrap.querySelector("#ai-out");
      if (!name) { out.textContent = "Type a vehicle first."; return; }
      const btn = wrap.querySelector("#ai-go");
      btn.disabled = true;
      out.textContent = "Asking…";
      try {
        const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system: 'Return ONLY a JSON object (no prose, no code fences) describing the requested vehicle for the Canadian market, base trim, with keys: label (string, year make model), msrp (number, CAD), engine (string), hp (number), torque (number, lb-ft, or null), trans (string, e.g. "CVT" or "8-speed auto"), fuel (number, combined L/100km), fuelReq (string, "Regular"/"Premium"/"Electric"), drive (string), clearance (number, ground clearance in mm, or null), seats (number), cargo (number, litres, or null), tow (number, lb, or null), heated (string, heated seats/wheel availability), screen (string, infotainment size), adas (string, the driver-assistance suite), warranty (string), features (string, the 2-3 standout features). Approximate values are fine.',
            messages: [{ role: "user", content: name }],
            max_tokens: 400,
          }),
        });
        const j = await res.json();
        if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
        const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
        const spec = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
        if (!spec.label) spec.label = name;
        close();
        onPick(spec);
        toast("Specs added — double-check the numbers", "success");
      } catch (e) {
        out.textContent = `Couldn't fetch specs (${e.message || "error"}) — try manual entry.`;
        btn.disabled = false;
      }
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
