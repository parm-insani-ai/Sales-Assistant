// Inventory lookup — the vehicles on the lot.

import * as store from "../store.js";
import { openModal, buildForm, toast, confirmDialog, emptyState } from "../components.js";
import { navigate } from "../router.js";
import { openMarketplaceBuilder } from "./marketplace.js";
import { currency, num, esc } from "../utils.js";

export function vehicleName(v) {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle";
}

export function renderInventory(view, { param }) {
  if (param) return renderVehicleDetail(view, param);

  const vehicles = store.all("vehicles");
  let search = "";
  let filter = "available"; // available | all | hold | sold

  const wrap = document.createElement("div");
  view.appendChild(wrap);

  function list() {
    const q = search.toLowerCase();
    let out = vehicles;
    if (filter !== "all") out = out.filter((v) => (v.status || "available") === filter);
    if (q) out = out.filter((v) =>
      [v.year, v.make, v.model, v.trim, v.color, v.stock, v.vin].join(" ").toLowerCase().includes(q));
    return out;
  }

  function draw() {
    const chips = [
      { id: "available", label: "Available" },
      { id: "hold", label: "On Hold" },
      { id: "sold", label: "Sold" },
      { id: "all", label: "All" },
    ];
    wrap.innerHTML = `
      <div class="searchbar">
        <input type="search" placeholder="Search year, make, model, stock #…" value="${esc(search)}" />
      </div>
      <div class="btn-row" style="overflow-x:auto; flex-wrap:nowrap; padding-bottom:4px; margin-bottom:6px;">
        ${chips.map((c) => `<button class="btn btn-sm ${filter === c.id ? "btn-primary" : "btn-ghost"}" data-filter="${c.id}" style="flex:0 0 auto">${esc(c.label)}</button>`).join("")}
      </div>
      <div class="veh-list"></div>
    `;
    const listEl = wrap.querySelector(".veh-list");
    const items = list();
    if (!items.length) {
      listEl.innerHTML = emptyState("🚗", "No vehicles", search ? "No matches." : "Tap + to add inventory.");
      if (!search) {
        const imp = document.createElement("button");
        imp.className = "btn btn-primary btn-block";
        imp.textContent = "📄 Import from spreadsheet (vAuto export, etc.)";
        imp.addEventListener("click", () => navigate("/import"));
        listEl.appendChild(imp);
      }
    } else {
      items.forEach((v) => listEl.appendChild(vehicleCard(v)));
    }
    wrap.querySelector('input[type="search"]').addEventListener("input", (e) => {
      search = e.target.value;
      const el = wrap.querySelector(".veh-list");
      const items2 = list();
      el.innerHTML = "";
      if (!items2.length) el.innerHTML = emptyState("🔎", "No matches", "");
      else items2.forEach((v) => el.appendChild(vehicleCard(v)));
    });
    wrap.querySelectorAll("[data-filter]").forEach((b) =>
      b.addEventListener("click", () => { filter = b.dataset.filter; draw(); }));
  }

  draw();
}

function statusBadge(status) {
  const s = status || "available";
  const map = { available: "badge-available", hold: "badge-hold", sold: "badge-sold" };
  const label = { available: "Available", hold: "On Hold", sold: "Sold" };
  return `<span class="badge ${map[s] || "badge-available"}">${label[s] || s}</span>`;
}

function vehicleCard(v) {
  const el = document.createElement("div");
  el.className = "card card-tap";
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(vehicleName(v))}</div>
        <div class="row-sub">
          ${v.stock ? "Stock #" + esc(v.stock) : ""}${v.stock && v.mileage != null ? " · " : ""}${v.mileage != null ? num(v.mileage) + " mi" : ""}${v.color ? " · " + esc(v.color) : ""}
        </div>
      </div>
      <div class="row-meta">
        <div class="strong mono">${v.price != null ? currency(v.price) : "—"}</div>
        <div style="margin-top:4px">${statusBadge(v.status)}</div>
      </div>
    </div>
  `;
  el.addEventListener("click", () => navigate(`/inventory/${v.id}`));
  return el;
}

export function openVehicleForm(existing) {
  const isEdit = !!existing;
  const v = existing || {};
  openModal(isEdit ? "Edit vehicle" : "Add vehicle", (close) => {
    const { element } = buildForm(
      [
        { name: "year", label: "Year", value: v.year, type: "number", inputmode: "numeric", half: true, placeholder: "2024" },
        { name: "make", label: "Make", value: v.make, half: true, placeholder: "Toyota", required: true },
        { name: "model", label: "Model", value: v.model, half: true, placeholder: "RAV4", required: true },
        { name: "trim", label: "Trim", value: v.trim, half: true, placeholder: "XLE" },
        { name: "price", label: "Price", value: v.price, type: "number", inputmode: "decimal", half: true, placeholder: "32995" },
        { name: "mileage", label: "Mileage", value: v.mileage, type: "number", inputmode: "numeric", half: true, placeholder: "12" },
        { name: "color", label: "Color", value: v.color, half: true, placeholder: "Silver" },
        { name: "stock", label: "Stock #", value: v.stock, half: true, placeholder: "T12345" },
        { name: "vin", label: "VIN", value: v.vin, placeholder: "Last 8 or full VIN" },
        { name: "condition", label: "Condition", value: v.condition || "Used", type: "select", half: true,
          options: ["New", "Used", "Certified"] },
        { name: "transmission", label: "Transmission", value: v.transmission || "", type: "select", half: true,
          options: ["", "Automatic", "Manual"] },
        { name: "fuelType", label: "Fuel", value: v.fuelType || "", type: "select", half: true,
          options: ["", "Gasoline", "Diesel", "Hybrid", "Electric", "Plug-in hybrid", "Flex"] },
        { name: "bodyStyle", label: "Body style", value: v.bodyStyle || "", type: "select", half: true,
          options: ["", "Sedan", "SUV", "Truck", "Coupe", "Hatchback", "Van/Minivan", "Convertible", "Wagon"] },
        { name: "status", label: "Status", value: v.status || "available", type: "select",
          options: [{ value: "available", label: "Available" }, { value: "hold", label: "On Hold" }, { value: "sold", label: "Sold" }] },
        { name: "notes", label: "Notes / selling points", value: v.notes, type: "textarea", placeholder: "Sunroof, heated seats, one owner, tow package… (used in the Marketplace listing)" },
      ],
      {
        submitLabel: isEdit ? "Save changes" : "Add vehicle",
        onSubmit: (data) => {
          if (isEdit) { store.update("vehicles", existing.id, data); toast("Vehicle updated", "success"); }
          else { store.create("vehicles", data); toast("Vehicle added", "success"); }
          close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    return element;
  });
}

function renderVehicleDetail(view, id) {
  const v = store.get("vehicles", id);
  if (!v) { view.innerHTML = emptyState("🤷", "Vehicle not found", ""); return; }

  const el = document.createElement("div");
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-act="back" style="margin-bottom:12px">← Inventory</button>
    <div class="card">
      <div class="row">
        <div class="row-main"><div class="row-title" style="font-size:1.3rem">${esc(vehicleName(v))}</div></div>
        ${statusBadge(v.status)}
      </div>
      <div class="stat-value mono" style="margin-top:12px">${v.price != null ? currency(v.price) : "Price not set"}</div>
    </div>

    <div class="section-title">Specs</div>
    <div class="card">
      <div class="kv"><span class="k">Stock #</span><span class="v">${esc(v.stock || "—")}</span></div>
      <div class="kv"><span class="k">VIN</span><span class="v">${esc(v.vin || "—")}</span></div>
      <div class="kv"><span class="k">Mileage</span><span class="v">${v.mileage != null ? num(v.mileage) + " mi" : "—"}</span></div>
      <div class="kv"><span class="k">Color</span><span class="v">${esc(v.color || "—")}</span></div>
    </div>
    ${v.notes ? `<div class="section-title">Notes</div><div class="card"><div style="white-space:pre-wrap">${esc(v.notes)}</div></div>` : ""}

    <div class="section-title">Actions</div>
    <div class="card">
      <button class="btn btn-primary btn-block" data-act="marketplace">📣 Build Facebook Marketplace listing</button>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-ghost btn-block" data-act="quote">🧮 Quote a deal</button>
        <button class="btn btn-ghost btn-block" data-act="edit">✏️ Edit</button>
      </div>
      <button class="btn btn-danger btn-block" data-act="delete" style="margin-top:10px">Delete vehicle</button>
    </div>
  `;
  view.appendChild(el);

  el.querySelector('[data-act="back"]').addEventListener("click", () => navigate("/inventory"));
  el.querySelector('[data-act="edit"]').addEventListener("click", () => openVehicleForm(v));
  el.querySelector('[data-act="marketplace"]').addEventListener("click", () => openMarketplaceBuilder(v));
  el.querySelector('[data-act="quote"]').addEventListener("click", () => {
    // Pre-fill the calculator with this vehicle's price.
    sessionStorage.setItem("calc-prefill", JSON.stringify({ price: v.price, label: vehicleName(v) }));
    navigate("/calculator");
  });
  el.querySelector('[data-act="delete"]').addEventListener("click", async () => {
    if (await confirmDialog(`Delete ${vehicleName(v)}?`)) {
      store.remove("vehicles", v.id);
      toast("Vehicle deleted");
      navigate("/inventory");
    }
  });
}
