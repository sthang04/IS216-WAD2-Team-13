-- Dedicated staging fixture records only. Create the five confirmed Auth test accounts first.
-- Existing simulator fixtures and append-only transfer history are preserved.
begin;
do $$ begin
 if (select count(*) from auth.users where email in ('pulse.e2e.owner@scis.smu.edu.sg','pulse.e2e.claimant@scis.smu.edu.sg','pulse.e2e.participant@scis.smu.edu.sg','pulse.e2e.outsider@scis.smu.edu.sg','pulse.e2e.admin@scis.smu.edu.sg' ) and email_confirmed_at is not null) <> 5 then
  raise exception 'Create the five confirmed staging Auth accounts before seeding; do not send invitations';
 end if;
 if exists(select 1 from public.members where id between 980001 and 980005 and (student_email is null or student_email not like 'pulse.e2e.%@scis.smu.edu.sg')) then raise exception 'Reserved E2E member IDs are already in use'; end if;
 if exists(select 1 from public.facilities where id=980001 and name is distinct from 'E2E Transfer Studio') then raise exception 'Reserved E2E facility ID is already in use'; end if;
 if exists(select 1 from public.facility_bookings where id between 980101 and 980106 and booking_source is distinct from 'E2E_STAGING') then raise exception 'Reserved E2E booking IDs are already in use'; end if;
end $$;
insert into public.exco_roles(role_code,role_name,can_release_booking,can_claim_booking,can_manage_waitlist,can_send_transfer_email,can_manage_members,is_admin_role,sort_order)
select 'E2E_LOGISTICS','Logistics Director',true,true,true,true,true,false,10 where not exists(select 1 from public.exco_roles where role_code='E2E_LOGISTICS');
insert into public.exco_roles(role_code,role_name,can_release_booking,can_claim_booking,can_manage_waitlist,can_send_transfer_email,can_manage_members,is_admin_role,sort_order)
select 'E2E_MEMBER','ExCo Member',false,false,false,false,false,false,100 where not exists(select 1 from public.exco_roles where role_code='E2E_MEMBER');
insert into public.members(id,full_name,student_email,auth_user_id,is_active,onboarded_at)
select v.id,v.name,v.email,u.id,true,now() from (values
 (980001,'E2E Booking Owner','pulse.e2e.owner@scis.smu.edu.sg'),
 (980002,'E2E Booking Claimant','pulse.e2e.claimant@scis.smu.edu.sg'),
 (980003,'E2E Meeting Participant','pulse.e2e.participant@scis.smu.edu.sg'),
 (980004,'E2E Other Club','pulse.e2e.outsider@scis.smu.edu.sg'),
 (980005,'E2E OSL Administrator','pulse.e2e.admin@scis.smu.edu.sg')
) v(id,name,email) join auth.users u on u.email=v.email on conflict(id) do update set auth_user_id=excluded.auth_user_id where members.student_email=excluded.student_email;
insert into public.club_memberships(id,member_id,club_id,role_id,is_active,academic_year,subcommittee)
select v.id,v.id,v.club_id,r.id,true,'2026/27','Executive' from (values
 (980001,5,'E2E_LOGISTICS'),
 (980002,10,'E2E_LOGISTICS'),
 (980003,10,'E2E_MEMBER'),
 (980004,13,'E2E_MEMBER'),
 (980005,19,'OSL_ADMIN')
) v(id,club_id,role_code) join public.exco_roles r on r.role_code=v.role_code on conflict(id) do nothing;
update public.app_config set value='false'::jsonb where key='demo_mode';
update public.app_config set value='"2099-12-31"'::jsonb where key='calendar_end_date';
update public.clubs set official_email='e2e-'||id||'@example.invalid' where id in(5,10,13,19);
update public.transfer_email_config set to_emails=array['e2e-osl@example.invalid'],cc_emails='{}';
insert into public.facilities(id,name,facility_type,location,capacity,selected_clubs_only,description,equipment,is_active)
values(980001,'E2E Transfer Studio','Dance Studio','Synthetic test venue',40,false,'Reserved for Playwright staging journeys',array['Mirrors'],true) on conflict(id) do nothing;
insert into public.facility_bookings(id,facility_id,booking_date,start_time,end_time,owner_club_id,original_club_id,status,fbs_reference,booking_source)
select 980101+i,980001,date_trunc('week',now() at time zone 'Asia/Singapore')::date+14,time '09:00'+i*interval '1 hour',time '10:00'+i*interval '1 hour',5,5,'Booked','E2E-BOOKING-'||i,'E2E_STAGING' from generate_series(0,5) i on conflict(id) do nothing;
-- Renew only idle fixture dates after the real four-day transfer window expires.
update public.facility_bookings set booking_date=date_trunc('week',now() at time zone 'Asia/Singapore')::date+14
where booking_source='E2E_STAGING' and owner_club_id=5 and status='Booked';
commit;
