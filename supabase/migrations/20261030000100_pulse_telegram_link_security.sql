-- =====================================================================
-- Pulse — Telegram linking: only the signed-in person can link their
-- own account. Additive, safe to re-run.
--
-- Before: rpc_create_telegram_link_code took p_demo_member_id, so while
-- app_config.demo_mode was on anyone with the public anon key could
-- make a link code for ANY member and receive their notifications.
-- Now the code is only made for the member whose Supabase Auth login
-- is calling (auth.uid()). The parameter stays so the app's call still
-- works, but it is ignored.
-- =====================================================================
create or replace function rpc_create_telegram_link_code(p_demo_member_id bigint default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_member bigint;
  v_code   text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 18);
begin
  if auth.uid() is null then raise exception 'Sign in to connect Telegram'; end if;
  select id into v_member from members where auth_user_id = auth.uid() order by id limit 1;
  if v_member is null then raise exception 'Sign in to connect Telegram'; end if;
  insert into telegram_links (member_id, link_code, code_expires_at)
  values (v_member, v_code, now() + interval '10 minutes')
  on conflict (member_id) do update set link_code = excluded.link_code, code_expires_at = excluded.code_expires_at;
  return v_code;
end $$;

revoke execute on function rpc_create_telegram_link_code(bigint) from anon;
grant execute on function rpc_create_telegram_link_code(bigint) to authenticated;

-- Lets the signed-in person see whether their own Telegram is linked
-- (telegram_links itself is never readable from the browser).
create or replace function rpc_my_telegram_link()
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_member bigint;
begin
  if auth.uid() is null then return false; end if;
  select id into v_member from members where auth_user_id = auth.uid() order by id limit 1;
  return exists (select 1 from telegram_links where member_id = v_member and telegram_chat_id is not null);
end $$;

revoke execute on function rpc_my_telegram_link() from anon;
grant execute on function rpc_my_telegram_link() to authenticated;
