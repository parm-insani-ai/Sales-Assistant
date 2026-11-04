// The calling session, on the screen: one customer at a time.
//
// Top: how far through the day's batch. Then the customer — name, what they
// drive, the read's verdict and reasons, and the script: the opener in the
// salesperson's voice, the ask, and what to say back to the objections this
// reason tends to draw. A big Call button dials. Under it, the outcomes,
// each doing its own paperwork (session.js), and the next customer is up.
// Spoke opens the note panel so what was said is kept, by voice. At the
// end, the summary: dials, reached, appointments, minutes.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { esc, telHref, phoneDisplay } from "../utils.js";
import { icon } from "../icons.js";
import { toast, emptyState } from "../components.js";
import { assessment } from "../assess.js";
import { contractSummary } from "../contract.js";
import { consentStatus } from "../consent.js";
import { openAppointmentForm } from "./calendar.js";
import { notePanel } from "./leads.js";
import { reachLine } from "../reachtime.js";
import { currentSession, currentCustomer, recordOutcome, skipCurrent, endSession, summarize, callScript, OUTCOMES, startSession, sessionQueue } from "../session.js";

export function renderSession(view) {
  const page = document.createElement("div");
  page.className = "cs-page";
  view.appendChild(page);
  draw();

  function draw() {
    const s = currentSession();
    if (!s) { page.replaceChildren(startCard()); return; }
    const cur = currentCustomer();
    if (!cur) { page.replaceChildren(summaryCard(endSession())); return; }
    page.replaceChildren(customerCard(cur, s));
  }

  // No session under way: offer today's batch.
  function startCard() {
    const q = sessionQueue();
    const el = document.createElement("div");
    if (!q.length) { el.innerHTML = emptyState("phone", "Nobody to call right now", "Today's batch is worked through, or nobody on it has a number. Outreach brings up the next handful tomorrow."); const b = document.createElement("button"); b.className = "btn btn-ghost"; b.textContent = "Back to Outreach"; b.addEventListener("click", () => navigate("/leads")); el.appendChild(b); return el; }
    el.className = "card cs-start";
    el.innerHTML = `
      <div class="cs-start-n">${q.length}</div>
      <div class="strong">to call today</div>
      <div class="small muted" style="margin:6px 0 14px">Best first. One at a time: who, why, what to say, the number — and what came of it.</div>
      <button type="button" class="btn btn-success btn-lg" data-act="start" style="width:100%">${icon("phone")} Start calling</button>`;
    el.querySelector('[data-act="start"]').addEventListener("click", () => { startSession(); draw(); });
    return el;
  }

  function customerCard(cur, s) {
    const l = cur.lead;
    const a = assessment(l.id) || { reasons: [], why: [], whySafe: [], tier: null, best: null };
    const script = callScript({ lead: l, reasons: a.reasons, whySafe: a.whySafe, why: a.why, best: a.best });
    const c = contractSummary(l);
    const consent = consentStatus(l);
    const done = s.done.filter((d) => d.outcome !== "skipped").length;
    const reached = s.done.filter((d) => ["reached", "appointment", "not_interested"].includes(d.outcome)).length;
    const el = document.createElement("div");
    el.className = "cs-wrap";
    el.innerHTML = `
      <div class="cs-head">
        <div class="cs-progress"><span class="strong">${cur.i + 1} of ${cur.of}</span><span class="muted"> · ${done} called · ${reached} reached</span></div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="end">End</button>
        <div class="cs-bar"><span style="width:${Math.round((cur.i / Math.max(1, cur.of)) * 100)}%"></span></div>
      </div>
      <div class="card cs-card">
        <div class="cs-who">
          <div>
            <div class="cs-name">${esc(l.name)}</div>
            <div class="cs-sub">${esc(l.vehicleInterest || "No vehicle noted")}${c && c.line ? ` · ${esc(c.line)}` : ""}</div>
            ${reachLine(l.id) ? `<div class="cs-when">${icon("clock")} ${esc(reachLine(l.id))}</div>` : ""}
          </div>
          ${a.tier ? `<span class="badge ${a.tier.badge}">${esc(a.tier.label)}</span>` : ""}
        </div>
        ${a.reasons.length ? `<div class="cs-reasons">${a.reasons.map((r) => `<span class="cs-reason">${esc(r)}</span>`).join("")}</div>` : ""}
        <div class="cs-script">
          <div class="cs-label">Say</div>
          <p class="cs-line">${esc(script.opener)}</p>
          <p class="cs-line cs-ask">${esc(script.bridge)}</p>
        </div>
        <details class="cs-obj">
          <summary>If they say…</summary>
          ${script.objections.map((o) => `<div class="cs-obj-row"><div class="cs-obj-say">“${esc(o.say)}”</div><div class="cs-obj-back">${esc(o.back)}</div></div>`).join("")}
        </details>
        ${!consent.ok ? `<div class="cs-note small">${icon("alert")} No texting consent on file — this one's a call. ${esc(consent.note || "")}</div>` : ""}
        <a class="btn btn-success btn-lg cs-dial" data-act="dial" href="${telHref(l.phone)}">${icon("phone")} Call ${esc(phoneDisplay(l.phone))}</a>
        <div class="cs-label" style="margin-top:14px">What came of it</div>
        <div class="cs-outcomes">
          ${OUTCOMES.map((o) => `<button type="button" class="btn cs-out cs-out-${o.kind}" data-outcome="${o.key}" title="${esc(o.hint)}">${icon(o.icon)}<span>${esc(o.label)}</span></button>`).join("")}
        </div>
        <div class="cs-slot"></div>
      </div>
      <div class="cs-foot">
        <button type="button" class="btn btn-ghost btn-sm" data-act="skip">Skip for now</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="open">Open their page</button>
      </div>`;
    el.querySelector('[data-act="end"]').addEventListener("click", () => { page.replaceChildren(summaryCard(endSession())); });
    el.querySelector('[data-act="skip"]').addEventListener("click", () => { skipCurrent(); draw(); });
    el.querySelector('[data-act="open"]').addEventListener("click", () => navigate(`/leads/${l.id}`));
    el.querySelector('[data-act="dial"]').addEventListener("click", () => { store.logActivity("touch"); el.classList.add("cs-dialed"); });
    const slot = el.querySelector(".cs-slot");
    const outcomes = el.querySelector(".cs-outcomes");
    const next = (line, kind = "success") => { if (line) toast(line, kind); draw(); };
    el.querySelectorAll("[data-outcome]").forEach((b) => b.addEventListener("click", () => {
      const key = b.dataset.outcome;
      outcomes.querySelectorAll("button").forEach((x) => { x.disabled = true; });
      b.classList.add("cs-out-picked");
      if (key === "appointment") {
        const r = recordOutcome(l.id, key);
        // The form books them; the session carries on when it closes.
        openAppointmentForm(null, { leadId: l.id, customerName: l.name, vehicle: l.vehicleInterest || "", type: "appointment" });
        const wait = setInterval(() => { if (!document.querySelector(".modal-backdrop")) { clearInterval(wait); next(r ? r.line : ""); } }, 300);
        return;
      }
      if (key === "reached") {
        const r = recordOutcome(l.id, key);
        if (!r) { next("Couldn't log that — try again", "danger"); return; }
        // What was said, by voice; the moves it implies are offered there.
        slot.appendChild(notePanel(l, r.rec, () => next(r.line)));
        slot.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      const r = recordOutcome(l.id, key);
      next(r ? r.line : "Couldn't log that — try again", r ? (key === "wrong_number" || key === "not_interested" ? "" : "success") : "danger");
    }));
    return el;
  }

  function summaryCard(sum) {
    const el = document.createElement("div");
    el.className = "card cs-summary";
    if (!sum) { el.innerHTML = `<div class="muted">No session to sum up.</div>`; return el; }
    const stat = (n, label) => `<div class="cs-stat"><div class="cs-stat-n">${n}</div><div class="cs-stat-l">${esc(label)}</div></div>`;
    const rate = sum.dials ? Math.round((sum.reached / sum.dials) * 100) : 0;
    el.innerHTML = `
      <div class="strong" style="font-size:1.1rem">Session done</div>
      <div class="small muted" style="margin-top:2px">${sum.minutes} minute${sum.minutes === 1 ? "" : "s"} on the phone${sum.left ? ` · ${sum.left} left for later` : ""}</div>
      <div class="cs-stats">
        ${stat(sum.dials, "dials")}${stat(sum.reached, "reached")}${stat(sum.appointments, sum.appointments === 1 ? "appointment" : "appointments")}${stat(`${rate}%`, "reach rate")}
      </div>
      <div class="small muted">${[sum.voicemail ? `${sum.voicemail} message${sum.voicemail === 1 ? "" : "s"} left` : "", sum.noAnswer ? `${sum.noAnswer} no answer` : "", sum.notInterested ? `${sum.notInterested} not interested` : "", sum.wrongNumber ? `${sum.wrongNumber} wrong number${sum.wrongNumber === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || "Every call reached someone."}</div>
      <div class="small" style="margin-top:10px">${sum.voicemail || sum.noAnswer ? "The follow-ups are on your Log — a text or a call for each one tomorrow." : "Nothing left to follow up from this round."}</div>
      <div class="btn-row" style="margin-top:14px">
        <button type="button" class="btn btn-primary" data-act="back" style="flex:1">Back to Outreach</button>
        ${sum.left ? `<button type="button" class="btn btn-ghost" data-act="again">Keep going</button>` : ""}
      </div>`;
    el.querySelector('[data-act="back"]').addEventListener("click", () => navigate("/leads"));
    const again = el.querySelector('[data-act="again"]');
    if (again) again.addEventListener("click", () => { startSession(); draw(); });
    return el;
  }
}
