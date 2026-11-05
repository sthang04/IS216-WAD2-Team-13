-- Replacement requests on Telegram say what is being asked.
--
-- Same function as in 20261105080229_telegram_alert_wiring.sql, with three more
-- fields for the message: the activities to cover (with times), who they are
-- covering for, and the reply deadline. Which invitations are claimed, and when,
-- is unchanged. Grants carry over because the signature is the same.

create or replace function public.rpc_simulator_claim_telegram() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if not coalesce((select invitations_enabled from simulator_private.release_gate where singleton),false) then return '[]'::jsonb; end if;
 with candidates as (
  select i.id from simulator_private.replacement_invitations i join simulator_private.recovery_plans p on p.id=i.plan_id
  where i.status='Pending' and i.delivery_status='Pending Delivery' and i.expires_at>clock_timestamp() and p.application_status='Draft'
   and p.before_state=simulator_private.event_state(p.event_id) and i.assignment_snapshot=simulator_private.invitation_terms(p.id,i.replaced_member_id)
  order by i.created_at limit 5 for update of i skip locked
 ), claimed as (
  update simulator_private.replacement_invitations i set delivery_status='Sending',telegram_claim_id=gen_random_uuid(),telegram_claimed_at=clock_timestamp()
  from candidates c where i.id=c.id returning i.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'claim_id',c.telegram_claim_id,'recipient_member_id',c.recipient_member_id,
   'event_name',(select e.name from public.events e join simulator_private.recovery_plans p on p.event_id=e.id where p.id=c.plan_id),
   'activity_count',jsonb_array_length(c.assignment_snapshot),
   'assignment_snapshot',c.assignment_snapshot,
   'expires_at',c.expires_at,
   'replaced_name',(select m.full_name from public.members m where m.id=c.replaced_member_id))),'[]'::jsonb) into result from claimed c;
 return result;
end $$;

revoke all on function public.rpc_simulator_claim_telegram() from public,anon,authenticated;
grant execute on function public.rpc_simulator_claim_telegram() to service_role;
