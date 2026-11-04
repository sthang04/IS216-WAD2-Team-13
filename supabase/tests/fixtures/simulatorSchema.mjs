// Minimal isolated PostgreSQL contract schema, never imported by the application.
export const fixture = `
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$auth$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
CREATE TABLE public.clubs(id bigint PRIMARY KEY,name text UNIQUE,short_name text,active boolean);
CREATE TABLE public.members(id bigint PRIMARY KEY,full_name text,auth_user_id uuid,is_active boolean);
CREATE TABLE public.exco_roles(id bigint PRIMARY KEY,role_code text,can_manage_members boolean,is_admin_role boolean);
CREATE TABLE public.club_memberships(member_id bigint REFERENCES members,club_id bigint REFERENCES clubs,role_id bigint REFERENCES exco_roles,is_active boolean,academic_year text);
CREATE TABLE public.events(id bigint PRIMARY KEY,name text,club_name text,starts_at timestamptz,ends_at timestamptz);
CREATE TABLE public.event_segments(id bigint PRIMARY KEY,event_id bigint REFERENCES events,title text,segment_type text,starts_at timestamptz,ends_at timestamptz);
CREATE TABLE public.segment_assignments(id bigint PRIMARY KEY,segment_id bigint REFERENCES event_segments,member_id bigint REFERENCES members,role_name text,is_required boolean,UNIQUE(segment_id,member_id,role_name));
CREATE TABLE public.segment_dependencies(prerequisite_segment_id bigint REFERENCES event_segments,dependent_segment_id bigint REFERENCES event_segments);
CREATE TABLE public.facilities(id bigint PRIMARY KEY,name text,is_active boolean,capacity integer);
CREATE TABLE public.facility_bookings(id bigint PRIMARY KEY,facility_id bigint REFERENCES facilities,booking_date date,start_time time,end_time time,owner_club_id bigint REFERENCES clubs,status text);
CREATE TABLE public.segment_facility_bookings(segment_id bigint REFERENCES event_segments,booking_id bigint REFERENCES facility_bookings,PRIMARY KEY(segment_id,booking_id));
CREATE TABLE public.notifications(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,recipient_member_id bigint,title text,body text,action_url text);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_public_read ON public.notifications FOR SELECT USING(true);
GRANT SELECT ON public.notifications TO anon,authenticated;
CREATE FUNCTION public.pulse_mark_push_pending() RETURNS trigger LANGUAGE plpgsql AS $trigger$
 BEGIN RAISE EXCEPTION 'Notification insertion forbidden during simulator tests'; END
$trigger$;
CREATE TRIGGER fixture_no_notification BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.pulse_mark_push_pending();
CREATE FUNCTION public.rpc_simulator_event_roster(bigint) RETURNS jsonb LANGUAGE sql AS $roster$ SELECT '{"existing":"untouched"}'::jsonb $roster$;
INSERT INTO clubs VALUES(1,'Club One','ONE',true),(2,'Club Two','TWO',true);
INSERT INTO exco_roles VALUES(1,'MANAGER',true,false),(2,'MEMBER',false,false),(3,'ADMIN',true,true);
INSERT INTO members SELECT n,'Fixture member '||n,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,true FROM generate_series(1,7) n;
INSERT INTO club_memberships SELECT n,CASE WHEN n=4 THEN 2 ELSE 1 END,CASE WHEN n IN(1,4) THEN 1 WHEN n=5 THEN 3 ELSE 2 END,true,'2026/27' FROM generate_series(1,7) n;
INSERT INTO events VALUES(1,'Fixture Event','Club One','2026-11-02T10:00:00.123456Z','2026-11-02T11:00:00.654321Z'),(2,'Other Event','Club Two','2026-11-02T12:00:00Z','2026-11-02T13:00:00Z');
INSERT INTO event_segments VALUES(1,1,'Fixture Activity','Performance','2026-11-02T10:00:00.123456Z','2026-11-02T11:00:00.654321Z'),(2,2,'Other Activity','Performance','2026-11-02T12:00:00Z','2026-11-02T13:00:00Z');
INSERT INTO segment_assignments VALUES(1,1,3,'Performer',true);
INSERT INTO facilities VALUES(1,'Original Room',true,50),(2,'Replacement Room',true,50),(3,'Other Room',true,50);
INSERT INTO facility_bookings VALUES(1,1,'2026-11-02','17:00','22:00',1,'Booked'),(2,2,'2026-11-02','17:00','22:00',1,'Pending Admin Sign-off'),(3,3,'2026-11-02','17:00','22:00',2,'Booked');
INSERT INTO segment_facility_bookings VALUES(1,1);
`
