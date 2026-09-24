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
