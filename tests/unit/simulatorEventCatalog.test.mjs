// WHY THIS FILE IS RETAINED: Checks how saved events and Day-of Operations records are combined, deduplicated, and validated.
// These focused regression checks preserve edge cases that browser journeys may not isolate.
// SCOPE: Node unit tests using node:test; excluded from browser E2E commands.
// A passing result here does not prove a complete user journey or deployed backend enforcement.
// Purpose: isolated behaviour checks for the simulator data/presentation contract; no browser or live database is used.
﻿import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readUnifiedSimulationData,
  validateEventSources
} from '../../src/services/simulatorEventCatalogService.js'
const source = '00000000-0000-4000-8000-000000000001',
  task = '00000000-0000-4000-8000-000000000002'
function fixture() {
  return {
    events: [
      {
        id: 1,
        name: 'Real saved event',
        club_name: 'Club One',
        starts_at: '2026-11-02T01:00:00Z',
        ends_at: '2026-11-02T02:00:00Z'
      },
      {
        id: 100,
        name: 'Ops projection',
        club_name: 'Club One',
        starts_at: '2026-11-04T01:00:00Z',
        ends_at: '2026-11-04T02:00:00Z'
      }
    ],
    event_segments: [
      {
        id: 11,
        event_id: 1,
        title: 'Existing activity',
        segment_type: 'Crew',
        starts_at: '2026-11-02T01:00:00Z',
        ends_at: '2026-11-02T02:00:00Z'
      },
      { id: 201, event_id: 100, title: 'Derived activity' }
    ],
    segment_assignments: [
      {
        id: 21,
        segment_id: 11,
        member_id: 7,
        role_name: 'Stage Manager',
        is_required: true
      }
    ],
    segment_dependencies: [
      { prerequisite_segment_id: 11, dependent_segment_id: 201 }
    ],
    segment_facility_bookings: [{ segment_id: 11, booking_id: 41 }],
    ops_events: [
      {
        id: source,
        club_id: 1,
        name: 'Operations event',
        event_date: '2026-11-04',
        venue: 'Stage'
      }
    ],
    ops_tasks: [
      {
        id: task,
        event_id: source,
        member_id: 7,
        title: 'Saved Ops task',
        task_type: 'setup',
        start_time: '09:00:00',
        end_time: '10:00:00',
        is_fixed: false
      }
    ],
    ops_event_crew: [
      { event_id: source, member_id: 7, checked_in_at: null, late: null }
    ],
    members: [{ id: 7, full_name: 'Actual member' }],
    clubs: [{ id: 1, name: 'Club One', short_name: 'ONE' }]
  }
}
function client(
  tables = fixture(),
  { catalog, errorTable, contextMissing = false, catalogError = false } = {}
) {
  const calls = []
  return {
    calls,
    from(table) {
      let filters = [],
        columns = '*',
        orders = []
      return {
        select(value) {
          columns = value
          return this
        },
        in(field, values) {
          calls.push({ table, field, values })
          filters.push((row) =>
            values.some((v) => String(v) === String(row[field]))
          )
          return this
        },
        order(field) {
          orders.push(field)
          return this
        },
        async range(start, end) {
          if (table === errorTable)
            return { error: { message: 'Permission denied' } }
          let rows = (tables[table] || []).filter((row) =>
            filters.every((f) => f(row))
          )
          rows.sort((a, b) => {
            for (const field of orders) {
              if (a[field] < b[field]) return -1
              if (a[field] > b[field]) return 1
            }
            return 0
          })
          return {
            data: rows.slice(start, end + 1).map((r) =>
              columns === '*'
                ? { ...r }
                : Object.fromEntries(
                    columns
                      .split(',')
                      .map((c) => c.trim())
                      .map((c) => [c, r[c]])
                  )
            ),
            count: rows.length,
            error: null
          }
        }
      }
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args })
      if (name === 'rpc_simulator_event_sources' && catalogError)
        return { error: { message: 'Catalog permission denied' } }
      if (name === 'rpc_simulator_event_sources')
        return {
          data: catalog || {
            contract_version: 1,
            links: [
              {
                event_id: 100,
                ops_event_id: source,
                source_event_uuid: source,
                archived: false
              }
            ]
          },
          error: null
        }
      if (name === 'rpc_simulator_ops_context')
        return contextMissing
          ? { error: { code: 'PGRST202', message: 'Missing RPC' } }
          : {
              data: {
                contract_version: 1,
                event_links: [
                  {
                    ops_event_id: source,
                    event_id: 100,
                    starts_at: '2026-11-04T01:00:00Z',
                    ends_at: '2026-11-04T02:00:00Z'
                  }
                ],
                task_links: [
                  {
                    ops_task_id: task,
                    event_id: 100,
                    segment_id: 201,
                    assignment_id: 202
                  }
                ],
                dependencies: [],
                booking_links: []
              },
              error: null
            }
      if (
        ['rpc_simulator_ops_roster', 'rpc_simulator_event_roster'].includes(
          name
        )
      )
        return {
          data: {
            event_id: args.p_event_id,
            club_id: 1,
            members: [
              {
                member_id: 7,
                club_id: 1,
                full_name: 'Actual member',
                academic_year: '2026/27'
              }
            ]
          },
          error: null
        }
      throw Error('Unexpected RPC ' + name)
    }
  }
}
test('both real event sources load once with original identities and related records', async () => {
  const db = client(),
    data = await readUnifiedSimulationData(db)
  assert.deepEqual(
    data.events.map((e) => e.id),
    [100, 1]
  )
  assert.equal(
    data.events.find((e) => e.id === 100).recovery_target,
    'ops_tasks'
  )
  assert.equal(
    data.events.find((e) => e.id === 1).recovery_target,
    'event_records'
  )
  assert.equal(data.events.find((e) => e.id === 1).source_table, 'events')
  assert.equal(data.event_segments.length, 2)
  assert.equal(
    data.segment_assignments.find((a) => a.id === 21).role_name,
    'Stage Manager'
  )
  assert.deepEqual(data.segment_facility_bookings, [
    { segment_id: 11, booking_id: 41 }
  ])
  assert.deepEqual(data.segment_dependencies, [
    { prerequisite_segment_id: 11, dependent_segment_id: 201 }
  ])
  assert.equal(data.replacement_memberships.length, 1)
  assert.equal(
    data.member_replacement_coverage.byEvent['1'].rosterVerified,
    true
  )
  assert.ok(
    data.integration_notices.some(
      (n) => n.event_id === 1 && n.message.includes('not linked to Day Ops')
    )
  )
})
test('empty Day Ops does not hide accessible event records', async () => {
  const tables = fixture()
  tables.ops_events = []
  tables.ops_tasks = []
  tables.ops_event_crew = []
  const data = await readUnifiedSimulationData(client(tables))
  assert.deepEqual(
    data.events.map((e) => e.id),
    [1]
  )
})
test('a matching name never creates an association or deduplicates real events', async () => {
  const tables = fixture()
  tables.events[0].name = tables.ops_events[0].name
  const data = await readUnifiedSimulationData(client(tables))
  assert.equal(data.events.length, 2)
  assert.equal(data.events[1].day_ops_linked, false)
})
test('archived Ops projections cannot reappear as standalone events', async () => {
  const tables = fixture()
  tables.ops_events = []
  tables.ops_tasks = []
  tables.ops_event_crew = []
  const data = await readUnifiedSimulationData(
    client(tables, {
      catalog: {
        contract_version: 1,
        links: [
          {
            event_id: 100,
            ops_event_id: null,
            source_event_uuid: source,
            archived: true
          }
        ]
      }
    })
  )
  assert.deepEqual(
    data.events.map((e) => e.id),
    [1]
  )
})
test('Ops-only accounts retain their event and empty accounts fail honestly', async () => {
  const tables = fixture()
  tables.events = []
  const data = await readUnifiedSimulationData(client(tables))
  assert.equal(data.events.length, 1)
  assert.equal(data.events[0].id, 100)
  tables.ops_events = []
  await assert.rejects(
    readUnifiedSimulationData(client(tables)),
    /No events are accessible/
  )
})
test('missing permissions and malformed mapping catalogs do not become partial success', async () => {
  await assert.rejects(
    readUnifiedSimulationData(client(fixture(), { errorTable: 'events' })),
    /Permission denied/
  )
  await assert.rejects(
    readUnifiedSimulationData(client(fixture(), { catalogError: true })),
    /Catalog permission denied/
  )
  await assert.rejects(
    readUnifiedSimulationData(
      client(fixture(), { catalog: { contract_version: 1 } })
    ),
    /catalog.*incomplete/
  )
  const entry = {
    event_id: 100,
    ops_event_id: source,
    source_event_uuid: source,
    archived: false
  }
  assert.throws(
    () => validateEventSources({ contract_version: 1, links: [entry, entry] }),
    /Ambiguous/
  )
  assert.throws(
    () =>
      validateEventSources({
        contract_version: 1,
        links: [{ ...entry, source_event_uuid: 'not-a-uuid' }]
      }),
    /Ambiguous/
  )
})
test('UUID preview IDs never reach bigint dependency/booking filters', async () => {
  const db = client(fixture(), { contextMissing: true })
  const data = await readUnifiedSimulationData(db)
  assert.deepEqual(
    data.events.map((e) => e.id),
    [source, 1]
  )
  assert.equal(data.events[0].recovery_integration_ready, false)
  assert.ok(
    db.calls
      .filter((c) =>
        ['segment_dependencies', 'segment_facility_bookings'].includes(c.table)
      )
      .every((c) => c.values.every((v) => /^[0-9]+$/.test(String(v))))
  )
})
test('mismatched persisted mappings fail before allowing the wrong recovery target', async () => {
  await assert.rejects(
    readUnifiedSimulationData(
      client(fixture(), { catalog: { contract_version: 1, links: [] } })
    ),
    /mappings changed/
  )
})
