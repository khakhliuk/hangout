alter table events add constraint events_recurrence_valid check (recurrence is null or recurrence in ('weekly', 'monthly'));
