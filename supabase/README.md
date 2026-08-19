# entoa cloud sync — setup

entoa works fully offline with no account. Turning on cloud sync adds a secure
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
4. **Connect the app.** In entoa: **Settings → Cloud sync & account**, paste the
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
  their own account and sees only their own customers.

## Calendar feeds (Apple / Outlook / Google)

To show your outside calendars *inside* entoa (read-only), the app subscribes to
each calendar's `.ics` feed. Browsers can't fetch those directly, so your
Supabase function fetches them for you — **the same function that powers the
voice agent** doubles as the calendar proxy (POST runs the agent, GET proxies a
feed). No second function or URL is needed.

### 1. Make sure your function has the calendar update (once)

If you deployed the voice agent before calendar feeds existed, update it: in
Supabase → **Edge Functions** → your function, replace its code with the latest
[`functions/voice-agent/index.ts`](./functions/voice-agent/index.ts) and deploy.
(Or with the CLI: `supabase functions deploy voice-agent --no-verify-jwt`.)

entoa automatically routes feeds through your voice agent URL. If you'd rather
run a separate proxy, deploy
[`functions/ics-proxy/index.ts`](./functions/ics-proxy/index.ts) and paste its
URL into **Settings → Calendar feeds → Calendar proxy URL** — that field
overrides the default.

### 2. Get each calendar's feed URL

- **Google:** Calendar → *Settings* → your calendar → **"Secret address in iCal
  format"** (copy the `.ics` link).
- **Apple:** Calendar app → share a calendar → **Public Calendar** → copy the
  `webcal://…` link (entoa handles `webcal://` automatically).
- **Outlook:** Calendar → **Share → Publish** → copy the **ICS** link. On a
  work/O'Regan's account this may be turned off by IT — if so, that one waits.

Add each in **Settings → Calendar feeds → Add a calendar**, then **Refresh now**.
Events are read-only, cached on your device, and refresh automatically. (To push
entoa's own appointments the other way, into your calendar, use "Add to
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
3. Paste the printed URL into entoa → **Settings → Voice agent → Voice agent URL**.

Notes: usage costs a small amount per request (billed by Anthropic). To change
the model, set a `MODEL` secret (default is a fast Haiku). Leave the URL blank in
entoa to keep using the free, offline on-device commands.

## Email sending (optional)

The same function can also send real emails — used for automated cadence
follow-ups (entoa → **Settings → Email**) . It sends through
[Resend](https://resend.com) (free tier ~100 emails/day):

1. Create a Resend account and **verify a domain you own**, so emails come from
   your address and don't land in spam.
2. In Supabase → Edge Functions → **Secrets**, add:
   - `RESEND_API_KEY` — from the Resend dashboard
   - `EMAIL_FROM` — e.g. `Parm Shokar <parm@yourdomain.com>`
3. Make sure the function is on the latest code, then in entoa →
   **Settings → Email** use **Send a test email**.

With the "send automatically" toggle on, any due cadence steps whose channel is
email go out when you open the app (capped, logged to each lead's email
history, and skipped for leads with no email or already sold/lost).

## Outlook inbox (read customer replies)

entoa can pull your Outlook inbox and file customer replies into each lead's
email history automatically. This runs entirely on your phone — the app signs
into Microsoft directly (OAuth + PKCE), tokens stay on the device, and only
mail from your customers is kept. No server involved.

### One-time setup (~5 minutes)

1. Go to [entra.microsoft.com](https://entra.microsoft.com) → **App
   registrations** → **New registration**. Name it "entoa".
2. Supported account types: **Accounts in any organizational directory and
   personal Microsoft accounts**.
3. Redirect URI: pick platform **Single-page application (SPA)** and enter your
   app's URL (e.g. `https://entoa.ai/`). The SPA platform type is required —
   it's what lets the app exchange tokens without a server secret.
4. Copy the **Application (client) ID** and paste it into entoa →
   **Settings → Email → Outlook inbox**, then tap **Connect Outlook** and sign
   in with the Microsoft account whose mail you want.

Mail is matched to customers by email address first, then by exact name (a
name match backfills the customer's email address). Unmatched mail is ignored
and never stored. entoa checks in the background when you open the app, or on
demand with **Check mail now**.

Note: a work mailbox (e.g. O'Regan's) may require IT to approve the sign-in
the first time (Microsoft calls this admin consent). A personal
Outlook/Hotmail account works with no approval.

## Self-serve booking page

Your personal booking link (entoa → **Settings → Booking page**) lets customers
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
