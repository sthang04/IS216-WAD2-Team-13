-- =====================================================================
-- Pulse: Day-of Operations, event start and end times
--
-- ops_events gets a start and end time, so the plan can cover set-up
-- before the show and teardown after it.
--
-- Needs 20261104000100_pulse_ops_events.sql first. Safe to run more than once.
-- =====================================================================

alter table ops_events add column if not exists start_time time;
alter table ops_events add column if not exists end_time   time;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ops_events_times_check') then
    alter table ops_events add constraint ops_events_times_check
      check (start_time is null or end_time is null or end_time > start_time);
  end if;
end $$;

-- Let the API see the new columns straight away
notify pgrst, 'reload schema';
