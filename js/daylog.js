// The daily customer prospect log, built from what the rep actually did:
// the Auto Alert / service-list customers they reached that day, with the
// outcome read from the call, the text, the reply, the appointment; the
// Facebook listings they copied to post. The rep's own rows sit alongside,
// and what they typed always wins over what was read. Pure: the rep's page
// builds it from the phone, the manager's board from the rep's synced
// records, the function from the same records at the recap.

export const SLOTS = 5;
export const idFor = (date) => `daylog:${date}`;

// The local day of a moment, on this phone.
export function dayOf(iso) {
  const d = new Date(iso); if (isNaN(d)) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// On the Auto Alert / service list: flagged by AutoAlert, in the service
// drive, or an owner from the book rather than a walk-in or an internet lead.
export function onList(l) {
  return !!(l && (l.alertType || l.serviceAppt || l.importedAt || /auto ?alert|service/i.test(String(l.source || ""))));
}
export function reasonOf(l) {
  if (!l) return "";
  if (l.alertType) return `AutoAlert: ${String(l.alertType).slice(0, 28)}`;
  if (l.serviceAppt) return `In service ${String(l.serviceAppt).slice(0, 10)}`;
  if (/auto ?alert/i.test(String(l.source || ""))) return "AutoAlert";
  if (/service/i.test(String(l.source || ""))) return "Service list";
  return "Owner book";
}
export const filledProspect = (p) => !!(p && (p.name || p.phone || p.email || p.outcome));
export const filledPost = (p) => !!(p && (p.vehicle || p.stock));
const blankProspect = () => ({ leadId: "", name: "", phone: "", email: "", outcome: "" });
const blankPost = () => ({ vehicleId: "", vehicle: "", stock: "", store: "" });
const hm = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}${d.getHours() < 12 ? "am" : "pm"}`; };

// What came of the day's contact with one customer, in a few words, from
// the records: "Reached — wants Saturday · texted · replied · appointment
// set Tue 2pm". Never a figure.
export function outcomeOf({ calls = [], texts = [], appointments = [] }) {
  const parts = [];
  const reached = calls.find((c) => c.outcome === "reached" || c.logged);
  if (reached) parts.push(reached.notes ? `Reached — ${String(reached.notes).replace(/^Daily log:\s*/i, "").slice(0, 60)}` : "Reached");
  else if (calls.length) parts.push(calls.some((c) => /voicemail|no answer/i.test(String(c.notes || c.outcome || ""))) ? "Voicemail" : "Called");
  const out = texts.filter((t) => t.dir === "out"), inn = texts.filter((t) => t.dir === "in");
  if (out.length) parts.push("texted");
  if (inn.length) parts.push("replied");
  const appt = appointments.find((a) => a.status !== "canceled");
  if (appt) parts.push(`appointment set${appt.when ? ` ${String(appt.when).slice(5, 10).replace("-", "/")} ${String(appt.when).slice(11, 16)}` : ""}`);
  return parts.join(" · ");
}

// The sheet for one day. `saved` is the rep's own record (may be null);
// the rest are that rep's records, any span — only the day's count.
export function buildSheet({ date, saved = null, leads = [], calls = [], texts = [], appointments = [], events = [], dealership = "" }) {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const inDay = (iso) => dayOf(iso) === date;
  // What happened with each customer that day.
  const touched = new Map();
  const add = (leadId, kind, rec) => { if (!leadId) return; const t = touched.get(leadId) || { calls: [], texts: [], appointments: [], first: "" }; t[kind].push(rec); const at = String(rec.at || rec.createdAt || ""); if (!t.first || at < t.first) t.first = at; touched.set(leadId, t); };
  calls.forEach((c) => { if (c.dir !== "in" && inDay(c.at)) add(c.leadId, "calls", c); });
  texts.forEach((t) => { if (inDay(t.at || t.createdAt)) add(t.leadId, "texts", t); });
  appointments.forEach((a) => { if (inDay(a.createdAt)) add(a.leadId, "appointments", a); });
  // The rep's rows first, as they left them.
  const prospects = (saved && Array.isArray(saved.prospects) ? saved.prospects : []).map((p) => ({ ...blankProspect(), ...p }));
  const has = (id, name) => prospects.some((p) => (id && p.leadId === id) || (name && String(p.name || "").trim().toLowerCase() === String(name).trim().toLowerCase()));
  // Then the customers reached that day who are on the list, in the order
  // they were reached: into the first empty slot, or on the end.
  const candidates = [...touched.entries()].filter(([id, t]) => onList(byId.get(id)) && (t.calls.length || t.texts.some((x) => x.dir === "out"))).sort((a, b) => a[1].first.localeCompare(b[1].first));
  for (const [id] of candidates) {
    const l = byId.get(id);
    if (has(id, l.name)) continue;
    const row = { ...blankProspect(), leadId: id, name: l.name || "", phone: l.phone || "", email: l.email || "", auto: true };
    const slot = prospects.findIndex((p) => !filledProspect(p));
    if (slot >= 0) prospects[slot] = row; else prospects.push(row);
  }
  while (prospects.length < SLOTS) prospects.push(blankProspect());
  // Every row with a customer from the book carries what the records say,
  // under what the rep wrote.
  prospects.forEach((p) => {
    const l = p.leadId ? byId.get(p.leadId) : null;
    p.reason = l ? reasonOf(l) : "";
    const t = p.leadId ? touched.get(p.leadId) : null;
    p.outcomeAuto = t ? outcomeOf(t) : "";
    p.outcomeAt = t && t.first ? hm(t.first) : "";
  });

  const posts = (saved && Array.isArray(saved.posts) ? saved.posts : []).map((p) => ({ ...blankPost(), ...p }));
  const hasPost = (vid, vehicle) => posts.some((p) => (vid && p.vehicleId === vid) || (vehicle && String(p.vehicle || "").trim().toLowerCase() === String(vehicle).trim().toLowerCase()));
  const posted = events.filter((e) => e.kind === "fb_post" && inDay(e.at)).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const e of posted) {
    const m = e.meta || {};
    if (hasPost(m.vehicleId, m.vehicle)) continue;
    const row = { ...blankPost(), vehicleId: m.vehicleId || "", vehicle: m.vehicle || "", stock: m.stock || "", store: m.store || dealership || "", auto: true };
    const slot = posts.findIndex((p) => !filledPost(p));
    if (slot >= 0) posts[slot] = row; else posts.push(row);
  }
  while (posts.length < SLOTS) posts.push(blankPost());

  const counts = {
    prospects: prospects.filter(filledProspect).length,
    outcomes: prospects.filter((p) => filledProspect(p) && (p.outcome || p.outcomeAuto)).length,
    posts: posts.filter(filledPost).length,
    auto: prospects.filter((p) => p.auto).length + posts.filter((p) => p.auto).length,
  };
  return { id: idFor(date), date, prospects, posts, counts };
}

// What goes in the record: the rows, without the derived fields.
export function stripSheet(sheet) {
  const keep = (p, keys) => { const o = {}; keys.forEach((k) => { if (p[k] != null && p[k] !== "") o[k] = p[k]; }); if (p.auto) o.auto = true; return o; };
  return { date: sheet.date, prospects: sheet.prospects.map((p) => keep(p, ["leadId", "name", "phone", "email", "outcome", "outcomeLogged"])), posts: sheet.posts.map((p) => keep(p, ["vehicleId", "vehicle", "stock", "store"])) };
}
