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
