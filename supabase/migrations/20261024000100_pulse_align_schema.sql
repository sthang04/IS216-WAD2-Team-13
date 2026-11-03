-- =====================================================================
-- Pulse — Master Facility Calendar
-- 1/4  Align the existing project schema (ADDITIVE, safe to re-run)
--
-- Works ON the tables that already exist in the shared Supabase project
-- (members, clubs, exco_roles, club_memberships, facilities,
--  facility_bookings, facility_transfers, transfer_audit_log,
--  transfer_emails, transfer_email_config, waitlist_entries, notifications).
--
-- It never drops a table or a column, and never touches the teammates'
-- tables (events, event_segments, segment_*, facility_slots).
-- What it does:
--   * creates app_config and telegram_links if they are missing
--   * adds a few nullable columns the RPCs need (member ids for actors,
--     original owner of a booking, email retry fields, ...)
--   * replaces old prototype CHECK / UNIQUE rules on the transfer tables
--     with the ones the transfer workflow needs
--   * normalises old status spellings
-- =====================================================================

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
create table if not exists app_config (
  key         text primary key,
  value       jsonb not null,
  description text
);

insert into app_config (key, value, description) values
  ('demo_mode',              'true',                    'When true, RPCs accept a demo member id if no Supabase Auth user is signed in. Set to false once the shared login is live.'),
  ('transfer_lead_days',     '4',                       'Minimum calendar days between today (Singapore time) and a booking for release/claim.'),
  ('calendar_end_date',      '"2026-12-31"',            'Last date Pulse shows bookings for.'),
  ('waitlist_offer_minutes', '30',                      'How long a waitlisted club holds an offer.'),
  ('offer_reminder_minutes', '5',                       'Send a reminder when this many minutes remain on an offer.'),
  ('pulse_base_url',         '"http://localhost:5173"', 'Used to build links inside emails and Telegram messages.'),
  ('osl_signoff_hours',      '48',                      'SSU Clause 9.1(c): OSL must sign off a transfer at least this many hours before the booking starts.'),
  ('osl_reminder_hours',     '24',                      'Remind OSL this many hours before the sign-off deadline.'),
  ('demo_persona_emails',    '["rachel.tan.2024@scis.smu.edu.sg","darren.koh.2024@business.smu.edu.sg","chloe.osl@smu.edu.sg","marcus.lim.2024@socsc.smu.edu.sg"]', 'The core demo personas (same emails as the team login screen).'),
  ('email_from',             '"pulse-notifications@example.org"', 'Fallback sender if the Logistics Director has no student_email. The Edge Function sends through its EMAIL_FROM secret with Reply-To set to the Logistics Director.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Who is who: members = one profile per person; club_memberships = each
-- club + role + academic year (history kept with is_active = false);
-- exco_roles = role definitions and permission flags.
-- OSL staff are modelled the same way: an "Office of Student Life" club
-- (category Administration) and an OSL_ADMIN role with is_admin_role.
-- Both are only added if missing; existing exco_roles rows are not changed.
-- ---------------------------------------------------------------------
insert into exco_roles (role_code, role_name, can_release_booking, can_claim_booking, can_manage_waitlist,
                        can_send_transfer_email, can_manage_members, is_admin_role, sort_order)
select 'OSL_ADMIN', 'OSL Facility Administrator', false, false, false, false, false, true, 5
where not exists (select 1 from exco_roles where upper(role_code) = 'OSL_ADMIN');

insert into clubs (name, short_name, category, official_email)
select 'Office of Student Life', 'OSL', 'Administration', null
where not exists (select 1 from clubs where lower(name) = 'office of student life');

-- Kept for the team's older code, but Pulse no longer reads or writes them:
-- a person's clubs, roles and years live in club_memberships.
comment on column members.club_name is 'Legacy, not used by Pulse. Club comes from club_memberships.';
comment on column members.role_code is 'Legacy, not used by Pulse. Role comes from club_memberships -> exco_roles.';
comment on column members.academic_year is 'Legacy, not used by Pulse. Year comes from club_memberships.academic_year.';

-- Private: numeric chat ids are never exposed to the browser.
create table if not exists telegram_links (
  member_id        bigint primary key references members(id) on delete cascade,
  telegram_chat_id bigint,
  link_code        text unique,
  code_expires_at  timestamptz,
  linked_at        timestamptz
);

-- Telegram testers (TELEGRAM_TEST_HANDLES) who sent /start to the bot.
-- Only the Edge Functions (service role) read or write it.
create table if not exists telegram_test_chats (
  username      text primary key,
  chat_id       bigint not null,
  registered_at timestamptz not null default now()
);
alter table telegram_test_chats enable row level security;
revoke all on telegram_test_chats from anon, authenticated;

-- Single-row routing table (id = true). Keep any row that is already there.
insert into transfer_email_config (id, to_emails, cc_emails)
select true, array['studentlife@smu.edu.sg'],
       array['artsvenuesfacility@sa.smu.edu.sg','artsvenues@smu.edu.sg','eechiing@smu.edu.sg']
where not exists (select 1 from transfer_email_config);

-- Replace the earlier example.org placeholders with the SMU routing list.
-- Emails still only reach TEST_EMAIL_RECIPIENT until EMAIL_LIVE_MODE=true.
update transfer_email_config
   set to_emails = array['studentlife@smu.edu.sg'],
       cc_emails = array['artsvenuesfacility@sa.smu.edu.sg','artsvenues@smu.edu.sg','eechiing@smu.edu.sg']
 where array_to_string(to_emails || cc_emails, ',') like '%example.org%'
    or cardinality(to_emails) = 0;

-- Reminder 5 minutes before a 30-minute waitlist offer ends.
update app_config set value = '5' where key = 'offer_reminder_minutes' and value = '10'::jsonb;

-- ---------------------------------------------------------------------
-- Extra columns (all nullable or defaulted, so existing rows are fine)
-- Supabase Auth ids (uuid) stay in the existing *_user_id columns; the
-- *_member_id columns let demo personas, who have no login yet, act too.
-- ---------------------------------------------------------------------
alter table facility_bookings  add column if not exists original_club_id bigint references clubs(id);

alter table facility_transfers add column if not exists released_by_member_id bigint references members(id);
alter table facility_transfers add column if not exists claimed_by_member_id  bigint references members(id);
alter table facility_transfers add column if not exists reviewed_by_member_id bigint references members(id);
alter table facility_transfers add column if not exists signoff_reminder_sent_at timestamptz;

alter table waitlist_entries   add column if not exists joined_by_member_id bigint references members(id);
alter table waitlist_entries   add column if not exists reminder_sent_at   timestamptz;

alter table notifications      add column if not exists recipient_member_id bigint references members(id) on delete cascade;
alter table notifications      add column if not exists waitlist_entry_id   bigint references waitlist_entries(id) on delete set null;
alter table notifications      add column if not exists telegram_status     text not null default 'NOT_REQUIRED';

alter table transfer_audit_log add column if not exists actor_member_id bigint references members(id);

alter table transfer_emails    add column if not exists requested_by_member_id bigint references members(id);
alter table transfer_emails    add column if not exists reply_to   text;
alter table transfer_emails    add column if not exists queued_at  timestamptz;
alter table transfer_emails    add column if not exists attempts   int not null default 0;
alter table transfer_emails    add column if not exists last_error text;

-- ---------------------------------------------------------------------
-- Normalise old status spellings before the new rules are added
-- ---------------------------------------------------------------------
update facility_bookings set status = case
    when lower(status) in ('released','available','proposed','proposed transfer') then 'Proposed Peer Transfer'
    when lower(status) in ('pending','pending admin','pending osl approval','pending approval') then 'Pending Admin Sign-off'
    when lower(status) in ('confirmed','officially confirmed','approved') then 'Officially Confirmed Booking'
    when lower(status) = 'booked' then 'Booked'
    else status end
 where status not in ('Booked','Proposed Peer Transfer','Pending Admin Sign-off','Officially Confirmed Booking');

update facility_transfers set transfer_status = case
    when lower(transfer_status) in ('released','proposed','proposed transfer') then 'Proposed Peer Transfer'
    when lower(transfer_status) in ('claimed','pending','pending admin','pending osl approval') then 'Pending Admin Sign-off'
    when lower(transfer_status) in ('approved','confirmed','officially confirmed') then 'Officially Confirmed Booking'
    when lower(transfer_status) = 'rejected'  then 'Rejected'
    when lower(transfer_status) in ('cancelled','canceled','undone') then 'Cancelled'
    else transfer_status end
 where transfer_status not in ('Proposed Peer Transfer','Pending Admin Sign-off','Officially Confirmed Booking','Rejected','Cancelled');

update waitlist_entries set status = upper(status) where status <> upper(status);

-- Original FBS holder: the releasing CCA of the earliest approved
-- transfer, otherwise whoever holds the booking now.
update facility_bookings b
   set original_club_id = coalesce(
         (select t.releasing_club_id from facility_transfers t
           where t.booking_id = b.id and t.transfer_status = 'Officially Confirmed Booking'
           order by t.id limit 1),
         b.owner_club_id)
 where b.original_club_id is null;

-- ---------------------------------------------------------------------
-- Replace prototype CHECK and UNIQUE rules on this module's tables.
-- A rejected claim is kept and the slot is relisted as a NEW transfer
-- row, and a club may re-join a waitlist after leaving, so "one row per
-- booking" style unique rules are swapped for partial unique indexes.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  -- CHECK constraints on the status-type columns (not NOT NULL rules).
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid in ('facility_bookings'::regclass, 'facility_transfers'::regclass, 'waitlist_entries'::regclass,
                          'transfer_emails'::regclass, 'notifications'::regclass)
       and c.conname not like 'pulse\_%'
       and pg_get_constraintdef(c.oid) ~* '(status|booking_source|email_type|recipient|type\M)'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    raise notice 'Pulse: replaced check % on %', r.conname, r.tbl;
  end loop;

  -- UNIQUE constraints that block history rows.
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.contype = 'u'
       and c.conrelid in ('facility_transfers'::regclass, 'waitlist_entries'::regclass, 'transfer_emails'::regclass)
       and not exists (
         select 1 from unnest(c.conkey) k
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
          where a.attname not in ('booking_id','club_id','transfer_id'))
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    raise notice 'Pulse: replaced unique rule % on %', r.conname, r.tbl;
  end loop;

  -- Plain unique indexes with the same effect (not partial, not ours).
  for r in
    select i.indexrelid::regclass as idx
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
     where i.indisunique and not i.indisprimary and i.indpred is null
       and i.indrelid in ('facility_transfers'::regclass, 'waitlist_entries'::regclass, 'transfer_emails'::regclass)
       and ic.relname not like 'pulse\_%'
       and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
       and not exists (
         select 1 from unnest(i.indkey::int2[]) k
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k
          where a.attname not in ('booking_id','club_id','transfer_id'))
  loop
    execute format('drop index %s', r.idx);
    raise notice 'Pulse: replaced unique index %', r.idx;
  end loop;
end $$;

-- New rules. NOT VALID: existing rows are left alone, new writes are checked.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pulse_booking_status_check') then
    alter table facility_bookings add constraint pulse_booking_status_check
      check (status in ('Booked','Proposed Peer Transfer','Pending Admin Sign-off','Officially Confirmed Booking')) not valid;
  end if;
  -- 'Expired': OSL did not sign off 48 hours before the booking (SSU Clause 9.1(c)).
  if exists (select 1 from pg_constraint where conname = 'pulse_transfer_status_check'
              and pg_get_constraintdef(oid) not like '%Expired%') then
    alter table facility_transfers drop constraint pulse_transfer_status_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pulse_transfer_status_check') then
    alter table facility_transfers add constraint pulse_transfer_status_check
      check (transfer_status in ('Proposed Peer Transfer','Pending Admin Sign-off','Officially Confirmed Booking','Rejected','Cancelled','Expired')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pulse_transfer_not_self_check') then
    alter table facility_transfers add constraint pulse_transfer_not_self_check
      check (claiming_club_id is null or claiming_club_id <> releasing_club_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pulse_waitlist_status_check') then
    alter table waitlist_entries add constraint pulse_waitlist_status_check
      check (status in ('WAITING','OFFERED','EXPIRED','DECLINED','LEFT','CLAIMED')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pulse_email_status_check') then
    alter table transfer_emails add constraint pulse_email_status_check
      check (status in ('DRAFT','QUEUED','SENDING','SENT','FAILED')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pulse_telegram_status_check') then
    alter table notifications add constraint pulse_telegram_status_check
      check (telegram_status in ('NOT_REQUIRED','PENDING','SENT','NO_CHAT','FAILED')) not valid;
  end if;
end $$;

-- Clean up duplicates that would block the partial unique indexes.
update facility_transfers t set transfer_status = 'Cancelled'
 where t.transfer_status in ('Proposed Peer Transfer','Pending Admin Sign-off')
   and exists (select 1 from facility_transfers n
                where n.booking_id = t.booking_id and n.id > t.id
                  and n.transfer_status in ('Proposed Peer Transfer','Pending Admin Sign-off'));
update waitlist_entries w set status = 'LEFT', left_at = coalesce(left_at, now())
 where w.status in ('WAITING','OFFERED')
   and exists (select 1 from waitlist_entries n
                where n.booking_id = w.booking_id and n.club_id = w.club_id and n.id > w.id
                  and n.status in ('WAITING','OFFERED'));
update waitlist_entries w set status = 'WAITING', offered_at = null, offer_expires_at = null
 where w.status = 'OFFERED'
   and exists (select 1 from waitlist_entries n where n.booking_id = w.booking_id and n.id > w.id and n.status = 'OFFERED');

create unique index if not exists pulse_transfers_one_open_idx
  on facility_transfers (booking_id) where transfer_status in ('Proposed Peer Transfer','Pending Admin Sign-off');
create unique index if not exists pulse_transfers_voucher_idx
  on facility_transfers (audit_voucher_id) where audit_voucher_id is not null;
create unique index if not exists pulse_waitlist_one_active_idx
  on waitlist_entries (booking_id, club_id) where status in ('WAITING','OFFERED');
create unique index if not exists pulse_waitlist_one_offer_idx
  on waitlist_entries (booking_id) where status = 'OFFERED';
create unique index if not exists pulse_emails_one_per_type_idx
  on transfer_emails (transfer_id, email_type) where email_type is not null;

create index if not exists pulse_bookings_date_idx        on facility_bookings (booking_date, facility_id);
create index if not exists pulse_bookings_owner_idx       on facility_bookings (owner_club_id, booking_date);
create index if not exists pulse_waitlist_queue_idx       on waitlist_entries (booking_id, status, created_at, id);
create index if not exists pulse_notifications_member_idx on notifications (recipient_member_id, created_at desc);
create index if not exists pulse_audit_transfer_idx       on transfer_audit_log (transfer_id, created_at);

-- ---------------------------------------------------------------------
-- Immutability: vouchers can't change once issued; the audit log is
-- append-only. (The demo reset uses TRUNCATE, which skips row triggers.)
-- ---------------------------------------------------------------------
create or replace function protect_audit_voucher() returns trigger
language plpgsql as $$
begin
  if old.audit_voucher_id is not null and new.audit_voucher_id is distinct from old.audit_voucher_id then
    raise exception 'Audit vouchers are immutable once issued';
  end if;
  return new;
end $$;

-- Stops anyone editing or deleting audit rows
create or replace function block_audit_log_changes() returns trigger
language plpgsql as $$
begin
  raise exception 'transfer_audit_log is append-only';
end $$;

drop trigger if exists pulse_voucher_immutable on facility_transfers;
-- Audit vouchers can never be changed once written
create trigger pulse_voucher_immutable
  before update on facility_transfers
  for each row execute function protect_audit_voucher();

drop trigger if exists pulse_audit_log_append_only on transfer_audit_log;
-- The audit log can only be added to
create trigger pulse_audit_log_append_only
  before update or delete on transfer_audit_log
  for each row execute function block_audit_log_changes();
