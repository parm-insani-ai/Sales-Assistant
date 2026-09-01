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
  label: "Nissan Canada · September 2026 (SB2609-ATL, Atlantic)",
  expiry: "2026-09-30",
  items: [
    { model: "Rogue",
      aprByTerm: { 24: 0, 36: 0, 48: 0, 60: 0, 72: 2.9, 84: 2.9 },
      leasePayment: 429, leaseTerm: 36, leaseDown: 0, leaseTrim: "S",
      notes: "Special finance 0% up to 60 mo (2.9% at 72/84). Advertised: Rogue S lease $99 WEEKLY @ 0%/36 ULOW (16k km), $0 down, incl. $1,200 Clear-out bonus (lease only). SV+ trims: $5,000 non-stackable cash alt on std-rate/cash deals. 0.5% loyalty rate reduction (1.0% for returning Qashqai)." },
    { model: "Rogue Plug-in Hybrid", cash: 10000,
      notes: "$10,000 std-rate/cash-buyer cash. Std rates apply (7.24%+). Not EVAP-eligible." },
    { model: "Kicks", cash: 500,
      aprByTerm: { 24: 0, 36: 0, 48: 3.4, 60: 3.4, 72: 4.4, 84: 4.4 },
      notes: "0% up to 36 mo + $500 finance cash + $1,000 Welcome/Conquest bonus. Lease 2.9% (36-60) w/ $1,000 lease cash. Non-stackable alt: $2,000-$3,000 on SV/SR trims. 0.5% loyalty (1.0% returning Kicks/Qashqai)." },
    { model: "Sentra", cash: 750,
      aprByTerm: { 24: 0, 36: 0, 48: 3.9, 60: 4.9, 72: 4.9, 84: 4.9 },
      leasePayment: 320, leaseTerm: 36, leaseDown: 699, leaseTrim: "SV",
      notes: "0% up to 36 mo + $750 finance cash (OR up to $2,750 bonus cash on SR trims, non-stackable). Advertised: SV lease $320/mo · 36 mo ULOW, $699 down, incl. loyalty reduction. 0.5-1.0% loyalty for returning Sentra." },
    { model: "Pathfinder",
      aprByTerm: { 24: 5.4, 36: 5.4, 48: 5.9, 60: 5.9, 72: 6.4, 84: 6.4 },
      notes: "Special finance 5.4-6.4%. Lease: SL/PRO-4X/Platinum 4.9% w/ $5,000 lease cash." },
    { model: "Murano",
      aprByTerm: { 24: 4.9, 36: 4.9, 48: 5.4, 60: 5.4, 72: 5.9, 84: 5.9 },
      notes: "MY26 special finance 4.9-5.9%. $2,000 non-stackable cash alt. MY27: 1.0% loyalty for returning Murano owners." },
    { model: "Frontier",
      aprByTerm: { 24: 5.4, 36: 5.4, 48: 6.4, 60: 6.4, 72: 6.9, 84: 6.9 },
      notes: "Special finance 5.4-6.9%." },
    { model: "Armada", cash: 5000,
      aprByTerm: { 24: 4.9, 36: 4.9, 48: 4.9, 60: 4.9, 72: 4.9, 84: 4.9 },
      notes: "4.9% + $5,000 on special finance, OR $7,500 non-stackable/cash-purchase bonus." },
    { model: "Leaf", cash: 1000,
      aprByTerm: { 24: 0, 36: 0, 48: 0, 60: 0, 72: 1.4, 84: 1.9 },
      notes: "S+/SV+: 0% up to 60 + $1,000. Platinum+: $5,000 @ 3.9%. EVAP-eligible (all 2026 trims). Lease S+/SV+ 0%." },
    { model: "Ariya", cash: 6000,
      aprByTerm: { 24: 6.4, 36: 6.4, 48: 6.4, 60: 6.4, 72: 6.9, 84: 6.9 },
      notes: "Cash/rates vary by trim: SV FWD & SL e-4ORCE $6,000 @6.4%; SL+ FWD $7,000 @7.4%; SL+/Platinum+ e-4ORCE $5,000 @3.4%. EVAP: SV FWD, SL e-4ORCE, SL+ FWD. Verify trim at desk." },
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
        { name: "leaseTrim", label: "Lease trim (advertised)", value: sp.leaseTrim, half: true, placeholder: "SV", hint: "The advertised lease applies only to this trim; other trims get a computed lease." },
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
