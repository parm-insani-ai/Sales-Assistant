// Text / email templates. Fill placeholders from a lead and open the phone's
// Messages or Mail composer, or copy to clipboard.

import * as store from "../store.js";
import { openModal, toast } from "../components.js";
import { esc, smsHref } from "../utils.js";

// Replace {placeholders} using the lead + settings.
export function fillTemplate(text, lead) {
  const s = store.getSettings();
  const name = (lead && lead.name) || "there";
  const firstName = String(name).trim().split(/\s+/)[0] || "there";
  const map = {
    name,
    firstName,
    vehicle: (lead && lead.vehicleInterest) || "vehicle",
    salesperson: s.salesperson || "your salesperson",
    dealership: s.dealership || "the dealership",
  };
  return String(text || "").replace(/\{(\w+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : m);
}

// Open the template picker for a given lead.
export function openTemplatePicker(lead) {
  const templates = store.getSettings().messageTemplates || [];
  openModal("Send a message", (close) => {
    const wrap = document.createElement("div");
    if (!lead.phone && !lead.email) {
      wrap.innerHTML = `<div class="muted small">Add a phone number or email to this lead first.</div>`;
      return wrap;
    }
    wrap.innerHTML = `<div class="small muted" style="margin-bottom:12px">Pick a template — it'll fill in ${esc((lead.name || "the customer").split(" ")[0])}'s name and vehicle automatically.</div>`;
    templates.forEach((t) => {
      const canUse = t.channel === "email" ? !!lead.email : !!lead.phone;
      const btn = document.createElement("button");
      btn.className = "btn btn-ghost btn-block";
      btn.style.cssText = "justify-content:flex-start;text-align:left;margin-bottom:10px;height:auto;padding:12px 14px";
      btn.disabled = !canUse;
      if (!canUse) btn.style.opacity = "0.45";
      btn.innerHTML = `<div style="width:100%">
        <div class="strong">${t.channel === "email" ? "✉️" : "💬"} ${esc(t.name)}</div>
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
        <a id="m-send" class="btn btn-primary btn-block" href="#">${isEmail ? "✉️ Open in Mail" : "💬 Open in Messages"}</a>
        <button id="m-copy" class="btn btn-ghost btn-block">📋 Copy</button>
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
      // Log the touch as a note timestamp on the lead (lightweight activity).
      store.update("leads", lead.id, { lastContacted: new Date().toISOString() });
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
