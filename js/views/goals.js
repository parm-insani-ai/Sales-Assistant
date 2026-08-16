// Commission & goal tracker. Log the gross/commission on each sale and track
// month-to-date progress against monthly unit and commission goals.

import * as store from "../store.js";
import { openModal, buildForm, toast, confirmDialog, emptyState } from "../components.js";
import { navigate } from "../router.js";
import { currency, esc, formatDate, todayISO } from "../utils.js";
import { icon } from "../icons.js";

function monthKey(iso) {
  return (iso || "").slice(0, 7); // YYYY-MM
}
function thisMonthKey() {
  return new Date().toISOString().slice(0, 7);
}
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Aggregate a month's sales.
export function monthSummary(mKey = thisMonthKey()) {
  const sales = store.all("sales").filter((s) => monthKey(s.saleDate) === mKey);
  const units = sales.length;
  const front = sales.reduce((a, s) => a + (Number(s.frontGross) || 0), 0);
  const back = sales.reduce((a, s) => a + (Number(s.backGross) || 0), 0);
  const commission = sales.reduce((a, s) => a + (Number(s.commission) || 0), 0);
  return { sales, units, front, back, totalGross: front + back, commission };
}

// The appointment funnel — the north star. Set → confirmed → showed → sold.
export function apptFunnel(mKey = thisMonthKey()) {
  const now = Date.now();
  const appts = store.all("appointments").filter((a) => a.status !== "canceled" && monthKey(a.when) === mKey);
  const isPast = (a) => { const t = new Date(a.when).getTime(); return !isNaN(t) && t < now; };
  const set = appts.length;
  const confirmed = appts.filter((a) => a.confirmed).length;
  const showed = appts.filter((a) => a.outcome === "showed" || a.outcome === "sold").length;
  const sold = appts.filter((a) => a.outcome === "sold").length;
  const past = appts.filter(isPast).length;
  const showRate = past ? Math.round((showed / past) * 100) : 0; // of appts that have happened
  const closeRate = showed ? Math.round((sold / showed) * 100) : 0;
  return { set, confirmed, showed, sold, past, showRate, closeRate };
}

function progressCard(label, value, goal, fmt) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  const hit = goal > 0 && value >= goal;
  return `
    <div class="card">
      <div class="row">
        <div class="strong">${esc(label)}</div>
        <div class="mono strong">${fmt(value)} <span class="muted">/ ${fmt(goal)}</span></div>
      </div>
      <div class="progress"><span style="width:${pct}%;background:${hit ? "var(--success)" : "var(--accent)"}"></span></div>
      <div class="small muted" style="margin-top:6px">${hit ? `<span style="color:var(--success)">${icon("check")} Goal reached!</span>` : `${pct}% — ${fmt(Math.max(0, goal - value))} to go`}</div>
    </div>`;
}

export function renderGoals(view) {
  const s = store.getSettings();
  const mKey = thisMonthKey();
  const sum = monthSummary(mKey);
  const funnel = apptFunnel(mKey);

  const el = document.createElement("div");
  el.innerHTML = `
    <div style="margin:2px 4px 14px"><div class="muted small">Month to date</div><div class="strong" style="font-size:1.15rem">${esc(monthLabel(mKey))}</div></div>

    <div class="section-title">Appointments — the goal</div>
    <div class="funnel-grid">
      <div class="stat"><div class="stat-value" style="color:var(--brand)">${funnel.set}</div><div class="stat-label">Set</div></div>
      <div class="stat"><div class="stat-value">${funnel.confirmed}</div><div class="stat-label">Confirmed</div></div>
      <div class="stat"><div class="stat-value">${funnel.showed}</div><div class="stat-label">Showed</div></div>
      <div class="stat"><div class="stat-value" style="color:var(--success)">${funnel.sold}</div><div class="stat-label">Sold</div></div>
    </div>
    <div class="card" style="margin-top:6px">
      <div class="row"><span class="muted small">Show rate <span class="muted">(of ${funnel.past} past)</span></span><span class="mono strong">${funnel.showRate}%</span></div>
      <div class="row" style="margin-top:8px"><span class="muted small">Appointment → sold</span><span class="mono strong" style="color:var(--success)">${funnel.closeRate}%</span></div>
    </div>
    ${progressCard("Appointments set", funnel.set, s.goalAppointments, (v) => String(v))}

    <div class="section-title">Sales this month</div>
    <div class="stat-grid" style="margin-bottom:6px">
      <div class="stat"><div class="stat-value">${sum.units}</div><div class="stat-label">Units sold</div></div>
      <div class="stat"><div class="stat-value" style="color:var(--success)">${currency(sum.commission)}</div><div class="stat-label">Commission</div></div>
      <div class="stat"><div class="stat-value mono" style="font-size:1.25rem">${currency(sum.totalGross)}</div><div class="stat-label">Total gross</div></div>
      <div class="stat"><div class="stat-value mono" style="font-size:1.25rem">${sum.units ? currency(Math.round(sum.commission / sum.units)) : "$0"}</div><div class="stat-label">Avg / unit</div></div>
    </div>

    ${progressCard("Units", sum.units, s.goalUnits, (v) => String(v))}
    ${progressCard("Commission", sum.commission, s.goalCommission, (v) => currency(v))}
    <button class="btn btn-ghost btn-sm btn-block" data-act="edit-goals">Edit monthly goals</button>

    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>This month's sales</span>
      <button class="btn btn-sm btn-primary" data-act="add-sale">＋ Log sale</button>
    </div>
    <div class="sales-list"></div>
  `;
  view.appendChild(el);

  const listEl = el.querySelector(".sales-list");
  if (!sum.sales.length) {
    listEl.innerHTML = emptyState("dollar", "No sales logged yet", "Tap “Log sale” after you close a deal.");
  } else {
    sum.sales
      .slice()
      .sort((a, b) => (b.saleDate || "").localeCompare(a.saleDate || ""))
      .forEach((sale) => listEl.appendChild(saleCard(sale)));
  }

  el.querySelector('[data-act="add-sale"]').addEventListener("click", () => openSaleForm());
  el.querySelector('[data-act="edit-goals"]').addEventListener("click", () => openGoalsForm());
}

function saleCard(sale) {
  const el = document.createElement("div");
  el.className = "card card-tap";
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(sale.customerName || "Customer")}</div>
        <div class="row-sub">${esc(sale.vehicle || "")}${sale.saleDate ? " · " + esc(formatDate(sale.saleDate)) : ""}</div>
      </div>
      <div class="row-meta">
        <div class="strong mono" style="color:var(--success)">${currency(sale.commission)}</div>
        <div class="small muted mono">${currency((Number(sale.frontGross)||0)+(Number(sale.backGross)||0))} gross</div>
      </div>
    </div>
  `;
  el.addEventListener("click", () => openSaleForm(sale));
  return el;
}

export function openSaleForm(existing, prefill = {}, onDone) {
  const isEdit = !!existing;
  const sale = existing || prefill;
  openModal(isEdit ? "Edit sale" : "Log a sale", (close) => {
    const { element } = buildForm(
      [
        { name: "customerName", label: "Customer", value: sale.customerName, required: true },
        { name: "vehicle", label: "Vehicle", value: sale.vehicle, placeholder: "2024 RAV4 XLE" },
        { name: "saleDate", label: "Sale date", value: sale.saleDate || todayISO(), type: "date" },
        { name: "frontGross", label: "Front gross", value: sale.frontGross, type: "number", inputmode: "decimal", half: true, placeholder: "0" },
        { name: "backGross", label: "Back gross", value: sale.backGross, type: "number", inputmode: "decimal", half: true, placeholder: "0" },
        { name: "commission", label: "Your commission", value: sale.commission, type: "number", inputmode: "decimal", placeholder: "0", hint: "What you actually get paid on this deal." },
        { name: "notes", label: "Notes", value: sale.notes, type: "textarea" },
      ],
      {
        submitLabel: isEdit ? "Save" : "Log sale",
        onSubmit: (data) => {
          if (isEdit) { store.update("sales", existing.id, data); toast("Sale updated", "success"); }
          else {
            store.create("sales", { ...data, leadId: sale.leadId || null, deliveryId: sale.deliveryId || null });
            // Keep the linked customer's pipeline stage in sync (don't downgrade
            // a delivered customer back to sold).
            if (sale.leadId) {
              const lead = store.get("leads", sale.leadId);
              if (lead && lead.stage !== "delivered") store.update("leads", sale.leadId, { stage: "sold" });
            }
            toast("Sale logged", "success");
          }
          close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
          if (onDone) onDone();
        },
      }
    );
    if (isEdit) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-danger btn-block";
      del.style.marginTop = "10px";
      del.textContent = "Delete sale";
      del.addEventListener("click", async () => {
        if (await confirmDialog("Delete this sale record?")) {
          store.remove("sales", existing.id); toast("Deleted"); close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }
      });
      element.appendChild(del);
    }
    return element;
  });
}

function openGoalsForm() {
  const s = store.getSettings();
  openModal("Monthly goals", (close) => {
    const { element } = buildForm(
      [
        { name: "goalAppointments", label: "Appointments set / month", value: s.goalAppointments, type: "number", inputmode: "numeric", hint: "Your north-star activity — set this and the app rallies around it." },
        { name: "goalUnits", label: "Units per month", value: s.goalUnits, type: "number", inputmode: "numeric", half: true },
        { name: "goalCommission", label: "Commission ($) per month", value: s.goalCommission, type: "number", inputmode: "decimal", half: true },
      ],
      {
        submitLabel: "Save goals",
        onSubmit: (data) => {
          store.updateSettings({ goalAppointments: Number(data.goalAppointments) || 0, goalUnits: Number(data.goalUnits) || 0, goalCommission: Number(data.goalCommission) || 0 });
          toast("Goals saved", "success");
          close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    return element;
  });
}
