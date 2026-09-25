-- viniva cloud backend — database schema.
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query →
-- paste all of this → Run. Safe to re-run (idempotent).
--
-- Design: the app is local-first. Every record from any collection (leads,
-- vehicles, tasks, sales, spifs, specials, appointments, deliveries, activity)
-- is mirrored into ONE table as a JSON blob, partitioned by the signed-in user.
-- This keeps the schema tiny and means new app features never need a migration.
-- Row-Level Security guarantees each user can only ever see or touch their own
-- rows — so the same database safely serves a whole team, each private.

create table if not exists public.records (
  id          text        not null,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  collection  text        not null,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  deleted     boolean     not null default false,
  primary key (user_id, id)
);

create index if not exists records_user_updated_idx on public.records (user_id, updated_at);
create index if not exists records_user_coll_idx    on public.records (user_id, collection);

alter table public.records enable row level security;

-- One policy covers select/insert/update/delete: you may only reach rows whose
-- user_id is your own auth id. The WITH CHECK stops anyone writing rows for
-- another user.
drop policy if exists "records are private to their owner" on public.records;
create policy "records are private to their owner"
  on public.records
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Table-level privileges for the roles PostgREST uses. RLS (above) still limits
-- WHICH rows each user can touch; these GRANTs just allow reaching the table at
-- all. Without them you get "permission denied for table records".
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.records to anon, authenticated;

-- Keep updated_at honest even if a client forgets to set it.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists records_touch_updated on public.records;
create trigger records_touch_updated
  before insert or update on public.records
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Stores and teams.
--
-- A store has members; one or more of them are managers. A manager can READ
-- every member's records — that is what fills the manager board and lets
-- them open a rep's customer page — and nothing else: writing stays with
-- the owner of each row, and reps see nothing of each other. Re-run safe.

create table if not exists public.stores (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  invite_code text        not null unique,
  created_by  uuid        not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.store_members (
  store_id  uuid        not null references public.stores (id) on delete cascade,
  user_id   uuid        not null references auth.users (id) on delete cascade,
  role      text        not null default 'rep' check (role in ('manager', 'rep')),
  name      text        not null default '',
  email     text        not null default '',
  joined_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
create index if not exists store_members_user_idx on public.store_members (user_id);

alter table public.stores        enable row level security;
alter table public.store_members enable row level security;

-- Admins: the dealership's owner of the app. Only an admin can create a
-- store or appoint and demote managers, so nobody can make themselves a
-- manager by tapping a button. Admins are set here, by whoever holds the
-- Supabase project — there is no screen for it:
--
--   insert into public.admins (user_id)
--     select id from auth.users where email = 'you@example.com'
--     on conflict do nothing;
create table if not exists public.admins (
  user_id  uuid        primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

-- The store(s) the signed-in user belongs to. SECURITY DEFINER so a policy
-- on store_members can consult it without recursing into its own policy.
create or replace function public.my_store_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select store_id from public.store_members where user_id = auth.uid()
$$;

-- Does the signed-in user manage the store that `target` belongs to?
create or replace function public.manages(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.store_members me
    join public.store_members them on them.store_id = me.store_id
    where me.user_id = auth.uid() and me.role = 'manager' and them.user_id = target
  )
$$;

drop policy if exists "members see their store" on public.stores;
create policy "members see their store"
  on public.stores for select
  using (id in (select public.my_store_ids()));

drop policy if exists "members see their store's members" on public.store_members;
create policy "members see their store's members"
  on public.store_members for select
  using (store_id in (select public.my_store_ids()));

-- Records: a manager may read their store's members' rows. The owner-only
-- policy above still governs every write.
drop policy if exists "managers read their store's records" on public.records;
create policy "managers read their store's records"
  on public.records for select
  using (public.manages(user_id));

grant select on public.stores to authenticated;
grant select on public.store_members to authenticated;

-- The signed-in user's store: its name, invite code, their role, and the
-- members. Null when they're not in one. `admin` says whether they are one.
create or replace function public.my_store() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', s.id, 'name', s.name, 'code', s.invite_code, 'role', me.role, 'admin', public.is_admin(),
    'members', (
      select coalesce(json_agg(json_build_object(
        'user_id', m.user_id, 'role', m.role, 'name', m.name, 'email', m.email, 'joined_at', m.joined_at
      ) order by m.role, m.name, m.email), '[]'::json)
      from public.store_members m where m.store_id = s.id
    )
  )
  from public.store_members me
  join public.stores s on s.id = me.store_id
  where me.user_id = auth.uid()
  limit 1
$$;

-- Create a store; the creator is its first manager.
create or replace function public.create_store(store_name text, display_name text default '') returns json
language plpgsql security definer set search_path = public as $$
declare s public.stores; code text; em text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if not public.is_admin() then raise exception 'only an admin can create a store'; end if;
  if trim(coalesce(store_name, '')) = '' then raise exception 'the store needs a name'; end if;
  code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.stores (name, invite_code, created_by) values (trim(store_name), code, auth.uid()) returning * into s;
  -- The admin joins the new store as its manager unless they're already in
  -- one; a second store is run from the admin screen.
  if not exists (select 1 from public.store_members where user_id = auth.uid()) then
    select email into em from auth.users where id = auth.uid();
    insert into public.store_members (store_id, user_id, role, name, email)
      values (s.id, auth.uid(), 'manager', trim(coalesce(display_name, '')), coalesce(em, ''));
  end if;
  return public.my_store();
end $$;

-- Join a store by its invite code, as a rep.
create or replace function public.join_store(code text, display_name text default '') returns json
language plpgsql security definer set search_path = public as $$
declare s public.stores; em text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into s from public.stores where invite_code = lower(trim(coalesce(code, '')));
  if s.id is null then raise exception 'no store has that invite code'; end if;
  if exists (select 1 from public.store_members where user_id = auth.uid() and store_id <> s.id) then raise exception 'you are already in another store'; end if;
  select email into em from auth.users where id = auth.uid();
  insert into public.store_members (store_id, user_id, role, name, email)
    values (s.id, auth.uid(), 'rep', trim(coalesce(display_name, '')), coalesce(em, ''))
    on conflict (store_id, user_id) do update
      set name = case when excluded.name <> '' then excluded.name else public.store_members.name end;
  return public.my_store();
end $$;

-- What the store calls me.
create or replace function public.set_my_name(display_name text) returns json
language plpgsql security definer set search_path = public as $$
begin
  update public.store_members set name = trim(coalesce(display_name, '')) where user_id = auth.uid();
  return public.my_store();
end $$;

-- Change a member's role in a store, or remove them.
--   An admin can do anything in any store (pass its id, or null for your own).
--   A manager can remove a rep from their own store — nothing more: appointing
--   and demoting managers is the admin's call.
create or replace function public.set_member_role(member uuid, new_role text, store uuid default null) returns json
language plpgsql security definer set search_path = public as $$
declare sid uuid; target_role text; admin boolean := public.is_admin();
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if admin and store is not null then sid := store;
  else select store_id into sid from public.store_members where user_id = auth.uid(); end if;
  if sid is null then raise exception 'you are not in a store'; end if;
  select role into target_role from public.store_members where store_id = sid and user_id = member;
  if target_role is null then raise exception 'they are not in that store'; end if;
  if not admin then
    if not exists (select 1 from public.store_members where store_id = sid and user_id = auth.uid() and role = 'manager')
    then raise exception 'only a manager can do that'; end if;
    if new_role <> 'remove' then raise exception 'only an admin can appoint or demote a manager'; end if;
    if target_role = 'manager' then raise exception 'only an admin can remove a manager'; end if;
  end if;
  if new_role = 'remove' then
    if member = auth.uid() then raise exception 'leave the store instead'; end if;
    delete from public.store_members where store_id = sid and user_id = member;
  elsif new_role in ('manager', 'rep') then
    update public.store_members set role = new_role where store_id = sid and user_id = member;
  else
    raise exception 'role must be manager, rep or remove';
  end if;
  return public.my_store();
end $$;

-- Admin: every store with its members.
create or replace function public.admin_stores() returns json
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then coalesce((
    select json_agg(json_build_object(
      'id', s.id, 'name', s.name, 'code', s.invite_code, 'created_at', s.created_at,
      'members', (select coalesce(json_agg(json_build_object('user_id', m.user_id, 'role', m.role, 'name', m.name, 'email', m.email, 'joined_at', m.joined_at) order by m.role, m.name, m.email), '[]'::json)
                  from public.store_members m where m.store_id = s.id)
    ) order by s.name) from public.stores s), '[]'::json)
  else null end
$$;

-- Admin: put an account into a store by its sign-in email, as a manager or
-- a rep. The account must already exist (they signed up in the app).
create or replace function public.admin_add_member(store uuid, member_email text, new_role text default 'rep', display_name text default '') returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'only an admin can do that'; end if;
  if new_role not in ('manager', 'rep') then raise exception 'role must be manager or rep'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(member_email)) limit 1;
  if uid is null then raise exception 'no account has signed up with that email yet'; end if;
  if not exists (select 1 from public.stores where id = store) then raise exception 'no such store'; end if;
  if exists (select 1 from public.store_members where user_id = uid and store_id <> store) then raise exception 'they are already in another store'; end if;
  insert into public.store_members (store_id, user_id, role, name, email)
    values (store, uid, new_role, trim(coalesce(display_name, '')), lower(trim(member_email)))
    on conflict (store_id, user_id) do update set role = excluded.role,
      name = case when excluded.name <> '' then excluded.name else public.store_members.name end;
  return public.admin_stores();
end $$;

-- Admin: rename a store, or delete it (members drop off; their books stay).
create or replace function public.admin_set_store(store uuid, new_name text default null, remove boolean default false) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'only an admin can do that'; end if;
  if remove then delete from public.stores where id = store;
  elsif new_name is not null and trim(new_name) <> '' then update public.stores set name = trim(new_name) where id = store; end if;
  return public.admin_stores();
end $$;

-- Leave the store. The last manager can't leave while others remain.
create or replace function public.leave_store() returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid; r text;
begin
  select store_id, role into sid, r from public.store_members where user_id = auth.uid();
  if sid is null then return; end if;
  if r = 'manager'
     and (select count(*) from public.store_members where store_id = sid and role = 'manager') = 1
     and (select count(*) from public.store_members where store_id = sid) > 1
  then raise exception 'make someone else a manager first'; end if;
  delete from public.store_members where store_id = sid and user_id = auth.uid();
  delete from public.stores where id = sid and not exists (select 1 from public.store_members where store_id = sid);
end $$;

grant execute on function public.my_store_ids() to authenticated;
grant execute on function public.manages(uuid) to authenticated;
grant execute on function public.my_store() to authenticated;
grant execute on function public.create_store(text, text) to authenticated;
grant execute on function public.join_store(text, text) to authenticated;
grant execute on function public.set_my_name(text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.set_member_role(uuid, text, uuid) to authenticated;
grant execute on function public.admin_stores() to authenticated;
grant execute on function public.admin_add_member(uuid, text, text, text) to authenticated;
grant execute on function public.admin_set_store(uuid, text, boolean) to authenticated;
-- The two-argument form from the first version of this file, if it was run.
drop function if exists public.set_member_role(uuid, text);
grant execute on function public.leave_store() to authenticated;

-- ---------------------------------------------------------------------------
-- What a manager can do TO a rep's book — narrowly.
--
-- Managers read everything in their store; they can write exactly two
-- things: an appointment's status (confirmed, showed, no-show, sold, notes)
-- and a rep's monthly targets. Both go through functions that check the
-- manager relationship, so the owner-only write policy on records stands.

-- Targets set by the store for a rep and a month ("2026-09").
create table if not exists public.store_targets (
  store_id   uuid not null references public.stores (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  goal_units integer not null default 0,
  goal_appts integer not null default 0,
  set_by     uuid,
  updated_at timestamptz not null default now(),
  primary key (store_id, user_id, month)
);
alter table public.store_targets enable row level security;
drop policy if exists "members see their store's targets" on public.store_targets;
create policy "members see their store's targets"
  on public.store_targets for select
  using (store_id in (select public.my_store_ids()));
grant select on public.store_targets to authenticated;

-- A manager (or admin) sets a rep's targets for a month.
create or replace function public.set_target(member uuid, target_month text, units integer, appts integer) returns json
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select store_id into sid from public.store_members where user_id = member;
  if sid is null then raise exception 'they are not in a store'; end if;
  if not public.is_admin() and not public.manages(member) then raise exception 'only a manager of their store can set targets'; end if;
  insert into public.store_targets (store_id, user_id, month, goal_units, goal_appts, set_by)
    values (sid, member, target_month, greatest(0, coalesce(units, 0)), greatest(0, coalesce(appts, 0)), auth.uid())
    on conflict (store_id, user_id, month) do update
      set goal_units = excluded.goal_units, goal_appts = excluded.goal_appts, set_by = excluded.set_by, updated_at = now();
  return public.targets_for_store(sid, target_month);
end $$;

-- Every target in a store for a month.
create or replace function public.targets_for_store(store uuid, target_month text) returns json
language sql stable security definer set search_path = public as $$
  select case when store in (select public.my_store_ids()) or public.is_admin() then
    coalesce((select json_agg(json_build_object('user_id', t.user_id, 'month', t.month, 'goal_units', t.goal_units, 'goal_appts', t.goal_appts))
              from public.store_targets t where t.store_id = store and t.month = target_month), '[]'::json)
  else '[]'::json end
$$;

-- My own target for a month, as the store set it. Null when none.
create or replace function public.my_target(target_month text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('month', t.month, 'goal_units', t.goal_units, 'goal_appts', t.goal_appts)
  from public.store_targets t where t.user_id = auth.uid() and t.month = target_month limit 1
$$;

-- A manager marks what happened to a rep's appointment. Only these keys
-- can change; the row must be one of the rep's appointments.
create or replace function public.manager_update_appointment(member uuid, appt_id text, patch jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare allowed jsonb; row_data jsonb;
begin
  if not public.is_admin() and not public.manages(member) then raise exception 'only a manager of their store can do that'; end if;
  allowed := jsonb_strip_nulls(jsonb_build_object(
    'confirmed', patch->'confirmed', 'outcome', patch->'outcome', 'status', patch->'status', 'managerNote', patch->'managerNote'));
  allowed := allowed || jsonb_build_object('updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  update public.records set data = data || allowed, updated_at = now()
    where user_id = member and id = appt_id and collection = 'appointments' and deleted = false
    returning data into row_data;
  if row_data is null then raise exception 'no such appointment'; end if;
  return row_data::json;
end $$;

grant execute on function public.set_target(uuid, text, integer, integer) to authenticated;
grant execute on function public.targets_for_store(uuid, text) to authenticated;
grant execute on function public.my_target(text) to authenticated;
grant execute on function public.manager_update_appointment(uuid, text, jsonb) to authenticated;

-- A manager hands a rep a job: "reach out to Dana Muise — lease ends in 2
-- months". One task row in the rep's book, and nothing else.
create or replace function public.manager_add_task(member uuid, task jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare tid text; nowiso text; row_data jsonb;
begin
  if not public.is_admin() and not public.manages(member) then raise exception 'only a manager of their store can do that'; end if;
  tid := 'tsk_' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  nowiso := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  row_data := jsonb_strip_nulls(jsonb_build_object(
    'id', tid, 'leadId', task->'leadId', 'title', task->'title', 'due', task->'due', 'channel', task->'channel',
    'note', task->'note', 'fromManager', true, 'setBy', auth.uid(), 'done', false, 'createdAt', nowiso, 'updatedAt', nowiso));
  if coalesce(row_data->>'title', '') = '' then raise exception 'the task needs a title'; end if;
  insert into public.records (id, user_id, collection, data) values (tid, member, 'tasks', row_data);
  return row_data::json;
end $$;
grant execute on function public.manager_add_task(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The store's shared inventory.
--
-- One lot for the whole store: what the website import reads lands here
-- as well as in the importing account's own book, every member's app pulls
-- it, and the manager's read of a customer prices against it. Managers (and
-- the function, with the service role) write it; members read it.
create table if not exists public.store_vehicles (
  store_id   uuid        not null references public.stores (id) on delete cascade,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted    boolean     not null default false,
  primary key (store_id, id)
);
alter table public.store_vehicles enable row level security;
drop policy if exists "members read their store's inventory" on public.store_vehicles;
create policy "members read their store's inventory"
  on public.store_vehicles for select
  using (store_id in (select public.my_store_ids()));
grant select on public.store_vehicles to authenticated;

-- The store's lot, for any member. Rows changed since `since` when given.
create or replace function public.store_inventory(store uuid, since timestamptz default null) returns json
language sql stable security definer set search_path = public as $$
  select case when store in (select public.my_store_ids()) or public.is_admin() then
    coalesce((select json_agg(json_build_object('id', v.id, 'data', v.data, 'updated_at', v.updated_at, 'deleted', v.deleted) order by v.updated_at)
              from public.store_vehicles v where v.store_id = store and (since is null or v.updated_at > since)), '[]'::json)
  else '[]'::json end
$$;

-- A manager (or admin) writes units into the store's lot: `rows` is a JSON
-- array of vehicle objects with an id. With `complete`, units not in the
-- list are marked sold.
create or replace function public.set_store_inventory(store uuid, rows jsonb, complete boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare r jsonb; ids text[] := '{}'; n integer := 0;
begin
  if not public.is_admin() and not exists (select 1 from public.store_members where store_id = store and user_id = auth.uid() and role = 'manager')
  then raise exception 'only a manager of the store can do that'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    if coalesce(r->>'id', '') = '' then continue; end if;
    ids := ids || (r->>'id');
    insert into public.store_vehicles (store_id, id, data, deleted) values (store, r->>'id', r, false)
      on conflict (store_id, id) do update set data = excluded.data, deleted = false, updated_at = now();
    n := n + 1;
  end loop;
  if complete then
    update public.store_vehicles set data = data || jsonb_build_object('status', 'sold', 'goneAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), updated_at = now()
      where store_id = store and not (id = any(ids)) and coalesce(data->>'status', 'available') <> 'sold';
  end if;
  return json_build_object('written', n);
end $$;

grant execute on function public.store_inventory(uuid, timestamptz) to authenticated;
grant execute on function public.set_store_inventory(uuid, jsonb, boolean) to authenticated;
