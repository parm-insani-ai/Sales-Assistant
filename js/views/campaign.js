// Campaigns — the outreach half of the agent. Pick a segment of owners, let
// the deal engine choose each one's replacement vehicle, draft the right text
// for their situation, then send the batch one tap at a time from your own
// number.
//
// Two deliberate constraints shape this file:
//   · No numbers leave the building. The invite link shows their car against
//     the one picked for them, spec by spec, with no pricing anywhere. The
//     figures stay on your screen for when they're at the desk.
//   · Nothing sends itself. Every text goes through the Messages app from your
//     own number, which is both better for deliverability and the only version
//     that's honest about consent.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { toast } from "../components.js";
import { esc, smsHref, daysFromToday } from "../utils.js";
import { topOpportunities, equityDetail, bestPitch } from "./dealbuilder.js";
import { findSpec, comparePayload, compareLink } from "./compare.js";
import { shortenLink } from "../shortlink.js";
import { allTemplates, recommendTemplate, fillTemplate } from "./messages.js";
import { bookingLink, cachedShortBookingLink } from "./settings.js";
import * as backend from "../backend.js";
import { sendText, smsReady } from "../sms.js";

// ---- Segments -------------------------------------------------------------
// Each is a plain predicate over a scored opportunity, so a segment can lean on
// the same ranking the radar uses.
export const SEGMENTS = [
  { id: "all", label: "Every opportunity", hint: "Ranked by how ready they are to move.", fn: () => true },
  { id: "equity", label: "Sitting on equity", hint: "Trade worth more than what's owed.",
    fn: (o) => { const e = equityDetail(o.lead); return e.v != null && e.v >= 2000; } },
  { id: "paidoff", label: "Paid off", hint: "No payment, no payoff — the whole trade is theirs.",
    fn: (o) => o.lead.currentPayment == null && (o.lead.payoff == null || Number(o.lead.payoff) === 0) },
  { id: "lease", label: "Lease maturing", hint: "Inside 120 days of the end of their lease.",
    fn: (o) => { const d = o.lead.leaseEnd ? daysFromToday(o.lead.leaseEnd) : null; return d != null && d >= -30 && d <= 120; } },
  { id: "loyal", label: "Nissan owners", hint: "Already in the family — the easiest conversation.",
    fn: (o) => /nissan/i.test(String(o.lead.vehicleInterest || "")) },
];

// Contactable, not already worked today, and not opted out.
function reachable(lead) {
  if (!lead.phone) return false;
  if (lead.stage === "lost" || lead.doNotContact) return false;
  // Texted STOP. Carrier rules aside, an opt-out the app only half-honours
  // reads as deliberate, which is worse than not having one.
  if (store.optedOut(lead)) return false;
  const last = lead.lastCampaignAt ? Date.now() - new Date(lead.lastCampaignAt).getTime() : Infinity;
  return last > 20 * 24 * 3600 * 1000; // one outreach per customer per ~3 weeks
}

// ---- Building a campaign --------------------------------------------------
// One row per customer: who they are, what they drive, what we'd put them in,
// and the message that goes with their situation.
export function buildCampaign(segmentId, limit = 25) {
  const seg = SEGMENTS.find((s) => s.id === segmentId) || SEGMENTS[0];
  const rows = [];
  topOpportunities(200).forEach((o) => {
    if (rows.length >= limit) return;
    if (!reachable(o.lead)) return;
    if (!seg.fn(o)) return;
    // Invite them to look at a replacement for what they drive, not whatever
    // happens to match their payment.
    const pitch = bestPitch(o.lead, store.getSettings().dealMethod || "both", { preferReplacement: true }) || o.best;
    if (!pitch) return;
    const tplId = recommendTemplate(o.lead);
    const tpl = allTemplates().find((t) => t.id === tplId) || allTemplates()[0];
    rows.push({
      lead: o.lead,
      score: o.score,
      reasons: o.reasons,
      pitch,
      template: tpl,
      // The link is minted on prepare, not here — building a campaign should
      // never burn short links for people you end up skipping.
      link: null,
      body: fillTemplate(tpl.body, o.lead),
      sent: false,
    });
  });
  return rows;
}

// The invite payload: their vehicle beside the one picked for them. Reuses the
// comparison page, personalised — and pointedly carries no pricing.
function invitePayload(row) {
  const s = store.getSettings();
  const theirs = (() => {
    const vi = String(row.lead.vehicleInterest || "");
    const words = vi.replace(/^\d{4}\s*/, "").trim().split(/\s+/).filter(Boolean);
    for (let k = words.length; k >= 1; k--) {
      try { const hit = findSpec(words.slice(0, k).join(" ")); if (hit) return hit; } catch {}
    }
    return null;
  })();
  const mine = (() => {
    try { return findSpec(String(row.pitch.vehicle.model || "")); } catch { return null; }
  })();
  if (!mine) return null;
  const sameCar = theirs && mine && theirs.id === mine.id;
  const picked = sameCar ? [mine] : [theirs, mine].filter(Boolean);
  // Nothing to compare against (we don't know their car) — still show the one
  // we picked, on its own.
  const payload = comparePayload(picked.length > 1 ? picked : [mine]);
  // comparePayload is the sales-tool version and includes Price / MSRP. An
  // invite carries no money, so drop that row (and any other priced row) before
  // it ever leaves the device.
  const money = /price|msrp|payment|apr|monthly|cash/i;
  const keep = payload.r.map((label, i) => (money.test(label) ? -1 : i)).filter((i) => i >= 0);
  payload.r = keep.map((i) => payload.r[i]);
  payload.k = keep.map((i) => payload.k[i]);
  payload.v = payload.v.map((v) => ({ ...v, cells: keep.map((i) => v.cells[i]) }));
  if (payload.w) {
    const remap = {};
    keep.forEach((orig, now) => { const k = payload.k[now]; if (payload.w[k] != null) remap[k] = payload.w[k]; });
    payload.w = remap;
  }
  const first = String(row.lead.name || "").trim().split(/\s+/)[0];
  payload.h = `The ${row.pitch.vehicle.model} I picked out for you${first ? `, ${first}` : ""}`;
  payload.m = sameCar
    ? `You're in a ${row.lead.vehicleInterest} already, so you know the car — this is where it's got to since. No numbers on this page; I'd rather go through those properly with you. If it's worth a look, grab a time below.`
    : theirs
    ? `You're in a ${row.lead.vehicleInterest} right now. Here's how it lines up against the one I had in mind — no numbers here, I'd rather go through those with you properly. If it looks worth a look, grab a time below.`
    : `Here's the one I had in mind for you — no numbers on this page, I'd rather go through those with you properly. If it looks worth a look, grab a time below.`;
  try {
    if (backend.currentUser() && (s.agentUrl || "").trim()) payload.b = cachedShortBookingLink() || bookingLink();
  } catch {}
  return payload;
}

// Mint each row's personal link up front. Taps then open Messages instantly
// from a plain href — an await between the tap and the sms: navigation gets
// swallowed by iOS as a non-gesture.
export async function prepareCampaign(rows, onProgress) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.link) { if (onProgress) onProgress(i + 1, rows.length); continue; }
    const payload = invitePayload(row);
    if (payload) {
      const label = `${row.lead.name} · ${row.pitch.vehicle.model}`;
      row.link = (await shortenLink("compare.html", "invite", payload, { label, leadId: row.lead.id }))
        || compareLink(payload);
    }
    if (onProgress) onProgress(i + 1, rows.length);
  }
  return rows;
}

export function messageFor(row) {
  return row.link ? `${row.body}\n\n${row.link}` : row.body;
}

// Sending is the customer's first touch: stamp it so cadence, the pre-fetch
// filter and the 3-week guard all have a timestamp to work from.
export function markSent(row) {
  const now = new Date().toISOString();
  store.update("leads", row.lead.id, {
    lastCampaignAt: now,
    lastContacted: now,
    stage: row.lead.stage === "delivered" ? "working" : row.lead.stage,
  });
  store.logActivity("touch");
  row.sent = true;
}

// Shortening needs a signed-in cloud account and a function URL. Without them
// the fallback link carries the whole payload in the URL — fine for a browser,
// hopeless in a text message.
export function canShorten() {
  try {
    const s = store.getSettings();
    return !!(backend.currentUser() && (s.agentUrl || "").trim());
  } catch { return false; }
}

// ---- View -----------------------------------------------------------------
export function renderCampaign(view) {
  let segment = "all";
  let rows = [];
  let prepared = false;

  const el = document.createElement("div");
  view.appendChild(el);

  function draw() {
    const sent = rows.filter((r) => r.sent).length;
    el.innerHTML = `
      <div class="hero">
        <div class="hero-greeting">Campaign</div>
        <div class="hero-title">Fill the desk</div>
      </div>
      <div class="fab-note" style="margin:0 2px 14px;text-align:left">Pick who to reach, and the agent works out what to put each of them in and what to say. ${
        smsReady()
          ? "Sends from your texting number, so replies come back to the Inbox."
          : "You send from your own number."
      } Nothing goes out on its own, and no pricing leaves the building.</div>

      <div class="card">
        <div class="field">
          <label>Who are we reaching?</label>
          <select id="cm-seg">
            ${SEGMENTS.map((s) => `<option value="${s.id}"${s.id === segment ? " selected" : ""}>${esc(s.label)}</option>`).join("")}
          </select>
          <div class="hint">${esc((SEGMENTS.find((s) => s.id === segment) || SEGMENTS[0]).hint)} Customers texted in the last three weeks are skipped.</div>
        </div>
        <button class="btn btn-primary btn-block" data-act="build">${icon("target")} Build the list</button>
        ${canShorten() ? "" : `<div class="hint" style="margin-top:10px;color:var(--warning)">Cloud sync isn't connected, so invite links can't be shortened — they'd go out as a very long URL that reads like spam. Sign in under Settings → Cloud sync first.</div>`}
      </div>

      ${rows.length ? `
        <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>${rows.length} to reach${sent ? ` · ${sent} sent` : ""}</span>
          ${prepared ? "" : `<button class="btn btn-sm btn-primary" data-act="prep">Prepare links</button>`}
        </div>
        <div class="cm-list"></div>` : ""}
    `;

    const list = el.querySelector(".cm-list");
    if (list) rows.forEach((row, i) => list.appendChild(rowCard(row, i)));

    el.querySelector("#cm-seg").addEventListener("change", (e) => { segment = e.target.value; draw(); });
    el.querySelector('[data-act="build"]').addEventListener("click", () => {
      rows = buildCampaign(segment);
      prepared = false;
      if (!rows.length) toast("Nobody matches that segment right now", "");
      draw();
    });
    const prep = el.querySelector('[data-act="prep"]');
    if (prep) prep.addEventListener("click", async () => {
      prep.disabled = true;
      prep.textContent = "Preparing…";
      await prepareCampaign(rows, (done, total) => { prep.textContent = `Preparing ${done}/${total}…`; });
      prepared = true;
      toast("Links ready — tap Text on each", "success");
      draw();
    });
  }

  function rowCard(row, i) {
    const inApp = smsReady();
    const card = document.createElement("div");
    card.className = "card";
    if (row.sent) card.style.opacity = "0.5";
    const v = row.pitch.vehicle;
    const body = messageFor(row);
    card.innerHTML = `
      <div class="row">
        <div class="row-main">
          <div class="row-title">${esc(row.lead.name)}</div>
          <div class="row-sub">${esc(row.lead.vehicleInterest || "vehicle unknown")} → <b>${esc([v.year, v.make, v.model, v.trim].filter(Boolean).join(" "))}</b></div>
        </div>
        <div class="row-meta"><span class="badge ${row.sent ? "badge-delivered" : "badge-working"}">${row.sent ? "sent" : row.score}</span></div>
      </div>
      ${row.reasons && row.reasons.length ? `<div class="btn-row" style="gap:6px;margin-top:8px">${row.reasons.map((r) => `<span class="badge badge-working">${esc(r)}</span>`).join("")}</div>` : ""}
      <div class="small muted" style="margin-top:10px;white-space:pre-wrap;line-height:1.45">${esc(body)}</div>
      <div class="btn-row" style="margin-top:10px">
        ${inApp
          ? `<button class="btn ${row.sent ? "btn-ghost" : "btn-primary"} btn-sm" style="flex:1" data-act="send">${icon("message")} ${row.sent ? "Send again" : "Text"}</button>`
          : `<a class="btn ${row.sent ? "btn-ghost" : "btn-primary"} btn-sm" style="flex:1" data-act="send" href="${smsHref(row.lead.phone, body)}">${icon("message")} ${row.sent ? "Send again" : "Text"}</a>`}
        <button class="btn btn-ghost btn-sm" data-act="open" style="flex:0 0 auto">${icon("users")}</button>
        <button class="btn btn-ghost btn-sm" data-act="skip" style="flex:0 0 auto">Skip</button>
      </div>
      ${row.link ? "" : `<div class="hint" style="margin-top:6px">No invite link yet — tap Prepare links above so they get the vehicle page.</div>`}
    `;
    card.querySelector('[data-act="send"]').addEventListener("click", async (ev) => {
      // With a texting number configured, send from the app so the reply comes
      // back into the Inbox. Without one it hands off to the phone's SMS app,
      // where the reply lands in the phone's own messages and the loop is open.
      if (inApp) {
        ev.preventDefault();
        const btn = card.querySelector('[data-act="send"]');
        btn.disabled = true;
        btn.textContent = "Sending…";
        const r = await sendText(row.lead, body);
        if (!r.ok) {
          toast(r.error, "warn");
          btn.disabled = false;
          btn.innerHTML = `${icon("message")} Text`;
          return;
        }
      }
      markSent(row);
      // Re-render just this card so the list keeps its scroll position.
      const next = rowCard(row, i);
      card.replaceWith(next);
    });
    card.querySelector('[data-act="open"]').addEventListener("click", () => navigate(`/leads/${row.lead.id}`));
    card.querySelector('[data-act="skip"]').addEventListener("click", () => {
      rows = rows.filter((r) => r !== row);
      card.remove();
    });
    return card;
  }

  draw();
}
