alter table events drop constraint events_created_by_fkey;
alter table events alter column created_by drop not null;
alter table events add constraint events_created_by_fkey foreign key (created_by) references members(id) on delete set null;

alter table event_slots drop constraint event_slots_added_by_fkey;
alter table event_slots alter column added_by drop not null;
alter table event_slots add constraint event_slots_added_by_fkey foreign key (added_by) references members(id) on delete set null;

alter table event_place_options drop constraint event_place_options_added_by_fkey;
alter table event_place_options alter column added_by drop not null;
alter table event_place_options add constraint event_place_options_added_by_fkey foreign key (added_by) references members(id) on delete set null;
