create or replace function join_space(p_space_id uuid, p_first_name text, p_username text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid bigint := tg_uid();
begin
  if uid is null then
    raise exception 'no tg_user_id in token';
  end if;
  insert into members (space_id, tg_user_id, first_name, username)
  values (p_space_id, uid, coalesce(p_first_name, ''), p_username)
  on conflict (space_id, tg_user_id) do nothing;
end;
$$;

grant execute on function join_space(uuid, text, text) to authenticated;
