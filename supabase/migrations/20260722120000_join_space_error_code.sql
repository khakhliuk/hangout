-- Swap the human-readable Ukrainian exception message for a stable marker.
-- Postgres errors surface as raw PostgrestError.message strings all the way
-- to the UI unless the client explicitly recognizes and translates them —
-- a plain-language message baked into the DB can't be told apart from an
-- unexpected technical error, so the frontend ends up showing whichever one
-- comes back verbatim. A stable code lets the client show the right friendly
-- text for this expected case and a generic one for everything else.
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
    raise exception 'space_closed';
  end if;

  insert into members (space_id, tg_user_id)
  values (p_space_id, uid)
  on conflict (space_id, tg_user_id) do nothing;
end;
$$;
grant execute on function join_space(uuid) to authenticated;
