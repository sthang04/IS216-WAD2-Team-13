-- Hosted Cron can retain a valid Vault service credential different from the
-- runtime's current key. Compare it inside the database; never return either key.
-- Only the backend service role may ask, and browsers cannot claim invitations.
create or replace function public.rpc_simulator_telegram_authorized(p_bearer text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(length(p_bearer)>100 and exists(
  select 1 from vault.decrypted_secrets where name='pulse_service_key' and decrypted_secret=p_bearer
 ),false)
$$;
revoke all on function public.rpc_simulator_telegram_authorized(text) from public,anon,authenticated;
grant execute on function public.rpc_simulator_telegram_authorized(text) to service_role;
notify pgrst,'reload schema';
