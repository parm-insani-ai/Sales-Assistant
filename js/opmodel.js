// The store's operating model: the month's targets worked backwards to what
// each day has to produce, at the store's own ratios.
//
//   units  ←  customers spoken with  (closing ratio, by new and used)
//   units through an appointment  ←  shows  ←  appointments set
//   ups needed, by source, at the store's mix and each source's close rate
//   per rep: units, customers, appointments, by week and by selling day
//   pace: where each number should be today
//
// Pure, so node can test it. The defaults are O'Regan's Nissan Halifax's
// year-to-date figures (ups and units by source from the CRM); the store's
// own settings replace them on Admin, and the measured month replaces the
// ratios as the app records them.

export const DEFAULT_SOURCES = [
  // key, label, ups, units — year to date, from the CRM's source report.
  { key: "dealer_site", label: "Dealer site", ups: 382, units: 99 },
  { key: "website", label: "O'Regan's website", ups: 265, units: 97 },
  { key: "appointment", label: "Appointment", ups: 172, units: 123 },
  { key: "facebook", label: "Facebook", ups: 89, units: 31 },
  { key: "repeat", label: "Repeat customer", ups: 74, units: 55 },
  { key: "referral", label: "Referral", ups: 73, units: 45 },
  { key: "autoalert", label: "Auto Alert", ups: 66, units: 22 },
  { key: "lot", label: "Lot", ups: 40, units: 9 },
  { key: "service", label: "Service", ups: 37, units: 14 },
  { key: "promo", label: "Promo letter", ups: 28, units: 12 },
  { key: "activengage", label: "ActivEngage", ups: 23, units: 12 },
  { key: "oem", label: "Manufacturer lead", ups: 21, units: 11 },
  { key: "service_drive", label: "Service drive", ups: 13, units: 3 },
  { key: "autotrader", label: "Auto Trader", ups: 11, units: 6 },
  { key: "other", label: "Other", ups: 6, units: 1 },
];

export const DEFAULT_PLAN = {
  targetNew: 50, targetUsed: 30,
  // Sold ÷ customers spoken with, in percent. The store's year to date is
  // 41.5 across both; a measured month by category replaces it.
  closingNew: 41.5, closingUsed: 41.5,
  // How the booked path converts: the share of units that come through an
  // appointment, the show rate, and closing on a show. Appointment ups close
  // at 72 year to date; the show rate is measured by the app.
  apptShare: 60, showRate: 60, closeOnShow: 72,
  // Selling days: 0 = Sunday … 6 = Saturday.
  sellingDays: [1, 2, 3, 4, 5, 6],
  // Each rep's units this month, by user id; anyone not listed gets an
  // even share of what's left.
  alloc: {},
  sources: DEFAULT_SOURCES,
};

const pad = (n) => String(n).padStart(2, "0");
const r1 = (n) => Math.round(n * 10) / 10;
const ceil = (n) => Math.ceil(n - 1e-9);
const pct = (n) => (isFinite(n) && n > 0 ? n / 100 : 0);

// Selling days in a month, and how many have passed through `now` (today counts).
export function sellingDays(now = new Date(), days = DEFAULT_PLAN.sellingDays) {
  const y = now.getFullYear(), m = now.getMonth();
  const total = new Date(y, m + 1, 0).getDate();
  let all = 0, gone = 0;
  for (let d = 1; d <= total; d++) {
    const dow = new Date(y, m, d).getDay();
    if (!days.includes(dow)) continue;
    all++; if (d <= now.getDate()) gone++;
  }
  return { all, gone, left: all - gone, isSellingDay: days.includes(now.getDay()) };
}

/**
 * The month's plan.
 *   cfg: DEFAULT_PLAN shape (partial allowed)
 *   members: [{ user_id, name, role }] — the reps the units are spread over
 *   now: the date the pace is read at
 */
export function storePlan(cfg = {}, { members = [], now = new Date() } = {}) {
  const p = { ...DEFAULT_PLAN, ...cfg, sources: (cfg.sources && cfg.sources.length ? cfg.sources : DEFAULT_SOURCES) };
  const days = sellingDays(now, p.sellingDays && p.sellingDays.length ? p.sellingDays : DEFAULT_PLAN.sellingDays);
  const tNew = Math.max(0, Number(p.targetNew) || 0), tUsed = Math.max(0, Number(p.targetUsed) || 0), units = tNew + tUsed;
  const cNew = pct(p.closingNew) || pct(DEFAULT_PLAN.closingNew), cUsed = pct(p.closingUsed) || pct(DEFAULT_PLAN.closingUsed);
  const custNew = cNew ? ceil(tNew / cNew) : 0, custUsed = cUsed ? ceil(tUsed / cUsed) : 0;
  const customers = { new: custNew, used: custUsed, total: custNew + custUsed, perDay: days.all ? r1((custNew + custUsed) / days.all) : 0 };
  const closing = units && customers.total ? r1((units / customers.total) * 100) : 0;

  // The booked path.
  const share = pct(p.apptShare), show = pct(p.showRate), cos = pct(p.closeOnShow);
  const viaAppt = Math.round(units * share);
  const shows = cos ? ceil(viaAppt / cos) : 0;
  const set = show ? ceil(shows / show) : 0;
  const appts = { unitsVia: viaAppt, shows, set, perDay: days.all ? r1(set / days.all) : 0, perWeek: r1(set / (days.all / 6)) };
  const walkins = { units: units - viaAppt, customers: Math.max(0, customers.total - shows) };

  // Ups by source at the store's mix: the total ups the units need at the
  // mix's weighted close, each source's share of them, and what each is
  // worth — so the manager sees which ups to grow.
  const srcs = p.sources.map((s) => ({ ...s, ups: Number(s.ups) || 0, units: Number(s.units) || 0 }));
  const upsAll = srcs.reduce((a, s) => a + s.ups, 0), unitsAll = srcs.reduce((a, s) => a + s.units, 0);
  const mixClose = upsAll ? unitsAll / upsAll : 0;
  const upsNeeded = mixClose ? ceil(units / mixClose) : 0;
  const sources = srcs.filter((s) => s.ups > 0).map((s) => {
    const close = s.ups ? s.units / s.ups : 0, shareOfUps = upsAll ? s.ups / upsAll : 0;
    const need = Math.round(upsNeeded * shareOfUps);
    return { key: s.key, label: s.label, share: r1(shareOfUps * 100), close: Math.round(close * 100), upsNeeded: need, unitsExpected: r1(need * close), perDay: days.all ? r1(need / days.all) : 0 };
  }).sort((a, b) => b.upsNeeded - a.upsNeeded);
  const apptSrc = sources.find((s) => s.key === "appointment");
  const lever = apptSrc ? { apptClose: apptSrc.close, mixClose: Math.round(mixClose * 100), perUp: r1((apptSrc.close - Math.round(mixClose * 100)) / 100) } : null;

  // Per rep: their units (set, else an even share of what's left), then the
  // rest at the store's ratios, by week and by selling day.
  const reps = members.filter((m) => m && m.user_id);
  const alloc = p.alloc || {};
  const fixed = reps.filter((m) => alloc[m.user_id] != null).reduce((a, m) => a + (Number(alloc[m.user_id]) || 0), 0);
  const free = reps.filter((m) => alloc[m.user_id] == null);
  const each = free.length ? Math.max(0, units - fixed) / free.length : 0;
  const weeks = days.all / 6;
  const perRep = reps.map((m) => {
    const u = alloc[m.user_id] != null ? Number(alloc[m.user_id]) || 0 : r1(each);
    const c = closing ? ceil(u / (closing / 100)) : 0;
    const a = units ? ceil(set * (u / units)) : 0;
    return { member: m, units: u, customers: c, appts: a, shows: units ? ceil(shows * (u / units)) : 0,
      week: { units: r1(u / weeks), customers: r1(c / weeks), appts: r1(a / weeks) },
      day: { customers: days.all ? r1(c / days.all) : 0, appts: days.all ? r1(a / days.all) : 0 } };
  });

  // Pace: where each number should be today, by selling days gone.
  const frac = days.all ? days.gone / days.all : 0;
  const pace = { frac: r1(frac * 100), units: r1(units * frac), unitsNew: r1(tNew * frac), unitsUsed: r1(tUsed * frac), customers: r1(customers.total * frac), appts: r1(set * frac), ups: r1(upsNeeded * frac) };

  return { targets: { new: tNew, used: tUsed, units }, closing: { new: r1(cNew * 100), used: r1(cUsed * 100), store: closing }, customers, appts, walkins, upsNeeded, mixClose: Math.round(mixClose * 100), sources, lever, perRep, days, pace };
}

// Actuals against the plan's pace, in one read each: ahead, on pace, or
// behind by how much. `actual` is what the month has so far.
export function paceRead(plan, actual = {}) {
  const line = (label, have, want, unit = "") => {
    const h = Number(have) || 0, w = Number(want) || 0, diff = r1(h - w);
    return { label, have: h, want: w, diff, state: diff >= 0 ? (diff > 0 ? "ahead" : "on") : "behind", text: diff >= 0 ? (diff > 0 ? `${diff} ahead` : "on pace") : `${Math.abs(diff)} behind`, unit };
  };
  return [
    line("Units", actual.units, plan.pace.units),
    line("Customers spoken with", actual.customers, plan.pace.customers),
    line("Appointments set", actual.appts, plan.pace.appts),
  ];
}

// The CRM's source names, onto the plan's keys, so a customer's `source`
// counts against the right row. Unknown sources count as "other".
export function sourceKey(source) {
  const s = String(source || "").trim().toLowerCase();
  if (!s) return "other";
  if (/appoint/.test(s)) return "appointment";
  if (/dealer ?site|internet|web lead|email lead/.test(s)) return /manufacturer|oem|nissan\.ca/.test(s) ? "oem" : "dealer_site";
  if (/o'?regan|website|site/.test(s)) return "website";
  if (/facebook|instagram|social/.test(s)) return "facebook";
  if (/repeat|be-?back|previous/.test(s)) return "repeat";
  if (/referr/.test(s)) return "referral";
  if (/auto ?alert|paid-?off|equity|lease ?end/.test(s)) return "autoalert";
  if (/^lot$|walk|showroom/.test(s)) return "lot";
  if (/service drive/.test(s)) return "service_drive";
  if (/service/.test(s)) return "service";
  if (/promo|letter|mail/.test(s)) return "promo";
  if (/activ/.test(s)) return "activengage";
  if (/trader/.test(s)) return "autotrader";
  if (/manufacturer|oem/.test(s)) return "oem";
  if (/phone|call/.test(s)) return "website";
  return "other";
}
