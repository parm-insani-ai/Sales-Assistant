// The salesperson's own lists: named buckets they put customers into by hand
// — a callback list, the people who were interested but didn't commit to an
// appointment, the ones to invite to the spring event. Not a rule, not a
// cut: a membership, kept on the record so it syncs with everything else.
//
// A list is one row in the "lists" collection: { id, name, ids: [leadId…],
// at }. A customer can sit on any number of lists. On Outreach each list is
// a chip on the Cut row with its count, and the bar under it can call, text
// or email the list. Everywhere a customer is worked — their page, the
// session's "How did it go?", the card — they can be put on a list in a tap.

import * as store from "./store.js";

const norm = (s) => String(s || "").trim().replace(/\s+/g, " ");
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

// Every list, newest first; the ids cleaned of customers no longer on file.
// Read once per change to the lists or the book — a card per customer asks.
let cache = { key: "", lists: [] };
export function memberLists() {
  const key = store.generation("lists") + ":" + store.generation("leads");
  if (cache.key === key) return cache.lists;
  const leads = new Set(store.all("leads").map((l) => l.id));
  const lists = store.all("lists")
    .filter((x) => x && x.name)
    .map((x) => ({ ...x, ids: (Array.isArray(x.ids) ? x.ids : []).filter((id) => leads.has(id)) }))
    .sort((a, b) => String(b.at || b.createdAt || "").localeCompare(String(a.at || a.createdAt || "")));
  cache = { key, lists };
  return lists;
}
export function listById(id) { return memberLists().find((x) => x.id === id) || null; }
export function listByName(name) { return memberLists().find((x) => same(x.name, name)) || null; }

// A new list by name; an existing one of that name is returned as is.
export function createList(name) {
  const n = norm(name);
  if (!n) return null;
  const had = listByName(n);
  if (had) return had;
  return store.create("lists", { name: n, ids: [], at: new Date().toISOString() });
}
export function renameList(id, name) {
  const n = norm(name); const x = store.get("lists", id);
  if (!x || !n) return null;
  return store.update("lists", id, { name: n, at: new Date().toISOString() });
}
export function deleteList(id) { const x = store.get("lists", id); if (x) store.remove("lists", id); return !!x; }

// Membership.
export function onList(listId, leadId) { const x = store.get("lists", listId); return !!(x && Array.isArray(x.ids) && x.ids.includes(leadId)); }
export function addToList(listId, leadIds) {
  const x = store.get("lists", listId); if (!x) return 0;
  const ids = Array.isArray(x.ids) ? x.ids.slice() : [];
  let added = 0;
  for (const id of [].concat(leadIds)) if (id && !ids.includes(id)) { ids.push(id); added++; }
  if (added) store.update("lists", listId, { ids, at: new Date().toISOString() });
  return added;
}
export function removeFromList(listId, leadIds) {
  const x = store.get("lists", listId); if (!x) return 0;
  const drop = new Set([].concat(leadIds));
  const ids = (Array.isArray(x.ids) ? x.ids : []).filter((id) => !drop.has(id));
  const removed = (x.ids || []).length - ids.length;
  if (removed) store.update("lists", listId, { ids, at: new Date().toISOString() });
  return removed;
}
export function toggleMember(listId, leadId) {
  if (onList(listId, leadId)) { removeFromList(listId, leadId); return false; }
  addToList(listId, leadId); return true;
}
// The lists one customer is on.
export function listsOf(leadId) { return memberLists().filter((x) => x.ids.includes(leadId)); }

// "Put Dana on my callback list" — by name, made if it isn't there yet.
export function addByName(name, leadIds) {
  const x = createList(name); if (!x) return null;
  const added = addToList(x.id, leadIds);
  return { list: listById(x.id) || x, added };
}
