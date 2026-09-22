// Questions about the lot, answered from the lot.
//
// "Do we have any Rogue SVs?", "how many kilometres on the Civic Sport?",
// "what's the cheapest used SUV under thirty?", "what's stock NHP1868 going
// for?" — every one of these is answered exactly by the vehicles collection,
// which the daily import keeps in line with the store's website. The prices
// spoken here are the website's own, never a catalogue figure.
//
// Pure functions over a vehicles array, so node can test them and both the
// agent tool and the offline voice parser share one reading of a sentence.

const BODIES = [
  [/\b(suvs?|crossovers?|cuvs?)\b/, /suv|crossover|cuv/i],
  [/\b(sedans?)\b/, /sedan/i],
  [/\b(trucks?|pickups?|pick-ups?)\b/, /truck|pickup/i],
  [/\b(hatch(backs?)?)\b/, /hatch/i],
  [/\b(vans?|minivans?)\b/, /van/i],
  [/\b(coupes?)\b/, /coupe/i],
  [/\b(convertibles?)\b/, /convertible/i],
  [/\b(wagons?)\b/, /wagon/i],
];
const FUELS = [
  [/\b(evs?|electrics?|battery|fully electric)\b/, /electric/i],
  [/\b(plug-?in|phevs?)\b/, /plug/i],
  [/\b(hybrids?)\b/, /hybrid/i],
  [/\b(diesels?)\b/, /diesel/i],
];
const COLOURS = ["black", "white", "grey", "gray", "silver", "red", "blue", "green", "orange", "brown", "beige", "gold", "yellow", "burgundy", "purple", "tan", "bronze", "pearl"];
const SMALL = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
const STOP = new Set(["the", "a", "an", "any", "do", "we", "have", "got", "in", "on", "lot", "stock", "inventory", "what", "whats", "is", "are", "there", "how", "many", "much", "price", "of", "for", "to", "and", "or", "with", "under", "over", "than", "less", "more", "cheapest", "newest", "lowest", "highest", "best", "km", "kms", "kilometres", "kilometers", "mileage", "show", "me", "list", "find", "cars", "car", "vehicles", "vehicle", "units", "unit", "available", "left", "still", "new", "used", "certified", "one", "ones", "some", "about", "around", "up", "at", "does", "it", "that", "this", "our", "my", "your", "going", "listed", "cost", "costs", "does", "which", "who", "please", "hey", "ok", "okay", "so", "um", "like", "get", "us", "tell", "know", "want", "looking", "need", "just"]);

function words(text) {
  return String(text || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9$.,+\- ]+/g, " ").split(/\s+/).filter(Boolean);
}
// "thirty" → 30, "thirty five" → 35, "30k" / "30 grand" / "30 thousand" → 30000.
function spokenNumbers(text) {
  let t = " " + String(text || "").toLowerCase() + " ";
  t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/g, (m, a, b) => String(SMALL[a] + SMALL[b]));
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(hundred)\b/g, (m, a) => String(SMALL[a] * 100));
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/g, (m) => String(SMALL[m]));
  t = t.replace(/(\d[\d,]*(?:\.\d+)?)\s*(k|grand|thousand)\b/g, (m, n) => String(Math.round(Number(n.replace(/,/g, "")) * 1000)));
  return t;
}
const money = (s) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;
function singular(w) { return w.length >= 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w; }
// One edit apart — a swapped pair counts once — for the speech engine's
// spelling of a model name ("rouge" for Rogue).
function close(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; for (let j = 1; j <= b.length; j++) d[i][j] = i === 0 ? j : 0; }
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length] <= 1;
}

// What the lot itself is called: every make, model and trim on it, lowercased.
export function lotVocabulary(vehicles) {
  const makes = new Set(), models = new Set(), trims = new Set(), modelWords = new Set();
  (vehicles || []).forEach((v) => {
    const mk = String(v.make || "").toLowerCase().trim(); if (mk) makes.add(mk);
    const md = String(v.model || "").toLowerCase().trim(); if (md) { models.add(md); md.split(/[\s-]+/).forEach((w) => { if (w.length >= 2) modelWords.add(w); }); }
    String(v.trim || "").toLowerCase().split(/[\s/,]+/).forEach((w) => { if (w && !/^\d+$/.test(w)) trims.add(w); });
  });
  return { makes, models, trims, modelWords };
}

/**
 * Read a sentence about the lot into filters and an ask.
 * Returns null when the sentence isn't about the lot at all.
 */
export function parseLotQuestion(text, vehicles, hints = {}) {
  const raw = String(text || "");
  const t = spokenNumbers(raw);
  const ws = words(t);
  const vocab = lotVocabulary(vehicles);
  const f = { models: [], makes: [], trims: [], condition: hints.condition || "", body: hints.body || "", fuel: hints.fuel || "", drive: "", colour: hints.color || "", stock: hints.stock || "", year: null, minYear: null, maxPrice: hints.maxPrice || null, minPrice: hints.minPrice || null, maxKm: hints.maxKm || null, sort: hints.sort || "", ask: hints.ask || "", certified: false };
  let hits = 0;

  // Condition.
  if (/\b(brand new|new)\b/.test(t) && !/\bnewest\b/.test(t)) { f.condition = "New"; hits++; }
  if (/\b(used|pre-?owned|second-?hand|trade-?ins?)\b/.test(t)) { f.condition = "Used"; hits++; }
  if (/\b(certified|cpo)\b/.test(t)) { f.certified = true; f.condition = f.condition || "Used"; hits++; }
  if (/\b(demos?|demonstrators?)\b/.test(t)) { f.demo = true; hits++; }
  for (const [re, m] of BODIES) if (re.test(t)) { f.body = m; hits++; break; }
  for (const [re, m] of FUELS) if (re.test(t)) { f.fuel = m; hits++; break; }
  if (/\b(awd|4wd|4x4|all-?wheel|four-?wheel)\b/.test(t)) { f.drive = /all|4|four/i; hits++; }
  for (const c of COLOURS) if (new RegExp(`\\b${c}\\b`).test(t)) { f.colour = c === "gray" ? "grey" : c; hits++; break; }

  // Money: "under 30000", "less than $25,000", "around 30000", "between 20000 and 30000".
  const btw = /\bbetween\s+\$?(\d[\d,]*)\s+and\s+\$?(\d[\d,]*)/.exec(t);
  if (btw) { f.minPrice = money(btw[1]); f.maxPrice = money(btw[2]); hits++; }
  const under = /\b(under|below|less than|cheaper than|max(?:imum)?|up to|no more than|at most|within)\s+\$?(\d[\d,]*(?:\.\d+)?)(?![\d,.])(?!\s*(?:km|kms|kilomet|clicks|k\b))/.exec(t);
  if (under && !btw) { let n = money(under[2]); if (n > 0 && n < 1000) n *= 1000; f.maxPrice = n; hits++; }
  const over = /\b(over|above|more than|at least|min(?:imum)?)\s+\$?(\d[\d,]*(?:\.\d+)?)(?![\d,.])(?!\s*(?:km|kms|kilomet|clicks|k\b))/.exec(t);
  if (over && !btw) { let n = money(over[2]); if (n > 0 && n < 1000) n *= 1000; f.minPrice = n; hits++; }
  const around = /\b(around|about|roughly|near)\s+\$?(\d[\d,]*(?:\.\d+)?)(?![\d,.])(?!\s*(?:km|kms|kilomet))/.exec(t);
  if (around && !under && !over && !btw) { let n = money(around[2]); if (n > 0 && n < 1000) n *= 1000; f.minPrice = Math.round(n * 0.9); f.maxPrice = Math.round(n * 1.1); hits++; }
  // Kilometres: "under 50,000 km", "less than 80000 kilometres", "low kilometres".
  const km = /\b(under|below|less than|max(?:imum)?|up to|no more than|fewer than)\s+(\d[\d,]*)\s*(?:km|kms|kilomet\w*|clicks)\b/.exec(t);
  if (km) { f.maxKm = money(km[2]); hits++; }
  if (/\b(low|lowest|fewest|least)\s+(km|kms|kilomet\w*|mileage|miles|clicks)\b/.test(t) || /\b(kms?|kilomet\w*|mileage)\b.*\b(low|lowest)\b/.test(t)) { f.sort = "km"; hits++; }
  // Year: "2024 rogue", "2022 or newer".
  const yr = /\b((?:19|20)\d{2})\b/.exec(t);
  if (yr) { if (/\b(or newer|and up|and newer|or later|plus|\+)\b/.test(t.slice(yr.index))) f.minYear = Number(yr[1]); else f.year = Number(yr[1]); hits++; }
  // A stock number, spoken or typed: "stock NHP1868", "stock number n h p 1868".
  const stk = /\bstock\s*(?:number|no\.?|#)?\s*:?\s*((?:[a-z]\s?){0,4}\d[\d\s]{2,}[a-z]?)\b/.exec(t);
  if (stk) { f.stock = stk[1].replace(/\s+/g, "").toUpperCase(); hits++; }
  else { const tok = ws.find((w) => /^[a-z]{1,4}\d{3,}[a-z]?$/.test(w) && !/^(19|20)\d{2}$/.test(w)); if (tok && (vehicles || []).some((v) => String(v.stock || "").toLowerCase() === tok)) { f.stock = tok.toUpperCase(); hits++; } }

  // Makes, models and trims, by the lot's own names.
  const seen = new Set();
  let afterModel = false;
  const forms = (w) => [...new Set([w, singular(w)])];
  for (let i = 0; i < ws.length; i++) {
    const raw = ws[i];
    // Two-word models first: "land cruiser", "5 series", "cr-v hybrid", "grand cherokee".
    const two = i + 1 < ws.length ? forms(ws[i + 1]).map((n) => `${raw} ${n}`) : [];
    const model2 = two.length && [...vocab.models].find((m) => two.includes(m) || two.includes(m.replace(/-/g, " ")));
    if (model2) { if (!seen.has(model2)) { f.models.push(model2); seen.add(model2); } i++; hits++; afterModel = true; continue; }
    const w = singular(raw);
    if (STOP.has(raw) || STOP.has(w) || raw.length < 2) { afterModel = afterModel && /^(the|a|an)$/.test(raw); continue; }
    const model = [...vocab.models].find((m) => forms(raw).some((x) => m === x || m.replace(/-/g, "") === x.replace(/-/g, "") || close(m, x)));
    if (model) { if (!seen.has(model)) { f.models.push(model); seen.add(model); } hits++; afterModel = true; continue; }
    const make = [...vocab.makes].find((m) => forms(raw).some((x) => m === x || close(m, x)));
    if (make) { if (!seen.has(make)) { f.makes.push(make); seen.add(make); } hits++; afterModel = true; continue; }
    const trim = forms(raw).find((x) => vocab.trims.has(x));
    if (trim) { if (!seen.has("trim:" + trim)) { f.trims.push(trim); seen.add("trim:" + trim); } hits++; afterModel = false; continue; }
    // "Rogue SL" when no SL is on the lot: the word right after a model is its
    // trim, so the answer can say there are none rather than list every Rogue.
    if (afterModel && /^[a-z]{1,4}\+?$/.test(w) && !/^(19|20)\d{2}$/.test(w)) { f.trims.push(w); seen.add("trim:" + w); hits++; }
    afterModel = false;
  }

  // The ask.
  if (!f.ask) {
    if (/\b(how many|number of|count of|how much stock|how many of)\b/.test(t) && !/\b(km|kms|kilomet\w*|clicks|miles)\b/.test(t)) f.ask = "count";
    else if (/\b(how many|how much)\b.*\b(km|kms|kilomet\w*|clicks|miles)\b/.test(t) || /\b(kilomet\w*|mileage|odometer|kms?)\b.*\b(on|of)\b/.test(t) || /\b(what|whats|how).*\b(mileage|odometer)\b/.test(t)) f.ask = "km";
    else if (/\b(cheapest|least expensive|lowest price[d]?|best price[d]?|most affordable)\b/.test(t)) f.ask = "cheapest";
    else if (/\b(most expensive|priciest|highest price[d]?|top of the line)\b/.test(t)) f.ask = "priciest";
    else if (/\b(newest|latest|most recent)\b/.test(t)) f.ask = "newest";
    else if (/\b(how much|price|priced|cost|costs|going for|listed (at|for)|asking|worth)\b/.test(t) || /\$/.test(raw)) f.ask = "price";
    else f.ask = "list";
  }
  if (f.ask === "cheapest") f.sort = f.sort || "price";
  if (f.ask === "priciest") f.sort = "priceDesc";
  if (f.ask === "newest") f.sort = "year";

  // An instruction is never a lot question, whatever vehicle it names.
  if (/\b(add|create|new (lead|customer|prospect)|book|schedule|text|message|call|phone|remind|log|email|send|note|mark|update|delete|cancel|sold|bought|signed|deliver\w*)\b/.test(t) && !/\b(how many|how much|cheapest|price of|going for)\b/.test(t)) return null;
  const aboutLot = /\b(lot|stock|inventory|in stock|on hand|available|have|got|carry|sell|selling|units?|cars?|vehicles?|suvs?|trucks?|sedans?|listed|going for|priced?|kilomet\w*|kms?|mileage|cheapest|newest)\b/.test(t);
  const filtered = f.models.length || f.makes.length || f.trims.length || f.stock || f.body || f.fuel || f.condition || f.colour || f.maxPrice || f.minPrice || f.maxKm || f.year || f.minYear || f.demo;
  if (!aboutLot && !filtered) return null;
  if (!filtered && !/\b(on the lot|the lot|inventory|in stock|on hand|what (do we|have we|we) (have|got)|how many (cars|vehicles|units)|cheapest|newest|anything (in|on|available))\b/.test(t)) return null;
  f.confidence = filtered ? (f.models.length || f.stock ? 2 : 1) : 0;
  return f;
}

export function vehicleLabel(v) {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle";
}
const fmtMoney = (n) => "$" + Math.round(Number(n)).toLocaleString("en-CA");
const fmtKm = (n) => Math.round(Number(n)).toLocaleString("en-CA") + " km";
function arrivesOn(v, today) {
  const d = String(v.inventoryDate || "").slice(0, 10);
  if (!d || d <= (today || new Date().toISOString().slice(0, 10))) return "";
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString("en-CA", { month: "long", day: "numeric" });
}
const isNew = (v) => /^new$/i.test(String(v.condition || ""));

export function matchLot(vehicles, f, { today } = {}) {
  const inv = (vehicles || []).filter((v) => (v.status || "available") === "available");
  return inv.filter((v) => {
    const model = String(v.model || "").toLowerCase(), make = String(v.make || "").toLowerCase(), trim = String(v.trim || "").toLowerCase();
    if (f.stock) return String(v.stock || "").toUpperCase() === f.stock;
    if (f.models.length && !f.models.some((m) => model === m || model.includes(m) || m.includes(model))) return false;
    if (f.makes.length && !f.makes.some((m) => make === m)) return false;
    if (f.trims.length && !f.trims.every((tr) => trim.split(/[\s/,]+/).includes(tr))) return false;
    if (f.condition && (isNew(v) ? "New" : "Used") !== f.condition) return false;
    if (f.certified && !v.certified) return false;
    if (f.demo && !v.demo) return false;
    if (f.body && !f.body.test(String(v.bodyStyle || ""))) return false;
    if (f.fuel && !f.fuel.test(String(v.fuel || v.fuelType || ""))) return false;
    if (f.drive && !f.drive.test(String(v.drivetrain || ""))) return false;
    if (f.colour && !String(v.color || "").toLowerCase().includes(f.colour)) return false;
    if (f.year && Number(v.year) !== f.year) return false;
    if (f.minYear && !(Number(v.year) >= f.minYear)) return false;
    if (f.maxPrice && !(v.price != null && v.price <= f.maxPrice)) return false;
    if (f.minPrice && !(v.price != null && v.price >= f.minPrice)) return false;
    if (f.maxKm && !(v.mileage != null && v.mileage <= f.maxKm)) return false;
    return true;
  }).sort((a, b) => {
    if (f.sort === "price") return (a.price ?? 1e12) - (b.price ?? 1e12);
    if (f.sort === "priceDesc") return (b.price ?? -1) - (a.price ?? -1);
    if (f.sort === "km") return (a.mileage ?? 1e12) - (b.mileage ?? 1e12);
    if (f.sort === "year") return (Number(b.year) || 0) - (Number(a.year) || 0);
    return (a.price ?? 1e12) - (b.price ?? 1e12);
  });
}

// What was asked for, in words — "used Rogue SVs under $30,000".
export function describeFilters(f) {
  const bits = [];
  if (f.stock) return "stock #" + f.stock;
  if (f.certified) bits.push("certified"); else if (f.condition) bits.push(f.condition.toLowerCase());
  if (f.demo) bits.push("demo");
  if (f.year) bits.push(String(f.year)); else if (f.minYear) bits.push(`${f.minYear} or newer`);
  if (f.colour) bits.push(f.colour);
  if (f.fuel) bits.push(f.fuel.source.replace(/\\|\//g, ""));
  if (f.drive) bits.push("AWD");
  const cap = (s) => s.split(/[\s-]+/).map((w) => (/^\d/.test(w) || /^[a-z]{1,3}$/.test(w) && w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  if (f.makes.length && !f.models.length) bits.push(f.makes.map(cap).join("/"));
  if (f.models.length) bits.push(f.models.map(cap).join("/"));
  if (f.trims.length) bits.push(f.trims.map((x) => x.length <= 3 ? x.toUpperCase() : cap(x)).join(" "));
  if (f.body) bits.push(f.body.source.split("|")[0].toUpperCase() === "SUV" ? "SUV" : f.body.source.split("|")[0]);
  let s = bits.join(" ") || "vehicles";
  if (f.minPrice && f.maxPrice) s += ` between ${fmtMoney(f.minPrice)} and ${fmtMoney(f.maxPrice)}`;
  else if (f.maxPrice) s += ` under ${fmtMoney(f.maxPrice)}`;
  else if (f.minPrice) s += ` over ${fmtMoney(f.minPrice)}`;
  if (f.maxKm) s += ` under ${fmtKm(f.maxKm)}`;
  return s;
}

function oneLine(v, { withName = true, today } = {}) {
  const bits = [];
  if (withName) bits.push(`the ${vehicleLabel(v)}`);
  if (v.price != null) bits.push(fmtMoney(v.price)); else if (isNew(v)) bits.push("no price on the site yet");
  if (v.mileage != null && !isNew(v)) bits.push(fmtKm(v.mileage));
  if (v.color) bits.push(String(v.color).split("/")[0]);
  const arr = arrivesOn(v, today); if (arr) bits.push("arrives " + arr);
  if (v.stock) bits.push("#" + v.stock);
  return bits.join(", ");
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || pluralLabel(one)}`;
// "Rogue SV" → "Rogue SVs"; "used SUV under $30,000" → "used SUVs under $30,000".
function pluralLabel(label) {
  const m = /^(.*?)( (?:under|over|between) .*)?$/.exec(label);
  const head = m[1], tail = m[2] || "";
  if (/(s|\+|series)$/i.test(head)) return head + tail;
  return head + "s" + tail;
}

/**
 * Answer a lot question: { answer, matches, filters, label, count }.
 * `answer` is one or two spoken sentences with the website's prices; the
 * matches are what the screen shows, so the sentence never reads a list.
 */
export function answerLot(vehicles, text, hints = {}, { today } = {}) {
  const f = parseLotQuestion(text, vehicles, hints);
  if (!f) return null;
  const matches = matchLot(vehicles, f, { today });
  const label = describeFilters(f);
  const n = matches.length;
  const first = matches[0];
  let answer = "";
  if (!n) {
    answer = `Nothing on the lot matches ${label}.`;
    // One step wider, so the answer still helps: drop the trim, then the price cap, then the condition.
    const wider = [];
    if (f.trims.length) wider.push({ ...f, trims: [], why: "in other trims" });
    if (f.maxPrice) wider.push({ ...f, maxPrice: null, minPrice: null, why: "over that price" });
    if (f.maxKm) wider.push({ ...f, maxKm: null, why: "with more kilometres" });
    if (f.condition) wider.push({ ...f, condition: "", certified: false, why: f.condition === "New" ? "used" : "new" });
    if (f.colour) wider.push({ ...f, colour: "", why: "in other colours" });
    for (const w of wider) {
      const alt = matchLot(vehicles, w, { today });
      if (alt.length) { const nm = describeFilters(w).replace(/ under .*$/, "").replace(/ over .*$/, "").replace(/ between .*$/, ""); answer += ` There ${alt.length === 1 ? "is" : "are"} ${plural(alt.length, nm === "vehicles" ? "vehicle" : nm)} ${w.why}, from ${alt[0].price != null ? fmtMoney(alt[0].price) : "no price yet"}.`; return { answer, matches: alt, filters: w, label: describeFilters(w), count: alt.length, widened: true }; }
    }
    return { answer, matches, filters: f, label, count: 0 };
  }
  const single = n === 1;
  const noun = single ? label.replace(/^vehicles\b/, "vehicle") : pluralLabel(label);
  switch (f.ask) {
    case "count":
      answer = single ? `One ${noun} on the lot: ${oneLine(first, { withName: true, today })}.`
        : `${n} ${noun} on the lot. ${firstTwo(matches, today)}`;
      break;
    case "km":
      answer = single ? (first.mileage != null ? `${fmtKm(first.mileage)} on the ${vehicleLabel(first)}${first.stock ? ", stock " + first.stock : ""}${first.price != null ? ", listed at " + fmtMoney(first.price) : ""}.` : isNew(first) ? `The ${vehicleLabel(first)} is new — no kilometres to speak of.` : `No kilometres on file for the ${vehicleLabel(first)}.`)
        : `${n} ${noun}: ${matches.slice(0, 3).map((v) => `the ${vehicleLabel(v)}${v.stock ? " #" + v.stock : ""} at ${v.mileage != null ? fmtKm(v.mileage) : "no reading"}`).join(", ")}${n > 3 ? ", and more on screen" : ""}.`;
      break;
    case "price":
      answer = single ? `The ${vehicleLabel(first)}${first.stock ? ", stock " + first.stock + "," : ""} ${first.price != null ? "is listed at " + fmtMoney(first.price) + (first.wasPrice && first.wasPrice > first.price ? ", down from " + fmtMoney(first.wasPrice) : "") : isNew(first) ? "has no price on the site yet" : "has no price on file"}${first.mileage != null && !isNew(first) ? " with " + fmtKm(first.mileage) : ""}${arrivesOn(first, today) ? ", arriving " + arrivesOn(first, today) : ""}.`
        : `${n} ${noun}, from ${first.price != null ? fmtMoney(first.price) : "no price yet"}${matches[n - 1].price != null && matches[n - 1].price !== first.price ? " to " + fmtMoney(matches[n - 1].price) : ""}. ${firstTwo(matches, today)}`;
      break;
    case "cheapest":
      answer = `Cheapest ${noun} is ${oneLine(first, { withName: true, today })}.${n > 1 && matches[1].price != null ? ` Next is ${oneLine(matches[1], { withName: true, today })}.` : ""}`;
      break;
    case "priciest":
      answer = `Top of the range is ${oneLine(first, { withName: true, today })}.${n > 1 ? ` ${n - 1} more on screen.` : ""}`;
      break;
    case "newest":
      answer = `Newest ${noun} is ${oneLine(first, { withName: true, today })}.${n > 1 ? ` ${n - 1} more on screen.` : ""}`;
      break;
    default:
      answer = single ? `Yes — one ${noun}: ${oneLine(first, { withName: true, today })}.`
        : `Yes — ${n} ${noun} on the lot. ${firstTwo(matches, today)}`;
  }
  return { answer, matches, filters: f, label, count: n };
}
function firstTwo(matches, today) {
  const two = matches.slice(0, 2).map((v) => oneLine(v, { withName: true, today }));
  return `${two.join("; ")}${matches.length > 2 ? "; the rest are on screen" : ""}.`;
}

// A one-line picture of the lot for the assistant's context: counts by model.
export function lotSummary(vehicles, { limit = 14 } = {}) {
  const inv = (vehicles || []).filter((v) => (v.status || "available") === "available");
  if (!inv.length) return "";
  const byModel = new Map();
  let newN = 0, usedN = 0, unpriced = 0;
  inv.forEach((v) => {
    const k = [v.make, v.model].filter(Boolean).join(" ") || "Unknown";
    const e = byModel.get(k) || { n: 0, isNew: 0 };
    e.n++; if (isNew(v)) { e.isNew++; newN++; } else usedN++;
    if (v.price == null) unpriced++;
    byModel.set(k, e);
  });
  const top = [...byModel.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, limit)
    .map(([k, e]) => `${k} ${e.n}${e.isNew && e.isNew < e.n ? ` (${e.isNew} new)` : e.isNew ? " new" : ""}`);
  return `${inv.length} vehicles on the lot (${newN} new, ${usedN} used${unpriced ? `, ${unpriced} new units without a website price yet` : ""}): ${top.join(", ")}${byModel.size > limit ? ", and more" : ""}.`;
}
