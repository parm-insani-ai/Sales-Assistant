// A customer's current contract, read plainly from whatever is on file.
//
// The book carries the facts in pieces — a payment, payments left as of an
// import date, a maturity date, an original term, a purchase date, a deal
// type — and no two customers have the same pieces. This turns whatever is
// there into one reading: what they pay, how many payments are left, when it
// matures, and whether it's already paid off. Pure, so node can test it.

const MONTH = 30.44 * 86400000;
const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
const parse = (iso) => { if (!iso) return null; const d = new Date(String(iso).length === 10 ? iso + "T12:00:00" : iso); return isNaN(d) ? null : d; };
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), 28));
const monthLabel = (d) => d.toLocaleDateString("en-CA", { month: "short", year: "numeric" });
const fmtMoney = (n) => "$" + Math.round(Number(n)).toLocaleString("en-CA");

/**
 * Payments left on the contract, as of `now`. Prefers a stated count (aged
 * by the months since it was stated), then a maturity date, then purchase
 * date + term. Null when nothing says.
 */
export function paymentsLeftOf(lead, now = new Date()) {
  const stated = num(lead.paymentsLeft);
  if (stated != null) {
    const asOf = parse(lead.paymentsLeftAsOf) || parse(lead.updatedAt) || parse(lead.createdAt) || now;
    const elapsed = Math.max(0, Math.floor((now - asOf) / MONTH));
    return { left: Math.max(0, Math.round(stated - elapsed)), src: "stated", asOf };
  }
  let end = parse(lead.leaseEnd);
  let src = "maturity";
  const term = num(lead.currentTerm);
  if (!end && lead.purchaseDate && term) { const p = parse(lead.purchaseDate); if (p) { end = addMonths(p, term); src = "term"; } }
  if (!end) return null;
  return { left: Math.max(0, Math.round((end - now) / MONTH)), src, end };
}

/**
 * The contract in one object:
 *   payment, left, matures (Date|null), paidOff, type ("Lease"|"Finance"|""),
 *   term, paid (payments made, when the term is known), payoff, apr,
 *   line (one short line for a card), rows ([label, value] for a page).
 * Null when nothing about a contract is on file.
 */
export function contractSummary(lead, now = new Date()) {
  const payment = num(lead.currentPayment);
  const term = num(lead.currentTerm);
  const payoff = num(lead.payoff);
  const apr = num(lead.currentApr);
  const purchase = parse(lead.purchaseDate);
  const leftInfo = paymentsLeftOf(lead, now);
  const dealType = String(lead.dealType || "");
  const type = /lease/i.test(dealType) || /deal type:\s*lease/i.test(String(lead.notes || "")) ? "Lease"
    : /retail|finance|loan|purchase/i.test(dealType) ? "Finance" : lead.leaseEnd && !dealType ? "Lease" : "";
  if (payment == null && !leftInfo && payoff == null && !term && !purchase) return null;

  const left = leftInfo ? leftInfo.left : null;
  const matures = leftInfo ? (leftInfo.end || addMonths(leftInfo.asOf || now, num(lead.paymentsLeft) || 0)) : null;
  const paidOff = left != null && left <= 0;
  const paid = term && left != null ? Math.max(0, Math.min(term, term - left)) : term && purchase ? Math.max(0, Math.min(term, Math.floor((now - purchase) / MONTH))) : null;

  // One line for a card: "$532/mo · 23 payments left · matures Aug 2028".
  const bits = [];
  if (payment != null) bits.push(paidOff ? `was ${fmtMoney(payment)}/mo` : `${fmtMoney(payment)}/mo`);
  if (paidOff) bits.push(`paid off${matures ? " " + monthLabel(matures) : ""}`);
  else if (left != null) bits.push(`${left} payment${left === 1 ? "" : "s"} left${matures ? ", matures " + monthLabel(matures) : ""}`);
  else if (term && purchase) bits.push(`${term}-mo term from ${monthLabel(purchase)}`);
  else if (payoff != null) bits.push(`${fmtMoney(payoff)} owing`);
  if (type && !paidOff) bits.unshift(type);
  const line = bits.join(" · ");

  // The page's rows.
  const rows = [];
  if (payment != null) rows.push(["Payment", `${fmtMoney(payment)}/mo${type ? " · " + type.toLowerCase() : ""}`]);
  if (paidOff) rows.push(["Payments left", `Paid off${matures ? " · matured " + monthLabel(matures) : ""}`]);
  else if (left != null) rows.push(["Payments left", `${left}${term ? " of " + term : ""}${leftInfo.src === "stated" && leftInfo.asOf ? ` · as of ${leftInfo.asOf.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}` : ""}`]);
  else if (term) rows.push(["Term", `${term} months${purchase ? " from " + monthLabel(purchase) : ""}`]);
  if (matures && !paidOff) rows.push(["Matures", matures.toLocaleDateString("en-CA", { month: "long", year: "numeric" })]);
  if (payoff != null) rows.push(["Payoff", fmtMoney(payoff)]);
  if (apr != null) rows.push(["Rate", `${apr}%`]);
  if (purchase) rows.push(["Since", monthLabel(purchase)]);

  return { payment, left, matures, paidOff, type, term, paid, payoff, apr, purchase, line, rows, src: leftInfo ? leftInfo.src : null };
}
