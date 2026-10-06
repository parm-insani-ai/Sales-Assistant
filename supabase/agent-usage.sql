-- viniva — the assistant's daily spend, kept where only the function can reach it.
-- Run this once: Dashboard → SQL Editor → New query → paste all of this → Run.
-- Safe to re-run.
--
-- The cloud function adds what each model call cost (from the usage the API
-- reports) and refuses calls once a person, or the store, has used the day's
-- budget: AGENT_DAILY_USD per person (default 5) and AGENT_DAILY_USD_TOTAL for
-- everyone (default 50), both secrets on the function. Until this has been
-- run there's nowhere to keep the count, and the budgets are off.
--
-- Not in the records table on purpose: a person can write their own records,
-- so a count kept there could be reset by the person it limits. This table has
-- row level security on and no policies, so only the service role — the
-- function — can read or write it.

create table if not exists public.agent_usage (
  user_id  uuid    not null references auth.users (id) on delete cascade,
  day      date    not null,
  usd      numeric not null default 0,
  calls    integer not null default 0,
  primary key (user_id, day)
);

alter table public.agent_usage enable row level security;
revoke all on public.agent_usage from anon, authenticated;

-- One call's cost, added in one statement so two calls at once both count.
create or replace function public.agent_add_usage(p_user uuid, p_day date, p_usd numeric)
returns numeric
language sql
security definer
set search_path = public
as $$
  insert into public.agent_usage (user_id, day, usd, calls)
  values (p_user, p_day, p_usd, 1)
  on conflict (user_id, day)
  do update set usd = public.agent_usage.usd + excluded.usd, calls = public.agent_usage.calls + 1
  returning usd;
$$;

revoke execute on function public.agent_add_usage(uuid, date, numeric) from public, anon, authenticated;
grant execute on function public.agent_add_usage(uuid, date, numeric) to service_role;

-- To see the spend:  select day, sum(usd) as usd, sum(calls) as calls from public.agent_usage group by day order by day desc;
