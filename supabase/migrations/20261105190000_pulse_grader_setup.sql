-- =====================================================================
-- Pulse — professors can grade with their own accounts. Safe to re-run.
--
-- 1. Each professor gets a second CCA, so they can release from one and claim
--    with the other. Added as EXCO_MEMBER so sign-up can still set their role.
-- 2. Each professor gets a delivery route, using the address already on the
--    ExCo list, so no address is written here. ld_only limits their transfer
--    emails to CCAs where they hold a role that can claim. Until they sign up
--    and choose Logistics Director, Pulse emails them nothing. Their Telegram
--    uses the chat they link, so the route leaves it empty.
-- 3. Shared persona logins can no longer link a Telegram chat, which would
--    take the persona's alerts away from the teammate standing in for it.
-- =====================================================================

insert into public.club_memberships (member_id, club_id, role_id, academic_year, is_active)
select v.member_id, v.club_id, (select id from public.exco_roles where upper(role_code) = 'EXCO_MEMBER'), '2026/27', true
  from (values (83::bigint, 5::bigint),    -- Kyong Jin Shim: SMU Eurhythmix, alongside SMU INDANCITY
               (84::bigint, 10::bigint))   -- Wong Chee Chein: SMU Samba Masala, alongside SMU Symphonia
       as v(member_id, club_id)
on conflict (member_id, club_id, academic_year) do update set is_active = true;

alter table public.demo_recipients add column if not exists ld_only boolean not null default false;

insert into public.demo_recipients (persona_key, persona_label, member_id, recipient_name, email, copy_all, ld_only)
select v.persona_key, m.full_name, m.id, m.full_name, lower(m.student_email), false, true
  from (values ('prof_kyong', 83::bigint), ('prof_wong', 84::bigint)) as v(persona_key, member_id)
  join public.members m on m.id = v.member_id
on conflict (persona_key) do update set email = excluded.email, ld_only = true, active = true, updated_at = now();

create or replace view public.demo_recipient_routes with (security_invoker = true) as
  select r.persona_key, r.persona_label, r.member_id, r.email, r.telegram_chat_id, r.copy_all,
         coalesce(public.is_osl_admin(r.member_id), false) as is_osl_admin,
         array(select cm.club_id
                 from public.club_memberships cm
                 join public.exco_roles er on er.id = cm.role_id
                where cm.member_id = r.member_id and cm.is_active
                  and (not r.ld_only or er.can_claim_booking)) as club_ids
    from public.demo_recipients r
   where r.active;

create or replace function public.rpc_create_telegram_link_code(p_demo_member_id bigint default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_member bigint;
  v_code   text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 18);
begin
  if auth.uid() is null then raise exception 'Sign in to connect Telegram'; end if;
  select id into v_member from members where auth_user_id = auth.uid() order by id limit 1;
  if v_member is null then raise exception 'Sign in to connect Telegram'; end if;
  if exists (select 1 from demo_recipients where member_id = v_member and active and telegram_chat_id is not null) then
    raise exception 'This is a shared demo account, and its alerts already go to a team member. Connect Telegram from your own account.';
  end if;
  insert into telegram_links (member_id, link_code, code_expires_at)
  values (v_member, v_code, now() + interval '10 minutes')
  on conflict (member_id) do update set link_code = excluded.link_code, code_expires_at = excluded.code_expires_at;
  return v_code;
end $$;

-- Review wording that lives in data
update public.exco_roles set role_name = 'ExCo Member' where role_code = 'EXCO_MEMBER' and role_name = 'EXCO Member';
update public.member_baseline_events set title = replace(title, 'Soltning', 'Solutioning') where title like '%Soltning%';
