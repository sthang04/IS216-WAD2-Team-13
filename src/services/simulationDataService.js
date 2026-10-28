/*
  PULSE — WHAT-IF SIMULATOR DATA SERVICE

  PURPOSE:
  Load the data needed by the What-If Simulator.

  LOCAL MODE:
  - Uses our existing test data while event-table RLS is being prepared.

  SUPABASE MODE:
  - Uses the logged-in user's Supabase session.
  - Reads only records the database's RLS policies permit.
  - Includes facility bookings on the event dates to check clashes.

  IMPORTANT:
  - This service only performs SELECT queries.
  - It never changes real bookings, members, or event schedules.
  - It never bypasses RLS or uses a service-role key.
  - Live mode does NOT fall back to test data when a query fails.
*/

import { supabase, isSupabaseConfigured } from '../supabase'
import { getSimulationTestData } from '../data/simulationTestData.js'

// Supabase projects may limit how many rows one query returns.
// Fail clearly rather than running a simulation on a truncated result.
const MAX_ROWS = 1000

async function readRows(table, configureQuery) {
  let query = supabase.from(table).select('*').limit(MAX_ROWS)
  if (configureQuery) query = configureQuery(query)

  const { data, error } = await query

  if (error) {
    throw new Error(`Could not load ${table}: ${error.message}`)
  }

  if ((data?.length ?? 0) === MAX_ROWS) {
    throw new Error(
      `Too many ${table} records for this loader. Add pagination before using live mode.`
    )
  }

  return data ?? []
}

// Convert a timestamp to its Singapore calendar date (YYYY-MM-DD).
// Facility bookings use event_date rather than a timestamp.
function singaporeDate(timestamp) {
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid event timestamp: ${timestamp}`)
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)

  const value = type =>
    parts.find(part => part.type === type)?.value

  return `${value('year')}-${value('month')}-${value('day')}`
}

// ==========================================
// STEP 1: LOAD DATA FROM SUPABASE (READ-ONLY)
// ==========================================

export async function loadLiveSimulationData() {

  if (!isSupabaseConfigured() || !supabase) {
    throw new Error(
      'Supabase is not configured. Use local simulation mode for now.'
    )
  }

  // Check for a real Supabase Auth user.
  // A local demo or guest persona is not sufficient.
  const { data: authData, error: authError } =
    await supabase.auth.getUser()

  if (authError || !authData?.user) {
    throw new Error(
      'Please sign in with your Supabase ExCo account to use live data.'
    )
  }

  // RLS is responsible for restricting events to authorised CCAs.
  // We do not trust a client-side club name as an access-control check.
  const events = await readRows('events')

  if (events.length === 0) {
    throw new Error(
      'No events are accessible to this account. Check the event SELECT policies and CCA membership.'
    )
  }

  const eventIds = events.map(event => event.id)

  const eventSegments = await readRows(
    'event_segments',
    query => query.in('event_id', eventIds)
  )

  if (eventSegments.length === 0) {
    throw new Error(
      'No event activities are accessible. Check event_segments SELECT permissions or event data.'
    )
  }

  const segmentIds = eventSegments.map(segment => segment.id)

  // ==========================================
  // STEP 2: LOAD RELATED EVENT INFORMATION
  // ==========================================

  // Retrieve assignments, dependencies and facility links
  // belonging to the accessible event activities.
  const [assignments, dependencies, facilityLinks] =
    await Promise.all([

      readRows(
        'segment_assignments',
        query => query.in('segment_id', segmentIds)
      ),

      readRows(
        'segment_dependencies',
        query => query.in(
          'prerequisite_segment_id',
          segmentIds
        )
      ),

      readRows(
        'segment_facility_slots',
        query => query.in('segment_id', segmentIds)
      )

    ])

  // Retrieve assigned members instead of loading
  // the entire members table.
  const memberIds = [
    ...new Set(assignments.map(row => row.member_id))
  ]

  const members = memberIds.length
    ? await readRows(
        'members',
        query => query.in('id', memberIds)
      )
    : []

  // ==========================================
  // STEP 3: LOAD FACILITY BOOKINGS
  // ==========================================

  // Include bookings on relevant event dates.
  // These help identify possible clashes with other CCAs.
  //
  // The facility_slots RLS policy determines
  // which bookings the logged-in user can see.

  const dates = [
    ...events.flatMap(event => [
      event.starts_at,
      event.ends_at
    ]),

    ...eventSegments.flatMap(segment => [
      segment.starts_at,
      segment.ends_at
    ])

  ]
    .filter(Boolean)
    .map(singaporeDate)
    .sort()

  // Include one day on either side of the original schedule so that
  // common short recovery delays also have booking data to inspect.
  // Recovery options outside this window remain NEEDS_REVIEW.
  const coverageStart = dates.length
    ? new Date(Date.parse(`${dates[0]}T00:00:00Z`) - 86400000)
        .toISOString().slice(0, 10)
    : null
  const coverageEnd = dates.length
    ? new Date(Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) + 86400000)
        .toISOString().slice(0, 10)
    : null

  const facilitySlots = dates.length
    ? await readRows(
        'facility_slots',
        query => query
          .gte('event_date', coverageStart)
          .lte('event_date', coverageEnd)
      )
    : []

  // ==========================================
  // STEP 4: RETURN DATA TO THE SIMULATOR
  // ==========================================

  // Return the same data structure as simulationTestData.js.
  //
  // This allows simulationService.js to work with either
  // local test data or authorised Supabase data.

  return {
    events,
    members,
    event_segments: eventSegments,
    segment_assignments: assignments,
    segment_dependencies: dependencies,
    segment_facility_slots: facilityLinks,
    facility_slots: facilitySlots,
    // This is the query window, not a guarantee that RLS exposed
    // every CCA's reservation. RLS must be verified separately.
    facility_booking_coverage: {
      startDate: coverageStart,
      endDate: coverageEnd
    }
  }
}

// ==========================================
// STEP 5: CHOOSE THE DATA SOURCE
// ==========================================

// Default to local test data until the team
// approves the event-table SELECT policies.

export async function loadSimulationData({
  source = 'local'
} = {}) {

  // LOCAL MODE:
  // Continue testing the simulator without Supabase.
  if (source === 'local') {
    return getSimulationTestData()
  }

  // LIVE MODE:
  // Retrieve data using the authenticated Supabase client.
  if (source === 'supabase') {
    return loadLiveSimulationData()
  }

  // Prevent unsupported data-source values.
  throw new Error(
    `Unknown simulation data source: ${source}`
  )
}
