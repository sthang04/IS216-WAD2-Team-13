-- =====================================================================
-- Pulse — whitelist the project team as ExCos (data, not a migration)
--
-- Run in the Supabase SQL editor AFTER migration
-- 20261103000100_pulse_signup_self_roles.sql.
-- Everyone starts as EXCO_MEMBER and picks their role at sign-up.
-- Safe to re-run: existing emails are not duplicated, a role already picked is kept.
-- =====================================================================

begin;

-- 1. The people to whitelist ---------------------------------------------
-- Edit names / CCAs here. club = clubs.short_name.
-- Everyone starts as EXCO_MEMBER (no permissions) and picks their real role when signing up.
create temp table pulse_new_excos (full_name text, email text, club text) on commit drop;
insert into pulse_new_excos values
  ('Jerica Koh',  'kohjiaxuan.jerica@gmail.com',           'Eurhythmix'),
  ('Giselle Goh', 'giselle.goh.2025@computing.smu.edu.sg', 'Funk Movement'),
  ('Alicia Goh',  'aliciagohjb@gmail.com',                 'Chamber Choir'),
  ('Chloe Ang',   'chloe.a.2025@computing.smu.edu.sg',     'Guitarissimo'),
  ('Angel Low',   'angellow365@gmail.com',                 'Caderas Latinas'),
  ('Sa Thang',    'sa.thang.2023@scis.smu.edu.sg',         'StageIT');

-- Stop with a clear message if a CCA is misspelt or the EXCO_MEMBER role is missing
do $$
declare bad text;
begin
  if not exists (select 1 from public.exco_roles where role_code = 'EXCO_MEMBER') then
    raise exception 'EXCO_MEMBER role is missing: run migration 20261103000100_pulse_signup_self_roles.sql first';
  end if;
  select string_agg(p.email || ' -> ' || p.club, '; ') into bad
    from pulse_new_excos p
    left join public.clubs c on c.short_name = p.club
   where c.id is null;
  if bad is not null then
    raise exception 'Unknown CCA: %', bad;
  end if;
end $$;

-- 2. members rows (skips emails that already exist) ---------------------------
insert into public.members (full_name, student_email)
select p.full_name, lower(p.email)
  from pulse_new_excos p
 where not exists (select 1 from public.members m where lower(m.student_email) = lower(p.email));

-- 3. Active club_memberships as EXCO_MEMBER (re-running re-activates, but keeps a role already picked)
insert into public.club_memberships (member_id, club_id, role_id, academic_year, is_active)
select m.id, c.id, r.id, '2026/27', true
  from pulse_new_excos p
  join public.members m    on lower(m.student_email) = lower(p.email)
  join public.clubs c      on c.short_name = p.club
  join public.exco_roles r on r.role_code = 'EXCO_MEMBER'
on conflict (member_id, club_id, academic_year)
  do update set is_active = true;

-- 4. Check the result --------------------------------------------------------
select m.full_name, m.student_email, c.short_name as cca, r.role_name, cm.is_active,
       m.created_at, m.onboarded_at, (m.auth_user_id is not null) as has_login
  from pulse_new_excos p
  join public.members m on lower(m.student_email) = lower(p.email)
  join public.club_memberships cm on cm.member_id = m.id
  join public.clubs c on c.id = cm.club_id
  join public.exco_roles r on r.id = cm.role_id
 order by m.full_name;

commit;
