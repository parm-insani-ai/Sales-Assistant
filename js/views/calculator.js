// Payment & deal calculator. Estimates monthly payment from price, trade,
// down, fees, tax, APR and term.

import * as store from "../store.js";
import { currency, currency2, esc } from "../utils.js";
import { toast } from "../components.js";

// Core deal math, exported so it can be unit-tested / reused.
export function computeDeal(input) {
  const price = num(input.price);
  const down = num(input.down);
  const tradeAllowance = num(input.tradeAllowance);
  const tradePayoff = num(input.tradePayoff);
  const fees = num(input.fees);
  const taxRate = num(input.taxRate) / 100;
  const apr = num(input.apr) / 100;
  const term = Math.max(0, Math.round(num(input.term)));

  // Trading in at a dealer, tax applies to price minus the trade allowance
  // (NS: 14% HST on the difference) — the trade-in tax credit.
  const taxableBase = Math.max(0, price - tradeAllowance);
  const tax = taxableBase * taxRate;

  const netTradeEquity = tradeAllowance - tradePayoff; // can be negative
  const amountFinanced = Math.max(0, price + tax + fees - down - netTradeEquity);

  const r = apr / 12;
  let monthly = 0;
  if (term > 0) {
    monthly = r === 0 ? amountFinanced / term
      : (amountFinanced * r) / (1 - Math.pow(1 + r, -term));
  }
  const totalOfPayments = monthly * term;
  const totalInterest = Math.max(0, totalOfPayments - amountFinanced);

  return { price, tax, taxableBase, fees, netTradeEquity, amountFinanced, monthly, totalOfPayments, totalInterest, term };
}

function num(v) { return Number(v) || 0; }

export function renderCalculator(view) {
  const s = store.getSettings();

  // Optional prefill from an inventory vehicle or the Deal Builder.
  let prefillLabel = "";
  let prefillPrice = "";
  let pf = null;
  try {
    pf = JSON.parse(sessionStorage.getItem("calc-prefill") || "null");
    if (pf) { prefillPrice = pf.price ?? ""; prefillLabel = pf.label || ""; sessionStorage.removeItem("calc-prefill"); }
  } catch {}
  const pfVal = (k, d) => (pf && pf[k] != null && pf[k] !== "" ? pf[k] : d);

  const el = document.createElement("div");
  el.innerHTML = `
    ${prefillLabel ? `<div class="card" style="border-color:var(--primary)"><div class="small muted">Quoting</div><div class="strong">${esc(prefillLabel)}</div></div>` : ""}

    <div class="card">
      <div class="field-inline">
        <div class="field"><label>Sale price</label><input id="c-price" type="number" inputmode="decimal" placeholder="0" value="${esc(prefillPrice)}"></div>
        <div class="field"><label>Cash down</label><input id="c-down" type="number" inputmode="decimal" placeholder="0"></div>
      </div>
      <div class="field-inline">
        <div class="field"><label>Trade allowance</label><input id="c-trade" type="number" inputmode="decimal" placeholder="0" value="${esc(pfVal("tradeAllowance", ""))}"></div>
        <div class="field"><label>Trade payoff</label><input id="c-payoff" type="number" inputmode="decimal" placeholder="0" value="${esc(pfVal("tradePayoff", ""))}"></div>
      </div>
      <div class="field-inline">
        <div class="field"><label>Doc / fees</label><input id="c-fees" type="number" inputmode="decimal" value="${esc(s.docFee)}"></div>
        <div class="field"><label>Tax rate %</label><input id="c-tax" type="number" inputmode="decimal" step="0.01" value="${esc(s.taxRate)}"></div>
      </div>
      <div class="field-inline">
        <div class="field"><label>APR %</label><input id="c-apr" type="number" inputmode="decimal" step="0.01" value="${esc(pfVal("apr", s.defaultApr))}"></div>
        <div class="field"><label>Term (months)</label><input id="c-term" type="number" inputmode="numeric" value="${esc(s.defaultTerm)}"></div>
      </div>
      <div class="btn-row" style="margin-top:4px">
        ${[48, 60, 72, 84].map((t) => `<button class="btn btn-sm btn-ghost" data-term="${t}" style="flex:1">${t}</button>`).join("")}
      </div>
    </div>

    <div class="card" id="c-result" style="border-color:var(--accent)"></div>

    <div class="fab-note">Estimate only — taxes and fees vary by state and deal. Confirm final figures with your F&amp;I desk.</div>
  `;
  view.appendChild(el);

  const ids = ["price", "down", "trade", "payoff", "fees", "tax", "apr", "term"];
  const get = (k) => el.querySelector(`#c-${k}`);
  const result = el.querySelector("#c-result");

  function recompute() {
    const d = computeDeal({
      price: get("price").value,
      down: get("down").value,
      tradeAllowance: get("trade").value,
      tradePayoff: get("payoff").value,
      fees: get("fees").value,
      taxRate: get("tax").value,
      apr: get("apr").value,
      term: get("term").value,
    });
    result.innerHTML = `
      <div class="kv kv-total"><span class="k strong">Est. monthly</span><span class="v mono">${currency2(d.monthly)}<span class="muted small">/mo</span></span></div>
      <hr class="divider" />
      <div class="kv"><span class="k">Taxable base</span><span class="v mono">${currency(d.taxableBase)}</span></div>
      <div class="kv"><span class="k">Sales tax</span><span class="v mono">${currency(d.tax)}</span></div>
      <div class="kv"><span class="k">Net trade equity</span><span class="v mono">${currency(d.netTradeEquity)}</span></div>
      <div class="kv"><span class="k">Amount financed</span><span class="v mono">${currency(d.amountFinanced)}</span></div>
      <div class="kv"><span class="k">Total of payments</span><span class="v mono">${currency(d.totalOfPayments)}</span></div>
      <div class="kv"><span class="k">Total interest</span><span class="v mono">${currency(d.totalInterest)}</span></div>
    `;
  }

  ids.forEach((k) => get(k).addEventListener("input", recompute));
  el.querySelectorAll("[data-term]").forEach((b) =>
    b.addEventListener("click", () => { get("term").value = b.dataset.term; recompute(); }));

  recompute();
}
