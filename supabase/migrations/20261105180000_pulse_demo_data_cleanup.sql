-- =====================================================================
-- Pulse — presentation data cleanup. Safe to re-run.
--
-- 1. Facilities 22 (ACC) and 23 (Music & Drama Lab) are switched-off duplicates
--    of 1 (Arts & Culture Centre) and 5 (Music & Drama Lab (MDL)). The calendar
--    hides inactive facilities but transfer history does not, so OSL-approved
--    bookings on them were in history and missing from every calendar. Only
--    those are moved: the other 81 rows stay hidden, because moving them would
--    double-book the active facilities. Booking 1572 overlaps 216, but Samba
--    Masala holds both, so no other CCA loses anything.
-- 2. Sample members, events and tasks get presentable names. Rows are renamed,
--    not deleted, so crew, tasks and history stay attached.
-- 3. The audit log is append-only and is not rewritten. A new view column lets
--    the page say when an OSL admin acted for a CCA.
-- =====================================================================

update public.facility_bookings set facility_id = 1 where facility_id = 22 and id in (1567, 1572, 1573);
update public.facility_bookings set facility_id = 5 where facility_id = 23 and id in (1618, 1621);

update public.members m set full_name = n.new_name
  from (values (46, 'John Pork',     'Ethan Ng'),
               (47, 'Ben Dover',     'Daniel Foo'),
               (48, 'Rick Astley',   'Caleb Seah'),
               (49, 'Walter White',  'Wen Jie Toh'),
               (50, 'Peter Griffin', 'Ivan Lau'),
               (51, 'Hugh Jass',     'Hannah Yeo'),
               (52, 'Saul Goodman',  'Amir Hassan'),
               (53, 'Gordon Ramsay', 'Clara Teo'),
               (54, 'Michael Scott', 'Joel Pang')) as n(id, old_name, new_name)
 where m.id = n.id and m.full_name = n.old_name;

update public.ops_events e set name = n.new_name
  from (values ('testing', date '2026-11-05', 'Eurhythmix Showcase Rehearsal'),
               ('iugkjh',  date '2026-11-06', 'Eurhythmix Technical Run'),
               ('test',    date '2026-11-07', 'Eurhythmix Dress Rehearsal')) as n(old_name, event_date, new_name)
 where e.name = n.old_name and e.event_date = n.event_date;

update public.events set name = 'Eurhythmix Evening Rehearsal' where name = 'Eurhythmix Test: Evening Rehearsal';
update public.events set name = 'Eurhythmix Technical Workshop' where name = 'Eurhythmix Test: Technical Workshop';

update public.ops_tasks t set title = n.new_title
  from (values ('Set up of merch',         'Set up merchandise'),
               ('Greet guest',             'Greet guests'),
               ('Sound & Light check',     'Sound and lighting check'),
               ('Collect pass + give out', 'Collect and distribute passes')) as n(old_title, new_title)
 where t.title = n.old_title;

create or replace view public.v_transfer_audit_history as
 select l.id as audit_event_id,
        l.transfer_id,
        l.booking_id,
        t.audit_voucher_id,
        b.fbs_reference,
        l.event_type,
        c.name as actor_club,
        l.actor_user_id,
        l.details,
        l.created_at,
        l.event_type as action,
        m.full_name as actor_name,
        c.name as actor_club_name,
        l.actor_member_id,
        coalesce(public.is_osl_admin(l.actor_member_id), false) as actor_is_osl
   from public.transfer_audit_log l
   join public.facility_bookings b on b.id = l.booking_id
   left join public.facility_transfers t on t.id = l.transfer_id
   left join public.members m on m.id = l.actor_member_id
   left join public.clubs c on c.id = l.actor_club_id;
