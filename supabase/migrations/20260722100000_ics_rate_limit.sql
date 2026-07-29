-- Backs a basic per-IP rate limit for the public, unauthenticated `ics`
-- edge function. RLS is enabled with no policies, so it's reachable only via
-- the service-role client inside the function — never through the public
-- REST API (anon/authenticated get nothing).
create table ics_rate_limits (
  ip text primary key,
  window_start timestamptz not null,
  count int not null default 0
);

alter table ics_rate_limits enable row level security;
