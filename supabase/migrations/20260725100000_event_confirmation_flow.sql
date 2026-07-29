-- Splits the event lifecycle into an explicit voting phase (proposed) and a
-- decided phase (confirmed). RSVP only exists after confirmation; before that
-- there's just voting on date/place options. See finalize_event_creation and
-- confirm_event below for how each phase transition is triggered.

alter table events add column confirmed_at timestamptz;
alter table events add column confirmed_slot_id uuid references event_slots(id);
alter table events add column confirmed_place_id uuid references event_place_options(id);

create function event_locked(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from events
    where id = p_event_id and (confirmed_at is not null or cancelled_at is not null)
  )
$$;

-- Voting (adding/toggling options) freezes once an event is confirmed or cancelled.
alter policy event_slots_insert on event_slots
  with check (is_event_member(event_id) and is_self(added_by) and not event_locked(event_id));

alter policy event_place_options_insert on event_place_options
  with check (is_event_member(event_id) and is_self(added_by) and not event_locked(event_id));

alter policy slot_votes_insert on slot_votes
  with check (
    is_self(member_id)
    and not exists (select 1 from event_slots s where s.id = slot_id and event_locked(s.event_id))
  );

alter policy slot_votes_delete on slot_votes
  using (
    is_self(member_id)
    and not exists (select 1 from event_slots s where s.id = slot_id and event_locked(s.event_id))
  );

alter policy place_votes_insert on place_votes
  with check (
    is_self(member_id)
    and not exists (select 1 from event_place_options o where o.id = option_id and event_locked(o.event_id))
  );

alter policy place_votes_delete on place_votes
  using (
    is_self(member_id)
    and not exists (select 1 from event_place_options o where o.id = option_id and event_locked(o.event_id))
  );

-- RSVP only exists once an event has been confirmed — nothing to RSVP to
-- while dates/places are still being voted on.
alter policy rsvps_insert on rsvps
  with check (
    is_event_member(event_id)
    and (is_self(member_id) or is_self(invited_by))
    and exists (select 1 from events e where e.id = rsvps.event_id and e.confirmed_at is not null)
  );

-- Called right after a client creates an event + its slots/places. If there
-- was never a real choice to make (one date, at most one place), skips
-- straight to confirmed and RSVPs the creator — matches the old create flow
-- where RSVP was available immediately. Otherwise leaves it in proposed for
-- voting; RSVP opens later via confirm_event().
create function finalize_event_creation(p_event_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_created_by uuid;
  v_slot_count int;
  v_place_count int;
  v_slot_id uuid;
  v_place_option_id uuid;
begin
  select created_by into v_created_by from events where id = p_event_id;
  if v_created_by is null then
    raise exception 'event not found';
  end if;
  if not is_self(v_created_by) then
    raise exception 'only the creator can finalize';
  end if;

  select count(*) into v_slot_count from event_slots where event_id = p_event_id;
  select count(*) into v_place_count from event_place_options where event_id = p_event_id;

  if v_slot_count = 1 and v_place_count <= 1 then
    select id into v_slot_id from event_slots where event_id = p_event_id;
    select id into v_place_option_id from event_place_options where event_id = p_event_id;
    update events
      set confirmed_at = now(), confirmed_slot_id = v_slot_id, confirmed_place_id = v_place_option_id
      where id = p_event_id;
    insert into rsvps (event_id, member_id, status)
      values (p_event_id, v_created_by, 'going')
      on conflict (event_id, member_id) do nothing;
  end if;
end;
$$;
grant execute on function finalize_event_creation(uuid) to authenticated;

-- Called by the creator via "Завершити голосування". Locks in the current
-- leading slot/place (event_winning_slots / event_winning_places already rank
-- purely by vote count, no RSVP involved) and auto-RSVPs only members who
-- backed *both* winning options — a dimension with a single option never had
-- a real vote to cast, so it's not required as a match. Respects max_people:
-- earliest matched voters go in, the rest land on the waitlist, same as a
-- manual RSVP over capacity would.
create function confirm_event(p_event_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_created_by uuid;
  v_confirmed_at timestamptz;
  v_max_people int;
  v_slot_id uuid;
  v_place_option_id uuid;
  v_slot_count int;
  v_place_count int;
  v_free int;
  rec record;
begin
  select created_by, confirmed_at, max_people into v_created_by, v_confirmed_at, v_max_people
    from events where id = p_event_id;
  if v_created_by is null then
    raise exception 'event not found';
  end if;
  if not is_self(v_created_by) then
    raise exception 'only the creator can confirm';
  end if;
  if v_confirmed_at is not null then
    raise exception 'already confirmed';
  end if;

  select slot_id into v_slot_id from event_winning_slots where event_id = p_event_id;
  select option_id into v_place_option_id from event_winning_places where event_id = p_event_id;
  if v_slot_id is null then
    raise exception 'no date options to confirm';
  end if;

  select count(*) into v_slot_count from event_slots where event_id = p_event_id;
  select count(*) into v_place_count from event_place_options where event_id = p_event_id;

  update events
    set confirmed_at = now(), confirmed_slot_id = v_slot_id, confirmed_place_id = v_place_option_id
    where id = p_event_id;

  v_free := coalesce(v_max_people, 2147483647);
  for rec in (
    select m.id as member_id,
      greatest(
        coalesce(sv.created_at, '-infinity'::timestamptz),
        coalesce(pv.created_at, '-infinity'::timestamptz)
      ) as matched_at
    from members m
    join events e on e.id = p_event_id and m.space_id = e.space_id
    left join slot_votes sv on sv.slot_id = v_slot_id and sv.member_id = m.id
    left join place_votes pv on pv.option_id = v_place_option_id and pv.member_id = m.id
    where (v_slot_count <= 1 or sv.member_id is not null)
      and (v_place_count <= 1 or v_place_option_id is null or pv.member_id is not null)
    order by matched_at asc
  ) loop
    insert into rsvps (event_id, member_id, status)
      values (p_event_id, rec.member_id, case when v_free > 0 then 'going' else 'waitlisted' end)
      on conflict (event_id, member_id) do nothing;
    v_free := v_free - 1;
  end loop;
end;
$$;
grant execute on function confirm_event(uuid) to authenticated;
