// Leads / follow-ups — the mini CRM.

import * as store from "../store.js";
import { LEAD_STAGES, stageMeta } from "../store.js";
import { openModal, buildForm, toast, undoToast, confirmDialog, emptyState, swipeable } from "../components.js";
import { navigate } from "../router.js";
import { openTemplatePicker } from "./messages.js";
import { openAppointmentForm } from "./calendar.js";
import { openSaleForm } from "./goals.js";
import { openDealerSearch } from "./dealer.js";
import { maybeStartCadence, startCadence, hasCadence } from "../cadence.js";
import { openReferralCapture } from "./referrals.js";
import { openDealBuilder, openDealDetail, dealsForLead, offerText, equity, dealInputs, estimateTradeDetail } from "./dealbuilder.js";
import { prospectSummary } from "./prospecting.js";
import { icon } from "../icons.js";
import {
  currency, esc, initials, phoneDisplay, telHref, smsHref, mailtoHref,
  relativeDay, daysFromToday, formatDate, todayISO,
} from "../utils.js";
import { emailsForLead, logEmail } from "../email.js";
import { afterSale, closeFollowUps } from "../connections.js";

export function renderLeads(view, { param }) {
  if (param) return renderLeadDetail(view, param);

  let search = "";
  // active | due | all | <stage>. A stat card can preset the filter (one-shot).
  let filter = sessionStorage.getItem("leads-filter") || "active";
  sessionStorage.removeItem("leads-filter");
  // Mass-delete selection mode (e.g. clearing a bad import to start fresh).
  let selecting = false;
  const selected = new Set();

  const wrap = document.createElement("div");
  view.appendChild(wrap);

  function draw() {
    const q = search.toLowerCase();
    let list = store.all("leads"); // read fresh so swipe-deletes/undos stay accurate
    if (filter === "active") list = list.filter((l) => !["delivered", "lost"].includes(l.stage));
    else if (filter === "due") list = list.filter((l) => !["delivered", "lost"].includes(l.stage) && l.followUp && daysFromToday(l.followUp) <= 0);
    else if (filter !== "all") list = list.filter((l) => l.stage === filter);
    if (q) list = list.filter((l) =>
      [l.name, l.phone, l.vehicleInterest, l.source, l.notes].join(" ").toLowerCase().includes(q));

    // Sort: overdue follow-ups first, then by follow-up date, then newest.
    list = list.slice().sort((a, b) => {
      const da = a.followUp ? daysFromToday(a.followUp) : Infinity;
      const db = b.followUp ? daysFromToday(b.followUp) : Infinity;
      if (da !== db) return da - db;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });

    const chips = [
      { id: "active", label: "Active" },
      { id: "due", label: "Due follow-ups" },
      { id: "all", label: "All" },
      ...LEAD_STAGES.map((s) => ({ id: s.id, label: s.label })),
    ];

    const ps = prospectSummary();
    const callSub = ps.hot ? ` · ${ps.hot} new` : ps.total ? ` · ${ps.total}` : "";
    wrap.innerHTML = `
      <div class="searchbar">
        <input type="search" placeholder="Search leads…" value="${esc(search)}" />
      </div>
      <div class="btn-row" style="overflow-x:auto; flex-wrap:nowrap; padding-bottom:4px; margin-bottom:12px;">
        ${chips.map((c) => `<button class="btn btn-sm ${filter === c.id ? "btn-primary" : "btn-ghost"}" data-filter="${c.id}" style="flex:0 0 auto">${esc(c.label)}</button>`).join("")}
      </div>
      ${selecting ? `
      <div class="btn-row" style="margin-bottom:12px">
        <button class="btn btn-ghost btn-sm" data-act="sel-all" style="flex:0 0 auto">Select all shown</button>
        <button class="btn btn-danger btn-sm" data-act="sel-del" style="flex:1">${icon("trash")} Delete (<span id="sel-count">${selected.size}</span>)</button>
        <button class="btn btn-ghost btn-sm" data-act="sel-done" style="flex:0 0 auto">Done</button>
      </div>
      <div class="hint" style="margin-bottom:10px">Tap leads to select. The filter chips and search narrow what "Select all shown" grabs — search "AutoAlert" to target one import batch.</div>` : `
      <div class="btn-row" style="margin-bottom:10px">
        <button class="btn btn-primary btn-block" data-act="add-lead">${icon("plus")} Add customer</button>
        <button class="btn btn-ghost btn-sm" data-act="select" style="flex:0 0 auto">Select</button>
      </div>
      <button class="btn btn-ghost btn-block" data-act="call-list" style="margin-bottom:12px">${icon("target")} Today's call list${callSub}</button>`}
      <div class="lead-list"></div>
    `;

    const listEl = wrap.querySelector(".lead-list");
    if (!list.length) {
      listEl.innerHTML = emptyState("users", "No leads here", search ? "Try a different search." : "Tap + to add your first customer.");
    } else {
      list.forEach((l) => listEl.appendChild(selecting ? selectCard(l) : leadCard(l)));
    }

    wrap.querySelector('input[type="search"]').addEventListener("input", (e) => {
      search = e.target.value;
      renderList(); // re-render only the list for smoother typing
    });

    // Switching filters re-renders only the list and updates the active chip in
    // place — rebuilding the whole view would snap the scrollable filter row
    // (and the page) back to the top.
    wrap.querySelectorAll("[data-filter]").forEach((b) =>
      b.addEventListener("click", () => {
        filter = b.dataset.filter;
        wrap.querySelectorAll("[data-filter]").forEach((x) => {
          const active = x === b;
          x.classList.toggle("btn-primary", active);
          x.classList.toggle("btn-ghost", !active);
        });
        renderList();
      }));

    const on = (sel, fn) => { const n = wrap.querySelector(sel); if (n) n.addEventListener("click", fn); };
    on('[data-act="add-lead"]', () => openLeadForm());
    on('[data-act="call-list"]', () => navigate("/prospecting"));
    on('[data-act="select"]', () => { selecting = true; selected.clear(); draw(); });
    on('[data-act="sel-done"]', () => { selecting = false; selected.clear(); draw(); });
    on('[data-act="sel-all"]', () => {
      applyFilter().forEach((l) => selected.add(l.id));
      renderList(); updateSelCount();
    });
    on('[data-act="sel-del"]', async () => {
      const ids = [...selected];
      if (!ids.length) { toast("Tap some leads first"); return; }
      const ok = await confirmDialog(
        `Delete ${ids.length} lead${ids.length === 1 ? "" : "s"}? Their open follow-up tasks are removed too. This can't be undone (it deletes from the cloud as well).`);
      if (!ok) return;
      ids.forEach((id) => store.remove("leads", id));
      store.all("tasks")
        .filter((t) => t.leadId && selected.has(t.leadId) && !t.done)
        .forEach((t) => store.remove("tasks", t.id));
      selected.clear();
      selecting = false;
      toast(`Deleted ${ids.length} lead${ids.length === 1 ? "" : "s"}`, "success");
      draw();
    });
  }

  function updateSelCount() {
    const n = wrap.querySelector("#sel-count");
    if (n) n.textContent = selected.size;
  }

  // Selection-mode row: whole card toggles; no swipe/navigation in this mode.
  function selectCard(l) {
    const el = document.createElement("div");
    el.className = "card";
    const drawState = () => {
      const isSel = selected.has(l.id);
      el.style.outline = isSel ? "2px solid var(--brand)" : "none";
      el.innerHTML = `
        <div class="row" style="align-items:center;gap:12px">
          <span style="flex:none;display:inline-flex;width:24px;height:24px;border-radius:50%;border:2px solid ${isSel ? "var(--brand)" : "var(--border)"};background:${isSel ? "var(--brand)" : "transparent"};color:#fff;align-items:center;justify-content:center">${isSel ? "✓" : ""}</span>
          <div class="row-main" style="min-width:0">
            <div class="row-title">${esc(l.name || "Customer")}</div>
            <div class="row-sub">${esc([l.vehicleInterest, l.source].filter(Boolean).join(" · ") || stageMeta(l.stage).label)}</div>
          </div>
        </div>`;
    };
    drawState();
    el.addEventListener("click", () => {
      if (selected.has(l.id)) selected.delete(l.id); else selected.add(l.id);
      drawState(); updateSelCount();
    });
    return el;
  }

  function renderList() {
    const el = wrap.querySelector(".lead-list");
    if (!el) return;
    const filtered = applyFilter();
    el.innerHTML = "";
    if (!filtered.length) el.innerHTML = emptyState("users", "No leads here", search ? "Try a different search." : "Nothing in this filter yet.");
    else filtered.forEach((x) => el.appendChild(selecting ? selectCard(x) : leadCard(x)));
  }

  function applyFilter() {
    const q = search.toLowerCase();
    let list = store.all("leads"); // read fresh so swipe-deletes/undos stay accurate
    if (filter === "active") list = list.filter((l) => !["delivered", "lost"].includes(l.stage));
    else if (filter === "due") list = list.filter((l) => !["delivered", "lost"].includes(l.stage) && l.followUp && daysFromToday(l.followUp) <= 0);
    else if (filter !== "all") list = list.filter((l) => l.stage === filter);
    if (q) list = list.filter((l) =>
      [l.name, l.phone, l.vehicleInterest, l.source, l.notes].join(" ").toLowerCase().includes(q));
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
  return swipeable(el, {
    onDelete: (restoreRow) => {
      const snapshot = { ...l };
      store.remove("leads", l.id);
      undoToast(`Deleted ${l.name}`, () => { store.restore("leads", snapshot); restoreRow(); });
    },
  });
}

// --- Add / edit form ---
// opts.focus: field name to focus once open (tap-to-edit from the detail page).
// The 60-second money form: everything the deal engine runs on, in one sheet.
// Fill it from a call ("what are you paying? what's the buyout?") and the
// pre-made deal recomputes on the spot.
export function openMoneyForm(l) {
  openModal("Their numbers", (close) => {
    const numOrNull = (v) => (v === "" || v == null ? null : Number(v));
    const estD = l.currentValue == null ? estimateTradeDetail(l) : null;
    const { element } = buildForm(
      [
        { name: "currentPayment", label: "Current payment $/mo", value: l.currentPayment, type: "number", inputmode: "decimal", half: true, placeholder: "532" },
        { name: "payoff", label: "Payoff / buyout $", value: l.payoff, type: "number", inputmode: "decimal", half: true, placeholder: "19455", hint: "Blank = current payment × payments left to maturity." },
        { name: "currentValue", label: "Trade value $ (appraised)", value: l.currentValue, type: "number", inputmode: "decimal", half: true, placeholder: "21500", hint: estD ? `Blank = estimate ≈ ${currency(estD.value)} (${estD.lines.join(" · ")})` : "Leave blank to use a book estimate." },
        { name: "currentApr", label: "Their rate %", value: l.currentApr, type: "number", inputmode: "decimal", half: true, placeholder: "8.9", hint: "Blank = solved from payment, payoff & maturity when possible." },
        { name: "leaseEnd", label: "Contract maturity date", value: l.leaseEnd || "", type: "date", half: true },
        { name: "currentTerm", label: "Original term (mo)", value: l.currentTerm, type: "number", inputmode: "numeric", half: true, placeholder: "72" },
        { name: "odometer", label: "Odometer (km)", value: l.odometer, type: "number", inputmode: "numeric", half: true, placeholder: "48000", hint: "Feeds the km adjustment on the estimate." },
        { name: "tradeCondition", label: "Trade condition", value: l.tradeCondition || "", type: "select", half: true, options: [
          { value: "", label: "Not graded" },
          { value: "clean", label: "Clean (+5%)" },
          { value: "average", label: "Average" },
          { value: "rough", label: "Rough (−15%)" },
        ] },
      ],
      {
        submitLabel: "Save & rebuild deal",
        onSubmit: (data) => {
          store.update("leads", l.id, {
            currentPayment: numOrNull(data.currentPayment),
            payoff: numOrNull(data.payoff),
            currentValue: numOrNull(data.currentValue),
            currentApr: numOrNull(data.currentApr),
            leaseEnd: data.leaseEnd || null,
            currentTerm: numOrNull(data.currentTerm),
            odometer: numOrNull(data.odometer),
            tradeCondition: data.tradeCondition || null,
          });
          toast("Deal inputs updated", "success");
          close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    return element;
  });
}

export function openLeadForm(existing, opts = {}) {
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
        { name: "dob", label: "Birthday (optional)", value: l.dob || "", type: "date", half: true },
        { name: "leaseEnd", label: "Lease end (optional)", value: l.leaseEnd || "", type: "date", half: true },
        { name: "notes", label: "Notes", value: l.notes, type: "textarea", placeholder: "Trade-in, budget, timeline, hot buttons…" },
      ],
      {
        submitLabel: isEdit ? "Save changes" : "Add lead",
        onSubmit: (data) => {
          if (isEdit) {
            store.update("leads", existing.id, data);
            toast("Lead updated", "success");
          } else {
            const lead = store.create("leads", data);
            const n = maybeStartCadence(lead.id);
            toast(n ? `Lead added — ${n}-step follow-up plan started` : "Lead added", "success");
          }
          close();
          // Refresh current view.
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    // Land on the field the user tapped (after the sheet's slide-up).
    if (opts.focus) setTimeout(() => element.querySelector(`[name="${opts.focus}"]`)?.focus(), 150);
    return element;
  });
}

// --- Detail page ---
function renderLeadDetail(view, id) {
  const l = store.get("leads", id);
  if (!l) {
    view.innerHTML = emptyState("help", "Lead not found", "It may have been deleted.");
    return;
  }
  const st = stageMeta(l.stage);
  const linkedVehicle = l.vehicleId ? store.get("vehicles", l.vehicleId) : null;

  const el = document.createElement("div");
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-act="back" style="margin-bottom:12px">← Leads</button>

    <div class="card">
      <div class="row">
        <div class="row-main" data-edit="name" style="cursor:pointer">
          <div class="row-title" style="font-size:1.35rem">${esc(l.name)}</div>
          <div class="row-sub">${l.vehicleInterest ? esc(l.vehicleInterest) : "No vehicle noted — tap to add"}</div>
        </div>
        <span class="badge ${st.badge}">${esc(st.label)}</span>
      </div>

      ${(l.phone || l.email) ? `
      <div class="btn-row" style="margin-top:14px">
        ${l.phone ? `<a class="btn btn-success btn-sm" data-act="call" style="flex:1" href="${telHref(l.phone)}">${icon("phone")} Call</a>
        <a class="btn btn-primary btn-sm" data-act="text" style="flex:1" href="${smsHref(l.phone)}">${icon("message")} Text</a>` : ""}
        ${l.email ? `<a class="btn btn-primary btn-sm" data-act="email" style="flex:1" href="${mailtoHref(l.email)}">${icon("mail")} Email</a>` : ""}
      </div>` : ""}
      ${l.phone || l.email ? `<button class="btn btn-ghost btn-sm btn-block" data-act="templates" style="margin-top:8px">${icon("file")} Use a message template</button>` : ""}
    </div>

    <div class="section-title">Quick stage update</div>
    <div class="card">
      <div class="btn-row">
        ${LEAD_STAGES.map((s) => `<button class="btn btn-sm ${s.id === l.stage ? "btn-primary" : "btn-ghost"}" data-stage="${s.id}">${esc(s.label)}</button>`).join("")}
      </div>
    </div>

    <div class="section-title">Details <span class="muted" style="font-weight:500;font-size:0.78rem">· tap a row to edit</span></div>
    <div class="card">
      <div class="kv" data-edit="phone" style="cursor:pointer"><span class="k">Phone</span><span class="v">${l.phone ? esc(phoneDisplay(l.phone)) : "Tap to add"}</span></div>
      <div class="kv" data-edit="email" style="cursor:pointer"><span class="k">Email</span><span class="v">${l.email ? esc(l.email) : "Tap to add"}</span></div>
      <div class="kv" data-edit="source" style="cursor:pointer"><span class="k">Source</span><span class="v">${esc(l.source || "—")}</span></div>
      <div class="kv" data-edit="followUp" style="cursor:pointer"><span class="k">Follow-up</span><span class="v">${l.followUp ? esc(relativeDay(l.followUp)) + " (" + esc(formatDate(l.followUp)) + ")" : "Tap to set"}</span></div>
      ${linkedVehicle ? `<div class="kv"><span class="k">Matched vehicle</span><span class="v">${esc(vehicleName(linkedVehicle))}</span></div>` : ""}
      ${l.currentPayment != null ? `<div class="kv"><span class="k">Current payment</span><span class="v mono">${currency(l.currentPayment)}/mo</span></div>` : ""}
      ${l.currentValue != null ? `<div class="kv"><span class="k">Est. equity</span><span class="v mono" style="color:${(l.currentValue-(l.payoff||0))>=0?"var(--success)":"var(--danger)"}">${currency(l.currentValue-(l.payoff||0))}</span></div>`
        : l.payoff != null ? `<div class="kv"><span class="k">Payoff</span><span class="v mono">${currency(l.payoff)} <span class="muted small">· trade value not appraised</span></span></div>` : ""}
      <div class="kv"><span class="k">Added</span><span class="v">${esc(formatDate(l.createdAt))}</span></div>
    </div>

    <div id="deal-slot"></div>

    ${l.notes ? `<div class="section-title">Notes</div><div class="card" data-edit="notes" style="cursor:pointer"><div style="white-space:pre-wrap">${esc(l.notes)}</div></div>` : ""}

    <div class="section-title">Email history</div>
    <div class="card">
      <div class="email-log"></div>
      <button class="btn btn-ghost btn-sm btn-block" data-act="log-email">${icon("mail")} Log an email</button>
    </div>

    <div class="section-title">Actions</div>
    <div class="card">
      <button class="btn btn-primary btn-block" data-act="find-car" style="margin-bottom:10px">${icon("search")} Find a car on O'Regan's</button>
      <button class="btn btn-ghost btn-block" data-act="cadence" style="margin-bottom:10px">${icon("bell")} ${hasCadence(l.id) ? "Follow-up plan is active" : "Start follow-up plan"}</button>
      <button class="btn btn-ghost btn-block" data-act="referral" style="margin-bottom:14px">${icon("users")} Ask for a referral</button>
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
        <button class="btn btn-ghost btn-block" data-act="appointment">${icon("calendar")} Schedule</button>
        <button class="btn btn-ghost btn-block" data-act="logsale">${icon("dollar")} Log sale</button>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-primary btn-block" data-act="edit">${icon("edit")} Edit</button>
        <button class="btn btn-success btn-block" data-act="deliver">${icon("check")} Start delivery</button>
      </div>
      <button class="btn btn-danger btn-block" data-act="delete" style="margin-top:10px">Delete lead</button>
    </div>
  `;
  view.appendChild(el);

  el.querySelector('[data-act="back"]').addEventListener("click", () => navigate("/leads"));
  el.querySelector('[data-act="edit"]').addEventListener("click", () => openLeadForm(l));
  // Tap-to-edit: any detail row opens the form focused on that field.
  el.querySelectorAll("[data-edit]").forEach((n) =>
    n.addEventListener("click", () => openLeadForm(l, { focus: n.dataset.edit })));

  const tmplBtn = el.querySelector('[data-act="templates"]');
  if (tmplBtn) tmplBtn.addEventListener("click", () => openTemplatePicker(l));

  // Log outreach as a "touch" and stamp last-contacted when calling/texting.
  const logTouch = () => {
    store.logActivity("touch");
    store.update("leads", l.id, { lastContacted: new Date().toISOString() });
  };
  const callBtn = el.querySelector('[data-act="call"]');
  if (callBtn) callBtn.addEventListener("click", logTouch);
  const textBtn = el.querySelector('[data-act="text"]');
  if (textBtn) textBtn.addEventListener("click", logTouch);
  const emailBtn = el.querySelector('[data-act="email"]');
  if (emailBtn) emailBtn.addEventListener("click", () => {
    logTouch();
    logEmail(l.id, { direction: "out", subject: "", body: "", via: "mail-app" });
  });

  // --- Email history: sent emails (templates / automated) + hand-logged replies.
  const drawEmailLog = () => {
    const box = el.querySelector(".email-log");
    const items = emailsForLead(l.id);
    if (!items.length) { box.innerHTML = `<div class="muted small" style="margin-bottom:10px">Nothing logged yet. Emails sent from entoa land here automatically.</div>`; return; }
    box.innerHTML = items.slice(0, 12).map((e) => `
      <div class="kv" style="align-items:flex-start">
        <span class="k" style="flex:none">${e.direction === "in" ? "↓ In" : "↑ Out"}</span>
        <span class="v" style="text-align:left;flex:1;font-weight:550">
          ${esc(e.subject || "(no subject)")}
          <div class="small muted" style="font-weight:450">${esc(formatDate(e.receivedAt || e.createdAt))}${e.via === "auto" ? " · sent automatically" : e.via === "outlook" ? " · from Outlook" : ""}</div>
        </span>
      </div>`).join("");
  };
  drawEmailLog();

  el.querySelector('[data-act="log-email"]').addEventListener("click", () => {
    openModal("Log an email", (close) => {
      const { element } = buildForm(
        [
          { name: "direction", label: "Direction", value: "in", type: "select",
            options: [{ value: "in", label: "Received from customer" }, { value: "out", label: "Sent to customer" }] },
          { name: "subject", label: "Subject", value: "", placeholder: "Re: the Rogue" },
          { name: "body", label: "Email text (optional)", value: "", type: "textarea", placeholder: "Paste the email here…" },
        ],
        {
          submitLabel: "Log it",
          onSubmit: (data) => {
            logEmail(l.id, { direction: data.direction, subject: data.subject, body: data.body, via: "manual" });
            if (data.direction === "out") logTouch();
            toast("Email logged", "success");
            close();
            drawEmailLog();
          },
        }
      );
      return element;
    });
  });

  el.querySelector('[data-act="cadence"]').addEventListener("click", () => {
    if (hasCadence(l.id)) { toast("Follow-up plan already running", ""); return; }
    const n = startCadence(l.id);
    toast(`${n}-step follow-up plan started`, "success");
    renderRefresh(view, id);
  });

  el.querySelector('[data-act="referral"]').addEventListener("click", () => openReferralCapture(l.name, l.id));

  // The deal is pre-made: best payment-matched option front and center, two
  // alternates under it, the offer text one tap away. No button hunting.
  (function buildDealSection() {
    const slot = el.querySelector("#deal-slot");
    if (l.stage === "lost") return;
    const hasMoney = l.currentPayment != null || l.currentValue != null || l.payoff != null;
    // No payment on file? Still pre-make the deal — lowest payments first,
    // labeled as such. Every customer of a Nissan store has a next car.
    const rows = dealsForLead(l).slice(0, 3);
    if (!rows.length) return;
    const best = rows[0];
    const band = store.getSettings().dealMatchBand || 50;
    const deltaLine = (m) => m.delta == null ? "" :
      Math.abs(m.delta) <= band ? "≈ same payment" :
      m.delta < 0 ? `${currency(Math.round(-m.delta))}/mo less` : `+${currency(Math.round(m.delta))}/mo`;
    const vname = (v) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
    const deltaColor = (m) => m.delta != null && m.delta <= band ? "var(--success)" : "var(--muted)";

    slot.innerHTML = `
      <div class="section-title">The deal</div>
      <div class="card">
        <div class="row" data-deal-open="0" style="cursor:pointer">
          <div class="row-main">
            <div class="row-title">${esc(vname(best.vehicle))}</div>
            <div class="row-sub">
              <span class="badge ${best.method === "lease" ? "badge-appt" : "badge-working"}">${best.method === "lease" ? "Lease" : "Finance"}</span>
              ${best.vehicle.price != null ? " " + currency(best.vehicle.price) : ""}${best.vehicle.lineup ? " · new — order/allocate" : best.vehicle.stock ? " · #" + esc(best.vehicle.stock) : ""}
              ${best.special ? `<div style="margin-top:3px"><span class="badge badge-sold">🏷 ${esc(best.special)}</span></div>` : ""}
              <div class="small muted" style="margin-top:3px">Tap for the full breakdown ›</div>
            </div>
          </div>
          <div class="row-meta">
            <div class="strong mono" style="font-size:1.2rem">${currency(Math.round(best.monthly))}<span class="muted" style="font-size:0.75rem">/mo</span></div>
            <div class="small strong" style="color:${deltaColor(best)}">${deltaLine(best)}</div>
          </div>
        </div>
        <div class="btn-row" style="margin-top:12px">
          ${l.phone ? `<a class="btn btn-primary btn-sm" data-act="deal-offer" style="flex:1.4" href="${smsHref(l.phone, offerText(l, best))}">${icon("message")} Text this offer</a>` : `<button class="btn btn-ghost btn-sm" data-edit="phone" style="flex:1.4">Add phone to text it</button>`}
          <button class="btn btn-ghost btn-sm" data-act="deal-more" style="flex:1">All options</button>
        </div>
        ${rows.length > 1 ? `
        <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
          ${rows.slice(1).map((m, i) => `
            <div class="row" data-deal-open="${i + 1}" style="padding:5px 0;cursor:pointer">
              <div class="small" style="flex:1">${esc(vname(m.vehicle))} <span class="muted">· ${m.method === "lease" ? "lease" : "finance"}${m.special ? " · 🏷" : ""} ›</span></div>
              <div class="small mono strong">${currency(Math.round(m.monthly))}/mo</div>
              <div class="small mono" style="width:92px;text-align:right;color:${deltaColor(m)}">${deltaLine(m)}</div>
            </div>`).join("")}
        </div>` : ""}
        ${(() => {
          // What this deal stands on — every input with its provenance, and a
          // one-tap way to replace an estimate with the real number.
          const inp = dealInputs(l);
          const chip = (label, x, fmt) => {
            const cls = x.src === "known" ? "di-known" : (x.src === "missing" || x.src === "default") ? "di-miss" : "di-est";
            const mark = x.src === "known" ? "✓" : x.src === "missing" ? "+" : "≈";
            const tag = x.src === "book" ? " est" : x.src === "calc" ? " calc" : x.src === "wash" ? " assumed" : x.src === "default" ? " assumed" : "";
            return `<span class="di-chip ${cls}">${mark} ${label} ${x.v != null ? fmt(x.v) : "add"}${tag}</span>`;
          };
          const strip = [
            chip("pmt", inp.payment, (v) => currency(Math.round(v))),
            chip("payoff", inp.payoff, (v) => currency(Math.round(v))),
            chip("trade", inp.value, (v) => currency(Math.round(v))),
            chip("rate", inp.apr, (v) => v + "%"),
            inp.maturity.v != null ? chip("mat.", inp.maturity, (v) => v + " mo") : "",
          ].join("");
          const note = inp.payment.src === "missing"
            ? "No payment on file — these are the lowest payments. Add it and this becomes a payment-matched deal."
            : inp.value.src === "wash" ? `Assumes their trade washes the ${currency(l.payoff)} payoff — appraise or add a value to tighten this.`
            : inp.value.src === "book" ? "Trade value is a book estimate from year/model — appraise to firm it up."
            : "";
          return `
            <div class="di-strip" data-act="deal-numbers" title="Update their numbers">${strip}<span class="di-chip di-edit">edit</span></div>
            ${note ? `<div class="fab-note" style="margin-top:6px;text-align:left">${note}</div>` : ""}`;
        })()}
      </div>`;

    const offer = slot.querySelector('[data-act="deal-offer"]');
    if (offer) offer.addEventListener("click", (ev) => {
      ev.stopPropagation();
      store.logActivity("touch");
      store.update("leads", l.id, { lastContacted: new Date().toISOString() });
    });
    slot.querySelectorAll("[data-deal-open]").forEach((n) =>
      n.addEventListener("click", () => openDealDetail(l, rows[Number(n.dataset.dealOpen)])));
    slot.querySelector('[data-act="deal-more"]').addEventListener("click", () => openDealBuilder(l));
    const nums = slot.querySelector('[data-act="deal-numbers"]');
    if (nums) nums.addEventListener("click", (ev) => { ev.stopPropagation(); openMoneyForm(l); });
    const addPhone = slot.querySelector('[data-edit="phone"]');
    if (addPhone) addPhone.addEventListener("click", () => openLeadForm(l, { focus: "phone" }));
  })();

  el.querySelector('[data-act="find-car"]').addEventListener("click", () =>
    openDealerSearch({ vehicleInterest: l.vehicleInterest, name: l.name }));

  el.querySelector('[data-act="appointment"]').addEventListener("click", () =>
    openAppointmentForm(null, { leadId: l.id, customerName: l.name, vehicle: l.vehicleInterest, type: "appointment" }));

  el.querySelector('[data-act="logsale"]').addEventListener("click", () =>
    openSaleForm(null, { leadId: l.id, customerName: l.name, vehicle: l.vehicleInterest }));

  el.querySelectorAll("[data-stage]").forEach((b) =>
    b.addEventListener("click", () => {
      const stage = b.dataset.stage;
      store.update("leads", l.id, { stage });
      toast(`Moved to ${stageMeta(stage).label}`, "success");
      // Stage changes ripple through the rest of the app.
      if (stage === "sold") {
        const hasSale = store.all("sales").some((s) => s.leadId === l.id);
        if (!hasSale) {
          // Sold means a sale — open the form prefilled so units/commission count.
          openSaleForm(null, { customerName: l.name, vehicle: l.vehicleInterest, leadId: l.id }, () => renderRefresh(view, id));
          return;
        }
        afterSale(l.id, { vehicle: l.vehicleInterest || "" });
      } else if (stage === "lost") {
        closeFollowUps(l.id);
      }
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
