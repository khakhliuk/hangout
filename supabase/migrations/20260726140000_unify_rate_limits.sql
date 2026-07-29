-- Consolidates the seven per-function rate-limit tables into one, keyed by
-- (scope, key) where scope is the function name and key is whatever that
-- function limits by (IP for most, profile_id for feedback). Same shape,
-- same RLS posture (enabled, no policies — service-role access only), just
-- one table instead of seven near-identical ones.
create table rate_limits (
  scope text not null,
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (scope, key)
);

alter table rate_limits enable row level security;

drop table auto_repeat_rate_limits;
drop table feedback_rate_limits;
drop table ics_rate_limits;
drop table notify_event_rate_limits;
drop table notify_new_event_rate_limits;
drop table notify_promotions_rate_limits;
drop table notify_reminders_rate_limits;
