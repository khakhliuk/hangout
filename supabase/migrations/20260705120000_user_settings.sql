create table user_settings (
  tg_user_id bigint primary key,
  notify_new_events boolean not null default true,
  notify_reminders boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy user_settings_select on user_settings for select to authenticated
  using (tg_user_id = tg_uid());

create policy user_settings_insert on user_settings for insert to authenticated
  with check (tg_user_id = tg_uid());

create policy user_settings_update on user_settings for update to authenticated
  using (tg_user_id = tg_uid());
