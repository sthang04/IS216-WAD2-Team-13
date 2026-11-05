-- Real Telegram alert queues. Recipients are derived from authenticated membership,
-- persisted event crew and private invitations; no bot token enters the browser.
create schema if not exists pulse_alerts;
revoke all on schema pulse_alerts from public;
grant usage on schema pulse_alerts to authenticated,anon;

-- A real login is required even while the older application supports demo personas.
create or replace function pulse_alerts.actor() returns bigint
language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor_id bigint;
begin
 if auth.uid() is null then raise exception 'Sign in to send Telegram alerts' using errcode='42501'; end if;
 select m.id into actor_id from public.members m where m.auth_user_id=auth.uid() and m.is_active order by m.id limit 1;
 if actor_id is null then raise exception 'An active Pulse membership is required' using errcode='42501'; end if;
 return actor_id;
end $$;
revoke all on function pulse_alerts.actor() from public,anon;
grant execute on function pulse_alerts.actor() to authenticated;

-- Restrict new personal/crew notices even when legacy demo SELECT policies are broad.
create or replace function pulse_alerts.can_access(p_type text,p_member bigint) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select p_type not in ('SCHEDULE_CHANGED','OPS_SCHEDULE_CHANGED') or
 (auth.uid() is not null and exists(select 1 from public.members m where m.id=p_member and m.auth_user_id=auth.uid()))
$$;
revoke all on function pulse_alerts.can_access(text,bigint) from public;
grant execute on function pulse_alerts.can_access(text,bigint) to authenticated,anon;
drop policy if exists pulse_private_alert_read on public.notifications;
create policy pulse_private_alert_read on public.notifications as restrictive for select to anon,authenticated
 using(pulse_alerts.can_access(type,recipient_member_id));

create or replace function pulse_alerts.schedule_change(p_action text,p_title text,p_date date,p_start_time time,p_end_time time,p_venue text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare actor_id bigint:=pulse_alerts.actor(); club bigint; notification_id bigint; legacy_name text; legacy_delay integer; legacy_id uuid; legacy_club bigint; legacy_count integer;
begin
 if p_action is null or p_action not in ('added','updated','removed') or nullif(btrim(p_title),'') is null or length(p_title)>200
  or p_date is null or p_start_time is null or p_end_time is null or p_end_time<=p_start_time or length(coalesce(p_venue,''))>500 then
  raise exception 'A valid schedule action, title, date and time interval are required'; end if;
 -- Compatibility with the currently published Ops client. Resolve its reserved
 -- title to exactly one saved event owned by the caller; never trust its demo ID.
 if p_action='updated' and starts_with(p_title,'📋 Live Run of Show: ') then
  legacy_name:=substr(p_title,length('📋 Live Run of Show: ')+1);
 elsif p_action='updated' and p_title ~ '^⚠️ Rehearsal Delay \(\+[0-9]+m\): ' then
  legacy_delay:=substring(p_title from '\(\+([0-9]+)m\)')::integer;
  legacy_name:=regexp_replace(p_title,'^⚠️ Rehearsal Delay \(\+[0-9]+m\): ','');
 end if;
 if legacy_name is not null then
  select count(*),(array_agg(e.id))[1],(array_agg(e.club_id))[1] into legacy_count,legacy_id,legacy_club
  from public.ops_events e where e.name=legacy_name and e.event_date=p_date and coalesce(e.venue,'SMU Main Hall')=coalesce(p_venue,'SMU Main Hall')
   and exists(select 1 from public.club_memberships cm where cm.member_id=actor_id and cm.club_id=e.club_id and cm.is_active);
  if legacy_count<>1 then raise exception 'Save the event with its actual crew before notifying'; end if;
  return pulse_alerts.ops_change(legacy_club,legacy_id,null,case when legacy_delay is null then 'updated' else 'delayed' end,legacy_delay,null,null,null);
 end if;
 select cm.club_id into club from public.club_memberships cm join public.clubs c on c.id=cm.club_id
 where cm.member_id=actor_id and cm.is_active and c.active order by cm.id limit 1;
 if club is null then raise exception 'An active CCA membership is required' using errcode='42501'; end if;
 insert into public.notifications(recipient_club_id,recipient_member_id,recipient_user_id,type,title,body,action_url,telegram_status)
 values(club,actor_id,auth.uid(),'SCHEDULE_CHANGED','Personal schedule '||p_action,
  format(E'%s\nDate: %s\nTime: %s - %s\nVenue: %s',p_title,p_date,to_char(p_start_time,'HH24:MI'),to_char(p_end_time,'HH24:MI'),coalesce(p_venue,'To be confirmed')),
  '/personal-schedule','PENDING') returning id into notification_id;
 return jsonb_build_object('queued',1,'notification_id',notification_id);
end $$;
revoke all on function pulse_alerts.schedule_change(text,text,date,time,time,text) from public,anon;
grant execute on function pulse_alerts.schedule_change(text,text,date,time,time,text) to authenticated;
-- Legacy demo-member argument is retained for client compatibility, never used for identity.
create or replace function public.rpc_notify_schedule_change(p_action text,p_title text,p_date date,p_start_time time,p_end_time time,p_venue text,p_demo_member_id bigint default null) returns jsonb
language sql security invoker set search_path=pg_catalog as $$ select pulse_alerts.schedule_change(p_action,p_title,p_date,p_start_time,p_end_time,p_venue) $$;
revoke all on function public.rpc_notify_schedule_change(text,text,date,time,time,text,bigint) from public,anon;
grant execute on function public.rpc_notify_schedule_change(text,text,date,time,time,text,bigint) to authenticated;

-- Persisted events use only their saved crew. Local sample names must resolve
-- uniquely inside the caller's own CCA; sample numeric IDs are never trusted.
create or replace function pulse_alerts.ops_change(p_club_id bigint,p_event_id uuid,p_member_names text[],p_action text,p_delay_minutes integer,p_event_name text,p_event_date date,p_venue text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare actor_id bigint:=pulse_alerts.actor(); recipients bigint[]; title_text text; event_day date; venue_text text; queued integer;
begin
 if not exists(select 1 from public.club_memberships cm join public.clubs c on c.id=cm.club_id where cm.member_id=actor_id and cm.club_id=p_club_id and cm.is_active and c.active) then
  raise exception 'You may only notify crew in your active CCA' using errcode='42501'; end if;
 if p_action is null or p_action not in ('updated','delayed') or (p_action='delayed' and (p_delay_minutes is null or p_delay_minutes<1 or p_delay_minutes>300)) then raise exception 'Invalid Day-of Ops update or delay'; end if;
 if p_event_id is not null then
  select e.name,e.event_date,e.venue into title_text,event_day,venue_text from public.ops_events e where e.id=p_event_id and e.club_id=p_club_id for share;
  if not found then raise exception 'The saved event does not belong to this CCA' using errcode='42501'; end if;
  select array_agg(distinct oc.member_id) into recipients from public.ops_event_crew oc join public.members m on m.id=oc.member_id and m.is_active
   where oc.event_id=p_event_id and exists(select 1 from public.club_memberships cm where cm.member_id=oc.member_id and cm.club_id=p_club_id and cm.is_active);
 else
  if coalesce(cardinality(p_member_names),0)=0 or cardinality(p_member_names)>100 or nullif(btrim(p_event_name),'') is null or length(p_event_name)>200 or p_event_date is null then raise exception 'Save an event or select a valid crew before notifying'; end if;
  if exists(select 1 from unnest(p_member_names) requested(name) where nullif(btrim(name),'') is null or
   (select count(distinct m.id) from public.members m join public.club_memberships cm on cm.member_id=m.id where m.is_active and cm.is_active and cm.club_id=p_club_id and lower(btrim(m.full_name))=lower(btrim(requested.name)))<>1) then
   raise exception 'Every local crew name must match one active CCA member; save the event with its actual crew first'; end if;
  select array_agg(distinct m.id) into recipients from public.members m join public.club_memberships cm on cm.member_id=m.id
   where m.is_active and cm.is_active and cm.club_id=p_club_id and exists(select 1 from unnest(p_member_names) n(name) where lower(btrim(n.name))=lower(btrim(m.full_name)));
  title_text:=p_event_name; event_day:=p_event_date; venue_text:=p_venue;
 end if;
 if coalesce(cardinality(recipients),0)=0 then raise exception 'This event has no active crew to notify'; end if;
 insert into public.notifications(recipient_club_id,recipient_member_id,recipient_user_id,type,title,body,action_url,telegram_status)
 select p_club_id,m.id,m.auth_user_id,'OPS_SCHEDULE_CHANGED',case when p_action='delayed' then 'Day-of Ops delay' else 'Day-of Ops schedule updated' end,
  format(E'%s\nDate: %s\nVenue: %s\n%s',title_text,event_day,coalesce(venue_text,'To be confirmed'),case when p_action='delayed' then format('Current tasks delayed by %s minutes. Check the updated run of show.',p_delay_minutes) else 'The run of show was updated. Open Pulse for your assigned tasks.' end),
  '/operations','PENDING' from public.members m where m.id=any(recipients);
 get diagnostics queued=row_count;
 return jsonb_build_object('queued',queued,'event_id',p_event_id);
end $$;
revoke all on function pulse_alerts.ops_change(bigint,uuid,text[],text,integer,text,date,text) from public,anon;
grant execute on function pulse_alerts.ops_change(bigint,uuid,text[],text,integer,text,date,text) to authenticated;
create or replace function public.rpc_notify_ops_schedule_change(p_club_id bigint,p_event_id uuid default null,p_member_names text[] default null,p_action text default 'updated',p_delay_minutes integer default null,p_event_name text default null,p_event_date date default null,p_venue text default null) returns jsonb
language sql security invoker set search_path=pg_catalog as $$ select pulse_alerts.ops_change(p_club_id,p_event_id,p_member_names,p_action,p_delay_minutes,p_event_name,p_event_date,p_venue) $$;
revoke all on function public.rpc_notify_ops_schedule_change(bigint,uuid,text[],text,integer,text,date,text) from public,anon;
grant execute on function public.rpc_notify_ops_schedule_change(bigint,uuid,text[],text,integer,text,date,text) to authenticated;

-- Existing demo bells retain their behavior, while new private types require
-- the actual recipient's Auth identity for reads, mark-read and deletion.
create or replace function public.rpc_my_notifications(p_demo_member_id bigint default null,p_limit integer default 30)
returns table(id bigint,type text,title text,message text,body text,booking_id bigint,transfer_id bigint,link_path text,action_url text,is_read boolean,created_at timestamptz,recipient_club_id bigint)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor_id bigint:=public.current_member_id(p_demo_member_id);
begin
 if actor_id is null then return; end if;
 return query select n.id,n.type,n.title,n.body,n.body,n.booking_id,n.transfer_id,n.action_url,n.action_url,n.is_read,n.created_at,n.recipient_club_id
 from public.notifications n where n.recipient_member_id=actor_id and pulse_alerts.can_access(n.type,n.recipient_member_id) order by n.created_at desc,n.id desc limit least(greatest(p_limit,1),100);
end $$;
create or replace function public.rpc_mark_notifications_read(p_notification_id bigint default null,p_demo_member_id bigint default null) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare actor_id bigint:=public.current_member_id(p_demo_member_id); count_rows integer;
begin
 if actor_id is null then raise exception 'Sign in to manage notifications'; end if;
 update public.notifications n set is_read=true where n.recipient_member_id=actor_id and not n.is_read and (p_notification_id is null or n.id=p_notification_id) and pulse_alerts.can_access(n.type,n.recipient_member_id);
 get diagnostics count_rows=row_count; return count_rows;
end $$;
create or replace function public.rpc_delete_notifications(p_notification_id bigint default null,p_demo_member_id bigint default null) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare actor_id bigint:=public.current_member_id(p_demo_member_id); count_rows integer;
begin
 if actor_id is null then raise exception 'Sign in to manage notifications'; end if;
 delete from public.notifications n where n.recipient_member_id=actor_id and (p_notification_id is null or n.id=p_notification_id) and pulse_alerts.can_access(n.type,n.recipient_member_id);
 get diagnostics count_rows=row_count; return count_rows;
end $$;

-- Install the previously unlinked private invitation queue. Delivery is claimed
-- atomically; an uncertain send is not automatically retried.
alter table simulator_private.replacement_invitations add column if not exists telegram_claim_id uuid,add column if not exists telegram_claimed_at timestamptz;
-- Bounded worker scans use a partial index as the invitation history grows.
create index if not exists simulator_telegram_pending_idx on simulator_private.replacement_invitations(created_at) where status='Pending' and delivery_status='Pending Delivery';
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
   'event_name',(select e.name from public.events e join simulator_private.recovery_plans p on p.event_id=e.id where p.id=c.plan_id),'activity_count',jsonb_array_length(c.assignment_snapshot))),'[]'::jsonb) into result from claimed c;
 return result;
end $$;
create or replace function public.rpc_simulator_finish_telegram(p_id uuid,p_claim_id uuid,p_status text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_status is null or p_status not in ('SENT','FAILED','NO_CHAT','UNKNOWN') then raise exception 'Invalid delivery result'; end if;
 update simulator_private.replacement_invitations set delivery_status=p_status where id=p_id and telegram_claim_id=p_claim_id and delivery_status='Sending';
 if found then return true; end if;
 return exists(select 1 from simulator_private.replacement_invitations where id=p_id and telegram_claim_id=p_claim_id and delivery_status=p_status);
end $$;
revoke all on function public.rpc_simulator_claim_telegram(),public.rpc_simulator_finish_telegram(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.rpc_simulator_claim_telegram(),public.rpc_simulator_finish_telegram(uuid,uuid,text) to service_role;

-- Linking a chat retries only recent notices that never had a destination, plus
-- still-valid private invitations. SENT/FAILED/UNKNOWN are never replayed here.
create or replace function pulse_alerts.on_chat_linked() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.telegram_chat_id is null or new.telegram_chat_id is not distinct from old.telegram_chat_id then return new; end if;
 update public.notifications n set telegram_status='PENDING' where n.recipient_member_id=new.member_id and n.type in ('SCHEDULE_CHANGED','OPS_SCHEDULE_CHANGED') and n.telegram_status='NO_CHAT' and n.created_at>now()-interval '24 hours';
 update simulator_private.replacement_invitations i set delivery_status='Pending Delivery',telegram_claim_id=null,telegram_claimed_at=null
  from simulator_private.recovery_plans p where i.plan_id=p.id and i.recipient_member_id=new.member_id and i.delivery_status='NO_CHAT' and i.status='Pending' and i.expires_at>clock_timestamp() and p.application_status='Draft';
 return new;
end $$;
revoke all on function pulse_alerts.on_chat_linked() from public,anon,authenticated;
drop trigger if exists pulse_retry_unlinked_alerts on public.telegram_links;
create trigger pulse_retry_unlinked_alerts after update of telegram_chat_id on public.telegram_links for each row execute function pulse_alerts.on_chat_linked();
notify pgrst,'reload schema';
