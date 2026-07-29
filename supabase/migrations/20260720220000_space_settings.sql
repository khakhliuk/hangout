create table space_settings (
  space_id uuid primary key references spaces(id) on delete cascade,
  allow_new_members boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table space_settings enable row level security;

create policy space_settings_select on space_settings for select to authenticated
  using (is_space_member(space_id));

create policy space_settings_update on space_settings for update to authenticated
  using (exists (select 1 from spaces s where s.id = space_id and s.admin_tg_user_id = tg_uid()));

insert into space_settings (space_id)
select id from spaces
on conflict (space_id) do nothing;

create function create_default_space_settings() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into space_settings (space_id) values (new.id)
  on conflict (space_id) do nothing;
  return new;
end;
$$;

create trigger spaces_create_settings
after insert on spaces
for each row execute function create_default_space_settings();

-- Existing members re-joining (already in the space) must keep working even
-- when a space later closes itself off — the gate only applies to brand-new
-- joins, checked after confirming the caller isn't already a member.
create or replace function join_space(p_space_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid bigint := tg_uid();
  already_member boolean;
  allow_new boolean;
begin
  if uid is null then
    raise exception 'no tg_user_id in token';
  end if;

  select exists(select 1 from members where space_id = p_space_id and tg_user_id = uid) into already_member;
  if already_member then
    return;
  end if;

  select coalesce(allow_new_members, true) into allow_new from space_settings where space_id = p_space_id;
  if allow_new is false then
    raise exception 'Цей простір наразі закритий для нових учасників';
  end if;

  insert into members (space_id, tg_user_id)
  values (p_space_id, uid)
  on conflict (space_id, tg_user_id) do nothing;
end;
$$;
grant execute on function join_space(uuid) to authenticated;

-- Event deep-links decline the same way "event not found" already does
-- (return null) instead of raising, so joining-via-event doesn't leak
-- whether a closed space's event exists.
create or replace function join_space_by_event(p_event_id uuid) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  uid bigint := tg_uid();
  sid uuid;
  already_member boolean;
  allow_new boolean;
begin
  if uid is null then
    raise exception 'no tg_user_id in token';
  end if;

  select space_id into sid from events where id = p_event_id;
  if sid is null then
    return null;
  end if;

  select exists(select 1 from members where space_id = sid and tg_user_id = uid) into already_member;
  if already_member then
    return sid;
  end if;

  select coalesce(allow_new_members, true) into allow_new from space_settings where space_id = sid;
  if allow_new is false then
    return null;
  end if;

  insert into members (space_id, tg_user_id)
  values (sid, uid)
  on conflict (space_id, tg_user_id) do nothing;
  return sid;
end;
$$;
grant execute on function join_space_by_event(uuid) to authenticated;
