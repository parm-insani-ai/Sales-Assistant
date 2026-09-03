// Communication hub: today's outreach queue, one-tap sends, the email stream,
// and the automated-email status — everything about talking to customers.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { openModal, buildForm, toast, undoToast } from "../components.js";
import { icon } from "../icons.js";
import { esc, initials, formatDate, relativeDay, daysFromToday, telHref, smsHref, mailtoHref } from "../utils.js";
import { openTemplatePicker } from "./messages.js";
import { emailSendConfigured } from "../email.js";
import { isLikelyPrefetch } from "../plays.js";
import { getOccasions, markOccasion } from "../occasions.js";
import { isDismissedToday, dismissToday } from "../plays.js";

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

const chMeta = (c) =>
  c === "text" ? { icon: "message", label: "Text" } :
  c === "email" ? { icon: "mail", label: "Email" } :
  { icon: "phone", label: "Call" };

export function renderComms(view) {
  const leads = store.all("leads");
  const leadById = (id) => leads.find((l) => l.id === id) || null;
  const s = store.getSettings();
  const today = new Date().toISOString().slice(0, 10);

  const due = store.all("tasks")
    .filter((t) => !t.done && t.leadId && t.channel && t.due && t.due <= today)
    .sort((a, b) => (a.due || "").localeCompare(b.due || ""));

  const emails = store.all("emails")
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 10);

  // Appointments today/tomorrow that should be confirmed or reminded — the
  // no-show killers.
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const todayK = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const tm = new Date(now); tm.setDate(tm.getDate() + 1);
  const tomorrowK = `${tm.getFullYear()}-${pad(tm.getMonth() + 1)}-${pad(tm.getDate())}`;
  const upcoming = store.all("appointments")
    .filter((a) => a.status !== "canceled" && !a.outcome && a.when &&
      (a.when.startsWith(todayK) || a.when.startsWith(tomorrowK)))
    .sort((a, b) => (a.when || "").localeCompare(b.when || ""));

  const occasions = getOccasions();

  // Link activity: every short link you've sent (booking page, comparisons)
  // reports its opens back through cloud sync. An open in the last 48h is the
  // hottest signal in the app — that customer is reading your stuff right now.
  const links = store.all("links")
    .slice()
    .sort((a, b) => (b.lastOpenAt || b.createdAt || "").localeCompare(a.lastOpenAt || a.createdAt || ""))
    .slice(0, 6);
  const HOT_MS = 48 * 3600 * 1000;
  const timeAgo = (iso) => {
    const ms = Date.now() - new Date(iso).getTime();
    if (!isFinite(ms) || ms < 0) return "";
    const min = Math.round(ms / 60000);
    if (min < 60) return `${Math.max(1, min)}m ago`;
    if (min < 1440) return `${Math.round(min / 60)}h ago`;
    return `${Math.round(min / 1440)}d ago`;
  };

  // Everything that needs chasing is one list, on Home. Point at it rather
  // than re-ranking the same signals here.
  const queued = due.length + occasions.length;

  const el = document.createElement("div");
  el.innerHTML = `
    ${queued ? `<div class="card card-tap" data-goto="/" style="margin-bottom:12px">
      <div class="row"><div class="row-main">
        <div class="row-title">${icon("target")} ${queued} to reach today</div>
        <div class="row-sub">Follow-ups, reminders and reasons to call all live in Today's queue.</div>
      </div><div class="row-meta strong">›</div></div>
    </div>` : ""}
    ${links.length ? `<div class="section-title">Link activity</div>
    <div class="card" id="c-links"></div>` : ""}
    ${upcoming.length ? `<div class="section-title">Confirmations &amp; reminders</div>
    <div class="card" id="c-remind"></div>` : ""}
    <div class="section-title">Send a message</div>
    <div class="card">
      <div class="searchbar" style="margin-bottom:10px"><input type="search" id="c-search" placeholder="Find a customer…"></div>
      <div id="c-people"></div>
    </div>

    <div class="section-title">Recent emails</div>
    <div class="card" id="c-emails">${emails.length ? "" : `<div class="muted small">No emails logged yet. Send one with a template, or log a reply from a customer's page.</div>`}</div>

    <div class="card">
      <div class="row">
        <div class="row-main">
          <div class="row-title">${icon("mail")} Automated emails</div>
          <div class="row-sub">${
            s.emailAutoSend
              ? (emailSendConfigured() ? "On — due follow-up emails send when you open the app." : "On, but the sending function isn't set up yet.")
              : "Off — turn on to send due follow-up emails automatically."
          }</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="c-settings">Set up</button>
      </div>
    </div>
  `;
  view.appendChild(el);

  // --- Link activity rows ---
  const linkBox = el.querySelector("#c-links");
  if (linkBox) links.forEach((lk) => {
    const label = (lk.meta && lk.meta.label) || (lk.kind === "book" ? "Booking link" : "Comparison");
    const opens = Number(lk.opens) || 0;
    const prefetch = isLikelyPrefetch(lk);
    const hot = !prefetch && lk.lastOpenAt && Date.now() - new Date(lk.lastOpenAt).getTime() < HOT_MS;
    const row = document.createElement("div");
    row.className = "row";
    row.style.cssText = "padding:7px 0;border-bottom:1px solid var(--border)";
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title" style="font-size:0.92rem">${esc(label)} ${hot ? '<span class="badge badge-soon">🔥 hot</span>' : ""}</div>
        <div class="row-sub">${prefetch ? `Opened once on delivery — that's a link preview, not them. ` : ""}${opens
          ? `Opened ${opens}×${lk.lastOpenAt ? ` · last ${esc(timeAgo(lk.lastOpenAt))}` : ""}`
          : `Not opened yet${lk.createdAt ? ` · sent ${esc(timeAgo(lk.createdAt))}` : ""}`}</div>
      </div>
      ${opens ? `<div class="row-meta strong mono">${opens}×</div>` : ""}
      <button class="modal-close" data-link-x aria-label="Delete link" style="font-size:1.1rem;flex:none;margin-left:8px">&times;</button>`;
    row.querySelector("[data-link-x]").addEventListener("click", () => {
      store.remove("links", lk.id);
      row.remove();
      if (!linkBox.children.length) linkBox.innerHTML = `<div class="muted small">No links tracked.</div>`;
    });
    linkBox.appendChild(row);
  });

  // --- Confirmations & reminders: one-tap prefilled text; sending marks the
  // appointment confirmed and logs the touch.
  const remindBox = el.querySelector("#c-remind");
  if (remindBox) upcoming.filter((a) => !isDismissedToday(`cf:${a.id}`)).slice(0, 10).forEach((a) => {
    const lead = a.leadId ? leadById(a.leadId) : null;
    const phone = a.phone || (lead && lead.phone) || "";
    const isToday = a.when.startsWith(todayK);
    const time = a.when.slice(11, 16);
    const fn = String(a.customerName || (lead && lead.name) || "there").split(" ")[0];
    const msg = `Hi ${fn}, ${a.confirmed ? "quick reminder about" : "confirming"} your ${(a.title || "appointment").toLowerCase()} ${isToday ? "today" : "tomorrow"} at ${time}${s.dealership ? ` at ${s.dealership}` : ""}. See you then!${s.salesperson ? ` — ${s.salesperson}` : ""}`;
    const row = document.createElement("div");
    row.className = "kv";
    row.style.alignItems = "center";
    row.innerHTML = `
      <span class="v" style="text-align:left;flex:1;font-weight:550;cursor:pointer">${esc(a.customerName || "Customer")}
        <div class="small muted" style="font-weight:450">${esc(a.title || "Appointment")} · ${isToday ? "today" : "tomorrow"} ${esc(time)}${a.confirmed ? " · confirmed ✓" : ""}</div>
      </span>
      ${phone
        ? `<a class="btn ${a.confirmed ? "btn-ghost" : "btn-primary"} btn-sm" href="${smsHref(phone, msg)}" style="flex:none">${icon("message")} ${a.confirmed ? "Remind" : "Confirm"}</a>`
        : `<button class="btn btn-ghost btn-sm" data-open style="flex:none">Open</button>`}
      <button class="modal-close" data-remind-x aria-label="Dismiss" style="font-size:1.1rem;flex:none">&times;</button>
    `;
    row.querySelector("[data-remind-x]").addEventListener("click", () => {
      dismissToday(`cf:${a.id}`);
      row.remove();
      if (!remindBox.children.length) remindBox.innerHTML = `<div class="muted small">All caught up.</div>`;
    });
    row.querySelector("span").addEventListener("click", () => navigate(`/calendar/${a.id}`));
    const openB = row.querySelector("[data-open]");
    if (openB) openB.addEventListener("click", () => navigate(`/calendar/${a.id}`));
    const actB = row.querySelector("a");
    if (actB) actB.addEventListener("click", () => {
      store.update("appointments", a.id, { confirmed: true });
      if (lead) store.update("leads", lead.id, { lastContacted: new Date().toISOString() });
      store.logActivity("touch");
      row.querySelector(".small").textContent = `${a.title || "Appointment"} · ${isToday ? "today" : "tomorrow"} ${time} · confirmed ✓`;
    });
    remindBox.appendChild(row);
  });

  // --- Reasons to reach out: date-driven occasions (lease maturities,
  // birthdays, purchase anniversaries) with a ready-to-send message. Acting or
  // dismissing marks the occasion on the lead so it never nags twice.
  const occBox = el.querySelector("#c-occ");
  if (occBox) occasions.slice(0, 8).forEach((o) => {
    const row = document.createElement("div");
    row.className = "kv";
    row.style.alignItems = "center";
    const canText = !!o.lead.phone;
    row.innerHTML = `
      <span class="v" style="text-align:left;flex:1;font-weight:550;cursor:pointer">${esc(o.lead.name)}
        <div class="small muted" style="font-weight:450">${esc(o.label)}</div>
      </span>
      ${canText
        ? `<a class="btn btn-primary btn-sm" href="${smsHref(o.lead.phone, o.message)}" style="flex:none">${icon("message")} Text</a>`
        : `<button class="btn btn-ghost btn-sm" data-occ-open style="flex:none">Open</button>`}
      <button class="modal-close" data-occ-skip aria-label="Dismiss" style="font-size:1.1rem;flex:none">&times;</button>
    `;
    row.querySelector("span").addEventListener("click", () => navigate(`/leads/${o.lead.id}`));
    const openB = row.querySelector("[data-occ-open]");
    if (openB) openB.addEventListener("click", () => navigate(`/leads/${o.lead.id}`));
    const textB = row.querySelector("a");
    if (textB) textB.addEventListener("click", () => {
      markOccasion(o.lead.id, o.key);
      store.update("leads", o.lead.id, { lastContacted: new Date().toISOString() });
      store.logActivity("touch");
      row.style.opacity = "0.45";
    });
    row.querySelector("[data-occ-skip]").addEventListener("click", () => {
      markOccasion(o.lead.id, o.key);
      row.remove();
      if (!occBox.children.length) occBox.innerHTML = `<div class="muted small">All caught up.</div>`;
    });
    occBox.appendChild(row);
  });

  el.querySelectorAll("[data-goto]").forEach((n) =>
    n.addEventListener("click", () => navigate(n.dataset.goto)));

  // --- Outreach due lives in Today's queue now; this only runs if the section
  // is ever brought back. ---
  const dueBox = el.querySelector("#c-due");
  if (dueBox) due.slice(0, 12).forEach((t) => {
    const l = leadById(t.leadId);
    const m = chMeta(t.channel);
    const overdue = daysFromToday(t.due) < 0;
    const href = !l ? "#" :
      t.channel === "text" ? smsHref(l.phone, t.body || "") :
      t.channel === "email" ? mailtoHref(l.email, "", t.body || "") : telHref(l.phone);
    const usable = l && (t.channel === "email" ? !!l.email : !!l.phone);
    const row = document.createElement("div");
    row.className = "kv";
    row.style.alignItems = "center";
    row.innerHTML = `
      <span class="v" style="text-align:left;flex:1;font-weight:550;cursor:pointer">${esc(t.title)}
        <div class="small ${overdue ? "" : "muted"}" style="font-weight:450;${overdue ? "color:var(--danger)" : ""}">${esc(relativeDay(t.due))}</div>
      </span>
      ${usable
        ? `<a class="btn btn-primary btn-sm" href="${href}" style="flex:none">${icon(m.icon)} ${m.label}</a>`
        : `<button class="btn btn-ghost btn-sm" data-open style="flex:none">Open</button>`}
      <button class="modal-close" data-due-x aria-label="Delete follow-up" style="font-size:1.1rem;flex:none">&times;</button>
    `;
    row.querySelector("[data-due-x]").addEventListener("click", () => {
      const snapshot = { ...t };
      store.remove("tasks", t.id);
      row.remove();
      undoToast("Follow-up deleted", () => store.restore("tasks", snapshot));
    });
    row.querySelector("span").addEventListener("click", () => l && navigate(`/leads/${l.id}`));
    const openBtn = row.querySelector("[data-open]");
    if (openBtn) openBtn.addEventListener("click", () => l && navigate(`/leads/${l.id}`));
    const act = row.querySelector("a");
    if (act) act.addEventListener("click", () => {
      store.update("tasks", t.id, { done: true });
      store.update("leads", l.id, { lastContacted: new Date().toISOString() });
      store.logActivity("touch");
      row.style.opacity = "0.45";
    });
    dueBox.appendChild(row);
  });

  // --- Send a message: pick a customer, then a template. Everyone but lost
  // leads shows here — sold and delivered customers are exactly who thank-you
  // and referral messages go to. Missing contact info gets a tap-to-add path
  // instead of silently hiding the customer.
  const people = el.querySelector("#c-people");
  const contactable = leads
    .filter((l) => l.stage !== "lost")
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const drawPeople = (q = "") => {
    const query = q.trim().toLowerCase();
    const list = (query
      ? contactable.filter((l) => [l.name, l.vehicleInterest, l.phone, l.email].join(" ").toLowerCase().includes(query))
      : contactable
    ).slice(0, 8);
    people.innerHTML = list.length ? "" : `<div class="muted small">No customers${query ? " match that" : " yet"}.</div>`;
    list.forEach((l) => {
      const hasContact = !!(l.phone || l.email);
      const row = document.createElement("div");
      row.className = "kv";
      row.style.cssText = "align-items:center;cursor:pointer";
      row.innerHTML = `
        <span class="v" style="text-align:left;flex:1;font-weight:550">${esc(l.name)}
          <div class="small muted" style="font-weight:450">${hasContact ? esc(l.vehicleInterest || "No vehicle noted") : "No phone or email — tap to add"}</div>
        </span>
        <span class="muted" style="flex:none">${l.phone ? icon("message") : ""} ${l.email ? icon("mail") : ""}</span>
      `;
      row.addEventListener("click", () => hasContact ? openTemplatePicker(l) : addContactThenMessage(l));
      people.appendChild(row);
    });
  };
  drawPeople();
  el.querySelector("#c-search").addEventListener("input", (e) => drawPeople(e.target.value));

  // --- Recent emails across every customer. ---
  const emailBox = el.querySelector("#c-emails");
  emails.forEach((e) => {
    const l = leadById(e.leadId);
    const row = document.createElement("div");
    row.className = "kv";
    row.style.cssText = "align-items:flex-start;cursor:pointer";
    row.innerHTML = `
      <span class="k" style="flex:none">${e.direction === "in" ? "↓ In" : "↑ Out"}</span>
      <span class="v" style="text-align:left;flex:1;font-weight:550">${esc(e.subject || "(no subject)")}
        <div class="small muted" style="font-weight:450">${esc(l ? l.name : "Customer")} · ${esc(formatDate(e.receivedAt || e.createdAt))}${e.via === "auto" ? " · automatic" : e.via === "outlook" ? " · Outlook" : ""}</div>
      </span>
      <button class="modal-close" data-em-x aria-label="Delete" style="font-size:1.1rem;flex:none">&times;</button>
    `;
    row.querySelector("[data-em-x]").addEventListener("click", (ev) => {
      ev.stopPropagation();
      store.remove("emails", e.id);
      row.remove();
    });
    row.addEventListener("click", () => l && navigate(`/leads/${l.id}`));
    emailBox.appendChild(row);
  });

  el.querySelector("#c-settings").addEventListener("click", () => navigate("/settings"));
}
