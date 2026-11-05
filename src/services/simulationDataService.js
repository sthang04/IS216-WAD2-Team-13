// Purpose: Read authorized live event, member and booking evidence; never replace a failed Supabase read with demo records.
/*
  PULSE — WHAT-IF SIMULATOR DATA SERVICE

  PURPOSE:
  Load the data needed by the What-If Simulator.

  TEST DATA:
  - Automated tests import fixtures directly; this loader never supplies them.

  SUPABASE MODE:
  - Uses the logged-in user's Supabase session.
  - Reads only records the database's RLS policies permit.
  - Includes facility bookings on the event dates to check clashes.

  IMPORTANT:
  - This service performs SELECT queries and the read-only roster RPC.
  - It never changes real bookings, members, or event schedules.
  - It uses the caller session, never a service-role key. The roster RPC performs explicit server authorization.
  - Live mode does NOT fall back to test data when a query fails.
*/

import { supabase, isSupabaseConfigured } from '../supabase'
import { readUnifiedSimulationData } from './simulatorEventCatalogService.js'
import { readSimulatorRows } from './simulatorPaginationService.js'


// Keep all simulator reads on the shared authenticated client. The helper
// verifies pagination/counts; it never assumes that a short page is complete.
async function readRows(table, configureQuery, columns = '*') {
  return readSimulatorRows(supabase, table, configureQuery, columns)
}

// Convert a timestamp to its Singapore calendar date (YYYY-MM-DD).
// Facility bookings use booking_date rather than a timestamp.
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

// Load only authorized live evidence. Read failures stay errors so incomplete
// records cannot quietly become an optimistic simulation or demo fallback.
export async function loadLiveSimulationData() {

  if (!isSupabaseConfigured() || !supabase) {
    throw new Error(
      'Supabase is not configured. Live event data cannot be loaded.'
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

  // Keep standalone event records visible alongside canonical Day Ops events.
  // Verified source mappings prevent a projection appearing as a second event.
  const operational = await readUnifiedSimulationData(supabase)
  const events = operational.events
  const eventSegments = operational.event_segments
  const facilityLinks = operational.segment_facility_bookings

  // ==========================================
  // STEP 3: LOAD FACILITY BOOKINGS
  // ==========================================

  // Include bookings on relevant event dates.
  // These help identify possible clashes with other CCAs.
  //
  // The facility_bookings RLS policy determines
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

  // Shared master-calendar schema introduced by the main branch.
  // Fetch facilities separately so we do not depend on PostgREST FK joins.
  const [bookings, facilities] = await Promise.all([
    dates.length
      ? readRows('facility_bookings', query => query
          .gte('booking_date', coverageStart)
          .lte('booking_date', coverageEnd))
      : Promise.resolve([]),
    readRows('facilities',query=>query.eq('is_active',true))
  ])

  const facilitiesById = new Map(
    facilities.map(facility => [String(facility.id), facility])
  )

  // Preserve the legacy shape consumed by the simulation/recovery services.
  // Keep the actual booking and facility IDs for future write operations.
  const facilitySlots = bookings.map(booking => {
    const facility = facilitiesById.get(String(booking.facility_id))
    // Keep legacy HH:mm display compatibility; raw calendar fields above retain
    // seconds for the recommendation/evaluation evidence parser.
    const hhmm = value => String(value || '').slice(0,5)
    return {
      ...booking,
      venue_name: facility?.name || null,
      venue_type: facility?.facility_type || null,
      building_location: facility?.location || null,
      event_date: booking.booking_date,
      time_slot: `${hhmm(booking.start_time)} - ${hhmm(booking.end_time)}`,
      owner_club_id: booking.owner_club_id,
      facility_id: booking.facility_id
    }
  })

  const normalizedFacilityLinks = facilityLinks.map(link => ({
    ...link,
    facility_slot_id: link.booking_id
  }))

  // The absence of a booking in an RLS-filtered result is NOT proof that a room is free. Booking writes need server-side verification.
  // ==========================================
  // STEP 4: RETURN DATA TO THE SIMULATOR
  // ==========================================

  // Normalize live records into the shared simulation engine input shape.
  // The engine receives authorized records from both sources without fixtures.

  // Day Ops events with a venue but no linked booking get a stand-in "venue only"
  // slot (simulatorOpsDataService). Simulation only: never a facility_bookings row.
  return {
    ...operational,
    segment_facility_slots: [...normalizedFacilityLinks, ...(operational.venue_only_links || [])],
    facility_slots: [...facilitySlots, ...(operational.venue_only_slots || [])],
    facilities,
    facility_bookings: bookings,
    segment_facility_bookings: facilityLinks,
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

// Live errors never fall back to fixtures; tests import fixtures directly.

export async function loadSimulationData({
  source = 'supabase'
} = {}) {

  // Local fixtures are imported directly by automated tests, never by live views.
  if (source === 'local') {
    throw new Error('Local fixtures are test-only. The simulator uses real Supabase data.')
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
