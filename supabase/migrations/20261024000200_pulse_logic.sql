-- =====================================================================
-- Pulse — Master Facility Calendar
-- 2/4  Helpers, views, RPCs (every write goes through these), RLS, grants
--
-- Safe to re-run. Views keep the columns your project already had (in
-- the same order) and add the ones the Vue app needs after them, so
-- anything else that reads them keeps working.
--
-- Status values (facility_bookings.status and facility_transfers.transfer_status):
--   Booked · Proposed Peer Transfer · Pending Admin Sign-off ·
--   Officially Confirmed Booking   (+ Rejected / Cancelled for transfers)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Remove older copies of this module's functions (any signature) so
--    changed return types can be recreated. Nothing else is touched.
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'rpc\_%'
            or p.proname in ('cfg_text','cfg_int','cfg_bool','sg_today','transfer_cutoff_date','fmt_slot',
                             'transfer_state_code','current_member_id','member_auth_uid','is_logistics_director',
                             'has_club_permission','is_osl_admin','require_club_permission','require_logistics_director',
                             'require_osl_admin','assert_transfer_window','log_transfer_event','notify_club_directors',
                             'notify_osl_admins','offer_next_waitlist','expire_offers_for_booking',
                             'process_expired_waitlist_offers','generate_bookings_from_patterns','compose_transfer_email','osl_signoff_deadline','process_osl_signoff_deadlines','pulse_link_auth_users','pulse_on_auth_user_created',
                             'queue_osl_request_email','notify_claim_result','pulse_install_view'))
  loop
    begin
      execute format('drop function %s', f.sig);
    exception when dependent_objects_still_exist then
      raise notice 'Pulse: kept % (something else depends on it)', f.sig;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Config + date helpers
-- ---------------------------------------------------------------------
create or replace function cfg_text(p_key text) returns text
language sql stable security definer set search_path = public as $$ select value #>> '{}' from app_config where key = p_key $$;

-- Reads a number setting from pulse_config (e.g. transfer lead days)
create or replace function cfg_int(p_key text) returns int
language sql stable security definer set search_path = public as $$ select (value #>> '{}')::int from app_config where key = p_key $$;

-- Reads a true/false setting from pulse_config
create or replace function cfg_bool(p_key text) returns boolean
language sql stable security definer set search_path = public as $$ select coalesce((value #>> '{}')::boolean, false) from app_config where key = p_key $$;

-- SMU runs on Singapore time; never trust the browser's clock.
create or replace function sg_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Singapore')::date $$;

-- First date that can still be released or claimed (today in Singapore + lead days)
create or replace function transfer_cutoff_date() returns date
language sql stable as $$ select sg_today() + coalesce(cfg_int('transfer_lead_days'), 4) $$;

-- Formats a slot for emails, e.g. 'Thu 5 Nov 2026, 18:00-20:00'
create or replace function fmt_slot(p_date date, p_start time, p_end time) returns text
language sql immutable as $$
  select to_char(p_date, 'Dy DD Mon') || ', ' || to_char(p_start, 'HH24:MI') || '–' || to_char(p_end, 'HH24:MI')
$$;

-- SSU Clause 9.1(c): OSL must sign off at least 48 hours before the booking starts.
create or replace function osl_signoff_deadline(p_date date, p_start time) returns timestamptz
language sql stable as $$
  select ((p_date + p_start) at time zone 'Asia/Singapore')
         - make_interval(hours => coalesce(cfg_int('osl_signoff_hours'), 48))
$$;

-- Short codes the Vue app uses for a transfer row.
create or replace function transfer_state_code(p_status text) returns text
language sql immutable as $$
  select case p_status
    when 'Proposed Peer Transfer'       then 'RELEASED'
    when 'Pending Admin Sign-off'       then 'CLAIMED'
    when 'Officially Confirmed Booking' then 'APPROVED'
    when 'Rejected'                     then 'REJECTED'
    when 'Cancelled'                    then 'CANCELLED'
    when 'Expired'                      then 'EXPIRED'
    else upper(p_status) end
$$;

-- ---------------------------------------------------------------------
-- 2. Identity and permissions
-- Real identity comes from Supabase Auth (members.auth_user_id). While
-- app_config.demo_mode is on and nobody is signed in, the persona
-- switcher's member id is accepted instead. Turn demo_mode off for real use.
-- ---------------------------------------------------------------------
create or replace function current_member_id(p_demo_member_id bigint default null) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  v_id bigint;
begin
  -- The demo seeder acts as several personas inside one transaction.
  if current_setting('pulse.seeding', true) = 'on' and cfg_bool('demo_mode') then
    return p_demo_member_id;
  end if;
  if auth.uid() is not null then
    select id into v_id from members where auth_user_id = auth.uid() order by id limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;
  if cfg_bool('demo_mode') and p_demo_member_id is not null
     and exists (select 1 from members where id = p_demo_member_id) then
    return p_demo_member_id;
  end if;
  return null;
end $$;

-- Finds the Supabase Auth login id linked to a member
create or replace function member_auth_uid(p_member_id bigint) returns uuid
language sql stable security definer set search_path = public as $$
  select auth_user_id from members where id = p_member_id
$$;

-- Permission comes only from the role's flags in exco_roles (an active membership
-- of that club whose role has, e.g., can_release_booking). No role names are hard-coded.
-- p_permission: release | claim | waitlist | email
create or replace function has_club_permission(p_member_id bigint, p_club_id bigint, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from club_memberships cm
      join exco_roles r on r.id = cm.role_id
     where cm.member_id = p_member_id
       and cm.club_id   = p_club_id
       and cm.is_active
       and case p_permission
             when 'release'  then r.can_release_booking
             when 'claim'    then r.can_claim_booking
             when 'waitlist' then r.can_manage_waitlist
             when 'email'    then r.can_send_transfer_email
             else false end
  )
$$;

-- True if this member's exco_roles row lets them release or claim for this club
create or replace function is_logistics_director(p_member_id bigint, p_club_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select has_club_permission(p_member_id, p_club_id, 'release') or has_club_permission(p_member_id, p_club_id, 'claim')
$$;

-- OSL administrators: an active membership whose exco role has is_admin_role.
create or replace function is_osl_admin(p_member_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_memberships cm join exco_roles r on r.id = cm.role_id
                  where cm.member_id = p_member_id and cm.is_active and r.is_admin_role)
$$;

-- Stops the action with an error unless the caller has this exco_roles flag for the club
create or replace function require_club_permission(p_club_id bigint, p_permission text, p_demo_member_id bigint) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  v_member bigint := current_member_id(p_demo_member_id);
begin
  -- The demo seeder acts for CCAs that have no Logistics Director persona.
  if current_setting('pulse.seeding', true) = 'on' and cfg_bool('demo_mode') then
    return v_member;
  end if;
  if v_member is null then
    raise exception 'Sign in to manage facility bookings' using errcode = '28000';
  end if;
  if not has_club_permission(v_member, p_club_id, p_permission) then
    raise exception 'Only the Logistics Director of the selected CCA can do this' using errcode = '42501';
  end if;
  return v_member;
end $$;

-- Stops the action with an error unless the caller is an OSL administrator
create or replace function require_osl_admin(p_demo_member_id bigint) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  v_member bigint := current_member_id(p_demo_member_id);
begin
  if v_member is null or not is_osl_admin(v_member) then
    raise exception 'Only OSL administrators can do this' using errcode = '42501';
  end if;
  return v_member;
end $$;

-- Stops the action if the booking is too close (transfers close a few days before)
create or replace function assert_transfer_window(p_date date) returns void
language plpgsql stable as $$
begin
  -- The demo seeder may place historic transfers inside the window.
  if current_setting('pulse.seeding', true) = 'on' then
    return;
  end if;
  if p_date < transfer_cutoff_date() then
    raise exception 'Transfers close % days before the booking date (earliest eligible date is %)',
      cfg_int('transfer_lead_days'), to_char(transfer_cutoff_date(), 'DD Mon YYYY');
  end if;
  if p_date > cfg_text('calendar_end_date')::date then
    raise exception 'Pulse only supports bookings up to %', cfg_text('calendar_end_date');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Audit + notification helpers
-- ---------------------------------------------------------------------
create or replace function log_transfer_event(
  p_transfer_id bigint, p_booking_id bigint, p_event_type text,
  p_actor bigint, p_club bigint, p_details jsonb default '{}'
) returns void
language sql security definer set search_path = public as $$
  insert into transfer_audit_log (transfer_id, booking_id, event_type, actor_user_id, actor_member_id, actor_club_id, details)
  values (p_transfer_id, p_booking_id, p_event_type, member_auth_uid(p_actor), p_actor, p_club, coalesce(p_details, '{}'))
$$;

-- One row per Logistics Director of the club (club id kept for context).
-- p_telegram = true only for: the waitlist offer to the #1 club, its
-- 5-minute reminder, and the OSL approval / rejection result.
create or replace function notify_club_directors(
  p_club_id bigint, p_type text, p_title text, p_body text,
  p_booking_id bigint, p_transfer_id bigint, p_entry_id bigint,
  p_link text, p_telegram boolean
) returns void
language sql security definer set search_path = public as $$
  insert into notifications (recipient_club_id, recipient_member_id, recipient_user_id, type, title, body,
                             booking_id, transfer_id, waitlist_entry_id, action_url, telegram_status)
  select distinct on (cm.member_id)
         p_club_id, cm.member_id, m.auth_user_id, p_type, p_title, p_body,
         p_booking_id, p_transfer_id, p_entry_id, p_link,
         case when p_telegram then 'PENDING' else 'NOT_REQUIRED' end
    from club_memberships cm
    join exco_roles r on r.id = cm.role_id
    join members m    on m.id = cm.member_id
   where cm.club_id = p_club_id and cm.is_active
     and (r.can_release_booking or r.can_claim_booking)
$$;

-- OSL results go to every active member of the club, not only the LD.
create or replace function notify_club_members(
  p_club_id bigint, p_type text, p_title text, p_body text,
  p_booking_id bigint, p_transfer_id bigint, p_entry_id bigint,
  p_link text, p_telegram boolean
) returns void
language sql security definer set search_path = public as $$
  insert into notifications (recipient_club_id, recipient_member_id, recipient_user_id, type, title, body,
                             booking_id, transfer_id, waitlist_entry_id, action_url, telegram_status)
  select distinct on (cm.member_id)
         p_club_id, cm.member_id, m.auth_user_id, p_type, p_title, p_body,
         p_booking_id, p_transfer_id, p_entry_id, p_link,
         case when p_telegram then 'PENDING' else 'NOT_REQUIRED' end
    from club_memberships cm
    join members m on m.id = cm.member_id
   where cm.club_id = p_club_id and cm.is_active
$$;

-- Sends an in-app notification to every OSL administrator
create or replace function notify_osl_admins(
  p_type text, p_title text, p_body text, p_booking_id bigint, p_transfer_id bigint
) returns void
language sql security definer set search_path = public as $$
  insert into notifications (recipient_member_id, recipient_user_id, type, title, body, booking_id, transfer_id, action_url)
  select m.id, m.auth_user_id, p_type, p_title, p_body, p_booking_id, p_transfer_id,
         '/facilities/admin?transfer=' || p_transfer_id
    from members m
   where is_osl_admin(m.id)
$$;

-- OSL results for the claiming CCA: every member for a direct claim, but only
-- the Logistics Director when the claim came from accepting a waitlist offer.
create or replace function notify_claim_result(
  p_transfer_id bigint, p_type text, p_title text, p_body text, p_booking_id bigint
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_club bigint := (select claiming_club_id from facility_transfers where id = p_transfer_id);
begin
  if exists (select 1 from transfer_audit_log
              where transfer_id = p_transfer_id and event_type = 'CLAIMED'
                and coalesce((details->>'via_waitlist_offer')::boolean, false)) then
    perform notify_club_directors(v_club, p_type, p_title, p_body, p_booking_id, p_transfer_id, null, '/facilities/my-club', true);
  else
    perform notify_club_members(v_club, p_type, p_title, p_body, p_booking_id, p_transfer_id, null, '/facilities/my-club', true);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Waitlist engine (FIFO by created_at, id as a stable tie-break)
-- Callers must already hold a row lock on the booking.
-- ---------------------------------------------------------------------
create or replace function offer_next_waitlist(p_booking_id bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  b      facility_bookings%rowtype;
  e      waitlist_entries%rowtype;
  v_fac  text;
  v_mins int := coalesce(cfg_int('waitlist_offer_minutes'), 30);
begin
  select * into b from facility_bookings where id = p_booking_id;
  if b.status <> 'Proposed Peer Transfer' then
    return null;
  end if;

  -- Somebody already holds a live offer.
  select * into e from waitlist_entries
   where booking_id = p_booking_id and status = 'OFFERED' and offer_expires_at > now();
  if found then
    return e.id;
  end if;

  select * into e from waitlist_entries
   where booking_id = p_booking_id and status = 'WAITING' and club_id <> b.owner_club_id
   order by created_at, id
   limit 1
   for update;
  if not found then
    return null;
  end if;

  update waitlist_entries
     set status = 'OFFERED', offered_at = now(), offer_expires_at = now() + make_interval(mins => v_mins)
   where id = e.id;

  select name into v_fac from facilities where id = b.facility_id;
  perform notify_club_directors(
    e.club_id, 'WAITLIST_OFFER', 'Waitlist offer: ' || v_fac,
    format('You are #1 on the waitlist for %s on %s. You have %s minutes to claim it.',
           v_fac, fmt_slot(b.booking_date, b.start_time, b.end_time), v_mins),
    b.id, null, e.id, '/facilities/waitlist?booking=' || b.id, true);
  return e.id;
end $$;

-- Expire stale offers for one booking (lock held by caller) and promote the next club.
create or replace function expire_offers_for_booking(p_booking_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  e     waitlist_entries%rowtype;
  b     facility_bookings%rowtype;
  v_fac text;
begin
  for e in
    update waitlist_entries set status = 'EXPIRED', left_at = now()
     where booking_id = p_booking_id and status = 'OFFERED' and offer_expires_at <= now()
    returning *
  loop
    select * into b from facility_bookings where id = e.booking_id;
    select name into v_fac from facilities where id = b.facility_id;
    perform notify_club_directors(
      e.club_id, 'WAITLIST_EXPIRED', 'Waitlist offer expired: ' || v_fac,
      format('Your hold on %s (%s) expired and the slot moved to the next club.',
             v_fac, fmt_slot(b.booking_date, b.start_time, b.end_time)),
      b.id, null, e.id, '/facilities/waitlist', false);
  end loop;
  perform offer_next_waitlist(p_booking_id);
end $$;

-- Scheduled job (pg_cron, every minute). Works with no browser open.
create or replace function process_expired_waitlist_offers() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_booking bigint;
  v_count   int := 0;
  e         waitlist_entries%rowtype;
  b         facility_bookings%rowtype;
  v_fac     text;
begin
  for v_booking in
    select distinct booking_id from waitlist_entries
     where status = 'OFFERED' and offer_expires_at <= now()
  loop
    perform 1 from facility_bookings where id = v_booking for update;
    perform expire_offers_for_booking(v_booking);
    v_count := v_count + 1;
  end loop;

  -- One reminder per offer when it is close to expiring.
  for e in
    update waitlist_entries set reminder_sent_at = now()
     where status = 'OFFERED' and reminder_sent_at is null
       and offer_expires_at > now()
       and offer_expires_at <= now() + make_interval(mins => coalesce(cfg_int('offer_reminder_minutes'), 10))
    returning *
  loop
    select * into b from facility_bookings where id = e.booking_id;
    select name into v_fac from facilities where id = b.facility_id;
    perform notify_club_directors(
      e.club_id, 'WAITLIST_REMINDER', 'Offer ending soon: ' || v_fac,
      format('Your hold on %s (%s) ends at %s.', v_fac,
             fmt_slot(b.booking_date, b.start_time, b.end_time),
             to_char(e.offer_expires_at at time zone 'Asia/Singapore', 'HH24:MI')),
      b.id, null, e.id, '/facilities/waitlist?booking=' || b.id, true);
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 5. Optional: turn club_training_patterns into dated bookings.
-- Not run automatically. day_of_week is read as ISO (1 = Mon … 7 = Sun);
-- 0 is treated as Sunday. Rows without a facility or times are skipped.
-- ---------------------------------------------------------------------
create or replace function generate_bookings_from_patterns(p_from date default null, p_until date default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_from  date := coalesce(p_from, sg_today());
  v_until date := least(coalesce(p_until, cfg_text('calendar_end_date')::date), cfg_text('calendar_end_date')::date);
  v_count int;
begin
  insert into facility_bookings (facility_id, booking_date, start_time, end_time, owner_club_id, original_club_id,
                                 fbs_reference, booking_source, status)
  select p.facility_id, d::date, p.start_time, p.end_time, p.club_id, p.club_id,
         'PATTERN-' || to_char(d, 'YYYYMMDD') || '-' || lpad(p.id::text, 4, '0'),
         'PATTERN', 'Booked'
    from club_training_patterns p
   cross join lateral generate_series(greatest(coalesce(p.valid_from, v_from), v_from),
                                      least(coalesce(p.valid_to, v_until), v_until), interval '1 day') d
   where p.facility_id is not null and p.start_time is not null and p.end_time is not null
     and extract(isodow from d) = case when p.day_of_week = 0 then 7 else p.day_of_week end
     and not exists (select 1 from facility_bookings x
                      where x.facility_id = p.facility_id and x.booking_date = d::date
                        and x.start_time < p.end_time and x.end_time > p.start_time);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 6. Email composition (uses the stored fbs_reference)
-- ---------------------------------------------------------------------
create or replace function compose_transfer_email(p_transfer_id bigint, p_type text, p_signatory bigint)
returns table (subject text, body text, action_url text)
language plpgsql stable security definer set search_path = public as $$
declare
  t  facility_transfers%rowtype;
  b  facility_bookings%rowtype;
  v_fac text; v_loc text; v_rel text; v_cla text; v_sig text; v_link text; v_details text; v_slip text;
begin
  select * into t from facility_transfers where id = p_transfer_id;
  select * into b from facility_bookings where id = t.booking_id;
  select name, location into v_fac, v_loc from facilities where id = b.facility_id;
  select name into v_rel from clubs where id = t.releasing_club_id;
  select name into v_cla from clubs where id = t.claiming_club_id;
  select full_name into v_sig from members where id = p_signatory;
  v_link := cfg_text('pulse_base_url') || '/facilities/admin?transfer=' || t.id;
  v_slip := case when b.booking_slip_url is not null then E'\nFBS booking slip: ' || b.booking_slip_url else '' end;

  v_details := format(E'  FBS Reference: %s\n  Facility: %s (%s)\n  Date: %s\n  Time: %s – %s\n  Releasing CCA: %s\n  Claiming CCA: %s',
    b.fbs_reference, v_fac, v_loc, to_char(b.booking_date, 'FMDay, FMDD FMMonth YYYY'),
    to_char(b.start_time, 'HH24:MI'), to_char(b.end_time, 'HH24:MI'), v_rel, v_cla);

  if p_type = 'OSL_REQUEST' then
    subject := format('Facility booking transfer approval request: %s, %s (%s to %s)',
                      v_fac, to_char(b.booking_date, 'DD Mon YYYY'), v_rel, v_cla);
    body := format(E'Dear Office of Student Life,\n\n'
      'I am writing on behalf of %s to request approval for the transfer of our existing facility booking to %s.\n\n'
      'The booking details are as follows:\n\n%s\n\n'
      'The booking was released through Pulse and subsequently claimed by %s. Both CCAs are awaiting formal administrative approval before the transfer is considered confirmed.\n\n'
      'Please find the original FBS booking confirmation attached for verification.%s\n\n'
      'Kindly review and advise whether the transfer may proceed.\n\n'
      'Pulse review link: %s\n\n'
      'Thank you for your assistance.\n\n'
      'Best regards,\n%s\nLogistics Director\n%s',
      v_rel, v_cla, v_details, v_cla, v_slip, v_link, coalesce(v_sig, 'Logistics Director'), v_rel);
    action_url := v_link;
  else
    subject := format('Facility booking transfer approved: %s, %s (%s to %s)',
                      v_fac, to_char(b.booking_date, 'DD Mon YYYY'), v_rel, v_cla);
    body := format(E'Dear %s, %s, ACF Operations and Arts Venues Teams,\n\n'
      'This email confirms that the facility booking transfer submitted through Pulse has been approved by the Office of Student Life.\n\n'
      'The confirmed booking details are as follows:\n\n%s\n\n'
      '%s is now the confirmed holder of this booking under the approved transfer arrangement.\n\n'
      'The relevant CCA representatives and venue coordinators are copied for their records and any necessary operational coordination.\n\n'
      'Please retain the original FBS booking confirmation and this approval notification for reference. Any required updates to the official FBS record should be completed through the appropriate SMU process.\n\n'
      'Thank you.\n\n'
      'Best regards,\nPulse Facility Coordination\nOn behalf of the authorized OSL approval\nSingapore Management University\n\n'
      'Automated notification generated following OSL approval.',
      v_cla, v_rel, v_details, v_cla);
    action_url := cfg_text('pulse_base_url') || '/facilities/my-club';
  end if;
  return next;
end $$;

-- =====================================================================
-- 7. Read views
-- Each view starts with the columns your project already had, in the
-- same order, then adds the extra ones. If an existing view can't be
-- replaced in place, it is dropped and recreated.
-- Views run with the owner's rights; the OSL-only ones are not granted
-- to browser roles and are read through role-checked RPCs instead.
-- =====================================================================
create or replace function pulse_install_view(p_name text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute format('create or replace view %I as %s', p_name, p_sql);
  exception when invalid_table_definition or datatype_mismatch or wrong_object_type or feature_not_supported then
    raise notice 'Pulse: recreating view % (%)', p_name, sqlerrm;
    execute format('drop view if exists %I', p_name);
    execute format('create view %I as %s', p_name, p_sql);
  end;
end $$;

-- The RPCs that return these views' row types are recreated below.
drop function if exists rpc_osl_pending_transfers(bigint);
drop function if exists rpc_transfer_audit_history(bigint, bigint);

select pulse_install_view('v_master_facility_calendar', $v$
select
  -- columns already in the project
  b.id                                    as booking_id,
  f.id                                    as facility_id,
  f.name                                  as facility_name,
  f.facility_type,
  f.location,
  b.booking_date,
  b.start_time,
  b.end_time,
  b.owner_club_id,
  oc.name                                 as owner_club,
  oc.official_email                       as owner_email,
  t.claiming_club_id,
  cc.name                                 as claiming_club,
  cc.official_email                       as claiming_email,
  b.fbs_reference,
  b.status,
  t.id                                    as transfer_id,
  null::text                              as audit_voucher_id,   -- OSL-only: read it through rpc_osl_pending_transfers
  t.email_status,
  t.released_at,
  t.claimed_at,
  -- added for the Vue app
  to_char(b.start_time, 'HH24:MI') || ' – ' || to_char(b.end_time, 'HH24:MI') as time_label,
  extract(isodow from b.booking_date)::int as weekday,
  case b.status
    when 'Proposed Peer Transfer' then 0
    when 'Pending Admin Sign-off' then 1
    when 'Booked'                 then 2
    else 3 end                            as status_rank,
  (b.booking_source = 'PULSE_DEMO' or b.fbs_reference like 'DEMO-%') as is_demo_reference,
  b.booking_source,
  b.booking_slip_url,
  f.capacity,
  f.capacity_is_estimate,
  f.equipment,
  null::text                              as photo_url,
  null::text                              as photo_note,
  oc.name                                 as owner_club_name,
  b.original_club_id,
  rc.name                                 as original_club_name,
  transfer_state_code(t.transfer_status)  as transfer_state,
  t.releasing_club_id,
  relc.name                               as releasing_club_name,
  cc.name                                 as claiming_club_name,
  coalesce(w.waitlist_count, 0)           as waitlist_count,
  o.club_id                               as offered_club_id,
  ofc.name                                as offered_club_name,
  o.offer_expires_at,
  (b.booking_date >= transfer_cutoff_date()
     and b.booking_date <= cfg_text('calendar_end_date')::date) as is_transfer_window_open
from facility_bookings b
join facilities f        on f.id  = b.facility_id
join clubs oc            on oc.id = b.owner_club_id
left join clubs rc       on rc.id = coalesce(b.original_club_id, b.owner_club_id)
left join lateral (
  select * from facility_transfers ft
   where ft.booking_id = b.id and ft.transfer_status = b.status
   order by ft.id desc limit 1
) t on true
left join clubs relc     on relc.id = t.releasing_club_id
left join clubs cc       on cc.id   = t.claiming_club_id
left join lateral (
  select count(*)::int as waitlist_count from waitlist_entries we
   where we.booking_id = b.id and we.status in ('WAITING','OFFERED')
) w on true
left join waitlist_entries o on o.booking_id = b.id and o.status = 'OFFERED' and o.offer_expires_at > now()
left join clubs ofc      on ofc.id = o.club_id
where f.is_active
$v$);

select pulse_install_view('v_waitlist_queue', $v$
select
  we.id               as waitlist_id,
  we.booking_id,
  we.club_id,
  c.name              as club_name,
  c.official_email,
  we.created_at       as joined_at,
  we.status,
  we.offered_at,
  we.offer_expires_at,
  we.claimed_at,
  we.left_at,
  case when we.status in ('WAITING','OFFERED') then
    row_number() over (partition by we.booking_id, (we.status in ('WAITING','OFFERED'))
                       order by we.created_at, we.id)
  end                 as queue_position,
  -- added for the Vue app
  we.id               as entry_id,
  b.booking_date,
  b.start_time,
  b.end_time,
  b.status            as booking_status,
  b.fbs_reference,
  f.name              as facility_name,
  f.location,
  b.owner_club_id,
  oc.name             as owner_club_name
from waitlist_entries we
join clubs c              on c.id = we.club_id
join facility_bookings b  on b.id = we.booking_id
join facilities f         on f.id = b.facility_id
join clubs oc             on oc.id = b.owner_club_id
$v$);

-- Members with no membership still appear (club columns null), so OSL
-- admins and public viewers can be chosen as personas.
select pulse_install_view('v_user_club_memberships', $v$
select
  m.auth_user_id     as user_id,
  m.id               as member_id,
  m.full_name,
  m.student_email,
  m.telegram_handle,
  cm.id              as membership_id,
  cm.academic_year,
  cm.is_active       as membership_is_active,
  cm.club_id,
  c.name             as club_name,
  c.short_name,
  c.official_email   as club_email,
  cm.role_id,
  r.role_code,
  r.role_name,
  coalesce(r.can_release_booking, false)     as can_release_booking,
  coalesce(r.can_claim_booking, false)       as can_claim_booking,
  coalesce(r.can_manage_waitlist, false)     as can_manage_waitlist,
  coalesce(r.can_send_transfer_email, false) as can_send_transfer_email,
  coalesce(r.can_manage_members, false)      as can_manage_members,
  coalesce(r.is_admin_role, false)           as is_admin_role,
  -- added for the Vue app
  coalesce(r.is_admin_role, false)           as is_osl_admin,
  m.auth_user_id     as auth_user_id,
  (coalesce(r.can_release_booking, false) or coalesce(r.can_claim_booking, false)) as can_manage_facilities,
  cm.is_active
from members m
left join club_memberships cm on cm.member_id = m.id and cm.is_active
left join clubs c             on c.id = cm.club_id
left join exco_roles r        on r.id = cm.role_id
where coalesce(m.is_active, true)
$v$);

-- Demo personas: members not yet linked to a real login.
select pulse_install_view('v_demo_personas', $v$
select
  member_id, full_name, club_id, club_name, role_code, role_name, is_osl_admin, membership_is_active,
  can_release_booking, can_claim_booking, can_manage_waitlist, can_send_transfer_email,
  -- added for the Vue app
  user_id, is_admin_role, can_manage_facilities, can_manage_members, membership_id, short_name
from v_user_club_memberships
where coalesce(membership_is_active, true)
  and case
        -- Only the core personas (the team login cards) when app_config lists them.
        when jsonb_array_length(coalesce((select value from app_config where key = 'demo_persona_emails'), '[]'::jsonb)) > 0
        then member_id in (select m.id from members m
                            where lower(m.student_email) in (select lower(e) from jsonb_array_elements_text(
                                    (select value from app_config where key = 'demo_persona_emails')) e))
        else user_id is null
      end
$v$);

-- OSL-only views
select pulse_install_view('v_osl_pending_transfers', $v$
select
  b.id                 as booking_id,
  f.id                 as facility_id,
  f.name               as facility_name,
  f.facility_type,
  f.location,
  b.booking_date,
  b.start_time,
  b.end_time,
  b.owner_club_id,
  oc.name              as owner_club,
  oc.official_email    as owner_email,
  t.claiming_club_id,
  cc.name              as claiming_club,
  cc.official_email    as claiming_email,
  b.fbs_reference,
  b.status,
  t.id                 as transfer_id,
  t.audit_voucher_id,
  t.email_status,
  t.released_at,
  t.claimed_at,
  (select count(*) from transfer_audit_log l where l.transfer_id = t.id) as audit_event_count,
  -- added for the Vue app
  transfer_state_code(t.transfer_status) as state,
  (b.booking_source = 'PULSE_DEMO' or b.fbs_reference like 'DEMO-%') as is_demo_reference,
  b.booking_slip_url,
  b.status             as booking_status,
  t.releasing_club_id,
  rc.name              as releasing_club_name,
  rm.full_name         as released_by_name,
  cc.name              as claiming_club_name,
  cm.full_name         as claimed_by_name,
  e.status             as osl_email_status,
  e.queued_at          as osl_email_queued_at,
  osl_signoff_deadline(b.booking_date, b.start_time) as signoff_deadline,
  round(extract(epoch from osl_signoff_deadline(b.booking_date, b.start_time) - now()) / 3600.0, 1) as hours_to_deadline
from facility_transfers t
join facility_bookings b on b.id = t.booking_id
join facilities f        on f.id = b.facility_id
join clubs oc            on oc.id = b.owner_club_id
join clubs rc            on rc.id = t.releasing_club_id
left join members rm     on rm.id = t.released_by_member_id
left join clubs cc       on cc.id = t.claiming_club_id
left join members cm     on cm.id = t.claimed_by_member_id
left join transfer_emails e on e.transfer_id = t.id and e.email_type = 'OSL_REQUEST'
where t.transfer_status = 'Pending Admin Sign-off'
$v$);

select pulse_install_view('v_transfer_audit_history', $v$
select
  l.id            as audit_event_id,
  l.transfer_id,
  l.booking_id,
  t.audit_voucher_id,
  b.fbs_reference,
  l.event_type,
  c.name          as actor_club,
  l.actor_user_id,
  l.details,
  l.created_at,
  -- added for the Vue app
  l.event_type    as action,
  m.full_name     as actor_name,
  c.name          as actor_club_name,
  l.actor_member_id
from transfer_audit_log l
join facility_bookings b       on b.id = l.booking_id
left join facility_transfers t on t.id = l.transfer_id
left join members m            on m.id = l.actor_member_id
left join clubs c              on c.id = l.actor_club_id
$v$);

select pulse_install_view('v_pending_transfer_emails', $v$
select
  e.id            as email_id,
  e.email_type,
  e.transfer_id,
  e.booking_id,
  e.from_email,
  e.to_emails,
  e.cc_emails,
  e.subject,
  e.body,
  e.action_url,
  e.status,
  e.created_at,
  b.fbs_reference,
  t.audit_voucher_id,
  rc.name         as releasing_club,
  cc.name         as claiming_club,
  -- added
  e.reply_to,
  e.attempts,
  e.queued_at,
  e.last_error
from transfer_emails e
join facility_transfers t on t.id = e.transfer_id
join facility_bookings b  on b.id = e.booking_id
join clubs rc             on rc.id = t.releasing_club_id
left join clubs cc        on cc.id = t.claiming_club_id
where e.status in ('DRAFT','QUEUED','SENDING','FAILED')
$v$);

-- =====================================================================
-- 8. RPCs called by Vue. Each runs in one transaction; any exception
-- rolls the whole action back.
-- =====================================================================

-- Release ------------------------------------------------------------
create or replace function rpc_release_booking(p_booking_id bigint, p_club_id bigint, p_demo_member_id bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member bigint := require_club_permission(p_club_id, 'release', p_demo_member_id);
  b        facility_bookings%rowtype;
  v_tid    bigint;
  v_offer  bigint;
begin
  select * into b from facility_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.owner_club_id <> p_club_id then raise exception 'Only the CCA that holds this booking can release it'; end if;
  if b.status not in ('Booked','Officially Confirmed Booking') then
    raise exception 'Only Booked slots can be released (this one is %)', b.status;
  end if;
  perform assert_transfer_window(b.booking_date);

  insert into facility_transfers (booking_id, releasing_club_id, released_by_member_id, transfer_status, released_at, email_status)
  values (b.id, p_club_id, v_member, 'Proposed Peer Transfer', now(), 'NOT_REQUIRED')
  returning id into v_tid;

  update facility_bookings set status = 'Proposed Peer Transfer', updated_at = now() where id = b.id;
  perform log_transfer_event(v_tid, b.id, 'RELEASED', v_member, p_club_id, jsonb_build_object('fbs_reference', b.fbs_reference));

  -- Only the waitlisted club hears about it; other clubs see the slot on the calendar.
  v_offer := offer_next_waitlist(b.id);

  return jsonb_build_object('booking_id', b.id, 'transfer_id', v_tid, 'status', 'Proposed Peer Transfer',
                            'waitlist_offer_entry_id', v_offer);
end $$;

-- Undo release -------------------------------------------------------
create or replace function rpc_undo_release(p_booking_id bigint, p_club_id bigint, p_demo_member_id bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member bigint := require_club_permission(p_club_id, 'release', p_demo_member_id);
  b        facility_bookings%rowtype;
  t        facility_transfers%rowtype;
  v_offer  record;
  v_fac    text;
  v_prev   text;
  r        record;
begin
  select * into b from facility_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.owner_club_id <> p_club_id then raise exception 'Only the releasing CCA can undo this release'; end if;
  if b.status <> 'Proposed Peer Transfer' then raise exception 'Undo is only possible while the slot is a Proposed Peer Transfer'; end if;

  perform expire_offers_for_booking(b.id);
  select we.*, c.name as club_name into v_offer
    from waitlist_entries we join clubs c on c.id = we.club_id
   where we.booking_id = b.id and we.status = 'OFFERED' and we.offer_expires_at > now();
  if found then
    raise exception '% currently holds a waitlist offer until %; undo is blocked until it is answered or expires',
      v_offer.club_name, to_char(v_offer.offer_expires_at at time zone 'Asia/Singapore', 'HH24:MI');
  end if;

  select * into t from facility_transfers where booking_id = b.id and transfer_status = 'Proposed Peer Transfer' for update;
  update facility_transfers
     set transfer_status = 'Cancelled', reviewed_at = now(),
         reviewed_by = member_auth_uid(v_member), reviewed_by_member_id = v_member
   where id = t.id;

  -- Back to what it was before the release (a booking that came to us
  -- through an approved transfer stays Officially Confirmed).
  v_prev := case when exists (select 1 from facility_transfers x
                               where x.booking_id = b.id and x.transfer_status = 'Officially Confirmed Booking'
                                 and x.claiming_club_id = p_club_id)
                 then 'Officially Confirmed Booking' else 'Booked' end;
  update facility_bookings set status = v_prev, updated_at = now() where id = b.id;
  perform log_transfer_event(t.id, b.id, 'RELEASE_UNDONE', v_member, p_club_id);

  select name into v_fac from facilities where id = b.facility_id;
  for r in select distinct club_id from waitlist_entries where booking_id = b.id and status = 'WAITING' loop
    perform notify_club_directors(r.club_id, 'RELEASE_UNDONE', 'Release withdrawn: ' || v_fac,
      format('The release of %s (%s) was withdrawn. You remain on the waitlist.', v_fac, fmt_slot(b.booking_date, b.start_time, b.end_time)),
      b.id, t.id, null, '/facilities/waitlist', false);
  end loop;

  return jsonb_build_object('booking_id', b.id, 'status', v_prev);
end $$;

-- Claim (also how a waitlisted club accepts its offer) ----------------
create or replace function rpc_claim_booking(p_booking_id bigint, p_club_id bigint, p_demo_member_id bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member  bigint := require_club_permission(p_club_id, 'claim', p_demo_member_id);
  b         facility_bookings%rowtype;
  t         facility_transfers%rowtype;
  v_offer   record;
  v_voucher text;
  v_fac     text;
  v_club    text;
begin
  -- Row lock: a second simultaneous claim waits here, then sees the new status.
  select * into b from facility_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.owner_club_id = p_club_id then raise exception 'A CCA cannot claim its own booking'; end if;

  perform expire_offers_for_booking(b.id);

  if b.status <> 'Proposed Peer Transfer' then
    raise exception 'This slot is no longer available to claim (status: %)', b.status;
  end if;
  perform assert_transfer_window(b.booking_date);

  select we.*, c.name as club_name into v_offer
    from waitlist_entries we join clubs c on c.id = we.club_id
   where we.booking_id = b.id and we.status = 'OFFERED' and we.offer_expires_at > now();
  if found and v_offer.club_id <> p_club_id then
    raise exception 'This slot is held for % (waitlist #1) until %',
      v_offer.club_name, to_char(v_offer.offer_expires_at at time zone 'Asia/Singapore', 'HH24:MI');
  end if;

  select * into t from facility_transfers where booking_id = b.id and transfer_status = 'Proposed Peer Transfer' for update;
  if not found then raise exception 'No open release found for this booking'; end if;

  v_voucher := '#SMU-' || to_char(sg_today(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  update facility_transfers
     set transfer_status = 'Pending Admin Sign-off', claiming_club_id = p_club_id, claimed_by_member_id = v_member,
         claimed_at = now(), audit_voucher_id = v_voucher, email_status = 'NOT_SENT'
   where id = t.id;
  update facility_bookings set status = 'Pending Admin Sign-off', updated_at = now() where id = b.id;
  update waitlist_entries set status = 'CLAIMED', claimed_at = now()
   where booking_id = b.id and club_id = p_club_id and status in ('WAITING','OFFERED');

  perform log_transfer_event(t.id, b.id, 'CLAIMED', v_member, p_club_id,
    jsonb_build_object('audit_voucher_id', v_voucher, 'via_waitlist_offer', v_offer.club_id is not null));

  select name into v_fac  from facilities where id = b.facility_id;
  select name into v_club from clubs where id = p_club_id;

  -- The formal request goes to OSL straight away, signed by the releasing Logistics Director.
  perform queue_osl_request_email(t.id, coalesce(t.released_by_member_id, v_member));
  perform log_transfer_event(t.id, b.id, 'OSL_EMAIL_REQUESTED', null, t.releasing_club_id,
    jsonb_build_object('automatic', true));

  -- The releasing CCA is told, and OSL gets a bell alert alongside the email.
  perform notify_club_directors(t.releasing_club_id, 'SLOT_CLAIMED', 'Claimed: ' || v_fac,
    format('%s claimed %s (%s). The transfer request has been emailed to OSL for approval.',
           v_club, v_fac, fmt_slot(b.booking_date, b.start_time, b.end_time)),
    b.id, t.id, null, '/facilities/my-club', false);
  perform notify_osl_admins('TRANSFER_PENDING', 'Transfer awaiting approval: ' || v_fac,
    format('%s → %s: %s, %s (FBS %s). Approve or reject it in OSL Review.',
           (select name from clubs where id = t.releasing_club_id), v_club,
           v_fac, fmt_slot(b.booking_date, b.start_time, b.end_time), b.fbs_reference),
    b.id, t.id);

  -- The voucher is OSL-only, so it is not returned to the claimant.
  return jsonb_build_object('booking_id', b.id, 'transfer_id', t.id, 'status', 'Pending Admin Sign-off');
end $$;

-- Waitlist -------------------------------------------------------------
create or replace function rpc_join_waitlist(p_booking_id bigint, p_club_id bigint, p_demo_member_id bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member bigint := require_club_permission(p_club_id, 'waitlist', p_demo_member_id);
  b        facility_bookings%rowtype;
  v_id     bigint;
  v_pos    bigint;
begin
  select * into b from facility_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.owner_club_id = p_club_id then raise exception 'You already hold this booking'; end if;
  perform assert_transfer_window(b.booking_date);

  perform expire_offers_for_booking(b.id);
  if b.status = 'Proposed Peer Transfer'
     and not exists (select 1 from waitlist_entries where booking_id = b.id and status = 'OFFERED') then
    raise exception 'This slot is open right now — claim it directly instead of joining the waitlist';
  end if;
  if exists (select 1 from waitlist_entries where booking_id = b.id and club_id = p_club_id and status in ('WAITING','OFFERED')) then
    raise exception 'Your CCA is already on this waitlist';
  end if;

  insert into waitlist_entries (booking_id, club_id, joined_by_member_id, status, created_at)
  values (b.id, p_club_id, v_member, 'WAITING', clock_timestamp())
  returning id into v_id;

  select queue_position into v_pos from v_waitlist_queue where waitlist_id = v_id;
  return jsonb_build_object('entry_id', v_id, 'waitlist_id', v_id, 'queue_position', v_pos);
end $$;

-- Called by the Waitlist page: our CCA leaves the queue (or declines its offer)
create or replace function rpc_leave_waitlist(p_booking_id bigint, p_club_id bigint, p_demo_member_id bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member bigint := require_club_permission(p_club_id, 'waitlist', p_demo_member_id);
  e        waitlist_entries%rowtype;
  v_status text;
begin
  perform 1 from facility_bookings where id = p_booking_id for update;
  select * into e from waitlist_entries
   where booking_id = p_booking_id and club_id = p_club_id and status in ('WAITING','OFFERED') for update;
  if not found then raise exception 'Your CCA is not on this waitlist'; end if;

  -- Leaving while holding the offer counts as declining it; the next club is promoted.
  v_status := case when e.status = 'OFFERED' then 'DECLINED' else 'LEFT' end;
  update waitlist_entries set status = v_status, left_at = now() where id = e.id;
  if e.status = 'OFFERED' then
    perform offer_next_waitlist(p_booking_id);
  end if;
  return jsonb_build_object('entry_id', e.id, 'status', v_status);
end $$;

-- Formal OSL request email. Queued automatically when a club claims;
-- the RPC below is only a manual resend if delivery failed. ----------
create or replace function queue_osl_request_email(p_transfer_id bigint, p_signatory bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t        facility_transfers%rowtype;
  e        transfer_emails%rowtype;
  c        record;
  v_to     text[];
  v_reply  text := (select student_email from members where id = p_signatory);
begin
  select * into t from facility_transfers where id = p_transfer_id;
  select * into e from transfer_emails where transfer_id = t.id and email_type = 'OSL_REQUEST' for update;
  if found and e.status in ('QUEUED','SENDING','SENT') then
    return;
  end if;

  select * into c from compose_transfer_email(t.id, 'OSL_REQUEST', p_signatory);
  select coalesce(to_emails, '{}') into v_to from transfer_email_config limit 1;

  if e.id is null then
    insert into transfer_emails (transfer_id, booking_id, email_type, sender_user_id, sender_club_id, requested_by_member_id,
                                 from_email, to_emails, cc_emails, reply_to, subject, body, action_url, status, queued_at)
    values (t.id, t.booking_id, 'OSL_REQUEST', member_auth_uid(p_signatory), t.releasing_club_id, p_signatory,
            coalesce(v_reply, cfg_text('email_from'), 'pulse-notifications@example.org'),
            coalesce(v_to, '{}'), '{}', v_reply, c.subject, c.body, c.action_url, 'QUEUED', now());
  else
    update transfer_emails
       set to_emails = coalesce(v_to, '{}'), reply_to = v_reply,
           subject = c.subject, body = c.body, action_url = c.action_url, status = 'QUEUED',
           requested_by_member_id = p_signatory, sender_user_id = member_auth_uid(p_signatory), queued_at = now(), last_error = null
     where id = e.id;
  end if;
  update facility_transfers set email_status = 'QUEUED' where id = t.id;
end $$;

-- Called by My Club: resend the transfer request email to OSL if it failed
create or replace function rpc_request_osl_email(p_transfer_id bigint, p_club_id bigint, p_demo_member_id bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member bigint := require_club_permission(p_club_id, 'email', p_demo_member_id);
  t        facility_transfers%rowtype;
begin
  select * into t from facility_transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if t.releasing_club_id <> p_club_id then raise exception 'Only the releasing CCA sends the OSL request'; end if;
  if t.transfer_status <> 'Pending Admin Sign-off' then
    raise exception 'The OSL request can only be sent while the transfer is Pending Admin Sign-off';
  end if;
  if exists (select 1 from transfer_emails where transfer_id = t.id and email_type = 'OSL_REQUEST'
              and status in ('QUEUED','SENDING','SENT')) then
    raise exception 'The OSL request for this transfer was already sent';
  end if;

  perform queue_osl_request_email(t.id, v_member);
  perform log_transfer_event(t.id, t.booking_id, 'OSL_EMAIL_REQUESTED', v_member, p_club_id);
  return jsonb_build_object('transfer_id', t.id, 'email_status', 'QUEUED');
end $$;

-- OSL decisions ----------------------------------------------------------
create or replace function rpc_approve_transfer(p_transfer_id bigint, p_demo_member_id bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin  bigint := require_osl_admin(p_demo_member_id);
  t        facility_transfers%rowtype;
  b        facility_bookings%rowtype;
  c        record;
  v_fac    text;
  v_rel    clubs%rowtype;
  v_cla    clubs%rowtype;
  v_sig    bigint;
  v_cc     text[];
begin
  select * into t from facility_transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  select * into b from facility_bookings where id = t.booking_id for update;
  if t.transfer_status <> 'Pending Admin Sign-off' or b.status <> 'Pending Admin Sign-off' then
    raise exception 'Only transfers that are Pending Admin Sign-off can be approved';
  end if;
  if now() > osl_signoff_deadline(b.booking_date, b.start_time) and current_setting('pulse.seeding', true) is distinct from 'on' then
    raise exception 'The sign-off deadline passed at % (SSU Clause 9.1(c) needs approval 48 hours before the booking). The slot stays with the releasing CCA.',
      to_char(osl_signoff_deadline(b.booking_date, b.start_time) at time zone 'Asia/Singapore', 'DD Mon HH24:MI');
  end if;

  update facility_bookings
     set owner_club_id = t.claiming_club_id, status = 'Officially Confirmed Booking', updated_at = now()
   where id = b.id;
  update facility_transfers
     set transfer_status = 'Officially Confirmed Booking', reviewed_at = now(),
         reviewed_by = member_auth_uid(v_admin), reviewed_by_member_id = v_admin, email_status = 'CONFIRMATION_QUEUED'
   where id = t.id;
  perform log_transfer_event(t.id, b.id, 'APPROVED', v_admin, null, jsonb_build_object('fbs_reference', b.fbs_reference));

  select name into v_fac from facilities where id = b.facility_id;
  select * into v_rel from clubs where id = t.releasing_club_id;
  select * into v_cla from clubs where id = t.claiming_club_id;

  -- Claiming CCA: all members (LD only for waitlist claims). Releasing CCA: its LD only.
  perform notify_claim_result(t.id, 'TRANSFER_APPROVED', 'Approved: ' || v_fac,
    format('OSL approved your transfer for %s (%s). It is now an Officially Confirmed Booking.', v_fac, fmt_slot(b.booking_date, b.start_time, b.end_time)),
    b.id);
  perform notify_club_directors(v_rel.id, 'TRANSFER_APPROVED', 'Handover approved: ' || v_fac,
    format('OSL approved the handover of %s (%s) to %s.', v_fac, fmt_slot(b.booking_date, b.start_time, b.end_time), v_cla.name),
    b.id, t.id, null, '/facilities/my-club', true);

  -- Confirmation email to the claiming CCA, CC releasing CCA + Arts Venues/ACF list.
  v_sig := coalesce((select requested_by_member_id from transfer_emails where transfer_id = t.id and email_type = 'OSL_REQUEST'),
                    t.released_by_member_id);
  select * into c from compose_transfer_email(t.id, 'TRANSFER_CONFIRMED', v_sig);
  v_cc := array_remove(array[v_rel.official_email], null)
          || coalesce((select cc_emails from transfer_email_config limit 1), '{}');
  if not exists (select 1 from transfer_emails where transfer_id = t.id and email_type = 'TRANSFER_CONFIRMED') then
    insert into transfer_emails (transfer_id, booking_id, email_type, sender_user_id, sender_club_id, requested_by_member_id,
                                 from_email, to_emails, cc_emails, reply_to, subject, body, action_url, status, queued_at)
    values (t.id, b.id, 'TRANSFER_CONFIRMED', member_auth_uid(v_admin), t.releasing_club_id, v_admin,
            coalesce(cfg_text('email_from'), 'pulse-notifications@example.org'),
            array_remove(array[v_cla.official_email], null), v_cc,
            (select student_email from members where id = v_sig), c.subject, c.body, c.action_url, 'QUEUED', now());
  end if;

  return jsonb_build_object('transfer_id', t.id, 'booking_id', b.id, 'status', 'Officially Confirmed Booking');
end $$;

-- Called by OSL: reject a claim; the slot goes back on offer
create or replace function rpc_reject_transfer(p_transfer_id bigint, p_reason text, p_demo_member_id bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin  bigint := require_osl_admin(p_demo_member_id);
  t        facility_transfers%rowtype;
  b        facility_bookings%rowtype;
  v_new    bigint;
  v_fac    text;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Please give a reason for the rejection'; end if;

  select * into t from facility_transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  select * into b from facility_bookings where id = t.booking_id for update;
  if t.transfer_status <> 'Pending Admin Sign-off' then
    raise exception 'Only transfers that are Pending Admin Sign-off can be rejected';
  end if;

  update facility_transfers
     set transfer_status = 'Rejected', reviewed_at = now(), reviewed_by = member_auth_uid(v_admin),
         reviewed_by_member_id = v_admin, rejection_reason = btrim(p_reason)
   where id = t.id;
  perform log_transfer_event(t.id, b.id, 'REJECTED', v_admin, null, jsonb_build_object('reason', btrim(p_reason)));

  -- The slot goes back on offer as a new transfer attempt.
  insert into facility_transfers (booking_id, releasing_club_id, released_by_member_id, transfer_status, released_at, email_status)
  values (b.id, t.releasing_club_id, t.released_by_member_id, 'Proposed Peer Transfer', now(), 'NOT_REQUIRED')
  returning id into v_new;
  update facility_bookings set status = 'Proposed Peer Transfer', updated_at = now() where id = b.id;
  perform log_transfer_event(v_new, b.id, 'RELISTED_AFTER_REJECTION', v_admin, null, jsonb_build_object('rejected_transfer_id', t.id));

  select name into v_fac from facilities where id = b.facility_id;
  -- Claiming CCA gets the reason; the releasing CCA's LD is told without it.
  perform notify_claim_result(t.id, 'TRANSFER_REJECTED', 'Not approved: ' || v_fac,
    format('OSL did not approve your claim for %s (%s). Reason: %s', v_fac, fmt_slot(b.booking_date, b.start_time, b.end_time), btrim(p_reason)),
    b.id);
  perform notify_club_directors(t.releasing_club_id, 'TRANSFER_REJECTED', 'Claim rejected: ' || v_fac,
    format('OSL rejected the claim on %s (%s). The slot is a Proposed Peer Transfer again.', v_fac, fmt_slot(b.booking_date, b.start_time, b.end_time)),
    b.id, t.id, null, '/facilities/my-club', true);

  perform offer_next_waitlist(b.id);
  return jsonb_build_object('transfer_id', t.id, 'new_transfer_id', v_new, 'status', 'Proposed Peer Transfer');
end $$;

-- SSU Clause 9.1(c) sign-off deadlines -----------------------------------
-- Run every few minutes by pg_cron (see the schedules file):
--  * 24 hours before the deadline: email OSL a reminder and alert OSL admins in Pulse
--  * after the deadline: the transfer expires and the slot stays with the releasing CCA
create or replace function process_osl_signoff_deadlines() returns jsonb
language plpgsql security definer set search_path = public as $$
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
           rejection_reason = 'OSL sign-off deadline passed (SSU Clause 9.1(c), 48 hours before the booking)'
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
end $$;

-- Sign-in flow: Supabase Auth (email + password) -> public.members.auth_user_id
-- -> club_memberships + exco_roles (permissions) -> what Pulse shows.
-- members.auth_user_id is filled here, in the database, never by the browser:
-- each Auth user is matched once to the members row with the same email.
drop function if exists rpc_link_my_account();

-- Links each Supabase Auth login to the member with the same SMU email
create or replace function pulse_link_auth_users() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  update members m set auth_user_id = u.id
    from auth.users u
   where m.auth_user_id is null
     and lower(m.student_email) = lower(u.email)
     and not exists (select 1 from members x where x.auth_user_id = u.id);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- New Auth users (Dashboard -> Authentication -> Add user, or sign-up) are linked straight away.
-- Sign-up: link to the existing profile with that email, or create a new
-- personal profile (name + email only). No club or role is ever granted
-- here: Logistics Director or OSL access needs an approved club_memberships row.
create or replace function pulse_on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from members where auth_user_id = new.id) then
    return new;
  end if;
  update members set auth_user_id = new.id
   where id = (select id from members
                where auth_user_id is null and lower(student_email) = lower(new.email)
                order by id limit 1);
  if not found then
    insert into members (full_name, student_email, auth_user_id)
    values (coalesce(nullif(to_jsonb(new) -> 'raw_user_meta_data' ->> 'full_name', ''), split_part(new.email, '@', 1)),
            lower(new.email), new.id);
  end if;
  return new;
exception when others then
  -- Never block a sign-up or login because of Pulse; the link can be made later
  -- with select pulse_link_auth_users();
  raise warning 'Pulse could not link auth user %: %', new.email, sqlerrm;
  return new;
end $$;

drop trigger if exists pulse_link_member_on_signup on auth.users;
-- When someone signs up, link them to their member row (never grants a role)
create trigger pulse_link_member_on_signup
  after insert or update of email on auth.users
  for each row execute function pulse_on_auth_user_created();

-- OSL reads --------------------------------------------------------------
create or replace function rpc_osl_pending_transfers(p_demo_member_id bigint default null)
returns setof v_osl_pending_transfers
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_osl_admin(p_demo_member_id);
  return query select * from v_osl_pending_transfers order by claimed_at;
end $$;

-- Called by OSL: every audit log entry for one booking
create or replace function rpc_transfer_audit_history(p_booking_id bigint, p_demo_member_id bigint default null)
returns setof v_transfer_audit_history
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_osl_admin(p_demo_member_id);
  return query select * from v_transfer_audit_history where booking_id = p_booking_id order by created_at, audit_event_id;
end $$;

-- Called by OSL: the latest approved / rejected transfers
create or replace function rpc_recent_transfer_decisions(p_demo_member_id bigint default null, p_limit int default 20)
returns table (transfer_id bigint, audit_voucher_id text, state text, decided_at timestamptz, rejection_reason text,
               fbs_reference text, facility_name text, booking_date date, start_time time, end_time time,
               releasing_club_name text, claiming_club_name text, confirmation_email_status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_osl_admin(p_demo_member_id);
  return query
    select t.id, t.audit_voucher_id, transfer_state_code(t.transfer_status), t.reviewed_at, t.rejection_reason,
           b.fbs_reference, f.name, b.booking_date, b.start_time, b.end_time, rc.name, cc.name, e.status
      from facility_transfers t
      join facility_bookings b on b.id = t.booking_id
      join facilities f on f.id = b.facility_id
      join clubs rc on rc.id = t.releasing_club_id
      left join clubs cc on cc.id = t.claiming_club_id
      left join transfer_emails e on e.transfer_id = t.id and e.email_type = 'TRANSFER_CONFIRMED'
     where t.transfer_status in ('Officially Confirmed Booking','Rejected','Expired')
     order by t.reviewed_at desc nulls last
     limit p_limit;
end $$;

-- Transfer status for the CCAs involved (no voucher). Any active member
-- of the club may read it; only the Logistics Director can act.
create or replace function rpc_club_transfers(p_club_id bigint, p_demo_member_id bigint default null)
returns table (transfer_id bigint, booking_id bigint, state text, direction text, released_at timestamptz,
               claimed_at timestamptz, decided_at timestamptz, rejection_reason text,
               releasing_club_name text, claiming_club_name text, fbs_reference text, facility_name text,
               booking_date date, start_time time, end_time time, osl_email_status text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_member bigint := current_member_id(p_demo_member_id);
begin
  if v_member is null or not exists (select 1 from club_memberships where member_id = v_member and club_id = p_club_id and is_active) then
    raise exception 'You are not a member of this CCA' using errcode = '42501';
  end if;
  return query
    select t.id, t.booking_id, transfer_state_code(t.transfer_status),
           case when t.releasing_club_id = p_club_id then 'OUTGOING' else 'INCOMING' end,
           t.released_at, t.claimed_at, t.reviewed_at, t.rejection_reason,
           rc.name, cc.name, b.fbs_reference, f.name, b.booking_date, b.start_time, b.end_time, e.status
      from facility_transfers t
      join facility_bookings b on b.id = t.booking_id
      join facilities f on f.id = b.facility_id
      join clubs rc on rc.id = t.releasing_club_id
      left join clubs cc on cc.id = t.claiming_club_id
      left join transfer_emails e on e.transfer_id = t.id and e.email_type = 'OSL_REQUEST'
     where (t.releasing_club_id = p_club_id or t.claiming_club_id = p_club_id)
       and t.transfer_status in ('Pending Admin Sign-off','Officially Confirmed Booking','Rejected','Expired')
     order by b.booking_date, b.start_time;
end $$;

-- Notifications ------------------------------------------------------------
-- body/action_url are the stored columns; message/link_path are the names
-- the Vue bell uses.
create or replace function rpc_my_notifications(p_demo_member_id bigint default null, p_limit int default 30)
returns table (id bigint, type text, title text, message text, body text, booking_id bigint, transfer_id bigint,
               link_path text, action_url text, is_read boolean, created_at timestamptz, recipient_club_id bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_member bigint := current_member_id(p_demo_member_id);
begin
  if v_member is null then return; end if;
  return query
    select n.id, n.type, n.title, n.body, n.body, n.booking_id, n.transfer_id, n.action_url, n.action_url,
           n.is_read, n.created_at, n.recipient_club_id
      from notifications n
     where n.recipient_member_id = v_member
     order by n.created_at desc, n.id desc
     limit p_limit;
end $$;

-- Called by the bell: mark one notification (or all, when id is null) as read
create or replace function rpc_mark_notifications_read(p_notification_id bigint default null, p_demo_member_id bigint default null)
returns int
language plpgsql security definer set search_path = public as $$
declare v_member bigint := current_member_id(p_demo_member_id); v_n int;
begin
  if v_member is null then raise exception 'Sign in to manage notifications'; end if;
  update notifications set is_read = true
   where recipient_member_id = v_member and not is_read
     and (p_notification_id is null or id = p_notification_id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Swipe-to-delete (one id) or "Clear all" (null).
create or replace function rpc_delete_notifications(p_notification_id bigint default null, p_demo_member_id bigint default null)
returns int
language plpgsql security definer set search_path = public as $$
declare v_member bigint := current_member_id(p_demo_member_id); v_n int;
begin
  if v_member is null then raise exception 'Sign in to manage notifications'; end if;
  delete from notifications
   where recipient_member_id = v_member
     and (p_notification_id is null or id = p_notification_id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Telegram linking: the user opens t.me/<bot>?start=<code>
create or replace function rpc_create_telegram_link_code(p_demo_member_id bigint default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_member bigint := current_member_id(p_demo_member_id);
  v_code   text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 18);
begin
  if v_member is null then raise exception 'Sign in to connect Telegram'; end if;
  insert into telegram_links (member_id, link_code, code_expires_at)
  values (v_member, v_code, now() + interval '15 minutes')
  on conflict (member_id) do update set link_code = excluded.link_code, code_expires_at = excluded.code_expires_at;
  return v_code;
end $$;

-- =====================================================================
-- 9. Row Level Security + grants
-- Browser roles can READ public data; every write to this module's
-- tables goes through the RPCs above. Shared tables (members, clubs,
-- facilities) keep their existing settings; only a read policy is added
-- where RLS is already on.
-- =====================================================================
do $$
declare t text;
begin
  -- Private to the RPCs.
  foreach t in array array['app_config','telegram_links','facility_transfers','transfer_audit_log','transfer_emails','transfer_email_config']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;

  -- Readable, but written only through RPCs.
  foreach t in array array['facility_bookings','waitlist_entries','notifications']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke insert, update, delete, truncate on %I from anon, authenticated', t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'facility_bookings' and policyname = 'pulse_public_read') then
    create policy pulse_public_read on facility_bookings for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'waitlist_entries' and policyname = 'pulse_public_read') then
    create policy pulse_public_read on waitlist_entries for select using (true);
  end if;
  -- Your own notifications. In demo mode (no real login yet) the browser
  -- subscribes on behalf of a persona, so the check is relaxed.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'pulse_own_notifications') then
    create policy pulse_own_notifications on notifications for select
      using (cfg_bool('demo_mode') or recipient_user_id = auth.uid() or recipient_member_id = current_member_id(null));
  end if;

  -- Shared tables: grant read, add a read policy only if RLS is already on.
  foreach t in array array['clubs','facilities','exco_roles']
  loop
    execute format('grant select on %I to anon, authenticated', t);
    if (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass)
       and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'pulse_public_read') then
      execute format('create policy pulse_public_read on %I for select using (true)', t);
    end if;
  end loop;
end $$;

grant select on v_master_facility_calendar, v_waitlist_queue, v_user_club_memberships, v_demo_personas to anon, authenticated;
revoke all on v_osl_pending_transfers, v_transfer_audit_history, v_pending_transfer_emails from anon, authenticated;

-- Functions: only the rpc_* entry points are callable from the browser.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('cfg_text','cfg_int','cfg_bool','sg_today','transfer_cutoff_date','fmt_slot','transfer_state_code',
                         'current_member_id','member_auth_uid','is_logistics_director','has_club_permission','is_osl_admin',
                         'require_club_permission','require_osl_admin','assert_transfer_window','log_transfer_event',
                         'notify_club_directors','notify_club_members','notify_osl_admins','offer_next_waitlist','expire_offers_for_booking',
                         'process_expired_waitlist_offers','generate_bookings_from_patterns','compose_transfer_email',
                         'queue_osl_request_email','notify_claim_result','protect_audit_voucher','block_audit_log_changes','pulse_install_view',
                         'osl_signoff_deadline','process_osl_signoff_deadlines','pulse_link_auth_users','pulse_on_auth_user_created')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'rpc\_%'
  loop
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;

-- Helpers used inside views and RLS policies must stay executable by the reader.
grant execute on function cfg_bool(text), cfg_int(text), cfg_text(text), sg_today(), transfer_cutoff_date(),
                          transfer_state_code(text), current_member_id(bigint) to anon, authenticated;

-- Realtime: push booking, waitlist and notification changes to browsers.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['facility_bookings','waitlist_entries','notifications'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end $$;
