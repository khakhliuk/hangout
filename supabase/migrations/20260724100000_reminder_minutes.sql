alter table user_settings add column reminder_minutes int;

alter table user_settings add constraint user_settings_reminder_valid
  check (reminder_minutes is null or reminder_minutes in (60, 180, 1440));

drop function get_user_settings();
create function get_user_settings()
returns table(notify_new_events boolean, notify_promotions boolean, reminder_minutes int)
language sql stable security definer set search_path = public
as $$
  select coalesce(us.notify_new_events, false),
         coalesce(us.notify_promotions, true),
         us.reminder_minutes
  from profiles p
  left join user_settings us on us.profile_id = p.id
  where p.tg_user_id = tg_uid()
$$;
grant execute on function get_user_settings() to authenticated;

drop function save_user_settings(boolean, boolean);
create function save_user_settings(
  p_notify_new_events boolean,
  p_notify_promotions boolean,
  p_reminder_minutes int default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  pid uuid;
begin
  select id into pid from profiles where tg_user_id = tg_uid();
  if pid is null then
    raise exception 'no profile for current user';
  end if;
  insert into user_settings (profile_id, notify_new_events, notify_promotions, reminder_minutes, updated_at)
  values (pid, p_notify_new_events, p_notify_promotions, p_reminder_minutes, now())
  on conflict (profile_id) do update
    set notify_new_events = excluded.notify_new_events,
        notify_promotions = excluded.notify_promotions,
        reminder_minutes = excluded.reminder_minutes,
        updated_at = now();
end;
$$;
grant execute on function save_user_settings(boolean, boolean, int) to authenticated;

create table event_reminders_sent (
  event_id uuid not null references events(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);

alter table event_reminders_sent enable row level security;
