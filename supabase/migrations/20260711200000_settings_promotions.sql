alter table user_settings rename column notify_reminders to notify_promotions;
alter table user_settings alter column notify_new_events set default false;
