-- ExCo list for sign-up (run in the Supabase SQL editor)
-- OSL adds one row per ExCo per CCA (a student leading 2 CCAs gets 2 rows);
-- the ExCo signs up themselves and fills in name, Telegram and their position in each CCA.

-- 1. Create table exco_members
CREATE TABLE IF NOT EXISTS exco_members (
  email TEXT NOT NULL,
  cca TEXT NOT NULL,
  full_name TEXT,
  position TEXT,
  telegram_handle TEXT,
  onboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (email, cca)
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE exco_members ENABLE ROW LEVEL SECURITY;

-- 3. Signed-in users can only see and edit their own row
DROP POLICY IF EXISTS "Read own ExCo row" ON exco_members;
CREATE POLICY "Read own ExCo row" ON exco_members FOR SELECT TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Update own ExCo row" ON exco_members;
CREATE POLICY "Update own ExCo row" ON exco_members FOR UPDATE TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email'))
  WITH CHECK (lower(email) = lower(auth.jwt() ->> 'email'));

-- 4. ExCos may only change their profile fields, never their email or CCA (OSL controls those)
REVOKE INSERT, UPDATE, DELETE ON exco_members FROM anon, authenticated;
GRANT SELECT ON exco_members TO authenticated;
GRANT UPDATE (full_name, position, telegram_handle, onboarded_at) ON exco_members TO authenticated;

-- 5. Sign-up check: answers "is this email on the ExCo list, which CCAs, and not signed up yet?"
--    without letting anyone read the table itself
CREATE OR REPLACE FUNCTION check_exco_signup(p_email TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ccas JSON;
BEGIN
  SELECT json_agg(cca ORDER BY cca) INTO v_ccas FROM exco_members WHERE lower(email) = lower(trim(p_email));
  IF v_ccas IS NULL THEN
    RETURN json_build_object('status', 'not_listed');
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(trim(p_email))) THEN
    RETURN json_build_object('status', 'already_registered');
  END IF;
  RETURN json_build_object('status', 'ok', 'ccas', v_ccas);
END;
$$;

REVOKE ALL ON FUNCTION check_exco_signup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_exco_signup(TEXT) TO anon, authenticated;

-- 6. Add an ExCo (OSL does this), one row per CCA they lead. Use lowercase emails.
-- INSERT INTO exco_members (email, cca) VALUES ('name.2025@smu.edu.sg', 'Eurhythmix');
-- INSERT INTO exco_members (email, cca) VALUES ('name.2025@smu.edu.sg', 'Samba Masala');
