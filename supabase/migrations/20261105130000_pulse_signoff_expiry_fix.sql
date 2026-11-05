-- =====================================================================
-- Pulse — late transfers expire again. Additive, safe to re-run.
--
-- process_osl_signoff_deadlines logs SIGNOFF_EXPIRED, which the audit log's
-- check constraint never allowed, so every run failed and rolled back. Late
-- transfers stayed in Pending Admin Sign-off, and no reminders went out either.
-- The function's only other change is the reason: "Late approval".
-- The next cron run (every 5 minutes) expires anything already late.
-- =====================================================================

alter table public.transfer_audit_log drop constraint if exists transfer_audit_log_event_type_check;
alter table public.transfer_audit_log add constraint transfer_audit_log_event_type_check
  check (event_type in ('RELEASED', 'CLAIMED', 'EMAIL_READY', 'EMAIL_SENT', 'APPROVED', 'REJECTED', 'CANCELLED',
                        'OSL_EMAIL_REQUESTED', 'RELEASE_UNDONE', 'RELISTED_AFTER_REJECTION', 'SIGNOFF_EXPIRED'));

create or replace function public.process_osl_signoff_deadlines()
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  r        record;
  v_rem    int := 0;
  v_exp    int := 0;
  v_to     text[];
  v_body   text;
  v_prev   text;
begin
  select coalesce(to_emails, '{}') into v_to from transfer_email_config limit 1;

  -- 1. Reminders
  for r in
    select t.*, b.booking_date, b.start_time, b.end_time, b.fbs_reference, f.name as facility_name,
           rc.name as releasing_name, cc.name as claiming_name,
           osl_signoff_deadline(b.booking_date, b.start_time) as deadline
      from facility_transfers t
      join facility_bookings b on b.id = t.booking_id
      join facilities f on f.id = b.facility_id
      join clubs rc on rc.id = t.releasing_club_id
      left join clubs cc on cc.id = t.claiming_club_id
     where t.transfer_status = 'Pending Admin Sign-off'
       and t.signoff_reminder_sent_at is null
       and now() >= osl_signoff_deadline(b.booking_date, b.start_time) - make_interval(hours => coalesce(cfg_int('osl_reminder_hours'), 24))
       and now() <  osl_signoff_deadline(b.booking_date, b.start_time)
     for update of t
  loop
    v_body := format(E'Dear Office of Student Life,\n\n'
      'This is a reminder that the following facility booking transfer is still awaiting sign-off. Under SSU Clause 9.1(c) it must be approved by %s, 48 hours before the booking starts. If it is not approved by then, the booking stays with %s.\n\n'
      '  FBS Reference: %s\n  Facility: %s\n  Date: %s\n  Time: %s – %s\n  Releasing CCA: %s\n  Claiming CCA: %s\n\n'
      'Review transfer: %s\n\n'
      'Pulse Facility Coordination',
      to_char(r.deadline at time zone 'Asia/Singapore', 'FMDay DD Mon YYYY, HH24:MI'), r.releasing_name,
      r.fbs_reference, r.facility_name, to_char(r.booking_date, 'FMDay, FMDD FMMonth YYYY'),
      to_char(r.start_time, 'HH24:MI'), to_char(r.end_time, 'HH24:MI'), r.releasing_name, r.claiming_name,
      cfg_text('pulse_base_url') || '/facilities/admin?transfer=' || r.id);
    if not exists (select 1 from transfer_emails where transfer_id = r.id and email_type = 'OSL_DEADLINE_REMINDER') then
      insert into transfer_emails (transfer_id, booking_id, email_type, sender_club_id, from_email, to_emails, cc_emails,
                                   subject, body, action_url, status, queued_at)
      values (r.id, r.booking_id, 'OSL_DEADLINE_REMINDER', r.releasing_club_id,
              coalesce(cfg_text('email_from'), 'pulse-notifications@example.org'), coalesce(v_to, '{}'), '{}',
              format('Action needed within 24 hours: facility transfer sign-off (%s, %s)', r.facility_name, to_char(r.booking_date, 'DD Mon YYYY')),
              v_body, cfg_text('pulse_base_url') || '/facilities/admin?transfer=' || r.id, 'QUEUED', now());
    end if;
    perform notify_osl_admins('OSL_DEADLINE_REMINDER', 'Sign-off due within 24 hours',
      format('%s → %s: %s, %s. Approve by %s or it stays with %s.', r.releasing_name, r.claiming_name, r.facility_name,
             fmt_slot(r.booking_date, r.start_time, r.end_time),
             to_char(r.deadline at time zone 'Asia/Singapore', 'Dy DD Mon HH24:MI'), r.releasing_name),
      r.booking_id, r.id);
    update facility_transfers set signoff_reminder_sent_at = now() where id = r.id;
    v_rem := v_rem + 1;
  end loop;

  -- 2. Expiry: the slot remains with (and belongs to) the releasing CCA
  for r in
    select t.*, b.booking_date, b.start_time, b.end_time, f.name as facility_name, cc.name as claiming_name
      from facility_transfers t
      join facility_bookings b on b.id = t.booking_id
      join facilities f on f.id = b.facility_id
      left join clubs cc on cc.id = t.claiming_club_id
     where t.transfer_status = 'Pending Admin Sign-off'
       and now() >= osl_signoff_deadline(b.booking_date, b.start_time)
     for update of t
  loop
    perform 1 from facility_bookings where id = r.booking_id for update;
    update facility_transfers set transfer_status = 'Expired', reviewed_at = now(),
           rejection_reason = 'Late approval: OSL did not sign off 48 hours before the booking (SSU Clause 9.1(c))'
     where id = r.id;
    v_prev := case when exists (select 1 from facility_transfers x
                                 where x.booking_id = r.booking_id and x.transfer_status = 'Officially Confirmed Booking'
                                   and x.claiming_club_id = r.releasing_club_id)
                   then 'Officially Confirmed Booking' else 'Booked' end;
    update facility_bookings set status = v_prev, updated_at = now() where id = r.booking_id;
    update waitlist_entries set status = 'LEFT', left_at = now()
     where booking_id = r.booking_id and status in ('WAITING','OFFERED');
    perform log_transfer_event(r.id, r.booking_id, 'SIGNOFF_EXPIRED', null, null,
      jsonb_build_object('deadline', osl_signoff_deadline(r.booking_date, r.start_time)));
    perform notify_club_members(r.claiming_club_id, 'TRANSFER_EXPIRED', 'Not signed off in time: ' || r.facility_name,
      format('OSL did not sign off %s (%s) 48 hours before the booking, so the transfer lapsed and the slot stays with the releasing CCA.',
             r.facility_name, fmt_slot(r.booking_date, r.start_time, r.end_time)),
      r.booking_id, r.id, null, '/facilities/my-club', true);
    perform notify_club_members(r.releasing_club_id, 'TRANSFER_EXPIRED', 'Slot stays with you: ' || r.facility_name,
      format('OSL did not sign off the transfer of %s (%s) to %s in time, so the booking remains yours.',
             r.facility_name, fmt_slot(r.booking_date, r.start_time, r.end_time), r.claiming_name),
      r.booking_id, r.id, null, '/facilities/my-club', true);
    v_exp := v_exp + 1;
  end loop;
  return jsonb_build_object('reminders', v_rem, 'expired', v_exp);
end $function$;
