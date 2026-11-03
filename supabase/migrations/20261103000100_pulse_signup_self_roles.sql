-- =====================================================================
-- Pulse — ExCo sign-up with self-selected roles. Additive, safe to re-run.
--
-- Whitelist = members.student_email + an active club_memberships row.
-- OSL whitelists the email + CCA with the placeholder role EXCO_MEMBER
-- (no permissions); the ExCo picks their real role while signing up.
--
-- Adds: EXCO_MEMBER role, members.created_at / onboarded_at,
--       rpc_check_signup, rpc_update_my_profile, rpc_set_my_roles
-- (src/services/authService.js calls all three functions).
-- =====================================================================

-- members: when they were whitelisted, and when they first signed up
alter table public.members add column if not exists created_at   timestamptz not null default now();
alter table public.members add column if not exists onboarded_at timestamptz;

comment on column public.members.created_at   is 'When OSL added this person to the whitelist';
comment on column public.members.onboarded_at is 'When this person signed up (login first linked)';

-- Existing members who already have a login: use their account creation time
update public.members m
   set onboarded_at = u.created_at
  from auth.users u
 where m.auth_user_id = u.id
   and m.onboarded_at is null;

-- Stamp onboarded_at the first time a login is linked (sign-up trigger, or manual link)
create or replace function public.pulse_stamp_member_onboarded() returns trigger
language plpgsql as $$
begin
  if new.auth_user_id is not null and new.onboarded_at is null then
    new.onboarded_at := now();
  end if;
  return new;
end $$;

drop trigger if exists pulse_member_onboarded on public.members;
create trigger pulse_member_onboarded
  before insert or update of auth_user_id on public.members
  for each row execute function public.pulse_stamp_member_onboarded();

-- 0. Placeholder role for whitelisted people who haven't picked a role yet (no permissions)
insert into public.exco_roles (role_code, role_name, can_release_booking, can_claim_booking, can_manage_waitlist,
                               can_send_transfer_email, can_manage_members, is_admin_role, sort_order)
select 'EXCO_MEMBER', 'ExCo Member', false, false, false, false, false, false, 100
where not exists (select 1 from public.exco_roles where upper(role_code) = 'EXCO_MEMBER');

-- 1. Sign-up check: "is this email whitelisted, for which CCAs, and not signed up yet?"
--    Returns { status: 'ok', full_name, ccas: [...], roles: [{code, name}] } | { status: 'not_listed' } | { status: 'already_registered' }
--    roles = what the sign-up form may offer (never OSL admin roles).
--    Same rule as sign-in: a membership counts unless is_active = false.
create or replace function public.rpc_check_signup(p_email text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_ccas  json;
  v_roles json;
  v_name  text;
begin
  select json_agg(distinct c.name order by c.name) into v_ccas
    from members m
    join club_memberships cm on cm.member_id = m.id and coalesce(cm.is_active, true)
    join clubs c on c.id = cm.club_id
   where lower(m.student_email) = v_email
     and coalesce(m.is_active, true);

  if v_ccas is null then
    return json_build_object('status', 'not_listed');
  end if;

  if exists (select 1 from members where lower(student_email) = v_email and auth_user_id is not null)
     or exists (select 1 from auth.users where lower(email) = v_email) then
    return json_build_object('status', 'already_registered');
  end if;

  select json_agg(json_build_object('code', r.role_code, 'name', r.role_name) order by r.sort_order, r.role_name)
    into v_roles
    from exco_roles r
   where not coalesce(r.is_admin_role, false);

  select full_name into v_name
    from members
   where lower(student_email) = v_email
   order by id
   limit 1;

  return json_build_object('status', 'ok', 'full_name', v_name, 'ccas', v_ccas, 'roles', v_roles);
end $$;

revoke all on function public.rpc_check_signup(text) from public;
grant execute on function public.rpc_check_signup(text) to anon, authenticated;

-- 2. After sign-up: the new ExCo saves their own name and Telegram handle.
--    (The pulse_link_member_on_signup trigger has already linked their login to the members row.)
create or replace function public.rpc_update_my_profile(p_full_name text, p_telegram_handle text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;

  update members
     set full_name       = coalesce(nullif(trim(p_full_name), ''), full_name),
         telegram_handle = nullif(trim(p_telegram_handle), '')
   where auth_user_id = auth.uid();

  if not found then
    raise exception 'No member profile is linked to this login.';
  end if;
end $$;

revoke all on function public.rpc_update_my_profile(text, text) from public;
grant execute on function public.rpc_update_my_profile(text, text) to authenticated;

-- 3. After sign-up: the new ExCo picks their role in each CCA.
--    p_roles = { "<club name>": "<role_code>", ... }  e.g. { "Eurhythmix": "LOGISTICS_DIRECTOR" }
--    Only the signed-in person's own memberships, only while the role is still EXCO_MEMBER
--    (so nobody can promote themselves later), and never an OSL admin role.
create or replace function public.rpc_set_my_roles(p_roles jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member_id   bigint;
  v_placeholder bigint;
  v_club        text;
  v_code        text;
  v_role_id     bigint;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;

  select id into v_member_id from members where auth_user_id = auth.uid();
  if v_member_id is null then
    raise exception 'No member profile is linked to this login.';
  end if;

  select id into v_placeholder from exco_roles where upper(role_code) = 'EXCO_MEMBER';

  for v_club, v_code in select key, value from jsonb_each_text(coalesce(p_roles, '{}'::jsonb)) loop
    select id into v_role_id
      from exco_roles
     where upper(role_code) = upper(v_code)
       and not coalesce(is_admin_role, false);
    if v_role_id is null then
      raise exception 'Unknown role: %', v_code;
    end if;

    update club_memberships cm
       set role_id = v_role_id
      from clubs c
     where c.id = cm.club_id
       and c.name = v_club
       and cm.member_id = v_member_id
       and coalesce(cm.is_active, true)
       and cm.role_id = v_placeholder;
  end loop;
end $$;

revoke all on function public.rpc_set_my_roles(jsonb) from public;
grant execute on function public.rpc_set_my_roles(jsonb) to authenticated;

-- =====================================================================
-- HOW TO WHITELIST A NEW EXCO (what used to be "insert into exco_members")
-- Uncomment, change the values, and run. They pick their own role when signing up.
-- Club = clubs.short_name (e.g. 'Eurhythmix', 'Samba Masala').
-- =====================================================================
-- with new_member as (
--   insert into members (full_name, student_email)
--   values ('Jane Doe', 'jane.doe.2025@scis.smu.edu.sg')
--   returning id
-- )
-- insert into club_memberships (member_id, club_id, role_id, academic_year, is_active)
-- select new_member.id, c.id, r.id, '2026/27', true
--   from new_member, clubs c, exco_roles r
--  where c.short_name = 'Eurhythmix' and r.role_code = 'EXCO_MEMBER';
--
-- Second CCA for someone already in members: run only the club_memberships insert,
-- using (select id from members where student_email = '...') as member_id.
--
-- Someone picked the wrong role? Their choice is locked after sign-up, so OSL fixes it:
-- update club_memberships set role_id = (select id from exco_roles where role_code = 'PRESIDENT')
--  where member_id = (select id from members where student_email = '...')
--    and club_id = (select id from clubs where short_name = 'Eurhythmix') and academic_year = '2026/27';


-- =====================================================================
-- CHECK: who can sign up right now (whitelisted, SMU email, no login yet)
-- =====================================================================
-- select m.full_name, m.student_email, c.short_name as club, r.role_name
--   from members m
--   join club_memberships cm on cm.member_id = m.id and coalesce(cm.is_active, true)
--   join clubs c on c.id = cm.club_id
--   join exco_roles r on r.id = cm.role_id
--  where m.auth_user_id is null
--    and m.student_email ~* '@([a-z0-9-]+\.)*smu\.edu\.sg$'
--  order by c.short_name, m.full_name;
