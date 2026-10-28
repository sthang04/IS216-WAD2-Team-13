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

   Members who are unavailable or have no matching
   recorded role are excluded.

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
const slotPeriod = slot => {
  const [start, end] = slot.time_slot.split(/\s*-\s*/)

  return [
    `${slot.event_date}T${start}:00+08:00`,
    `${slot.event_date}T${end}:00+08:00`
  ]
}


// Normalize role names before comparing them.
//
// Example:
// " Lead Dancer " becomes "lead dancer".
const norm = value =>
  String(value || '').trim().toLowerCase()


// Remove duplicate values from an array.
const distinct = values => [...new Set(values)]


/*
============================================================
ALGORITHM 1 — PERFORMER / CREW REPLACEMENT RANKING
============================================================

PURPOSE:
Recommend suitable members when an assigned performer
or crew member becomes unavailable.

INPUTS:
- data:
  Event, member, assignment and scheduling records.

- eventId:
  ID of the event being simulated.

- memberId:
  ID of the unavailable member.

- disruptions:
  Array of hypothetical disruptions.

- limit:
  Maximum number of recommendations to return.

SCORING CRITERIA:

1. SPECIALTY MATCH — 50%

   Checks whether the candidate has previously performed
   the required role.

   Specialty Score =
     Matching Required Roles / Total Required Roles

2. TIMETABLE AVAILABILITY — 30%

   Checks whether the candidate:
   - Has overlapping assigned activities
   - Is marked unavailable in the simulation

   Availability Score:
   - 1 = No recorded conflicts
   - 0 = Has a conflict or is unavailable

3. COMMITMENT LOAD — 20%

   Considers how many assignments the candidate already
   has for the selected event.

   Load Score =
     max(0, 1 - Number of Assignments / 5)

   Five assignments is a proposed workload threshold.

FINAL FORMULA:

Suitability Score =
  100 × (
    0.50 × Specialty Score
    + 0.30 × Availability Score
    + 0.20 × Load Score
  )

ELIGIBILITY RULES:
- Exclude the unavailable member.
- Exclude candidates with timetable conflicts.
- Exclude candidates without a matching recorded role.

OUTPUT:
Eligible candidates ranked by suitability score,
highest first.

IMPORTANT:
The score is a heuristic ranking, NOT the probability
that a replacement will succeed.
============================================================
*/

export function recommendMemberReplacements(
  data,
  eventId,
  memberId,
  disruptions = [],
  limit = 5
) {

  // ----------------------------------------------------------
  // STEP 1: IDENTIFY THE AFFECTED ACTIVITIES
  // ----------------------------------------------------------

  // Retrieve activities belonging to the selected event.
  const eventSegments = data.event_segments.filter(
    segment => segment.event_id === eventId
  )

  // Store the IDs for efficient assignment filtering.
  const segmentIds = new Set(
    eventSegments.map(segment => segment.id)
  )

  // Find assignments belonging to the unavailable member.
  //
  // Only assignments that overlap the member's
  // unavailability period need replacement.
  const impacted = data.segment_assignments
    .filter(assignment =>
      assignment.member_id === memberId &&
      segmentIds.has(assignment.segment_id)
    )
    .filter(assignment =>
      eventSegments.some(segment =>
        segment.id === assignment.segment_id &&
        disruptions.some(disruption =>
          disruption.type === 'MEMBER_UNAVAILABLE' &&
          disruption.memberId === memberId &&
          overlap(
            segment.starts_at,
            segment.ends_at,
            disruption.start,
            disruption.end
          )
        )
      )
    )

  // Identify the roles that require replacements.
  const requiredRoles = distinct(
    impacted.map(assignment =>
      norm(assignment.role_name)
    )
  )

  // Retrieve the affected activity records.
  const affectedSegments = eventSegments.filter(
    segment =>
      impacted.some(
        assignment =>
          assignment.segment_id === segment.id
      )
  )

  // If no assignments are affected, no replacement is needed.
  if (!affectedSegments.length) {
    return []
  }


  // ----------------------------------------------------------
  // STEP 2: ORGANIZE MEMBERS' EXISTING ASSIGNMENTS
  // ----------------------------------------------------------

  // Group assignments by member ID.
  //
  // This avoids repeatedly searching through the full
  // assignment list for each candidate.
  const assignmentsByMember = new Map()

  for (const assignment of data.segment_assignments) {

    if (!assignmentsByMember.has(assignment.member_id)) {
      assignmentsByMember.set(
        assignment.member_id,
        []
      )
    }

    assignmentsByMember
      .get(assignment.member_id)
      .push(assignment)
  }

  // Create a lookup for activity information.
  const segmentById = new Map(
    data.event_segments.map(segment => [
      segment.id,
      segment
    ])
  )


  // ----------------------------------------------------------
  // STEP 3: EVALUATE POTENTIAL REPLACEMENT MEMBERS
  // ----------------------------------------------------------

  // Exclude the unavailable member from the candidate list.
  return data.members
    .filter(member => member.id !== memberId)
    .map(member => {

      // Retrieve this candidate's recorded assignments.
      const assignments =
        assignmentsByMember.get(member.id) || []

      // Identify roles previously performed by the candidate.
      //
      // These roles are used as a proxy for specialty
      // because a dedicated skills profile is not available.
      const roles = distinct(
        assignments
          .map(assignment => norm(assignment.role_name))
          .filter(Boolean)
      )

      // Find which required roles match the candidate's
      // recorded role history.
      const matchedRoles = requiredRoles.filter(
        role => roles.includes(role)
      )


      // ------------------------------------------------------
      // STEP 4A: CALCULATE SPECIALTY MATCH (50%)
      // ------------------------------------------------------

      // Example:
      // Required roles: Lead Dancer, Dance Captain
      // Matched roles: Lead Dancer
      //
      // Specialty Score = 1 / 2 = 0.5
      const specialtyScore = requiredRoles.length
        ? matchedRoles.length / requiredRoles.length
        : 0


      // ------------------------------------------------------
      // STEP 4B: CHECK TIMETABLE AVAILABILITY (30%)
      // ------------------------------------------------------

      // Find assignments that overlap any affected activity.
      //
      // A candidate should not be recommended if they
      // already have another activity at the same time.
      const clashes = affectedSegments.flatMap(target =>
        assignments
          .filter(assignment =>
            assignment.segment_id !== target.id
          )
          .filter(assignment => {

            const assignedSegment =
              segmentById.get(assignment.segment_id)

            return assignedSegment &&
              overlap(
                assignedSegment.starts_at,
                assignedSegment.ends_at,
                target.starts_at,
                target.ends_at
              )
          })
      )

      // Also check whether this candidate is marked
      // unavailable by another disruption in the
      // current simulation.
      const unavailable = disruptions.some(disruption =>
        disruption.type === 'MEMBER_UNAVAILABLE' &&
        disruption.memberId === member.id &&
        affectedSegments.some(segment =>
          overlap(
            segment.starts_at,
            segment.ends_at,
            disruption.start,
            disruption.end
          )
        )
      )

      // Candidate is free only if there are no recorded
      // timetable clashes and no simulated unavailability.
      const isFree =
        clashes.length === 0 &&
        !unavailable


      // ------------------------------------------------------
      // STEP 4C: CALCULATE COMMITMENT LOAD (20%)
      // ------------------------------------------------------

      // Count the candidate's existing assignments
      // within the selected event.
      //
      // More assignments mean a higher workload.
      const currentLoad = assignments.filter(
        assignment =>
          segmentIds.has(assignment.segment_id)
      ).length

      // Convert workload into a score between 0 and 1.
      //
      // Examples:
      // 0 assignments -> 1.0
      // 2 assignments -> 0.6
      // 5 assignments -> 0.0
      //
      // This is a workload proxy, not a medical
      // measurement of burnout.
      const loadScore = Math.max(
        0,
        1 - currentLoad / 5
      )


      // ------------------------------------------------------
      // STEP 5: CALCULATE FINAL SUITABILITY SCORE
      // ------------------------------------------------------

      // Weighted formula:
      // 50% specialty + 30% availability + 20% workload
      const score = Math.round(
        100 * (
          0.50 * specialtyScore +
          0.30 * (isFree ? 1 : 0) +
          0.20 * loadScore
        )
      )

      // Eligibility is separate from the numerical score.
      //
      // Even if a candidate has a high score, they must
      // be free and have at least one matching role.
      const eligible =
        isFree &&
        specialtyScore > 0


      // ------------------------------------------------------
      // STEP 6: PREPARE THE CANDIDATE RESULT
      // ------------------------------------------------------

      // Return the score and supporting explanations
      // so the UI can show WHY someone was recommended.
      return {
        id: member.id,
        name: member.full_name,
        score,
        eligible,

        specialty:
          roles.join(', ') || 'No recorded role',

        workload:
          `${currentLoad} assigned tasks`,

        availability: unavailable
          ? 'Marked unavailable'
          : clashes.length
            ? `${clashes.length} schedule clash(es)`
            : 'No recorded timetable clashes',

        experience:
          `${matchedRoles.length}/${requiredRoles.length} required role(s) matched`,

        reason: !isFree
          ? 'Not currently available for all affected segments'
          : specialtyScore === 0
            ? 'No matching recorded role'
            : `Matches ${matchedRoles.join(', ')}; ${currentLoad} existing assignments`,

        matchedRoles,
        currentLoad,
        clashes: clashes.length
      }
    })


    // --------------------------------------------------------
    // STEP 7: FILTER AND RANK ELIGIBLE CANDIDATES
    // --------------------------------------------------------

    // Remove candidates who do not satisfy eligibility rules.
    .filter(candidate => candidate.eligible)

    // Rank highest suitability score first.
    //
    // If two candidates have the same score,
    // prefer the candidate with fewer assignments.
    .sort((a, b) =>
      b.score - a.score ||
      a.currentLoad - b.currentLoad
    )

    // Return only the requested number of recommendations.
    .slice(0, limit)
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
      data.facility_slots.map(slot =>
        slot.venue_name
      )
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
          : null
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
