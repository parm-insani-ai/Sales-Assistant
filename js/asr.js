// Repairing what the speech engine heard.
//
// "Text 226-246-7202 the three car is ready" — the words were fine, the engine
// wasn't. Browser speech recognition is a general-purpose model with no idea
// that this person says "Sentra" forty times a day, or that "Cy Poe" is a name
// rather than two mistakes.
//
// Nothing here tries to be a better recogniser. It uses the one advantage the
// app has over the engine: it knows the vocabulary. The customers on file, the
// models on the lot, the trims — a closed set of a few hundred proper nouns
// that the engine has never seen and this app can check against.
//
// Two rules keep it from doing harm:
//
//   Only proper nouns are ever rewritten. Ordinary English is left exactly as
//   heard — "three" stays "three", because deciding it meant "the" is a guess,
//   and a wrong guess here changes what the salesperson said.
//
//   A word is only snapped to a name when it's close to exactly one of them.
//   Two plausible candidates means we don't know, and the model downstream is
//   better placed to decide from context than a distance metric is.

import * as store from "./store.js";

// Words that must never be treated as a mangled proper noun, however close
// they look. Short common words are where fuzzy matching does its damage:
// without this, "for" becomes "Ford" and "some" becomes "Sam".
const COMMON = new Set(("a an and the is are was were be been being do does did done have has had " +
  "i me my mine you your yours he him his she her hers it its we us our ours they them their " +
  "this that these those to of in on at by for with from about into over after before as if " +
  "or but so than then there here when where what which who whom whose why how all any both each " +
  "few more most other some such no nor not only own same too very can will just should now " +
  "call text email send book set add log get make made take took give gave put show tell ask " +
  "car cars truck van suv new used today tomorrow yesterday morning afternoon evening night " +
  "week month year day time ready done sold lease finance payment price deal trade appointment " +
  "one two three four five six seven eight nine ten hundred thousand am pm oclock").split(/\s+/));

const NUMBER_WORDS = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5,
  six: 6, seven: 7, eight: 8, ate: 8, nine: 9,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };

/**
 * The proper nouns this salesperson actually says: their customers, and the
 * vehicles they sell. Capped, because it also goes to the model in the system
 * prompt and an unbounded list would crowd out the instructions.
 */
export function vocabulary({ limit = 400 } = {}) {
  const names = new Set();
  const models = new Set();
  const add = (set, v) => {
    String(v || "").split(/[\s/,-]+/).forEach((w) => {
      const t = w.replace(/[^A-Za-z'’]/g, "");
      if (t.length >= 3 && !COMMON.has(t.toLowerCase())) set.add(t);
    });
  };
  store.all("leads").forEach((l) => { add(names, l.name); add(models, l.vehicleInterest); });
  store.all("vehicles").forEach((v) => { add(models, `${v.make || ""} ${v.model || ""} ${v.trim || ""}`); });
  store.all("specials").forEach((sp) => add(models, sp.model));
  return {
    names: [...names].slice(0, limit),
    models: [...models].slice(0, limit),
  };
}

// Bounded edit distance, counting a swapped pair of letters as ONE edit rather
// than two.
//
// That detail decides real cases. "Rogue" heard as "rouge" is a single
// transposition; under plain Levenshtein it costs two, which is the same price
// as "price" -> "Priya" — two substitutions, and a rewrite that would put a
// customer's name where the salesperson said a word about money. Charging a
// transposition once separates the two, so the threshold can stay tight enough
// to leave ordinary words alone while still catching the swaps that speech
// engines and typists actually produce.
function distance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      if (d[i][j] < best) best = d[i][j];
    }
    if (best > cap) return cap + 1;
  }
  return d[a.length][b.length];
}

// A run of spoken digits is a phone number. Engines transcribe these wildly
// inconsistently — "two two six" and "226" and "to too six" all mean the same
// thing, and the agent can now text a raw number, so getting this right is
// worth more than it used to be.
export function digitsFromSpeech(text) {
  const words = String(text || "").toLowerCase().split(/[\s-]+/);
  let out = "";
  let run = "";
  const flush = () => {
    if (run.length >= 7) out += (out ? " " : "") + run;
    run = "";
  };
  for (const raw of words) {
    const w = raw.replace(/[^a-z0-9]/g, "");
    if (!w) continue;
    if (/^\d+$/.test(w)) { run += w; continue; }
    if (w in NUMBER_WORDS) { run += NUMBER_WORDS[w]; continue; }
    if (w in TEENS) { run += TEENS[w]; continue; }
    if (w in TENS) { run += TENS[w]; continue; }
    flush();
  }
  flush();
  return out;
}

/**
 * Snap obvious mishearings of names and models onto the real thing.
 * Conservative by design — see the note at the top of the file.
 */
export function repair(text, vocab = vocabulary()) {
  const terms = [...vocab.names, ...vocab.models];
  if (!terms.length) return String(text || "");
  return String(text || "").replace(/[A-Za-z'’]+/g, (word) => {
    const lower = word.toLowerCase();
    if (word.length < 4 || COMMON.has(lower)) return word;
    // Already right.
    if (terms.some((t) => t.toLowerCase() === lower)) return word;
    // Allow one edit per four characters, so longer words get more latitude
    // without short ones becoming a free-for-all.
    const cap = Math.max(1, Math.floor(word.length / 4));
    let best = null, bestD = cap + 1, tied = false;
    for (const t of terms) {
      const d = distance(lower, t.toLowerCase(), cap);
      if (d > cap) continue;
      if (d < bestD) { best = t; bestD = d; tied = false; }
      else if (d === bestD && t.toLowerCase() !== String(best).toLowerCase()) tied = true;
    }
    // Ambiguous: two names are equally close. Leave it — the model reading the
    // whole sentence has context a distance metric doesn't.
    if (!best || tied) return word;
    return best;
  });
}

/**
 * Pick the likeliest of the engine's alternatives.
 *
 * Engines return several readings of the same audio and the app takes the
 * first. The first is only the engine's best guess in general English; the one
 * that mentions a customer who exists is almost always the right one here.
 */
export function pickBest(alternatives, vocab = vocabulary()) {
  const list = (alternatives || []).map((a) => String(a || "").trim()).filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  const terms = new Set([...vocab.names, ...vocab.models].map((t) => t.toLowerCase()));
  const score = (t) => {
    let hits = 0;
    for (const w of t.toLowerCase().match(/[a-z'’]+/g) || []) if (terms.has(w)) hits++;
    // Digits are worth something too: a reading that resolves to a phone
    // number is more likely right than one that scattered it into words.
    return hits * 2 + (digitsFromSpeech(t) ? 1 : 0);
  };
  let best = list[0], bestScore = score(list[0]);
  for (let i = 1; i < list.length; i++) {
    const s = score(list[i]);
    // Strictly greater: ties go to the engine's own ranking, which knows things
    // about the audio that this doesn't.
    if (s > bestScore) { best = list[i]; bestScore = s; }
  }
  return best;
}

// What the recogniser should be asked to listen for. A Canadian phone gets
// en-CA, which handles local place and street names better than en-US.
export function recognitionLang() {
  const l = String(navigator.language || "");
  return /^en/i.test(l) ? l : "en-US";
}
