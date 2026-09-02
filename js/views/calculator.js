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
  // Program residuals are a % of MSRP — pass msrp when the cap cost already
  // has lease cash or add-ons folded in, so the residual isn't distorted.
  const residual = num(input.msrp || input.price) * residualPct;
  const depreciation = (adjCap - residual) / term;
  const rent = (adjCap + residual) * mf;
  let base = depreciation + rent;
  // Equity bigger than the lease needs drives the payment negative. A "$0/mo"
  // row isn't a quotable offer — cap it at zero and report the surplus, which
  // is the real pitch: the trade covers the lease and hands money back.
  let surplus = 0;
  if (base < 0) { surplus = Math.round(-base * term); base = 0; }
  const tax = base * taxRate;
  return { monthly: base + tax, residual, term, surplus };
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

  // Finance or lease, remembered between visits; a quoted lease row lands here
  // in lease mode automatically.
  let method = pfVal("method", sessionStorage.getItem("calc-method") || "finance");

  const el = document.createElement("div");
  const draw = () => {
    const isLease = method === "lease";
    el.innerHTML = `
      ${prefillLabel ? `<div class="card" style="border-color:var(--primary)"><div class="small muted">Quoting</div><div class="strong">${esc(prefillLabel)}</div></div>` : ""}

      <div class="btn-row" style="margin-bottom:12px">
        <button class="btn ${isLease ? "btn-ghost" : "btn-primary"}" data-method="finance" style="flex:1">Finance</button>
        <button class="btn ${isLease ? "btn-primary" : "btn-ghost"}" data-method="lease" style="flex:1">Lease</button>
      </div>

      <div class="card">
        <div class="field-inline">
          <div class="field"><label>${isLease ? "MSRP / cap cost" : "Sale price"}</label><input id="c-price" type="number" inputmode="decimal" placeholder="0" value="${esc(prefillPrice)}"></div>
          <div class="field"><label>${isLease ? "Cash down (cap reduction)" : "Cash down"}</label><input id="c-down" type="number" inputmode="decimal" placeholder="0" value="${esc(pfVal("down", ""))}"></div>
        </div>
        <div class="field-inline">
          <div class="field"><label>Trade allowance</label><input id="c-trade" type="number" inputmode="decimal" placeholder="0" value="${esc(pfVal("tradeAllowance", ""))}"></div>
          <div class="field"><label>Trade payoff</label><input id="c-payoff" type="number" inputmode="decimal" placeholder="0" value="${esc(pfVal("tradePayoff", ""))}"></div>
        </div>
        <div class="field-inline">
          <div class="field"><label>Doc / fees</label><input id="c-fees" type="number" inputmode="decimal" value="${esc(pfVal("fees", s.docFee))}"></div>
          <div class="field"><label>Tax rate %</label><input id="c-tax" type="number" inputmode="decimal" step="0.01" value="${esc(s.taxRate)}"></div>
        </div>
        <div class="field-inline">
          <div class="field"><label>${isLease ? "Lease rate %" : "APR %"}</label><input id="c-apr" type="number" inputmode="decimal" step="0.01" value="${esc(pfVal("apr", s.defaultApr))}"></div>
          <div class="field"><label>Term (months)</label><input id="c-term" type="number" inputmode="numeric" value="${esc(pfVal("term", isLease ? (s.leaseTerm || 36) : s.defaultTerm))}"></div>
        </div>
        ${isLease ? `
        <div class="field-inline">
          <div class="field"><label>Residual % of MSRP</label><input id="c-res" type="number" inputmode="decimal" step="0.1" value="${esc(pfVal("resPct", s.leaseResidualPct || 58))}"></div>
          <div class="field"><label>MSRP (residual base)</label><input id="c-msrp" type="number" inputmode="decimal" placeholder="same as cap cost" value="${esc(pfVal("msrp", ""))}"></div>
        </div>
        <div class="hint" style="margin-bottom:6px">Residual comes off MSRP, not the cap cost — that's why lease cash and fees lower the payment without shrinking the buyout. Rate and residual are on the program sheet for this trim and term.</div>` : ""}
        <div class="btn-row" style="margin-top:4px">
          ${(isLease ? [24, 36, 48, 60] : [24, 36, 48, 60, 72, 84]).map((t) => `<button class="btn btn-sm btn-ghost" data-term="${t}" style="flex:1">${t}</button>`).join("")}
        </div>
      </div>

      <div class="card" id="c-result" style="border-color:var(--accent)"></div>

      <div class="fab-note">Estimate only — taxes, fees and program details vary by deal. Confirm final figures with your desk.</div>
    `;

    const get = (k) => el.querySelector(`#c-${k}`);
    const result = el.querySelector("#c-result");

    function recompute() {
      const common = {
        price: get("price").value,
        down: get("down").value,
        tradeAllowance: get("trade").value,
        tradePayoff: get("payoff").value,
        fees: get("fees").value,
        taxRate: get("tax").value,
        apr: get("apr").value,
        term: get("term").value,
      };
      if (isLease) {
        const l = computeLease({ ...common, residualPct: get("res").value, msrp: get("msrp").value || common.price });
        result.innerHTML = `
          <div class="kv kv-total"><span class="k strong">Est. lease payment</span><span class="v mono">${currency2(l.monthly)}<span class="muted small">/mo</span></span></div>
          ${l.surplus ? `<div class="kv"><span class="k">Equity beyond the lease</span><span class="v mono" style="color:var(--success)">${currency(l.surplus)} back</span></div>` : ""}
          <hr class="divider" />
          <div class="kv"><span class="k">Residual value</span><span class="v mono">${currency(l.residual)}</span></div>
          <div class="kv"><span class="k">Term</span><span class="v mono">${l.term} mo</span></div>
          <div class="kv"><span class="k">Total of payments</span><span class="v mono">${currency(l.monthly * l.term)}</span></div>
          <div class="kv"><span class="k">Tax</span><span class="v mono">included in the payment</span></div>
        `;
      } else {
        const d = computeDeal(common);
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
    }

    ["price", "down", "trade", "payoff", "fees", "tax", "apr", "term", "res", "msrp"]
      .forEach((k) => { const n = get(k); if (n) n.addEventListener("input", recompute); });
    el.querySelectorAll("[data-term]").forEach((b) =>
      b.addEventListener("click", () => { get("term").value = b.dataset.term; recompute(); }));
    // Switching method keeps whatever is already typed in the shared fields.
    el.querySelectorAll("[data-method]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.method === method) return;
        const keep = {};
        ["price", "down", "trade", "payoff", "fees", "tax"].forEach((k) => { keep[k] = get(k).value; });
        method = b.dataset.method;
        sessionStorage.setItem("calc-method", method);
        pf = null; // typed values win over a stale prefill
        prefillPrice = keep.price;
        draw();
        ["down", "trade", "payoff", "fees", "tax"].forEach((k) => { const n = el.querySelector(`#c-${k}`); if (n) n.value = keep[k]; });
        el.querySelector("#c-result") && el.querySelectorAll("[data-term]").length && el.querySelector("#c-price").dispatchEvent(new Event("input"));
      }));

    recompute();
  };

  view.appendChild(el);
  draw();
}
