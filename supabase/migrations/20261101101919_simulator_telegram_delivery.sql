-- PREPARED ONLY. Requires privacy/deployment review; no gate activation.
-- Private queue consumed ONLY by send-simulator-invitation-notifications.
-- No changes to the original Telegram worker, cron job or public notifications.
BEGIN;
ALTER TABLE simulator_private.replacement_invitations ADD COLUMN telegram_claim_id uuid, ADD COLUMN telegram_claimed_at timestamptz;
-- Explicit defense in depth; no direct browser grants are added.
ALTER TABLE simulator_private.replacement_invitations ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.rpc_simulator_claim_telegram() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF NOT coalesce((SELECT invitations_enabled FROM simulator_private.release_gate WHERE singleton),false)
 THEN RETURN '[]'::jsonb; END IF;
 -- At most one attempt per invitation. Sending is deliberately never reclaimed:
 -- a network timeout/crash cannot establish whether Telegram received a message.
 WITH candidates AS (
  SELECT i.id FROM simulator_private.replacement_invitations i
  JOIN simulator_private.recovery_plans p ON p.id=i.plan_id
  WHERE i.status='Pending' AND i.delivery_status='Pending Delivery'
   AND i.expires_at>clock_timestamp() AND p.application_status='Draft'
   AND p.before_state=simulator_private.event_state(p.event_id)
   AND i.assignment_snapshot=simulator_private.invitation_terms(p.id,i.replaced_member_id)
  ORDER BY i.created_at LIMIT 5 FOR UPDATE OF i SKIP LOCKED
 ), claimed AS (
  UPDATE simulator_private.replacement_invitations i
  SET delivery_status='Sending',telegram_claim_id=gen_random_uuid(),telegram_claimed_at=clock_timestamp()
  FROM candidates c WHERE i.id=c.id RETURNING i.*
 ) SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'claim_id',telegram_claim_id,'recipient_member_id',recipient_member_id)),'[]'::jsonb)
 INTO result FROM claimed;
 RETURN result;
END $$;
CREATE FUNCTION public.rpc_simulator_finish_telegram(p_id uuid,p_claim_id uuid,p_status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('SENT','FAILED','NO_CHAT','UNKNOWN') THEN RAISE EXCEPTION 'Invalid delivery result'; END IF;
 UPDATE simulator_private.replacement_invitations SET delivery_status=p_status
 WHERE id=p_id AND telegram_claim_id=p_claim_id AND delivery_status='Sending';
 IF FOUND THEN RETURN true; END IF;
 -- Repeating the same completion is idempotent; conflicting results are rejected.
 RETURN EXISTS(SELECT 1 FROM simulator_private.replacement_invitations
  WHERE id=p_id AND telegram_claim_id=p_claim_id AND delivery_status=p_status);
END $$;
REVOKE ALL ON FUNCTION public.rpc_simulator_claim_telegram(),public.rpc_simulator_finish_telegram(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_simulator_claim_telegram(),public.rpc_simulator_finish_telegram(uuid,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.rpc_simulator_my_invitations() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor bigint:=simulator_private.actor(); result jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'event_name',e.name,'club_name',e.club_name,
  'status',CASE
   WHEN i.status IN ('Pending','Accepted') AND i.expires_at<=clock_timestamp() THEN 'Expired'
   WHEN i.status IN ('Pending','Accepted') AND p.application_status='Cancelled' THEN 'Cancelled'
   WHEN i.status='Pending' AND (p.application_status<>'Draft'
    OR p.before_state IS DISTINCT FROM simulator_private.event_state(p.event_id)
    OR i.assignment_snapshot IS DISTINCT FROM simulator_private.invitation_terms(p.id,i.replaced_member_id)) THEN 'Stale'
   ELSE i.status END,
  'delivery_status',i.delivery_status,'expires_at',i.expires_at,'assignment_snapshot',i.assignment_snapshot,
  'facilities',coalesce((SELECT jsonb_agg(jsonb_build_object('segment_id',t->>'segment_id',
   'venue_name',coalesce((SELECT c->>'venueName' FROM jsonb_array_elements(p.changes) c
     WHERE c->>'segmentId'=t->>'segment_id' AND c->>'venueName' IS NOT NULL LIMIT 1),
    (SELECT string_agg(f.name,', ' ORDER BY f.name) FROM public.segment_facility_bookings l
     JOIN public.facility_bookings b ON b.id=l.booking_id JOIN public.facilities f ON f.id=b.facility_id
     WHERE l.segment_id=(t->>'segment_id')::bigint),'Facility to be confirmed')))
   FROM jsonb_array_elements(i.assignment_snapshot) t),'[]'::jsonb))
 ORDER BY i.created_at DESC,i.id),'[]'::jsonb) INTO result
 FROM simulator_private.replacement_invitations i
 JOIN simulator_private.recovery_plans p ON p.id=i.plan_id JOIN public.events e ON e.id=p.event_id
 WHERE i.recipient_member_id=actor AND EXISTS(
  SELECT 1 FROM public.clubs c JOIN public.club_memberships cm ON cm.club_id=c.id
  JOIN public.exco_roles r ON r.id=cm.role_id WHERE (e.club_name=c.name OR e.club_name=c.short_name)
   AND c.active=true AND cm.member_id=actor AND cm.is_active=true AND r.is_admin_role=false);
 RETURN jsonb_build_object('invitations',result);
END $$;
COMMIT;
