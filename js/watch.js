// A stock watch: a customer wants a vehicle the lot doesn't have, so the
// lot is watched for it — "Ken wants a white Rogue Platinum, let me know
// when one comes in" — and the moment one lands, in the morning import or
// any sync, it's a notification and a line under Right now: Ken's Rogue
// is in, stock number, price, text him. The want is read the way the lot
// is asked about (model, make, trim, colour, new or used, years, a price
// or kilometre cap); the matching is the same on the phone and in the
// function, so the push at 7am and the line on Home never disagree.

import * as store from "./store.js";
import { classify, modelsIn, MAKES } from "./segments.js";

const COLOURS = ["black", "white", "grey", "gray", "silver", "red", "blue", "green", "orange", "brown", "beige", "gold", "yellow", "burgundy", "purple", "tan", "bronze", "pearl"];
const TRIMS = /\b(platinum|limited|touring|sport|premium|midnight|rock creek|pro-?4x|nismo|sr|sl|sv|s|le|xle|se|xse|trd|ex|ex-l|lx|hybrid|plug-?in|e-?power|awd|4wd)\b/;
const BODY = [[/\b(suvs?|crossovers?|cuvs?)\b/, "suv"], [/\b(trucks?|pickups?|pick-ups?)\b/, "truck"], [/\b(sedans?|hatchbacks?|coupes?|compacts?)\b/, "car"], [/\b(mini)?vans?\b/, "van"]];
const norm = (s) => String(s || "").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
const lower = (s) => norm(s).toLowerCase();
const money = (s) => { const n = Number(String(s).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : 0; };
const canonMake = (m) => (m === "vw" ? "volkswagen" : m === "chevy" ? "chevrolet" : m === "mercedes-benz" ? "mercedes" : m);

// What they want, from the sentence. `useful` says whether it narrows to
// something the lot can be watched for (a model, a make, or a body style).
export function parseWant(text) {
  const t = lower(text);
  const w = { text: norm(text), models: modelsIn(t), makes: [], trim: "", colour: "", condition: "", body: "", yearMin: null, yearMax: null, maxPrice: null, maxKm: null };
  w.makes = MAKES.filter((m) => new RegExp(`\\b${m.replace(/-/g, "\\-")}\\b`).test(t)).map(canonMake);
  const c = COLOURS.find((x) => new RegExp(`\\b${x}\\b`).test(t)); if (c) w.colour = c === "gray" ? "grey" : c;
  if (/\b(used|pre-?owned|second-?hand)\b/.test(t)) w.condition = "Used";
  else if (/\b(brand new|new)\b/.test(t) && !/\bnewest\b/.test(t)) w.condition = "New";
  for (const [re, b] of BODY) if (re.test(t)) { w.body = b; break; }
  // The trim: the word right after the model ("Rogue Platinum", "Kicks SR"),
  // or a trim word anywhere when only one model is named.
  for (const m of w.models) {
    const after = new RegExp(`\\b${m.replace(/[-.]/g, (ch) => "\\" + ch)}s?\\s+([a-z0-9-]+\\+?)\\b`).exec(t);
    if (after && TRIMS.test(after[1]) && !w.trim) w.trim = after[1].replace(/pro-?4x/, "pro-4x");
  }
  if (!w.trim && w.models.length === 1) { const any = TRIMS.exec(t.replace(new RegExp(`\\b${w.models[0]}\\b`), " ")); if (any && !["s"].includes(any[1])) w.trim = any[1]; }
  // Years: "2024 or newer", "2022 to 2024", "a 2023".
  const yrs = t.match(/\b(?:19|20)\d{2}\b/g) || [];
  const range = /\b((?:19|20)\d{2})\s*(?:to|-|through|and)\s*((?:19|20)\d{2})\b/.exec(t);
  if (range) { w.yearMin = Number(range[1]); w.yearMax = Number(range[2]); }
  else if (yrs.length === 1) {
    const y = Number(yrs[0]);
    if (/\b(or newer|and newer|or later|and up|\+)/.test(t.slice(t.indexOf(yrs[0])))) w.yearMin = y;
    else if (/\b(or older|and older|or earlier)\b/.test(t)) w.yearMax = y;
    else { w.yearMin = y; w.yearMax = y; }
  }
  // Caps: "under 40", "under $40,000", "below 35k", "under 50,000 km".
  const km = /\b(?:under|below|less than|max(?:imum)?|up to|no more than)\s+\$?(\d[\d,]*)\s*(?:km|kms|kilomet\w*|clicks)\b/.exec(t);
  if (km) w.maxKm = money(km[1]);
  const price = /\b(?:under|below|less than|max(?:imum)?|up to|no more than|around|about|budget (?:of|is))\s+\$?(\d[\d,]*(?:\.\d+)?)\s*(k|grand|thousand)?\b(?!\s*(?:km|kms|kilomet|clicks))/.exec(t);
  if (price) { let n = money(price[1]); if (price[2] || (n > 0 && n < 1000)) n *= 1000; w.maxPrice = n; }
  return w;
}
export function isUseful(w) { return !!(w && (w.models.length || w.makes.length || w.body)); }

// "white 2024+ Rogue Platinum, new, under $40,000"
export function describeWant(w) {
  if (!w) return "";
  const cap = (s) => String(s).split(/[\s-]+/).map((x) => (/^[a-z]{1,3}$/.test(x) ? x.toUpperCase() : x.charAt(0).toUpperCase() + x.slice(1))).join(" ");
  const bits = [];
  if (w.colour) bits.push(w.colour);
  if (w.yearMin != null && w.yearMax != null && w.yearMin === w.yearMax) bits.push(String(w.yearMin));
  else if (w.yearMin != null && w.yearMax != null) bits.push(`${w.yearMin}–${w.yearMax}`);
  else if (w.yearMin != null) bits.push(`${w.yearMin}+`);
  else if (w.yearMax != null) bits.push(`up to ${w.yearMax}`);
  const name = [w.models.length ? "" : w.makes.map(cap).join(" / "), w.models.map(cap).join(" / "), w.trim ? cap(w.trim) : ""].filter(Boolean).join(" ");
  bits.push(name || ({ suv: "SUV", truck: "truck", car: "sedan", van: "van" })[w.body] || "vehicle");
  const extra = [];
  if (w.condition) extra.push(w.condition.toLowerCase());
  if (w.maxPrice) extra.push(`under $${Math.round(w.maxPrice).toLocaleString()}`);
  if (w.maxKm) extra.push(`under ${Math.round(w.maxKm).toLocaleString()} km`);
  return bits.join(" ") + (extra.length ? ", " + extra.join(", ") : "");
}

export function vehicleLabel(v) { return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" "); }

// Does this unit on the lot fit the want? The same rules as the function's.
export function vehicleFits(w, v) {
  if (!w || !v || (v.status || "available") !== "available") return false;
  const c = classify("", { year: v.year, make: v.make, model: v.model, trim: v.trim });
  const model = lower(v.model), make = lower(v.make), trim = lower(v.trim), colour = lower(v.color).replace("gray", "grey");
  if (w.models.length && !w.models.some((m) => c.model === m || model.includes(m))) return false;
  if (w.makes.length && !w.makes.some((m) => c.make === m || make.includes(m))) return false;
  if (!w.models.length && w.body && c.body !== w.body && !lower(v.bodyStyle).includes(w.body === "car" ? "sedan" : w.body)) return false;
  if (w.trim && !trim.includes(w.trim.replace(/\+$/, ""))) return false;
  if (w.colour && !colour.includes(w.colour)) return false;
  if (w.condition && v.condition && lower(v.condition) !== w.condition.toLowerCase()) return false;
  if (w.yearMin != null && !(v.year && v.year >= w.yearMin)) return false;
  if (w.yearMax != null && !(v.year && v.year <= w.yearMax)) return false;
  if (w.maxPrice && v.price != null && Number(v.price) > w.maxPrice) return false;
  if (w.maxKm && v.mileage != null && Number(v.mileage) > w.maxKm) return false;
  return true;
}

// ---- The watches themselves ----
export function openWatches() { return store.all("watches").filter((w) => !w.done && !w.matchedVehicleId); }
export function watchesFor(leadId) { return store.all("watches").filter((w) => w.leadId === leadId && !w.done); }
export function createWatch(leadId, text) {
  const want = parseWant(text);
  return store.create("watches", { leadId, text: want.text, want, done: false, matchedAt: null, matchedVehicleId: null, matched: null, notifiedAt: null });
}
export function cancelWatch(id) { store.update("watches", id, { done: true, doneAt: new Date().toISOString(), doneBy: "cancel" }); }
export function closeWatch(id, by = "done") { store.update("watches", id, { done: true, doneAt: new Date().toISOString(), doneBy: by }); }

// Every open watch against the lot: the first unit that fits closes the
// search and is kept on the watch. Returns the new matches, with the
// customer and the unit, for whoever wants to say so.
export function checkWatches({ vehicles = null, now = new Date() } = {}) {
  const lot = vehicles || store.all("vehicles");
  const hits = [];
  for (const w of openWatches()) {
    const v = lot.find((x) => vehicleFits(w.want, x));
    if (!v) continue;
    const matched = { id: v.id, label: vehicleLabel(v), price: v.price ?? null, stock: v.stock || "", color: v.color || "", km: v.mileage ?? null };
    store.update("watches", w.id, { matchedAt: now.toISOString(), matchedVehicleId: v.id, matched });
    hits.push({ watch: { ...w, matchedAt: now.toISOString(), matchedVehicleId: v.id, matched }, vehicle: v, lead: store.get("leads", w.leadId) || null });
  }
  return hits;
}
// Watches that found their unit and haven't been acted on.
export function matchedWatches() {
  return store.all("watches").filter((w) => !w.done && w.matchedVehicleId).map((w) => ({ watch: w, vehicle: store.get("vehicles", w.matchedVehicleId) || null, lead: store.get("leads", w.leadId) || null }));
}
