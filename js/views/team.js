// Team — the store, its members, and the manager's board.
//
// Without a store: join one by invite code — or, as the dealership's admin,
// create one. Admins are set in the database by whoever holds the Supabase
// project; only they create stores and appoint or demote managers, so nobody
// becomes a manager by tapping a button. A manager can remove a rep. A rep sees who's on the team and their own numbers. A manager
// sees the board: every rep, today and month to date — touches, appointments
// set and shown, units against goal and pace, untouched new leads, overdue
// follow-ups — and can open a rep to see the lists behind the numbers, and
// any customer on them, read-only. Nothing here writes to a rep's book.

import * as store from "../store.js";
import * as backend from "../backend.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { toast, confirmDialog, openModal, emptyState } from "../components.js";
import { esc, phoneDisplay, telHref, formatDate, formatDateTime, relativeDay, currency } from "../utils.js";
import { contractSummary } from "../contract.js";
import { cachedStore, myStore, createStore, joinStore, setMemberRole, leaveStore, setMyName, isManager, isAdmin, inviteLink, memberName, repLead, adminStores, adminAddMember, adminSetStore, checkAdmin, cachedBoard, loadBoard } from "../team.js";
import { runningVersion, getVersion } from "../updater.js";

const stageLabel = (s) => (store.stageMeta(s) || { label: s }).label;
const stageBadge = (s) => (store.stageMeta(s) || { badge: "" }).badge;

export function renderTeam(view, { param } = {}) {
  const el = document.createElement("div");
  view.appendChild(el);
  const me = backend.currentUser();
  if (!me) {
    el.innerHTML = `<div class="hero"><div class="hero-greeting">Team</div><div class="hero-title">Sign in first</div></div>
      <div class="card">The team lives in your cloud account. Sign in under Settings → Cloud sync & account, then come back here.</div>`;
    return;
  }

  let team = cachedStore();
  let board = cachedBoard();
  let loading = false, error = "";
  let admin = isAdmin(team);
  let stores = null; // every store, for an admin
  // What the screen knows about itself, so a "why isn't this working" has
  // an answer on the screen: the account, the build, the admin check.
  let check = { admin: null, error: "" }, build = "";
  Promise.all([runningVersion().catch(() => null), getVersion().catch(() => null)]).then(([run, live]) => {
    build = (run || "").replace(/^viniva-/, "") || (live && live.version) || "";
    const n = el.querySelector(".team-build"); if (n) n.textContent = build ? "build " + build.slice(0, 7) : "";
  });

  async function refreshTeam() {
    check = await checkAdmin();
    try { team = await myStore(); error = ""; } catch (e) { error = e && e.message ? e.message : "couldn't reach the store"; }
    admin = check.admin || isAdmin(team);
    if (admin) { try { stores = await adminStores(); } catch { stores = null; } }
    draw();
    if (team && isManager(team)) await refreshBoard();
  }
  function statusHTML() {
    const verdict = check.admin === null ? "checking…" : check.error ? `failed — ${esc(check.error)}` : check.admin ? "yes" : "no — this email isn't in the admins table";
    return `<div class="card small muted team-status" style="margin-top:14px">
      <div>Signed in as <span class="mono">${esc(me.email || me.id)}</span> · <span class="team-build">${build ? "build " + esc(build.slice(0, 7)) : ""}</span></div>
      <div style="margin-top:4px">Admin check: <span class="team-admin-check">${verdict}</span></div>
      <button class="btn btn-ghost btn-sm" data-act="recheck" style="margin-top:8px">Check again</button>
    </div>`;
  }
  async function refreshStores() {
    try { stores = await adminStores(); } catch (e) { toast(e.message || "Couldn't read the stores", "danger"); }
    draw();
  }
  async function refreshBoard() {
    if (!team || loading) return;
    loading = true; draw();
    try { board = await loadBoard(team, { force: true }); }
    catch (e) { error = e && e.message ? e.message : "couldn't read the board"; }
    loading = false; draw();
  }

  function draw() {
    if (!team) { drawNoStore(); return; }
    const manager = isManager(team);
    const mine = (team.members || []).find((m) => m.user_id === me.id);
    // An admin's screen leads with the admin controls; the board follows when
    // they also manage a store.
    el.innerHTML = `
      <div class="hero">
        <div class="hero-greeting">${admin ? "Admin" : manager ? "Manager board" : "Team"}</div>
        <div class="hero-title">${esc(team.name)}</div>
      </div>
      ${error ? `<div class="fab-note" style="text-align:left;color:var(--danger);margin:0 2px 12px">${esc(error)}</div>` : ""}
      ${admin ? adminHTML() : ""}
      ${manager ? boardHTML() : repHTML(mine)}
      ${statusHTML()}
      <div class="section-title">Members <span class="muted" style="font-weight:500;font-size:0.78rem">· ${(team.members || []).length}</span></div>
      <div class="card">
        ${(team.members || []).map((m) => `
          <div class="row" style="padding:6px 0">
            <div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(memberName(m))}${m.user_id === me.id ? ' <span class="muted small">(you)</span>' : ""}</div><div class="row-sub">${esc(m.email || "")}</div></div>
            <div class="row-meta"><span class="badge ${m.role === "manager" ? "badge-sold" : "badge-working"}">${m.role === "manager" ? "Manager" : "Rep"}</span>
              ${m.user_id !== me.id && (admin || (manager && m.role === "rep")) ? `<button class="btn btn-ghost btn-sm" data-role="${esc(m.user_id)}" style="margin-left:6px">…</button>` : ""}</div>
          </div>`).join("")}
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-ghost btn-sm" data-act="rename" style="flex:1">${mine && mine.name ? "Change my name" : "Set my name"}</button>
          <button class="btn btn-ghost btn-sm" data-act="leave" style="flex:0 0 auto">Leave store</button>
        </div>
      </div>
      ${manager ? `
      <div class="section-title">Invite a rep</div>
      <div class="card">
        <div class="small muted" style="margin-bottom:6px">Send this link. They sign in to their own cloud account, tap it, and they're on the board.</div>
        <div class="mono small" style="word-break:break-all;background:var(--surface-2);border-radius:10px;padding:10px" id="invite-link">${esc(inviteLink(team.code))}</div>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn btn-primary btn-sm btn-block" data-act="copy-invite">${icon("send")} Copy invite link</button>
          ${navigator.share ? `<button class="btn btn-ghost btn-sm" data-act="share-invite" style="flex:0 0 auto">Share</button>` : ""}
        </div>
        <div class="hint">Invite code: <span class="mono">${esc(team.code)}</span> — a rep can also type it under Tools → Team. Reps join themselves; managers are appointed by the admin.</div>
      </div>` : ""}
    `;
    wireAdmin();
    const on = (sel, fn) => { const n = el.querySelector(sel); if (n) n.addEventListener("click", fn); };
    on('[data-act="refresh"]', refreshBoard);
    on('[data-act="recheck"]', refreshTeam);
    on('[data-act="copy-invite"]', async () => { try { await navigator.clipboard.writeText(inviteLink(team.code)); toast("Invite link copied", "success"); } catch { toast("Copy the link from the box", "warn"); } });
    on('[data-act="share-invite"]', () => navigator.share({ title: `Join ${team.name} on viniva`, text: `Tap to join ${team.name} on viniva`, url: inviteLink(team.code) }).catch(() => {}));
    on('[data-act="rename"]', () => openNameSheet(mine));
    on('[data-act="leave"]', async () => {
      if (!(await confirmDialog(`Leave ${team.name}? A manager can invite you back with the link.`, { confirmLabel: "Leave" }))) return;
      try { await leaveStore(); team = null; board = null; toast("You've left the store", "success"); draw(); } catch (e) { toast(e.message || "Couldn't leave", "danger"); }
    });
    el.querySelectorAll("[data-role]").forEach((b) => b.addEventListener("click", () => openRoleSheet((team.members || []).find((m) => m.user_id === b.dataset.role))));
    el.querySelectorAll("[data-rep]").forEach((r) => r.addEventListener("click", () => openRep(r.dataset.rep)));
  }

  function drawNoStore() {
    el.innerHTML = `
      <div class="hero"><div class="hero-greeting">${admin ? "Admin" : "Team"}</div><div class="hero-title">${admin ? "Set up the store" : "Join your store"}</div></div>
      ${error ? `<div class="fab-note" style="text-align:left;color:var(--danger);margin:0 2px 12px">${esc(error)}</div>` : ""}
      <div class="fab-note" style="margin:0 2px 14px;text-align:left">A store is your reps and managers on one board. Reps keep their own books; a manager sees every rep's numbers and can open any customer, read-only. No integration, no IT — a link does it.</div>
      ${admin ? `
      <div class="section-title">Admin · create a store</div>
      <div class="card">
        <div class="field"><label>Store name</label><input id="st-name" placeholder="O'Regan's Nissan Halifax" value="${esc(store.getSettings().dealership || "")}"></div>
        <div class="field"><label>Your name</label><input id="st-me" placeholder="How the team sees you" value="${esc(store.getSettings().salesperson || "")}"></div>
        <button class="btn btn-primary btn-block" data-act="create">${icon("store")} Create the store</button>
        <div class="hint">You join it as its first manager and get an invite link for the reps. Appoint other managers from the admin section.</div>
      </div>` : `
      <div class="card"><div class="strong">Stores are set up by your dealership's admin.</div><div class="small muted" style="margin-top:4px">They create the store and appoint its managers, so nobody can make themselves a manager. Ask your manager for the invite link or code and join below.</div></div>`}
      <div class="section-title">I'm a rep</div>
      <div class="card">
        <div class="field"><label>Invite code</label><input id="st-code" placeholder="from your manager" value="${esc(param || "")}" autocapitalize="off" autocomplete="off"></div>
        <div class="field"><label>Your name</label><input id="st-me2" placeholder="How the board shows you" value="${esc(store.getSettings().salesperson || "")}"></div>
        <button class="btn btn-primary btn-block" data-act="join">${icon("users")} Join the store</button>
        <div class="hint">Your manager can then see your numbers and your customers. Nothing changes about your own app.</div>
      </div>
      ${statusHTML()}
    `;
    const rc = el.querySelector('[data-act="recheck"]'); if (rc) rc.addEventListener("click", refreshTeam);
    const create = el.querySelector('[data-act="create"]');
    if (create) create.addEventListener("click", async (ev) => {
      const name = el.querySelector("#st-name").value.trim(), meName = el.querySelector("#st-me").value.trim();
      if (!name) { toast("Give the store a name", "warn"); return; }
      ev.currentTarget.disabled = true;
      try { team = await createStore(name, meName); error = ""; toast(`${name} is set up — you're its manager`, "success"); draw(); refreshStores(); refreshBoard(); }
      catch (e) { error = e.message || "Couldn't create the store"; draw(); }
    });
    el.querySelector('[data-act="join"]').addEventListener("click", async (ev) => {
      const code = el.querySelector("#st-code").value.trim(), meName = el.querySelector("#st-me2").value.trim();
      if (!code) { toast("Enter the invite code", "warn"); return; }
      ev.currentTarget.disabled = true;
      try { team = await joinStore(code, meName); error = ""; toast(`You're on ${team.name}'s team`, "success"); if (param) navigate("/team"); else draw(); }
      catch (e) { error = e.message || "Couldn't join"; draw(); }
    });
  }

  // ---- The board ----
  function boardHTML() {
    const stats = board ? board.stats : null;
    const reps = (team.members || []);
    const byId = new Map((stats || []).map((s) => [s.member.user_id, s]));
    const rows = reps.map((m) => byId.get(m.user_id) || { member: m });
    // Totals across the store.
    const sum = (f) => rows.reduce((a, r) => a + (r.error || !r.touches ? 0 : f(r)), 0);
    const totals = stats ? { touches: sum((r) => r.touches.today), set: sum((r) => r.appts.set), shown: sum((r) => r.appts.shown), units: sum((r) => r.sales.units), goal: sum((r) => r.goal.units), untouched: sum((r) => r.leads.untouched.length), overdue: sum((r) => r.leads.overdue.length) } : null;
    const paceCls = (r) => (!r.goal.units ? "" : r.sales.units >= r.goal.pace ? "color:var(--success)" : r.sales.units < r.goal.pace * 0.6 ? "color:var(--danger)" : "color:var(--warning)");
    rows.sort((a, b) => ((b.sales ? b.sales.units : -1) - (a.sales ? a.sales.units : -1)) || memberName(a.member).localeCompare(memberName(b.member)));
    return `
      <div class="row" style="margin:0 2px 8px"><span class="small muted">${board ? "As of " + esc(formatDateTime(board.at)) : "Not read yet"}</span><button class="btn btn-ghost btn-sm" data-act="refresh" ${loading ? "disabled" : ""}>${loading ? "Reading…" : "Refresh"}</button></div>
      ${totals ? `<div class="stat-grid" style="margin-bottom:12px">
        <div class="stat"><div class="stat-value">${totals.units}<span class="muted" style="font-size:0.9rem;font-weight:500"> / ${totals.goal}</span></div><div class="stat-label">Units this month</div></div>
        <div class="stat"><div class="stat-value" style="color:var(--brand)">${totals.set}</div><div class="stat-label">Appointments set</div></div>
        <div class="stat"><div class="stat-value">${totals.touches}</div><div class="stat-label">Touches today</div></div>
        <div class="stat"><div class="stat-value" style="${totals.untouched ? "color:var(--danger)" : ""}">${totals.untouched}</div><div class="stat-label">Untouched leads</div></div>
      </div>` : ""}
      <div class="section-title">By rep <span class="muted" style="font-weight:500;font-size:0.78rem">· today · month to date</span></div>
      <div class="card" style="padding:6px 0">
        ${rows.length ? rows.map((r) => `
          <div class="team-row" data-rep="${esc(r.member.user_id)}" style="padding:10px 16px;border-bottom:1px solid var(--border);cursor:pointer">
            <div class="row" style="align-items:center">
              <div class="row-main"><div class="row-title" style="font-size:0.98rem">${esc(memberName(r.member))}${r.member.role === "manager" ? ' <span class="badge badge-sold" style="margin-left:4px">Mgr</span>' : ""}</div>
                ${r.error ? `<div class="row-sub" style="color:var(--danger)">${esc(r.error)}</div>` : r.touches ? `<div class="row-sub">${r.touches.today} touch${r.touches.today === 1 ? "" : "es"} today · ${r.touches.month} this month${r.appts.today.length ? ` · ${r.appts.today.length} appt${r.appts.today.length === 1 ? "" : "s"} today` : ""}</div>` : `<div class="row-sub muted">Reading…</div>`}
              </div>
              ${r.sales ? `<div class="row-meta"><div class="mono strong" style="${paceCls(r)}">${r.sales.units}<span class="muted" style="font-weight:500"> / ${r.goal.units || "—"}</span></div><div class="small muted">${r.goal.units ? "pace " + r.goal.pace : "no goal set"}</div></div>` : ""}
            </div>
            ${r.appts ? `<div class="team-cells">
              <span><b>${r.appts.set}</b> set</span><span><b>${r.appts.shown}</b> shown${r.appts.showRate != null ? ` <span class="muted">(${r.appts.showRate}%)</span>` : ""}</span>
              <span style="${r.leads.untouched.length ? "color:var(--danger)" : ""}"><b>${r.leads.untouched.length}</b> untouched</span><span style="${r.leads.overdue.length ? "color:var(--warning)" : ""}"><b>${r.leads.overdue.length}</b> overdue</span>
            </div>` : ""}
          </div>`).join("") : `<div class="muted small" style="padding:10px 16px">No one on the board yet — send the invite link below.</div>`}
      </div>
    `;
  }

  function repHTML(mine) {
    return `<div class="card"><div class="strong">You're on the team${mine && mine.name ? ", " + esc(mine.name) : ""}.</div>
      <div class="small muted" style="margin-top:4px">Your manager sees your touches, appointments, units and open leads, and can open a customer of yours read-only. Your book stays yours — nobody else on the team sees it.</div></div>`;
  }

  // ---- A rep, opened from the board ----
  function openRep(userId) {
    const r = (board && board.stats.find((x) => x.member.user_id === userId)) || null;
    const m = (team.members || []).find((x) => x.user_id === userId);
    if (!r || r.error || !r.touches) { toast("Refresh the board first", "warn"); return; }
    openRepSheet(r, m);
  }

  function openNameSheet(mine) {
    openModal("Your name on the team", (close) => {
      const root = document.createElement("div");
      root.innerHTML = `<div class="field"><label>Name</label><input id="tn-name" value="${esc((mine && mine.name) || store.getSettings().salesperson || "")}"></div><button class="btn btn-primary btn-block" data-act="save">Save</button>`;
      root.querySelector('[data-act="save"]').addEventListener("click", async () => {
        try { team = await setMyName(root.querySelector("#tn-name").value.trim()); close(); draw(); } catch (e) { toast(e.message || "Couldn't save", "danger"); }
      });
      return root;
    });
  }

  // Change someone's role. An admin can appoint or demote a manager in any
  // store (storeId names it); a manager can only remove a rep from their own.
  function openRoleSheet(m, storeId = null, storeName = team && team.name) {
    if (!m) return;
    openModal(memberName(m), (close) => {
      const root = document.createElement("div");
      root.innerHTML = `
        <div class="small muted" style="margin-bottom:10px">${esc(m.email || "")}</div>
        ${admin ? `<button class="btn btn-ghost btn-block" data-r="${m.role === "manager" ? "rep" : "manager"}" style="margin-bottom:8px">${m.role === "manager" ? "Make a rep" : "Make a manager"}</button>` : ""}
        <button class="btn btn-danger btn-block" data-r="remove">Remove from the store</button>
        <div class="hint">${admin ? "A manager sees everyone's numbers and customers. " : "Only the admin can appoint or demote a manager. "}Removing someone leaves their own book untouched — they just drop off the board.</div>`;
      root.querySelectorAll("[data-r]").forEach((b) => b.addEventListener("click", async () => {
        const role = b.dataset.r;
        if (role === "remove" && !(await confirmDialog(`Remove ${memberName(m)} from ${storeName || "the store"}?`, { confirmLabel: "Remove" }))) return;
        try {
          const r = await setMemberRole(m.user_id, role, storeId);
          if (!storeId) team = r; else if (r && team && r.id === team.id) team = r;
          close();
          if (admin) await refreshStores(); else draw();
          if (board) refreshBoard();
        } catch (e) { toast(e.message || "Couldn't change that", "danger"); }
      }));
      return root;
    });
  }

  // ---- Admin: every store, its managers, and who's in it ----
  function adminHTML() {
    const list = stores || [];
    return `
      <div class="section-title">Admin <span class="muted" style="font-weight:500;font-size:0.78rem">· every store</span></div>
      ${list.map((st) => `
      <div class="card admin-store" data-store="${esc(st.id)}">
        <div class="row"><div class="row-main"><div class="row-title">${esc(st.name)}</div><div class="row-sub">Invite code <span class="mono">${esc(st.code)}</span> · ${st.members.length} member${st.members.length === 1 ? "" : "s"}</div></div>
          <button class="btn btn-ghost btn-sm" data-store-menu="${esc(st.id)}">…</button></div>
        ${st.members.map((m) => `<div class="row" style="padding:5px 0"><div class="row-main"><div class="small strong">${esc(memberName(m))}</div><div class="small muted">${esc(m.email || "")}</div></div>
          <div class="row-meta"><span class="badge ${m.role === "manager" ? "badge-sold" : "badge-working"}">${m.role === "manager" ? "Manager" : "Rep"}</span>${m.user_id !== me.id ? `<button class="btn btn-ghost btn-sm" data-arole="${esc(m.user_id)}" data-astore="${esc(st.id)}" style="margin-left:6px">…</button>` : ""}</div></div>`).join("")}
        <div class="row" style="gap:6px;margin-top:8px;align-items:stretch">
          <input class="admin-email" placeholder="their sign-in email" autocapitalize="off" autocomplete="off" style="flex:1;min-width:0">
          <select class="admin-role" style="flex:0 0 auto"><option value="manager">Manager</option><option value="rep">Rep</option></select>
          <button class="btn btn-primary btn-sm" data-add="${esc(st.id)}" style="flex:0 0 auto">Add</button>
        </div>
        <div class="hint">Add by email to appoint a manager. The account has to exist already — they sign up in the app first.</div>
      </div>`).join("")}
      <div class="card">
        <div class="row" style="gap:6px;align-items:stretch"><input id="admin-new-store" placeholder="Another store's name" style="flex:1;min-width:0"><button class="btn btn-ghost btn-sm" data-act="admin-create" style="flex:0 0 auto">Create</button></div>
        <div class="hint">You're an admin because the project owner listed your account in the database. There's no button for that, on purpose.</div>
      </div>`;
  }
  function wireAdmin() {
    if (!admin) return;
    el.querySelectorAll("[data-arole]").forEach((b) => b.addEventListener("click", () => {
      const st = (stores || []).find((x) => x.id === b.dataset.astore);
      const m = st && st.members.find((x) => x.user_id === b.dataset.arole);
      openRoleSheet(m, st.id, st.name);
    }));
    el.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", async () => {
      const card = b.closest(".admin-store");
      const email = card.querySelector(".admin-email").value.trim(), role = card.querySelector(".admin-role").value;
      if (!email) { toast("Enter their sign-in email", "warn"); return; }
      b.disabled = true;
      try { stores = await adminAddMember(b.dataset.add, email, role); toast(`${email} is a ${role}`, "success"); await refreshTeam(); }
      catch (e) { toast(e.message || "Couldn't add them", "danger"); b.disabled = false; }
    }));
    el.querySelectorAll("[data-store-menu]").forEach((b) => b.addEventListener("click", () => {
      const st = (stores || []).find((x) => x.id === b.dataset.storeMenu);
      if (!st) return;
      openModal(st.name, (close) => {
        const root = document.createElement("div");
        root.innerHTML = `<div class="field"><label>Name</label><input id="as-name" value="${esc(st.name)}"></div>
          <button class="btn btn-primary btn-block" data-a="rename" style="margin-bottom:8px">Rename</button>
          <button class="btn btn-danger btn-block" data-a="delete">Delete the store</button>
          <div class="hint">Deleting drops everyone off the board. Their books stay theirs.</div>`;
        root.querySelector('[data-a="rename"]').addEventListener("click", async () => { try { stores = await adminSetStore(st.id, { name: root.querySelector("#as-name").value }); close(); await refreshTeam(); } catch (e) { toast(e.message || "Couldn't rename", "danger"); } });
        root.querySelector('[data-a="delete"]').addEventListener("click", async () => {
          if (!(await confirmDialog(`Delete ${st.name}? ${st.members.length} member${st.members.length === 1 ? "" : "s"} drop off the board.`, { confirmLabel: "Delete" }))) return;
          try { stores = await adminSetStore(st.id, { remove: true }); close(); await refreshTeam(); } catch (e) { toast(e.message || "Couldn't delete", "danger"); }
        });
        return root;
      });
    }));
    const mk = el.querySelector('[data-act="admin-create"]');
    if (mk) mk.addEventListener("click", async () => {
      const name = el.querySelector("#admin-new-store").value.trim();
      if (!name) { toast("Give the store a name", "warn"); return; }
      try { await createStore(name, ""); toast(`${name} created`, "success"); await refreshTeam(); } catch (e) { toast(e.message || "Couldn't create it", "danger"); }
    });
  }

  draw();
  refreshTeam();
}

// #/join/CODE — the invite link. Signed in: join straight away; otherwise the
// setup screen with the code filled in.
export function renderJoin(view, { param } = {}) {
  const code = String(param || "").trim();
  const me = backend.currentUser();
  if (!me || !code) { renderTeam(view, { param: code }); return; }
  const el = document.createElement("div");
  el.innerHTML = `<div class="hero"><div class="hero-greeting">Team</div><div class="hero-title">Joining…</div></div><div class="card muted small">Adding you to the store with code <span class="mono">${esc(code)}</span>.</div>`;
  view.appendChild(el);
  joinStore(code, store.getSettings().salesperson || "").then((t) => { toast(`You're on ${t.name}'s team`, "success"); navigate("/team"); },
    (e) => { el.innerHTML = ""; view.innerHTML = ""; renderTeam(view, { param: code }); toast(e.message || "Couldn't join", "danger"); });
}

// ---- A rep's day, opened from a board: the lists behind the numbers ----
export function openRepSheet(r, m) {
  const userId = r.member ? r.member.user_id : m && m.user_id;
  openModal(memberName(m || r.member), () => {
    const root = document.createElement("div");
    const leadRow = (l, sub) => `<div class="row rep-lead" data-lead="${esc(l.id)}" style="padding:8px 0;cursor:pointer"><div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(l.name || "Customer")}</div><div class="row-sub">${esc(sub)}</div></div><span class="badge ${stageBadge(l.stage)}">${esc(stageLabel(l.stage))}</span></div>`;
    root.innerHTML = `
      <div class="stat-grid" style="margin-bottom:12px">
        <div class="stat"><div class="stat-value">${r.sales.units}<span class="muted" style="font-size:0.9rem;font-weight:500"> / ${r.goal.units || "—"}</span></div><div class="stat-label">Units · pace ${r.goal.pace}</div></div>
        <div class="stat"><div class="stat-value mono" style="font-size:1.25rem">${currency(r.sales.gross)}</div><div class="stat-label">Gross this month</div></div>
        <div class="stat"><div class="stat-value" style="color:var(--brand)">${r.appts.set}</div><div class="stat-label">Set · ${r.appts.shown} shown · ${r.appts.sold} sold</div></div>
        <div class="stat"><div class="stat-value">${r.touches.today}</div><div class="stat-label">Touches today · ${r.touches.month} MTD${r.goal.touchesDay ? " · goal " + r.goal.touchesDay + "/day" : ""}</div></div>
      </div>
      ${r.appts.today.length ? `<div class="section-title">Today's appointments</div><div class="card">${r.appts.today.map((a) => `<div class="row" style="padding:6px 0"><div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(a.customerName || a.title || "Appointment")}</div><div class="row-sub">${esc(String(a.when).slice(11, 16))}${a.type ? " · " + esc(a.type) : ""}</div></div><span class="small muted">${apptState(a)}</span></div>`).join("")}</div>` : ""}
      <div class="section-title">Untouched new leads <span class="muted" style="font-weight:500;font-size:0.78rem">· ${r.leads.untouched.length} older than a day</span></div>
      <div class="card">${r.leads.untouched.length ? r.leads.untouched.slice(0, 30).map((l) => leadRow(l, `${l.vehicleInterest || "No vehicle noted"} · added ${formatDate(l.createdAt)}`)).join("") : `<div class="muted small">None — every new lead has been touched.</div>`}</div>
      <div class="section-title">Overdue follow-ups <span class="muted" style="font-weight:500;font-size:0.78rem">· ${r.leads.overdue.length}</span></div>
      <div class="card">${r.leads.overdue.length ? r.leads.overdue.slice(0, 30).map((l) => leadRow(l, `${l.vehicleInterest || "No vehicle noted"} · due ${relativeDay(l.followUp)}`)).join("") : `<div class="muted small">None overdue.</div>`}</div>
      <div class="hint">${r.leads.open} open leads in all. Tap a customer to read their page.</div>
    `;
    root.querySelectorAll("[data-lead]").forEach((n) => n.addEventListener("click", () => openCustomerSheet(userId, n.dataset.lead)));
    return root;
  });
}

export function apptState(a) {
  return a.outcome === "sold" ? "Sold" : a.outcome === "showed" ? "Showed" : a.outcome === "no_show" ? "No-show" : a.confirmed ? "Confirmed" : "Set";
}

// ---- A rep's customer, read-only ----
export async function openCustomerSheet(userId, leadId) {
  let data = null;
  try { data = await repLead(userId, leadId); } catch (e) { toast(e.message || "Couldn't read the customer", "danger"); return; }
  if (!data) { toast("That customer isn't there any more", "warn"); return; }
  const l = data.lead;
  const c = contractSummary(l);
  openModal(l.name || "Customer", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="card">
        <div class="row"><div class="row-main"><div class="row-title">${esc(l.vehicleInterest || "No vehicle noted")}</div><div class="row-sub">${l.source ? esc(l.source) + " · " : ""}added ${esc(formatDate(l.createdAt))}</div></div><span class="badge ${stageBadge(l.stage)}">${esc(stageLabel(l.stage))}</span></div>
        <div class="kv"><span class="k">Phone</span><span class="v">${l.phone ? `<a href="${esc(telHref(l.phone))}">${esc(phoneDisplay(l.phone))}</a>` : "—"}</span></div>
        <div class="kv"><span class="k">Email</span><span class="v">${esc(l.email || "—")}</span></div>
        <div class="kv"><span class="k">Follow-up</span><span class="v">${l.followUp ? esc(relativeDay(l.followUp)) + " (" + esc(formatDate(l.followUp)) + ")" : "—"}</span></div>
        <div class="kv"><span class="k">Last contacted</span><span class="v">${l.lastContacted ? esc(formatDateTime(l.lastContacted)) + (l.lastContactVia ? " · " + esc(l.lastContactVia) : "") : "Never"}</span></div>
        ${c ? `<div class="kv"><span class="k">Contract</span><span class="v">${esc(c.line)}</span></div>` : ""}
      </div>
      ${l.notes ? `<div class="section-title">Notes</div><div class="card small" style="white-space:pre-wrap">${esc(l.notes)}</div>` : ""}
      <div class="section-title">Recent texts <span class="muted" style="font-weight:500;font-size:0.78rem">· ${data.texts.length ? "newest first" : "none"}</span></div>
      <div class="card">${data.texts.length ? data.texts.map((t) => `<div style="padding:6px 0;border-bottom:1px solid var(--border)"><div class="small muted">${t.dir === "in" ? "Them" : "Rep"} · ${esc(formatDateTime(t.at || t.createdAt))}</div><div class="small" style="white-space:pre-wrap">${esc(t.body || "")}</div></div>`).join("") : `<div class="muted small">No texts with this customer.</div>`}</div>
      <div class="hint">Read-only. The rep's own app is where this customer is worked.</div>
    `;
    return root;
  });
}
