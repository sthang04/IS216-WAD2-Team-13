/**
 * Adapt live Day Ops records to the simulator's established engine shape.
 * This module never saves a scenario, edits an operations task, or guesses a
 * dependency/booking. source_id / ops_task_id always preserve the real UUID.
 */
import { readSimulatorRows } from './simulatorPaginationService.js'
import { loadEventReplacementRosters } from './simulatorRosterService.js'

const same = (a, b) => a != null && b != null && String(a) === String(b)
const uuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value)
  )
const numericId = (value) => {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw Error('Unsafe numeric ID received from Day Ops.')
  if (!/^[1-9][0-9]*$/.test(String(value)))
    throw Error('Invalid persisted member or mapping ID.')
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : String(value)
}
const mappedId = (value) => value != null && /^[1-9][0-9]*$/.test(String(value))
const unique = (rows, key, label) => {
  const seen = new Set()
  for (const row of rows) {
    const id = key(row)
    if (seen.has(id))
      throw Error('Duplicate ' + label + ' record. Refresh Day Ops data.')
    seen.add(id)
  }
}

/** Combine a persisted date and time without using the browser's timezone.
 * Keep PostgreSQL fractional seconds intact for later snapshot comparison. */
export function opsTaskTimestamp(day, time) {
  const date = String(day || ''),
    clock = String(time || '')
  // PostgreSQL time accepts 24:00 as the exact end of the event day.
  if (/^24:00(?::00(?:\.0{1,6})?)?$/.test(clock)) {
    opsTaskTimestamp(date, '00:00:00')
    return (
      new Date(Date.parse(date + 'T00:00:00Z') + 86400000)
        .toISOString()
        .slice(0, 10) + 'T00:00:00+08:00'
    )
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(clock)
  )
    throw Error('Day Ops task has an invalid date or time.')
  const value =
    date + 'T' + clock + (clock.length === 5 ? ':00' : '') + '+08:00'
  if (
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(date + 'T00:00:00+08:00') + 28800000)
      .toISOString()
      .slice(0, 10) !== date
  )
    throw Error('Day Ops task has an invalid calendar date.')
  return value
}

/** Day Ops supports one calendar day, including its exact 24:00 boundary. */
export function opsPeriodOnEventDate(day, start, end) {
  const first = Date.parse(day + 'T00:00:00+08:00'),
    last = first + 86400000,
    a = Date.parse(start),
    b = Date.parse(end)
  const fraction = String(end).match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] || ''
  return (
    Number.isFinite(first) &&
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    a >= first &&
    a < last &&
    b > a &&
    b <= last &&
    !(b === last && /[1-9]/.test(fraction))
  )
}

/** Pure conversion, also usable by local contract checks without Supabase.
 * Numeric engine IDs are used only when the deployed bridge proves the exact
 * task/event mappings. Otherwise real UUIDs support safe read-only previews. */
export function adaptOpsSimulationData({
  events = [],
  tasks = [],
  crew = [],
  members = [],
  clubs = [],
  context = null
}) {
  unique(events, (e) => String(e.id), 'operations event')
  unique(tasks, (t) => String(t.id), 'operations task')
  unique(
    crew,
    (c) => String(c.event_id) + ':' + String(c.member_id),
    'event crew'
  )
  const crewKeys = new Set(
    crew.map((c) => String(c.event_id) + ':' + String(c.member_id))
  )
  const knownEvents = new Set(events.map((e) => String(e.id)))
  const eventLinks =
    context?.contract_version === 1 ? context.event_links || [] : []
  const taskLinks =
    context?.contract_version === 1 ? context.task_links || [] : []
  unique(eventLinks, (e) => String(e.ops_event_id), 'event mapping')
  unique(taskLinks, (t) => String(t.ops_task_id), 'task mapping')
  unique(eventLinks, (e) => String(e.event_id), 'mapped event')
  unique(taskLinks, (t) => String(t.segment_id), 'mapped activity')
  unique(taskLinks, (t) => String(t.assignment_id), 'mapped assignment')
  const eventMap = new Map(),
    normalizedEvents = [],
    segments = [],
    assignments = [],
    notices = []
  for (const event of events) {
    if (!uuid(event.id))
      throw Error('Day Ops event is missing its persisted UUID.')
    const rows = tasks.filter((t) => same(t.event_id, event.id)),
      link = eventLinks.find((l) => same(l.ops_event_id, event.id))
    // A partially migrated event must not mix UUID tasks with unrelated numeric
    // records. Require a complete one-to-one mapping before enabling writes.
    const ready =
      mappedId(link?.event_id) &&
      rows.every((t) => {
        const l = taskLinks.find((l) => same(l.ops_task_id, t.id))
        return (
          l &&
          same(l.event_id, link.event_id) &&
          mappedId(l.segment_id) &&
          mappedId(l.assignment_id)
        )
      })
    const id = ready ? numericId(link.event_id) : event.id
    const club = clubs.find((c) => same(c.id, event.club_id))
    eventMap.set(String(event.id), id)
    const normalized = {
      id,
      source_table: 'ops_events',
      source_id: event.id,
      club_id: numericId(event.club_id),
      club_name: club?.name || null,
      name: event.name,
      event_date: event.event_date,
      venue_name: event.venue || null,
      recovery_integration_ready: ready,
      starts_at: null,
      ends_at: null
    }
    for (const task of rows) {
      if (
        !uuid(task.id) ||
        !crewKeys.has(String(event.id) + ':' + String(task.member_id))
      )
        throw Error(
          'Day Ops task is not linked to its event crew. Refresh before simulating.'
        )
      const starts_at = opsTaskTimestamp(event.event_date, task.start_time),
        ends_at = opsTaskTimestamp(event.event_date, task.end_time)
      if (Date.parse(starts_at) >= Date.parse(ends_at))
        throw Error('Day Ops task must finish after it starts.')
      const mapping = ready
        ? taskLinks.find((l) => same(l.ops_task_id, task.id))
        : null
      const segmentId = mapping ? numericId(mapping.segment_id) : task.id
      segments.push({
        id: segmentId,
        event_id: id,
        title: task.title,
        segment_type: task.task_type,
        starts_at,
        ends_at,
        venue_name: task.venue || event.venue || null,
        is_fixed: task.is_fixed === true,
        source_table: 'ops_tasks',
        ops_task_id: task.id
      })
      // task_type is recorded task-category experience, not a qualification or a
      // crew member's job title. Availability/role suitability still need review.
      assignments.push({
        id: mapping ? numericId(mapping.assignment_id) : task.id,
        segment_id: segmentId,
        member_id: numericId(task.member_id),
        role_name: task.task_type,
        is_required: true,
        ops_task_id: task.id
      })
      if (
        !normalized.starts_at ||
        Date.parse(starts_at) < Date.parse(normalized.starts_at)
      )
        normalized.starts_at = starts_at
      if (
        !normalized.ends_at ||
        Date.parse(ends_at) > Date.parse(normalized.ends_at)
      )
        normalized.ends_at = ends_at
    }
    if (!rows.length)
      notices.push({
        event_id: id,
        message:
          'No saved Day Ops tasks exist for this event. Add tasks in Day Ops before simulating.'
      })
    if (!ready)
      notices.push({
        event_id: id,
        message:
          'Day Ops tasks are live. Recovery updates are unavailable until the operations integration has been deployed and verified.'
      })
    // Recovery may extend the legacy event bounds beyond the first/last task.
    // Preserve the exact server bounds so the capture cannot silently rebase.
    if (ready && rows.length && link.starts_at && link.ends_at) {
      normalized.starts_at = link.starts_at
      normalized.ends_at = link.ends_at
    }
    normalizedEvents.push(normalized)
  }
  if (tasks.some((t) => !knownEvents.has(String(t.event_id))))
    throw Error('Operations task references an inaccessible event.')
  // Only stored edges and exact booking references from the reviewed bridge are
  // accepted. Sequential task times and matching room names never create links.
  const segmentIds = new Set(segments.map((s) => String(s.id)))
  const dependencies = (context?.dependencies || [])
    .filter(
      (d) =>
        segmentIds.has(String(d.prerequisite_segment_id)) &&
        segmentIds.has(String(d.dependent_segment_id))
    )
    .map((d) => ({
      prerequisite_segment_id: numericId(d.prerequisite_segment_id),
      dependent_segment_id: numericId(d.dependent_segment_id)
    }))
  const links = (context?.booking_links || [])
    .filter((l) => segmentIds.has(String(l.segment_id)))
    .map((l) => ({
      segment_id: numericId(l.segment_id),
      booking_id: numericId(l.booking_id)
    }))
  return {
    source: 'ops',
    events: normalizedEvents,
    event_segments: segments,
    segment_assignments: assignments,
    segment_dependencies: dependencies,
    segment_facility_bookings: links,
    segment_facility_slots: links.map((l) => ({
      ...l,
      facility_slot_id: l.booking_id
    })),
    members: members.map((m) => ({
      id: numericId(m.id),
      full_name: m.full_name
    })),
    ops_event_crew: crew.map((c) => ({
      ...c,
      event_id: eventMap.get(String(c.event_id)),
      member_id: numericId(c.member_id)
    })),
    integration_notices: notices
  }
}

/** Read the same three canonical tables as opsService, preserving RLS and full
 * pagination. No guest sample plan, browser storage, or legacy demo fallback. */
export async function readOpsSimulationData(client) {
  // Step 1: read saved operations records. Empty or failed live reads stay honest.
  const events = await readSimulatorRows(
    client,
    'ops_events',
    undefined,
    'id,club_id,name,event_date,venue'
  )
  if (!events.length)
    throw Error(
      'No accessible Day Ops events found. Create an event in Day Ops or check club permissions.'
    )
  const ids = events.map((e) => e.id),
    clubIds = [...new Set(events.map((e) => e.club_id))]
  const [tasks, crew, clubs] = await Promise.all([
    readSimulatorRows(
      client,
      'ops_tasks',
      (q) => q.in('event_id', ids),
      'id,event_id,member_id,title,task_type,start_time,end_time,venue,is_fixed'
    ),
    readSimulatorRows(
      client,
      'ops_event_crew',
      (q) => q.in('event_id', ids),
      'event_id,member_id,checked_in_at,late'
    ),
    readSimulatorRows(
      client,
      'clubs',
      (q) => q.in('id', clubIds),
      'id,name,short_name'
    )
  ])
  const memberIds = [...new Set(crew.map((c) => c.member_id))]
  const members = memberIds.length
    ? await readSimulatorRows(
        client,
        'members',
        (q) => q.in('id', memberIds),
        'id,full_name'
      )
    : []
  // Step 2: discover exact compatibility mappings. Only a missing RPC is an
  // undeployed integration; denied or failed reads must not become fake success.
  const { data: context, error } = await client.rpc(
    'rpc_simulator_ops_context',
    {}
  )
  if (error && !['PGRST202', '42883'].includes(error.code))
    throw Error('Could not verify Day Ops integration: ' + error.message)
  if (
    !error &&
    (!context ||
      context.contract_version !== 1 ||
      !['event_links', 'task_links', 'dependencies', 'booking_links'].every(
        (k) => Array.isArray(context[k])
      ))
  )
    throw Error(
      'Incomplete Day Ops integration response. Refresh before continuing.'
    )
  const result = adaptOpsSimulationData({
    events,
    tasks,
    crew,
    members,
    clubs,
    context: error ? null : context
  })
  // Step 3: use the FK-based, authorized Ops roster only for mapped events.
  // Event crew alone is not evidence of complete current replacement membership.
  const mapped = result.events.filter((e) => e.recovery_integration_ready)
  const roster = await loadEventReplacementRosters(client, mapped, {
    rpcName: 'rpc_simulator_ops_roster'
  })
  result.members = [
    ...new Map(
      [...result.members, ...roster.members].map((m) => [String(m.id), m])
    ).values()
  ]
  result.replacement_memberships = roster.replacement_memberships
  const byEvent = { ...roster.member_replacement_coverage.byEvent }
  for (const e of result.events)
    if (!e.recovery_integration_ready)
      byEvent[String(e.id)] = {
        rosterVerified: false,
        scheduleVerified: false,
        warning:
          'The live event crew is loaded. Replacement membership and recovery updates require the reviewed operations integration.'
      }
  result.member_replacement_coverage = {
    ...roster.member_replacement_coverage,
    byEvent,
    rosterVerified: Object.values(byEvent).every((c) => c.rosterVerified),
    scheduleVerified: false
  }
  return result
}
