-- Backs a per-IP rate limit for the `notify-reminders` edge function. It's
-- meant to be invoked only by a Supabase Cron Job every 10 minutes, but the
-- cron integration's net.http_post carries no auth headers at all — no
-- apikey, no Authorization — so verify_jwt=true silently 401s it at the
-- gateway before the function ever runs (same issue auto-repeat already
-- worked around). Deploying with --no-verify-jwt makes it public instead;
-- this table caps abuse the way auto_repeat_rate_limits does. RLS enabled
-- with no policies — reachable only via the service-role client inside the
-- function, never through the public REST API.
create table notify_reminders_rate_limits (
  ip text primary key,
  window_start timestamptz not null,
  count int not null default 0
);

alter table notify_reminders_rate_limits enable row level security;
