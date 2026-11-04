-- LOCAL REVIEW ONLY. New contracts for the connected Supabase reviewer.
-- Requires deployed recovery migration 002 helpers; never edits the roster RPC.
-- Original links are separate from rpc_simulator_attach_booking (PLAN changes).
-- No notifications/Telegram calls, calendar mutations, RLS weakening or gate activation.
BEGIN;
ALTER TABLE simulator_private.release_gate
 ADD COLUMN original_booking_linking_enabled boolean NOT NULL DEFAULT false;
-- Owner-reviewed bindings, NOT guessed shared-table columns. Defaults deliberately
-- certify no audience source and no per-record approval meaning for "Booked".
-- Configure only after reviewing actual column semantics and calendar RPC bodies.
CREATE TABLE simulator_private.original_booking_review_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 activity_audience_column name,
 event_audience_column name,
 audience_includes_staff boolean NOT NULL DEFAULT false,
 booked_approval_column name,
 booked_approval_value text
);
INSERT INTO simulator_private.original_booking_review_policy DEFAULT VALUES;
ALTER TABLE simulator_private.original_booking_review_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE simulator_private.original_booking_review_policy FROM PUBLIC,anon,authenticated;

-- Historical keys are archival identifiers, not live foreign keys. Live targets
-- are verified when the audit is inserted; immutable snapshots survive normal
-- deletion AND public calendar TRUNCATE/CASCADE reset jobs without acquiring a
-- new dependency on those tables. No existing migration-002 FKs are changed.
CREATE TABLE simulator_private.original_booking_link_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_id bigint NOT NULL CHECK(event_id>0),
 segment_id bigint NOT NULL CHECK(segment_id>0),
 booking_id bigint NOT NULL CHECK(booking_id>0),
 actor_member_id bigint NOT NULL CHECK(actor_member_id>0),
 evidence_snapshot jsonb NOT NULL,
 snapshot_fingerprint text NOT NULL,
 manual_suitability_verified boolean NOT NULL CHECK(manual_suitability_verified),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE simulator_private.original_booking_link_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE simulator_private.original_booking_link_audit FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA simulator_private FROM PUBLIC,anon,authenticated;

CREATE FUNCTION simulator_private.protect_original_booking_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Original booking audit history cannot be erased'; END IF;
 IF TG_OP='UPDATE' THEN
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Original booking audit history is immutable'; END IF;
  RETURN NEW;
 END IF;
 -- These are real references at capture time. Thereafter their immutable IDs
 -- and snapshots are the authoritative history, even if live objects disappear.
 IF NOT EXISTS(SELECT 1 FROM public.event_segments s JOIN public.events e ON e.id=s.event_id
   WHERE s.id=NEW.segment_id AND e.id=NEW.event_id)
  OR NOT EXISTS(SELECT 1 FROM public.facility_bookings b WHERE b.id=NEW.booking_id)
  OR NOT EXISTS(SELECT 1 FROM public.members m WHERE m.id=NEW.actor_member_id)
 THEN RAISE EXCEPTION 'Audit source objects are not valid at capture time'; END IF;
 IF (NEW.evidence_snapshot->>'event_id')::bigint IS DISTINCT FROM NEW.event_id
  OR (NEW.evidence_snapshot->>'segment_id')::bigint IS DISTINCT FROM NEW.segment_id
  OR (NEW.evidence_snapshot->>'booking_id')::bigint IS DISTINCT FROM NEW.booking_id
  OR (NEW.evidence_snapshot->>'actor_member_id')::bigint IS DISTINCT FROM NEW.actor_member_id
  OR simulator_private.state_fingerprint(NEW.evidence_snapshot) IS DISTINCT FROM NEW.snapshot_fingerprint
 THEN RAISE EXCEPTION 'Audit snapshot does not match its source keys or fingerprint'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_original_booking_audit_rows BEFORE INSERT OR UPDATE OR DELETE
 ON simulator_private.original_booking_link_audit FOR EACH ROW EXECUTE FUNCTION simulator_private.protect_original_booking_audit();
CREATE TRIGGER protect_original_booking_audit_truncate BEFORE TRUNCATE
 ON simulator_private.original_booking_link_audit FOR EACH STATEMENT EXECUTE FUNCTION simulator_private.protect_original_booking_audit();

-- One shared server-side eligibility check for discovery AND locked linking.
-- Unknown audience/capacity requires explicit manual verification; staff count
-- alone never certifies suitability. Approval and time coverage fail closed.
CREATE FUNCTION simulator_private.original_booking_evidence(p_segment bigint,p_booking bigint,p_club bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE seg public.event_segments; book public.facility_bookings; room public.facilities;
 reasons jsonb:='[]'::jsonb; verification jsonb:='[]'::jsonb; headcount bigint; capacity_value numeric;
 policy simulator_private.original_booking_review_policy; event_record jsonb; audience_text text;
 audience_value numeric; required_value numeric; audience_source text; capacity_verified boolean:=false; approval_verified boolean:=false;
BEGIN
 SELECT * INTO policy FROM simulator_private.original_booking_review_policy WHERE singleton;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed booking policy is unavailable'; END IF;
 SELECT * INTO seg FROM public.event_segments WHERE id=p_segment;
 IF NOT FOUND THEN RAISE EXCEPTION 'Activity unavailable'; END IF;
 SELECT to_jsonb(e) INTO event_record FROM public.events e WHERE e.id=seg.event_id;
 SELECT * INTO book FROM public.facility_bookings WHERE id=p_booking;
 IF NOT FOUND THEN RAISE EXCEPTION 'Booking unavailable'; END IF;
 SELECT * INTO room FROM public.facilities WHERE id=book.facility_id;
 IF NOT FOUND OR room.is_active IS DISTINCT FROM true THEN reasons:=reasons||jsonb_build_array('Facility is missing or inactive'); END IF;
 IF book.owner_club_id IS DISTINCT FROM p_club THEN reasons:=reasons||jsonb_build_array('Booking belongs to another club'); END IF;
 -- Booked alone is not verified approval. A reviewed per-record marker must
 -- establish approval; only the explicit confirmed status is accepted by default.
 approval_verified:=book.status='Officially Confirmed Booking' OR
  (book.status='Booked' AND policy.booked_approval_column IS NOT NULL AND policy.booked_approval_value IS NOT NULL
   AND to_jsonb(book)->>policy.booked_approval_column::text=policy.booked_approval_value);
 IF approval_verified IS DISTINCT FROM true THEN reasons:=reasons||jsonb_build_array('Booking requires verified final approval; Booked alone is insufficient'); END IF;
 -- The existing model represents one booking_date with start/end time, not
 -- invented overnight reservations. Cross-midnight coverage must really exist.
 IF ((seg.starts_at<seg.ends_at) AND
  ((book.booking_date+book.start_time) AT TIME ZONE 'Asia/Singapore'<=seg.starts_at) AND
  ((book.booking_date+book.end_time) AT TIME ZONE 'Asia/Singapore'>=seg.ends_at)) IS NOT TRUE
 THEN reasons:=reasons||jsonb_build_array('Booking does not cover the complete activity'); END IF;
 SELECT count(DISTINCT a.member_id) INTO headcount FROM public.segment_assignments a WHERE a.segment_id=seg.id;
 -- Reviewed source bindings only: missing values never certify suitability.
 IF policy.activity_audience_column IS NOT NULL THEN
  audience_text:=to_jsonb(seg)->>policy.activity_audience_column::text;
  IF coalesce(audience_text,'') ~ '^[0-9]+$' THEN audience_source:='activity.'||policy.activity_audience_column; END IF;
 END IF;
 IF audience_source IS NULL AND policy.event_audience_column IS NOT NULL THEN
  audience_text:=event_record->>policy.event_audience_column::text;
  IF coalesce(audience_text,'') ~ '^[0-9]+$' THEN audience_source:='event.'||policy.event_audience_column; END IF;
 END IF;
 IF audience_source IS NOT NULL THEN
  audience_value:=audience_text::numeric;
  required_value:=CASE WHEN policy.audience_includes_staff THEN greatest(audience_value,headcount) ELSE audience_value+headcount END;
 ELSE verification:=verification||jsonb_build_array('Audience requirement is unknown; manually verify total attendance and room capacity'); END IF;
 IF coalesce(to_jsonb(room)->>'capacity','') ~ '^[0-9]+$' THEN
  capacity_value:=(to_jsonb(room)->>'capacity')::numeric;
  IF capacity_value<headcount THEN reasons:=reasons||jsonb_build_array('Room capacity is below the assigned-member minimum'); END IF;
  IF required_value IS NOT NULL AND capacity_value<required_value THEN reasons:=reasons||jsonb_build_array('Room capacity is below the verified total attendance requirement'); END IF;
  capacity_verified:=required_value IS NOT NULL AND capacity_value>=required_value;
 ELSE verification:=verification||jsonb_build_array('Room capacity is unknown; explicit manual capacity verification is required'); END IF;
 verification:=verification||jsonb_build_array('Required equipment, layout and suitability require explicit organizer verification');
 IF EXISTS(SELECT 1 FROM public.segment_facility_bookings link JOIN public.event_segments other ON other.id=link.segment_id
  WHERE link.booking_id=book.id AND other.event_id<>seg.event_id)
 THEN reasons:=reasons||jsonb_build_array('Booking is allocated to another event'); END IF;
 IF EXISTS(SELECT 1 FROM public.segment_facility_bookings link WHERE link.segment_id=seg.id AND link.booking_id<>book.id)
 THEN reasons:=reasons||jsonb_build_array('Activity already has a different allocation; use reviewed event editing'); END IF;
 IF EXISTS(SELECT 1 FROM public.facility_bookings other WHERE other.id<>book.id AND other.facility_id=book.facility_id
  AND (other.booking_date+other.start_time) AT TIME ZONE 'Asia/Singapore'<seg.ends_at
  AND seg.starts_at<(other.booking_date+other.end_time) AT TIME ZONE 'Asia/Singapore')
 THEN reasons:=reasons||jsonb_build_array('Another recorded reservation overlaps the room'); END IF;
 IF EXISTS(SELECT 1 FROM public.segment_facility_bookings link JOIN public.event_segments other ON other.id=link.segment_id
  JOIN public.facility_bookings other_book ON other_book.id=link.booking_id
  WHERE other.id<>seg.id AND other_book.facility_id=book.facility_id
  AND other.starts_at<seg.ends_at AND seg.starts_at<other.ends_at)
 THEN reasons:=reasons||jsonb_build_array('Another activity overlaps in this room'); END IF;
 RETURN jsonb_build_object('booking_id',book.id,'facility_id',book.facility_id,'facility_name',room.name,
  'booking_date',book.booking_date,'start_time',book.start_time,'end_time',book.end_time,
  'owner_club_id',book.owner_club_id,'status',book.status,'capacity',capacity_value,
  'minimum_capacity',headcount,'audience_requirement',audience_value,'required_capacity',required_value,
  'audience_source',audience_source,'capacity_verified',capacity_verified,'approval_verified',coalesce(approval_verified,false),
  'manual_suitability_required',true,'verification_required',verification,'eligible',jsonb_array_length(reasons)=0,'reasons',reasons,
  'booking_fingerprint',simulator_private.state_fingerprint(jsonb_build_object('booking',to_jsonb(book),'facility',to_jsonb(room),
   'event',event_record,'activity',to_jsonb(seg),'staff_minimum',headcount,'review_policy',to_jsonb(policy))));
END $$;

CREATE FUNCTION public.rpc_simulator_original_booking_candidates(p_event_id bigint,p_segment_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE club bigint:=simulator_private.event_club(p_event_id,true); seg public.event_segments; candidates jsonb;
BEGIN
 SELECT * INTO seg FROM public.event_segments WHERE id=p_segment_id AND event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Activity does not belong to the selected event' USING ERRCODE='42501'; END IF;
 -- Club ownership restricts disclosure. All statuses remain visible with reasons;
 -- absence of a candidate never implies a vacant room can be booked.
 SELECT coalesce(jsonb_agg(simulator_private.original_booking_evidence(seg.id,b.id,club)
  ORDER BY b.booking_date,b.start_time,b.id),'[]'::jsonb) INTO candidates
 FROM public.facility_bookings b WHERE b.owner_club_id=club
  AND b.booking_date BETWEEN (seg.starts_at AT TIME ZONE 'Asia/Singapore')::date
   AND (seg.ends_at AT TIME ZONE 'Asia/Singapore')::date;
 RETURN jsonb_build_object('event_id',p_event_id,'segment_id',seg.id,
  'event_fingerprint',simulator_private.state_fingerprint(simulator_private.event_state(p_event_id)),'bookings',candidates);
END $$;

CREATE FUNCTION public.rpc_simulator_link_original_booking(p_event_id bigint,p_segment_id bigint,p_booking_id bigint,
 p_expected_event_fingerprint text,p_expected_booking_fingerprint text,p_acknowledge_suitability boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor bigint:=simulator_private.actor(); club bigint; evidence jsonb; audit_snapshot jsonb; current_event_fingerprint text;
BEGIN
 -- actor() establishes lock_timeout BEFORE relation/row lock waits.
 club:=simulator_private.event_club(p_event_id,true);
 -- Hold a shared gate-row lock so a release revocation cannot race this write.
 PERFORM singleton FROM simulator_private.release_gate WHERE original_booking_linking_enabled FOR SHARE;
 IF NOT FOUND
 THEN RAISE EXCEPTION 'Original booking linking is not deployed and verified for release' USING ERRCODE='55000'; END IF;
 IF coalesce(p_acknowledge_suitability,false) IS NOT TRUE THEN RAISE EXCEPTION 'Confirm audience capacity, equipment and suitability first'; END IF;
 -- Reject absent or malformed evidence before waiting for broad writer locks.
 -- Fingerprints are opaque server hashes, never timestamps rounded by the UI.
 IF coalesce(p_expected_event_fingerprint,'') !~ '^[a-f0-9]{64}$'
  OR coalesce(p_expected_booking_fingerprint,'') !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'Refresh the booking evidence first'; END IF;
 -- Same table ordering as recovery Confirm/Undo. Ordinary writers can still
 -- deadlock if they use another order; full-schema two-session tests are required.
 LOCK TABLE public.event_segments,public.facility_bookings,public.segment_assignments,public.segment_facility_bookings IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.club_memberships,public.clubs,public.exco_roles,public.facilities,public.members,public.segment_dependencies IN SHARE MODE;
 -- Keep reviewed source/approval policy stable throughout the locked decision.
 LOCK TABLE simulator_private.original_booking_review_policy IN SHARE MODE;
 PERFORM e.id FROM public.events e WHERE e.id=p_event_id FOR UPDATE;
 club:=simulator_private.event_club(p_event_id,true);
 IF NOT EXISTS(SELECT 1 FROM public.event_segments WHERE id=p_segment_id AND event_id=p_event_id)
 THEN RAISE EXCEPTION 'Activity does not belong to the selected event' USING ERRCODE='42501'; END IF;
 evidence:=simulator_private.original_booking_evidence(p_segment_id,p_booking_id,club);
 IF evidence->>'booking_fingerprint' IS DISTINCT FROM p_expected_booking_fingerprint
 THEN RAISE EXCEPTION 'Booking changed; refresh eligibility'; END IF;
 IF (evidence->>'eligible')::boolean IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Booking is ineligible: %',evidence->'reasons'; END IF;
 -- An exact retry may use its ORIGINAL pre-link fingerprint, but only while
 -- the current event still matches the recorded post-link state. Later edits
 -- must never be reported as an unchanged, successfully retried association.
 current_event_fingerprint:=simulator_private.state_fingerprint(simulator_private.event_state(p_event_id));
 IF EXISTS(SELECT 1 FROM public.segment_facility_bookings WHERE segment_id=p_segment_id AND booking_id=p_booking_id) THEN
  IF current_event_fingerprint IS DISTINCT FROM p_expected_event_fingerprint AND NOT EXISTS(
   SELECT 1 FROM simulator_private.original_booking_link_audit a
   WHERE a.event_id=p_event_id AND a.segment_id=p_segment_id AND a.booking_id=p_booking_id
    AND a.evidence_snapshot->>'before_event_fingerprint'=p_expected_event_fingerprint
    AND a.evidence_snapshot->>'after_event_fingerprint'=current_event_fingerprint
    AND a.evidence_snapshot->>'source_booking_fingerprint'=p_expected_booking_fingerprint)
  THEN RAISE EXCEPTION 'Event changed; refresh eligibility'; END IF;
  RETURN jsonb_build_object('linked',true,'already_linked',true,'event_id',p_event_id,'segment_id',p_segment_id,'booking_id',p_booking_id);
 END IF;
 IF current_event_fingerprint IS DISTINCT FROM p_expected_event_fingerprint
 THEN RAISE EXCEPTION 'Event changed; refresh eligibility'; END IF;
 INSERT INTO public.segment_facility_bookings(segment_id,booking_id) VALUES(p_segment_id,p_booking_id);
 audit_snapshot:=(evidence-'booking_fingerprint')||jsonb_build_object('event_id',p_event_id,
  'segment_id',p_segment_id,'actor_member_id',actor,'manual_suitability_verified',true,
  'before_event_fingerprint',p_expected_event_fingerprint,
  'after_event_fingerprint',simulator_private.state_fingerprint(simulator_private.event_state(p_event_id)),
  'source_booking_fingerprint',p_expected_booking_fingerprint);
 INSERT INTO simulator_private.original_booking_link_audit(event_id,segment_id,booking_id,actor_member_id,
  evidence_snapshot,snapshot_fingerprint,manual_suitability_verified)
 VALUES(p_event_id,p_segment_id,p_booking_id,actor,audit_snapshot,simulator_private.state_fingerprint(audit_snapshot),true);
 RETURN jsonb_build_object('linked',true,'already_linked',false,'event_id',p_event_id,'segment_id',p_segment_id,'booking_id',p_booking_id);
END $$;

-- A protected member inbox replaces neither notifications nor Telegram.
-- Identity is derived on the server. No other recipient or plan snapshots leak.
CREATE FUNCTION public.rpc_simulator_my_invitations() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor bigint:=simulator_private.actor(); result jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'event_name',e.name,
  'status',CASE WHEN i.status IN ('Pending','Accepted') AND i.expires_at<=clock_timestamp() THEN 'Expired' ELSE i.status END,
  'delivery_status',i.delivery_status,'expires_at',i.expires_at,'assignment_snapshot',i.assignment_snapshot)
  ORDER BY i.created_at DESC,i.id),'[]'::jsonb) INTO result
 FROM simulator_private.replacement_invitations i
 JOIN simulator_private.recovery_plans p ON p.id=i.plan_id JOIN public.events e ON e.id=p.event_id
 WHERE i.recipient_member_id=actor AND EXISTS(
  SELECT 1 FROM public.clubs c JOIN public.club_memberships cm ON cm.club_id=c.id
  JOIN public.exco_roles r ON r.id=cm.role_id WHERE (e.club_name=c.name OR e.club_name=c.short_name)
   AND c.active=true AND cm.member_id=actor AND cm.is_active=true AND r.is_admin_role=false);
 RETURN jsonb_build_object('invitations',result);
END $$;
REVOKE ALL ON FUNCTION simulator_private.protect_original_booking_audit() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION simulator_private.original_booking_evidence(bigint,bigint,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rpc_simulator_original_booking_candidates(bigint,bigint),
 public.rpc_simulator_link_original_booking(bigint,bigint,bigint,text,text,boolean),public.rpc_simulator_my_invitations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_simulator_original_booking_candidates(bigint,bigint),
 public.rpc_simulator_link_original_booking(bigint,bigint,bigint,text,text,boolean),public.rpc_simulator_my_invitations() TO authenticated;
-- Review trusted owner, endpoint signatures, deployed 002 helper bodies, private
-- schema exposure and audit retention before deployment. Leave every gate OFF.
COMMIT;
