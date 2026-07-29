-- Per-IP rate limits for notify-event/notify-new-event/notify-promotions.
-- All three accept a bare event_id and act via the service role (RLS
-- bypassed), and verify_jwt=true is satisfied by the public anon key — not a
-- check on who holds it — so without this they're callable, unlimited, by
-- anyone who has that key (shipped in the frontend bundle). RLS enabled with
-- no policies — reachable only via the service-role client inside each
-- function, never through the public REST API.
create table notify_event_rate_limits (
  ip text primary key,
  window_start timestamptz not null,
  count int not null default 0
);
alter table notify_event_rate_limits enable row level security;

create table notify_new_event_rate_limits (
  ip text primary key,
  window_start timestamptz not null,
  count int not null default 0
);
alter table notify_new_event_rate_limits enable row level security;

create table notify_promotions_rate_limits (
  ip text primary key,
  window_start timestamptz not null,
  count int not null default 0
);
alter table notify_promotions_rate_limits enable row level security;
