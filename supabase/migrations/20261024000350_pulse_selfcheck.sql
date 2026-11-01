-- =====================================================================
-- Pulse — 4/4  Self-check. Fails loudly if anything the Vue app reads is
-- missing, so a half-applied install can't go unnoticed.
-- Success ends with:  NOTICE  Pulse install OK: ...
-- =====================================================================
do $$
declare
  required text[][] := array[
    ['facilities', 'id,name,facility_type,location,capacity,capacity_is_estimate,equipment,is_active'],
    ['facility_bookings', 'id,facility_id,booking_date,start_time,end_time,owner_club_id,original_club_id,fbs_reference,booking_source,status'],
    ['facility_transfers', 'id,booking_id,releasing_club_id,claiming_club_id,audit_voucher_id,transfer_status,released_by_member_id,claimed_by_member_id,reviewed_by_member_id,email_status'],
    ['notifications', 'id,recipient_club_id,recipient_member_id,type,title,body,action_url,is_read,telegram_status'],
    ['v_master_facility_calendar', 'booking_id,booking_date,start_time,end_time,status,status_rank,fbs_reference,is_demo_reference,facility_id,facility_name,owner_club_id,owner_club,owner_club_name,releasing_club_name,claiming_club_id,claiming_club_name,transfer_id,waitlist_count,offered_club_id,offered_club_name,offer_expires_at,is_transfer_window_open'],
    ['v_waitlist_queue', 'waitlist_id,entry_id,booking_id,club_id,club_name,status,queue_position,offer_expires_at,booking_date,start_time,end_time,booking_status,fbs_reference,facility_name,owner_club_name'],
    ['v_user_club_memberships', 'user_id,member_id,full_name,club_id,club_name,role_name,role_code,can_release_booking,can_claim_booking,can_manage_waitlist,can_send_transfer_email,is_admin_role,membership_is_active,is_osl_admin'],
    ['v_demo_personas', 'member_id,full_name,user_id,club_id,club_name,role_name,role_code,can_release_booking,can_claim_booking,can_manage_waitlist,can_send_transfer_email,is_admin_role,membership_is_active']
  ];
  rpcs text[] := array['rpc_release_booking','rpc_undo_release','rpc_claim_booking','rpc_join_waitlist','rpc_leave_waitlist',
    'rpc_request_osl_email','rpc_approve_transfer','rpc_reject_transfer','rpc_osl_pending_transfers','rpc_transfer_audit_history',
    'rpc_recent_transfer_decisions','rpc_club_transfers','rpc_my_notifications','rpc_mark_notifications_read','rpc_delete_notifications','rpc_reset_demo_data'];
  i int; col text; missing text[] := '{}'; r text; v_personas int; v_lds int; v_week int; v_osl int;
begin
  for i in 1 .. array_length(required, 1) loop
    foreach col in array string_to_array(required[i][2], ',') loop
      if not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = required[i][1] and column_name = col) then
        missing := missing || (required[i][1] || '.' || col);
      end if;
    end loop;
  end loop;
  foreach r in array rpcs loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = r) then
      missing := missing || r;
    elsif not has_function_privilege('anon', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                              where n.nspname = 'public' and p.proname = r limit 1), 'execute') then
      missing := missing || ('anon cannot execute ' || r);
    end if;
  end loop;
  if not has_table_privilege('anon', 'public.v_demo_personas', 'select') then
    missing := missing || 'anon cannot read v_demo_personas'::text;
  end if;
  if array_length(missing, 1) > 0 then
    raise exception 'Pulse install incomplete. Missing: %', array_to_string(missing, ', ');
  end if;

  select count(distinct member_id) into v_personas from v_demo_personas;
  select count(distinct member_id) into v_lds from v_demo_personas where role_code = 'LOGISTICS_DIRECTOR' and can_release_booking;
  select count(distinct member_id) into v_osl from v_demo_personas where is_admin_role;
  select count(*) into v_week from v_master_facility_calendar
   where booking_date between date_trunc('week', sg_today())::date + 7 and date_trunc('week', sg_today())::date + 13
     and status <> 'Booked';
  raise notice 'Pulse install OK: % personas (% Logistics Directors, % OSL admins), % transfer exceptions next week',
    v_personas, v_lds, v_osl, v_week;
end $$;
