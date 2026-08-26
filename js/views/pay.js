// Paycheck reconciliation — "did I get paid what the tracker says I earned?"
// Each pay period holds what ADP (or any payroll) actually paid; the app
// lines it up against the Sold Tracker's deals inside that period and shows
// the gap. Stubs come in three ways, easiest first: import the PDF straight
// from Files (on iPhone: share the stub → Save to Files → Import here),
// paste the stub's text, or type the numbers.

import * as store from "../store.js";
import { openModal, buildForm, toast, undoToast, emptyState, swipeable } from "../components.js";
import { currency, esc, todayISO, formatDate } from "../utils.js";
import { icon } from "../icons.js";
import { dealTotal } from "./soldlog.js";
import { extractPdfText, parseStub } from "../paystub.js";

// Deals whose sale date falls inside the period.
function dealsInPeriod(p) {
  const a = p.periodStart || "", b = p.periodEnd || p.payDate || "";
  if (!a || !b) return [];
  return store.all("sales").filter((s) => {
    const d = String(s.saleDate || s.createdAt || "").slice(0, 10);
    return d >= a && d <= b;
  });
}

function expectedFor(p) {
  return dealsInPeriod(p).reduce((t, s) => t + dealTotal(s), 0);
}

export function renderPay(view) {
  const el = document.createElement("div");
  el.innerHTML = `
    <div class="small muted" style="margin:2px 0 12px">Log each paycheck and entoa checks it against the Sold Tracker — every deal in the pay period, front and back — so short pays get caught while the deals are still fresh.</div>
    <div class="btn-row" style="margin-bottom:14px">
      <button class="btn btn-primary btn-block" data-act="pdf">${icon("upload")} Import stub (PDF)</button>
      <button class="btn btn-ghost btn-block" data-act="paste">${icon("edit")} Paste / type</button>
    </div>
    <input type="file" accept="application/pdf" id="pay-file" style="display:none">
    <div id="pay-list"></div>
  `;
  view.appendChild(el);

  const draw = () => {
    const box = el.querySelector("#pay-list");
    box.innerHTML = "";
    const checks = store.all("paychecks")
      .slice()
      .sort((a, b) => (b.payDate || b.periodEnd || "").localeCompare(a.payDate || a.periodEnd || ""));
    if (!checks.length) {
      box.innerHTML = emptyState("dollar", "No paychecks logged yet", "On your phone: open the stub in ADP, Share → Save to Files, then Import here. Or just type the numbers.");
      return;
    }
    checks.forEach((p) => {
      const paid = p.commissionPaid ?? null;
      const deals = dealsInPeriod(p);
      const expected = expectedFor(p);
      const delta = paid != null ? Math.round((paid - expected) * 100) / 100 : null;
      const card = document.createElement("div");
      card.className = "card card-tap";
      const range = p.periodStart && p.periodEnd ? `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` : (p.payDate ? formatDate(p.payDate) : "Pay period");
      card.innerHTML = `
        <div class="row">
          <div class="row-main">
            <div class="row-title">${esc(range)}</div>
            <div class="row-sub">${p.payDate ? `Paid ${esc(formatDate(p.payDate))} · ` : ""}${deals.length} deal${deals.length === 1 ? "" : "s"} in period</div>
          </div>
          <div class="row-meta">
            <div class="strong mono">${paid != null ? esc(currency(paid)) : "—"}</div>
            <div class="small muted">commission paid</div>
          </div>
        </div>
        <div class="row" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
          <div class="small muted">Tracker says ${esc(currency(Math.round(expected)))}</div>
          <div class="small strong" style="margin-left:auto;${delta == null ? "" : delta < -1 ? "color:var(--danger)" : "color:var(--brand)"}">
            ${delta == null ? "add what you were paid" : delta < -1 ? `short ${esc(currency(-delta))}` : delta > 1 ? `+${esc(currency(delta))} over` : "matches ✓"}
          </div>
        </div>`;
      card.addEventListener("click", () => openPeriodDetail(p, draw));
      box.appendChild(swipeable(card, {
        onDelete: (restoreRow) => {
          const snapshot = { ...p };
          store.remove("paychecks", p.id);
          draw();
          undoToast("Paycheck deleted", () => { store.restore("paychecks", snapshot); draw(); });
        },
      }));
    });
  };

  // --- PDF import: Files picker → on-device parse → confirm form ---
  const fileInput = el.querySelector("#pay-file");
  el.querySelector('[data-act="pdf"]').addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    toast("Reading the stub…");
    try {
      const text = await extractPdfText(file);
      const parsed = parseStub(text);
      openCheckForm(null, parsed, draw);
      const found = ["periodStart", "periodEnd", "payDate", "gross", "net", "commission"].filter((k) => parsed[k] != null).length;
      toast(found ? `Found ${found} field${found === 1 ? "" : "s"} — check and save` : "Couldn't read fields — enter them below", found ? "success" : "");
    } catch (e) {
      toast("Couldn't read that PDF — paste the text instead", "danger");
    }
  });

  el.querySelector('[data-act="paste"]').addEventListener("click", () => openPasteForm(draw));

  draw();
}

// Paste sheet: one big textarea; parse on submit and hand off to the form.
function openPasteForm(onDone) {
  openModal("Paste your stub", (close) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="small muted" style="margin-bottom:10px">Paste the stub's text (or skip straight to entering numbers).</div>
      <div class="field"><textarea id="ps-text" rows="6" placeholder="Pay Date 08/15/2026&#10;Gross Pay $4,120.00 …"></textarea></div>
      <div class="btn-row">
        <button class="btn btn-primary btn-block" id="ps-go">Read it</button>
        <button class="btn btn-ghost btn-block" id="ps-manual">Enter manually</button>
      </div>`;
    wrap.querySelector("#ps-go").addEventListener("click", () => {
      const parsed = parseStub(wrap.querySelector("#ps-text").value);
      close();
      openCheckForm(null, parsed, onDone);
    });
    wrap.querySelector("#ps-manual").addEventListener("click", () => { close(); openCheckForm(null, {}, onDone); });
    return wrap;
  });
}

// The confirm/edit form for one paycheck.
export function openCheckForm(existing, prefill, onDone) {
  const isEdit = !!existing;
  const p = existing || prefill || {};
  openModal(isEdit ? "Paycheck" : "Confirm paycheck", (close) => {
    const { element } = buildForm(
      [
        { name: "periodStart", label: "Period start", value: p.periodStart || "", type: "date", half: true },
        { name: "periodEnd", label: "Period end", value: p.periodEnd || "", type: "date", half: true },
        { name: "payDate", label: "Pay date", value: p.payDate || todayISO(), type: "date" },
        { name: "commissionPaid", label: "Commission paid", value: p.commissionPaid ?? p.commission ?? "", type: "number", inputmode: "decimal", placeholder: "0.00", hint: "The commission/bonus earnings on the stub — this is what gets checked against the tracker." },
        { name: "gross", label: "Gross pay", value: p.gross ?? "", type: "number", inputmode: "decimal", half: true, placeholder: "0.00" },
        { name: "net", label: "Net pay", value: p.net ?? "", type: "number", inputmode: "decimal", half: true, placeholder: "0.00" },
        { name: "notes", label: "Notes", value: p.notes || "", type: "textarea" },
      ],
      {
        submitLabel: isEdit ? "Save" : "Add paycheck",
        onSubmit: (data) => {
          const rec = {
            ...data,
            commissionPaid: data.commissionPaid === "" ? null : Number(data.commissionPaid),
            gross: data.gross === "" ? null : Number(data.gross),
            net: data.net === "" ? null : Number(data.net),
          };
          if (isEdit) { store.update("paychecks", existing.id, rec); toast("Saved", "success"); }
          else { store.create("paychecks", rec); toast("Paycheck added", "success"); }
          close();
          if (onDone) onDone();
        },
      }
    );
    return element;
  });
}

// Detail: the deals the tracker expects to be on this cheque.
function openPeriodDetail(p, onDone) {
  openModal("Pay period", (close) => {
    const wrap = document.createElement("div");
    const deals = dealsInPeriod(p);
    const expected = expectedFor(p);
    const paid = p.commissionPaid;
    const delta = paid != null ? Math.round((paid - expected) * 100) / 100 : null;
    const spiffs = store.all("spifs").filter((x) => !x.expiry || !p.periodStart || x.expiry >= p.periodStart);
    wrap.innerHTML = `
      <div class="kv"><span class="k">Commission paid</span><span class="v mono strong">${paid != null ? esc(currency(paid)) : "—"}</span></div>
      <div class="kv"><span class="k">Tracker expected</span><span class="v mono">${esc(currency(Math.round(expected)))}</span></div>
      ${delta != null ? `<div class="kv"><span class="k">Difference</span><span class="v mono strong" style="color:${delta < -1 ? "var(--danger)" : "var(--brand)"}">${delta < -1 ? "short " + esc(currency(-delta)) : delta > 1 ? "+" + esc(currency(delta)) : "matches ✓"}</span></div>` : ""}
      <div class="section-title" style="margin-top:12px">Deals in this period</div>
      ${deals.length ? deals.map((s) => `
        <div class="kv"><span class="k">${esc(s.customerName || "Deal")}${s.vehicle ? ` · ${esc(s.vehicle)}` : ""}</span>
        <span class="v mono">${esc(currency(dealTotal(s)))}</span></div>`).join("")
        : `<div class="muted small" style="margin-bottom:8px">No tracked deals in this date range — check the period dates.</div>`}
      ${delta != null && delta < -1 && spiffs.length ? `<div class="hint" style="margin-top:10px">If the gap isn't a deal, check spiffs: ${esc(spiffs.map((x) => x.title).slice(0, 3).join(" · "))}</div>` : ""}
      <div class="btn-row" style="margin-top:14px">
        <button class="btn btn-primary btn-block" id="pd-edit">${icon("edit")} Edit</button>
      </div>`;
    wrap.querySelector("#pd-edit").addEventListener("click", () => { close(); openCheckForm(p, null, onDone); });
    return wrap;
  });
}
