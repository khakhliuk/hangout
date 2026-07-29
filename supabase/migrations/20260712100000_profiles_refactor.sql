-- profiles: one row per Telegram account, anchored to the real Supabase Auth user.
-- Deleting the auth user cascades through profiles to every membership/setting.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tg_user_id bigint not null unique,
  first_name text not null,
  username text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create function shares_space_with(target_tg_user_id bigint) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from members m1
    join members m2 on m1.space_id = m2.space_id
    where m1.tg_user_id = tg_uid() and m2.tg_user_id = target_tg_user_id
  )
$$;

-- Readable by yourself, or anyone who shares a space with you (same visibility
-- as seeing their name today via the members list). No insert/update policy —
-- profiles are only written by the auth function via the service role key.
create policy profiles_select on profiles for select to authenticated
  using (tg_user_id = tg_uid() or shares_space_with(tg_user_id));

-- Backfill from existing members rows (one profile per distinct tg_user_id,
-- picking the most recent membership as the source of truth for name/avatar).
insert into profiles (id, tg_user_id, first_name, username, avatar_url, updated_at)
select distinct on (m.tg_user_id)
  u.id,
  m.tg_user_id,
  m.first_name,
  m.username,
  m.avatar_url,
  now()
from members m
join auth.users u on (u.raw_app_meta_data->>'tg_user_id')::bigint = m.tg_user_id
order by m.tg_user_id, m.joined_at desc
on conflict (tg_user_id) do nothing;

alter table members
  add constraint members_tg_user_id_fkey
  foreign key (tg_user_id) references profiles(tg_user_id) on delete cascade;

alter table members drop column first_name;
alter table members drop column username;
alter table members drop column avatar_url;

-- members now just links a profile to a space; identity lives in profiles.
drop function if exists join_space(uuid, text, text);
drop function if exists join_space(uuid, text, text, text);
create function join_space(p_space_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid bigint := tg_uid();
begin
  if uid is null then
    raise exception 'no tg_user_id in token';
  end if;
  insert into members (space_id, tg_user_id)
  values (p_space_id, uid)
  on conflict (space_id, tg_user_id) do nothing;
end;
$$;
grant execute on function join_space(uuid) to authenticated;

drop function if exists join_space_by_event(uuid, text, text);
drop function if exists join_space_by_event(uuid, text, text, text);
create function join_space_by_event(p_event_id uuid) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  uid bigint := tg_uid();
  sid uuid;
begin
  if uid is null then
    raise exception 'no tg_user_id in token';
  end if;
  select space_id into sid from events where id = p_event_id;
  if sid is null then
    return null;
  end if;
  insert into members (space_id, tg_user_id)
  values (sid, uid)
  on conflict (space_id, tg_user_id) do nothing;
  return sid;
end;
$$;
grant execute on function join_space_by_event(uuid) to authenticated;

-- user_settings: PK shares identity with profiles (1:1), not a bare tg_user_id.
create table user_settings_new (
  profile_id uuid primary key references profiles(id) on delete cascade,
  notify_new_events boolean not null default false,
  notify_promotions boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Enable RLS immediately, before any data lands in the table or it's exposed
-- under its final name — no window where it's selectable without a policy.
alter table user_settings_new enable row level security;

insert into user_settings_new (profile_id, notify_new_events, notify_promotions, updated_at)
select p.id, us.notify_new_events, us.notify_promotions, us.updated_at
from user_settings us
join profiles p on p.tg_user_id = us.tg_user_id;

drop table user_settings;
alter table user_settings_new rename to user_settings;

-- No grants to `authenticated` on the table itself — all access goes through
-- the security-definer RPCs below, which resolve "self" via tg_uid().

create function get_user_settings()
returns table(notify_new_events boolean, notify_promotions boolean)
language sql stable security definer set search_path = public
as $$
  select coalesce(us.notify_new_events, false), coalesce(us.notify_promotions, true)
  from profiles p
  left join user_settings us on us.profile_id = p.id
  where p.tg_user_id = tg_uid()
$$;
grant execute on function get_user_settings() to authenticated;

create function save_user_settings(p_notify_new_events boolean, p_notify_promotions boolean)
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
  insert into user_settings (profile_id, notify_new_events, notify_promotions, updated_at)
  values (pid, p_notify_new_events, p_notify_promotions, now())
  on conflict (profile_id) do update
    set notify_new_events = excluded.notify_new_events,
        notify_promotions = excluded.notify_promotions,
        updated_at = now();
end;
$$;
grant execute on function save_user_settings(boolean, boolean) to authenticated;
