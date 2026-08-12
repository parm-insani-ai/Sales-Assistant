// Monthly manufacturer specials board. Keep the current APR / lease / cash
// offers by model in one place so you can quote them instantly and drop them
// into a deal. Editable in seconds each month; ships with a one-tap seeder for
// the current Nissan Canada national offers.

import * as store from "../store.js";
import { openModal, buildForm, toast, confirmDialog, emptyState } from "../components.js";
import { currency, esc, formatDate, todayISO } from "../utils.js";
import { icon } from "../icons.js";

// Nissan Canada national representative offers (captured Aug 2026). These are a
// starting point — always confirm live numbers; regional/Atlantic offers vary.
const NISSAN_SEED = {
  label: "Nissan Canada · August 2026",
  expiry: "2026-08-31",
  items: [
    { model: "Rogue", financeApr: 0, financeTerm: 60, cash: 0, notes: "0% APR up to 60 mo (rep. $630/mo, $0 down). Incl. 0.5% rate reduction." },
    { model: "Rogue Plug-in Hybrid", financeApr: 0, financeTerm: 60, cash: 10000, notes: "$10,000 finance/lease cash (Aug 1–31)." },
    { model: "Kicks", leasePayment: 319, leaseTerm: 36, leaseDown: 4019, financeApr: 2.4, financeTerm: 60, notes: "Lease $319/mo · 36 mo, $4,019 down. Or from $157 bi-weekly @ 2.4% / 60 mo, $1,499 down." },
    { model: "Sentra", financeApr: 0, financeTerm: 36, leasePayment: 269, leaseTerm: 36, leaseDown: 3139, notes: "0% APR · 36 mo. Lease $269/mo · 36 mo, $3,139 down." },
    { model: "Pathfinder", leasePayment: 379, leaseTerm: 36, leaseDown: 4659, notes: "Lease $379/mo · 36 mo, $4,659 down." },
  ],
};

function offerLines(o) {
  const lines = [];
  if (o.financeApr != null && o.financeApr !== "") {
    lines.push(`${o.financeApr}% APR${o.financeTerm ? ` · ${o.financeTerm} mo` : ""}`);
  }
  if (o.leasePayment != null && o.leasePayment !== "") {
    lines.push(`Lease ${currency(o.leasePayment)}/mo${o.leaseTerm ? ` · ${o.leaseTerm} mo` : ""}${o.leaseDown ? ` · ${currency(o.leaseDown)} down` : ""}`);
  }
  if (o.cash) lines.push(`${currency(o.cash)} cash`);
  return lines;
}

export function renderSpecials(view) {
  const specials = store.all("specials")
    .sort((a, b) => String(a.model || "").localeCompare(String(b.model || "")));

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
      <span>Current specials</span>
      <button class="btn btn-sm btn-primary" data-act="add">${icon("plus")} Add</button>
    </div>
    <div class="special-list"></div>
    <div class="fab-note">Confirm live numbers before quoting — offers change monthly and by region. Tap a card to edit.</div>
  `;
  view.appendChild(el);

  const list = el.querySelector(".special-list");
  if (!specials.length) {
    list.innerHTML = `
      ${emptyState("tag", "No specials loaded", "Add your own, or load this month's Nissan Canada offers to start.")}
      <button class="btn btn-primary btn-block" data-act="seed" style="margin-top:12px">${icon("download")} Load ${esc(NISSAN_SEED.label)}</button>`;
    list.querySelector('[data-act="seed"]').addEventListener("click", seedNissan);
  } else {
    specials.forEach((sp) => list.appendChild(specialCard(sp)));
    const seedRow = document.createElement("button");
    seedRow.className = "btn btn-ghost btn-sm btn-block";
    seedRow.style.marginTop = "8px";
    seedRow.innerHTML = `${icon("download")} Re-load ${esc(NISSAN_SEED.label)}`;
    seedRow.addEventListener("click", seedNissan);
    list.appendChild(seedRow);
  }

  el.querySelector('[data-act="add"]').addEventListener("click", () => openSpecialForm());
}

function specialCard(sp) {
  const lines = offerLines(sp);
  const expired = sp.expiry && sp.expiry < todayISO();
  const el = document.createElement("div");
  el.className = "card card-tap";
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${icon("tag")} ${esc(sp.model || "Model")}</div>
        <div class="row-sub">${lines.length ? lines.map(esc).join(" · ") : "No offer details"}</div>
      </div>
      ${sp.expiry ? `<div class="row-meta"><div class="small ${expired ? "" : "muted"}" style="${expired ? "color:var(--danger)" : ""}">${expired ? "Expired" : "ends " + esc(formatDate(sp.expiry))}</div></div>` : ""}
    </div>
    ${sp.notes ? `<div class="small muted" style="margin-top:8px;white-space:pre-wrap">${esc(sp.notes)}</div>` : ""}
  `;
  el.addEventListener("click", () => openSpecialForm(sp));
  return el;
}

function seedNissan() {
  const existing = store.all("specials");
  const has = (model) => existing.some((s) => String(s.model).toLowerCase() === model.toLowerCase());
  let added = 0;
  NISSAN_SEED.items.forEach((it) => {
    if (has(it.model)) return;
    store.create("specials", { ...it, expiry: it.expiry || NISSAN_SEED.expiry, source: NISSAN_SEED.label });
    added++;
  });
  toast(added ? `Loaded ${added} Nissan offer${added === 1 ? "" : "s"}` : "Those offers are already loaded", added ? "success" : "");
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function openSpecialForm(existing) {
  const isEdit = !!existing;
  const sp = existing || {};
  openModal(isEdit ? "Edit special" : "New special", (close) => {
    const { element } = buildForm(
      [
        { name: "model", label: "Model", value: sp.model, required: true, placeholder: "Rogue" },
        { name: "financeApr", label: "Finance APR %", value: sp.financeApr, type: "number", inputmode: "decimal", half: true, placeholder: "0" },
        { name: "financeTerm", label: "Finance term (mo)", value: sp.financeTerm, type: "number", inputmode: "numeric", half: true, placeholder: "60" },
        { name: "leasePayment", label: "Lease $/mo", value: sp.leasePayment, type: "number", inputmode: "decimal", half: true, placeholder: "319" },
        { name: "leaseTerm", label: "Lease term (mo)", value: sp.leaseTerm, type: "number", inputmode: "numeric", half: true, placeholder: "36" },
        { name: "leaseDown", label: "Lease down $", value: sp.leaseDown, type: "number", inputmode: "decimal", half: true, placeholder: "4019" },
        { name: "cash", label: "Cash / bonus $", value: sp.cash, type: "number", inputmode: "decimal", half: true, placeholder: "0" },
        { name: "expiry", label: "Expires", value: sp.expiry || "", type: "date" },
        { name: "notes", label: "Details / fine print", value: sp.notes, type: "textarea", placeholder: "Stackable, down payment, conditions…" },
      ],
      {
        submitLabel: isEdit ? "Save" : "Add special",
        onSubmit: (data) => {
          if (isEdit) { store.update("specials", existing.id, data); toast("Special updated", "success"); }
          else { store.create("specials", data); toast("Special added", "success"); }
          close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    if (isEdit) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-danger btn-block";
      del.style.marginTop = "10px";
      del.textContent = "Delete special";
      del.addEventListener("click", async () => {
        if (await confirmDialog("Delete this special?")) {
          store.remove("specials", existing.id); toast("Deleted"); close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }
      });
      element.appendChild(del);
    }
    return element;
  });
}
