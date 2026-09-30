// The month's sales math and the sale form. (The Goals page they were on
// is gone — the Sales target on Home carries all of it.)

import * as store from "../store.js";
import { openModal, buildForm, toast, confirmDialog } from "../components.js";
import { currency, esc, formatDate, todayISO } from "../utils.js";
import { icon } from "../icons.js";
import { afterSale, leadByName } from "../connections.js";

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

export function saleCard(sale) {
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
        { name: "saleDate", label: "Sale date", value: sale.saleDate || todayISO(), type: "date", half: true },
        // The target sheet counts sales by category.
        { name: "newUsed", label: "New / used", value: sale.newUsed || "", type: "select", half: true, options: [{ value: "", label: "—" }, { value: "New", label: "New" }, { value: "Used", label: "Used" }] },
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
            // Every sale gets a customer: link by name if one exists, otherwise
            // create one — so the buyer shows up in Leads/Comms for follow-up.
            let leadId = sale.leadId || null;
            if (!leadId) {
              const match = leadByName(data.customerName);
              leadId = match ? match.id
                : store.create("leads", { name: data.customerName, vehicleInterest: data.vehicle || "", stage: "sold", source: "Sale" }).id;
            }
            store.create("sales", { ...data, leadId, deliveryId: sale.deliveryId || null });
            afterSale(leadId, { vehicle: data.vehicle, fromDelivery: !!sale.deliveryId });
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
