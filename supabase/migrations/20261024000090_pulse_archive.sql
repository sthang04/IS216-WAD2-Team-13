-- =====================================================================
-- Pulse — Master Facility Calendar
-- 0/4  Archive before switching to the 4 core personas (run once, safe to re-run)
--
-- Copies the people data (members and their club memberships) into the
-- schema pulse_archive_20261026 before the seed changes members to fit the
-- four login personas. Clubs, facilities and bookings are not archived:
-- they stay exactly as they are. Nothing is deleted from public; tables that already
-- have an archive copy are left as they are, so re-running keeps the
-- first snapshot. To look at it: select * from pulse_archive_20261026.members;
-- =====================================================================
create schema if not exists pulse_archive_20261026;
revoke all on schema pulse_archive_20261026 from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['members','club_memberships']
  loop
    if to_regclass('public.' || t) is not null
       and to_regclass('pulse_archive_20261026.' || t) is null then
      execute format('create table pulse_archive_20261026.%I as table public.%I', t, t);
      raise notice 'Pulse: archived %', t;
    end if;
  end loop;
end $$;
