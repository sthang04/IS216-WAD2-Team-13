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

import { prepareDisruptionCards, assessCombinedRecovery, buildCombinedRecoveryOptions } from '../services/combinedSimulationService.js'

import {
  evaluateRecoveryPlans
} from '../services/recoveryPlanEvaluationService.js'

import PipMascot from '../components/PipMascot.vue'
import SimulatorImpactWorkspace from '../components/SimulatorImpactWorkspace.vue'
import SimulatorRecoveryWorkflow from '../components/SimulatorRecoveryWorkflow.vue'
import {projectRecoveryPreview} from '../services/simulatorWorkflowService.js'
import SimulatorCalendarActions from '../components/SimulatorCalendarActions.vue'
import SimulatorFacilitySetup from '../components/SimulatorFacilitySetup.vue'
import {presentSimulatorFacilities} from '../services/simulatorFacilityPresentationService.js'

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
const invitationRefreshVersion = ref(0)

const activeComparison = ref('original')
const selectedRecoveryId = ref('')
const selectedSavedRecovery=shallowRef(null),workflowStage=ref('Draft')
const comparedRecovery=computed(()=>{
 const p=selectedSavedRecovery.value
 if(!p?.before_state)return selectedRecoveryPlan.value
 try{const after=projectRecoveryPreview(p.before_state,p.changes)
  return {id:p.id,title:p.title,changes:p.changes,proposedSegments:after.segments,proposedAssignments:after.assignments,
   proposedVenues:Object.fromEntries((p.changes || []).filter(c=>c.venueName).map(c=>[String(c.segmentId),c.venueName])),conflicts:[],warnings:[],metrics:null,saved:true}
 }catch{return null}
})
const impactData=computed(()=>selectedSavedRecovery.value?.before_state?{...data.value,event_segments:[...(data.value?.event_segments || []).filter(s=>String(s.event_id)!==String(selectedEventId.value)),...selectedSavedRecovery.value.before_state.segments]}:data.value)
function reviewSavedRecovery(saved){const changed=selectedSavedRecovery.value?.id!==saved?.id || selectedSavedRecovery.value?.application_status!==saved?.application_status;selectedSavedRecovery.value=saved;if(saved && changed)activeComparison.value=saved.application_status==='Undone'?'original':'recovery'}
const currentStage=computed(()=>['Applied','Undone'].includes(workflowStage.value)?7:workflowStage.value==='Ready to apply'?6:!['Draft',''].includes(workflowStage.value)?5:selectedRecoveryId.value?4:result.value?3:0)
const stages=[{label:'Configure',target:'simulator-scenarios'},{label:'Run simulation',target:'simulator-scenarios'},{label:'Understand impact',target:'simulator-impact'},{label:'Explore recovery',target:'simulator-recovery'},{label:'Compare plans',target:'simulator-comparison'},{label:'Track requirements',target:'simulator-recovery-workflow'},{label:'Apply',target:'simulator-recovery-workflow'},{label:'Review / Undo',target:'simulator-recovery-workflow'}]
async function selectCandidate(assessment,candidate){
 replacementSelections.value={...replacementSelections.value,[String(assessment.memberId)]:candidate.id}
 await nextTick()
 const option=recoveryOptions.value.find(o=>o.id==='combined-selected') || recoveryOptions.value.find(o=>o.changes.some(c=>String(c.replacementMemberId)===String(candidate.id)&&String(c.replacedMemberId)===String(assessment.memberId)))
 if(option)selectRecoveryPlan(option.id)
}
function setOutageWindow(card,mode){card.intervalMode=mode;if(mode==='event'){card.start=toSingaporeLocal(selectedEvent.value?.starts_at);card.end=toSingaporeLocal(selectedEvent.value?.ends_at)}}
const selectedRecoveryPlan = computed(() => rankedRecoveryPlans.value.find(p => p.id === selectedRecoveryId.value) || null)
function selectRecoveryPlan(id) {
  selectedSavedRecovery.value=null
  selectedRecoveryId.value = id
  activeComparison.value = id ? 'recovery' : 'original'
}


const selectedEventId = ref(null)
// Reuse the original simulator's stable card IDs and Add/Remove pattern.
let nextDisruptionId = 1
const disruptionCards = ref([])
const replacementSelections = ref({})
const selectedFacilityOptions = ref([])



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

// The disrupted room must come from a real booking linked to this event.
const eventLinkedBookings=computed(()=>(data.value?.facility_slots || []).filter(slot=>
 (data.value?.segment_facility_slots || []).some(link=>
  eventSegmentIds.value.has(String(link.segment_id))&&String(link.facility_slot_id)===String(slot.id))) )
function setDisruptedBooking(card){
 const booking=eventLinkedBookings.value.find(b=>String(b.id)===String(card.facilityBookingId))
 card.venueName=booking?.venue_name || ''
}

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

// ========================================================
// INITIALIZE INPUTS
// ========================================================

function createDisruption() {
  const event = selectedEvent.value
  return { id: 'D' + nextDisruptionId++, type: 'MEMBER_UNAVAILABLE',
    memberId: eventMembers.value[0]?.id ?? null, facilityBookingId:eventLinkedBookings.value[0]?.id ?? null, venueName: eventFacilities.value[0] || '',
    segmentId: eventSegments.value[0]?.id ?? null, delayMinutes: 30,
    start: toSingaporeLocal(event?.starts_at), end: toSingaporeLocal(event?.ends_at) }
}
function addDisruption() { disruptionCards.value.push(createDisruption()) }
// A preset uses a real selected-event activity and only changes preview inputs.
function addDelayPreset(){
 if(!eventSegments.value.length)return
 const card=createDisruption();card.type='SCHEDULE_DELAY';card.delayMinutes=15
 disruptionCards.value.push(card)
}
function removeDisruption(id) {
  // Keep one input card, matching WhatIfSimulator's original interaction.
  if (disruptionCards.value.length > 1) disruptionCards.value = disruptionCards.value.filter(d => d.id !== id)
}
function resetSelections() {
  disruptionCards.value = [createDisruption()]
  replacementSelections.value = {}
  selectedFacilityOptions.value = []
  result.value = null
  activeComparison.value = 'original'
}
function buildDisruptions() {
  return prepareDisruptionCards(data.value, selectedEventId.value, disruptionCards.value)
}
function validateInputs() { buildDisruptions() }

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

watch(disruptionCards, () => {
  // Editing any card invalidates the combined result and its recovery choices.
  if (!initialized.value) return
  result.value = null
  error.value = ''
  activeComparison.value = 'original'
  replacementSelections.value = {}
  selectedFacilityOptions.value = []
}, { deep: true, flush: 'sync' })

// ========================================================
// LOAD LIVE SUPABASE DATA
// ========================================================

/** Reload actual data without applying changes or cancelling invitations.
 * Reset clears hypothetical choices; persisted history belongs to SQL. */
async function refreshSimulator(preserveScenario=false) {
  loading.value = true
  initialized.value = false
  error.value = ''
  result.value = null
  const previousEventId = selectedEventId.value
  const priorCards=preserveScenario===true?structuredClone(disruptionCards.value.map(c=>({...c}))):null
  try {
    data.value = await loadSimulationData({ source: 'supabase' })
    selectedEventId.value = data.value.events.find(e => String(e.id) === String(previousEventId))?.id ?? data.value.events[0]?.id ?? null
    if (!selectedEventId.value) throw new Error('No accessible events found in Supabase.')
    resetSelections()
    if(priorCards && String(previousEventId)===String(selectedEventId.value))disruptionCards.value=priorCards
    await nextTick()
    initialized.value = true
    runSimulation()
    return true
  } catch (e) {
    data.value = null
    error.value = e?.message || String(e)
    return false
  } finally { loading.value = false }
}
onMounted(refreshSimulator)

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

// All recommendation services receive the complete combined simulation. Repeated
// periods for one member share one group; different members never share a list.
const showAllCandidates = ref(false)
const combinedAssessment = computed(() => {
  if (!result.value || !data.value) return { memberGroups: [], facilityRecovery: [], facilityOptions: [], delayedChanges: [] }
  return assessCombinedRecovery(data.value, selectedEventId.value, result.value, buildDisruptions())
})
const memberAssessments = computed(() => combinedAssessment.value.memberGroups)
const facilityRecovery = computed(() => presentSimulatorFacilities({data:data.value || {},recommendations:combinedAssessment.value.facilityRecovery,options:combinedAssessment.value.facilityOptions,rankedPlans:rankedRecoveryPlans.value,simulatedSegments:result.value?.simulatedSegments || []}))
const hasFacilityDisruptions = computed(() => disruptionCards.value.some(d => d.type !== 'MEMBER_UNAVAILABLE'))
const replacementCoverage = computed(() =>
  data.value?.member_replacement_coverage?.byEvent?.[String(selectedEventId.value)] ?? data.value?.member_replacement_coverage)
// Coverage warnings belong to affected staffing, not every facility disruption.
const showMemberAvailabilityWarning=computed(()=>!!result.value&&(memberAssessments.value.some(g=>g.segments?.length>0)||
 (result.value.conflictCounts?.member ?? 0)>0||(result.value.conflictCounts?.memberDoubleBooking ?? 0)>0))
function candidateGroups(assessment) {
  const shown = showAllCandidates.value ? assessment.eligible : assessment.eligible.slice(0,5)
  return [
    { title: 'Exact-role matches', members: shown.filter(c => !c.requiresManualReview) },
    { title: 'Needs Manual Review', members: shown.filter(c => c.requiresManualReview) }
  ].filter(group => group.members.length)
}
const recoveryOptions = computed(() => buildCombinedRecoveryOptions(combinedAssessment.value,
  replacementSelections.value, selectedFacilityOptions.value))

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

watch(() => recoveryOptions.value, options => {
  if (!options.some(o => o.id === selectedRecoveryId.value)) selectedRecoveryId.value = ''
})

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
    facilityRecovery.value.length
  ) {
    return 'Suggestions only'
  }

  return 'Needs review'
})

// ========================================================
// DYNAMIC RECOMMENDATION LABELS
// ========================================================

const recommendationTitle = computed(() => 'Combined Recovery Recommendations')
const recommendationLabel = computed(() => 'COMBINED CONTINGENCY PLANNING')
const recommendationBadge = computed(() => 'All Selected Disruptions')

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
  if (!result.value && !selectedSavedRecovery.value) {
    return []
  }

  if (
    activeComparison.value === 'original'
  ) {
    return selectedSavedRecovery.value?.before_state?.segments || eventSegments.value
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
      comparedRecovery.value
        ?.proposedSegments || []
    )
  }

  return []
})

const comparisonTitle = computed(() => {
  switch (activeComparison.value) {
    case 'original':
      return 'Original Schedule'

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
    !comparedRecovery.value
  ) {
    return null
  }

  return comparedRecovery.value
    .proposedVenues?.[String(segment.id)] ||
    null
}

// ========================================================
// TELEGRAM DISPATCH PREVIEW
// ========================================================


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
          Event Control Room
        </h3>

        <p class="text-muted small mb-0">
          Simulate disruptions, review recovery options,
          and compare plans without modifying live records.
        </p>
      </div>

      <div><button type="button" class="btn btn-outline-secondary btn-sm" :disabled="loading" @click="refreshSimulator(true)">Refresh event data</button></div>
    </div>
    <nav class="simulator-steps mb-3" aria-label="Simulator workflow">
     <a v-for="(step,i) in stages" :key="step.label" :href="'#'+step.target" :aria-current="i===currentStage?'step':undefined" :class="{current:i===currentStage}"><span>{{ i+1 }}</span>{{ step.label }}</a>
    </nav>
    <p class="small text-muted" role="status">Next: {{ stages[currentStage].label }}. Simulations stay read-only; saving requests and applying recovery require separate confirmation.</p>

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
      role="alert"
      class="alert alert-danger"
    >
      <strong>Simulation error:</strong>
      {{ error }}
    </div>

    <!-- ===================================================
         SIMULATION SUMMARY
    ==================================================== -->

    <div
      v-if="result"
      class="small border rounded p-2 mb-3"
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

    <div class="row g-3 mx-0 mb-4 simulator-metrics">

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
         SCENARIO SANDBOX
    ==================================================== -->

    <div class="simulator-control-grid mb-4">
    <section id="simulator-scenarios" class="pulse-card p-3 p-lg-4 shadow-sm simulator-builder" aria-label="Scenario builder">

      <div
        class="d-flex justify-content-between
               align-items-center mb-3"
      >
        <div>
          <span
            class="text-uppercase fw-bold text-danger small"
            style="font-size: 0.65rem;"
          >
            Scenario Builder
          </span>

          <h5 class="fw-bold mb-0">
            Choose Disruption Scenarios
          </h5>
        </div>

        <span
          class="badge bg-danger bg-opacity-10
                 text-danger border"
        >
          Supabase • Read-Only
        </span>
      </div>

      <!-- Original Add/Remove disruption-card pattern, now in the unified view. -->
      <label class="small fw-bold" for="simulation-event">Event</label>
      <select id="simulation-event" v-model="selectedEventId" class="form-select form-select-sm mb-3" :disabled="loading">
        <option v-for="event in events" :key="event.id" :value="event.id">{{ event.name }}</option>
      </select>
      <p class="small text-muted">Add member, facility and delay disruptions together. Repeated delays on one activity accumulate. Times use Singapore time.</p>
      <div v-for="(d,index) in disruptionCards" :key="d.id" class="simulator-scenario-card mt-3 p-3 rounded-3 bg-light border">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <strong>Disruption {{ index + 1 }}</strong>
          <button type="button" class="btn btn-outline-danger btn-sm" :disabled="disruptionCards.length === 1" @click="removeDisruption(d.id)">Remove disruption</button>
        </div>
        <label class="small fw-bold" :for="d.id + '-type'">Disruption type</label>
        <select :id="d.id + '-type'" v-model="d.type" class="form-select form-select-sm mb-2">
          <option value="MEMBER_UNAVAILABLE">Member unavailable</option>
          <option value="FACILITY_UNAVAILABLE">Facility unavailable</option>
          <option value="SCHEDULE_DELAY">Schedule delay</option>
        </select>
        <template v-if="d.type === 'MEMBER_UNAVAILABLE'">
          <label class="small fw-bold" :for="d.id + '-member'">Unavailable member</label>
          <select :id="d.id + '-member'" v-model="d.memberId" class="form-select form-select-sm mb-2">
            <option v-for="member in eventMembers" :key="member.id" :value="member.id">{{ member.full_name }}</option>
          </select>
        </template>
        <template v-else-if="d.type === 'FACILITY_UNAVAILABLE'">
          <label class="small fw-bold" :for="d.id + '-venue'">Unavailable facility</label>
          <select :id="d.id + '-venue'" v-model="d.facilityBookingId" @change="setDisruptedBooking(d)" class="form-select form-select-sm mb-2">
            <option v-for="booking in eventLinkedBookings" :key="booking.id" :value="booking.id">{{ booking.venue_name }} | Booking {{ booking.id }} | {{ booking.event_date }} {{ booking.time_slot }} | {{ booking.status }}</option>
          </select>
          <!-- Missing/RLS-hidden links are not evidence that a room is vacant. -->
          <p v-if="!eventFacilities.length" class="alert alert-warning small">
            No accessible linked facility bookings. Facility Unavailable needs an actual
            calendar booking linked to this event's activity. Ask an authorized organizer
            to verify and link an approved booking; no booking is created here.
          </p>
        </template>
        <template v-else>
          <label class="small fw-bold" :for="d.id + '-segment'">Delayed activity</label>
          <select :id="d.id + '-segment'" v-model="d.segmentId" class="form-select form-select-sm mb-2">
            <option v-for="segment in eventSegments" :key="segment.id" :value="segment.id">{{ segment.title }}</option>
          </select>
          <label class="small fw-bold" :for="d.id + '-delay'">Delay (minutes)</label>
          <input :id="d.id + '-delay'" v-model.number="d.delayMinutes" type="number" min="1" max="1440" class="form-control form-control-sm">
        </template>
        <p v-if="d.type==='FACILITY_UNAVAILABLE' && !eventLinkedBookings.length" class="small text-warning">No linked facility booking is available. Arrange the original booking in Facility Setup / Booking Readiness below before simulating an outage.</p>
        <div v-if="d.type==='FACILITY_UNAVAILABLE'" class="my-2"><label class="small fw-bold" :for="d.id+'-window'">Outage interval</label><select :id="d.id+'-window'" class="form-select form-select-sm" :value="d.intervalMode || 'custom'" @change="setOutageWindow(d,$event.target.value)"><option value="custom">Specific time interval</option><option value="event">Entire event</option></select></div>
        <div v-if="d.type !== 'SCHEDULE_DELAY'" class="row g-2">
          <div class="col-md-6">
            <label class="small fw-bold" :for="d.id + '-start'">Unavailable from (Singapore)</label>
            <input :id="d.id + '-start'" v-model="d.start" :disabled="d.intervalMode==='event'" type="datetime-local" class="form-control form-control-sm">
          </div>
          <div class="col-md-6">
            <label class="small fw-bold" :for="d.id + '-end'">Unavailable until (Singapore)</label>
            <input :id="d.id + '-end'" v-model="d.end" :disabled="d.intervalMode==='event'" type="datetime-local" class="form-control form-control-sm">
          </div>
        </div>
      </div>

      <div class="d-flex flex-wrap gap-2 mt-3">
        <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="loading || !eventSegments.length" @click="addDelayPreset">Add 15-min delay</button>
        <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="loading" @click="addDisruption">Add disruption</button>
        <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="loading" @click="resetSelections">Reset scenario</button>
        <button type="button" class="btn btn-pulse-primary btn-sm" :disabled="loading" @click="runSimulation">Run combined simulation ({{ disruptionCards.length }})</button>
      </div>
    </section>
    <SimulatorImpactWorkspace :data="impactData" :event-id="selectedEventId" :result="result"
      :disruptions="result ? buildDisruptions() : []" :recovery="comparedRecovery" :loading="loading" />
    </div>

    <details v-if="data && selectedEvent && hasFacilityDisruptions" id="simulator-booking-readiness" class="pulse-card p-3 mb-4" aria-label="Facility booking readiness"><summary class="fw-bold">Facility Setup / Booking Readiness</summary>
      <SimulatorFacilitySetup :data="data" :event-id="selectedEventId" :busy="loading" @refresh="refreshSimulator" />
    </details>
    <!-- ===================================================
         SCENARIO-SPECIFIC RECOMMENDATIONS
    ==================================================== -->

    <div id="simulator-recovery" class="pulse-card p-4 shadow-sm mb-4">

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

      <div v-if="showMemberAvailabilityWarning && replacementCoverage?.warning" class="alert alert-warning" role="status">
        {{ replacementCoverage.warning }}
      </div>

      <p
        v-if="!result"
        class="text-muted small mb-0"
      >
        Waiting for a successful simulation.
      </p>

      <!-- MEMBER REPLACEMENTS -->

      <template v-if="result">
        <section v-for="candidateAssessment in memberAssessments" :key="candidateAssessment.memberId" class="mb-4">
          <h6 class="fw-bold">Replacement for {{ candidateAssessment.memberName }}</h6>
          <p class="small text-muted">Affected activities: {{ candidateAssessment.segments.map(s => s.title).join(', ') || 'None in the simulated schedule' }}</p>
        <div v-for="warning in candidateAssessment.warnings" :key="warning" class="alert alert-warning" role="status">{{ warning }}</div>

        <p
          v-if="candidateAssessment.segments.length === 0"
          class="text-muted small mb-0"
        >
          No affected activities were detected.

          Select an unavailable period overlapping
          one of the member's assigned activities.
        </p>

        <p
          v-else-if="!candidateAssessment.eligible.length"
          class="text-muted small mb-0"
        >
          No eligible replacement was found among
          accessible member records.

          Only verified active club memberships enter the candidate list.
          Check roster coverage before interpreting an empty result. Advisory only: reschedule the activity, redistribute qualified tasks, reduce scope, or contact the organizer. Nothing is changed automatically.
        </p>

        <div v-else>
          <div class="d-flex align-items-center gap-2 mb-3">
            <button type="button" class="btn btn-outline-secondary btn-sm" :aria-pressed="showAllCandidates" @click="showAllCandidates = !showAllCandidates">
              {{ showAllCandidates ? 'Show Top 5' : 'Show All Candidates' }}
            </button>
            <span class="small text-muted">Showing {{ (showAllCandidates ? candidateAssessment.eligible.length : Math.min(5,candidateAssessment.eligible.length)) }} of {{ candidateAssessment.eligible.length }} eligible candidates</span>
          </div>
          <section v-for="group in candidateGroups(candidateAssessment)" :key="group.title" class="mb-3">
            <h6>{{ group.title }}</h6>
            <div class="row g-3">
          <div
            v-for="candidate in group.members"
            :key="candidate.id"
            class="col-lg-4"
          >
            <div
              class="p-3 rounded-3 border h-100
                     d-flex flex-column
                     justify-content-between
                     pulse-candidate-card" :class="{'is-selected': String(replacementSelections[String(candidateAssessment.memberId)])===String(candidate.id)}"
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
                    class="badge bg-light text-dark border"
                  >
                    Ranking: {{ candidate.score }}/100
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
                  <strong>Recorded event conflicts:</strong> None found in loaded records.<br>
                  <strong>Availability evidence:</strong>
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
                @click="selectCandidate(candidateAssessment,candidate)" :aria-pressed="String(replacementSelections[String(candidateAssessment.memberId)])===String(candidate.id)"
              >
                {{ String(replacementSelections[String(candidateAssessment.memberId)])===String(candidate.id) ? 'Selected replacement' : 'Select replacement' }}
              </button>
            </div>
          </div>
            </div>
          </section>
        </div>

        <p
          v-if="candidateAssessment.eligible.length"
          class="small text-muted mt-3 mb-0"
        >
          Candidate suitability uses specialty match
          (50%), timetable availability (30%), and
          workload (20%).

          Scores rank candidates; they do not confirm qualifications or acceptance.
          Incomplete timetable evidence requires review.
        </p>

        <section v-if="candidateAssessment.excluded.length" class="mt-4">
          <h6>Excluded replacement candidates ({{ candidateAssessment.excluded.length }})</h6>
          <p class="small text-muted">These authorized club members have recorded conflicts. Personal timetable coverage remains incomplete.</p>
          <div v-for="candidate in candidateAssessment.excluded" :key="candidate.id" class="p-3 border rounded-3 mb-2">
            <strong>{{ candidate.name }}</strong>
            <ul class="small mb-1"><li v-for="reason in candidate.reasons" :key="reason">{{ reason }}</li></ul>
            <div v-for="conflict in candidate.conflicts" :key="conflict.segmentId" class="small text-muted">
              {{ conflict.eventName }} | {{ conflict.activity }}<br>
              {{ formatTime(conflict.start) }} to {{ formatTime(conflict.end) }}
            </div>
          </div>
        </section>
        <p v-else-if="candidateAssessment.segments.length > 0" class="small text-muted mt-3">No authorized candidates were excluded by recorded conflicts. This does not prove personal availability.</p>

        </section>
      </template>

      <!-- FACILITY / DELAY RECOVERY -->

      <template v-if="result && hasFacilityDisruptions">
        <h6 class="fw-bold">Ranked facility and schedule recommendations</h6>
        <p v-if="disruptionCards.some(d => d.type==='SCHEDULE_DELAY')" class="small text-muted">Advisory only: review downstream timing, shorten nonessential activities, or consider safe parallel activities. Nothing is changed automatically.</p>
        <label class="small fw-bold" for="combined-facility-option">Facility/time options for combined preview (multiple selections allowed)</label>
        <select id="combined-facility-option" v-model="selectedFacilityOptions" multiple class="form-select form-select-sm mb-3">

          <option v-for="option in combinedAssessment.facilityOptions" :key="option.id" :value="option.id">{{ option.title }}</option>
        </select>

        <p
          v-if="!facilityRecovery.length"
          class="text-muted small mb-0"
        >
          No facility or schedule recovery suggestion
          was generated from accessible records. Advisory only: explore later times, split the activity if appropriate, reduce capacity, or contact the facility administrator. Nothing is changed automatically.
        </p>

        <div
          v-for="(recommendation, index) in facilityRecovery"
          :key="recommendation.segmentId ?? index"
          data-testid="facility-recovery"
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
            data-testid="facility-alternative"
            class="small mb-2"
          >
            <strong>#{{ alternativeIndex + 1 }} Alternative facility:</strong>

            {{
              alternative.venue ||
              alternative.venueName ||
              'Venue requires verification'
            }}

            <div class="text-muted">
              {{ alternative.status }}
            </div>
            <div class="text-muted">Existing recovery score: {{ alternative.score ?? 'unavailable' }}/100; evaluator rank {{ alternative.evaluationRank ?? 'unavailable' }}. Booking verification required.</div>
            <div>Capacity: {{ alternative.capacity ?? 'unverified' }}; recorded assignee minimum: {{ alternative.minimumCapacity ?? 'unverified' }}.</div>
            <div>Suitability: {{ alternative.suitability }}</div>
            <div>Recorded equipment: {{ alternative.equipment.join(', ') || 'unverified' }}; required equipment needs organizer review.</div>
            <div>Timing: {{ formatTime(alternative.starts_at) }} to {{ formatTime(alternative.ends_at) }}. A supporting booking record does not prove vacancy.</div>
            <div>Room conflicts: {{ alternative.score==null ? 'evaluation unavailable; verification required' : 'none disqualifying in loaded evaluation records' }}. Visibility may be incomplete.</div>
            <div v-for="warning in alternative.warnings" :key="warning" class="text-muted">{{ warning }}</div>
            <div v-for="conflict in alternative.remainingConflicts" :key="conflict.message" class="text-muted">Other recovery issue: {{ conflict.message }}</div>

            <div
              v-if="alternative.reason"
              class="text-muted"
            >
              {{ alternative.reason }}
            </div>
            <!-- Keep the existing recommendation order, score and explanation. -->
            <SimulatorCalendarActions
              :venue="alternative.venue || alternative.venueName"
              :facility-id="alternative.facilityId"
              :start="result?.simulatedSegments?.find(s => String(s.id) === String(recommendation.segmentId))?.starts_at"
              :end="result?.simulatedSegments?.find(s => String(s.id) === String(recommendation.segmentId))?.ends_at"
              :event-club-id="selectedEvent?.club_id"
              :event-club-name="selectedEvent?.club_name"
            />
          </div>


          <p v-if="!recommendation.alternatives.length" class="small text-warning">No eligible alternative facility in accessible records. This does not prove there are no rooms elsewhere.</p>
          <details v-if="recommendation.excludedAlternatives.length" class="small mb-2">
            <summary>Alternatives excluded by existing checks ({{ recommendation.excludedAlternatives.length }})</summary>
            <div v-for="excluded in recommendation.excludedAlternatives" :key="excluded.venue">{{ excluded.venue }}: {{ excluded.rejectedReasons.join(' ') }}</div>
          </details>
          <p v-if="!recommendation.alternatives.length" class="small text-muted">Advisory only: explore later times, split the activity if appropriate, reduce capacity, or contact the facility administrator. Nothing is changed automatically.</p>
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
            Explore recovery
          </span>

          <h5 class="fw-bold mb-0">
            Recovery Plan Ranking
          </h5>
        </div>

        <span class="badge bg-light text-dark border">
          Ranked options
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
            v-if="hasFacilityDisruptions"
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
          class="p-3 border rounded-3 mb-3 recovery-choice" :class="{'is-selected': selectedRecoveryId===plan.id}" :data-plan-id="plan.id" :data-plan-title="plan.title"
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
              {{ {FEASIBLE:'Ready for review',NEEDS_REVIEW:'Verification needed',INFEASIBLE:'Unresolved conflicts'}[plan.status] || plan.status }}
            </span>
          </div>

          <div class="fw-bold mb-2">
            Recovery Score:
            {{ plan.score }}/100
          </div>

          <button type="button" class="btn btn-pulse-primary btn-sm mb-3" :aria-pressed="selectedRecoveryId===plan.id" @click="selectRecoveryPlan(plan.id)">{{ selectedRecoveryId===plan.id ? 'Selected plan' : 'Select this plan' }}</button>
          <ul class="small selected-changes"><li v-for="(change,i) in plan.changes" :key="i">
            <strong>{{ eventSegments.find(s => String(s.id)===String(change.segmentId))?.title || 'Activity' }}</strong>
            <span v-if="change.starts_at || change.ends_at">: {{ formatTime(change.starts_at) }} to {{ formatTime(change.ends_at) }}</span>
            <span v-if="change.venueName">: move to {{ change.venueName }}</span>
            <span v-if="change.replacementMemberId!=null">: replace {{ data.members.find(m => String(m.id)===String(change.replacedMemberId))?.full_name || 'assigned member' }} with {{ data.members.find(m => String(m.id)===String(change.replacementMemberId))?.full_name || 'replacement member' }}</span>
          </li></ul>
          <details class="small"><summary>Checks and score breakdown</summary>
          <div class="row g-2 small mb-2 mt-2">

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
        </details>
        </div>

      </template>
    </div>




    <!-- ===================================================
         PLAN COMPARISON
    ==================================================== -->

    <div id="simulator-comparison" class="pulse-card p-4 shadow-sm">

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
            :disabled="!comparedRecovery"
            @click="activeComparison = 'recovery'"
          >
            Recovery Plan
          </button>

        </div>
      </div>

      <p v-if="!comparedRecovery" class="small text-muted">Select a ranked recovery above to compare and prepare that exact proposal.</p>
      <p v-else class="small" role="status">Selected for comparison and preparation: <strong>{{ comparedRecovery.title }}</strong>. Availability and approvals are checked again before Apply.</p>
      <div
        class="p-3 rounded-3 bg-light border"
      >
        <p
          v-if="!result && !selectedSavedRecovery"
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
            {{ selectedSavedRecovery ? 'Original schedule captured before this saved recovery.' : 'Currently loaded event schedule. Simulation does not change it.' }}
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
            Selected recovery option:
            <strong>
              {{ comparedRecovery?.title }}
            </strong>.

            This remains a preview and has not been
            applied to Supabase.
          </p>

          <ul v-if="activeComparison==='recovery' && comparedRecovery" class="small">
            <li v-for="(change,i) in comparedRecovery.changes.filter(c=>c.replacementMemberId!=null)" :key="i">{{ data.members.find(m=>String(m.id)===String(change.replacedMemberId))?.full_name || 'Assigned member' }} to {{ data.members.find(m=>String(m.id)===String(change.replacementMemberId))?.full_name || 'Replacement member' }} for {{ eventSegments.find(s=>String(s.id)===String(change.segmentId))?.title }} ({{ change.roleName || 'role requires verification' }})</li>
          </ul>
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
              comparedRecovery
            "
            class="small mt-3"
          >
            <strong>
              Evaluated Recovery Score:
            </strong>

            {{ comparedRecovery.score ?? 'Not re-scored' }}/100

            <div class="text-muted">
              {{ comparedRecovery.metrics?.conflictCount ?? 'Unverified' }}
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
        Actual saved plan status and confirmed database operations
        are shown in the recovery workflow below.
      </p>
    </div>

    <!-- Review the comparison before confirming database recovery. -->
    <SimulatorRecoveryWorkflow @operation-complete="activeComparison=$event==='Undone'?'original':'recovery'" @stage-change="workflowStage=$event" @review-saved="reviewSavedRecovery" :selected-recovery-id="selectedRecoveryId" @select-option="selectRecoveryPlan" :refresh-event="refreshSimulator" :refresh-version="invitationRefreshVersion" @invitations-changed="invitationRefreshVersion++" :data="data" :event-id="selectedEventId" :options="recoveryOptions"
      :disruptions="result ? buildDisruptions() : []" />

    <PipMascot
    class="simulation-pip"
    mode="simulation"
    :result="result"
    />

  </div>
  
</template>



<style scoped>
.simulator-control-grid{display:grid;grid-template-columns:minmax(20rem,25rem) minmax(0,1fr);gap:1.25rem;align-items:start}
.simulator-builder{min-width:0;align-self:start}
.simulator-steps{display:flex;flex-wrap:wrap;gap:.5rem;padding:.6rem;border:1px solid var(--pulse-border);border-radius:.75rem;background:var(--pulse-card-bg)}
.simulator-steps a{display:flex;align-items:center;gap:.45rem;padding:.4rem .65rem;color:var(--pulse-ink-muted);font-size:.8rem;font-weight:600;text-decoration:none;border-radius:.45rem}
.simulator-steps a:hover,.simulator-steps a:focus-visible{background:var(--pulse-primary-light);color:var(--pulse-primary)}
.simulator-steps a span{display:grid;place-items:center;width:1.3rem;height:1.3rem;border:1px solid var(--pulse-border);border-radius:50%;font-size:.7rem}
#simulator-scenarios,#simulator-recovery,#simulator-comparison{scroll-margin-top:1.5rem}
.simulator-builder .row>[class*="col-"]{width:100%}
@media(max-width:1100px){.simulator-control-grid{grid-template-columns:1fr}.simulator-builder{position:static;max-height:none}.simulator-builder .row>[class*="col-"]{width:50%}}
@media(max-width:575px){.simulator-builder .row>[class*="col-"]{width:100%}.simulator-steps{gap:.15rem}.simulator-steps a{font-size:.72rem;padding:.35rem}.simulator-scenario-card{padding:.75rem!important}}
.simulator-metrics>div{display:flex}.simulator-metrics .pulse-card{width:100%;height:100%;min-height:6rem;display:flex;flex-direction:column;justify-content:space-between;gap:.25rem}.simulator-metrics .text-uppercase{min-height:2rem}.simulator-metrics .fs-5{font-size:clamp(.95rem,2vw,1.25rem)!important}
.simulator-steps .current{background:var(--pulse-primary-light);color:var(--pulse-primary)}.pulse-candidate-card.is-selected{border-color:var(--pulse-primary)!important;box-shadow:0 0 0 2px var(--pulse-primary-light)}
.recovery-choice.is-selected{border-color:var(--pulse-primary)!important;box-shadow:0 0 0 2px var(--pulse-primary-light);background:var(--pulse-card-bg)}
.recovery-choice summary{cursor:pointer;padding:.5rem 0}.selected-changes{padding-left:1.2rem}
</style>
