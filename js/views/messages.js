// Text / email templates. Fill placeholders from a lead and open the phone's
// Messages or Mail composer, or copy to clipboard.

import * as store from "../store.js";
import { DEFAULT_TEMPLATES } from "../store.js";
import { openModal, toast } from "../components.js";
import { esc, smsHref } from "../utils.js";
import { icon } from "../icons.js";

// Replace {placeholders} using the lead + settings.
export function fillTemplate(text, lead) {
  const s = store.getSettings();
  const name = (lead && lead.name) || "there";
  const firstName = String(name).trim().split(/\s+/)[0] || "there";
  // {vehicle} is whatever vehicle the record is about. For an inbound lead
  // that's what they asked for; for an imported owner it's what they DRIVE —
  // which is why owner templates say {theirCar} and never "your interest in".
  const car = (lead && lead.vehicleInterest) || "";
  const money = (n) => "$" + Math.round(Number(n)).toLocaleString("en-CA");
  const val = lead && lead.currentValue != null ? Number(lead.currentValue) : null;
  const payoff = lead && lead.payoff != null ? Number(lead.payoff) : null;
  const map = {
    name,
    firstName,
    vehicle: car || "vehicle",
    theirCar: car || "your vehicle",
    tradeValue: val != null ? money(val) : "more than you'd think",
    equity: val != null ? money(Math.max(0, val - (payoff || 0))) : "real money",
    payment: lead && lead.currentPayment != null ? money(lead.currentPayment) + "/mo" : "what you pay now",
    salesperson: s.salesperson || "your salesperson",
    dealership: s.dealership || "the dealership",
  };
  return String(text || "").replace(/\{(\w+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : m);
}

// Saved templates plus any newer built-in defaults the user's stored settings
// predate (settings merge shallowly, so new defaults never reach old installs).
export function allTemplates() {
  const saved = store.getSettings().messageTemplates || [];
  return saved.concat(DEFAULT_TEMPLATES.filter((d) => !saved.some((s) => s.id === d.id)));
}

// Which opening earns the best chance of a reply for THIS customer. An owner
// with equity gets the trade-up angle, a paid-off car gets the cash angle, a
// maturing lease gets the deadline, and a genuine inbound enquiry gets the
// inbound note. Anything else falls through to first contact.
export function recommendTemplate(lead) {
  if (!lead) return "tpl_first";
  const days = lead.leaseEnd ? Math.round((new Date(lead.leaseEnd) - Date.now()) / 86400000) : null;
  if (days != null && !isNaN(days) && days <= 120) return "tpl_leaseend";
  const owner = !!lead.vehicleInterest && (lead.stage === "delivered" || lead.currentValue != null || lead.payoff != null || lead.purchaseDate);
  if (!owner) return "tpl_first";
  const paidOff = lead.currentPayment == null && (lead.payoff == null || Number(lead.payoff) === 0);
  return paidOff ? "tpl_paidoff" : "tpl_equity";
}

// Open the template picker for a given lead.
export function openTemplatePicker(lead) {
  const templates = allTemplates();
  openModal("Send a message", (close) => {
    const wrap = document.createElement("div");
    if (!lead.phone && !lead.email) {
      wrap.innerHTML = `<div class="muted small">Add a phone number or email to this lead first.</div>`;
      return wrap;
    }
    wrap.innerHTML = `<div class="small muted" style="margin-bottom:12px">Pick a template — it'll fill in ${esc((lead.name || "the customer").split(" ")[0])}'s name, vehicle and numbers automatically.</div>`;
    // Best fit first, so the right opening is the one under your thumb.
    const pick = recommendTemplate(lead);
    const ordered = templates.slice().sort((x, y) => (y.id === pick) - (x.id === pick));
    ordered.forEach((t) => {
      const canUse = t.channel === "email" ? !!lead.email : !!lead.phone;
      const btn = document.createElement("button");
      btn.className = "btn btn-ghost btn-block";
      btn.style.cssText = "justify-content:flex-start;text-align:left;margin-bottom:10px;height:auto;padding:12px 14px";
      btn.disabled = !canUse;
      if (!canUse) btn.style.opacity = "0.45";
      btn.innerHTML = `<div style="width:100%">
        <div class="strong">${icon(t.channel === "email" ? "mail" : "message")} ${esc(t.name)}${t.id === pick ? ` <span class="badge badge-sold">best fit</span>` : ""}</div>
        <div class="small muted" style="margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(fillTemplate(t.body, lead).replace(/\n/g, " "))}</div>
      </div>`;
      if (canUse) btn.addEventListener("click", () => { close(); openComposer(t, lead); });
      wrap.appendChild(btn);
    });
    return wrap;
  });
}

// Show the filled message, editable, with send / copy actions.
function openComposer(template, lead) {
  const isEmail = template.channel === "email";
  openModal(template.name, (close) => {
    const wrap = document.createElement("div");
    const filledBody = fillTemplate(template.body, lead);
    const filledSubject = fillTemplate(template.subject, lead);

    wrap.innerHTML = `
      ${isEmail ? `<div class="field"><label>Subject</label><input id="m-subject" value="${esc(filledSubject)}"></div>` : ""}
      <div class="field">
        <label>Message ${isEmail ? "" : "to " + esc((lead.name || "").split(" ")[0])}</label>
        <textarea id="m-body" style="min-height:150px">${esc(filledBody)}</textarea>
      </div>
      <div class="btn-row">
        <a id="m-send" class="btn btn-primary btn-block" href="#">${isEmail ? `${icon("mail")} Open in Mail` : `${icon("message")} Open in Messages`}</a>
        <button id="m-copy" class="btn btn-ghost btn-block">${icon("file")} Copy</button>
      </div>
      <div class="hint" style="margin-top:10px">Opens your ${isEmail ? "email app" : "Messages app"} with this ready to send — you can still edit before sending.</div>
    `;

    const bodyEl = wrap.querySelector("#m-body");
    const subjEl = wrap.querySelector("#m-subject");
    const sendEl = wrap.querySelector("#m-send");

    const updateHref = () => {
      const body = bodyEl.value;
      if (isEmail) {
        const subj = subjEl ? subjEl.value : "";
        sendEl.href = `mailto:${encodeURIComponent(lead.email || "")}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
      } else {
        sendEl.href = smsHref(lead.phone, body);
      }
    };
    updateHref();
    bodyEl.addEventListener("input", updateHref);
    if (subjEl) subjEl.addEventListener("input", updateHref);

    sendEl.addEventListener("click", () => {
      // Stamp last-contacted and count it as a prospecting touch.
      store.update("leads", lead.id, { lastContacted: new Date().toISOString() });
      store.logActivity("touch");
      // Emails also land in the lead's email history.
      if (isEmail) store.create("emails", {
        leadId: lead.id, direction: "out",
        subject: subjEl ? subjEl.value : "", body: bodyEl.value, via: "mail-app",
      });
      setTimeout(close, 50);
    });

    wrap.querySelector("#m-copy").addEventListener("click", async () => {
      const text = (isEmail && subjEl ? subjEl.value + "\n\n" : "") + bodyEl.value;
      try {
        await navigator.clipboard.writeText(text);
        toast("Copied to clipboard", "success");
      } catch {
        bodyEl.select();
        toast("Select and copy the text", "");
      }
    });

    return wrap;
  });
}
