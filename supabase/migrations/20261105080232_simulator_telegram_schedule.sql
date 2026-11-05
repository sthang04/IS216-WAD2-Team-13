-- Invoke the dedicated, service-authenticated worker using the same secured
-- project/bot configuration as the existing waitlist sender. No secrets are copied.
do $$ begin
 if not exists(select 1 from vault.secrets where name='pulse_project_url') or not exists(select 1 from vault.secrets where name='pulse_service_key') then
  raise exception 'Configure the existing Pulse worker Vault entries before scheduling simulator delivery';
 end if;
end $$;
select cron.schedule('pulse-send-simulator-invitations','* * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='pulse_project_url')||'/functions/v1/send-simulator-invitation-notifications',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='pulse_service_key')),
  body:='{}'::jsonb,timeout_milliseconds:=55000);
$job$);
