-- LOCAL REVIEW ONLY. Corrective migration after reviewed 002, 003 and 004.
-- No gate activation, production data edits, new tables or shared calendar changes.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.rpc_simulator_workflow_capabilities(bigint)') IS NULL
  OR to_regprocedure('simulator_private.original_booking_evidence(bigint,bigint,bigint)') IS NULL
 THEN RAISE EXCEPTION 'Deploy and verify simulator migrations 003 and 004 before 005'; END IF;
END $$;

-- Restored rows are checked under transition_plan's existing locks. Recorded
-- disruption intervals remain evidence: their historical timestamp is not a
-- cancellation/resolution flag. No new Revise Recovery workflow is introduced.
CREATE FUNCTION simulator_private.assert_undo_disruptions_clear(p_event bigint,p_disruptions jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE disruption jsonb; unavailable_from timestamptz; unavailable_until timestamptz;
 unavailable_member_id bigint; venue text;
BEGIN
 IF p_disruptions IS NULL OR jsonb_typeof(p_disruptions) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Undo blocked: recorded disruptions are invalid; original safety cannot be verified'; END IF;
 FOR disruption IN SELECT value FROM jsonb_array_elements(p_disruptions) LOOP
  -- Undo intentionally restores the original schedule; a recorded delay is not
  -- an unavailable resource. Existing dependency/time/conflict checks still run.
  IF disruption->>'type'='SCHEDULE_DELAY' THEN CONTINUE; END IF;
  IF coalesce(disruption->>'type','') NOT IN ('MEMBER_UNAVAILABLE','FACILITY_UNAVAILABLE')
  THEN RAISE EXCEPTION 'Undo blocked: unsupported recorded disruption'; END IF;
  unavailable_from:=(disruption->>'start')::timestamptz;
  unavailable_until:=(disruption->>'end')::timestamptz;
  IF unavailable_from IS NULL OR unavailable_until IS NULL OR unavailable_until<=unavailable_from
   OR NOT isfinite(unavailable_from) OR NOT isfinite(unavailable_until)
  THEN RAISE EXCEPTION 'Undo blocked: recorded unavailability has invalid times'; END IF;
  IF disruption->>'type'='MEMBER_UNAVAILABLE' THEN
   unavailable_member_id:=(disruption->>'memberId')::bigint;
   IF unavailable_member_id IS NULL OR unavailable_member_id<=0 THEN RAISE EXCEPTION 'Undo blocked: recorded unavailable member is invalid'; END IF;
   IF EXISTS(SELECT 1 FROM public.segment_assignments a
     JOIN public.event_segments s ON s.id=a.segment_id
     WHERE s.event_id=p_event AND a.member_id=unavailable_member_id
      AND s.starts_at<unavailable_until AND unavailable_from<s.ends_at)
   THEN RAISE EXCEPTION 'Undo blocked: original member is still recorded unavailable during a restored activity. No event or plan changes were committed.'; END IF;
  ELSE
   venue:=btrim(disruption->>'venueName');
   IF venue IS NULL OR venue='' THEN RAISE EXCEPTION 'Undo blocked: recorded unavailable facility is invalid'; END IF;
   -- Legacy plans record a venue name, not a stable physical facility ID.
   -- A renamed/deleted venue must fail closed rather than silently evade the
   -- recorded outage. This does not edit or revise the saved disruption.
   IF NOT EXISTS(SELECT 1 FROM public.facilities f WHERE lower(btrim(f.name))=lower(venue))
   THEN RAISE EXCEPTION 'Undo blocked: recorded original facility identity changed; unavailability cannot be safely verified'; END IF;
   IF EXISTS(SELECT 1 FROM public.segment_facility_bookings l
     JOIN public.event_segments s ON s.id=l.segment_id
     JOIN public.facility_bookings b ON b.id=l.booking_id
     JOIN public.facilities f ON f.id=b.facility_id
     WHERE s.event_id=p_event AND lower(btrim(f.name))=lower(venue)
      AND s.starts_at<unavailable_until AND unavailable_from<s.ends_at)
   THEN RAISE EXCEPTION 'Undo blocked: original facility is still recorded unavailable during a restored activity. No event or plan changes were committed.'; END IF;
  END IF;
 END LOOP;
END $$;


-- Preserve the existing writer verbatim except for the Undo-only disruption
-- validation below validate_event. Apply consent/approval/expiry, snapshots,
-- revisions, lock order, atomic rollback and audit semantics are unchanged.
CREATE OR REPLACE FUNCTION simulator_private.transition_plan(p_plan uuid,p_version integer,p_ack boolean,p_undo boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p simulator_private.recovery_plans; club bigint; actor bigint:=simulator_private.actor();
 v_change jsonb; rowstate jsonb; i simulator_private.replacement_invitations; v_disruption jsonb; terms jsonb;
 booking public.facility_bookings; segment public.event_segments; oldtime timestamptz; minutes bigint; current_state jsonb; expected_state jsonb; expected_fingerprint text;
BEGIN
 -- Bound waits BEFORE acquiring the plan/recipient/row/table locks.
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM simulator_private.require_release(true);
 IF p_version IS NULL OR p_version<1 THEN RAISE EXCEPTION 'A positive plan revision is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO p FROM simulator_private.recovery_plans WHERE id=p_plan FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='42501'; END IF;
 club:=simulator_private.event_club(p.event_id,true);
 BEGIN
  -- Reject stale and NULL revisions even on retry paths. A stale retry must
  -- refresh history; a retry with the current version remains a no-op.
  IF p.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Plan revision changed; refresh history'; END IF;
  IF (NOT p_undo AND p.application_status='Applied') OR (p_undo AND p.application_status='Undone') THEN RETURN to_jsonb(p); END IF;

  IF NOT p_undo AND p.lifecycle<>'In Progress' THEN RAISE EXCEPTION 'Start Recovery Plan before confirming'; END IF;
  IF NOT coalesce(p_ack,false) THEN RAISE EXCEPTION 'Personal timetable, equipment and qualification review must be acknowledged'; END IF;
  IF (p_undo AND p.application_status<>'Applied') OR (NOT p_undo AND p.application_status<>'Draft') THEN RAISE EXCEPTION 'Plan is not in the required application state'; END IF;
  -- Block competing shared writers and phantom assignment/booking inserts during
  -- validation and commit. No table structure or shared policy is altered.
  -- Fixed internal order: plan, writer tables, metadata tables, selected event,
  -- then invitation rows. Keep globally conflicting INSERTs blocked: team writers
  -- do not share simulator advisory locks. Row-only checks would miss phantoms.
  LOCK TABLE public.event_segments,public.facility_bookings,public.segment_assignments,
    public.segment_facility_bookings IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.club_memberships,public.clubs,public.exco_roles,public.facilities,public.members,public.segment_dependencies IN SHARE MODE;
  -- Safe narrowing: unrelated event metadata updates no longer need a global
  -- events-table write lock. Only this event's original metadata is protected.
  PERFORM e.id FROM public.events e WHERE e.id=p.event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event unavailable'; END IF;
  club:=simulator_private.event_club(p.event_id,true);
  current_state:=simulator_private.event_state(p.event_id);
  expected_state:=CASE WHEN p_undo THEN p.after_state ELSE p.before_state END;
  expected_fingerprint:=CASE WHEN p_undo THEN p.after_fingerprint ELSE p.before_fingerprint END;
  IF expected_fingerprint IS NULL OR simulator_private.state_fingerprint(expected_state) IS DISTINCT FROM expected_fingerprint
  THEN RAISE EXCEPTION 'Stored recovery snapshot is invalid'; END IF;
  IF simulator_private.state_fingerprint(current_state) IS DISTINCT FROM expected_fingerprint OR current_state IS DISTINCT FROM expected_state
  THEN RAISE EXCEPTION '%',CASE WHEN p_undo THEN 'Undo blocked: event records changed after recovery. No event records were changed by this attempt. Refresh and review later edits before manual recovery.'
   ELSE 'Affected event records changed; automatic operation is blocked' END; END IF;

  IF p_undo THEN
   -- Restore only the reviewed event fields/assignments/links. Existing event rows
   -- must still match after_state; never reclaim or cancel an external booking.
   UPDATE public.events SET starts_at=(p.before_state->'event'->>'starts_at')::timestamptz,
     ends_at=(p.before_state->'event'->>'ends_at')::timestamptz WHERE id=p.event_id;
   FOR rowstate IN SELECT value FROM jsonb_array_elements(p.before_state->'segments') LOOP
    UPDATE public.event_segments SET starts_at=(rowstate->>'starts_at')::timestamptz,ends_at=(rowstate->>'ends_at')::timestamptz WHERE id=(rowstate->>'id')::bigint AND event_id=p.event_id;
   END LOOP;
   FOR rowstate IN SELECT value FROM jsonb_array_elements(p.before_state->'assignments') LOOP
    UPDATE public.segment_assignments SET member_id=(rowstate->>'member_id')::bigint WHERE id=(rowstate->>'id')::bigint;
   END LOOP;
   DELETE FROM public.segment_facility_bookings l USING public.event_segments s WHERE l.segment_id=s.id AND s.event_id=p.event_id;
   INSERT INTO public.segment_facility_bookings(segment_id,booking_id)
    SELECT (value->>'segment_id')::bigint,(value->>'booking_id')::bigint FROM jsonb_array_elements(p.before_state->'links');
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p.changes) c WHERE c ? 'replacementMemberId'
    GROUP BY c->>'segmentId',c->>'replacementMemberId' HAVING count(DISTINCT c->>'replacedMemberId')>1)
   THEN RAISE EXCEPTION 'One candidate cannot replace multiple people in one activity'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p.changes) c CROSS JOIN LATERAL jsonb_each(c) field
    WHERE field.key IN ('starts_at','ends_at','venueName') GROUP BY c->>'segmentId',field.key HAVING count(DISTINCT field.value)>1)
   THEN RAISE EXCEPTION 'Contradictory recovery choices'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p.changes) c WHERE c ? 'replacementMemberId'
    GROUP BY c->>'assignmentId' HAVING count(*)>1)
   THEN RAISE EXCEPTION 'Duplicate assignment changes'; END IF;
   -- Check all accepted terms BEFORE updating any assignments; otherwise the
   -- first changed role would invalidate the terms check for the next role.
   FOR v_change IN SELECT DISTINCT jsonb_build_object('original',value->>'replacedMemberId','replacement',value->>'replacementMemberId')
     FROM jsonb_array_elements(p.changes) WHERE value ? 'replacementMemberId' LOOP
    SELECT * INTO i FROM simulator_private.replacement_invitations WHERE plan_id=p.id
      AND recipient_member_id=(v_change->>'replacement')::bigint AND replaced_member_id=(v_change->>'original')::bigint
      AND status='Accepted' FOR UPDATE;
    -- Recheck wall-clock expiry AFTER the invitation row lock is acquired.
    IF NOT FOUND OR i.expires_at<=clock_timestamp() OR i.status IS DISTINCT FROM 'Accepted' OR i.assignment_snapshot IS DISTINCT FROM simulator_private.invitation_terms(p.id,(v_change->>'original')::bigint)
    THEN RAISE EXCEPTION 'Exact replacement invitation has not been accepted or has expired'; END IF;
   END LOOP;
   FOR v_change IN SELECT value FROM jsonb_array_elements(p.changes) LOOP
    SELECT * INTO segment FROM public.event_segments WHERE id=(v_change->>'segmentId')::bigint AND event_id=p.event_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Plan contains an unrelated activity'; END IF;
    IF v_change ? 'replacementMemberId' THEN
     UPDATE public.segment_assignments SET member_id=(v_change->>'replacementMemberId')::bigint
       WHERE id=(v_change->>'assignmentId')::bigint AND segment_id=segment.id AND member_id=(v_change->>'replacedMemberId')::bigint;
     IF NOT FOUND THEN RAISE EXCEPTION 'Original assignment changed'; END IF;
    END IF;
    IF v_change ? 'starts_at' OR v_change ? 'ends_at' THEN
     UPDATE public.event_segments SET starts_at=coalesce((v_change->>'starts_at')::timestamptz,starts_at),ends_at=coalesce((v_change->>'ends_at')::timestamptz,ends_at) WHERE id=segment.id;
    END IF;
    IF v_change ? 'venueName' OR v_change ? 'facilityBookingId' THEN
     IF v_change->>'facilityBookingId' IS NULL THEN RAISE EXCEPTION 'An actual replacement booking is required'; END IF;
     SELECT * INTO booking FROM public.facility_bookings WHERE id=(v_change->>'facilityBookingId')::bigint;
     IF NOT FOUND OR booking.owner_club_id IS DISTINCT FROM club OR coalesce(booking.status,'') NOT IN ('Booked','Officially Confirmed Booking')
     THEN RAISE EXCEPTION 'Replacement booking is not approved for this club'; END IF;
     IF v_change ? 'venueName' AND NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=booking.facility_id AND f.name=v_change->>'venueName') THEN RAISE EXCEPTION 'Booking does not match selected facility'; END IF;
     IF (SELECT count(*) FROM public.segment_facility_bookings WHERE segment_id=segment.id)>1 THEN RAISE EXCEPTION 'Multi-room allocation needs manual recovery'; END IF;
     DELETE FROM public.segment_facility_bookings WHERE segment_id=segment.id;
     INSERT INTO public.segment_facility_bookings(segment_id,booking_id) VALUES(segment.id,booking.id);
    END IF;
   END LOOP;
   -- Extend event bounds only when the proposed activities require it. Both the
   -- old and resulting bounds are captured for preview/history and safe undo.
   UPDATE public.events e SET starts_at=least(e.starts_at,(SELECT min(s.starts_at) FROM public.event_segments s WHERE s.event_id=e.id)),
     ends_at=greatest(e.ends_at,(SELECT max(s.ends_at) FROM public.event_segments s WHERE s.event_id=e.id)) WHERE e.id=p.event_id;
  END IF;

  PERFORM simulator_private.validate_event(p.event_id,club);
  IF p_undo THEN
   -- This runs inside the existing exception/subtransaction boundary. Raising
   -- here rolls back ALL tentative restoration writes before auditing failure.
   PERFORM simulator_private.assert_undo_disruptions_clear(p.event_id,p.disruptions);
  END IF;
  IF NOT p_undo THEN
   -- Do not resolve a plan while selected hypothetical problems remain.
   FOR v_disruption IN SELECT value FROM jsonb_array_elements(p.disruptions) LOOP
    IF v_disruption->>'type'='MEMBER_UNAVAILABLE' THEN
     IF EXISTS(SELECT 1 FROM public.segment_assignments a JOIN public.event_segments s ON s.id=a.segment_id WHERE s.event_id=p.event_id AND a.member_id=(v_disruption->>'memberId')::bigint
       AND s.starts_at<(v_disruption->>'end')::timestamptz AND (v_disruption->>'start')::timestamptz<s.ends_at) THEN RAISE EXCEPTION 'Unavailable member remains assigned'; END IF;
    ELSIF v_disruption->>'type'='FACILITY_UNAVAILABLE' THEN
     IF EXISTS(SELECT 1 FROM public.segment_facility_bookings l JOIN public.event_segments s ON s.id=l.segment_id
       JOIN public.facility_bookings b ON b.id=l.booking_id JOIN public.facilities f ON f.id=b.facility_id
       WHERE s.event_id=p.event_id AND f.name=v_disruption->>'venueName' AND s.starts_at<(v_disruption->>'end')::timestamptz AND (v_disruption->>'start')::timestamptz<s.ends_at)
     THEN RAISE EXCEPTION 'Unavailable facility remains allocated'; END IF;
    ELSIF v_disruption->>'type'<>'SCHEDULE_DELAY' THEN RAISE EXCEPTION 'Unsupported disruption'; END IF;
   END LOOP;
   FOR rowstate IN SELECT value FROM jsonb_array_elements(p.before_state->'segments') LOOP
    SELECT coalesce(sum((value->>'delayMinutes')::bigint),0) INTO minutes FROM jsonb_array_elements(p.disruptions)
     WHERE value->>'type'='SCHEDULE_DELAY' AND (value->>'segmentId')::bigint=(rowstate->>'id')::bigint;
    IF minutes<0 THEN RAISE EXCEPTION 'Invalid delay'; END IF;
    SELECT s.starts_at INTO oldtime FROM public.event_segments s WHERE s.id=(rowstate->>'id')::bigint;
    IF oldtime<(rowstate->>'starts_at')::timestamptz+make_interval(mins=>minutes::integer) THEN RAISE EXCEPTION 'Required simulated delay was not preserved'; END IF;
   END LOOP;
   -- Consent can expire while validating a large plan, not just while locking.
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p.changes) c WHERE c ? 'replacementMemberId' AND NOT EXISTS(
     SELECT 1 FROM simulator_private.replacement_invitations accepted WHERE accepted.plan_id=p.id
       AND accepted.recipient_member_id=(c->>'replacementMemberId')::bigint
       AND accepted.replaced_member_id=(c->>'replacedMemberId')::bigint
       AND accepted.status='Accepted' AND accepted.expires_at>clock_timestamp()))
   THEN RAISE EXCEPTION 'Invitation expired before recovery completion'; END IF;
   current_state:=simulator_private.event_state(p.event_id);
   UPDATE simulator_private.recovery_plans SET after_state=current_state,after_fingerprint=simulator_private.state_fingerprint(current_state),application_status='Applied',lifecycle='Resolved',
     version=version+1,applied_at=clock_timestamp(),applied_by=actor WHERE id=p.id RETURNING * INTO p;
  ELSE
   current_state:=simulator_private.event_state(p.event_id);
   IF current_state IS DISTINCT FROM p.before_state OR simulator_private.state_fingerprint(current_state) IS DISTINCT FROM p.before_fingerprint
   THEN RAISE EXCEPTION 'Restoration did not match original event state'; END IF;
   UPDATE simulator_private.recovery_plans SET application_status='Undone',lifecycle='Open',version=version+1,undone_at=clock_timestamp(),undone_by=actor WHERE id=p.id RETURNING * INTO p;
  END IF;
  INSERT INTO simulator_private.recovery_audit(plan_id,actor_member_id,action,outcome,details)
   VALUES(p.id,actor,CASE WHEN p_undo THEN 'UNDO' ELSE 'APPLY' END,'Succeeded','Telegram messages and external booking transfers are not reversed');
  RETURN to_jsonb(p);
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO simulator_private.recovery_audit(plan_id,actor_member_id,action,outcome,details)
   VALUES(p.id,actor,CASE WHEN p_undo THEN 'UNDO' ELSE 'APPLY' END,'Blocked',SQLERRM);
  RETURN jsonb_build_object('ok',false,'error',SQLERRM);
 END;
END $$;

REVOKE ALL ON FUNCTION simulator_private.assert_undo_disruptions_clear(bigint,jsonb),
 simulator_private.transition_plan(uuid,integer,boolean,boolean) FROM PUBLIC,anon,authenticated;
-- Public Apply/Undo RPC signatures, owners and grants are unchanged.
COMMIT;
