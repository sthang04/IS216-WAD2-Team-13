-- =====================================================================
-- Pulse: Day-of Operations (events, crew, run-of-show tasks)
--
--   ops_events       one row per CCA event (Showcase, Bazaar booth, ...)
--   ops_event_crew   which ExCos are on each event, plus their check-in
--   ops_tasks        each crew member's tasks (the blocks in the grid)
--
-- Only active ExCos of the event's CCA can see or change it.
-- Safe to run more than once. Nothing existing is changed.
-- =====================================================================

create table if not exists ops_events (
  id          uuid primary key default gen_random_uuid(),
  club_id     bigint not null references clubs(id) on delete cascade,
  name        text   not null,
  event_date  date   not null,
  venue       text,
  created_by  bigint references members(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists ops_event_crew (
  event_id      uuid   not null references ops_events(id) on delete cascade,
  member_id     bigint not null references members(id) on delete cascade,
  checked_in_at time,  -- null until they check in on the day
  late          text,  -- e.g. 'Running 10 min late (SOE seminar)'
  primary key (event_id, member_id)
);

create table if not exists ops_tasks (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid   not null references ops_events(id) on delete cascade,
  member_id   bigint not null,
  title       text   not null,
  task_type   text   not null default 'other' check (task_type in ('setup', 'move', 'perform', 'meal', 'other')),
  start_time  time   not null,
  end_time    time   not null check (end_time > start_time),
  venue       text,
  is_fixed    boolean not null default false,  -- fixed times (e.g. the show) are never moved by a delay
  -- Taking someone off the crew removes their tasks too
  foreign key (event_id, member_id) references ops_event_crew(event_id, member_id) on delete cascade
);

-- Tables made by the first version of this file lack the direct task -> event link
-- (the app needs it to load an event's tasks in one request)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ops_tasks_event_id_fkey') then
    alter table ops_tasks add constraint ops_tasks_event_id_fkey
      foreign key (event_id) references ops_events(id) on delete cascade;
  end if;
end $$;

create index if not exists ops_events_club_idx on ops_events(club_id, event_date);
create index if not exists ops_tasks_event_idx on ops_tasks(event_id);

-- True if the signed-in user is an active ExCo of this CCA
create or replace function ops_is_club_exco(p_club_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from club_memberships cm
      join members m on m.id = cm.member_id
     where m.auth_user_id = auth.uid()
       and cm.club_id = p_club_id
       and cm.is_active
  )
$$;

-- True if this member is an active ExCo of this CCA (only they can be put on a crew)
create or replace function ops_member_in_club(p_member_id bigint, p_club_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_memberships
     where member_id = p_member_id and club_id = p_club_id and is_active
  )
$$;

revoke all on function ops_is_club_exco(bigint) from public;
revoke all on function ops_member_in_club(bigint, bigint) from public;
grant execute on function ops_is_club_exco(bigint) to authenticated;
grant execute on function ops_member_in_club(bigint, bigint) to authenticated;

-- Row-level security: everything is scoped to the event's CCA
alter table ops_events     enable row level security;
alter table ops_event_crew enable row level security;
alter table ops_tasks      enable row level security;

drop policy if exists "CCA ExCos manage their events" on ops_events;
create policy "CCA ExCos manage their events" on ops_events for all to authenticated
  using (ops_is_club_exco(club_id))
  with check (ops_is_club_exco(club_id));

drop policy if exists "CCA ExCos manage their event crew" on ops_event_crew;
create policy "CCA ExCos manage their event crew" on ops_event_crew for all to authenticated
  using (exists (select 1 from ops_events e where e.id = event_id and ops_is_club_exco(e.club_id)))
  with check (exists (select 1 from ops_events e
                       where e.id = event_id
                         and ops_is_club_exco(e.club_id)
                         and ops_member_in_club(member_id, e.club_id)));

drop policy if exists "CCA ExCos manage their event tasks" on ops_tasks;
create policy "CCA ExCos manage their event tasks" on ops_tasks for all to authenticated
  using (exists (select 1 from ops_events e where e.id = event_id and ops_is_club_exco(e.club_id)))
  with check (exists (select 1 from ops_events e where e.id = event_id and ops_is_club_exco(e.club_id)));

-- Signed-in users only (guests see sample data in the app instead)
revoke all on ops_events, ops_event_crew, ops_tasks from anon;
grant select, insert, update, delete on ops_events, ops_event_crew, ops_tasks to authenticated;

-- Let the API see the new tables and links straight away
notify pgrst, 'reload schema';
