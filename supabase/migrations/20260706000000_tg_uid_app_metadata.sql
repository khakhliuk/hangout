create or replace function tg_uid() returns bigint
language sql stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'tg_user_id', '')::bigint
$$;
