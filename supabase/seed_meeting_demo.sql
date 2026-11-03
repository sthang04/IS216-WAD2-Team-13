-- =====================================================================
-- Pulse — demo data for the Weekly Meeting Scheduler (Eurhythmix only).
-- Data, not a migration. Run in the Supabase SQL editor AFTER migration
-- 20261103000200_pulse_meeting_scheduler.sql. Safe to re-run: it first
-- removes what it added last time.
--
-- Adds:
--   * Timetables: 3-4 weekly SMU classes for each Eurhythmix member who has
--     not imported their own (.ics) yet. Term 10 Aug - 22 Nov, recess week skipped.
--   * Week of 2 Nov: "ExCo Weekly Sync" - CONFIRMED Thu 5 Nov 19:00-21:00.
--     More meetings can still be scheduled that week, and every week after is empty.
-- No notifications are created, so nothing is sent on Telegram.
--
-- To remove the demo data only, run the "1. Remove previous demo data" block.
-- (It also removes the two older demo requests for the weeks of 9 and 16 Nov.)
-- =====================================================================

begin;

-- 1. Remove previous demo data ------------------------------------------------
delete from public.meeting_requests r
 using public.clubs c
 where c.id = r.club_id and c.short_name = 'Eurhythmix'
   and r.title in ('ExCo Weekly Sync', 'Arts Festival Run-of-Show Review', 'Costume & Props Check');
delete from public.member_baseline_events where source_file = 'demo-seed.ics';

-- 2. Who is in Eurhythmix --------------------------------------------------------
create temp table demo_members on commit drop as
select m.id as member_id, m.full_name, cm.subcommittee,
       row_number() over (order by m.id) as n,
       -- people who imported a real timetable keep it
       exists (select 1 from public.member_baseline_events e where e.member_id = m.id) as has_own_timetable
  from public.club_memberships cm
  join public.members m on m.id = cm.member_id
  join public.clubs c   on c.id = cm.club_id
 where c.short_name = 'Eurhythmix' and coalesce(cm.is_active, true) and coalesce(m.is_active, true);

-- 3. Timetables -----------------------------------------------------------------
-- SMU seminar slots: 08:15-11:30, 12:00-15:15, 15:30-18:45 (grid hours 8-11, 12-15, 15-18)
create temp table demo_slots (slot int, starts time, ends time, first_hour int, last_hour int) on commit drop;
insert into demo_slots values
  (0, '08:15', '11:30', 8, 11),
  (1, '12:00', '15:15', 12, 15),
  (2, '15:30', '18:45', 15, 18);

create temp table demo_modules (k int, title text) on commit drop;
insert into demo_modules values
  (0, 'IS216 Web Application Development II'), (1, 'COR1100 Writing and Reasoning'),
  (2, 'IS112 Data Management'), (3, 'ACCT101 Financial Accounting'), (4, 'STAT101 Introductory Statistics'),
  (5, 'COR3001 Big Questions'), (6, 'MGMT102 Business Communication'), (7, 'ECON101 Microeconomics'),
  (8, 'IS111 Introduction to Programming'), (9, 'IS214 Enterprise Solution Management'),
  (10, 'FNCE101 Finance'), (11, 'IS213 Enterprise Solution Development'), (12, 'IS215 Digital Business');

-- Each member gets 3 or 4 classes on different weekdays (1 = Mon ... 5 = Fri), picked from their id
create temp table demo_classes on commit drop as
select distinct on (d.member_id, wd)
       d.member_id,
       wd as weekday,
       s.slot, s.starts, s.ends, s.first_hour, s.last_hour,
       (select title from demo_modules where k = (d.member_id * 3 + j * 5) % 13) as title
  from demo_members d
 cross join generate_series(0, 3) j
 cross join lateral (select (((d.member_id * 7 + j * 2) % 5) + 1)::int as wd) w
  join demo_slots s on s.slot = ((d.member_id + j * 2) % 3)::int
 where not d.has_own_timetable
   and (j < 3 or d.member_id % 2 = 0)
 order by d.member_id, wd, j;

insert into public.member_baseline_events (member_id, title, starts_at, ends_at, rrule, exdates, source_file)
select c.member_id,
       c.title,
       ((date '2026-08-10' + (c.weekday - 1)) + c.starts) at time zone 'Asia/Singapore',
       ((date '2026-08-10' + (c.weekday - 1)) + c.ends)   at time zone 'Asia/Singapore',
       jsonb_build_object(
         'freq', 'WEEKLY', 'interval', 1,
         'byday', jsonb_build_array(c.weekday),            -- same numbering as JavaScript getDay(): 1 = Mon
         'until', (extract(epoch from timestamptz '2026-11-22 23:59:59+08') * 1000)::bigint,
         'count', null),
       array[to_char(date '2026-10-05' + (c.weekday - 1), 'YYYY-MM-DD')],   -- recess week
       'demo-seed.ics'
  from demo_classes c;

-- 4. Meeting requests -------------------------------------------------------------
create temp table demo_meetings (key text, id bigint) on commit drop;

with organiser as (
  select (select member_id from demo_members where full_name = 'Mei Chen') as mei
), ins as (
  insert into public.meeting_requests (club_id, organiser_member_id, title, week_start, vote_deadline, status,
                                       confirmed_date, confirmed_start_hour, confirmed_end_hour, venue, confirmed_at)
  select (select id from public.clubs where short_name = 'Eurhythmix'), o.mei, 'ExCo Weekly Sync',
         date '2026-11-02', timestamptz '2026-11-03 12:00+08', 'CONFIRMED',
         date '2026-11-05', 19, 21, 'SMU Connexion Meeting Room 3', timestamptz '2026-11-03 12:30+08'
    from organiser o
  returning id
)
insert into demo_meetings
select 'sync', id from ins;

-- Participants: everyone, all answered
insert into public.meeting_participants (meeting_id, member_id, responded_at)
select m.id, d.member_id, timestamptz '2026-11-03 10:00+08' - (d.n || ' minutes')::interval
  from demo_meetings m
 cross join demo_members d;

-- 5. Votes ---------------------------------------------------------------------------
-- Everyone who answered is free outside their classes some of the time: mostly weekday
-- evenings and Saturday afternoons. Picked from a hash so re-runs give the same result.
-- People with their own imported timetable (no demo classes) only vote for evenings.
insert into public.meeting_availability (meeting_id, member_id, slot_date, hour)
select p.meeting_id, p.member_id, day::date, h
  from public.meeting_participants p
  join demo_meetings dm on dm.id = p.meeting_id
  join public.meeting_requests r on r.id = p.meeting_id
  join demo_members d on d.member_id = p.member_id
 cross join generate_series(r.week_start, r.week_start + 5, interval '1 day') day
 cross join generate_series(8, 21) h
 where p.responded_at is not null
   and not exists (select 1 from demo_classes c
                    where c.member_id = p.member_id and c.weekday = extract(isodow from day)
                      and h between c.first_hour and c.last_hour)
   and (not d.has_own_timetable or h >= 19)
   and abs(hashtext(p.meeting_id || '-' || p.member_id || '-' || day::date || '-' || h)) % 100 <
       case
         when extract(isodow from day) = 6 then case when h between 10 and 17 then 45 else 5 end
         when h >= 19 then 78
         when h = 18 then 45
         when h between 12 and 17 then 28
         else 12
       end;

-- The confirmed sync: make sure everyone who answered can make Thu 19:00-21:00
insert into public.meeting_availability (meeting_id, member_id, slot_date, hour)
select p.meeting_id, p.member_id, date '2026-11-05', h
  from public.meeting_participants p
  join demo_meetings dm on dm.id = p.meeting_id and dm.key = 'sync'
 cross join generate_series(19, 20) h
on conflict do nothing;

-- 6. Check ------------------------------------------------------------------------------
select r.title, r.week_start, r.status,
       count(p.member_id) as participants,
       count(p.member_id) filter (where p.responded_at is null) as pending,
       (select count(*) from public.meeting_availability a where a.meeting_id = r.id) as votes
  from public.meeting_requests r
  join demo_meetings dm on dm.id = r.id
  left join public.meeting_participants p on p.meeting_id = r.id
 group by r.id
 order by r.week_start;

select count(distinct member_id) as members_with_demo_timetable, count(*) as classes
  from public.member_baseline_events where source_file = 'demo-seed.ics';

commit;
