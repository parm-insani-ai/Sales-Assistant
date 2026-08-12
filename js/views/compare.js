// Side-by-side vehicle comparison — AutoTrader-style. Line up cars from your
// own inventory (or a "cross-shop" car the customer is also considering) on
// price, mileage, fuel, drivetrain and features, then share the comparison
// straight to the customer.

import * as store from "../store.js";
import { openModal, buildForm, toast, emptyState } from "../components.js";
import { currency, esc, num } from "../utils.js";
import { icon } from "../icons.js";

const ROWS = [
  { label: "Price", get: (v) => (v.price != null && v.price !== "" ? currency(v.price) : "—") },
  { label: "Mileage", get: (v) => (v.mileage != null && v.mileage !== "" ? num(v.mileage) + " mi" : "—") },
  { label: "Fuel", get: (v) => v.fuelType || "—" },
  { label: "Drivetrain", get: (v) => v.drivetrain || v.transmission || "—" },
  { label: "Body", get: (v) => v.bodyStyle || "—" },
  { label: "Color", get: (v) => v.color || "—" },
  { label: "Condition", get: (v) => v.condition || "—" },
  { label: "Notes", get: (v) => v.notes || "—" },
];

function vehName(v) {
  if (v.label) return v.label;
  const n = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
  return n || "Vehicle";
}

export function renderCompare(view) {
  const selected = []; // working set of vehicles being compared

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="section-title" style="margin-top:2px">Compare vehicles</div>
    <div id="cmp-table"></div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn-primary btn-block" data-act="add">${icon("plus")} Add vehicle</button>
      <button class="btn btn-ghost btn-block" data-act="share" disabled>${icon("upload")} Share</button>
    </div>
    <div class="fab-note">Add cars from your inventory, or a “cross-shop” vehicle the customer is also considering, and put them head-to-head.</div>
  `;
  view.appendChild(el);

  const tableWrap = el.querySelector("#cmp-table");
  const shareBtn = el.querySelector('[data-act="share"]');

  const draw = () => {
    if (!selected.length) {
      tableWrap.innerHTML = emptyState("compare", "Nothing to compare yet", "Add two or more vehicles to see them side by side.");
      shareBtn.disabled = true;
      return;
    }
    shareBtn.disabled = selected.length < 1;

    // A horizontally-scrolling grid: first column = spec labels, then one column
    // per vehicle. Cheapest price in each numeric row is highlighted.
    const cheapest = selected.reduce((min, v, i) => {
      const p = Number(v.price);
      return (!isNaN(p) && p > 0 && (min.p == null || p < min.p)) ? { p, i } : min;
    }, { p: null, i: -1 });

    const cols = selected.map((v, i) => `
      <div class="cmp-col">
        <div class="cmp-head">
          <div class="cmp-name">${esc(vehName(v))}</div>
          <button class="cmp-x" data-remove="${i}" aria-label="Remove">&times;</button>
        </div>
        ${ROWS.map((r) => {
          const highlight = r.label === "Price" && cheapest.i === i && selected.length > 1;
          return `<div class="cmp-cell${highlight ? " cmp-best" : ""}">${esc(r.get(v))}${highlight ? ' <span class="cmp-tag">best</span>' : ""}</div>`;
        }).join("")}
      </div>`).join("");

    tableWrap.innerHTML = `
      <div class="cmp-scroll">
        <div class="cmp-col cmp-labels">
          <div class="cmp-head"><div class="cmp-name muted small">Spec</div></div>
          ${ROWS.map((r) => `<div class="cmp-cell muted small">${esc(r.label)}</div>`).join("")}
        </div>
        ${cols}
      </div>`;

    tableWrap.querySelectorAll("[data-remove]").forEach((b) =>
      b.addEventListener("click", () => { selected.splice(Number(b.dataset.remove), 1); draw(); }));
  };

  el.querySelector('[data-act="add"]').addEventListener("click", () =>
    openVehiclePicker((v) => { selected.push(v); draw(); }));

  shareBtn.addEventListener("click", () => shareComparison(selected));

  draw();
}

function openVehiclePicker(onPick) {
  const inv = store.all("vehicles").filter((v) => v.status !== "sold");
  openModal("Add a vehicle", (close) => {
    const wrap = document.createElement("div");
    const custom = document.createElement("button");
    custom.className = "btn btn-primary btn-block";
    custom.style.marginBottom = "12px";
    custom.innerHTML = `${icon("edit")} Enter a cross-shop vehicle`;
    custom.addEventListener("click", () => { close(); openCustomForm(onPick); });
    wrap.appendChild(custom);

    if (!inv.length) {
      const note = document.createElement("div");
      note.className = "muted small";
      note.style.textAlign = "center";
      note.textContent = "No inventory yet — import or add vehicles, or enter one above.";
      wrap.appendChild(note);
    } else {
      const title = document.createElement("div");
      title.className = "section-title";
      title.textContent = "From your inventory";
      wrap.appendChild(title);
      inv.forEach((v) => {
        const btn = document.createElement("button");
        btn.className = "btn btn-ghost btn-block";
        btn.style.cssText = "justify-content:space-between;margin-bottom:8px;text-align:left";
        btn.innerHTML = `<span>${esc(vehName(v))}</span><span class="mono small muted">${v.price != null && v.price !== "" ? esc(currency(v.price)) : ""}</span>`;
        btn.addEventListener("click", () => { close(); onPick({ ...v }); });
        wrap.appendChild(btn);
      });
    }
    return wrap;
  });
}

function openCustomForm(onPick) {
  openModal("Cross-shop vehicle", (close) => {
    const { element } = buildForm(
      [
        { name: "label", label: "Vehicle", required: true, placeholder: "2024 Honda CR-V EX" },
        { name: "price", label: "Price", type: "number", inputmode: "decimal", half: true, placeholder: "35000" },
        { name: "mileage", label: "Mileage", type: "number", inputmode: "numeric", half: true, placeholder: "0" },
        { name: "fuelType", label: "Fuel", half: true, placeholder: "Gas / Hybrid / EV" },
        { name: "drivetrain", label: "Drivetrain", half: true, placeholder: "AWD" },
        { name: "bodyStyle", label: "Body", half: true, placeholder: "SUV" },
        { name: "color", label: "Color", half: true, placeholder: "" },
        { name: "notes", label: "Key features / notes", type: "textarea", placeholder: "Trims, options, warranty, why they're considering it…" },
      ],
      {
        submitLabel: "Add to comparison",
        onSubmit: (data) => { onPick(data); close(); },
      }
    );
    return element;
  });
}

function comparisonText(selected) {
  const lines = ["Vehicle comparison", ""];
  selected.forEach((v, i) => {
    const bits = ROWS.map((r) => r.get(v)).filter((x) => x && x !== "—");
    lines.push(`${i + 1}) ${vehName(v)}`);
    lines.push(`   ${[v.price != null && v.price !== "" ? currency(v.price) : null, v.mileage ? num(v.mileage) + " mi" : null, v.fuelType, v.drivetrain || v.transmission].filter(Boolean).join(" · ")}`);
    if (v.notes) lines.push(`   ${v.notes}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

async function shareComparison(selected) {
  if (!selected.length) return;
  const text = comparisonText(selected);
  try {
    if (navigator.share) { await navigator.share({ title: "Vehicle comparison", text }); return; }
  } catch { return; /* user cancelled the share sheet */ }
  try {
    await navigator.clipboard.writeText(text);
    toast("Comparison copied — paste it into a text", "success");
  } catch {
    openModal("Comparison", () => `<pre style="white-space:pre-wrap;font:inherit;margin:0">${esc(text)}</pre>`);
  }
}
