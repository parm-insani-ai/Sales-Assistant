# viniva

**The AI deal engine and CRM for car salespeople.** viniva is a **mobile-first Progressive Web App** — it works offline, installs to your home screen like a native app, and (in this on-device version) keeps your data on your phone with no login or server. Turn your customer database into a proactive stream of deals ready to pitch.

Live at **[entoa.ai](https://entoa.ai)**.

## What it does

| Area | What you get |
| --- | --- |
| **🏠 Dashboard** | Your day at a glance — follow-ups due today, open to-dos, deliveries in prep, and month-to-date stats. Call or text a customer in one tap. |
| **👥 Leads** | A simple CRM. Log every up: name, phone, the vehicle they want, source, notes. Move them through stages (New → Working → Appointment → Negotiating → Sold → Delivered). Set follow-up reminders so nobody falls through the cracks. |
| **👉 Right now** | Home's list of what needs you this minute: a welcome text drafted and locked, then ready; a customer waiting on a reply; an appointment nobody confirmed. Swipe a row left to clear it — a text or reminder is ticked off (a text sent from the app clears itself), a reply is marked read, anything else is hidden for the day — with Undo on the toast. |
| **✅ To-dos** | One list on Log, under the To-dos chip, each to-do its own card like a customer on Outreach: the title, who and when, a badge for Now/Overdue/Today, and a banner across the bottom for the assistant's half (Do it → Working… → Done — check it out). Check it out opens the work on its own page, and everything stays on that page: what the assistant did and said, the results themselves (the payment-matched options, the units on the lot, a comparison, what it booked), and the next things it can do from there — text them the options, compare the two best, book a time, set a reminder, or anything you type — each run in the same conversation so it knows what it already found. A text it drafts sits on the page with its own Send button; nothing goes to the customer until you tap it, and figures are blocked. The assistant runs with navigation held, so no screen opens over the work. Any to-do can have a time: give it one and it notifies you at that moment, app open or closed, and sits under Right now on Home until you tick it off. Soonest first, by when it's actually due. The follow-up plan's own steps aren't here; they're on the Queue with their one-tap action. Every to-do carries a **Do it** button — one in your own words goes to the assistant as written; a next move the app filed from something you said (units under their budget, a second option, the spouse's invite, a referral ask) goes with the specific ask: the assistant runs the lookup or writes the draft now, with today's lot, and puts it on screen. The to-do stays until you tick it. Moves only you can make (show the car, appraise the trade) get no button. |
| **🚗 Inventory** | Search your lot by year/make/model/stock #. Track price, mileage, color, VIN, and availability. Quote a deal straight from a vehicle. |
| **🧮 Deal Calculator** | Estimate a monthly payment from sale price, down, trade allowance/payoff, fees, tax, APR and term. Shows amount financed, tax, total interest. |
| **📦 Delivery Prep** | A checklist to get every sold car ready for handoff (detail, gas, plates, paperwork, walk-around…). Start one from a lead in one tap. Track progress to 100%. |
| **📅 Calendar** | Schedule appointments, test drives, deliveries and calls with a date & time. Today's appointments surface on the dashboard. Book one straight from a lead. |
| **💵 Goals & Commission** | Log the front/back gross and your commission on each sale. Set monthly unit and commission goals and watch month-to-date progress on the dashboard. |
| **📱 Message Templates** | One-tap follow-up texts and emails with the customer's name, vehicle, your name and dealership auto-filled. Opens straight in your phone's Messages/Mail app. Fully editable in Settings. |
| **📣 Marketplace Listing Builder** | Turn any vehicle into a copy-paste-ready Facebook Marketplace listing: title, all the structured fields (year/make/model/mileage/price/condition/transmission/fuel/body), a sales-ready description, and a photo shot-list. (Facebook has no API to post automatically, so this builds it for one-tap paste.) |
| **📷 Read the paperwork** | On a sale, photograph the customer approval order or the line-by-line worksheet and the deal is read off it: the car (stock, VIN, new or used), the trade and any lien, how it's paid (finance, lease or cash; term, lender, payment), every product and accessory sold, and the order's own "no further work except" lines. The rep sees it all on one sheet with the delivery prep list already written — each product turned into its steps with who does them and the lead time (rust protection: book with service, three days; an accessory package: order from parts, five days, then book the install), plus the base steps for the financing, the trade, a new or used car, an EV — and one tap puts it on the delivery's checklist, patches the sale, and makes a to-do for today for anything with a lead time. The page is saved with the sale. The rules are editable per store (settings.prepRules); nothing read from the paperwork is ever sent to a customer. |
| **📄 Spreadsheet Import** | Bulk-load inventory or leads from a CSV/Excel export (e.g. **vAuto** inventory or **AutoAlert** leads — both export to Excel). Auto-matches columns, parses messy `$`/comma numbers, previews before importing, and updates existing records instead of duplicating (matched by VIN/stock for vehicles, phone/email for leads). A row from a file is not a lead that walked in: every imported row carries the import time, an owner is on file since their purchase date, and imported rows stay out of speed to lead, the source table, untouched and fresh leads, the log, and the sweep's "hasn't been touched" until someone logs or contacts them. |
| **🎯 Prospecting engine** | The lead-generation core. **Follow-up cadences**: every new lead auto-gets a proven multi-touch reminder sequence (call/text over 30 days) so none go cold. **Daily call list**: mines your contacts for buying signals — due follow-ups, cold leads (no contact in 7+ days), past-customer equity/anniversaries, birthdays, lease-ends — into a prioritized "who to call today." **Speed-to-lead**: brand-new, never-contacted leads jump to the top as "Respond now." **Activity scoreboard**: daily touch goal + appointments-set. Editable cadence and goal in Settings. |
| **📇 Import mining** | The importer reads a **purchase/sale date**, **lease-end**, and **birthday** on a past-customer export (e.g. from vAuto/DMS). One upload turns your whole book of business into a warm equity/lease/anniversary/birthday call list. |
| **💳 Deal Builder (payment match)** | The AutoAlert-style engine: for a customer with imported equity data (current payment, payoff, value), it prices every available new vehicle as a trade-in deal and surfaces the ones they can get into for **close to what they already pay**. Shows closest matches with "≈ same payment", a cash-down tweaker, a one-tap **text offer** ("…a new Rogue for about $607/mo, right around what you pay now"), and "Quote" to open the calculator pre-filled. |
| **📡 Deal Radar (proactive)** | Scans your whole database and **connects the dots** — scoring every customer by payment-match closeness, equity, ownership length, lease timing, and interest rate — into a **ranked feed of deals ready to pitch**, strongest first, each with the reason chips ("Same payment · $3,300 equity · Lease ends in 45d") and one-tap text/call. The top deals surface **automatically on your dashboard** every time you open the app. |
| **🤝 Referral engine** | Prompts you to capture referrals at delivery (or any time, or from the + menu). Each referral drops straight into your pipeline as a new lead with a follow-up cadence started — referred buyers close far higher than cold leads. |
| **📋 The store's app (managers)** | A store groups reps under one or more managers, and a manager gets the store's app: four screens. **Home** leads with the month's math: the store's targets (new and used) at its closing ratio back to customers spoken with and, through the booked path (share of units through an appointment, show rate, closing on a show), appointments set — each with where it should be today against where it is; the ups needed by source at the year's mix against the customers logged by source this month; and the lever, that an up arriving as an appointment closes at nearly three times the mix. Then today's plan, the micromanager's card: what the store needs to set to hit the month and, per rep, how many appointments they need today, how many they've set, what's on their plate that produces them (fresh leads, customers waiting, texts to send, appointments to confirm), how many of the night read's plays they've done, the flags you'd walk over about (an untouched lead, no touches by noon, nothing set this week, overdue follow-ups), and when they last logged, set or sold anything; then what the manager's taps came to over the last fourteen days — nudges, texts from the store, hand-offs, welcomes, drafts sent, each with how many had an appointment set within a day. Under the appointments bar, the show rate the store actually gets against the one the plan assumes. An hour after any appointment with no outcome, the rep's phone asks "Did Dana show?" with Showed and No-show as buttons on the notification (one tap, where the phone draws them; the appointment's page otherwise), and reading a delivery's paperwork marks the customer and the appointment that brought them in sold, so the show rate and the funnel come from fact rather than memory. **Floor** is three lists — the customers on the floor now, the ones who were and left without buying, the ones who'd come in if someone called — each row with its one action, each capped at ten with a show-all. **Act now** is everything that costs business by the hour, the costliest first: every untouched lead from five minutes old with a clock running on it and a nudge, since the first hour books; customers across every rep's book waiting on a reply, longest first, with a nudge to the rep or a Reply that texts them from the store's number as you (and the agent's held draft, when it wrote one); texts the reps' phones have drafted and not sent, by rep, with the oldest wait and a nudge; appointments in the next 24 hours nobody has confirmed, with a nudge or a confirmation text already drafted; and who was logged today without a text yet, with Welcome now. Texts still in their hold (a welcome in its five minutes) ride at the end with the minute they send, so a customer just logged is on the Floor as soon as the rep's phone syncs; with nothing drafted, a fold says what the board read from each rep's phone (when it last synced, how many texts their plan holds, when the next is ready), so a text the rep sees and the Floor doesn't is explained on the page. When nothing is waiting the list says so in one line. **Get them back** is everyone who's been in and isn't sold: the no-shows nobody has rebooked and the unsold ups gone quiet two days or more, quietest first, each with a nudge and a drafted text from you — a be-back closes at nearly three times the rate of a fresh up. **Bring them in** is the ranked owner book across every rep (equity, a lease ending, paid off, service history), anyone booked into the service drive today or tomorrow first, with the reasons and a Send that hands one to their rep with a to-do; the dispatcher does the same each morning on its own, this is for a slow day. Under it, today's appointments; folded under that, the day's record (every customer logged, appointment set and car sold across the store, newest first). The huddle itself comes from the agent at eight, and from the voice assistant on request. The function's sweep pushes a manager with notifications on about the same things while the app is shut: a customer waiting more than fifteen minutes, a lead untouched past fifteen (the rep hears at five), an appointment two hours out that isn't confirmed — each once, in business hours, opening the Floor. **Reps** is each rep with their stats and goals (tap for their day, Targets to set their month), two weeks of calls — dials, connects, and calls followed by an appointment within a day — and how many of the manager's taps about them booked; a row that reads empty says why (a new account, a phone that hasn't synced, a store you don't manage) instead of showing zeros, and a Logged chip of everyone logged this month across the store with their follow-up plan and where it stands. **Admin** is the store itself: members and roles, the invite link, the account, **store targets** — units by category, the closing ratios, the booked path's rates, selling days, and each rep's share of the month, with Write to set every rep's month on their phone from it (the per-rep day on Home and the rep's own daily target come from the same plan) — and **the store's agent** — what the function does for the manager every day, each with a switch and its hour: drafts a reply, in the manager's voice, for any customer a rep has left waiting, held for the manager's tap (the push carries it and opens the Floor on it); at five, texts every appointment for tomorrow that nobody has confirmed, from the store's number in the manager's name; the morning after a no-show, texts a sorry-we-missed-you and puts a rebook on the rep's list; at eight, hands each rep a few reach-outs from their own owner book as to-dos with the reason, plus anyone of theirs in the service drive that day; sends the manager the huddle at eight and the day's recap at six, as a push and by email. Never a figure in anything sent to a customer; each thing once. With a plan saved under Store targets, five more agents run on it: the **planner** writes every rep's month to their phone on the first morning from the allocation and rolls last month's measured closing, show and close-on-show ratios into the plan when the month had enough in it to trust (twenty customers or appointments), with last month's close in the push and the email; the **dispatcher** sizes each rep's morning hand-outs to the plan — the owner-book contacts their share of the month needs each working day, plus a catch-up when their appointments are behind pace (the gap over the set rate over the days left), within the store's cap; the **converter** holds a time-ask in the manager's voice for any internet up a day old with nothing booked (an up that arrives as an appointment closes at three times the rate) and tells the rep to ask for a time when their first reply went out without one; the **reviewer** reports the week against the plan on the review day — units, customers and appointments against pace, store and rep — and names the leak (traffic, appointments from customers, show rate, or closing on a show) with the fix; and the **be-back** list goes out the same morning: the ten unsold ups most worth a call, still in play, nothing booked, quiet two days or more, which the Floor also carries as a card with a nudge and a drafted text. Each rep's row on Reps carries a coach line when one of their rates — set rate, show rate, closing on a show, closing — is more than five points below the store's, with the play that moves it. **The store's owner book**: a manager loads a CSV or Excel export of every customer the dealership has (the DMS owner list, an AutoAlert equity export, a lease-end report) from the "+" — the columns matched as the rep-side import matches them, each customer keyed by VIN or phone so a second load updates rather than doubles — and the Customers page ranks them under a Store book chip, best first with the reasons (equity, a lease ending, paid off, years in, the rate, service), leaving out anyone already in a rep's book. Hand to… puts one in a rep's book as the store's customer with the to-do and the reason; Deal the top ten spreads them across the reps round robin; Set aside keeps a wrong number out. The dispatcher deals from the same book each morning when a rep's own book runs short of their quota, so nobody is contacted twice. The table and its functions are in supabase/storebook.sql. **Measurement**: every act on either app is one record in an event log — logged, texted, called, appointment set, confirmed, showed, no-show, sold, task done, the manager's nudges and hand-offs, the agent's texts and hand-outs, a push received and a push opened — with who, which customer, when and what prompted it, never a figure or a message body; the store's pages compute from their own records as before, Admin → More → Export writes every event across the store and each rep's month to a spreadsheet, and **Advanced statistics** (under the "+" on both apps; the store's for a manager, their own for a rep) reads the log in place: speed to lead (median, inside ten minutes, by rep and by hour of arrival), pushes (received, opened, acted on inside half an hour), which follow-up step books, the welcome's timing against replies and appointments, confirmed against unconfirmed show rates, what the manager's taps came to, the agent's own work (confirmation texts that showed, hand-outs worked and booked), when ups get logged and appointments set by hour and day, and discipline (past appointments with an outcome marked, leads that got a first contact) — each with its sample, saying what it still needs below its threshold, over 7, 28 or 90 days. The agent runs the same reads on the review day and sends the sentences: the store's to each manager as a push and by email, each rep's own to the rep. **Daily log** (under the rep's "+" and on their Home) is the store's daily customer prospect sheet in the app, filled in by itself: the Auto Alert / service-list customers the rep reached that day come in from their calls and texts with the outcome read off the records (reached, voicemail, texted, replied, appointment set), and the Marketplace listings they copied come in as Facebook posts; the rep adds or corrects rows (a customer picked from the book fills the row and a typed outcome counts as a contact, a vehicle picked from the lot fills the stock), and what they type wins. It syncs with everything else. **Daily logs** under the manager's "+" shows every rep's sheet for any day, built from the rep's synced records — so a rep who never opened the page is on it — with the day's totals; Home's rep line carries how far each sheet is; and the end-of-day recap carries the totals and each rep's line, by push and by email. Everything else — email, welcome text, nudges, reach-outs, targets, invites, the appointment board, customers, timing, lease ends, insights, settings, the sales view — is under the "+". The manager can open a rep's lists and any customer, read-only. **Today on the floor** lists every customer logged, appointment set and car sold across the store as it happens, newest first, and the board counts customers logged and the closing ratio. Each rep's sheet carries their own sales-target sheet (sold and spoken with against target, closing ratio, this week's share, new and used), everyone they've logged this month, and the next two weeks of appointments. Every rep shows when their phone last synced, flagged once it's a day old, and syncing can't be switched off while a rep is in a store. The board re-reads when the manager comes back to the app. Reps join by an invite link; nothing changes about their own app, and reps never see each other's books. Stores are created and managers appointed by an admin set in the database, so nobody can make themselves a manager. |
| **📅 Appointments, preset** | Home's second tile counts the appointments ahead and opens the list — every appointment by day, confirmed or not, with where its presets stand. Booking one presets the lot: a confirmation text to the customer, timed by the appointment — the afternoon before (4pm) for a morning appointment, the morning of (9am) for an afternoon one, right away if booked too late for that — held on Log for your OK; and reminders to you the morning of (8:30) and an hour before. Confirming clears the confirmation text; an outcome clears everything; moving the appointment resets it all. The wording is a template in settings (`apptConfirmText`; the hours are `apptConfirmAm`, `apptConfirmPm`, `apptMorning`) with `{first}` `{me}` `{dealership}` `{type}` `{day}` `{time}` `{vehicle}`. |
| **📧 Email, the mail app's way** | Comms → Email is your Gmail or Outlook inbox, and it keeps itself current: a check every minute while the app is in front (`mailPollSec` in settings), one on coming back to the app, a pull down to check now, new mail announced wherever you are and a customer's reply filed into their history at once. New mail is a notification on the phone too — from the app while it's open, and from the function's sweep while it's shut (it watches a connected Gmail with the refresh token the app publishes; needs notifications turned on in Settings and the function's latest code). An email opens as a full page: pictures in place, attachments underneath (photos as thumbnails that open full size, files that open or save), quoted history folded. Reply or compose with a Cc line, files and photos from the phone, and a ✨ button that has the assistant write the email from the customer's profile and the whole conversation — with the no-figures rule — for you to edit and send. |
| **💬 The conversation, as context** | Every text, email and call with a customer — both directions, plus what's in the connected Gmail/Outlook inbox — is one record the assistant refers to. It carries who has written in lately (and who's waiting on a reply) into every turn, answers *"what did Dana say?"*, *"read me Ken's email"*, *"who's waiting on me?"*, *"what came in today?"* from the actual messages, and every drafted text or reply continues from the whole exchange rather than the texts alone. |
| **🎙️ Voice, as a conversation** | The Voice tab is the app's main way of working. Talk and your words appear on the thread as you say them; the assistant shows each step it takes ("Looking up Ann Lee", "Booking Ann Lee"), ticked as it goes; the answer lands in writing — spoken too, unless you mute it — or the action just gets done and the app opens the screen. Type instead whenever you like; it's the same thread. A pause mid-sentence doesn't cut you off: the panel holds what it heard and sends it at the next real silence. Everything the assistant changes can be put back — an **Undo** chip sits under each change, and "undo that" does the same — so it acts on what you said rather than checking first. Closing the sheet keeps the conversation in mind for ten minutes, so "book him Thursday" a moment later still knows who. Settings → Voice agent → *How it works for you* sets the tone, the sign-off and standing instructions that every text and email it drafts in your name follows. |
| **📊 Performance** | Tap into the Sales target on Home and every number is there, a month at a time: the target sheet (target, closing expected, customers to speak with, spoken with, sold, closing so far, units and conversations remaining, attainment, pace, this week), the appointment funnel (set, confirmed, showed, sold, show and close rates), commission (total, front, business office, business gross, average per deal, against the goal), and the "Vehicles Sold Track" sheet's own panels — new vs used, type of lead, business managers, manufacturers, models — plus week by week and the month's activity. **Export sheet** downloads the tracker sheet itself, filled in: the sheet's columns in its order (month, deal, type, name, phone, vehicle, make-ready, VIN, etch, delivered, BM, front, business gross, B.O., total, notes), "My Plate" from Settings, and the summary panels down the right. |
| **📄 Sold** | Tap the Sold tile on Home: everyone you've sold, by month, newest first. Open a sale and photograph or scan its paperwork — the bill of sale, the worksheet, the trade — with the camera or from Files (a PDF works too). Each file is saved with the sale and the customer, shows at once and offline from the phone, and backs up to your own folder in the cloud bucket in the background (`supabase/storage.sql`, run once). Tap one to see it full size, open it, or delete it with undo. |
| **👥 Outreach** | Your whole owner book, best first. One row up top for search and Filter; five chips that fit the screen: Best now (uncontacted, ranked by how ready they are to trade), Timing, Follow up, Contacted, All. Best now is grouped by why each customer is worth a call — Reaching out to you, Same payment or less, Equity to trade, Contract or lease ending, In the service drive, Better rate available, Warranty or km running out, Flagged for you, Due for a change — each customer under their strongest reason (anyone who's texted or opened your link, or is in the service drive, goes there first), the top three of each showing and Show all for the rest. Contacted and All are grouped Ready now, Opening up in the next 3 months, Everyone else; Contacted opens with what the last four weeks of openers came to — sent, replied, booked — with the full readout in Coach a tap away. Each card is the name, the vehicle, the one reason, and an action — Review a drafted opener, Call when there's no texting consent, or Add number. Swipe for Contacted, Not now (off Best now for a month) or Delete; long-press to select several. Add customers with the +. The Deal Radar, with its payment sliders, is its own screen from the Payment matches link. |
| **🎯 Queue** | Log → Queue: everything worth doing today, each play its own card — the customer, what it asks, the reason beneath, and the action across the bottom (Text, Call, Review a drafted text, Open). Grouped Now, Later today, and When you get a minute. Swipe a card left for Later (hidden for the day) or Done, with Undo. A plan step carries **Do it**: the assistant drafts it or preps the call on the to-do's work page. |
| **🌙 The night read** | At 2am the model goes through your book the way a manager would at the end of the day — who wrote and is waiting, who's gone quiet, which appointment is shaky, whose timeline is arriving — and writes the next working day's plays, each with the reason and the draft for a text. They lead Today's queue in the morning, marked *Overnight read*; the 8am push names the first. Nothing sends by itself: a text play opens the conversation with the draft in the box. Needs the `viniva-night` job from `supabase/cron.sql`. |
| **🎙️ Voice control** | Tap the mic and talk: *"new lead John Smith interested in a Rogue," "add task call the bank tomorrow," "schedule a test drive with Priya at 3pm," "log a sale for Sarah, commission 700," "find a used Pathfinder on the network," "go to inventory."* It creates the record and speaks a confirmation. Commands are parsed on-device (no server). Where a browser's speech recognition is unavailable (some iOS versions), the same box accepts typed input — or use your keyboard's dictation mic. |

## Run it

It's plain HTML/CSS/JavaScript with **no build step**. You just need to serve the folder over HTTP (ES modules and the service worker don't run from `file://`).

```bash
# from the project folder — any static server works:
python3 -m http.server 8000
# then open http://localhost:8000 on your computer
```

To use it on your **phone on the same Wi-Fi**, find your computer's local IP and open `http://<that-ip>:8000`.

### Put it on your phone's home screen (recommended)

Deploy the folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, Vercel). Then on your phone:

- **iPhone (Safari):** open the site → Share → *Add to Home Screen*.
- **Android (Chrome):** open the site → menu → *Install app* / *Add to Home Screen*.

Now it launches full-screen like an app and works offline.

#### As a real phone app (TestFlight and Play internal testing)

The same files also build into native iPhone and Android apps, with the
phone's own speech recognizer behind the microphone and real push
notifications — no Home Screen step. See [native/README.md](native/README.md)
for the one-time Apple and Google setup and the GitHub Actions that upload
to TestFlight and to the Play Store's internal testing track.

#### Deploy to GitHub Pages (free)

1. Push this branch to GitHub.
2. Repo **Settings → Pages** → Source: *Deploy from a branch* → pick this branch, folder `/ (root)`.
3. Your app will be live at `https://<user>.github.io/<repo>/`.

## Deploying the Supabase function

The cloud half of viniva — the voice agent, short links, self-serve booking,
push notifications, email and two-way texting — is one Edge Function. Its
source is `supabase/functions/voice-agent/index.ts`. Whenever that file
changes, or you add a secret, the function has to be redeployed: **secrets
added after a deploy don't reach a running function until it is redeployed.**

**From GitHub, automatically.** The workflow in
`.github/workflows/deploy-function.yml` deploys the function on every push
that changes it, as `quick-api`, with Verify JWT off. One-time setup: in
Supabase, your avatar → Account → Access Tokens → generate one; in GitHub,
this repo → Settings → Secrets and variables → Actions → new repository
secret named `SUPABASE_ACCESS_TOKEN`. Until that secret exists the workflow
fails with a message saying so and nothing else changes. If your install's
function is named differently, add a repository variable
`SUPABASE_FUNCTION_NAME`; the project ref defaults to this store's and can
be set with `SUPABASE_PROJECT_REF`. Secrets already on the function are
untouched by a deploy.

**From the dashboard** (no tools to install, works from a phone):

**Deploy to the function the app actually calls.** The name is NOT fixed — it
is whatever is in Settings → *Voice agent URL*, and installs differ:
`voice-agent` and `quick-api` are both in the wild. Deploying to the wrong one
is silent and confusing: the app keeps working on the old code while the new
code sits in a function nothing calls. Read the name off that URL first.

1. Settings → **Voice agent URL** → note the last path segment.
2. Supabase → your project → **Edge Functions** → open **that** function.
3. **Select all** in the editor and paste the whole new file over it. Replace,
   don't append.
4. **Deploy**.

**From the CLI**, substituting the same name:

```sh
supabase functions deploy <that-name> --no-verify-jwt
```

The folder in this repo is `voice-agent/` for historical reasons — the function
long ago grew past being just the voice agent, and now carries short links,
booking, push, email and texting too. The folder name and the deployed name do
not have to match, and renaming the deployed one would break every short link
already sitting in a customer's text thread.

After deploying, keep **Verify JWT off** for this function — the app, the
public booking page, and Twilio's webhook all call it without a Supabase token.
Inbound texts are authenticated by Twilio's request signature instead.

**The assistant's model.** The function calls Claude Sonnet 5.5 unless a
`MODEL` secret names another model; `EFFORT` (default `medium`) sets how hard
it thinks. The tool list and the standing part of the brief are sent as a
cached prefix, so each turn pays in full only for the live part (the date,
the names on file, what's come in) and the conversation itself. The brief
lives in the app (`js/agent.js`) and ships with the normal update; the model
and effort live in the function's secrets.

**The night read** runs on the same key: `{"nightly": 1}` to the function
(the `viniva-night` cron job in `supabase/cron.sql`, 2am Halifax) reads each
salesperson's book — live customers, the next days' appointments, follow-ups
due, the last three days of texts and emails, deliveries in prep, with
every figure taken out — and writes one `agentplays` record for the day
that's starting (or the next working day). Each rep gets their own run of the
function, and each rep is read at most once a day. `NIGHT_MODEL` overrides the model for this pass alone. To run
it for one person by hand: `{"nightly": {"u": "<user id>"}}`.

**Measuring it.** `test/utterances.test.js` runs a set of real sentences a
salesperson says ("Ken's coming in Thursday at 4", "sold one to Moe, made
800", "undo that") against the live model and reports which tool each one
picked. The easy way to run it: add `ANTHROPIC_API_KEY` as a repository secret on
GitHub, then Actions → **Agent eval** → Run workflow. The score and every miss
land on the run's summary, and the run fails under 90%. Locally it needs
`ANTHROPIC_API_KEY` in the environment of the stub server
(`ANTHROPIC_API_KEY=… node test/server.js`); without it the eval says so and
skips. Run it before and after changing the brief, the tools, the model or
the effort.

`test/fnrelay.test.js` runs the cloud function itself under Deno against a
stand-in database and model: who may use the assistant, the daily budgets,
the size and output caps, and the night read. It skips without Deno
(`DENO_BIN=…`).

## Finding a car on the dealer network (search launcher)

From a customer's lead (or the Inventory tab), **🔎 Find a car** opens the O'Regan's inventory site pre-filtered the right way:

- **My store** → all inventory (new + used)
- **The network** → **used only** (matching the rule that only used cars can be sold from other stores in the group)

A phone app can't read another site's inventory directly (cross-origin security + the sites' bot protection), so instead of scraping, this deep-links straight into the dealer's own search with the used/new filter already applied — you just narrow by make/model on the site. The site URLs and the "used only" filter are editable under **Settings → Dealer inventory sites**, so it works for any dealer group.

## Connecting to vAuto, AutoAlert, or your dealer website

The app runs entirely on your device with no server, which is what keeps it free and private. Live API connections to enterprise tools like **vAuto** (Cox Automotive) and **AutoAlert** aren't possible from an on-device app: their APIs are partner-gated (they require credentials issued under a dealership-level agreement), and those credentials can't be safely stored in a browser app — that would need a hosted backend.

The practical path that works today, with no credentials or backend, is the **📄 Spreadsheet Import**: export inventory from vAuto (or leads from AutoAlert) to Excel/CSV and load the file in. See **Settings → Import inventory / leads from spreadsheet**, or the **+** menu → *Import from spreadsheet*.

> If your dealership *can* provide API credentials and you want real-time sync, that's a larger project (a hosted backend + per-vendor API agreements) — it's doable, just a different architecture than this on-device app.

## Your data

- Everything is stored in your browser's `localStorage` on **this device only**. Nothing is uploaded anywhere.
- **Back it up:** Settings (⚙️ in the + menu) → *Export backup* saves a `.json` file. *Import* restores it — great for moving to a new phone.
- Clearing your browser data / site data will erase it, so export a backup now and then.

> **Note:** Because data is per-device, it does **not** sync between your phone and computer. If you want cloud sync across devices (and a shared team view), that's a natural next step — it would need a small backend. Ask and we can add it.

## Project layout

```
index.html            App shell (top bar, bottom tab nav)
manifest.json         PWA manifest (installability)
sw.js                 Service worker (offline caching)
css/styles.css        All styling (dark, mobile-first)
icons/icon.svg        App icon
js/
  app.js              Bootstrap, routing, quick-add menu
  router.js           Tiny hash router
  store.js            localStorage data store (leads, tasks, vehicles, deliveries)
  utils.js            Formatting helpers (money, dates, phone)
  components.js       Modal, toast, confirm, form builder
  views/
    dashboard.js      Home
    leads.js          Leads CRM + detail
    inventory.js      Vehicle inventory + detail
    calculator.js     Deal / payment calculator
    deliveries.js     Delivery prep checklists
    tasks.js          To-do list
    settings.js       Defaults, checklist template, backup
```

## Heads up on the calculator

The payment math is a standard amortization estimate and assumes sales tax applies to *(price − trade allowance)*, which is the common rule but **varies by state and deal structure**. Always confirm final numbers with your F&I desk before quoting a customer a hard figure.
