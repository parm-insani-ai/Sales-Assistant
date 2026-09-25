// The manager's welcome text, its rules pinned: who gets one, when, never
// on the rep's heels, never twice, only in the store's day, and the words.
const path = require("path");
(async () => {
const W = await import("file://" + path.resolve(__dirname, "../js/welcome.js"));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
// 2 pm ADT on a Thursday = 17:00 UTC.
const now = Date.parse("2026-09-24T17:00:00Z");
const ago = (min) => new Date(now - min * 60000).toISOString();
const cfg = { ...W.DEFAULT_WELCOME, enabled: true, manager: "Sam", tzOffsetMinutes: 180 };
const lead = (over = {}) => ({ id: "l1", name: "Dana Muise", phone: "9025551111", stage: "new", source: "Walk-in", createdAt: ago(200), ...over });

// The delay is per customer, between the bounds, and stable.
const d1 = W.delayFor({ id: "abc" }, cfg), d2 = W.delayFor({ id: "abd" }, cfg);
if (d1 < 45 || d1 > 150 || d2 < 45 || d2 > 150 || d1 === d2 || W.delayFor({ id: "abc" }, cfg) !== d1) fail("delays: " + d1 + " " + d2);

// Due: logged 200 minutes ago, no texts, store open.
let r = W.welcomeDue(lead(), [], cfg, now);
if (!r.due) fail("a fresh walk-in three hours in should be due: " + JSON.stringify(r));
// Not yet: logged 10 minutes ago.
r = W.welcomeDue(lead({ createdAt: ago(10) }), [], cfg, now);
if (r.due || !/waits until \d+ min/.test(r.why) || !r.inMinutes) fail("ten minutes in is too soon: " + JSON.stringify(r));
// The rep texted 12 minutes ago: hold.
r = W.welcomeDue(lead(), [{ dir: "out", at: ago(12) }], cfg, now);
if (r.due || !/rep texted them 12 min ago/.test(r.why)) fail("on the rep's heels: " + JSON.stringify(r));
// The rep texted 40 minutes ago: fine.
if (!W.welcomeDue(lead(), [{ dir: "out", at: ago(40) }], cfg, now).due) fail("forty minutes after the rep's text is clear");
// The manager's own earlier text doesn't count as the rep's.
if (!W.welcomeDue(lead(), [{ dir: "out", at: ago(5), via: "manager-welcome" }], cfg, now).due) fail("a manager text isn't the rep's heels");
// They're mid-conversation with the rep: hold.
r = W.welcomeDue(lead(), [{ dir: "in", at: ago(5) }], cfg, now);
if (r.due || !/texting the rep right now/.test(r.why)) fail("mid-conversation: " + JSON.stringify(r));
// Already welcomed, opted out, no phone, an owner, came in by text, too old, off.
if (W.welcomeDue(lead({ managerWelcomeAt: ago(60) }), [], cfg, now).due) fail("never twice");
if (W.welcomeDue(lead({ smsOptOut: true }), [], cfg, now).due) fail("opted out");
if (W.welcomeDue(lead({ phone: "" }), [], cfg, now).due) fail("no phone");
if (W.welcomeDue(lead({ purchaseDate: "2021-01-01" }), [], cfg, now).due) fail("an owner on file isn't a visit");
if (W.welcomeDue(lead({ source: "text" }), [], cfg, now).due) fail("a customer created from an inbound text didn't come in");
if (W.welcomeDue(lead({ createdAt: ago(5 * 1440) }), [], cfg, now).due) fail("five days later is too late");
if (W.welcomeDue(lead(), [], { ...cfg, enabled: false }, now).due) fail("off means off");
if (W.welcomeDue(lead({ stage: "delivered" }), [], cfg, now).due) fail("delivered isn't a fresh enquiry");
// Outside the store's day: 9 pm ADT = 00:00 UTC next day.
r = W.welcomeDue(lead({ createdAt: new Date(Date.parse("2026-09-25T00:00:00Z") - 200 * 60000).toISOString() }), [], cfg, Date.parse("2026-09-25T00:00:00Z"));
if (r.due || !/outside the store's hours/.test(r.why)) fail("9 pm is after hours: " + JSON.stringify(r));
if (W.localHour(Date.parse("2026-09-25T00:00:00Z"), 180) !== 21) fail("local hour");

// The words.
const t = W.welcomeText(lead(), { manager: "Sam", store: "O'Regan's Nissan Halifax", rep: "Parm" }, cfg.template);
console.log(t);
if (t !== "Hi Dana, it's Sam, the sales manager at O'Regan's Nissan Halifax. Thanks for coming in to see Parm — we'd love to help in any way we can. If there's anything at all, you can reach me right here.") fail("the text: " + t);
const t2 = W.welcomeText({ name: "" }, { manager: "Sam", store: "O'Regan's" }, "Hi {first}, {manager} here at {store}. Thanks for coming in.");
if (t2 !== "Hi there, Sam here at O'Regan's. Thanks for coming in.") fail("a custom template with no name: " + t2);
console.log(process.exitCode ? "\nwelcome.test.js FAILED" : "\nwelcome.test.js passed");
})();
