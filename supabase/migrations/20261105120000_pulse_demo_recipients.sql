-- =====================================================================
-- Pulse — demo delivery: real email and Telegram for the teammate
-- demonstrating each persona. Additive, safe to re-run.
--
-- demo_recipients says who stands in for each persona. It is read only
-- when EMAIL_DEMO_MODE=true / TELEGRAM_DELIVERY_MODE=demo, and starts with
-- no addresses, so applying this migration sends nothing to anyone.
-- members.student_email and transfer_email_config are not touched.
-- Fill it in with supabase/notificationRecipientSetup.sql.
-- =====================================================================

create table if not exists public.demo_recipients (
  persona_key      text primary key,
  persona_label    text not null,
  member_id        bigint unique references public.members(id) on delete cascade, -- null: no member row (Dev)
  recipient_name   text,                                        -- the teammate, for your own reference
  email            text check (email is null or email ~ '^[^@\s,]+@[^@\s,]+\.[^@\s,]+$'),
  telegram_chat_id bigint,                                      -- several personas may share one chat
  copy_all         boolean not null default false,              -- also gets a copy of every email and alert
  active           boolean not null default true,
  updated_at       timestamptz not null default now(),
  constraint demo_recipients_has_target check (member_id is not null or copy_all)
);

-- Personal addresses: only the edge functions (service role) can read this
alter table public.demo_recipients enable row level security;
revoke all on public.demo_recipients from anon, authenticated;

insert into public.demo_recipients (persona_key, persona_label, member_id, copy_all)
select s.persona_key, s.persona_label, m.id, false
  from (values ('rachel', 'Rachel Tan', 'rachel.tan.2024@scis.smu.edu.sg'),
               ('darren', 'Darren Koh', 'darren.koh.2024@business.smu.edu.sg'),
               ('marcus', 'Marcus Lim', 'marcus.lim.2024@socsc.smu.edu.sg'),
               ('osl_admin', 'OSL Admin', 'chloe.osl@smu.edu.sg')) as s(persona_key, persona_label, login_email)
  join public.members m on lower(m.student_email) = s.login_email
on conflict (persona_key) do nothing;

-- The Dev persona has no row in members, so nothing is ever addressed to it
insert into public.demo_recipients (persona_key, persona_label, member_id, copy_all)
values ('dev', 'Dev Administrator', null, true)
on conflict (persona_key) do nothing;

-- Active stand-ins, with what the edge functions route on
create or replace view public.demo_recipient_routes with (security_invoker = true) as
  select r.persona_key, r.persona_label, r.member_id, r.email, r.telegram_chat_id, r.copy_all,
         coalesce(public.is_osl_admin(r.member_id), false) as is_osl_admin,
         array(select cm.club_id from public.club_memberships cm
                where cm.member_id = r.member_id and cm.is_active) as club_ids
    from public.demo_recipients r
   where r.active;

revoke all on public.demo_recipient_routes from anon, authenticated;
grant select on public.demo_recipients, public.demo_recipient_routes to service_role;

-- "Connected to Telegram" also shows for someone linked through demo_recipients
create or replace function rpc_my_telegram_link()
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_member bigint;
begin
  if auth.uid() is null then return false; end if;
  select id into v_member from members where auth_user_id = auth.uid() order by id limit 1;
  return exists (select 1 from telegram_links where member_id = v_member and telegram_chat_id is not null)
      or exists (select 1 from demo_recipients where member_id = v_member and active and telegram_chat_id is not null);
end $$;

revoke execute on function rpc_my_telegram_link() from anon;
grant execute on function rpc_my_telegram_link() to authenticated;

-- Links inside emails are built from this. Same value as 20261105000100, which never reached the live database.
update public.app_config
   set value = '"https://is-216-wad-2-team-13.vercel.app"'
 where key = 'pulse_base_url';
