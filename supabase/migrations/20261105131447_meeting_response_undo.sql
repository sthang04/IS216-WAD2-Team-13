-- Let a participant undo their response while voting is open.
create or replace function public.rpc_clear_meeting_response(
  p_meeting_id bigint, p_demo_member_id bigint default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me bigint := current_member_id(p_demo_member_id);
  v_meeting public.meeting_requests;
begin
  perform pulse_expire_meeting_polls();
  perform pulse_meeting_for_member(p_meeting_id, v_me);
  select * into v_meeting from public.meeting_requests where id = p_meeting_id for update;
  if not exists (select 1 from public.meeting_participants where meeting_id = p_meeting_id and member_id = v_me) then
    raise exception 'You are not a participant of this meeting.';
  end if;
  if v_meeting.status <> 'COLLECTING' or v_meeting.vote_deadline <= clock_timestamp() then
    raise exception 'Voting for this meeting has closed.';
  end if;
  delete from public.meeting_availability where meeting_id = p_meeting_id and member_id = v_me;
  update public.meeting_participants set responded_at = null
    where meeting_id = p_meeting_id and member_id = v_me;
end $$;
revoke all on function public.rpc_clear_meeting_response(bigint, bigint) from public;
grant execute on function public.rpc_clear_meeting_response(bigint, bigint) to anon, authenticated;