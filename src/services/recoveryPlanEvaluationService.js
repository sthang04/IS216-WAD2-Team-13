/*
==========================================================
RECOVERY PLAN EVALUATION SERVICE
==========================================================

FEATURE 5: Event Risk Planning & What-If Simulator

PURPOSE:
Compare possible recovery plans after a disruption and
identify which option is most suitable.

SUPPORTED SCENARIOS:
1. MEMBER_UNAVAILABLE
   - Evaluate proposed replacement assignments.
   - Check replacement member timetable clashes.
   - Check whether the original member is still required.

2. FACILITY_UNAVAILABLE
   - Evaluate proposed alternative venues.
   - Detect venue clashes and unavailable facilities.
   - Check whether existing bookings cover the new plan.

3. SCHEDULE_DELAY
   - Evaluate proposed new start/end times.
   - Detect member double-bookings.
   - Detect venue clashes with other bookings.
   - Check dependencies between activities.

==========================================================
RECOVERY EVALUATION ALGORITHM
==========================================================

STEP 1: Generate or receive possible recovery plans.

STEP 2: Apply each recovery plan to a temporary copy
        of the event schedule.

STEP 3: Check feasibility:
        - Member availability
        - Facility availability
        - Facility booking coverage
        - Dependency order
        - Required replacement roles
        - Missing or incomplete information

STEP 4: Calculate four scoring components:

Conflict Resolution       = 40%
Timetable Preservation    = 30%
Member Workload           = 20%
Venue Suitability         = 10%

Final Score =
    0.40 * conflictScore
  + 0.30 * timetableScore
  + 0.20 * workloadScore
  + 0.10 * venueScore

STEP 5: Rank recovery plans.

IMPORTANT:
- A score is NOT a probability of success.
- Plans with known conflicts are not considered feasible.
- Plans requiring unverified information are marked
  NEEDS_REVIEW rather than SAFE.
- An option is only RECOMMENDED when it passes all
  checks using the supplied records.
- A "clear" result only covers records accessible to
  the application. It does not guarantee that all
  external CCA bookings are visible.
- No Supabase INSERT, UPDATE or DELETE is performed.

==========================================================
INPUT EXAMPLE
==========================================================

evaluateRecoveryPlans({
  data,
  eventId,
  disruptions,
  simulationResult,
  options: [
    {
      id: 'option-1',
      title: 'Move rehearsal to Studio B',
      changes: [
        {
          segmentId: 12,
          venueName: 'Studio B'
        }
      ]
    },
    {
      id: 'option-2',
      title: 'Reschedule rehearsal',
      changes: [
        {
          segmentId: 12,
          starts_at: '2027-10-16T12:00:00Z',
          ends_at: '2027-10-16T13:00:00Z'
        }
      ]
    }
  ]
})

NOTE:
A venue change must be supported by an appropriate
booking or be marked for manual booking verification.

==========================================================
*/

export const RECOVERY_WEIGHTS = Object.freeze({
  conflict: 0.40,
  timetable: 0.30,
  workload: 0.20,
  venue: 0.10
})

const MINUTE = 60 * 1000

// ========================================================
// STEP 1: GENERAL HELPERS
// ========================================================

function list(value) {
  return Array.isArray(value) ? value : []
}

function sameId(a, b) {
  return String(a) === String(b)
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value))
}

function round(value) {
  return Math.round(value * 100) / 100
}

function timestamp(value) {
  const time = Date.parse(value)

  return Number.isFinite(time) ? time : NaN
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

function validPeriod(start, end) {
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start < end
  )
}

function unique(items) {
  return [...new Set(items)]
}

function normaliseRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function getEventSegments(data, eventId) {
  return list(data.event_segments).filter(
    segment => sameId(segment.event_id, eventId)
  )
}

function getSegmentMap(segments) {
  return new Map(
    segments.map(segment => [
      String(segment.id),
      segment
    ])
  )
}

function getMemberName(data, memberId) {
  const member = list(data.members).find(
    item => sameId(item.id, memberId)
  )

  return member?.full_name || `Member ${memberId}`
}

function getVenueMap(data) {
  return new Map(
    list(data.facility_slots).map(slot => [
      String(slot.id),
      slot
    ])
  )
}

// ========================================================
// STEP 2: PARSE FACILITY BOOKING TIMES
// ========================================================

/*
The existing Supabase facility_slots table stores:

event_date: "2027-10-16"
time_slot:  "18:00-19:00"

Convert this Singapore-local booking interval into
timestamps that can be compared with segment timestamps.

This function deliberately rejects unsupported formats
instead of silently assuming that a venue is free.
*/

function parseFacilityBooking(slot) {
  if (!slot?.event_date || !slot?.time_slot) {
    return null
  }

  const match = String(slot.time_slot).match(
    /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/
  )

  if (!match) return null

  const [, startText, endText] = match

  const start = timestamp(
    `${slot.event_date}T${startText}:00+08:00`
  )

  const end = timestamp(
    `${slot.event_date}T${endText}:00+08:00`
  )

  if (!validPeriod(start, end)) {
    return null
  }

  return {
    start,
    end
  }
}

// ========================================================
// STEP 3: PREPARE A TEMPORARY RECOVERY PLAN
// ========================================================

/*
Each recovery option can contain one or more changes.

SUPPORTED CHANGE FIELDS:

segmentId
starts_at
ends_at
venueName
replacementMemberId
replacedMemberId

The evaluator never changes the original data.

For member replacements, the caller must identify
which original member is being replaced.

For venue changes, the evaluator uses the new venue
name but does NOT create a confirmed booking.
*/

function buildProposedPlan(data, eventId, option) {
  const originalSegments = getEventSegments(
    data,
    eventId
  )

  const segmentMap = new Map(
    originalSegments.map(segment => [
      String(segment.id),
      { ...segment }
    ])
  )

  const assignments = list(
    data.segment_assignments
  ).map(assignment => ({ ...assignment }))

  const venueOverrides = new Map()
  const errors = []

  for (const change of list(option.changes)) {
    const segment = segmentMap.get(
      String(change.segmentId)
    )

    if (!segment) {
      errors.push(
        `Unknown segment: ${change.segmentId}`
      )

      continue
    }

    if (change.starts_at !== undefined) {
      segment.starts_at = change.starts_at
    }

    if (change.ends_at !== undefined) {
      segment.ends_at = change.ends_at
    }

    if (change.venueName !== undefined) {
      if (!String(change.venueName).trim()) {
        errors.push(
          `Missing venue for ${segment.title}`
        )
      } else {
        venueOverrides.set(
          String(segment.id),
          String(change.venueName).trim()
        )
      }
    }

    if (change.replacementMemberId != null) {
      if (change.replacedMemberId == null) {
        errors.push(
          `Missing replacedMemberId for ${segment.title}`
        )

        continue
      }

      const target = assignments.find(
        assignment =>
          sameId(
            assignment.segment_id,
            segment.id
          ) &&
          sameId(
            assignment.member_id,
            change.replacedMemberId
          )
      )

      if (!target) {
        errors.push(
          `Original member assignment not found for ${segment.title}`
        )

        continue
      }

      if (!list(data.members).some(
        member => sameId(
          member.id,
          change.replacementMemberId
        )
      )) {
        errors.push(
          `Replacement member ${change.replacementMemberId} was not loaded`
        )

        continue
      }

      target.member_id =
        change.replacementMemberId
    }
  }

  return {
    segments: [...segmentMap.values()],
    assignments,
    venueOverrides,
    errors
  }
}

// ========================================================
// STEP 4: CHECK MEMBER TIMETABLE CONFLICTS
// ========================================================

/*
A member cannot attend two overlapping activities.

Checks the proposed event schedule against:
1. Other activities in the selected event.
2. Other loaded events' activities.

NOTE:
The result is limited to assignments available under
the current Supabase user's permissions.
*/

function checkMemberConflicts(
  data,
  eventId,
  plan
) {
  const conflicts = []
  const segmentMap = getSegmentMap(
    plan.segments
  )

  const allSegments = [
    ...list(data.event_segments).filter(
      segment => !sameId(
        segment.event_id,
        eventId
      )
    ),
    ...plan.segments
  ]

  const allSegmentMap = getSegmentMap(
    allSegments
  )

  const eventSegmentIds = new Set(
    plan.segments.map(segment =>
      String(segment.id)
    )
  )

  const allAssignments = [
    ...list(data.segment_assignments).filter(
      assignment =>
        !eventSegmentIds.has(
          String(assignment.segment_id)
        )
    ),
    ...plan.assignments.filter(
      assignment =>
        eventSegmentIds.has(
          String(assignment.segment_id)
        )
    )
  ]

  const byMember = new Map()

  for (const assignment of allAssignments) {
    const memberId = String(
      assignment.member_id
    )

    const segment = allSegmentMap.get(
      String(assignment.segment_id)
    )

    if (!segment) continue

    if (!byMember.has(memberId)) {
      byMember.set(memberId, [])
    }

    byMember.get(memberId).push(segment)
  }

  for (const [memberId, segments] of byMember) {
    for (let i = 0; i < segments.length; i++) {
      for (
        let j = i + 1;
        j < segments.length;
        j++
      ) {
        const first = segments[i]
        const second = segments[j]

        // Ignore duplicate references to the same segment.
        if (sameId(first.id, second.id)) {
          continue
        }

        // At least one activity must belong to the
        // selected event, otherwise the conflict is
        // unrelated to this recovery decision.
        if (
          !segmentMap.has(String(first.id)) &&
          !segmentMap.has(String(second.id))
        ) {
          continue
        }

        if (
          overlaps(
            timestamp(first.starts_at),
            timestamp(first.ends_at),
            timestamp(second.starts_at),
            timestamp(second.ends_at)
          )
        ) {
          conflicts.push({
            type: 'MEMBER_DOUBLE_BOOKING',
            memberId,
            message:
              `${getMemberName(data, memberId)} has ` +
              `overlapping activities: ` +
              `${first.title} and ${second.title}`
          })
        }
      }
    }
  }

  return conflicts
}

// ========================================================
// STEP 5: CHECK DEPENDENCY CONFLICTS
// ========================================================

/*
If activity B depends on activity A, activity A must
finish before activity B starts.

Example:
Soundcheck must finish before performance starts.

If a delayed soundcheck ends after the performance
starts, the recovery plan violates this dependency.
*/

function checkDependencyConflicts(
  data,
  plan
) {
  const conflicts = []

  const segmentMap = getSegmentMap(
    plan.segments
  )

  for (
    const dependency of list(
      data.segment_dependencies
    )
  ) {
    const prerequisite = segmentMap.get(
      String(
        dependency.prerequisite_segment_id
      )
    )

    const dependent = segmentMap.get(
      String(
        dependency.dependent_segment_id
      )
    )

    if (!prerequisite || !dependent) {
      continue
    }

    if (
      timestamp(prerequisite.ends_at) >
      timestamp(dependent.starts_at)
    ) {
      conflicts.push({
        type: 'DEPENDENCY_CONFLICT',
        segmentId: dependent.id,
        message:
          `${dependent.title} starts before ` +
          `${prerequisite.title} finishes`
      })
    }
  }

  return conflicts
}

// ========================================================
// STEP 6: CHECK FACILITY BOOKINGS
// ========================================================

/*
For every segment that has a facility-slot link:

1. Determine the proposed venue.
2. Check whether the original booking covers
   the proposed segment time.
3. Check overlapping bookings at the same venue.
4. Check simulated facility closures.

IMPORTANT:
A different venue name does not automatically create
a confirmed booking.

If a proposed venue lacks a confirmed booking,
the plan requires manual booking verification.

Existing bookings from other CCAs are considered only
when they are present in data.facility_slots.
*/

// Booking statuses reflect the project facility_slots records.
// Only "Booked" is treated as a confirmed reservation.
function bookingStatus(slot) {
  return String(slot?.status || '').trim().toLowerCase()
}

function isConfirmedBooking(slot) {
  return bookingStatus(slot) === 'booked'
}

function sameVenue(a, b) {
  return String(a || '').trim().toLowerCase() ===
    String(b || '').trim().toLowerCase()
}

function singaporeDateFromMs(value) {
  return new Date(value + 8 * 60 * 60 * 1000)
    .toISOString().slice(0, 10)
}

function checkFacilityConflicts(data, plan, disruptions) {
  const conflicts = []
  const warnings = []
  const slotMap = getVenueMap(data)
  const knownSlots = list(data.facility_slots)
  const linksBySegment = new Map()

  for (const link of list(data.segment_facility_slots)) {
    const key = String(link.segment_id)
    if (!linksBySegment.has(key)) linksBySegment.set(key, [])
    linksBySegment.get(key).push(link)
  }

  for (const segment of plan.segments) {
    const key = String(segment.id)
    const start = timestamp(segment.starts_at)
    const end = timestamp(segment.ends_at)
    if (!validPeriod(start, end)) continue

    const links = linksBySegment.get(key) || []
    const linkedSlots = links
      .map(link => slotMap.get(String(link.facility_slot_id)))
      .filter(Boolean)
    const override = plan.venueOverrides.get(key)
    const venues = override
      ? [override]
      : unique(linkedSlots.map(slot => slot.venue_name).filter(Boolean))

    // An unlinked activity has no provable booking entitlement.
    // We do not invent a venue or treat another CCA's booking as ours.
    if (!venues.length) {
      warnings.push(`No linked facility booking for ${segment.title}`)
      continue
    }

    // If a recovery option moves outside the dates loaded by the data
    // service, absence of bookings cannot be used as proof of vacancy.
    const coverage = data.facility_booking_coverage
    if (coverage?.startDate && coverage?.endDate) {
      const firstDate = singaporeDateFromMs(start)
      const lastDate = singaporeDateFromMs(end - 1)
      if (firstDate < coverage.startDate || lastDate > coverage.endDate) {
        warnings.push(
          `Booking data does not cover the proposed date for ${segment.title}`
        )
      }
    }

    for (const venue of venues) {
      for (const disruption of disruptions) {
        if (disruption.type === 'FACILITY_UNAVAILABLE' &&
            sameVenue(disruption.venueName, venue) &&
            overlaps(start, end,
              timestamp(disruption.start), timestamp(disruption.end))) {
          conflicts.push({
            type: 'FACILITY_UNAVAILABLE',
            segmentId: segment.id,
            venue,
            message: `${venue} is unavailable during ${segment.title}`
          })
        }
      }

      // Booking coverage requires a link to this activity, a confirmed
      // booking status, the same venue, and full coverage of its time.
      const linkedConfirmed = linkedSlots.some(slot => {
        if (!sameVenue(slot.venue_name, venue) ||
            !isConfirmedBooking(slot)) return false
        const period = parseFacilityBooking(slot)
        return period && period.start <= start && period.end >= end
      })

      if (!linkedConfirmed) {
        const linkedPending = linkedSlots.some(slot => {
          if (!sameVenue(slot.venue_name, venue) ||
              isConfirmedBooking(slot)) return false
          const period = parseFacilityBooking(slot)
          return period && period.start <= start && period.end >= end
        })
        warnings.push(linkedPending
          ? `Booking approval pending for ${segment.title} at ${venue}`
          : `Booking verification required for ${segment.title} at ${venue}`)
      }

      // A linked slot is not a competing reservation for this activity.
      const ownIds = new Set(linkedSlots.map(slot => String(slot.id)))
      for (const slot of knownSlots) {
        if (!sameVenue(slot.venue_name, venue) ||
            ownIds.has(String(slot.id))) continue

        const period = parseFacilityBooking(slot)
        if (!period) {
          warnings.push(`Unrecognised booking time for ${venue} (slot ${slot.id})`)
          continue
        }
        if (!overlaps(start, end, period.start, period.end)) continue

        if (isConfirmedBooking(slot)) {
          conflicts.push({
            type: 'FACILITY_DOUBLE_BOOKING',
            segmentId: segment.id,
            venue,
            facilitySlotId: slot.id,
            message: `${segment.title} overlaps a Booked reservation at ${venue}`
          })
        } else {
          warnings.push(
            `${segment.title} overlaps a ${slot.status || 'unconfirmed'} ` +
            `reservation at ${venue} (slot ${slot.id})`
          )
        }
      }
    }
  }

  return { conflicts, warnings: unique(warnings) }
}

// ========================================================
// STEP 7: CHECK MEMBER UNAVAILABILITY
// ========================================================

/*
After a member replacement, check whether an
unavailable member is still assigned to any affected
activity.

If so, the proposed plan has not fully recovered
from the member disruption.
*/

function checkUnavailableMembers(
  plan,
  disruptions
) {
  const conflicts = []

  const segmentMap = getSegmentMap(
    plan.segments
  )

  for (const disruption of disruptions) {
    if (
      disruption.type !==
      'MEMBER_UNAVAILABLE'
    ) {
      continue
    }

    for (const assignment of plan.assignments) {
      if (
        !sameId(
          assignment.member_id,
          disruption.memberId
        )
      ) {
        continue
      }

      const segment = segmentMap.get(
        String(assignment.segment_id)
      )

      if (!segment) continue

      if (
        overlaps(
          timestamp(segment.starts_at),
          timestamp(segment.ends_at),
          timestamp(disruption.start),
          timestamp(disruption.end)
        )
      ) {
        conflicts.push({
          type: 'MEMBER_UNAVAILABLE',
          segmentId: segment.id,
          memberId: disruption.memberId,
          message:
            `Unavailable member is still assigned ` +
            `to ${segment.title}`
        })
      }
    }
  }

  return conflicts
}

// ========================================================
// STEP 8: CHECK REPLACEMENT SPECIALTY
// ========================================================

/*
A replacement member should have evidence of being
suitable for the required role.

The current database records role_name on assignments.

This is useful as experience evidence, but it is NOT
the same as a verified skills or certification profile.

Exact prior role match:
  Evidence found.

No prior role match:
  Needs manual specialty verification.

Never invent a member's specialty.
*/

function checkReplacementSpecialty(
  data,
  option
) {
  const warnings = []

  for (const change of list(option.changes)) {
    if (
      change.replacementMemberId == null ||
      change.replacedMemberId == null
    ) {
      continue
    }

    const originalAssignment =
      list(data.segment_assignments).find(
        assignment =>
          sameId(
            assignment.segment_id,
            change.segmentId
          ) &&
          sameId(
            assignment.member_id,
            change.replacedMemberId
          )
      )

    const requiredRole = normaliseRole(
      originalAssignment?.role_name
    )

    if (!requiredRole) {
      warnings.push(
        `Required specialty is not recorded for ` +
        `segment ${change.segmentId}`
      )

      continue
    }

    const replacementRoles =
      list(data.segment_assignments)
        .filter(assignment =>
          sameId(
            assignment.member_id,
            change.replacementMemberId
          )
        )
        .map(assignment =>
          normaliseRole(
            assignment.role_name
          )
        )

    if (
      !replacementRoles.includes(
        requiredRole
      )
    ) {
      warnings.push(
        `Specialty verification required for ` +
        `replacement member ` +
        `${change.replacementMemberId}: ` +
        `required role "${requiredRole}"`
      )
    }
  }

  return warnings
}

// ========================================================
// STEP 9: VALIDATE PROPOSED SEGMENT TIMES
// ========================================================

function checkInvalidTimes(plan) {
  const conflicts = []

  for (const segment of plan.segments) {
    const start = timestamp(
      segment.starts_at
    )

    const end = timestamp(
      segment.ends_at
    )

    if (!validPeriod(start, end)) {
      conflicts.push({
        type: 'INVALID_SEGMENT_TIME',
        segmentId: segment.id,
        message:
          `Invalid proposed timing for ${segment.title}`
      })
    }
  }

  return conflicts
}

// ========================================================
// STEP 10: CALCULATE TIMETABLE SCORE
// ========================================================

/*
The less a recovery plan changes the original schedule,
the higher its timetable preservation score.

Penalty:
- 1 point per 5 minutes of total timing movement.
- 5 points per activity with a changed venue.

The values are design heuristics and can be adjusted
after testing with realistic event schedules.
*/

function calculateTimetableScore(
  originalSegments,
  plan
) {
  const originalMap = getSegmentMap(
    originalSegments
  )

  let movementMinutes = 0
  let changedSegments = 0

  for (const segment of plan.segments) {
    const original = originalMap.get(
      String(segment.id)
    )

    if (!original) continue

    const startMovement = Math.abs(
      timestamp(segment.starts_at) -
      timestamp(original.starts_at)
    ) / MINUTE

    const endMovement = Math.abs(
      timestamp(segment.ends_at) -
      timestamp(original.ends_at)
    ) / MINUTE

    if (
      startMovement > 0 ||
      endMovement > 0
    ) {
      changedSegments++
    }

    movementMinutes +=
      (startMovement + endMovement) / 2
  }

  const venueChanges =
    plan.venueOverrides.size

  const penalty =
    movementMinutes / 5 +
    venueChanges * 5

  return {
    score: round(
      clamp(100 - penalty)
    ),
    movementMinutes: round(
      movementMinutes
    ),
    changedSegments,
    venueChanges
  }
}

// ========================================================
// STEP 11: CALCULATE MEMBER WORKLOAD SCORE
// ========================================================

/*
Count each member's assignments after the proposed
changes.

More commitments result in a lower workload score.

This is a simple workload proxy, NOT a verified
fatigue or burnout assessment.

For a more accurate burnout algorithm, future data
should include rehearsal duration, weekly hours,
rest periods and member availability preferences.
*/

function calculateWorkloadScore(
  data,
  eventId,
  plan
) {
  const eventSegmentIds = new Set(
    plan.segments.map(segment =>
      String(segment.id)
    )
  )

  const assignments = [
    ...list(data.segment_assignments).filter(
      assignment =>
        !eventSegmentIds.has(
          String(assignment.segment_id)
        )
    ),
    ...plan.assignments.filter(
      assignment =>
        eventSegmentIds.has(
          String(assignment.segment_id)
        )
    )
  ]

  const load = new Map()

  for (const assignment of assignments) {
    const id = String(
      assignment.member_id
    )

    load.set(
      id,
      (load.get(id) || 0) + 1
    )
  }

  const eventMemberIds = unique(
    plan.assignments
      .filter(assignment =>
        eventSegmentIds.has(
          String(assignment.segment_id)
        )
      )
      .map(assignment =>
        String(assignment.member_id)
      )
  )

  if (!eventMemberIds.length) {
    return {
      score: null,
      maximumAssignments: null,
      reason: 'No member assignments available'
    }
  }

  const maximumAssignments = Math.max(
    ...eventMemberIds.map(
      id => load.get(id) || 0
    )
  )

  // Illustrative workload heuristic:
  // 1 assignment -> 100
  // 2 assignments -> 90
  // 3 assignments -> 80
  // and so on.
  const score = clamp(
    100 - Math.max(
      0,
      maximumAssignments - 1
    ) * 10
  )

  return {
    score,
    maximumAssignments,
    reason:
      'Based on the maximum recorded assignment count'
  }
}

// ========================================================
// STEP 12: CALCULATE VENUE SCORE
// ========================================================

/*
Prefer retaining the existing venue when possible.

Every venue change has a small operational cost.

Unknown venue capacity or equipment does NOT count
as verified suitability. Such information must be
checked separately.
*/

function calculateVenueScore(plan) {
  const changes =
    plan.venueOverrides.size

  return {
    score: clamp(
      100 - changes * 10
    ),
    venueChanges: changes
  }
}

// ========================================================
// STEP 13: EVALUATE ONE RECOVERY PLAN
// ========================================================

/*
This is the main scoring function.

Hard constraints:
- Invalid segment timings
- Member clashes
- Dependency conflicts
- Facility clashes
- Member/facility unavailability

Warnings:
- Unverified venue booking
- Unverified member specialty
- Missing facility information

A plan with warnings cannot be automatically marked
as fully feasible.

The score is still useful for comparing tentative
options, but only fully verified feasible plans may
receive RECOMMENDED status.
*/

export function evaluateRecoveryPlan({
  data,
  eventId,
  disruptions = [],
  option
}) {
  if (!data || !eventId || !option) {
    throw new Error(
      'data, eventId and option are required'
    )
  }

  const originalSegments = getEventSegments(
    data,
    eventId
  )

  if (!originalSegments.length) {
    throw new Error(
      'No event segments found for evaluation'
    )
  }

  const plan = buildProposedPlan(
    data,
    eventId,
    option
  )

  const facilityResult =
    checkFacilityConflicts(
      data,
      plan,
      disruptions
    )

  const conflicts = [
    ...checkInvalidTimes(plan),
    ...checkMemberConflicts(
      data,
      eventId,
      plan
    ),
    ...checkDependencyConflicts(
      data,
      plan
    ),
    ...checkUnavailableMembers(
      plan,
      disruptions
    ),
    ...facilityResult.conflicts
  ]

  const warnings = unique([
    ...plan.errors,
    ...facilityResult.warnings,
    ...checkReplacementSpecialty(
      data,
      option
    )
  ])

  // Remove duplicate conflict messages.
  const uniqueConflicts = [
    ...new Map(
      conflicts.map(conflict => [
        JSON.stringify(conflict),
        conflict
      ])
    ).values()
  ]

  const timetable =
    calculateTimetableScore(
      originalSegments,
      plan
    )

  const workload =
    calculateWorkloadScore(
      data,
      eventId,
      plan
    )

  const venue =
    calculateVenueScore(plan)

  // Conflict score is zero if there are known
  // conflicts, otherwise 100.
  //
  // A conflict-free plan with incomplete data may
  // still require manual review.
  const conflictScore =
    uniqueConflicts.length === 0
      ? 100
      : 0

  const workloadScore =
    workload.score ?? 0

  const score = round(
    conflictScore *
      RECOVERY_WEIGHTS.conflict +

    timetable.score *
      RECOVERY_WEIGHTS.timetable +

    workloadScore *
      RECOVERY_WEIGHTS.workload +

    venue.score *
      RECOVERY_WEIGHTS.venue
  )

  const status =
    uniqueConflicts.length > 0
      ? 'INFEASIBLE'
      : warnings.length > 0 ||
        workload.score == null
        ? 'NEEDS_REVIEW'
        : 'FEASIBLE'

  const reasons = []

  if (uniqueConflicts.length) {
    reasons.push(
      `${uniqueConflicts.length} known conflict(s) remain`
    )
  } else {
    reasons.push(
      'No conflicts detected in accessible records'
    )
  }

  if (timetable.movementMinutes > 0) {
    reasons.push(
      `${timetable.movementMinutes} total minutes ` +
      `of schedule movement`
    )
  }

  if (timetable.venueChanges > 0) {
    reasons.push(
      `${timetable.venueChanges} venue change(s)`
    )
  }

  if (warnings.length) {
    reasons.push(
      `${warnings.length} item(s) require manual verification`
    )
  }

  return {
    id: option.id,
    title:
      option.title ||
      'Untitled Recovery Option',

    score,
    status,
    feasible: status === 'FEASIBLE',

    scoreBreakdown: {
      conflict: conflictScore,
      timetable: timetable.score,
      workload: workload.score,
      venue: venue.score
    },

    metrics: {
      conflictCount:
        uniqueConflicts.length,

      warningCount:
        warnings.length,

      changedSegments:
        timetable.changedSegments,

      movementMinutes:
        timetable.movementMinutes,

      venueChanges:
        timetable.venueChanges,

      maximumAssignments:
        workload.maximumAssignments
    },

    conflicts: uniqueConflicts,
    warnings,
    reasons,

    // The actual proposed schedule for Plan Comparison.
    proposedSegments: plan.segments,

    // Temporary replacement assignments.
    proposedAssignments: plan.assignments,

    // Venue overrides are returned as plain objects
    // so they are easy to display in Vue.
    proposedVenues:
      Object.fromEntries(
        plan.venueOverrides
      ),

    changes: list(option.changes)
  }
}

// ========================================================
// STEP 14: RANK MULTIPLE RECOVERY PLANS
// ========================================================

/*
Ranking rules:

1. FEASIBLE plans come first.
2. NEEDS_REVIEW plans come second.
3. INFEASIBLE plans come last.

Within each group:
- Higher recovery score ranks first.
- Fewer conflicts breaks a tie.
- Less schedule movement breaks a tie.

Only a FEASIBLE plan may be automatically selected
as the recommended recovery plan.
*/

export function evaluateRecoveryPlans({
  data,
  eventId,
  disruptions = [],
  simulationResult = null,
  options = []
}) {
  if (!Array.isArray(options)) {
    throw new Error(
      'options must be an array'
    )
  }

  const evaluated = options.map(option =>
    evaluateRecoveryPlan({
      data,
      eventId,
      disruptions,
      option
    })
  )

  const statusRank = {
    FEASIBLE: 0,
    NEEDS_REVIEW: 1,
    INFEASIBLE: 2
  }

  evaluated.sort((a, b) => {
    const statusDifference =
      statusRank[a.status] -
      statusRank[b.status]

    if (statusDifference !== 0) {
      return statusDifference
    }

    if (a.score !== b.score) {
      return b.score - a.score
    }

    if (
      a.metrics.conflictCount !==
      b.metrics.conflictCount
    ) {
      return (
        a.metrics.conflictCount -
        b.metrics.conflictCount
      )
    }

    return (
      a.metrics.movementMinutes -
      b.metrics.movementMinutes
    )
  })

  const rankedPlans = evaluated.map(
    (plan, index) => ({
      ...plan,
      rank: index + 1
    })
  )

  const recommendedPlan =
    rankedPlans.find(
      plan => plan.status === 'FEASIBLE'
    ) || null

  return {
    eventId,

    // Existing simulation results are kept
    // for comparison and explanation.
    simulationConflictCount:
      simulationResult?.conflictCounts?.total ??
      null,

    evaluatedCount:
      rankedPlans.length,

    feasibleCount:
      rankedPlans.filter(
        plan => plan.status === 'FEASIBLE'
      ).length,

    needsReviewCount:
      rankedPlans.filter(
        plan => plan.status === 'NEEDS_REVIEW'
      ).length,

    rankedPlans,

    recommendedPlan,

    summary: recommendedPlan
      ? (
          `Recommended: ${recommendedPlan.title} ` +
          `(score ${recommendedPlan.score}/100). ` +
          `Requires organiser approval before applying.`
        )
      : rankedPlans.length
        ? (
            'No fully verified feasible recovery plan. ' +
            'Review the warnings and conflicts.'
          )
        : (
            'No recovery options were provided for evaluation.'
          )
  }
}
