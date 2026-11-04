-- PREPARED LOCALLY ONLY. Never run against a shared database without deployment approval.
-- Requires the existing simulator workflow (002–006), logistics access and ops_* schema.
-- Ops UUID records remain canonical; bigint rows below are a compatibility projection.
-- No release gate, Day Ops policy, attendance, notification or calendar reservation is changed.
BEGIN;
SET LOCAL lock_timeout='5s';
-- Refuse an older writer that lacks the reviewed disruption-safe Undo contract.
DO $preflight$ BEGIN
 IF to_regprocedure('simulator_private.transition_plan(uuid,integer,boolean,boolean)') IS NULL
 OR position('assert_undo_disruptions_resolved' IN pg_get_functiondef('simulator_private.transition_plan(uuid,integer,boolean,boolean)'::regprocedure))=0
 THEN RAISE EXCEPTION 'Review simulator migration 006 before installing the Ops bridge'; END IF;
END $preflight$;
CREATE SEQUENCE simulator_private.ops_projection_ids START WITH 900000000000 MAXVALUE 999999999999;
CREATE TABLE simulator_private.ops_event_links(
 source_event_uuid uuid PRIMARY KEY,
 ops_event_id uuid UNIQUE REFERENCES public.ops_events(id) ON DELETE SET NULL,
 event_id bigint NOT NULL UNIQUE REFERENCES public.events(id),
 club_id bigint NOT NULL REFERENCES public.clubs(id)
);
CREATE TABLE simulator_private.ops_task_links(
 source_task_uuid uuid PRIMARY KEY,
 ops_task_id uuid UNIQUE REFERENCES public.ops_tasks(id) ON DELETE SET NULL,
 source_event_uuid uuid NOT NULL REFERENCES simulator_private.ops_event_links(source_event_uuid),
 segment_id bigint NOT NULL UNIQUE REFERENCES public.event_segments(id),
 assignment_id bigint NOT NULL UNIQUE REFERENCES public.segment_assignments(id)
);
CREATE TABLE simulator_private.ops_plan_states(
 plan_id uuid PRIMARY KEY REFERENCES simulator_private.recovery_plans(id),
 source_event_uuid uuid NOT NULL REFERENCES simulator_private.ops_event_links(source_event_uuid),
 before_ops jsonb NOT NULL,
 after_ops jsonb
);
-- PostgreSQL does not index FK columns automatically. These paths are used by
-- per-event refreshes, source deletion checks and recovery snapshot lookups.
CREATE INDEX simulator_ops_event_club_idx ON simulator_private.ops_event_links(club_id);
CREATE INDEX simulator_ops_task_event_idx ON simulator_private.ops_task_links(source_event_uuid);
CREATE INDEX simulator_ops_plan_event_idx ON simulator_private.ops_plan_states(source_event_uuid);
ALTER TABLE simulator_private.ops_event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulator_private.ops_task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulator_private.ops_plan_states ENABLE ROW LEVEL SECURITY;

-- Exact event/task fields, including fixed status and venue, participate in stale
-- detection. Attendance is deliberately excluded: check-ins do not change a plan.
CREATE FUNCTION simulator_private.ops_state(p_source uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('event',(SELECT to_jsonb(e)||jsonb_build_object('created_at',simulator_private.iso(e.created_at)) FROM public.ops_events e WHERE e.id=p_source),
 'tasks',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.ops_tasks t WHERE t.event_id=p_source),'[]'::jsonb),
 'dependencies',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.prerequisite_segment_id,d.dependent_segment_id)
  FROM public.segment_dependencies d WHERE EXISTS(SELECT 1 FROM simulator_private.ops_task_links l WHERE l.source_event_uuid=p_source
   AND l.segment_id IN(d.prerequisite_segment_id,d.dependent_segment_id))),'[]'::jsonb))
$$;

-- Preserve the reviewed legacy authorization for historical events. Mapped
-- events resolve by club FK, never names; a tombstone permits history, not Apply.
ALTER FUNCTION simulator_private.event_club(bigint,boolean) RENAME TO legacy_event_club;
CREATE FUNCTION simulator_private.event_club(p_event bigint,p_manage boolean) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE club bigint; actor bigint:=simulator_private.actor();
BEGIN
 IF p_manage IS NULL THEN RAISE EXCEPTION 'Event unavailable or not authorised' USING ERRCODE='42501'; END IF;
 SELECT l.club_id INTO club FROM simulator_private.ops_event_links l
 JOIN public.clubs c ON c.id=l.club_id AND c.active WHERE l.event_id=p_event;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM simulator_private.ops_event_links WHERE event_id=p_event)
  THEN RAISE EXCEPTION 'Event unavailable or not authorised' USING ERRCODE='42501'; END IF;
  RETURN simulator_private.legacy_event_club(p_event,p_manage);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.club_memberships cm JOIN public.exco_roles r ON r.id=cm.role_id
  WHERE cm.member_id=actor AND cm.club_id=club AND cm.is_active AND NOT r.is_admin_role
   AND (NOT p_manage OR r.can_manage_members OR r.role_code='LOGISTICS_DIRECTOR'))
 THEN RAISE EXCEPTION 'Event management permission required' USING ERRCODE='42501'; END IF;
 RETURN club;
END $$;

-- One-way projection, called in the same transaction as each Ops write. Existing
-- task UUIDs keep their assignment/segment IDs across edits and reassignments.
CREATE FUNCTION simulator_private.project_ops_event(p_source uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e public.ops_events; l simulator_private.ops_event_links; t public.ops_tasks;
 task_link simulator_private.ops_task_links; v_club_name text; lo timestamptz; hi timestamptz;
 old_flag text:=current_setting('pulse.ops_projection',true);
BEGIN
 SELECT * INTO e FROM public.ops_events WHERE id=p_source;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM set_config('pulse.ops_projection','on',true);
 SELECT c.name INTO v_club_name FROM public.clubs c WHERE c.id=e.club_id;
 SELECT min((e.event_date+op_task.start_time) AT TIME ZONE 'Asia/Singapore'),max((e.event_date+op_task.end_time) AT TIME ZONE 'Asia/Singapore')
 INTO lo,hi FROM public.ops_tasks op_task WHERE op_task.event_id=e.id;
 -- Empty events have no real schedule: do not invent times. Existing mappings
 -- remain as archival identifiers after the last task is deleted.
 IF lo IS NULL OR hi IS NULL THEN
  PERFORM set_config('pulse.ops_projection',coalesce(old_flag,''),true);RETURN;
 END IF;
 SELECT * INTO l FROM simulator_private.ops_event_links WHERE source_event_uuid=e.id;
 IF NOT FOUND THEN
  l.event_id:=nextval('simulator_private.ops_projection_ids');
  INSERT INTO public.events(id,name,club_name,starts_at,ends_at) VALUES(l.event_id,e.name,v_club_name,lo,hi);
  INSERT INTO simulator_private.ops_event_links VALUES(e.id,e.id,l.event_id,e.club_id) RETURNING * INTO l;
 ELSE
  UPDATE simulator_private.ops_event_links SET club_id=e.club_id,ops_event_id=e.id WHERE source_event_uuid=e.id;
  UPDATE public.events SET name=e.name,club_name=v_club_name,starts_at=lo,ends_at=hi WHERE id=l.event_id AND (name,club_name,starts_at,ends_at) IS DISTINCT FROM (e.name,v_club_name,lo,hi);
 END IF;
 FOR t IN SELECT * FROM public.ops_tasks WHERE event_id=e.id ORDER BY id LOOP
  SELECT * INTO task_link FROM simulator_private.ops_task_links WHERE source_task_uuid=t.id;
  IF NOT FOUND THEN
   task_link.segment_id:=nextval('simulator_private.ops_projection_ids');task_link.assignment_id:=nextval('simulator_private.ops_projection_ids');
   INSERT INTO public.event_segments(id,event_id,title,segment_type,starts_at,ends_at)
    VALUES(task_link.segment_id,l.event_id,t.title,t.task_type,(e.event_date+t.start_time) AT TIME ZONE 'Asia/Singapore',(e.event_date+t.end_time) AT TIME ZONE 'Asia/Singapore');
   INSERT INTO public.segment_assignments(id,segment_id,member_id,role_name,is_required)
    VALUES(task_link.assignment_id,task_link.segment_id,t.member_id,t.task_type,true);
   INSERT INTO simulator_private.ops_task_links VALUES(t.id,t.id,e.id,task_link.segment_id,task_link.assignment_id);
  ELSE
   UPDATE public.event_segments SET event_id=l.event_id,title=t.title,segment_type=t.task_type,
    starts_at=(e.event_date+t.start_time) AT TIME ZONE 'Asia/Singapore',ends_at=(e.event_date+t.end_time) AT TIME ZONE 'Asia/Singapore' WHERE id=task_link.segment_id
    AND (event_id,title,segment_type,starts_at,ends_at) IS DISTINCT FROM (l.event_id,t.title,t.task_type,(e.event_date+t.start_time) AT TIME ZONE 'Asia/Singapore',(e.event_date+t.end_time) AT TIME ZONE 'Asia/Singapore');
   UPDATE public.segment_assignments SET member_id=t.member_id,role_name=t.task_type,is_required=true WHERE id=task_link.assignment_id AND (member_id,role_name,is_required) IS DISTINCT FROM (t.member_id,t.task_type,true);
   UPDATE simulator_private.ops_task_links SET source_event_uuid=e.id,ops_task_id=t.id WHERE source_task_uuid=t.id;
  END IF;
 END LOOP;
 PERFORM set_config('pulse.ops_projection',coalesce(old_flag,''),true);
END $$;

CREATE FUNCTION simulator_private.ops_projection_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l simulator_private.ops_task_links; prior text:=current_setting('pulse.ops_projection',true);
BEGIN
 IF current_setting('pulse.ops_writeback',true)='on' THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='ops_tasks' AND TG_OP='DELETE' THEN
  -- Immutable source UUID survives FK SET NULL ordering during cascades.
  SELECT * INTO l FROM simulator_private.ops_task_links WHERE source_task_uuid=OLD.id;
  IF FOUND THEN
   PERFORM set_config('pulse.ops_projection','on',true);
   DELETE FROM public.segment_dependencies WHERE prerequisite_segment_id=l.segment_id OR dependent_segment_id=l.segment_id;
   DELETE FROM public.segment_facility_bookings WHERE segment_id=l.segment_id;
   DELETE FROM simulator_private.ops_task_links WHERE source_task_uuid=OLD.id;
   DELETE FROM public.segment_assignments WHERE id=l.assignment_id;
   DELETE FROM public.event_segments WHERE id=l.segment_id;
   PERFORM set_config('pulse.ops_projection',coalesce(prior,''),true);
  END IF;
  PERFORM simulator_private.project_ops_event(OLD.event_id);
 ELSIF TG_TABLE_NAME='ops_events' THEN
  IF TG_OP='UPDATE' AND OLD.club_id<>NEW.club_id AND EXISTS(
    SELECT 1 FROM simulator_private.ops_event_links event_link JOIN simulator_private.recovery_plans saved ON saved.event_id=event_link.event_id WHERE event_link.source_event_uuid=NEW.id)
  THEN RAISE EXCEPTION 'Moving an event with recovery history to another club requires an archival review'; END IF;
  IF TG_OP<>'DELETE' THEN PERFORM simulator_private.project_ops_event(NEW.id); END IF;
 ELSE
  PERFORM simulator_private.project_ops_event(NEW.event_id);
  IF TG_OP='UPDATE' AND OLD.event_id<>NEW.event_id THEN PERFORM simulator_private.project_ops_event(OLD.event_id); END IF;
 END IF;
 RETURN NULL;
END $$;

-- Direct legacy writes must not create a second source of truth. Reviewed
-- recovery writes and the projection set this flag inside private functions.
CREATE FUNCTION simulator_private.guard_ops_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE event_key bigint; old_event_key bigint;
BEGIN
 IF current_setting('pulse.ops_projection',true)='on' THEN RETURN coalesce(NEW,OLD); END IF;
 IF TG_TABLE_NAME='events' THEN event_key:=coalesce(NEW.id,OLD.id);
 ELSIF TG_TABLE_NAME='event_segments' THEN event_key:=coalesce(NEW.event_id,OLD.event_id);
 ELSE SELECT event_id INTO event_key FROM public.event_segments WHERE id=coalesce(NEW.segment_id,OLD.segment_id); END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='events' THEN old_event_key:=OLD.id;
  ELSIF TG_TABLE_NAME='event_segments' THEN old_event_key:=OLD.event_id;
  ELSE SELECT event_id INTO old_event_key FROM public.event_segments WHERE id=OLD.segment_id; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM simulator_private.ops_event_links WHERE event_id IN(event_key,old_event_key))
 THEN RAISE EXCEPTION 'This record is derived from Day Ops; edit the actual operations task'; END IF;
 RETURN coalesce(NEW,OLD);
END $$;

CREATE FUNCTION simulator_private.capture_ops_plan() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l simulator_private.ops_event_links;
BEGIN
 SELECT * INTO l FROM simulator_private.ops_event_links WHERE event_id=NEW.event_id;
 IF FOUND THEN
  IF l.ops_event_id IS NULL THEN RAISE EXCEPTION 'Day Ops event has been deleted'; END IF;
  INSERT INTO simulator_private.ops_plan_states VALUES(NEW.id,l.source_event_uuid,simulator_private.ops_state(l.source_event_uuid),NULL);
 END IF;
 RETURN NEW;
END $$;

-- Keep the full existing consent/booking/approval/dependency/Undo validator.
-- Wrap it so legacy changes and exact Ops UUID writes commit or roll back together.
ALTER FUNCTION simulator_private.transition_plan(uuid,integer,boolean,boolean) RENAME TO transition_legacy_plan;
CREATE FUNCTION simulator_private.transition_plan(p_plan uuid,p_version integer,p_ack boolean,p_undo boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p simulator_private.recovery_plans; l simulator_private.ops_event_links;
 snapshots simulator_private.ops_plan_states; result jsonb; expected jsonb; row record; changed jsonb;
 actor bigint:=simulator_private.actor(); club bigint; event_day date; original_task jsonb;
 projection_flag text:=current_setting('pulse.ops_projection',true);writeback_flag text:=current_setting('pulse.ops_writeback',true);
BEGIN
 PERFORM set_config('lock_timeout','5s',true);
 -- Same global writer order as Ops: operations tables, then compatibility tables.
 -- Bound coarse locks prevent phantoms from the existing multi-request Ops saver.
 LOCK TABLE public.ops_events,public.ops_tasks,public.ops_event_crew IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO p FROM simulator_private.recovery_plans WHERE id=p_plan FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM simulator_private.ops_event_links WHERE event_id=p.event_id;
 IF NOT FOUND THEN RETURN simulator_private.transition_legacy_plan(p_plan,p_version,p_ack,p_undo); END IF;
 club:=simulator_private.event_club(p.event_id,true);
 PERFORM simulator_private.require_release(true);
 BEGIN
  IF p_version IS NULL OR p_version<1 OR p_version IS DISTINCT FROM p.version THEN RAISE EXCEPTION 'Plan revision changed; refresh history'; END IF;
  IF l.ops_event_id IS NULL THEN RAISE EXCEPTION 'Day Ops event has been deleted'; END IF;
  SELECT * INTO snapshots FROM simulator_private.ops_plan_states WHERE plan_id=p.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan predates Day Ops integration; regenerate the proposal'; END IF;
  expected:=CASE WHEN p.application_status='Applied' THEN snapshots.after_ops ELSE snapshots.before_ops END;
  IF expected IS NULL OR simulator_private.ops_state(l.source_event_uuid) IS DISTINCT FROM expected
  THEN RAISE EXCEPTION 'Day Ops records changed; refresh and regenerate the proposal'; END IF;
  -- Idempotent retries still pass the legacy revision/status authorization.
  IF (NOT p_undo AND p.application_status='Applied') OR (p_undo AND p.application_status='Undone')
  THEN RETURN simulator_private.transition_legacy_plan(p_plan,p_version,p_ack,p_undo); END IF;
  PERFORM set_config('pulse.ops_projection','on',true);
  IF NOT p_undo THEN
   FOR changed IN SELECT value FROM jsonb_array_elements(p.changes) LOOP
    IF EXISTS(SELECT 1 FROM simulator_private.ops_task_links m JOIN public.ops_tasks t ON t.id=m.ops_task_id
      JOIN public.event_segments s ON s.id=m.segment_id WHERE m.segment_id=(changed->>'segmentId')::bigint AND t.is_fixed
       AND (coalesce((changed->>'starts_at')::timestamptz,s.starts_at)<>s.starts_at OR coalesce((changed->>'ends_at')::timestamptz,s.ends_at)<>s.ends_at))
    THEN RAISE EXCEPTION 'Fixed Day Ops task times cannot be moved'; END IF;
   END LOOP;
  END IF;
  result:=simulator_private.transition_legacy_plan(p_plan,p_version,p_ack,p_undo);
  IF result->>'ok'='false' THEN
   PERFORM set_config('pulse.ops_projection',coalesce(projection_flag,''),true);RETURN result;
  END IF;
  IF NOT p_undo THEN
   -- Keep event bounds a deterministic projection too. Otherwise a harmless Ops
   -- autosave could shrink extended bounds and wrongly make Undo appear stale.
   UPDATE public.events e SET starts_at=(SELECT min(starts_at) FROM public.event_segments WHERE event_id=e.id),
    ends_at=(SELECT max(ends_at) FROM public.event_segments WHERE event_id=e.id) WHERE e.id=p.event_id;
   UPDATE simulator_private.recovery_plans SET after_state=simulator_private.event_state(p.event_id),
    after_fingerprint=simulator_private.state_fingerprint(simulator_private.event_state(p.event_id)) WHERE id=p.id RETURNING to_jsonb(recovery_plans) INTO result;
  END IF;
  SELECT event_date INTO event_day FROM public.ops_events WHERE id=l.ops_event_id;
  PERFORM set_config('pulse.ops_writeback','on',true);
  FOR row IN SELECT m.ops_task_id,s.id,s.starts_at,s.ends_at,a.member_id,t.venue
   FROM simulator_private.ops_task_links m JOIN public.event_segments s ON s.id=m.segment_id
   JOIN public.segment_assignments a ON a.id=m.assignment_id JOIN public.ops_tasks t ON t.id=m.ops_task_id
   WHERE m.source_event_uuid=l.source_event_uuid LOOP
   IF (row.starts_at AT TIME ZONE 'Asia/Singapore')::date<>event_day OR ((row.ends_at AT TIME ZONE 'Asia/Singapore')::date<>event_day AND NOT ((row.ends_at AT TIME ZONE 'Asia/Singapore')::date=event_day+1 AND (row.ends_at AT TIME ZONE 'Asia/Singapore')::time='00:00'::time))
    OR row.ends_at<=row.starts_at THEN RAISE EXCEPTION 'Day Ops task times must remain on the event date'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.members m JOIN public.club_memberships cm ON cm.member_id=m.id
     WHERE m.id=row.member_id AND m.is_active AND cm.is_active AND cm.club_id=club)
   THEN RAISE EXCEPTION 'Replacement is not an active event club member'; END IF;
   -- Add new crew only after consent checks; never overwrite check-in/late fields.
   INSERT INTO public.ops_event_crew(event_id,member_id) VALUES(l.ops_event_id,row.member_id) ON CONFLICT DO NOTHING;
   IF p_undo THEN
    SELECT value INTO original_task FROM jsonb_array_elements(snapshots.before_ops->'tasks') WHERE value->>'id'=row.ops_task_id::text;
    IF original_task IS NULL THEN RAISE EXCEPTION 'Original operations task is unavailable'; END IF;
    row.venue:=original_task->>'venue';
   ELSE
    -- Booking approval determines the room; names alone never identify a booking.
    SELECT value INTO changed FROM jsonb_array_elements(p.changes)
     WHERE (value->>'segmentId')::bigint=row.id AND (value ? 'facilityBookingId' OR value ? 'venueName') LIMIT 1;
    IF FOUND THEN SELECT f.name INTO row.venue FROM public.segment_facility_bookings b
      JOIN public.facility_bookings booking ON booking.id=b.booking_id JOIN public.facilities f ON f.id=booking.facility_id WHERE b.segment_id=row.id; END IF;
   END IF;
   UPDATE public.ops_tasks SET member_id=row.member_id,start_time=(row.starts_at AT TIME ZONE 'Asia/Singapore')::time,
    end_time=CASE WHEN (row.ends_at AT TIME ZONE 'Asia/Singapore')::date=event_day+1 THEN '24:00'::time ELSE (row.ends_at AT TIME ZONE 'Asia/Singapore')::time END,venue=row.venue WHERE id=row.ops_task_id AND event_id=l.ops_event_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Day Ops task disappeared during recovery'; END IF;
  END LOOP;
  IF p_undo THEN
   IF simulator_private.ops_state(l.source_event_uuid) IS DISTINCT FROM snapshots.before_ops THEN RAISE EXCEPTION 'Operations restoration does not match original tasks'; END IF;
  ELSE UPDATE simulator_private.ops_plan_states SET after_ops=simulator_private.ops_state(l.source_event_uuid) WHERE plan_id=p.id; END IF;
  PERFORM set_config('pulse.ops_projection',coalesce(projection_flag,''),true);
  PERFORM set_config('pulse.ops_writeback',coalesce(writeback_flag,''),true);
  RETURN result;
 EXCEPTION WHEN OTHERS THEN
  -- This subtransaction rolls back legacy success, all task writes and audit
  -- together. A blocked attempt leaves the reviewed plan and both stores intact.
  INSERT INTO simulator_private.recovery_audit(plan_id,actor_member_id,action,outcome,details)
   VALUES(p.id,actor,CASE WHEN p_undo THEN 'UNDO' ELSE 'APPLY' END,'Blocked',SQLERRM);
  RETURN jsonb_build_object('ok',false,'error',SQLERRM);
 END;
END $$;

CREATE FUNCTION public.rpc_simulator_ops_context() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor bigint:=simulator_private.actor(); permitted bigint[];
BEGIN
 SELECT coalesce(array_agg(l.event_id),'{}'::bigint[]) INTO permitted
 FROM simulator_private.ops_event_links l JOIN public.ops_events e ON e.id=l.ops_event_id
 JOIN public.clubs c ON c.id=e.club_id AND c.active
 WHERE EXISTS(SELECT 1 FROM public.club_memberships cm JOIN public.exco_roles r ON r.id=cm.role_id
  WHERE cm.member_id=actor AND cm.club_id=e.club_id AND cm.is_active AND NOT r.is_admin_role);
 RETURN jsonb_build_object('contract_version',1,
 'event_links',coalesce((SELECT jsonb_agg(jsonb_build_object('ops_event_id',l.ops_event_id,'event_id',l.event_id,'starts_at',simulator_private.iso(e.starts_at),'ends_at',simulator_private.iso(e.ends_at)) ORDER BY l.event_id)
  FROM simulator_private.ops_event_links l JOIN public.events e ON e.id=l.event_id WHERE l.event_id=ANY(permitted)),'[]'::jsonb),
 'task_links',coalesce((SELECT jsonb_agg(jsonb_build_object('ops_task_id',t.ops_task_id,'event_id',l.event_id,'segment_id',t.segment_id,'assignment_id',t.assignment_id) ORDER BY t.segment_id)
  FROM simulator_private.ops_task_links t JOIN simulator_private.ops_event_links l USING(source_event_uuid) WHERE l.event_id=ANY(permitted)),'[]'::jsonb),
 'dependencies',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.prerequisite_segment_id,d.dependent_segment_id) FROM public.segment_dependencies d JOIN public.event_segments s ON s.id=d.prerequisite_segment_id JOIN public.event_segments dependent ON dependent.id=d.dependent_segment_id WHERE s.event_id=ANY(permitted) AND dependent.event_id=ANY(permitted)),'[]'::jsonb),
 'booking_links',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.segment_id,b.booking_id) FROM public.segment_facility_bookings b JOIN public.event_segments s ON s.id=b.segment_id WHERE s.event_id=ANY(permitted)),'[]'::jsonb));
END $$;
CREATE FUNCTION public.rpc_simulator_ops_roster(p_event_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE club bigint:=simulator_private.event_club(p_event_id,false); roster jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM simulator_private.ops_event_links WHERE event_id=p_event_id AND ops_event_id IS NOT NULL)
 THEN RAISE EXCEPTION 'Live operations event unavailable'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(candidate) ORDER BY member_id,academic_year),'[]'::jsonb) INTO roster FROM
 (SELECT DISTINCT m.id AS member_id,m.full_name,cm.club_id,cm.academic_year FROM public.club_memberships cm
  JOIN public.members m ON m.id=cm.member_id WHERE cm.club_id=club AND cm.is_active AND m.is_active) candidate;
 RETURN jsonb_build_object('event_id',p_event_id,'club_id',club,'members',roster);
END $$;
CREATE OR REPLACE FUNCTION public.rpc_simulator_workflow_capabilities(p_event_id bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor bigint:=simulator_private.actor(); result jsonb;
BEGIN
 IF p_event_id IS NOT NULL THEN PERFORM simulator_private.event_club(p_event_id,true); END IF;
 SELECT jsonb_build_object('contract_version',4,'ops_integration_version',1,'event_id',p_event_id,
  'application_enabled',coalesce(bool_or(g.application_enabled),false),'invitations_enabled',coalesce(bool_or(g.invitations_enabled),false),
  'original_booking_linking_enabled',coalesce(bool_or(g.original_booking_linking_enabled),false)) INTO result FROM simulator_private.release_gate g;
 RETURN result;
END $$;
-- Rebind the public entrypoints explicitly to the new transactional dispatcher.
CREATE OR REPLACE FUNCTION public.rpc_simulator_apply_plan(p_plan_id uuid,p_expected_version integer,p_accept_unverified boolean) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT simulator_private.transition_plan(p_plan_id,p_expected_version,p_accept_unverified,false) $$;
CREATE OR REPLACE FUNCTION public.rpc_simulator_undo_plan(p_plan_id uuid,p_expected_version integer,p_accept_unverified boolean) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT simulator_private.transition_plan(p_plan_id,p_expected_version,p_accept_unverified,true) $$;

CREATE TRIGGER simulator_ops_event_projection AFTER INSERT OR UPDATE OR DELETE ON public.ops_events FOR EACH ROW EXECUTE FUNCTION simulator_private.ops_projection_trigger();
CREATE TRIGGER simulator_ops_task_projection AFTER INSERT OR UPDATE OR DELETE ON public.ops_tasks FOR EACH ROW EXECUTE FUNCTION simulator_private.ops_projection_trigger();
CREATE TRIGGER simulator_ops_plan_snapshot AFTER INSERT ON simulator_private.recovery_plans FOR EACH ROW EXECUTE FUNCTION simulator_private.capture_ops_plan();
CREATE TRIGGER simulator_guard_ops_event BEFORE INSERT OR UPDATE OR DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION simulator_private.guard_ops_projection();
CREATE TRIGGER simulator_guard_ops_segment BEFORE INSERT OR UPDATE OR DELETE ON public.event_segments FOR EACH ROW EXECUTE FUNCTION simulator_private.guard_ops_projection();
CREATE TRIGGER simulator_guard_ops_assignment BEFORE INSERT OR UPDATE OR DELETE ON public.segment_assignments FOR EACH ROW EXECUTE FUNCTION simulator_private.guard_ops_projection();
DO $$ DECLARE event_source uuid; BEGIN
 FOR event_source IN SELECT id FROM public.ops_events ORDER BY id LOOP PERFORM simulator_private.project_ops_event(event_source); END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA simulator_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA simulator_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA simulator_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rpc_simulator_ops_context(),public.rpc_simulator_ops_roster(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_simulator_ops_context(),public.rpc_simulator_ops_roster(bigint) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
