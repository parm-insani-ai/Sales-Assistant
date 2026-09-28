// The manager's email — one sheet.
//
// A manager has no book on their phone, so the rep's email screens don't
// fit. This is theirs: send a real email to any customer on any rep's file
// (it goes through the function and is filed on the customer's page, marked
// as the manager's, so the rep sees it); everything sent or received across
// the store in the last month; and the manager's own Outlook, whose customer
// replies are filed into the right rep's book.

import * as store from "../store.js";
import { icon } from "../icons.js";
import { toast, openModal } from "../components.js";
import { esc, formatDateTime } from "../utils.js";
import { memberName, cachedBook, loadBook, loadMail, sendManagerEmail } from "../team.js";
import { outlookConfigured, outlookConnected, outlookAccount, connectOutlook, disconnectOutlook, lastMailPull, pullStoreMail } from "../msmail.js";

// No figures reach a customer before the sales desk.
export const figuresIn = (s) => /\$\s?\d|\d\s?%|\bapr\b|\bper month\b|\/mo\b/i.test(String(s || ""));

export const DEFAULT_MAIL = {
  subject: "Thanks for coming in to {store}",
  body: "Hi {first},\n\nIt's {manager}, the sales manager at {store}. Thanks for coming in to see {rep} — we'd love to help in any way we can. If there's anything at all, reply to this note or call me any time.\n\n{manager}\n{store}",
};
export function fillMail(tpl, { lead, rep, team }) {
  const s = store.getSettings();
  const first = String(lead.name || "there").trim().split(/\s+/)[0] || "there";
  return String(tpl || "").replace(/\{first\}/g, first).replace(/\{manager\}/g, s.salesperson || "the sales manager").replace(/\{store\}/g, team.name || s.dealership || "the store").replace(/\{rep\}/g, rep ? memberName(rep) : "us");
}

// Write to one customer. `row` is a book row: { lead, rep }.
export function openComposeSheet(team, row, { onSent } = {}) {
  const { lead, rep } = row;
  openModal(`Email ${lead.name || "customer"}`, (close) => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <div class="kv"><span class="k">To</span><span class="v">${esc(lead.email || "—")}</span></div>
        <div class="kv"><span class="k">Their rep</span><span class="v">${esc(memberName(rep))}</span></div>
      </div>
      <div class="field"><label>Subject</label><input id="ml-subject" value="${esc(fillMail(DEFAULT_MAIL.subject, { lead, rep, team }))}"></div>
      <div class="field"><label>The email</label><textarea id="ml-body" rows="8">${esc(fillMail(DEFAULT_MAIL.body, { lead, rep, team }))}</textarea><div class="hint">From you, as the manager. No figures — payments and rates wait for the sales desk.</div></div>
      <button class="btn btn-primary btn-block" data-act="send" ${lead.email ? "" : "disabled"}>${icon("send")} Send</button>
      ${lead.email ? "" : `<div class="hint">No email on file for this customer.</div>`}
      <div class="hint">It sends through the store's email set-up (Settings → Email) and is filed on ${esc(lead.name || "the customer")}'s page for ${esc(memberName(rep))} too, marked as yours.</div>`;
    root.querySelector('[data-act="send"]').addEventListener("click", async (e) => {
      const subject = root.querySelector("#ml-subject").value.trim(), text = root.querySelector("#ml-body").value.trim();
      if (!subject || !text) { toast("Subject and a message, please", "warn"); return; }
      if (figuresIn(subject) || figuresIn(text)) { toast("No figures in an email to a customer — take out the amount or rate", "warn"); return; }
      e.target.disabled = true;
      try { await sendManagerEmail(rep.user_id, lead.id, { subject, text }); toast(`Sent to ${lead.name || "the customer"}`, "success"); if (onSent) onSent({ subject, text }); close(); }
      catch (err) { toast(err.message || "Couldn't send", "danger"); e.target.disabled = false; }
    });
    return root;
  });
}

export async function openMailSheet(team) {
  let book = cachedBook();
  let mail = null;
  let q = "";
  openModal("Email", () => {
    const root = document.createElement("div");
    function draw() {
      const s = store.getSettings();
      const rows = book && q.trim() ? book.rows.filter((r) => [r.lead.name, r.lead.email, r.lead.vehicleInterest].join(" ").toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
      root.innerHTML = `
        <div class="section-title">Write to a customer</div>
        <div class="searchbar"><input type="search" id="ml-q" placeholder="Customer's name, on any rep's book…" value="${esc(q)}"></div>
        ${q.trim() ? `<div class="card" style="padding:4px 0;margin-bottom:12px">${rows.length ? rows.map((r, i) => `<div class="row" data-pick="${i}" style="padding:8px 16px;cursor:pointer;align-items:center"><div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(r.lead.name || "Customer")}</div><div class="row-sub">${esc(r.lead.email || "no email on file")} · ${esc(memberName(r.rep))}</div></div><span class="muted">›</span></div>`).join("") : `<div class="muted small" style="padding:8px 16px">${book ? "Nobody matches." : "Reading the book…"}</div>`}</div>` : ""}
        <div class="section-title">Your Outlook <span class="muted" style="font-weight:500;font-size:0.78rem">· customer replies land on the right rep's file</span></div>
        <div class="card" style="margin-bottom:12px">
          ${outlookConnected() ? `
            <div class="small">${icon("checkline")} Connected as <b>${esc((outlookAccount() || {}).email || "your account")}</b>${lastMailPull() ? ` <span class="muted">· last checked ${esc(formatDateTime(lastMailPull()))}</span>` : ""}</div>
            <div class="btn-row" style="margin-top:8px"><button class="btn btn-ghost btn-sm" data-act="pull">Check mail now</button><button class="btn btn-ghost btn-sm" data-act="disconnect">Disconnect</button></div>
            <div class="hint">Mail from a customer on any rep's book is filed on that customer's page, for the rep to see. Everything else is ignored and never stored.</div>`
          : `
            <div class="small muted">Sign in once and viniva reads your inbox on this phone — a reply from a customer on any rep's book is filed on that customer's page. Nothing else is kept.</div>
            ${outlookConfigured() ? "" : `<div class="field" style="margin-top:8px"><label>Application (client) ID <span class="muted">· from the Entra app registration, see the README</span></label><input id="ml-client" value="${esc(s.msClientId || "")}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>`}
            <button class="btn btn-primary btn-sm" data-act="connect" style="margin-top:8px">Connect Outlook</button>`}
        </div>
        <div class="section-title">Across the store <span class="muted" style="font-weight:500;font-size:0.78rem">· last 30 days</span></div>
        <div class="card">${mail ? (mail.length ? mail.slice(0, 40).map((e) => `<div style="padding:6px 0;border-bottom:1px solid var(--border)"><div class="small muted">${e.direction === "in" ? "↓ " + esc(e.customer) : "↑ " + esc(e.customer)} · ${esc(memberName(e.rep))}${e.via === "manager" ? " · <b>you</b>" : e.via === "manager-welcome" ? " · your welcome" : e.via === "auto" ? " · automatic" : e.via === "outlook" ? " · Outlook" : ""} · ${esc(formatDateTime(e.receivedAt || e.createdAt))}</div><div class="small">${esc(e.subject || "(no subject)")}</div></div>`).join("") : `<div class="muted small">No emails across the store in the last month.</div>`) : `<div class="muted small">Reading…</div>`}</div>
        <div class="hint">Sending needs the store's email set-up on the function (Resend, see Settings → Email); the rep's own emails and automatic follow-ups are theirs and show here too.</div>`;
      const on = (sel, fn) => { const n = root.querySelector(sel); if (n) n.addEventListener("click", fn); };
      const qi = root.querySelector("#ml-q");
      qi.addEventListener("input", (e) => { q = e.target.value; const at = e.target.selectionStart; draw(); const n = root.querySelector("#ml-q"); n.focus(); try { n.setSelectionRange(at, at); } catch { /* fine */ } });
      root.querySelectorAll("[data-pick]").forEach((n) => n.addEventListener("click", () => openComposeSheet(team, rows[Number(n.dataset.pick)], { onSent: () => { mail = null; draw(); loadMail(team).then((m) => { mail = m; draw(); }).catch(() => { mail = []; draw(); }); } })));
      on('[data-act="connect"]', async () => {
        const ci = root.querySelector("#ml-client");
        if (ci) store.updateSettings({ msClientId: ci.value.trim() });
        try { await connectOutlook(); } catch (e) { toast(e.message || "Couldn't start the sign-in", "danger"); }
      });
      on('[data-act="disconnect"]', () => { disconnectOutlook(); draw(); });
      on('[data-act="pull"]', async (e) => {
        e.target.disabled = true;
        try { const r = await pullStoreMail(team); toast(r.linked ? `${r.linked} customer email${r.linked === 1 ? "" : "s"} filed` : `Checked ${r.checked} — nothing from a customer`, "success"); mail = await loadMail(team); }
        catch (err) { toast(err.message || "Couldn't check mail", "danger"); }
        draw();
      });
    }
    draw();
    (async () => {
      try { book = await loadBook(team); } catch { /* the list says so */ }
      try { mail = await loadMail(team); } catch { mail = []; }
      draw();
    })();
    return root;
  });
}
