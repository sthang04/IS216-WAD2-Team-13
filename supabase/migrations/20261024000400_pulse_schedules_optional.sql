-- =====================================================================
-- Pulse — Master Facility Calendar  (optional, run separately)
-- Optional: scheduled jobs. Needs the pg_cron and pg_net extensions
-- (Supabase Dashboard → Database → Extensions), and two Vault secrets:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'pulse_project_url');
--   select vault.create_secret('<service-role key>',                'pulse_service_key');
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Expire 30-minute waitlist offers and promote the next club, every minute,
-- whether or not anyone has Pulse open.
select cron.schedule('pulse-expire-waitlist-offers', '* * * * *',
  $$ select public.process_expired_waitlist_offers(); $$);

-- SSU Clause 9.1(c): remind OSL 24 hours before the 48-hour sign-off deadline,
-- and hand the slot back to the releasing CCA once the deadline passes.
select cron.schedule('pulse-osl-signoff-deadlines', '*/5 * * * *',
  $$ select public.process_osl_signoff_deadlines(); $$);

-- Kick the Edge Functions that deliver queued emails and Telegram alerts.
select cron.schedule('pulse-send-transfer-emails', '* * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'pulse_project_url') || '/functions/v1/send-transfer-emails',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pulse_service_key')),
    body    := '{}'::jsonb)
$$);

select cron.schedule('pulse-send-telegram', '* * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'pulse_project_url') || '/functions/v1/send-telegram-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pulse_service_key')),
    body    := '{}'::jsonb)
$$);

