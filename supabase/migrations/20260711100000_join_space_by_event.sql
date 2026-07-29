create or replace function join_space_by_event(p_event_id uuid, p_first_name text, p_username text)
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
  insert into members (space_id, tg_user_id, first_name, username)
  values (sid, uid, coalesce(p_first_name, ''), p_username)
  on conflict (space_id, tg_user_id) do nothing;
  return sid;
end;
$$;

grant execute on function join_space_by_event(uuid, text, text) to authenticated;
