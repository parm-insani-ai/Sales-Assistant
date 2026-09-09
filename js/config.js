// Build-time backend defaults.
//
// The Supabase project URL and anon key are what a device uses to reach the
// account. They used to live only in Settings — that is, only in localStorage —
// which made a wiped install unrecoverable in a way that isn't obvious until it
// happens: every customer, text and appointment is sitting safe in the cloud,
// and the app has just lost the one thing it needs to go and get them. There is
// no sync fix for that, because the credentials are what sync runs on.
//
// Shipping them with the app breaks the loop. Reinstall, sign in, everything
// comes back.
//
// The anon key is meant to be public — it is served to every browser that opens
// the app, and it grants nothing on its own. Row-level security is what protects
// the data: every row is scoped to `user_id = auth.uid()`, so the key can only
// ever read what the signed-in person already owns. Do NOT put the SERVICE ROLE
// key here; that one bypasses RLS and belongs only in the Edge Function's
// environment.
//
// Anything saved in Settings still wins over these — this is the floor, not an
// override.
export const BACKEND_DEFAULTS = {
  // e.g. "https://abcdefghijklmnop.supabase.co"
  url: "",
  // Supabase → Project Settings → API → Project API keys → `anon` `public`
  anonKey: "",
};
