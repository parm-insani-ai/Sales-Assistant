# viniva cloud sync — setup

viniva works fully offline with no account. Turning on cloud sync adds a secure
backup and keeps your data in sync across devices (and, later, lets a team each
have their own private data). It uses [Supabase](https://supabase.com) — a
hosted Postgres database with authentication. The free tier is plenty.

Nothing changes about how the app runs: it stays a static site, still works
offline, and your device's copy remains the fast working copy. Supabase is just
the cloud mirror.

## One-time setup (~2 minutes)

1. **Create a project** at [supabase.com](https://supabase.com) (free). Give it
   a name and a database password, pick a region near you.
2. **Create the table.** In your project open **SQL Editor → New query**, paste
   the entire contents of [`schema.sql`](./schema.sql), and click **Run**. This
   creates one `records` table with Row-Level Security so each account can only
   ever see its own data.
3. **Copy your keys.** Go to **Project Settings → API** and copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public** key (a long `eyJ…` string)
4. **Connect the app.** In viniva: **Settings → Cloud sync & account**, paste the
   Project URL and anon key, then **Create account** with your email + password.
5. *(Optional, recommended for a single user)* In Supabase **Authentication →
   Providers → Email**, turn **off** "Confirm email" so sign-up is instant. Leave
   it on if you prefer email confirmation.

That's it. Your data backs up automatically in the background, and signing in on
another device pulls everything down.

## Notes

- **The anon key is meant to be public** — it's safe in the app. Your data is
  protected by the Row-Level Security policy in `schema.sql`, which ties every
  row to the signed-in user.
- **Conflicts** resolve by newest edit wins (last-write-wins on each record).
- **Offline:** edits made offline queue up and sync the next time you're online.
- **A whole team** can share one Supabase project — each person signs in with
  their own account and sees only their own customers. See the next section
  for the store and the manager board.

## Teams and the manager board

A **store** groups accounts on one project: reps and one or more managers. A
manager sees the board under **+ → Team** — every rep's touches,
appointments set and shown, units against goal and pace, untouched new
leads and overdue follow-ups, today and month to date — and can open a rep's
lists and any customer on them, read-only. Reps keep their own books and
never see each other's.

Who can do what:

- **Admin** — the dealership's owner of the app. Creates stores, appoints and
  demotes managers, adds people by email, renames or deletes a store. Admins
  are set in the database by whoever holds the Supabase project; there is no
  button for it, so nobody can make themselves a manager.
- **Manager** — sees the board and any rep's customers, read-only; can remove
  a rep from the store.
- **Rep** — joins by invite link or code; their book stays their own.

Setup:

1. Re-run [`schema.sql`](./schema.sql) in **SQL Editor** (it's safe to
   re-run). This adds the `stores`, `store_members` and `admins` tables, the
   database functions the app calls, and a policy that lets a manager *read*
   their store's members' records. Writing stays owner-only.
2. Make yourself the admin. The account has to exist first (sign up in the
   app), then in **SQL Editor**:

   ```sql
   insert into public.admins (user_id)
     select id from auth.users where email = 'you@example.com'
     on conflict do nothing;
   ```

3. Open **+ → Team**, name the store and tap **Create the store**. You
   join it as its first manager and get an invite link. To make someone else
   a manager, add their sign-in email in the admin section with the role set
   to Manager (they need to have signed up first).
4. Each rep signs in to their own cloud account, taps the invite link (or
   types the code under + → Team), and they're on the board.

The board reads the reps' synced records, so a rep's numbers are as current
as their last sync.

What a manager can write into a rep's book is deliberately narrow, and each
goes through a database function that checks the manager relationship:

- **Appointment outcomes** — confirmed, showed, no-show, sold, and a manager
  note — from the Appointments tab. They land in the rep's own calendar on
  their next sync.
- **Monthly targets** — units and appointments set — per rep, from the Team
  tab. The rep's app adopts them as its goals for the month.

- **The store's lot** — the website import fills a shared inventory for the
  store as well as the importer's own book (re-run `schema.sql` and paste
  the function to get this). Every member's app pulls it, so a rep who
  never imported still has the lot for their radar, and the manager's read
  of a customer prices every one of them against it: what they could drive
  for the money they pay now.
- **Reminders** — Log → Reminders in the rep's app: a to-do with a
  time. The function's ten-minute sweep pushes it at that time (quiet
  hours and the proactive switch don't hold it back — the rep asked), once;
  with the app open the phone shows it itself. Needs notifications on
  (Settings → Notifications) to arrive with the app closed. Re-paste the
  function after this change.
- **The welcome text** — Home → Welcome text in the store's app. With it
  on, a customer a rep logs gets a text from the sales manager on the
  function's ten-minute sweep: 45–150 minutes after they're logged (a
  different delay per customer), never within 30 minutes of the rep's own
  text, only in the store's day, once. It logs in the rep's conversation
  with the customer, marked as the manager's. Needs Twilio on the function
  (the same setup as texting). A customer who left only an email address
  gets the welcome by email instead (needs the Resend setup below), filed
  on their page.
- **The manager's email** — Home → Email in the store's app, or the Email
  button on any customer's sheet, or by voice ("email Dana and thank her
  for coming in"). It sends through the function as the manager
  (`{memail}`; needs Resend) and is filed in the rep's book against the
  customer, marked as the manager's, so the rep sees it on the customer's
  page. The manager's own Outlook can be connected from the same sheet
  (the Entra setup below): a reply from a customer on any rep's book is
  filed into that rep's book through `manager_log_email`.
- **Timing** — when it makes sense, not whether. Every owner on a book is
  put in the month their window opens: equity clears $3,000 as the payoff
  comes down (amortised at their rate) and the value drifts (about 12% a
  year), a like-for-like on the shared lot lands at their payment, the
  contract runs out, or a lease is six months from its end. A rep has it
  under + → Timing with a follow-up set for that month (one at a time
  or all at once); the manager has it as the Timing and Lease ends views
  on Customers, handing a customer to their rep as a to-do due in that
  month. Both assistants answer "when does it make sense for Dana" and
  "when do our leases end". The month is an estimate from what's on file.
- **The manager's voice assistant** — the Voice button in the store's app.
  The same hands-free panel as a rep's, with the store's tools instead of a
  book's: where the store stands, a rep's day, fresh leads waiting, who to
  reach out to, a customer's story, the calendar, the huddle, insights;
  nudges and to-dos to a rep's phone, targets, appointment outcomes, the
  welcome, an email to a customer or a rep. Needs the voice agent set up
  (the function URL in Settings), like a rep's.
- **A to-do** — from the Customers tab, the manager hands a rep one customer
  to reach out to, with the reasons in the title. One task row in the rep's
  book, which their app shows in the queue on the next sync.

Nudges (a push notification to a rep's phone — a fresh lead waiting, an
appointment to confirm, a no-show to rebook) go through the function, which
checks the same relationship. They need push notifications set up (VAPID
keys on the function) and the rep to have turned notifications on.

## Calendar feeds (Apple / Outlook / Google)

To show your outside calendars *inside* viniva (read-only), the app subscribes to
each calendar's `.ics` feed. Browsers can't fetch those directly, so your
Supabase function fetches them for you — **the same function that powers the
voice agent** doubles as the calendar proxy (POST runs the agent, GET proxies a
feed). No second function or URL is needed.

### 1. Make sure your function has the calendar update (once)

If you deployed the voice agent before calendar feeds existed, update it: in
Supabase → **Edge Functions** → your function, replace its code with the latest
[`functions/voice-agent/index.ts`](./functions/voice-agent/index.ts) and deploy.
(Or with the CLI: `supabase functions deploy voice-agent --no-verify-jwt`.)

viniva automatically routes feeds through your voice agent URL. If you'd rather
run a separate proxy, deploy
[`functions/ics-proxy/index.ts`](./functions/ics-proxy/index.ts) and paste its
URL into **Settings → Calendar feeds → Calendar proxy URL** — that field
overrides the default.

### 2. Get each calendar's feed URL

- **Google:** Calendar → *Settings* → your calendar → **"Secret address in iCal
  format"** (copy the `.ics` link).
- **Apple:** Calendar app → share a calendar → **Public Calendar** → copy the
  `webcal://…` link (viniva handles `webcal://` automatically).
- **Outlook:** Calendar → **Share → Publish** → copy the **ICS** link. On a
  work/O'Regan's account this may be turned off by IT — if so, that one waits.

Add each in **Settings → Calendar feeds → Add a calendar**, then **Refresh now**.
Events are read-only, cached on your device, and refresh automatically. (To push
viniva's own appointments the other way, into your calendar, use "Add to
calendar" on any appointment.)

The proxy only fetches known calendar hosts (Google/Apple/Outlook/Yahoo). Add
more in the `ALLOW` list in the function if you use another provider.

## Voice agent (Claude)

Makes the Voice button a real assistant: speak in plain language and it runs the
task — "book Ken a test drive Thursday at 4", "mark Sara's appointment sold",
"log a sale for Moe, commission 800", "add a task to call the bank tomorrow".

A Supabase Edge Function holds your Anthropic API key (never in the app), asks
Claude what to do, and returns the actions; the app runs them on-device.

### Deploy

1. Get an API key at [console.anthropic.com](https://console.anthropic.com).
2. Store it as a secret and deploy the function:
   ```
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy voice-agent --no-verify-jwt
   ```
   The function is in [`functions/voice-agent/index.ts`](./functions/voice-agent/index.ts).
3. Paste the printed URL into viniva → **Settings → Voice agent → Voice agent URL**.

Notes: usage costs a small amount per request (billed by Anthropic). To change
the model, set a `MODEL` secret (default Claude Sonnet 5.5; `EFFORT` defaults to
medium). Leave the URL blank in viniva to keep using the free, offline
on-device commands.

### Who can spend your key

Anyone can make an account in the app, and signing in only proves who someone
is. So the function decides who may use the model, and how much:

1. **Run [`agent-usage.sql`](./agent-usage.sql) once** (SQL Editor → paste →
   Run). It makes the table the daily spend is counted in. Only the function
   can read or write it, so nobody can reset their own count. Until it's run,
   the budgets below are off.
2. **Set `AGENT_EMAILS`** to the accounts that may use the assistant, comma
   separated: `supabase secrets set AGENT_EMAILS=you@example.com`. Anyone in
   your store (they joined with a manager's invite code) is in without being
   listed. Unset, any signed-in account can use it, which is how it worked
   before.
3. **Budgets** (optional): `AGENT_DAILY_USD` per person, default 5, and
   `AGENT_DAILY_USD_TOTAL` for everyone together, default 50. A person over
   budget hears "You've used today's assistant budget. It resets overnight."
   To see the spend:
   `select day, sum(usd), sum(calls) from agent_usage group by day order by day desc;`

Every request is also capped in size and in output, whatever the app sends.

### The managers' sweep and the manager's texts

The same ten-minute sweep (`viniva-sweep` in `cron.sql`) also pushes each
manager with notifications on about what's costing business on the floor:
a customer waiting more than fifteen minutes on a reply, a new lead nobody
has touched for thirty, an appointment two hours out that isn't confirmed.
Each once, inside the manager's business hours, tapping through to the
Floor. Nothing to set up beyond notifications on the manager's phone.

A manager can text any rep's customer from the Floor (a reply the rep
hasn't got to, a confirmation) — `{"mtext": {"rep", "leadId", "body"}}` —
from the store's `TWILIO_FROM` number, filed in the rep's thread marked as
the manager's; the customer's reply comes back to the rep's thread. A text
with a dollar amount or a rate in it is refused.

### The night read

The 2am job (`cron.sql`) hands each rep to their own run of the function, so
a big store doesn't run out of time partway through. It plans the day that's
starting, and reads each rep at most once a day however often the URL is
posted to. The per-rep runs call the function at
`<SUPABASE_URL>/functions/v1/quick-api`; if yours has another name, set
`SELF_URL` to its URL. If a per-rep call can't be made, that rep's read runs
in the main run instead.

## Email sending (optional)

The same function can also send real emails — used for automated cadence
follow-ups (viniva → **Settings → Email**) . It sends through
[Resend](https://resend.com) (free tier ~100 emails/day):

1. Create a Resend account and **verify a domain you own**, so emails come from
   your address and don't land in spam.
2. In Supabase → Edge Functions → **Secrets**, add:
   - `RESEND_API_KEY` — from the Resend dashboard
   - `EMAIL_FROM` — e.g. `Parm Shokar <parm@yourdomain.com>`
3. Make sure the function is on the latest code, then in viniva →
   **Settings → Email** use **Send a test email**.

With the "send automatically" toggle on, any due cadence steps whose channel is
email go out when you open the app (capped, logged to each lead's email
history, and skipped for leads with no email or already sold/lost).

## Outlook (send from your own address, read customer replies)

Connect your Outlook once and email works both ways: what viniva sends —
follow-up emails, appointment reminders, the test — goes out from your own
mailbox and lands in your Sent Items, and customer replies are filed into
each lead's email history automatically. This runs entirely on your phone —
the app signs into Microsoft directly (OAuth + PKCE), tokens stay on the
device, and only mail from your customers is kept. No server involved, and
no Resend needed. (A connection made before sending existed reads only; tap
Connect Outlook again to allow sending.)

### One-time setup (~5 minutes)

1. Go to [entra.microsoft.com](https://entra.microsoft.com) → **App
   registrations** → **New registration**. Name it "viniva".
2. Supported account types: **Accounts in any organizational directory and
   personal Microsoft accounts**.
3. Redirect URI: pick platform **Single-page application (SPA)** and enter your
   app's URL (e.g. `https://entoa.ai/`). The SPA platform type is required —
   it's what lets the app exchange tokens without a server secret.
4. Copy the **Application (client) ID** and paste it into viniva →
   **Settings → Email → Your Outlook**, then tap **Connect Outlook** and sign
   in with the mailbox you sell from. Allow **Read your mail** and **Send
   mail as you**. One registration serves the whole store: every rep pastes
   the same ID and signs in with their own mailbox.

Mail is matched to customers by email address first, then by exact name (a
name match backfills the customer's email address). Unmatched mail is ignored
and never stored. viniva checks in the background when you open the app, or on
demand with **Check mail now**.

Note: a work mailbox (e.g. O'Regan's) may require IT to approve the sign-in
the first time (Microsoft calls this admin consent). A personal
Outlook/Hotmail account works with no approval.

## Gmail (send from your Gmail address, read customer replies)

The same two halves as Outlook, for a Google account. Reading and sending
happen on the phone; only the sign-in's token exchange goes through the
function, because Google requires the client secret for it.

### One-time setup (~15 minutes)

1. At [console.cloud.google.com](https://console.cloud.google.com) create a
   project (or pick one), then **APIs & Services → Library** and enable the
   **Gmail API**.
2. **APIs & Services → OAuth consent screen**: External, app name "viniva",
   your email as the contact. Under **Test users** add every Google account
   that will connect (Google allows up to 100 without a review; each user
   sees an "unverified app" warning and taps **Advanced → Go to viniva**).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   type **Web application**; under **Authorised redirect URIs** add your app's
   URL exactly as the browser shows it (e.g. `https://entoa.ai/`).
4. Copy the **Client ID** into viniva → **Settings → Email → Gmail**, and the
   **Client secret** into Supabase → Edge Functions → **Secrets** as
   `GOOGLE_CLIENT_SECRET`. Re-paste the function after this update.
5. Tap **Connect Gmail**, sign in, allow reading and sending.

Outlook takes precedence when both are connected. Everything else — matching
replies to customers, filing, automated sends — works exactly as for Outlook.

## Self-serve booking page

Your personal booking link (viniva → **Settings → Booking page**) lets customers
pick their own appointment slot — no back-and-forth. The public page lives at
`/book.html`; the booking API is two more routes on the same Edge Function
(`GET ?avail=1` for taken slots, `POST {book}` to book). A booking is written
directly into your synced `records` as a confirmed appointment (using the
function's service-role access), so it appears in the app on the next sync, the
customer is auto-created as a lead, and — if the Resend email secrets are set —
they get a confirmation email on the spot. Double-booking is rejected
server-side.

Requirements: cloud sync signed in (bookings travel through it) and the
function on the latest code. Bookable days/hours/slot length are set in the
same Settings section; the link encodes them.

## Paperwork on sales (`storage.sql`)

The Sold screen keeps photos and scans of each sale's paperwork. They go to a
private bucket called `docs`, each account under its own folder. Run
[`storage.sql`](./storage.sql) once in **SQL Editor** to create the bucket and
its policy. Until then the files stay on the phone only (the screen says so).
