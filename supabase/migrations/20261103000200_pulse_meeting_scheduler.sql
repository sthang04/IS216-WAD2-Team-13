-- =====================================================================
-- Pulse — Weekly Meeting Scheduler. Additive, safe to re-run.
--
-- An ExCo starts a meeting request for one week of their CCA: picks the
-- participants and a voting deadline. Participants mark the hours they are
-- free (When2Meet style). The organiser confirms a time once everyone has
-- answered, or once the deadline has passed.
--
-- Tables
--   member_baseline_events  each person's imported timetable (.ics)
--   meeting_requests        one request per CCA per week
--   meeting_participants    who must answer, and when they did
--   meeting_availability    one row per (participant, day, hour) they are free
--   club_memberships.subcommittee  for "select by subcommittee"
--
-- Every write goes through an rpc_* function below, which checks who is
-- calling (current_member_id), their CCA, the deadline and the status.
-- Other people's timetables are returned without titles ("Class" only).
-- Times are Singapore time; grid hours run 08:00 to 22:00.
-- =====================================================================

alter table public.club_memberships add column if not exists subcommittee text;
comment on column public.club_memberships.subcommittee is 'e.g. Executive, Logistics, Technical. Used to pick meeting participants.';

create table if not exists public.member_baseline_events (
  id          bigint generated always as identity primary key,
  member_id   bigint not null references public.members(id) on delete cascade,
  title       text not null default 'Busy',
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  rrule       jsonb,                          -- { freq, interval, byday: [0-6], until: ms, count }
  exdates     text[] not null default '{}',   -- 'YYYY-MM-DD' dates skipped
  source_file text,
  created_at  timestamptz not null default now(),
  constraint member_baseline_events_order check (ends_at > starts_at)
);
create index if not exists member_baseline_events_member on public.member_baseline_events(member_id);

create table if not exists public.meeting_requests (
  id                   bigint generated always as identity primary key,
  club_id              bigint not null references public.clubs(id),
  organiser_member_id  bigint not null references public.members(id),
  title                text not null,
  week_start           date not null,           -- a Monday
  vote_deadline        timestamptz not null,
  status               text not null default 'COLLECTING',
  confirmed_date       date,
  confirmed_start_hour int,
  confirmed_end_hour   int,
  venue                text,
  created_at           timestamptz not null default now(),
  confirmed_at         timestamptz,
  constraint meeting_requests_status check (status in ('COLLECTING', 'EXPIRED', 'CONFIRMED', 'CANCELLED')),
  constraint meeting_requests_monday check (extract(isodow from week_start) = 1),
  constraint meeting_requests_confirmed check (
    status <> 'CONFIRMED' or (confirmed_date is not null and confirmed_start_hour >= 8
                              and confirmed_end_hour <= 22 and confirmed_end_hour > confirmed_start_hour))
);
-- One open request per CCA per week
create unique index if not exists meeting_requests_one_open
  on public.meeting_requests(club_id, week_start) where status in ('COLLECTING', 'EXPIRED');

create table if not exists public.meeting_participants (
  meeting_id     bigint not null references public.meeting_requests(id) on delete cascade,
  member_id      bigint not null references public.members(id) on delete cascade,
  responded_at   timestamptz,
  last_nudged_at timestamptz,
  primary key (meeting_id, member_id)
);

create table if not exists public.meeting_availability (
  meeting_id bigint not null,
  member_id  bigint not null,
  slot_date  date not null,
  hour       int not null,
  created_at timestamptz not null default now(),
  primary key (meeting_id, member_id, slot_date, hour),
  foreign key (meeting_id, member_id) references public.meeting_participants(meeting_id, member_id) on delete cascade,
  constraint meeting_availability_hour check (hour between 8 and 21)
);

-- ---------------------------------------------------------------------
-- Read access (also what Realtime uses to decide who gets live updates).
-- No insert/update/delete policies: changes only go through the rpc_* functions.
-- Baseline events have no policy at all: read them through rpc_my_baseline /
-- rpc_club_baselines, so titles of other people's classes never leave the database.
-- ---------------------------------------------------------------------
create or replace function public.pulse_is_club_member(p_member_id bigint, p_club_id bigint)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_member_id is not null and exists (
    select 1
      from club_memberships cm
      join members m on m.id = cm.member_id
     where cm.member_id = p_member_id and cm.club_id = p_club_id
       and coalesce(cm.is_active, true) and coalesce(m.is_active, true))
$$;

alter table public.member_baseline_events enable row level security;
alter table public.meeting_requests       enable row level security;
alter table public.meeting_participants   enable row level security;
alter table public.meeting_availability   enable row level security;

drop policy if exists pulse_meeting_requests_read on public.meeting_requests;
create policy pulse_meeting_requests_read on public.meeting_requests for select to anon, authenticated
  using (cfg_bool('demo_mode') or pulse_is_club_member(current_member_id(null), club_id));

drop policy if exists pulse_meeting_participants_read on public.meeting_participants;
create policy pulse_meeting_participants_read on public.meeting_participants for select to anon, authenticated
  using (cfg_bool('demo_mode') or exists (
    select 1 from meeting_requests r where r.id = meeting_id and pulse_is_club_member(current_member_id(null), r.club_id)));

drop policy if exists pulse_meeting_availability_read on public.meeting_availability;
create policy pulse_meeting_availability_read on public.meeting_availability for select to anon, authenticated
  using (cfg_bool('demo_mode') or exists (
    select 1 from meeting_requests r where r.id = meeting_id and pulse_is_club_member(current_member_id(null), r.club_id)));

-- Live updates for the scheduler page
do $$
declare t text;
begin
  foreach t in array array['meeting_requests', 'meeting_participants', 'meeting_availability'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- Monday 00:00 of the week AFTER the meeting week, Singapore time
create or replace function public.pulse_meeting_week_end(p_week_start date)
returns timestamptz
language sql stable as $$
  select ((p_week_start + 7)::timestamp at time zone 'Asia/Singapore')
$$;

-- In-app notification (the bell) that is also sent on Telegram by send-telegram-notifications
create or replace function public.pulse_notify_meeting(
  p_member_id bigint, p_club_id bigint, p_type text, p_title text, p_body text, p_meeting_id bigint
) returns void
language sql security definer set search_path = public as $$
  insert into notifications (recipient_club_id, recipient_member_id, recipient_user_id, type, title, body,
                             action_url, telegram_status)
  select p_club_id, m.id, m.auth_user_id, p_type, p_title, p_body,
         '/availability?meeting=' || p_meeting_id, 'PENDING'
    from members m
   where m.id = p_member_id
$$;

-- Voting closes at the deadline. Requests with people still to answer become EXPIRED.
-- Run every minute by cron, and at the start of every meeting rpc.
create or replace function public.pulse_expire_meeting_polls()
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update meeting_requests r
     set status = 'EXPIRED'
   where r.status = 'COLLECTING'
     and r.vote_deadline <= now()
     and exists (select 1 from meeting_participants p where p.meeting_id = r.id and p.responded_at is null);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Is the organiser allowed to confirm now? Everyone answered, or the deadline passed.
create or replace function public.pulse_meeting_can_confirm(p_meeting_id bigint)
returns boolean
language sql stable security definer set search_path = public as $$
  select r.status in ('COLLECTING', 'EXPIRED')
         and (r.vote_deadline <= now()
              or not exists (select 1 from meeting_participants p
                              where p.meeting_id = r.id and p.responded_at is null))
    from meeting_requests r
   where r.id = p_meeting_id
$$;

-- Loads a meeting and checks the caller may see it. Raises otherwise.
create or replace function public.pulse_meeting_for_member(p_meeting_id bigint, p_member_id bigint)
returns public.meeting_requests
language plpgsql stable security definer set search_path = public as $$
declare v_meeting meeting_requests;
begin
  if p_member_id is null then
    raise exception 'Please sign in first.';
  end if;
  select * into v_meeting from meeting_requests where id = p_meeting_id;
  if v_meeting.id is null or not pulse_is_club_member(p_member_id, v_meeting.club_id) then
    raise exception 'Meeting request not found.';
  end if;
  return v_meeting;
end $$;

-- ---------------------------------------------------------------------
-- Timetables (baseline schedules)
-- ---------------------------------------------------------------------

-- Replaces the caller's timetable with the events parsed from their .ics file
create or replace function public.rpc_save_my_baseline(p_events jsonb, p_file_name text, p_demo_member_id bigint default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_me    bigint := current_member_id(p_demo_member_id);
  v_count int;
begin
  if v_me is null then raise exception 'Please sign in first.'; end if;
  if jsonb_typeof(p_events) <> 'array' then raise exception 'Events must be a list.'; end if;
  if jsonb_array_length(p_events) > 1000 then raise exception 'That calendar has too many events (max 1000).'; end if;

  delete from member_baseline_events where member_id = v_me;

  insert into member_baseline_events (member_id, title, starts_at, ends_at, rrule, exdates, source_file)
  select v_me,
         left(coalesce(nullif(trim(e->>'title'), ''), 'Busy'), 200),
         to_timestamp((e->>'start')::double precision / 1000),
         to_timestamp((e->>'end')::double precision / 1000),
         case when jsonb_typeof(e->'rrule') = 'object' then e->'rrule' end,
         coalesce(array(select jsonb_array_elements_text(coalesce(e->'exdates', '[]'::jsonb))), '{}'),
         left(p_file_name, 200)
    from jsonb_array_elements(p_events) e
   where (e->>'end')::double precision > (e->>'start')::double precision;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.rpc_clear_my_baseline(p_demo_member_id bigint default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_me bigint := current_member_id(p_demo_member_id);
begin
  if v_me is null then raise exception 'Please sign in first.'; end if;
  delete from member_baseline_events where member_id = v_me;
end $$;

-- The caller's own timetable, with titles
create or replace function public.rpc_my_baseline(p_demo_member_id bigint default null)
returns table (title text, start_ms double precision, end_ms double precision, rrule jsonb, exdates text[], source_file text)
language sql stable security definer set search_path = public as $$
  select e.title, (extract(epoch from e.starts_at) * 1000)::double precision, (extract(epoch from e.ends_at) * 1000)::double precision,
         e.rrule, e.exdates, e.source_file
    from member_baseline_events e
   where e.member_id = current_member_id(p_demo_member_id)
   order by e.starts_at
$$;

-- Everyone else in the CCA: busy times only, no titles
create or replace function public.rpc_club_baselines(p_club_id bigint, p_demo_member_id bigint default null)
returns table (member_id bigint, start_ms double precision, end_ms double precision, rrule jsonb, exdates text[])
language plpgsql stable security definer set search_path = public as $$
declare v_me bigint := current_member_id(p_demo_member_id);
begin
  if not pulse_is_club_member(v_me, p_club_id) then return; end if;
  return query
    select e.member_id, (extract(epoch from e.starts_at) * 1000)::double precision, (extract(epoch from e.ends_at) * 1000)::double precision, e.rrule, e.exdates
      from member_baseline_events e
     where e.member_id <> v_me
       and pulse_is_club_member(e.member_id, p_club_id);
end $$;

-- ---------------------------------------------------------------------
-- Roster for the participant picker
-- ---------------------------------------------------------------------
create or replace function public.rpc_club_roster(p_club_id bigint, p_demo_member_id bigint default null)
returns table (member_id bigint, full_name text, role_name text, subcommittee text, telegram_linked boolean, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_me bigint := current_member_id(p_demo_member_id);
begin
  if not pulse_is_club_member(v_me, p_club_id) then return; end if;
  return query
    select distinct on (m.id) m.id, m.full_name, r.role_name, cm.subcommittee,
           exists (select 1 from telegram_links t where t.member_id = m.id and t.telegram_chat_id is not null),
           m.id = v_me
      from club_memberships cm
      join members m    on m.id = cm.member_id
      join exco_roles r on r.id = cm.role_id
     where cm.club_id = p_club_id and coalesce(cm.is_active, true) and coalesce(m.is_active, true)
     order by m.id, cm.created_at desc;
end $$;

-- ---------------------------------------------------------------------
-- Meeting requests
-- ---------------------------------------------------------------------

-- Everything the scheduler page shows for one week (or one meeting, from a Telegram link)
create or replace function public.rpc_meeting_snapshot(
  p_club_id bigint, p_week_start date, p_meeting_id bigint default null, p_demo_member_id bigint default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_me      bigint := current_member_id(p_demo_member_id);
  v_meeting meeting_requests;
begin
  perform pulse_expire_meeting_polls();

  if p_meeting_id is not null then
    select * into v_meeting from meeting_requests where id = p_meeting_id;
  else
    select * into v_meeting from meeting_requests
     where club_id = p_club_id and week_start = p_week_start and status <> 'CANCELLED'
     order by created_at desc limit 1;
  end if;

  if v_meeting.id is null or not pulse_is_club_member(v_me, v_meeting.club_id) then
    return json_build_object('meeting', null);
  end if;

  return json_build_object(
    'meeting', json_build_object(
      'id', v_meeting.id,
      'club_id', v_meeting.club_id,
      'title', v_meeting.title,
      'week_start', v_meeting.week_start,
      'vote_deadline', v_meeting.vote_deadline,
      'status', v_meeting.status,
      'organiser_member_id', v_meeting.organiser_member_id,
      'organiser_name', (select full_name from members where id = v_meeting.organiser_member_id),
      'confirmed_date', v_meeting.confirmed_date,
      'confirmed_start_hour', v_meeting.confirmed_start_hour,
      'confirmed_end_hour', v_meeting.confirmed_end_hour,
      'venue', v_meeting.venue,
      'voting_open', v_meeting.status = 'COLLECTING' and v_meeting.vote_deadline > now(),
      'can_confirm', pulse_meeting_can_confirm(v_meeting.id),
      'is_organiser', v_meeting.organiser_member_id = v_me,
      'is_participant', exists (select 1 from meeting_participants where meeting_id = v_meeting.id and member_id = v_me),
      'server_now', now()),
    'participants', coalesce((
      select json_agg(json_build_object(
               'member_id', p.member_id,
               'full_name', m.full_name,
               'responded_at', p.responded_at,
               'last_nudged_at', p.last_nudged_at,
               'telegram_linked', exists (select 1 from telegram_links t where t.member_id = p.member_id and t.telegram_chat_id is not null))
             order by m.full_name)
        from meeting_participants p join members m on m.id = p.member_id
       where p.meeting_id = v_meeting.id), '[]'),
    'availability', coalesce((
      select json_agg(json_build_object('member_id', a.member_id, 'slot_date', a.slot_date, 'hour', a.hour))
        from meeting_availability a
       where a.meeting_id = v_meeting.id), '[]'));
end $$;

create or replace function public.rpc_create_meeting(
  p_club_id bigint, p_title text, p_week_start date, p_vote_deadline timestamptz,
  p_member_ids bigint[], p_demo_member_id bigint default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me        bigint := current_member_id(p_demo_member_id);
  v_title     text := left(trim(coalesce(p_title, '')), 120);
  v_ids       bigint[];
  v_bad       int;
  v_id        bigint;
  v_organiser text;
  v_member    bigint;
begin
  if v_me is null then raise exception 'Please sign in first.'; end if;
  if not pulse_is_club_member(v_me, p_club_id) then raise exception 'You are not an ExCo of this CCA.'; end if;
  if v_title = '' then raise exception 'Give the meeting a title.'; end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then raise exception 'Pick a week (it starts on a Monday).'; end if;
  if pulse_meeting_week_end(p_week_start) <= now() then raise exception 'That week is already over.'; end if;
  if p_vote_deadline is null or p_vote_deadline <= now() then raise exception 'The voting deadline must be in the future.'; end if;
  if p_vote_deadline >= pulse_meeting_week_end(p_week_start) then
    raise exception 'The voting deadline must be before the end of the meeting week.';
  end if;

  perform pulse_expire_meeting_polls();

  -- The organiser always takes part
  v_ids := array(select distinct x from unnest(coalesce(p_member_ids, '{}') || v_me) x where x is not null);
  if array_length(v_ids, 1) < 2 then raise exception 'Pick at least one other participant.'; end if;
  if array_length(v_ids, 1) > 100 then raise exception 'Too many participants.'; end if;
  select count(*) into v_bad from unnest(v_ids) x where not pulse_is_club_member(x, p_club_id);
  if v_bad > 0 then raise exception 'Every participant must be an ExCo of this CCA.'; end if;

  if exists (select 1 from meeting_requests where club_id = p_club_id and week_start = p_week_start
                                               and status in ('COLLECTING', 'EXPIRED')) then
    raise exception 'This CCA already has an open meeting request for that week.';
  end if;

  insert into meeting_requests (club_id, organiser_member_id, title, week_start, vote_deadline)
  values (p_club_id, v_me, v_title, p_week_start, p_vote_deadline)
  returning id into v_id;

  insert into meeting_participants (meeting_id, member_id)
  select v_id, x from unnest(v_ids) x;

  select full_name into v_organiser from members where id = v_me;
  foreach v_member in array v_ids loop
    continue when v_member = v_me;
    perform pulse_notify_meeting(v_member, p_club_id, 'MEETING_REQUEST',
      'Mark your availability: ' || v_title,
      v_organiser || ' is finding a time for "' || v_title || '" in the week of '
        || to_char(p_week_start, 'DD Mon') || '. Mark when you are free by '
        || to_char(p_vote_deadline at time zone 'Asia/Singapore', 'Dy DD Mon, HH24:MI') || '.',
      v_id);
  end loop;

  return v_id;
end $$;

-- One click on the grid: free (true) or not free (false) for one hour
create or replace function public.rpc_set_meeting_availability(
  p_meeting_id bigint, p_slot_date date, p_hour int, p_available boolean, p_demo_member_id bigint default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me      bigint := current_member_id(p_demo_member_id);
  v_meeting meeting_requests;
begin
  perform pulse_expire_meeting_polls();
  v_meeting := pulse_meeting_for_member(p_meeting_id, v_me);

  if not exists (select 1 from meeting_participants where meeting_id = p_meeting_id and member_id = v_me) then
    raise exception 'You are not a participant of this meeting.';
  end if;
  if v_meeting.status <> 'COLLECTING' or v_meeting.vote_deadline <= now() then
    raise exception 'Voting for this meeting has closed.';
  end if;
  if p_slot_date < v_meeting.week_start or p_slot_date > v_meeting.week_start + 6 then
    raise exception 'That day is not in the meeting week.';
  end if;
  if p_hour is null or p_hour < 8 or p_hour > 21 then
    raise exception 'That hour is outside 08:00 to 22:00.';
  end if;

  if p_available then
    insert into meeting_availability (meeting_id, member_id, slot_date, hour)
    values (p_meeting_id, v_me, p_slot_date, p_hour)
    on conflict do nothing;
  else
    delete from meeting_availability
     where meeting_id = p_meeting_id and member_id = v_me and slot_date = p_slot_date and hour = p_hour;
  end if;

  update meeting_participants set responded_at = coalesce(responded_at, now())
   where meeting_id = p_meeting_id and member_id = v_me;
end $$;

-- "None of these times work for me": answers with no free hours
create or replace function public.rpc_submit_no_availability(p_meeting_id bigint, p_demo_member_id bigint default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me      bigint := current_member_id(p_demo_member_id);
  v_meeting meeting_requests;
begin
  perform pulse_expire_meeting_polls();
  v_meeting := pulse_meeting_for_member(p_meeting_id, v_me);
  if not exists (select 1 from meeting_participants where meeting_id = p_meeting_id and member_id = v_me) then
    raise exception 'You are not a participant of this meeting.';
  end if;
  if v_meeting.status <> 'COLLECTING' or v_meeting.vote_deadline <= now() then
    raise exception 'Voting for this meeting has closed.';
  end if;

  delete from meeting_availability where meeting_id = p_meeting_id and member_id = v_me;
  update meeting_participants set responded_at = coalesce(responded_at, now())
   where meeting_id = p_meeting_id and member_id = v_me;
end $$;

-- Organiser reminds people who have not answered. p_member_id null = everyone pending.
-- Each person can be nudged at most once every 15 minutes. Returns how many were nudged.
create or replace function public.rpc_nudge_meeting(p_meeting_id bigint, p_member_id bigint default null, p_demo_member_id bigint default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_me      bigint := current_member_id(p_demo_member_id);
  v_meeting meeting_requests;
  v_target  record;
  v_count   int := 0;
begin
  perform pulse_expire_meeting_polls();
  v_meeting := pulse_meeting_for_member(p_meeting_id, v_me);
  if v_meeting.organiser_member_id <> v_me then raise exception 'Only the organiser can send nudges.'; end if;
  if v_meeting.status <> 'COLLECTING' or v_meeting.vote_deadline <= now() then
    raise exception 'Voting for this meeting has closed.';
  end if;

  if p_member_id is not null and not exists (
       select 1 from meeting_participants
        where meeting_id = p_meeting_id and member_id = p_member_id and responded_at is null) then
    raise exception 'That person has already answered or is not a participant.';
  end if;

  for v_target in
    select p.member_id
      from meeting_participants p
     where p.meeting_id = p_meeting_id
       and p.responded_at is null
       and p.member_id <> v_me
       and (p_member_id is null or p.member_id = p_member_id)
       and (p.last_nudged_at is null or p.last_nudged_at < now() - interval '15 minutes')
     for update
  loop
    perform pulse_notify_meeting(v_target.member_id, v_meeting.club_id, 'MEETING_NUDGE',
      'Reminder: ' || v_meeting.title,
      'You have not marked your availability for "' || v_meeting.title || '" yet. Voting closes '
        || to_char(v_meeting.vote_deadline at time zone 'Asia/Singapore', 'Dy DD Mon, HH24:MI') || '.',
      p_meeting_id);
    update meeting_participants set last_nudged_at = now()
     where meeting_id = p_meeting_id and member_id = v_target.member_id;
    v_count := v_count + 1;
  end loop;

  if p_member_id is not null and v_count = 0 then
    raise exception 'Already nudged in the last 15 minutes. Try again later.';
  end if;
  return v_count;
end $$;

-- Organiser picks the final time. Checked here, not only by the button.
create or replace function public.rpc_confirm_meeting(
  p_meeting_id bigint, p_date date, p_start_hour int, p_end_hour int, p_venue text, p_demo_member_id bigint default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me      bigint := current_member_id(p_demo_member_id);
  v_meeting meeting_requests;
  v_member  bigint;
  v_when    text;
  v_venue   text := nullif(left(trim(coalesce(p_venue, '')), 120), '');
begin
  perform pulse_expire_meeting_polls();
  v_meeting := pulse_meeting_for_member(p_meeting_id, v_me);

  -- Lock and re-read the row so two confirms can't race
  select * into v_meeting from meeting_requests where id = p_meeting_id for update;

  if v_meeting.organiser_member_id <> v_me then raise exception 'Only the organiser can confirm this meeting.'; end if;
  if v_meeting.status not in ('COLLECTING', 'EXPIRED') then raise exception 'This meeting is already %.', lower(v_meeting.status); end if;
  if not pulse_meeting_can_confirm(p_meeting_id) then
    raise exception 'Wait until every participant has answered, or the voting deadline has passed.';
  end if;
  if p_date < v_meeting.week_start or p_date > v_meeting.week_start + 6 then
    raise exception 'Pick a day in the meeting week.';
  end if;
  if p_start_hour is null or p_end_hour is null or p_start_hour < 8 or p_end_hour > 22 or p_end_hour <= p_start_hour then
    raise exception 'Pick a time between 08:00 and 22:00.';
  end if;
  if (p_date + make_interval(hours => p_start_hour))::timestamp at time zone 'Asia/Singapore' <= now() then
    raise exception 'That time has already passed.';
  end if;

  update meeting_requests
     set status = 'CONFIRMED', confirmed_date = p_date, confirmed_start_hour = p_start_hour,
         confirmed_end_hour = p_end_hour, venue = v_venue, confirmed_at = now()
   where id = p_meeting_id;

  v_when := to_char(p_date, 'Dy DD Mon') || ', ' || lpad(p_start_hour::text, 2, '0') || ':00 - '
            || lpad(p_end_hour::text, 2, '0') || ':00' || coalesce(' at ' || v_venue, '');
  for v_member in select member_id from meeting_participants where meeting_id = p_meeting_id and member_id <> v_me loop
    perform pulse_notify_meeting(v_member, v_meeting.club_id, 'MEETING_CONFIRMED',
      'Meeting confirmed: ' || v_meeting.title,
      '"' || v_meeting.title || '" is on ' || v_when || '.',
      p_meeting_id);
  end loop;
end $$;

create or replace function public.rpc_cancel_meeting(p_meeting_id bigint, p_demo_member_id bigint default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me      bigint := current_member_id(p_demo_member_id);
  v_meeting meeting_requests;
  v_member  bigint;
begin
  v_meeting := pulse_meeting_for_member(p_meeting_id, v_me);
  if v_meeting.organiser_member_id <> v_me then raise exception 'Only the organiser can cancel this meeting.'; end if;
  if v_meeting.status = 'CANCELLED' then return; end if;

  update meeting_requests set status = 'CANCELLED' where id = p_meeting_id;

  for v_member in select member_id from meeting_participants where meeting_id = p_meeting_id and member_id <> v_me loop
    perform pulse_notify_meeting(v_member, v_meeting.club_id, 'MEETING_CANCELLED',
      'Meeting cancelled: ' || v_meeting.title,
      '"' || v_meeting.title || '" has been cancelled by the organiser.',
      p_meeting_id);
  end loop;
end $$;

-- Only the rpc_* functions are callable from the app
revoke all on function public.pulse_is_club_member(bigint, bigint) from public;
revoke all on function public.pulse_notify_meeting(bigint, bigint, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.pulse_expire_meeting_polls() from public, anon, authenticated;
revoke all on function public.pulse_meeting_can_confirm(bigint) from public, anon, authenticated;
revoke all on function public.pulse_meeting_for_member(bigint, bigint) from public, anon, authenticated;
grant execute on function public.pulse_is_club_member(bigint, bigint) to anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'rpc_save_my_baseline(jsonb, text, bigint)', 'rpc_clear_my_baseline(bigint)', 'rpc_my_baseline(bigint)',
    'rpc_club_baselines(bigint, bigint)', 'rpc_club_roster(bigint, bigint)',
    'rpc_meeting_snapshot(bigint, date, bigint, bigint)', 'rpc_create_meeting(bigint, text, date, timestamptz, bigint[], bigint)',
    'rpc_set_meeting_availability(bigint, date, int, boolean, bigint)', 'rpc_submit_no_availability(bigint, bigint)',
    'rpc_nudge_meeting(bigint, bigint, bigint)', 'rpc_confirm_meeting(bigint, date, int, int, text, bigint)',
    'rpc_cancel_meeting(bigint, bigint)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- Close voting at the deadline even when nobody has the page open (needs pg_cron, already used by Pulse)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'pulse-expire-meeting-polls') then
      perform cron.unschedule('pulse-expire-meeting-polls');
    end if;
    perform cron.schedule('pulse-expire-meeting-polls', '* * * * *', 'select public.pulse_expire_meeting_polls()');
  end if;
end $$;

-- Demo subcommittees for Eurhythmix (only fills in blanks)
update public.club_memberships cm
   set subcommittee = s.sub
  from public.members m, public.clubs c,
       (values ('Mei Chen', 'Executive'), ('Angel Low', 'Executive'), ('Marcus Tan', 'Executive'),
               ('Rachel Tan', 'Logistics'), ('Rachel Chua', 'Logistics'), ('Ben Dover', 'Logistics'),
               ('Sarah Lim', 'Performance'), ('Rick Astley', 'Performance'), ('John Pork', 'Performance'),
               ('Walter White', 'Technical'), ('Jerica Koh', 'Technical'),
               ('Peter Griffin', 'Marketing'), ('Michael Scott', 'Marketing'), ('Gordon Ramsay', 'Welfare')) as s(name, sub)
 where m.id = cm.member_id and c.id = cm.club_id
   and c.short_name = 'Eurhythmix' and m.full_name = s.name
   and cm.subcommittee is null;
