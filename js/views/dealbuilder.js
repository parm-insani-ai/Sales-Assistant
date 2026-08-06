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
import { currency, currency2, esc, smsHref } from "../utils.js";

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

// ---------- /deals page: every customer you can put in a new car near their payment ----------
export function renderDeals(view) {
  const s = store.getSettings();
  const band = s.dealMatchBand || 50;
  const leads = store.all("leads").filter((l) => l.currentPayment != null);
  const haveInventory = store.all("vehicles").some((v) => (v.status || "available") === "available" && v.price != null);

  const opps = leads.map((l) => ({ lead: l, best: bestDealForLead(l) }))
    .filter((o) => o.best)
    .map((o) => ({ ...o, delta: o.best.delta }))
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="hero">
      <div class="hero-greeting">Deal Builder</div>
      <div class="hero-title">Payment-match deals</div>
    </div>
    <div class="fab-note" style="margin:0 2px 14px;text-align:left">Customers you can move into a new vehicle for close to what they pay now — from their imported equity data.</div>
    <div class="deals-list"></div>
  `;
  view.appendChild(el);

  const list = el.querySelector(".deals-list");
  if (!leads.length) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">${icon("dollar", "ico-xl")}</div><div class="strong">No customer payment data yet</div><div class="small">Import an AutoAlert equity export (with current payment, payoff, value) to build payment-match deals.</div><button class="btn btn-primary btn-block" data-act="import" style="margin-top:16px">${icon("file")} Import customers</button></div>`;
    list.querySelector('[data-act="import"]').addEventListener("click", () => navigate("/import"));
    return;
  }
  if (!haveInventory) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">${icon("car", "ico-xl")}</div><div class="strong">No inventory to match against</div><div class="small">Add vehicles or import your inventory, then deals appear here.</div><button class="btn btn-primary btn-block" data-act="inv" style="margin-top:16px">${icon("file")} Import inventory</button></div>`;
    list.querySelector('[data-act="inv"]').addEventListener("click", () => navigate("/import"));
    return;
  }

  opps.forEach(({ lead, best, delta }) => {
    const near = Math.abs(delta) <= band;
    const card = document.createElement("div");
    card.className = "card card-tap";
    card.innerHTML = `
      <div class="row">
        <div class="row-main">
          <div class="row-title">${esc(lead.name)}</div>
          <div class="row-sub">Pays ${currency(lead.currentPayment)}/mo · ${esc(lead.vehicleInterest || "current vehicle")}</div>
        </div>
        <span class="badge ${near ? "badge-sold" : "badge-soon"}">${near ? "≈ same pmt" : (delta > 0 ? "+" : "") + currency(Math.round(delta)) + "/mo"}</span>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="small muted">New: ${esc(vehName(best.vehicle))}</div>
        <div class="strong mono">${currency2(best.monthly)}/mo</div>
      </div>
    `;
    card.addEventListener("click", () => openDealBuilder(lead));
    list.appendChild(card);
  });

  if (!opps.length) {
    list.innerHTML = `<div class="muted small" style="text-align:center;padding:30px">No payment matches in current inventory. Try adding more vehicles.</div>`;
  }
}
