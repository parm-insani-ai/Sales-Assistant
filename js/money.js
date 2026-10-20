// The one rule every text to a customer passes through: no figure. Not a
// price, not a payment, not a rate, not what a trade is worth — numbers
// stay for the desk. Deliberately broad: the cost of a false positive is a
// sentence retyped, the cost of a miss is a number a salesperson has to
// walk back with a real customer. The same expression runs on the phone
// (every send path) and in the function (every send), so the typed, the
// dictated, the drafted and the manager's all meet it.

const NUM_WORDS = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|a couple|a few|several)";
const MONEY = new RegExp([
  String.raw`\$\s?\d`,                                   // $14,000  $ 300
  String.raw`\d+\s?(%|percent)`,                         // 4.9%  5 percent
  String.raw`\bapr\b`,
  String.raw`\b\d{2,3}\s?(a|per)\s?(month|mo|week|wk)\b`, // 300 a month
  String.raw`\b\d[\d,]{2,}\s?(dollars|bucks)\b`,         // 14,000 dollars
  String.raw`\b\d+(\.\d+)?\s?k\b`,                       // 14k  3.5k
  String.raw`\b\d[\d,]*\s?grand\b`,                      // 14 grand
  String.raw`\bmonthly\s+payment(\s+\w+){0,2}\s+\d|\bmonthly\s+is\s+\d`,
  String.raw`\b` + NUM_WORDS + String.raw`[\w\s-]{0,24}\b(thousand|grand|dollars|bucks)\b`, // fourteen thousand
].join("|"), "i");

export function looksLikeMoney(text) {
  return MONEY.test(String(text || ""));
}
export const MONEY_MESSAGE = "No figures in a text to a customer — take the dollar amount or rate out";
