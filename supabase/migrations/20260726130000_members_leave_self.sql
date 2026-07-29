-- The existing members_delete policy only lets the space admin remove a
-- member. A member leaving voluntarily needs their own delete path.
create policy members_delete_self on members for delete to authenticated
  using (tg_user_id = tg_uid());
