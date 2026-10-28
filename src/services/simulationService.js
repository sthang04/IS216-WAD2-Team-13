/*

PURPOSE:
This file contains the logic used to simulate disruptions without changing actual facility bookings.

For example:
If Studio L7.2 becomes unavailable from 19:00 to 20:00, the simulator checks which existing bookings overlap
with that unavailable period.

IMPORTANT:
- This file does NOT update the Supabase database.
- It only calculates the possible impact.
- It supports multiple facility disruptions at once.
- The facilities and bookings are NOT hardcoded here. They are passed into the function from existing data.

*/

import {
  checkMemberUnavailabilityConflicts,
  checkFacilityUnavailabilityConflicts,
  compareDependencyConflicts,
  compareMemberScheduleConflicts,
  compareFacilityScheduleConflicts
} from './conflictService.js';

/* 
   STEP 1: Convert time into minutes

   Facility bookings store time as text (e.g. "19:00").
   Convert this into minutes since midnight so that
   time periods can be compared easily.
 */

function toMinutes(time) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);

  // Reject invalid time formats.
  if (!match) {
    throw new Error(`Invalid time: ${time}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  return hours * 60 + minutes;
}


/* 
   STEP 2: Check whether two time periods overlap

   Determines whether a disruption overlaps with an
   existing facility booking.

   Time periods that only touch at their boundaries
   are NOT considered overlapping.
*/

function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}


/* 
   STEP 3: Run the facility disruption simulation

   This is the main function.

   INPUTS:
   1. slots
      Existing facility booking records from Supabase.

   2. disruptions
      Hypothetical facility disruptions selected by the user.

   OUTPUT:
   - affectedSlots: Bookings affected by disruptions.
   - affectedCount: Total number of affected bookings.

   No database changes are made.
*/

export function simulateFacilityDisruptions(
  slots,
  disruptions
) {

  /* 
     STEP 3A: Prepare and validate disruptions

     For each disruption:
     1. Check that the disruption type is supported.
     2. Check that the facility and date are provided.
     3. Validate the start and end times.
     4. Ensure the end time is after the start time.
     5. Generate a temporary ID if no ID is provided.
     6. Convert times into minutes for comparison.
  */

  const prepared = disruptions.map((d, index) => {

    if (d.type !== 'FACILITY_UNAVAILABLE') {
      throw new Error(
        `Unsupported disruption: ${d.type}`
      );
    }

    if (!d.venueName || !d.date) {
      throw new Error(
        'Venue and date are required'
      );
    }

    const start = toMinutes(d.start);
    const end = toMinutes(d.end);

    if (start >= end) {
      throw new Error(
        'End time must be after start time'
      );
    }

    // Generate a temporary ID if one is missing.
    return {
      ...d,
      id: d.id || `disruption-${index + 1}`,
      startMinutes: start,
      endMinutes: end
    };
  });


  /* 
     STEP 3B: Find affected facility bookings

     For each existing booking:
     1. Read the booking's time slot.
     2. Convert its start and end times into minutes.
     3. Validate the booking time range.
     4. Compare the booking against ALL disruptions.
     5. Check whether the facility, date and times match.
     6. Record the booking if it is affected.

     A booking affected by multiple disruptions is
     only counted once.
  */

  const affectedSlots = slots.flatMap(slot => {

    const [from, to] = slot.time_slot.split(
      /\s*-\s*/
    );

    const slotStart = toMinutes(from);
    const slotEnd = toMinutes(to);

    // Reject invalid booking time ranges.
    if (slotStart >= slotEnd) {
      throw new Error(
        `Invalid booking time: ${slot.time_slot}`
      );
    }

    /* Find every disruption affecting this booking.
       All three conditions must be satisfied:
       - Same facility
       - Same date
       - Overlapping time
    */

    const causes = prepared.filter(d =>
      d.venueName === slot.venue_name &&
      d.date === slot.event_date &&
      overlaps(
        slotStart,
        slotEnd,
        d.startMinutes,
        d.endMinutes
      )
    );

    // Exclude bookings that are not affected.
    if (causes.length === 0) {
      return [];
    }

    /* Return the affected booking.
       causedBy contains the IDs of all disruptions
       responsible for affecting this booking.
    */

    return [{
      ...slot,
      causedBy: causes.map(d => d.id)
    }];
  });


  /* 
     STEP 3C: Return simulation results

     affectedSlots:
     All existing bookings affected by disruptions.

     affectedCount:
     Total number of affected bookings.

     Results can be displayed in the UI.
     No Supabase database changes are made.
  */

  return {
    affectedSlots,
    affectedCount: affectedSlots.length
  };
  
}

/*

STEP 2: DYNAMIC MULTI-DISRUPTION SIMULATION

PURPOSE:
Simulate different disruptions against an event.

Supported disruption types:
1. Member Unavailability
2. Facility Unavailability
3. Schedule Delay

The function accepts an ARRAY of disruptions,
so multiple disruptions can be tested together.

This stage identifies:
- Directly affected activities
- Affected facility bookings
- Downstream activities requiring review

Detailed conflict validation comes next.

IMPORTANT:
All changes are made to a temporary copy.
No Supabase database updates are performed.

*/

// Convert a timestamp into milliseconds.
// This makes comparing dates and times easier.

function simulationTime(value) {
  const time = Date.parse(value);

  if (!Number.isFinite(time)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }

  return time;
}


// Check whether two time periods overlap.

function periodsOverlap(aStart, aEnd, bStart, bEnd) {
  return (
    simulationTime(aStart) < simulationTime(bEnd) &&
    simulationTime(bStart) < simulationTime(aEnd)
  );
}


// Convert a facility booking's text time into timestamps.

function getBookingPeriod(slot) {
  const [start, end] = slot.time_slot.split(/\s*-\s*/);

  return {
    start: `${slot.event_date}T${start}:00+08:00`,
    end: `${slot.event_date}T${end}:00+08:00`
  };
}


/* Main simulation function.

INPUTS:
- data        = Event data from our test file
- eventId     = Event selected for simulation
- disruptions = List of hypothetical disruptions

*/

export function runSimulation(data, eventId, disruptions) {

  // STEP 1: Create an independent data copy.
  // This protects the original event plan.

  const snapshot = structuredClone(data);

  // Retrieve activities belonging to the event.
  const segments = snapshot.event_segments.filter(
    s => s.event_id === eventId
  );

  const segmentMap = new Map(
    segments.map(s => [s.id, s])
  );

  // Store affected activities and bookings.
  // Maps/Sets prevent duplicate results.

  const directImpacts = new Map();
  const affectedBookingIds = new Set();


  // Helper: record why an activity is affected.

  function markAffected(segmentId, disruption, reason) {
    const segment = segmentMap.get(segmentId);
    if (!segment) return;

    if (!directImpacts.has(segmentId)) {
      directImpacts.set(segmentId, {
        segmentId,
        title: segment.title,
        causes: []
      });
    }

    directImpacts.get(segmentId).causes.push({
      disruptionId: disruption.id,
      type: disruption.type,
      reason
    });
  }


  // STEP 2: Apply schedule delays first.
  // This ensures other disruptions are checked against the updated simulated timings.

  for (const d of disruptions) {
    if (d.type !== 'SCHEDULE_DELAY') continue;

    const segment = segmentMap.get(d.segmentId);

    if (!segment) {
      throw new Error('Selected segment not found');
    }

    if (
      !Number.isInteger(d.delayMinutes) ||
      d.delayMinutes < 0
    ) {
      throw new Error('Invalid delay duration');
    }

    const delay = d.delayMinutes * 60 * 1000;

    segment.starts_at = new Date(
      simulationTime(segment.starts_at) + delay
    ).toISOString();

    segment.ends_at = new Date(
      simulationTime(segment.ends_at) + delay
    ).toISOString();

    if (delay > 0) {
      markAffected(
        segment.id,
        d,
        `Activity delayed by ${d.delayMinutes} minutes`
      );
    }
  }


  // STEP 3: Check member and facility disruptions.

  for (const d of disruptions) {

    if (d.type === 'SCHEDULE_DELAY') continue;

    if (
      d.type !== 'MEMBER_UNAVAILABLE' &&
      d.type !== 'FACILITY_UNAVAILABLE'
    ) {
      throw new Error(`Unsupported disruption: ${d.type}`);
    }

    // Validate the unavailable period.
    const start = simulationTime(d.start);
    const end = simulationTime(d.end);

    if (start >= end) {
      throw new Error('Invalid unavailability period');
    }


    // CASE A: MEMBER UNAVAILABLE
    //
    // Find assignments belonging to the member,
    // then check whether their activity overlaps
    // the unavailable period.

    if (d.type === 'MEMBER_UNAVAILABLE') {

      for (const assignment of snapshot.segment_assignments) {
        if (assignment.member_id !== d.memberId) continue;

        const segment = segmentMap.get(
          assignment.segment_id
        );

        if (!segment) continue;

        if (periodsOverlap(
          segment.starts_at,
          segment.ends_at,
          d.start,
          d.end
        )) {
          markAffected(
            segment.id,
            d,
            `Assigned ${assignment.role_name} unavailable`
          );
        }
      }
    }


    // CASE B: FACILITY UNAVAILABLE
    
    // Find facility bookings at the selected venue. Then identify linked activities overlapping the unavailable period.

    if (d.type === 'FACILITY_UNAVAILABLE') {

      for (const slot of snapshot.facility_slots) {
        if (slot.venue_name !== d.venueName) continue;

        const booking = getBookingPeriod(slot);

        if (!periodsOverlap(
          booking.start,
          booking.end,
          d.start,
          d.end
        )) continue;

        // Record the affected booking once.
        affectedBookingIds.add(slot.id);

        // Find activities linked to this booking.
        for (const link of snapshot.segment_facility_slots) {
          if (link.facility_slot_id !== slot.id) continue;

          const segment = segmentMap.get(link.segment_id);
          if (!segment) continue;

          if (periodsOverlap(
            segment.starts_at,
            segment.ends_at,
            d.start,
            d.end
          )) {
            markAffected(
              segment.id,
              d,
              `Facility unavailable: ${slot.venue_name}`
            );
          }
        }
      }
    }
  }


  // STEP 4: Find downstream dependencies.
  // If a directly affected activity is required before another activity, flag that later activity for review.
  // This does not automatically mean the later activity is cancelled or blocked.

  const downstreamIds = new Set();
  const visited = new Set(directImpacts.keys());
  const queue = [...directImpacts.keys()];

  while (queue.length > 0) {
    const currentId = queue.shift();

    for (const dependency of snapshot.segment_dependencies) {

      if (dependency.prerequisite_segment_id !== currentId) {
        continue;
      }

      const nextId = dependency.dependent_segment_id;

      if (!segmentMap.has(nextId) || visited.has(nextId)) {
        continue;
      }

      visited.add(nextId);
      queue.push(nextId);

      if (!directImpacts.has(nextId)) {
        downstreamIds.add(nextId);
      }
    }
  }


  // STEP 5: Return the results.
  // This function only returns JavaScript data.
  // It never inserts, updates or deletes bookings.

  return {
    eventId,
    disruptionCount: disruptions.length,

    directImpacts: [...directImpacts.values()],

    downstreamRisks: [...downstreamIds].map(id => ({
      segmentId: id,
      title: segmentMap.get(id).title,
      status: 'REQUIRES_REVIEW'
    })),

    affectedBookings: snapshot.facility_slots.filter(
      slot => affectedBookingIds.has(slot.id)
    ),

    simulatedSegments: segments
  };
}


/*

STEP 6: COMPLETE SIMULATION FUNCTION

PURPOSE:
Combine all disruption and conflict checks
into one function.

WHAT IT DOES:
1. Checks that the selected event exists.
2. Runs all selected disruptions together.
3. Detects unavailable member conflicts.
4. Detects unavailable facility conflicts.
5. Detects new dependency timing conflicts.
6. Combines the results into one report.

IMPORTANT:
This function only calculates results.
It does NOT change Supabase bookings.

*/

export function runCompleteSimulation(
  data,
  eventId,
  disruptions
) {

  // STEP 1: Check whether the event exists.
  const event = data.events.find(
    e => e.id === eventId
  );

  if (!event) {
    throw new Error('Selected event not found');
  }

  // Make sure at least one disruption is selected.
  if (!Array.isArray(disruptions) ||
      disruptions.length === 0) {
    throw new Error('Add at least one disruption');
  }


  // STEP 2: Run the disruption simulation.
  // This uses our existing runSimulation() function to calculate hypothetical impacts.

  const simulation = runSimulation(
    data,
    eventId,
    disruptions
  );


  // STEP 3: Get the original event activities.
  // We need them to compare the event schedule before and after the disruptions.

  const originalSegments = data.event_segments.filter(
    segment => segment.event_id === eventId
  );

  const segmentIds = new Set(
    originalSegments.map(s => s.id)
  );


  // Get dependencies belonging to this event.
  const dependencies = data.segment_dependencies.filter(
    d =>
      segmentIds.has(d.prerequisite_segment_id) &&
      segmentIds.has(d.dependent_segment_id)
  );


  // STEP 4: Check member availability conflicts.
  const memberConflicts =
    checkMemberUnavailabilityConflicts(
      data,
      simulation.simulatedSegments,
      disruptions
    );


  // STEP 5: Check facility availability conflicts.
  const facilityConflicts =
    checkFacilityUnavailabilityConflicts(
      data,
      simulation.simulatedSegments,
      disruptions
    );


  // STEP 6: Compare dependency timing conflicts.
  // Only newly introduced timing conflicts should count as new conflicts.

  const dependencyComparison =
    compareDependencyConflicts(
      originalSegments,
      simulation.simulatedSegments,
      dependencies
    );

    
// STEP 7: CHECK MEMBER DOUBLE-BOOKING
// PURPOSE:
// Compare member assignments before and after applying the disruptions.
// Only NEW conflicts are reported. Existing overlaps are kept in the baseline.

const memberScheduleComparison =
  compareMemberScheduleConflicts(
    data,
    originalSegments,
    simulation.simulatedSegments
  );

// STEP 8:  CHECK FACILITY SCHEDULE CLASHES

const facilityScheduleComparison =
  compareFacilityScheduleConflicts(
    data,
    originalSegments,
    simulation.simulatedSegments
  );


// STEP 9: Combine all conflicts.
// Using a Map prevents duplicate conflict keys from being counted multiple times.

const allConflicts = [
  ...memberConflicts,
  ...facilityConflicts,
  ...dependencyComparison.newConflicts,
  ...memberScheduleComparison.newConflicts,
  ...facilityScheduleComparison.newConflicts
];
  
// STEP 10: REMOVE DUPLICATE CONFLICTS
// PURPOSE: Different disruption scenarios may introduce the same conflict.
// We use each conflict's unique "key" to ensure that it is counted only once.

// Create a Map using each conflict's unique key.
const uniqueConflicts = new Map(
  allConflicts.map(conflict => [
    conflict.key,
    conflict
  ])
);

// Convert the unique conflicts back into an array.
// This array will be returned to the Vue interface.
const newConflicts = [
  ...uniqueConflicts.values()
];

// STEP 11: IDENTIFY ALL AFFECTED BOOKINGS
// PURPOSE:
// Include facility bookings impacted by:
// 1. Facility unavailability
// 2. New facility scheduling conflicts
// Set prevents the same booking being counted more than once.

// Start with bookings affected by unavailable venues.
const affectedBookingIds = new Set(
  simulation.affectedBookings.map(booking => booking.id)
);

// Include bookings involved in new scheduling clashes.
for (const conflict of facilityScheduleComparison.newConflicts) {
  affectedBookingIds.add(conflict.facilitySlotId);
}

// Retrieve the actual affected booking records.
const affectedBookings = data.facility_slots.filter(
  booking => affectedBookingIds.has(booking.id)
);

  // STEP 10: Return the complete simulation report.
  // These results will eventually be shown in the What-If Simulator Vue interface.

  return {
  ...simulation,

  // Override the original booking impact list with the combined booking impact results.
  affectedBookings,

  eventName: event.name,

    newConflicts,

    
    conflictCounts: {

      // Required members unavailable
      member: memberConflicts.length,

      // Facilities unavailable during activities
      facility: facilityConflicts.length,

      // Activities violating prerequisites
      dependency: dependencyComparison.newConflicts.length,

      // Members assigned to overlapping activities
      memberDoubleBooking: memberScheduleComparison.newConflicts.length,

      // NEW: Activities overlapping at the same facility
      facilitySchedule: facilityScheduleComparison.newConflicts.length,

      // Total unique detected conflicts
      total: newConflicts.length

      },

    baselineDependencyConflicts:
      dependencyComparison.baseline
  };
}
