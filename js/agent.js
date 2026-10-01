// Voice agent — a real tool-use loop. The request goes to a Claude gateway on
// the user's Supabase; Claude can call READ tools (look up customers, the deal
// radar, stats, today's schedule) and WRITE tools (book appointments, log sales,
// update customers…). We run each tool locally against the store, feed the
// results back, and let Claude take the next step until it's done — so it can
// answer questions and carry out multi-step tasks. All data stays on-device;
// the gateway only relays messages to the model.

import * as store from "./store.js";
import { navigate, holdNavigation } from "./router.js";
import { undoToast } from "./components.js";
import { maybeStartCadence, startCadence, planSummary } from "./cadence.js";
import { addContext, PROFILE_FIELDS } from "./context.js";
import { openDealerSearch } from "./views/dealer.js";
import { findSpec, queueCompare } from "./views/compare.js";
import { topOpportunities, dealsForLead, equityDetail, warmRadar } from "./views/dealbuilder.js";
import { salesTarget, inferShopping } from "./target.js";
import { logCustomer } from "./logbook.js";
import { apptFunnel, monthSummary } from "./views/goals.js";
import { afterSale, afterAppointmentBooked, afterDeliveryComplete, closeFollowUps } from "./connections.js";
import { getOccasions } from "./occasions.js";
import { computeDeal } from "./views/calculator.js";
import { sendEmail, logEmail } from "./email.js";
import { smsHref, telHref } from "./utils.js";
import { bookingLink, cachedShortBookingLink } from "./bookinglink.js";
import { weekStart, weekStats, coachInsights } from "./views/coach.js";
import { getPlays } from "./plays.js";
import { getProspects, prospectStats } from "./prospects.js";
import { assessAll, assessment } from "./assess.js";
import { getNudges } from "./nudges.js";
import * as backend from "./backend.js";
import { openText } from "./sms.js";
import { vocabulary } from "./asr.js";
import { answerLot, lotSummary } from "./lot.js";
import { styleBrief } from "./style.js";
import { parseOutreach, audienceFor, describeAudience, unknownNote } from "./outreach.js";
import { reachForBlast } from "./consent.js";
import { makeMatcher } from "./match.js";
import { horizonFor, horizonBook, contractsEnding, followUpFor, monthLabel } from "./horizon.js";
import { conversationFor, transcript, standingWith, recentInbound, recentDigest, loadBodies } from "./convo.js";
import { planTasks, planStatus, onAppointmentConfirmed, onAppointmentOutcome } from "./apptplan.js";

// Put the units a lot answer counted on the Inventory screen, under the
// question as a chip, so the spoken sentence hands over to what's on screen.
export function showLotOnScreen(res) {
  if (!res || !res.matches || !res.matches.length) return;
  try { sessionStorage.setItem("inventory-pick", JSON.stringify({ ids: res.matches.map((v) => v.id), label: res.label })); } catch { /* the answer still gets spoken */ }
  navigate("/inventory");
}

export { agentConfigured } from "./agentcfg.js";

function buildContext() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()],
    nowTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    salesperson: store.getSettings().salesperson || "",
    counts: { leads: store.all("leads").length, appointments: store.all("appointments").length },
    lot: lotSummary(store.all("vehicles")),
    // The proper nouns the speech engine is most likely to have mangled. The
    // model repairing "centra" into "Sentra" from context is far more reliable
    // than any distance metric, but only if it knows what the candidates are.
    vocab: vocabulary({ limit: 120 }),
    // Who has written in lately, and whether they've been answered — so
    // "anything from Dana?" or "who's waiting on me?" needs no lookup, and
    // a message drafted mid-conversation continues it.
    recent: recentDigest(),
  };
}

// Everything that can be known about a customer beyond a name and a number —
// the same fields on create, update and add_context, so a detail said at any
// point lands in the same place. See context.js.
const CONTEXT_PROPS = Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key,
  f.type === "list" ? { type: "array", items: { type: "string" }, description: f.hint }
  : f.type === "money" ? { type: "number", description: f.hint + " — 'thirty' or '30k' for a car means 30000" }
  : f.type === "enum" ? { type: "string", enum: f.values, description: f.hint }
  : { type: "string", description: f.hint }]));
CONTEXT_PROPS.notes = { type: "string", description: "EVERYTHING else said about them, in the salesperson's own words — wants, likes, budget, timeline, family, story, how they came in. Keep all of it; nothing is too small." };

// The agent's brain lives here in the app (not on the server), so it can be
// improved and shipped via the normal auto-update — no Supabase redeploy.
const TOOLS = [
  { name: "ask_user", description: "Ask the salesperson ONE short question when a required detail is genuinely missing or ambiguous (e.g. which customer, or a time you can't reasonably assume), or to confirm something that can't be undone. Only use when you truly can't proceed. When the answer is one of a few clear choices — yes or no, which of two customers, new or used, one of a few times — pass them as `options` (2 to 5 short labels) so they can just tap one; leave `options` out when the answer is free-form (a phone number, a name, a note).", input_schema: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" }, description: "2–5 short tappable answers, only when the answer is one of a few clear choices" } }, required: ["question"] } },
  { name: "find_customers", description: "Look up customers/leads by name/vehicle query, stage, needsFollowUp, or hasEquity.", input_schema: { type: "object", properties: { query: { type: "string" }, stage: { type: "string" }, needsFollowUp: { type: "boolean" }, hasEquity: { type: "boolean" } } } },
  { name: "get_customer", description: "Full details for one customer by name — contact, vehicle, position, profile, notes, the assessment, and the CONVERSATION so far (their texts, emails and calls, oldest first) with whether they're waiting on a reply.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "get_messages", description: "What people have SAID — every text, email and call on file. With `customer`: that person's whole conversation, oldest first ('what did Dana say?', 'read me Ken's email', 'did Sara get back to me?', 'where did I leave things with Moe?'). Without: everything that came in recently from everyone, newest first, each marked answered or waiting ('anything from my customers?', 'what came in today?', 'who's waiting on me?', 'any emails?'). Includes mail in the connected inbox from people not on file.", input_schema: { type: "object", properties: { customer: { type: "string" }, kind: { type: "string", enum: ["text", "email", "call"], description: "only this kind" }, hours: { type: "number", description: "without a customer: how far back (default 48)" } } } },
  { name: "get_appointments", description: "List appointments, optionally for a date (YYYY-MM-DD).", input_schema: { type: "object", properties: { date: { type: "string" } } } },
  { name: "deal_radar", description: "Who on file could be put into a different vehicle right now, matched against real inventory. Use for ANY phrasing of this question — 'who can I get into a car for less than they're paying now', 'who could I upgrade', 'who's got equity', 'anyone I can move into something newer', 'who should I call about a trade'. Returns each customer with what they pay today, the matched vehicle, the new monthly, and `delta` (new minus current — NEGATIVE means cheaper). Set cheaperOnly when the ask is specifically about a lower/cheaper/better payment than they have now. Set `vehicle` to run it the OTHER WAY — from a vehicle to the customers who fit it: 'which customers can be put in a Nissan Sentra right now', 'who could I move into a Rogue', 'who fits this Frontier'.", input_schema: { type: "object", properties: { limit: { type: "number" }, cheaperOnly: { type: "boolean", description: "only customers whose matched payment is LOWER than what they pay today" }, maxMonthly: { type: "number", description: "cap the new monthly payment" }, vehicle: { type: "string", description: "a model/trim to match against, e.g. \"Sentra\" or \"2026 Nissan Rogue SV\" — returns the customers who fit THAT vehicle" } } } },
  { name: "get_stats", description: "This month's appointment funnel, units, commission, goals.", input_schema: { type: "object", properties: {} } },
  { name: "get_tasks", description: "List open to-dos ('what's on my plate?'). dueToday also includes overdue.", input_schema: { type: "object", properties: { dueToday: { type: "boolean" } } } },
  { name: "get_deliveries", description: "Upcoming deliveries with prep progress ('when's Sara's delivery?', 'what's left to prep?').", input_schema: { type: "object", properties: {} } },
  { name: "get_occasions", description: "Reasons to reach out — upcoming birthdays, lease maturities, purchase anniversaries, each with a ready-to-send message.", input_schema: { type: "object", properties: {} } },
  { name: "get_specials", description: "Current manufacturer/monthly specials on file (APRs, lease deals, cash offers).", input_schema: { type: "object", properties: {} } },
  { name: "get_spiffs", description: "Current spifs/bonuses on file.", input_schema: { type: "object", properties: {} } },
  { name: "payment_quote", description: "Estimate a monthly car payment. Uses the salesperson's saved tax rate, doc fee, APR and term for anything not given.", input_schema: { type: "object", properties: { price: { type: "number" }, down: { type: "number" }, trade: { type: "number", description: "trade-in allowance" }, payoff: { type: "number", description: "trade-in payoff owed" }, apr: { type: "number" }, term: { type: "number", description: "months" } }, required: ["price"] } },
  { name: "deal_options", description: "Payment-matched vehicles from inventory for one customer ('what could I put Dana in?').", input_schema: { type: "object", properties: { customer: { type: "string" } }, required: ["customer"] } },
  { name: "get_booking_link", description: "The salesperson's self-serve booking link (customers pick their own appointment time). Pair with text_customer to send it.", input_schema: { type: "object", properties: {} } },
  { name: "get_link_activity", description: "Opens on links the salesperson has sent (booking page, comparisons) — 'did anyone look at what I sent?', 'anything hot?'. Recent opens mean the customer is engaging right now.", input_schema: { type: "object", properties: {} } },
  { name: "get_nudges", description: "What needs attention RIGHT NOW — customers waiting on a reply, appointments about to start that aren't confirmed, appointments that have passed with no outcome, deliveries with prep outstanding, deals gone quiet. Use for 'what needs me now?', 'anything urgent?', 'am I missing anything?'. Different from get_plays: this is time-critical, that is the day's queue.", input_schema: { type: "object", properties: {} } },
  { name: "get_prospects", description: "Today's prospects: the customers on file (imported owners, past customers) the app has picked out today because a car can be sold to them now — equity, a payment-matched deal, a lease coming due, years in the same vehicle. Use for 'who should I reach out to today', 'who can I sell a car to', 'work the book', 'who's worth a call'. Each comes with the reasons and a drafted opener the salesperson approves. Puts the list on Log.", input_schema: { type: "object", properties: {} } },
  { name: "get_plays", description: "The ranked play sheet — 'what should I do right now?', 'what are my plays?'. Warm link opens, unconfirmed appointments, no-show recoveries, due follow-ups, occasions, radar opportunities — best first.", input_schema: { type: "object", properties: {} } },
  { name: "sales_target", description: "The monthly sales target sheet — 'how am I doing against my target?', 'how many customers do I need to talk to?', 'am I on pace?', 'what's my closing ratio?'. New and used unit targets, the closing ratio expected, customers to speak with, spoken with so far, sold, remaining, pace, and this week's share.", input_schema: { type: "object", properties: {} } },
  { name: "get_coach", description: "The weekly sales-coach readout — 'how am I doing this week?', 'give me my weekly review'. This week's scorecard (units, commission, appointments, show rate, touches), last week for comparison, and the coach's insights.", input_schema: { type: "object", properties: {} } },
  { name: "open_page", description: "Open a screen.", input_schema: { type: "object", properties: { page: { type: "string", enum: ["home", "leads", "inventory", "calculator", "deliveries", "calendar", "goals", "radar", "tools", "comms", "soldlog", "coach", "pay", "spiffs", "specials", "compare", "import", "settings"] } }, required: ["page"] } },
  { name: "create_lead", description: "Add a new customer/lead. Use this when someone 'wants', 'is looking for', or 'is interested in' a vehicle — that is interest, NOT a sale. A PHONE NUMBER IS REQUIRED: if none was said, ask_user for it FIRST (one short question: \"What's Ann's number?\"), then create with everything. Only if they say they don't have it, pass noPhone: true. Capture EVERYTHING said about them in the same call: contact details, the vehicle, and all the context fields (trim, features, new/used, budget, timeline, trade, who else, what matters) plus the whole thing in `notes`. Always set newUsed when it can be told (\"a used Rogue\" → used; a current model year → new): the monthly sales target counts customers spoken with by new and used, and adding them here logs the conversation. Their follow-up plan starts automatically.", input_schema: { type: "object", properties: { name: { type: "string" }, vehicle: { type: "string", description: "e.g. \"Nissan Rogue\" or \"2026 Rogue SV\"" }, phone: { type: "string", description: "required — ask for it if it wasn't said" }, noPhone: { type: "boolean", description: "only when the salesperson says they don't have a number" }, email: { type: "string" }, followUp: { type: "string" }, ...CONTEXT_PROPS }, required: ["name"] } },
  { name: "update_lead", description: "Update an existing customer (match by name) — contact details, stage, vehicle, and any context learned about them (same fields as create_lead).", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, stage: { type: "string", enum: ["new", "working", "appointment", "negotiating", "sold", "delivered", "lost"] }, followUp: { type: "string" }, vehicle: { type: "string" }, ...CONTEXT_PROPS }, required: ["name"] } },
  { name: "add_context", description: "Record something learned about an existing customer — 'Parm said he loves the SV moonroof', 'Sara's budget is around thirty', 'Ken's wife has to sign off'. Put the structured parts in their fields and the whole remark in `notes`. Use this for ANY detail about a customer that isn't a stage change or a contact detail.", input_schema: { type: "object", properties: { customer: { type: "string" }, vehicle: { type: "string" }, ...CONTEXT_PROPS }, required: ["customer"] } },
  { name: "add_task", description: "Add a to-do/reminder.", input_schema: { type: "object", properties: { title: { type: "string" }, due: { type: "string" } }, required: ["title"] } },
  { name: "complete_task", description: "Check off an open to-do (match by words from its title — 'mark the plates thing done').", input_schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  { name: "complete_delivery", description: "Mark a customer's delivery as delivered/handed over. Kicks off the post-delivery follow-up plan.", input_schema: { type: "object", properties: { customer: { type: "string" } }, required: ["customer"] } },
  { name: "text_customer", description: "Text a customer — YOU write a natural message; the salesperson just hits send. Use for 'text Ken that his car is ready', or to send the booking link / a comparison. `customer` accepts a NAME or a PHONE NUMBER. Given a number for someone not on file, just send it — the customer record is created automatically. Never ask who a phone number belongs to.", input_schema: { type: "object", properties: { customer: { type: "string", description: "customer name, or a phone number" }, message: { type: "string" } }, required: ["customer", "message"] } },
  { name: "call_customer", description: "Open the phone dialer ('call Moe', 'call 902 555 1234'). `customer` accepts a name or a phone number — dial a raw number without asking who it is.", input_schema: { type: "object", properties: { customer: { type: "string", description: "customer name, or a phone number" } }, required: ["customer"] } },
  { name: "send_email", description: "Actually send an email to a customer (needs their email on file and email sending set up). YOU write the subject and body.", input_schema: { type: "object", properties: { customer: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["customer", "subject", "body"] } },
  { name: "add_special", description: "Save a manufacturer/monthly special ('0% for 60 months on Rogues till Monday').", input_schema: { type: "object", properties: { model: { type: "string" }, financeApr: { type: "number" }, financeTerm: { type: "number" }, leasePayment: { type: "number" }, leaseTerm: { type: "number" }, leaseDown: { type: "number" }, leaseTrim: { type: "string", description: "trim the advertised lease applies to" }, cash: { type: "number" }, expiry: { type: "string", description: "YYYY-MM-DD" }, notes: { type: "string" } }, required: ["model"] } },
  { name: "add_spif", description: "Save a spif/bonus ('$500 on every Pathfinder this weekend').", input_schema: { type: "object", properties: { title: { type: "string" }, amount: { type: "number" }, match: { type: "string", description: "keyword a sale's vehicle must contain to count" }, expiry: { type: "string", description: "YYYY-MM-DD" }, notes: { type: "string" } }, required: ["title"] } },
  { name: "log_sale", description: "Log a CLOSED sale. Use ONLY when the salesperson clearly says the deal is done — 'sold', 'bought', 'signed', 'took delivery', 'made $X on'. Never for interest ('wants/looking at a Rogue' is create_lead or update_lead, not a sale). Capture tracker details when spoken: lead type, new/used, stock #, business manager, front vs business-office commission.", input_schema: { type: "object", properties: { customer: { type: "string" }, commission: { type: "number" }, front: { type: "number" }, back: { type: "number" }, vehicle: { type: "string" }, leadType: { type: "string", enum: ["Walk-in", "Hand Off", "Referral", "Facebook", "BDC", "Service", "Auto Alert", "Other"] }, newUsed: { type: "string", enum: ["New", "Used"] }, stock: { type: "string" }, bm: { type: "string", description: "business manager who worked the deal" }, frontComm: { type: "number", description: "front commission $" }, boComm: { type: "number", description: "business office commission $" } }, required: ["customer"] } },
  { name: "delete_customer", description: "Remove a customer from the book entirely — 'delete Tony Montana', 'get rid of that lead', 'remove him from the system'. Their open follow-ups and upcoming appointments go too; texts and emails already logged stay. This can't be undone, so it runs in two steps: call it, and if `confirmed` isn't true it tells you what to confirm; ask_user that one question, and only on a clear yes call again with confirmed: true. A customer who's merely gone quiet or bought elsewhere is update_lead to stage 'lost', not this.", input_schema: { type: "object", properties: { customer: { type: "string" }, confirmed: { type: "boolean", description: "true only after the salesperson has said yes to deleting this person" } }, required: ["customer"] } },
  { name: "undo_sale", description: "Remove a sale that was logged by mistake (e.g. 'I didn't sell that car', 'that wasn't a sale'). Deletes the customer's most recent sale record and moves their stage back from sold.", input_schema: { type: "object", properties: { customer: { type: "string" } }, required: ["customer"] } },
  { name: "remember_rule", description: "Save a standing instruction about how YOU should behave, for good — 'from now on always offer a test drive before talking price', 'never book Saturdays after 3', 'call me PJ in texts', 'when someone asks for a number, say the desk works it out'. It goes into the salesperson's standing instructions, which every brief and every drafted text and email reads from then on, on every device. Two steps: call it with the rule in the salesperson's words; if `confirmed` isn't true it hands back what to read aloud — ask_user that, with options — and only on a clear yes call again with confirmed: true. NOT for facts about a customer (that's add_context) and not for a one-off ask.", input_schema: { type: "object", properties: { rule: { type: "string", description: "the instruction, in the salesperson's words, as one sentence" }, confirmed: { type: "boolean", description: "true only after the salesperson said yes to this exact rule" } }, required: ["rule"] } },
  { name: "forget_rule", description: "Remove a standing instruction — 'forget the rule about Saturdays', 'stop calling me PJ', 'drop that instruction'. Matches on the words; says which rule went.", input_schema: { type: "object", properties: { rule: { type: "string", description: "words from the rule to remove" } }, required: ["rule"] } },
  { name: "undo_last", description: "Reverse the last change you made — 'undo that', 'no, not Dana', 'that was wrong', 'scrap that', 'take that back'. Puts the records exactly back: a customer added is removed, an update restored, an appointment unbooked, a sale taken off, a to-do reopened. Each call undoes one more change, newest first. Then do what they meant, if they said.", input_schema: { type: "object", properties: {} } },
  { name: "book_appointment", description: "Book an appointment with a customer.", input_schema: { type: "object", properties: { customer: { type: "string" }, type: { type: "string", enum: ["appointment", "testdrive", "delivery", "call"] }, when: { type: "string", description: "YYYY-MM-DDTHH:MM" }, vehicle: { type: "string" } }, required: ["customer", "when"] } },
  { name: "appointment_outcome", description: "Set a customer's appointment outcome.", input_schema: { type: "object", properties: { customer: { type: "string" }, outcome: { type: "string", enum: ["confirmed", "showed", "no_show", "sold"] } }, required: ["customer", "outcome"] } },
  { name: "start_cadence", description: "Start the follow-up plan for a customer.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "lot_lookup", description: "ANY question about what's on the lot — answered from the store's own inventory with the WEBSITE'S prices and kilometres. 'Do we have any Rogue SVs?', 'how many used Rogues?', 'what's the Civic Sport going for?', 'how many kilometres on stock NHP1868?', 'cheapest used SUV under thirty?', 'any hybrids?', 'anything black under 25?'. Pass the salesperson's words as `question`; add structured filters only when they help. Returns the count, the matching units (price, km, stock, colour, arrival date) and a ready spoken `answer` — read the answer back as is; the units are already on screen.", input_schema: { type: "object", properties: { question: { type: "string", description: "the salesperson's own words" }, condition: { type: "string", enum: ["New", "Used"] }, maxPrice: { type: "number" }, minPrice: { type: "number" }, maxKm: { type: "number" }, stock: { type: "string" }, sort: { type: "string", enum: ["price", "priceDesc", "km", "year"] }, ask: { type: "string", enum: ["count", "price", "km", "cheapest", "priciest", "newest", "list"] } }, required: ["question"] } },
  { name: "mass_outreach", description: "Set up a text or email to MANY customers at once, picked by what they drive or where they stand: 'text everyone who owns a Sentra that this month if they trade it in for a new Nissan they get double loyalty', 'email all my Rogue owners from 2018 to 2021 that…', 'text everyone with a paid off Nissan that…', 'text everyone whose lease is ending that…'. Pass the salesperson's whole sentence as `sentence` (audience AND message). The app builds the recipient list and writes each message in the customer's name; the salesperson reviews on screen and taps Send — nothing sends from this tool. Never put a dollar amount or a rate in the message.", input_schema: { type: "object", properties: { sentence: { type: "string", description: "the whole request: who, and what to tell them" }, channel: { type: "string", enum: ["text", "email"] } }, required: ["sentence"] } },
  { name: "search_inventory", description: "Put the dealer-website search buttons on screen for the wider O'Regan's NETWORK (other stores, used vehicles) — only when the salesperson asks about the network or other stores. It opens the website in the browser; this app does NOT see the results, cannot count, filter or sort them, and cannot say what's there. Questions about OUR lot are lot_lookup. NOT for comparing models — that's compare_vehicles.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "when_it_makes_sense", description: "WHEN a customer's next vehicle starts to make sense — not whether, but the month: when their equity clears the line as the payoff comes down and the value drifts, when a like-for-like on the lot lands at their payment, when the contract runs out, or six months before a lease ends. 'When should I go back to Dana?', 'when does it make sense for Ken?', or with no customer: 'who opens up in the next six months?', 'who's coming up?'. Opens the Timing screen.", input_schema: { type: "object", properties: { customer: { type: "string" }, months: { type: "number", description: "with no customer: how far ahead to list (default 6)" } } } },
  { name: "lease_ends", description: "Every lease on the book with when it ends, soonest first — 'when do my leases end?', 'any leases ending this year?', 'what's coming off lease?'. Opens the Timing screen on the lease list.", input_schema: { type: "object", properties: { months: { type: "number", description: "only leases ending within this many months (default 12)" } } } },
  { name: "compare_vehicles", description: "Open the side-by-side comparison tool with the named vehicles, using the built-in 2026 Canadian spec database. Use whenever the salesperson wants to compare models or a customer is cross-shopping — 'compare the Kicks with the CR-V', 'how does the Rogue stack up against the RAV4'.", input_schema: { type: "object", properties: { vehicles: { type: "array", items: { type: "string" }, description: "Vehicle names, e.g. [\"Nissan Kicks\", \"Honda CR-V\"]" } }, required: ["vehicles"] } },
];

// The brief is two parts, and the split is the cache. The standing part —
// how to read speech, which tool answers what, the rules — is the same bytes
// on every call, so it's sent as its own block marked for caching and read
// back from the cache after the first turn. The live part (today's date, the
// names on file, what's come in) changes and is paid for each time. Anything
// that varies must stay out of the standing part, or nothing caches.
function buildSystem(ctx) {
  return [buildStanding(), buildLive(ctx)].join("\n");
}
function buildStanding() {
  return [
    `You are viniva's hands-free assistant for a car salesperson.`,
    `Understand plain, casual speech — the user will NOT use command words. Infer what they want from whatever they tell you. A bare fact usually implies an action: "Ken's coming in Thursday at 4" → book an appointment; "sold one to Moe, made 800" → log a sale; "Sara's cell is 902-555-1212" → update Sara's phone; "who should I call?" → check the deal radar / follow-ups; "compare the Kicks with the CR-V" or "customer's cross-shopping the RAV4" → compare_vehicles (never search_inventory for that).`,
    `CRITICAL distinction: "X wants / is looking for / is interested in a <vehicle>" means INTEREST — create the lead (or update their vehicle of interest). It is NOT a sale. Log a sale only when the words clearly say the deal closed: "sold", "bought", "signed", "took delivery", "made $X on the deal". If they say a sale was logged by mistake, use undo_sale.`,
    `Strongly prefer ACTING on reasonable assumptions over asking. Resolve relative dates/times to YYYY-MM-DD or YYYY-MM-DDTHH:MM; if no time is given for an appointment, pick a sensible business-hours time; default appointment type to a general appointment unless a test drive, delivery, or call is implied.`,
    `Use READ tools to look things up before acting when helpful (deal_radar, find_customers, get_appointments, get_customer, get_stats, get_tasks, get_deliveries, get_occasions, get_specials, get_spiffs). You can take multiple steps.`,
    `WHAT CUSTOMERS HAVE SAID is on file — every text, email and call, both directions. get_customer includes the conversation so far; get_messages answers "what did Dana say?", "read me Ken's email", "did Sara get back to me?", "anything from my customers?", "what came in today?", "who's waiting on me?". Answer from what they actually wrote — quote or paraphrase the message, don't guess. When writing a text or email to a customer, continue from what they last said: answer what they asked, never ask something they've already answered, never repeat what was already sent.`,
    `"Why is Dana a good candidate?", "what's the story with Ken?", "should I call Sara?" → get_customer: its \`assessment\` has the score, the reasons in order, and the next move — read the top two reasons back. "Who should I reach out to today?", "who can I sell a car to?", "work the book", "bring me people worth a call" → get_prospects: the app has already gone through everyone on file and picked today's handful, each with the reason. Name the top one or two and hand over to the screen.`,
    `MASS OUTREACH: "text/email everyone who owns / drives / has a <model>, with a paid-off car, whose lease is ending, from <year> to <year>, that <message>" → mass_outreach with the whole sentence. It opens the review screen with the recipients and the drafts; say how many it's going to and that it's ready to send. It never sends by itself.`,
    `THE LOT: any question about what's in stock, a unit's price or kilometres, the cheapest of something, or whether we have a model/trim/colour → lot_lookup with the salesperson's words. Its prices are the website's exact prices. Read its \`answer\` back as is. Never quote a catalogue MSRP for a unit on the lot, and never say a price the lot_lookup didn't give you.`,
    `TIMING: "when should I go back to Dana?", "when does it make sense for Ken?", "who opens up in the next six months?", "who's coming up?" → when_it_makes_sense; "when do my leases end?", "what's coming off lease this year?" → lease_ends. The answer is a month and the reason — say it plainly: "Dana opens up in March, when her equity clears three thousand."`,
    `More examples: "what's on my plate?" → get_tasks; "mark the plates thing done" → complete_task; "Sara's car is handed over" → complete_delivery; "let Ken know his car's ready" → text_customer (write the message yourself, warm and short); "what's the payment on 42 grand over 72 months?" → payment_quote; "what could I put Dana in?" → deal_options; "any birthdays or leases ending?" → get_occasions; "how am I doing this week?" → get_coach; "what should I do right now?" → get_plays; "0% on Rogues till Monday" → add_special; "text Ken my booking link" → get_booking_link then text_customer with the link in the message.`,
    // "Who are people I can get into a car right now for a lower payment than
    // they're paying currently" is one sentence for a question the app can
    // answer exactly. Nothing in it names a tool, and that has to be fine —
    // the salesperson is describing the job, not operating a menu.
    `NEVER answer that you didn't understand, and never ask the salesperson to rephrase. They speak in whole sentences about their job, not in commands, and no wording is wrong. Work out which tool answers the sentence and call it — a question about payments, equity, upgrades or trades is deal_radar; about who to contact is get_plays or find_customers; about a person is get_customer. If more than one could fit, pick the closest and answer. Only if genuinely nothing fits, say in one sentence what you CAN look up — never "try rephrasing".`,
    `Only call ask_user when a REQUIRED detail is genuinely missing or ambiguous — e.g. several customers match the name, or no customer is named at all — or to confirm something that can't be undone. Ask ONE short question, then continue once answered. Never ask for something you can reasonably assume.`,
    `RULES FROM THE SALESPERSON. When they tell you how to behave from now on — "from now on…", "always…", "never…", "when X happens, do Y", "remember that I…", "don't ever…" — that is a standing rule, not a one-off: remember_rule with it in their words. It hands back the wording to confirm; ask_user that ONE question with options ("Yes, remember it" / "No"), and on a yes call remember_rule again with confirmed: true. A saved rule is in your brief from the next turn on, everywhere the app writes. The rules already in force are under HOW … WORKS below — follow them without being asked. "Forget the rule about…" → forget_rule. A remark about a customer is add_context, not a rule.`,
    `EVERYTHING YOU WRITE CAN BE UNDONE. Every change you make — a customer added or updated, a note, an appointment, a sale, a to-do, a special — is reversible with undo_last, and the salesperson sees an Undo button after each one. So ACT on the most sensible reading and say what you did; never ask "should I?" or "did you mean?" before an ordinary change. Only a delete needs a yes first. "Undo that", "no, not Dana", "that was wrong", "scrap that", "take that back" → undo_last (the last change; call it again for the one before). If they then say what they meant, do that next.`,
    `BUTTONS OR WORDS: when the answer to your question is one of a few clear choices, give ask_user \`options\` — 2 to 5 short labels the salesperson taps instead of answering aloud: a yes/no ("Yes, delete Tony" / "No, keep him"), which customer ("Dana Muise" / "Dana Lee"), new or used, one of a few times. When the answer is free-form — a phone number, a name, a note, a date you can't guess — ask in words with no options. Options are exactly what they'd say, so the tapped label comes back to you as their answer.`,
    `Match people to existing customers by name; create a new lead only if clearly new.`,
    `DELETING: "delete Tony", "remove him from the system", "get rid of that lead" → delete_customer. It won't delete until you've asked ONE confirming question (ask_user, the exact wording it hands back) and heard a clear yes; then call it again with confirmed: true. Never say there's no way to delete a customer. "Lost", "bought elsewhere", "not interested" → update_lead stage "lost" instead.`,
    `EVERY NEW CUSTOMER GETS A PHONE NUMBER. "Add Ann, she's after a Rogue" with no number → ask_user "What's Ann's number?" BEFORE create_lead, then create with the number and everything else that was said. Numbers arrive as words or split up — join them. If they say they don't have it, create with noPhone: true and move on. A customer who appears for the first time through a sale or an appointment and has no number: say so in one clause and ask for it.`,
    // What the salesperson knows about a customer is the product. Every text in
    // the follow-up plan is written from it, so a detail dropped here is a
    // generic message later.
    `CONTEXT IS THE PRODUCT. When the salesperson says anything about a customer beyond a name and a number — what they want, the trim, a feature they love, new or used, a budget, a timeline, a trade-in, who else is deciding, why they're shopping, how they came in — capture ALL of it: the structured parts in the context fields AND the whole remark, in the salesperson's words, in \`notes\`. Never drop a detail and never summarise it away. "Add Parm, 902 555 1234, he's after a Rogue, loves the SV moonroof, open to new or used, wants to be around thirty" is ONE create_lead call with name, phone, vehicle "Nissan Rogue", trim "SV", features ["moonroof"], newUsed "either", budget 30000, and notes holding the sentence. A remark about someone already on file is add_context.`,
    `A new customer's follow-up plan starts by itself — texts and calls over 90 days, each text drafted from their context and held on Log for the salesperson's OK. Say so in one clause ("follow-up plan's started, first text is waiting for your OK on Log"). Never say they need to set anything up.`,
    // The screen follows the conversation. The list tools put their results on
    // screen as tappable rows, so the spoken reply's job is to hand over to
    // what the salesperson is now looking at — not to read the list back to
    // them. Reciting three names they can already see, and that they then have
    // to go and find for themselves, is the assistant stopping half way.
    `The app FOLLOWS you: a tool that returns a list of people or jobs also puts that list on the salesperson's screen, with one-tap text and call buttons on every row. So do NOT read a list aloud. Name at most the top one or two and hand over to the screen — "Lynn and Mark are your hottest, both one tap away" — because they're already looking at it.`,
    `When finished, reply with ONE short, natural spoken sentence — what you did, or the answer. Plain words only: it's spoken aloud and shown as prose, so no markdown — no asterisks, no bold, no bullet points, no headings, no labels with colons.`,
    // The reply is the only thing the salesperson hears, and it has to be
    // true. A tool that opened a web page is not a search; a draft in a box
    // is not a sent text; a list the app put on screen is not one you read.
    `SAY ONLY WHAT HAPPENED. Your reply must match the tool results word for word in substance: never claim a result, a count, a price, a sort, a filter, a send or a confirmation that a tool result doesn't state. "Opened the search" means the salesperson still has to search — say so; it does not mean results are on screen. A text is "in the box, ready for your send", never "sent". If a tool returned nothing, say nothing was found. If you did not look something up, do not describe it. Never invent a detail to sound finished.`,
    `WHAT YOU CANNOT DO — say so plainly when asked, in one sentence, then offer the nearest thing you can: browse the web or any dealer website (you can only open it for them); see a website's results or prices (only the lot_lookup units from our own site); send anything without the salesperson's tap (texts and outreach wait for their send; only send_email sends); read documents or photos; quote a trade value, a payment the desk hasn't worked out, or a rate (never a figure to a customer); act on another salesperson's customers; book service appointments or anything outside this app; remember a conversation from before today's session unless it's on file. "I can't do that from here" is a complete, correct answer.`,
    // Everything the user "says" reached here through speech recognition, and
    // saying so changes how the model reads a garbled sentence: as something to
    // repair from context rather than as a strange request to query.
    `What the user says arrives as a SPEECH TRANSCRIPT and may contain recognition errors — wrong homophones, a name spelled as ordinary words, a stray or missing short word. Read for intent and repair silently against the names below and the rest of the sentence. Do NOT ask the user to repeat themselves or point out that something was unclear; act on the most sensible reading. Numbers spoken aloud may arrive as words or be split up ("two two six" = 226) — join them.`,
  ].join("\n");
}
function buildLive(ctx) {
  return [
    `The salesperson${ctx.salesperson ? " is named " + ctx.salesperson + "." : "'s name isn't set."} Today is ${ctx.weekday} ${ctx.today}, time ${ctx.nowTime} (local).`,
    styleBrief(),
    ctx.counts ? `The salesperson has ${ctx.counts.leads} customers and ${ctx.counts.appointments} appointments on file.` : ``,
    ctx.lot ? `THE LOT RIGHT NOW (from the store's website; ask lot_lookup for units and prices): ${ctx.lot}` : ``,
    ctx.recent ? `RECENT MESSAGES IN (newest first; WAITING = they wrote last and nobody has answered; get_messages has the whole exchange):\n${ctx.recent}` : ``,
    ctx.vocab && ctx.vocab.names.length
      ? `Customers on file (a mangled word close to one of these is almost certainly that name): ${ctx.vocab.names.join(", ")}.` : ``,
    ctx.vocab && ctx.vocab.models.length
      ? `Vehicles this dealership deals in: ${ctx.vocab.models.join(", ")}.` : ``,
  ].filter(Boolean).join("\n");
}

// Turn an HTTP failure into a message that says what to actually fix.
async function describeAgentError(res) {
  const j = await res.json().catch(() => ({}));
  const msg = j.error || j.message || "";
  if (res.status === 404)
    return "No function at that URL (404). Open Settings → Voice agent and tap Test connection — it will find the right function and fix the URL for you.";
  if (res.status === 401 || res.status === 403)
    return msg && /sign in/i.test(msg) ? msg : `The function rejected the call (${res.status}). Sign in to your cloud account in Settings, and make sure the function has the latest code with "Verify JWT" off (it checks your session itself).`;
  return msg || `Agent error (${res.status})`;
}

// One call to the model through the function: any brain, any tools. The
// salesperson's assistant and the manager's (manageagent.js) share this
// relay and the session loop below; they differ in what they know and what
// they can do.
export async function callRelay({ system, tools, messages, max_tokens = 1024 }) {
  const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("Voice agent isn't set up");
  const res = await fetch(url, {
    method: "POST",
    headers: await backend.fnHeaders(),
    body: JSON.stringify({ system, tools, messages, max_tokens }),
  });
  if (!res.ok) throw new Error(await describeAgentError(res));
  return res.json(); // { content:[...], stop_reason }
}
// The request as the function sends it on: the standing brief marked as a
// cached prefix, the live brief after it, the tools, the conversation.
// (Exported for the utterance eval, which sends the same thing straight to
// the model.)
export function agentRequest(messages) {
  const ctx = buildContext();
  return {
    system: [
      { type: "text", text: buildStanding(), cache_control: { type: "ephemeral" } },
      { type: "text", text: buildLive(ctx) },
    ],
    tools: TOOLS,
    messages,
    max_tokens: 1024,
  };
}
function callAgent(messages) {
  return callRelay(agentRequest(messages));
}

// Cheap end-to-end check used by Settings: hits the saved URL with a tiny
// request so the user can verify the function name, JWT setting, and API key
// without opening voice mode. Resolves true or throws a fix-it message.
export async function testAgent() {
  const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("Paste your function URL first");
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: await backend.fnHeaders(),
      body: JSON.stringify({ messages: [{ role: "user", content: "Reply with the word OK." }], max_tokens: 8 }),
    });
  } catch {
    throw new Error("Couldn't reach that URL — check it for typos and make sure you're online.");
  }
  if (!res.ok) throw new Error(await describeAgentError(res));
  return true;
}

// When the saved URL 404s, the function exists under a different name — scan
// the same project for it. Supabase's gateway answers 404 (with CORS) for names
// that don't exist, and anything else for ones that do, so a tiny POST per
// candidate tells them apart. Returns the working URL or null.
const FN_CANDIDATES = [
  "quick-api", "voice-agent", "voice_agent", "voiceagent", "voice",
  "agent", "assistant", "claude", "smart-api", "hello-world", "rapid-api", "super-api",
];
export async function findAgentFunction() {
  const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
  const m = url.match(/^(https?:\/\/[^/]+\/functions\/v1)(?:\/|$)/);
  if (!m) return null;
  const base = m[1];
  const current = url.slice(base.length).replace(/^\//, "");
  for (const name of FN_CANDIDATES) {
    if (name === current) continue;
    try {
      const res = await fetch(`${base}/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}", // our function answers 400 "No messages" — cheap, no Claude call
      });
      if (res.status !== 404) return `${base}/${name}`;
    } catch { /* network/CORS — can't tell, keep scanning */ }
  }
  return null;
}

// ---- Entity resolution ----
// A phone number spoken out loud can arrive in any shape. Strip it to digits
// and see whether there are enough of them to be a number.
function asPhone(q) {
  const digits = String(q || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

// The standing instructions, one rule per line.
function standingRules() {
  return String(store.getSettings().agentNotes || "").split("\n").map((r) => r.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
}

function findLead(name) {
  if (!name) return null;
  const q = String(name).trim().toLowerCase();
  // "text 226-246-7202 that his car is ready" is an ordinary instruction, and
  // matching on names alone meant the agent came back asking who that was.
  const phone = asPhone(q);
  if (phone) {
    const byPhone = store.leadByPhone(phone);
    if (byPhone) return byPhone;
  }
  const leads = store.all("leads");
  return (
    leads.find((l) => (l.name || "").toLowerCase() === q) ||
    leads.find((l) => (l.name || "").toLowerCase().includes(q)) ||
    leads.find((l) => l.name && q.includes((l.name || "").toLowerCase())) || null
  );
}
function findAppt(customer) {
  const q = String(customer || "").trim().toLowerCase();
  const appts = store.all("appointments").filter((a) => a.status !== "canceled" && (a.customerName || "").toLowerCase().includes(q));
  if (!appts.length) return null;
  const now = Date.now();
  appts.sort((a, b) => Math.abs(new Date(a.when) - now) - Math.abs(new Date(b.when) - now));
  return appts[0];
}
const num = (v) => (v == null || v === "" ? null : Number(String(v).replace(/[^0-9.\-]/g, "")) || null);
// Equity via the shared resolver: a customer whose trade simply hasn't been
// appraised must read as unknown, never as "negative the entire payoff".
const equityOf = (l) => equityDetail(l).v;

/**
 * Say why the radar came back empty, from what was actually counted.
 *
 * The old messages asserted causes nobody had checked — "your customers don't
 * have payment details captured yet" was told to a salesperson who had just
 * imported a customer file, and was both wrong and the app's own fault. A
 * message that names a cause has to have measured it; otherwise it sends
 * someone off fixing the wrong thing, and it costs them trust in every other
 * number the app shows them.
 */
function emptyReason({ skipped, want, vehicle, cheaperOnly, cap }) {
  const total = store.all("leads").length;
  if (!total) return "there are no customers on file yet";
  if (want && skipped.noVehicle && !skipped.noOptions)
    return `${skipped.noVehicle} customer${skipped.noVehicle === 1 ? " was" : "s were"} priced, but none against a ${vehicle} — check that model is in stock or in the Nissan lineup`;
  if (want && skipped.noOptions === total)
    return "nothing could be priced at all — there's no inventory loaded and no lineup to fall back on";
  const bits = [];
  if (skipped.notCheaper) bits.push(`${skipped.notCheaper} priced above what they pay now`);
  if (skipped.overCap) bits.push(`${skipped.overCap} over the $${cap}/mo cap`);
  if (skipped.noBaseline) bits.push(`${skipped.noBaseline} with no current payment on file to compare against`);
  if (skipped.noOptions) bits.push(`${skipped.noOptions} with nothing to price against`);
  if (skipped.closed) bits.push(`${skipped.closed} already sold or lost`);
  if (bits.length) return `no matches — ${bits.join(", ")}`;
  return cheaperOnly ? "nobody prices below what they pay today" : "no matches";
}

// Does this vehicle answer to what was asked for? Every spoken word has to
// appear somewhere in the vehicle, so "Sentra" and "2026 Nissan Sentra SV" both
// match a Sentra, and "Rogue" never does.
function matchesVehicle(v, want) {
  if (!want) return true;
  const hay = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ").toLowerCase();
  return want.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

const ROUTES = {
  home: "/", dashboard: "/", leads: "/leads", customers: "/leads", inventory: "/inventory",
  calculator: "/calculator", deliveries: "/deliveries", calendar: "/calendar", schedule: "/calendar",
  goals: "/", target: "/", radar: "/deals", deals: "/deals", prospecting: "/log", tools: "/tools", today: "/log", log: "/log", logbook: "/log", queue: "/log", todos: "/log", tasks: "/log", outreach: "/leads",
  comms: "/comms", communication: "/comms", messages: "/comms",
  soldlog: "/soldlog", sold: "/soldlog", tracker: "/soldlog",
  coach: "/coach",
  pay: "/pay", paycheck: "/pay", paychecks: "/pay",
  spiffs: "/spiffs", specials: "/specials", compare: "/compare", import: "/import", settings: "/settings",
};

// Run one tool. Returns { result, note } — `result` is what Claude sees (data
// object for reads, a short confirmation string for writes); `note` is a
// human-facing action summary (⚠ prefix = failure), or "" for silent reads.
// Async because a few tools (send_email) do real network work. Exported so
// tests can exercise every tool without a live Claude relay.
// ---- Undo ----
//
// Every change the assistant makes can be put back. That's what lets it act
// on a sentence instead of checking first: a wrong guess is one tap, not a
// mess. The mechanism is a snapshot rather than per-tool bookkeeping — the
// collections a write can touch are copied before it runs and compared after,
// so a tool that creates a customer AND starts their plan AND logs them is
// one entry that puts all three back, whatever the tool happened to do.
const UNDO_COLLECTIONS = ["leads", "tasks", "appointments", "sales", "specials", "spifs", "deliveries", "activity"];
// Settings the tools can change — a standing rule lives here, not in a
// collection — snapshotted the same way.
const UNDO_SETTINGS = ["agentNotes"];
const WRITE_TOOLS = /^(create_lead|update_lead|add_context|add_note|note|add_task|complete_task|finish_task|complete_delivery|mark_delivered|add_special|add_spif|log_spif|log_sale|undo_sale|book_appointment|schedule_appointment|appointment_outcome|set_outcome|start_cadence|start_followup|delete_customer|remove_customer|delete_lead|remember_rule|forget_rule)$/;
const undoStack = [];
function snapshotRecords() {
  const snap = new Map();
  UNDO_COLLECTIONS.forEach((c) => snap.set(c, new Map(store.all(c).map((r) => [r.id, JSON.stringify(r)]))));
  snap.set("__settings", new Map(UNDO_SETTINGS.map((k) => [k, JSON.stringify(store.getSettings()[k] ?? "")])));
  return snap;
}
// What changed since the snapshot, as the moves that put it back — or null
// when nothing did (a tool that only looked, or refused).
function diffSince(before) {
  const moves = [];
  const was = before.get("__settings");
  UNDO_SETTINGS.forEach((k) => { const now = JSON.stringify(store.getSettings()[k] ?? ""); if (was && was.get(k) !== now) moves.push({ setting: k, value: JSON.parse(was.get(k)) }); });
  UNDO_COLLECTIONS.forEach((c) => {
    const was = before.get(c);
    const now = new Map(store.all(c).map((r) => [r.id, JSON.stringify(r)]));
    now.forEach((json, id) => {
      if (!was.has(id)) moves.push({ c, id, remove: true });
      else if (was.get(id) !== json) moves.push({ c, id, put: JSON.parse(was.get(id)) });
    });
    was.forEach((json, id) => { if (!now.has(id)) moves.push({ c, id, put: JSON.parse(json) }); });
  });
  return moves.length ? moves : null;
}
function applyMoves(moves) {
  store.bulk(() => {
    moves.forEach((m) => {
      if (m.setting) { store.updateSettings({ [m.setting]: m.value }); return; }
      if (m.remove) { store.remove(m.c, m.id); return; }
      // Whole record back, not a merge: a field the change added has to go.
      store.remove(m.c, m.id);
      store.restore(m.c, m.put);
    });
  });
}
// Reverse the newest change. Returns what it was, or null with nothing to undo.
export function undoLast() {
  const u = undoStack.pop();
  if (!u) return null;
  applyMoves(u.moves);
  return u.label;
}
export function lastUndoable() { return undoStack.length ? undoStack[undoStack.length - 1].label : null; }

export async function execTool(name, p = {}) {
  const t = (name || "").toLowerCase();
  if (t === "undo_last" || t === "undo") {
    const label = undoLast();
    return label ? { result: `undone: ${label}. Say so in a few words; if they said what they meant instead, do that now.`, note: `undid: ${label}` } : { result: "nothing to undo", note: "" };
  }
  if (!WRITE_TOOLS.test(t)) return runTool(t, p);
  const before = snapshotRecords();
  const out = await runTool(t, p);
  const moves = diffSince(before);
  if (moves) undoStack.push({ label: String(out.note || t).replace(/^⚠\s*/, ""), moves, at: Date.now() });
  return out;
}

async function runTool(t, p = {}) {
  // The tools that read the radar wait for it to be current — a slice at a
  // time, so the panel keeps answering — instead of computing it in one go.
  if (/^(find_customers|get_customer|deal_radar|deal_options|get_prospects|work_the_book|get_plays)$/.test(t)) { try { await warmRadar(); } catch { /* priced on demand below */ } }
  switch (t) {
    // ---- READS ----
    //
    // A read that produces a LIST of things to act on also puts that list on
    // screen. Reading three names aloud and stopping there is the assistant
    // doing the easy half: the salesperson then has to go and find those three
    // people themselves, which is the work they asked to be saved.
    //
    // So each of these lands on the screen where its rows are already tappable
    // — the queue on Home, the leads list filtered, the calendar — and scrolls
    // to it. Nothing new is rendered; these screens already have the one-tap
    // text and call buttons on every row.
    case "find_customers": {
      let list = store.all("leads");
      const q = (p.query || "").toLowerCase();
      if (q) list = list.filter((l) => (l.name || "").toLowerCase().includes(q) || (l.vehicleInterest || "").toLowerCase().includes(q));
      if (p.stage) list = list.filter((l) => l.stage === p.stage);
      if (p.needsFollowUp) list = list.filter((l) => l.followUp);
      if (p.hasEquity) list = list.filter((l) => (equityOf(l) || 0) > 0);
      // Best candidates first, each with why — the same order as the Leads page.
      const rank = assessAll().byId;
      const sc = (l) => { const a = rank.get(l.id); return a ? a.score : 0; };
      list = list.slice().sort((a, b) => sc(b) - sc(a));
      const customers = list.slice(0, 15).map((l) => { const a = rank.get(l.id); return { name: l.name, phone: l.phone || "", stage: l.stage, vehicle: l.vehicleInterest || "", payment: l.currentPayment ?? null, equity: equityOf(l), followUp: l.followUp || null, score: a ? a.score : 0, why: a ? a.reasons : [] }; });
      // Show the same set on the leads list. It already has these filters, so
      // the screen matches the answer instead of being a different list that
      // happens to contain it.
      if (list.length) {
        try {
          sessionStorage.setItem("leads-filter", p.needsFollowUp ? "due" : "all");
          if (p.query) sessionStorage.setItem("leads-search", p.query);
        } catch { }
        navigate("/leads");
      }
      return { result: { count: list.length, customers }, note: "" };
    }
    case "get_customer": {
      const l = findLead(p.name || p.customer);
      if (!l) return { result: { found: false }, note: "" };
      const a = assessment(l.id);
      const st = standingWith(l.id);
      await loadBodies(l.id).catch(() => {});
      return { result: { found: true, name: l.name, phone: l.phone || "", email: l.email || "", stage: l.stage, vehicle: l.vehicleInterest || "", payment: l.currentPayment ?? null, payoff: l.payoff ?? null, value: l.currentValue ?? null, equity: equityOf(l), apr: l.currentApr ?? null, followUp: l.followUp || null, leaseEnd: l.leaseEnd || null,
        lastContacted: l.lastContacted || null,
        profile: l.profile || {}, notes: l.notes || "",
        // The read of them: how strong a candidate, why, and the next move.
        assessment: a ? { score: a.score, tier: a.tier ? a.tier.label : "no reason yet", why: a.why, next: a.next ? a.next.label : "" } : null,
        // What's been said, oldest first, and whether they're waiting on us.
        conversation: transcript(conversationFor(l.id, { limit: 12 }), { name: l.name }),
        waitingOnMe: st.waitingOnMe }, note: "" };
    }
    case "get_messages": case "recent_messages": case "get_conversation": {
      const kinds = p.kind ? [p.kind] : ["text", "email", "call"];
      if (p.customer || p.name) {
        const l = findLead(p.customer || p.name);
        if (!l) return { result: { found: false }, note: `⚠ couldn't find ${p.customer || p.name}` };
        if (kinds.includes("email")) await loadBodies(l.id).catch(() => {});
        const items = conversationFor(l.id, { kinds, limit: 25 });
        const st = standingWith(l.id);
        // The thread when they've been texting, their page otherwise.
        navigate(items.some((i) => i.kind === "text") ? `/inbox/${l.id}` : `/leads/${l.id}`);
        return { result: { customer: l.name, messages: transcript(items, { name: l.name, maxChars: 600 }), waitingOnMe: st.waitingOnMe,
          note: items.length ? "oldest first" : `nothing on file with ${l.name} yet` }, note: "" };
      }
      const rows = recentInbound({ hours: p.hours || 48, limit: 15 }).filter((i) => kinds.includes(i.kind));
      if (rows.length) navigate("/comms");
      return { result: { messages: rows.map((i) => ({ when: i.at, from: i.who, customer: i.customer, by: i.kind, subject: i.subject || undefined, text: i.text.slice(0, 400), answered: i.answered })),
        note: rows.length ? "newest first; answered:false means they're waiting on a reply" : "nothing has come in" }, note: "" };
    }
    case "get_appointments": {
      let list = store.all("appointments").filter((a) => a.status !== "canceled");
      if (p.date) list = list.filter((a) => String(a.when).slice(0, 10) === p.date);
      list = list.sort((a, b) => String(a.when).localeCompare(String(b.when))).slice(0, 25);
      if (list.length) navigate("/calendar");
      return { result: { appointments: list.map((a) => ({ customer: a.customerName, when: a.when, type: a.type, confirmed: !!a.confirmed, outcome: a.outcome || "" })) }, note: "" };
    }
    case "deal_radar": {
      // "Who can I get into something for LESS than they're paying now" is not
      // the radar's usual question, and running it through the usual machinery
      // gets the wrong answer for a subtle reason.
      //
      // dealsForLead ranks a customer's options by |delta| — closest to the
      // payment they already have. That's right for "what can they afford":
      // it finds the most car for the money they're already spending. But it
      // means each customer's "best" match is the payment-NEUTRAL one, which
      // is precisely the row that can't show a saving. Filtering those for
      // delta < 0 tests the wrong option and misses everyone whose cheapest
      // match would genuinely save them money.
      //
      // So when the ask is about saving, look at each customer's CHEAPEST
      // viable option instead, and rank by how much they'd save.
      const cap = Number(p.maxMonthly) || 0;
      // "Which customers can be put in a Nissan Sentra right now" is the radar
      // run the other way round — from a vehicle to the people who fit it —
      // and there was no way to ask it. It is one of the most ordinary
      // questions on a lot: a unit is aging, or a model is on program, and you
      // want the names.
      const want = String(p.vehicle || "").trim().toLowerCase();
      let rows;
      // Why each customer fell out. An empty answer that guesses at its own
      // cause is worse than one that says nothing: it sends the salesperson off
      // fixing whatever was guessed at. The /deals screen already reports these
      // counts honestly; this tool was inventing a reason instead.
      const skipped = { noBaseline: 0, noOptions: 0, noVehicle: 0, overCap: 0, notCheaper: 0, closed: 0 };
      if (p.cheaperOnly || want) {
        const method = store.getSettings().dealMethod || "both";
        rows = [];
        store.all("leads").forEach((l) => {
          // A baseline is needed to BEAT a payment, not to quote one. "Who can
          // get in a Sentra right now" can be answered for anybody the app can
          // price — and after a plain customer import, that is everybody,
          // because a name and a phone number are all such a file carries.
          // Requiring a current payment here answered a freshly imported book
          // of business with "nobody", and then blamed the file for it.
          if (p.cheaperOnly && l.currentPayment == null) { skipped.noBaseline++; return; }
          if (["sold", "delivered", "lost"].includes(l.stage)) { skipped.closed++; return; }
          let options = dealsForLead(l, { method });
          if (!options.length) { skipped.noOptions++; return; }
          if (want) {
            options = options.filter((o) => matchesVehicle(o.vehicle, want));
            if (!options.length) { skipped.noVehicle++; return; }
          }
          // What their equity is worth, and so what a deal spends when it puts
          // the trade in.
          const eq = Math.max(0, Number(equityOf(l)) || 0);
          // Ranking on the headline payment alone hands the top spot to
          // whichever option consumes the most equity, and that is almost
          // always a lease. $15,000 of trade equity poured into a 48-month
          // lease buys a $117/mo payment and a car they hand back owning
          // nothing — the biggest saving on the sheet and the worst advice on
          // it. Financed, the same equity survives as ownership in the new
          // vehicle; leased, it is simply spent.
          //
          // So a lease carries the equity it burns, amortised over its own
          // term, and the ranking compares like with like.
          const cost = (o) => o.monthly + (o.method === "lease" && o.term > 0 ? eq / o.term : 0);
          const cheapest = options.reduce((a, b) => (cost(b) < cost(a) ? b : a));
          if (cap && cheapest.monthly > cap) { skipped.overCap++; return; }
          // Only gate on beating today's payment when that was the question.
          // "Who could go into a Sentra" is not asking who saves money.
          if (p.cheaperOnly && !(cheapest.monthly < l.currentPayment)) { skipped.notCheaper++; return; }
          const saving = l.currentPayment != null ? Math.round(l.currentPayment - cheapest.monthly) : null;
          const burns = cheapest.method === "lease" && eq > 0;
          rows.push({
            lead: l, best: cheapest,
            equityUsed: Math.round(eq),
            effectiveMonthly: Math.round(cost(cheapest)),
            reasons: (saving > 0 ? [`Saves $${saving}/mo`] : saving != null ? [`$${Math.abs(saving)}/mo more than now`] : [`$${Math.round(cheapest.monthly)}/mo — no current payment on file to compare`])
              .concat(eq > 0 ? [`$${Math.round(eq).toLocaleString()} equity`] : [])
              // Said plainly, because this is the sentence that stops a number
              // being quoted that would have to be walked back at the desk.
              .concat(burns ? [`Lease — spends their $${Math.round(eq).toLocaleString()} equity, nothing owned at the end`] : []),
          });
        });
        // Cheapest by TRUE cost, so an equity-funded lease can't outrank a
        // finance deal that reaches a similar payment and keeps the equity.
        //
        // Anyone we can show a saving to leads, because "you'd pay less than
        // you do now" is a call you can make today. Everyone else follows on
        // payment alone — still worth ringing about a Sentra, just without a
        // number to open with.
        const savesBy = (o) => (o.lead.currentPayment != null ? o.lead.currentPayment - o.best.monthly : null);
        rows.sort((a, b) => {
          const sa = savesBy(a), sb = savesBy(b);
          if ((sa > 0) !== (sb > 0)) return sa > 0 ? -1 : 1;
          if (sa > 0 && sb > 0) return a.effectiveMonthly - b.effectiveMonthly;
          return a.best.monthly - b.best.monthly;
        });
      } else {
        rows = topOpportunities(Number(p.limit) || 8);
        if (cap) rows = rows.filter((o) => o.best.monthly <= cap);
      }
      const opps = rows.slice(0, Number(p.limit) || 8).map((o) => ({
        customer: o.lead.name, phone: o.lead.phone || "", pays: o.lead.currentPayment ?? null,
        vehicle: [o.best.vehicle.year, o.best.vehicle.make, o.best.vehicle.model].filter(Boolean).join(" "),
        monthly: Math.round(o.best.monthly), delta: o.best.delta != null ? Math.round(o.best.delta) : null,
        saves: o.best.delta != null && o.best.delta < 0 ? Math.abs(Math.round(o.best.delta)) : null,
        // What the saving actually costs. A lease funded by the trade shows a
        // small payment and a large equityUsed; without both numbers the model
        // reads back a headline that isn't the whole deal.
        equityUsed: o.equityUsed ?? null,
        trueMonthly: o.effectiveMonthly ?? null,
        method: o.best.method, reasons: o.reasons,
      }));
      if (opps.length) navigate("/deals");
      return {
        result: {
          opportunities: opps,
          note: opps.length ? "" : emptyReason({ skipped, want, vehicle: p.vehicle, cheaperOnly: p.cheaperOnly, cap }),
        },
        note: "",
      };
    }
    case "get_stats": {
      const f = apptFunnel(); const m = monthSummary(); const s = store.getSettings();
      return { result: { appointmentsSet: f.set, confirmed: f.confirmed, showed: f.showed, sold: f.sold, showRate: `${f.showRate}%`, appointmentToSold: `${f.closeRate}%`, unitsSold: m.units, commission: m.commission, goalAppointments: s.goalAppointments, goalUnits: s.goalUnits }, note: "" };
    }
    case "get_tasks": {
      let list = store.all("tasks").filter((x) => !x.done);
      if (p.dueToday) {
        const today = new Date(); const pad2 = (n) => String(n).padStart(2, "0");
        const iso = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
        list = list.filter((x) => x.due && String(x.due).slice(0, 10) <= iso);
      }
      list.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
      if (list.length) { try { sessionStorage.setItem("viniva:log:open", "todos"); } catch { /* the queue, then */ } navigate("/log", ".tasks-slot"); }
      return { result: { count: list.length, tasks: list.slice(0, 20).map((x) => ({ title: x.title, due: x.due || null, priority: x.priority || "normal" })) }, note: "" };
    }
    case "get_deliveries": {
      const list = store.all("deliveries").filter((d) => d.status !== "delivered")
        .sort((a, b) => (a.deliveryDate || "9999").localeCompare(b.deliveryDate || "9999"));
      if (list.length) navigate("/deliveries");
      return { result: { count: list.length, deliveries: list.slice(0, 15).map((d) => {
        const items = d.checklist || [];
        return { customer: d.customerName || "", vehicle: d.vehicle || "", date: d.deliveryDate || null, prepDone: `${items.filter((i) => i.done).length}/${items.length}`, remaining: items.filter((i) => !i.done).map((i) => i.label).slice(0, 10) };
      }) }, note: "" };
    }
    case "when_it_makes_sense": case "timing": case "when": {
      const s = store.getSettings();
      const lot = store.all("vehicles");
      const hopts = { now: new Date(), defaultApr: s.defaultApr, dealMatchBand: s.dealMatchBand, match: lot.length ? makeMatcher(lot, s) : null };
      const slim = (r) => ({ customer: r.lead.name, vehicle: r.lead.vehicleInterest || "", month: r.hz.m === 0 ? "now" : r.hz.at ? monthLabel(r.hz.at) : "unknown", monthsAway: r.hz.m, why: r.hz.why, equityNow: r.hz.equityNow, followUp: r.lead.followUp || null });
      if (p.customer) {
        const l = findLead(p.customer);
        if (!l) return { result: { found: false }, note: "" };
        const hz = horizonFor(l, hopts);
        if (!hz) return { result: { found: true, customer: l.name, applies: false, note: "not an owner on file, or lost / just bought" }, note: "" };
        try { sessionStorage.setItem("horizon-tab", "timing"); } catch { /* fine */ }
        navigate("/horizon");
        return { result: { found: true, ...slim({ lead: l, hz }), lease: hz.lease, paymentsLeft: hz.left, contractEnds: hz.end ? monthLabel(hz.end) : null, suggestedFollowUp: followUpFor(hz) }, note: `timing ${l.name}` };
      }
      const months = Number(p.months) || 6;
      const rows = horizonBook(store.all("leads"), hopts);
      const within = rows.filter((r) => r.hz.m != null && r.hz.m <= months);
      try { sessionStorage.setItem("horizon-tab", "timing"); } catch { /* fine */ }
      navigate("/horizon");
      return { result: { readyNow: rows.filter((r) => r.hz.m === 0).length, openingWithin: months, count: within.length, customers: within.slice(0, 12).map(slim) }, note: "reading the book for timing" };
    }
    case "lease_ends": case "leases": {
      const months = Number(p.months) || 12;
      const now = Date.now();
      const list = contractsEnding(store.all("leads"), { now, type: "lease" });
      const soon = list.filter((r) => !r.end || r.end.getTime() - now <= months * 30.44 * 86400000);
      try { sessionStorage.setItem("horizon-tab", "leases"); } catch { /* fine */ }
      navigate("/horizon");
      return { result: { leasesOnBook: list.length, endingWithin: months, count: soon.length, leases: soon.slice(0, 15).map((r) => ({ customer: r.lead.name, vehicle: r.lead.vehicleInterest || "", ends: r.end ? r.end.toISOString().slice(0, 10) : null, monthsLeft: r.left, past: r.past, payment: r.payment })) }, note: "listing the leases" };
    }
    case "get_occasions": {
      const occ = getOccasions().slice(0, 12).map((o) => ({ customer: o.lead.name, phone: o.lead.phone || "", occasion: o.label, suggestedMessage: o.message }));
      if (occ.length) navigate("/comms");
      return { result: { occasions: occ }, note: "" };
    }
    case "get_specials": {
      const today = new Date().toISOString().slice(0, 10);
      const list = store.all("specials").filter((x) => !x.expiry || x.expiry >= today);
      return { result: { specials: list.map((x) => ({ model: x.model, financeApr: x.financeApr ?? null, financeTerm: x.financeTerm ?? null, leasePayment: x.leasePayment ?? null, leaseTerm: x.leaseTerm ?? null, leaseDown: x.leaseDown ?? null, cash: x.cash ?? null, expires: x.expiry || null, notes: x.notes || "" })) }, note: "" };
    }
    case "get_spiffs": {
      const today = new Date().toISOString().slice(0, 10); const mo = today.slice(0, 7);
      const list = store.all("spifs").filter((x) => (x.expiry ? x.expiry >= today : (x.month || mo) === mo));
      return { result: { spiffs: list.map((x) => ({ title: x.title, amount: x.amount ?? null, countsWhenVehicleContains: x.match || null, target: x.target ?? null, expires: x.expiry || null, notes: x.notes || "" })) }, note: "" };
    }
    case "payment_quote": case "quote_payment": {
      const price = num(p.price);
      if (!price) return { result: "need a price", note: "" };
      const s = store.getSettings();
      const apr = p.apr != null ? Number(p.apr) : (s.defaultApr || 0);
      const term = p.term != null ? Number(p.term) : (s.defaultTerm || 72);
      const d = computeDeal({ price, down: num(p.down) || 0, tradeAllowance: num(p.trade) || 0, tradePayoff: num(p.payoff) || 0, fees: p.fees != null ? num(p.fees) : (s.docFee || 0), taxRate: p.taxRate != null ? Number(p.taxRate) : (s.taxRate || 0), apr, term });
      return { result: { monthly: Math.round(d.monthly), amountFinanced: Math.round(d.amountFinanced), tax: Math.round(d.tax), term: d.term, aprUsed: apr, assumptions: "salesperson's saved tax rate/doc fee/APR/term fill in anything not stated" }, note: "" };
    }
    case "deal_options": case "match_deals": {
      const lead = findLead(p.customer || p.name);
      if (!lead) return { result: "not found", note: "" };
      // One row per vehicle, its closest-to-their-payment option: the
      // list underneath has every term and lease for each unit, and five
      // of the same Kicks is not five options.
      const seen = new Set(), rows = [];
      for (const r of dealsForLead(lead)) {
        const v = r.vehicle, key = `${v.year}|${v.make}|${v.model}|${v.trim || ""}|${v.condition || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ vehicle: [v.year, v.make, v.model, v.trim].filter(Boolean).join(" "), monthly: Math.round(r.monthly), delta: r.delta != null ? Math.round(r.delta) : null, method: r.method, special: r.special || null, inStock: !v.lineup });
        if (rows.length >= 5) break;
      }
      return { result: { customer: lead.name, currentPayment: lead.currentPayment ?? null, options: rows }, note: "" };
    }
    case "get_nudges": {
      const list = getNudges({ limit: 6 }).map((n) => ({ what: n.title, why: n.sub, urgency: n.urgency }));
      if (list.length) navigate("/", ".nudge-slot");
      return { result: { urgent: list, note: list.length ? "most urgent first" : "nothing time-critical right now" }, note: "" };
    }
    case "get_prospects": case "work_the_book": {
      const rows = getProspects().map((c) => ({
        customer: c.lead.name, drives: c.lead.vehicleInterest || "", reasons: c.reasons,
        pitch: c.best && c.best.vehicle ? [c.best.vehicle.year, c.best.vehicle.make, c.best.vehicle.model, c.best.vehicle.trim].filter(Boolean).join(" ") : "",
        canText: !!c.lead.phone,
      }));
      const stats = prospectStats();
      if (rows.length) { try { sessionStorage.setItem("viniva:log:open", "queue"); } catch { /* fine */ } navigate("/log", ".plays-slot"); }
      return { result: { prospects: rows, note: rows.length
        ? `today's ${rows.length}, best first — each on Log with a Review button that drafts the opener; ${stats.eligibleNow} more in the book with a reason`
        : (stats.withReason ? "everyone with a reason has been reached or surfaced recently — tomorrow brings the next handful" : "nobody on file has enough data to price a deal — import an equity export") }, note: "" };
    }
    case "get_plays": {
      const plays = getPlays(6).map((p) => ({ play: p.title, why: p.sub, oneTapReady: !!p.href }));
      // Today's queue lives most of a page down Home — land on it, not above it.
      if (plays.length) { try { sessionStorage.setItem("viniva:log:open", "queue"); } catch { /* fine */ } navigate("/log", ".plays-slot"); }
      return { result: { plays, note: plays.length ? "ordered hottest first" : "nothing urgent — a good time for prospecting calls" }, note: "" };
    }
    case "get_coach": case "weekly_review": {
      const mon = weekStart();
      const weeks = Array.from({ length: 8 }, (_, i) => {
        const d = new Date(mon); d.setDate(d.getDate() - 7 * i);
        return weekStats(d);
      });
      const brief = (w) => ({ units: w.units, commission: Math.round(w.total), front: Math.round(w.front), backOffice: Math.round(w.bo), apptsSet: w.apptsSet, showRate: w.showRate, newLeads: w.leadsNew, touches: w.touches, linkOpens: w.linksOpened });
      return { result: {
        thisWeek: brief(weeks[0]), lastWeek: brief(weeks[1]),
        insights: coachInsights(weeks, { current: true }).map((i) => i.text),
      }, note: "" };
    }
    case "sales_target": case "get_target": {
      const t = salesTarget();
      const pc = (v) => (v == null ? null : Math.round(v * 100));
      navigate("/performance");
      return { result: {
        month: t.mKey, targetNew: t.plan.targetNew, targetUsed: t.plan.targetUsed, target: t.plan.target,
        closingRatioExpectedPct: pc(t.plan.closingNew), customersToSpeakWith: t.plan.need, customersToSpeakWithNew: t.plan.needNew, customersToSpeakWithUsed: t.plan.needUsed,
        spokenWith: t.spoke, spokenWithNew: t.spokeNew, spokenWithUsed: t.spokeUsed, sold: t.sold, soldNew: t.soldNew, soldUsed: t.soldUsed,
        actualClosingPct: pc(t.closing), remainingUnits: t.remainingUnits, conversationsRemaining: t.remainingTalks, targetAttainmentPct: pc(t.attainment),
        dayOfMonth: t.day, daysInMonth: t.daysIn, behindPaceBy: Math.max(0, t.expectedByNow - t.spoke), week: t.week, weeks: t.weeks, thisWeekSpokenWith: t.spokeWeek, thisWeekShare: t.perWeek, appointmentsSet: t.appts,
      }, note: t.plan.target ? `${t.sold} of ${t.plan.target} sold, ${t.spoke} of ${t.plan.need} customers spoken with` : "no target set yet — Set your target on Home" };
    }
    case "get_link_activity": {
      const links = store.all("links")
        .slice()
        .sort((a, b) => (b.lastOpenAt || b.createdAt || "").localeCompare(a.lastOpenAt || a.createdAt || ""))
        .slice(0, 10)
        .map((lk) => ({
          link: (lk.meta && lk.meta.label) || (lk.kind === "book" ? "Booking link" : "Comparison"),
          opens: Number(lk.opens) || 0,
          lastOpened: lk.lastOpenAt || null,
          sent: lk.createdAt || null,
        }));
      return { result: { links, note: "opens sync in from the cloud — a very recent open is a hot signal" }, note: "" };
    }
    case "get_booking_link": {
      try {
        if (!backend.currentUser()) return { result: "booking links need Cloud sync — the salesperson should sign in under Settings", note: "" };
        if (!(store.getSettings().agentUrl || "").trim()) return { result: "booking links need the agent function set up in Settings", note: "" };
        return { result: { link: cachedShortBookingLink() || bookingLink() }, note: "" };
      } catch (e) {
        return { result: `booking link unavailable: ${e && e.message ? e.message : e}`, note: "" };
      }
    }

    // ---- WRITES ----
    case "open_page": case "navigate": {
      const route = ROUTES[String(p.page || p.route || "").toLowerCase()] || (String(p.route || "").startsWith("/") ? p.route : null);
      if (!route) return { result: "no such page", note: "⚠ couldn't find that page" };
      navigate(route);
      return { result: `opened the ${route} screen — nothing else was done; the salesperson can see it`, note: `opened ${route}` };
    }
    case "create_lead": {
      if (!p.name) return { result: "need a name", note: "⚠ need a name for the lead" };
      // Every customer added gets a phone number — the follow-up plan, the
      // texts and the calls all need one. Not said? Ask, then come back.
      if (!asPhone(p.phone) && !p.noPhone) {
        return { result: `Not added yet: ${p.name} needs a phone number. Ask the salesperson for it with ask_user, then call create_lead again with the same details plus \`phone\`. Only if they say they don't have one, call again with noPhone: true.`, note: `asking for ${p.name}'s number` };
      }
      // New or used: said outright, or read off the vehicle (a 2026 is new).
      const shopping = /^(new|used)$/i.test(String(p.newUsed || "")) ? (String(p.newUsed).toLowerCase() === "new" ? "New" : "Used") : inferShopping(`${p.vehicle || ""} ${p.notes || p.note || ""}`);
      const lead = store.create("leads", { name: p.name, vehicleInterest: p.vehicle || "", phone: asPhone(p.phone) || "", email: p.email || "", stage: "new", source: "Voice", followUp: p.followUp || null, notes: "", shopping });
      // Everything else said about them, structured where it can be and kept
      // whole in the notes either way.
      addContext(lead.id, { ...p, note: p.notes || p.note || "" });
      // Telling the app about a customer puts them in the log — the
      // conversation the sales target counts, no second step.
      logCustomer(lead.id);
      const n = maybeStartCadence(lead.id);
      const plan = n ? ` Follow-up plan started automatically: ${n} touches over 90 days, each text drafted from their context and held for the salesperson's OK — nothing sends on its own. Their welcome text is drafted and under "Right now" on Home, locked for five minutes so it doesn't land on their heels${lead.phone ? "" : " (and it needs their phone number to send)"}.` : "";
      return { result: `created lead ${lead.name}.${plan}`, note: `added ${lead.name}${n ? ` — ${n}-step follow-up plan started` : ""}` };
    }
    case "update_lead": {
      const lead = findLead(p.name || p.customer);
      if (!lead) return { result: "not found", note: `⚠ couldn't find ${p.name || p.customer}` };
      const patch = {};
      ["phone", "email", "stage", "followUp"].forEach((k) => { if (p[k] != null && p[k] !== "") patch[k] = p[k]; });
      if (p.vehicle) patch.vehicleInterest = p.vehicle;
      store.update("leads", lead.id, patch);
      // Anything learned about them is context, never an overwrite of the notes.
      const ctx = addContext(lead.id, { ...p, vehicle: null, note: p.notes || p.note || "" });
      // Stage changes ripple: sold sets up delivery prep + retires follow-ups,
      // lost just retires them.
      if (patch.stage === "sold") afterSale(lead.id, { vehicle: p.vehicle || "" });
      else if (patch.stage === "lost") closeFollowUps(lead.id);
      const learned = ctx && ctx.changed.length ? ` Noted: ${ctx.changed.join(", ")}.` : "";
      return { result: `updated ${lead.name}.${learned}`, note: `updated ${lead.name}` };
    }
    case "add_context": case "add_note": case "note": {
      const lead = findLead(p.customer || p.name);
      if (!lead) return { result: "not found", note: `⚠ couldn't find ${p.customer || p.name}` };
      const r = addContext(lead.id, { ...p, note: p.notes || p.note || "" });
      // Context on someone who was never worked is a reason to start.
      const started = ["new", "working"].includes(lead.stage) ? maybeStartCadence(lead.id) : 0;
      const what = r && r.changed.length ? r.changed.join(", ") : "nothing new";
      return {
        result: `noted for ${lead.name}: ${what}.${started ? ` Follow-up plan started (${started} touches); first text waiting on Log.` : ""} ${planSummary(lead.id)}`.trim(),
        note: `noted for ${lead.name}`,
      };
    }
    case "add_task": {
      if (!p.title) return { result: "need a task", note: "⚠ need a task" };
      store.create("tasks", { title: p.title, due: p.due || "", priority: p.priority || "normal", done: false });
      return { result: `added task`, note: `added to-do: ${p.title}` };
    }
    case "complete_task": case "finish_task": {
      const ql = String(p.title || "").trim().toLowerCase();
      if (!ql) return { result: "which to-do?", note: "" };
      const open = store.all("tasks").filter((x) => !x.done);
      const titleOf = (x) => (x.title || "").toLowerCase();
      // Spoken references are loose ("the plates thing") — drop filler words,
      // then match all remaining words, then settle for a unique partial match.
      const STOP = new Set(["the", "that", "this", "thing", "task", "todo", "item", "one", "for", "and", "done", "off", "mark", "with", "about"]);
      const tokens = ql.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
      let hit = open.find((x) => titleOf(x).includes(ql));
      if (!hit && tokens.length) hit = open.find((x) => tokens.every((w) => titleOf(x).includes(w)));
      if (!hit && tokens.length) {
        const partial = open.filter((x) => tokens.some((w) => titleOf(x).includes(w)));
        if (partial.length === 1) hit = partial[0];
      }
      if (!hit) return { result: `no open to-do matching "${p.title}"`, note: `⚠ no to-do matching "${p.title}"` };
      store.update("tasks", hit.id, { done: true });
      return { result: `done: ${hit.title}`, note: `checked off: ${hit.title}` };
    }
    case "complete_delivery": case "mark_delivered": {
      const q = String(p.customer || p.name || "").trim().toLowerCase();
      const d = q ? store.all("deliveries").find((x) => x.status !== "delivered" && (x.customerName || "").toLowerCase().includes(q)) : null;
      if (!d) return { result: "no active delivery found", note: `⚠ no active delivery for ${p.customer || "that customer"}` };
      store.update("deliveries", d.id, { status: "delivered", checklist: (d.checklist || []).map((i) => ({ ...i, done: true })) });
      afterDeliveryComplete(d);
      const dl = d.leadId ? store.get("leads", d.leadId) : findLead(d.customerName);
      if (dl && dl.stage === "sold") store.update("leads", dl.id, { stage: "delivered" });
      return { result: `marked delivered — post-delivery follow-ups queued`, note: `marked ${d.customerName}'s delivery complete` };
    }
    case "text_customer": case "text": {
      const who = p.customer || p.name || p.phone || "";
      const lead = findLead(who);
      // Nobody on file, but a real phone number was given: text it. openText
      // creates the customer record on the way, exactly as an inbound text from
      // a stranger does — the conversation needs somewhere to live either way,
      // and refusing to send until someone types a name is worse than a record
      // briefly named after a phone number.
      if (!lead) {
        const phone = asPhone(who);
        if (phone) {
          if (!openText(phone, String(p.message || "")))
            location.href = smsHref(phone, String(p.message || ""));
          return { result: `opened a text to ${who} with the message in the box — NOT sent; the salesperson reads it and hits send`, note: `texting ${who}` };
        }
        return { result: "not found", note: `⚠ couldn't find ${who}` };
      }
      if (!lead.phone) return { result: `${lead.name} has no phone number on file`, note: `⚠ no phone on file for ${lead.name}` };
      // On a page that stays put, the draft stays there too — with its own
      // Send button — rather than opening the conversation.
      if (staying) return { result: `drafted a text to ${lead.name} — it's on the page with a Send button; NOT sent until the salesperson taps it`, note: `drafted a text to ${lead.name}` };
      // Same destination either way: the conversation when a texting number is
      // set up, the phone's SMS app when it isn't.
      if (!openText(lead.phone, String(p.message || "")))
        location.href = smsHref(lead.phone, String(p.message || ""));
      return { result: `opened a text to ${lead.name} with the message in the box — NOT sent; the salesperson reads it and hits send`, note: `texting ${lead.name}` };
    }
    case "call_customer": case "call": {
      const who = p.customer || p.name || p.phone || "";
      const lead = findLead(who);
      if (!lead) {
        const phone = asPhone(who);
        if (phone) { location.href = telHref(phone); return { result: `dialing ${who}`, note: `calling ${who}` }; }
        return { result: "not found", note: `⚠ couldn't find ${who}` };
      }
      if (!lead.phone) return { result: `${lead.name} has no phone number on file`, note: `⚠ no phone on file for ${lead.name}` };
      location.href = telHref(lead.phone);
      return { result: `dialing ${lead.name}`, note: `calling ${lead.name}` };
    }
    case "send_email": case "email_customer": {
      const lead = findLead(p.customer || p.name);
      if (!lead) return { result: "not found", note: `⚠ couldn't find ${p.customer || p.name}` };
      const to = String(p.to || lead.email || "").trim();
      if (!to) return { result: `${lead.name} has no email on file`, note: `⚠ no email on file for ${lead.name}` };
      if (!p.subject || !p.body) return { result: "need a subject and body", note: "" };
      try {
        await sendEmail({ to, subject: p.subject, text: p.body });
        logEmail(lead.id, { direction: "out", subject: p.subject, body: p.body, via: "voice" });
        return { result: `email sent to ${to}`, note: `emailed ${lead.name}` };
      } catch (e) {
        return { result: `email failed: ${e && e.message ? e.message : e}`, note: `⚠ email failed: ${e && e.message ? e.message : e}` };
      }
    }
    case "add_special": {
      if (!p.model) return { result: "need the model", note: "" };
      store.create("specials", { model: p.model, financeApr: num(p.financeApr), financeTerm: num(p.financeTerm), leasePayment: num(p.leasePayment), leaseTerm: num(p.leaseTerm), leaseDown: num(p.leaseDown), leaseTrim: p.leaseTrim || "", cash: num(p.cash), expiry: p.expiry || "", notes: p.notes || "" });
      return { result: `saved special on ${p.model}`, note: `added special: ${p.model}` };
    }
    case "add_spif": case "log_spif": {
      if (!p.title) return { result: "need the spif", note: "" };
      store.create("spifs", { title: p.title, amount: num(p.amount), match: p.match || "", target: num(p.target), expiry: p.expiry || "", notes: p.notes || "", month: new Date().toISOString().slice(0, 7) });
      return { result: `saved spif`, note: `added spif: ${p.title}` };
    }
    case "log_sale": {
      const name = p.customer || p.name || "Customer";
      // Every sale gets a customer — create one if the name doesn't match.
      const lead = findLead(name) ||
        store.create("leads", { name, vehicleInterest: p.vehicle || "", stage: "sold", source: "Voice", shopping: /^(new|used)$/i.test(String(p.newUsed || "")) ? p.newUsed : inferShopping(p.vehicle) });
      const frontComm = num(p.frontComm), boComm = num(p.boComm);
      const commission = frontComm != null || boComm != null ? (frontComm || 0) + (boComm || 0) : num(p.commission);
      store.create("sales", { customerName: name, vehicle: p.vehicle || "", saleDate: p.date || new Date().toISOString().slice(0, 10), commission, frontGross: num(p.front ?? p.frontGross), backGross: num(p.back ?? p.backGross), leadType: p.leadType || "", newUsed: p.newUsed || "", stock: p.stock || "", bm: p.bm || "", frontComm, boComm, makeReady: {}, leadId: lead.id, notes: "" });
      afterSale(lead.id, { vehicle: p.vehicle || "" });
      return { result: `logged sale`, note: `logged sale for ${name}` };
    }
    case "delete_customer": case "remove_customer": case "delete_lead": {
      const lead = findLead(p.customer || p.name);
      if (!lead) return { result: "not found", note: `⚠ couldn't find ${p.customer || p.name}` };
      const openTasks = store.all("tasks").filter((t) => t.leadId === lead.id && !t.done);
      const upcoming = store.all("appointments").filter((a) => a.leadId === lead.id && a.status !== "canceled" && String(a.when) >= new Date().toISOString().slice(0, 16));
      if (p.confirmed !== true) {
        return { result: `Not deleted. Confirm first with ask_user (options ["Yes, delete ${lead.name.split(" ")[0]}", "No, keep ${lead.name.split(" ")[0]}"]): "Delete ${lead.name} from your customers${openTasks.length || upcoming.length ? `, with ${[openTasks.length ? `${openTasks.length} open follow-up${openTasks.length > 1 ? "s" : ""}` : "", upcoming.length ? `${upcoming.length} upcoming appointment${upcoming.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ")}` : ""}? This can't be undone." Only on a clear yes, call delete_customer again with confirmed: true.`, note: `checking before deleting ${lead.name}` };
      }
      // Gone, with the things that would otherwise keep nagging about them.
      // The logged texts, emails and calls stay — history isn't rewritten.
      const snapshot = { lead: { ...lead }, tasks: openTasks.map((t) => ({ ...t })), appts: upcoming.map((a) => ({ ...a })) };
      openTasks.forEach((t) => store.remove("tasks", t.id));
      upcoming.forEach((a) => store.remove("appointments", a.id));
      store.remove("leads", lead.id);
      undoToast(`Deleted ${lead.name}`, () => {
        store.restore("leads", snapshot.lead);
        snapshot.tasks.forEach((t) => store.restore("tasks", t));
        snapshot.appts.forEach((a) => store.restore("appointments", a));
      });
      if (location.hash.includes(lead.id)) navigate("/leads");
      return { result: `deleted ${lead.name}${openTasks.length ? `, ${openTasks.length} open follow-up${openTasks.length > 1 ? "s" : ""}` : ""}${upcoming.length ? `, ${upcoming.length} upcoming appointment${upcoming.length > 1 ? "s" : ""}` : ""} — an Undo is on screen for a few seconds`, note: `deleted ${lead.name}` };
    }
    case "undo_sale": {
      const q = String(p.customer || p.name || "").trim().toLowerCase();
      const sales = store.all("sales")
        .filter((s) => (s.customerName || "").toLowerCase().includes(q))
        .sort((a, b) => (b.createdAt || b.saleDate || "").localeCompare(a.createdAt || a.saleDate || ""));
      if (!q || !sales.length) return { result: "not found", note: `⚠ no sale found for ${p.customer || "that customer"}` };
      const sale = sales[0];
      store.remove("sales", sale.id);
      const lead = sale.leadId ? store.get("leads", sale.leadId) : findLead(sale.customerName);
      if (lead && lead.stage === "sold") store.update("leads", lead.id, { stage: "working" });
      return { result: `removed sale for ${sale.customerName}`, note: `removed the sale for ${sale.customerName}` };
    }
    case "book_appointment": case "schedule_appointment": {
      // Everyone with an appointment is a customer — create the lead if new.
      const who = p.customer || p.name || "Customer";
      const lead = findLead(who) ||
        store.create("leads", { name: who, vehicleInterest: p.vehicle || "", stage: "new", source: "Voice" });
      const type = ["testdrive", "delivery", "call", "appointment"].includes(p.type) ? p.type : "appointment";
      const label = { appointment: "Appointment", testdrive: "Test drive", delivery: "Delivery", call: "Phone call" }[type];
      const a2 = store.create("appointments", { type, title: label, customerName: lead.name, vehicle: p.vehicle || lead.vehicleInterest || "", when: p.when || "", status: "scheduled", confirmed: false, outcome: "", leadId: lead.id, notes: "" });
      afterAppointmentBooked(lead.id, a2.when, a2.id);
      const ct = planTasks(a2.id).find((t) => t.apptPlan === "confirm");
      const ctWhen = ct ? planStatus(a2.id).find((i) => i.role === "confirm") : null;
      return { result: `booked ${label} with ${a2.customerName} at ${a2.when}${ct ? `. Preset: a confirmation text to ${a2.customerName} goes ${ctWhen && ctWhen.ready ? "now" : ctWhen ? ctWhen.when : "ahead of it"} (held on Log for the salesperson's OK), and the salesperson gets reminders the morning of and an hour before` : ""}${lead.phone ? "" : ". No phone on file — ask for their number so the text can go"}`, note: `booked ${label.toLowerCase()} with ${a2.customerName || "customer"}` };
    }
    case "appointment_outcome": case "set_outcome": {
      const appt = findAppt(p.customer || p.name);
      if (!appt) return { result: "no appointment found", note: `⚠ no appointment found for ${p.customer || p.name}` };
      const o = String(p.outcome || "").toLowerCase();
      if (o === "confirmed" || o === "confirm") { store.update("appointments", appt.id, { confirmed: true }); onAppointmentConfirmed(appt.id); return { result: "confirmed", note: `confirmed ${appt.customerName}` }; }
      if (o.includes("no")) { store.update("appointments", appt.id, { outcome: "no_show" }); onAppointmentOutcome(appt.id); return { result: "no-show", note: `marked ${appt.customerName} no-show` }; }
      if (o.includes("show")) { store.update("appointments", appt.id, { outcome: "showed", confirmed: true }); onAppointmentOutcome(appt.id); return { result: "showed", note: `marked ${appt.customerName} showed` }; }
      if (o === "sold") {
        store.update("appointments", appt.id, { outcome: "sold", confirmed: true });
        onAppointmentOutcome(appt.id);
        const logged = store.all("sales").some((s) => s.apptId === appt.id || (appt.leadId && s.leadId === appt.leadId));
        if (!logged) {
          store.create("sales", { customerName: appt.customerName, vehicle: appt.vehicle, saleDate: new Date().toISOString().slice(0, 10), frontGross: 0, backGross: 0, commission: 0, leadId: appt.leadId || null, apptId: appt.id });
          if (appt.leadId) afterSale(appt.leadId, { vehicle: appt.vehicle || "" });
        }
        return { result: "sold", note: `marked ${appt.customerName} sold` };
      }
      return { result: "unknown outcome", note: "⚠ unknown outcome" };
    }
    // ---- Standing rules ----
    // How the salesperson wants the assistant to behave, kept for good in
    // the standing instructions (Settings → Voice agent → How it works for
    // you), one rule per line. Every brief and every drafter reads them.
    case "remember_rule": case "remember": {
      const rule = String(p.rule || "").trim().replace(/\s+/g, " ").replace(/[.]+$/, "");
      if (!rule) return { result: "need the rule, in the salesperson's words", note: "" };
      const rules = standingRules();
      if (rules.some((r) => r.toLowerCase() === rule.toLowerCase())) return { result: `already a rule: "${rule}" — nothing to save`, note: "" };
      if (p.confirmed !== true) {
        return { result: `Not saved yet. Read it back and confirm with ask_user (options ["Yes, remember it", "No"]): "From now on: ${rule}. Want me to remember that?" On a clear yes, call remember_rule again with the same rule and confirmed: true.`, note: `checking the rule before saving` };
      }
      store.updateSettings({ agentNotes: [...rules, rule].join("\n").slice(0, 1200) });
      return { result: `saved: "${rule}". It's in your brief from the next turn, and every text and email follows it. Say so in one short sentence.`, note: `remembered: ${rule}` };
    }
    case "forget_rule": case "forget": {
      const q = String(p.rule || "").toLowerCase();
      const rules = standingRules();
      if (!rules.length) return { result: "there are no standing rules to forget", note: "" };
      const words = q.split(/\W+/).filter((w) => w.length > 2 && !/^(the|rule|about|that|this|forget|drop|stop|instruction|one)$/.test(w));
      let hit = rules.find((r) => r.toLowerCase() === q);
      if (!hit && words.length) hit = rules.find((r) => words.every((w) => r.toLowerCase().includes(w)));
      if (!hit && words.length) { const some = rules.filter((r) => words.some((w) => r.toLowerCase().includes(w))); if (some.length === 1) hit = some[0]; }
      if (!hit) return { result: `no rule matches "${p.rule}". The rules on file: ${rules.map((r) => `"${r}"`).join("; ")}. Ask which one, with options.`, note: `⚠ no rule matching "${p.rule}"` };
      store.updateSettings({ agentNotes: rules.filter((r) => r !== hit).join("\n") });
      return { result: `forgot the rule: "${hit}"`, note: `forgot: ${hit}` };
    }
    case "start_cadence": case "start_followup": {
      const lead = findLead(p.name || p.customer);
      if (!lead) return { result: "not found", note: `⚠ couldn't find ${p.name || p.customer}` };
      startCadence(lead.id);
      return { result: "started", note: `started follow-up plan for ${lead.name}` };
    }
    case "mass_outreach": case "outreach": case "blast": {
      const sentence = String(p.sentence || p.message || "");
      if (!sentence) return { result: "need the sentence: who, and what to tell them", note: "⚠ who should it go to, and what should it say?" };
      const spec = parseOutreach(sentence);
      if (p.channel) spec.channel = p.channel;
      const aud = audienceFor(spec, store.all("leads"), { reach: reachForBlast });
      const m = await import("./views/outreach.js");
      m.queueOutreach(sentence);
      if (aud.unknown && aud.unknown.length) return { result: { channel: spec.channel, recipients: 0, notUnderstood: aud.unknown, answer: unknownNote(spec), status: "nobody picked — ask the salesperson to reword the audience; never widen it to everyone" }, note: `⚠ didn't understand ${aud.unknown.map((u) => `"${u}"`).join(", ")}` };
      return { result: { channel: spec.channel, audience: describeAudience(spec), recipients: aud.included.length, leftOut: aud.excluded.length, leftOutWhy: aud.excluded.slice(0, 5).map((x) => x.why), message: spec.message, ready: !!spec.message, status: "on screen — the salesperson reviews and taps Send" }, note: `${aud.included.length} on screen to ${spec.channel}` };
    }
    case "lot_lookup": case "lot": case "inventory_lookup": {
      const hints = { condition: p.condition || "", maxPrice: p.maxPrice || null, minPrice: p.minPrice || null, maxKm: p.maxKm || null, stock: p.stock ? String(p.stock).toUpperCase() : "", sort: p.sort || "", ask: p.ask || "" };
      const res = answerLot(store.all("vehicles"), p.question || p.query || "the lot", hints);
      if (!res) {
        const all = store.all("vehicles").filter((v) => (v.status || "available") === "available");
        return { result: { count: all.length, answer: all.length ? lotSummary(all) : "There's nothing on the lot in the app yet — Settings → Dealer inventory sites → Import the lot now." }, note: "" };
      }
      showLotOnScreen(res);
      const units = res.matches.slice(0, 8).map((v) => ({ id: v.id, vehicle: [v.year, v.make, v.model, v.trim].filter(Boolean).join(" "), price: v.price, wasPrice: v.wasPrice || null, km: v.mileage, stock: v.stock || "", color: v.color || "", condition: v.condition || "", certified: !!v.certified, arrives: v.inventoryDate && String(v.inventoryDate).slice(0, 10) > new Date().toISOString().slice(0, 10) ? String(v.inventoryDate).slice(0, 10) : "" }));
      return { result: { count: res.count, asked: res.label, answer: res.answer, widened: !!res.widened, units, more: Math.max(0, res.count - units.length), prices: "the website's exact prices" }, note: res.count ? `${res.count} on screen` : "" };
    }
    case "search_inventory": case "find_vehicle": {
      const want = String(p.query || p.vehicle || "").trim();
      openDealerSearch({ vehicleInterest: want });
      // Honest about what this is: two buttons that open the dealer's website
      // in the browser. The app never sees that site's results, applies no
      // filter and no sort, and can't say what's there.
      return {
        result: `Put two buttons on screen that open the dealer websites in the browser (the store's own site; the O'Regan's network, used only)${want ? `, with "${want}" shown as what to look for` : ""}. NOTHING has been searched yet and this app CANNOT see those sites' results, counts or prices, and applied no filter or sort. Tell the salesperson exactly that: tap the button, search on the site, and come back with the unit. Do not describe results.`,
        note: `inventory search buttons on screen${want ? " for " + want : ""}`,
      };
    }
    case "compare_vehicles": case "compare": {
      const wanted = (Array.isArray(p.vehicles) ? p.vehicles : [p.a, p.b, p.query]).filter(Boolean);
      if (!wanted.length) return { result: "need vehicle names", note: "⚠ which vehicles should I compare?" };
      const found = [], missing = [];
      wanted.forEach((q) => { const v = findSpec(q); if (v) found.push(v); else missing.push(q); });
      if (!found.length) return { result: `not in the spec database: ${missing.join(", ")}. Tell the salesperson they can add it manually on the compare screen.`, note: `⚠ ${missing.join(" and ")} not in the vehicle database` };
      const names = found.map((v) => v.label).join(" vs ");
      // Staying put: the specs come back side by side for the page to draw.
      if (staying) return { result: { compared: found.map((v) => ({ label: v.label, price: v.price ?? v.msrp ?? null, engine: v.engine || "", hp: v.hp || null, fuel: v.fuel || null, drive: v.drive || v.drivetrain || "", seats: v.seats || null })), missing }, note: `comparing ${names}` };
      queueCompare(found);
      navigate("/compare");
      return { result: `opened the comparison: ${names}${missing.length ? `. Not in the database (can be entered manually on that screen): ${missing.join(", ")}` : ""}`, note: `comparing ${names}` };
    }
    default:
      return { result: `There is no tool "${t}" — this app can't do that. Tell the salesperson plainly that it isn't something you can do here, and what you can do instead if anything.`, note: `⚠ I can't do "${t}"` };
  }
}

// A conversational agent session. It keeps the message history so the agent can
// ask a follow-up question (via the ask_user tool) and continue once you answer.
// send(text) runs the tool-use loop and returns:
//   { say, done:true }              — finished (spoken reply)
//   { say:question, done:false }    — needs an answer; call send(answer) next
// `call(messages)` asks the model and `exec(name, input)` runs a tool; the
// defaults are the salesperson's. The manager's assistant passes its own.
// What each step reads as while it runs, on the voice panel's thread. The
// salesperson watches the assistant work, so the words are what it's doing
// for them, not the tool's name.
const STEP_LABELS = {
  find_customers: "Looking through your customers", get_customer: (i) => `Looking up ${i.name || i.customer || "the customer"}`,
  get_messages: (i) => i.customer ? `Reading the conversation with ${i.customer}` : "Reading what's come in",
  get_appointments: "Checking the calendar", deal_radar: "Running the deal radar", get_stats: "Pulling this month's numbers",
  get_tasks: "Checking your to-dos", get_deliveries: "Checking deliveries", get_occasions: "Looking for occasions",
  get_specials: "Checking the specials", get_spiffs: "Checking the spifs", payment_quote: "Working out the payment",
  deal_options: (i) => `Pricing options for ${i.customer || "them"}`, get_booking_link: "Getting your booking link",
  get_link_activity: "Checking link opens", get_nudges: "Checking what needs you now", get_prospects: "Picking today's prospects",
  get_plays: "Ranking the plays", sales_target: "Checking the target sheet", get_coach: "Pulling the week's scorecard",
  open_page: (i) => `Opening ${i.page || "the page"}`, create_lead: (i) => `Adding ${i.name || "the customer"}`,
  update_lead: (i) => `Updating ${i.name || "the customer"}`, add_context: (i) => `Noting that for ${i.customer || "them"}`,
  add_task: "Adding the to-do", complete_task: "Checking it off", complete_delivery: "Marking it delivered",
  text_customer: (i) => `Writing a text to ${i.customer || "them"}`, call_customer: (i) => `Calling ${i.customer || "them"}`,
  send_email: (i) => `Emailing ${i.customer || "them"}`, add_special: "Saving the special", add_spif: "Saving the spif",
  log_sale: (i) => `Logging the sale for ${i.customer || "them"}`, undo_sale: "Taking that sale back",
  delete_customer: (i) => i.confirmed ? `Deleting ${i.customer || "them"}` : `Checking before deleting ${i.customer || "them"}`,
  book_appointment: (i) => `Booking ${i.customer || "the appointment"}`, appointment_outcome: "Setting the outcome",
  start_cadence: "Starting the follow-up plan", lot_lookup: "Checking the lot", mass_outreach: "Building the outreach",
  search_inventory: "Searching the network", when_it_makes_sense: "Working out the timing", lease_ends: "Listing the leases",
  compare_vehicles: "Opening the comparison", undo_last: "Undoing that",
  remember_rule: (i) => i.confirmed ? "Saving the rule" : "Checking the rule", forget_rule: "Dropping the rule",
};
export function stepLabel(name, input = {}) {
  const l = STEP_LABELS[name];
  if (typeof l === "function") return l(input || {});
  if (l) return l;
  const words = String(name || "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// A session carries its whole history, and a long one — a morning of talking
// to it — would carry an hour of tool results into every call. Past this
// much, the oldest whole turns go; the newest few always stay. Cut at the
// seams only: a turn is the salesperson's words through to the reply, and
// a question-and-answer pair stays together. The retained history loses
// its thinking blocks when cut, because a thinking block is only valid in
// the exact conversation that produced it, and this is no longer that.
const HISTORY_BUDGET = 48000; // characters of history, roughly 12k tokens
const KEEP_TURNS = 4;
function trimHistory(messages) {
  const size = () => JSON.stringify(messages).length;
  if (size() <= HISTORY_BUDGET) return 0;
  const last = messages[messages.length - 1];
  // Mid-turn (tool results waiting on the model) is never the moment.
  if (!last || last.role !== "user" || typeof last.content !== "string") return 0;
  const starts = () => messages.map((m, i) => (m.role === "user" && typeof m.content === "string" ? i : -1)).filter((i) => i >= 0);
  let dropped = 0;
  while (size() > HISTORY_BUDGET) {
    const s = starts();
    if (s.length <= KEEP_TURNS) break;
    messages.splice(0, s[1]);
    dropped++;
  }
  if (dropped) messages.forEach((m) => {
    if (m.role === "assistant" && Array.isArray(m.content)) m.content = m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
  });
  return dropped;
}

// On while a session that stays on its page runs a tool: the tools that
// would open a screen put the result in their reply instead (a drafted
// text stays a draft on the page; a comparison comes back as specs), and
// the router holds every navigate() for the duration.
let staying = false;
export function stayingOnPage() { return staying; }

// opts.stay — run every tool with navigation held and nothing opened: the
// caller's page draws the results itself. opts.onTool(name, input, result)
// hears each tool as it finishes, for that drawing.
export function createAgentSession({ call = callAgent, exec = execTool, stay = false, onTool = null } = {}) {
  const messages = [];
  let pending = null; // { results:[...], askId } while awaiting a human answer
  let aside = "";     // something that happened off-thread (an Undo tap), told on the next turn
  let lastAt = 0;     // when the salesperson last said something

  // onProgress hears the work as it happens: the model's own words when it
  // thinks aloud before acting, each step as it starts, and what came of it.
  async function loop(onProgress) {
    const undoBefore = undoStack.length;
    // What this turn changed, for the Undo chip: the newest undoable change,
    // if the turn made one.
    const undone = (r) => ({ ...r, undo: undoStack.length > undoBefore ? lastUndoable() : null });
    for (let step = 0; step < 8; step++) {
      trimHistory(messages);
      const resp = await call(messages);
      const content = resp.content || [];
      const toolUses = content.filter((b) => b.type === "tool_use");
      const text = content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();

      if (!toolUses.length || resp.stop_reason !== "tool_use") {
        // The reply stays in the history: the next thing said is usually a
        // follow-up on it, and "book her Thursday" needs the "her" the
        // assistant just talked about.
        messages.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: text || "Done." }] });
        return undone({ say: text, done: true });
      }
      if (text && onProgress) onProgress(text);

      messages.push({ role: "assistant", content });
      const results = [];
      let askId = null, question = null, options = [];
      for (const tu of toolUses) {
        if (tu.name === "ask_user") {
          askId = tu.id;
          question = (tu.input && tu.input.question) || "Could you give me a bit more detail?";
          // Tappable answers, when the question has a few clear ones.
          options = Array.isArray(tu.input && tu.input.options) ? tu.input.options.map((o) => String(o || "").trim()).filter(Boolean).slice(0, 5) : [];
          if (options.length < 2) options = [];
        } else {
          if (onProgress) onProgress(stepLabel(tu.name, tu.input));
          let out;
          if (stay) { staying = true; holdNavigation(true); }
          try { out = await exec(tu.name, tu.input || {}); }
          catch (e) { out = { result: `error: ${e && e.message ? e.message : e}`, note: "" }; }
          finally { if (stay) { staying = false; holdNavigation(false); } }
          if (out.note && onProgress) onProgress(out.note);
          if (onTool) { try { onTool(tu.name, tu.input || {}, out.result); } catch { /* the page's drawing is its own */ } }
          results.push({ type: "tool_result", tool_use_id: tu.id, content: typeof out.result === "string" ? out.result : JSON.stringify(out.result) });
        }
      }
      // If the agent asked something, hold the other results and wait for the
      // human — we'll answer all tool calls together on the next send().
      if (askId) { pending = { results, askId }; return undone({ say: question, done: false, options }); }
      messages.push({ role: "user", content: results });
    }
    return undone({ say: "That needed too many steps — try breaking it into smaller asks.", done: true });
  }

  async function send(text, onProgress) {
    const said = aside ? `${aside} ${text}` : String(text);
    aside = "";
    lastAt = Date.now();
    if (pending) {
      const results = pending.results;
      results.push({ type: "tool_result", tool_use_id: pending.askId, content: said });
      messages.push({ role: "user", content: results });
      pending = null;
    } else {
      messages.push({ role: "user", content: said });
    }
    return loop(onProgress);
  }

  // The Undo chip: reverse the last change here and now, and make sure the
  // model hears about it with the next thing said, so it doesn't carry on as
  // if the change stood.
  function undo() {
    const label = undoLast();
    if (label) aside = `[The salesperson tapped Undo: "${label}" has been reversed.]`;
    return label;
  }

  // The panel closed on an unanswered question and reopened later: the
  // question lapses, so the next thing said is a new turn rather than the
  // answer to something from before. The history stays valid — the asked
  // tool gets its result.
  function abandon() {
    if (!pending) return false;
    const results = pending.results;
    results.push({ type: "tool_result", tool_use_id: pending.askId, content: "(no answer — the salesperson moved on)" });
    messages.push({ role: "user", content: results });
    messages.push({ role: "assistant", content: [{ type: "text", text: "Okay." }] });
    pending = null;
    return true;
  }

  return { send, undo, abandon, turns: () => messages.filter((m) => m.role === "user" && typeof m.content === "string").length, lastAt: () => lastAt };
}
