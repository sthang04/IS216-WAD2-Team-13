// Day-of Operations: reading and saving a CCA's events, crew and tasks.
// Tables: ops_events, ops_event_crew, ops_tasks (supabase/migrations/20261104000100_pulse_ops_events.sql,
// event start/end times in 20261104000200_pulse_ops_event_times.sql).
// The database only lets active ExCos of the event's CCA read or change them.

import { supabase } from '../supabase'

// Supabase returns { data, error }: throw the error, otherwise give back the rows
function unwrap(response) {
  if (response.error) {
    throw response.error
  }
  return response.data
}

// True when the error means the ops tables haven't been created yet
export function isMissingTableError(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

// '18:30:00' -> 1110 (minutes after midnight), and back
function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

// The CCA's active ExCos: who can be put on an event's crew
export async function loadClubExcos(clubId) {
  const rows = unwrap(await supabase
    .from('v_user_club_memberships')
    .select('member_id, full_name, role_name, telegram_handle, membership_is_active')
    .eq('club_id', clubId)
    .order('full_name'))

  return rows
    .filter((row) => row.membership_is_active !== false)
    .map((row) => ({
      memberId: Number(row.member_id),
      name: row.full_name,
      role: row.role_name || 'ExCo',
      phone: row.telegram_handle || ''
    }))
}

// False until 20261104000200 has been run (ops_events has no start/end time yet)
let hasEventTimes = true

// '42703' / 'PGRST204': the column doesn't exist
function isMissingColumnError(error) {
  return error?.code === '42703' || error?.code === 'PGRST204'
}

function selectEvents(clubId) {
  // The !name picks which link to follow (tasks also link to crew, so there's more than one path)
  const eventColumns = hasEventTimes ? 'id, name, event_date, venue, start_time, end_time' : 'id, name, event_date, venue'
  return supabase
    .from('ops_events')
    .select(`${eventColumns}, ops_event_crew!ops_event_crew_event_id_fkey(member_id, checked_in_at, late), ops_tasks!ops_tasks_event_id_fkey(id, member_id, title, task_type, start_time, end_time, venue, is_fixed)`)
    .eq('club_id', clubId)
    .order('event_date')
}

// All of a CCA's events, in the shape the page uses (times in minutes)
export async function loadEvents(clubId, excos) {
  let response = await selectEvents(clubId)
  if (hasEventTimes && isMissingColumnError(response.error)) {
    hasEventTimes = false
    response = await selectEvents(clubId)
  }
  const rows = unwrap(response)

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    date: row.event_date,
    venue: row.venue || '',
    start: row.start_time ? timeToMinutes(row.start_time) : null,
    end: row.end_time ? timeToMinutes(row.end_time) : null,
    crew: row.ops_event_crew.map((c) => {
      const exco = excos.find((e) => e.memberId === Number(c.member_id))
      return {
        memberId: Number(c.member_id),
        name: exco ? exco.name : 'Former ExCo',
        role: exco ? exco.role : '',
        phone: exco ? exco.phone : '',
        checkedInAt: c.checked_in_at ? timeToMinutes(c.checked_in_at) : null,
        late: c.late || '',
        blocks: row.ops_tasks
          .filter((t) => Number(t.member_id) === Number(c.member_id))
          .map((t) => ({
            id: t.id,
            start: timeToMinutes(t.start_time),
            end: timeToMinutes(t.end_time),
            title: t.title,
            type: t.task_type,
            venue: t.venue || '',
            fixed: t.is_fixed
          }))
      }
    })
  }))
}

// Save one event as it is now: details, crew (with check-ins) and tasks.
// Crew or tasks no longer on the page are removed.
// createdBy is only passed the first time, so later saves keep the original creator.
export async function saveEvent(clubId, event, createdBy = null) {
  const details = {
    id: event.id,
    club_id: clubId,
    name: event.name,
    event_date: event.date,
    venue: event.venue || null
  }
  if (hasEventTimes) {
    details.start_time = event.start == null ? null : minutesToTime(event.start)
    details.end_time = event.end == null ? null : minutesToTime(event.end)
  }
  if (createdBy !== null) details.created_by = createdBy
  unwrap(await supabase.from('ops_events').upsert(details))

  const memberIds = event.crew.map((p) => p.memberId)
  const taskIds = event.crew.flatMap((p) => p.blocks.map((b) => b.id))

  // Remove tasks first, then crew (removing crew also removes their tasks)
  let removeTasks = supabase.from('ops_tasks').delete().eq('event_id', event.id)
  if (taskIds.length) removeTasks = removeTasks.not('id', 'in', `(${taskIds.join(',')})`)
  unwrap(await removeTasks)

  let removeCrew = supabase.from('ops_event_crew').delete().eq('event_id', event.id)
  if (memberIds.length) removeCrew = removeCrew.not('member_id', 'in', `(${memberIds.join(',')})`)
  unwrap(await removeCrew)

  if (memberIds.length) {
    unwrap(await supabase.from('ops_event_crew').upsert(event.crew.map((p) => ({
      event_id: event.id,
      member_id: p.memberId,
      checked_in_at: p.checkedInAt === null ? null : minutesToTime(p.checkedInAt),
      late: p.late || null
    })), { onConflict: 'event_id,member_id' }))
  }

  if (taskIds.length) {
    unwrap(await supabase.from('ops_tasks').upsert(event.crew.flatMap((p) => p.blocks.map((b) => ({
      id: b.id,
      event_id: event.id,
      member_id: p.memberId,
      title: b.title,
      task_type: b.type,
      start_time: minutesToTime(b.start),
      end_time: minutesToTime(b.end),
      venue: b.venue || null,
      is_fixed: b.fixed
    })))))
  }
}

export async function deleteEvent(eventId) {
  unwrap(await supabase.from('ops_events').delete().eq('id', eventId))
}
