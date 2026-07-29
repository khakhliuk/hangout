create or replace view event_winning_slots with (security_invoker = true) as
select distinct on (s.event_id)
  s.event_id,
  s.id as slot_id,
  s.starts_at,
  count(v.member_id) as votes
from event_slots s
join events e on e.id = s.event_id
left join slot_votes v on v.slot_id = s.id
group by s.event_id, s.id, s.starts_at, s.added_by, s.created_at, e.created_by
order by s.event_id, count(v.member_id) desc, (s.added_by = e.created_by) desc, s.created_at;

create or replace view event_winning_places with (security_invoker = true) as
select distinct on (o.event_id)
  o.event_id,
  o.id as option_id,
  o.place_id,
  count(v.member_id) as votes
from event_place_options o
join events e on e.id = o.event_id
left join place_votes v on v.option_id = o.id
group by o.event_id, o.id, o.place_id, o.added_by, o.created_at, e.created_by
order by o.event_id, count(v.member_id) desc, (o.added_by = e.created_by) desc, o.created_at;

create or replace view events_resolved with (security_invoker = true) as
select
  e.*,
  ws.slot_id as winning_slot_id,
  ws.starts_at,
  wp.option_id as winning_option_id,
  wp.place_id,
  case
    when e.cancelled_at is not null then 'cancelled'
    when ws.starts_at <= now() then 'happened'
    else 'proposed'
  end as status
from events e
left join event_winning_slots ws on ws.event_id = e.id
left join event_winning_places wp on wp.event_id = e.id;

revoke all on event_winning_slots from anon;
revoke all on event_winning_places from anon;
revoke all on events_resolved from anon;
