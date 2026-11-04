// Purpose: Combine both real event sources using verified stable mappings, retaining independent events and archived-source exclusions.
﻿/** Unified, read-only event data. Both tables can contain real events. Exact
 * server mappings identify Ops projections; names and dates never merge rows. */
import { readSimulatorRows } from './simulatorPaginationService.js'
import { readOpsSimulationData } from './simulatorOpsDataService.js'
import { loadEventReplacementRosters } from './simulatorRosterService.js'
const key = (value) => String(value)
const unique = (rows, identity) => [
  ...new Map(rows.map((row) => [identity(row), row])).values()
]
const uuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value)
  )
const numeric = (value) =>
  /^[1-9][0-9]*$/.test(String(value)) &&
  (typeof value !== 'number' || Number.isSafeInteger(value))

// Reject malformed, duplicated or ambiguous server mappings before combining event sources.
export function validateEventSources(data) {
  if (data?.contract_version !== 1 || !Array.isArray(data.links))
    throw Error(
      'Event source catalog is unavailable or incomplete. Refresh after backend verification.'
    )
  const events = new Set(),
    sources = new Set()
  for (const link of data.links) {
    if (
      !numeric(link.event_id) ||
      !uuid(link.source_event_uuid) ||
      typeof link.archived !== 'boolean' ||
      (link.archived
        ? link.ops_event_id !== null
        : link.ops_event_id !== link.source_event_uuid) ||
      events.has(key(link.event_id)) ||
      sources.has(link.source_event_uuid.toLowerCase())
    )
      throw Error('Ambiguous event source mappings. Refresh before continuing.')
    events.add(key(link.event_id))
    sources.add(link.source_event_uuid.toLowerCase())
  }
  return data.links
}

export async function readUnifiedSimulationData(client) {
  // Read both authoritative sources, rather than treating one as a fallback for
  // a failed read. An empty permitted dataset is valid; a denied query is not.
  const [stored, ops, response] = await Promise.all([
    readSimulatorRows(client, 'events'),
    readOpsSimulationData(client, { allowEmpty: true }),
    client.rpc('rpc_simulator_event_sources', {})
  ])
  if (response.error)
    throw Error(
      'Could not verify event source links: ' + response.error.message
    )
  const links = validateEventSources(response.data)
  const mappedIds = new Set(links.map((l) => key(l.event_id)))
  const standalone = stored.filter((event) => !mappedIds.has(key(event.id)))
  for (const event of ops.events) {
    const link = links.find((l) => l.ops_event_id === event.source_id)
    if (
      event.recovery_integration_ready &&
      (!link || key(link.event_id) !== key(event.id))
    )
      throw Error('Day Ops mappings changed while loading. Refresh event data.')
  }
  const [roster, segments] = await Promise.all([
    loadEventReplacementRosters(client, standalone),
    standalone.length
      ? readSimulatorRows(client, 'event_segments', (q) =>
          q.in(
            'event_id',
            standalone.map((e) => e.id)
          )
        )
      : []
  ])
  const segmentIds = segments.map((s) => s.id)
  const allSegments = [
    ...ops.event_segments,
    ...segments.map((s) => ({ ...s, source_table: 'event_segments' }))
  ]
  if (new Set(allSegments.map((s) => key(s.id))).size !== allSegments.length)
    throw Error(
      'An activity appears in multiple event sources. Refresh verified mappings.'
    )
  const allSegmentIds = allSegments.map((s) => s.id)
  // UUID-only previews have no bigint booking/dependency rows yet. Never send
  // those UUIDs to bigint filters or infer a mapping for them.
  const persistedSegmentIds = allSegmentIds.filter(numeric)
  const [assignments, dependencies, bookings] = await Promise.all([
    segmentIds.length
      ? readSimulatorRows(client, 'segment_assignments', (q) =>
          q.in('segment_id', segmentIds)
        )
      : [],
    persistedSegmentIds.length
      ? readSimulatorRows(client, 'segment_dependencies', (q) =>
          q.in('prerequisite_segment_id', persistedSegmentIds)
        )
      : [],
    persistedSegmentIds.length
      ? readSimulatorRows(client, 'segment_facility_bookings', (q) =>
          q.in('segment_id', persistedSegmentIds)
        )
      : []
  ])
  const memberIds = [...new Set(assignments.map((a) => a.member_id))]
  const assigned = memberIds.length
    ? await readSimulatorRows(
        client,
        'members',
        (q) => q.in('id', memberIds),
        'id,full_name'
      )
    : []
  const events = [
    ...ops.events.map((e) => ({
      ...e,
      day_ops_linked: links.some((l) => l.ops_event_id === e.source_id),
      recovery_target: 'ops_tasks'
    })),
    ...roster.events.map((e) => ({
      ...e,
      source_table: 'events',
      source_id: e.id,
      day_ops_linked: false,
      recovery_target: 'event_records'
    }))
  ]
  if (!events.length)
    throw Error(
      'No events are accessible to this account. Check event permissions and active club membership.'
    )
  const byEvent = {
    ...ops.member_replacement_coverage.byEvent,
    ...roster.member_replacement_coverage.byEvent
  }
  const known = new Set(allSegmentIds.map(key))
  const facilityLinks = unique(
    [...ops.segment_facility_bookings, ...bookings],
    (l) => key(l.segment_id) + ':' + key(l.booking_id)
  )
  return {
    ...ops,
    source: 'supabase',
    events,
    event_segments: allSegments,
    segment_assignments: [...ops.segment_assignments, ...assignments],
    members: unique([...ops.members, ...assigned, ...roster.members], (m) =>
      key(m.id)
    ),
    replacement_memberships: unique(
      [...ops.replacement_memberships, ...roster.replacement_memberships],
      (m) => JSON.stringify([key(m.memberId), key(m.clubId), m.academicYear])
    ),
    member_replacement_coverage: {
      byEvent,
      rosterVerified: Object.values(byEvent).every((c) => c.rosterVerified),
      scheduleVerified: false
    },
    // Only stored edges between loaded activities are visible. This also retains
    // real dependencies crossing the two sources, rather than inferring new ones.
    segment_dependencies: unique(
      [...ops.segment_dependencies, ...dependencies],
      (d) => key(d.prerequisite_segment_id) + ':' + key(d.dependent_segment_id)
    ).filter(
      (d) =>
        known.has(key(d.prerequisite_segment_id)) &&
        known.has(key(d.dependent_segment_id))
    ),
    segment_facility_bookings: facilityLinks,
    segment_facility_slots: facilityLinks.map((l) => ({
      ...l,
      facility_slot_id: l.booking_id
    })),
    integration_notices: [
      ...ops.integration_notices,
      ...standalone.map((e) => ({
        event_id: e.id,
        message:
          'This saved event is not linked to Day Ops. Apply/Undo updates its event activities and assignments, not Day Ops tasks.'
      }))
    ]
  }
}
