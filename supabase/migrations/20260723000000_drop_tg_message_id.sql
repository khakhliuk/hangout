-- Dead column from the initial schema, superseded by bot_message_id
-- (20260710000000_bot_message_id.sql). Never read or written anywhere.
-- events_resolved selects e.* so it must be dropped and recreated around
-- the column drop.
drop view events_resolved;

alter table events drop column tg_message_id;

create view events_resolved with (security_invoker = true) as
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

revoke all on events_resolved from anon;
