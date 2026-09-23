// "Text everyone who owns a Sentra that this month, if they trade it in for
// a new Nissan, they get double loyalty." — one sentence into a blast.
const path = require("path");
(async () => {
const o = await import("file://" + path.resolve(__dirname, "../js/outreach.js"));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const now = new Date("2026-09-23T12:00:00").getTime();

// --- The sentence.
let s = o.parseOutreach("message anyone who owns a Sentra that this month if they trade in their Sentra for a new Nissan, they get double loyalty");
console.log(JSON.stringify({ channel: s.channel, models: s.audience.models, message: s.message }));
if (s.channel !== "text" || JSON.stringify(s.audience.models) !== '["sentra"]' || !/^this month if they trade in their Sentra/.test(s.message)) fail("the Sentra sentence: " + JSON.stringify(s));
s = o.parseOutreach("email all my Rogue owners from 2018 to 2021 saying we're buying back Rogues this week");
if (s.channel !== "email" || s.audience.models[0] !== "rogue" || s.audience.yearMin !== 2018 || s.audience.yearMax !== 2021 || !/buying back/.test(s.message)) fail("email + years: " + JSON.stringify(s));
s = o.parseOutreach("text everyone with a paid off Nissan: the new Rogue is in and trade-ins are strong");
if (!s.audience.paidOff || !s.audience.nissan || s.audience.models.length || !/new Rogue is in/.test(s.message)) fail("paid off Nissan with a colon: " + JSON.stringify(s));
s = o.parseOutreach("text everyone whose lease is ending that we have a loyalty offer this month");
if (!s.audience.lease) fail("lease ending: " + JSON.stringify(s.audience));
s = o.parseOutreach("text all past customers I haven't contacted in 60 days that I'd love to catch up");
if (JSON.stringify(s.audience.stages) !== '["sold","delivered"]' || s.audience.quietDays !== 60) fail("past customers, quiet 60 days: " + JSON.stringify(s.audience));
s = o.parseOutreach("email everyone that the service department is open Saturdays now");
if (!s.audience.everyone || s.channel !== "email") fail("everyone: " + JSON.stringify(s));

// --- Is it a blast?
for (const t of ["text everyone who owns a sentra that we have double loyalty", "email all my Rogue owners saying hi", "reach out to anyone with a paid off Nissan", "text every Kicks owner about the trade-in event"]) if (!o.isOutreach(t)) fail("not read as outreach: " + t);
for (const t of ["text Sara that her car is ready", "book Ken Thursday at 4", "how many Rogues do we have", "add a lead named Rogue Smith"]) if (o.isOutreach(t)) fail("read as outreach: " + t);

// --- Second person, no figures.
const sp = o.toSecondPerson("this month if they trade in their Sentra for a new Nissan, they get double loyalty");
console.log("→", sp);
if (sp !== "This month if you trade in your Sentra for a new Nissan, you get double loyalty.") fail("second person: " + sp);
if (o.toSecondPerson("they're eligible and their trade is worth more than they think") !== "You're eligible and your trade is worth more than you think.") fail("contractions: " + o.toSecondPerson("they're eligible and their trade is worth more than they think"));
if (!o.figuresIn("we'll give them $500 extra").length || !o.figuresIn("rates from 2.9%").length || o.figuresIn("double loyalty this month").length) fail("figures guard");

// --- The audience from the book, and who can be reached.
const leads = [
  { id: "1", name: "Sam Sentra", phone: "9025551111", vehicleInterest: "2019 Nissan Sentra SV", stage: "sold" },
  { id: "2", name: "Sue Sentra", phone: "", email: "sue@example.com", vehicleInterest: "2021 Nissan Sentra SR", stage: "delivered" },
  { id: "3", name: "Stan Sentra", phone: "9025553333", vehicleInterest: "2017 Sentra S", stage: "sold", smsOptOut: true },
  { id: "4", name: "Rae Rogue", phone: "9025554444", vehicleInterest: "2020 Nissan Rogue SV", stage: "sold" },
  { id: "5", name: "Sal Sentra", phone: "9025555555", vehicleInterest: "2018 Nissan Sentra", stage: "working", lastCampaignAt: "2026-09-15T00:00:00.000Z" },
  { id: "6", name: "Lynn Lost", phone: "9025556666", vehicleInterest: "2019 Nissan Sentra", stage: "lost" },
];
s = o.parseOutreach("text everyone who owns a Sentra that this month if they trade in their Sentra for a new Nissan, they get double loyalty");
const aud = o.audienceFor(s, leads, { now });
console.log("audience:", aud.included.map((l) => l.name), aud.excluded.map((x) => x.lead.name + ": " + x.why));
if (aud.included.map((l) => l.id).join() !== "1") fail("only Sam should be reachable by text: " + aud.included.map((l) => l.name));
if (!aud.excluded.some((x) => x.lead.id === "2" && /no phone/.test(x.why)) || !aud.excluded.some((x) => x.lead.id === "3" && /opted out/.test(x.why)) || !aud.excluded.some((x) => x.lead.id === "5" && /reached 8 days ago/.test(x.why)) || !aud.excluded.some((x) => x.lead.id === "6" && /do not contact/.test(x.why))) fail("exclusions: " + JSON.stringify(aud.excluded.map((x) => x.why)));
if (aud.included.concat(aud.excluded.map((x) => x.lead)).some((l) => l.id === "4")) fail("a Rogue owner is in the Sentra audience");
const withRecent = o.audienceFor(s, leads, { now, includeRecent: true });
if (!withRecent.included.some((l) => l.id === "5")) fail("includeRecent doesn't bring Sal back");
const byEmail = o.audienceFor({ ...s, channel: "email" }, leads, { now });
if (byEmail.included.map((l) => l.id).join() !== "2") fail("by email only Sue is reachable: " + byEmail.included.map((l) => l.name));

// --- The draft.
const d = o.draftFor(leads[0], s, { salesperson: "Parm", dealership: "O'Regan's Nissan" });
console.log("draft:", d.body);
if (!/^Hi Sam, it's Parm at O'Regan's Nissan\. This month if you trade in your Sentra for a new Nissan, you get double loyalty\. Want me to see what that looks like for you\? Reply STOP to opt out\.$/.test(d.body)) fail("the text draft: " + d.body);
const e = o.draftFor(leads[1], { ...s, channel: "email" }, { salesperson: "Parm", dealership: "O'Regan's Nissan" });
if (!/double loyalty/.test(e.subject) || !/^Hi Sue,\n\nThis month if you trade in your Sentra/.test(e.body) || !/Parm\nO'Regan's Nissan$/.test(e.body)) fail("the email draft: " + JSON.stringify(e));
if (o.describeAudience(s) !== "Sentra owners") fail("label: " + o.describeAudience(s));
if (o.describeAudience(o.parseOutreach("text everyone with a paid off Nissan older than 2019 that hi")) !== "2018 and older Nissan owners · paid off") fail("label 2: " + o.describeAudience(o.parseOutreach("text everyone with a paid off Nissan older than 2019 that hi")));
console.log(process.exitCode ? "\noutreach.test.js FAILED" : "\noutreach.test.js passed");
})();
