// Sold: everyone you've sold, newest first by month, and the paperwork on
// each sale — photographed or scanned right here and kept with the
// customer. Reached from the Sold tile on Home.

import * as store from "../store.js";
import { esc, formatDateTime } from "../utils.js";
import { icon } from "../icons.js";
import { openModal, toast, undoToast, emptyState } from "../components.js";
import { docsFor, docCount, addDoc, docBlob, removeDoc, syncDocs, pendingDocs } from "../docs.js";
import { readDealPages, applyDealRead } from "../dealread.js";

const initials = (name) => String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
const vehLabel = (s) => [s.year, s.brand, s.model, s.trim].filter(Boolean).join(" ") || s.vehicle || "";
const monthOf = (s) => String(s.saleDate || s.createdAt || "").slice(0, 7);
function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return y && m ? new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Undated";
}
const dayLabel = (iso) => { const d = new Date(String(iso || "").slice(0, 10) + "T12:00:00"); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const isImage = (d) => /^image\//.test(d.mime || "");

export function renderSold(view) {
  const el = document.createElement("div");
  el.className = "sd-page";
  view.appendChild(el);
  const open = new Set(); // sales showing their paperwork
  const urls = new Map(); // doc id → object URL for its thumbnail

  function draw() {
    const sales = store.all("sales").slice().sort((a, b) => String(b.saleDate || b.createdAt || "").localeCompare(String(a.saleDate || a.createdAt || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const months = [];
    sales.forEach((s) => { const k = monthOf(s); let g = months.find((x) => x.key === k); if (!g) { g = { key: k, sales: [] }; months.push(g); } g.sales.push(s); });
    const pending = pendingDocs();
    el.innerHTML = `
      <div class="hero">
        <div class="hero-greeting">${sales.length ? `${sales.length} customer${sales.length === 1 ? "" : "s"} · all time` : "All time"}</div>
        <div class="hero-title">Sold</div>
        ${pending ? `<div class="small muted" style="margin-top:6px">${icon("upload")} ${pending} file${pending === 1 ? "" : "s"} waiting to back up — they'll go when you're signed in and online.</div>` : ""}
      </div>
      ${!sales.length ? emptyState("award", "Nobody sold yet", "Log a sale by voice, from Goals, or on the Sold Tracker and they land here with a place for the paperwork.") : ""}
      ${months.map((g) => `
        <div class="section-title">${esc(monthLabel(g.key))} <span class="muted" style="font-weight:500;font-size:0.78rem">· ${g.sales.length}</span></div>
        ${g.sales.map((s) => saleHtml(s)).join("")}
      `).join("")}
    `;
    el.querySelectorAll(".sd-sale").forEach(wire);
  }

  function saleHtml(s) {
    const n = docCount(s.id);
    const isOpen = open.has(s.id);
    return `
      <div class="card sd-sale ${isOpen ? "sd-open" : ""}" data-id="${esc(s.id)}">
        <div class="row sd-head">
          <span class="sd-avatar">${esc(initials(s.customerName))}</span>
          <div class="row-main">
            <div class="row-title">${esc(s.customerName || "Customer")}</div>
            <div class="row-sub">${[vehLabel(s), dayLabel(s.saleDate)].filter(Boolean).map(esc).join(" · ")}</div>
          </div>
          <span class="sd-count ${n ? "sd-has" : ""}">${icon("file")} ${n}</span>
        </div>
        <div class="sd-body" ${isOpen ? "" : "hidden"}></div>
      </div>`;
  }

  // Inside a sale: its paperwork as thumbnails, and the two ways to add
  // some — the camera, or a file (a scan from Files, a PDF from mail).
  function wire(card) {
    const s = store.get("sales", card.dataset.id);
    if (!s) return;
    const body = card.querySelector(".sd-body");
    card.querySelector(".sd-head").addEventListener("click", () => {
      if (open.has(s.id)) { open.delete(s.id); card.classList.remove("sd-open"); body.hidden = true; return; }
      open.add(s.id); card.classList.add("sd-open"); body.hidden = false; paintBody();
    });
    if (open.has(s.id)) paintBody();

    function paintBody() {
      const docs = docsFor(s.id);
      body.innerHTML = `
        <div class="sd-docs">${docs.map((d) => `<button type="button" class="sd-thumb" data-doc="${esc(d.id)}" aria-label="${esc(d.name || "file")}">${isImage(d) ? `<img alt="">` : `<span class="sd-thumb-file">${icon("file")}<span>${esc((d.name || "PDF").replace(/\.pdf$/i, ""))}</span></span>`}${d.uploaded ? "" : `<span class="sd-thumb-wait" title="Waiting to back up">${icon("upload")}</span>`}</button>`).join("")}</div>
        ${docs.length ? "" : `<div class="small muted" style="margin:2px 0 10px">No paperwork saved yet. Snap the bill of sale, the worksheet, the trade — they stay with ${esc((s.customerName || "the customer").split(" ")[0])}.</div>`}
        <div class="sd-add">
          <label class="btn btn-primary btn-sm sd-addbtn">${icon("image")} Take a photo<input type="file" accept="image/*" capture="environment" multiple hidden data-add></label>
          <label class="btn btn-ghost btn-sm sd-addbtn">${icon("paperclip")} Add a file<input type="file" accept="image/*,application/pdf" multiple hidden data-add></label>
          <label class="btn btn-ghost btn-sm sd-addbtn sd-readbtn" title="Photograph the approval order or the worksheet: the deal is read and the delivery prep list written">${icon("sparkles")} Read the paperwork<input type="file" accept="image/*" capture="environment" multiple hidden data-read></label>
          ${s.dealReadAt ? `<span class="small muted sd-read-done">${icon("check")} read${s.products && s.products.length ? ` · ${s.products.length} product${s.products.length === 1 ? "" : "s"}` : ""}${s.deliveryId ? ` · <a href="#/deliveries/${esc(s.deliveryId)}" style="color:var(--brand)">prep list</a>` : ""}</span>` : ""}
          ${s.leadId && store.get("leads", s.leadId) ? `<a class="btn btn-ghost btn-sm" href="#/leads/${esc(s.leadId)}" style="margin-left:auto">${icon("users")} Customer</a>` : ""}
        </div>`;
      docs.forEach((d) => { const img = body.querySelector(`[data-doc="${d.id}"] img`); if (img) thumb(d, img); });
      body.querySelectorAll("[data-add]").forEach((inp) => inp.addEventListener("change", async () => {
        const files = [...inp.files];
        inp.value = "";
        if (!files.length) return;
        for (const f of files) { try { await addDoc({ saleId: s.id, leadId: s.leadId || null, file: f }); } catch (e) { toast(`Couldn't save ${f.name || "that"}: ${e && e.message ? e.message : e}`, "danger"); } }
        toast(files.length === 1 ? "Saved with the sale" : `${files.length} saved with the sale`, "success");
        card.querySelector(".sd-count").innerHTML = `${icon("file")} ${docCount(s.id)}`;
        card.querySelector(".sd-count").classList.add("sd-has");
        paintBody();
      }));
      body.querySelectorAll(".sd-thumb").forEach((b) => b.addEventListener("click", () => { const d = store.get("docs", b.dataset.doc); if (d) viewer(d, s, paintBody, card); }));
      const readInp = body.querySelector("[data-read]");
      if (readInp) readInp.addEventListener("change", async () => {
        const files = [...readInp.files].filter((f) => /^image\//.test(f.type || ""));
        readInp.value = "";
        if (!files.length) return;
        const btn = body.querySelector(".sd-readbtn");
        if (btn) { btn.classList.add("disabled"); btn.innerHTML = `${icon("sparkles")} Reading…`; }
        try {
          const r = await readDealPages(store.get("sales", s.id) || s, files);
          reviewRead(store.get("sales", s.id) || s, r, () => { card.querySelector(".sd-count").innerHTML = `${icon("file")} ${docCount(s.id)}`; paintBody(); });
        } catch (e) { toast(e && e.message ? e.message : "Couldn't read the page", "danger"); paintBody(); }
      });
    }
  }

  // What was read, for the rep to confirm: the car and the money as a
  // check, every product as a line, and the prep list with its owners and
  // lead times. One tap writes the delivery and the day's to-dos.
  function reviewRead(s, r, after) {
    const { read, items, headsUp: hu } = r;
    const v = read.vehicle || {}, f = read.finance || {};
    const car = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
    const trade = (read.trade || []).map((t) => [t.year, t.make, t.model].filter(Boolean).join(" ")).filter(Boolean).join(", ");
    const pay = f.type ? `${f.type}${f.term ? ` · ${f.term} mo` : ""}${f.payment ? ` · $${Number(f.payment).toLocaleString("en-CA")}${f.frequency ? " " + f.frequency : ""}` : ""}${f.lender ? ` · ${f.lender}` : ""}` : "";
    const owner = (o) => ({ service: "Service", parts: "Parts", finance: "F&I", customer: "Customer", rep: "You" })[o] || o;
    const el = document.createElement("div");
    el.className = "deal-read";
    el.innerHTML = `
      <div class="small muted">${esc(read.form === "worksheet" ? "Worksheet" : read.form === "bill_of_sale" ? "Bill of sale" : "Approval order")}${read.dealNo ? ` · deal ${esc(String(read.dealNo))}` : ""}${read.date ? ` · ${esc(String(read.date))}` : ""}</div>
      <div class="card" style="margin-top:8px">
        <div class="strong">${esc(car || s.vehicle || "Vehicle")}${v.stock ? ` <span class="muted small">· ${esc(v.stock)}</span>` : ""}</div>
        <div class="small muted">${[v.newUsed, v.colour, trade ? "trade: " + trade : "", pay].filter(Boolean).map(esc).join(" · ")}</div>
        ${read.notes && read.notes.length ? `<div class="small" style="margin-top:6px"><b>On the order:</b> ${read.notes.map(esc).join(" · ")}</div>` : ""}
      </div>
      <div class="section-title">On the deal <span class="muted" style="font-weight:500;font-size:0.78rem">· ${read.products.length} product${read.products.length === 1 ? "" : "s"}</span></div>
      <div class="card deal-products">${read.products.length ? read.products.map((p) => `<div class="row" style="padding:4px 0"><div class="row-main small">${esc(p.name)}</div><span class="small muted">${esc(p.kind || "")}</span></div>`).join("") : `<div class="small muted">No products or accessories read on this page.</div>`}</div>
      <div class="section-title">To get it ready <span class="muted" style="font-weight:500;font-size:0.78rem">· ${items.length}</span></div>
      <div class="card deal-prep"><div class="small" style="margin-bottom:8px;color:var(--warning);font-weight:600">${esc(hu)}</div>
        ${items.map((i, n) => `<label class="row deal-prep-item" style="padding:5px 0;align-items:flex-start;gap:8px"><input type="checkbox" data-item="${n}" checked style="margin-top:3px"><div class="row-main"><div class="small">${esc(i.label)}</div><div class="small muted">${esc(owner(i.owner))}${i.lead ? ` · ${i.lead} day${i.lead === 1 ? "" : "s"} lead` : " · day of"}${i.from && i.from !== "delivery" && i.from !== "vehicle" ? ` · ${esc(i.from)}` : ""}</div></div></label>`).join("")}
      </div>
      <button class="btn btn-primary btn-block" data-act="apply" style="margin-top:10px">Put it on the delivery</button>
      <div class="hint">The photo is saved with the sale. The list goes on the delivery's prep checklist; anything with a lead time becomes a to-do for today. Nothing here is ever sent to the customer.</div>`;
    const close = openModal("Read from the paperwork", () => el, { focus: false });
    el.querySelector('[data-act="apply"]').addEventListener("click", () => {
      const keep = items.filter((_, n) => { const c = el.querySelector(`[data-item="${n}"]`); return !c || c.checked; });
      const out = applyDealRead(s, read, keep);
      close();
      toast(`${keep.length} on the prep list${out.tasks.length ? ` · ${out.tasks.length} to start today` : ""}`, "success");
      if (after) after();
    });
  }

  async function thumb(d, img) {
    let u = urls.get(d.id);
    if (!u) { const blob = await docBlob(d); if (!blob) { img.replaceWith(Object.assign(document.createElement("span"), { className: "sd-thumb-file", innerHTML: `${icon("image")}<span>Not on this phone yet</span>` })); return; } u = URL.createObjectURL(blob); urls.set(d.id, u); }
    img.src = u;
  }

  // The file, full size, with its date and the one way to get rid of it.
  function viewer(d, s, after, card) {
    openModal(d.name || (isImage(d) ? "Photo" : "File"), (close) => {
      const box = document.createElement("div");
      box.className = "sd-viewer";
      box.innerHTML = `<div class="sd-viewer-body"><div class="muted small">Loading…</div></div>
        <div class="small muted" style="margin-top:10px">${esc(s.customerName || "")} · ${esc(formatDateTime(d.at))}${d.uploaded ? " · backed up" : " · on this phone, waiting to back up"}</div>
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
        after();
        card.querySelector(".sd-count").innerHTML = `${icon("file")} ${docCount(s.id)}`;
        undoToast("File deleted", async () => {
          store.restore("docs", { ...snapshot, path: "", uploaded: null });
          if (blob) { const { cacheSet } = await import("../cachedb.js"); await cacheSet(`doc:${snapshot.id}`, blob); }
          syncDocs();
          after();
          card.querySelector(".sd-count").innerHTML = `${icon("file")} ${docCount(s.id)}`;
        });
      });
      return box;
    });
  }

  draw();
  syncDocs().then((n) => { if (n && el.isConnected) draw(); });
}
