-- Backs a per-user rate limit for the `feedback` edge function. RLS enabled
-- with no policies — reachable only via the service-role client inside the
-- function, never through the public REST API.
create table feedback_rate_limits (
  profile_id uuid primary key,
  window_start timestamptz not null,
  count int not null default 0
);

alter table feedback_rate_limits enable row level security;
