alter table event_place_options drop constraint event_place_options_place_id_fkey;
alter table event_place_options add constraint event_place_options_place_id_fkey
  foreign key (place_id) references places(id) on delete cascade;
