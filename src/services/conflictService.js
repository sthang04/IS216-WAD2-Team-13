/*

PULSE - CONFLICT CHECKING SERVICE
File: src/services/conflictService.js


PURPOSE:
Check whether an event schedule violates
operational rules.

This first version checks dependency timing.

Example:
Activity A must finish before Activity B starts.

If a simulated delay causes Activity A to finish
after Activity B begins, a conflict is detected.

IMPORTANT:
- No member names are hardcoded.
- No event names are hardcoded.
- Works with different event schedules.
- Does not modify the original data.
- Does not update Supabase.

*/


/* 

STEP 1: Check dependency timing conflicts
INPUT:
- segments = event activities and their timings
- dependencies = relationships between activities

OUTPUT:
 A list of detected dependency conflicts.

 */

export function checkDependencyTimingConflicts(
  segments,
  dependencies
) {

  // Create a lookup so we can find activities quickly using their IDs.

  const segmentMap = new Map(
    segments.map(segment => [segment.id, segment])
  );

  const conflicts = [];


  // STEP 2: Check every dependency relationship.

  for (const dependency of dependencies) {

    // Find the activity that must happen first.
    const prerequisite = segmentMap.get(
      dependency.prerequisite_segment_id
    );

    // Find the activity that depends on it.
    const dependent = segmentMap.get(
      dependency.dependent_segment_id
    );

    // Ignore relationships outside this event.
    if (!prerequisite || !dependent) continue;


    // Convert timings into milliseconds.
    const prerequisiteEnd = Date.parse(
      prerequisite.ends_at
    );

    const dependentStart = Date.parse(
      dependent.starts_at
    );

    // Reject invalid timestamps.
    if (
      !Number.isFinite(prerequisiteEnd) ||
      !Number.isFinite(dependentStart)
    ) {
      throw new Error('Invalid segment timing');
    }


    // STEP 3: Detect timing violations.
    
    // The prerequisite must finish before  or exactly when the dependent starts.
    // If it finishes later, there is a conflict.

    if (prerequisiteEnd > dependentStart) {

      const overlapMinutes =
        (prerequisiteEnd - dependentStart) / 60000;

      conflicts.push({
        key: `DEPENDENCY:${prerequisite.id}:${dependent.id}`,
        type: 'DEPENDENCY_TIMING',
        severity: 'high',

        prerequisiteId: prerequisite.id,
        dependentId: dependent.id,

        overlapMinutes,

        message:
          `${prerequisite.title} finishes ` +
          `${overlapMinutes} minutes after ` +
          `${dependent.title} starts`
      });
    }
  }

  return conflicts;
}


// STEP 4: Compare original and simulated schedules.
// WHY? An event might already have conflicts before the simulation.
// We should not report those existing problems as NEW conflicts caused by a disruption.

export function compareDependencyConflicts(
  originalSegments,
  simulatedSegments,
  dependencies
) {

  // Check the original event schedule.
  const baseline = checkDependencyTimingConflicts(
    originalSegments,
    dependencies
  );

  // Check the schedule after disruptions.
  const simulated = checkDependencyTimingConflicts(
    simulatedSegments,
    dependencies
  );

  // Store identifiers of existing conflicts.
  const baselineKeys = new Set(
    baseline.map(conflict => conflict.key)
  );

  // Find conflicts introduced by the simulation.
  const newConflicts = simulated.filter(
    conflict => !baselineKeys.has(conflict.key)
  );

  return {
    baseline,
    simulated,
    newConflicts
  };
}


/*

MEMBER UNAVAILABILITY CONFLICT CHECKING

PURPOSE:
Detect when an unavailable member is assigned
to an activity during their unavailable period.

The function works for ANY member and event.
No member names or event IDs are hardcoded.

It also supports multiple member disruptions
within the same simulation.

IMPORTANT:
- Only required assignments create conflicts.
- The original data is not modified.
- No Supabase database operations are performed.

*/

export function checkMemberUnavailabilityConflicts(
  data,
  simulatedSegments,
  disruptions
) {

  // STEP 1: Create lookups for event segments and members using their unique IDs.

  const segmentMap = new Map(
    simulatedSegments.map(s => [s.id, s])
  );

  const memberMap = new Map(
    data.members.map(m => [m.id, m])
  );


  // STEP 2: Find all member unavailability disruptions selected by the user.
  // Other disruption types are handled by their own validation rules.

  const unavailableMembers = disruptions
    .filter(d => d.type === 'MEMBER_UNAVAILABLE')
    .map(d => {

      const start = Date.parse(d.start);
      const end = Date.parse(d.end);

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start >= end
      ) {
        throw new Error('Invalid member unavailability period');
      }

      return { ...d, startTime: start, endTime: end };
    });


  // STEP 3: Store any detected conflicts.

  const conflicts = [];


  // STEP 4: Examine every member assignment.

  for (const assignment of data.segment_assignments) {

    // Find the activity associated with this assignment.
    const segment = segmentMap.get(
      assignment.segment_id
    );

    // Ignore activities outside the selected event.
    if (!segment) continue;

    // Optional assignments do not generate a required-member conflict.
    if (assignment.is_required === false) continue;


    // STEP 5: Find unavailability periods that:
    // - Belong to the assigned member
    // - Overlap the simulated activity timing

    const segmentStart = Date.parse(segment.starts_at);
    const segmentEnd = Date.parse(segment.ends_at);

    const causes = unavailableMembers.filter(d =>
      d.memberId === assignment.member_id &&
      segmentStart < d.endTime &&
      d.startTime < segmentEnd
    );


    // If the member is available, no conflict.
    if (causes.length === 0) continue;


    // STEP 6: Retrieve the member information.
    const member = memberMap.get(
      assignment.member_id
    );


    // STEP 7: Record the conflict.
    // One assignment produces one conflict, even if several unavailability periods affect the same assignment.

    conflicts.push({
      key: `MEMBER_UNAVAILABLE:${assignment.id}`,
      type: 'MEMBER_UNAVAILABLE',
      severity: 'high',

      segmentId: segment.id,
      memberId: assignment.member_id,

      memberName: member?.full_name ?? 'Unknown member',
      segmentTitle: segment.title,
      roleName: assignment.role_name,

      causedBy: causes.map(d => d.id),

      message:
        `${member?.full_name ?? 'Member'} is unavailable ` +
        `for the required ${assignment.role_name} role ` +
        `during ${segment.title}`
    });
  }

  // STEP 8: Return all detected conflicts.
  // No original records have been modified.

  return conflicts;
}


/*

FACILITY UNAVAILABILITY CONFLICTS

PURPOSE:
Identify event activities affected when a
facility becomes unavailable.

The function checks:
1. Which facility is unavailable.
2. Which bookings use that facility.
3. Which activities are linked to those bookings.
4. Whether the disruption overlaps their timings.

It supports multiple facility disruptions.

IMPORTANT:
- Facility names are retrieved from the data.
- No specific facility is hardcoded.
- No Supabase data is modified.
=================================================
*/

export function checkFacilityUnavailabilityConflicts(
  data,
  simulatedSegments,
  disruptions
) {

  // STEP 1: Build lookups for quick access.
  // Map each segment and facility booking to its unique ID.

  const segmentMap = new Map(
    simulatedSegments.map(s => [s.id, s])
  );

  const facilityMap = new Map(
    data.facility_slots.map(f => [f.id, f])
  );


  // STEP 2: Get facility disruptions only.
  //
  // Member unavailability and schedule delays
  // are handled by the other checking rules.

  const facilityDisruptions = disruptions
    .filter(d => d.type === 'FACILITY_UNAVAILABLE');

  const conflicts = new Map();


  // STEP 3: Examine every segment-facility link.
  // This allows us to identify which activities actually depend on a facility booking.

  for (const link of data.segment_facility_slots) {

    const segment = segmentMap.get(link.segment_id);
    const facility = facilityMap.get(link.facility_slot_id);

    if (!segment || !facility) continue;


    // Convert existing booking text into timestamps.

    const [from, to] = facility.time_slot.split(/\s*-\s*/);

    const bookingStart = Date.parse(
      `${facility.event_date}T${from}:00+08:00`
    );

    const bookingEnd = Date.parse(
      `${facility.event_date}T${to}:00+08:00`
    );

    const segmentStart = Date.parse(segment.starts_at);
    const segmentEnd = Date.parse(segment.ends_at);

    if (
      ![bookingStart, bookingEnd, segmentStart, segmentEnd]
        .every(Number.isFinite) ||
      bookingStart >= bookingEnd ||
      segmentStart >= segmentEnd
    ) {
      throw new Error('Invalid facility or segment timing');
    }


    // STEP 4: Find disruptions that overlap both the linked booking and its activity.

    const causes = facilityDisruptions.filter(d => {

      const disruptionStart = Date.parse(d.start);
      const disruptionEnd = Date.parse(d.end);

      if (
        !Number.isFinite(disruptionStart) ||
        !Number.isFinite(disruptionEnd) ||
        disruptionStart >= disruptionEnd
      ) {
        throw new Error('Invalid facility disruption period');
      }

      return (
        // Same facility
        d.venueName === facility.venue_name &&

        // Booking overlaps disruption
        bookingStart < disruptionEnd &&
        disruptionStart < bookingEnd &&

        // Activity overlaps disruption
        segmentStart < disruptionEnd &&
        disruptionStart < segmentEnd
      );
    });


    // No overlap means no conflict.
    if (causes.length === 0) continue;


    // STEP 5: Record the facility conflict.
    // One activity-facility relationship produces one conflict, even when multiple disruptions affect it.

    const key =
      `FACILITY_UNAVAILABLE:${segment.id}:${facility.id}`;

    conflicts.set(key, {
      key,
      type: 'FACILITY_UNAVAILABLE',
      severity: 'high',

      segmentId: segment.id,
      segmentTitle: segment.title,

      facilitySlotId: facility.id,
      facilityName: facility.venue_name,
      bookingStatus: facility.status,

      causedBy: causes.map(d => d.id),

      message:
        `${facility.venue_name} is unavailable ` +
        `during ${segment.title}`
    });
  }


  // STEP 6: Return all detected conflicts.
  // This is a calculation only.
  // No database updates are performed.

  return [...conflicts.values()];
}


/*

COMBINE ALL SIMULATION AND CONFLICT CHECKS

PURPOSE:
Run every available conflict checker through
one function.

PROCESS:
1. Load the selected event information.
2. Run all hypothetical disruptions together.
3. Check member availability conflicts.
4. Check facility availability conflicts.
5. Compare dependency timing conflicts.
6. Combine the results into one report.

IMPORTANT:
- The simulation operates on temporary data.
- Existing bookings and assignments are unchanged.
- No Supabase updates are performed.
====================================================
*/

export function runCompleteSimulation(
  data,
  eventId,
  disruptions
) {

  // STEP 1: Validate the simulation request.
  // ExCo must select an existing event and provide at least one disruption.

  const event = data.events.find(
    e => e.id === eventId
  );

  if (!event) {
    throw new Error('Selected event not found');
  }

  if (!Array.isArray(disruptions) ||
      disruptions.length === 0) {
    throw new Error('Add at least one disruption');
  }


  // STEP 2: Run the simulation engine.
  // This applies all disruptions to a temporary event snapshot and identifies direct impacts.

  const simulation = runSimulation(
    data,
    eventId,
    disruptions
  );


  // STEP 3: Retrieve the event's original activities.
  // We need these to compare the event before and after the hypothetical disruptions.

  const originalSegments = data.event_segments.filter(
    segment => segment.event_id === eventId
  );

  const segmentIds = new Set(
    originalSegments.map(s => s.id)
  );


  // Retrieve only dependencies belonging to the selected event.

  const dependencies = data.segment_dependencies.filter(
    d =>
      segmentIds.has(d.prerequisite_segment_id) &&
      segmentIds.has(d.dependent_segment_id)
  );


  // STEP 4: Check member availability.
  // Identify required members who cannot attend their assigned activities.

  const memberConflicts =
    checkMemberUnavailabilityConflicts(
      data,
      simulation.simulatedSegments,
      disruptions
    );


  // STEP 5: Check facility availability.
  // Identify activities affected by unavailable facilities.

  const facilityConflicts =
    checkFacilityUnavailabilityConflicts(
      data,
      simulation.simulatedSegments,
      disruptions
    );


  // STEP 6: Check dependency timing.
  // Compare the original event schedule against the simulated schedule.
  // Only newly introduced dependency conflicts are included in the new-conflict total.

  const dependencyComparison =
    compareDependencyConflicts(
      originalSegments,
      simulation.simulatedSegments,
      dependencies
    );


  // STEP 7: Combine all detected conflicts.
  // Each conflict has a stable unique key.
  // Using a Map prevents duplicate keys from being counted more than once.

  const allConflicts = [
    ...memberConflicts,
    ...facilityConflicts,
    ...dependencyComparison.newConflicts
  ];

  const newConflicts = [
    ...new Map(
      allConflicts.map(c => [c.key, c])
    ).values()
  ];


  // STEP 8: Return the complete results
  // The Vue interface can use these values to display summary cards, explanations and the simulated event timeline.

  return {
    ...simulation,

    eventName: event.name,

    newConflicts,

    conflictCounts: {
      member: memberConflicts.length,
      facility: facilityConflicts.length,
      dependency: dependencyComparison.newConflicts.length,
      total: newConflicts.length
    },

    baselineDependencyConflicts:
      dependencyComparison.baseline
  };
}

/*

STEP 8: MEMBER DOUBLE-BOOKING CHECKER

PURPOSE:
Detect members assigned to multiple activities
that overlap in time.

EXAMPLE:
A rehearsal is delayed and now overlaps
with a performance.

If the same member is assigned to both,
the simulator should report a conflict.

This works for any member and event.
No database changes are made.

*/

export function compareMemberScheduleConflicts(
  data,
  originalSegments,
  simulatedSegments
) {

  // Find overlapping assignments in a schedule.
  function findConflicts(segments) {

    const conflicts = [];
    const segmentMap = new Map(
      segments.map(s => [s.id, s])
    );

    // Group event assignments by member.
    const assignmentsByMember = new Map();

    for (const assignment of data.segment_assignments) {

      // Ignore assignments outside this event.
      if (!segmentMap.has(assignment.segment_id)) {
        continue;
      }

      if (!assignmentsByMember.has(assignment.member_id)) {
        assignmentsByMember.set(
          assignment.member_id,
          new Set()
        );
      }

      assignmentsByMember
        .get(assignment.member_id)
        .add(assignment.segment_id);
    }

    // Check each member's assigned activities.
    for (const [memberId, segmentIds] of assignmentsByMember) {

      const ids = [...segmentIds].sort((a, b) => a - b);

      const member = data.members.find(
        m => m.id === memberId
      );

      // Compare each distinct pair of activities.
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {

          const first = segmentMap.get(ids[i]);
          const second = segmentMap.get(ids[j]);

          const start = Math.max(
            Date.parse(first.starts_at),
            Date.parse(second.starts_at)
          );

          const end = Math.min(
            Date.parse(first.ends_at),
            Date.parse(second.ends_at)
          );

          // If start >= end, there is no overlap.
          if (start >= end) continue;

          const overlapMinutes = (end - start) / 60000;

          conflicts.push({
            key: `MEMBER_OVERLAP:${memberId}:${ids[i]}:${ids[j]}`,
            type: 'MEMBER_DOUBLE_BOOKING',
            severity: 'high',

            memberId,
            memberName: member?.full_name ?? 'Unknown member',

            segmentIds: [ids[i], ids[j]],
            overlapMinutes,

            message:
              `${member?.full_name ?? 'Member'} is assigned to ` +
              `${first.title} and ${second.title}, ` +
              `which overlap by ${overlapMinutes} minutes`
          });
        }
      }
    }

    return conflicts;
  }

  // Check the original confirmed schedule.
  const baseline = findConflicts(originalSegments);

  // Check the simulated schedule.
  const simulated = findConflicts(simulatedSegments);

  // Only report conflicts that did not exist before.
  const baselineKeys = new Set(
    baseline.map(c => c.key)
  );

  const newConflicts = simulated.filter(
    c => !baselineKeys.has(c.key)
  );

  return {
    baseline,
    simulated,
    newConflicts
  };
}


/*

STEP 9: FACILITY SCHEDULE CONFLICT CHECKER

PURPOSE:
Detect when two event activities need the same
facility booking at overlapping times.

EXAMPLE:
Tech Rehearsal: 19:00 - 19:45
Performance:    19:30 - 21:00

Both activities use the same studio.

The simulator should detect a 15-minute
facility scheduling conflict.

IMPORTANT:
- Works with any linked facility and segment.
- Compares original and simulated schedules.
- Only reports NEW scheduling conflicts.
- Does not modify any database records.

ASSUMPTION:
Activities linked to the same facility booking
require exclusive use during their time period.

*/

export function compareFacilityScheduleConflicts(
  data,
  originalSegments,
  simulatedSegments
) {

  // STEP 1: Detect facility schedule overlaps  within a given event schedule.

  function findConflicts(segments) {

    const segmentMap = new Map(
      segments.map(s => [s.id, s])
    );

    const facilityMap = new Map(
      data.facility_slots.map(f => [f.id, f])
    );

    const segmentsByFacility = new Map();

    // STEP 2: Group activities by facility booking.

    for (const link of data.segment_facility_slots) {

      if (!segmentMap.has(link.segment_id)) continue;
      if (!facilityMap.has(link.facility_slot_id)) continue;

      if (!segmentsByFacility.has(link.facility_slot_id)) {
        segmentsByFacility.set(
          link.facility_slot_id,
          new Set()
        );
      }

      segmentsByFacility
        .get(link.facility_slot_id)
        .add(link.segment_id);
    }

    const conflicts = [];

    // STEP 3: Compare activities that use the same facility booking.

    for (const [facilityId, segmentIds] of segmentsByFacility) {

      const facility = facilityMap.get(facilityId);
      const ids = [...segmentIds].sort((a, b) => a - b);

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {

          const first = segmentMap.get(ids[i]);
          const second = segmentMap.get(ids[j]);

          const firstStart = Date.parse(first.starts_at);
          const firstEnd = Date.parse(first.ends_at);
          const secondStart = Date.parse(second.starts_at);
          const secondEnd = Date.parse(second.ends_at);

          // Validate activity timings.
          if (
            ![
              firstStart, firstEnd,
              secondStart, secondEnd
            ].every(Number.isFinite) ||
            firstStart >= firstEnd ||
            secondStart >= secondEnd
          ) {
            throw new Error('Invalid activity timing');
          }

          // STEP 4: Calculate overlapping minutes.
          const overlapStart = Math.max(
            firstStart,
            secondStart
          );

          const overlapEnd = Math.min(
            firstEnd,
            secondEnd
          );

          // No overlap means no conflict.
          if (overlapStart >= overlapEnd) continue;

          const overlapMinutes =
            (overlapEnd - overlapStart) / 60000;

          // STEP 5: Record the detected conflict.
          conflicts.push({
            key:
              `FACILITY_OVERLAP:${facilityId}:${ids[i]}:${ids[j]}`,

            type: 'FACILITY_SCHEDULE_OVERLAP',
            severity: 'high',

            facilitySlotId: facilityId,
            facilityName: facility.venue_name,

            segmentIds: [ids[i], ids[j]],
            overlapMinutes,

            message:
              `${first.title} and ${second.title} ` +
              `both use ${facility.venue_name} ` +
              `and overlap by ${overlapMinutes} minutes`
          });
        }
      }
    }

    return conflicts;
  }

  // STEP 6: Check the original event schedule.
  const baseline = findConflicts(originalSegments);

  // STEP 7: Check the simulated schedule.
  const simulated = findConflicts(simulatedSegments);

  // STEP 8: Identify only newly introduced conflicts.
  const baselineKeys = new Set(
    baseline.map(c => c.key)
  );

  const newConflicts = simulated.filter(
    c => !baselineKeys.has(c.key)
  );

  // STEP 9: Return the comparison results.
  return {
    baseline,
    simulated,
    newConflicts
  };
}

