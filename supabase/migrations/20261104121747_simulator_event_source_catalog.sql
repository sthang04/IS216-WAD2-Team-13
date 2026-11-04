-- Read-only source identity for unified event visibility. Names/dates are not links.
-- Private mappings stay private; callers receive only mappings in their active clubs.
-- Includes tombstones so a deleted Ops event cannot reappear as an independent event.
BEGIN;
CREATE FUNCTION public.rpc_simulator_event_sources() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor bigint:=simulator_private.actor();
BEGIN
 RETURN jsonb_build_object('contract_version',1,'links',coalesce((
  SELECT jsonb_agg(jsonb_build_object('event_id',l.event_id,'ops_event_id',l.ops_event_id,
    'source_event_uuid',l.source_event_uuid,'archived',l.ops_event_id IS NULL) ORDER BY l.event_id)
  FROM simulator_private.ops_event_links l JOIN public.clubs c ON c.id=l.club_id AND c.active
  WHERE EXISTS(SELECT 1 FROM public.club_memberships cm JOIN public.exco_roles r ON r.id=cm.role_id
   WHERE cm.member_id=actor AND cm.club_id=l.club_id AND cm.is_active AND NOT r.is_admin_role)
 ),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.rpc_simulator_event_sources() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_simulator_event_sources() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
