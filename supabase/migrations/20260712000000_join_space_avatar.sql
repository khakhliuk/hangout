create or replace function join_space(p_space_id uuid, p_first_name text, p_username text, p_avatar_url text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid bigint := tg_uid();
begin
  if uid is null then
    raise exception 'no tg_user_id in token';
  end if;
  insert into members (space_id, tg_user_id, first_name, username, avatar_url)
  values (p_space_id, uid, coalesce(p_first_name, ''), p_username, p_avatar_url)
  on conflict (space_id, tg_user_id) do nothing;
end;
$$;

grant execute on function join_space(uuid, text, text, text) to authenticated;

create or replace function join_space_by_event(p_event_id uuid, p_first_name text, p_username text, p_avatar_url text default null)
returns uuid
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
  insert into members (space_id, tg_user_id, first_name, username, avatar_url)
  values (sid, uid, coalesce(p_first_name, ''), p_username, p_avatar_url)
  on conflict (space_id, tg_user_id) do nothing;
  return sid;
end;
$$;

grant execute on function join_space_by_event(uuid, text, text, text) to authenticated;
