create policy members_delete on members for delete to authenticated
  using (
    exists (
      select 1 from spaces s
      where s.id = members.space_id
        and s.admin_tg_user_id = (auth.jwt() -> 'app_metadata' ->> 'tg_user_id')::bigint
    )
  );
