// Mass outreach — the screen where a blast is reviewed and sent.
//
// It opens from a sentence (spoken to the assistant, typed here, or picked
// from the examples) and shows: who it's going to and who it isn't and why,
// the message each person gets in their own name, and one button that sends
// them one after another from your number. Figures never leave: a dollar
// amount or a rate in the message blocks the send until it's out.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { toast, confirmDialog } from "../components.js";
import { esc, smsHref, mailtoHref } from "../utils.js";
import { sendText, smsReady } from "../sms.js";
import { sendEmail, emailSendConfigured, logEmail } from "../email.js";
import { parseOutreach, audienceFor, draftFor, figuresIn, describeAudience, toSecondPerson } from "../outreach.js";

const PREFILL = "outreach-prefill";

// A sentence handed over by the assistant or the voice parser lands here;
// the screen opens on it.
export function queueOutreach(sentence) {
  try { sessionStorage.setItem(PREFILL, String(sentence || "")); } catch { /* the screen still opens */ }
  navigate("/outreach");
}

const EXAMPLES = [
  "Text everyone who owns a Sentra that this month, if they trade in their Sentra for a new Nissan, they get double loyalty",
  "Email all my Rogue owners from 2018 to 2021 that we're paying top dollar for Rogues this week",
  "Text everyone with a paid off Nissan that the new lineup is in and their trade has never been worth more",
  "Text everyone whose lease is ending that I can walk them through their three options in ten minutes",
];

export function renderOutreach(view) {
  let sentence = "";
  try { sentence = sessionStorage.getItem(PREFILL) || ""; sessionStorage.removeItem(PREFILL); } catch { sentence = ""; }
  let spec = sentence ? parseOutreach(sentence) : null;
  let channel = spec ? spec.channel : "text";
  let message = spec ? spec.message : "";
  let includeRecent = false;
  const skipped = new Set();
  let sending = false;
  const results = { sent: 0, failed: 0 };

  const el = document.createElement("div");
  view.appendChild(el);

  function draw() {
    const s = store.getSettings();
    const leads = store.all("leads");
    const live = spec ? { ...spec, channel, message } : null;
    const aud = live ? audienceFor(live, leads, { channel, includeRecent }) : { included: [], excluded: [] };
    const recipients = aud.included.filter((l) => !skipped.has(l.id));
    const figures = figuresIn(message);
    const ready = channel === "text" ? smsReady() : emailSendConfigured();
    el.innerHTML = `
      <div class="card" style="margin-top:2px">
        <div class="field" style="margin-bottom:8px">
          <label>Who, and what to tell them</label>
          <textarea id="mo-sentence" rows="3" placeholder="Text everyone who owns a Sentra that this month, if they trade it in for a new Nissan, they get double loyalty">${esc(sentence)}</textarea>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary btn-sm" data-act="build" style="flex:1">${icon("sparkles")} Build the blast</button>
          <button class="btn btn-ghost btn-sm" data-act="examples" style="flex:0 0 auto">Examples</button>
        </div>
        <div class="mo-examples" hidden style="margin-top:8px">
          ${EXAMPLES.map((x, i) => `<button class="btn btn-ghost btn-sm btn-block" data-example="${i}" style="text-align:left;white-space:normal;margin-top:6px">${esc(x)}</button>`).join("")}
        </div>
      </div>
      ${!spec ? `<div class="fab-note" style="margin:0 2px">Say it to the assistant, or type it here. The app works out who's in the audience from what they drive and where they stand, writes each message in their name, and you send.</div>` : `
      <div class="section-title">To <span class="muted" style="font-weight:500;font-size:0.78rem">· ${esc(describeAudience(live))}</span></div>
      <div class="card">
        <div class="seg" role="group" aria-label="Channel" style="margin-bottom:10px">
          <button class="seg-btn ${channel === "text" ? "active" : ""}" data-channel="text">${icon("message")} Text</button>
          <button class="seg-btn ${channel === "email" ? "active" : ""}" data-channel="email">${icon("mail")} Email</button>
        </div>
        <div class="row" style="margin-bottom:6px"><span class="strong">${recipients.length} ${channel === "text" ? "will be texted" : "will be emailed"}</span><span class="small muted">${aud.excluded.length ? aud.excluded.length + " left out" : ""}</span></div>
        <div class="mo-list">
          ${recipients.length ? recipients.map((l) => `
            <div class="row mo-row" data-lead="${esc(l.id)}">
              <div class="row-main" style="min-width:0"><div class="row-title" style="font-size:0.95rem">${esc(l.name)}</div><div class="row-sub">${esc(l.vehicleInterest || "")}${channel === "text" && l.phone ? " · " + esc(l.phone) : channel === "email" && l.email ? " · " + esc(l.email) : ""}</div></div>
              <button class="modal-close" data-skip="${esc(l.id)}" aria-label="Leave out" title="Leave out">&times;</button>
            </div>`).join("") : `<div class="muted small">Nobody in this audience can be reached by ${channel} right now.</div>`}
        </div>
        ${aud.excluded.length || skipped.size ? `
        <details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">Left out (${aud.excluded.length + skipped.size})</summary>
          <div style="margin-top:6px">
            ${[...skipped].map((id) => { const l = store.get("leads", id); return l ? `<div class="row" style="padding:4px 0"><span class="small">${esc(l.name)}</span><button class="btn btn-ghost btn-sm" data-unskip="${esc(id)}">Put back</button></div>` : ""; }).join("")}
            ${aud.excluded.map((x) => `<div class="row" style="padding:4px 0"><span class="small">${esc(x.lead.name)}</span><span class="small muted">${esc(x.why)}</span></div>`).join("")}
          </div>
          ${aud.excluded.some((x) => /reached/.test(x.why)) && !includeRecent ? `<button class="btn btn-ghost btn-sm btn-block" data-act="include-recent" style="margin-top:8px">Include the ones reached recently</button>` : ""}
        </details>` : ""}
      </div>

      <div class="section-title">The message <span class="muted" style="font-weight:500;font-size:0.78rem">· in your words, written to each of them</span></div>
      <div class="card">
        <div class="field" style="margin-bottom:8px">
          <label>What to tell them</label>
          <textarea id="mo-message" rows="3">${esc(message)}</textarea>
          <div class="hint">"They" becomes "you" in each message. No dollar amounts or rates — those stay for the desk.</div>
        </div>
        ${figures.length ? `<div class="fab-note" style="text-align:left;color:var(--danger)">Take the figure${figures.length > 1 ? "s" : ""} out before sending: ${figures.map(esc).join(", ")}.</div>` : ""}
        ${recipients[0] ? `<div class="small muted" style="margin-bottom:4px">How ${esc(recipients[0].name.split(" ")[0])} will get it:</div>
        <div class="mo-preview small" style="white-space:pre-wrap;line-height:1.45;background:var(--surface-2);border-radius:10px;padding:10px">${(() => { const d = draftFor(recipients[0], live, s); return esc(channel === "email" ? "Subject: " + d.subject + "\n\n" + d.body : d.body); })()}</div>` : ""}
      </div>

      <div class="card">
        ${!ready ? `<div class="fab-note" style="text-align:left;margin-bottom:8px">${channel === "text" ? "No texting number set up — each text hands off to your phone's Messages app one at a time." : "Email sending isn't set up (Settings → Voice agent) — each email hands off to your mail app one at a time."}</div>` : ""}
        <button class="btn btn-primary btn-block" data-act="send" ${!recipients.length || figures.length || sending ? "disabled" : ""}>${icon(channel === "text" ? "message" : "mail")} ${sending ? "Sending…" : `Send to ${recipients.length}`}</button>
        <div class="mo-progress small muted" style="margin-top:8px;text-align:center"></div>
        <div class="fab-note" style="margin-top:8px">Sent one after another from your own number. Each one is logged on the customer and counts as a contact.</div>
      </div>`}
    `;

    el.querySelector('[data-act="build"]').addEventListener("click", () => {
      sentence = el.querySelector("#mo-sentence").value.trim();
      if (!sentence) { toast("Say who, and what to tell them", "warn"); return; }
      spec = parseOutreach(sentence); channel = spec.channel; message = spec.message; skipped.clear();
      if (!spec.message) toast("Add what to tell them — after \"that\" or a colon", "warn");
      draw();
    });
    el.querySelector('[data-act="examples"]').addEventListener("click", () => { const x = el.querySelector(".mo-examples"); x.hidden = !x.hidden; });
    el.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => { sentence = EXAMPLES[Number(b.dataset.example)]; spec = parseOutreach(sentence); channel = spec.channel; message = spec.message; skipped.clear(); draw(); }));
    if (!spec) return;
    el.querySelectorAll("[data-channel]").forEach((b) => b.addEventListener("click", () => { channel = b.dataset.channel; draw(); }));
    el.querySelectorAll("[data-skip]").forEach((b) => b.addEventListener("click", () => { skipped.add(b.dataset.skip); draw(); }));
    el.querySelectorAll("[data-unskip]").forEach((b) => b.addEventListener("click", () => { skipped.delete(b.dataset.unskip); draw(); }));
    const inc = el.querySelector('[data-act="include-recent"]');
    if (inc) inc.addEventListener("click", () => { includeRecent = true; draw(); });
    el.querySelectorAll(".mo-row .row-main").forEach((n) => n.addEventListener("click", () => navigate(`/leads/${n.closest(".mo-row").dataset.lead}`)));
    const msgEl = el.querySelector("#mo-message");
    let t = null;
    msgEl.addEventListener("input", () => { message = msgEl.value; clearTimeout(t); t = setTimeout(() => { const y = view.scrollTop; draw(); view.scrollTop = y; const m2 = el.querySelector("#mo-message"); m2.focus(); m2.setSelectionRange(m2.value.length, m2.value.length); }, 400); });
    el.querySelector('[data-act="send"]').addEventListener("click", () => send(recipients, live));
  }

  async function send(recipients, live) {
    const s = store.getSettings();
    if (!(await confirmDialog(`${channel === "text" ? "Text" : "Email"} ${recipients.length} ${recipients.length === 1 ? "person" : "people"} now?`))) return;
    sending = true; draw();
    const prog = el.querySelector(".mo-progress");
    const ready = channel === "text" ? smsReady() : emailSendConfigured();
    const now = new Date().toISOString();
    const blast = store.create("blasts", { channel, sentence, audience: describeAudience(live), message, offer: toSecondPerson(message), recipients: recipients.map((l) => l.id), sent: [], failed: [], startedAt: now });
    let i = 0;
    for (const l of recipients) {
      i++;
      if (prog) prog.textContent = `Sending ${i} of ${recipients.length} — ${l.name}…`;
      const d = draftFor(l, live, s);
      let ok = false, err = "";
      try {
        if (channel === "text") {
          if (ready) { const r = await sendText(l, d.body); ok = !!r.ok; err = r.error || ""; }
          else { window.open(smsHref(l.phone, d.body), "_blank"); ok = true; }
        } else {
          if (ready) { await sendEmail({ to: l.email, subject: d.subject, text: d.body }); ok = true; }
          else { window.open(mailtoHref(l.email, d.subject, d.body), "_blank"); ok = true; }
          if (ok) logEmail(l.id, { direction: "out", subject: d.subject, body: d.body, via: ready ? "blast" : "mail-app" });
        }
      } catch (e) { ok = false; err = e && e.message ? e.message : "send failed"; }
      if (ok) {
        results.sent++;
        store.update("leads", l.id, { lastCampaignAt: now, lastContacted: new Date().toISOString(), lastContactVia: channel, stage: l.stage === "delivered" ? "working" : l.stage });
        store.logActivity("touch");
        const b = store.get("blasts", blast.id); store.update("blasts", blast.id, { sent: [...(b.sent || []), l.id] });
      } else {
        results.failed++;
        const b = store.get("blasts", blast.id); store.update("blasts", blast.id, { failed: [...(b.failed || []), { id: l.id, error: err }] });
      }
      // A breath between sends, so the number doesn't read as a machine.
      if (ready && i < recipients.length) await new Promise((r) => setTimeout(r, 600));
    }
    store.update("blasts", blast.id, { finishedAt: new Date().toISOString() });
    sending = false;
    toast(`${results.sent} sent${results.failed ? `, ${results.failed} failed` : ""}`, results.failed ? "warn" : "success");
    draw();
    const done = el.querySelector(".mo-progress");
    if (done) done.textContent = `${results.sent} sent${results.failed ? `, ${results.failed} failed` : ""}. Replies land in Comms.`;
  }

  draw();
}
