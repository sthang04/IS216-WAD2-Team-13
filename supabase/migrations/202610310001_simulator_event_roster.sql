-- LOCAL REVIEW ARTIFACT ONLY. Do not run without explicit deployment approval.
-- Verified contract: events.club_name matches clubs.name OR clubs.short_name;
-- active members -> active club_memberships -> exco_roles, clubs.active.
-- Existing event SELECT access excludes admin roles. No year is hardcoded.
BEGIN;

-- CREATE deliberately fails if this signature already exists: do not overwrite
-- an unknown deployed implementation. Review ownership before deploying.
CREATE FUNCTION public.rpc_simulator_event_roster(p_event_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_uid uuid := auth.uid();
  resolved_club_id bigint;
  matching_clubs bigint;
  roster jsonb;
BEGIN
  -- Never accept a member ID from the browser as proof of caller identity.
  IF caller_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Names are compared exactly, matching the existing event SELECT policy.
  -- Missing and ambiguous matches fail closed, including short-name collisions.
  SELECT count(*), min(c.id)
    INTO matching_clubs, resolved_club_id
  FROM public.events AS e
  JOIN public.clubs AS c
    ON e.club_name = c.name OR e.club_name = c.short_name
  WHERE e.id = p_event_id AND c.active = true;

  IF matching_clubs <> 1 THEN
    RAISE EXCEPTION 'Event unavailable or not authorised' USING ERRCODE = '42501';
  END IF;

  -- A definer function can read rows hidden by RLS. That is why it repeats
  -- the verified event-access rules BEFORE returning any other member's data.
  -- Fixed schema names/search_path prevent untrusted object substitution.
  IF NOT EXISTS (
    SELECT 1
    FROM public.members AS caller
    JOIN public.club_memberships AS cm ON cm.member_id = caller.id
    JOIN public.exco_roles AS r ON r.id = cm.role_id
    WHERE caller.auth_user_id = caller_uid
      AND caller.is_active = true
      AND cm.club_id = resolved_club_id
      AND cm.is_active = true
      AND r.is_admin_role = false
  ) THEN
    RAISE EXCEPTION 'Event unavailable or not authorised' USING ERRCODE = '42501';
  END IF;

  -- Start from membership, never assignments: standby members are included.
  -- Return only display identity and membership evidence, not contact/auth data.
  -- Retain active membership years as-is; no current-year rule was verified.
  SELECT coalesce(jsonb_agg(to_jsonb(candidate)
      ORDER BY candidate.member_id, candidate.academic_year), '[]'::jsonb)
    INTO roster
  FROM (
    SELECT DISTINCT m.id AS member_id, m.full_name,
      cm.club_id, cm.academic_year
    FROM public.club_memberships AS cm
    JOIN public.members AS m ON m.id = cm.member_id
    WHERE cm.club_id = resolved_club_id
      AND cm.is_active = true
      AND m.is_active = true
  ) AS candidate;

  -- An envelope preserves the resolved club even if the roster is empty.
  -- One JSON result avoids PostgREST silently truncating a set-returning roster.
  RETURN jsonb_build_object('event_id', p_event_id,
    'club_id', resolved_club_id, 'members', roster);
END;
$function$;

-- Functions otherwise receive PUBLIC EXECUTE by default. Only real signed-in
-- callers may execute this endpoint; the function still checks auth.uid().
REVOKE ALL ON FUNCTION public.rpc_simulator_event_roster(bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_simulator_event_roster(bigint)
  TO authenticated;
COMMIT;
