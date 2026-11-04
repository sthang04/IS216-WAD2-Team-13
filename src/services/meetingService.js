// Weekly Meeting Scheduler: meeting requests, availability votes and timetables.
// Every change goes through an rpc_* function, which checks who you are, your CCA,
// the voting deadline and the meeting status
// (supabase/migrations/20261103000200_pulse_meeting_scheduler.sql).

import { supabase } from '../supabase'
import { demoMemberId } from './sessionState'

async function call(name, args) {
  const response = await supabase.rpc(name, { ...args, p_demo_member_id: demoMemberId() })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}

// { meeting, participants, availability } for one week of a CCA, or for one meeting id
// (Telegram links open /availability?meeting=ID). meeting is null when there is none.
export function fetchMeetingSnapshot({ clubId, weekStart, meetingId = null }) {
  return call('rpc_meeting_snapshot', { p_club_id: clubId, p_week_start: weekStart, p_meeting_id: meetingId })
}

// Everyone in the CCA, for picking participants
export function fetchClubRoster(clubId) {
  return call('rpc_club_roster', { p_club_id: clubId })
}

export function createMeeting({ clubId, title, weekStart, voteDeadline, memberIds }) {
  return call('rpc_create_meeting', {
    p_club_id: clubId,
    p_title: title,
    p_week_start: weekStart,
    p_vote_deadline: voteDeadline,
    p_member_ids: memberIds
  })
}

export function setAvailability(meetingId, slotDate, hour, available) {
  return call('rpc_set_meeting_availability', {
    p_meeting_id: meetingId, p_slot_date: slotDate, p_hour: hour, p_available: available
  })
}

export function submitNoAvailability(meetingId) {
  return call('rpc_submit_no_availability', { p_meeting_id: meetingId })
}

// memberId null = everyone who hasn't answered. Returns how many were nudged.
export function nudgeParticipants(meetingId, memberId = null) {
  return call('rpc_nudge_meeting', { p_meeting_id: meetingId, p_member_id: memberId })
}

export function confirmMeeting(meetingId, { date, startHour, endHour, venue }) {
  return call('rpc_confirm_meeting', {
    p_meeting_id: meetingId, p_date: date, p_start_hour: startHour, p_end_hour: endHour, p_venue: venue
  })
}

export function cancelMeeting(meetingId) {
  return call('rpc_cancel_meeting', { p_meeting_id: meetingId })
}

// ---------------- Timetables ----------------

// Your own timetable, with titles: [{ title, start, end, rrule, exdates }] + the file name
export async function fetchMyBaseline() {
  const rows = await call('rpc_my_baseline', {})
  return {
    fileName: rows.length ? rows[0].source_file : '',
    events: rows.map((r) => ({ title: r.title, start: r.start_ms, end: r.end_ms, rrule: r.rrule, exdates: r.exdates || [] }))
  }
}

// Everyone else in the CCA: busy times only (no titles), grouped by member id
export async function fetchClubBaselines(clubId) {
  const rows = await call('rpc_club_baselines', { p_club_id: clubId })
  const byMember = {}
  rows.forEach((r) => {
    if (!byMember[r.member_id]) byMember[r.member_id] = []
    byMember[r.member_id].push({ title: 'Class', start: r.start_ms, end: r.end_ms, rrule: r.rrule, exdates: r.exdates || [] })
  })
  return byMember
}

export function saveMyBaseline(events, fileName) {
  return call('rpc_save_my_baseline', { p_events: events, p_file_name: fileName })
}

export function clearMyBaseline() {
  return call('rpc_clear_my_baseline', {})
}

// ---------------- Live updates ----------------

// Runs onChange when a meeting of this CCA, its participants or its votes change.
// Returns a function that stops listening.
export function listenForMeetings(clubId, meetingId, onChange) {
  let channel = supabase
    .channel('meetings-' + clubId + '-' + (meetingId || 'none'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_requests', filter: 'club_id=eq.' + clubId }, onChange)
  if (meetingId) {
    channel = channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_participants', filter: 'meeting_id=eq.' + meetingId }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_availability', filter: 'meeting_id=eq.' + meetingId }, onChange)
  }
  channel.subscribe()

  function stopListening() {
    supabase.removeChannel(channel)
  }
  return stopListening
}
