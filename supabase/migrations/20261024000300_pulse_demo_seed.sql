-- =====================================================================
-- Pulse — Master Facility Calendar
-- 3/4  Demo data (only while app_config.demo_mode is true)
--
-- Adds what the demo needs WITHOUT removing anything shared:
--   * nothing in exco_roles is added or changed (needs LOGISTICS_DIRECTOR)
--   * the demo CCAs and facilities if missing (matched by name)
--   * the 4 core personas from the team login screen, and no others:
--       Rachel Tan  Logistics Director, Eurhythmix
--       Darren Koh  Logistics Director, Samba Masala (his Eurhythmix row is set inactive)
--       Marcus Lim  Symphonia ExCo, not Logistics (existing non-Logistics role, e.g. PRESIDENT)
--       Chloe Ang   OSL admin (Office of Student Life, OSL_ADMIN role)
--     Other CCAs in the story have no Logistics Director persona; the seeder
--     acts for them with the pulse.seeding bypass.
--   * weekly demo bookings (booking_source = 'PULSE_DEMO', FBS reference
--     DEMO-...) in free slots only, up to 31 Dec 2026
--   * transfers in every state for next week and the week after, made
--     through the real RPCs so audit logs, vouchers and notifications match
--
-- The "Reset demo" button (rpc_reset_demo_data) clears this module's
-- transfer, waitlist, email and notification rows, deletes PULSE_DEMO
-- bookings, gives every other booking back to its original CCA as
-- Booked, then seeds again. members, clubs, facilities, facility_slots
-- and the teammates' tables are never deleted from.
-- =====================================================================

-- Which real club plays each demo role is worked out on every run and
-- kept in a temporary table (pulse_demo_map) that disappears at commit.
-- 'Samba Masala' is the focus club (Darren Koh's). Only Arts & Culture (ACF) CCAs are used.
drop table if exists public.pulse_demo_clubs;

drop function if exists pulse_demo_setup();
drop function if exists pulse_demo_club(text);
drop function if exists pulse_demo_ld(bigint);
drop function if exists pulse_demo_ensure_member(text, text, bigint, text);
drop function if exists pulse_demo_core_persona(text, text, bigint, text);
drop function if exists demo_booking(text, text, int, date);
drop function if exists seed_demo_week(date);
drop function if exists seed_demo_exceptions();
drop function if exists pulse_seed_demo();

-- Demo only: finds a club by name
create or replace function pulse_demo_club(p_demo_name text) returns bigint
language plpgsql stable security definer set search_path = public as $$
begin
  return (select club_id from pulse_demo_map where demo_name = p_demo_name);
end $$;

-- Who the seeder acts as for a club: its active Logistics Director, else any
-- active member, else the OSL admin (only used while pulse.seeding is on).
create or replace function pulse_demo_ld(p_club_id bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select cm.member_id
       from club_memberships cm join exco_roles r on r.id = cm.role_id
      where cm.club_id = p_club_id and cm.is_active
      order by (r.can_release_booking or r.can_claim_booking) desc, cm.id limit 1),
    (select m.id from members m where is_osl_admin(m.id) order by (lower(m.full_name) = 'chloe ang') desc, m.id limit 1))
$$;

-- Give a core persona exactly one active membership: p_club_id with p_role_code.
-- Their other club memberships are set inactive (never deleted); exco_roles is untouched.
create or replace function pulse_demo_core_persona(p_name text, p_email text, p_club_id bigint, p_role_code text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_member bigint;
  v_role   bigint;
  v_row    bigint;
begin
  select id into v_member from members
   where lower(student_email) = lower(p_email) or lower(full_name) = lower(p_name)
   order by (lower(student_email) = lower(p_email)) desc, id limit 1;
  -- members holds personal details only; the club and role go in club_memberships.
  if v_member is null then
    insert into members (full_name, student_email)
    values (p_name, lower(p_email))
    returning id into v_member;
  end if;
  update members set student_email = lower(p_email), is_active = true where id = v_member;
  if p_club_id is not null then
    select id into v_role from exco_roles where upper(role_code) = upper(p_role_code) order by id limit 1;
    if v_role is null then
      raise exception 'Pulse demo needs an exco_roles row with role_code %', p_role_code;
    end if;
    -- Other clubs: kept as history, set inactive.
    update club_memberships set is_active = false
     where member_id = v_member and is_active and club_id <> p_club_id;
    -- This club: your table allows one row per member + club + academic year,
    -- so re-use the latest row (changing its role) instead of adding a second one.
    select id into v_row from club_memberships
     where member_id = v_member and club_id = p_club_id
     order by academic_year desc, is_active desc, id desc limit 1;
    if v_row is null then
      insert into club_memberships (member_id, club_id, role_id, is_active) values (v_member, p_club_id, v_role, true);
    else
      update club_memberships set role_id = v_role, is_active = true where id = v_row;
      update club_memberships set is_active = false
       where member_id = v_member and club_id = p_club_id and id <> v_row and is_active;
    end if;
  end if;
  return v_member;
end $$;

-- Find a member by name, or create a demo one (no login, example.org email).
-- With a club and role, also makes sure that membership exists.
create or replace function pulse_demo_ensure_member(p_name text, p_role_code text, p_club_id bigint, p_member_role text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_member bigint;
  v_role   bigint;
  v_club   text;
begin
  select id into v_member from members where lower(full_name) = lower(p_name) order by id limit 1;
  select name into v_club from clubs where id = p_club_id;
  if v_member is null then
    insert into members (full_name, student_email)
    values (p_name, lower(regexp_replace(p_name, '[^A-Za-z]+', '.', 'g')) || '.demo@example.org')
    returning id into v_member;
  end if;
  if p_club_id is not null and p_role_code is not null then
    select id into v_role from exco_roles where upper(role_code) = upper(p_role_code) order by id limit 1;
    if not exists (select 1 from club_memberships where member_id = v_member and club_id = p_club_id and is_active) then
      insert into club_memberships (member_id, club_id, role_id, is_active) values (v_member, p_club_id, v_role, true);
    end if;
  end if;
  return v_member;
end $$;

-- Demo only: creates the demo personas and memberships
create or replace function pulse_demo_setup() returns void
language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_id     bigint;
  v_name   text;
begin
  create temp table if not exists pulse_demo_map (demo_name text primary key, club_id bigint not null) on commit drop;
  delete from pulse_demo_map;

  -- Remove the old sports placeholder club; the demo is scoped to ACF CCAs.
  begin
    delete from club_memberships where club_id in (select id from clubs where name ilike 'Pulse Sports Demo%');
    delete from facility_bookings where owner_club_id in (select id from clubs where name ilike 'Pulse Sports Demo%');
    delete from clubs where name ilike 'Pulse Sports Demo%';
  exception when foreign_key_violation then
    raise notice 'Pulse: kept "Pulse Sports Demo Club" because another table still points to it';
  end;

  -- exco_roles is left exactly as it is (login depends on it). The demo
  -- needs a LOGISTICS_DIRECTOR role with the release/claim flags already on.
  if not exists (select 1 from exco_roles where upper(role_code) = 'LOGISTICS_DIRECTOR') then
    raise exception 'Pulse demo needs an exco_roles row with role_code LOGISTICS_DIRECTOR';
  end if;

  -- Clubs (matched by name or short name) ----------------------------------
  for r in select * from (values
      ('Eurhythmix','EXM'), ('Samba Masala','SM'), ('INDANCITY','IDC'), ('Chinese Orchestra','CO'),
      ('Symphonia','SYM'), ('Stageit','STG'), ('Voix','VX'), ('Ardiente','ARD'), ('Caderas Latinas','CL'),
      ('SoundFoundry','SF'), ('Rentak','RTK'), ('Ivory Keys','IK')) v(demo_name, short)
  loop
    select id into v_id from clubs
     where lower(name) = lower(r.demo_name)
        or lower(name) = lower('SMU ' || r.demo_name)
        or lower(name) like '%' || lower(r.demo_name) || '%'
     order by (category = 'Arts & Culture') desc, (lower(name) = lower(r.demo_name)) desc, id limit 1;
    if v_id is null then
      insert into clubs (name, short_name, category, official_email)
      values ('SMU ' || r.demo_name, r.short, 'Arts & Culture', lower(replace(r.demo_name, ' ', '')) || '@example.org')
      returning id into v_id;
    end if;
    insert into pulse_demo_map (demo_name, club_id) values (r.demo_name, v_id)
    on conflict (demo_name) do update set club_id = excluded.club_id;
  end loop;

  -- Facilities (kept if they already exist) ----------------------------------
  insert into facilities (name, facility_type, location, capacity, capacity_is_estimate, equipment, description)
  select v.name, v.type, v.loc, v.cap, v.est, v.eq, v.descr
    from (values
      ('ACC', 'Multi-Purpose', 'Basement Concourse, School of Economics / School of Social Sciences', 150, false,
       array['Air Conditioning','Audio System','Projector','Mirrors'], 'Published seated-event capacity'),
      ('Studio 7.1', 'Acoustic Room', 'Level 7 Studio (building to confirm)', 25, true,
       array['Air Conditioning','Audio System','Soundproofing'], 'Prototype estimate'),
      ('Studio 7.2', 'Dance Studio', 'Level 7 Studio (building to confirm)', 35, true,
       array['Air Conditioning','Audio System','Mirrors'], 'Prototype estimate'),
      ('Gym Studio', 'Dance Studio', 'Basement 1, School of Computing and Information Systems 2 (beside SMU Gym)', 30, true,
       array['Air Conditioning','Audio System','Mirrors'], 'Prototype estimate'),
      ('Music & Drama Lab', 'Acoustic Room', 'Basement 1, School of Economics / SCIS2', 30, true,
       array['Air Conditioning','Audio System','Projector','Soundproofing'], 'Prototype estimate'),
      ('Basement Studio', 'Multi-Purpose', 'Basement Carpark, Lee Kong Chian School of Business', 40, true,
       array['Air Conditioning','Audio System','Projector','Soundproofing'], 'Prototype estimate'),
      ('Sports Hall', 'Sports Court', 'SMU Sports Hall (location to confirm)', 200, true,
       array['Air Conditioning','Audio System'], 'Prototype estimate')
    ) v(name, type, loc, cap, est, eq, descr)
   where not exists (select 1 from facilities f where lower(f.name) = lower(v.name));
  update facilities set is_active = true
   where lower(name) in ('acc','studio 7.1','studio 7.2','gym studio','music & drama lab','basement studio','sports hall')
     and not is_active;

  -- The 4 core personas (same emails as the team login screen) ---------------
  -- Rachel and Darren are Logistics Directors; Marcus is a non-Logistics ExCo
  -- member (first existing non-Logistics, non-admin role, e.g. PRESIDENT).
  select role_code into v_name from exco_roles
   where upper(role_code) <> 'LOGISTICS_DIRECTOR' and not is_admin_role
   order by (upper(role_code) = 'PRESIDENT') desc, sort_order, id limit 1;
  perform pulse_demo_core_persona('Rachel Tan', 'rachel.tan.2024@scis.smu.edu.sg',      pulse_demo_club('Eurhythmix'),   'LOGISTICS_DIRECTOR');
  perform pulse_demo_core_persona('Darren Koh', 'darren.koh.2024@business.smu.edu.sg',  pulse_demo_club('Samba Masala'), 'LOGISTICS_DIRECTOR');
  perform pulse_demo_core_persona('Marcus Lim', 'marcus.lim.2024@socsc.smu.edu.sg',     pulse_demo_club('Symphonia'),    v_name);
  perform pulse_demo_core_persona('Chloe Ang',  'chloe.osl@smu.edu.sg',
          (select id from clubs where lower(name) = 'office of student life'), 'OSL_ADMIN');
  update members set telegram_handle = '@chloeanggggg' where lower(student_email) = 'chloe.osl@smu.edu.sg';
  -- Link any Supabase Auth users that already exist (new ones are linked by a trigger).
  perform pulse_link_auth_users();

  -- Earlier demo rounds created extra personas with .demo@example.org emails.
  -- They are archived (see 20261024000090) and their memberships set inactive.
  update club_memberships set is_active = false
   where is_active and member_id in (select id from members where student_email like '%.demo@example.org');
  update members set is_active = false where student_email like '%.demo@example.org' and is_active;
end $$;

-- Weekly demo bookings in free slots (ISO weekday: 1 = Mon … 7 = Sun).
create or replace function pulse_demo_generate_bookings() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_from  date := date_trunc('week', sg_today())::date;
  v_until date := cfg_text('calendar_end_date')::date;
  v_count int;
begin
  insert into facility_bookings (facility_id, booking_date, start_time, end_time, owner_club_id, original_club_id,
                                 fbs_reference, booking_source, status)
  select f.id, d::date, v.s::time, v.e::time, dc.club_id, dc.club_id,
         'DEMO-' || to_char(d, 'YYYYMMDD') || '-' || upper(left(regexp_replace(f.name, '[^A-Za-z0-9]', '', 'g'), 12))
           || '-' || replace(v.s, ':', ''),
         'PULSE_DEMO', 'Booked'
    from (values
      ('Eurhythmix',        'ACC',               3, '19:30', '22:30'),
      ('Eurhythmix',        'ACC',               6, '15:30', '18:30'),
      ('Eurhythmix',        'Studio 7.2',        1, '18:00', '21:00'),
      ('Chinese Orchestra', 'Studio 7.1',        5, '18:00', '21:00'),
      ('Chinese Orchestra', 'Studio 7.1',        2, '16:00', '19:00'),
      ('Symphonia',         'Studio 7.1',        4, '16:00', '19:00'),
      ('Stageit',           'ACC',               2, '10:00', '13:00'),
      ('Voix',              'ACC',               4, '18:00', '21:00'),
      ('Samba Masala',      'Basement Studio',   1, '12:00', '15:00'),
      ('Samba Masala',      'Music & Drama Lab', 7, '19:30', '22:30'),
      ('Ivory Keys',        'Basement Studio',   6, '15:30', '18:30'),
      ('Ardiente',          'Gym Studio',        2, '15:00', '18:00'),
      ('Caderas Latinas',   'Gym Studio',        6, '19:00', '22:00'),
      ('INDANCITY',         'Gym Studio',        5, '16:00', '19:00'),
      ('INDANCITY',         'Sports Hall',       4, '19:00', '22:00'),
      ('SoundFoundry',      'Music & Drama Lab', 3, '14:00', '18:00'),
      ('Rentak',            'Music & Drama Lab', 3, '19:30', '22:30'),
      ('Eurhythmix',        'Studio 7.2',        4, '18:00', '21:00'),
      -- Friday–Sunday slots stay outside the 4-day lock for next week,
      -- so there is always something to release, claim or accept.
      ('Samba Masala',      'Studio 7.2',        5, '19:00', '22:00'),
      ('Samba Masala',      'Sports Hall',       6, '10:00', '13:00'),
      ('Eurhythmix',        'Gym Studio',        7, '14:00', '17:00'),
      ('Symphonia',         'ACC',               5, '14:00', '17:00'),
      ('Voix',              'Basement Studio',   7, '10:00', '13:00'),
      ('Rentak',            'Studio 7.2',        6, '10:00', '13:00'),
      ('Ardiente',          'ACC',               7, '18:00', '21:00'),
      ('Stageit',           'Studio 7.1',        6, '10:00', '13:00'),
      ('SoundFoundry',      'Studio 7.1',        7, '14:00', '17:00')
    ) v(demo_name, facility, weekday, s, e)
    join pulse_demo_map dc on dc.demo_name = v.demo_name
    join lateral (select id, name from facilities where lower(name) = lower(v.facility) order by id limit 1) f on true
   cross join lateral generate_series(v_from, v_until, interval '1 day') d
   where extract(isodow from d) = v.weekday
     and not exists (select 1 from facility_bookings x
                      where x.facility_id = f.id and x.booking_date = d::date
                        and x.start_time < v.e::time and x.end_time > v.s::time);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Demo only: creates one booking with a DEMO- FBS reference
create or replace function demo_booking(p_club text, p_facility text, p_weekday int, p_week_start date) returns bigint
language sql stable security definer set search_path = public as $$
  select b.id
    from facility_bookings b
    join facilities f on f.id = b.facility_id
   where b.booking_source = 'PULSE_DEMO'
     and b.owner_club_id = pulse_demo_club(p_club)
     and lower(f.name) = lower(p_facility)
     and b.booking_date = p_week_start + (p_weekday - 1)
     and b.status = 'Booked'
   order by b.start_time limit 1
$$;

-- One week of demo activity. Called for next week and the week after, so
-- every stat card and section has data whichever of those weeks is open.
create or replace function seed_demo_week(p_week_start date) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_b   bigint;
  v_t   jsonb;
  v_osl bigint := (select m.id from members m where is_osl_admin(m.id) order by (lower(m.full_name) = 'chloe ang') desc, m.id limit 1);
begin
  -- A. Chinese Orchestra releases Studio 7.1 (Fri). Eurhythmix, Samba Masala
  --    and INDANCITY queued first, so Eurhythmix holds the 30-min offer.
  v_b := demo_booking('Chinese Orchestra', 'Studio 7.1', 5, p_week_start);
  if v_b is not null then
    perform rpc_join_waitlist(v_b, pulse_demo_club('Eurhythmix'),   pulse_demo_ld(pulse_demo_club('Eurhythmix')));
    perform rpc_join_waitlist(v_b, pulse_demo_club('Samba Masala'), pulse_demo_ld(pulse_demo_club('Samba Masala')));
    perform rpc_join_waitlist(v_b, pulse_demo_club('INDANCITY'),    pulse_demo_ld(pulse_demo_club('INDANCITY')));
    perform rpc_release_booking(v_b, pulse_demo_club('Chinese Orchestra'), pulse_demo_ld(pulse_demo_club('Chinese Orchestra')));
  end if;

  -- B. Caderas Latinas releases Gym Studio (Sat); the focus club is #1, so it holds an offer.
  v_b := demo_booking('Caderas Latinas', 'Gym Studio', 6, p_week_start);
  if v_b is not null then
    perform rpc_join_waitlist(v_b, pulse_demo_club('Samba Masala'), pulse_demo_ld(pulse_demo_club('Samba Masala')));
    perform rpc_join_waitlist(v_b, pulse_demo_club('Symphonia'),    pulse_demo_ld(pulse_demo_club('Symphonia')));
    perform rpc_release_booking(v_b, pulse_demo_club('Caderas Latinas'), pulse_demo_ld(pulse_demo_club('Caderas Latinas')));
  end if;

  -- C/D. Open releases anyone can claim.
  v_b := demo_booking('Ivory Keys', 'Basement Studio', 6, p_week_start);
  if v_b is not null then perform rpc_release_booking(v_b, pulse_demo_club('Ivory Keys'), pulse_demo_ld(pulse_demo_club('Ivory Keys'))); end if;
  v_b := demo_booking('Stageit', 'Studio 7.1', 6, p_week_start);
  if v_b is not null then perform rpc_release_booking(v_b, pulse_demo_club('Stageit'), pulse_demo_ld(pulse_demo_club('Stageit'))); end if;

  -- E. The focus club's own release (its LD can undo it).
  v_b := demo_booking('Samba Masala', 'Studio 7.2', 5, p_week_start);
  if v_b is not null then perform rpc_release_booking(v_b, pulse_demo_club('Samba Masala'), pulse_demo_ld(pulse_demo_club('Samba Masala'))); end if;

  -- F. Focus club → INDANCITY pending (the OSL email goes out automatically on claim).
  v_b := demo_booking('Samba Masala', 'Sports Hall', 6, p_week_start);
  if v_b is not null then
    perform rpc_release_booking(v_b, pulse_demo_club('Samba Masala'), pulse_demo_ld(pulse_demo_club('Samba Masala')));
    perform rpc_claim_booking(v_b, pulse_demo_club('INDANCITY'), pulse_demo_ld(pulse_demo_club('INDANCITY')));
  end if;

  -- G. Voix → focus club pending.
  v_b := demo_booking('Voix', 'ACC', 4, p_week_start);
  if v_b is not null then
    perform rpc_release_booking(v_b, pulse_demo_club('Voix'), pulse_demo_ld(pulse_demo_club('Voix')));
    v_t := rpc_claim_booking(v_b, pulse_demo_club('Samba Masala'), pulse_demo_ld(pulse_demo_club('Samba Masala')));
  end if;

  -- H. Eurhythmix → Symphonia pending.
  v_b := demo_booking('Eurhythmix', 'Studio 7.2', 4, p_week_start);
  if v_b is not null then
    perform rpc_release_booking(v_b, pulse_demo_club('Eurhythmix'), pulse_demo_ld(pulse_demo_club('Eurhythmix')));
    perform rpc_claim_booking(v_b, pulse_demo_club('Symphonia'), pulse_demo_ld(pulse_demo_club('Symphonia')));
  end if;

  -- I. Rentak → focus club, approved by OSL.
  v_b := demo_booking('Rentak', 'Music & Drama Lab', 3, p_week_start);
  if v_b is not null then
    perform rpc_release_booking(v_b, pulse_demo_club('Rentak'), pulse_demo_ld(pulse_demo_club('Rentak')));
    v_t := rpc_claim_booking(v_b, pulse_demo_club('Samba Masala'), pulse_demo_ld(pulse_demo_club('Samba Masala')));
    perform rpc_approve_transfer((v_t->>'transfer_id')::bigint, v_osl);
  end if;

  -- J. Symphonia → Eurhythmix, approved by OSL.
  v_b := demo_booking('Symphonia', 'ACC', 5, p_week_start);
  if v_b is not null then
    perform rpc_release_booking(v_b, pulse_demo_club('Symphonia'), pulse_demo_ld(pulse_demo_club('Symphonia')));
    v_t := rpc_claim_booking(v_b, pulse_demo_club('Eurhythmix'), pulse_demo_ld(pulse_demo_club('Eurhythmix')));
    perform rpc_approve_transfer((v_t->>'transfer_id')::bigint, v_osl);
  end if;

  -- K. Ardiente → focus club, rejected; the slot is relisted.
  v_b := demo_booking('Ardiente', 'Gym Studio', 2, p_week_start);
  if v_b is not null then
    perform rpc_release_booking(v_b, pulse_demo_club('Ardiente'), pulse_demo_ld(pulse_demo_club('Ardiente')));
    v_t := rpc_claim_booking(v_b, pulse_demo_club('Samba Masala'), pulse_demo_ld(pulse_demo_club('Samba Masala')));
    perform rpc_reject_transfer((v_t->>'transfer_id')::bigint,
      'FBS slip does not match the booking date; please re-submit with the correct slip.', v_osl);
  end if;

  -- L. Voix → Eurhythmix, rejected; relisted on a Sunday so it is claimable again.
  v_b := demo_booking('Voix', 'Basement Studio', 7, p_week_start);
  if v_b is not null then
    perform rpc_release_booking(v_b, pulse_demo_club('Voix'), pulse_demo_ld(pulse_demo_club('Voix')));
    v_t := rpc_claim_booking(v_b, pulse_demo_club('Eurhythmix'), pulse_demo_ld(pulse_demo_club('Eurhythmix')));
    perform rpc_reject_transfer((v_t->>'transfer_id')::bigint, 'Booking slip not attached to the OSL request.', v_osl);
  end if;

  -- M. Plain queue positions on booked slots.
  v_b := demo_booking('Eurhythmix', 'ACC', 6, p_week_start);
  if v_b is not null then
    perform rpc_join_waitlist(v_b, pulse_demo_club('Samba Masala'), pulse_demo_ld(pulse_demo_club('Samba Masala')));
  end if;
  v_b := demo_booking('SoundFoundry', 'Studio 7.1', 7, p_week_start);
  if v_b is not null then
    perform rpc_join_waitlist(v_b, pulse_demo_club('INDANCITY'),  pulse_demo_ld(pulse_demo_club('INDANCITY')));
    perform rpc_join_waitlist(v_b, pulse_demo_club('Eurhythmix'), pulse_demo_ld(pulse_demo_club('Eurhythmix')));
  end if;
end $$;

-- Demo only: fills the calendar with demo bookings
create or replace function pulse_seed_demo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_next_week date := date_trunc('week', sg_today())::date + 7;
  v_new int;
begin
  if not cfg_bool('demo_mode') then
    raise exception 'Demo data is only seeded while app_config.demo_mode is true' using errcode = '42501';
  end if;

  -- 1. Clear this module's activity (shared tables are not touched).
  truncate notifications, transfer_emails, transfer_audit_log, waitlist_entries, facility_transfers;
  delete from facility_bookings where booking_source = 'PULSE_DEMO';
  update facility_bookings
     set owner_club_id = coalesce(original_club_id, owner_club_id), status = 'Booked', updated_at = now()
   where status <> 'Booked' or owner_club_id is distinct from coalesce(original_club_id, owner_club_id);

  -- 2. People, clubs, facilities, bookings.
  perform pulse_demo_setup();
  v_new := pulse_demo_generate_bookings();

  -- 3. Transfers in every state, through the real RPCs.
  perform set_config('pulse.seeding', 'on', true);
  perform seed_demo_week(v_next_week);
  if v_next_week + 7 <= cfg_text('calendar_end_date')::date then
    perform seed_demo_week(v_next_week + 7);
  end if;
  perform set_config('pulse.seeding', 'off', true);
  -- CCAs without a persona were acted for by the OSL admin; don't show her as their releaser or claimer.
  update facility_transfers t set released_by_member_id = null
   where is_osl_admin(released_by_member_id);
  update facility_transfers t set claimed_by_member_id = null
   where is_osl_admin(claimed_by_member_id);

  -- Seeded demo sends are not real; don't let the Edge Functions deliver them.
  update transfer_emails set status = 'SENT', sent_at = now(), provider_message_id = 'demo-seed' where status = 'QUEUED';
  update facility_transfers set email_status = case email_status
           when 'QUEUED' then 'SENT' when 'CONFIRMATION_QUEUED' then 'CONFIRMATION_SENT' else email_status end;
  update notifications set telegram_status = 'NOT_REQUIRED' where telegram_status = 'PENDING';

  return jsonb_build_object('reset_at', now(), 'demo_bookings', v_new,
                            'transfers', (select count(*) from facility_transfers));
end $$;

-- Presenter "Reset demo" button. Refuses to run once demo_mode is off.
create or replace function rpc_reset_demo_data() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not cfg_bool('demo_mode') then
    raise exception 'Demo reset is disabled outside demo mode' using errcode = '42501';
  end if;
  return pulse_seed_demo();
end $$;

revoke execute on function pulse_demo_club(text), pulse_demo_ld(bigint), pulse_demo_ensure_member(text, text, bigint, text),
                           pulse_demo_core_persona(text, text, bigint, text),
                           pulse_demo_setup(), pulse_demo_generate_bookings(), demo_booking(text, text, int, date),
                           seed_demo_week(date), pulse_seed_demo()
  from public, anon, authenticated;
grant execute on function rpc_reset_demo_data() to anon, authenticated;

-- Seed now (skipped when demo_mode is false).
select case when cfg_bool('demo_mode') then pulse_seed_demo() else '{"skipped":"demo_mode is false"}'::jsonb end as pulse_seed;
