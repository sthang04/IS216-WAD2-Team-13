-- =====================================================================
-- Pulse: Day-of Operations, link an event to its facility booking
--
-- ops_events gets the Master Facility Calendar booking it uses, so Event
-- Risk can test "what if this room is unavailable" on a Day Ops event.
-- Optional: events without a booking keep working as before.
--
-- Needs 20261104000100_pulse_ops_events.sql first. Safe to run more than once.
-- =====================================================================

alter table ops_events
  add column if not exists facility_booking_id bigint
  references facility_bookings(id) on delete set null;

-- Let the API see the new column straight away
notify pgrst, 'reload schema';
