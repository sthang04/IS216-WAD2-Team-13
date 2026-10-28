<script setup>
import { ref, computed, watch } from 'vue'

// Get temporary test data until Supabase RBAC is ready.
import { getSimulationTestData } from '../data/simulationTestData.js'

// Reuse the simulation engine we already built.
import { runCompleteSimulation } from '../services/simulationService.js'

// The cat mascot
import PipMascot from './PipMascot.vue'


// STEP 1: LOAD EVENT DATA

// Later, this data source will be replace with an authorised Supabase event snapshot.

const data = getSimulationTestData()

// Get all available events.
const events = data.events

// Store the event currently selected by ExCo.
const selectedEventId = ref(events[0]?.id ?? null)

// Store the simulation result and errors.
const result = ref(null)
const errorMessage = ref('')


// ============================================
// STEP 2: GET DATA FOR THE SELECTED EVENT
// ============================================

// Find the selected event.
const selectedEvent = computed(() =>
  events.find(e => e.id === selectedEventId.value)
)

// Find all activities belonging to the event.
const eventSegments = computed(() =>
  data.event_segments.filter(
    s => s.event_id === selectedEventId.value
  )
)

// Find members assigned to this event.
const eventMembers = computed(() => {
  const segmentIds = new Set(
    eventSegments.value.map(s => s.id)
  )

  const memberIds = new Set(
    data.segment_assignments
      .filter(a => segmentIds.has(a.segment_id))
      .map(a => a.member_id)
  )

  return data.members.filter(m => memberIds.has(m.id))
})

// Find facilities linked to the event.
// Remove duplicate facility names.
const eventFacilities = computed(() => {
  const segmentIds = new Set(
    eventSegments.value.map(s => s.id)
  )

  const facilityIds = new Set(
    data.segment_facility_slots
      .filter(link => segmentIds.has(link.segment_id))
      .map(link => link.facility_slot_id)
  )

  return [...new Set(
    data.facility_slots
      .filter(f => facilityIds.has(f.id))
      .map(f => f.venue_name)
  )]
})


// ============================================
// STEP 3: PREPARE DATE AND TIME INPUTS
// ============================================

// HTML datetime-local inputs need a value like:
// 2027-10-16T18:30
//
// Convert a stored timestamp into the user's
// local date and time for the input.

function toLocalInput(value) {
  const date = new Date(value)
  const pad = n => String(n).padStart(2, '0')

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + 'T' + [
    pad(date.getHours()),
    pad(date.getMinutes())
  ].join(':')
}

// Convert the user's selected local time back
// into a timestamp for the simulation engine.

function toTimestamp(value) {
  const date = new Date(value)

  if (!value || Number.isNaN(date.getTime())) {
    throw new Error('Please enter a valid date and time')
  }

  return date.toISOString()
}


// ============================================
// STEP 4: CREATE DISRUPTIONS DYNAMICALLY
// ============================================

let nextDisruptionId = 1

// Create a new disruption with default values.
// These values come from the selected event,
// not hardcoded members or facility names.

function createDisruption() {
  const event = selectedEvent.value

  return {
    id: `D${nextDisruptionId++}`,
    type: 'MEMBER_UNAVAILABLE',

    memberId: eventMembers.value[0]?.id ?? null,
    venueName: eventFacilities.value[0] ?? '',
    segmentId: eventSegments.value[0]?.id ?? null,

    start: event ? toLocalInput(event.starts_at) : '',
    end: event ? toLocalInput(event.ends_at) : '',

    delayMinutes: 10
  }
}

// The user starts with ONE disruption.
// They can add more if necessary.
const disruptions = ref([createDisruption()])

function addDisruption() {
  disruptions.value.push(createDisruption())
}

function removeDisruption(id) {
  // Keep at least one disruption input visible.
  if (disruptions.value.length <= 1) return

  disruptions.value = disruptions.value.filter(
    d => d.id !== id
  )
}


// ============================================
// STEP 5: RESET RESULTS WHEN INPUTS CHANGE
// ============================================

// When the user selects another event,
// reset the scenario to the new event's data.

watch(selectedEventId, () => {
  disruptions.value = [createDisruption()]
  result.value = null
  errorMessage.value = ''
})

// Prevent stale simulation results from being
// displayed after the user changes a disruption.

watch(disruptions, () => {
  result.value = null
  errorMessage.value = ''
}, { deep: true })


// ============================================
// STEP 6: CONVERT FORM DATA INTO SCENARIOS
// ============================================

function prepareDisruption(d) {

  // Member unavailable
  if (d.type === 'MEMBER_UNAVAILABLE') {
    if (d.memberId == null) {
      throw new Error('Please select a member')
    }

    return {
      id: d.id,
      type: d.type,
      memberId: d.memberId,
      start: toTimestamp(d.start),
      end: toTimestamp(d.end)
    }
  }

  // Facility unavailable
  if (d.type === 'FACILITY_UNAVAILABLE') {
    if (!d.venueName) {
      throw new Error('Please select a facility')
    }

    return {
      id: d.id,
      type: d.type,
      venueName: d.venueName,
      start: toTimestamp(d.start),
      end: toTimestamp(d.end)
    }
  }

  // Schedule delay
  if (d.type === 'SCHEDULE_DELAY') {
    if (d.segmentId == null) {
      throw new Error('Please select an activity')
    }

    if (
      !Number.isInteger(d.delayMinutes) ||
      d.delayMinutes <= 0
    ) {
      throw new Error(
        'Delay must be a positive whole number'
      )
    }

    return {
      id: d.id,
      type: d.type,
      segmentId: d.segmentId,
      delayMinutes: d.delayMinutes
    }
  }

  throw new Error('Unsupported disruption type')
}


// ============================================
// STEP 7: RUN THE SIMULATION
// ============================================

function run() {
  errorMessage.value = ''
  result.value = null

  try {
    // Convert all selected disruptions into
    // the format expected by our engine.
    const scenarios = disruptions.value.map(
      prepareDisruption
    )

    // Run the complete simulation.
    // The engine calculates impacts in memory.
    result.value = runCompleteSimulation(
      data,
      selectedEventId.value,
      scenarios
    )

  } catch (error) {
    // Display errors to the user instead of
    // crashing the entire application.
    errorMessage.value = error.message
  }
}


// ============================================
// STEP 8: PREPARE RESULTS FOR DISPLAY
// ============================================

// Sort the simulated activities by start time.
const sortedSegments = computed(() =>
  [...(result.value?.simulatedSegments ?? [])]
    .sort((a, b) =>
      Date.parse(a.starts_at) - Date.parse(b.starts_at)
    )
)

// Check if an activity was directly affected.
function isDirectlyAffected(segmentId) {
  return result.value?.directImpacts.some(
    impact => impact.segmentId === segmentId
  ) ?? false
}

// Check if an activity has downstream risk.
function hasDownstreamRisk(segmentId) {
  return result.value?.downstreamRisks.some(
    risk => risk.segmentId === segmentId
  ) ?? false
}

// Format timestamps for display.
function formatTime(value) {
  return new Date(value).toLocaleString('en-SG', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

</script>


<template>
  <section class="card shadow-sm mt-4">

    <div class="card-body p-4">

      <!-- SIMULATOR HEADER -->
      <div class="d-flex justify-content-between
                  align-items-center mb-2">

        <h3 class="fw-bold mb-0">
          What-If Disruption Simulator
        </h3>

        <span class="badge bg-secondary">
          Simulation Only
        </span>
      </div>

      <p class="text-muted">
        Test hypothetical disruptions without
        modifying confirmed event bookings.
      </p>


      <!-- EVENT SELECTION -->
      <div class="mb-4">
        <label class="form-label fw-bold">
          Select Event
        </label>

        <select
          v-model.number="selectedEventId"
          class="form-select"
        >
          <option
            v-for="event in events"
            :key="event.id"
            :value="event.id"
          >
            {{ event.name }}
          </option>
        </select>
      </div>


      <!-- DISRUPTION INPUTS -->
      <h5 class="fw-bold">
        Disruption Scenarios
      </h5>

      <p class="text-muted small">
        Add one or more disruptions to test
        their combined impact.
      </p>

      <div
        v-for="(d, index) in disruptions"
        :key="d.id"
        class="border rounded p-3 mb-3"
      >

        <div class="d-flex justify-content-between
                    align-items-center mb-3">

          <strong>
            Disruption {{ index + 1 }}
          </strong>

          <button
            type="button"
            class="btn btn-outline-danger btn-sm"
            :disabled="disruptions.length === 1"
            @click="removeDisruption(d.id)"
          >
            Remove
          </button>
        </div>


        <!-- DISRUPTION TYPE -->
        <div class="mb-3">
          <label class="form-label">
            Disruption Type
          </label>

          <select
            v-model="d.type"
            class="form-select"
          >
            <option value="MEMBER_UNAVAILABLE">
              Member Unavailability
            </option>

            <option value="FACILITY_UNAVAILABLE">
              Facility Unavailability
            </option>

            <option value="SCHEDULE_DELAY">
              Schedule Delay
            </option>
          </select>
        </div>


        <!-- MEMBER UNAVAILABILITY -->
        <div v-if="d.type === 'MEMBER_UNAVAILABLE'">
          <label class="form-label">
            Unavailable Member
          </label>

          <select
            v-model.number="d.memberId"
            class="form-select mb-3"
          >
            <option
              v-for="member in eventMembers"
              :key="member.id"
              :value="member.id"
            >
              {{ member.full_name }}
            </option>
          </select>
        </div>


        <!-- FACILITY UNAVAILABILITY -->
        <div
          v-else-if="d.type === 'FACILITY_UNAVAILABLE'"
        >
          <label class="form-label">
            Unavailable Facility
          </label>

          <select
            v-model="d.venueName"
            class="form-select mb-3"
          >
            <option
              v-for="facility in eventFacilities"
              :key="facility"
              :value="facility"
            >
              {{ facility }}
            </option>
          </select>
        </div>


        <!-- SCHEDULE DELAY -->
        <div v-else>
          <label class="form-label">
            Delayed Activity
          </label>

          <select
            v-model.number="d.segmentId"
            class="form-select mb-3"
          >
            <option
              v-for="segment in eventSegments"
              :key="segment.id"
              :value="segment.id"
            >
              {{ segment.title }}
            </option>
          </select>

          <label class="form-label">
            Delay (Minutes)
          </label>

          <input
            v-model.number="d.delayMinutes"
            type="number"
            min="1"
            step="1"
            class="form-control mb-3"
          />
        </div>


        <!-- UNAVAILABLE TIME PERIOD -->
        <div
          v-if="d.type !== 'SCHEDULE_DELAY'"
          class="row"
        >
          <div class="col-md-6 mb-3">
            <label class="form-label">
              Unavailable From
            </label>

            <input
              v-model="d.start"
              type="datetime-local"
              class="form-control"
            />
          </div>

          <div class="col-md-6 mb-3">
            <label class="form-label">
              Unavailable Until
            </label>

            <input
              v-model="d.end"
              type="datetime-local"
              class="form-control"
            />
          </div>
        </div>

      </div>


      <!-- ACTION BUTTONS -->
      <div class="d-flex flex-wrap gap-2 mb-4">

        <button
          type="button"
          class="btn btn-outline-primary"
          @click="addDisruption"
        >
          + Add Another Disruption
        </button>

        <button
          type="button"
          class="btn btn-danger"
          :disabled="!selectedEventId"
          @click="run"
        >
          Run Simulation ({{ disruptions.length }})
        </button>

      </div>


      <!-- ERROR MESSAGE -->
      <div
        v-if="errorMessage"
        class="alert alert-danger"
        role="alert"
      >
        {{ errorMessage }}
      </div>


      <!-- SIMULATION RESULTS -->
      <div v-if="result">

        <hr />

        <h4 class="fw-bold mb-3">
          Simulation Results
        </h4>


        <!-- SUMMARY CARDS -->
        <div class="row g-3 mb-4">

          <div
            v-for="card in [
              {
                label: 'Affected Segments',
                value: result.directImpacts.length
              },
              {
                label: 'New Conflicts',
                value: result.conflictCounts.total
              },
              {
                label: 'Affected Bookings',
                value: result.affectedBookings.length
              },
              {
                label: 'Downstream Risks',
                value: result.downstreamRisks.length
              }
            ]"
            :key="card.label"
            class="col-md-3 col-6"
          >
            <div class="card h-100">
              <div class="card-body">
                <small class="text-muted">
                  {{ card.label }}
                </small>

                <h2 class="fw-bold mt-2 mb-0">
                  {{ card.value }}
                </h2>
              </div>
            </div>
          </div>

        </div>


        <!-- CONFLICT EXPLANATIONS -->
        <h5 class="fw-bold">
          Detected Conflicts
        </h5>

        <p
          v-if="result.newConflicts.length === 0"
          class="text-muted"
        >
          No new conflicts detected by the
          currently implemented rules.
        </p>

        <div
          v-for="conflict in result.newConflicts"
          :key="conflict.key"
          class="alert alert-danger"
        >
          <strong>{{ conflict.type }}</strong>
          <p class="mb-0">
            {{ conflict.message }}
          </p>
        </div>


        <!-- DOWNSTREAM RISKS -->
        <h5 class="fw-bold mt-4">
          Downstream Impacts
        </h5>

        <p
          v-if="!result.downstreamRisks.length"
          class="text-muted"
        >
          No additional downstream segments
          identified.
        </p>

        <div
          v-for="risk in result.downstreamRisks"
          :key="risk.segmentId"
          class="alert alert-warning"
        >
          {{ risk.title }} — Requires Review
        </div>


        <!-- SIMULATED TIMELINE -->
        <h5 class="fw-bold mt-4">
          Simulated Event Timeline
        </h5>

        <div class="table-responsive">
          <table class="table table-bordered">

            <thead>
              <tr>
                <th>Activity</th>
                <th>Start</th>
                <th>End</th>
                <th>Impact</th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="segment in sortedSegments"
                :key="segment.id"
              >
                <td>{{ segment.title }}</td>

                <td>
                  {{ formatTime(segment.starts_at) }}
                </td>

                <td>
                  {{ formatTime(segment.ends_at) }}
                </td>

                <td>
                  <span
                    v-if="isDirectlyAffected(segment.id)"
                    class="badge bg-danger"
                  >
                    Direct Impact
                  </span>

                  <span
                    v-else-if="hasDownstreamRisk(segment.id)"
                    class="badge bg-warning text-dark"
                  >
                    At Risk
                  </span>

                  <span
                    v-else
                    class="badge bg-success"
                  >
                    No Detected Impact
                  </span>
                </td>
              </tr>
            </tbody>

          </table>
        </div>


        <p class="text-muted small mt-3">
          These are hypothetical results.
          No confirmed bookings or assignments
          have been modified.
        </p>

      </div>

    </div>
  </section>
  <!-- Pip automatically receives the latest simulation result -->
<PipMascot
  mode="simulation"
  :result="result"
/>
</template>
