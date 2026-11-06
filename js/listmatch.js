// Who a spoken list picks, counted the way the Outreach screen counts: the
// chip, the sheet's audience, then the cuts — so the number the voice says
// from Home is the number on the screen when it opens. Mirrors the rules in
// views/leads.js (the chips, cutPass) without needing the screen drawn.

import * as store from "./store.js";
import { inAudience } from "./outreach.js";
import { assessAll, categoryOf } from "./assess.js";
import { inLog } from "./logbook.js";
import { daysFromToday, todayISO } from "./utils.js";
import { classify } from "./segments.js";

const DAY = 86400000;
// The reason cuts, each the category of reason the read of the book gives.
const CAT = { payment: "payment", equity: "equity", ending: "ending", cycle: "cycle", rate: "rate", warranty: "warranty", service: "service" };

export function chipPasses(chip, l, today = todayISO()) {
  const snoozed = !!l.prospectSnoozedUntil && l.prospectSnoozedUntil > today;
  if (chip === "tocontact") return !inLog(l) && !l.lastContacted && !snoozed;
  if (chip === "contacted") return !inLog(l) && !!l.lastContacted;
  if (chip === "due") return !["delivered", "lost"].includes(l.stage) && !!l.followUp && daysFromToday(l.followUp) <= 0;
  return true;
}

export function cutPasses(key, l, byId, now = Date.now()) {
  const drive = String(l.vehicleInterest || "");
  if (key.startsWith("model:")) { const m = key.slice(6); return classify(drive).model === m || drive.toLowerCase().includes(m); }
  if (key.startsWith("body:")) return classify(drive).body === key.slice(5);
  if (key === "quiet") { const t = l.lastContacted ? new Date(l.lastContacted).getTime() : 0; return !t || now - t > 180 * DAY; }
  if (key === "nonumber") return !l.phone || !!l.badPhone;
  const cat = CAT[key];
  if (!cat) return true;
  const a = byId.get(l.id);
  return !!(a && (a.reasons || []).some((r) => categoryOf(r) === cat));
}

/** The customers a spoken list picks. `chip` stands in when the sentence named none. */
export function spokenMatches(spec, { chip = "all", now = Date.now() } = {}) {
  const byId = assessAll().byId;
  const today = todayISO();
  const which = spec.chip || chip;
  const cuts = spec.cuts || [];
  return store.all("leads").filter((l) => chipPasses(which, l, today) && (!spec.audience || inAudience(spec.audience, l, now)) && cuts.every((k) => cutPasses(k, l, byId, now)));
}
