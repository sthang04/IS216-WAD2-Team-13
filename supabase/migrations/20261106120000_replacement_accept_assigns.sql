-- Accepting a replacement request assigns the replacement straight away.
--
-- Before: the replacement accepted in Pulse, then an organiser had to press
-- Apply. Now, when the last replacement a plan is waiting for accepts, the same
-- Apply runs inside that request, with all of its checks (exact terms, expiry,
-- clashes, rooms, Day Ops write-back). There is no organiser step.
--
-- If one of those checks fails, the acceptance is still saved, the reply says
-- why, and an organiser can still press Apply by hand. Undo is unchanged.
-- Run after 20261104083807_simulator_ops_integration.sql.
BEGIN;
SET LOCAL lock_timeout='5s';

-- Same as in 20261104083807_simulator_ops_integration.sql, plus one exception:
-- while rpc_simulator_respond_invitation is auto-applying a plan, the manage
-- check passes for that one event. The caller must still be an active,
-- non-admin member of the event's club. The flag is transaction-local and is
-- only set inside rpc_simulator_respond_invitation below.
CREATE OR REPLACE FUNCTION simulator_private.event_club(p_event bigint,p_manage boolean) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE club bigint; actor bigint:=simulator_private.actor();
 auto boolean:=p_event IS NOT NULL AND coalesce(current_setting('simulator.auto_apply_event',true),'')=p_event::text;
BEGIN
 IF p_manage IS NULL THEN RAISE EXCEPTION 'Event unavailable or not authorised' USING ERRCODE='42501'; END IF;
 SELECT l.club_id INTO club FROM simulator_private.ops_event_links l
 JOIN public.clubs c ON c.id=l.club_id AND c.active WHERE l.event_id=p_event;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM simulator_private.ops_event_links WHERE event_id=p_event)
  THEN RAISE EXCEPTION 'Event unavailable or not authorised' USING ERRCODE='42501'; END IF;
  RETURN simulator_private.legacy_event_club(p_event,p_manage AND NOT auto);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.club_memberships cm JOIN public.exco_roles r ON r.id=cm.role_id
  WHERE cm.member_id=actor AND cm.club_id=club AND cm.is_active AND NOT r.is_admin_role
   AND (NOT p_manage OR auto OR r.can_manage_members OR r.role_code='LOGISTICS_DIRECTOR'))
 THEN RAISE EXCEPTION 'Event management permission required' USING ERRCODE='42501'; END IF;
 RETURN club;
END $$;

-- Same checks as in 202610310002_simulator_recovery_workflow.sql. Accepting
-- then applies the plan once every replacement in it has accepted. Declining is
-- unchanged. The reply adds: assigned (true/false), waiting_for (how many
-- other replacements still have to accept) and assign_error (why it could not
-- be applied, if it could not).
CREATE OR REPLACE FUNCTION public.rpc_simulator_respond_invitation(p_invitation_id uuid,p_response text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i simulator_private.replacement_invitations; p simulator_private.recovery_plans; actor bigint:=simulator_private.actor();
 waiting integer:=0; applied jsonb;
BEGIN
 -- Bound waits BEFORE acquiring the plan/recipient/row/table locks.
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM simulator_private.require_release(false);
 -- Accepting may run Apply, which locks the Day Ops tables before the plan.
 -- Take them first here too, so the two can never wait on each other.
 IF p_response='Accepted' THEN
  LOCK TABLE public.ops_events,public.ops_tasks,public.ops_event_crew IN SHARE ROW EXCLUSIVE MODE;
 END IF;
 -- Always lock the plan before its invitation, matching apply's lock order.
 SELECT p1.* INTO p FROM simulator_private.recovery_plans p1 JOIN simulator_private.replacement_invitations i1 ON i1.plan_id=p1.id WHERE i1.id=p_invitation_id FOR UPDATE OF p1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM simulator_private.replacement_invitations WHERE id=p_invitation_id FOR UPDATE;
 IF i.recipient_member_id<>actor THEN RAISE EXCEPTION 'Only the invited member may respond' USING ERRCODE='42501'; END IF;
 PERFORM simulator_private.event_club(p.event_id,false);
 IF p_response IS NULL OR p_response NOT IN ('Accepted','Declined') THEN RAISE EXCEPTION 'Choose Accept or Decline'; END IF;
 -- A repeated answer changes nothing. It is checked before the stale-plan
 -- check because an accepted plan is applied, and applied plans are not Draft.
 IF i.status=p_response THEN
  RETURN to_jsonb(i)||jsonb_build_object('assigned',p.application_status='Applied','waiting_for',0);
 END IF;
 -- This check occurs after both the plan and invitation row locks.
 IF i.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Invitation expired'; END IF;
 IF p.application_status<>'Draft' OR p.before_state IS DISTINCT FROM simulator_private.event_state(p.event_id)
   OR i.assignment_snapshot IS DISTINCT FROM simulator_private.invitation_terms(p.id,i.replaced_member_id)
 THEN RAISE EXCEPTION 'Assignment terms changed; a renewed invitation is required'; END IF;
 IF i.status<>'Pending' THEN RAISE EXCEPTION 'Invitation already answered or cancelled'; END IF;
 UPDATE simulator_private.replacement_invitations SET status=p_response,responded_at=clock_timestamp() WHERE id=i.id RETURNING * INTO i;
 INSERT INTO simulator_private.recovery_audit(plan_id,actor_member_id,action,outcome,details) VALUES(p.id,actor,'RESPOND','Succeeded',p_response);

 IF p_response='Accepted' THEN
  -- Replacements in this plan that have not accepted yet.
  SELECT count(*) INTO waiting FROM (
   SELECT DISTINCT c->>'replacedMemberId' AS replaced,c->>'replacementMemberId' AS replacement
   FROM jsonb_array_elements(p.changes) c WHERE c ? 'replacementMemberId') needed
  WHERE NOT EXISTS(SELECT 1 FROM simulator_private.replacement_invitations a
   WHERE a.plan_id=p.id AND a.recipient_member_id=needed.replacement::bigint AND a.replaced_member_id=needed.replaced::bigint
    AND a.status='Accepted' AND a.expires_at>clock_timestamp());
  IF waiting=0 THEN
   -- The replacement's acceptance stands in for the organiser's Apply and its
   -- review acknowledgement. Any failure is rolled back on its own, so the
   -- acceptance above is kept either way.
   PERFORM set_config('simulator.auto_apply_event',p.event_id::text,true);
   BEGIN
    applied:=simulator_private.transition_plan(p.id,p.version,true,false);
   EXCEPTION WHEN OTHERS THEN
    applied:=jsonb_build_object('ok',false,'error',SQLERRM);
   END;
   PERFORM set_config('simulator.auto_apply_event','',true);
  END IF;
 END IF;
 RETURN to_jsonb(i)||jsonb_build_object(
  'assigned',coalesce(applied->>'application_status','')='Applied',
  'waiting_for',waiting,
  'assign_error',CASE WHEN applied->>'ok'='false' THEN applied->>'error' END);
END $$;

REVOKE ALL ON FUNCTION simulator_private.event_club(bigint,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rpc_simulator_respond_invitation(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_simulator_respond_invitation(uuid,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
