-- Marks an event as "already spawned its next occurrence" so the daily
-- auto-repeat trigger doesn't recreate it every run once it's been handled.
alter table events add column repeated_at timestamptz;
