// The daily customer prospect log — the sheet the store has reps fill in by
// hand every day, in the app and filled in by itself: the Auto Alert /
// service-list customers the rep reached that day come in from the calls,
// texts and appointments as they happen, with the outcome read from the
// records; the Facebook listings they copied come in as posts. The rep adds
// or corrects rows; what they type wins. It syncs with everything else, and
// the manager reads every rep's sheet for any day under + → Daily logs —
// built from the rep's synced records, so it is there whether or not the
// rep ever opened the page. The end-of-day recap carries the totals.
//
// One record a day per rep: { id: "daylog:YYYY-MM-DD", date, prospects:
// [{ leadId, name, phone, email, outcome, auto }], posts: [{ vehicleId,
// vehicle, stock, store, auto }] }. The building is in js/daylog.js.

import * as store from "../store.js";
import * as backend from "../backend.js";
import { esc, todayISO } from "../utils.js";
import { icon } from "../icons.js";
import { navigate } from "../router.js";
import { cachedStore, myStore, isManager, memberName } from "../team.js";
import { onPull } from "../pulltorefresh.js";
import { SLOTS, idFor, buildSheet, stripSheet, filledProspect, filledPost } from "../daylog.js";

const vehicleLabel = (v) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
const ofSlots = (n) => (n <= SLOTS ? `${n} of ${SLOTS}` : `${n}`);

// This phone's sheet for a day, from its own records.
export function sheetFor(date) {
  const s = store.getSettings();
  return buildSheet({ date, saved: store.get("daylogs", idFor(date)), leads: store.all("leads"), calls: store.all("calls"), texts: store.all("texts"), appointments: store.all("appointments"), events: store.all("events").filter((e) => e.kind === "fb_post"), dealership: s.dealership || "" });
}
// Keep the sheet as built — the rows read from the records included — so
// the record that syncs carries them. Only when something is on it.
function keep(sheet) {
  const data = stripSheet(sheet);
  if (!data.prospects.some(filledProspect) && !data.posts.some(filledPost)) return;
  const existing = store.get("daylogs", sheet.id);
  if (existing && JSON.stringify({ p: existing.prospects, q: existing.posts }) === JSON.stringify({ p: data.prospects, q: data.posts })) return;
  if (existing) store.update("daylogs", sheet.id, data); else store.create("daylogs", { id: sheet.id, ...data });
}
// For Home: today's counts.
export function todayCounts() {
  const c = sheetFor(todayISO()).counts;
  return c.prospects || c.posts ? c : null;
}

// ---- The rep's sheet ----
export function renderDaylog(view) {
  const el = document.createElement("div");
  view.appendChild(el);
  let date = todayISO();
  const s = store.getSettings();

  function draw() {
    const sheet = sheetFor(date);
    keep(sheet);
    const c = sheet.counts;
    const dayLabel = new Date(date + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
    el.innerHTML = `
      <div class="hero"><div class="hero-title">Daily log</div></div>
      <div class="row dl-day" style="margin:0 2px 12px;align-items:center"><span class="small muted" style="flex:1">${esc(dayLabel)}</span><input type="date" class="dl-date" value="${esc(date)}" max="${esc(todayISO())}" aria-label="Day"></div>

      <div class="section-title" style="margin-top:0">Auto Alert / Service list <span class="muted dl-count" style="font-weight:500;font-size:0.78rem">· ${ofSlots(c.prospects)}</span></div>
      <div class="card dl-card">
        ${sheet.prospects.map((p, i) => `
        <div class="dl-slot${p.auto ? " dl-is-auto" : ""}" data-kind="prospect" data-i="${i}">
          <div class="dl-num" title="${p.auto ? "Read from your calls and texts" : ""}">${i + 1}</div>
          <div class="dl-fields">
            <div class="dl-pickwrap"><input class="dl-in" data-f="name" value="${esc(p.name)}" placeholder="Customer" autocomplete="off"><div class="dl-pick" hidden></div></div>
            ${p.reason || p.outcomeAt ? `<div class="small muted dl-why">${esc([p.reason, p.outcomeAt ? `reached ${p.outcomeAt}` : ""].filter(Boolean).join(" · "))}</div>` : ""}
            <div class="dl-two"><input class="dl-in" data-f="phone" type="tel" inputmode="tel" value="${esc(p.phone)}" placeholder="Phone"><input class="dl-in" data-f="email" type="email" value="${esc(p.email)}" placeholder="Email"></div>
            <input class="dl-in dl-outcome" data-f="outcome" value="${esc(p.outcome)}" placeholder="${esc(p.outcomeAuto || "Outcome")}">
          </div>
        </div>`).join("")}
      </div>

      <div class="section-title">Facebook posts <span class="muted dl-count" style="font-weight:500;font-size:0.78rem">· ${ofSlots(c.posts)}</span></div>
      <div class="card dl-card">
        ${sheet.posts.map((p, i) => `
        <div class="dl-slot${p.auto ? " dl-is-auto" : ""}" data-kind="post" data-i="${i}">
          <div class="dl-num" title="${p.auto ? "From a listing you copied" : ""}">${i + 1}</div>
          <div class="dl-fields">
            <div class="dl-pickwrap"><input class="dl-in" data-f="vehicle" value="${esc(p.vehicle)}" placeholder="Vehicle" autocomplete="off"><div class="dl-pick" hidden></div></div>
            <div class="dl-two"><input class="dl-in" data-f="stock" value="${esc(p.stock)}" placeholder="Stock #"><input class="dl-in" data-f="store" value="${esc(p.store)}" placeholder="${esc(s.dealership || "Store")}"></div>
          </div>
        </div>`).join("")}
      </div>
      <div class="hint" style="margin:10px 2px 0">Fills in by itself from your calls, texts and the listings you copy; a green number is one it read. Add or correct anything — it saves as you type and goes to the store. An outcome on a customer from your book counts as a contact.</div>
    `;
    wire(sheet);
  }

  function wire(sheet) {
    el.querySelector(".dl-date").addEventListener("change", (e) => { const v = e.target.value; if (v && v <= todayISO()) { date = v; draw(); } });
    const counts = () => {
      const fresh = buildSheet({ date, saved: stripSheet(sheet), leads: [], events: [] }).counts; // what's typed, counted
      const [a, b] = el.querySelectorAll(".dl-count");
      if (a) a.textContent = `· ${ofSlots(Math.max(fresh.prospects, sheet.counts.prospects))}`;
      if (b) b.textContent = `· ${ofSlots(Math.max(fresh.posts, sheet.counts.posts))}`;
    };
    let timer = null;
    const commit = () => { clearTimeout(timer); timer = setTimeout(() => { const data = stripSheet(sheet); const existing = store.get("daylogs", sheet.id); if (existing) store.update("daylogs", sheet.id, data); else store.create("daylogs", { id: sheet.id, ...data }); counts(); }, 350); };
    el.querySelectorAll(".dl-slot").forEach((slot) => {
      const kind = slot.dataset.kind, i = Number(slot.dataset.i);
      const row = kind === "prospect" ? sheet.prospects[i] : sheet.posts[i];
      const pick = slot.querySelector(".dl-pick");
      const picker = slot.querySelector(".dl-pickwrap .dl-in");
      // Typing a name (or a vehicle) offers matches from the book (the lot);
      // a tap fills the row and remembers which record it was.
      const showMatches = () => {
        const q = picker.value.trim().toLowerCase();
        if (q.length < 2) { pick.hidden = true; return; }
        const items = kind === "prospect"
          ? store.all("leads").filter((l) => String(l.name || "").toLowerCase().includes(q)).slice(0, 5).map((l) => ({ id: l.id, title: l.name, sub: [l.phone, l.vehicleInterest].filter(Boolean).join(" · ") }))
          : store.all("vehicles").filter((v) => v.status !== "sold" && (`${vehicleLabel(v)} ${v.stock || ""}`).toLowerCase().includes(q)).slice(0, 5).map((v) => ({ id: v.id, title: vehicleLabel(v), sub: v.stock ? `#${v.stock}` : "" }));
        pick.innerHTML = items.map((x) => `<button type="button" class="dl-match" data-id="${esc(x.id)}"><span class="strong">${esc(x.title)}</span>${x.sub ? ` <span class="muted small">${esc(x.sub)}</span>` : ""}</button>`).join("");
        pick.hidden = !items.length;
        pick.querySelectorAll(".dl-match").forEach((b) => b.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          if (kind === "prospect") {
            const l = store.get("leads", b.dataset.id); if (!l) return;
            Object.assign(row, { leadId: l.id, name: l.name || "", phone: l.phone || row.phone, email: l.email || row.email, auto: false });
          } else {
            const v = store.get("vehicles", b.dataset.id); if (!v) return;
            Object.assign(row, { vehicleId: v.id, vehicle: vehicleLabel(v), stock: v.stock || row.stock, store: row.store || s.dealership || "", auto: false });
          }
          slot.querySelectorAll(".dl-in").forEach((inp) => { inp.value = row[inp.dataset.f] || ""; });
          pick.hidden = true;
          commit();
        }));
      };
      picker.addEventListener("input", showMatches);
      picker.addEventListener("blur", () => setTimeout(() => { pick.hidden = true; }, 120));
      slot.querySelectorAll(".dl-in").forEach((inp) => {
        inp.addEventListener("input", () => {
          const f = inp.dataset.f, v = inp.value;
          // Typing over a picked name or vehicle lets go of the record.
          if (f === "name" && row.leadId && v !== row.name) { row.leadId = ""; row.auto = false; }
          if (f === "vehicle" && row.vehicleId && v !== row.vehicle) { row.vehicleId = ""; row.auto = false; }
          row[f] = v;
          if (kind === "post" && f === "vehicle" && v && !row.store) { row.store = s.dealership || ""; const st = slot.querySelector('[data-f="store"]'); if (st && !st.value) st.value = row.store; }
          commit();
        });
        // An outcome written against a customer from the book is a contact
        // made — it counts toward their touches and speed to lead like any
        // other, and the event log keeps it as a daily-log prospect. Not
        // again for a customer the records already show reached today.
        if (inp.dataset.f === "outcome") inp.addEventListener("change", () => {
          const v = inp.value.trim();
          if (!v || row.outcomeLogged === v) return;
          row.outcomeLogged = v;
          if (row.leadId && !row.outcomeAuto && store.get("leads", row.leadId)) { try { store.logContact(row.leadId, { via: "call", notes: `Daily log: ${v}` }); } catch { /* the sheet still saves */ } }
          try { store.logEvent("daylog_prospect", { leadId: row.leadId || null, name: row.name, meta: { outcome: v.slice(0, 80), date: sheet.date } }); } catch { /* fine */ }
          commit();
        });
      });
    });
  }

  draw();
}

// ---- The manager's read: every rep's sheet for a day, from their records ----
// A day's window, widened a day each way: `at` is UTC and the day is local;
// the builder keeps what falls on the day.
const windowOf = (date) => {
  const d = new Date(date + "T00:00:00");
  const iso = (ms) => new Date(ms).toISOString();
  return { from: iso(d.getTime() - 36 * 3600000), to: iso(d.getTime() + 60 * 3600000) };
};
export async function repSheet(userId, date, { dealership = "" } = {}) {
  const w = windowOf(date);
  const rd = (coll, filters, limit = 2000) => backend.readRecords(userId, coll, filters, { select: "data", limit }).then((rs) => rs.map((r) => r.data || {}), () => []);
  const [saved, calls, texts, appts, events] = await Promise.all([
    rd("daylogs", { id: `eq.${idFor(date)}` }, 1),
    rd("calls", { "data->>at": [`gte.${w.from}`, `lt.${w.to}`] }),
    rd("texts", { "data->>at": [`gte.${w.from}`, `lt.${w.to}`] }),
    rd("appointments", { "data->>createdAt": [`gte.${w.from}`, `lt.${w.to}`] }),
    rd("events", { "data->>kind": "eq.fb_post", "data->>at": [`gte.${w.from}`, `lt.${w.to}`] }),
  ]);
  const ids = new Set([...calls, ...texts, ...appts].map((x) => x.leadId).filter(Boolean));
  (saved[0] && saved[0].prospects || []).forEach((p) => { if (p.leadId) ids.add(p.leadId); });
  const leads = ids.size ? await rd("leads", { id: `in.(${[...ids].join(",")})` }, ids.size + 5) : [];
  return buildSheet({ date, saved: saved[0] || null, leads, calls, texts, appointments: appts, events, dealership });
}

export function renderDaylogs(view) {
  const el = document.createElement("div");
  view.appendChild(el);
  let team = cachedStore();
  let date = todayISO();
  let logs = null, loading = false, error = "";

  async function load() {
    if (loading) return;
    loading = true; error = ""; draw();
    try {
      team = await myStore();
      if (!team || !isManager(team)) throw new Error("The daily logs are the manager's.");
      logs = await Promise.all((team.members || []).map(async (m) => ({ member: m, sheet: await repSheet(m.user_id, date, { dealership: team.name || "" }) })));
    } catch (e) { error = e && e.message ? e.message : "couldn't read the logs"; logs = logs || []; }
    loading = false; draw();
  }

  function draw() {
    const today = todayISO();
    const yest = new Date(Date.now() - 86400000); const yKey = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, "0")}-${String(yest.getDate()).padStart(2, "0")}`;
    const dayLabel = new Date(date + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
    const chip = (d, label) => `<button class="btn btn-sm ${d === date ? "btn-primary" : "btn-ghost"}" data-day="${d}">${label}</button>`;
    const head = `<div class="hero"><div class="hero-title">Daily logs</div></div>
      <div class="row" style="margin:0 2px 12px;align-items:center;gap:8px"><div class="lead-chips" style="margin:0;flex:1">${chip(today, "Today")}${chip(yKey, "Yesterday")}</div><input type="date" class="dl-date" value="${esc(date)}" max="${esc(today)}" aria-label="Day"></div>
      ${error ? `<div class="fab-note" style="text-align:left;color:var(--danger);margin:0 2px 12px">${esc(error)}</div>` : ""}`;
    if (!logs) { el.innerHTML = head + `<div class="card muted small">${loading ? "Reading the reps' logs…" : "Pull down to read."}</div>`; wire(); return; }
    const reps = logs.filter((x) => x.member.role !== "manager" || x.sheet.counts.prospects || x.sheet.counts.posts);
    const filled = reps.filter((x) => x.sheet.counts.prospects || x.sheet.counts.posts);
    const tot = filled.reduce((a, x) => { const c = x.sheet.counts; a.p += c.prospects; a.o += c.outcomes; a.f += c.posts; return a; }, { p: 0, o: 0, f: 0 });
    const summary = `<div class="section-title" style="margin-top:0">${esc(dayLabel)} <span class="muted" style="font-weight:500;font-size:0.78rem">· ${filled.length} of ${reps.length} rep${reps.length === 1 ? "" : "s"} logged${loading ? " · reading…" : ""}</span></div>
      <div class="card dl-sum"><div class="row" style="gap:16px"><div><div class="strong" style="font-size:1.2rem">${tot.p}</div><div class="small muted">prospects</div></div><div><div class="strong" style="font-size:1.2rem">${tot.o}</div><div class="small muted">with an outcome</div></div><div><div class="strong" style="font-size:1.2rem">${tot.f}</div><div class="small muted">posts</div></div></div></div>`;
    const cards = reps.map(({ member, sheet }) => {
      const name = memberName(member);
      const c = sheet.counts;
      if (!c.prospects && !c.posts) return `<div class="card dl-rep dl-empty" data-rep="${esc(member.user_id)}"><div class="row"><div class="row-main"><div class="row-title">${esc(name)}</div><div class="row-sub">Nothing logged, nobody on the list reached</div></div></div></div>`;
      const pros = sheet.prospects.filter(filledProspect);
      const posts = sheet.posts.filter(filledPost);
      return `<div class="card dl-rep" data-rep="${esc(member.user_id)}">
        <div class="row" style="margin-bottom:8px"><div class="row-main"><div class="row-title">${esc(name)}</div></div><span class="small muted">${ofSlots(c.prospects)} · ${c.posts} post${c.posts === 1 ? "" : "s"}</span></div>
        ${pros.length ? `<div class="small strong muted" style="margin:6px 0 2px">Auto Alert / Service list</div>${pros.map((p) => `<div class="dl-line"><div><span class="strong">${esc(p.name || "—")}</span>${p.phone ? ` <span class="muted small">${esc(p.phone)}</span>` : ""}${p.email ? ` <span class="muted small">${esc(p.email)}</span>` : ""}${p.reason ? ` <span class="muted small">· ${esc(p.reason)}</span>` : ""}</div><div class="small ${p.outcome || p.outcomeAuto ? "" : "muted"}">${esc(p.outcome || p.outcomeAuto || "no outcome yet")}${p.outcomeAt ? ` <span class="muted">· ${esc(p.outcomeAt)}</span>` : ""}</div></div>`).join("")}` : ""}
        ${posts.length ? `<div class="small strong muted" style="margin:10px 0 2px">Facebook posts</div>${posts.map((p) => `<div class="dl-line"><div><span class="strong">${esc(p.vehicle || "—")}</span>${p.stock ? ` <span class="muted small">#${esc(p.stock)}</span>` : ""}</div>${p.store ? `<div class="small muted">${esc(p.store)}</div>` : ""}</div>`).join("")}` : ""}
      </div>`;
    }).join("");
    el.innerHTML = head + summary + cards;
    wire();
  }
  function wire() {
    el.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => { date = b.dataset.day; logs = null; load(); }));
    const inp = el.querySelector(".dl-date");
    if (inp) inp.addEventListener("change", (e) => { const v = e.target.value; if (v && v <= todayISO()) { date = v; logs = null; load(); } });
    el.querySelectorAll(".dl-rep[data-rep]").forEach((n) => n.addEventListener("click", () => { try { sessionStorage.setItem("customers-query", JSON.stringify({ q: "", rep: n.dataset.rep, mode: "all" })); } catch { /* fine */ } }));
  }

  draw();
  load();
  onPull(() => { logs = null; load(); });
}

// A rep's Home row: how far today's sheet is, a tap away.
export function daylogRow() {
  const c = todayCounts();
  const row = document.createElement("div");
  row.className = "card card-tap dl-home";
  row.innerHTML = `<div class="row"><div class="row-main"><div class="row-title">${icon("file")} Daily log</div><div class="row-sub">${c ? `${ofSlots(c.prospects)} prospects · ${ofSlots(c.posts)} posts${c.auto ? ` · ${c.auto} read from your day` : ""}` : "Fills in as you work the list"}</div></div><span class="muted">›</span></div>`;
  row.addEventListener("click", () => navigate("/daylog"));
  return row;
}
