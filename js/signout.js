// Signing out, from anywhere: Settings, or the tile in the "+" sheet.
//
// Anything still queued leaves for the cloud first — if the next person
// through the door is a different account, this book is about to go. Then
// the front door: sign in again, and pick up syncing. A different account
// starts over from Home, because which app this is (the rep's or the
// store's) is decided at boot from who they are.

import * as backend from "./backend.js";
import * as sync from "./sync.js";
import { showLogin } from "./login.js";
import { claimDevice } from "./account.js";
import { toast } from "./components.js";

export async function signOutNow({ after = null } = {}) {
  try { await sync.syncNow(); } catch { /* signing out anyway; the outbox stays on the phone */ }
  await backend.signOut();
  sync.disable();
  toast("Signed out");
  const user = await showLogin();
  const switched = claimDevice(user);
  if (switched) { location.hash = "#/"; location.reload(); return; }
  sync.enable(); sync.init(); sync.syncNow();
  if (after) after();
}
