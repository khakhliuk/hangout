create table spaces (
  id uuid primary key default gen_random_uuid(),
  tg_chat_id bigint not null unique,
  title text not null,
  admin_tg_user_id bigint not null,
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  tg_user_id bigint not null,
  username text,
  first_name text not null,
  joined_at timestamptz not null default now(),
  unique (space_id, tg_user_id)
);

create table places (
  id uuid primary key default gen_random_uuid(),
  google_place_id text unique,
  name text not null,
  lat double precision,
  lng double precision,
  maps_cid text,
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  created_by uuid not null references members(id),
  title text not null,
  category text not null,
  min_people int not null check (min_people > 0),
  max_people int check (max_people >= min_people),
  cost_per_person numeric,
  recurrence text,
  tg_message_id bigint,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create table event_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  starts_at timestamptz not null,
  added_by uuid not null references members(id),
  created_at timestamptz not null default now(),
  unique (event_id, starts_at)
);

create table slot_votes (
  slot_id uuid not null references event_slots(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (slot_id, member_id)
);

create table event_place_options (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  place_id uuid not null references places(id),
  added_by uuid not null references members(id),
  created_at timestamptz not null default now(),
  unique (event_id, place_id)
);

create table place_votes (
  option_id uuid not null references event_place_options(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, member_id)
);

create table rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  status text not null check (status in ('going', 'declined', 'waitlisted')),
  guest_name text,
  invited_by uuid references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, member_id),
  check (
    (member_id is not null and guest_name is null and invited_by is null)
    or
    (member_id is null and guest_name is not null and invited_by is not null)
  )
);

create index members_space_idx on members (space_id);
create index events_space_idx on events (space_id);
create index event_slots_event_idx on event_slots (event_id);
create index event_place_options_event_idx on event_place_options (event_id);
create index event_place_options_place_idx on event_place_options (place_id);
create index rsvps_event_idx on rsvps (event_id);

create function tg_uid() returns bigint
language sql stable
as $$
  select nullif(auth.jwt() ->> 'tg_user_id', '')::bigint
$$;

create function is_space_member(space uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from members m
    where m.space_id = space and m.tg_user_id = tg_uid()
  )
$$;

create function is_event_member(event uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from events e
    join members m on m.space_id = e.space_id
    where e.id = event and m.tg_user_id = tg_uid()
  )
$$;

create function is_self(member uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from members m
    where m.id = member and m.tg_user_id = tg_uid()
  )
$$;

create view event_winning_slots as
select distinct on (s.event_id)
  s.event_id,
  s.id as slot_id,
  s.starts_at,
  count(v.member_id) as votes
from event_slots s
join events e on e.id = s.event_id
left join slot_votes v on v.slot_id = s.id
group by s.event_id, s.id, s.starts_at, s.added_by, s.created_at, e.created_by
order by s.event_id, count(v.member_id) desc, (s.added_by = e.created_by) desc, s.created_at;

create view event_winning_places as
select distinct on (o.event_id)
  o.event_id,
  o.id as option_id,
  o.place_id,
  count(v.member_id) as votes
from event_place_options o
join events e on e.id = o.event_id
left join place_votes v on v.option_id = o.id
group by o.event_id, o.id, o.place_id, o.added_by, o.created_at, e.created_by
order by o.event_id, count(v.member_id) desc, (o.added_by = e.created_by) desc, o.created_at;

create view events_resolved as
select
  e.*,
  ws.slot_id as winning_slot_id,
  ws.starts_at,
  wp.option_id as winning_option_id,
  wp.place_id,
  case
    when e.cancelled_at is not null then 'cancelled'
    when ws.starts_at <= now() then 'happened'
    else 'proposed'
  end as status
from events e
left join event_winning_slots ws on ws.event_id = e.id
left join event_winning_places wp on wp.event_id = e.id;

alter table spaces enable row level security;
alter table members enable row level security;
alter table places enable row level security;
alter table events enable row level security;
alter table event_slots enable row level security;
alter table slot_votes enable row level security;
alter table event_place_options enable row level security;
alter table place_votes enable row level security;
alter table rsvps enable row level security;

create policy spaces_select on spaces for select to authenticated
  using (is_space_member(id));

create policy members_select on members for select to authenticated
  using (is_space_member(space_id));

create policy members_insert on members for insert to authenticated
  with check (tg_user_id = tg_uid());

create policy places_select on places for select to authenticated
  using (true);

create policy places_insert on places for insert to authenticated
  with check (true);

create policy events_select on events for select to authenticated
  using (is_space_member(space_id));

create policy events_insert on events for insert to authenticated
  with check (is_space_member(space_id) and is_self(created_by));

create policy events_update on events for update to authenticated
  using (is_self(created_by));

create policy event_slots_select on event_slots for select to authenticated
  using (is_event_member(event_id));

create policy event_slots_insert on event_slots for insert to authenticated
  with check (is_event_member(event_id) and is_self(added_by));

create policy slot_votes_select on slot_votes for select to authenticated
  using (exists (select 1 from event_slots s where s.id = slot_id and is_event_member(s.event_id)));

create policy slot_votes_insert on slot_votes for insert to authenticated
  with check (is_self(member_id));

create policy slot_votes_delete on slot_votes for delete to authenticated
  using (is_self(member_id));

create policy event_place_options_select on event_place_options for select to authenticated
  using (is_event_member(event_id));

create policy event_place_options_insert on event_place_options for insert to authenticated
  with check (is_event_member(event_id) and is_self(added_by));

create policy place_votes_select on place_votes for select to authenticated
  using (exists (select 1 from event_place_options o where o.id = option_id and is_event_member(o.event_id)));

create policy place_votes_insert on place_votes for insert to authenticated
  with check (is_self(member_id));

create policy place_votes_delete on place_votes for delete to authenticated
  using (is_self(member_id));

create policy rsvps_select on rsvps for select to authenticated
  using (is_event_member(event_id));

create policy rsvps_insert on rsvps for insert to authenticated
  with check (is_event_member(event_id) and (is_self(member_id) or is_self(invited_by)));

create policy rsvps_update on rsvps for update to authenticated
  using (is_self(member_id) or is_self(invited_by));

create policy rsvps_delete on rsvps for delete to authenticated
  using (is_self(member_id) or is_self(invited_by));
