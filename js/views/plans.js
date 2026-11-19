// Follow-up plans — every cadence the app runs, on one page, each editable.
//
// /plans is the index: the plans by situation (an internet or phone enquiry,
// a showroom visit, came in and didn't buy, a no-show, an owner from the
// book, nurture) and the cadences by rule (the attempts after a missed call,
// what each conversation outcome sets up, what an appointment comes with).
// /plans/:key is one of them: its touches as a timeline by day, each a tap
// to change, one to add, one to take off, and Reset to the default.
//
// The plans themselves live in cadence.js (planOf / savePlan, the attempt
// rows and the outcome rules); this page is only the way to see and change
// them. A plan started for a customer copies the plan as it is that moment,
// so an edit changes the next customer's plan, not the ones already running.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { openModal, buildForm, toast, confirmDialog, emptyState } from "../components.js";
import { icon } from "../icons.js";
import { esc } from "../utils.js";
import { PLAN_KINDS, planOf, planIsDefault, savePlan, resetPlan, INTENT_LABELS,
  attemptPlan, attemptsTotal, restDays, attemptPlanIsDefault, saveAttemptPlan, resetAttemptPlan, attemptLine,
  outcomeRules, OUTCOME_RULE_DEFAULTS, OUTCOME_RULE_LABELS, outcomeRulesAreDefault, saveOutcomeRules, resetOutcomeRules } from "../cadence.js";
import { apptPresets, DEFAULTS as APPT_DEFAULTS } from "../apptplan.js";

// The cadences by rule, beside the six by situation.
export const RULE_KINDS = [
  { key: "attempts", short: "Missed call", label: "Missed call — the attempts", from: "the first call that rang out", blurb: "Each miss queues the next attempt by rule — a text asking when's good, a call in the other half of the day, a call when they tend to pick up, a text with two times, a call in a part of the day not yet tried — and after the last, a rest. A reply or a conversation ends the chase." },
  { key: "outcomes", short: "After a call", label: "After a conversation", from: "the conversation", blurb: "What each outcome of a conversation sets up, and how far out: a call back when they didn't say when, a check-back after not now, how long not interested and bought elsewhere park them. Interested is a text with two times to come in the same afternoon; booked is the appointment itself." },
  { key: "appt", short: "Appointment", label: "Appointment booked", from: "the booking", blurb: "What every appointment comes with the moment it's booked: a confirmation text to the customer, timed by the appointment, and your own reminders. The wording of the texts is under Settings." },
];
const ALL = [...PLAN_KINDS, ...RULE_KINDS];
const kindOf = (key) => ALL.find((k) => k.key === key) || null;

const verbOf = (ch) => (ch === "text" ? "Text" : ch === "email" ? "Email" : "Call");
const icoOf = (ch) => (ch === "text" ? "message" : ch === "email" ? "mail" : "phone");
const whenOf = (st) => st.after != null ? `${st.after} min` : `Day ${st.day}${st.hh != null ? ` · ${String(st.hh).padStart(2, "0")}:${String(st.mm || 0).padStart(2, "0")}` : ""}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** One line on a plan: "14 touches over 30 days · 6 calls · 7 texts · 1 email". */
export function planLine(key) {
  const k = kindOf(key);
  if (!k) return "";
  if (key === "attempts") { const rows = attemptPlan(); const days = rows.reduce((a, r) => a + (r.days || 0), 0); return `${attemptsTotal()} attempts over about ${plural(Math.max(1, days), "day")}, then ${plural(restDays(), "day")}' rest`; }
  if (key === "outcomes") { const r = outcomeRules(); return `Call back ${plural(r.callbackDays, "day")} · not now ${plural(r.notNowDays, "day")} · not interested ${plural(r.notInterestedDays, "day")} · bought elsewhere ${plural(r.boughtElsewhereDays, "day")}`; }
  if (key === "appt") { const p = apptPresets(); return `Confirmation ${p.confirmAm} the day before a morning appointment, ${p.confirmPm} the morning of an afternoon one · your reminders ${p.morning} and ${p.remindMin} min before`; }
  const steps = planOf(key, { bare: true });
  if (!steps.length) return "No touches";
  const span = Math.max(...steps.map((s) => Number(s.day) || 0));
  const by = { call: 0, text: 0, email: 0 };
  steps.forEach((s) => { by[s.channel] = (by[s.channel] || 0) + 1; });
  const mix = ["call", "text", "email"].filter((c) => by[c]).map((c) => plural(by[c], c)).join(" · ");
  return `${plural(steps.length, "touch").replace("touchs", "touches")} over ${span === 0 ? "day zero" : plural(span, "day")} · ${mix}${k.nurtured ? " · then nurture" : ""}`;
}
export function planEdited(key) {
  if (key === "attempts") return !attemptPlanIsDefault();
  if (key === "outcomes") return !outcomeRulesAreDefault();
  if (key === "appt") { const s = store.getSettings(); return ["apptConfirmAm", "apptConfirmPm", "apptMorning", "apptRemindMin", "apptNoon"].some((k) => s[k] != null && String(s[k]) !== String(APPT_DEFAULTS[k])); }
  return !planIsDefault(key);
}

export function renderPlans(view, { param } = {}) {
  const el = document.createElement("div");
  el.className = "fp";
  view.appendChild(el);
  if (param) { drawPlan(el, param); return; }
  const row = (k) => `<a class="card card-tap fp-row" href="#/plans/${k.key}" data-plan-row="${k.key}"><div class="row" style="align-items:center"><div class="row-main" style="min-width:0"><div class="row-title">${esc(k.label)}${planEdited(k.key) ? ` <span class="badge badge-working">Edited</span>` : ""}</div><div class="row-sub">${esc(planLine(k.key))}</div></div><div class="row-meta muted">›</div></div></a>`;
  el.innerHTML = `
    <div class="section-title">By situation <span class="muted">· ${PLAN_KINDS.length}</span></div>
    <div class="hint" style="margin:0 2px 8px">Day zero is the moment it happens; the touches follow from there, each with its day, time, channel and what it's for. Tap a plan to see its timeline and change it.</div>
    ${PLAN_KINDS.map(row).join("")}
    <div class="section-title" style="margin-top:14px">By rule <span class="muted">· ${RULE_KINDS.length}</span></div>
    ${RULE_KINDS.map(row).join("")}
    <div class="hint" style="margin:8px 2px 0">A change applies to the next customer it starts for; plans already running keep their steps. Each plan has Reset for the default.</div>`;
}

function chips(el, key) {
  return `<div class="lead-chips plan-chips" style="margin-bottom:8px">${ALL.map((k) => `<button type="button" class="btn btn-sm ${k.key === key ? "btn-primary" : "btn-ghost"}" data-plan="${k.key}">${esc(k.short)}</button>`).join("")}</div>`;
}

function drawPlan(el, key) {
  const kind = kindOf(key);
  if (!kind) { el.innerHTML = emptyState("target", "No such plan", "Pick one from the list."); return; }
  const wrap = document.createElement("div");
  wrap.className = "plan-editor";
  wrap.dataset.kind = key;
  el.appendChild(wrap);
  const draw = () => {
    if (key === "attempts") drawAttempts(wrap, kind, draw);
    else if (key === "outcomes") drawOutcomes(wrap, kind, draw);
    else if (key === "appt") drawAppt(wrap, kind, draw);
    else drawTouches(wrap, kind, draw);
    wrap.querySelectorAll(".plan-chips [data-plan]").forEach((b) => b.addEventListener("click", () => navigate(`/plans/${b.dataset.plan}`)));
  };
  draw();
}

const head = (kind, extra = "") => `
  <div class="card fp-head">
    <div class="row-title">${esc(kind.label)}${planEdited(kind.key) ? ` <span class="badge badge-working">Edited</span>` : ""}</div>
    <div class="row-sub" style="margin-top:4px">${esc(kind.blurb)} Day zero is ${esc(kind.from)}.${kind.nurtured ? " After the last touch, Nurture follows." : ""}</div>
    <div class="fp-meta small muted" style="margin-top:6px">${esc(planLine(kind.key))}</div>
    ${extra}
  </div>`;

// ---- The six by situation: a timeline by day ----
function drawTouches(wrap, kind, redraw) {
  const key = kind.key;
  const steps = planOf(key, { bare: true });
  const isDefault = planIsDefault(key);
  const days = [];
  steps.forEach((st, idx) => {
    const d = Number(st.day) || 0;
    let g = days.find((x) => x.day === d);
    if (!g) { g = { day: d, rows: [] }; days.push(g); }
    g.rows.push({ st, idx });
  });
  wrap.innerHTML = `
    ${chips(wrap, key)}
    ${head(kind)}
    <div class="card fp-tl">
      ${steps.length ? days.map((g) => `
        <div class="fp-day">
          <div class="fp-day-label">Day ${g.day}${g.day === 0 ? ` <span class="muted small">· ${esc(kind.from)}</span>` : ""}</div>
          ${g.rows.map(({ st, idx }) => `<div class="check-item plan-step" data-idx="${idx}" style="cursor:pointer"><span class="fp-ico">${icon(icoOf(st.channel))}</span><label style="flex:1;cursor:pointer"><span class="strong">${esc(whenOf(st))}</span> · ${verbOf(st.channel)} — ${esc(st.label)}${st.intent && INTENT_LABELS[st.intent] ? ` <span class="muted small">· ${esc(INTENT_LABELS[st.intent])}</span>` : ""}${st.needsEmail ? ` <span class="muted small">· only with an email on file</span>` : ""}</label><button type="button" class="modal-close" data-del="${idx}" aria-label="Remove" style="font-size:1.2rem">&times;</button></div>`).join("")}
        </div>`).join("") : `<div class="muted small">No touches — add one below.</div>`}
      <div class="btn-row" style="margin-top:10px">
        <button type="button" class="btn btn-ghost btn-sm" data-act="add-step" style="flex:1">+ Add a touch</button>
        ${isDefault ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-act="reset-plan" style="flex:0 0 auto" title="Back to the default plan">Reset</button>`}
      </div>
    </div>`;
  wrap.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); const next = steps.slice(); next.splice(Number(b.dataset.del), 1); savePlan(key, next); redraw(); }));
  wrap.querySelectorAll(".plan-step").forEach((row) => row.addEventListener("click", () => editStep(key, Number(row.dataset.idx), redraw)));
  wrap.querySelector('[data-act="add-step"]').addEventListener("click", () => editStep(key, null, redraw));
  const reset = wrap.querySelector('[data-act="reset-plan"]');
  if (reset) reset.addEventListener("click", async () => {
    if (!(await confirmDialog(`Put the ${kind.label} plan back to its default? Your changes to it go.`, { confirmLabel: "Reset" }))) return;
    resetPlan(key); toast(`${kind.label}: back to default`, "success"); redraw();
  });
}

function editStep(key, idx, redraw) {
  const steps = planOf(key, { bare: true });
  const st = idx != null ? steps[idx] : { day: 1, channel: "call", intent: "check", label: "" };
  const intents = Object.entries(INTENT_LABELS).map(([value, label]) => ({ value, label }));
  openModal(idx != null ? "Edit the touch" : "Add a touch", (close) => {
    const { element } = buildForm(
      [
        { name: "day", label: "Day (0 = day zero)", value: st.day ?? 0, type: "number", inputmode: "numeric", half: true, required: true },
        { name: "time", label: "Time (blank = the channel's usual hour)", value: st.hh != null ? `${String(st.hh).padStart(2, "0")}:${String(st.mm || 0).padStart(2, "0")}` : "", type: "time", half: true },
        { name: "after", label: "Or minutes after day zero (day 0 only)", value: st.after ?? "", type: "number", inputmode: "numeric", half: true, placeholder: "5" },
        { name: "channel", label: "Channel", value: st.channel || "call", type: "select", half: true, options: [{ value: "call", label: "Call" }, { value: "text", label: "Text" }, { value: "email", label: "Email" }] },
        { name: "intent", label: "What the text is for (the drafter writes it)", value: st.intent || "check", type: "select", options: [{ value: "", label: "— none —" }, ...intents] },
        { name: "label", label: "What to do", value: st.label || "", required: true, placeholder: "One-week call — where are they at" },
      ],
      { submitLabel: idx != null ? "Save" : "Add touch", onSubmit: (d) => {
        const next = steps.slice();
        const step = { day: Math.max(0, Number(d.day) || 0), channel: d.channel, intent: d.intent || "", label: String(d.label || "").trim() };
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(d.time || "").trim());
        if (m) { step.hh = Number(m[1]); step.mm = Number(m[2]); }
        if (step.day === 0 && d.after !== "" && d.after != null && !isNaN(Number(d.after))) step.after = Math.max(1, Number(d.after));
        if (st.needsEmail && step.channel === "email") step.needsEmail = true;
        if (idx != null) next[idx] = step; else next.push(step);
        savePlan(key, next);
        close(); redraw();
      } }
    );
    return element;
  });
}

// ---- Missed call: the attempts ----
function drawAttempts(wrap, kind, redraw) {
  const rows = attemptPlan();
  const isDefault = attemptPlanIsDefault();
  wrap.innerHTML = `
    ${chips(wrap, kind.key)}
    ${head(kind)}
    <div class="card fp-tl">
      ${rows.map((st, idx) => `<div class="check-item plan-step" data-idx="${idx}" style="cursor:pointer"><span class="fp-ico">${icon(icoOf(st.channel))}</span><label style="flex:1;cursor:pointer"><span class="strong">After miss ${idx + 1}</span> · ${esc(attemptLine(st))}</label><button type="button" class="modal-close" data-del="${idx}" aria-label="Remove" style="font-size:1.2rem">&times;</button></div>`).join("")}
      <div class="check-item" style="opacity:.8"><span class="fp-ico">${icon("clock")}</span><label style="flex:1"><span class="strong">After miss ${rows.length + 1}</span> · rest — off the lists for <input type="number" class="fp-inline" data-f="rest" min="1" max="730" value="${restDays()}" inputmode="numeric"> days, then another round</label></div>
      <div class="btn-row" style="margin-top:10px">
        <button type="button" class="btn btn-ghost btn-sm" data-act="add-step" style="flex:1">+ Add an attempt</button>
        ${isDefault ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-act="reset-plan" style="flex:0 0 auto">Reset</button>`}
      </div>
    </div>`;
  wrap.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); const next = rows.slice(); next.splice(Number(b.dataset.del), 1); if (!next.length) { toast("Keep at least one attempt", "warn"); return; } saveAttemptPlan({ steps: next }); redraw(); }));
  wrap.querySelectorAll(".plan-step").forEach((row) => row.addEventListener("click", () => editAttempt(Number(row.dataset.idx), redraw)));
  wrap.querySelector('[data-act="add-step"]').addEventListener("click", () => editAttempt(null, redraw));
  const rest = wrap.querySelector('[data-f="rest"]');
  rest.addEventListener("change", () => { const n = Number(rest.value); if (n > 0) { saveAttemptPlan({ restDays: n }); toast(`Rest: ${n} days`, "success"); redraw(); } });
  const reset = wrap.querySelector('[data-act="reset-plan"]');
  if (reset) reset.addEventListener("click", async () => {
    if (!(await confirmDialog("Put the attempts back to the default six? Your changes go.", { confirmLabel: "Reset" }))) return;
    resetAttemptPlan(); toast("Attempts: back to default", "success"); redraw();
  });
}
function editAttempt(idx, redraw) {
  const rows = attemptPlan();
  const st = idx != null ? rows[idx] : { channel: "call", days: 1, other: true };
  openModal(idx != null ? `After miss ${idx + 1}` : "Add an attempt", (close) => {
    const { element } = buildForm(
      [
        { name: "channel", label: "Channel", value: st.channel, type: "select", half: true, options: [{ value: "call", label: "Call" }, { value: "text", label: "Text" }] },
        { name: "days", label: "Days after the miss (0 = same day)", value: st.days ?? 1, type: "number", inputmode: "numeric", half: true, required: true },
        { name: "hours", label: "Same day: hours after the miss", value: st.hours ?? 2, type: "number", inputmode: "numeric", half: true },
        { name: "intent", label: "A text asks for", value: st.intent || "missed", type: "select", half: true, options: [{ value: "missed", label: "When's good?" }, { value: "time", label: "Two times to catch them" }] },
        { name: "slot", label: "A call goes", value: st.untried ? "untried" : "other", type: "select", options: [{ value: "other", label: "When they tend to pick up, or the other half of the day" }, { value: "untried", label: "In a part of the day not yet tried" }] },
      ],
      { submitLabel: idx != null ? "Save" : "Add", onSubmit: (d) => {
        const next = rows.slice();
        const step = d.channel === "text"
          ? { channel: "text", days: Math.max(0, Number(d.days) || 0), intent: d.intent === "time" ? "time" : "missed", hours: Math.max(1, Number(d.hours) || 2) }
          : { channel: "call", days: Math.max(0, Number(d.days) || 0), ...(d.slot === "untried" ? { untried: true } : { other: true }) };
        if (idx != null) next[idx] = step; else next.push(step);
        saveAttemptPlan({ steps: next });
        close(); redraw();
      } }
    );
    return element;
  });
}

// ---- After a conversation: the days ----
function drawOutcomes(wrap, kind, redraw) {
  const r = outcomeRules();
  wrap.innerHTML = `${chips(wrap, kind.key)}${head(kind)}<div class="card fp-tl"><div class="fp-form"></div>
    <div class="check-item" style="opacity:.8"><span class="fp-ico">${icon("sparkles")}</span><label style="flex:1"><span class="strong">Interested</span> · a text with two times to come in, the same afternoon; the follow-up plan takes them from there</label></div>
    <div class="check-item" style="opacity:.8"><span class="fp-ico">${icon("calendar")}</span><label style="flex:1"><span class="strong">Booked</span> · the appointment, with its confirmation and reminders (the Appointment plan)</label></div>
    ${outcomeRulesAreDefault() ? "" : `<div class="btn-row" style="margin-top:10px"><button type="button" class="btn btn-ghost btn-sm" data-act="reset-plan">Reset</button></div>`}
  </div>`;
  const { element } = buildForm(
    Object.keys(OUTCOME_RULE_DEFAULTS).map((k) => ({ name: k, label: `${OUTCOME_RULE_LABELS[k].label} — days`, value: r[k], type: "number", inputmode: "numeric", half: true, required: true, hint: OUTCOME_RULE_LABELS[k].hint })),
    { submitLabel: "Save", onSubmit: (d) => { saveOutcomeRules(d); toast("Saved", "success"); redraw(); } }
  );
  wrap.querySelector(".fp-form").appendChild(element);
  const reset = wrap.querySelector('[data-act="reset-plan"]');
  if (reset) reset.addEventListener("click", async () => {
    if (!(await confirmDialog("Put the days back to the defaults?", { confirmLabel: "Reset" }))) return;
    resetOutcomeRules(); toast("Back to default", "success"); redraw();
  });
}

// ---- Appointment booked: the timings ----
function drawAppt(wrap, kind, redraw) {
  const p = apptPresets();
  wrap.innerHTML = `${chips(wrap, kind.key)}${head(kind)}<div class="card fp-tl"><div class="fp-form"></div>
    <div class="hint" style="margin-top:8px">The confirmation text is held for your OK on the Log like every text the app writes, unless auto-send is on. Its wording, and the reminder's, are under Settings.</div>
    ${planEdited("appt") ? `<div class="btn-row" style="margin-top:10px"><button type="button" class="btn btn-ghost btn-sm" data-act="reset-plan">Reset</button></div>` : ""}
  </div>`;
  const { element } = buildForm(
    [
      { name: "apptConfirmAm", label: "Morning appointment: confirmation the day before, at", value: p.confirmAm, type: "time", half: true, required: true },
      { name: "apptConfirmPm", label: "Afternoon or evening: confirmation that morning, at", value: p.confirmPm, type: "time", half: true, required: true },
      { name: "apptNoon", label: "Morning ends at (hour)", value: p.noon, type: "number", inputmode: "numeric", half: true, required: true },
      { name: "apptMorning", label: "Your reminder the morning of, at", value: p.morning, type: "time", half: true, required: true },
      { name: "apptRemindMin", label: "And minutes before", value: p.remindMin, type: "number", inputmode: "numeric", half: true, required: true },
    ],
    { submitLabel: "Save", onSubmit: (d) => { store.updateSettings({ apptConfirmAm: d.apptConfirmAm, apptConfirmPm: d.apptConfirmPm, apptNoon: Number(d.apptNoon) || APPT_DEFAULTS.apptNoon, apptMorning: d.apptMorning, apptRemindMin: Number(d.apptRemindMin) || APPT_DEFAULTS.apptRemindMin }); toast("Saved", "success"); redraw(); } }
  );
  wrap.querySelector(".fp-form").appendChild(element);
  const reset = wrap.querySelector('[data-act="reset-plan"]');
  if (reset) reset.addEventListener("click", async () => {
    if (!(await confirmDialog("Put the appointment timings back to the defaults?", { confirmLabel: "Reset" }))) return;
    store.updateSettings({ apptConfirmAm: null, apptConfirmPm: null, apptNoon: null, apptMorning: null, apptRemindMin: null }); toast("Back to default", "success"); redraw();
  });
}
