// The paperwork, read: photograph the approval order or the worksheet from
// the Sold screen and the function reads what's on the deal — the car, the
// trade, how it's paid, every product and accessory — then dealprep.js turns
// it into the delivery prep list and the rep confirms it with one tap. The
// photo is saved with the sale like any other page; the read is a draft
// until confirmed; nothing from it ever reaches a customer.

import * as store from "./store.js";
import * as backend from "./backend.js";
import { addDoc } from "./docs.js";
import { prepFromDeal, headsUp, DEFAULT_PREP_RULES } from "./dealprep.js";

const MAX_EDGE = 1600;

// A page as a JPEG no wider than the model needs, as base64.
async function pageData(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) {
    const buf = await file.arrayBuffer();
    return { media_type: file.type || "image/jpeg", data: btoa(String.fromCharCode(...new Uint8Array(buf))) };
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.85);
  return { media_type: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
}

// Photograph pages, save them with the sale, and read them. Returns
// { read, items, headsUp, docs }.
export async function readDealPages(sale, files) {
  const s = store.getSettings();
  const fn = (s.agentUrl || "").trim().replace(/\/+$/, "");
  if (!fn) throw new Error("Set up the cloud function in Settings first");
  const docs = [];
  for (const f of files) { try { docs.push(await addDoc({ saleId: sale.id, leadId: sale.leadId || null, file: f })); } catch { /* the read still runs */ } }
  const images = [];
  for (const f of files.slice(0, 4)) images.push(await pageData(f));
  const res = await fetch(fn, { method: "POST", headers: await backend.fnHeaders(), body: JSON.stringify({ dealread: { images, saleId: sale.id } }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `Couldn't read the page (${res.status})`);
  const read = j.read || {};
  const rules = Array.isArray(s.prepRules) && s.prepRules.length ? s.prepRules.map((r) => ({ ...r, match: r.match instanceof RegExp ? r.match : new RegExp(String(r.match), "i") })) : DEFAULT_PREP_RULES;
  const items = prepFromDeal(read, { rules });
  return { read, items, headsUp: headsUp(items), docs };
}

// The delivery for a sale: the one it points at, else one for the same
// customer still in prep, else a new one.
export function deliveryForSale(sale) {
  const byId = sale.deliveryId && store.get("deliveries", sale.deliveryId);
  if (byId) return byId;
  const open = store.all("deliveries").find((d) => !d.done && d.status !== "delivered" && ((sale.leadId && d.leadId === sale.leadId) || (d.customerName && d.customerName === sale.customerName)));
  return open || null;
}

// The rep said yes: what was read goes on the sale, the prep list goes on
// the delivery (merged with what's there), and anything with a lead time
// becomes a to-do with a date, so Right now says it today.
export function applyDealRead(sale, read, items, { today = new Date() } = {}) {
  const v = read.vehicle || {}, f = read.finance || {};
  const patch = {};
  if (v.stock && !sale.stock) patch.stock = v.stock;
  if (v.vin && !sale.vin) patch.vin = v.vin;
  if (v.newUsed && !sale.newUsed) patch.newUsed = v.newUsed;
  if (v.year && !sale.year) patch.year = v.year;
  if (v.make && !sale.brand) patch.brand = v.make;
  if (v.model && !sale.model) patch.model = v.model;
  if (v.trim && !sale.trim) patch.trim = v.trim;
  if (f.type && !sale.dealType) patch.dealType = f.type;
  if (f.lender && !sale.lender) patch.lender = f.lender;
  patch.products = (read.products || []).map((p) => ({ name: p.name, kind: p.kind || "", amount: p.amount == null ? null : Number(p.amount) }));
  patch.dealReadAt = new Date().toISOString();
  if (read.dealNo && !sale.dealNo) patch.dealNo = String(read.dealNo);
  store.update("sales", sale.id, patch);

  const vehicle = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || sale.vehicle || "";
  let d = deliveryForSale(sale);
  const lines = items.map((i) => ({ label: i.label, done: false, owner: i.owner, lead: i.lead, startBy: i.startBy || "", from: i.from || "" }));
  if (d) {
    const have = Array.isArray(d.checklist) ? d.checklist : [];
    const merged = have.concat(lines.filter((l) => !have.some((h) => h.label === l.label)));
    const dp = { checklist: merged };
    if (read.deliveryDate && !d.deliveryDate) dp.deliveryDate = String(read.deliveryDate).slice(0, 10);
    if (vehicle && !d.vehicle) dp.vehicle = vehicle;
    store.update("deliveries", d.id, dp);
    d = store.get("deliveries", d.id);
  } else {
    d = store.create("deliveries", { customerName: sale.customerName || (read.customer && read.customer.name) || "Customer", vehicle, deliveryDate: read.deliveryDate ? String(read.deliveryDate).slice(0, 10) : "", status: "prep", notes: (read.notes || []).join("\n"), leadId: sale.leadId || null, checklist: lines });
  }
  if (!sale.deliveryId) store.update("sales", sale.id, { deliveryId: d.id });

  // The heads-up: a to-do per lead-time item, dated so the day's list and
  // Right now carry it. Day of: the delivery date, else today.
  const pad = (n) => String(n).padStart(2, "0");
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const made = [];
  items.filter((i) => i.lead >= 2).forEach((i) => {
    const due = i.startBy && i.startBy > todayKey ? i.startBy : todayKey;
    const exists = store.all("tasks").some((t) => !t.done && t.deliveryId === d.id && t.title === i.label);
    if (exists) return;
    made.push(store.create("tasks", { title: i.label, due, readyAt: new Date(`${due}T09:00:00`).toISOString(), channel: "todo", kind: "prep", priority: "high", done: false, leadId: sale.leadId || null, deliveryId: d.id, saleId: sale.id, why: [`${i.from ? i.from + " on the deal" : "On the deal"} — ${i.lead} days' lead time${d.deliveryDate ? `, delivery ${d.deliveryDate}` : ""}`], source: "dealread" }));
  });
  return { delivery: d, tasks: made };
}
