create schema if not exists ops_private;
revoke all on schema ops_private from public, anon, authenticated;
create table ops_private.crew_reminders (
  assignment_key text not null,
  member_id bigint not null,
  starts_at timestamptz not null,
  primary key (assignment_key, member_id, starts_at)
);
alter table ops_private.crew_reminders enable row level security;

-- Called by the service-role Telegram worker, never by a browser.
create or replace function public.queue_ops_crew_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare queued integer;
begin
  with assignments as (
    select 'event:' || e.id as assignment_key, c.member_id, e.club_id,
      e.name as title, e.venue,
      (e.event_date + e.start_time) at time zone 'Asia/Singapore' as starts_at
    from public.ops_events e join public.ops_event_crew c on c.event_id = e.id
    where e.start_time is not null
    union all
    select 'task:' || t.id, t.member_id, e.club_id,
      e.name || ': ' || t.title, coalesce(t.venue, e.venue),
      (e.event_date + t.start_time) at time zone 'Asia/Singapore'
    from public.ops_tasks t join public.ops_events e on e.id = t.event_id
    join public.ops_event_crew c on c.event_id = t.event_id and c.member_id = t.member_id
  ), due as (
    select a.* from assignments a
    where a.starts_at > now() and a.starts_at <= now() + interval '15 minutes'
      and exists (select 1 from public.club_memberships cm
        where cm.member_id = a.member_id and cm.club_id = a.club_id and cm.is_active)
  ), claimed as (
    insert into ops_private.crew_reminders (assignment_key, member_id, starts_at)
    select assignment_key, member_id, starts_at from due
    on conflict do nothing returning *
  )
  insert into public.notifications
    (recipient_member_id, recipient_club_id, type, title, body, action_url, telegram_status)
  select d.member_id, d.club_id, 'OPS_CREW_REMINDER', 'Upcoming crew assignment',
    d.title || ' starts at ' || to_char(d.starts_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI')
      || ' SGT. Venue: ' || coalesce(nullif(d.venue, ''), 'See run of show') || '.',
    '/operations', 'PENDING'
  from due d join claimed c using (assignment_key, member_id, starts_at);
  get diagnostics queued = row_count;
  return queued;
end;
$$;
revoke all on function public.queue_ops_crew_reminders() from public, anon, authenticated;
grant execute on function public.queue_ops_crew_reminders() to service_role;
