// Delivery prep — checklists to get a sold car ready for handoff.

import * as store from "../store.js";
import { openModal, buildForm, toast, confirmDialog, emptyState } from "../components.js";
import { navigate } from "../router.js";
import { esc, formatDate, relativeDay, daysFromToday, todayISO } from "../utils.js";
import { icon } from "../icons.js";
import { openReferralCapture } from "./referrals.js";

function progress(d) {
  const items = d.checklist || [];
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, pct: items.length ? Math.round((done / items.length) * 100) : 0 };
}

export function renderDeliveries(view, { param }) {
  if (param) return renderDeliveryDetail(view, param);

  const deliveries = store.all("deliveries");
  const active = deliveries.filter((d) => d.status !== "delivered");
  const done = deliveries.filter((d) => d.status === "delivered");

  const el = document.createElement("div");
  if (!deliveries.length) {
    el.innerHTML = emptyState("check", "No deliveries yet", "Start one from a lead, or tap + to create one.");
    view.appendChild(el);
    return;
  }

  const sortByDate = (a, b) => (a.deliveryDate || "9999").localeCompare(b.deliveryDate || "9999");

  el.innerHTML = `
    ${active.length ? `<div class="section-title">In progress</div><div class="active-list"></div>` : ""}
    ${done.length ? `<div class="section-title">Delivered</div><div class="done-list"></div>` : ""}
  `;
  view.appendChild(el);

  if (active.length) {
    const c = el.querySelector(".active-list");
    active.sort(sortByDate).forEach((d) => c.appendChild(deliveryCard(d)));
  }
  if (done.length) {
    const c = el.querySelector(".done-list");
    done.sort((a, b) => (b.deliveryDate || "").localeCompare(a.deliveryDate || "")).forEach((d) => c.appendChild(deliveryCard(d)));
  }
}

function deliveryCard(d) {
  const el = document.createElement("div");
  el.className = "card card-tap";
  const p = progress(d);
  const dateBadge = d.deliveryDate
    ? `<span class="badge ${daysFromToday(d.deliveryDate) <= 1 ? "badge-soon" : ""}">${esc(relativeDay(d.deliveryDate))}</span>`
    : `<span class="badge">No date</span>`;
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(d.customerName || "Customer")}</div>
        <div class="row-sub">${esc(d.vehicle || "Vehicle TBD")}</div>
      </div>
      <div class="row-meta">${d.status === "delivered" ? '<span class="badge badge-delivered">Delivered</span>' : dateBadge}</div>
    </div>
    <div class="row" style="margin-top:10px">
      <div class="small muted">${p.done}/${p.total} ready</div>
      <div class="small strong mono">${p.pct}%</div>
    </div>
    <div class="progress"><span style="width:${p.pct}%"></span></div>
  `;
  el.addEventListener("click", () => navigate(`/deliveries/${d.id}`));
  return el;
}

export function openDeliveryForm(existing) {
  const isEdit = !!existing;
  const d = existing || {};
  openModal(isEdit ? "Edit delivery" : "New delivery", (close) => {
    const { element } = buildForm(
      [
        { name: "customerName", label: "Customer name", value: d.customerName, required: true },
        { name: "vehicle", label: "Vehicle", value: d.vehicle, placeholder: "2024 RAV4 XLE — Silver" },
        { name: "deliveryDate", label: "Delivery date", value: d.deliveryDate || "", type: "date" },
      ],
      {
        submitLabel: isEdit ? "Save" : "Create delivery",
        onSubmit: (data) => {
          if (isEdit) { store.update("deliveries", existing.id, data); toast("Updated", "success"); }
          else {
            const settings = store.getSettings();
            store.create("deliveries", {
              ...data, status: "prep", notes: "",
              checklist: settings.deliveryChecklist.map((label) => ({ label, done: false })),
            });
            toast("Delivery created", "success");
          }
          close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    return element;
  });
}

function renderDeliveryDetail(view, id) {
  const d = store.get("deliveries", id);
  if (!d) { view.innerHTML = emptyState("help", "Delivery not found", ""); return; }
  const p = progress(d);

  const el = document.createElement("div");
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-act="back" style="margin-bottom:12px">← Deliveries</button>
    <div class="card">
      <div class="row">
        <div class="row-main">
          <div class="row-title" style="font-size:1.3rem">${esc(d.customerName || "Customer")}</div>
          <div class="row-sub">${esc(d.vehicle || "Vehicle TBD")}</div>
        </div>
        ${d.status === "delivered" ? '<span class="badge badge-delivered">Delivered</span>' : ""}
      </div>
      <div class="row" style="margin-top:6px">
        <div class="small muted">${d.deliveryDate ? icon("calendar") + " " + esc(formatDate(d.deliveryDate)) + " · " + esc(relativeDay(d.deliveryDate)) : "No date set"}</div>
        <div class="small strong mono">${p.done}/${p.total}</div>
      </div>
      <div class="progress"><span style="width:${p.pct}%"></span></div>
    </div>

    <div class="section-title">Prep checklist</div>
    <div class="card">
      <div class="checklist"></div>
      <button class="btn btn-ghost btn-sm btn-block" data-act="add-item" style="margin-top:10px">+ Add checklist item</button>
    </div>

    ${d.notes ? `<div class="section-title">Notes</div><div class="card"><div style="white-space:pre-wrap">${esc(d.notes)}</div></div>` : ""}

    <div class="section-title">Actions</div>
    <div class="card">
      ${d.status !== "delivered" ? `<button class="btn btn-success btn-block" data-act="complete">${icon("check")} Mark delivered</button>` : `<button class="btn btn-ghost btn-block" data-act="reopen">Reopen delivery</button>`}
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-primary btn-block" data-act="edit">${icon("edit")} Edit</button>
        <button class="btn btn-danger btn-block" data-act="delete">Delete</button>
      </div>
    </div>
  `;
  view.appendChild(el);

  const checklistEl = el.querySelector(".checklist");
  function drawChecklist() {
    checklistEl.innerHTML = "";
    (d.checklist || []).forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "check-item" + (item.done ? " done" : "");
      const cbId = `cb_${idx}`;
      row.innerHTML = `
        <input type="checkbox" id="${cbId}" ${item.done ? "checked" : ""} />
        <label for="${cbId}">${esc(item.label)}</label>
        <button class="modal-close" data-del="${idx}" aria-label="Remove" style="font-size:1.2rem">&times;</button>
      `;
      row.querySelector("input").addEventListener("change", (e) => {
        d.checklist[idx].done = e.target.checked;
        store.update("deliveries", d.id, { checklist: d.checklist });
        refresh();
      });
      row.querySelector("[data-del]").addEventListener("click", () => {
        d.checklist.splice(idx, 1);
        store.update("deliveries", d.id, { checklist: d.checklist });
        refresh();
      });
      checklistEl.appendChild(row);
    });
  }
  drawChecklist();

  function refresh() { view.innerHTML = ""; renderDeliveryDetail(view, id); }

  el.querySelector('[data-act="back"]').addEventListener("click", () => navigate("/deliveries"));
  el.querySelector('[data-act="edit"]').addEventListener("click", () => openDeliveryForm(d));
  el.querySelector('[data-act="add-item"]').addEventListener("click", () => {
    openModal("Add item", (close) => {
      const { element } = buildForm(
        [{ name: "label", label: "Checklist item", required: true, placeholder: "e.g. Program garage remote" }],
        { submitLabel: "Add", onSubmit: ({ label }) => {
          d.checklist = d.checklist || [];
          d.checklist.push({ label, done: false });
          store.update("deliveries", d.id, { checklist: d.checklist });
          close(); refresh();
        } });
      return element;
    });
  });

  const completeBtn = el.querySelector('[data-act="complete"]');
  if (completeBtn) completeBtn.addEventListener("click", async () => {
    const remaining = (d.checklist || []).filter((i) => !i.done).length;
    if (remaining > 0 && !(await confirmDialog(`${remaining} item(s) still unchecked. Mark delivered anyway?`, { danger: false, confirmLabel: "Mark delivered" }))) return;
    store.update("deliveries", d.id, { status: "delivered" });
    if (d.leadId) store.update("leads", d.leadId, { stage: "delivered" });
    toast("Congrats on the delivery!", "success");

    // A delivered car is a sold car — count it toward your units immediately.
    // Auto-log the sale (unless this deal is already logged) so the number
    // always moves, even on a phone; commission can be filled in later in Goals.
    const alreadyLogged = store.all("sales").some((s) =>
      s.deliveryId === d.id || (d.leadId && s.leadId === d.leadId));
    if (!alreadyLogged) {
      store.create("sales", {
        customerName: d.customerName, vehicle: d.vehicle, saleDate: todayISO(),
        frontGross: 0, backGross: 0, commission: 0,
        leadId: d.leadId || null, deliveryId: d.id,
      });
      toast("Counted as a sale — add your commission in Goals", "success");
    }
    navigate("/deliveries");
    // Delivery is the best moment to ask for a referral.
    openReferralCapture(d.customerName, d.leadId);
  });
  const reopenBtn = el.querySelector('[data-act="reopen"]');
  if (reopenBtn) reopenBtn.addEventListener("click", () => {
    store.update("deliveries", d.id, { status: "prep" });
    refresh();
  });

  el.querySelector('[data-act="delete"]').addEventListener("click", async () => {
    if (await confirmDialog("Delete this delivery?")) {
      store.remove("deliveries", d.id);
      toast("Deleted");
      navigate("/deliveries");
    }
  });
}
