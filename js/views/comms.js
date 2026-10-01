// Comms — the inbox.
//
// One list of conversations, one row per customer, newest and unanswered
// first. Two tabs, because texts and email are answered in different postures:
// a text is a two-minute reply, an email is a sit-down.
//
// What used to be here — outreach due, appointment confirmations, occasions —
// is the Home queue's job. Those are things to go and do; this is things people
// have said to you. Keeping both on one screen was what made Comms, Leads and
// the old Deal Radar blur into each other.
//
// Link opens live in the conversation rather than in a feed of their own. "Ann
// opened the booking page twice this afternoon" is a fact about the
// conversation with Ann; anywhere else and you're reading two lists and
// joining them by hand.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { openModal, buildForm, toast } from "../components.js";
import { icon } from "../icons.js";
import { esc, formatDate, mailtoHref, initials } from "../utils.js";
import { openTemplatePicker } from "./messages.js";
import { emailSendConfigured, lastAutoEmailError } from "../email.js";
import { inboxThreads, smsReady, smsBlocker, linkIsHot } from "../sms.js";
import { mailboxProvider, mailboxAccount, mailboxMessages, mailboxCheckedAt, loadMailbox, refreshMailbox, mailboxStale, messageBody, messageContent, attachmentBlob, replyToMessage, composeEmail, customerFor, markRead, messageLink, mailAppLink, parseAddress } from "../mailbox.js";
import { draftEmail } from "../maildraft.js";
import { onPull } from "../pulltorefresh.js";
import { openLeadForm } from "./leads.js";
import { formatDateTime } from "../utils.js";

const TAB_KEY = "comms-tab"; // survives navigating into a thread and back

// A customer without a phone or email: collect it on the spot, then go
// straight into picking a message — no detour through the lead page.
function addContactThenMessage(lead) {
  openModal(`Reach ${String(lead.name || "them").split(" ")[0]}`, (close) => {
    const { element } = buildForm(
      [
        { name: "phone", label: "Phone", value: lead.phone || "", type: "tel", inputmode: "tel", placeholder: "(902) 555-1234" },
        { name: "email", label: "Email", value: lead.email || "", type: "email", placeholder: "name@email.com" },
      ],
      {
        submitLabel: "Save & choose message",
        onSubmit: (data) => {
          store.update("leads", lead.id, { phone: (data.phone || "").trim(), email: (data.email || "").trim() });
          close();
          const updated = store.get("leads", lead.id);
          if (updated.phone || updated.email) openTemplatePicker(updated);
          else toast("Add a phone or email to message them", "");
        },
      }
    );
    return element;
  });
}

function when(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return "";
  const today = new Date().toISOString().slice(0, 10);
  const clock = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return t.toISOString().slice(0, 10) === today ? clock : formatDate(iso);
}

// A steady colour per sender, the way the mail apps colour their avatars.
function avatarColor(key) {
  let h = 0;
  for (const c of String(key || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 40% 46%)`;
}

// The text as a mail app shows it: links tappable, and the quoted history
// of the thread ("On … wrote:", "> …", Outlook's "From: / Sent:") folded
// behind three dots so what's new is what you read.
function mailHtml(text) {
  const t = String(text || "").replace(/\r\n/g, "\n");
  const { fresh, quoted } = splitQuoted(t);
  let html = linkify(fresh);
  if (quoted) html += `<button class="mail-quote-btn" type="button" aria-label="Show quoted text">•••</button><div class="mail-quote">${linkify(quoted)}</div>`;
  return html;
}
function splitQuoted(t) {
  const lines = t.split("\n");
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim(), next = (lines[i + 1] || "").trim();
    if ((/^On .{4,}/.test(l) && (/wrote:$/.test(l) || /wrote:$/.test(next))) ||
        /^-{2,}\s*Original Message\s*-{2,}$/i.test(l) || /^_{5,}$/.test(l) ||
        (/^From: .+/.test(l) && /^(Sent|Date): /.test(next)) || l.startsWith(">")) { cut = i; break; }
  }
  if (cut <= 0) return { fresh: t.trim(), quoted: "" };
  return { fresh: lines.slice(0, cut).join("\n").trim(), quoted: lines.slice(cut).join("\n").trim() };
}
function linkify(text) {
  return String(text).split(/(https?:\/\/[^\s<>"']+)/g).map((p, i) => {
    if (!(i % 2)) return esc(p);
    const m = /^(.*?)([.,;:!?)]*)$/.exec(p);
    return `<a href="${esc(m[1])}" target="_blank" rel="noopener">${esc(m[1])}</a>${esc(m[2])}`;
  }).join("");
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  if (min < 1440) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / 1440)}d ago`;
}

// The one-line summary of where a conversation stands.
function preview(t) {
  const last = t.last;
  if (!last) return "";
  if (last.type === "text") {
    const body = String(last.rec.body || "").replace(/\s+/g, " ").slice(0, 68);
    return `${last.rec.dir === "out" ? "You: " : ""}${body}`;
  }
  if (last.type === "call") {
    const how = last.rec.dir === "in" ? "Called you" : last.rec.via === "text" ? "You texted" : last.rec.via === "email" ? "You emailed" : "You called";
    return `${how}${last.rec.notes ? ` · ${last.rec.notes}` : last.rec.outcome && !last.rec.logged ? ` · ${last.rec.outcome}` : ""}`;
  }
  if (last.type === "open") {
    const n = Number(last.rec.opens) || 1;
    const what = /book/i.test(last.rec.kind || "") ? "your booking page" : "the vehicle page";
    return `Opened ${what}${n > 1 ? ` ${n}×` : ""}`;
  }
  return "";
}

export function renderComms(view) {
  let tab = sessionStorage.getItem(TAB_KEY) || "messages";

  const el = document.createElement("div");
  view.appendChild(el);

  function draw() {
    sessionStorage.setItem(TAB_KEY, tab);
    // Tabs, then a compose button the size a compose button should be. A
    // full-width primary bar for "New message" took more of the screen than
    // the conversations did, and starting a fresh thread is the rarer action —
    // most of the time you're answering someone who already wrote to you.
    el.innerHTML = `
      <div class="btn-row" style="margin-bottom:6px; flex-wrap:nowrap; align-items:center">
        <button class="btn btn-sm ${tab === "messages" ? "btn-primary" : "btn-ghost"}" data-tab="messages" style="flex:1">${icon("message")} Messages</button>
        <button class="btn btn-sm ${tab === "email" ? "btn-primary" : "btn-ghost"}" data-tab="email" style="flex:1">${icon("mail")} Email</button>
        <button class="ib-round ib-more" data-act="compose"
          aria-label="${tab === "email" ? "New email" : "New message"}">${icon("plus")}</button>
      </div>
      <div id="c-body"></div>`;
    el.querySelectorAll("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => { tab = b.dataset.tab; draw(); }));
    el.querySelector('[data-act="compose"]').addEventListener("click", () =>
      (tab === "email" ? openCompose() : openPeoplePicker("text")));
    (tab === "messages" ? drawMessages : drawEmail)(el.querySelector("#c-body"));
  }

  // ---- Messages & calls ----
  function drawMessages(box) {
    const threads = inboxThreads();

    if (!smsReady()) {
      const warn = document.createElement("div");
      warn.className = "card";
      warn.style.marginBottom = "12px";
      warn.innerHTML = `<div class="row"><div class="row-main">
        <div class="row-title">${icon("message")} Replies aren't switched on</div>
        <div class="row-sub">${esc(smsBlocker())}</div>
      </div><button class="btn btn-sm btn-ghost" data-act="setup">Set up</button></div>`;
      warn.querySelector('[data-act="setup"]').addEventListener("click", () => navigate("/settings"));
      box.appendChild(warn);
    }

    if (!threads.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.innerHTML = `<div class="muted small">No conversations yet. Every text you send — and every reply — lands here.</div>`;
      box.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "conv-list";
    // A screenful now; the rest as the scroll reaches them. Four hundred
    // conversations drawn at once was the pause on the way into this screen.
    const FIRST = 25, CHUNK = 40;
    let i = 0;
    const append = (n) => { const f = document.createDocumentFragment(); threads.slice(i, i + n).forEach((t) => f.appendChild(convRow(t))); i = Math.min(threads.length, i + n); list.appendChild(f); };
    append(FIRST);
    box.appendChild(list);
    if (i < threads.length) {
      const more = document.createElement("div");
      more.className = "muted small";
      more.style.cssText = "text-align:center;padding:10px";
      const label = () => { more.textContent = i < threads.length ? `Showing ${i} of ${threads.length}` : ""; };
      label();
      box.appendChild(more);
      if (typeof IntersectionObserver === "function") {
        const w = new IntersectionObserver((entries) => { if (!entries.some((e) => e.isIntersecting)) return; append(CHUNK); label(); if (i >= threads.length) w.disconnect(); });
        w.observe(more);
      } else { more.addEventListener("click", () => { append(CHUNK); label(); }); }
    }
  }

  // One conversation, the way a messages list has always drawn one: who,
  // what they last said, when. The ordering still puts unanswered replies and
  // live link opens on top — that judgement is the point of the screen — but
  // it's expressed by position and weight rather than by a row of chips.
  function convRow(t) {
    const row = document.createElement("div");
    row.className = `conv-row${t.unread ? " conv-unread" : ""}${t.lead.smsOptOut ? " conv-row-muted" : ""}`;
    const name = t.lead.name || "Customer";
    row.innerHTML = `
      <div class="conv-av${t.hot ? " conv-av-dot" : ""}">${esc(initials(name))}</div>
      <div class="conv-main">
        <div class="conv-top">
          <span class="conv-name">${esc(name)}</span>
          <span class="conv-time">${esc(when(t.at))}</span>
        </div>
        <div class="conv-bottom">
          <span class="conv-preview">${esc(preview(t))}</span>
          ${t.lead.smsOptOut ? `<span class="conv-tag">opted out</span>` : ""}
          ${t.unread ? `<span class="conv-badge">${t.unread}</span>` : ""}
        </div>
      </div>`;
    // The dot says someone is reading a link right now, which is the one thing
    // on this screen you'd want explained. Say it, quietly, in place of the
    // preview — it IS the newest thing that happened.
    if (t.hot) {
      const p2 = row.querySelector(".conv-preview");
      p2.textContent = `Opened your link · ${timeAgo(t.lastOpenAtHot || t.at)}`;
      p2.style.color = "var(--brand-strong)";
    }
    row.addEventListener("click", () => navigate(`/inbox/${t.leadId}`));
    return row;
  }

  // ---- Email: the mailbox ----
  // With Gmail or Outlook connected this is the inbox itself — every
  // message, not just customers' — read and answered here. Without one,
  // it's what the app has logged: emails sent from here and replies filed
  // by hand.
  function drawEmail(box) {
    const provider = mailboxProvider();
    if (!provider) return drawEmailLog(box);
    box.innerHTML = `
      <div class="mail-head small muted">
        <span class="mail-acct">${icon("mail")} ${provider === "gmail" ? "Gmail" : "Outlook"} · ${esc(mailboxAccount())}</span>
        <span class="mail-when" style="margin-left:auto;flex:none"></span>
        <button class="btn btn-sm btn-ghost" data-act="mail-refresh" style="flex:none">Check</button>
      </div>
      <div class="mail-list"></div>`;
    const list = box.querySelector(".mail-list");
    const whenEl = box.querySelector(".mail-when");
    const paint = () => {
      const msgs = mailboxMessages();
      whenEl.textContent = mailboxCheckedAt() ? `checked ${timeAgo(mailboxCheckedAt())}` : "";
      list.innerHTML = "";
      if (!msgs.length) {
        list.innerHTML = `<div class="card"><div class="muted small">${mailboxCheckedAt() ? "Your inbox is empty for now." : "Checking your inbox…"}</div></div>`;
        return;
      }
      const wrap = document.createElement("div");
      wrap.className = "conv-list";
      msgs.forEach((m) => wrap.appendChild(mailRow(m)));
      list.appendChild(wrap);
    };
    const refresh = async () => {
      whenEl.textContent = "Checking…";
      try { await refreshMailbox(); } catch (e) { toast(`Mail: ${e.message || "check failed"}`, "danger"); }
      if (box.isConnected) paint();
    };
    loadMailbox().then(() => { if (!box.isConnected) return; paint(); if (mailboxStale(1)) refresh(); });
    box.querySelector('[data-act="mail-refresh"]').addEventListener("click", refresh);
    onPull(refresh);
    // The inbox checks itself (mailbox.js startMailboxWatch); every check
    // repaints this list while it's on screen.
    const onMailbox = () => { if (!box.isConnected) return window.removeEventListener("viniva-mailbox", onMailbox); paint(); };
    window.addEventListener("viniva-mailbox", onMailbox);
  }

  function mailRow(m) {
    const who = m.from.name || m.from.addr || "Unknown";
    const lead = customerFor(m.from.addr, m.from.name);
    const row = document.createElement("div");
    row.className = `conv-row${m.unread ? " conv-unread" : ""}`;
    row.innerHTML = `
      <div class="conv-av">${esc(initials(who))}</div>
      <div class="conv-main">
        <div class="conv-top">
          <span class="conv-name">${esc(who)}</span>
          <span class="conv-time">${esc(when(m.at))}</span>
        </div>
        <span class="conv-subject">${esc(m.subject || "(no subject)")}</span>
        <div class="conv-bottom">
          <span class="conv-preview">${esc(String(m.snippet || "").replace(/\s+/g, " ").slice(0, 90))}</span>
          ${lead ? `<span class="conv-tag">customer</span>` : ""}
        </div>
      </div>`;
    row.addEventListener("click", () => openMessage(m, lead));
    return row;
  }

  // One email, the way Gmail or Outlook on a phone shows one: the subject
  // up top, the sender with a coloured avatar and "to me" (tap for the full
  // addresses), the text at reading size with the thread's history folded
  // away, then Reply, Open in Gmail/Outlook, and the customer.
  function openMessage(m, lead) {
    markRead(m.id);
    const who = m.from.name || m.from.addr || "Unknown";
    const appName = m.provider === "outlook" ? "Outlook" : "Gmail";
    const link = messageLink(m);
    openModal(m.subject || "(no subject)", (close) => {
      const wrap = document.createElement("div");
      wrap.className = "mail-view";
      wrap.innerHTML = `
        <div class="mail-bar">
          <button class="mail-bar-btn" data-act="back" aria-label="Back">${icon("back")}</button>
          <span class="mail-bar-title"></span>
          ${lead ? `<button class="mail-bar-btn" data-act="open-customer" aria-label="${esc(lead.name)}" title="${esc(lead.name)}">${icon("users")}</button>` : `<button class="mail-bar-btn" data-act="add-customer" aria-label="Add as customer" title="Add as customer">${icon("plus")}</button>`}
        </div>
        <div class="mail-page">
          <h1 class="mail-subject">${esc(m.subject || "(no subject)")}${lead ? ` <span class="mail-chip">Customer</span>` : ""}</h1>
          <div class="mail-from" role="button" aria-expanded="false" title="Show details">
            <div class="conv-av mail-av" style="background:${avatarColor(m.from.addr || who)}">${esc(initials(who))}</div>
            <div class="mail-from-main">
              <div class="mail-from-name"><span>${esc(who)}</span><span class="mail-from-time">${esc(when(m.at))}</span></div>
              <div class="mail-from-sub">to ${esc(toLabel(m))} <span class="chev">▼</span></div>
            </div>
            <button class="mail-bar-btn mail-from-reply" data-act="reply" aria-label="Reply" title="Reply">${icon("reply")}</button>
          </div>
          <dl class="mail-details" hidden>
            <dt>From</dt><dd>${esc(m.from.name ? `${m.from.name} <${m.from.addr}>` : m.from.addr)}</dd>
            <dt>To</dt><dd>${esc(m.to || mailboxAccount() || "me")}</dd>
            <dt>Date</dt><dd>${esc(fullDate(m.at))}</dd>
          </dl>
          <div class="mail-body muted">Loading…</div>
          <div class="mail-atts" hidden></div>
        </div>
        <div class="mail-foot mail-actions">
          <button class="mail-pill" data-act="reply">${icon("reply")} Reply</button>
          ${link ? `<a class="mail-pill" data-act="open-in" href="${esc(link)}" target="_blank" rel="noopener">${icon("external")} Open in ${appName}</a>` : ""}
        </div>`;
      wrap.querySelector('[data-act="back"]').addEventListener("click", close);
      const from = wrap.querySelector(".mail-from"), details = wrap.querySelector(".mail-details");
      from.addEventListener("click", (e) => { if (e.target.closest("[data-act]")) return; const open = details.hidden; details.hidden = !open; from.setAttribute("aria-expanded", String(open)); });
      const body = wrap.querySelector(".mail-body");
      messageContent(m).then(async (c) => {
        body.classList.remove("muted");
        // An email with pictures or a laid-out table is shown as the HTML
        // it is; a plain one reads better as text — our type, the quoted
        // history folded, links tappable, dark mode.
        const rich = !!c.html && (/<img\b|<table\b/i.test(c.html) || !c.text);
        const cids = new Map();
        if (rich) {
          // The pictures the HTML refers to by content id are fetched first,
          // so they're in the page when it draws.
          const inline = c.attachments.filter((a) => a.cid && /^image\//.test(a.type));
          await Promise.all(inline.map(async (a) => { try { cids.set(a.cid, URL.createObjectURL(await attachmentBlob(m, a))); } catch { /* shown as a broken picture */ } }));
          renderHtml(body, c.html, cids);
        } else {
          body.innerHTML = c.text ? mailHtml(c.text) : "(no text)";
          const qb = body.querySelector(".mail-quote-btn");
          if (qb) qb.addEventListener("click", () => { body.querySelector(".mail-quote").classList.add("open"); qb.remove(); });
        }
        drawAttachments(wrap.querySelector(".mail-atts"), m, c.attachments.filter((a) => !(a.cid && cids.has(a.cid))));
      }).catch((e) => { body.textContent = `Couldn't load the message: ${e.message || e}`; });
      const oc = wrap.querySelector('[data-act="open-customer"]');
      if (oc) oc.addEventListener("click", () => { close(); navigate(`/leads/${lead.id}`); });
      const ac = wrap.querySelector('[data-act="add-customer"]');
      if (ac) ac.addEventListener("click", () => { close(); openLeadForm(null, { prefill: { name: m.from.name || "", email: m.from.addr } }); });
      wrap.querySelectorAll('[data-act="open-in"]').forEach((oi) => oi.addEventListener("click", (e) => {
        if (oi.dataset.web) return; // the app wasn't there last time — let the web link through
        const app = mailAppLink(m);
        if (!app || !app.app) return; // desktop: the anchor opens the web mailbox
        e.preventDefault();
        openMailApp(app.href, oi.classList.contains("mail-pill") ? oi : null, appName);
      }));
      // Reply is Gmail's reply: the compose page, To and Subject filled in,
      // the original quoted under the message area, sent in the thread.
      wrap.querySelectorAll('[data-act="reply"]').forEach((b) => b.addEventListener("click", () => openCompose({ replyTo: m })));
      return wrap;
    }, { focus: false, className: "modal-mail" });
  }

  // An HTML email as the mail apps show it: in a frame of its own, no
  // scripts, pictures in place (cid: ones swapped for the fetched bytes),
  // links opening outside, the quoted history folded behind three dots,
  // and the frame sized to its content so the page scrolls as one.
  function renderHtml(body, html, cids) {
    const withPics = html.replace(/(src\s*=\s*["']?)cid:([^"'\s>]+)/gi, (all, pre, cid) => cids.has(cid) ? `${pre}${cids.get(cid)}` : all);
    const style = `<style>
      html,body{margin:0;padding:0;background:#fff;color:#0f1720;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere;word-break:break-word}
      img{max-width:100%!important;height:auto!important} table{max-width:100%!important} a{color:#195438}
      body.fold .gmail_quote,body.fold blockquote[type="cite"],body.fold #divRplyFwdMsg,body.fold #divRplyFwdMsg~*,body.fold #appendonsend~*{display:none!important}
    </style><base target="_blank">`;
    body.innerHTML = `<iframe class="mail-html" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title="Email"></iframe>`;
    const f = body.querySelector("iframe");
    const size = () => { try { f.style.height = Math.max(40, f.contentDocument.documentElement.scrollHeight) + "px"; } catch { /* the frame is gone */ } };
    f.addEventListener("load", () => {
      const doc = f.contentDocument;
      doc.body.classList.add("fold");
      size();
      doc.querySelectorAll("img").forEach((im) => { im.addEventListener("load", size); im.addEventListener("error", size); });
      setTimeout(size, 400);
      if (doc.querySelector('.gmail_quote, blockquote[type="cite"], #divRplyFwdMsg, #appendonsend')) {
        const qb = document.createElement("button");
        qb.className = "mail-quote-btn"; qb.type = "button"; qb.setAttribute("aria-label", "Show quoted text"); qb.textContent = "•••";
        qb.addEventListener("click", () => { doc.body.classList.remove("fold"); qb.remove(); size(); setTimeout(size, 300); });
        body.appendChild(qb);
      }
    });
    f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${style}</head><body>${withPics}</body></html>`;
  }

  // What's attached: pictures as thumbnails that open full size, anything
  // else as a chip that opens or saves the file.
  function drawAttachments(box, m, atts) {
    if (!atts.length) return;
    box.hidden = false;
    box.innerHTML = `<div class="mail-atts-head">${icon("paperclip")} ${atts.length} attachment${atts.length > 1 ? "s" : ""}</div><div class="mail-atts-list"></div>`;
    const list = box.querySelector(".mail-atts-list");
    atts.forEach((a) => {
      const pic = /^image\//.test(a.type);
      const el = document.createElement("button");
      el.type = "button";
      el.className = `mail-att${pic ? " mail-att-pic" : ""}`;
      el.innerHTML = pic ? `<span class="mail-att-thumb">${icon("image")}</span><span class="mail-att-name">${esc(a.name)}</span>`
        : `<span class="mail-att-ico">${icon("file")}</span><span class="mail-att-main"><span class="mail-att-name">${esc(a.name)}</span><span class="mail-att-size">${fileSize(a.size)}</span></span>`;
      list.appendChild(el);
      if (pic && a.size < 8 * 1024 * 1024) {
        attachmentBlob(m, a).then((b) => { const u = URL.createObjectURL(b); el.querySelector(".mail-att-thumb").innerHTML = `<img src="${u}" alt="">`; el.dataset.url = u; }).catch(() => {});
      }
      el.addEventListener("click", async () => {
        if (pic) {
          if (!el.dataset.url) { try { el.dataset.url = URL.createObjectURL(await attachmentBlob(m, a)); } catch (e) { toast(`Couldn't open ${a.name}: ${e.message || e}`, "danger"); return; } }
          return openPhoto(el.dataset.url, a.name);
        }
        // A window opened by the tap can be pointed at the file once it's here;
        // one opened after the wait would be blocked as a popup.
        const w = window.open("", "_blank");
        try { const u = URL.createObjectURL(await attachmentBlob(m, a)); if (w) w.location = u; else location.href = u; }
        catch (e) { if (w) w.close(); toast(`Couldn't open ${a.name}: ${e.message || e}`, "danger"); }
      });
    });
  }

  // A picture full size, with a way to keep or share it.
  function openPhoto(url, name) {
    const box = document.createElement("div");
    box.className = "photo-box";
    box.innerHTML = `<div class="photo-bar"><button class="mail-bar-btn" data-act="close" aria-label="Close">${icon("back")}</button><span class="mail-bar-title">${esc(name)}</span><a class="mail-bar-btn" href="${url}" download="${esc(name)}" aria-label="Save" title="Save">${icon("download")}</a></div><div class="photo-body"><img src="${url}" alt="${esc(name)}"></div>`;
    box.querySelector('[data-act="close"]').addEventListener("click", () => box.remove());
    box.querySelector(".photo-body").addEventListener("click", () => box.remove());
    document.body.appendChild(box);
  }

  function fileSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
  }

  // Hand the message to the mail app on the phone. If the phone hasn't
  // switched away within a moment the app isn't installed: the button
  // turns into the web link, so the next tap opens Gmail/Outlook in the
  // browser (a popup after a timer would be blocked; a tap won't be).
  function openMailApp(href, btn, appName) {
    const t = setTimeout(() => {
      if (document.hidden) return;
      if (btn) { btn.dataset.web = "1"; btn.innerHTML = `${icon("external")} Open ${appName} on the web`; }
      toast(`The ${appName} app didn't open — tap again for ${appName} on the web`);
    }, 1800);
    document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(t); }, { once: true });
    location.href = href;
  }

  // "to me" when it came to the connected address, like the mail apps say.
  function toLabel(m) {
    const me = (mailboxAccount() || "").toLowerCase();
    const to = String(m.to || "");
    if (!to || (me && to.toLowerCase().includes(me))) return "me";
    const p = parseAddress(to.split(",")[0]);
    return p.name || p.addr || "me";
  }
  function fullDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  // A new email to anyone — a customer picked from the book, or any address.
  // Laid out like the mail apps' compose: From, To and Subject as hairline
  // rows, the message filling the rest of the screen, Send underneath.
  // With `replyTo`, it's a reply: To is the sender, Subject "Re: …", and the
  // original sits quoted under the message area behind three dots, as it
  // does in Gmail. The reply goes out in the same thread.
  function openCompose(prefill = {}) {
    const from = mailboxAccount();
    const re = prefill.replyTo || null;
    if (re) {
      prefill = { ...prefill, to: re.from.name ? `${re.from.name} <${re.from.addr}>` : re.from.addr, subject: /^re:/i.test(re.subject || "") ? re.subject : `Re: ${re.subject || ""}` };
    }
    openModal(re ? "Reply" : "New email", (close) => {
      const wrap = document.createElement("div");
      wrap.className = "mail-compose";
      wrap.innerHTML = `
        <div class="mail-bar">
          <button class="mail-bar-btn" data-act="back" aria-label="Back">${icon("back")}</button>
          <span class="mail-bar-title">${re ? "Reply" : "Compose"}</span>
          <button class="mail-bar-btn" data-act="draft" aria-label="Write it for me" title="Write it for me">${icon("sparkles")}</button>
          <button class="mail-bar-btn" data-act="attach" aria-label="Attach a file or photo" title="Attach a file or photo">${icon("paperclip")}</button>
          <button class="mail-bar-btn mail-bar-send" data-act="send" aria-label="Send" title="Send">${icon("send")}</button>
          <input type="file" id="mc-files" multiple hidden>
        </div>
        <div class="mail-page mc-page">
          ${from ? `<div class="mc-row"><span class="mc-label">From</span><span class="mc-from">${esc(from)}</span></div>` : ""}
          <div class="mc-row"><label class="mc-label" for="mc-to">To</label><input type="text" id="mc-to" inputmode="email" placeholder="" value="${esc(prefill.to || "")}" autocomplete="off" autocapitalize="off">${re ? "" : `<button class="mc-pick" data-act="pick" aria-label="Pick a customer" title="Pick a customer">${icon("users")}</button>`}</div>
          <div class="mc-row"><label class="mc-label" for="mc-cc">Cc</label><input type="text" id="mc-cc" inputmode="email" placeholder="" value="${esc(prefill.cc || "")}" autocomplete="off" autocapitalize="off"></div>
          <div class="mc-row"><label class="mc-label" for="mc-subject">Subject</label><input type="text" id="mc-subject" value="${esc(prefill.subject || "")}" autocomplete="off"></div>
          <div class="mc-atts" hidden></div>
          <div class="hint" id="mc-out"></div>
          <textarea id="mc-text" class="mc-body" placeholder="Compose email">${esc(prefill.text || "")}</textarea>
          ${re ? `<div class="mc-quote"><button class="mail-quote-btn" type="button" aria-label="Show quoted text">•••</button><div class="mail-quote"></div></div>` : ""}
        </div>`;
      wrap.querySelector('[data-act="back"]').addEventListener("click", close);
      if (re) setTimeout(() => wrap.querySelector("#mc-text").focus(), 80); // straight into the reply, To and Subject being set
      const out = wrap.querySelector("#mc-out");

      // Files and photos to send: picked from the phone, shown as chips
      // (pictures as thumbnails), each removable.
      const files = [];
      const attsBox = wrap.querySelector(".mc-atts"), fileIn = wrap.querySelector("#mc-files");
      const paintFiles = () => {
        attsBox.hidden = !files.length;
        attsBox.innerHTML = "";
        files.forEach((f, i) => {
          const chip = document.createElement("span");
          chip.className = "mc-att";
          const pic = /^image\//.test(f.type);
          chip.innerHTML = `${pic ? `<img class="mc-att-thumb" alt="">` : `<span class="mc-att-ico">${icon("file")}</span>`}<span class="mc-att-name">${esc(f.name)}</span><span class="mc-att-size">${fileSize(f.size)}</span><button type="button" class="mc-att-x" aria-label="Remove ${esc(f.name)}">×</button>`;
          if (pic) chip.querySelector("img").src = URL.createObjectURL(f);
          chip.querySelector(".mc-att-x").addEventListener("click", () => { files.splice(i, 1); paintFiles(); });
          attsBox.appendChild(chip);
        });
      };
      wrap.querySelector('[data-act="attach"]').addEventListener("click", () => fileIn.click());
      fileIn.addEventListener("change", () => {
        [...fileIn.files].forEach((f) => files.push(f));
        fileIn.value = "";
        const total = files.reduce((s, f) => s + f.size, 0);
        if (total > 25 * 1024 * 1024) { out.textContent = `That's ${fileSize(total)} of files — email takes about 25 MB at most`; }
        paintFiles();
      });

      // The assistant writes it, from the conversation and what's typed so
      // far; the salesperson edits and sends.
      const draftBtn = wrap.querySelector('[data-act="draft"]');
      draftBtn.addEventListener("click", async () => {
        const ta = wrap.querySelector("#mc-text"), sub = wrap.querySelector("#mc-subject");
        draftBtn.disabled = true; draftBtn.classList.add("busy"); out.textContent = "Writing…";
        const was = ta.placeholder; ta.placeholder = "Writing…";
        try {
          const d = await draftEmail({ to: wrap.querySelector("#mc-to").value, replyTo: re, subject: sub.value.trim(), notes: ta.value.trim() });
          ta.value = d.body;
          if (d.subject && !sub.value.trim()) sub.value = d.subject;
          out.textContent = "";
          toast(d.customer ? `Drafted from your conversation with ${d.customer.split(" ")[0]} — read it over` : "Drafted — read it over");
          ta.focus();
        } catch (e) { out.textContent = `✗ ${e.message || "Couldn't draft it"}`; }
        finally { draftBtn.disabled = false; draftBtn.classList.remove("busy"); ta.placeholder = was; }
      });
      const pick = wrap.querySelector('[data-act="pick"]');
      if (pick) pick.addEventListener("click", () => openPeoplePicker("email", (l) => {
        wrap.querySelector("#mc-to").value = l.email || "";
        const sub = wrap.querySelector("#mc-subject"); if (!sub.value && l.vehicleInterest) sub.value = `About the ${l.vehicleInterest}`;
      }));
      let quoted = "";
      if (re) {
        const q = wrap.querySelector(".mail-quote"), qb = wrap.querySelector(".mail-quote-btn");
        qb.addEventListener("click", () => { q.classList.add("open"); qb.remove(); });
        messageBody(re).then((t) => {
          quoted = `On ${fullDate(re.at)}, ${re.from.name || re.from.addr} <${re.from.addr}> wrote:\n${String(t || "").split("\n").map((l) => `> ${l}`).join("\n")}`;
          q.textContent = quoted;
        }).catch(() => { q.textContent = "(couldn't load the original)"; });
      }
      const btn = wrap.querySelector('[data-act="send"]');
      btn.addEventListener("click", async () => {
        const to = wrap.querySelector("#mc-to").value.trim(), cc = wrap.querySelector("#mc-cc").value.trim(), subject = wrap.querySelector("#mc-subject").value.trim(), text = wrap.querySelector("#mc-text").value.trim();
        if (!to || !subject) { out.textContent = "Add an address and a subject"; return; }
        if (re && !text) { out.textContent = "Write your reply first"; return; }
        if (cc && !cc.split(/[,;]/).every((a) => /@/.test(a))) { out.textContent = "Check the Cc addresses"; return; }
        btn.disabled = true; out.textContent = files.length ? `Sending with ${files.length} file${files.length > 1 ? "s" : ""}…` : "Sending…";
        try {
          if (re) { await replyToMessage(re, text, quoted, { cc, files }); toast(`Replied to ${re.from.name || re.from.addr}`, "success"); }
          else { await composeEmail({ to, cc, subject, text, files }); toast(`Sent to ${to}`, "success"); }
          close();
        } catch (e) { out.textContent = `✗ ${e.message || "Send failed"}`; btn.disabled = false; }
      });
      return wrap;
    }, { className: "modal-mail modal-compose", focus: !re });
  }

  // ---- Email, with no mailbox connected: what the app has logged ----
  function drawEmailLog(box) {
    const s = store.getSettings();
    const autoErr = lastAutoEmailError();
    // One row per customer, carrying their most recent email either way.
    const byLead = new Map();
    store.all("emails").forEach((e) => {
      if (!e.leadId) return;
      const at = String(e.createdAt || e.receivedAt || "");
      const cur = byLead.get(e.leadId);
      if (!cur || at > cur.at) byLead.set(e.leadId, { at, last: e, count: (cur?.count || 0) + 1 });
      else cur.count += 1;
    });
    const rows = [...byLead.entries()]
      .map(([leadId, e]) => ({ leadId, lead: store.get("leads", leadId), ...e }))
      .filter((r) => r.lead)
      .sort((a, b) => b.at.localeCompare(a.at));

    const connect = document.createElement("div");
    connect.className = "card";
    connect.style.marginBottom = "12px";
    connect.innerHTML = `<div class="row"><div class="row-main">
      <div class="row-title">${icon("mail")} Your inbox isn't connected</div>
      <div class="row-sub">Connect Gmail or Outlook and your whole inbox shows here — read, reply and send from your own address.</div>
    </div><button class="btn btn-sm btn-ghost" data-act="setup">Connect</button></div>`;
    connect.querySelector('[data-act="setup"]').addEventListener("click", () => navigate("/settings"));
    box.appendChild(connect);

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.style.marginBottom = "12px";
      empty.innerHTML = `<div class="muted small">No emails logged yet.</div>`;
      box.appendChild(empty);
    }

    const list = document.createElement("div");
    list.className = "conv-list";
    rows.forEach((r) => {
      const name = r.lead.name || "Customer";
      const row = document.createElement("div");
      row.className = `conv-row${r.last.direction === "in" ? " conv-unread" : ""}`;
      const tag = r.last.direction === "in" ? "reply" : (r.last.via === "auto" ? "automatic" : "");
      row.innerHTML = `
        <div class="conv-av">${esc(initials(name))}</div>
        <div class="conv-main">
          <div class="conv-top">
            <span class="conv-name">${esc(name)}</span>
            <span class="conv-time">${esc(when(r.at))}</span>
          </div>
          <div class="conv-bottom">
            <span class="conv-preview">${esc(String(r.last.subject || r.last.body || "").replace(/\s+/g, " ").slice(0, 80))}</span>
            ${tag ? `<span class="conv-tag">${esc(tag)}</span>` : ""}
            ${r.count > 1 ? `<span class="conv-tag">${r.count}</span>` : ""}
          </div>
        </div>`;
      row.addEventListener("click", () => navigate(`/leads/${r.leadId}`));
      list.appendChild(row);
    });
    box.appendChild(list);

    const auto = document.createElement("div");
    auto.className = "card";
    auto.style.marginTop = "14px";
    auto.innerHTML = `
      <div class="row">
        <div class="row-main">
          <div class="row-title">${icon("mail")} Automated emails</div>
          <div class="row-sub">${
            !s.emailAutoSend
              ? "Off — turn on to send due follow-up emails automatically."
              : !emailSendConfigured()
                ? "On, but nothing can send yet."
                : autoErr && autoErr.setup
                  ? `On, but nothing can send: ${esc(autoErr.message)}`
                  : "On — due follow-up emails send when you open the app."
          }</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-act="email-settings">Set up</button>
      </div>`;
    auto.querySelector('[data-act="email-settings"]').addEventListener("click", () => navigate("/settings"));
    box.appendChild(auto);
  }

  // Starting a new conversation: pick the person first, the same way a
  // messages app does.
  function openPeoplePicker(channel, onPick = null) {
    openModal(channel === "email" ? "Pick a customer" : "New message", (close) => {
      const wrap = document.createElement("div");
      wrap.innerHTML = `<div class="searchbar"><input type="search" id="cp-q" placeholder="Find a customer…"></div><div id="cp-list"></div>`;
      const list = wrap.querySelector("#cp-list");
      const paint = (q = "") => {
        const needle = q.toLowerCase();
        const people = store.all("leads")
          .filter((l) => !needle || [l.name, l.phone, l.email, l.vehicleInterest].join(" ").toLowerCase().includes(needle))
          .filter((l) => (channel === "email" ? true : !l.smsOptOut))
          .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
          .slice(0, 40);
        list.innerHTML = people.length ? "" : `<div class="muted small" style="padding:8px 2px">Nobody matches that.</div>`;
        people.forEach((l) => {
          const row = document.createElement("div");
          row.className = "row";
          row.style.cursor = "pointer";
          const reachable = channel === "email" ? !!l.email : !!l.phone;
          row.innerHTML = `<div class="row-main" style="min-width:0">
              <div class="row-title">${esc(l.name || "Customer")}</div>
              <div class="row-sub">${esc(l.vehicleInterest || (channel === "email" ? l.email : l.phone) || "no contact details")}</div>
            </div>${reachable ? "" : `<div class="row-meta small muted">add ${channel === "email" ? "email" : "phone"}</div>`}`;
          row.addEventListener("click", () => {
            close();
            if (onPick) { if (!reachable) return addContactThenMessage(l); return onPick(l); }
            if (!reachable) return addContactThenMessage(l);
            if (channel === "email") return openTemplatePicker(l);
            // Texting goes to the thread, where the conversation already lives.
            navigate(`/inbox/${l.id}`);
          });
          list.appendChild(row);
        });
      };
      paint();
      wrap.querySelector("#cp-q").addEventListener("input", (e) => paint(e.target.value));
      return wrap;
    });
  }

  draw();
  const off = store.subscribe(() => { if (document.body.contains(el)) draw(); });
  window.addEventListener("hashchange", () => off && off(), { once: true });
}
