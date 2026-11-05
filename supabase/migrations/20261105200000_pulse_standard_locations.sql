-- =====================================================================
-- Pulse — every facility location reads the same way: building short form, then floor.
-- Safe to re-run. Only the wording changes; no booking is affected.
-- =====================================================================
update public.facilities f set location = n.location
  from (values
    ('Arts & Culture Centre (ACC)', 'SOE / SOSS, Basement Concourse'),
    ('Music & Drama Lab (MDL)',     'SOE / SOSS, Basement 1'),
    ('Studio 7.1',                  'SOE, Level 7'),
    ('Studio 7.2',                  'SOE, Level 7'),
    ('Basement Studio',             'LKCSB, Basement Carpark'),
    ('Gym Studio',                  'SCIS 2, Basement 1'),
    ('Sports Hall',                 'Admin Building, Level 3')
  ) as n(name, location)
 where f.name = n.name and f.is_active;
