-- The store's owner book: every customer the dealership has, loaded once
-- by a manager, ranked by the app with the reasons they're worth a call,
-- and dealt out to reps so nobody is contacted twice.
--
-- A row is a customer as the export described them (the same fields the
-- rep-side import reads: payment, payoff, value, purchase date, lease end,
-- rate, term, kilometres, service dates). `status` is where they are:
--   new       — in the pool, nobody's yet
--   assigned  — handed to a rep: a lead in that rep's book carries
--               storeCustomerId, and the rep's record is the truth from then
--   skip      — a manager set them aside (wrong number, moved away, do not contact)
-- Managers (and the function, with the service role) write; members read.
--
-- Run this once in the SQL editor after schema.sql.

create table if not exists public.store_customers (
  store_id    uuid        not null references public.stores (id) on delete cascade,
  id          text        not null,
  data        jsonb       not null default '{}'::jsonb,
  status      text        not null default 'new',
  assigned_to uuid        references auth.users (id) on delete set null,
  assigned_at timestamptz,
  updated_at  timestamptz not null default now(),
  deleted     boolean     not null default false,
  primary key (store_id, id)
);
create index if not exists store_customers_status on public.store_customers (store_id, status);
alter table public.store_customers enable row level security;
drop policy if exists "members read their store's book" on public.store_customers;
create policy "members read their store's book"
  on public.store_customers for select
  using (store_id in (select public.my_store_ids()));
grant select on public.store_customers to authenticated;

-- The book, for a manager or admin: every live row, or those changed since.
create or replace function public.store_book(store uuid, since timestamptz default null) returns json
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() or exists (select 1 from public.store_members where store_id = store and user_id = auth.uid() and role = 'manager') then
    coalesce((select json_agg(json_build_object('id', c.id, 'data', c.data, 'status', c.status, 'assigned_to', c.assigned_to, 'assigned_at', c.assigned_at, 'updated_at', c.updated_at, 'deleted', c.deleted) order by c.updated_at)
              from public.store_customers c where c.store_id = store and (since is null or c.updated_at > since)), '[]'::json)
  else '[]'::json end
$$;

-- Load rows into the book: `rows` is a JSON array of customer objects with
-- an id (the VIN when the export has one, else the phone). A row already
-- there keeps its status and assignment and takes the newer fields.
create or replace function public.store_book_upsert(store uuid, rows jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare r jsonb; n integer := 0; fresh integer := 0;
begin
  if not public.is_admin() and not exists (select 1 from public.store_members where store_id = store and user_id = auth.uid() and role = 'manager')
  then raise exception 'only a manager of the store can do that'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    if coalesce(r->>'id', '') = '' then continue; end if;
    insert into public.store_customers (store_id, id, data) values (store, r->>'id', r)
      on conflict (store_id, id) do update set data = public.store_customers.data || excluded.data, deleted = false, updated_at = now();
    if found then n := n + 1; end if;
  end loop;
  select count(*) into fresh from public.store_customers where store_id = store and status = 'new' and not deleted;
  return json_build_object('written', n, 'unassigned', fresh);
end $$;

-- Hand a customer to a rep: a lead in the rep's book (marked as the store's,
-- never a fresh lead), a to-do with the reasons, and the row marked assigned.
create or replace function public.store_book_assign(store uuid, customer_id text, member uuid, why text default '') returns json
language plpgsql security definer set search_path = public as $$
declare c public.store_customers; lid text; tid text; nowiso text; lead jsonb; by text;
begin
  if not public.is_admin() and not exists (select 1 from public.store_members where store_id = store and user_id = auth.uid() and role = 'manager')
  then raise exception 'only a manager of the store can do that'; end if;
  if not exists (select 1 from public.store_members where store_id = store and user_id = member) then raise exception 'they are not in this store'; end if;
  select * into c from public.store_customers where store_id = store and id = customer_id and not deleted;
  if c.id is null then raise exception 'no such customer in the book'; end if;
  if c.status = 'assigned' then raise exception 'already handed out'; end if;
  nowiso := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  lid := 'sb_' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  select coalesce(name, '') into by from public.store_members where store_id = store and user_id = auth.uid();
  lead := (c.data - 'id') || jsonb_build_object('id', lid, 'storeCustomerId', c.id, 'source', coalesce(c.data->>'source', 'Owner book'), 'stage', coalesce(c.data->>'stage', 'delivered'),
    'importedAt', nowiso, 'handedAt', nowiso, 'handedBy', auth.uid(), 'createdAt', coalesce(c.data->>'createdAt', nowiso), 'updatedAt', nowiso);
  insert into public.records (id, user_id, collection, data) values (lid, member, 'leads', lead);
  tid := 'tsk_' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  insert into public.records (id, user_id, collection, data) values (tid, member, 'tasks', jsonb_build_object(
    'id', tid, 'leadId', lid, 'title', 'Reach out to ' || coalesce(c.data->>'name', 'customer') || case when coalesce(why, '') <> '' then ' — ' || why else '' end || ' (from ' || coalesce(nullif(by, ''), 'your manager') || ')',
    'due', to_char(now() at time zone 'utc', 'YYYY-MM-DD'), 'channel', 'call', 'kind', 'reach', 'priority', 'high', 'source', 'manager', 'fromManager', true, 'setBy', auth.uid(), 'done', false, 'createdAt', nowiso, 'updatedAt', nowiso));
  update public.store_customers set status = 'assigned', assigned_to = member, assigned_at = now(), updated_at = now() where store_id = store and id = customer_id;
  return json_build_object('leadId', lid, 'taskId', tid);
end $$;

-- Set a customer aside, or put them back in the pool.
create or replace function public.store_book_status(store uuid, customer_id text, new_status text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and not exists (select 1 from public.store_members where store_id = store and user_id = auth.uid() and role = 'manager')
  then raise exception 'only a manager of the store can do that'; end if;
  if new_status not in ('new', 'skip') then raise exception 'status must be new or skip'; end if;
  update public.store_customers set status = new_status, assigned_to = null, assigned_at = null, updated_at = now() where store_id = store and id = customer_id;
  return json_build_object('ok', true);
end $$;

grant execute on function public.store_book(uuid, timestamptz) to authenticated;
grant execute on function public.store_book_upsert(uuid, jsonb) to authenticated;
grant execute on function public.store_book_assign(uuid, text, uuid, text) to authenticated;
grant execute on function public.store_book_status(uuid, text, text) to authenticated;
