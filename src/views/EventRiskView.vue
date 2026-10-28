<script setup>
import {
  ref,
  shallowRef,
  computed,
  onMounted,
  watch,
  nextTick
} from 'vue'

import {
  loadSimulationData
} from '../services/simulationDataService.js'

import {
  runCompleteSimulation
} from '../services/simulationService.js'

import {
  recommendMemberReplacements,
  recommendFacilityRecovery,
  buildFacilityAndDelayRecoveryOptions
} from '../services/recoveryRecommendationService.js'

import {
  evaluateRecoveryPlans
} from '../services/recoveryPlanEvaluationService.js'

/*
========================================================
EVENT RISK PLANNING & WHAT-IF SIMULATOR
========================================================

This page connects four parts:

1. Supabase data
   simulationDataService.js

2. Disruption simulation
   simulationService.js

3. Recovery suggestions
   recoveryRecommendationService.js

4. Recovery plan evaluation
   recoveryPlanEvaluationService.js

IMPORTANT:
- This page does not update Supabase.
- Telegram messages are previews only.
- A disrupted schedule is NOT automatically a recovery.
- A recovery must be evaluated before it can be
  displayed as the recommended plan.

========================================================
*/

defineProps({
  apiMode: {
    type: Boolean,
    default: false
  },
  readOnly: {
    type: Boolean,
    default: false
  }
})

// ========================================================
// STATE
// ========================================================

// shallowRef prevents structuredClone errors caused by
// passing Vue reactive proxies into the simulation engine.
const data = shallowRef(null)
const result = shallowRef(null)

const loading = ref(true)
const error = ref('')
const initialized = ref(false)

const activeScenario = ref('member')
const activeComparison = ref('original')

const selectedEventId = ref(null)
const selectedMemberId = ref(null)
const selectedVenue = ref('')
const selectedSegmentId = ref(null)

const delayMinutes = ref(30)

const disruptionStart = ref('')
const disruptionEnd = ref('')

const dispatchModalOpen = ref(false)
const selectedCandidate = ref(null)

const dispatchSent = ref(false)
const dispatchAccepted = ref(false)

const toastMsg = ref('')

// ========================================================
// DATA HELPERS
// ========================================================

const events = computed(() =>
  data.value?.events || []
)

const eventSegments = computed(() =>
  (data.value?.event_segments || []).filter(
    segment =>
      String(segment.event_id) ===
      String(selectedEventId.value)
  )
)

const selectedEvent = computed(() =>
  events.value.find(
    event =>
      String(event.id) ===
      String(selectedEventId.value)
  )
)

const eventSegmentIds = computed(() =>
  new Set(
    eventSegments.value.map(segment =>
      String(segment.id)
    )
  )
)

const eventMembers = computed(() => {
  const memberIds = new Set(
    (data.value?.segment_assignments || [])
      .filter(assignment =>
        eventSegmentIds.value.has(
          String(assignment.segment_id)
        )
      )
      .map(assignment =>
        String(assignment.member_id)
      )
  )

  return (data.value?.members || []).filter(
    member =>
      memberIds.has(String(member.id))
  )
})

const eventFacilities = computed(() => {
  const slotIds = new Set(
    (data.value?.segment_facility_slots || [])
      .filter(link =>
        eventSegmentIds.value.has(
          String(link.segment_id)
        )
      )
      .map(link =>
        String(link.facility_slot_id)
      )
  )

  const names = (data.value?.facility_slots || [])
    .filter(slot =>
      slotIds.has(String(slot.id))
    )
    .map(slot => slot.venue_name)
    .filter(Boolean)

  return [...new Set(names)]
})

const selectedMember = computed(() =>
  eventMembers.value.find(
    member =>
      String(member.id) ===
      String(selectedMemberId.value)
  )
)

const targetSegments = computed(() => {
  const assignedIds = new Set(
    (data.value?.segment_assignments || [])
      .filter(assignment =>
        String(assignment.member_id) ===
        String(selectedMemberId.value)
      )
      .map(assignment =>
        String(assignment.segment_id)
      )
  )

  return eventSegments.value.filter(
    segment =>
      assignedIds.has(String(segment.id))
  )
})

// ========================================================
// DATE / TIME HELPERS
// ========================================================

function formatTime(value) {
  if (!value) return 'Unknown time'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function toSingaporeLocal(value) {
  if (!value) return ''

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Date(
    date.getTime() + 8 * 60 * 60 * 1000
  ).toISOString().slice(0, 16)
}

function fromSingaporeLocal(value) {
  if (!value) return null

  const date = new Date(
    `${value}:00+08:00`
  )

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toISOString()
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  const a = Date.parse(aStart)
  const b = Date.parse(aEnd)
  const c = Date.parse(bStart)
  const d = Date.parse(bEnd)

  if (
    ![a, b, c, d].every(Number.isFinite)
  ) {
    return false
  }

  return a < d && c < b
}

// ========================================================
// INITIALIZE INPUTS
// ========================================================

function resetSelections() {
  selectedMemberId.value =
    eventMembers.value[0]?.id ?? null

  selectedVenue.value =
    eventFacilities.value[0] ?? ''

  selectedSegmentId.value =
    eventSegments.value[0]?.id ?? null

  const defaultSegment =
    targetSegments.value[0] ||
    eventSegments.value[0]

  disruptionStart.value =
    defaultSegment
      ? toSingaporeLocal(
          defaultSegment.starts_at
        )
      : ''

  disruptionEnd.value =
    defaultSegment
      ? toSingaporeLocal(
          defaultSegment.ends_at
        )
      : ''

  result.value = null
  activeComparison.value = 'original'
}

// ========================================================
// BUILD DISRUPTIONS
// ========================================================

function buildDisruptions() {
  if (activeScenario.value === 'delay') {
    return [{
      id: 'delay-1',
      type: 'SCHEDULE_DELAY',
      segmentId: selectedSegmentId.value,
      delayMinutes: Number(
        delayMinutes.value
      )
    }]
  }

  const common = {
    id: 'disruption-1',
    start: fromSingaporeLocal(
      disruptionStart.value
    ),
    end: fromSingaporeLocal(
      disruptionEnd.value
    )
  }

  if (activeScenario.value === 'member') {
    return [{
      ...common,
      type: 'MEMBER_UNAVAILABLE',
      memberId: selectedMemberId.value
    }]
  }

  return [{
    ...common,
    type: 'FACILITY_UNAVAILABLE',
    venueName: selectedVenue.value
  }]
}

// ========================================================
// VALIDATION
// ========================================================

function validateInputs() {
  if (!data.value) {
    throw new Error(
      'Supabase data has not loaded.'
    )
  }

  if (!selectedEventId.value) {
    throw new Error(
      'Please select an event.'
    )
  }

  if (activeScenario.value === 'member') {
    if (!selectedMemberId.value) {
      throw new Error(
        'Please select a member.'
      )
    }
  }

  if (activeScenario.value === 'facility') {
    if (!selectedVenue.value) {
      throw new Error(
        'Please select a facility.'
      )
    }
  }

  if (activeScenario.value === 'delay') {
    if (!selectedSegmentId.value) {
      throw new Error(
        'Please select an activity.'
      )
    }

    if (
      !Number.isFinite(
        Number(delayMinutes.value)
      ) ||
      Number(delayMinutes.value) <= 0
    ) {
      throw new Error(
        'Delay must be greater than zero.'
      )
    }

    return
  }

  const start = fromSingaporeLocal(
    disruptionStart.value
  )

  const end = fromSingaporeLocal(
    disruptionEnd.value
  )

  if (
    !start ||
    !end ||
    Date.parse(start) >= Date.parse(end)
  ) {
    throw new Error(
      'Please enter a valid unavailability period.'
    )
  }
}

// ========================================================
// RUN SIMULATION
// ========================================================

function runSimulation() {
  if (
    !data.value ||
    !selectedEventId.value
  ) {
    return
  }

  error.value = ''
  result.value = null

  try {
    validateInputs()

    result.value = runCompleteSimulation(
      data.value,
      selectedEventId.value,
      buildDisruptions()
    )

    console.log(
      '[Event Risk] Simulation:',
      result.value
    )
  } catch (e) {
    error.value =
      e?.message || String(e)

    console.error(
      '[Event Risk] Simulation error:',
      e
    )
  }
}

// ========================================================
// AUTO-RECALCULATION
// ========================================================

watch(selectedEventId, async () => {
  if (!initialized.value) return

  initialized.value = false

  resetSelections()

  await nextTick()

  initialized.value = true

  runSimulation()
})

watch(
  [
    activeScenario,
    selectedMemberId,
    selectedVenue,
    selectedSegmentId,
    delayMinutes,
    disruptionStart,
    disruptionEnd
  ],
  () => {
    if (!initialized.value) return

    activeComparison.value = 'original'
    runSimulation()
  },
  { flush: 'post' }
)

// ========================================================
// LOAD LIVE SUPABASE DATA
// ========================================================

onMounted(async () => {
  loading.value = true

  try {
    data.value = await loadSimulationData({
      source: 'supabase'
    })

    selectedEventId.value =
      data.value?.events?.[0]?.id ?? null

    if (!selectedEventId.value) {
      throw new Error(
        'No accessible events found in Supabase.'
      )
    }

    resetSelections()

    await nextTick()

    initialized.value = true

    runSimulation()
  } catch (e) {
    error.value =
      e?.message || String(e)

    console.error(
      '[Event Risk] Loading error:',
      e
    )
  } finally {
    loading.value = false
  }
})

// ========================================================
// KPI CALCULATIONS
// ========================================================

const impactedCount = computed(() => {
  if (!result.value) return null

  const ids = [
    ...(result.value.directImpacts || [])
      .map(item => item.segmentId),

    ...(result.value.downstreamRisks || [])
      .map(item => item.segmentId)
  ].filter(id => id != null)

  return new Set(
    ids.map(String)
  ).size
})

const assignmentCount = computed(() => {
  if (!result.value) return null

  const affectedIds = new Set(
    (result.value.directImpacts || [])
      .map(item =>
        String(item.segmentId)
      )
  )

  return (
    data.value?.segment_assignments || []
  ).filter(assignment =>
    affectedIds.has(
      String(assignment.segment_id)
    )
  ).length
})

const conflictCount = computed(() =>
  result.value
    ? result.value.conflictCounts?.total ?? 0
    : null
)

// ========================================================
// MEMBER REPLACEMENT RECOMMENDATIONS
// ========================================================

const candidates = computed(() => {
  if (
    !result.value ||
    !data.value ||
    activeScenario.value !== 'member'
  ) {
    return []
  }

  try {
    return recommendMemberReplacements(
      data.value,
      selectedEventId.value,
      selectedMemberId.value,
      buildDisruptions()
    )
  } catch (e) {
    console.error(
      '[Event Risk] Member recommendations:',
      e
    )

    return []
  }
})

// ========================================================
// FACILITY / DELAY RECOMMENDATIONS
// ========================================================

const facilityRecovery = computed(() => {
  if (
    !result.value ||
    !data.value ||
    activeScenario.value === 'member'
  ) {
    return []
  }

  try {
    return recommendFacilityRecovery(
      data.value,
      selectedEventId.value,
      result.value,
      buildDisruptions()
    )
  } catch (e) {
    console.error(
      '[Event Risk] Facility recommendations:',
      e
    )

    return []
  }
})

// ========================================================
// BUILD RECOVERY OPTIONS FOR EVALUATION
// ========================================================

/*
The service generates concrete recovery options for all scenarios.
Member candidates produce assignment changes; facility and delay
suggestions produce venue/time changes. All are read-only proposals.
Facility availability, booking ownership, and capacity cannot be
assumed merely because a venue exists in accessible Supabase rows.
*/

const recoveryOptions = computed(() => {
  if (
    !data.value ||
    !result.value
  ) {
    return []
  }

  // Facility and delay recommendations are now converted
  // into structured proposals for the same evaluator.
  // A proposal is NOT a confirmed facility reservation.
  if (activeScenario.value !== 'member') {
    return buildFacilityAndDelayRecoveryOptions(
      data.value,
      selectedEventId.value,
      result.value,
      buildDisruptions(),
      facilityRecovery.value
    )
  }

  // Find assignments of the unavailable member
  // that overlap the disruption period.
  const disruption =
    buildDisruptions()[0]

  const affectedAssignments = (
    data.value.segment_assignments || []
  ).filter(assignment => {
    if (
      String(assignment.member_id) !==
      String(selectedMemberId.value)
    ) {
      return false
    }

    const segment = eventSegments.value.find(
      item =>
        String(item.id) ===
        String(assignment.segment_id)
    )

    if (!segment) return false

    return overlaps(
      segment.starts_at,
      segment.ends_at,
      disruption.start,
      disruption.end
    )
  })

  if (!affectedAssignments.length) {
    return []
  }

  return candidates.value
    .filter(candidate =>
      candidate.id != null &&
      String(candidate.id) !==
        String(selectedMemberId.value)
    )
    .map(candidate => ({
      id: `replacement-${candidate.id}`,

      title:
        `Replace ${selectedMember.value?.full_name || 'member'} ` +
        `with ${candidate.name}`,

      changes: affectedAssignments.map(
        assignment => ({
          segmentId:
            assignment.segment_id,

          replacedMemberId:
            selectedMemberId.value,

          replacementMemberId:
            candidate.id
        })
      )
    }))
})

// ========================================================
// RECOVERY PLAN EVALUATION ALGORITHM
// ========================================================

/*
The evaluation service:
- Applies each option to a temporary plan.
- Checks known conflicts.
- Checks available booking information.
- Calculates weighted scores.
- Ranks options.
- Returns a recommended plan only if feasible.

The evaluation does NOT update Supabase.
*/

const recoveryEvaluation = computed(() => {
  if (
    !data.value ||
    !result.value
  ) {
    return null
  }

  try {
    return evaluateRecoveryPlans({
      data: data.value,

      eventId:
        selectedEventId.value,

      disruptions:
        buildDisruptions(),

      simulationResult:
        result.value,

      options:
        recoveryOptions.value
    })
  } catch (e) {
    console.error(
      '[Event Risk] Recovery evaluation:',
      e
    )

    return null
  }
})

const bestRecoveryPlan = computed(() =>
  recoveryEvaluation.value
    ?.recommendedPlan ?? null
)

const rankedRecoveryPlans = computed(() =>
  recoveryEvaluation.value
    ?.rankedPlans || []
)

// Booking outcomes come from the evaluator; the view never decides
// whether a reservation is confirmed or whether a venue is free.
function isBookingMessage(message) {
  return /booking|reservation|facility|venue|slot|room/i.test(String(message || ''))
}

function bookingConflicts(plan) {
  return (plan.conflicts || []).filter(item =>
    isBookingMessage(item.message) ||
    ['FACILITY_DOUBLE_BOOKING', 'FACILITY_UNAVAILABLE'].includes(item.type)
  )
}

function bookingWarnings(plan) {
  return (plan.warnings || []).filter(isBookingMessage)
}

function otherWarnings(plan) {
  return (plan.warnings || []).filter(item => !isBookingMessage(item))
}

const bookingDataCoverage = computed(() =>
  data.value?.facility_booking_coverage || null
)

const recoveryStatus = computed(() => {
  if (!result.value) {
    return '—'
  }

  if (bestRecoveryPlan.value) {
    return 'Evaluated option'
  }

  if (rankedRecoveryPlans.value.length) {
    return 'Needs review'
  }

  if (
    activeScenario.value !== 'member' &&
    facilityRecovery.value.length
  ) {
    return 'Suggestions only'
  }

  return 'Needs review'
})

// ========================================================
// DYNAMIC RECOMMENDATION LABELS
// ========================================================

const recommendationTitle = computed(() => {
  switch (activeScenario.value) {
    case 'member':
      return 'Ranked Replacement Candidates'

    case 'facility':
      return 'Facility Recovery Recommendations'

    case 'delay':
      return 'Schedule Delay Recovery Recommendations'

    default:
      return 'Recovery Recommendations'
  }
})

const recommendationLabel = computed(() => {
  switch (activeScenario.value) {
    case 'member':
      return 'MEMBER CONTINGENCY PLANNING'

    case 'facility':
      return 'FACILITY CONTINGENCY PLANNING'

    case 'delay':
      return 'SCHEDULE RECOVERY ANALYSIS'

    default:
      return 'RECOVERY ANALYSIS'
  }
})

const recommendationBadge = computed(() => {
  switch (activeScenario.value) {
    case 'member':
      return 'Multi-Factor Suitability Scoring'

    case 'facility':
      return 'Alternative Venue Search'

    case 'delay':
      return 'Conflict Detection & Rescheduling'

    default:
      return 'Recovery Analysis'
  }
})

// ========================================================
// PLAN COMPARISON
// ========================================================

/*
Three comparison states:

ORIGINAL:
The confirmed schedule loaded from Supabase.

DISRUPTED:
The schedule after the what-if disruption.

RECOVERY:
The highest-ranked feasible recovery option.

If there is no feasible evaluated option,
the recovery view must NOT pretend that the
disrupted schedule is a recovered schedule.
*/

const comparisonSegments = computed(() => {
  if (!result.value) {
    return []
  }

  if (
    activeComparison.value === 'original'
  ) {
    return eventSegments.value
  }

  if (
    activeComparison.value === 'disrupted'
  ) {
    return (
      result.value.simulatedSegments || []
    )
  }

  if (
    activeComparison.value === 'recovery'
  ) {
    return (
      bestRecoveryPlan.value
        ?.proposedSegments || []
    )
  }

  return []
})

const comparisonTitle = computed(() => {
  switch (activeComparison.value) {
    case 'original':
      return 'Original Confirmed Plan'

    case 'disrupted':
      return 'Simulated Disrupted Plan'

    case 'recovery':
      return 'Evaluated Recovery Plan'

    default:
      return 'Plan Comparison'
  }
})

function isSegmentChanged(segment) {
  if (
    activeComparison.value === 'original'
  ) {
    return false
  }

  const original =
    eventSegments.value.find(
      item =>
        String(item.id) ===
        String(segment.id)
    )

  if (!original) {
    return false
  }

  return (
    Date.parse(original.starts_at) !==
      Date.parse(segment.starts_at) ||

    Date.parse(original.ends_at) !==
      Date.parse(segment.ends_at)
  )
}

function proposedVenueFor(segment) {
  if (
    activeComparison.value !== 'recovery' ||
    !bestRecoveryPlan.value
  ) {
    return null
  }

  return bestRecoveryPlan.value
    .proposedVenues?.[String(segment.id)] ||
    null
}

// ========================================================
// TELEGRAM DISPATCH PREVIEW
// ========================================================

function openTelegramDispatch(candidate) {
  selectedCandidate.value = candidate

  dispatchSent.value = false
  dispatchAccepted.value = false

  dispatchModalOpen.value = true
}

function sendTelegramDispatch() {
  dispatchSent.value = true

  toastMsg.value =
    'Preview only: no Telegram message was sent.'
}

function simulateMemberAcceptance() {
  dispatchAccepted.value = true

  toastMsg.value =
    'Preview only: no member assignment was changed.'
}

function applyToEventPlan() {
  toastMsg.value =
    'This is a read-only simulation. No changes were applied to Supabase.'
}
</script>

<template>
  <div class="py-2">

    <!-- ===================================================
         PAGE HEADER
    ==================================================== -->

    <div
      class="d-flex flex-wrap justify-content-between
             align-items-center gap-3 mb-4"
    >
      <div>
        <div class="d-flex align-items-center gap-2 mb-1">
          <span
            class="badge bg-danger rounded-pill px-2 py-1"
            style="font-size: 0.65rem; font-weight: 800;"
          >
            FEATURE 5
          </span>

          <span
            v-if="apiMode"
            class="pulse-api-tag"
          >
            Supabase DB Query + JS Matching
          </span>
        </div>

        <h3 class="fw-bold mb-1">
          Event Risk Planning &amp; What-If Simulator
        </h3>

        <p class="text-muted small mb-0">
          Simulate disruptions, review recovery options,
          and compare plans without modifying live records.
        </p>
      </div>

      <div class="d-flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-sm btn-pulse-outline"
          :disabled="loading || !data"
          @click="runSimulation"
        >
          ⚡ Run What-If Simulation
        </button>

        <button
          type="button"
          class="btn btn-sm btn-pulse-primary"
          @click="applyToEventPlan"
        >
          ✓ Apply Changes to Event Plan
        </button>
      </div>
    </div>

    <!-- STATUS MESSAGES -->

    <div
      v-if="toastMsg"
      class="alert alert-info mb-3"
    >
      {{ toastMsg }}
    </div>

    <div
      v-if="loading"
      class="alert alert-info"
    >
      Loading Supabase event data…
    </div>

    <div
      v-if="error"
      class="alert alert-danger"
    >
      <strong>Simulation error:</strong>
      {{ error }}
    </div>

    <!-- ===================================================
         SCENARIO SANDBOX
    ==================================================== -->

    <div class="pulse-card p-4 shadow-sm mb-4">

      <div
        class="d-flex justify-content-between
               align-items-center mb-3"
      >
        <div>
          <span
            class="text-uppercase fw-bold text-danger small"
            style="font-size: 0.65rem;"
          >
            Scenario Sandbox
          </span>

          <h5 class="fw-bold mb-0">
            Choose Disruption Scenario
          </h5>
        </div>

        <span
          class="badge bg-danger bg-opacity-10
                 text-danger border"
        >
          Supabase • Read-Only
        </span>
      </div>

      <!-- SCENARIO CARDS -->

      <div class="row g-3">

        <div class="col-md-4">
          <button
            type="button"
            class="btn w-100 p-3 text-start rounded-3 border"
            :class="
              activeScenario === 'member'
                ? 'bg-danger bg-opacity-10 border-danger text-danger fw-bold'
                : 'bg-light text-dark'
            "
            @click="activeScenario = 'member'"
          >
            <div style="font-size: 0.85rem;">
              Performer Illness / Drop
            </div>

            <small
              class="text-muted"
              style="font-size: 0.7rem;"
            >
              Replacement matching
            </small>
          </button>
        </div>

        <div class="col-md-4">
          <button
            type="button"
            class="btn w-100 p-3 text-start rounded-3 border"
            :class="
              activeScenario === 'facility'
                ? 'bg-danger bg-opacity-10 border-danger text-danger fw-bold'
                : 'bg-light text-dark'
            "
            @click="activeScenario = 'facility'"
          >
            <div style="font-size: 0.85rem;">
              Facility Unavailability
            </div>

            <small
              class="text-muted"
              style="font-size: 0.7rem;"
            >
              Venue contingency
            </small>
          </button>
        </div>

        <div class="col-md-4">
          <button
            type="button"
            class="btn w-100 p-3 text-start rounded-3 border"
            :class="
              activeScenario === 'delay'
                ? 'bg-danger bg-opacity-10 border-danger text-danger fw-bold'
                : 'bg-light text-dark'
            "
            @click="activeScenario = 'delay'"
          >
            <div style="font-size: 0.85rem;">
              Schedule Delay (+30 mins)
            </div>

            <small
              class="text-muted"
              style="font-size: 0.7rem;"
            >
              Conflict detection
            </small>
          </button>
        </div>

      </div>

      <!-- INPUTS -->

      <div class="mt-3 p-3 rounded-3 bg-light border">

        <label class="small fw-bold">
          Event
        </label>

        <select
          v-model="selectedEventId"
          class="form-select form-select-sm mb-2"
          :disabled="loading"
        >
          <option
            v-for="event in events"
            :key="event.id"
            :value="event.id"
          >
            {{ event.name }}
          </option>
        </select>

        <!-- MEMBER INPUT -->

        <template v-if="activeScenario === 'member'">
          <label class="small fw-bold">
            Unavailable Member
          </label>

          <select
            v-model="selectedMemberId"
            class="form-select form-select-sm mb-2"
          >
            <option
              v-for="member in eventMembers"
              :key="member.id"
              :value="member.id"
            >
              {{ member.full_name }}
            </option>
          </select>

          <p
            v-if="selectedMember"
            class="small text-muted mb-2"
          >
            Simulating unavailability for
            <strong>
              {{ selectedMember.full_name }}
            </strong>.
          </p>
        </template>

        <!-- FACILITY INPUT -->

        <template
          v-else-if="activeScenario === 'facility'"
        >
          <label class="small fw-bold">
            Unavailable Facility
          </label>

          <select
            v-model="selectedVenue"
            class="form-select form-select-sm mb-2"
          >
            <option
              v-for="venue in eventFacilities"
              :key="venue"
              :value="venue"
            >
              {{ venue }}
            </option>
          </select>
        </template>

        <!-- DELAY INPUT -->

        <template v-else>
          <label class="small fw-bold">
            Delayed Activity
          </label>

          <select
            v-model="selectedSegmentId"
            class="form-select form-select-sm mb-2"
          >
            <option
              v-for="segment in eventSegments"
              :key="segment.id"
              :value="segment.id"
            >
              {{ segment.title }}
            </option>
          </select>

          <label class="small fw-bold">
            Delay (minutes)
          </label>

          <input
            v-model.number="delayMinutes"
            type="number"
            min="1"
            max="1440"
            class="form-control form-control-sm mb-2"
          />
        </template>

        <!-- UNAVAILABILITY TIMES -->

        <div
          v-if="activeScenario !== 'delay'"
          class="row g-2"
        >
          <div class="col-md-6">
            <label class="small fw-bold">
              Unavailable From (Singapore)
            </label>

            <input
              v-model="disruptionStart"
              type="datetime-local"
              class="form-control form-control-sm"
            />
          </div>

          <div class="col-md-6">
            <label class="small fw-bold">
              Unavailable Until (Singapore)
            </label>

            <input
              v-model="disruptionEnd"
              type="datetime-local"
              class="form-control form-control-sm"
            />
          </div>
        </div>

      </div>
    </div>

    <!-- ===================================================
         SIMULATION SUMMARY
    ==================================================== -->

    <div
      v-if="result"
      class="alert alert-info small mb-4"
    >
      <strong>Simulation calculated.</strong>

      {{ impactedCount }} affected segment(s),

      {{ assignmentCount }} assignment(s)
      requiring review,

      {{ conflictCount }} reported conflict(s).

      <span v-if="impactedCount === 0">
        No affected activities were detected
        for the selected disruption.
      </span>
    </div>

    <!-- ===================================================
         KPI CARDS
    ==================================================== -->

    <div class="row g-3 mb-4">

      <div class="col-6 col-md-3">
        <div class="pulse-card p-3 shadow-sm text-center">
          <div
            class="text-muted small text-uppercase fw-bold"
            style="font-size: 0.65rem;"
          >
            Affected Segments
          </div>

          <div class="fw-bold fs-5 mt-1 text-danger">
            {{ impactedCount ?? '—' }} Segments
          </div>
        </div>
      </div>

      <div class="col-6 col-md-3">
        <div class="pulse-card p-3 shadow-sm text-center">
          <div
            class="text-muted small text-uppercase fw-bold"
            style="font-size: 0.65rem;"
          >
            Assignments Requiring Review
          </div>

          <div class="fw-bold fs-5 mt-1 text-warning">
            {{ assignmentCount ?? '—' }} Assignments
          </div>
        </div>
      </div>

      <div class="col-6 col-md-3">
        <div class="pulse-card p-3 shadow-sm text-center">
          <div
            class="text-muted small text-uppercase fw-bold"
            style="font-size: 0.65rem;"
          >
            Potential Conflicts
          </div>

          <div class="fw-bold fs-5 mt-1 text-danger">
            {{ conflictCount ?? '—' }} Conflicts
          </div>
        </div>
      </div>

      <div class="col-6 col-md-3">
        <div class="pulse-card p-3 shadow-sm text-center">
          <div
            class="text-muted small text-uppercase fw-bold"
            style="font-size: 0.65rem;"
          >
            Recovery Feasibility
          </div>

          <div class="fw-bold mt-1 text-success">
            {{ recoveryStatus }}
          </div>
        </div>
      </div>

    </div>

    <!-- ===================================================
         SCENARIO-SPECIFIC RECOMMENDATIONS
    ==================================================== -->

    <div class="pulse-card p-4 shadow-sm mb-4">

      <div
        class="d-flex flex-wrap justify-content-between
               align-items-center gap-2 mb-3"
      >
        <div>
          <span
            class="text-uppercase fw-bold text-primary small"
            style="font-size: 0.65rem;"
          >
            {{ recommendationLabel }}
          </span>

          <h5 class="fw-bold mb-0">
            {{ recommendationTitle }}
          </h5>
        </div>

        <span
          class="badge border"
          style="
            background-color: #f3e8ff;
            color: #6b21a8;
          "
        >
          {{ recommendationBadge }}
        </span>
      </div>

      <p
        v-if="!result"
        class="text-muted small mb-0"
      >
        Waiting for a successful simulation.
      </p>

      <!-- MEMBER REPLACEMENTS -->

      <template v-else-if="activeScenario === 'member'">

        <p
          v-if="impactedCount === 0"
          class="text-muted small mb-0"
        >
          No affected activities were detected.

          Select an unavailable period overlapping
          one of the member's assigned activities.
        </p>

        <p
          v-else-if="!candidates.length"
          class="text-muted small mb-0"
        >
          No eligible replacement was found among
          accessible member records.

          A replacement must have a matching recorded
          role and a conflict-free timetable.
        </p>

        <div
          v-else
          class="row g-3"
        >
          <div
            v-for="candidate in candidates"
            :key="candidate.id"
            class="col-lg-4"
          >
            <div
              class="p-3 rounded-3 border h-100
                     d-flex flex-column
                     justify-content-between
                     pulse-candidate-card"
            >
              <div>
                <div
                  class="d-flex justify-content-between
                         align-items-center mb-1"
                >
                  <strong class="fs-6">
                    {{ candidate.name }}
                  </strong>

                  <span
                    class="badge bg-success bg-opacity-10
                           text-success border border-success"
                  >
                    {{ candidate.score }}% Match
                  </span>
                </div>

                <div
                  class="text-muted small fw-semibold mb-2"
                >
                  {{ candidate.specialty }}
                  •
                  {{ candidate.workload }}
                </div>

                <div
                  class="p-2 rounded-2 bg-light small mb-2"
                >
                  <strong>Availability:</strong>
                  {{ candidate.availability }}

                  <br>

                  <strong>Experience:</strong>
                  {{ candidate.experience }}
                </div>

                <p class="text-muted small mb-3">
                  {{ candidate.reason }}
                </p>
              </div>

              <button
                type="button"
                class="btn btn-pulse-primary btn-sm
                       w-100 fw-bold py-2"
                @click="openTelegramDispatch(candidate)"
              >
                Dispatch via Telegram Bot
              </button>
            </div>
          </div>
        </div>

        <p
          v-if="candidates.length"
          class="small text-muted mt-3 mb-0"
        >
          Candidate suitability uses specialty match
          (50%), timetable availability (30%), and
          workload (20%).

          This is separate from the recovery plan
          evaluation score.
        </p>

      </template>

      <!-- FACILITY / DELAY RECOVERY -->

      <template v-else>

        <p
          v-if="!facilityRecovery.length"
          class="text-muted small mb-0"
        >
          No facility or schedule recovery suggestion
          was generated from accessible records.
        </p>

        <div
          v-for="(recommendation, index) in facilityRecovery"
          :key="recommendation.segmentId ?? index"
          class="p-3 border rounded-3 mb-3"
        >
          <h6 class="fw-bold">
            {{
              recommendation.segmentTitle ||
              recommendation.title ||
              'Recovery Suggestion'
            }}
          </h6>

          <p
            v-if="recommendation.issue"
            class="small mb-2"
          >
            <strong>Issue:</strong>
            {{ recommendation.issue }}
          </p>

          <p
            v-if="recommendation.originalVenue"
            class="small mb-2"
          >
            <strong>Current venue:</strong>
            {{ recommendation.originalVenue }}
          </p>

          <div
            v-for="(alternative, alternativeIndex) in
              recommendation.alternatives || []"
            :key="alternativeIndex"
            class="small mb-2"
          >
            <strong>Possible alternative venue:</strong>

            {{
              alternative.venue ||
              alternative.venueName ||
              'Venue requires verification'
            }}

            <div class="text-muted">
              {{ alternative.status }}
            </div>

            <div
              v-if="alternative.reason"
              class="text-muted"
            >
              {{ alternative.reason }}
            </div>
          </div>

          <div
            v-for="(time, timeIndex) in
              recommendation.laterTimes || []"
            :key="timeIndex"
            class="small mb-2"
          >
            <strong>Possible time shift:</strong>

            {{ formatTime(time.start) }}
            to
            {{ formatTime(time.end) }}

            <span v-if="time.venue">
              at {{ time.venue }}
            </span>

            <div class="text-muted">
              {{ time.status }}
            </div>
          </div>

          <p
            v-if="recommendation.advice"
            class="small mb-0"
          >
            <strong>Recommendation:</strong>
            {{ recommendation.advice }}
          </p>

          <span
            class="badge bg-warning text-dark mt-2"
          >
            Requires Verification
          </span>
        </div>

        <p class="small text-muted mt-3 mb-0">
          These suggestions are now included in recovery
          plan evaluation. Their ranking does not confirm
          booking rights, capacity, equipment or approval.
        </p>

      </template>
    </div>

    <!-- ===================================================
         RECOVERY PLAN EVALUATION RESULTS
    ==================================================== -->

    <div class="pulse-card p-4 shadow-sm mb-4">

      <div
        class="d-flex flex-wrap justify-content-between
               align-items-center gap-2 mb-3"
      >
        <div>
          <span
            class="text-uppercase fw-bold text-primary small"
            style="font-size: 0.65rem;"
          >
            Recovery Evaluation Algorithm
          </span>

          <h5 class="fw-bold mb-0">
            Recovery Plan Ranking
          </h5>
        </div>

        <span class="badge bg-light text-dark border">
          Weighted Multi-Criteria Scoring
        </span>
      </div>

      <p class="small text-muted">
        Evaluates concrete proposed recovery plans using
        conflict resolution (40%), timetable preservation
        (30%), member workload (20%) and venue suitability
        (10%).
      </p>

      <p
        v-if="!result"
        class="small text-muted mb-0"
      >
        Run a simulation to evaluate recovery plans.
      </p>

      <template v-else>

        <div
          v-if="bestRecoveryPlan"
          class="alert alert-success small"
        >
          <strong>
            Recommended Evaluated Option:
          </strong>

          {{ bestRecoveryPlan.title }}

          <div class="mt-1">
            Recovery Score:
            <strong>
              {{ bestRecoveryPlan.score }}/100
            </strong>
          </div>

          <div class="mt-1">
            {{
              bestRecoveryPlan.reasons.join('; ')
            }}
          </div>

          <div class="mt-2">
            Based on accessible records.
            Organiser approval is still required.
          </div>
        </div>

        <div
          v-else
          class="alert alert-warning small"
        >
          <strong>
            No fully verified recovery plan yet.
          </strong>

          <div class="mt-1">
            {{
              recoveryEvaluation?.summary ||
              'No recovery options could be evaluated.'
            }}
          </div>

          <div
            v-if="activeScenario !== 'member'"
            class="mt-2"
          >
            Facility and schedule suggestions are now passed
            into the evaluation algorithm as proposed changes.
            Options may still require booking, capacity,
            equipment or organiser verification.
          </div>
        </div>

        <div class="alert alert-info small" role="status">
          <strong>Facility booking checks</strong>
          <div class="mt-1">
            Confirmed overlapping reservations are treated as conflicts.
            Pending reservations and unverified bookings require review.
            A room with no detected conflict is not automatically booked.
          </div>
          <div v-if="bookingDataCoverage" class="mt-2">
            Booking records queried for:
            <strong>{{ bookingDataCoverage.startDate }}</strong>
            to <strong>{{ bookingDataCoverage.endDate }}</strong>.
            Visibility is subject to Supabase access policies.
          </div>
          <div v-else class="mt-2">
            Booking coverage has not been verified for this data source.
          </div>
        </div>

        <!-- RANKED EVALUATED OPTIONS -->

        <div
          v-for="plan in rankedRecoveryPlans"
          :key="plan.id"
          class="p-3 border rounded-3 mb-3"
        >
          <div
            class="d-flex flex-wrap justify-content-between
                   align-items-center gap-2 mb-2"
          >
            <div>
              <strong>
                #{{ plan.rank }} —
                {{ plan.title }}
              </strong>
            </div>

            <span
              class="badge"
              :class="
                plan.status === 'FEASIBLE'
                  ? 'bg-success'
                  : plan.status === 'NEEDS_REVIEW'
                    ? 'bg-warning text-dark'
                    : 'bg-danger'
              "
            >
              {{ plan.status }}
            </span>
          </div>

          <div class="fw-bold mb-2">
            Recovery Score:
            {{ plan.score }}/100
          </div>

          <div class="row g-2 small mb-2">

            <div class="col-6 col-md-3">
              <div class="bg-light p-2 rounded">
                <div class="text-muted">
                  Conflict Resolution
                </div>

                <strong>
                  {{ plan.scoreBreakdown.conflict }}/100
                </strong>
              </div>
            </div>

            <div class="col-6 col-md-3">
              <div class="bg-light p-2 rounded">
                <div class="text-muted">
                  Timetable
                </div>

                <strong>
                  {{ plan.scoreBreakdown.timetable }}/100
                </strong>
              </div>
            </div>

            <div class="col-6 col-md-3">
              <div class="bg-light p-2 rounded">
                <div class="text-muted">
                  Workload
                </div>

                <strong>
                  {{ plan.scoreBreakdown.workload }}/100
                </strong>
              </div>
            </div>

            <div class="col-6 col-md-3">
              <div class="bg-light p-2 rounded">
                <div class="text-muted">
                  Venue Suitability
                </div>

                <strong>
                  {{ plan.scoreBreakdown.venue }}/100
                </strong>
              </div>
            </div>

          </div>

          <div class="small text-muted mb-2">
            {{ plan.metrics.conflictCount }}
            known conflict(s),

            {{ plan.metrics.warningCount }}
            verification warning(s).
          </div>

          <div
            v-for="(reason, index) in plan.reasons"
            :key="index"
            class="small text-muted"
          >
            • {{ reason }}
          </div>

          <!-- Separate booking outcomes from general recovery checks. -->
          <div class="border rounded-3 p-3 mt-3 bg-light">
            <div class="fw-bold small mb-2">
              Facility Booking Verification
            </div>

            <div v-if="bookingConflicts(plan).length" class="small text-danger mb-2">
              <strong>Booking conflict — venue cannot be used as proposed</strong>
              <div v-for="(item, index) in bookingConflicts(plan)" :key="'bc-' + index">
                • {{ item.message }}
              </div>
            </div>

            <div v-if="bookingWarnings(plan).length" class="small text-warning-emphasis mb-2">
              <strong>Booking approval or verification required</strong>
              <div v-for="(message, index) in bookingWarnings(plan)" :key="'bw-' + index">
                • {{ message }}
              </div>
            </div>

            <div
              v-if="!bookingConflicts(plan).length && !bookingWarnings(plan).length"
              class="small text-muted"
            >
              No booking issues reported by the evaluator for this plan.
              This is based on accessible records, not a new reservation or
              independent confirmation of complete CCA booking visibility.
            </div>
          </div>

          <div
            v-if="plan.conflicts.length"
            class="mt-2"
          >
            <strong class="small text-danger">
              Detected Conflicts
            </strong>

            <div
              v-for="(conflict, index) in plan.conflicts"
              :key="index"
              class="small text-danger"
            >
              • {{ conflict.message }}
            </div>
          </div>

          <div
            v-if="otherWarnings(plan).length"
            class="mt-2"
          >
            <strong class="small text-warning">
              Other Manual Verification Required
            </strong>

            <div
              v-for="(warning, index) in otherWarnings(plan)"
              :key="index"
              class="small text-muted"
            >
              • {{ warning }}
            </div>
          </div>
        </div>

      </template>
    </div>

    <!-- ===================================================
         PLAN COMPARISON
    ==================================================== -->

    <div class="pulse-card p-4 shadow-sm">

      <div
        class="d-flex flex-wrap justify-content-between
               align-items-center gap-3 mb-3"
      >
        <h5 class="fw-bold mb-0">
          Plan Comparison
        </h5>

        <div class="btn-group btn-group-sm">

          <button
            type="button"
            class="btn"
            :class="
              activeComparison === 'original'
                ? 'btn-secondary text-white'
                : 'btn-outline-secondary'
            "
            @click="activeComparison = 'original'"
          >
            Original Plan
          </button>

          <button
            type="button"
            class="btn"
            :class="
              activeComparison === 'disrupted'
                ? 'btn-warning text-dark'
                : 'btn-outline-warning'
            "
            @click="activeComparison = 'disrupted'"
          >
            Disrupted Plan
          </button>

          <button
            type="button"
            class="btn"
            :class="
              activeComparison === 'recovery'
                ? 'btn-success text-white'
                : 'btn-outline-success'
            "
            :disabled="!bestRecoveryPlan"
            @click="activeComparison = 'recovery'"
          >
            Recovery Plan
          </button>

        </div>
      </div>

      <div
        class="p-3 rounded-3 bg-light border"
      >
        <p
          v-if="!result"
          class="small text-muted mb-0"
        >
          Waiting for a successful simulation.
        </p>

        <template v-else>

          <strong class="d-block mb-2">
            {{ comparisonTitle }}
          </strong>

          <p
            v-if="activeComparison === 'original'"
            class="small text-muted"
          >
            Original schedule from Supabase.
            No simulated changes have been applied.
          </p>

          <p
            v-else-if="activeComparison === 'disrupted'"
            class="small text-muted"
          >
            Schedule after the simulated disruption.

            This is NOT necessarily a valid recovery plan.
          </p>

          <p
            v-else
            class="small text-muted"
          >
            Evaluated recovery option:
            <strong>
              {{ bestRecoveryPlan?.title }}
            </strong>.

            This remains a preview and has not been
            applied to Supabase.
          </p>

          <div
            v-for="segment in comparisonSegments"
            :key="segment.id"
            class="small py-2 border-bottom"
          >
            <div
              class="d-flex flex-wrap justify-content-between
                     align-items-center gap-2"
            >
              <div>
                <strong>
                  {{ segment.title }}
                </strong>

                <div class="text-muted">
                  {{ formatTime(segment.starts_at) }}
                  to
                  {{ formatTime(segment.ends_at) }}
                </div>

                <div
                  v-if="proposedVenueFor(segment)"
                  class="text-muted"
                >
                  Proposed venue:
                  {{ proposedVenueFor(segment) }}
                </div>
              </div>

              <span
                v-if="isSegmentChanged(segment)"
                class="badge bg-warning text-dark"
              >
                Time Changed
              </span>
            </div>
          </div>

          <div
            v-if="
              activeComparison === 'recovery' &&
              bestRecoveryPlan
            "
            class="small mt-3"
          >
            <strong>
              Evaluated Recovery Score:
            </strong>

            {{ bestRecoveryPlan.score }}/100

            <div class="text-muted">
              {{ bestRecoveryPlan.metrics.conflictCount }}
              known conflict(s) detected in accessible records.
            </div>
          </div>

          <div
            v-else-if="activeComparison === 'disrupted'"
            class="small mt-3"
          >
            <strong>
              Disruption Impact:
            </strong>

            {{ conflictCount }} reported conflict(s).

            {{
              result.downstreamRisks?.length || 0
            }}
            downstream risk(s).
          </div>

        </template>
      </div>

      <p class="small text-muted mt-3 mb-0">
        All comparison views are read-only.
        No recovery option has been applied to the
        confirmed event schedule.
      </p>
    </div>

    <!-- ===================================================
         TELEGRAM DISPATCH PREVIEW MODAL
    ==================================================== -->

    <div
      v-if="dispatchModalOpen"
      class="position-fixed bg-dark bg-opacity-50
             d-flex justify-content-center
             align-items-center p-3"
      style="
        z-index: 1060;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
      "
    >
      <div
        class="pulse-card p-4 shadow-lg"
        style="
          max-width: 460px;
          width: 100%;
        "
      >
        <div
          class="d-flex justify-content-between
                 align-items-center mb-3"
        >
          <h5 class="fw-bold mb-0">
            Telegram Dispatch Preview
          </h5>

          <button
            type="button"
            class="btn-close"
            @click="dispatchModalOpen = false"
          ></button>
        </div>

        <p class="text-muted small">
          Preview only.

          No Telegram message will be sent and
          no Supabase assignment will be changed.
        </p>

        <div
          class="p-3 rounded-3 mb-3 text-white"
          style="
            background: linear-gradient(
              135deg,
              #1e293b,
              #0f172a
            );
          "
        >
          <strong>
            SMU Pulse Dispatcher Bot
          </strong>

          <hr>

          <div class="small">
            <strong>
              REPLACEMENT REQUEST
            </strong>

            <br>

            Event:
            {{ selectedEvent?.name }}

            <br>

            Candidate:
            {{ selectedCandidate?.name }}

            <br>

            Candidate Suitability:
            {{ selectedCandidate?.score }}%

            <br>

            Affected Activities:
            {{
              targetSegments
                .map(segment => segment.title)
                .join(', ')
            }}
          </div>

          <div class="d-flex gap-2 mt-3">
            <button
              type="button"
              class="btn btn-success btn-sm flex-grow-1"
              :disabled="dispatchAccepted"
              @click="simulateMemberAcceptance"
            >
              {{
                dispatchAccepted
                  ? '✓ Accepted (Preview)'
                  : '[ Accept Gig ]'
              }}
            </button>

            <button
              type="button"
              class="btn btn-outline-light btn-sm flex-grow-1"
              @click="dispatchModalOpen = false"
            >
              [ Decline ]
            </button>
          </div>
        </div>

        <button
          v-if="!dispatchSent"
          type="button"
          class="btn btn-pulse-primary w-100"
          @click="sendTelegramDispatch"
        >
          Trigger Outbound Telegram Message
        </button>

        <div
          v-else
          class="text-center text-success small fw-bold"
        >
          Preview only — no message delivered.
        </div>

      </div>
    </div>

  </div>
</template>
