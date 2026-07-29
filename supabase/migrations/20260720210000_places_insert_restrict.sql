-- places is a global, unscoped table (shared across all spaces so place
-- history/recommendations can eventually surface across the whole app), so
-- there's no per-space check to apply here. Read stays open to any
-- authenticated user for that reason; writes are tightened to require the
-- caller to actually be a member of some space, not just hold any valid token.
drop policy if exists places_insert on places;
create policy places_insert on places for insert to authenticated
  with check (exists (select 1 from members m where m.tg_user_id = tg_uid()));
