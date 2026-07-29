-- event_reminders_sent was keyed only by (event_id, profile_id), so firing
-- any one reminder window (60/180/1440 min) for an event permanently blocked
-- every other window for that same event+profile. Only test data exists so
-- far — truncate rather than backfill an unknowable window value.
truncate table event_reminders_sent;
alter table event_reminders_sent drop constraint event_reminders_sent_pkey;
alter table event_reminders_sent add column minutes int not null;
alter table event_reminders_sent add constraint event_reminders_sent_pkey primary key (event_id, profile_id, minutes);
