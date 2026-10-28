/*

PURPOSE:
Provide sample event data while developing
the What-If Disruption Simulator.

WHY DO WE NEED THIS?
Our event data exists in Supabase, but the
Vue application cannot read it yet because
authentication and read policies are not ready.

This file allows us to develop and test
the simulator without waiting for RBAC.

IMPORTANT:
- This contains TEST DATA only.
- It does NOT connect to Supabase.
- It does NOT change live bookings.
- The simulation engine will calculate impacts
  instead of using hardcoded results.
- Once RBAC is ready, this data can be replaced
  with records retrieved from Supabase.

*/

// 29.10 src/data/simulationTestData.js is a development reference. It won't affect live simulator as long as nothing imports or calls it.


// 1. EVENTS
// Stores the event being simulated.
// For testing, we're using the same demo event that we previously created in Supabase.

const events = [
  {
    id: 1,
    name: "Eurhythmix Simulator Demo",
    club_name: "Eurhythmix",
    starts_at: "2027-10-16T18:00:00+08:00",
    ends_at: "2027-10-16T21:00:00+08:00"
  }
];

// 2. MEMBERS
// Stores the performers and crew.
// The simulator will use member IDs to find their assignments.
// For example, member ID 2 is Angel Low. But the simulation logic must work with ANY member ID, not just Angel Low.

const members = [
  {
    id: 1,
    full_name: "Mei Chen",
    club_name: "Eurhythmix"
  },
  {
    id: 2,
    full_name: "Angel Low",
    club_name: "Eurhythmix"
  },
  {
    id: 3,
    full_name: "Marcus Tan",
    club_name: "Eurhythmix"
  },
  {
    id: 4,
    full_name: "Darren Koh",
    club_name: "Eurhythmix"
  },
  {
    id: 5,
    full_name: "Rachel Chua",
    club_name: "Eurhythmix"
  }
];

// 3. EVENT SEGMENTS
// Stores activities within the event.
// Each segment has:
// - A unique ID
// - The event it belongs to
// - A title and activity type
// - Start and end timings
// These timings are needed to detect overlaps caused by disruptions.

const event_segments = [
  {
    id: 1,
    event_id: 1,
    title: "Act 1: Soundcheck",
    segment_type: "Soundcheck",
    starts_at: "2027-10-16T18:00:00+08:00",
    ends_at: "2027-10-16T18:30:00+08:00"
  },
  {
    id: 2,
    event_id: 1,
    title: "Doors Open & FOH Handover",
    segment_type: "Operations",
    starts_at: "2027-10-16T19:15:00+08:00",
    ends_at: "2027-10-16T19:30:00+08:00"
  },
  {
    id: 3,
    event_id: 1,
    title: "Opening Night Performance",
    segment_type: "Performance",
    starts_at: "2027-10-16T19:30:00+08:00",
    ends_at: "2027-10-16T21:00:00+08:00"
  },
  {
    id: 4,
    event_id: 1,
    title: "Act 2: Tech Rehearsal",
    segment_type: "Rehearsal",
    starts_at: "2027-10-16T18:30:00+08:00",
    ends_at: "2027-10-16T19:15:00+08:00"
  }
];

// 4. MEMBER ASSIGNMENTS
// Connects members to event segments.
// Example:
// member_id: 2 = Angel Low
// segment_id: 4 = Act 2 Tech Rehearsal
// This tells the simulator that Angel Low is required for that rehearsal.
// If she becomes unavailable, the engine can identify this assignment automatically.

const segment_assignments = [
  { id: 1, segment_id: 1, member_id: 3, role_name: "Stage Manager", is_required: true },
  { id: 2, segment_id: 1, member_id: 1, role_name: "Sound Technician", is_required: true },

  { id: 3, segment_id: 2, member_id: 3, role_name: "Operations Coordinator", is_required: true },
  { id: 4, segment_id: 2, member_id: 1, role_name: "FOH Lead", is_required: true },

  { id: 5, segment_id: 3, member_id: 5, role_name: "Dance Captain", is_required: true },
  { id: 6, segment_id: 3, member_id: 2, role_name: "Lead Dancer", is_required: true },
  { id: 7, segment_id: 3, member_id: 4, role_name: "Technical Lead", is_required: true },

  { id: 8, segment_id: 4, member_id: 2, role_name: "Lead Dancer", is_required: true },
  { id: 9, segment_id: 4, member_id: 5, role_name: "Dance Captain", is_required: true },
  { id: 10, segment_id: 4, member_id: 4, role_name: "Technical Lead", is_required: true }
];

// 5. FACILITY BOOKINGS
// Represents existing facility reservations.
// We use the booking from our test event.
// If a facility becomes unavailable, the simulator checks which linked activities overlap with the disruption period.

const facility_slots = [
  {
    id: 3,
    venue_name: "Studio L7.2 (Dance)",
    venue_type: "Dance Studio",
    building_location: "Level 7",
    event_date: "2027-10-16",
    time_slot: "18:00 - 21:00",
    owner_club: "Eurhythmix",
    status: "Booked",
    claiming_club: null,
    audit_ticket_id: null,
    notes: null
  }
];

// 6. EVENT-FACILITY RELATIONSHIPS
// Identifies which activities use a facility.
// The three segments below use the booking with facility_slot_id = 3.
// This allows the simulator to find affected activities when a facility is unavailable.

const segment_facility_slots = [
  { segment_id: 1, facility_slot_id: 3 },
  { segment_id: 4, facility_slot_id: 3 },
  { segment_id: 3, facility_slot_id: 3 }
];

// 7. EVENT DEPENDENCIES
// Describes activities that depend on others.
// Example:
// Act 2 Tech Rehearsal must be completed before Opening Night Performance.
// If the rehearsal is disrupted, the engine can flag the performance as potentially affected by that dependency.

const segment_dependencies = [
  {
    prerequisite_segment_id: 1,
    dependent_segment_id: 4
  },
  {
    prerequisite_segment_id: 4,
    dependent_segment_id: 3
  },
  {
    prerequisite_segment_id: 2,
    dependent_segment_id: 3
  }
];

// 8. PROVIDE THE TEST DATA TO THE SIMULATOR
// This function combines all the test data into one object.
// structuredClone creates an independent copy so simulation changes cannot modify the original test dataset.
// Later, eventDataService.js can return the same structure using Supabase records.

export function getSimulationTestData() {
  return structuredClone({
    events,
    members,
    event_segments,
    segment_assignments,
    facility_slots,
    segment_facility_slots,
    segment_dependencies
  });
}
