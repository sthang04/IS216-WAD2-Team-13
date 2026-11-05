-- Staging-only fixture preparation. Never install this helper on the shared app backend.
-- The private function can only reset a completed, returned E2E booking for the dedicated OSL test account.
create schema if not exists e2e_private;
revoke all on schema e2e_private from public,anon;
grant usage on schema e2e_private to authenticated;
create or replace function e2e_private.restore_booking(p_booking_id bigint) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.facility_bookings%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.members where auth_user_id=auth.uid() and student_email='pulse.e2e.admin@scis.smu.edu.sg' and is_active) or not public.is_osl_admin(public.current_member_id(null)) then
  raise exception 'Only the dedicated staging administrator may prepare E2E records' using errcode='42501';
 end if;
 select * into b from public.facility_bookings where id=p_booking_id for update;
 if not found or b.booking_source<>'E2E_STAGING' or b.owner_club_id<>5 or b.status not in ('Booked','Officially Confirmed Booking') then
  raise exception 'Only an already returned E2E booking can be prepared';
 end if;
 update public.facility_bookings set status='Booked',updated_at=now() where id=b.id;
end $$;
revoke all on function e2e_private.restore_booking(bigint) from public,anon;
grant execute on function e2e_private.restore_booking(bigint) to authenticated;
create or replace function public.rpc_e2e_restore_booking(p_booking_id bigint) returns void
language sql security invoker set search_path=public,pg_temp as $$ select e2e_private.restore_booking(p_booking_id) $$;
revoke all on function public.rpc_e2e_restore_booking(bigint) from public,anon;
grant execute on function public.rpc_e2e_restore_booking(bigint) to authenticated;
notify pgrst,'reload schema';