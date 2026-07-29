update events set title = left(title, 30) where char_length(title) > 30;
alter table events add constraint events_title_length check (char_length(title) <= 30);
