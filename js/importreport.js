// What a file gives you.
//
// A spreadsheet from the dealer is the only input, and the whole read of
// the book — same payment, equity, a contract ending, years in the car, a
// rate worth beating, a warranty running out, a service visit coming — is
// made of its columns. So the one thing to know before importing is which
// of those reasons this file can support, on what share of its rows, and
// what's missing: the column to ask the dealer for next time is often the
// whole difference between a weak book and a strong one. Pure: rows and a
// mapping in, a report out.

// Each reason the read can find, the fields that give it, and what to ask
// for when they're absent. `any` means one of the groups suffices; a group
// is every field in it.
export const REASONS = [
  { key: "reach", label: "A way to reach them", any: [["phone"], ["email"]], ask: "a phone number on every row", vital: true },
  { key: "payment", label: "Same or cheaper payment", any: [["currentPayment"]], ask: "the current monthly payment" },
  { key: "equity", label: "Equity in the trade", any: [["equity"], ["payoff", "currentValue"], ["currentPayment", "paymentsLeft", "currentValue"]], ask: "payoff (or payments remaining) and a trade value" },
  { key: "ending", label: "Contract ending", any: [["leaseEnd"], ["paymentsLeft"], ["currentTerm", "purchaseDate"]], ask: "lease end dates, or payments remaining (or term and purchase date)" },
  { key: "cycle", label: "Years in the car", any: [["purchaseDate"]], ask: "the purchase date" },
  { key: "warranty", label: "Warranty ending", any: [["purchaseDate"], ["odometer"]], ask: "the purchase date and odometer" },
  { key: "rate", label: "A rate worth beating", any: [["currentApr"]], ask: "the APR they carry" },
  { key: "service", label: "A service visit coming", any: [["serviceAppt"], ["lastService"]], ask: "upcoming service appointments" },
  { key: "lease", label: "Lease or finance", any: [["dealType"], ["leaseEnd"]], ask: "the deal type" },
];

const has = (v) => v != null && String(v).trim() !== "";

/**
 * fileReport(rows, mapping) → { rows, fields: {field: n}, reasons: [{key,
 * label, n, share, state, ask}], unlocked, missing, headline, asks }.
 * `rows` are the parsed rows (header → cell); `mapping` is field → header.
 */
export function fileReport(rows, mapping) {
  const total = rows.length;
  const fields = {};
  Object.entries(mapping || {}).forEach(([field, header]) => {
    if (!header || field.startsWith("_")) return;
    fields[field] = rows.reduce((n, r) => n + (has(r[header]) ? 1 : 0), 0);
  });
  const vehicle = rows.reduce((n, r) => n + ((mapping.vehicleInterest && has(r[mapping.vehicleInterest])) || (mapping.vehModel && has(r[mapping.vehModel])) ? 1 : 0), 0);
  // A reason holds on a row when one of its groups is complete there.
  const reasons = REASONS.map((d) => {
    const groups = d.any.filter((g) => g.every((f) => mapping[f]));
    let n = 0;
    if (groups.length) n = rows.reduce((c, r) => c + (groups.some((g) => g.every((f) => has(r[mapping[f]]))) ? 1 : 0), 0);
    const share = total ? n / total : 0;
    const state = !groups.length || !n ? "missing" : share >= 0.6 ? "good" : "partial";
    return { key: d.key, label: d.label, n, share, state, ask: d.ask, vital: !!d.vital };
  });
  const unlocked = reasons.filter((r) => r.state !== "missing" && r.key !== "reach");
  const missing = reasons.filter((r) => r.state === "missing");
  const partial = reasons.filter((r) => r.state === "partial");
  const reach = reasons.find((r) => r.key === "reach");
  const unreachable = total - reach.n;
  // What to ask the dealer for, most valuable first: the vital one, then
  // the columns only some rows carry (the cheapest win — the column exists,
  // it wants filling), then the reasons missing outright.
  const asks = [
    ...(unreachable ? [`${unreachable === total ? "Phone numbers" : `A number for the ${unreachable.toLocaleString()} row${unreachable === 1 ? "" : "s"} without one`} — nobody can be reached without one.`] : []),
    ...partial.filter((r) => r.key !== "reach").map((r) => `${cap(r.ask)} on every row — "${r.label}" holds on ${Math.round(r.share * 100)}% now.`),
    ...missing.filter((r) => r.key !== "reach").map((r) => `${cap(r.ask)} — unlocks "${r.label}".`),
  ].slice(0, 6);
  const headline = !total ? "Nothing to read."
    : unlocked.length >= 5 ? `A strong file: ${unlocked.length} of ${REASONS.length - 1} reasons on ${pctWord(unlocked)}.`
    : unlocked.length >= 3 ? `A fair file: ${unlocked.length} of ${REASONS.length - 1} reasons on ${pctWord(unlocked)}.`
    : unlocked.length ? `A thin file: ${unlocked.length} reason${unlocked.length === 1 ? "" : "s"} to call on. The rest is a name and a number.`
    : "A list of names — no column here gives a reason to call. Ask for the payment, payoff and value columns.";
  return { rows: total, fields, vehicle, reasons, unlocked, missing, partial, unreachable, headline, asks };
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function pctWord(list) {
  const avg = list.reduce((s, r) => s + r.share, 0) / list.length;
  return avg >= 0.85 ? "nearly every row" : avg >= 0.5 ? "most rows" : "some rows";
}
