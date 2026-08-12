// Appointment scheduling — an agenda of upcoming appointments, test drives,
// deliveries and calls.

import * as store from "../store.js";
import { APPT_TYPES, apptType } from "../store.js";
import { openModal, buildForm, toast, confirmDialog, emptyState } from "../components.js";
import { navigate } from "../router.js";
import { esc, relativeDay, daysFromToday } from "../utils.js";
import { icon } from "../icons.js";

function timeLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function dayKey(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}
function dayHeading(key) {
  const rel = relativeDay(key);
  const d = new Date(key + "T00:00");
  const wd = d.toLocaleDateString("en-US", { weekday: "long" });
  return `${rel} · ${wd}`;
}

// --- Calendar export (.ics) ---
// Produces a standard iCalendar file for one appointment. Opening it adds the
// event to whatever calendar the phone uses — Outlook, Apple Calendar, Google.
// Works offline with no accounts; this is a one-way "add to calendar", not a
// live two-way sync (that needs a backend + Microsoft/Google sign-in).
function icsStamp(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
// Local wall-clock time with no zone, so the event lands at the time you set.
function icsLocal(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}
function icsEscape(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function buildICS(a) {
  const start = icsLocal(a.when);
  if (!start) return null;
  const end = new Date(new Date(a.when).getTime() + 60 * 60 * 1000); // default 1h
  const t = apptType(a.type);
  const summary = `${a.title || t.label}${a.customerName ? " — " + a.customerName : ""}`;
  const descBits = [a.vehicle ? `Vehicle: ${a.vehicle}` : "", a.notes || ""].filter(Boolean);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//entoa//Sales Assistant//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${a.id}@entoa.ai`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${start}`,
    `DTEND:${icsLocal(end.toISOString())}`,
    `SUMMARY:${icsEscape(summary)}`,
    descBits.length ? `DESCRIPTION:${icsEscape(descBits.join("\n"))}` : "",
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(summary)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}
function addToCalendar(a) {
  const ics = buildICS(a);
  if (!ics) { toast("Set a date & time first", "danger"); return; }
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const name = `${(a.customerName || "appointment").replace(/[^\w]+/g, "-").toLowerCase()}.ics`;
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function renderCalendar(view, { param }) {
  if (param) return renderApptDetail(view, param);

  const appts = store.all("appointments").filter((a) => a.status !== "canceled");
  const el = document.createElement("div");

  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const upcoming = appts.filter((a) => dayKey(a.when) >= todayKey && a.status !== "done");
  const past = appts.filter((a) => dayKey(a.when) < todayKey || a.status === "done");

  el.innerHTML = `
    <div class="btn-row" style="margin-bottom:12px">
      <button class="btn btn-primary btn-block" data-act="new">＋ New appointment</button>
    </div>
    <div class="upcoming"></div>
    ${past.length ? `<div class="section-title">Past & completed</div><div class="past"></div>` : ""}
  `;
  view.appendChild(el);

  el.querySelector('[data-act="new"]').addEventListener("click", () => openAppointmentForm());

  const upEl = el.querySelector(".upcoming");
  if (!upcoming.length) {
    upEl.innerHTML = emptyState("calendar", "No upcoming appointments", "Tap “New appointment” to schedule one.");
  } else {
    renderGroups(upEl, upcoming, false);
  }
  const pastEl = el.querySelector(".past");
  if (pastEl) renderGroups(pastEl, past.slice().reverse(), true);
}

function renderGroups(container, list, isPast) {
  // Sort by datetime.
  const sorted = list.slice().sort((a, b) => String(a.when).localeCompare(String(b.when)));
  if (isPast) sorted.reverse();
  const groups = new Map();
  sorted.forEach((a) => {
    const k = dayKey(a.when);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  });
  groups.forEach((items, key) => {
    const h = document.createElement("div");
    h.className = "section-title";
    h.textContent = key ? dayHeading(key) : "No date";
    container.appendChild(h);
    items.forEach((a) => container.appendChild(apptCard(a)));
  });
}

function apptCard(a) {
  const el = document.createElement("div");
  el.className = "card card-tap";
  const t = apptType(a.type);
  const overdue = a.status !== "done" && a.when && daysFromToday(dayKey(a.when)) < 0;
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${icon(t.icon)} ${esc(a.title || t.label)}</div>
        <div class="row-sub">${esc(a.customerName || "")}${a.vehicle ? " · " + esc(a.vehicle) : ""}</div>
      </div>
      <div class="row-meta">
        <div class="strong mono">${esc(timeLabel(a.when)) || "—"}</div>
        ${a.status === "done" ? '<div class="small muted">Done</div>' : overdue ? '<div class="small" style="color:var(--danger)">Past</div>' : ""}
      </div>
    </div>
  `;
  el.addEventListener("click", () => navigate(`/calendar/${a.id}`));
  return el;
}

// datetime-local wants "YYYY-MM-DDTHH:MM"; store the same string.
function defaultWhen() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function openAppointmentForm(existing, prefill = {}) {
  const isEdit = !!existing;
  const a = existing || prefill;
  openModal(isEdit ? "Edit appointment" : "New appointment", (close) => {
    const { element } = buildForm(
      [
        { name: "type", label: "Type", value: a.type || "appointment", type: "select",
          options: APPT_TYPES.map((t) => ({ value: t.id, label: t.label })) },
        { name: "customerName", label: "Customer", value: a.customerName, required: true, placeholder: "Jane Doe" },
        { name: "when", label: "Date & time", value: a.when || defaultWhen(), type: "datetime-local", required: true },
        { name: "vehicle", label: "Vehicle", value: a.vehicle, placeholder: "2024 RAV4 XLE" },
        { name: "notes", label: "Notes", value: a.notes, type: "textarea", placeholder: "Bring trade, financing pre-approved…" },
      ],
      {
        submitLabel: isEdit ? "Save" : "Schedule",
        onSubmit: (data) => {
          const title = APPT_TYPES.find((t) => t.id === data.type)?.label || "Appointment";
          if (isEdit) { store.update("appointments", existing.id, { ...data, title }); toast("Updated", "success"); }
          else { store.create("appointments", { ...data, title, status: "scheduled", leadId: a.leadId || null }); toast("Appointment scheduled", "success"); }
          close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    return element;
  });
}

function renderApptDetail(view, id) {
  const a = store.get("appointments", id);
  if (!a) { view.innerHTML = emptyState("help", "Appointment not found", ""); return; }
  const t = apptType(a.type);
  const lead = a.leadId ? store.get("leads", a.leadId) : null;

  const el = document.createElement("div");
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-act="back" style="margin-bottom:12px">← Calendar</button>
    <div class="card">
      <div class="row-title" style="font-size:1.3rem">${icon(t.icon)} ${esc(a.title || t.label)}</div>
      <div class="row-sub" style="margin-top:4px">${esc(a.customerName || "")}${a.vehicle ? " · " + esc(a.vehicle) : ""}</div>
      <div class="kv" style="margin-top:12px"><span class="k">When</span><span class="v">${a.when ? esc(relativeDay(dayKey(a.when))) + " at " + esc(timeLabel(a.when)) : "—"}</span></div>
      <div class="kv"><span class="k">Status</span><span class="v">${esc(a.status || "scheduled")}</span></div>
    </div>
    ${a.notes ? `<div class="section-title">Notes</div><div class="card"><div style="white-space:pre-wrap">${esc(a.notes)}</div></div>` : ""}
    ${lead ? `<button class="btn btn-ghost btn-block" data-act="lead" style="margin-bottom:12px">${icon("users")} Open ${esc(lead.name)}'s lead</button>` : ""}

    <div class="section-title">Actions</div>
    <div class="card">
      <button class="btn btn-ghost btn-block" data-act="ics" style="margin-bottom:10px">${icon("calendar")} Add to calendar (Outlook / Apple / Google)</button>
      ${a.status !== "done" ? `<button class="btn btn-success btn-block" data-act="done">${icon("checkline")} Mark completed</button>` : `<button class="btn btn-ghost btn-block" data-act="reopen">Reopen</button>`}
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-primary btn-block" data-act="edit">${icon("edit")} Edit</button>
        <button class="btn btn-danger btn-block" data-act="delete">Delete</button>
      </div>
    </div>
  `;
  view.appendChild(el);

  el.querySelector('[data-act="back"]').addEventListener("click", () => navigate("/calendar"));
  el.querySelector('[data-act="edit"]').addEventListener("click", () => openAppointmentForm(a));
  el.querySelector('[data-act="ics"]').addEventListener("click", () => addToCalendar(a));
  const leadBtn = el.querySelector('[data-act="lead"]');
  if (leadBtn) leadBtn.addEventListener("click", () => navigate(`/leads/${a.leadId}`));

  const doneBtn = el.querySelector('[data-act="done"]');
  if (doneBtn) doneBtn.addEventListener("click", () => { store.update("appointments", a.id, { status: "done" }); toast("Marked completed", "success"); navigate("/calendar"); });
  const reopenBtn = el.querySelector('[data-act="reopen"]');
  if (reopenBtn) reopenBtn.addEventListener("click", () => { store.update("appointments", a.id, { status: "scheduled" }); view.innerHTML = ""; renderApptDetail(view, id); });

  el.querySelector('[data-act="delete"]').addEventListener("click", async () => {
    if (await confirmDialog("Delete this appointment?")) { store.remove("appointments", a.id); toast("Deleted"); navigate("/calendar"); }
  });
}
