-- =====================================================================
-- Pulse — Meeting Scheduler: the organiser can edit a meeting after creating it.
-- Additive, safe to re-run.
--   rpc_update_meeting_participants  change who is involved, while voting is open
--   rpc_update_meeting_agenda        change the agenda, until the meeting starts
--   rpc_meeting_snapshot             week_meetings also say who organises each one
--                                    and when voting closes (for the right-click menu)
-- =====================================================================

create or replace function public.rpc_meeting_snapshot(
  p_club_id bigint, p_week_start date, p_meeting_id bigint default null, p_demo_member_id bigint default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_me      bigint := current_member_id(p_demo_member_id);
  v_meeting meeting_requests;
begin
  perform pulse_expire_meeting_polls();

  if p_meeting_id is not null then
    select * into v_meeting from meeting_requests where id = p_meeting_id;
  else
    -- No meeting picked: show the newest open request, else the newest confirmed one
    select * into v_meeting from meeting_requests
     where club_id = p_club_id and week_start = p_week_start and status <> 'CANCELLED'
     order by (status in ('COLLECTING', 'EXPIRED')) desc, created_at desc limit 1;
  end if;

  if v_meeting.id is null or not pulse_is_club_member(v_me, v_meeting.club_id) then
    return json_build_object('meeting', null, 'week_meetings', '[]'::json);
  end if;

  return json_build_object(
    -- Every meeting of this CCA in the same week, for the switcher and the calendar
    'week_meetings', coalesce((
      select json_agg(json_build_object(
               'id', w.id, 'title', w.title, 'agenda', w.agenda, 'status', w.status,
               'organiser_name', (select full_name from members where id = w.organiser_member_id),
               'confirmed_date', w.confirmed_date, 'confirmed_start_hour', w.confirmed_start_hour,
               'confirmed_end_hour', w.confirmed_end_hour,
               'organiser_member_id', w.organiser_member_id, 'vote_deadline', w.vote_deadline,
               'is_organiser', w.organiser_member_id = v_me)
             order by w.created_at)
        from meeting_requests w
       where w.club_id = v_meeting.club_id and w.week_start = v_meeting.week_start and w.status <> 'CANCELLED'), '[]'),
    'meeting', json_build_object(
      'id', v_meeting.id,
      'club_id', v_meeting.club_id,
      'title', v_meeting.title,
      'agenda', v_meeting.agenda,
      'week_start', v_meeting.week_start,
      'vote_deadline', v_meeting.vote_deadline,
      'status', v_meeting.status,
      'organiser_member_id', v_meeting.organiser_member_id,
      'organiser_name', (select full_name from members where id = v_meeting.organiser_member_id),
      'confirmed_date', v_meeting.confirmed_date,
      'confirmed_start_hour', v_meeting.confirmed_start_hour,
      'confirmed_end_hour', v_meeting.confirmed_end_hour,
      'venue', v_meeting.venue,
      'voting_open', v_meeting.status = 'COLLECTING' and v_meeting.vote_deadline > now(),
      'can_confirm', pulse_meeting_can_confirm(v_meeting.id),
      'is_organiser', v_meeting.organiser_member_id = v_me,
      'is_participant', exists (select 1 from meeting_participants where meeting_id = v_meeting.id and member_id = v_me),
      'server_now', now()),
    'participants', coalesce((
      select json_agg(json_build_object(
               'member_id', p.member_id,
               'full_name', m.full_name,
               'responded_at', p.responded_at,
               'last_nudged_at', p.last_nudged_at,
               'telegram_linked', exists (select 1 from telegram_links t where t.member_id = p.member_id and t.telegram_chat_id is not null))
             order by m.full_name)
        from meeting_participants p join members m on m.id = p.member_id
       where p.meeting_id = v_meeting.id), '[]'),
    'availability', coalesce((
      select json_agg(json_build_object('member_id', a.member_id, 'slot_date', a.slot_date, 'hour', a.hour))
        from meeting_availability a
       where a.meeting_id = v_meeting.id), '[]'));
end $$;

-- When does this meeting start? Confirmed: its chosen time. Otherwise the end of its week.
create or replace function public.pulse_meeting_starts_at(p_meeting public.meeting_requests)
returns timestamptz
language sql stable as $$
  select case
    when p_meeting.status = 'CONFIRMED'
      then (p_meeting.confirmed_date + make_interval(hours => p_meeting.confirmed_start_hour))::timestamp at time zone 'Asia/Singapore'
    else pulse_meeting_week_end(p_meeting.week_start)
  end
$$;

-- The full new list of participants (the organiser always stays in).
-- Added people get the meeting request; removed people lose their votes and are told in the bell.
create or replace function public.rpc_update_meeting_participants(
  p_meeting_id bigint, p_member_ids bigint[], p_demo_member_id bigint default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_me        bigint := current_member_id(p_demo_member_id);
  v_meeting   meeting_requests;
  v_ids       bigint[];
  v_bad       int;
  v_added     bigint[];
  v_removed   bigint[];
  v_member    bigint;
  v_organiser text;
begin
  perform pulse_expire_meeting_polls();
  v_meeting := pulse_meeting_for_member(p_meeting_id, v_me);
  select * into v_meeting from meeting_requests where id = p_meeting_id for update;

  if v_meeting.organiser_member_id <> v_me then raise exception 'Only the organiser can change the participants.'; end if;
  if v_meeting.status <> 'COLLECTING' or v_meeting.vote_deadline <= now() then
    raise exception 'Participants can only be changed while voting is open.';
  end if;

  v_ids := array(select distinct x from unnest(coalesce(p_member_ids, '{}') || v_me) x where x is not null);
  if array_length(v_ids, 1) < 2 then raise exception 'Pick at least one other participant.'; end if;
  if array_length(v_ids, 1) > 100 then raise exception 'Too many participants.'; end if;
  select count(*) into v_bad from unnest(v_ids) x where not pulse_is_club_member(x, v_meeting.club_id);
  if v_bad > 0 then raise exception 'Every participant must be an ExCo of this CCA.'; end if;

  v_added := array(select x from unnest(v_ids) x
                    where not exists (select 1 from meeting_participants p where p.meeting_id = p_meeting_id and p.member_id = x));
  v_removed := array(select p.member_id from meeting_participants p
                      where p.meeting_id = p_meeting_id and p.member_id <> all (v_ids));

  delete from meeting_participants where meeting_id = p_meeting_id and member_id = any (v_removed);  -- their votes go too
  insert into meeting_participants (meeting_id, member_id) select p_meeting_id, x from unnest(v_added) x;

  select full_name into v_organiser from members where id = v_me;
  foreach v_member in array v_added loop
    perform pulse_notify_meeting(v_member, v_meeting.club_id, 'MEETING_REQUEST',
      'Mark your availability: ' || v_meeting.title,
      v_organiser || ' added you to "' || v_meeting.title || '" in the week of '
        || to_char(v_meeting.week_start, 'DD Mon') || '. Mark when you are free by '
        || to_char(v_meeting.vote_deadline at time zone 'Asia/Singapore', 'Dy DD Mon, HH24:MI') || '.'
        || coalesce(E'\n\nAgenda:\n' || left(v_meeting.agenda, 500), ''),
      p_meeting_id);
  end loop;
  -- In the bell only: the Telegram sender skips this type
  foreach v_member in array v_removed loop
    perform pulse_notify_meeting(v_member, v_meeting.club_id, 'MEETING_REMOVED',
      'Removed from: ' || v_meeting.title,
      v_organiser || ' removed you from "' || v_meeting.title || '". You no longer need to vote.',
      p_meeting_id);
  end loop;

  return json_build_object('added', coalesce(array_length(v_added, 1), 0), 'removed', coalesce(array_length(v_removed, 1), 0));
end $$;

-- New agenda (empty = none), until the meeting starts. Participants are told in the bell.
create or replace function public.rpc_update_meeting_agenda(
  p_meeting_id bigint, p_agenda text, p_demo_member_id bigint default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me      bigint := current_member_id(p_demo_member_id);
  v_meeting meeting_requests;
  v_agenda  text := nullif(left(trim(coalesce(p_agenda, '')), 1000), '');
  v_member  bigint;
begin
  v_meeting := pulse_meeting_for_member(p_meeting_id, v_me);
  select * into v_meeting from meeting_requests where id = p_meeting_id for update;

  if v_meeting.organiser_member_id <> v_me then raise exception 'Only the organiser can change the agenda.'; end if;
  if v_meeting.status = 'CANCELLED' then raise exception 'This meeting was cancelled.'; end if;
  if pulse_meeting_starts_at(v_meeting) <= now() then
    raise exception 'The meeting has already started, so the agenda can no longer be changed.';
  end if;
  if v_agenda is not distinct from v_meeting.agenda then return; end if;

  update meeting_requests set agenda = v_agenda where id = p_meeting_id;

  -- In the bell only: the Telegram sender skips this type
  for v_member in select member_id from meeting_participants where meeting_id = p_meeting_id and member_id <> v_me loop
    perform pulse_notify_meeting(v_member, v_meeting.club_id, 'MEETING_AGENDA_UPDATED',
      'Agenda updated: ' || v_meeting.title,
      coalesce(E'New agenda:\n' || left(v_agenda, 500), 'The agenda was removed.'),
      p_meeting_id);
  end loop;
end $$;

revoke all on function public.pulse_meeting_starts_at(public.meeting_requests) from public, anon, authenticated;
revoke all on function public.rpc_update_meeting_participants(bigint, bigint[], bigint) from public;
revoke all on function public.rpc_update_meeting_agenda(bigint, text, bigint) from public;
grant execute on function public.rpc_update_meeting_participants(bigint, bigint[], bigint) to anon, authenticated;
grant execute on function public.rpc_update_meeting_agenda(bigint, text, bigint) to anon, authenticated;
