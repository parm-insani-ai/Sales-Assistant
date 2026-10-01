// Sold Tracker — the "Vehicles Sold Track" sheet, rebuilt as an app screen.
// One deal log per month with the full paper-tracker detail (lead type, stock,
// VIN, file/etch numbers, business manager, front + business-office commission)
// plus the make-ready checklist, and the sheet's summary panels: New vs Used,
// lead types, business managers, brands and models. It reads and writes the
// same "sales" collection the rest of the app uses — a sale logged by voice or
// from Goals shows up here, and a deal added here counts toward Goals.

import * as store from "../store.js";
import { openModal, buildForm, toast, undoToast, emptyState, swipeable } from "../components.js";
import { currency, esc, todayISO } from "../utils.js";
import { icon } from "../icons.js";
import { afterSale, leadByName } from "../connections.js";
import { downloadXlsx } from "../xlsxwrite.js";
import { LEAD_TYPES, MAKE_READY, dealTotal, dealFront, dealBO, dealSummary, trackerSheet } from "../dealstats.js";

// The deal math lives in dealstats.js (the Performance screen and the export
// share it); these names stay exported from here for the screens that import them.
export { LEAD_TYPES, dealTotal, dealFront, dealBO };

function vehLabel(s) {
  return [s.year, s.brand, s.model, s.trim].filter(Boolean).join(" ") || s.vehicle || "Vehicle";
}

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function renderSoldLog(view) {
  let ym = todayISO().slice(0, 7); // selected month
  let yearMode = false;

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="row" style="margin:2px 0 12px;gap:8px">
      <button class="btn btn-ghost btn-sm" data-nav="-1" aria-label="Previous month">‹</button>
      <div class="strong" id="sl-month" style="flex:1;text-align:center"></div>
      <button class="btn btn-ghost btn-sm" data-nav="1" aria-label="Next month">›</button>
      <button class="btn btn-ghost btn-sm" data-nav="year">Year</button>
      <button class="btn btn-ghost btn-sm" data-act="export" aria-label="Export spreadsheet">${icon("download")}</button>
    </div>
    <div id="sl-list"></div>
    <button class="btn btn-primary btn-block" data-act="add" style="margin:12px 0 4px">${icon("plus")} Log a deal</button>
    <div id="sl-stats"></div>
  `;
  view.appendChild(el);

  const inScope = (s) => String(s.saleDate || s.createdAt || "").slice(0, yearMode ? 4 : 7) === (yearMode ? ym.slice(0, 4) : ym);
  const scoped = () => store.all("sales").filter(inScope)
    .sort((a, b) => String(a.saleDate || "").localeCompare(String(b.saleDate || "")));

  const draw = () => {
    el.querySelector("#sl-month").textContent = yearMode ? ym.slice(0, 4) : monthLabel(ym);
    el.querySelector('[data-nav="year"]').classList.toggle("btn-primary", yearMode);
    drawList();
    drawStats();
  };

  const drawList = () => {
    const box = el.querySelector("#sl-list");
    box.innerHTML = "";
    const deals = scoped();
    if (!deals.length) {
      box.innerHTML = emptyState("dollar", "No deals this " + (yearMode ? "year" : "month"), "Log one below — every sale you track builds the summaries.");
      return;
    }
    deals.forEach((s, i) => {
      const card = document.createElement("div");
      card.className = "card card-tap";
      const ready = MAKE_READY.filter(([k]) => s.makeReady && s.makeReady[k]).length;
      card.innerHTML = `
        <div class="row">
          <div class="row-main">
            <div class="row-title">${i + 1}. ${esc(s.customerName || "Customer")}
              ${s.newUsed ? `<span class="badge ${s.newUsed === "New" ? "badge-soon" : ""}">${esc(s.newUsed)}</span>` : ""}
            </div>
            <div class="row-sub">${esc(vehLabel(s))}${s.stock ? ` · ${esc(s.stock)}` : ""}${s.leadType ? ` · ${esc(s.leadType)}` : ""}</div>
          </div>
          <div class="row-meta">
            <div class="strong mono">${currency(dealTotal(s))}</div>
            ${s.bm ? `<div class="small muted">${esc(s.bm)}</div>` : ""}
          </div>
        </div>
        <div class="btn-row" style="margin-top:10px;gap:6px">
          ${MAKE_READY.map(([k, lb]) =>
            `<button type="button" class="btn btn-sm ${s.makeReady && s.makeReady[k] ? "btn-primary" : "btn-ghost"}" data-mr="${k}" style="padding:4px 9px;font-size:0.72rem">${lb}</button>`).join("")}
          <span class="small muted mono" style="margin-left:auto">${ready}/${MAKE_READY.length}</span>
        </div>`;
      card.querySelectorAll("[data-mr]").forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const mr = { ...(s.makeReady || {}) };
          mr[b.dataset.mr] = !mr[b.dataset.mr];
          store.update("sales", s.id, { makeReady: mr });
          draw();
        }));
      card.addEventListener("click", () => openDealForm(s, draw));
      box.appendChild(swipeable(card, {
        onDelete: (restoreRow) => {
          const snapshot = { ...s };
          store.remove("sales", s.id);
          draw();
          undoToast("Deal deleted", () => { store.restore("sales", snapshot); draw(); });
        },
      }));
    });
  };

  const drawStats = () => {
    const deals = scoped();
    const box = el.querySelector("#sl-stats");
    if (!deals.length) { box.innerHTML = ""; return; }

    const sm = dealSummary(deals);
    const money = (v) => currency(Math.round(v));
    const pctS = (v) => `${Math.round(v * 10) / 10}%`;

    // New vs Used panel — same rows as the sheet.
    const nuRows = [
      ["Deals", sm.news, sm.useds, sm.count],
      ["Share", pctS(sm.share.New), pctS(sm.share.Used), sm.count ? "100%" : "0%"],
      ["Avg front", money(sm.avgFront.New), money(sm.avgFront.Used), money(sm.avgFront.Total)],
      ["Front total", money(sm.frontTotal.New), money(sm.frontTotal.Used), money(sm.frontTotal.Total)],
      ["Avg B.O.", money(sm.avgBO.New), money(sm.avgBO.Used), money(sm.avgBO.Total)],
      ["Avg total", money(sm.avgTotal.New), money(sm.avgTotal.Used), money(sm.avgTotal.Total)],
    ];
    const byLead = sm.byLead.filter((l) => l.deals).map((l) => [l.type, l]).concat(sm.untyped ? [["Untracked", { deals: sm.untyped, total: 0, avg: 0, pct: 0 }]] : []);
    const byBM = sm.byBM.map((b) => [b.bm, b]);
    const byBrand = sm.byBrand.filter((b) => b.deals).map((b) => [b.brand, b]);
    const byModel = sm.byModel.filter((m) => m.deals).map((m) => [m.model, m]);

    const grid3 = (rows) => rows.map(([lb, a, b, c]) => `
      <div class="row" style="padding:5px 0;border-bottom:1px solid var(--border)">
        <div class="small muted" style="flex:1.2">${esc(lb)}</div>
        <div class="small mono" style="flex:1;text-align:right">${esc(String(a))}</div>
        <div class="small mono" style="flex:1;text-align:right">${esc(String(b))}</div>
        <div class="small mono strong" style="flex:1;text-align:right">${esc(String(c))}</div>
      </div>`).join("");

    box.innerHTML = `
      <div class="section-title" style="margin-top:16px">New vs used</div>
      <div class="card">
        <div class="row" style="padding-bottom:5px;border-bottom:1px solid var(--border)">
          <div class="small strong" style="flex:1.2"></div>
          <div class="small strong" style="flex:1;text-align:right">New</div>
          <div class="small strong" style="flex:1;text-align:right">Used</div>
          <div class="small strong" style="flex:1;text-align:right">Total</div>
        </div>
        ${grid3(nuRows)}
      </div>

      <div class="section-title">Where deals came from</div>
      <div class="card">
        ${byLead.map(([k, l]) => `
          <div class="row" style="padding:6px 0;border-bottom:1px solid var(--border)">
            <div class="small strong" style="flex:1.4">${esc(k)}</div>
            <div class="small mono" style="flex:0.6;text-align:right">${l.deals}</div>
            <div class="small mono" style="flex:1;text-align:right">${money(l.total)}</div>
            <div class="small mono muted" style="flex:1.2;text-align:right;white-space:nowrap">${money(l.avg)} avg</div>
            <div class="small mono muted" style="flex:0.7;text-align:right">${pctS(l.pct)}</div>
          </div>`).join("")}
      </div>

      ${byBM.length ? `
      <div class="section-title">Business managers</div>
      <div class="card">
        ${byBM.map(([k, b]) => `
          <div class="row" style="padding:6px 0;border-bottom:1px solid var(--border)">
            <div class="small strong" style="flex:1.4">${esc(k)}</div>
            <div class="small mono" style="flex:0.6;text-align:right">${b.deals}</div>
            <div class="small mono" style="flex:1;text-align:right">${money(b.total)}</div>
            <div class="small mono muted" style="flex:1.3;text-align:right;white-space:nowrap">${money(b.avg)} avg B.O.</div>
          </div>`).join("")}
      </div>` : ""}

      ${byBrand.length ? `
      <div class="section-title">Manufacturers</div>
      <div class="card"><div class="btn-row" style="gap:8px">
        ${byBrand.map(([k, b]) => `<span class="badge">${esc(k)} · ${b.deals}</span>`).join("")}
      </div></div>` : ""}

      ${byModel.length ? `
      <div class="section-title">Models</div>
      <div class="card">
        ${byModel.slice(0, 12).map(([k, m]) => `
          <div class="row" style="padding:5px 0;border-bottom:1px solid var(--border)">
            <div class="small strong" style="flex:2">${esc(k)}</div>
            <div class="small mono" style="flex:1;text-align:right">${m.deals}</div>
            <div class="small mono muted" style="flex:1;text-align:right">${m.news} new · ${m.useds} used</div>
          </div>`).join("")}
      </div>` : ""}
    `;
  };

  el.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.nav === "year") { yearMode = !yearMode; draw(); return; }
    yearMode = false;
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + Number(b.dataset.nav), 1);
    ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    draw();
  }));
  el.querySelector('[data-act="add"]').addEventListener("click", () => openDealForm(null, draw));

  // Export the current view (month or year) as the "Vehicles Sold Track"
  // sheet itself, filled in: the sheet's columns in its order, the summary
  // panels down the right, numbers as numbers so Excel keeps summing them.
  el.querySelector('[data-act="export"]').addEventListener("click", () => exportTracker(scoped(), yearMode ? ym.slice(0, 4) : ym));

  draw();
}

// The tracker sheet, filled in and downloaded. `stamp` names the file.
export function exportTracker(deals, stamp) {
  if (!deals.length) { toast("Nothing to export for " + stamp); return false; }
  const s = store.getSettings();
  downloadXlsx(`vehicles-sold-track-${stamp}.xlsx`, [trackerSheet(deals, { leads: store.all("leads"), plate: s.myPlate || "" })]);
  toast("Tracker sheet downloaded", "success");
  return true;
}

// The full tracker form — a superset of the quick "Log a sale" form. Editing a
// simple sale here upgrades it with the tracker fields in place.
export function openDealForm(existing, onDone) {
  const isEdit = !!existing;
  const s = existing || {};
  openModal(isEdit ? "Deal details" : "Log a deal", (close) => {
    const { element } = buildForm(
      [
        { name: "customerName", label: "Customer", value: s.customerName, required: true },
        { name: "phone", label: "Phone", value: s.phone || (s.leadId && (store.get("leads", s.leadId) || {}).phone) || "", type: "tel", inputmode: "tel", half: true, placeholder: "(902) 555-1234" },
        { name: "saleDate", label: "Sale date", value: s.saleDate || todayISO(), type: "date", half: true },
        { name: "deliveredAt", label: "Delivered", value: s.deliveredAt || "", type: "date", half: true },
        { name: "leadType", label: "Lead type", value: s.leadType || "", type: "select", half: true, options: ["", ...LEAD_TYPES] },
        { name: "brand", label: "Brand", value: s.brand, half: true, placeholder: "Nissan" },
        { name: "model", label: "Model", value: s.model, half: true, placeholder: "Rogue" },
        { name: "trim", label: "Trim", value: s.trim, half: true, placeholder: "SV" },
        { name: "year", label: "Year", value: s.year, type: "number", inputmode: "numeric", half: true, placeholder: "2026" },
        { name: "newUsed", label: "New / used", value: s.newUsed || "", type: "select", half: true, options: ["", "New", "Used"] },
        { name: "kms", label: "KMs", value: s.kms, type: "number", inputmode: "numeric", half: true, placeholder: "25000" },
        { name: "stock", label: "Stock #", value: s.stock, half: true, placeholder: "NHP1950" },
        { name: "vin", label: "VIN", value: s.vin, half: true },
        { name: "fileNo", label: "File #", value: s.fileNo, half: true },
        { name: "etchNo", label: "Etch #", value: s.etchNo, half: true },
        { name: "bm", label: "Business manager", value: s.bm, placeholder: "Who worked the back end" },
        { name: "frontComm", label: "Front commission", value: s.frontComm, type: "number", inputmode: "decimal", half: true, placeholder: "300" },
        { name: "boComm", label: "B. office comm", value: s.boComm, type: "number", inputmode: "decimal", half: true, placeholder: "200" },
        { name: "bizGross", label: "Business gross", value: s.bizGross, type: "number", inputmode: "decimal", placeholder: "2500", hint: "Front + business office commission becomes your total for Goals." },
        { name: "notes", label: "Notes", value: s.notes, type: "textarea" },
      ],
      {
        submitLabel: isEdit ? "Save deal" : "Log deal",
        onSubmit: (data) => {
          // Keep the rest of the app in sync: a composed vehicle string for
          // lists, and commission = the tracker total so Goals adds up.
          const vehicle = [data.year, data.brand, data.model, data.trim].filter(Boolean).join(" ") || s.vehicle || "";
          const total = (Number(data.frontComm) || 0) + (Number(data.boComm) || 0);
          const patch = { ...data, vehicle };
          if (data.frontComm !== "" || data.boComm !== "") patch.commission = total;
          if (isEdit) { store.update("sales", existing.id, patch); toast("Deal saved", "success"); }
          else {
            let leadId = null;
            const match = leadByName(data.customerName);
            leadId = match ? match.id
              : store.create("leads", { name: data.customerName, phone: data.phone || "", vehicleInterest: vehicle, stage: "sold", source: data.leadType || "Sale" }).id;
            // A number typed here is the customer's number.
            if (match && data.phone && !match.phone) store.update("leads", match.id, { phone: data.phone });
            store.create("sales", { ...patch, leadId, makeReady: {} });
            afterSale(leadId, { vehicle });
            toast("Deal logged", "success");
          }
          close();
          if (onDone) onDone();
        },
      }
    );
    return element;
  });
}
