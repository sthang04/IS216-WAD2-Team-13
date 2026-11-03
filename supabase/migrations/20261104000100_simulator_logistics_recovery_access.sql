BEGIN;

-- Recovery permission is scoped to the authenticated actor's active event club.
-- Logistics Directors may coordinate recovery without receiving general member
-- administration privileges. All existing release gates and RPC checks still apply.
CREATE OR REPLACE FUNCTION simulator_private.event_club(p_event bigint,p_manage boolean) RETURNS bigint
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
    AND r.is_admin_role=false
    AND (NOT p_manage OR r.can_manage_members=true OR r.role_code='LOGISTICS_DIRECTOR'))
 THEN RAISE EXCEPTION 'Event management permission required' USING ERRCODE='42501'; END IF;
 RETURN club;
END $$;

-- CREATE OR REPLACE retains existing function ownership and ACLs. Keep the
-- helper private; callers enter through the existing authenticated public RPCs.
REVOKE ALL ON FUNCTION simulator_private.event_club(bigint,boolean) FROM PUBLIC, anon, authenticated;

COMMIT;
