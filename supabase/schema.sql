-- entoa cloud backend — database schema.
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
