-- File data in supabase website

-- 1. Create table facility_slots
CREATE TABLE IF NOT EXISTS facility_slots (
  id BIGSERIAL PRIMARY KEY,
  venue_name TEXT NOT NULL,
  venue_type TEXT NOT NULL,
  building_location TEXT NOT NULL,
  event_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  owner_club TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Booked',
  claiming_club TEXT,
  audit_ticket_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE facility_slots ENABLE ROW LEVEL SECURITY;

-- 3. Allow public read, update, and insert for demo
DROP POLICY IF EXISTS "Allow public read access" ON facility_slots;
CREATE POLICY "Allow public read access" ON facility_slots FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public update access" ON facility_slots;
CREATE POLICY "Allow public update access" ON facility_slots FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow public insert access" ON facility_slots;
CREATE POLICY "Allow public insert access" ON facility_slots FOR INSERT WITH CHECK (true);

-- 4. Insert records
DELETE FROM facility_slots WHERE id IN (1, 2, 3, 4, 5, 6);

INSERT INTO facility_slots (id, venue_name, venue_type, building_location, event_date, time_slot, owner_club, status, claiming_club, audit_ticket_id, notes)
VALUES
  (
    1,
    'ACC',
    'Multi-Purpose',
    'Location TBC',
    '2027-10-16',
    '10:00 - 13:00',
    'Stageit',
    'Booked',
    NULL,
    NULL,
    NULL
  ),
  (
    2,
    'Studio L7.1 (Music)',
    'Acoustic Room',
    'Level 7',
    '2027-10-16',
    '16:00 - 19:00',
    'Chinese Orchestra',
    'Proposed Peer Transfer',
    NULL,
    NULL,
    NULL
  ),
  (
    3,
    'Studio L7.2 (Dance)',
    'Dance Studio',
    'Level 7',
    '2027-10-16',
    '18:00 - 21:00',
    'Eurhythmix',
    'Booked',
    NULL,
    NULL,
    NULL
  ),
  (
    4,
    'Gym Studio',
    'Sports Court',
    'Location TBC',
    '2027-10-17',
    '19:00 - 22:00',
    'ACF ExCo',
    'Booked',
    NULL,
    NULL,
    NULL
  ),
  (
    5,
    'Music Drama Lab (MDL)',
    'Acoustic Room',
    'Location TBC',
    '2027-10-17',
    '14:00 - 18:00',
    'SoundFoundry',
    'Pending Admin Sign-off',
    'Eurhythmix',
    '#SMU-2027-089',
    NULL
  ),
  (
    6,
    'Basement Studio',
    'Multi-Purpose',
    'Basement',
    '2027-10-18',
    '15:00 - 18:00',
    'Funk Movement',
    'Booked',
    NULL,
    NULL,
    NULL
  );

-- Sync sequence with highest id
SELECT setval('facility_slots_id_seq', (SELECT MAX(id) FROM facility_slots));
