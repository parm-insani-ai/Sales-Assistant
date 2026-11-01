// Delivered: everyone who has driven away in a car you sold them — their
// contact details in one place, and the pictures of their contract. One
// list, newest delivery first, with a search box for a name, a vehicle or a
// phone number. Reached from Delivered on the "+" sheet.
//
// A customer is here when their sale is marked delivered (the Sold
// Tracker's Delivered date), or their delivery was completed on the
// Deliveries screen. The paperwork is the same set the Sold screen keeps —
// photographed or added here or there, it's the one sale's folder.

import * as store from "../store.js";
import { esc, formatDateTime, telHref, smsHref } from "../utils.js";
import { icon } from "../icons.js";
import { openModal, toast, undoToast, emptyState } from "../components.js";
import { docsFor, docCount, addDoc, docBlob, removeDoc, syncDocs, pendingDocs } from "../docs.js";

const initials = (name) => String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
const vehLabel = (s) => [s.year, s.brand, s.model, s.trim].filter(Boolean).join(" ") || s.vehicle || "";
const isImage = (d) => /^image\//.test(d.mime || "");
const dayOf = (v) => String(v || "").slice(0, 10);
const dayLabel = (iso) => { const d = new Date(dayOf(iso) + "T12:00:00"); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return y && m ? new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Undated";
}
const fmtPhone = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d.length === 11 && d[0] === "1" ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : String(p || ""); };

// Everyone delivered, newest first: the sale, the customer behind it, and
// the day they took delivery.
export function deliveredCustomers() {
  const leads = store.all("leads"), deliveries = store.all("deliveries"), sales = store.all("sales");
  const leadFor = (s) => (s.leadId && leads.find((l) => l.id === s.leadId)) || leads.find((l) => l.name && s.customerName && l.name.trim().toLowerCase() === s.customerName.trim().toLowerCase()) || null;
  const deliveryFor = (s) => deliveries.find((d) => d.status === "delivered" && (d.id === s.deliveryId || (s.leadId && d.leadId === s.leadId) || (d.customerName && s.customerName && d.customerName.trim().toLowerCase() === s.customerName.trim().toLowerCase())));
  const out = [];
  const seen = new Set();
  for (const s of sales) {
    const dl = deliveryFor(s);
    if (!s.deliveredAt && !dl) continue;
    const lead = leadFor(s);
    const at = s.deliveredAt || (dl && (dl.deliveryDate || dl.when || dl.date || dl.updatedAt)) || s.saleDate || s.createdAt || "";
    out.push({ key: s.id, saleId: s.id, name: s.customerName || (lead && lead.name) || "Customer", vehicle: vehLabel(s) || (dl && dl.vehicle) || "", at, lead, phone: (lead && lead.phone) || "", email: (lead && lead.email) || "", stock: s.stock || "", vin: s.vin || (lead && lead.vin) || "" });
    if (dl) seen.add(dl.id);
  }
  // A delivery completed without a sale behind it (the sale was removed,
  // or logged under another name): still a delivered customer.
  for (const d of deliveries) {
    if (d.status !== "delivered" || seen.has(d.id)) continue;
    const lead = (d.leadId && leads.find((l) => l.id === d.leadId)) || null;
    out.push({ key: `d:${d.id}`, saleId: `d:${d.id}`, name: d.customerName || (lead && lead.name) || "Customer", vehicle: d.vehicle || "", at: d.deliveryDate || d.when || d.date || d.updatedAt || "", lead, phone: (lead && lead.phone) || "", email: (lead && lead.email) || "", stock: "", vin: (lead && lead.vin) || "" });
  }
  return out.sort((a, b) => dayOf(b.at).localeCompare(dayOf(a.at)) || a.name.localeCompare(b.name));
}

export function renderDelivered(view) {
  const el = document.createElement("div");
  el.className = "sd-page dv-page";
  view.appendChild(el);
  const open = new Set();
  const urls = new Map();
  let q = "";

  function draw() {
    const all = deliveredCustomers();
    const needle = q.trim().toLowerCase().replace(/[^a-z0-9@. ]/g, "");
    const digits = q.replace(/\D/g, "");
    const list = needle ? all.filter((c) => [c.name, c.vehicle, c.email, c.stock, c.vin].join(" ").toLowerCase().includes(needle) || (digits.length >= 3 && String(c.phone || "").replace(/\D/g, "").includes(digits))) : all;
    const months = [];
    list.forEach((c) => { const k = dayOf(c.at).slice(0, 7) || "Undated"; let g = months.find((x) => x.key === k); if (!g) { g = { key: k, items: [] }; months.push(g); } g.items.push(c); });
    const pending = pendingDocs();
    el.innerHTML = `
      <div class="hero">
        <div class="hero-greeting">${all.length ? `${all.length} customer${all.length === 1 ? "" : "s"} · all time` : "All time"}</div>
        <div class="hero-title">Delivered</div>
        ${pending ? `<div class="small muted" style="margin-top:6px">${icon("upload")} ${pending} file${pending === 1 ? "" : "s"} waiting to back up — they'll go when you're signed in and online.</div>` : ""}
      </div>
      ${all.length ? `<div class="dv-search"><input type="search" class="dv-q" placeholder="Search a name, vehicle, phone or VIN" value="${esc(q)}" aria-label="Search delivered customers" autocomplete="off"></div>` : ""}
      ${!all.length ? emptyState("check", "Nobody delivered yet", "Mark a delivery complete on Deliveries, or set the Delivered date on a sale in the Sold Tracker, and they land here with their details and a place for the contract.") : ""}
      ${all.length && !list.length ? `<div class="card"><div class="muted small" style="text-align:center">Nobody delivered matches “${esc(q)}”.</div></div>` : ""}
      ${months.map((g) => `
        <div class="section-title">${esc(monthLabel(g.key))} <span class="muted" style="font-weight:500;font-size:0.78rem">· ${g.items.length}</span></div>
        ${g.items.map((c) => cardHtml(c)).join("")}
      `).join("")}`;
    const box = el.querySelector(".dv-q");
    if (box) {
      box.addEventListener("input", () => { q = box.value; const pos = box.selectionStart; draw(); const nb = el.querySelector(".dv-q"); if (nb) { nb.focus(); try { nb.setSelectionRange(pos, pos); } catch { /* fine */ } } });
    }
    el.querySelectorAll(".sd-sale").forEach((card) => wire(card, list.find((c) => c.key === card.dataset.id)));
  }

  function cardHtml(c) {
    const n = docCount(c.saleId);
    const isOpen = open.has(c.key);
    return `
      <div class="card sd-sale dv-card ${isOpen ? "sd-open" : ""}" data-id="${esc(c.key)}">
        <div class="row sd-head">
          <span class="sd-avatar">${esc(initials(c.name))}</span>
          <div class="row-main" style="min-width:0">
            <div class="row-title">${esc(c.name)}</div>
            <div class="row-sub">${[c.vehicle, c.at ? `delivered ${dayLabel(c.at)}` : ""].filter(Boolean).map(esc).join(" · ")}</div>
          </div>
          <span class="sd-count ${n ? "sd-has" : ""}" title="${n} file${n === 1 ? "" : "s"}">${icon("file")} ${n}</span>
        </div>
        <div class="sd-body" ${isOpen ? "" : "hidden"}></div>
      </div>`;
  }

  // Inside: how to reach them, then the contract — the pictures, and the
  // two ways to add one (the camera, or a file).
  function wire(card, c) {
    if (!c) return;
    const body = card.querySelector(".sd-body");
    card.querySelector(".sd-head").addEventListener("click", () => {
      if (open.has(c.key)) { open.delete(c.key); card.classList.remove("sd-open"); body.hidden = true; return; }
      open.add(c.key); card.classList.add("sd-open"); body.hidden = false; paintBody();
    });
    if (open.has(c.key)) paintBody();

    function paintBody() {
      const docs = docsFor(c.saleId);
      const first = c.name.split(" ")[0];
      body.innerHTML = `
        <div class="dv-contact">
          ${c.phone ? `<div class="row dv-line"><span class="dv-k">${icon("phone")} Phone</span><span class="dv-v mono">${esc(fmtPhone(c.phone))}</span></div>` : `<div class="row dv-line"><span class="dv-k">${icon("phone")} Phone</span><span class="dv-v muted">none on file</span></div>`}
          ${c.email ? `<div class="row dv-line"><span class="dv-k">${icon("mail")} Email</span><span class="dv-v">${esc(c.email)}</span></div>` : `<div class="row dv-line"><span class="dv-k">${icon("mail")} Email</span><span class="dv-v muted">none on file</span></div>`}
          ${c.vin ? `<div class="row dv-line"><span class="dv-k">${icon("car")} VIN</span><span class="dv-v mono">${esc(c.vin)}</span></div>` : ""}
          ${c.stock ? `<div class="row dv-line"><span class="dv-k">${icon("tag")} Stock</span><span class="dv-v mono">${esc(c.stock)}</span></div>` : ""}
        </div>
        <div class="btn-row dv-actions">
          ${c.phone ? `<a class="btn btn-ghost btn-sm" href="${esc(telHref(c.phone))}">${icon("phone")} Call</a><a class="btn btn-ghost btn-sm" href="${esc(smsHref(c.phone))}">${icon("message")} Text</a>` : ""}
          ${c.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(c.email)}">${icon("mail")} Email</a>` : ""}
          ${c.lead ? `<a class="btn btn-ghost btn-sm" href="#/leads/${esc(c.lead.id)}">${icon("users")} Customer</a>` : ""}
        </div>
        <div class="section-title dv-sub">Contract <span class="muted" style="font-weight:500;font-size:0.78rem">· ${docs.length}</span></div>
        <div class="sd-docs">${docs.map((d) => `<button type="button" class="sd-thumb" data-doc="${esc(d.id)}" aria-label="${esc(d.name || "file")}">${isImage(d) ? `<img alt="">` : `<span class="sd-thumb-file">${icon("file")}<span>${esc((d.name || "PDF").replace(/\.pdf$/i, ""))}</span></span>`}${d.uploaded ? "" : `<span class="sd-thumb-wait" title="Waiting to back up">${icon("upload")}</span>`}</button>`).join("")}</div>
        ${docs.length ? "" : `<div class="small muted" style="margin:2px 0 10px">No pictures of ${esc(first)}'s contract yet. Snap each page — they stay with ${esc(first)}, here and on Sold.</div>`}
        <div class="sd-add">
          <label class="btn btn-primary btn-sm sd-addbtn">${icon("image")} Take a photo<input type="file" accept="image/*" capture="environment" multiple hidden data-add></label>
          <label class="btn btn-ghost btn-sm sd-addbtn">${icon("paperclip")} Add a file<input type="file" accept="image/*,application/pdf" multiple hidden data-add></label>
        </div>`;
      docs.forEach((d) => { const img = body.querySelector(`[data-doc="${d.id}"] img`); if (img) thumb(d, img); });
      body.querySelectorAll("[data-add]").forEach((inp) => inp.addEventListener("change", async () => {
        const files = [...inp.files];
        inp.value = "";
        if (!files.length) return;
        for (const f of files) { try { await addDoc({ saleId: c.saleId, leadId: c.lead ? c.lead.id : null, file: f }); } catch (e) { toast(`Couldn't save ${f.name || "that"}: ${e && e.message ? e.message : e}`, "danger"); } }
        toast(files.length === 1 ? `Saved with ${first}'s contract` : `${files.length} saved with ${first}'s contract`, "success");
        count();
        paintBody();
      }));
      body.querySelectorAll(".sd-thumb").forEach((b) => b.addEventListener("click", () => { const d = store.get("docs", b.dataset.doc); if (d) viewer(d, c, paintBody); }));
    }
    function count() {
      const n = docCount(c.saleId);
      const badge = card.querySelector(".sd-count");
      badge.innerHTML = `${icon("file")} ${n}`;
      badge.classList.toggle("sd-has", n > 0);
    }

    async function thumb(d, img) {
      let u = urls.get(d.id);
      if (!u) { const blob = await docBlob(d); if (!blob) { img.replaceWith(Object.assign(document.createElement("span"), { className: "sd-thumb-file", innerHTML: `${icon("image")}<span>Not on this phone yet</span>` })); return; } u = URL.createObjectURL(blob); urls.set(d.id, u); }
      img.src = u;
    }

    // The page, full size, with its date and the one way to get rid of it.
    function viewer(d, c, after) {
      openModal(d.name || (isImage(d) ? "Photo" : "File"), (close) => {
        const box = document.createElement("div");
        box.className = "sd-viewer";
        box.innerHTML = `<div class="sd-viewer-body"><div class="muted small">Loading…</div></div>
          <div class="small muted" style="margin-top:10px">${esc(c.name)} · ${esc(formatDateTime(d.at))}${d.uploaded ? " · backed up" : " · on this phone, waiting to back up"}</div>
          <div class="btn-row" style="margin-top:12px">
            <a class="btn btn-ghost btn-sm" data-open target="_blank" rel="noopener" style="flex:1">${icon("external")} Open</a>
            <button type="button" class="btn btn-ghost btn-sm" data-del style="flex:1;color:var(--danger)">${icon("trash")} Delete</button>
          </div>`;
        docBlob(d).then((blob) => {
          const inner = box.querySelector(".sd-viewer-body");
          if (!blob) { inner.innerHTML = `<div class="muted small">This file isn't on this phone and couldn't be fetched right now.</div>`; return; }
          const u = URL.createObjectURL(blob);
          box.querySelector("[data-open]").href = u;
          inner.innerHTML = isImage(d) ? `<img src="${u}" alt="">` : `<div class="sd-pdf">${icon("file", "ico-xl")}<div class="strong">${esc(d.name || "PDF")}</div><div class="small muted">${Math.round((d.size || 0) / 1024)} KB · tap Open to read it</div></div>`;
        });
        box.querySelector("[data-del]").addEventListener("click", async () => {
          const snapshot = { ...d };
          const blob = await docBlob(d);
          await removeDoc(d);
          close();
          after(); count();
          undoToast("File deleted", async () => {
            store.restore("docs", { ...snapshot, path: "", uploaded: null });
            if (blob) { const { cacheSet } = await import("../cachedb.js"); await cacheSet(`doc:${snapshot.id}`, blob); }
            syncDocs();
            after(); count();
          });
        });
        return box;
      });
    }
  }

  draw();
  syncDocs().then((n) => { if (n && el.isConnected) draw(); });
}
