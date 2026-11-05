// Personal Schedule events (saved in Supabase, not this browser) and everyone's
// commitments for the meeting scheduler.
// Table + RPCs: supabase/migrations/20261106000100_pulse_personal_events.sql
// (personal_events, rpc_my_personal_events, rpc_save_personal_event,
//  rpc_delete_personal_event, rpc_club_commitments).
//
// Privacy is enforced by the database: rpc_club_commitments only returns a title
// for your own commitments. For anyone else it returns the time and the kind
// ('class' or 'busy') with title = null.

import { supabase } from '../supabase'
import { demoMemberId } from './sessionState'

async function call(name, args) {
  const response = await supabase.rpc(name, { ...args, p_demo_member_id: demoMemberId() })
  if (response.error) {
    throw new Error(response.error.message)
  }
  return response.data
}

// '18:30:00' -> '18:30'
function hhmm(time) {
  return String(time || '').slice(0, 5)
}

// Database row -> the shape PersonalScheduleView uses
function fromRow(r) {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    date: r.event_date,
    startTime: hhmm(r.start_time),
    endTime: hhmm(r.end_time),
    building: r.building || '',
    room: r.room || '',
    venue: r.venue || '',
    role: r.role || '',
    notes: r.notes || '',
    status: r.status || 'Not Started',
    isCustom: true
  }
}

// ---------------- Your own Personal Schedule events ----------------

export async function fetchMyPersonalEvents() {
  const rows = await call('rpc_my_personal_events', {})
  return (rows || []).map(fromRow)
}

// Creates the event or replaces it (same id). Returns the saved event.
export async function savePersonalEvent(ev) {
  const row = await call('rpc_save_personal_event', {
    p_event: {
      id: ev.id,
      title: ev.title,
      category: ev.category,
      event_date: ev.date,
      start_time: ev.startTime,
      end_time: ev.endTime,
      building: ev.building || null,
      room: ev.room || null,
      venue: ev.venue || null,
      role: ev.role || null,
      notes: ev.notes || null,
      status: ev.status || 'Not Started'
    }
  })
  return fromRow(row)
}

export function deletePersonalEvent(id) {
  return call('rpc_delete_personal_event', { p_id: id })
}

// ---------------- Everyone's commitments (meeting scheduler) ----------------

// Classes from timetables are NOT in here (those come from rpc_club_baselines / rpc_my_baseline).
// This covers Personal Schedule events and Day-of Ops tasks (meals and breaks left out),
// for everyone in the CCA, from `from` to `to` (inclusive, 'YYYY-MM-DD').
//
// Returns { 'memberId|YYYY-MM-DD': [{ startMin, endMin, kind: 'class' | 'busy', title }] }
// title is null for other people's commitments.
export async function fetchClubCommitments(clubId, from, to) {
  const rows = await call('rpc_club_commitments', { p_club_id: clubId, p_from: from, p_to: to })
  const byMemberDay = {}
  ;(rows || []).forEach((r) => {
    const key = `${r.member_id}|${r.slot_date}`
    if (!byMemberDay[key]) byMemberDay[key] = []
    byMemberDay[key].push({
      startMin: r.start_minute,
      endMin: r.end_minute,
      kind: r.kind === 'class' ? 'class' : 'busy',
      title: r.title || null
    })
  })
  return byMemberDay
}