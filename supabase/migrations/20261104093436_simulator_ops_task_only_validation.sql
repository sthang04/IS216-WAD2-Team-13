-- Task-only recovery for canonical Day Ops tasks. Apply/Undo still validate
-- membership, conflicts, dependencies, fixed times, consent and stale snapshots.
-- Venue/booking changes still require approved booking IDs in transition_plan;
-- ALL existing booking links retain ownership/approval/coverage/capacity checks.
-- No Day Ops source file, shared policy, release gate or reservation is changed.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $preflight$ BEGIN
 IF to_regclass('simulator_private.ops_task_links') IS NULL
 THEN RAISE EXCEPTION 'Install the reviewed Ops bridge before task-only validation'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION simulator_private.validate_event(p_event bigint,p_club bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; booking record; facility jsonb; headcount bigint; evidence jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM public.event_segments s WHERE s.event_id=p_event AND (s.starts_at IS NULL OR s.ends_at IS NULL OR s.ends_at<=s.starts_at))
 THEN RAISE EXCEPTION 'Invalid activity times'; END IF;
 IF EXISTS(SELECT 1 FROM public.segment_assignments a JOIN public.event_segments s ON s.id=a.segment_id
   WHERE s.event_id=p_event AND NOT EXISTS(SELECT 1 FROM public.members m JOIN public.club_memberships cm ON cm.member_id=m.id
     WHERE m.id=a.member_id AND m.is_active AND cm.is_active AND cm.club_id=p_club))
 THEN RAISE EXCEPTION 'An assigned member is inactive or outside the event club'; END IF;
 IF EXISTS(SELECT 1 FROM public.segment_assignments a JOIN public.event_segments sa ON sa.id=a.segment_id
   JOIN public.segment_assignments b ON b.member_id=a.member_id AND b.segment_id<>a.segment_id
   JOIN public.event_segments sb ON sb.id=b.segment_id
   WHERE sa.event_id=p_event AND sa.starts_at<sb.ends_at AND sb.starts_at<sa.ends_at)
 THEN RAISE EXCEPTION 'A member has another overlapping event assignment'; END IF;
 IF EXISTS(SELECT 1 FROM public.segment_dependencies d JOIN public.event_segments a ON a.id=d.prerequisite_segment_id
   JOIN public.event_segments b ON b.id=d.dependent_segment_id WHERE (a.event_id=p_event OR b.event_id=p_event) AND a.ends_at>b.starts_at)
 THEN RAISE EXCEPTION 'Activity dependency order would be violated'; END IF;
 FOR item IN SELECT s.*,l.booking_id FROM public.event_segments s LEFT JOIN public.segment_facility_bookings l ON l.segment_id=s.id WHERE s.event_id=p_event LOOP
   IF item.booking_id IS NULL THEN
    -- A canonical Ops task is an operational assignment, not automatically a
    -- room reservation. Its unlinked venue text grants no facility entitlement.
    -- Only verified mappings qualify: legacy/unmapped activities remain strict.
    IF EXISTS(SELECT 1 FROM simulator_private.ops_task_links mapped
      JOIN simulator_private.ops_event_links parent USING(source_event_uuid)
      JOIN public.ops_tasks actual ON actual.id=mapped.ops_task_id AND actual.event_id=parent.ops_event_id
      WHERE parent.event_id=p_event AND mapped.segment_id=item.id)
    THEN CONTINUE; END IF;
    RAISE EXCEPTION 'An activity lacks a verified facility booking';
   END IF;
   SELECT * INTO booking FROM public.facility_bookings b WHERE b.id=item.booking_id;
   IF NOT FOUND OR booking.owner_club_id IS DISTINCT FROM p_club OR coalesce(booking.status,'') NOT IN ('Booked','Officially Confirmed Booking')
   THEN RAISE EXCEPTION 'Facility ownership or approval is invalid'; END IF;
   -- Club ownership alone does not authorize borrowing another event allocation.
   IF EXISTS(SELECT 1 FROM public.segment_facility_bookings other_link JOIN public.event_segments other_segment ON other_segment.id=other_link.segment_id
     WHERE other_link.booking_id=item.booking_id AND other_segment.event_id<>p_event)
   THEN RAISE EXCEPTION 'Facility booking is already allocated to another event'; END IF;
   IF (((booking.booking_date+booking.start_time) AT TIME ZONE 'Asia/Singapore' <= item.starts_at) AND
     ((booking.booking_date+booking.end_time) AT TIME ZONE 'Asia/Singapore' >= item.ends_at)) IS NOT TRUE
   THEN RAISE EXCEPTION 'Facility booking does not cover activity times'; END IF;
   IF EXISTS(SELECT 1 FROM public.facility_bookings other WHERE other.id<>booking.id AND other.facility_id=booking.facility_id
     AND (other.booking_date+other.start_time) AT TIME ZONE 'Asia/Singapore'<item.ends_at
     AND item.starts_at<(other.booking_date+other.end_time) AT TIME ZONE 'Asia/Singapore')
   THEN RAISE EXCEPTION 'Another reservation overlaps this facility'; END IF;
   SELECT to_jsonb(f) INTO facility FROM public.facilities f WHERE f.id=booking.facility_id;
   IF facility IS NULL OR facility->>'is_active' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Facility is unavailable'; END IF;
   -- Assigned-member count is only a minimum capacity check, not audience size.
   -- Equipment and unrecorded attendees still require acknowledged manual review.
   SELECT count(DISTINCT a.member_id) INTO headcount FROM public.segment_assignments a WHERE a.segment_id=item.id;
   IF facility->>'capacity' ~ '^[0-9]+$' AND (facility->>'capacity')::bigint<headcount THEN RAISE EXCEPTION 'Facility capacity is insufficient'; END IF;
   -- Reuse migration 003's reviewed approval/audience policy. A generic
   -- Booked status is not proof of approval. Unknown audience/equipment still
   -- require the explicit manual acknowledgement enforced by transition_plan.
   evidence:=simulator_private.original_booking_evidence(item.id,item.booking_id,p_club);
   IF (evidence->>'eligible')::boolean IS DISTINCT FROM true
   THEN RAISE EXCEPTION 'Facility evidence invalid: %',evidence->'reasons'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.segment_facility_bookings l1 JOIN public.event_segments s1 ON s1.id=l1.segment_id
   JOIN public.facility_bookings b1 ON b1.id=l1.booking_id
   JOIN public.segment_facility_bookings l2 ON l2.segment_id<>l1.segment_id
   JOIN public.facility_bookings b2 ON b2.id=l2.booking_id AND b2.facility_id=b1.facility_id
   JOIN public.event_segments s2 ON s2.id=l2.segment_id
   WHERE s1.event_id=p_event AND s1.starts_at<s2.ends_at AND s2.starts_at<s1.ends_at)
 THEN RAISE EXCEPTION 'Activities overlap in the same physical room'; END IF;
END $$;

REVOKE ALL ON FUNCTION simulator_private.validate_event(bigint,bigint) FROM PUBLIC,anon,authenticated;
COMMIT;
