// The one rule every text to a customer passes through: no figure. Not a
// price, not a payment, not a rate, not what a trade is worth — numbers
// stay for the desk. Deliberately broad: the cost of a false positive is a
// sentence retyped, the cost of a miss is a number a salesperson has to
// walk back with a real customer. The same expression runs on the phone
// (every send path) and in the function (every send), so the typed, the
// dictated, the drafted and the manager's all meet it.
//
// The one carve-out: advertised content. A figure that matches a current
// special on file — the manufacturer's 0% financing, the advertised lease
// payment, the cash on the hood — may be said, because the store already
// says it on its website and its signs. Anything else with a number in it
// is still refused: a trade value, a payment worked out at the desk, a
// discount nobody advertised. The store's specials are the list, so what
// may be quoted is on the Specials page, not in anyone's head.

const NUM_WORDS = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|a couple|a few|several)";
const SOURCE = [
  String.raw`\$\s?\d[\d,]*(?:\.\d+)?k?`,                   // $14,000  $ 300  $3.5k
  String.raw`\d+(?:\.\d+)?\s?(?:%|percent)`,               // 4.9%  5 percent
  String.raw`\bapr\b`,
  String.raw`\b\d{2,3}\s?(?:a|per)\s?(?:month|mo|week|wk)\b`, // 300 a month
  String.raw`\b\d[\d,]{2,}\s?(?:dollars|bucks)\b`,         // 14,000 dollars
  String.raw`\b\d+(?:\.\d+)?\s?k\b`,                       // 14k  3.5k
  String.raw`\b\d[\d,]*\s?grand\b`,                        // 14 grand
  String.raw`\bmonthly\s+payment(?:\s+\w+){0,2}\s+\d|\bmonthly\s+is\s+\d`,
  String.raw`\b` + NUM_WORDS + String.raw`[\w\s-]{0,24}\b(?:thousand|grand|dollars|bucks)\b`, // fourteen thousand
].join("|");
const MONEY = new RegExp(SOURCE, "i");
const MONEY_ALL = new RegExp(SOURCE, "gi");

// One figure, as a key: "$14000", "0%", "300/mo" — so "0 %" and "0%" and
// "zero percent financing on a sign" compare equal.
export function figureKey(m) {
  const s = String(m || "").toLowerCase().replace(/,/g, "");
  let x;
  if ((x = /\$\s?(\d+(?:\.\d+)?)(k)?/.exec(s))) return "$" + (x[2] ? Number(x[1]) * 1000 : Number(x[1]));
  if ((x = /(\d+(?:\.\d+)?)\s?(?:%|percent)/.exec(s))) return Number(x[1]) + "%";
  if ((x = /(\d{2,3})\s?(?:a|per)\s?(?:month|mo|week|wk)/.exec(s))) return x[1] + "/mo";
  if ((x = /(\d+(?:\.\d+)?)\s?k\b/.exec(s))) return "$" + Number(x[1]) * 1000;
  if ((x = /(\d+)\s?grand/.exec(s))) return "$" + Number(x[1]) * 1000;
  if ((x = /(\d+)\s?(?:dollars|bucks)/.exec(s))) return "$" + Number(x[1]);
  return s.trim();
}

// What the store advertises, from its specials on file (unexpired): the
// finance rate, the lease payment and what's down, the cash, and any figure
// written in the notes. Keys as figureKey makes them.
export function advertisedFigures(specials, today = new Date().toISOString().slice(0, 10)) {
  const keys = new Set();
  const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  for (const sp of specials || []) {
    if (!sp || (sp.expiry && String(sp.expiry).slice(0, 10) < today)) continue;
    const apr = num(sp.financeApr); if (apr != null) keys.add(apr + "%");
    const lp = num(sp.leasePayment); if (lp) { keys.add("$" + lp); keys.add(lp + "/mo"); }
    const ld = num(sp.leaseDown); if (ld) keys.add("$" + ld);
    const cash = num(sp.cash); if (cash) keys.add("$" + cash);
    for (const m of String(sp.notes || "").match(MONEY_ALL) || []) keys.add(figureKey(m));
  }
  return keys;
}

// The store's advertised figures, kept here by the store (store.js) as the
// specials change, so every check on the phone sees the same list.
let ADVERTISED = new Set();
export function setAdvertised(keys) { ADVERTISED = keys instanceof Set ? keys : new Set(keys || []); }
export function advertised() { return ADVERTISED; }

// The figures in a text that aren't advertised: each as it was written,
// with where it sits. "APR" beside an advertised rate is part of the ad.
export function moneyIn(text, allowed = ADVERTISED) {
  const s = String(text || "");
  const out = [];
  for (const m of s.matchAll(MONEY_ALL)) {
    const hit = m[0];
    if (/^apr$/i.test(hit)) { if ([...allowed].some((k) => /%$/.test(k))) continue; }
    else if (allowed.has(figureKey(hit))) continue;
    out.push({ text: hit, at: m.index, end: m.index + hit.length });
  }
  return out;
}
export function looksLikeMoney(text, allowed = ADVERTISED) {
  if (!MONEY.test(String(text || ""))) return false;
  return moneyIn(text, allowed).length > 0;
}
export const MONEY_MESSAGE = "No figures in a text to a customer — take the dollar amount or rate out";
