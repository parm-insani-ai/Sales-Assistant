// Facebook Marketplace listing builder. Facebook has no public API to post to
// Marketplace, so this generates a polished, copy-paste-ready listing (title,
// the structured fields Marketplace asks for, a description, and a photo
// shot-list) that you paste into the Marketplace form.

import * as store from "../store.js";
import { openModal, toast } from "../components.js";
import { currency, num, esc } from "../utils.js";
import { icon } from "../icons.js";

const PHOTO_SHOTLIST = [
  "Front 3/4 (driver side)",
  "Rear 3/4 (passenger side)",
  "Both side profiles",
  "Front & rear straight-on",
  "Dashboard / gauges",
  "Front seats & rear seats",
  "Infotainment screen (on)",
  "Odometer close-up",
  "Wheels / tires",
  "Engine bay",
  "Trunk / cargo area",
  "Any extras (sunroof, tow pkg, badges)",
];

export function vehicleTitle(v) {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle";
}

function buildDescription(v) {
  const s = store.getSettings();
  const title = vehicleTitle(v);
  const lines = [];
  lines.push(`${title}${v.mileage != null ? ` — ${num(v.mileage)} miles` : ""}`);
  if (v.price != null) lines.push(`Priced at ${currency(v.price)}.`);
  lines.push("");

  // Selling points from notes (one per line/comma) or sensible defaults.
  const points = [];
  if (v.color) points.push(`${v.color} exterior`);
  if (v.transmission) points.push(v.transmission);
  if (v.fuelType) points.push(v.fuelType);
  if (v.notes) {
    v.notes.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean).forEach((p) => points.push(p));
  }
  if (points.length) {
    lines.push("Highlights:");
    points.forEach((p) => lines.push(`• ${p}`));
    lines.push("");
  }

  lines.push("Clean and inspected, ready for a test drive. Financing available for all credit situations — trade-ins welcome!");
  lines.push("");
  const contactBits = [];
  if (s.salesperson) contactBits.push(s.salesperson);
  if (s.dealership) contactBits.push(`at ${s.dealership}`);
  const who = contactBits.length ? contactBits.join(" ") : "us";
  lines.push(`Call or text ${who}${s.contactPhone ? ` at ${s.contactPhone}` : ""} to set up a time to see it.`);
  if (v.stock) lines.push(`(Stock #${v.stock})`);
  return lines.join("\n");
}

function buildFields(v) {
  const rows = [
    ["Vehicle type", "Car/Truck"],
    ["Year", v.year || ""],
    ["Make", v.make || ""],
    ["Model", [v.model, v.trim].filter(Boolean).join(" ")],
    ["Mileage", v.mileage != null ? num(v.mileage) : ""],
    ["Price", v.price != null ? String(v.price) : ""],
    ["Exterior color", v.color || ""],
    ["Condition", v.condition || "Used"],
    ["Transmission", v.transmission || ""],
    ["Fuel type", v.fuelType || ""],
    ["Body style", v.bodyStyle || ""],
  ];
  return rows.filter(([, val]) => String(val).trim() !== "");
}

export function openMarketplaceBuilder(v) {
  openModal("Facebook Marketplace listing", (close) => {
    const wrap = document.createElement("div");
    const fields = buildFields(v);
    const desc = buildDescription(v);
    const title = `${vehicleTitle(v)}${v.mileage != null ? ` - ${num(v.mileage)} mi` : ""}`;

    wrap.innerHTML = `
      <div class="hint" style="margin-bottom:12px">Facebook doesn't allow apps to post to Marketplace automatically, so this builds the listing for you to paste in. Tap <b>Copy</b>, open Marketplace → <b>Create new listing → Vehicle</b>, and paste.</div>

      <div class="field">
        <label>Title</label>
        <input id="mk-title" value="${esc(title)}">
      </div>

      <div class="section-title" style="margin-top:6px">Listing fields</div>
      <div class="card" style="padding:8px 14px">
        ${fields.map(([k, val]) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(String(val))}</span></div>`).join("")}
      </div>

      <div class="field" style="margin-top:12px">
        <label>Description (editable)</label>
        <textarea id="mk-desc" style="min-height:210px">${esc(desc)}</textarea>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary btn-block" data-act="copy-all">${icon("file")} Copy full listing</button>
        <button class="btn btn-ghost btn-block" data-act="copy-desc">Copy description</button>
      </div>

      <div class="section-title">Photo shot-list</div>
      <div class="card" style="padding:8px 14px">
        ${PHOTO_SHOTLIST.map((p) => `<div class="kv"><span class="k">•</span><span class="v" style="font-weight:500">${esc(p)}</span></div>`).join("")}
      </div>
      <div class="hint">Good photos sell cars. Shoot in daylight, clean car, no other vehicles in frame.</div>
    `;

    const titleEl = wrap.querySelector("#mk-title");
    const descEl = wrap.querySelector("#mk-desc");

    const fullText = () => {
      const fieldText = buildFields(v).map(([k, val]) => `${k}: ${val}`).join("\n");
      return `${titleEl.value}\n\n${fieldText}\n\n${descEl.value}`;
    };
    const copy = async (text, label) => {
      try { await navigator.clipboard.writeText(text); toast(label + " copied", "success"); }
      catch { descEl.select(); toast("Select and copy the text", ""); }
    };
    wrap.querySelector('[data-act="copy-all"]').addEventListener("click", () => copy(fullText(), "Listing"));
    wrap.querySelector('[data-act="copy-desc"]').addEventListener("click", () => copy(descEl.value, "Description"));

    return wrap;
  });
}
