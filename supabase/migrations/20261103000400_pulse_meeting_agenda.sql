-- =====================================================================
-- Pulse — Meeting Scheduler: an optional agenda on each meeting request.
-- Additive, safe to re-run. Replaces rpc_create_meeting (new p_agenda
-- argument; the old signature is dropped so calls aren't ambiguous) and
-- rpc_meeting_snapshot (returns agenda) from 20261103000300.
-- The agenda is also added to the Telegram meeting request.
-- =====================================================================

alter table public.meeting_requests add column if not exists agenda text;
comment on column public.meeting_requests.agenda is 'What the meeting is about, set by the organiser (max 1000 characters)';

drop function if exists public.rpc_create_meeting(bigint, text, date, timestamptz, bigint[], bigint);

create or replace function public.rpc_create_meeting(
  p_club_id bigint, p_title text, p_week_start date, p_vote_deadline timestamptz,
  p_member_ids bigint[], p_agenda text default null, p_demo_member_id bigint default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me        bigint := current_member_id(p_demo_member_id);
  v_title     text := left(trim(coalesce(p_title, '')), 120);
  v_agenda    text := nullif(left(trim(coalesce(p_agenda, '')), 1000), '');
  v_ids       bigint[];
  v_bad       int;
  v_id        bigint;
  v_organiser text;
  v_member    bigint;
begin
  if v_me is null then raise exception 'Please sign in first.'; end if;
  if not pulse_is_club_member(v_me, p_club_id) then raise exception 'You are not an ExCo of this CCA.'; end if;
  if v_title = '' then raise exception 'Give the meeting a title.'; end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then raise exception 'Pick a week (it starts on a Monday).'; end if;
  if pulse_meeting_week_end(p_week_start) <= now() then raise exception 'That week is already over.'; end if;
  if p_vote_deadline is null or p_vote_deadline <= now() then raise exception 'The voting deadline must be in the future.'; end if;
  if p_vote_deadline >= pulse_meeting_week_end(p_week_start) then
    raise exception 'The voting deadline must be before the end of the meeting week.';
  end if;

  perform pulse_expire_meeting_polls();

  -- The organiser always takes part
  v_ids := array(select distinct x from unnest(coalesce(p_member_ids, '{}') || v_me) x where x is not null);
  if array_length(v_ids, 1) < 2 then raise exception 'Pick at least one other participant.'; end if;
  if array_length(v_ids, 1) > 100 then raise exception 'Too many participants.'; end if;
  select count(*) into v_bad from unnest(v_ids) x where not pulse_is_club_member(x, p_club_id);
  if v_bad > 0 then raise exception 'Every participant must be an ExCo of this CCA.'; end if;

  -- Several meetings per week are fine, but not an endless stream of them
  if (select count(*) from meeting_requests where club_id = p_club_id and week_start = p_week_start
                                              and status in ('COLLECTING', 'EXPIRED')) >= 5 then
    raise exception 'This CCA already has 5 open meeting requests for that week. Confirm or cancel one first.';
  end if;

  insert into meeting_requests (club_id, organiser_member_id, title, agenda, week_start, vote_deadline)
  values (p_club_id, v_me, v_title, v_agenda, p_week_start, p_vote_deadline)
  returning id into v_id;

  insert into meeting_participants (meeting_id, member_id)
  select v_id, x from unnest(v_ids) x;

  select full_name into v_organiser from members where id = v_me;
  foreach v_member in array v_ids loop
    continue when v_member = v_me;
    perform pulse_notify_meeting(v_member, p_club_id, 'MEETING_REQUEST',
      'Mark your availability: ' || v_title,
      v_organiser || ' is finding a time for "' || v_title || '" in the week of '
        || to_char(p_week_start, 'DD Mon') || '. Mark when you are free by '
        || to_char(p_vote_deadline at time zone 'Asia/Singapore', 'Dy DD Mon, HH24:MI') || '.'
        || coalesce(E'\n\nAgenda:\n' || left(v_agenda, 500), ''),
      v_id);
  end loop;

  return v_id;
end $$;

revoke all on function public.rpc_create_meeting(bigint, text, date, timestamptz, bigint[], text, bigint) from public;
grant execute on function public.rpc_create_meeting(bigint, text, date, timestamptz, bigint[], text, bigint) to anon, authenticated;

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
               'confirmed_end_hour', w.confirmed_end_hour)
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
