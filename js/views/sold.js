// Sold: everyone you've sold, newest first by month, and the paperwork on
// each sale — photographed or scanned right here and kept with the
// customer. Reached from the Sold tile on Home.

import * as store from "../store.js";
import { esc, formatDateTime } from "../utils.js";
import { icon } from "../icons.js";
import { openModal, toast, undoToast, emptyState } from "../components.js";
import { docsFor, docCount, addDoc, docBlob, removeDoc, syncDocs, pendingDocs } from "../docs.js";

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
    }
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
