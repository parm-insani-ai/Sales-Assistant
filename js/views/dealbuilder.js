// Deal Builder — the AutoAlert-style payment-match engine. For a customer with a
// known current payment and equity (value − payoff), it prices every available
// inventory vehicle as a trade-in deal and surfaces the ones they could get into
// for close to what they pay now. Turns equity data into ready-to-pitch offers.

import * as store from "../store.js";
import { computeDeal } from "./calculator.js";
import { openModal, toast } from "../components.js";
import { navigate } from "../router.js";
import { openAppointmentForm } from "./calendar.js";
import { icon } from "../icons.js";
import { fillTemplate } from "./messages.js";
import { currency, currency2, esc, smsHref, telHref, parseDate, daysFromToday } from "../utils.js";

function num(v) { return Number(v) || 0; }

// Estimate a monthly LEASE payment. Depreciation + rent (money-factor) on the
// adjusted cap cost, with tax applied to the payment (common in CA/NS/HST).
export function computeLease(input) {
  const price = num(input.price);
  const fees = num(input.fees);
  const down = num(input.down);
  const netTradeEquity = num(input.tradeAllowance) - num(input.tradePayoff);
  const term = Math.max(1, Math.round(num(input.term)));
  const residualPct = num(input.residualPct) / 100;
  const taxRate = num(input.taxRate) / 100;
  const mf = num(input.apr) / 2400; // APR% → money factor

  const capCost = price + fees;
  const adjCap = capCost - down - netTradeEquity;
  const residual = price * residualPct;
  const depreciation = (adjCap - residual) / term;
  const rent = (adjCap + residual) * mf;
  let base = depreciation + rent;
  if (base < 0) base = 0;
  const tax = base * taxRate;
  return { monthly: base + tax, residual, term };
}

function financeBase(lead, down) {
  const s = store.getSettings();
  return {
    down: down != null ? down : 0,
    tradeAllowance: lead.currentValue || 0,
    tradePayoff: lead.payoff || 0,
    fees: s.docFee,
    taxRate: s.taxRate,
    apr: lead.currentApr || s.defaultApr,
  };
}

function availableVehicles() {
  return store.all("vehicles").filter((v) => (v.status || "available") === "available" && v.price != null);
}

// Both financing and leasing options for one vehicle, honoring the method filter.
function optionsForVehicle(lead, v, opts = {}) {
  const s = store.getSettings();
  const method = opts.method || s.dealMethod || "both";
  const base = financeBase(lead, opts.down);
  const out = [];
  if (method !== "lease") {
    const f = computeDeal({ ...base, term: s.defaultTerm, price: v.price });
    out.push({ vehicle: v, method: "finance", monthly: f.monthly, financed: f.amountFinanced });
  }
  if (method !== "finance") {
    const l = computeLease({ ...base, term: s.leaseTerm || 36, residualPct: s.leaseResidualPct || 58, price: v.price });
    out.push({ vehicle: v, method: "lease", monthly: l.monthly, residual: l.residual });
  }
  return out;
}

// Every finance/lease option across available inventory, closest payment first.
export function dealsForLead(lead, opts = {}) {
  const cur = lead.currentPayment != null ? lead.currentPayment : null;
  const rows = [];
  availableVehicles().forEach((v) => {
    optionsForVehicle(lead, v, opts).forEach((o) => rows.push({ ...o, delta: cur != null ? o.monthly - cur : null }));
  });
  rows.sort((a, b) => (cur != null ? Math.abs(a.delta) - Math.abs(b.delta) : a.monthly - b.monthly));
  return rows;
}

// Best single option for a customer (used by the radar + dashboard).
export function bestDealForLead(lead, opts = {}) {
  const rows = dealsForLead(lead, opts);
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

// The proactive radar: every customer who can move into a new vehicle within the
// current payment-tolerance band, via financing or leasing, scored and ranked.
export function topOpportunities(limit = 50) {
  const s = store.getSettings();
  const band = s.dealMatchBand != null ? s.dealMatchBand : 50;
  const method = s.dealMethod || "both";
  if (!availableVehicles().length) return [];
  const out = [];
  store.all("leads").forEach((l) => {
    const hasData = l.currentPayment != null || l.currentValue != null || l.payoff != null || l.leaseEnd || l.purchaseDate;
    if (!hasData) return;
    const best = bestDealForLead(l, { method });
    if (!best) return;
    // Only surface customers whose new payment stays within their tolerance
    // (or whose current payment is unknown — still a fresh-vehicle pitch).
    if (best.delta != null && best.delta > band) return;
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
  const how = match.method === "lease" ? " on a lease" : "";
  return `${intro} Good news — I can likely get you into a new ${v} for about $${pmt}/mo${how},${curLine}${trade ? "," + trade : ""}. Worth a quick look? What's your schedule like this week?`;
}

// ---------- Per-customer Deal Builder sheet ----------
export function openDealBuilder(lead) {
  openModal(`Deals for ${(lead.name || "customer").split(" ")[0]}`, (close) => {
    const wrap = document.createElement("div");
    const s = store.getSettings();

    function draw(down) {
      const rows = dealsForLead(lead, { down, method: "both" });
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
        <div class="row-sub"><span class="badge ${m.method === "lease" ? "badge-appt" : "badge-working"}" style="margin-right:6px">${m.method === "lease" ? "Lease" : "Finance"}</span>${v.price != null ? currency(v.price) : ""}${v.stock ? " · #" + esc(v.stock) : ""}</div>
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
  const haveInventory = availableVehicles().length > 0;

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="hero">
      <div class="hero-greeting">Deal Radar</div>
      <div class="hero-title">Deals ready to pitch</div>
    </div>
    <div class="fab-note" style="margin:0 2px 14px;text-align:left">Customers who can move into a new vehicle — financing or leasing — for close to what they pay now. Set your tolerance below.</div>
    <div id="deals-controls"></div>
    <div class="deals-list"></div>
  `;
  view.appendChild(el);
  const list = el.querySelector(".deals-list");
  const controls = el.querySelector("#deals-controls");

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

  const s = store.getSettings();
  const methods = [["both", "Both"], ["finance", "Finance"], ["lease", "Lease"]];
  controls.innerHTML = `
    <div class="card">
      <div class="seg" role="group" aria-label="Deal type">
        ${methods.map(([m, label]) => `<button class="seg-btn ${s.dealMethod === m ? "active" : ""}" data-method="${m}">${label}</button>`).join("")}
      </div>
      <div style="margin-top:16px">
        <div class="row"><label class="small strong">New payment can be up to</label><span class="small mono strong" id="band-val" style="color:var(--brand)">+${currency(s.dealMatchBand)}/mo</span></div>
        <input id="band-slider" type="range" min="0" max="200" step="10" value="${s.dealMatchBand}" style="width:100%;margin-top:6px" />
        <div class="row small muted"><span>Same payment</span><span>+$200/mo</span></div>
      </div>
    </div>`;

  const redraw = () => {
    const opps = topOpportunities(50);
    list.innerHTML = "";
    if (!opps.length) {
      list.innerHTML = `<div class="muted small" style="text-align:center;padding:30px">No customers within +${currency(store.getSettings().dealMatchBand)}/mo right now. Widen the tolerance above, switch Finance/Lease, or add inventory.</div>`;
      return;
    }
    opps.forEach((o) => list.appendChild(opportunityCard(o)));
  };

  controls.querySelectorAll("[data-method]").forEach((b) =>
    b.addEventListener("click", () => {
      store.updateSettings({ dealMethod: b.dataset.method });
      controls.querySelectorAll("[data-method]").forEach((x) => x.classList.toggle("active", x === b));
      redraw();
    }));
  const slider = controls.querySelector("#band-slider");
  const bandVal = controls.querySelector("#band-val");
  slider.addEventListener("input", () => { bandVal.textContent = `+${currency(Number(slider.value))}/mo`; });
  slider.addEventListener("change", () => { store.updateSettings({ dealMatchBand: Number(slider.value) }); redraw(); });

  redraw();
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
        <div class="row-main"><div class="small muted">Put them in · ${best.method === "lease" ? "Lease" : "Finance"}</div><div class="strong">${esc(vehName(v))}</div></div>
        <div class="row-meta"><div class="strong mono" style="font-size:1.05rem">${currency2(best.monthly)}<span class="muted" style="font-size:.8rem">/mo</span></div>${best.delta != null ? `<div class="small ${best.delta <= (store.getSettings().dealMatchBand || 50) ? "" : "muted"}" style="${best.delta <= (store.getSettings().dealMatchBand || 50) ? "color:var(--success);font-weight:700" : ""}">${best.delta <= 0 ? currency(Math.abs(Math.round(best.delta))) + "/mo less" : best.delta <= (store.getSettings().dealMatchBand || 50) ? "≈ same" : "+" + currency(Math.round(best.delta)) + "/mo"}</div>` : ""}</div>
      </div>
    </div>
    ${reasons.length ? `<div class="btn-row" style="gap:6px;margin-top:10px">${reasons.map((r) => `<span class="badge badge-working">${esc(r)}</span>`).join("")}</div>` : ""}
    <button class="btn btn-primary btn-block" data-act="book" style="margin-top:12px">${icon("calendar")} Book appointment</button>
    <div class="btn-row" style="margin-top:8px">
      ${lead.phone ? `<a class="btn btn-ghost btn-sm" data-act="offer" style="flex:1" href="${smsHref(lead.phone, offerText(lead, best))}">${icon("message")} Text offer</a>
      <a class="btn btn-ghost btn-sm" data-act="call" style="flex:0 0 auto" href="${telHref(lead.phone)}">${icon("phone")}</a>` : ""}
      <button class="btn btn-ghost btn-sm" data-act="more" style="flex:1">${icon("dollar")} Options</button>
    </div>
  `;
  const touch = () => { store.logActivity("touch"); store.update("leads", lead.id, { lastContacted: new Date().toISOString() }); };
  const offer = el.querySelector('[data-act="offer"]');
  if (offer) offer.addEventListener("click", touch);
  const call = el.querySelector('[data-act="call"]');
  if (call) call.addEventListener("click", touch);
  el.querySelector('[data-act="book"]').addEventListener("click", () =>
    openAppointmentForm(null, { leadId: lead.id, customerName: lead.name, vehicle: vehName(best.vehicle), type: "appointment" }));
  el.querySelector('[data-act="more"]').addEventListener("click", () => openDealBuilder(lead));
  return el;
}
