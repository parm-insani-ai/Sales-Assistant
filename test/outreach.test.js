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
// What the mic actually hands over: "lease sending", "least ending", "lease and ing", "paid of", "rouge".
for (const said of ["text everyone with the lease sending this year", "text everyone with the least ending this year", "text everyone whose lease is spending this year", "text everyone with their lease and ing this year", "text everyone whose lease is endng this year"]) {
  s = o.parseOutreach(said, now);
  if (!s.audience.lease || s.audience.unknown.length || s.audience.leaseUntil !== "2026-12-31") fail("heard wrong: " + said + " → " + JSON.stringify(s.audience));
}
s = o.parseOutreach("text my rouge owners who paid of their car that the new one is here", now);
if (s.audience.models.join() !== "rogue" || !s.audience.paidOff || s.audience.unknown.length) fail("rouge / paid of: " + JSON.stringify(s.audience));
// The lease window: this year, in March, by June, the next three months, 60 days.
s = o.parseOutreach("text everyone whose lease is ending in March that we'd love to see them", now);
if (s.audience.leaseFrom !== "2027-03-01" || s.audience.leaseUntil !== "2027-03-31" || s.audience.unknown.length || !/lease ending Mar 2027/.test(o.describeAudience(s))) fail("lease in March: " + JSON.stringify(s.audience) + " " + o.describeAudience(s));
s = o.parseOutreach("text everyone with a lease ending by June", now);
if (s.audience.leaseFrom || s.audience.leaseUntil !== "2027-06-30" || !/lease ending by Jun 2027/.test(o.describeAudience(s))) fail("lease by June: " + JSON.stringify(s.audience));
s = o.parseOutreach("email everyone whose lease is up in the next three months", now);
if (s.audience.leaseUntil !== "2026-12-22" || s.audience.unknown.length) fail("next three months: " + JSON.stringify(s.audience));
s = o.parseOutreach("text everyone whose lease ends within 60 days", now);
if (s.audience.leaseUntil !== "2026-11-22" || s.audience.unknown.length) fail("within 60 days: " + JSON.stringify(s.audience));
// Every way of introducing the message — "telling him" is what the mic makes of "telling them".
for (const [said, model] of [["message everyone who has a nissan rogue telling him that there's special financing on the rogue this month", "rogue"], ["text all my kicks owners tell her the new one is in", "kicks"], ["text sentra owners and let him know that the new sentra is in", "sentra"], ["email everyone who drives a frontier and say that we're buying trucks this week", "frontier"], ["text my altima owners, mention that the altima is being discontinued", "altima"], ["text rogue owners with a message that the new rogue is here", "rogue"]]) {
  s = o.parseOutreach(said, now);
  if (s.audience.models.join() !== model || s.audience.unknown.length || !s.message) fail("the message wasn't found: " + said + " → " + JSON.stringify(s));
}
s = o.parseOutreach("message everyone who has a nissan rogue telling him that there's 0% financing on nissan rogue this month and it might be one of the best times to buy", now);
if (s.audience.models.join() !== "rogue" || s.audience.unknown.length || !/^there's 0% financing/.test(s.message)) fail("telling him: " + JSON.stringify(s));
// The figures taken out, the meaning kept.
const noFig = o.stripFigures(s.message);
if (/0%|\$|\d%/.test(noFig) || !/special financing on nissan rogue this month/.test(noFig)) fail("the figure wasn't taken out plainly: " + noFig);
if (o.stripFigures("we'll give you $2,000 over book this month") !== "we'll give you a strong offer over book this month") fail("over book: " + o.stripFigures("we'll give you $2,000 over book this month"));
if (!/a payment that works/.test(o.stripFigures("get into a new Kicks for 300 a month"))) fail("a month: " + o.stripFigures("get into a new Kicks for 300 a month"));
if (/\d/.test(o.stripFigures("rates from 2.9% APR and up to $1,500 cash back"))) fail("rates and cash back: " + o.stripFigures("rates from 2.9% APR and up to $1,500 cash back"));
// "Contact" and the other ways of saying send-to-many; a sentence with only who in it has no message and isn't "not understood".
for (const said of ["contact everyone whose lease ends this year", "get in touch with everyone whose lease is ending this year", "reach everyone with a lease ending this year", "follow up with everyone whose lease is up this year"]) {
  s = o.parseOutreach(said, now);
  if (!s.audience.lease || s.audience.unknown.length || s.message) fail("a plain who-only sentence: " + said + " → " + JSON.stringify(s));
}
// With only who said, the message is written to the reason — no figure, second person, the window named.
const written = o.messageFor(o.parseOutreach("contact everyone whose lease ends this year", now));
if (!/lease/.test(written) || !/this year/.test(written) || !/you/.test(written) || /\$|\d/.test(written)) fail("the lease message: " + written);
if (!/in March/.test(o.messageFor(o.parseOutreach("text everyone whose lease is ending in March", now)))) fail("the month isn't named in the message");
if (!/paid off/.test(o.messageFor(o.parseOutreach("text everyone with a paid off car", now)))) fail("the paid-off message");
// Why nobody matched, said with what the audience needs on file.
const book = [{ vehicleInterest: "2023 Nissan Rogue" }, { vehicleInterest: "2021 Nissan Kicks" }];
const gaps = o.audienceGaps(o.parseOutreach("contact everyone whose lease ends this year", now), book, now);
if (!/none of the 2 customers on file has a lease end date/.test(gaps)) fail("the gap isn't explained: " + gaps);
const gaps2 = o.audienceGaps(o.parseOutreach("contact everyone whose lease ends this year", now), [{ leaseEnd: "2027-05-01" }], now);
if (!/1 of 1 have a lease end on file, none in the window/.test(gaps2)) fail("the window gap isn't explained: " + gaps2);
if (o.audienceGaps(o.parseOutreach("contact everyone whose lease ends this year", now), [{ leaseEnd: "2026-11-01" }], now) !== "") fail("a match shouldn't read as a gap");
// And who's in: a lease ending in November is "this year"; one ending in February isn't; nothing said means the next four months.
const thisYear = o.parseOutreach("text everyone with the lease ending this year", now).audience;
if (!o.inAudience(thisYear, { vehicleInterest: "2023 Nissan Rogue", leaseEnd: "2026-11-15" }, now) || o.inAudience(thisYear, { vehicleInterest: "2023 Nissan Rogue", leaseEnd: "2027-02-01" }, now)) fail("the lease window isn't applied");
const anyLease = o.parseOutreach("text everyone whose lease is ending", now).audience;
if (!o.inAudience(anyLease, { leaseEnd: "2027-01-10" }, now) || o.inAudience(anyLease, { leaseEnd: "2027-03-10" }, now)) fail("with nothing said the window should be four months");
s = o.parseOutreach("text all past customers I haven't contacted in 60 days that I'd love to catch up");
if (JSON.stringify(s.audience.stages) !== '["sold","delivered"]' || s.audience.quietDays !== 60) fail("past customers, quiet 60 days: " + JSON.stringify(s.audience));
s = o.parseOutreach("email everyone that the service department is open Saturdays now");
if (!s.audience.everyone || s.channel !== "email") fail("everyone: " + JSON.stringify(s));

// --- A model without "everyone who owns": "my Altima owners", "Rogue owners:".
s = o.parseOutreach("text my Altima owners that the Altima is being discontinued");
if (s.audience.models.join() !== "altima" || s.audience.everyone) fail("my Altima owners: " + JSON.stringify(s.audience));
s = o.parseOutreach("text Rogue owners: the new Rogue is here");
if (s.audience.models.join() !== "rogue" || !/new Rogue is here/.test(s.message)) fail("Rogue owners with a colon: " + JSON.stringify(s));
s = o.parseOutreach("text the Sentra people that we have double loyalty");
if (s.audience.models.join() !== "sentra") fail("the Sentra people: " + JSON.stringify(s.audience));

// --- What it can't read is never rounded down to everyone.
// --- Body style, and the one matcher the Leads filter shares.
s = o.parseOutreach("text everyone who owns an SUV that we have a family event");
if (s.audience.body !== "suv" || s.audience.unknown.length || o.describeAudience(s) !== "SUV owners") fail("SUV: " + JSON.stringify(s.audience) + " " + o.describeAudience(s));
s = o.parseOutreach("text all my Nissan truck owners that Frontier lease rates are good");
if (s.audience.body !== "truck" || !s.audience.nissan || o.describeAudience(s) !== "Nissan truck owners") fail("Nissan trucks: " + JSON.stringify(s.audience));
const rogue = { vehicleInterest: "2019 Nissan Rogue SV", stage: "sold", currentPayment: 450, payoff: 9000, currentValue: 16000, purchaseDate: "2019-06-01" };
const frontier = { vehicleInterest: "2022 Nissan Frontier PRO-4X", stage: "delivered", currentPayment: 700, payoff: 30000, currentValue: 33000 };
if (!o.inAudience({ ...o.emptyAudience(), body: "suv" }, rogue, now) || o.inAudience({ ...o.emptyAudience(), body: "suv" }, frontier, now)) fail("body matching");
if (!o.inAudience({ ...o.emptyAudience(), models: ["rogue"], equity: true, yearMax: 2019 }, rogue, now) || o.inAudience({ ...o.emptyAudience(), models: ["rogue"], paidOff: true }, rogue, now)) fail("hand-picked criteria don't match like the sentence's");
if (!o.isEveryone(o.emptyAudience()) || o.isEveryone({ ...o.emptyAudience(), ownedYears: 4 })) fail("isEveryone");

for (const [t, want] of [
  ["text everyone who is financed at over 8 percent that rates dropped", "financed at over 8 percent"],
  ["text everyone in Dartmouth that I'm at the Dartmouth store this week", "dartmouth"],
  ["text everyone who owns a Rogue with under 60,000 km that we want low km Rogues", "under 60,000 km"],
  ["text everyone who owns a Sentra or a Versa but not a lease that we have double loyalty", "but not a lease"],
  ["text all my Nissan owners except the ones I texted this month that we have an event", "except"],
]) {
  s = o.parseOutreach(t);
  if (!s.audience.unknown.includes(want) || s.audience.everyone) fail(`didn't flag "${want}": ` + JSON.stringify(s.audience));
  const a = o.audienceFor(s, [{ id: "x", name: "X", phone: "1", vehicleInterest: "2019 Nissan Rogue", stage: "sold" }], { now });
  if (a.included.length || !a.unknown.length) fail("picked people for a clause it didn't understand: " + t);
  if (!/didn't understand/.test(o.describeAudience(s)) || !/didn't understand/.test(o.unknownNote(s))) fail("no note for: " + t);
}
for (const t of ["text everyone who's had their car for more than 4 years that hi", "text everyone I haven't talked to in 3 months that hi", "text everyone who has a Nissan that's paid off that hi", "text everyone who owns a Rogue that is 2019 or older that hi", "let all my Sentra owners know that hi", "reach out to everyone who owns a Sentra about hi", "text all my past customers that hi", "text my delivered customers that hi", "email everyone that hi", "text everyone with a 2019 or older Nissan that hi"]) {
  s = o.parseOutreach(t);
  if (s.audience.unknown.length) fail(`flagged a clause it does read: "${t}" → ${JSON.stringify(s.audience.unknown)}`);
}

// --- Is it a blast?
for (const t of ["text everyone who owns a sentra that we have double loyalty", "email all my Rogue owners saying hi", "reach out to anyone with a paid off Nissan", "text every Kicks owner about the trade-in event", "text all my past customers that hi", "text my delivered customers that hi", "text the Sentra people that hi", "text all my new leads that hi"]) if (!o.isOutreach(t)) fail("not read as outreach: " + t);
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
