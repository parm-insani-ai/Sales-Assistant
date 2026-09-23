// What a vehicle IS — its class — so the next vehicle pitched to a customer
// is a step across or up from what they drive, never a step down.
//
// "2019 INFINITI QX60 LUXE AWD" is a luxury three-row SUV. The natural
// pitch is a Pathfinder Platinum, a Murano, an Armada, or a used QX60 on
// the lot — not the cheapest Kicks that happens to land on the payment.
// Pure functions over strings, so node can test them.

const LUXURY_MAKES = ["infiniti", "lexus", "acura", "bmw", "mercedes", "mercedes-benz", "audi", "volvo", "genesis", "cadillac", "lincoln", "porsche", "jaguar", "land rover", "range rover", "tesla", "alfa romeo", "maserati", "bentley", "rolls-royce", "aston martin", "lucid", "rivian", "polestar"];
export const MAKES = ["nissan", "infiniti", "toyota", "lexus", "honda", "acura", "hyundai", "genesis", "kia", "mazda", "subaru", "mitsubishi", "volkswagen", "vw", "ford", "lincoln", "chevrolet", "chevy", "gmc", "buick", "cadillac", "ram", "dodge", "jeep", "chrysler", "bmw", "mini", "mercedes-benz", "mercedes", "audi", "volvo", "porsche", "jaguar", "land rover", "range rover", "tesla", "alfa romeo", "fiat", "maserati", "rivian", "polestar", "lucid"];

// body: suv | car | truck | van | sports. size: 1 subcompact, 2 compact,
// 3 midsize, 4 large / three-row, 5 full-size.
const M = (body, size, extra = {}) => ({ body, size, ...extra });
const MODELS = {
  // Nissan
  kicks: M("suv", 1), qashqai: M("suv", 1), juke: M("suv", 1), rogue: M("suv", 2), "rogue plug-in hybrid": M("suv", 2, { hybrid: true }), "rogue sport": M("suv", 1),
  murano: M("suv", 3), pathfinder: M("suv", 4), armada: M("suv", 5), xterra: M("suv", 3),
  versa: M("car", 1), micra: M("car", 1), sentra: M("car", 2), altima: M("car", 3), maxima: M("car", 3),
  frontier: M("truck", 3), titan: M("truck", 5), leaf: M("car", 2, { ev: true }), ariya: M("suv", 2, { ev: true }),
  z: M("sports", 2), "370z": M("sports", 2), "350z": M("sports", 2), "gt-r": M("sports", 3),
  // Infiniti
  qx30: M("suv", 1), qx50: M("suv", 2), qx55: M("suv", 2), qx60: M("suv", 4), qx70: M("suv", 3), qx80: M("suv", 5), ex35: M("suv", 2), fx35: M("suv", 3), fx37: M("suv", 3), jx35: M("suv", 4),
  q50: M("car", 3), q60: M("sports", 3), q70: M("car", 3), g35: M("car", 3), g37: M("car", 3), m35: M("car", 3),
  // Lexus
  ux: M("suv", 1), nx: M("suv", 2), rx: M("suv", 3), tx: M("suv", 4), gx: M("suv", 4), lx: M("suv", 5), is: M("car", 2), es: M("car", 3), gs: M("car", 3), ls: M("car", 4), rc: M("sports", 2), lc: M("sports", 3), rz: M("suv", 2, { ev: true }),
  // Acura
  rdx: M("suv", 2), mdx: M("suv", 4), zdx: M("suv", 3, { ev: true }), integra: M("car", 2), ilx: M("car", 2), tlx: M("car", 3), rlx: M("car", 4), nsx: M("sports", 3),
  // BMW
  x1: M("suv", 1), x2: M("suv", 1), x3: M("suv", 2), x4: M("suv", 2), x5: M("suv", 3), x6: M("suv", 3), x7: M("suv", 4), ix: M("suv", 3, { ev: true }), i4: M("car", 2, { ev: true }), i5: M("car", 3, { ev: true }), i7: M("car", 4, { ev: true }),
  "2 series": M("car", 2), "3 series": M("car", 2), "4 series": M("sports", 2), "5 series": M("car", 3), "6 series": M("car", 3), "7 series": M("car", 4), "8 series": M("sports", 3), z4: M("sports", 2), m3: M("car", 2), m4: M("sports", 2), m5: M("car", 3),
  "230i": M("car", 2), "330i": M("car", 2), "330e": M("car", 2, { hybrid: true }), "430i": M("sports", 2), "530i": M("car", 3), "540i": M("car", 3), "740i": M("car", 4), "x3m": M("suv", 2), "x5m": M("suv", 3),
  // Mercedes
  gla: M("suv", 1), glb: M("suv", 1), glc: M("suv", 2), gle: M("suv", 3), gls: M("suv", 4), "g-class": M("suv", 4), "g 550": M("suv", 4), "a-class": M("car", 1), cla: M("car", 1), "c-class": M("car", 2), "e-class": M("car", 3), "s-class": M("car", 4), eqb: M("suv", 1, { ev: true }), eqe: M("car", 3, { ev: true }), eqs: M("car", 4, { ev: true }), "c 300": M("car", 2), "e 350": M("car", 3), "e 450": M("car", 3), "s 580": M("car", 4), "glc 300": M("suv", 2), "gle 350": M("suv", 3), "gle 450": M("suv", 3), "gls 450": M("suv", 4), "amg gt": M("sports", 3), "sl": M("sports", 3),
  // Audi
  q3: M("suv", 1), q4: M("suv", 2, { ev: true }), q5: M("suv", 2), q7: M("suv", 4), q8: M("suv", 3), a3: M("car", 1), a4: M("car", 2), a5: M("car", 2), a6: M("car", 3), a7: M("car", 3), a8: M("car", 4), "e-tron": M("suv", 3, { ev: true }), tt: M("sports", 2), r8: M("sports", 3), s4: M("car", 2), s5: M("car", 2), sq5: M("suv", 2), rs5: M("sports", 2),
  // Volvo
  xc40: M("suv", 1), xc60: M("suv", 2), xc90: M("suv", 4), s60: M("car", 2), s90: M("car", 3), v60: M("car", 2), v90: M("car", 3), c40: M("suv", 1, { ev: true }), ex30: M("suv", 1, { ev: true }), ex90: M("suv", 4, { ev: true }),
  // Cadillac / Lincoln / Genesis
  xt4: M("suv", 1), xt5: M("suv", 2), xt6: M("suv", 4), escalade: M("suv", 5), ct4: M("car", 2), ct5: M("car", 3), lyriq: M("suv", 3, { ev: true }),
  corsair: M("suv", 2), nautilus: M("suv", 3), aviator: M("suv", 4), navigator: M("suv", 5), mkc: M("suv", 2), mkx: M("suv", 3), mkz: M("car", 3),
  gv60: M("suv", 2, { ev: true }), gv70: M("suv", 2), gv80: M("suv", 4), g70: M("car", 2), g80: M("car", 3), g90: M("car", 4),
  // Porsche / Jaguar / Land Rover / Tesla / Alfa / Maserati
  macan: M("suv", 2), cayenne: M("suv", 3), panamera: M("car", 3), taycan: M("car", 3, { ev: true }), "911": M("sports", 3), cayman: M("sports", 2), boxster: M("sports", 2),
  "e-pace": M("suv", 1), "f-pace": M("suv", 2), "i-pace": M("suv", 2, { ev: true }), xe: M("car", 2), xf: M("car", 3), "f-type": M("sports", 3),
  evoque: M("suv", 1), "discovery sport": M("suv", 2), velar: M("suv", 2), "range rover sport": M("suv", 3), "range rover": M("suv", 4), defender: M("suv", 3), discovery: M("suv", 4),
  "model 3": M("car", 2, { ev: true }), "model y": M("suv", 2, { ev: true }), "model s": M("car", 3, { ev: true }), "model x": M("suv", 4, { ev: true }), cybertruck: M("truck", 5, { ev: true }),
  stelvio: M("suv", 2), giulia: M("car", 2), levante: M("suv", 3), ghibli: M("car", 3), grecale: M("suv", 2),
  // Toyota
  "corolla cross": M("suv", 1), "c-hr": M("suv", 1), rav4: M("suv", 2), venza: M("suv", 3), highlander: M("suv", 4), "grand highlander": M("suv", 4), "4runner": M("suv", 3), sequoia: M("suv", 5), "land cruiser": M("suv", 4),
  yaris: M("car", 1), corolla: M("car", 2), prius: M("car", 2, { hybrid: true }), camry: M("car", 3), avalon: M("car", 3), crown: M("car", 3), tacoma: M("truck", 3), tundra: M("truck", 5), sienna: M("van", 4), supra: M("sports", 2), "gr86": M("sports", 2), "bz4x": M("suv", 2, { ev: true }),
  // Honda
  "hr-v": M("suv", 1), "cr-v": M("suv", 2), "cr-v hybrid": M("suv", 2, { hybrid: true }), passport: M("suv", 3), pilot: M("suv", 4), fit: M("car", 1), civic: M("car", 2), accord: M("car", 3), ridgeline: M("truck", 3), odyssey: M("van", 4), prologue: M("suv", 3, { ev: true }),
  // Hyundai / Kia
  venue: M("suv", 1), kona: M("suv", 1), tucson: M("suv", 2), "santa fe": M("suv", 3), palisade: M("suv", 4), accent: M("car", 1), elantra: M("car", 2), sonata: M("car", 3), "santa cruz": M("truck", 3), "ioniq 5": M("suv", 2, { ev: true }), "ioniq 6": M("car", 3, { ev: true }), "ioniq": M("car", 2, { hybrid: true }), "kona electric": M("suv", 1, { ev: true }),
  soul: M("suv", 1), seltos: M("suv", 1), niro: M("suv", 1, { hybrid: true }), sportage: M("suv", 2), sorento: M("suv", 3), telluride: M("suv", 4), rio: M("car", 1), forte: M("car", 2), k4: M("car", 2), k5: M("car", 3), optima: M("car", 3), stinger: M("sports", 3), carnival: M("van", 4), sedona: M("van", 4), ev6: M("suv", 2, { ev: true }), ev9: M("suv", 4, { ev: true }),
  // Mazda / Subaru / Mitsubishi / VW
  "cx-3": M("suv", 1), "cx-30": M("suv", 1), "cx-5": M("suv", 2), "cx-50": M("suv", 2), "cx-70": M("suv", 3), "cx-9": M("suv", 4), "cx-90": M("suv", 4), mazda3: M("car", 2), "mazda 3": M("car", 2), mazda6: M("car", 3), "mx-5": M("sports", 1), miata: M("sports", 1),
  crosstrek: M("suv", 1), forester: M("suv", 2), outback: M("suv", 3), ascent: M("suv", 4), impreza: M("car", 2), legacy: M("car", 3), wrx: M("sports", 2), brz: M("sports", 2), solterra: M("suv", 2, { ev: true }),
  rvr: M("suv", 1), "eclipse cross": M("suv", 1), outlander: M("suv", 2), "outlander phev": M("suv", 2, { hybrid: true }), mirage: M("car", 1), lancer: M("car", 2),
  taos: M("suv", 1), tiguan: M("suv", 2), atlas: M("suv", 4), "atlas cross sport": M("suv", 3), jetta: M("car", 2), golf: M("car", 2), gti: M("sports", 2), passat: M("car", 3), arteon: M("car", 3), "id.4": M("suv", 2, { ev: true }), "id.buzz": M("van", 4, { ev: true }),
  // Ford / Chevy / GMC / Buick / Ram / Dodge / Jeep / Chrysler
  ecosport: M("suv", 1), escape: M("suv", 2), "bronco sport": M("suv", 1), bronco: M("suv", 3), edge: M("suv", 3), explorer: M("suv", 4), expedition: M("suv", 5), focus: M("car", 2), fusion: M("car", 3), mustang: M("sports", 3), "mach-e": M("suv", 2, { ev: true }), maverick: M("truck", 3), ranger: M("truck", 3), "f-150": M("truck", 5), f150: M("truck", 5), "f-250": M("truck", 5), "f-350": M("truck", 5), lightning: M("truck", 5, { ev: true }),
  trax: M("suv", 1), trailblazer: M("suv", 1), equinox: M("suv", 2), "equinox ev": M("suv", 2, { ev: true }), blazer: M("suv", 3), "blazer ev": M("suv", 3, { ev: true }), traverse: M("suv", 4), tahoe: M("suv", 5), suburban: M("suv", 5), spark: M("car", 1), sonic: M("car", 1), cruze: M("car", 2), malibu: M("car", 3), impala: M("car", 3), camaro: M("sports", 3), corvette: M("sports", 3), bolt: M("car", 1, { ev: true }), colorado: M("truck", 3), silverado: M("truck", 5),
  terrain: M("suv", 2), acadia: M("suv", 4), yukon: M("suv", 5), canyon: M("truck", 3), sierra: M("truck", 5), hummer: M("truck", 5, { ev: true }),
  encore: M("suv", 1), envista: M("suv", 1), envision: M("suv", 2), enclave: M("suv", 4),
  "1500": M("truck", 5), "2500": M("truck", 5), "3500": M("truck", 5), "ram 1500": M("truck", 5), durango: M("suv", 4), charger: M("car", 3), challenger: M("sports", 3), hornet: M("suv", 1), journey: M("suv", 3), "grand caravan": M("van", 4), caravan: M("van", 4),
  renegade: M("suv", 1), compass: M("suv", 2), cherokee: M("suv", 2), "grand cherokee": M("suv", 3), "grand cherokee l": M("suv", 4), wrangler: M("suv", 3), gladiator: M("truck", 3), wagoneer: M("suv", 5), "grand wagoneer": M("suv", 5),
  pacifica: M("van", 4), "town & country": M("van", 4), "300": M("car", 3),
  // Tesla-adjacent EV makes
  r1t: M("truck", 5, { ev: true }), r1s: M("suv", 4, { ev: true }), "polestar 2": M("car", 2, { ev: true }), "polestar 3": M("suv", 3, { ev: true }), air: M("car", 3, { ev: true }),
  // Mini / Fiat
  countryman: M("suv", 1), cooper: M("car", 1), "500": M("car", 1), "500x": M("suv", 1),
};
// Two-word and hyphenated names first, so "range rover sport" isn't "range rover", and "cr-v hybrid" isn't "cr-v".
const MODEL_KEYS = Object.keys(MODELS).sort((a, b) => b.length - a.length);

const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();

/**
 * Read a vehicle description into its class.
 * { make, model, body, size, tier, ev, hybrid, year, known }
 */
// A class is read once per distinct description: the book asks about the
// same three hundred units for every one of three thousand customers.
const CLASS_CACHE = new Map();
export function classify(text, meta = {}) {
  const t = norm([meta.year, meta.make, meta.model, meta.trim].filter(Boolean).join(" ") || text);
  const hit = CLASS_CACHE.get(t);
  if (hit) return hit;
  const r = classifyRaw(t);
  if (CLASS_CACHE.size > 20000) CLASS_CACHE.clear();
  CLASS_CACHE.set(t, r);
  return r;
}
function classifyRaw(t) {
  const year = Number((/\b((?:19|20)\d{2})\b/.exec(t) || [])[1]) || null;
  const make = MAKES.find((m) => new RegExp(`\\b${m.replace(/[-]/g, "\\-")}\\b`).test(t)) || "";
  let model = "", cls = null;
  for (const k of MODEL_KEYS) {
    const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[-.]/g, (c) => "\\" + c)}(?![a-z0-9])`);
    if (re.test(t)) { model = k; cls = MODELS[k]; break; }
  }
  const mk = make === "vw" ? "volkswagen" : make === "chevy" ? "chevrolet" : make === "mercedes-benz" ? "mercedes" : make;
  const tier = LUXURY_MAKES.includes(mk) ? "luxury" : "mainstream";
  const hybrid = !!(cls && cls.hybrid) || /\b(hybrid|phev|plug-in|prime|e-power)\b/.test(t);
  const ev = !!(cls && cls.ev) || /\b(ev|electric|e-tron|eqe|eqs|bev)\b/.test(t) && !hybrid;
  const premium = PREMIUM_TRIM.test(t);
  return { make: mk, model, body: cls ? cls.body : "", size: cls ? cls.size : 0, tier, ev, hybrid, year, premium, known: !!cls };
}

// The Nissan that answers to each class: what a customer in that seat
// would naturally move into. Alternatives in order after the first.
const NISSAN_FOR = {
  "suv1": ["kicks", "rogue"], "suv2": ["rogue", "murano"], "suv3": ["murano", "pathfinder", "rogue"], "suv4": ["pathfinder", "armada", "murano"], "suv5": ["armada", "pathfinder"],
  "car1": ["versa", "sentra", "kicks"], "car2": ["sentra", "altima"], "car3": ["altima", "murano"], "car4": ["altima", "murano", "armada"],
  "truck3": ["frontier", "titan"], "truck5": ["titan", "frontier"], "truck4": ["titan", "frontier"],
  "van4": ["pathfinder", "armada"], "van3": ["pathfinder"], "van5": ["pathfinder", "armada"],
  "sports1": ["z"], "sports2": ["z"], "sports3": ["z", "altima"],
};
const PREMIUM_TRIM = /\b(platinum|platinum\+|sl|sl\+|reserve|luxe|sensory|autograph|limited|premium|touring|signature|elite|ultimate|prestige|technology|tech|black label|denali|high country|calligraphy|x-line|gt-line|sport touring|premier|titanium|lariat|king ranch|summit|overland|essence|inscription|ultimate)\b/i;
const BASE_TRIM = /^(s|s fwd|s awd|base|lx|le|l|se|sv fwd|sv|g|gl|gs|ce|dx|value)$/i;

/**
 * How well a candidate fits a customer, 0–100+, from what they drive.
 * `owned` and `cand` are classify() results; `candInfo` carries trim,
 * condition, year and make of the candidate unit.
 */
export function fitScore(owned, cand, candInfo = {}) {
  if (!owned || !owned.known) return 50; // nothing to go on: everything is equal
  let s = 0;
  const sameBody = owned.body && owned.body === cand.body;
  const sameFamily = sameBody || (owned.body === "van" && cand.body === "suv") || (owned.body === "suv" && cand.body === "van") || (owned.body === "sports" && cand.body === "car");
  // Trucks come in two sizes, so midsize and full-size are one step apart.
  const rawDist = cand.size && owned.size ? Math.abs(cand.size - owned.size) : 9;
  const dist = owned.body === "truck" && cand.body === "truck" ? Math.min(rawDist, 1) : rawDist;
  if (sameBody) s += dist === 0 ? 60 : dist === 1 ? 40 : dist === 2 ? 15 : 0;
  else if (sameFamily) s += dist <= 1 ? 35 : dist === 2 ? 15 : 0;
  else if (owned.body === "car" && cand.body === "suv" && dist <= 1) s += 20; // the common move: car to crossover
  else if (owned.body === "suv" && cand.body === "car") s += 5;
  else s += 0;
  // A step down in size costs more than a step up.
  if (cand.size && owned.size && cand.size < owned.size) s -= 10 * (owned.body === "truck" && cand.body === "truck" ? 1 : owned.size - cand.size);
  // Same make is the natural repeat; same model more so.
  if (owned.make && owned.make === cand.make) s += 25;
  if (owned.model && owned.model === cand.model) s += 15;
  // The Nissan that answers to their class.
  const target = NISSAN_FOR[owned.body + owned.size] || [];
  const ti = cand.make === "nissan" ? target.indexOf(cand.model) : -1;
  if (ti === 0) s += 20; else if (ti > 0) s += 10;
  // The trim level they're used to: a premium-trim owner isn't pitched the base model.
  const trim = String(candInfo.trim || "");
  if (owned.premium) { if (PREMIUM_TRIM.test(trim)) s += 8; else if (BASE_TRIM.test(trim.trim())) s -= 8; }
  // Luxury drivers: a luxury unit, or a premium trim of a bigger Nissan — never a base subcompact.
  if (owned.tier === "luxury") {
    if (cand.tier === "luxury") s += 20;
    else if (PREMIUM_TRIM.test(trim) || ["murano", "armada", "pathfinder"].includes(cand.model)) s += 10;
    if (BASE_TRIM.test(trim.trim()) || (cand.size && cand.size <= 1)) s -= 25;
  }
  // Powertrain: EV to EV, hybrid to hybrid.
  if (owned.ev) s += cand.ev ? 30 : -15;
  else if (owned.hybrid) s += cand.hybrid ? 15 : cand.ev ? 5 : 0;
  else if (cand.ev) s -= 10;
  // Nobody moves into an older car than the one they have.
  const cy = Number(candInfo.year) || cand.year, oy = owned.year;
  if (cy && oy) { if (cy < oy) s -= 15 + 5 * Math.min(4, oy - cy); else if (cy > oy) s += 3; }
  return s;
}

// Every model named in a sentence, longest names first ("range rover
// sport" before "range rover"), for reading an audience: "Sentra owners".
export function modelsIn(text) {
  const t = norm(text);
  const found = [];
  let rest = t;
  const hasMake = MAKES.some((m) => new RegExp(`\\b${m.replace(/-/g, "\\-")}\\b`).test(t));
  for (const k of MODEL_KEYS) {
    // Two-letter badges (IS, ES, RX, TT…) are ordinary words in a sentence;
    // they only count with their make named.
    if (k.length <= 2 && !hasMake) continue;
    const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[-.]/g, (c) => "\\" + c)}s?(?![a-z0-9])`);
    if (re.test(rest)) { found.push(k); rest = rest.replace(re, "$1 "); }
  }
  return found;
}

// The class of a unit on the lot (or in the catalogue), read once per unit.
const UNIT_CACHE = new WeakMap();
export function classifyUnit(v) {
  if (!v || typeof v !== "object") return classify("");
  let c = UNIT_CACHE.get(v);
  if (!c) { c = classify("", { year: v.year, make: v.make, model: v.model, trim: v.trim }); UNIT_CACHE.set(v, c); }
  return c;
}
