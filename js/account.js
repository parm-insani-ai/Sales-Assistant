// Whose phone this is.
//
// Everything on the device — customers, texts, settings — belongs to the
// account that put it there. The store itself is one book with no name on it,
// so this stamps the book with the signed-in account and, when a different
// account signs in, starts a fresh one. Without that, the second person to
// sign in on a phone inherits the first person's customers and settings, and
// the next sync copies all of it into their account.

import * as store from "./store.js";

const OWNER = "viniva:owner";

// Local state that describes the previous account's book: what they were
// looking at, what they dismissed, what the sync cursor had reached. None of
// it means anything against a different account's records.
const PER_ACCOUNT_KEYS = [
  "viniva:sync", "viniva:prospects", "viniva:leads-spot", "viniva:leads-filter", "viniva:leads-opp",
  "viniva:outreach-pending", "viniva:playdismiss", "viniva:played", "viniva:sms-prefill", "viniva:autoemail-warned",
];

export function owner() {
  try { return localStorage.getItem(OWNER) || null; } catch { return null; }
}

/**
 * Stamp the device with the signed-in account. Returns true when the phone
 * belonged to a different account and was cleared for this one. A phone from
 * before stamping existed has no owner yet; whoever is signed in claims it.
 */
export function claimDevice(user) {
  if (!user || !user.id) return false;
  const was = owner();
  let cleared = false;
  if (was && was !== user.id) {
    store.resetForNewOwner();
    PER_ACCOUNT_KEYS.forEach((k) => { try { localStorage.removeItem(k); } catch { } });
    cleared = true;
  }
  try { localStorage.setItem(OWNER, user.id); } catch { }
  return cleared;
}

// The address you signed in with is your address, until you say otherwise.
// Runs after the first sync has had its say, so a contact email already in
// the account's settings wins over the sign-in one.
export function adoptSignInEmail(user) {
  const email = String(user?.email || "").trim();
  if (!email) return false;
  if (String(store.getSettings().contactEmail || "").trim()) return false;
  store.updateSettings({ contactEmail: email });
  return true;
}
