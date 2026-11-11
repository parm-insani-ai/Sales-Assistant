// Where everyone stands toward a conversation, read from made-up records:
// a message left is not one, a reply is, the states and the counts.
const path = require("path");
(async () => {
const m = await import("file://" + path.resolve(__dirname, "../js/reachstate.js"));
const fail = (x) => { console.error("FAIL: " + x); process.exitCode = 1; };
const J = JSON.stringify;
const now = new Date("2026-11-11T12:00:00").getTime();
const DAY = 86400000;
const ago = (d, h = 10) => new Date(now - d * DAY + (h - 12) * 3600000).toISOString();
const x = { stage: "delivered" };
const leads = [
  { id: "spoke", name: "A", phone: "1", ...x },                       // a call answered 10 days ago
  { id: "vm", name: "B", phone: "2", ...x },                          // two messages left, a text sent, next call queued
  { id: "reply", name: "C", phone: "3", ...x },                       // texted, replied
  { id: "old", name: "D", phone: "4", ...x },                         // spoke 300 days ago, nothing since
  { id: "never", name: "E", phone: "5", ...x },                       // untouched
  { id: "nophone", name: "F", ...x },                                 // no number
  { id: "rested", name: "G", phone: "7", restedAt: ago(3), prospectSnoozedUntil: "2027-01-05", ...x },
  { id: "due", name: "H", phone: "8", ...x },                         // one miss, nothing queued → due
  { id: "bought", name: "I", phone: "9", purchaseDate: ago(20).slice(0, 10), ...x },
  { id: "lost", name: "J", phone: "10", stage: "lost" },
];
const calls = [
  { leadId: "spoke", dir: "out", via: "call", at: ago(10), outcome: "reached", conversationOutcome: "callback" },
  { leadId: "vm", dir: "out", via: "call", at: ago(2, 9), outcome: "voicemail" },
  { leadId: "vm", dir: "out", via: "call", at: ago(1, 16), outcome: "no_answer" },
  { leadId: "old", dir: "out", via: "call", at: ago(300), outcome: "reached" },
  { leadId: "rested", dir: "out", via: "call", at: ago(4), outcome: "no_answer" },
  { leadId: "due", dir: "out", via: "call", at: ago(1), outcome: "no_answer" },
  { leadId: "reply", dir: "in", via: "call", at: ago(1), outcome: "reached" }, // an inbound call record isn't an attempt
];
const texts = [
  { leadId: "vm", dir: "out", at: ago(2, 11), body: "when's good?" },
  { leadId: "reply", dir: "out", at: ago(3), body: "hi" },
  { leadId: "reply", dir: "in", at: ago(2), body: "sure, call me" },
];
const tasks = [
  { leadId: "vm", sequence: true, done: false, channel: "call", due: new Date(now + DAY).toISOString().slice(0, 10), attempt: 4 },
  { leadId: "spoke", sequence: true, done: true, channel: "call", due: "2026-11-01" },
];
const idx = m.buildReachIndex({ calls, texts, tasks, now });
const st = (id) => m.reachStateOf(leads.find((l) => l.id === id), idx);

if (st("spoke").state !== "spoken" || st("spoke").conversation.outcome !== "callback" || st("spoke").days !== 10) fail("a call answered is a conversation: " + J(st("spoke")));
if (st("vm").state !== "working" || st("vm").attempts !== 3 || st("vm").conversation) fail("messages left and a text sent are misses, not a conversation; the next call is queued: " + J(st("vm")));
if (st("reply").state !== "spoken" || st("reply").conversation.via !== "text" || st("reply").conversation.outcome !== "replied") fail("a reply is a conversation: " + J(st("reply")));
if (st("old").state !== "lapsed") fail("spoken long ago and nothing since is lapsed: " + J(st("old")));
if (st("never").state !== "untouched" || st("never").attempts !== 0) fail("never tried: " + J(st("never")));
if (st("nophone").state !== "unreachable") fail("no number: " + J(st("nophone")));
if (st("rested").state !== "rested") fail("resting after the round: " + J(st("rested")));
if (st("due").state !== "due") fail("a miss with nothing queued is due now: " + J(st("due")));
if (st("bought").state !== "spoken" || st("bought").conversation.outcome !== "bought") fail("buying from the store is the conversation of record: " + J(st("bought")));
// The tally skips the lost; the share is of the reachable.
const c = m.countStates(leads, idx);
console.log(J(c));
if (c.total !== 9 || c.spoken !== 3 || c.working !== 1 || c.due !== 1 || c.rested !== 1 || c.lapsed !== 1 || c.untouched !== 1 || c.unreachable !== 1 || c.reachable !== 8 || c.pct !== 38) fail("the counts: " + J(c));
if (m.conversationsIn(leads, idx, 7) !== 1 || m.conversationsIn(leads, idx, 30) !== 3) fail("conversations in a window: " + m.conversationsIn(leads, idx, 7) + " / " + m.conversationsIn(leads, idx, 30));
// A due task makes "due"; a reply stamped on the file counts even with no text record.
const idx2 = m.buildReachIndex({ calls: [], texts: [], tasks: [{ leadId: "k", sequence: true, done: false, channel: "call", due: "2026-11-10" }], now });
if (m.reachStateOf({ id: "k", phone: "1" }, idx2).state !== "due") fail("an overdue sequence task is due");
if (m.reachStateOf({ id: "k2", phone: "1", lastReplyAt: ago(5) }, idx2).state !== "spoken") fail("lastReplyAt counts as a conversation");
if (m.reachStateOf({ id: "k3", phone: "1", lastContacted: ago(5), lastContactOutcome: "voicemail" }, idx2).state !== "lapsed") fail("a message left on the file is an attempt, not a conversation: " + m.reachStateOf({ id: "k3", phone: "1", lastContacted: ago(5), lastContactOutcome: "voicemail" }, idx2).state);
if (m.reachStateOf({ id: "k4", phone: "1", lastContacted: ago(5), lastContactOutcome: "reached" }, idx2).state !== "spoken") fail("a reached contact on the file is a conversation");

console.log(process.exitCode ? "\nreachstate.test.js FAILED" : "\nreachstate.test.js passed");
})();
