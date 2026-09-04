# entoa

**The AI deal engine and CRM for car salespeople.** entoa is a **mobile-first Progressive Web App** — it works offline, installs to your home screen like a native app, and (in this on-device version) keeps your data on your phone with no login or server. Turn your customer database into a proactive stream of deals ready to pitch.

Live at **[entoa.ai](https://entoa.ai)**.

## What it does

| Area | What you get |
| --- | --- |
| **🏠 Dashboard** | Your day at a glance — follow-ups due today, open to-dos, deliveries in prep, and month-to-date stats. Call or text a customer in one tap. |
| **👥 Leads** | A simple CRM. Log every up: name, phone, the vehicle they want, source, notes. Move them through stages (New → Working → Appointment → Negotiating → Sold → Delivered). Set follow-up reminders so nobody falls through the cracks. |
| **✅ To-dos** | Quick reminders with due dates and priority. Overdue items surface on the dashboard. |
| **🚗 Inventory** | Search your lot by year/make/model/stock #. Track price, mileage, color, VIN, and availability. Quote a deal straight from a vehicle. |
| **🧮 Deal Calculator** | Estimate a monthly payment from sale price, down, trade allowance/payoff, fees, tax, APR and term. Shows amount financed, tax, total interest. |
| **📦 Delivery Prep** | A checklist to get every sold car ready for handoff (detail, gas, plates, paperwork, walk-around…). Start one from a lead in one tap. Track progress to 100%. |
| **📅 Calendar** | Schedule appointments, test drives, deliveries and calls with a date & time. Today's appointments surface on the dashboard. Book one straight from a lead. |
| **💵 Goals & Commission** | Log the front/back gross and your commission on each sale. Set monthly unit and commission goals and watch month-to-date progress on the dashboard. |
| **📱 Message Templates** | One-tap follow-up texts and emails with the customer's name, vehicle, your name and dealership auto-filled. Opens straight in your phone's Messages/Mail app. Fully editable in Settings. |
| **📣 Marketplace Listing Builder** | Turn any vehicle into a copy-paste-ready Facebook Marketplace listing: title, all the structured fields (year/make/model/mileage/price/condition/transmission/fuel/body), a sales-ready description, and a photo shot-list. (Facebook has no API to post automatically, so this builds it for one-tap paste.) |
| **📄 Spreadsheet Import** | Bulk-load inventory or leads from a CSV/Excel export (e.g. **vAuto** inventory or **AutoAlert** leads — both export to Excel). Auto-matches columns, parses messy `$`/comma numbers, previews before importing, and updates existing records instead of duplicating (matched by VIN/stock for vehicles, phone/email for leads). |
| **🎯 Prospecting engine** | The lead-generation core. **Follow-up cadences**: every new lead auto-gets a proven multi-touch reminder sequence (call/text over 30 days) so none go cold. **Daily call list**: mines your contacts for buying signals — due follow-ups, cold leads (no contact in 7+ days), past-customer equity/anniversaries, birthdays, lease-ends — into a prioritized "who to call today." **Speed-to-lead**: brand-new, never-contacted leads jump to the top as "Respond now." **Activity scoreboard**: daily touch goal + appointments-set. Editable cadence and goal in Settings. |
| **📇 Import mining** | The importer reads a **purchase/sale date**, **lease-end**, and **birthday** on a past-customer export (e.g. from vAuto/DMS). One upload turns your whole book of business into a warm equity/lease/anniversary/birthday call list. |
| **💳 Deal Builder (payment match)** | The AutoAlert-style engine: for a customer with imported equity data (current payment, payoff, value), it prices every available new vehicle as a trade-in deal and surfaces the ones they can get into for **close to what they already pay**. Shows closest matches with "≈ same payment", a cash-down tweaker, a one-tap **text offer** ("…a new Rogue for about $607/mo, right around what you pay now"), and "Quote" to open the calculator pre-filled. |
| **📡 Deal Radar (proactive)** | Scans your whole database and **connects the dots** — scoring every customer by payment-match closeness, equity, ownership length, lease timing, and interest rate — into a **ranked feed of deals ready to pitch**, strongest first, each with the reason chips ("Same payment · $3,300 equity · Lease ends in 45d") and one-tap text/call. The top deals surface **automatically on your dashboard** every time you open the app. |
| **🤝 Referral engine** | Prompts you to capture referrals at delivery (or any time, or from the + menu). Each referral drops straight into your pipeline as a new lead with a follow-up cadence started — referred buyers close far higher than cold leads. |
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

#### Deploy to GitHub Pages (free)

1. Push this branch to GitHub.
2. Repo **Settings → Pages** → Source: *Deploy from a branch* → pick this branch, folder `/ (root)`.
3. Your app will be live at `https://<user>.github.io/<repo>/`.

## Deploying the Supabase function

The cloud half of entoa — the voice agent, short links, self-serve booking,
push notifications, email and two-way texting — is one Edge Function. Its
source is `supabase/functions/voice-agent/index.ts`. Whenever that file
changes, or you add a secret, the function has to be redeployed: **secrets
added after a deploy don't reach a running function until it is redeployed.**

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
