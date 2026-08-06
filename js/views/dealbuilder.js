// Deal Builder — the AutoAlert-style payment-match engine. For a customer with a
// known current payment and equity (value − payoff), it prices every available
// inventory vehicle as a trade-in deal and surfaces the ones they could get into
// for close to what they pay now. Turns equity data into ready-to-pitch offers.

import * as store from "../store.js";
import { computeDeal } from "./calculator.js";
import { openModal, toast } from "../components.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { fillTemplate } from "./messages.js";
import { currency, currency2, esc, smsHref, telHref, parseDate, daysFromToday } from "../utils.js";

// Compute payment-matched deals for one customer across available inventory.
// Returns matches sorted by closeness to their current payment.
export function dealsForLead(lead, opts = {}) {
  const s = store.getSettings();
  const down = opts.down != null ? opts.down : 0;
  const base = {
    down,
    tradeAllowance: lead.currentValue || 0,
    tradePayoff: lead.payoff || 0,
    fees: s.docFee,
    taxRate: s.taxRate,
    apr: lead.currentApr || s.defaultApr,
    term: s.defaultTerm,
  };
  const vehicles = store.all("vehicles").filter((v) => (v.status || "available") === "available" && v.price != null);
  const cur = lead.currentPayment || null;
  const rows = vehicles.map((v) => {
    const d = computeDeal({ ...base, price: v.price });
    return {
      vehicle: v,
      monthly: d.monthly,
      financed: d.amountFinanced,
      delta: cur != null ? d.monthly - cur : null,
    };
  });
  // Sort by closeness to current payment (or by lowest payment if unknown).
  rows.sort((a, b) => (cur != null ? Math.abs(a.delta) - Math.abs(b.delta) : a.monthly - b.monthly));
  return rows;
}

// Best single match for a customer (used by the /deals list).
export function bestDealForLead(lead) {
  const rows = dealsForLead(lead);
  return rows.length ? rows[0] : null;
}

export function equity(lead) {
  return (lead.currentValue || 0) - (lead.payoff || 0);
}

function yearsOwned(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  return (Date.now() - d.getTime()) / (365.25 * 86400000);
}

// Connect the dots: score how strong an upgrade opportunity this customer is,
// combining payment match, equity, ownership length, lease timing and rate.
// Returns { score (0-100), reasons[] } — the reasons are the "why" chips.
export function scoreOpportunity(lead, best) {
  const s = store.getSettings();
  const reasons = [];
  let score = 0;

  const cur = lead.currentPayment;
  if (cur != null && best) {
    const delta = best.monthly - cur;
    if (delta <= -20) { score += 48; reasons.push(`${currency(Math.round(-delta))}/mo less`); }
    else if (delta <= (s.dealMatchBand || 50)) { score += 40; reasons.push("Same payment"); }
    else if (delta <= 100) { score += 22; reasons.push(`+${currency(Math.round(delta))}/mo`); }
    else { score += 6; }
  } else if (best) {
    score += 10; // can still pitch a fresh vehicle even without their payment
  }

  const eq = equity(lead);
  if (eq >= 3000) { score += 20; reasons.push(`${currency(Math.round(eq))} equity`); }
  else if (eq > 0) { score += 10; reasons.push("Positive equity"); }

  const yrs = yearsOwned(lead.purchaseDate);
  if (yrs != null && yrs >= 3) { score += 15; reasons.push(`Owned ${Math.floor(yrs)} yrs`); }
  else if (yrs != null && yrs >= 2) { score += 8; }

  if (lead.leaseEnd) {
    const d = daysFromToday(lead.leaseEnd);
    if (d != null && d >= 0 && d <= 90) { score += 26; reasons.push(`Lease ends in ${d}d`); }
    else if (d != null && d > 90 && d <= 180) { score += 12; reasons.push("Lease ending soon"); }
  }

  if (lead.currentApr != null && lead.currentApr > (s.defaultApr || 0) + 1) {
    score += 12; reasons.push(`Rate ${lead.currentApr}% → ~${s.defaultApr}%`);
  }

  return { score: Math.min(100, Math.round(score)), reasons: reasons.slice(0, 3) };
}

function strength(score) {
  if (score >= 70) return { label: "Hot", badge: "badge-due" };
  if (score >= 45) return { label: "Strong", badge: "badge-sold" };
  return { label: "Worth a call", badge: "badge-soon" };
}

// The proactive radar: every customer with a buildable deal, scored and ranked.
export function topOpportunities(limit = 50) {
  const haveInv = store.all("vehicles").some((v) => (v.status || "available") === "available" && v.price != null);
  if (!haveInv) return [];
  const out = [];
  store.all("leads").forEach((l) => {
    const hasData = l.currentPayment != null || l.currentValue != null || l.payoff != null || l.leaseEnd || l.purchaseDate;
    if (!hasData) return;
    const best = bestDealForLead(l);
    if (!best) return;
    const { score, reasons } = scoreOpportunity(l, best);
    if (score <= 0) return;
    out.push({ lead: l, best, score, reasons });
  });
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function vehName(v) {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle";
}

// Build the ready-to-send offer text for a matched deal.
export function offerText(lead, match) {
  const s = store.getSettings();
  const v = vehName(match.vehicle);
  const pmt = Math.round(match.monthly);
  const intro = fillTemplate("Hi {firstName}, it's {salesperson} at {dealership}.", lead);
  const curLine = lead.currentPayment
    ? ` right around the $${Math.round(lead.currentPayment)}/mo you're paying now`
    : "";
  const trade = lead.vehicleInterest ? ` out of your ${lead.vehicleInterest}` : "";
  return `${intro} Good news — I can likely get you into a new ${v} for about $${pmt}/mo,${curLine}${trade ? "," + trade : ""}. Worth a quick look? What's your schedule like this week?`;
}

// ---------- Per-customer Deal Builder sheet ----------
export function openDealBuilder(lead) {
  openModal(`Deals for ${(lead.name || "customer").split(" ")[0]}`, (close) => {
    const wrap = document.createElement("div");
    const s = store.getSettings();

    function draw(down) {
      const rows = dealsForLead(lead, { down });
      const eq = equity(lead);
      const cur = lead.currentPayment;
      const top = rows.slice(0, 6);

      wrap.innerHTML = `
        <div class="card" style="margin-bottom:14px">
          <div class="row"><span class="k muted">Currently pays</span><span class="v strong mono">${cur != null ? currency(cur) + "/mo" : "unknown"}</span></div>
          <div class="row" style="margin-top:6px"><span class="k muted">On</span><span class="v">${esc(lead.vehicleInterest || "—")}</span></div>
          <div class="row" style="margin-top:6px"><span class="k muted">Est. equity</span><span class="v strong mono" style="color:${eq >= 0 ? "var(--success)" : "var(--danger)"}">${currency(eq)}</span></div>
        </div>

        <div class="field">
          <label>Cash down (tweak to hit their payment)</label>
          <input id="db-down" type="number" inputmode="decimal" value="${down}" />
        </div>

        ${cur == null ? `<div class="hint" style="margin-bottom:10px">No current payment on file for this customer — showing lowest payments. Add their payment/payoff/value to match.</div>` : ""}

        <div class="section-title" style="margin-top:6px">${cur != null ? "Closest matches" : "Lowest payments"}</div>
        <div class="db-list"></div>
        <div class="fab-note">Estimates using ${s.taxRate}% tax, ${currency(s.docFee)} fees, ${lead.currentApr || s.defaultApr}% APR, ${s.defaultTerm} mo, their car as trade. Confirm with your desk.</div>
      `;

      const list = wrap.querySelector(".db-list");
      if (!top.length) {
        list.innerHTML = `<div class="muted small">No available inventory with pricing. Add vehicles or import your inventory first.</div>`;
      } else {
        top.forEach((m) => list.appendChild(dealRow(lead, m)));
      }

      const downEl = wrap.querySelector("#db-down");
      downEl.addEventListener("change", () => draw(Number(downEl.value) || 0));
    }

    draw(0);
    return wrap;
  });
}

function dealRow(lead, m) {
  const el = document.createElement("div");
  el.className = "card";
  const v = m.vehicle;
  const near = m.delta != null && Math.abs(m.delta) <= (store.getSettings().dealMatchBand || 50);
  const deltaLabel = m.delta == null ? "" :
    m.delta <= 0 ? `${currency(Math.abs(Math.round(m.delta)))}/mo less` : `+${currency(Math.round(m.delta))}/mo`;
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(vehName(v))}</div>
        <div class="row-sub">${v.price != null ? currency(v.price) : ""}${v.stock ? " · Stock #" + esc(v.stock) : ""}</div>
      </div>
      <div class="row-meta">
        <div class="strong mono" style="font-size:1.05rem">${currency2(m.monthly)}<span class="muted" style="font-size:.8rem">/mo</span></div>
        ${m.delta != null ? `<div class="small ${near ? "" : "muted"}" style="${near ? "color:var(--success);font-weight:700" : ""}">${near ? "≈ same payment" : deltaLabel}</div>` : ""}
      </div>
    </div>
    <div class="btn-row" style="margin-top:12px">
      ${lead.phone ? `<a class="btn btn-primary btn-sm" data-act="offer" style="flex:1" href="${smsHref(lead.phone, offerText(lead, m))}">${icon("message")} Text offer</a>` : ""}
      <button class="btn btn-ghost btn-sm" data-act="quote" style="flex:1">${icon("calculator")} Quote</button>
    </div>
  `;
  const offerBtn = el.querySelector('[data-act="offer"]');
  if (offerBtn) offerBtn.addEventListener("click", () => {
    store.logActivity("touch");
    store.update("leads", lead.id, { lastContacted: new Date().toISOString() });
  });
  el.querySelector('[data-act="quote"]').addEventListener("click", () => {
    sessionStorage.setItem("calc-prefill", JSON.stringify({
      price: v.price, label: `${vehName(v)} — ${lead.name}`,
      tradeAllowance: lead.currentValue || 0, tradePayoff: lead.payoff || 0,
      apr: lead.currentApr || null,
    }));
    navigate("/calculator");
  });
  return el;
}

// ---------- /deals page: the proactive, ranked Deal Radar ----------
export function renderDeals(view) {
  const leadsWithData = store.all("leads").some((l) => l.currentPayment != null || l.currentValue != null || l.payoff != null || l.leaseEnd || l.purchaseDate);
  const haveInventory = store.all("vehicles").some((v) => (v.status || "available") === "available" && v.price != null);
  const opps = topOpportunities(50);

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="hero">
      <div class="hero-greeting">Deal Radar</div>
      <div class="hero-title">Deals ready to pitch</div>
    </div>
    <div class="fab-note" style="margin:0 2px 14px;text-align:left">Your database, scanned and ranked — customers who can move into a new vehicle right now, strongest opportunity first.</div>
    <div class="deals-list"></div>
  `;
  view.appendChild(el);
  const list = el.querySelector(".deals-list");

  if (!leadsWithData) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">${icon("dollar", "ico-xl")}</div><div class="strong">No customer data yet</div><div class="small">Import an AutoAlert equity export (current payment, payoff, value) and the radar fills with ready-to-pitch deals.</div><button class="btn btn-primary btn-block" data-act="import" style="margin-top:16px">${icon("file")} Import customers</button></div>`;
    list.querySelector('[data-act="import"]').addEventListener("click", () => navigate("/import"));
    return;
  }
  if (!haveInventory) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">${icon("car", "ico-xl")}</div><div class="strong">No inventory to match against</div><div class="small">Add vehicles or import your inventory, then the radar builds deals.</div><button class="btn btn-primary btn-block" data-act="inv" style="margin-top:16px">${icon("file")} Import inventory</button></div>`;
    list.querySelector('[data-act="inv"]').addEventListener("click", () => navigate("/import"));
    return;
  }
  if (!opps.length) {
    list.innerHTML = `<div class="muted small" style="text-align:center;padding:30px">No strong matches in current inventory yet. Add more vehicles, or check back as inventory changes.</div>`;
    return;
  }

  opps.forEach((o) => list.appendChild(opportunityCard(o)));
}

function opportunityCard({ lead, best, score, reasons }) {
  const el = document.createElement("div");
  el.className = "card";
  const st = strength(score);
  const v = best.vehicle;
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(lead.name)}</div>
        <div class="row-sub">${lead.currentPayment != null ? "Pays " + currency(lead.currentPayment) + "/mo · " : ""}${esc(lead.vehicleInterest || "current vehicle")}</div>
      </div>
      <span class="badge ${st.badge}">${st.label}</span>
    </div>
    <div class="card" style="margin:12px 0 0;background:var(--surface-2);border:none">
      <div class="row">
        <div class="row-main"><div class="small muted">Put them in</div><div class="strong">${esc(vehName(v))}</div></div>
        <div class="row-meta"><div class="strong mono" style="font-size:1.05rem">${currency2(best.monthly)}<span class="muted" style="font-size:.8rem">/mo</span></div>${best.delta != null ? `<div class="small ${best.delta <= (store.getSettings().dealMatchBand || 50) ? "" : "muted"}" style="${best.delta <= (store.getSettings().dealMatchBand || 50) ? "color:var(--success);font-weight:700" : ""}">${best.delta <= 0 ? currency(Math.abs(Math.round(best.delta))) + "/mo less" : best.delta <= (store.getSettings().dealMatchBand || 50) ? "≈ same" : "+" + currency(Math.round(best.delta)) + "/mo"}</div>` : ""}</div>
      </div>
    </div>
    ${reasons.length ? `<div class="btn-row" style="gap:6px;margin-top:10px">${reasons.map((r) => `<span class="badge badge-working">${esc(r)}</span>`).join("")}</div>` : ""}
    <div class="btn-row" style="margin-top:12px">
      ${lead.phone ? `<a class="btn btn-primary btn-sm" data-act="offer" style="flex:1" href="${smsHref(lead.phone, offerText(lead, best))}">${icon("message")} Text offer</a>
      <a class="btn btn-success btn-sm" data-act="call" style="flex:0 0 auto" href="${telHref(lead.phone)}">${icon("phone")}</a>` : ""}
      <button class="btn btn-ghost btn-sm" data-act="more" style="flex:1">${icon("dollar")} Options</button>
    </div>
  `;
  const touch = () => { store.logActivity("touch"); store.update("leads", lead.id, { lastContacted: new Date().toISOString() }); };
  const offer = el.querySelector('[data-act="offer"]');
  if (offer) offer.addEventListener("click", touch);
  const call = el.querySelector('[data-act="call"]');
  if (call) call.addEventListener("click", touch);
  el.querySelector('[data-act="more"]').addEventListener("click", () => openDealBuilder(lead));
  return el;
}
