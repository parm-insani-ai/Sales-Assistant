// Leads / follow-ups — the mini CRM.

import * as store from "../store.js";
import { LEAD_STAGES, stageMeta } from "../store.js";
import { openModal, buildForm, toast, confirmDialog, emptyState } from "../components.js";
import { navigate } from "../router.js";
import { openTemplatePicker } from "./messages.js";
import { openAppointmentForm } from "./calendar.js";
import { openSaleForm } from "./goals.js";
import {
  currency, esc, initials, phoneDisplay, telHref, smsHref,
  relativeDay, daysFromToday, formatDate, todayISO,
} from "../utils.js";

export function renderLeads(view, { param }) {
  if (param) return renderLeadDetail(view, param);

  const leads = store.all("leads");
  let search = "";
  let filter = "active"; // active | all | <stage>

  const wrap = document.createElement("div");
  view.appendChild(wrap);

  function draw() {
    const q = search.toLowerCase();
    let list = leads;
    if (filter === "active") list = list.filter((l) => !["delivered", "lost"].includes(l.stage));
    else if (filter !== "all") list = list.filter((l) => l.stage === filter);
    if (q) list = list.filter((l) =>
      [l.name, l.phone, l.vehicleInterest, l.notes].join(" ").toLowerCase().includes(q));

    // Sort: overdue follow-ups first, then by follow-up date, then newest.
    list = list.slice().sort((a, b) => {
      const da = a.followUp ? daysFromToday(a.followUp) : Infinity;
      const db = b.followUp ? daysFromToday(b.followUp) : Infinity;
      if (da !== db) return da - db;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });

    const chips = [
      { id: "active", label: "Active" },
      { id: "all", label: "All" },
      ...LEAD_STAGES.map((s) => ({ id: s.id, label: s.label })),
    ];

    wrap.innerHTML = `
      <div class="searchbar">
        <input type="search" placeholder="Search leads…" value="${esc(search)}" />
      </div>
      <div class="btn-row" style="overflow-x:auto; flex-wrap:nowrap; padding-bottom:4px; margin-bottom:6px;">
        ${chips.map((c) => `<button class="btn btn-sm ${filter === c.id ? "btn-primary" : "btn-ghost"}" data-filter="${c.id}" style="flex:0 0 auto">${esc(c.label)}</button>`).join("")}
      </div>
      <div class="lead-list"></div>
    `;

    const listEl = wrap.querySelector(".lead-list");
    if (!list.length) {
      listEl.innerHTML = emptyState("👥", "No leads here", search ? "Try a different search." : "Tap + to add your first customer.");
    } else {
      list.forEach((l) => listEl.appendChild(leadCard(l)));
    }

    wrap.querySelector('input[type="search"]').addEventListener("input", (e) => {
      search = e.target.value;
      // Re-render only the list for smoother typing.
      const el = wrap.querySelector(".lead-list");
      const filtered = applyFilter();
      el.innerHTML = "";
      if (!filtered.length) el.innerHTML = emptyState("🔎", "No matches", "");
      else filtered.forEach((x) => el.appendChild(leadCard(x)));
    });

    wrap.querySelectorAll("[data-filter]").forEach((b) =>
      b.addEventListener("click", () => { filter = b.dataset.filter; draw(); }));
  }

  function applyFilter() {
    const q = search.toLowerCase();
    let list = leads;
    if (filter === "active") list = list.filter((l) => !["delivered", "lost"].includes(l.stage));
    else if (filter !== "all") list = list.filter((l) => l.stage === filter);
    if (q) list = list.filter((l) =>
      [l.name, l.phone, l.vehicleInterest, l.notes].join(" ").toLowerCase().includes(q));
    return list.slice().sort((a, b) => {
      const da = a.followUp ? daysFromToday(a.followUp) : Infinity;
      const db = b.followUp ? daysFromToday(b.followUp) : Infinity;
      if (da !== db) return da - db;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
  }

  draw();
}

function leadCard(l) {
  const el = document.createElement("div");
  el.className = "card card-tap";
  const st = stageMeta(l.stage);
  const fuDays = l.followUp ? daysFromToday(l.followUp) : null;
  let fuBadge = "";
  if (l.followUp && !["delivered", "lost"].includes(l.stage)) {
    const cls = fuDays < 0 ? "badge-due" : fuDays === 0 ? "badge-due" : fuDays <= 2 ? "badge-soon" : "";
    fuBadge = `<span class="badge ${cls}" style="margin-left:6px">${esc(relativeDay(l.followUp))}</span>`;
  }
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(l.name)}</div>
        <div class="row-sub">${l.vehicleInterest ? esc(l.vehicleInterest) : "No vehicle noted"}${l.phone ? " · " + esc(phoneDisplay(l.phone)) : ""}</div>
      </div>
      <div class="row-meta">
        <span class="badge ${st.badge}">${esc(st.label)}</span>
      </div>
    </div>
    ${fuBadge ? `<div style="margin-top:8px">${fuBadge}</div>` : ""}
  `;
  el.addEventListener("click", () => navigate(`/leads/${l.id}`));
  return el;
}

// --- Add / edit form ---
export function openLeadForm(existing) {
  const isEdit = !!existing;
  const l = existing || {};
  openModal(isEdit ? "Edit lead" : "New lead", (close) => {
    const { element } = buildForm(
      [
        { name: "name", label: "Customer name", value: l.name, required: true, placeholder: "Jane Doe" },
        { name: "phone", label: "Phone", value: l.phone, type: "tel", inputmode: "tel", half: true, placeholder: "(555) 123-4567" },
        { name: "email", label: "Email", value: l.email, type: "email", half: true, placeholder: "jane@email.com" },
        { name: "vehicleInterest", label: "Vehicle of interest", value: l.vehicleInterest, placeholder: "2024 RAV4 XLE" },
        { name: "source", label: "Lead source", value: l.source || "Walk-in", type: "select",
          options: ["Walk-in", "Internet", "Phone-in", "Referral", "Repeat", "Service", "Other"] },
        { name: "stage", label: "Stage", value: l.stage || "new", type: "select",
          options: LEAD_STAGES.map((s) => ({ value: s.id, label: s.label })), half: true },
        { name: "followUp", label: "Next follow-up", value: l.followUp || "", type: "date", half: true },
        { name: "notes", label: "Notes", value: l.notes, type: "textarea", placeholder: "Trade-in, budget, timeline, hot buttons…" },
      ],
      {
        submitLabel: isEdit ? "Save changes" : "Add lead",
        onSubmit: (data) => {
          if (isEdit) {
            store.update("leads", existing.id, data);
            toast("Lead updated", "success");
          } else {
            store.create("leads", data);
            toast("Lead added", "success");
          }
          close();
          // Refresh current view.
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    return element;
  });
}

// --- Detail page ---
function renderLeadDetail(view, id) {
  const l = store.get("leads", id);
  if (!l) {
    view.innerHTML = emptyState("🤷", "Lead not found", "It may have been deleted.");
    return;
  }
  const st = stageMeta(l.stage);
  const linkedVehicle = l.vehicleId ? store.get("vehicles", l.vehicleId) : null;

  const el = document.createElement("div");
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-act="back" style="margin-bottom:12px">← Leads</button>

    <div class="card">
      <div class="row">
        <div class="row-main">
          <div class="row-title" style="font-size:1.35rem">${esc(l.name)}</div>
          <div class="row-sub">${l.vehicleInterest ? esc(l.vehicleInterest) : "No vehicle noted"}</div>
        </div>
        <span class="badge ${st.badge}">${esc(st.label)}</span>
      </div>

      ${l.phone ? `
      <div class="btn-row" style="margin-top:14px">
        <a class="btn btn-success btn-sm" style="flex:1" href="${telHref(l.phone)}">📞 Call</a>
        <a class="btn btn-primary btn-sm" style="flex:1" href="${smsHref(l.phone)}">💬 Text</a>
      </div>` : ""}
      ${l.phone || l.email ? `<button class="btn btn-ghost btn-sm btn-block" data-act="templates" style="margin-top:8px">📄 Use a message template</button>` : ""}
    </div>

    <div class="section-title">Quick stage update</div>
    <div class="card">
      <div class="btn-row">
        ${LEAD_STAGES.map((s) => `<button class="btn btn-sm ${s.id === l.stage ? "btn-primary" : "btn-ghost"}" data-stage="${s.id}">${esc(s.label)}</button>`).join("")}
      </div>
    </div>

    <div class="section-title">Details</div>
    <div class="card">
      <div class="kv"><span class="k">Phone</span><span class="v">${l.phone ? esc(phoneDisplay(l.phone)) : "—"}</span></div>
      <div class="kv"><span class="k">Email</span><span class="v">${l.email ? esc(l.email) : "—"}</span></div>
      <div class="kv"><span class="k">Source</span><span class="v">${esc(l.source || "—")}</span></div>
      <div class="kv"><span class="k">Follow-up</span><span class="v">${l.followUp ? esc(relativeDay(l.followUp)) + " (" + esc(formatDate(l.followUp)) + ")" : "—"}</span></div>
      ${linkedVehicle ? `<div class="kv"><span class="k">Matched vehicle</span><span class="v">${esc(vehicleName(linkedVehicle))}</span></div>` : ""}
      <div class="kv"><span class="k">Added</span><span class="v">${esc(formatDate(l.createdAt))}</span></div>
    </div>

    ${l.notes ? `<div class="section-title">Notes</div><div class="card"><div style="white-space:pre-wrap">${esc(l.notes)}</div></div>` : ""}

    <div class="section-title">Actions</div>
    <div class="card">
      <div class="field">
        <label>Set / change follow-up</label>
        <input type="date" data-act="followup" value="${esc(l.followUp || "")}" />
      </div>
      <div class="btn-row" style="margin-top:4px">
        <button class="btn btn-ghost btn-sm" data-act="followup-tomorrow">Follow up tomorrow</button>
        <button class="btn btn-ghost btn-sm" data-act="followup-3">In 3 days</button>
        <button class="btn btn-ghost btn-sm" data-act="followup-week">In a week</button>
      </div>
      <hr class="divider" />
      <div class="btn-row">
        <button class="btn btn-ghost btn-block" data-act="appointment">📅 Schedule</button>
        <button class="btn btn-ghost btn-block" data-act="logsale">💵 Log sale</button>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-primary btn-block" data-act="edit">✏️ Edit</button>
        <button class="btn btn-success btn-block" data-act="deliver">✅ Start delivery</button>
      </div>
      <button class="btn btn-danger btn-block" data-act="delete" style="margin-top:10px">Delete lead</button>
    </div>
  `;
  view.appendChild(el);

  el.querySelector('[data-act="back"]').addEventListener("click", () => navigate("/leads"));
  el.querySelector('[data-act="edit"]').addEventListener("click", () => openLeadForm(l));

  const tmplBtn = el.querySelector('[data-act="templates"]');
  if (tmplBtn) tmplBtn.addEventListener("click", () => openTemplatePicker(l));

  el.querySelector('[data-act="appointment"]').addEventListener("click", () =>
    openAppointmentForm(null, { leadId: l.id, customerName: l.name, vehicle: l.vehicleInterest, type: "appointment" }));

  el.querySelector('[data-act="logsale"]').addEventListener("click", () =>
    openSaleForm(null, { leadId: l.id, customerName: l.name, vehicle: l.vehicleInterest }));

  el.querySelectorAll("[data-stage]").forEach((b) =>
    b.addEventListener("click", () => {
      store.update("leads", l.id, { stage: b.dataset.stage });
      toast(`Moved to ${stageMeta(b.dataset.stage).label}`, "success");
      renderRefresh(view, id);
    }));

  const fuInput = el.querySelector('[data-act="followup"]');
  fuInput.addEventListener("change", () => {
    store.update("leads", l.id, { followUp: fuInput.value || null });
    toast("Follow-up set", "success");
    renderRefresh(view, id);
  });
  const setFu = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    store.update("leads", l.id, { followUp: d.toISOString().slice(0, 10) });
    toast("Follow-up set", "success");
    renderRefresh(view, id);
  };
  el.querySelector('[data-act="followup-tomorrow"]').addEventListener("click", () => setFu(1));
  el.querySelector('[data-act="followup-3"]').addEventListener("click", () => setFu(3));
  el.querySelector('[data-act="followup-week"]').addEventListener("click", () => setFu(7));

  el.querySelector('[data-act="deliver"]').addEventListener("click", () => {
    // Create a delivery from this lead and jump to it.
    const settings = store.getSettings();
    const checklist = settings.deliveryChecklist.map((label) => ({ label, done: false }));
    const d = store.create("deliveries", {
      leadId: l.id,
      customerName: l.name,
      vehicle: l.vehicleInterest || (linkedVehicle ? vehicleName(linkedVehicle) : ""),
      deliveryDate: "",
      status: "prep",
      checklist,
      notes: "",
    });
    store.update("leads", l.id, { stage: l.stage === "delivered" ? l.stage : "sold" });
    toast("Delivery started", "success");
    navigate(`/deliveries/${d.id}`);
  });

  el.querySelector('[data-act="delete"]').addEventListener("click", async () => {
    if (await confirmDialog(`Delete ${l.name}? This can't be undone.`)) {
      store.remove("leads", l.id);
      toast("Lead deleted");
      navigate("/leads");
    }
  });
}

function renderRefresh(view, id) {
  view.innerHTML = "";
  renderLeadDetail(view, id);
}

function vehicleName(v) {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
}
