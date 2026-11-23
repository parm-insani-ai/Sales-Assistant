// The Facebook Marketplace scoreboard — what pulls there, from the store's
// own records rather than a guess. Facebook publishes nothing about what
// sells; the app knows three things that, joined, say it for this lot:
// the listings copied from the Marketplace builder (an fb_post event each,
// with the vehicle), the leads that came in from Facebook (their source),
// and what became of them (appointments, sales). A lead is laid against
// the listing it most plausibly answered: same model, posted before the
// lead came in, inside the window. Per model and per body style: posts,
// leads, leads per post, booked, sold, and the days from the post to its
// first lead — plus the posts that have sat with no lead at all.

const DAY = 86400000;
export const ATTRIBUTE_DAYS = 45;  // a lead answers a post inside this long
export const SITTING_DAYS = 14;    // a post this old with no lead is sitting

export const isMarketplaceLead = (l) => /facebook|marketplace|\bfb\b|\bmeta\b/i.test(String((l && l.source) || ""));

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => norm(s).split(" ").filter(Boolean);
const MAKES = ["nissan", "toyota", "honda", "ford", "chevrolet", "chevy", "gmc", "hyundai", "kia", "mazda", "subaru", "volkswagen", "vw", "jeep", "ram", "dodge", "chrysler", "bmw", "mercedes", "audi", "lexus", "acura", "infiniti", "mitsubishi", "buick", "cadillac", "lincoln", "volvo", "tesla", "genesis", "mini"];
const TRIMS = new Set(["s", "sv", "sl", "sr", "se", "le", "xle", "lx", "ex", "touring", "platinum", "limited", "sport", "awd", "fwd", "4wd", "4x4", "pro", "pro-4x", "midnight", "rock", "creek", "nismo", "premium", "base", "plus", "edition"]);

/** The make and model words of a vehicle name: "2021 Nissan Rogue SV" → { make: "nissan", model: "rogue" }. */
export function modelKey(name) {
  const w = words(name).filter((x) => !/^\d{4}$/.test(x));
  let make = "";
  const rest = [];
  for (const x of w) { if (!make && MAKES.includes(x)) make = x === "chevy" ? "chevrolet" : x === "vw" ? "volkswagen" : x; else rest.push(x); }
  const model = rest.find((x) => !TRIMS.has(x) && !/^\d+$/.test(x)) || "";
  return { make, model };
}
// "Frontier" for the house make, "Honda Civic" for anyone else's.
const HOUSE = "nissan";
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const modelLabel = (v, fallback) => {
  const k = v && (v.make || v.model) ? { make: norm(v.make), model: norm(v.model) } : modelKey(fallback);
  const name = [k.make && k.make !== HOUSE ? cap(k.make) : "", cap(k.model)].filter(Boolean).join(" ");
  return name || String(fallback || "Vehicle");
};
const sameModel = (a, b) => a.model && b.model && a.model === b.model && (!a.make || !b.make || a.make === b.make);
const median = (xs) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const ms = (v) => new Date(v || 0).getTime();

/**
 * The scoreboard for a window. `from`/`to` are ISO days (inclusive); a
 * post counts when it was copied in the window, a lead when it came in
 * inside the window or the attribution days after.
 */
export function marketplaceScoreboard({ from, to, now = Date.now(), events = [], leads = [], appointments = [], sales = [], vehicles = [] } = {}) {
  const fromMs = ms(from + "T00:00:00"), toMs = ms(to + "T23:59:59.999");
  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const posts = events
    .filter((e) => e && e.kind === "fb_post" && ms(e.at) >= fromMs && ms(e.at) <= toMs)
    .map((e) => { const m = e.meta || {}; const v = m.vehicleId ? vById.get(m.vehicleId) : null; const name = m.vehicle || (v ? [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") : ""); return { id: e.id, at: ms(e.at), name, key: v && v.model ? { make: norm(v.make), model: norm(v.model) } : modelKey(name), label: modelLabel(v, name), body: (v && v.bodyStyle) || "", price: v && v.price != null ? Number(v.price) : null, stock: m.stock || (v && v.stock) || "", leads: [] }; });
  const fbLeads = leads.filter((l) => isMarketplaceLead(l) && ms(l.createdAt) >= fromMs && ms(l.createdAt) <= toMs + ATTRIBUTE_DAYS * DAY);
  // Each Facebook lead answers the latest post of its model before it came in.
  const unmatched = [];
  fbLeads.forEach((l) => {
    const k = modelKey(l.vehicleInterest);
    const at = ms(l.createdAt);
    const cands = posts.filter((p) => sameModel(p.key, k) && p.at <= at && at - p.at <= ATTRIBUTE_DAYS * DAY).sort((a, b) => b.at - a.at);
    if (cands[0]) cands[0].leads.push(l); else unmatched.push(l);
  });
  const booked = new Set(appointments.filter((a) => a.leadId && a.status !== "cancelled" && a.status !== "canceled").map((a) => a.leadId));
  const soldIds = new Set(sales.filter((s) => s.leadId).map((s) => s.leadId));
  const isSold = (l) => soldIds.has(l.id) || ["sold", "delivered"].includes(l.stage);
  const roll = (label, ps, extraLeads = []) => {
    const ls = [...ps.flatMap((p) => p.leads), ...extraLeads];
    const firstLeadDays = ps.map((p) => p.leads.length ? (Math.min(...p.leads.map((l) => ms(l.createdAt))) - p.at) / DAY : null).filter((x) => x != null);
    return { label, posts: ps.length, leads: ls.length, perPost: ps.length ? Math.round((ls.length / ps.length) * 100) / 100 : null, booked: ls.filter((l) => booked.has(l.id)).length, sold: ls.filter(isSold).length, daysToLead: firstLeadDays.length ? Math.round(median(firstLeadDays) * 10) / 10 : null, sitting: ps.filter((p) => !p.leads.length && now - p.at >= SITTING_DAYS * DAY).length };
  };
  const group = (keyOf) => { const m = new Map(); posts.forEach((p) => { const k = keyOf(p) || "Other"; if (!m.has(k)) m.set(k, []); m.get(k).push(p); }); return m; };
  const byModel = [...group((p) => p.label)].map(([label, ps]) => roll(label, ps));
  // Leads that named a model nobody posted still say what Facebook asks for.
  const extra = new Map();
  unmatched.forEach((l) => { const lb = modelLabel(null, l.vehicleInterest); if (!byModel.some((r) => r.label === lb)) { if (!extra.has(lb)) extra.set(lb, []); extra.get(lb).push(l); } else { const r = byModel.find((x) => x.label === lb); r.leads++; if (booked.has(l.id)) r.booked++; if (isSold(l)) r.sold++; r.perPost = r.posts ? Math.round((r.leads / r.posts) * 100) / 100 : null; } });
  [...extra].forEach(([label, ls]) => byModel.push(roll(label, [], ls)));
  const byBody = [...group((p) => p.body)].filter(([k]) => k && k !== "Other").map(([label, ps]) => roll(label, ps));
  const band = (p) => p.price == null ? "" : p.price < 15000 ? "Under $15k" : p.price < 25000 ? "$15–25k" : p.price < 40000 ? "$25–40k" : "$40k and up";
  const byPrice = [...group(band)].filter(([k]) => k && k !== "Other").map(([label, ps]) => roll(label, ps));
  const order = (a, b) => (b.perPost || 0) - (a.perPost || 0) || b.leads - a.leads || b.posts - a.posts;
  byModel.sort(order); byBody.sort(order); byPrice.sort((a, b) => a.label.localeCompare(b.label));
  const total = roll("All", posts);
  total.leads = fbLeads.length; total.booked = fbLeads.filter((l) => booked.has(l.id)).length; total.sold = fbLeads.filter(isSold).length; total.perPost = posts.length ? Math.round((fbLeads.length / posts.length) * 100) / 100 : null;
  const sitting = posts.filter((p) => !p.leads.length && now - p.at >= SITTING_DAYS * DAY).sort((a, b) => a.at - b.at).map((p) => ({ name: p.name || p.label, stock: p.stock, days: Math.floor((now - p.at) / DAY) }));
  return { posts: posts.length, leads: fbLeads.length, unmatched: unmatched.length, total, byModel, byBody, byPrice, sitting };
}

/** One line: "12 posts · 9 leads (0.75 a post) · 3 booked · 1 sold — Frontier pulls best (2 a post); 4 posts sitting". */
export function scoreboardLine(sb) {
  if (!sb || (!sb.posts && !sb.leads)) return "No Marketplace posts or Facebook leads in this window yet.";
  const best = sb.byModel.find((r) => r.posts && r.leads);
  const bits = [`${sb.posts} post${sb.posts === 1 ? "" : "s"}`, `${sb.leads} lead${sb.leads === 1 ? "" : "s"}${sb.total.perPost != null ? ` (${sb.total.perPost} a post)` : ""}`];
  if (sb.total.booked) bits.push(`${sb.total.booked} booked`);
  if (sb.total.sold) bits.push(`${sb.total.sold} sold`);
  let tail = "";
  if (best) tail += ` — ${best.label} pulls best (${best.perPost} a post)`;
  if (sb.sitting.length) tail += `${best ? ";" : " —"} ${sb.sitting.length} post${sb.sitting.length === 1 ? "" : "s"} sitting with no lead`;
  return bits.join(" · ") + tail;
}
