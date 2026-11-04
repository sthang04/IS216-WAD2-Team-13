-- =====================================================================
-- Pulse — Seed Dev Administrator into members & club_memberships
--
-- Run in the Supabase SQL Editor (bdqzysnapwxdzppkuftn)
-- Safe to re-run: idempotent and uses ON CONFLICT handling.
-- =====================================================================

DO $$
DECLARE
  v_user_id uuid;
  v_member_id integer;
  v_club_id integer;
  v_role_id integer;
BEGIN
  -- 1. Locate auth user ID for dev.admin@smu.edu.sg (already registered in auth.users)
  SELECT id INTO v_user_id 
  FROM auth.users 
  WHERE lower(email) = 'dev.admin@smu.edu.sg'
  LIMIT 1;

  -- 2. Insert or link Dev Administrator in public.members
  INSERT INTO public.members (full_name, student_email, auth_user_id, is_active)
  VALUES ('Dev Administrator', 'dev.admin@smu.edu.sg', v_user_id, true)
  ON CONFLICT (student_email) DO UPDATE
    SET auth_user_id = COALESCE(v_user_id, public.members.auth_user_id),
        is_active = true
  RETURNING id INTO v_member_id;

  IF v_member_id IS NULL THEN
    SELECT id INTO v_member_id FROM public.members WHERE lower(student_email) = 'dev.admin@smu.edu.sg';
  END IF;

  -- 3. Resolve Eurhythmix CCA & OSL_ADMIN role
  SELECT id INTO v_club_id FROM public.clubs WHERE short_name = 'Eurhythmix' LIMIT 1;
  SELECT id INTO v_role_id FROM public.exco_roles WHERE role_code = 'OSL_ADMIN' LIMIT 1;

  IF v_role_id IS NULL THEN
    SELECT id INTO v_role_id FROM public.exco_roles WHERE is_admin_role = true LIMIT 1;
  END IF;

  -- 4. Insert active membership for Dev Administrator
  IF v_member_id IS NOT NULL AND v_club_id IS NOT NULL AND v_role_id IS NOT NULL THEN
    INSERT INTO public.club_memberships (member_id, club_id, role_id, academic_year, is_active)
    VALUES (v_member_id, v_club_id, v_role_id, '2026/27', true)
    ON CONFLICT DO NOTHING;
  END IF;

  RAISE NOTICE 'Dev Administrator successfully linked! Member ID: %, User ID: %', v_member_id, v_user_id;
END $$;
