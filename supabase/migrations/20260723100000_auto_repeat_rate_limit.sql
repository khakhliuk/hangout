-- Backs a per-IP rate limit for the `auto-repeat` edge function. It's meant
-- to be invoked only by a daily Supabase Cron Job, but verify_jwt=true is
-- satisfied by the public anon key (any valid project JWT, not a check on
-- who holds it), so it's effectively callable by anyone who has that key —
-- which is everyone, since it ships in the frontend bundle. RLS enabled with
-- no policies — reachable only via the service-role client inside the
-- function, never through the public REST API.
create table auto_repeat_rate_limits (
  ip text primary key,
  window_start timestamptz not null,
  count int not null default 0
);

alter table auto_repeat_rate_limits enable row level security;
