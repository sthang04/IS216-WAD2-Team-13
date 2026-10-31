import {simulatorBookingPeriod} from './simulatorFacilityEvidence.js'
/*
============================================================
PULSE — RECOVERY RECOMMENDATION SERVICE
============================================================

PURPOSE:
Generate read-only recovery suggestions after the What-If
Simulator calculates disruptions.

This file does NOT:
- Modify Supabase records
- Assign replacement members
- Reserve facilities
- Send Telegram messages

ALGORITHMS:

1. MEMBER REPLACEMENT
   Rank potential replacements using:
   - Specialty / role match (50%)
   - Timetable availability (30%)
   - Current commitment load (20%)

   Confirmed conflicts exclude candidates; missing role or personal timetable
   evidence requires manual review.

2. FACILITY RECOVERY
   Identify activities affected by:
   - Facility unavailability
   - New facility scheduling overlaps
   - Schedule delays exceeding booked time slots

   Suggest possible alternative venues and later times.

IMPORTANT LIMITATIONS:
- Specialty is inferred from recorded role assignments.
  It is not a verified skills or qualifications profile.
- Workload is measured using assignment count, not hours.
  It is only a proxy for workload, not a burnout diagnosis.
- Availability depends on the records loaded from Supabase.
- Facility alternatives are tentative and require approval.
- Cross-CCA booking visibility depends on Supabase RLS.
============================================================
*/


// ============================================================
// HELPER FUNCTIONS
// ============================================================

// Convert an ISO timestamp into milliseconds.
// This allows us to compare different dates and times.
const ms = value => Date.parse(value)


// Check whether two time periods overlap.
//
// Overlap occurs when:
//   Start A < End B
//   AND
//   Start B < End A
//
// If one activity ends exactly when another begins,
// they are NOT considered overlapping.
const overlap = (a, b, c, d) =>
  ms(a) < ms(d) && ms(c) < ms(b)


// Calculate the duration between two timestamps in minutes.
// Available for future recovery calculations.
const minutes = (a, b) =>
  Math.max(0, (ms(b) - ms(a)) / 60000)


// Facility bookings store their date and time separately.
//
// Example:
// event_date: "2027-10-16"
// time_slot: "18:00 - 21:00"
//
// Convert these into complete timestamps using
// Singapore's UTC+08:00 timezone.
const slotPeriod = simulatorBookingPeriod


// Normalize role names before comparing them.
//
// Example:
// " Lead Dancer " becomes "lead dancer".
const norm = value =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')


// Remove duplicate values from an array.
const distinct = values => [...new Set(values)]


/**
 * Rank hypothetical replacements without changing assignments. Membership and
 * coverage are simulator metadata, not guessed database columns or permissions.
 * A missing clash does not prove availability when schedule coverage is unknown.
 */
export function assessMemberReplacements(data, eventId, memberId, disruptions = [], limit = Infinity) {
  const excluded = []
  const empty = message => ({ eligible: [], excluded: [], warnings: [message] })
  if (!data || !['events','members','event_segments','segment_assignments'].every(key =>
      Array.isArray(data[key]) && data[key].every(row => row && typeof row === 'object'))) {
    return empty('Member, event or assignment data is incomplete. Refresh before reviewing replacements.')
  }
  const validPeriod = (start,end) => Number.isFinite(ms(start)) && Number.isFinite(ms(end)) && ms(start) < ms(end)
  if (!Array.isArray(disruptions) || disruptions.some(d => !d ||
      (d.type === 'MEMBER_UNAVAILABLE' && !validPeriod(d.start,d.end)))) {
    return empty('Enter a valid unavailability period with an end after its start.')
  }
  const same = (a,b) => a != null && b != null && String(a) === String(b)
  const event = data.events.find(row => same(row.id,eventId))
  // A failed unrelated event must not invalidate this event's successful roster.
  const coverage = data.member_replacement_coverage?.byEvent?.[String(eventId)] ?? data.member_replacement_coverage
  if (!event || coverage?.rosterVerified !== true) return empty('The selected event roster is not verified. Check the coverage warning.')
  const segments = new Map(data.event_segments.map(row => [String(row.id),row]))
  const impacted = data.segment_assignments.filter(a => {
    const segment = segments.get(String(a.segment_id))
    return same(a.member_id,memberId) && same(segment?.event_id,eventId) &&
      disruptions.some(d => d.type === 'MEMBER_UNAVAILABLE' && same(d.memberId,memberId) &&
        overlap(segment.starts_at,segment.ends_at,d.start,d.end))
  })
  if (!impacted.length) return empty('No recorded assignments overlap the selected member unavailability. Check the selected event, member and dates.')
  const targets = [...new Set(impacted.map(a => String(a.segment_id)))].map(id => segments.get(id))
  const requiredRoles = distinct(impacted.map(a => norm(a.role_name)).filter(Boolean))
  const candidates = []
  for (const member of data.members) {
    if (same(member.id,memberId)) continue
    const membership = (data.replacement_memberships || []).some(row =>
      same(row.memberId,member.id) && same(row.clubId,event.club_id) && row.active === true && row.verified === true)
    if (!membership) continue
    const assignments = data.segment_assignments.filter(a => same(a.member_id,member.id))
    const roles = distinct(assignments.map(a => norm(a.role_name)).filter(Boolean))
    const matchedRoles = requiredRoles.filter(role => roles.includes(role))
    const clashes = assignments.filter(a => targets.some(target => {
      const segment = segments.get(String(a.segment_id))
      return segment && !same(segment.id,target.id) &&
        overlap(segment.starts_at,segment.ends_at,target.starts_at,target.ends_at)
    }))
    // Busy periods may come from a verified timetable adapter. Fixtures supply
    // them directly; live data must never invent a member's availability.
    const busy = (data.member_busy_periods || []).some(period => same(period.memberId,member.id) &&
      targets.some(t => overlap(t.starts_at,t.ends_at,period.start,period.end)))
    const unavailable = disruptions.some(d => d.type === 'MEMBER_UNAVAILABLE' && same(d.memberId,member.id) &&
      targets.some(t => overlap(t.starts_at,t.ends_at,d.start,d.end)))
    if (clashes.length || busy || unavailable) {
      // Only verified active club members reach this branch. Do not display
      // unauthorized identities merely to explain why they were not recommended.
      const conflicts = [...new Map(clashes.map(a => {
        const segment = segments.get(String(a.segment_id))
        const conflictingEvent = data.events.find(e => same(e.id,segment.event_id))
        return [String(segment.id), {
          segmentId: segment.id, eventName: conflictingEvent?.name || 'Event name unavailable',
          activity: segment.title || 'Activity name unavailable',
          start: segment.starts_at, end: segment.ends_at
        }]
      })).values()]
      const reasons = []
      if (conflicts.length) reasons.push('Overlapping recorded event assignment(s)')
      if (busy) reasons.push('Overlapping recorded busy period')
      if (unavailable) reasons.push('Marked unavailable in this simulation')
      excluded.push({ id: member.id, name: member.full_name, reasons, conflicts })
      continue
    }
    const valid = t => Number.isFinite(ms(t?.starts_at)) && Number.isFinite(ms(t?.ends_at)) && ms(t.starts_at) < ms(t.ends_at)
    const incomplete = targets.some(t => !valid(t)) || assignments.some(a => !valid(segments.get(String(a.segment_id)))) ||
      (data.member_busy_periods || []).some(p => same(p.memberId,member.id) &&
        (!Number.isFinite(ms(p.start)) || !Number.isFinite(ms(p.end)) || ms(p.start) >= ms(p.end)))
    const availabilityVerified = coverage?.scheduleVerified === true && !incomplete
    const roleMatch = !requiredRoles.length || impacted.some(a => !norm(a.role_name)) || !roles.length ? 'unverified' :
      matchedRoles.length === requiredRoles.length ? 'exact' : matchedRoles.length ? 'partial' : 'none'
    const reviewReasons = []
    if (roleMatch !== 'exact') reviewReasons.push(roleMatch === 'partial' ? 'Only some required roles are recorded' :
      roleMatch === 'none' ? 'Recorded roles do not match the required roles' : 'Required role or member experience is unverified')
    if (!availabilityVerified) reviewReasons.push('Availability unverified: timetable or assignment coverage is incomplete')
    const currentLoad = assignments.filter(a => same(segments.get(String(a.segment_id))?.event_id,eventId)).length
    const specialtyScore = requiredRoles.length ? matchedRoles.length / requiredRoles.length : 0
    // Preserve the 50/30/20 weights. Unknown availability earns no verified-availability points.
    const score = Math.round(100 * (0.5 * specialtyScore + 0.3 * Number(availabilityVerified) +
      0.2 * Math.max(0,1-currentLoad/5)))
    candidates.push({ id:member.id, name:member.full_name, score, roleMatch, matchedRoles, currentLoad,
      eligible:true, requiresManualReview:reviewReasons.length > 0, reviewReasons, availabilityVerified, clashes:0,
      specialty:roles.join(', ') || 'No recorded role history', workload:currentLoad + ' assigned tasks',
      availability:availabilityVerified ? 'No clashes in verified schedule coverage' : 'No recorded clash; availability unverified',
      experience:matchedRoles.length + '/' + requiredRoles.length + ' required roles recorded (' + roleMatch + ')',
      reason:reviewReasons.join('; ') || 'All required roles recorded; no known timetable conflicts' })
  }
  // Exact experience is preferred even if availability still needs review.
  const eligible = candidates.sort((a,b) => Number(b.roleMatch === 'exact')-Number(a.roleMatch === 'exact') ||
    Number(a.requiresManualReview)-Number(b.requiresManualReview) || b.score-a.score ||
    a.currentLoad-b.currentLoad || String(a.id).localeCompare(String(b.id)))
    .slice(0,Math.max(0,limit))
  return { eligible, excluded, warnings: [] }
}

// Keep the existing API and default limit for plan evaluation callers.
export function recommendMemberReplacements(data, eventId, memberId, disruptions = [], limit = 5) {
  return assessMemberReplacements(data, eventId, memberId, disruptions, limit).eligible
}

/*
============================================================
ALGORITHM 2 — FACILITY AND SCHEDULE RECOVERY
============================================================

PURPOSE:
Suggest possible recovery actions when a facility becomes
unavailable or an activity is delayed.

INPUTS:
- data:
  Accessible facility bookings and event activities.

- eventId:
  Selected event ID, retained for service consistency.

- result:
  Output from runCompleteSimulation(), including
  the simulated activity schedule and conflicts.

- disruptions:
  Hypothetical disruptions selected by the user.

RECOVERY PROCESS:

STEP 1:
Retrieve the simulated event schedule.

STEP 2:
Identify activities affected by:
- Facility unavailability
- Newly introduced facility scheduling overlaps
- Activities extending beyond their booking windows

STEP 3:
Identify possible alternative venues from known
facility booking records.

STEP 4:
Try moving an affected activity 30 minutes later.

STEP 5:
Return tentative recovery options for organizer review.

IMPORTANT LIMITATIONS:
- Known facility bookings do not prove a room is free.
- The system does not confirm room availability.
- Cross-CCA booking checks are not yet comprehensive.
- Equipment and capacity suitability are not checked.
- Full dependency validation of suggested times is
  not yet implemented.
- The system does not automatically change bookings.
============================================================
*/

export function recommendFacilityRecovery(
  data,
  eventId,
  result,
  disruptions = []
) {

  // ----------------------------------------------------------
  // STEP 1: RETRIEVE THE SIMULATED SCHEDULE
  // ----------------------------------------------------------

  // Use the simulated activities returned by the engine.
  //
  // The original Supabase event records remain unchanged.
  const segments = result.simulatedSegments || []

  // Create a lookup for facility bookings.
  const facilityById = new Map(
    data.facility_slots.map(slot => [
      slot.id,
      slot
    ])
  )

  // Relationships between activities and facility bookings.
  const linked = data.segment_facility_slots

  // Store the final recovery recommendations.
  const recommendations = []


  // ----------------------------------------------------------
  // STEP 2: EXAMINE EACH SIMULATED ACTIVITY
  // ----------------------------------------------------------

  for (const segment of segments) {

    // Find facility bookings linked to this activity.
    const currentLinks = linked.filter(
      link => link.segment_id === segment.id
    )

    const currentSlots = currentLinks
      .map(link =>
        facilityById.get(link.facility_slot_id)
      )
      .filter(Boolean)

    // Activities without linked facility bookings
    // cannot be evaluated using this recovery method.
    if (!currentSlots.length) {
      continue
    }

    // Get the venue names currently used by the activity.
    const currentVenues = distinct(
      currentSlots.map(slot => slot.venue_name)
    )


    // --------------------------------------------------------
    // STEP 2A: CHECK FACILITY UNAVAILABILITY
    // --------------------------------------------------------

    // Check whether a facility disruption overlaps
    // the activity's simulated timing.
    const unavailable = disruptions.some(disruption =>
      disruption.type === 'FACILITY_UNAVAILABLE' &&
      currentVenues.includes(disruption.venueName) &&
      overlap(
        segment.starts_at,
        segment.ends_at,
        disruption.start,
        disruption.end
      )
    )


    // --------------------------------------------------------
    // STEP 2B: CHECK NEW FACILITY SCHEDULE CONFLICTS
    // --------------------------------------------------------

    // The simulation engine reports newly introduced
    // facility overlaps between linked event activities.
    const scheduleConflict = (
      result.newConflicts || []
    ).some(conflict =>
      conflict.segmentIds?.includes(segment.id) &&
      conflict.type === 'FACILITY_SCHEDULE_OVERLAP'
    )


    // --------------------------------------------------------
    // STEP 2C: CHECK THE EXISTING BOOKING WINDOW
    // --------------------------------------------------------

    // A schedule delay may push an activity outside
    // the period originally reserved for the venue.
    //
    // Example:
    // Booking: 18:00–19:30
    // Delayed activity: 18:30–20:00
    //
    // The activity exceeds its booked time by 30 minutes.
    const outsideBooking = currentSlots.some(slot => {

      const [bookingStart, bookingEnd] =
        slotPeriod(slot)

      return (
        ms(segment.starts_at) < ms(bookingStart) ||
        ms(segment.ends_at) > ms(bookingEnd)
      )
    })


    // If no facility-related issue is detected,
    // no recovery recommendation is necessary.
    if (
      !unavailable &&
      !scheduleConflict &&
      !outsideBooking
    ) {
      continue
    }

    const originalVenue =
      currentVenues.join(', ')


    // --------------------------------------------------------
    // STEP 3: IDENTIFY POSSIBLE ALTERNATIVE VENUES
    // --------------------------------------------------------

    // Get venue names appearing in accessible records.
    //
    // IMPORTANT:
    // A venue appearing in the booking table does NOT
    // mean it is currently free.
    const alternatives = distinct(
      (data.facilities?.length ? data.facilities.filter(f=>f.is_active!==false).map(f=>f.name) : data.facility_slots.map(slot=>slot.venue_name)).filter(Boolean)
    )

      // Exclude venues already assigned to this activity.
      .filter(name =>
        !currentVenues.includes(name)
      )

      .map(name => {

        // Find existing bookings associated with this venue.
        const slots = data.facility_slots.filter(
          slot => slot.venue_name === name
        )

        // Look for a booking record covering the
        // proposed activity period.
        //
        // This only identifies a known booking record;
        // it does NOT establish vacancy.
        const supportingSlot = slots.find(slot => {

          const [bookingStart, bookingEnd] =
            slotPeriod(slot)

          return (
            ms(bookingStart) <= ms(segment.starts_at) &&
            ms(bookingEnd) >= ms(segment.ends_at)
          )
        })

        // Without an authoritative room availability
        // inventory, we cannot confirm a free room.
        return supportingSlot
          ? {
              venue: name,

              status:
                'Requires owner approval / booking verification',

              reason:
                `Existing booking belongs to ${
                  supportingSlot.owner_club ||
                  'an unknown club'
                }`
            }
          : {
              venue:name,
              status:'No recorded conflict verified yet / booking approval required',
              reason:'Active facility inventory candidate. Calendar conflicts, audience capacity, equipment and club eligibility require verification; no booking has been created.'
            }
      })

      // Remove venues without supporting records.
      .filter(Boolean)


    // --------------------------------------------------------
    // STEP 4: TRY MOVING THE ACTIVITY 30 MINUTES LATER
    // --------------------------------------------------------

    // This is a tentative scheduling suggestion.
    //
    // The activity must:
    // 1. Fit within the existing facility booking.
    // 2. Avoid overlapping other activities linked
    //    to the same booking.
    //
    // External bookings and dependencies still
    // require additional verification.
    const laterTimes = currentSlots.flatMap(slot => {

      const [bookingStart, bookingEnd] =
        slotPeriod(slot)

      // Preserve the original activity duration.
      const duration =
        ms(segment.ends_at) - ms(segment.starts_at)

      // Propose a new start time 30 minutes later.
      const candidateStart = new Date(
        ms(segment.starts_at) + 30 * 60000
      ).toISOString()

      const candidateEnd = new Date(
        ms(candidateStart) + duration
      ).toISOString()

      // Check whether the proposed timing fits
      // within the current facility booking.
      const fits = (
        ms(candidateStart) >= ms(bookingStart) &&
        ms(candidateEnd) <= ms(bookingEnd)
      )

      // Check whether another activity linked to
      // the same facility booking would overlap.
      const overlapsOther = segments.some(other =>
        other.id !== segment.id &&

        linked.some(link =>
          link.segment_id === other.id &&
          link.facility_slot_id === slot.id
        ) &&

        overlap(
          candidateStart,
          candidateEnd,
          other.starts_at,
          other.ends_at
        )
      )

      // Only return the proposed time if these
      // local scheduling checks pass.
      return fits && !overlapsOther
        ? [{
            start: candidateStart,
            end: candidateEnd,
            venue: slot.venue_name,

            status:
              'Tentative — verify external bookings and dependencies'
          }]
        : []
    })


    // --------------------------------------------------------
    // STEP 5: RETURN THE RECOVERY RECOMMENDATION
    // --------------------------------------------------------

    // Explain the detected problem and provide
    // possible recovery options for manual review.
    recommendations.push({

      segmentId: segment.id,

      segmentTitle: segment.title,

      originalVenue,

      issue: unavailable
        ? 'Facility unavailable'
        : scheduleConflict
          ? 'Facility schedule overlap'
          : 'Delayed activity exceeds booking window',

      alternatives,

      laterTimes,

      // If no tentative alternatives are identified,
      // advise the organizer to coordinate manually.
      advice:
        alternatives.length || laterTimes.length
          ? 'Review tentative alternatives and request approval before changing bookings'
          : 'No confirmed alternative in accessible records; coordinate with facility admin or shorten/resequence the activity.'
    })
  }


  // ----------------------------------------------------------
  // STEP 6: RETURN ALL FACILITY RECOVERY SUGGESTIONS
  // ----------------------------------------------------------

  // This function returns recommendations only.
  //
  // It does not:
  // - Update bookings
  // - Change event schedules
  // - Contact another CCA
  // - Send Telegram messages
  return recommendations
}


/*
============================================================
ALGORITHM 3 — STRUCTURED FACILITY / DELAY RECOVERY OPTIONS
============================================================

Convert tentative suggestions into the exact `changes` format
accepted by recoveryPlanEvaluationService.js.

A generated option is a PROPOSAL, not a confirmed booking.
The evaluation service decides FEASIBLE / NEEDS_REVIEW /
INFEASIBLE based on records it can inspect. Organiser and
facility-owner approval is still required.

Delay options preserve the simulated delay (rather than
pretending it never happened). A dependency-propagation option
moves dependent segments only when they would otherwise begin
before their prerequisites finish.
============================================================
*/
export function buildFacilityAndDelayRecoveryOptions(
  data,
  eventId,
  result,
  disruptions = [],
  recommendations = []
) {
  if (!result) return []

  const eventSegments = (data.event_segments || []).filter(
    segment => String(segment.event_id) === String(eventId)
  )
  const originalById = new Map(eventSegments.map(s => [String(s.id), s]))
  const simulated = (result.simulatedSegments || []).filter(
    segment => originalById.has(String(segment.id))
  )
  const simulatedById = new Map(simulated.map(s => [String(s.id), s]))
  const options = []
  const seen = new Set()

  const valid = value => Number.isFinite(Date.parse(value))
  const changedTimes = (original, proposed) =>
    valid(proposed?.starts_at) && valid(proposed?.ends_at) &&
    (Date.parse(original.starts_at) !== Date.parse(proposed.starts_at) ||
     Date.parse(original.ends_at) !== Date.parse(proposed.ends_at))

  const delayDisruptions = disruptions.filter(d => d.type === 'SCHEDULE_DELAY')
  const isDelay = delayDisruptions.length > 0

  // Baseline for all delay plans: include the delayed times.
  // Evaluator starts from original Supabase segments, not from
  // the simulated snapshot, so this is essential.
  const delayedChanges = simulated
    .filter(s => changedTimes(originalById.get(String(s.id)), s))
    .map(s => ({ segmentId: s.id, starts_at: s.starts_at, ends_at: s.ends_at }))

  function addOption(id, title, changes, note) {
    if (!changes.length) return
    const normalized = changes.filter(c => c.segmentId != null)
    const key = JSON.stringify(normalized)
    if (seen.has(key)) return
    seen.add(key)
    options.push({ id, title, changes: normalized, note, requiresApproval: true })
  }

  // Every suggested venue/time change becomes an explicit
  // evaluable plan. No reservation is created here.
  for (const recommendation of recommendations) {
    const segment = simulatedById.get(String(recommendation.segmentId))
    if (!segment) continue
    const prefix = `recovery-${String(segment.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`

    for (const [index, alternative] of (recommendation.alternatives || []).entries()) {
      const venueName = alternative.venue || alternative.venueName
      if (!venueName) continue
      addOption(
        `${prefix}-venue-${index}`,
        `Move ${segment.title} to ${venueName}`,
        [...delayedChanges, { segmentId: segment.id, venueName }],
        'Tentative venue change; booking rights, capacity and equipment need confirmation.'
      )
    }

    for (const [index, time] of (recommendation.laterTimes || []).entries()) {
      if (!valid(time.start) || !valid(time.end) ||
          Date.parse(time.start) >= Date.parse(time.end)) continue
      addOption(
        `${prefix}-time-${index}`,
        `Move ${segment.title} to a later time`,
        [
          ...delayedChanges.filter(c => String(c.segmentId) !== String(segment.id)),
          { segmentId: segment.id, starts_at: time.start, ends_at: time.end }
        ],
        'Tentative time change; other assignments and bookings require evaluation.'
      )
    }
  }

  if (isDelay && delayedChanges.length) {
    // This is a valid *candidate* even if it later fails
    // evaluation. It represents accepting the unavoidable
    // delay while checking the resulting conflicts.
    addOption(
      'delay-keep-simulated-times',
      'Keep delayed times and check existing bookings',
      delayedChanges,
      'The delay is preserved; may still cause booking or dependency conflicts.'
    )

    // Propagate delay only as far as necessary to preserve
    // prerequisite ordering. This does not assert venue
    // availability or member availability.
    const proposedById = new Map(simulated.map(s => [String(s.id), { ...s }]))
    const dependencies = (data.segment_dependencies || []).filter(d =>
      proposedById.has(String(d.prerequisite_segment_id)) &&
      proposedById.has(String(d.dependent_segment_id))
    )
    const maxPasses = proposedById.size
    for (let pass = 0; pass < maxPasses; pass++) {
      let changed = false
      for (const dep of dependencies) {
        const before = proposedById.get(String(dep.prerequisite_segment_id))
        const after = proposedById.get(String(dep.dependent_segment_id))
        if (!valid(before?.ends_at) || !valid(after?.starts_at) ||
            !valid(after?.ends_at)) continue
        const shift = Date.parse(before.ends_at) - Date.parse(after.starts_at)
        if (shift <= 0) continue
        after.starts_at = new Date(Date.parse(after.starts_at) + shift).toISOString()
        after.ends_at = new Date(Date.parse(after.ends_at) + shift).toISOString()
        changed = true
      }
      if (!changed) break
    }
    const propagated = [...proposedById.values()]
      .filter(s => changedTimes(originalById.get(String(s.id)), s))
      .map(s => ({ segmentId: s.id, starts_at: s.starts_at, ends_at: s.ends_at }))
    addOption(
      'delay-propagate-dependencies',
      'Keep delay and shift dependent activities',
      propagated,
      'Dependency order preserved where possible; bookings and member clashes still require checking.'
    )
  }

  return options
}
