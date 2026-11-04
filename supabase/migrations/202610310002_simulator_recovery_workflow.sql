-- PREPARED ONLY. Do not execute without separate database deployment approval.
-- Target: bdqzysnapwxdzppkuftn. The existing public roster RPC is not replaced,
-- called for recovery authorization, or redeployed by this migration. Do not run
-- migration 001 blindly: that public roster function is already installed.
-- User-supplied live inspection confirms the required tables/relationships,
-- roster JSONB RPC, calendar RPCs/views, and notification action_url -> link_path.
-- Full DDL/defaults/checks, trigger bodies, effective grants/owners, calendar
-- authorization bodies and staging lock/transaction behavior still need review.
-- Shared calendar anon EXECUTE grants are NOT proof of authorized operation;
-- this migration neither invokes its mutation RPCs nor changes their grants.
-- SECURITY: notifications is publicly readable and INSERT triggers push work.
-- Never publish private invitation details there, even through a definer helper.
-- No notification inserts, notification writer, or Telegram integration are added.
-- All new workflow writes default OFF until approved deployment AND verification.
-- Keep CREATE fail-closed; never overwrite an unknown installed implementation.
BEGIN;
CREATE SCHEMA simulator_private;
REVOKE ALL ON SCHEMA simulator_private FROM PUBLIC, anon, authenticated;

CREATE TABLE simulator_private.release_gate (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  invitations_enabled boolean NOT NULL DEFAULT false,
  application_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO simulator_private.release_gate DEFAULT VALUES;

-- Historical references deliberately retain the default NO ACTION behavior.
-- Deleting referenced events/members is blocked, not cascaded or silently nulled.
-- Team approval of retention/archival policy is required before deployment.
CREATE TABLE simulator_private.recovery_plans (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  event_id bigint NOT NULL REFERENCES public.events(id),
  organizer_member_id bigint NOT NULL REFERENCES public.members(id),
  title text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  start_request_id uuid,
  start_payload jsonb,
  UNIQUE(organizer_member_id,start_request_id),
  lifecycle text NOT NULL DEFAULT 'Open' CHECK(lifecycle IN ('Open','In Progress','Resolved','Cancelled')),
  application_status text NOT NULL DEFAULT 'Draft' CHECK(application_status IN ('Draft','Applied','Undone','Cancelled')),
  changes jsonb NOT NULL CHECK(jsonb_typeof(changes)='array'),
  disruptions jsonb NOT NULL CHECK(jsonb_typeof(disruptions)='array'),
  before_state jsonb NOT NULL,
  before_fingerprint text NOT NULL,
  after_state jsonb,
  after_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  applied_at timestamptz, applied_by bigint REFERENCES public.members(id),
  undone_at timestamptz, undone_by bigint REFERENCES public.members(id)
);
CREATE TABLE simulator_private.replacement_invitations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES simulator_private.recovery_plans(id),
  recipient_member_id bigint NOT NULL REFERENCES public.members(id),
  replaced_member_id bigint NOT NULL REFERENCES public.members(id),
  assignment_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Accepted','Declined','Expired','Cancelled')),
  delivery_status text NOT NULL DEFAULT 'Pending Delivery',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
  responded_at timestamptz
);
CREATE UNIQUE INDEX simulator_one_current_invitation
  ON simulator_private.replacement_invitations(plan_id,recipient_member_id,replaced_member_id)
  WHERE status IN ('Pending','Accepted');
CREATE TABLE simulator_private.recovery_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES simulator_private.recovery_plans(id),
  actor_member_id bigint NOT NULL REFERENCES public.members(id),
  action text NOT NULL, outcome text NOT NULL, details text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Defense in depth: no direct browser grants or policies on private workflow tables.
ALTER TABLE simulator_private.recovery_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulator_private.replacement_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulator_private.recovery_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulator_private.release_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA simulator_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA simulator_private FROM PUBLIC, anon, authenticated;

-- Native PostgreSQL timestamps retain six digits. Never round originals through
-- JavaScript Date before saving: Undo must restore the exact microsecond value.
CREATE FUNCTION simulator_private.iso(p_time timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

-- SHA-256 is a deterministic change fingerprint, not an authorization token.
-- Hash the SERVER JSONB representation with sorted arrays and lossless times.
-- Never trust a browser to generate its own authoritative state fingerprint.
CREATE FUNCTION simulator_private.state_fingerprint(p_state jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(p_state::text,'UTF8')),'hex')
$$;

-- Returns the actual caller member ID, rejecting ambiguous identity mappings.
CREATE FUNCTION simulator_private.actor() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result bigint; matches bigint;
BEGIN
 -- Applies before the actor lookup can wait on a relation lock.
 PERFORM set_config('lock_timeout','5s',true);
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT count(*),min(m.id) INTO matches,result FROM public.members m WHERE m.auth_user_id=auth.uid() AND m.is_active;
 IF matches<>1 THEN RAISE EXCEPTION 'Active member identity required' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

-- Recovery authorization is independent of the public roster reader and its
-- JSON envelope. An authenticated roster viewer is NOT automatically an organizer.
-- These exact event/club name rules were verified earlier; do not infer club IDs
-- from browser input, organization names supplied by the caller, or demo IDs.
CREATE FUNCTION simulator_private.event_club(p_event bigint,p_manage boolean) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE club bigint; matches bigint; actor bigint:=simulator_private.actor();
BEGIN
 IF p_event IS NULL OR p_manage IS NULL THEN
  RAISE EXCEPTION 'Event unavailable or not authorised' USING ERRCODE='42501';
 END IF;
 SELECT count(*),min(c.id) INTO matches,club
  FROM public.events e JOIN public.clubs c ON e.club_name=c.name OR e.club_name=c.short_name
  WHERE e.id=p_event AND c.active=true;
 -- Missing/inactive clubs and ambiguous full-name/short-name matches fail closed.
 IF matches<>1 THEN
  RAISE EXCEPTION 'Event unavailable or not authorised' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.club_memberships cm JOIN public.exco_roles r ON r.id=cm.role_id
  WHERE cm.member_id=actor AND cm.club_id=club AND cm.is_active=true
    AND r.is_admin_role=false AND (NOT p_manage OR r.can_manage_members=true))
 THEN RAISE EXCEPTION 'Event management permission required' USING ERRCODE='42501'; END IF;
 RETURN club;
END $$;
CREATE FUNCTION simulator_private.require_release(p_apply boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM simulator_private.release_gate g
   WHERE CASE WHEN p_apply THEN g.application_enabled ELSE g.invitations_enabled END)
 THEN RAISE EXCEPTION 'Simulator backend is not released for real operations' USING ERRCODE='55000'; END IF;
END $$;

-- Whole-event snapshots are deliberately conservative. Edits elsewhere in this
-- event block apply/undo, while changes in unrelated events do not overwrite data.
CREATE FUNCTION simulator_private.event_state(p_event bigint) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
 'event',(SELECT jsonb_build_object('id',e.id,'name',e.name,'club_name',e.club_name,
   'starts_at',simulator_private.iso(e.starts_at),'ends_at',simulator_private.iso(e.ends_at)) FROM public.events e WHERE e.id=p_event),
 'segments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'event_id',s.event_id,'title',s.title,'segment_type',s.segment_type,
   'starts_at',simulator_private.iso(s.starts_at),'ends_at',simulator_private.iso(s.ends_at)) ORDER BY s.id) FROM public.event_segments s WHERE s.event_id=p_event),'[]'::jsonb),
 'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'segment_id',a.segment_id,'member_id',a.member_id,'role_name',a.role_name,'is_required',a.is_required) ORDER BY a.id)
   FROM public.segment_assignments a JOIN public.event_segments s ON s.id=a.segment_id WHERE s.event_id=p_event),'[]'::jsonb),
 'links',coalesce((SELECT jsonb_agg(jsonb_build_object('segment_id',l.segment_id,'booking_id',l.booking_id) ORDER BY l.segment_id,l.booking_id)
   FROM public.segment_facility_bookings l JOIN public.event_segments s ON s.id=l.segment_id WHERE s.event_id=p_event),'[]'::jsonb))
$$;

-- Authorized read-only capture: the frontend compares this exact state with its
-- reviewed preview. Save rechecks the opaque server fingerprint under its own
-- statement snapshot, so capturing newer rows cannot silently rebase an old plan.
CREATE FUNCTION public.rpc_simulator_capture_state(p_event_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snapshot jsonb;
BEGIN
 PERFORM simulator_private.event_club(p_event_id,true);
 snapshot:=simulator_private.event_state(p_event_id);
 RETURN jsonb_build_object('state',snapshot,'fingerprint',simulator_private.state_fingerprint(snapshot));
END $$;

-- Validate ALL visible-to-server assignments, including other clubs' events.
-- Academic/personal timetables have no verified source: application requires an
-- explicit organizer review acknowledgement, not an invented availability claim.
CREATE FUNCTION simulator_private.validate_event(p_event bigint,p_club bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; booking record; facility jsonb; headcount bigint;
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
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.segment_facility_bookings l1 JOIN public.event_segments s1 ON s1.id=l1.segment_id
   JOIN public.facility_bookings b1 ON b1.id=l1.booking_id
   JOIN public.segment_facility_bookings l2 ON l2.segment_id<>l1.segment_id
   JOIN public.facility_bookings b2 ON b2.id=l2.booking_id AND b2.facility_id=b1.facility_id
   JOIN public.event_segments s2 ON s2.id=l2.segment_id
   WHERE s1.event_id=p_event AND s1.starts_at<s2.ends_at AND s2.starts_at<s1.ends_at)
 THEN RAISE EXCEPTION 'Activities overlap in the same physical room'; END IF;
END $$;

-- The server constructs invitation terms from saved plan changes and current
-- assignments. A recipient accepts these EXACT roles, activities and timings.
CREATE FUNCTION simulator_private.invitation_terms(p_plan uuid,p_replaced bigint) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('assignment_id',a.id,'segment_id',s.id,'activity',s.title,
   'role_name',a.role_name,'replaced_member_id',a.member_id,
   'starts_at',simulator_private.iso(coalesce(times.starts_at::timestamptz,s.starts_at)),
   'ends_at',simulator_private.iso(coalesce(times.ends_at::timestamptz,s.ends_at))) ORDER BY a.id),'[]'::jsonb)
 FROM simulator_private.recovery_plans p
 CROSS JOIN LATERAL jsonb_array_elements(p.changes) c
 JOIN public.segment_assignments a ON a.id=(c->>'assignmentId')::bigint AND a.member_id=p_replaced
 JOIN public.event_segments s ON s.id=a.segment_id AND s.event_id=p.event_id
 LEFT JOIN LATERAL (SELECT
   (SELECT value->>'starts_at' FROM jsonb_array_elements(p.changes) WHERE (value->>'segmentId')::bigint=s.id AND value ? 'starts_at' LIMIT 1) AS starts_at,
   (SELECT value->>'ends_at' FROM jsonb_array_elements(p.changes) WHERE (value->>'segmentId')::bigint=s.id AND value ? 'ends_at' LIMIT 1) AS ends_at
 ) times ON true
 WHERE p.id=p_plan AND (c->>'replacedMemberId')::bigint=p_replaced
$$;

-- PL/pgSQL variables use v_ names so they cannot collide with SQL row aliases.
-- PostgreSQL resolves function statements at execution too, not only CREATE time.
-- Save a revision only when the browser preview exactly matches current rows.
CREATE FUNCTION public.rpc_simulator_save_plan(p_event_id bigint,p_title text,p_changes jsonb,p_expected_state jsonb,p_expected_fingerprint text,p_disruptions jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor bigint:=simulator_private.actor(); club bigint; plan simulator_private.recovery_plans; v_change jsonb; v_disruption jsonb; snapshot jsonb; fingerprint text;
BEGIN
 -- Bound waits BEFORE acquiring the plan/recipient/row/table locks.
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM simulator_private.require_release(false);
 club:=simulator_private.event_club(p_event_id,true);
 IF p_changes IS NULL OR p_disruptions IS NULL OR jsonb_typeof(p_changes)<>'array' OR jsonb_typeof(p_disruptions)<>'array'
 THEN RAISE EXCEPTION 'Recovery changes and disruptions must be arrays'; END IF;
 IF jsonb_array_length(p_changes)=0 OR jsonb_array_length(p_changes)>200 OR jsonb_array_length(p_disruptions)=0 OR jsonb_array_length(p_disruptions)>100
 THEN RAISE EXCEPTION 'A bounded, non-empty recovery preview is required'; END IF;
 FOR v_disruption IN SELECT value FROM jsonb_array_elements(p_disruptions) LOOP
  IF v_disruption->>'type'='SCHEDULE_DELAY' THEN
   IF coalesce(v_disruption->>'delayMinutes','') !~ '^[1-9][0-9]*$' OR (v_disruption->>'delayMinutes')::numeric>1440
     OR NOT EXISTS(SELECT 1 FROM public.event_segments s WHERE s.id=(v_disruption->>'segmentId')::bigint AND s.event_id=p_event_id)
   THEN RAISE EXCEPTION 'Invalid schedule delay'; END IF;
  ELSIF v_disruption->>'type' IN ('MEMBER_UNAVAILABLE','FACILITY_UNAVAILABLE') THEN
   IF v_disruption->>'start' IS NULL OR v_disruption->>'end' IS NULL OR (v_disruption->>'start')::timestamptz>=(v_disruption->>'end')::timestamptz THEN RAISE EXCEPTION 'Invalid unavailable period'; END IF;
   IF v_disruption->>'type'='MEMBER_UNAVAILABLE' AND NOT EXISTS(SELECT 1 FROM public.segment_assignments a JOIN public.event_segments s ON s.id=a.segment_id
     WHERE s.event_id=p_event_id AND a.member_id=(v_disruption->>'memberId')::bigint) THEN RAISE EXCEPTION 'Unavailable member is not assigned to this event'; END IF;
   IF v_disruption->>'type'='FACILITY_UNAVAILABLE' AND NOT EXISTS(SELECT 1 FROM public.segment_facility_bookings l JOIN public.event_segments s ON s.id=l.segment_id
     JOIN public.facility_bookings b ON b.id=l.booking_id JOIN public.facilities f ON f.id=b.facility_id
     WHERE s.event_id=p_event_id AND f.name=v_disruption->>'venueName') THEN RAISE EXCEPTION 'Unavailable room is not linked to this event'; END IF;
  ELSE RAISE EXCEPTION 'Unsupported disruption'; END IF;
 END LOOP;
 snapshot:=simulator_private.event_state(p_event_id);
 fingerprint:=simulator_private.state_fingerprint(snapshot);
 IF p_expected_fingerprint IS NULL OR p_expected_fingerprint IS DISTINCT FROM fingerprint OR p_expected_state IS DISTINCT FROM snapshot
 THEN RAISE EXCEPTION 'Event changed; refresh and regenerate the preview'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_changes) c WHERE c ? 'replacementMemberId'
   GROUP BY c->>'replacedMemberId' HAVING count(DISTINCT c->>'replacementMemberId')>1)
 THEN RAISE EXCEPTION 'Split replacements for one member require separate reviewed plans'; END IF;
 FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
   IF NOT (v_change ?| ARRAY['replacementMemberId','venueName','facilityBookingId','starts_at','ends_at']) THEN RAISE EXCEPTION 'An actionable recovery selection is required'; END IF;
   IF v_change ? 'venueName' AND coalesce(trim(v_change->>'venueName'),'')='' THEN RAISE EXCEPTION 'A proposed room name is required'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.event_segments s WHERE s.id=(v_change->>'segmentId')::bigint AND s.event_id=p_event_id)
   THEN RAISE EXCEPTION 'Plan refers to an unrelated activity'; END IF;
   IF v_change ? 'replacementMemberId' AND NOT EXISTS(SELECT 1 FROM public.segment_assignments a
     WHERE a.id=(v_change->>'assignmentId')::bigint AND a.segment_id=(v_change->>'segmentId')::bigint AND a.member_id=(v_change->>'replacedMemberId')::bigint)
   THEN RAISE EXCEPTION 'Exact original assignment is required'; END IF;
 END LOOP;
 -- Reject contradictory selections before creating pending work.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_changes) c CROSS JOIN LATERAL jsonb_each(c) field
  WHERE field.key IN ('starts_at','ends_at','venueName','facilityBookingId') GROUP BY c->>'segmentId',field.key HAVING count(DISTINCT field.value)>1)
 THEN RAISE EXCEPTION 'Contradictory recovery choices'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_changes) c WHERE c ? 'replacementMemberId' GROUP BY c->>'assignmentId' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'Duplicate assignment changes'; END IF;
 INSERT INTO simulator_private.recovery_plans(event_id,organizer_member_id,title,changes,disruptions,before_state,before_fingerprint)
 VALUES(p_event_id,actor,left(coalesce(p_title,'Recovery preview'),200),p_changes,p_disruptions,snapshot,fingerprint) RETURNING * INTO plan;
 INSERT INTO simulator_private.recovery_audit(plan_id,actor_member_id,action,outcome) VALUES(plan.id,actor,'SAVE','Succeeded');
 RETURN to_jsonb(plan);
END $$;

CREATE FUNCTION public.rpc_simulator_invite(p_plan_id uuid,p_recipient_member_id bigint,p_replaced_member_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p simulator_private.recovery_plans; i simulator_private.replacement_invitations; terms jsonb; club bigint; actor bigint:=simulator_private.actor();
BEGIN
 -- Bound waits BEFORE acquiring the plan/recipient/row/table locks.
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM simulator_private.require_release(false);
 SELECT * INTO p FROM simulator_private.recovery_plans WHERE id=p_plan_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable'; END IF;
 club:=simulator_private.event_club(p.event_id,true);
 IF p.application_status<>'Draft' OR p.before_state IS DISTINCT FROM simulator_private.event_state(p.event_id) THEN RAISE EXCEPTION 'Plan is applied or stale'; END IF;
 IF p_recipient_member_id=p_replaced_member_id OR NOT EXISTS(SELECT 1 FROM public.members m JOIN public.club_memberships cm ON cm.member_id=m.id JOIN public.exco_roles r ON r.id=cm.role_id
   WHERE m.id=p_recipient_member_id AND m.is_active AND cm.is_active AND cm.club_id=club AND NOT r.is_admin_role)
 THEN RAISE EXCEPTION 'Recipient is not an eligible active club member'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.changes) c WHERE (c->>'replacedMemberId')::bigint=p_replaced_member_id AND (c->>'replacementMemberId')::bigint=p_recipient_member_id)
 THEN RAISE EXCEPTION 'Recipient does not match the saved plan'; END IF;
 PERFORM pg_advisory_xact_lock(p_recipient_member_id);
 terms:=simulator_private.invitation_terms(p.id,p_replaced_member_id);
 IF jsonb_array_length(terms)=0 THEN RAISE EXCEPTION 'Invitation has no assignments'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(terms) t CROSS JOIN LATERAL jsonb_array_elements(p.disruptions) d
   WHERE d->>'type'='MEMBER_UNAVAILABLE' AND (d->>'memberId')::bigint=p_recipient_member_id
   AND (t->>'starts_at')::timestamptz<(d->>'end')::timestamptz AND (d->>'start')::timestamptz<(t->>'ends_at')::timestamptz)
 THEN RAISE EXCEPTION 'Recipient is unavailable in the selected simulation'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(terms) t JOIN public.segment_assignments a ON a.member_id=p_recipient_member_id
   JOIN public.event_segments s ON s.id=a.segment_id WHERE s.id<>(t->>'segment_id')::bigint AND s.starts_at<(t->>'ends_at')::timestamptz AND (t->>'starts_at')::timestamptz<s.ends_at)
 THEN RAISE EXCEPTION 'Recipient has an overlapping event assignment'; END IF;
 -- Expire old invitations before checking the partial uniqueness constraint.
 UPDATE simulator_private.replacement_invitations SET status='Expired' WHERE plan_id=p.id AND expires_at<=clock_timestamp() AND status IN ('Pending','Accepted');
 SELECT * INTO i FROM simulator_private.replacement_invitations WHERE plan_id=p.id AND recipient_member_id=p_recipient_member_id AND replaced_member_id=p_replaced_member_id AND status IN ('Pending','Accepted') FOR UPDATE;
 IF FOUND THEN
  -- A delivery worker could hold this row after the earlier expiry cleanup.
  -- Recheck the actual clock after waiting rather than returning stale consent.
  IF i.expires_at<=clock_timestamp() THEN
   UPDATE simulator_private.replacement_invitations SET status='Expired' WHERE id=i.id;
  ELSE RETURN to_jsonb(i); END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM simulator_private.replacement_invitations existing
   -- Historical acceptance is consent, not a permanent member reservation.
   JOIN simulator_private.recovery_plans existing_plan ON existing_plan.id=existing.plan_id
    AND existing_plan.application_status='Draft'
   CROSS JOIN LATERAL jsonb_array_elements(existing.assignment_snapshot) oldterm
   CROSS JOIN LATERAL jsonb_array_elements(terms) newterm
   WHERE existing.recipient_member_id=p_recipient_member_id AND existing.status IN ('Pending','Accepted') AND existing.expires_at>clock_timestamp()
   AND (oldterm->>'starts_at')::timestamptz<(newterm->>'ends_at')::timestamptz
   AND (newterm->>'starts_at')::timestamptz<(oldterm->>'ends_at')::timestamptz)
 THEN RAISE EXCEPTION 'Recipient already has an overlapping replacement invitation'; END IF;
 -- Consent stays in simulator-owned protected storage, not public.notifications.
 -- That table's public-read policy would leak private terms; its INSERT trigger
 -- also schedules push work. The action_url/link_path mapping does not make a
 -- write safe. No direct INSERT or definer notification writer may be used here.
 -- A future notification design requires team-approved privacy and trigger review.
 -- Until then this invitation honestly remains delivery_status='Pending Delivery'.
 INSERT INTO simulator_private.replacement_invitations(plan_id,recipient_member_id,replaced_member_id,assignment_snapshot)
 VALUES(p.id,p_recipient_member_id,p_replaced_member_id,terms) RETURNING * INTO i;
 UPDATE simulator_private.recovery_plans SET lifecycle='In Progress' WHERE id=p.id;
 INSERT INTO simulator_private.recovery_audit(plan_id,actor_member_id,action,outcome,details) VALUES(p.id,actor,'INVITE','Succeeded','Created invitation; no Telegram message sent');
 RETURN to_jsonb(i);
END $$;

-- Return invitation details only to its authenticated recipient or event managers.
CREATE FUNCTION public.rpc_simulator_invitation(p_invitation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i simulator_private.replacement_invitations; p simulator_private.recovery_plans; actor bigint:=simulator_private.actor();
BEGIN
 SELECT * INTO i FROM simulator_private.replacement_invitations WHERE id=p_invitation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM simulator_private.recovery_plans WHERE id=i.plan_id;
 PERFORM simulator_private.event_club(p.event_id,false);
 IF actor<>i.recipient_member_id THEN PERFORM simulator_private.event_club(p.event_id,true); END IF;
 RETURN to_jsonb(i)||jsonb_build_object('event_name',(SELECT e.name FROM public.events e WHERE e.id=p.event_id),
   'status',CASE WHEN i.expires_at<=clock_timestamp() AND i.status IN ('Pending','Accepted') THEN 'Expired' ELSE i.status END);
END $$;

-- Response is written by the actual recipient inside Pulse, never a Telegram callback.
CREATE FUNCTION public.rpc_simulator_respond_invitation(p_invitation_id uuid,p_response text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i simulator_private.replacement_invitations; p simulator_private.recovery_plans; actor bigint:=simulator_private.actor();
BEGIN
 -- Bound waits BEFORE acquiring the plan/recipient/row/table locks.
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM simulator_private.require_release(false);
 -- Always lock the plan before its invitation, matching apply's lock order.
 SELECT p1.* INTO p FROM simulator_private.recovery_plans p1 JOIN simulator_private.replacement_invitations i1 ON i1.plan_id=p1.id WHERE i1.id=p_invitation_id FOR UPDATE OF p1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM simulator_private.replacement_invitations WHERE id=p_invitation_id FOR UPDATE;
 IF i.recipient_member_id<>actor THEN RAISE EXCEPTION 'Only the invited member may respond' USING ERRCODE='42501'; END IF;
 PERFORM simulator_private.event_club(p.event_id,false);
 IF p_response IS NULL OR p_response NOT IN ('Accepted','Declined') THEN RAISE EXCEPTION 'Choose Accept or Decline'; END IF;
 -- This check occurs after both the plan and invitation row locks.
 IF i.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Invitation expired'; END IF;
 IF p.application_status<>'Draft' OR p.before_state IS DISTINCT FROM simulator_private.event_state(p.event_id)
   OR i.assignment_snapshot IS DISTINCT FROM simulator_private.invitation_terms(p.id,i.replaced_member_id)
 THEN RAISE EXCEPTION 'Assignment terms changed; a renewed invitation is required'; END IF;
 IF i.status=p_response THEN RETURN to_jsonb(i); END IF;
 IF i.status<>'Pending' THEN RAISE EXCEPTION 'Invitation already answered or cancelled'; END IF;
 UPDATE simulator_private.replacement_invitations SET status=p_response,responded_at=clock_timestamp() WHERE id=i.id RETURNING * INTO i;
 INSERT INTO simulator_private.recovery_audit(plan_id,actor_member_id,action,outcome,details) VALUES(p.id,actor,'RESPOND','Succeeded',p_response);
 RETURN to_jsonb(i);
END $$;
-- Cancellation preserves invitation/audit history; it never reverses an applied plan.
CREATE FUNCTION public.rpc_simulator_cancel_invitation(p_invitation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i simulator_private.replacement_invitations; p simulator_private.recovery_plans; actor bigint:=simulator_private.actor();
BEGIN
 -- Bound waits BEFORE acquiring the plan/recipient/row/table locks.
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM simulator_private.require_release(false);
 SELECT p1.* INTO p FROM simulator_private.recovery_plans p1 JOIN simulator_private.replacement_invitations i1 ON i1.plan_id=p1.id WHERE i1.id=p_invitation_id FOR UPDATE OF p1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable'; END IF;
 PERFORM simulator_private.event_club(p.event_id,true);
 IF p.application_status<>'Draft' THEN RAISE EXCEPTION 'Cannot cancel an applied plan invitation'; END IF;
 UPDATE simulator_private.replacement_invitations SET status='Cancelled' WHERE id=p_invitation_id AND status IN ('Pending','Accepted') RETURNING * INTO i;
 IF NOT FOUND THEN SELECT * INTO i FROM simulator_private.replacement_invitations WHERE id=p_invitation_id; END IF;
 INSERT INTO simulator_private.recovery_audit(plan_id,actor_member_id,action,outcome) VALUES(p.id,actor,'CANCEL','Succeeded');
 RETURN to_jsonb(i);
END $$;

-- Per-action status is derived from persisted consent and actual calendar rows.
-- It is an explanation, not a substitute for Confirm's locked conflict checks.
CREATE FUNCTION simulator_private.plan_progress(p simulator_private.recovery_plans,p_club bigint) RETURNS jsonb
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
    WHEN b.owner_club_id IS DISTINCT FROM p_club OR coalesce(b.status,'') NOT IN ('Booked','Officially Confirmed Booking') THEN 'Not Approved'
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

-- One request UUID is reused for retries. Save + invitations + audit either all
-- commit or all roll back; Start NEVER updates live events or assignments.
CREATE FUNCTION public.rpc_simulator_start_plan(p_event_id bigint,p_title text,p_changes jsonb,p_expected_state jsonb,p_expected_fingerprint text,p_disruptions jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor bigint:=simulator_private.actor(); p simulator_private.recovery_plans; saved jsonb; pair record; payload jsonb; club bigint;
BEGIN
 PERFORM simulator_private.require_release(false);
 club:=simulator_private.event_club(p_event_id,true);
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'A start request ID is required'; END IF;
 -- Separate advisory key namespace from the bigint recipient locks.
 PERFORM pg_advisory_xact_lock(731021,hashtext(p_request_id::text));
 payload:=jsonb_build_object('event',p_event_id,'title',p_title,'changes',p_changes,
  'fingerprint',p_expected_fingerprint,'disruptions',p_disruptions);
 SELECT * INTO p FROM simulator_private.recovery_plans
  WHERE organizer_member_id=actor AND start_request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF p.start_payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Start request ID was reused for different selections'; END IF;
  RETURN to_jsonb(p)||simulator_private.plan_progress(p,club);
 END IF;
 saved:=public.rpc_simulator_save_plan(p_event_id,p_title,p_changes,p_expected_state,p_expected_fingerprint,p_disruptions);
 UPDATE simulator_private.recovery_plans SET lifecycle='In Progress',start_request_id=p_request_id,start_payload=payload
  WHERE id=(saved->>'id')::uuid RETURNING * INTO p;
 -- Stable recipient order avoids two Starts taking recipient locks in reverse order.
 FOR pair IN SELECT DISTINCT (value->>'replacementMemberId')::bigint AS recipient,(value->>'replacedMemberId')::bigint AS original
  FROM jsonb_array_elements(p.changes) WHERE value ? 'replacementMemberId' ORDER BY recipient,original LOOP
  PERFORM public.rpc_simulator_invite(p.id,pair.recipient,pair.original);
 END LOOP;
 INSERT INTO simulator_private.recovery_audit(plan_id,actor_member_id,action,outcome,details)
  VALUES(p.id,actor,'START','Succeeded','Pending actions saved; no event records changed; notification delivery unavailable');
 RETURN to_jsonb(p)||simulator_private.plan_progress(p,club);
END $$;

-- Attach a REAL calendar booking, including a pending claim. This does not
-- approve, claim or cancel it; Confirm independently rechecks approval and time.
CREATE FUNCTION public.rpc_simulator_attach_booking(p_plan_id uuid,p_expected_version integer,p_segment_id bigint,p_booking_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor bigint:=simulator_private.actor(); p simulator_private.recovery_plans; club bigint; room text;
BEGIN
 PERFORM simulator_private.require_release(false);
 IF p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'A positive plan revision is required'; END IF;
 SELECT * INTO p FROM simulator_private.recovery_plans WHERE id=p_plan_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='42501'; END IF;
 club:=simulator_private.event_club(p.event_id,true);
 IF p.version IS DISTINCT FROM p_expected_version OR p.application_status<>'Draft' OR p.lifecycle<>'In Progress'
  THEN RAISE EXCEPTION 'Refresh the current In Progress plan revision'; END IF;
 SELECT f.name INTO room FROM public.facility_bookings b JOIN public.facilities f ON f.id=b.facility_id
  WHERE b.id=p_booking_id AND f.is_active;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.changes) c
  WHERE (c->>'segmentId')::bigint=p_segment_id AND c->>'venueName'=room)
  THEN RAISE EXCEPTION 'Booking must match the proposed room and activity'; END IF;
 -- Never associate another event's allocation, even for the same club/room.
 IF EXISTS(SELECT 1 FROM public.segment_facility_bookings other_link JOIN public.event_segments other_segment ON other_segment.id=other_link.segment_id
  WHERE other_link.booking_id=p_booking_id AND other_segment.event_id<>p.event_id)
 THEN RAISE EXCEPTION 'Facility booking is already allocated to another event'; END IF;
 -- Exact duplicate attachment is a no-op with the current revision.
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.changes) c WHERE (c->>'segmentId')::bigint=p_segment_id
  AND c ? 'venueName' AND c->>'facilityBookingId' IS DISTINCT FROM p_booking_id::text)
  THEN RETURN to_jsonb(p)||simulator_private.plan_progress(p,club); END IF;
 UPDATE simulator_private.recovery_plans SET changes=(SELECT jsonb_agg(
  CASE WHEN (c->>'segmentId')::bigint=p_segment_id AND c ? 'venueName'
   THEN c||jsonb_build_object('facilityBookingId',p_booking_id) ELSE c END ORDER BY ord)
  FROM jsonb_array_elements(p.changes) WITH ORDINALITY v(c,ord)),version=version+1 WHERE id=p.id RETURNING * INTO p;
 INSERT INTO simulator_private.recovery_audit(plan_id,actor_member_id,action,outcome,details)
  VALUES(p.id,actor,'ATTACH_BOOKING','Succeeded','Associated calendar booking; approval remains independently required');
 RETURN to_jsonb(p)||simulator_private.plan_progress(p,club);
END $$;

-- Cancellation affects only this unconfirmed plan and its consent. Calendar
-- bookings/claims remain unchanged and may require manual calendar follow-up.
CREATE FUNCTION public.rpc_simulator_cancel_plan(p_plan_id uuid,p_expected_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor bigint:=simulator_private.actor(); p simulator_private.recovery_plans; club bigint;
BEGIN
 PERFORM simulator_private.require_release(false);
 IF p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'A positive plan revision is required'; END IF;
 SELECT * INTO p FROM simulator_private.recovery_plans WHERE id=p_plan_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='42501'; END IF;
 club:=simulator_private.event_club(p.event_id,true);
 IF p.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Plan revision changed; refresh history'; END IF;
 IF p.application_status='Cancelled' THEN RETURN to_jsonb(p)||simulator_private.plan_progress(p,club); END IF;
 IF p.application_status<>'Draft' THEN RAISE EXCEPTION 'Only unconfirmed plans may be cancelled; use Undo after confirmation'; END IF;
 UPDATE simulator_private.replacement_invitations SET status='Cancelled'
  WHERE plan_id=p.id AND status IN ('Pending','Accepted');
 UPDATE simulator_private.recovery_plans SET application_status='Cancelled',lifecycle='Cancelled',version=version+1
  WHERE id=p.id RETURNING * INTO p;
 INSERT INTO simulator_private.recovery_audit(plan_id,actor_member_id,action,outcome,details)
  VALUES(p.id,actor,'CANCEL_PLAN','Succeeded','No event changes; existing calendar claims require separate supported cancellation');
 RETURN to_jsonb(p)||simulator_private.plan_progress(p,club);
END $$;


-- Only authorized event managers can read recovery history and before/after values.
CREATE FUNCTION public.rpc_simulator_plan_history(p_event_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM simulator_private.event_club(p_event_id,true);
 RETURN jsonb_build_object('plans',coalesce((SELECT jsonb_agg((to_jsonb(p)||simulator_private.plan_progress(p,simulator_private.event_club(p.event_id,true))) ORDER BY p.created_at DESC) FROM simulator_private.recovery_plans p WHERE p.event_id=p_event_id),'[]'::jsonb),
  'invitations',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('status',CASE WHEN i.expires_at<=clock_timestamp() AND i.status IN ('Pending','Accepted') THEN 'Expired' ELSE i.status END)) FROM simulator_private.replacement_invitations i JOIN simulator_private.recovery_plans p ON p.id=i.plan_id WHERE p.event_id=p_event_id),'[]'::jsonb),
  'audit',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id DESC) FROM simulator_private.recovery_audit a JOIN simulator_private.recovery_plans p ON p.id=a.plan_id WHERE p.event_id=p_event_id),'[]'::jsonb));
END $$;

-- Apply and Undo use ONE transactional implementation. The inner exception block
-- rolls back every event mutation on failure, then records the failed attempt.
-- Table locks are conservative because shared assignment/booking writers do not
-- use simulator advisory locks. Review contention/lock ordering in staging before
-- enabling: this implementation favors consistency over throughput.
CREATE FUNCTION simulator_private.transition_plan(p_plan uuid,p_version integer,p_ack boolean,p_undo boolean) RETURNS jsonb
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
CREATE FUNCTION public.rpc_simulator_apply_plan(p_plan_id uuid,p_expected_version integer,p_accept_unverified boolean) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT simulator_private.transition_plan(p_plan_id,p_expected_version,p_accept_unverified,false)
$$;
CREATE FUNCTION public.rpc_simulator_undo_plan(p_plan_id uuid,p_expected_version integer,p_accept_unverified boolean) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT simulator_private.transition_plan(p_plan_id,p_expected_version,p_accept_unverified,true)
$$;

-- The private helper schema is never an API. Public endpoints repeat auth checks.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA simulator_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_simulator_start_plan(bigint,text,jsonb,jsonb,text,jsonb,uuid), public.rpc_simulator_attach_booking(uuid,integer,bigint,bigint), public.rpc_simulator_cancel_plan(uuid,integer),
 public.rpc_simulator_capture_state(bigint), public.rpc_simulator_save_plan(bigint,text,jsonb,jsonb,text,jsonb),
 public.rpc_simulator_invite(uuid,bigint,bigint), public.rpc_simulator_invitation(uuid),
 public.rpc_simulator_respond_invitation(uuid,text), public.rpc_simulator_cancel_invitation(uuid),
 public.rpc_simulator_plan_history(bigint), public.rpc_simulator_apply_plan(uuid,integer,boolean),
 public.rpc_simulator_undo_plan(uuid,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_simulator_start_plan(bigint,text,jsonb,jsonb,text,jsonb,uuid), public.rpc_simulator_attach_booking(uuid,integer,bigint,bigint), public.rpc_simulator_cancel_plan(uuid,integer),
 public.rpc_simulator_capture_state(bigint), public.rpc_simulator_save_plan(bigint,text,jsonb,jsonb,text,jsonb),
 public.rpc_simulator_invite(uuid,bigint,bigint), public.rpc_simulator_invitation(uuid),
 public.rpc_simulator_respond_invitation(uuid,text), public.rpc_simulator_cancel_invitation(uuid),
 public.rpc_simulator_plan_history(bigint), public.rpc_simulator_apply_plan(uuid,integer,boolean),
 public.rpc_simulator_undo_plan(uuid,integer,boolean) TO authenticated;
-- TEAM DECISIONS: retain NO ACTION history FKs (approve archival before deletion).
-- Keep table locks until shared writers adopt compatible locking/constraints.
-- A team transaction taking a different lock order can deadlock: PostgreSQL aborts
-- a participant and our exception block rolls back mutations. Staging must test
-- concurrent shared writers; do not claim advisory locks alone solve this.
-- DEPLOYMENT CHECKLIST: verify staging project, trusted function owner, fixed
-- search_path, anon/PUBLIC denial, cross-club denial, exact invitation acceptance,
-- state/version conflicts, concurrent writers, rollback, and successful/blocked
-- undo. No live verification has occurred. Enable release_gate only by a separate
-- approved administrative action AFTER these tests. No Telegram sender is wired.
COMMIT;
