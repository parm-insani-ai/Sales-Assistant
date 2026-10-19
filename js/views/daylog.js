// The daily customer prospect log — the sheet the store has reps fill in by
// hand every day, in the app: five Auto Alert / service-list customers with
// the outcome of each call, and five Facebook posts (vehicle, stock, store).
// The rep fills it on their phone; it syncs with everything else, and the
// manager reads every rep's sheet for any day under + → Daily logs.
//
// One record a day per rep: { id: "daylog:YYYY-MM-DD", date, prospects:
// [{ leadId, name, phone, email, outcome }] × 5, posts: [{ vehicleId,
// vehicle, stock, store }] × 5 }. A customer picked from the book carries
// their id, so an outcome on them is also logged as a contact.

import * as store from "../store.js";
import * as backend from "../backend.js";
import { esc, todayISO } from "../utils.js";
import { icon } from "../icons.js";
import { navigate } from "../router.js";
import { cachedStore, myStore, isManager, memberName } from "../team.js";
import { onPull } from "../pulltorefresh.js";

export const SLOTS = 5;
const idFor = (date) => `daylog:${date}`;
const blankProspect = () => ({ leadId: "", name: "", phone: "", email: "", outcome: "" });
const blankPost = () => ({ vehicleId: "", vehicle: "", stock: "", store: "" });

// The day's record, made on first use; always five of each.
export function daylogFor(date) {
  const rec = store.get("daylogs", idFor(date));
  const fill = (xs, blank) => Array.from({ length: SLOTS }, (_, i) => ({ ...blank(), ...((xs || [])[i] || {}) }));
  return rec ? { ...rec, prospects: fill(rec.prospects, blankProspect), posts: fill(rec.posts, blankPost) } : { id: idFor(date), date, prospects: fill([], blankProspect), posts: fill([], blankPost) };
}
const filledProspect = (p) => !!(p.name || p.phone || p.email || p.outcome);
const filledPost = (p) => !!(p.vehicle || p.stock);
export function daylogCounts(rec) {
  return { prospects: (rec.prospects || []).filter(filledProspect).length, outcomes: (rec.prospects || []).filter((p) => p.outcome).length, posts: (rec.posts || []).filter(filledPost).length };
}
// For Home: today's counts, or null when nothing has been written yet.
export function todayCounts() {
  const rec = store.get("daylogs", idFor(todayISO()));
  return rec ? daylogCounts(rec) : null;
}
const vehicleLabel = (v) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");

// ---- The rep's sheet ----
export function renderDaylog(view) {
  const el = document.createElement("div");
  view.appendChild(el);
  let date = todayISO();
  const s = store.getSettings();

  function save(rec) {
    const existing = store.get("daylogs", rec.id);
    const data = { date: rec.date, prospects: rec.prospects, posts: rec.posts };
    if (existing) store.update("daylogs", rec.id, data); else store.create("daylogs", { id: rec.id, ...data });
  }

  function draw() {
    const rec = daylogFor(date);
    const c = daylogCounts(rec);
    const dayLabel = new Date(date + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
    el.innerHTML = `
      <div class="hero"><div class="hero-title">Daily log</div></div>
      <div class="row dl-day" style="margin:0 2px 12px;align-items:center"><span class="small muted" style="flex:1">${esc(dayLabel)}</span><input type="date" class="dl-date" value="${esc(date)}" max="${esc(todayISO())}" aria-label="Day"></div>

      <div class="section-title" style="margin-top:0">Auto Alert / Service list <span class="muted dl-count" style="font-weight:500;font-size:0.78rem">· ${c.prospects} of ${SLOTS}</span></div>
      <div class="card dl-card">
        ${rec.prospects.map((p, i) => `
        <div class="dl-slot" data-kind="prospect" data-i="${i}">
          <div class="dl-num">${i + 1}</div>
          <div class="dl-fields">
            <div class="dl-pickwrap"><input class="dl-in" data-f="name" value="${esc(p.name)}" placeholder="Customer" autocomplete="off"><div class="dl-pick" hidden></div></div>
            <div class="dl-two"><input class="dl-in" data-f="phone" type="tel" inputmode="tel" value="${esc(p.phone)}" placeholder="Phone"><input class="dl-in" data-f="email" type="email" value="${esc(p.email)}" placeholder="Email"></div>
            <input class="dl-in dl-outcome" data-f="outcome" value="${esc(p.outcome)}" placeholder="Outcome">
          </div>
        </div>`).join("")}
      </div>

      <div class="section-title">Facebook posts <span class="muted dl-count" style="font-weight:500;font-size:0.78rem">· ${c.posts} of ${SLOTS}</span></div>
      <div class="card dl-card">
        ${rec.posts.map((p, i) => `
        <div class="dl-slot" data-kind="post" data-i="${i}">
          <div class="dl-num">${i + 1}</div>
          <div class="dl-fields">
            <div class="dl-pickwrap"><input class="dl-in" data-f="vehicle" value="${esc(p.vehicle)}" placeholder="Vehicle" autocomplete="off"><div class="dl-pick" hidden></div></div>
            <div class="dl-two"><input class="dl-in" data-f="stock" value="${esc(p.stock)}" placeholder="Stock #"><input class="dl-in" data-f="store" value="${esc(p.store)}" placeholder="${esc(s.dealership || "Store")}"></div>
          </div>
        </div>`).join("")}
      </div>
      <div class="hint" style="margin:10px 2px 0">Saves as you type and goes to the store. Pick a customer from your book and the outcome counts as a contact.</div>
    `;
    wire(rec);
  }

  function wire(rec) {
    el.querySelector(".dl-date").addEventListener("change", (e) => { const v = e.target.value; if (v && v <= todayISO()) { date = v; draw(); } });
    const counts = () => {
      const c = daylogCounts(rec);
      const [a, b] = el.querySelectorAll(".dl-count");
      if (a) a.textContent = `· ${c.prospects} of ${SLOTS}`;
      if (b) b.textContent = `· ${c.posts} of ${SLOTS}`;
    };
    let timer = null;
    const commit = () => { clearTimeout(timer); timer = setTimeout(() => { save(rec); counts(); }, 350); };
    el.querySelectorAll(".dl-slot").forEach((slot) => {
      const kind = slot.dataset.kind, i = Number(slot.dataset.i);
      const row = kind === "prospect" ? rec.prospects[i] : rec.posts[i];
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
            Object.assign(row, { leadId: l.id, name: l.name || "", phone: l.phone || row.phone, email: l.email || row.email });
          } else {
            const v = store.get("vehicles", b.dataset.id); if (!v) return;
            Object.assign(row, { vehicleId: v.id, vehicle: vehicleLabel(v), stock: v.stock || row.stock, store: row.store || s.dealership || "" });
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
          if (f === "name" && row.leadId && v !== row.name) row.leadId = "";
          if (f === "vehicle" && row.vehicleId && v !== row.vehicle) row.vehicleId = "";
          row[f] = v;
          if (kind === "post" && f === "vehicle" && v && !row.store) { row.store = s.dealership || ""; const st = slot.querySelector('[data-f="store"]'); if (st && !st.value) st.value = row.store; }
          commit();
        });
        // An outcome written against a customer from the book is a contact
        // made — it counts toward their touches and speed to lead like any
        // other, and the event log keeps it as a daily-log prospect.
        if (inp.dataset.f === "outcome") inp.addEventListener("change", () => {
          const v = inp.value.trim();
          if (!v || row.outcomeLogged === v) return;
          row.outcomeLogged = v;
          if (row.leadId && store.get("leads", row.leadId)) { try { store.logContact(row.leadId, { via: "call", notes: `Daily log: ${v}` }); } catch { /* the sheet still saves */ } }
          try { store.logEvent("daylog_prospect", { leadId: row.leadId || null, name: row.name, meta: { outcome: v.slice(0, 80), date: rec.date } }); } catch { /* fine */ }
          commit();
        });
      });
    });
  }

  draw();
}

// ---- The manager's read: every rep's sheet for a day ----
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
      const per = await Promise.all((team.members || []).map(async (m) => {
        const rows = await backend.readRecords(m.user_id, "daylogs", { id: `eq.${idFor(date)}` }, { select: "data", limit: 1 }).catch(() => []);
        return { member: m, rec: rows[0] && rows[0].data ? rows[0].data : null };
      }));
      logs = per;
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
    const reps = logs.filter((x) => x.member.role !== "manager" || x.rec);
    const filled = reps.filter((x) => x.rec && (daylogCounts(x.rec).prospects || daylogCounts(x.rec).posts));
    const tot = filled.reduce((a, x) => { const c = daylogCounts(x.rec); a.p += c.prospects; a.o += c.outcomes; a.f += c.posts; return a; }, { p: 0, o: 0, f: 0 });
    const summary = `<div class="section-title" style="margin-top:0">${esc(dayLabel)} <span class="muted" style="font-weight:500;font-size:0.78rem">· ${filled.length} of ${reps.length} rep${reps.length === 1 ? "" : "s"} logged${loading ? " · reading…" : ""}</span></div>
      <div class="card dl-sum"><div class="row" style="gap:16px"><div><div class="strong" style="font-size:1.2rem">${tot.p}</div><div class="small muted">prospects</div></div><div><div class="strong" style="font-size:1.2rem">${tot.o}</div><div class="small muted">with an outcome</div></div><div><div class="strong" style="font-size:1.2rem">${tot.f}</div><div class="small muted">posts</div></div></div></div>`;
    const cards = reps.map(({ member, rec }) => {
      const name = memberName(member);
      if (!rec) return `<div class="card dl-rep dl-empty" data-rep="${esc(member.user_id)}"><div class="row"><div class="row-main"><div class="row-title">${esc(name)}</div><div class="row-sub">Nothing logged</div></div></div></div>`;
      const c = daylogCounts(rec);
      const pros = (rec.prospects || []).filter(filledProspect);
      const posts = (rec.posts || []).filter(filledPost);
      return `<div class="card dl-rep" data-rep="${esc(member.user_id)}">
        <div class="row" style="margin-bottom:${pros.length || posts.length ? 8 : 0}px"><div class="row-main"><div class="row-title">${esc(name)}</div></div><span class="small muted">${c.prospects} of ${SLOTS} · ${c.posts} post${c.posts === 1 ? "" : "s"}</span></div>
        ${pros.length ? `<div class="small strong muted" style="margin:6px 0 2px">Auto Alert / Service list</div>${pros.map((p) => `<div class="dl-line"><div><span class="strong">${esc(p.name || "—")}</span>${p.phone ? ` <span class="muted small">${esc(p.phone)}</span>` : ""}${p.email ? ` <span class="muted small">${esc(p.email)}</span>` : ""}</div><div class="small ${p.outcome ? "" : "muted"}">${p.outcome ? esc(p.outcome) : "no outcome yet"}</div></div>`).join("")}` : ""}
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
  row.innerHTML = `<div class="row"><div class="row-main"><div class="row-title">${icon("file")} Daily log</div><div class="row-sub">${c ? `${c.prospects} of ${SLOTS} prospects · ${c.posts} of ${SLOTS} posts` : "Not started today"}</div></div><span class="muted">›</span></div>`;
  row.addEventListener("click", () => navigate("/daylog"));
  return row;
}
