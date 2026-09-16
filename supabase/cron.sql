-- viniva — the function's two scheduled jobs.
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query →
-- paste all of this → Run. Safe to re-run: a job with the same name is replaced.
--
-- Both jobs POST to the quick-api function. Nothing here is a secret — the
-- URL is public and the function decides for itself what to send.
--
-- Times are UTC (Supabase's cron runs in UTC). Halifax is UTC−3 in daylight
-- time and UTC−4 in winter, so 11:00 UTC is 8am ADT and 7am AST. Change the
-- morning hour to 12 in November if you'd rather keep 8am year-round.
--
-- If you set a CRON_KEY secret on the function, add it to each body:
--   '{"sweep":1,"key":"<your key>"}'

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every 30 minutes: the sweep. A welcome text whose five minutes are up, a
-- customer waiting on a reply, an appointment about to start unconfirmed,
-- tomorrow's delivery with prep outstanding — pushed inside business hours,
-- each at most once.
select cron.schedule(
  'viniva-sweep',
  '*/30 * * * *',
  $$
  select net.http_post(
    url     := 'https://bgzkafhlwaldbdfehfsa.supabase.co/functions/v1/quick-api',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{"sweep": 1}'::jsonb
  );
  $$
);

-- Once a day at 8am Halifax: the morning play sheet.
select cron.schedule(
  'viniva-morning',
  '0 11 * * *',
  $$
  select net.http_post(
    url     := 'https://bgzkafhlwaldbdfehfsa.supabase.co/functions/v1/quick-api',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{"plays": 1}'::jsonb
  );
  $$
);

-- To check they exist:   select jobname, schedule from cron.job;
-- To see recent runs:    select * from cron.job_run_details order by start_time desc limit 10;
-- To remove one:         select cron.unschedule('viniva-sweep');
