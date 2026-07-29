alter table places add column maps_url text;

create function promote_waitlist() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  ev uuid := coalesce(old.event_id, new.event_id);
  cap int;
  going_count int;
  free int;
  r record;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  select max_people into cap from events where id = ev;
  if cap is null then
    return null;
  end if;

  select count(*) into going_count from rsvps where event_id = ev and status = 'going';
  free := cap - going_count;
  if free <= 0 then
    return null;
  end if;

  for r in
    select id from rsvps
    where event_id = ev and status = 'waitlisted'
    order by created_at
    limit free
  loop
    update rsvps set status = 'going' where id = r.id;
  end loop;

  return null;
end;
$$;

create trigger rsvps_promote
after update of status or delete on rsvps
for each row execute function promote_waitlist();
