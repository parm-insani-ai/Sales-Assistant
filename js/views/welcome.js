// The manager's welcome text — the sheet that runs it.
//
// Switch it on, put your name in, read the words, see who's due and who's
// been welcomed. The sending happens on the function's ten-minute sweep,
// by the rules in welcome.js: an hour or two after the rep logs the
// customer (a different delay per customer), never within half an hour of
// the rep's own text, only in the store's day, once. Send now sends one
// straight away, for a customer who just left.

import * as store from "../store.js";
import { toast, openModal } from "../components.js";
import { esc, formatDateTime } from "../utils.js";
import { memberName, cachedBook, loadBook, cachedConfig, loadConfig, saveConfig, sendWelcomeNow, welcomeLog } from "../team.js";
import { DEFAULT_WELCOME, welcomeDue, welcomeText } from "../welcome.js";

const tzNow = () => new Date().getTimezoneOffset(); // minutes behind UTC, e.g. 180 for ADT

export async function openWelcomeSheet(team) {
  let cfg = { ...DEFAULT_WELCOME, ...((cachedConfig() || {}).welcome || {}) };
  let book = cachedBook();
  let log = null;
  openModal("Manager's welcome text", (close) => {
    const root = document.createElement("div");
    const s = store.getSettings();
    function draw() {
      const sample = { id: "sample", name: "Dana Muise", phone: "1", stage: "new", createdAt: new Date().toISOString() };
      const preview = welcomeText(sample, { manager: cfg.manager || s.salesperson || "", store: team.name, rep: "Parm" }, cfg.template);
      const now = Date.now();
      const rows = book ? book.rows.filter((r) => ["new", "working", "appointment"].includes(r.lead.stage) && !r.lead.purchaseDate && r.lead.createdAt && now - new Date(r.lead.createdAt) < 3 * 86400000) : [];
      const state = rows.map((r) => ({ ...r, d: welcomeDue(r.lead, [], { ...cfg, enabled: true, tzOffsetMinutes: tzNow() }, now) }))
        .filter((x) => !/came in by text|owner on file|no phone|opted out|not a fresh enquiry/.test(x.d.why));
      const due = state.filter((x) => x.d.due), waiting = state.filter((x) => !x.d.due && x.d.inMinutes), done = state.filter((x) => x.lead.managerWelcomeAt);
      root.innerHTML = `
        <label class="switch" style="margin-bottom:12px"><input type="checkbox" id="wl-on" ${cfg.enabled ? "checked" : ""}><span><b>Send the welcome automatically</b></span></label>
        <div class="field"><label>Your name, as the customer reads it</label><input id="wl-name" value="${esc(cfg.manager || "")}" placeholder="${esc(s.salesperson || "Sam")}"></div>
        <div class="field"><label>The text</label><textarea id="wl-template" rows="4">${esc(cfg.template)}</textarea><div class="hint">{first} their first name · {manager} you · {store} the store · {rep} the rep who logged them. No figures, no offers — this is a hello.</div></div>
        <div class="card small" style="white-space:pre-wrap;line-height:1.45;background:var(--surface-2);margin-bottom:12px">${esc(preview)}</div>
        <div class="field"><label>Timing</label>
          <div class="small muted">Goes out ${cfg.minMinutes}–${cfg.maxMinutes} minutes after the rep logs the customer — a different delay for each — between ${cfg.hourFrom}:00 and ${cfg.hourTo}:00, never within ${cfg.gapMinutes} minutes of the rep's own text, never while they're texting the rep, and once only. Customers created from an inbound text, owners on file, and anyone opted out are skipped.</div>
          <div class="row" style="gap:8px;margin-top:8px"><input id="wl-min" type="number" inputmode="numeric" value="${cfg.minMinutes}" style="flex:1"><span class="muted small">to</span><input id="wl-max" type="number" inputmode="numeric" value="${cfg.maxMinutes}" style="flex:1"><span class="muted small">min after</span></div>
          <div class="row" style="gap:8px;margin-top:8px"><input id="wl-from" type="number" inputmode="numeric" value="${cfg.hourFrom}" style="flex:1"><span class="muted small">to</span><input id="wl-to" type="number" inputmode="numeric" value="${cfg.hourTo}" style="flex:1"><span class="muted small">o'clock</span></div>
        </div>
        <button class="btn btn-primary btn-block" data-act="save">Save</button>
        <div class="section-title">Right now <span class="muted" style="font-weight:500;font-size:0.78rem">· customers logged in the last 3 days</span></div>
        <div class="card">
          ${book ? (state.length ? state.slice(0, 20).map((x) => `<div class="row" style="padding:6px 0;align-items:center"><div class="row-main"><div class="small strong">${esc(x.lead.name || "Customer")}</div><div class="small muted">${esc(memberName(x.rep))} · ${x.lead.managerWelcomeAt ? "welcomed " + esc(formatDateTime(x.lead.managerWelcomeAt)) : x.d.due ? (cfg.enabled ? "due — goes on the next sweep" : "would be due") : esc(x.d.why)}</div></div>${x.lead.managerWelcomeAt || !x.lead.phone ? "" : `<button class="btn btn-ghost btn-sm" data-send="${esc(x.lead.id)}" data-rep="${esc(x.rep.user_id)}">Send now</button>`}</div>`).join("") : `<div class="muted small">Nobody logged in the last three days.</div>`) : `<div class="muted small">Reading the book…</div>`}
          ${book && state.length > 20 ? `<div class="hint">${state.length} in all — ${due.length} due, ${waiting.length} waiting, ${done.length} welcomed.</div>` : ""}
        </div>
        <div class="section-title">Sent <span class="muted" style="font-weight:500;font-size:0.78rem">· last 30 days</span></div>
        <div class="card">${log ? (log.length ? log.slice(0, 30).map((t) => `<div style="padding:6px 0;border-bottom:1px solid var(--border)"><div class="small muted">${esc(formatDateTime(t.at))} · ${esc(memberName(t.rep))}'s customer</div><div class="small" style="white-space:pre-wrap">${esc(t.body)}</div></div>`).join("") : `<div class="muted small">None sent yet.</div>`) : `<div class="muted small">Reading…</div>`}</div>
        <div class="hint">Replies land wherever the store's texting number is pointed — the rep's inbox when the number is theirs. The text shows in the rep's conversation with the customer, marked as yours.</div>`;
      root.querySelector('[data-act="save"]').addEventListener("click", async () => {
        const next = { ...cfg, enabled: root.querySelector("#wl-on").checked, manager: root.querySelector("#wl-name").value.trim(), template: root.querySelector("#wl-template").value.trim() || DEFAULT_WELCOME.template,
          minMinutes: Number(root.querySelector("#wl-min").value) || 45, maxMinutes: Number(root.querySelector("#wl-max").value) || 150, hourFrom: Number(root.querySelector("#wl-from").value) || 9, hourTo: Number(root.querySelector("#wl-to").value) || 20, tzOffsetMinutes: tzNow() };
        if (next.enabled && !next.manager) { toast("Put your name in first", "warn"); return; }
        try { const data = await saveConfig(team, { welcome: next }); cfg = { ...DEFAULT_WELCOME, ...(data.welcome || {}) }; toast(cfg.enabled ? "On — welcomes go out on the sweep" : "Saved, switched off", "success"); draw(); }
        catch (e) { toast(e.message || "Couldn't save", "danger"); }
      });
      root.querySelector("#wl-template").addEventListener("input", (e) => { cfg = { ...cfg, template: e.target.value }; const p = root.querySelector(".card.small"); if (p) p.textContent = welcomeText(sample, { manager: root.querySelector("#wl-name").value.trim() || s.salesperson || "", store: team.name, rep: "Parm" }, cfg.template); });
      root.querySelector("#wl-name").addEventListener("input", (e) => { const p = root.querySelector(".card.small"); if (p) p.textContent = welcomeText(sample, { manager: e.target.value.trim() || s.salesperson || "", store: team.name, rep: "Parm" }, root.querySelector("#wl-template").value); });
      root.querySelectorAll("[data-send]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        try { const r = await sendWelcomeNow(b.dataset.rep, b.dataset.send); toast("Sent", "success"); const row = book.rows.find((x) => x.lead.id === b.dataset.send && x.rep.user_id === b.dataset.rep); if (row) row.lead.managerWelcomeAt = new Date().toISOString(); log = [{ at: new Date().toISOString(), body: r.body, rep: row ? row.rep : {} }, ...(log || [])]; draw(); }
        catch (e) { toast(e.message || "Couldn't send", "danger"); b.disabled = false; }
      }));
    }
    draw();
    (async () => {
      try { const data = await loadConfig(team); cfg = { ...DEFAULT_WELCOME, ...(data.welcome || {}) }; } catch { /* defaults */ }
      try { book = await loadBook(team); } catch { /* the card says so */ }
      draw();
      try { log = await welcomeLog(team); } catch { log = []; }
      draw();
    })();
    return root;
  });
}
