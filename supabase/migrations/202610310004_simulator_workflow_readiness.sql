-- LOCAL REVIEW ONLY. Requires reviewed migrations 002 and 003.
-- Never changes release gates, the roster RPC, calendar objects or notifications.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('simulator_private.original_booking_evidence(bigint,bigint,bigint)') IS NULL
 THEN RAISE EXCEPTION 'Deploy and verify simulator migration 003 before 004'; END IF;
END $$;

-- Authenticated capability metadata is explanatory, never authorization.
-- No plan/member details or caller-supplied identity are disclosed.
CREATE FUNCTION public.rpc_simulator_workflow_capabilities(p_event_id bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor bigint:=simulator_private.actor(); result jsonb;
BEGIN
 IF p_event_id IS NOT NULL THEN PERFORM simulator_private.event_club(p_event_id,true); END IF;
 SELECT jsonb_build_object('contract_version',4,'event_id',p_event_id,
  'application_enabled',coalesce(bool_or(g.application_enabled),false),
  'invitations_enabled',coalesce(bool_or(g.invitations_enabled),false),
  'original_booking_linking_enabled',coalesce(bool_or(g.original_booking_linking_enabled),false))
 INTO result FROM simulator_private.release_gate g;
 RETURN result;
END $$;

-- Keep the existing transactional writer and all its checks. Replace only the
-- simulator-owned validation/progress helpers so Apply AND Undo repeat the
-- reviewed booking policy while holding their existing transaction locks.
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
   IF item.booking_id IS NULL THEN RAISE EXCEPTION 'An activity lacks a verified facility booking'; END IF;
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

CREATE OR REPLACE FUNCTION simulator_private.plan_progress(p simulator_private.recovery_plans,p_club bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_change jsonb; a jsonb:='[]'::jsonb; state text; b public.facility_bookings;
 i simulator_private.replacement_invitations; n integer:=0; s jsonb; timing jsonb; start_at timestamptz; end_at timestamptz; all_ready boolean:=true; blockers jsonb:='[]'::jsonb;
BEGIN
 IF p.application_status='Draft' AND (p.before_fingerprint IS DISTINCT FROM simulator_private.state_fingerprint(simulator_private.event_state(p.event_id))) THEN
  all_ready:=false;blockers:=jsonb_build_array('Source event records changed; cancel and rerun the simulation before confirming.');
 END IF;
 FOR v_change IN SELECT value FROM jsonb_array_elements(p.changes) LOOP
  n:=n+1;
  IF v_change ? 'replacementMemberId' THEN
   SELECT * INTO i FROM simulator_private.replacement_invitations
    WHERE plan_id=p.id AND recipient_member_id=(v_change->>'replacementMemberId')::bigint
    AND replaced_member_id=(v_change->>'replacedMemberId')::bigint ORDER BY created_at DESC,id DESC LIMIT 1;
   state:=CASE WHEN NOT FOUND THEN 'Pending Delivery'
    WHEN i.status IN ('Pending','Accepted') AND i.expires_at<=clock_timestamp() THEN 'Expired'
    WHEN i.status='Accepted' AND i.assignment_snapshot IS DISTINCT FROM simulator_private.invitation_terms(p.id,i.replaced_member_id) THEN 'Consent changed'
    WHEN i.status='Pending' AND i.delivery_status='Pending Delivery' THEN 'Pending Delivery'
    ELSE i.status END;
   all_ready:=all_ready AND state='Accepted';
   a:=a||jsonb_build_array(jsonb_build_object('action',n,'kind','Member','segmentId',v_change->'segmentId',
    'memberId',v_change->'replacementMemberId','status',state));
  END IF;
  IF v_change ? 'venueName' OR v_change ? 'facilityBookingId' THEN
   s:=(SELECT value FROM jsonb_array_elements(p.before_state->'segments') WHERE value->>'id'=v_change->>'segmentId');
   -- Timing may be split across several selected actions for this activity.
   SELECT coalesce(jsonb_object_agg(k.key,k.value),'{}'::jsonb) INTO timing
    FROM jsonb_array_elements(p.changes) v CROSS JOIN LATERAL jsonb_each(v) k
    WHERE v->>'segmentId'=v_change->>'segmentId' AND k.key IN ('starts_at','ends_at');
   start_at:=coalesce(timing->>'starts_at',s->>'starts_at')::timestamptz;
   end_at:=coalesce(timing->>'ends_at',s->>'ends_at')::timestamptz;
   SELECT * INTO b FROM public.facility_bookings WHERE id=(v_change->>'facilityBookingId')::bigint;
   state:=CASE WHEN NOT FOUND THEN 'Awaiting Claim'
    WHEN EXISTS(SELECT 1 FROM public.segment_facility_bookings other_link JOIN public.event_segments other_segment ON other_segment.id=other_link.segment_id
      WHERE other_link.booking_id=b.id AND other_segment.event_id<>p.event_id) THEN 'Allocated to another event'
    WHEN b.status='Pending Admin Sign-off' THEN 'Pending Approval'
    WHEN b.owner_club_id IS DISTINCT FROM p_club OR coalesce((simulator_private.original_booking_evidence(
      (v_change->>'segmentId')::bigint,b.id,p_club)->>'approval_verified')::boolean,false) IS NOT TRUE THEN 'Not Approved'
    WHEN NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=b.facility_id AND f.is_active
      AND (NOT v_change ? 'venueName' OR f.name=v_change->>'venueName')) THEN 'Room mismatch or inactive'
    WHEN (((b.booking_date+b.start_time) AT TIME ZONE 'Asia/Singapore'<=start_at)
      AND ((b.booking_date+b.end_time) AT TIME ZONE 'Asia/Singapore'>=end_at)) IS NOT TRUE THEN 'Booking does not cover activity'
    ELSE 'Approved' END;
   all_ready:=all_ready AND state='Approved';
   a:=a||jsonb_build_array(jsonb_build_object('action',n,'kind','Room','segmentId',v_change->'segmentId',
    'venueName',v_change->'venueName','bookingId',v_change->'facilityBookingId','status',state));
  END IF;
  IF v_change ? 'starts_at' OR v_change ? 'ends_at' THEN
   a:=a||jsonb_build_array(jsonb_build_object('action',n,'kind','Schedule','segmentId',v_change->'segmentId','status','Awaiting Confirmation'));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('actions',a,'blockers',blockers,'workflow_status',
  CASE WHEN p.application_status='Cancelled' THEN 'Cancelled'
   WHEN p.application_status='Applied' THEN 'Resolved' WHEN p.application_status='Undone' THEN 'Undone'
   WHEN p.lifecycle='In Progress' AND all_ready THEN 'Ready to Confirm' ELSE p.lifecycle END);
END $$;

REVOKE ALL ON FUNCTION simulator_private.validate_event(bigint,bigint),
 simulator_private.plan_progress(simulator_private.recovery_plans,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rpc_simulator_workflow_capabilities(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_simulator_workflow_capabilities(bigint) TO authenticated;
-- Review actual helper bodies/owners and full-schema concurrency before release.
-- No gate activation belongs in this migration.
COMMIT;
