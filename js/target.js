// The monthly sales target, worked the way the store's target sheet works
// it: set how many new and used units you plan to sell and the closing
// ratio you expect (the store benchmark is 42%), and the sheet says how
// many customers you have to speak with. Then, as the month goes, it
// counts who you've spoken with, what you've sold, and where that leaves
// you — remaining to target, conversations remaining, pace, actual
// closing ratio, target attainment, and the week's share of the work.
//
// The sheet's customer log is the app itself: every customer on Leads,
// every contact logged (a call, text or email — or Call, Text or Email
// tapped on their page), every sale in the sold log. Nothing is typed
// twice. A customer's "New / Used" is the Shopping field on their record;
// a sale's is on the deal.

import * as store from "./store.js";
import { openModal, buildForm, toast } from "./components.js";

export const STORE_CLOSING_PCT = 42;
const num = (v) => Number(v) || 0;
const pad = (n) => String(n).padStart(2, "0");
export function monthKeyOf(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
// The month a record belongs to: a date or local date-time string as
// written; a full timestamp in the phone's own time.
function mk(v) {
  const s = String(v || "");
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(?::\d{2})?)?$/.test(s)) return s.slice(0, 7);
  const d = new Date(s);
  return isNaN(d) ? "" : monthKeyOf(d);
}
function dayOf(v) {
  const s = String(v || "");
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(?::\d{2})?)?$/.test(s)) return Number(s.slice(8, 10));
  const d = new Date(s);
  return isNaN(d) ? 0 : d.getDate();
}

// The plan: targets, ratios, and the conversations they call for
// (ROUNDUP(target / ratio), as the sheet has it). With no new/used split
// set, the unit goal (a manager's target, say) is the total.
export function targetPlan(s = store.getSettings()) {
  const targetNew = num(s.targetNew), targetUsed = num(s.targetUsed);
  const split = targetNew + targetUsed > 0;
  const target = split ? targetNew + targetUsed : num(s.goalUnits);
  const closingNew = (Number(s.closingNew) > 0 ? Number(s.closingNew) : STORE_CLOSING_PCT) / 100;
  const closingUsed = (Number(s.closingUsed) > 0 ? Number(s.closingUsed) : STORE_CLOSING_PCT) / 100;
  const need = (t, r) => (t > 0 && r > 0 ? Math.ceil(t / r - 1e-9) : 0);
  const needNew = split ? need(targetNew, closingNew) : 0;
  const needUsed = split ? need(targetUsed, closingUsed) : 0;
  return { split, targetNew, targetUsed, target, closingNew, closingUsed, needNew, needUsed, need: split ? needNew + needUsed : need(target, closingNew) };
}

// Every outbound contact this month, as (customer, day of month).
function contactEvents(mKey, leads) {
  const out = [];
  const push = (id, at) => { if (id && mk(at) === mKey) out.push({ leadId: id, day: dayOf(at) }); };
  store.all("calls").forEach((c) => { if ((c.dir || "out") === "out") push(c.leadId, c.at || c.createdAt); });
  store.all("texts").forEach((t) => { if (t.dir === "out") push(t.leadId, t.at || t.createdAt); });
  store.all("emails").forEach((e) => { if (e.direction === "out") push(e.leadId, e.sentAt || e.receivedAt || e.createdAt); });
  leads.forEach((l) => push(l.id, l.lastContacted));
  return out;
}

export function shoppingOf(l) {
  const v = String((l && l.shopping) || "").toLowerCase();
  return v === "new" ? "New" : v === "used" ? "Used" : "";
}

// The sheet, filled in from the book for the month `now` is in.
export function salesTarget(now = new Date()) {
  const s = store.getSettings();
  const plan = targetPlan(s);
  const mKey = monthKeyOf(now);
  const leads = store.all("leads");
  const byId = new Map(leads.map((l) => [l.id, l]));
  const events = contactEvents(mKey, leads);
  const spoken = new Set(events.map((e) => e.leadId));
  let spokeNew = 0, spokeUsed = 0;
  spoken.forEach((id) => { const c = shoppingOf(byId.get(id)); if (c === "New") spokeNew++; else if (c === "Used") spokeUsed++; });
  const sales = store.all("sales").filter((x) => mk(x.saleDate || x.createdAt) === mKey);
  const soldNew = sales.filter((x) => x.newUsed === "New").length;
  const soldUsed = sales.filter((x) => x.newUsed === "Used").length;
  const sold = sales.length;
  const appts = store.all("appointments").filter((a) => a.status !== "canceled" && mk(a.when) === mKey).length;

  // The month in weeks, the sheet's way: the required conversations spread
  // over the month's weeks (five in most months), and where this week
  // stands against its share.
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  const weeks = Math.ceil(daysIn / 7);
  const week = Math.min(weeks, Math.floor((day - 1) / 7) + 1);
  const perWeek = plan.need ? Math.ceil(plan.need / weeks) : 0;
  const from = (week - 1) * 7 + 1, to = Math.min(daysIn, week * 7);
  const spokeWeek = new Set(events.filter((e) => e.day >= from && e.day <= to).map((e) => e.leadId)).size;

  const ratio = (a, b) => (b ? a / b : null);
  return {
    mKey, plan, day, daysIn, weeks, week, perWeek, spokeWeek, appts,
    spoke: spoken.size, spokeNew, spokeUsed, spokeUnsplit: spoken.size - spokeNew - spokeUsed,
    sold, soldNew, soldUsed, soldUnsplit: sold - soldNew - soldUsed,
    closing: ratio(sold, spoken.size), closingNew: ratio(soldNew, spokeNew), closingUsed: ratio(soldUsed, spokeUsed),
    remainingUnits: Math.max(0, plan.target - sold),
    remainingTalks: Math.max(0, plan.need - spoken.size),
    // "Pace vs required": conversations logged over conversations required —
    // and against where the month is, so it reads as ahead or behind.
    pace: ratio(spoken.size, plan.need),
    expectedByNow: plan.need ? Math.round((plan.need * day) / daysIn) : 0,
    attainment: ratio(sold, plan.target),
  };
}

// Set the target: units by category and the closing ratio you expect.
// The unit goal the rest of the app rallies around follows the total.
export function openTargetForm(onDone) {
  const s = store.getSettings();
  openModal("Monthly sales target", (close) => {
    const { element } = buildForm(
      [
        { name: "targetNew", label: "New units this month", value: num(s.targetNew) || "", type: "number", inputmode: "numeric", half: true, placeholder: "0" },
        { name: "targetUsed", label: "Used units this month", value: num(s.targetUsed) || "", type: "number", inputmode: "numeric", half: true, placeholder: "0" },
        { name: "closingNew", label: "Closing ratio, new (%)", value: Number(s.closingNew) > 0 ? s.closingNew : STORE_CLOSING_PCT, type: "number", inputmode: "decimal", half: true },
        { name: "closingUsed", label: "Closing ratio, used (%)", value: Number(s.closingUsed) > 0 ? s.closingUsed : STORE_CLOSING_PCT, type: "number", inputmode: "decimal", half: true, hint: `The store benchmark is ${STORE_CLOSING_PCT}%. Units ÷ ratio = the customers you have to speak with.` },
      ],
      {
        submitLabel: "Set target",
        onSubmit: (data) => {
          const targetNew = num(data.targetNew), targetUsed = num(data.targetUsed);
          const patch = { targetNew, targetUsed, closingNew: num(data.closingNew) || STORE_CLOSING_PCT, closingUsed: num(data.closingUsed) || STORE_CLOSING_PCT };
          if (targetNew + targetUsed > 0) { patch.goalUnits = targetNew + targetUsed; patch.targetSetBy = "rep"; }
          store.updateSettings(patch);
          const plan = targetPlan(store.getSettings());
          toast(plan.need ? `${plan.target} units — speak with ${plan.need} customers` : "Target saved", "success");
          close();
          if (onDone) onDone();
        },
      }
    );
    return element;
  });
}
