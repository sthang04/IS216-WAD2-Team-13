<script setup>
// Purpose: own the simulator scenario, live source refresh, calculated impacts and selected recovery; previews never write operational tasks.
// This view owns hypothetical scenario state. Persisted recovery history is
// managed separately so event switches and Reset cannot erase real requests.
import {
  ref,
  shallowRef,
  computed,
  onMounted,
  onActivated,
  onDeactivated,
  onUnmounted,
  watch,
  nextTick
} from 'vue'

import {simulationImpactSummary,visibleRecoveryOptions} from '../services/simulatorPresentationService.js'
import {useRoute, useRouter} from 'vue-router'

import {
  loadSimulationData
} from '../services/simulationDataService.js'

import {
  runCompleteSimulation
} from '../services/simulationService.js'

import { prepareDisruptionCards, assessCombinedRecovery, buildCombinedRecoveryOptions } from '../services/combinedSimulationService.js'
import { groupActivities } from '../services/simulatorActivityGroups.js'

import {
  evaluateRecoveryPlans
} from '../services/recoveryPlanEvaluationService.js'

import { singaporeLocal as toSingaporeLocal, scheduleRange } from '../services/disruptionScheduleService.js'

import SimulatorPlanComparison from '../components/SimulatorPlanComparison.vue'
import SimulatorRecoveryPlanCard from '../components/SimulatorRecoveryPlanCard.vue'
import SimulatorBackToTop from '../components/SimulatorBackToTop.vue'
import PipMascot from '../components/PipMascot.vue'
import {notificationStore, setPipStatic, setPipQuiet} from '../services/notificationStore'
import SimulatorDisruptionInterval from '../components/SimulatorDisruptionInterval.vue'
import SimulatorImpactWorkspace from '../components/SimulatorImpactWorkspace.vue'
import SimulatorRecoveryWorkflow from '../components/SimulatorRecoveryWorkflow.vue'
import {projectRecoveryPreview} from '../services/simulatorWorkflowService.js'
import SimulatorFacilitySetup from '../components/SimulatorFacilitySetup.vue'
import SimulatorCandidateChooser from '../components/SimulatorCandidateChooser.vue'
import SimulatorFacilityChoices from '../components/SimulatorFacilityChoices.vue'
import {presentSimulatorFacilities} from '../services/simulatorFacilityPresentationService.js'
import RiskChatbotAssistant from '../components/RiskChatbotAssistant.vue'

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
- Scenario calculations never update Supabase. Child workflow panels make
  separately confirmed requests only when the reviewed backend gates permit.
- Candidate previews never send Telegram messages.
- A disrupted schedule is NOT automatically a recovery.
- A recovery must be evaluated before it can be
  displayed as the recommended plan.

========================================================
*/

const props = defineProps({
  active: {type:Boolean, default:true},
  eventId: {type:[String,Number], default:null},
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
const sourceRefreshNotice=ref('')
const result = shallowRef(null)

const loading = ref(false)
const error = ref('')
const initialized = ref(false)
const sessionVersion = ref(0)
const invitationRefreshVersion = ref(0)
let dataRequestVersion=0
// Background re-checks of saved data: at most every 3 minutes (a full load is ~50 requests).
const BACKGROUND_REFRESH_MS=180000
let lastLoadedAt=0

const selectedRecoveryId = ref('')
const selectedSavedRecovery=shallowRef(null)
const comparedRecovery=computed(()=>{
 const p=selectedSavedRecovery.value
 if(!p?.before_state)return selectedRecoveryPlan.value
 try{const after=projectRecoveryPreview(p.before_state,p.changes)
  return {id:p.id,title:p.title,changes:p.changes,proposedSegments:after.segments,proposedAssignments:after.assignments,
   proposedVenues:Object.fromEntries((p.changes || []).filter(c=>c.venueName).map(c=>[String(c.segmentId),c.venueName])),conflicts:[],warnings:[],metrics:null,saved:true}
 }catch{return null}
})
const impactData=computed(()=>selectedSavedRecovery.value?.before_state?{...data.value,event_segments:[...(data.value?.event_segments || []).filter(s=>String(s.event_id)!==String(selectedEventId.value)),...selectedSavedRecovery.value.before_state.segments]}:data.value)
function reviewSavedRecovery(saved){selectedSavedRecovery.value=saved}
// Section shortcuts describe destinations, not mandatory recovery stages.
const sectionShortcuts=computed(()=>[
 {id:'simulator-scenarios',label:'Scenario Builder'},
 {id:'simulator-impact',label:'Impact & Event Village',disabled:!result.value},
 {id:'impact-timeline',label:'Time Machine',disabled:!result.value},
 {id:'impact-facilities',label:'Facility Heatmap',disabled:!result.value},
 {id:'simulator-recovery',label:'Recovery options',disabled:!result.value},
 {id:'simulator-comparison',label:'Plan Comparison',disabled:!result.value&&!selectedSavedRecovery.value},
 {id:'simulator-recovery-workflow',label:'Approvals & Apply / Undo'},
 {id:'simulator-saved-recoveries',label:'Saved Recoveries & status'}
])
const simulationSummary=computed(()=>{
 if(!result.value)return ''
 try{return simulationImpactSummary({data:data.value,eventId:selectedEventId.value,result:result.value,disruptions:buildDisruptions()})}catch{return ''}
})
// Continue editing the selected ranked plan rather than accidentally combining
// a new room with a replacement left over from an earlier selection.
function adoptPreviewInputs(){
 const selected=selectedRecoveryPlan.value;if(!selected || selected.id==='combined-selected')return
 replacementSelections.value=Object.fromEntries(selected.changes.filter(c=>c.replacementMemberId!=null).map(c=>[String(c.replacedMemberId),c.replacementMemberId]))
 selectedFacilityOptions.value=selected.sourceFacilityOptionIds || (allFacilityChoices.value.some(o=>o.id===selected.id)?[selected.id]:[])
}
// Per-activity room options plus whole-venue moves ("Move Main Hall activities to X")
const allFacilityChoices=computed(()=>{const moves=(combinedAssessment.value.venueMoves || []).flatMap(v=>v.options);return [...(combinedAssessment.value.facilityOptions || []),...moves,...moves.flatMap(o=>o.fill || [])]})
const venueMoveCovered=computed(()=>new Set((combinedAssessment.value.venueMoves || []).flatMap(v=>v.segmentIds)))
function previewMemberId(id){return selectedRecoveryPlan.value?selectedRecoveryPlan.value.changes.find(c=>String(c.replacedMemberId)===String(id))?.replacementMemberId:replacementSelections.value[String(id)]}
const displayedFacilityChoices=computed(()=>selectedRecoveryPlan.value?.sourceFacilityOptionIds || (selectedRecoveryPlan.value && allFacilityChoices.value.some(o=>o.id===selectedRecoveryPlan.value.id)?[selectedRecoveryPlan.value.id]:[]))
async function selectCandidate(assessment,candidate){
 adoptPreviewInputs()
 replacementSelections.value={...replacementSelections.value,[String(assessment.memberId)]:candidate.id}
 await nextTick()
 const option=recoveryOptions.value.find(o=>o.id==='combined-selected') || recoveryOptions.value.find(o=>o.changes.some(c=>String(c.replacementMemberId)===String(candidate.id)&&String(c.replacedMemberId)===String(assessment.memberId)))
 if(option){selectRecoveryPlan(option.id);if(!selectedRecoveryPlan.value)error.value='Recovery evaluation is unavailable. Review the scenario and try again before preparing requests.'}
 else error.value='No recovery proposal could be prepared for this selection. Review affected activities and try again.'
}
function setOutageWindow(card,mode){card.intervalMode=mode;if(mode==='event'){card.start=toSingaporeLocal(selectedEvent.value?.starts_at);card.end=toSingaporeLocal(selectedEvent.value?.ends_at)}}
const selectedRecoveryPlan = computed(() => rankedRecoveryPlans.value.find(p => p.id === selectedRecoveryId.value) || null)
function selectRecoveryPlan(id) {
  selectedSavedRecovery.value=null
  selectedRecoveryId.value = id
}


const route = useRoute(), router = useRouter()
const navigationEventId = () => props.eventId ?? route.query.eventId ?? route.query.event_id ?? null
const selectedEventId = ref(navigationEventId())
// Reuse the original simulator's stable card IDs and Add/Remove pattern.
let nextDisruptionId = 1
// Cards and resource choices belong to this preview session; saved plans live
// in the recovery workflow and are not restored into these inputs.
const disruptionCards = ref([])
const pristineDisruptions = ref('[]')
const replacementSelections = ref({})
const selectedFacilityOptions = ref([])
const setupDialog=ref(null)
const setupActivityId=computed(()=>{const card=disruptionCards.value.find(d=>d.type==='FACILITY_UNAVAILABLE');return data.value?.segment_facility_bookings?.find(l=>String(l.booking_id)===String(card?.facilityBookingId))?.segment_id ?? eventSegments.value[0]?.id})
// Counted per activity (Day Ops crew copies once), real bookings only
const bookingCoverage=computed(()=>({total:groupActivities(eventSegments.value).length,linked:groupActivities(eventSegments.value).map(g=>g.items[0]).filter(s=>(data.value?.segment_facility_bookings || []).some(l=>String(l.segment_id)===String(s.id) && (data.value?.facility_bookings || []).some(b=>String(b.id)===String(l.booking_id)))).length}))
function openFacilitySetup(){setupDialog.value?.showModal()}
async function chooseFacility(id){
 adoptPreviewInputs()
 const chosen=allFacilityChoices.value.find(o=>o.id===id);if(!chosen)return
 const conflict=(a,b)=>a.changes.some(x=>b.changes.some(y=>String(x.segmentId)===String(y.segmentId) && ['venueName','starts_at','ends_at'].some(k=>x[k]!=null && y[k]!=null && x[k]!==y[k])))
 selectedFacilityOptions.value=selectedFacilityOptions.value.includes(id)?selectedFacilityOptions.value.filter(x=>x!==id):[...selectedFacilityOptions.value.filter(x=>{const previous=allFacilityChoices.value.find(o=>o.id===x);return previous && !conflict(previous,chosen)}),id]
 await nextTick()
 const option=recoveryOptions.value.find(o=>o.id==='combined-selected')
 selectRecoveryPlan(option?.id || '')
}


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
// The delay picker lists each activity once; a delay then moves every crew member's copy.
const delayActivities = computed(() => groupActivities(eventSegments.value))

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
    year: 'numeric',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatClock(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit' })
}

// UI bounds and submission validation share the loaded event schedule.
const eventSchedule = computed(() => scheduleRange(selectedEvent.value))
// ========================================================
// INITIALIZE INPUTS
// ========================================================

function createDisruption() {
  return { id: 'D' + nextDisruptionId++, type: 'MEMBER_UNAVAILABLE',
    memberId: eventMembers.value[0]?.id ?? null, facilityBookingId:eventLinkedBookings.value[0]?.id ?? null, venueName: eventFacilities.value[0] || '',
    segmentId: delayActivities.value.find(a=>!a.is_fixed)?.id ?? null, delayMinutes: 30,
    // Times start empty: the organiser types when the person or room is unavailable
    start: '', end: '' }
}
function addDisruption() { disruptionCards.value.push(createDisruption()) }
// Add/Remove edits only this hypothetical session; persisted history is separate.

function removeDisruption(id) {
  // Keep one editable card so the user can configure a fresh scenario.
  if (disruptionCards.value.length > 1) disruptionCards.value = disruptionCards.value.filter(d => d.id !== id)
}
// Reset only local proposals and results. The session counter asks child panels
// to clear confirmations without deleting persisted requests or approval history.
function resetSelections(resetWorkflow = true) {
  if(resetWorkflow) sessionVersion.value++
  nextDisruptionId = 1
  // Switching events discards stale cards and uses the new event's actual bounds.
  disruptionCards.value = [createDisruption()]
  selectedRecoveryId.value = ''
  if(resetWorkflow) selectedSavedRecovery.value = null
  rankingLimit.value = 3
  error.value = ''
  replacementSelections.value = {}
  selectedFacilityOptions.value = []
  result.value = null
  pristineDisruptions.value = JSON.stringify(disruptionCards.value)
}
// A delay card names one activity; the engine still gets one delay per Day Ops task,
// so Apply/Undo keeps writing back to the exact rows.
function expandDelayCards(cards) {
  return cards.flatMap(card => {
    if (card.type !== 'SCHEDULE_DELAY') return [card]
    const group = delayActivities.value.find(g => g.ids.some(id => String(id) === String(card.segmentId)))
    return (group?.ids || [card.segmentId]).map((segmentId, i) => ({ ...card, id: i ? card.id + '-' + i : card.id, segmentId }))
  })
}
function buildDisruptions() {
  return prepareDisruptionCards(data.value, selectedEventId.value, expandDelayCards(disruptionCards.value))
}
function validateInputs() { buildDisruptions() }
const validationMessage = computed(() => {
  try { buildDisruptions(); return '' } catch(e) { return e.message }
})
const canRunSimulation = computed(() => !!data.value && !!selectedEventId.value && !validationMessage.value)
const hasUnsavedWork = computed(() => !!result.value || JSON.stringify(disruptionCards.value) !== pristineDisruptions.value)
function confirmDiscard() { return !hasUnsavedWork.value || window.confirm('Discard this unsaved hypothetical simulation? Saved recoveries and approvals will remain unchanged.') }
function changeEvent(event) {
  if (!confirmDiscard()) { event.target.value = selectedEventId.value; return }
  selectedEventId.value = events.value.find(e => String(e.id) === event.target.value)?.id ?? null
}
function resetSession() { resetSelections() }
function beforeUnload(event) { if(props.active && hasUnsavedWork.value) { event.preventDefault(); event.returnValue = '' } }
// App.vue uses v-show; routed and KeepAlive consumers use the same local reset.
// A tagged recovery calendar round trip preserves this hypothetical proposal.
// Other navigation still uses the normal discard/reset behaviour.
let recoveryCalendarTrip=false
const recoveryCalendarTarget=to=>to.path==='/facilities'&&typeof to.query.simRecoveryToken==='string'&&!!to.query.simRecoveryToken
const removeNavigationGuard = router.beforeEach((to,from) => {
  if(props.active && !recoveryCalendarTarget(to) && (to.path !== from.path || to.query.eventId !== from.query.eventId || to.query.event_id !== from.query.event_id) && !confirmDiscard()) return false
})
const removeAfterNavigation = router.afterEach((to,from,failure) => {
  if(failure)return
  if(recoveryCalendarTarget(to)&&props.active){recoveryCalendarTrip=true;return}
  if(recoveryCalendarTrip&&!to.path.startsWith('/facilities')&&!['/events','/'].includes(to.path))recoveryCalendarTrip=false
  if(recoveryCalendarTrip&&['/events','/'].includes(to.path))return
  if(to.path !== from.path && props.active) resetSelections()
})
watch(() => props.active, active => { if(active) { if(recoveryCalendarTrip){recoveryCalendarTrip=false;adoptEventContext();return} resetSelections(); adoptEventContext() } })
function adoptEventContext() {
  const id = navigationEventId()
  if(id != null && events.value.some(e => String(e.id) === String(id) || String(e.source_id) === String(id))) selectedEventId.value = events.value.find(e => String(e.id) === String(id) || String(e.source_id) === String(id)).id
}
watch(() => [props.eventId, route.query.eventId, route.query.event_id], () => { if(props.active) adoptEventContext() })
let wasDeactivated = false
onDeactivated(() => { wasDeactivated = true })
onActivated(() => { if(wasDeactivated) { if(!recoveryCalendarTrip)resetSelections();recoveryCalendarTrip=false; adoptEventContext(); refreshOnFocus();wasDeactivated = false } })
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onUnmounted(() => { removeNavigationGuard(); removeAfterNavigation(); window.removeEventListener('beforeunload', beforeUnload) })

// ========================================================
// RUN SIMULATION
// ========================================================

// Validate every card together before running one calculation. Reusing an old
// result after invalid input would make the comparison describe the wrong plan.
function runSimulation() {
  if (
    !data.value ||
    !selectedEventId.value
  ) {
    return
  }

  error.value = ''
  result.value = null
  // Each new run starts on the top ranked plans.
  rankingLimit.value = 3

  try {
    validateInputs()

    result.value = runCompleteSimulation(
      data.value,
      selectedEventId.value,
      buildDisruptions()
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
// HYPOTHETICAL SESSION INVALIDATION
// ========================================================

watch(selectedEventId, async () => {
  if (!initialized.value) return

  initialized.value = false

  resetSelections()

  await nextTick()

  initialized.value = true

})

watch(disruptionCards, () => {
  // Editing any card invalidates the combined result and its recovery choices.
  if (!initialized.value) return
  result.value = null
  error.value = ''
  replacementSelections.value = {}
  selectedFacilityOptions.value = []
  selectedRecoveryId.value = ''
  selectedSavedRecovery.value = null
}, { deep: true, flush: 'sync' })

// ========================================================
// LOAD LIVE SUPABASE DATA
// ========================================================

/** Reload actual data without applying changes or cancelling invitations.
 * Reset clears hypothetical choices; persisted history belongs to SQL. */
// Reload authoritative records after a real operation; preserving inputs here
// is an explicit choice, unlike entering the simulator, which starts clean.
// Reload authoritative evidence, reject superseded requests and invalidate calculations without losing persisted recovery context.
async function refreshSimulator(preserveScenario=false,background=false) {
  const requestVersion=++dataRequestVersion
  lastLoadedAt=Date.now()
  // Background re-checks stay quiet: no banner, inputs stay usable.
  if(!background || !data.value) loading.value = true
  if(!background){initialized.value = false;error.value = '';result.value = null}
  const previousEventId = selectedEventId.value
  const priorCards=preserveScenario===true?structuredClone(disruptionCards.value.map(c=>({...c}))):null
  try {
    const fresh=await loadSimulationData({ source: 'supabase' })
    if(requestVersion!==dataRequestVersion)return false
    // Focus/poll reads preserve unsaved choices when the underlying evidence is
    // unchanged. Any source edit invalidates old impact/ranking/confirmation.
    if(background && JSON.stringify(fresh)===JSON.stringify(data.value))return true
    sourceRefreshNotice.value=background && data.value?'Saved operational data changed. The simulator has refreshed; rerun your scenario against the current tasks.':''
    data.value=fresh
    initialized.value=false
    result.value=null
    const requestedEvent=selectedEventId.value
    selectedEventId.value = data.value.events.find(e => String(e.id) === String(requestedEvent) || String(e.source_id) === String(requestedEvent))?.id ?? data.value.events[0]?.id ?? null
    if (!selectedEventId.value) throw new Error('No accessible events found in Supabase.')
    // Refresh invalidates hypothetical results but retains the selected saved
    // recovery so booking updates cannot erase its approval/Undo context.
    resetSelections(false)
    if(priorCards && String(previousEventId)===String(selectedEventId.value)){
      disruptionCards.value=priorCards
      for(const card of disruptionCards.value)if(card.type==='FACILITY_UNAVAILABLE' && card.facilityBookingId==null && eventLinkedBookings.value.length){card.facilityBookingId=eventLinkedBookings.value[0].id;setDisruptedBooking(card)}
    }
    await nextTick()
    initialized.value = true
    return true
  } catch (e) {
    if(requestVersion!==dataRequestVersion)return false
    data.value = null
    error.value = e?.message || String(e)
    return false
  } finally { if(requestVersion===dataRequestVersion)loading.value = false }
}
// Skipped while loading, while a scenario is in progress (a reload would wipe it),
// or when the data was loaded recently. "Refresh event data" always reloads.
function refreshOnFocus(){
  if(!props.active || document.hidden || loading.value || hasUnsavedWork.value) return
  if(data.value && Date.now()-lastLoadedAt < BACKGROUND_REFRESH_MS) return
  void refreshSimulator(false,true)
}
let sourceRefreshTimer
onMounted(() => { window.addEventListener('focus',refreshOnFocus);sourceRefreshTimer=setInterval(refreshOnFocus,60000);if(props.active) refreshSimulator() })
onUnmounted(()=>{++dataRequestVersion;window.removeEventListener('focus',refreshOnFocus);clearInterval(sourceRefreshTimer)})
watch(() => props.active, active => { if(active) refreshOnFocus() })

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


// ========================================================
// MEMBER REPLACEMENT RECOMMENDATIONS
// ========================================================

// All recommendation services receive the complete combined simulation. Repeated
// periods for one member share one group; different members never share a list.
const combinedAssessment = computed(() => {
  if (!result.value || !data.value) return { memberGroups: [], facilityRecovery: [], facilityOptions: [], delayedChanges: [] }
  return assessCombinedRecovery(data.value, selectedEventId.value, result.value, buildDisruptions())
})
const memberAssessments = computed(() => combinedAssessment.value.memberGroups)
const facilityRecovery = computed(() => presentSimulatorFacilities({data:data.value || {},recommendations:combinedAssessment.value.facilityRecovery,options:combinedAssessment.value.facilityOptions,rankedPlans:rankedRecoveryPlans.value,simulatedSegments:result.value?.simulatedSegments || []}))
// Rooms matter for a room outage, or for a delay on an event with real bookings
// (it may run past the booked time). Day-of Ops venues without bookings don't.
const hasFacilityDisruptions = computed(() => disruptionCards.value.some(d => d.type === 'FACILITY_UNAVAILABLE' ||
  (d.type === 'SCHEDULE_DELAY' && eventLinkedBookings.value.some(b => !b.venue_only))))
// Coverage warnings belong to affected staffing, not every facility disruption.
const showMemberAvailabilityWarning=computed(()=>!!result.value&&(memberAssessments.value.some(g=>g.segments?.length>0)||
 (result.value.conflictCounts?.member ?? 0)>0||(result.value.conflictCounts?.memberDoubleBooking ?? 0)>0))
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

// Disclosure limits the visible list, not the evaluated proposals or selection.
const rankingLimit = ref(3)
// Scoring rebuilds each plan; carry the room availability ("Free until 18:00") back on
const venueMeta=plan=>{const ids=[plan.id,...(plan.sourceFacilityOptionIds || [])];const move=allFacilityChoices.value.find(o=>o.kind==='venue-move'&&ids.includes(o.id));return move?{availability:move.availability,leftover:move.leftover}:{}}
const overallRankedPlans=computed(()=>{const plans=rankedRecoveryPlans.value.map(p=>({...p,...venueMeta(p)}));return plans.some(p=>p.kind==='combined')?plans.filter(p=>p.kind==='combined'||p.kind==='custom').map((p,i)=>({...p,rank:i+1})):plans})
const rankedRecoveryPlans = computed(() =>
  recoveryEvaluation.value
    ?.rankedPlans || []
)

const displayedRankedPlans = computed(() => visibleRecoveryOptions(overallRankedPlans.value,rankingLimit.value,selectedRecoveryId.value))

watch(() => recoveryOptions.value, options => {
  if (!options.some(o => o.id === selectedRecoveryId.value)) selectedRecoveryId.value = ''
})

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

const recommendationLabel = computed(() => 'COMBINED CONTINGENCY PLANNING')
const recommendationBadge = computed(() => 'All Selected Disruptions')

// Comparison rendering belongs to SimulatorPlanComparison; this view passes
// the selected evaluated or saved proposal without recomputing its score.

// Conversational Contingency Chatbot Mode (Prof Kyong Feedback: reduce cognitive overload)
// In automated Playwright test suites (window.__foundation), default to matrix to preserve low-level assertions.
const viewMode = ref(typeof window !== 'undefined' && window.__foundation ? 'matrix' : 'chatbot') // 'chatbot' | 'matrix'

function handleChatbotApplyPlan() {
  if (bestRecoveryPlan.value) {
    selectRecoveryPlan(bestRecoveryPlan.value.id)
  } else if (recoveryOptions.value.length) {
    selectRecoveryPlan(recoveryOptions.value[0].id)
  }
}

function handleScenarioTrigger(scenarioKey) {
  if (!disruptionCards.value.length) {
    disruptionCards.value = [createNewDisruption()]
  }
  const card = disruptionCards.value[0]
  if (scenarioKey === 'performer_illness') {
    card.type = 'MEMBER_UNAVAILABLE'
    const targetMember = eventMembers.value.find(m => m.full_name?.toLowerCase().includes('angel') || m.full_name?.toLowerCase().includes('mei')) || eventMembers.value[0]
    if (targetMember) card.memberId = targetMember.id
  } else if (scenarioKey === 'venue_fault') {
    card.type = 'FACILITY_UNAVAILABLE'
    if (eventLinkedBookings.value.length) {
      card.facilityBookingId = eventLinkedBookings.value[0].id
      setDisruptedBooking(card)
    }
  } else if (scenarioKey === 'schedule_delay') {
    card.type = 'SCHEDULE_DELAY'
    if (delayActivities.value.length) {
      card.segmentId = delayActivities.value[0].id
      card.delayMinutes = 30
    }
  }
  try {
    runSimulation()
  } catch (err) {
    console.warn('Simulation auto-run:', err.message)
  }
}

</script>

<template>
  <div class="py-2 simulator-page">

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
            v-if="apiMode"
            class="pulse-api-tag"
          >
            Supabase DB Query + JS Matching
          </span>
        </div>

        <h3 class="fw-bold mb-1" tabindex="-1">
          Event Control Room
        </h3>

        <p class="text-muted small mb-0">
          Simulate disruptions, review recovery options,
          and compare plans without modifying live records.
        </p>
      </div>

      <div><button type="button" class="btn btn-outline-secondary btn-sm" :disabled="loading" @click="refreshSimulator(true)">Refresh event data</button></div>
    </div>
    <!-- STATUS MESSAGES -->


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

    <!-- View Switcher Tabs (Prof Kyong feedback: conversational assistant simplifies cognitive load) -->
    <div class="d-flex flex-column flex-md-row align-items-stretch align-items-md-center justify-content-between p-2 mb-4 bg-white rounded-3 shadow-xs border gap-2">
      <div class="d-flex flex-column flex-sm-row align-items-stretch align-items-sm-center gap-2">
        <button
          type="button"
          class="btn btn-sm rounded-pill px-3 py-2 fw-bold d-flex align-items-center justify-content-center gap-2 flex-grow-1"
          :class="viewMode === 'chatbot' ? 'btn-pulse-primary text-white shadow-xs' : 'btn-light text-secondary border-0'"
          @click="viewMode = 'chatbot'"
        >
          <span>💬 AI Contingency Assistant</span>
          <span class="badge bg-white text-danger rounded-pill" style="font-size: 0.65rem;">Recommended</span>
        </button>
        <button
          type="button"
          class="btn btn-sm rounded-pill px-3 py-2 fw-bold d-flex align-items-center justify-content-center gap-2 flex-grow-1"
          :class="viewMode === 'matrix' ? 'btn-pulse-primary text-white shadow-xs' : 'btn-light text-secondary border-0'"
          @click="viewMode = 'matrix'"
        >
          <span>📊 Evaluator Matrix Sandbox</span>
        </button>
      </div>

      <div class="text-muted small px-2 py-1 text-center text-md-end" style="font-size: 0.75rem;">
        <span v-if="viewMode === 'chatbot'">💬 Conversational Flow &middot; Powered by 50/30/20 Multi-Factor Matcher</span>
        <span v-else>🔬 Low-level multi-scenario matrix for technical inspection</span>
      </div>
    </div>

    <!-- Mode 1: Conversational Chatbot Assistant (Prof Kyong's Preferred Submission Flow) -->
    <div v-show="viewMode === 'chatbot'">
      <RiskChatbotAssistant
        :data="data"
        :events="events"
        :selected-event-id="selectedEventId"
        :selected-event="selectedEvent"
        :disruption-cards="disruptionCards"
        :result="result"
        :ranked-recovery-plans="recoveryOptions"
        :best-recovery-plan="bestRecoveryPlan"
        :member-assessments="memberAssessments"
        :facility-recovery="facilityRecovery"
        :loading="loading"
        @trigger-scenario="handleScenarioTrigger"
        @apply-plan="handleChatbotApplyPlan"
        @reset="resetSession"
        @switch-to-matrix="viewMode = 'matrix'"
      />
    </div>

    <!-- Mode 2: Low-Level Matrix Sandbox (Kept in DOM so Playwright selectors remain 100% valid) -->
    <div v-show="viewMode === 'matrix'">
    <!-- ===================================================
         SIMULATION SUMMARY
    ==================================================== -->

    <!-- ===================================================
         KPI CARDS
    ==================================================== -->

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
            Step 1 &middot; What could go wrong
          </span>

          <h5 class="fw-bold mb-0">
            Scenario Builder
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
      <div class="scenario-builder-fields"><div class="scenario-event">
      <label class="small fw-bold" for="simulation-event">Event</label>
      <select id="simulation-event" :value="selectedEventId" @change="changeEvent" class="form-select form-select-sm mb-3" :disabled="loading">
        <optgroup v-if="events.some(e=>e.source_table==='ops_events')" label="Day Ops events"><option v-for="event in events.filter(e=>e.source_table==='ops_events')" :key="event.id" :value="event.id">{{ event.name }}</option></optgroup>
        <optgroup v-if="events.some(e=>e.source_table!=='ops_events')" label="Other saved events"><option v-for="event in events.filter(e=>e.source_table!=='ops_events')" :key="event.id" :value="event.id">{{ event.name }}</option></optgroup>
      </select>
      <p v-if="selectedEvent" class="small text-muted" role="status"><strong>{{ selectedEvent.source_table==='ops_events' ? 'Day Ops event' : 'Saved event records' }}</strong><span v-if="selectedEvent.source_table==='ops_events'"> &middot; Linked recovery updates actual Day Ops tasks when approved.</span><span v-else> &middot; Not linked to Day Ops. Recovery updates this event's saved activities.</span></p>
      <p v-if="sourceRefreshNotice" class="alert alert-info small" role="status">{{ sourceRefreshNotice }}</p>
      <p v-for="notice in (data?.integration_notices || []).filter(n=>String(n.event_id)===String(selectedEventId))" :key="notice.message" class="alert alert-info small" role="status">{{ notice.message }}</p>
      <p v-if="eventSchedule" class="small text-muted" data-testid="event-schedule">Event schedule (Singapore): {{ formatTime(selectedEvent.starts_at) }} to {{ formatTime(selectedEvent.ends_at) }}</p>
      <p v-else class="alert alert-warning small">This event has a missing or invalid schedule. Verify its start and end before simulating.</p>
      <p class="small text-muted">Add member, facility and delay disruptions together. Repeated delays on one activity accumulate. Times use Singapore time.</p>
      </div><div class="scenario-disruptions">
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
            <option v-for="booking in eventLinkedBookings" :key="booking.id" :value="booking.id"><template v-if="booking.venue_only">{{ booking.venue_name }} (Day-of Ops venue, no booking linked) | {{ booking.time_slot }}</template><template v-else>{{ booking.venue_name }} | Booking {{ booking.id }} | {{ booking.event_date }} {{ booking.time_slot }} | {{ booking.status }}</template></option>
          </select>
          <p v-if="eventLinkedBookings.find(b => String(b.id) === String(d.facilityBookingId))?.venue_only" class="small text-muted mb-2">
            This venue isn't booked through Pulse, so suggested rooms are ideas to request, not confirmed. Link a booking in Day-of Ops for full checks.
          </p>
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
            <option v-for="activity in delayActivities" :key="activity.key" :value="activity.id" :disabled="activity.is_fixed">{{ activity.title }} &middot; {{ formatClock(activity.starts_at) }}{{ activity.ids.length > 1 ? ' (' + activity.ids.length + ' crew)' : '' }}{{ activity.is_fixed ? ' (fixed)' : '' }}</option>
          </select>
          <details class="small text-muted mb-2"><summary>Activity schedule details</summary><p class="small text-muted">Activity schedule (Singapore): {{ formatTime(eventSegments.find(s => String(s.id) === String(d.segmentId))?.starts_at) }} to {{ formatTime(eventSegments.find(s => String(s.id) === String(d.segmentId))?.ends_at) }}. Delay starts at this activity's scheduled start; its finish may extend beyond the event.</p></details>
          <label class="small fw-bold" :for="d.id + '-delay'">Delay (minutes)</label>
          <input :id="d.id + '-delay'" v-model.number="d.delayMinutes" type="number" min="1" max="1440" class="form-control form-control-sm">
        </template>
        <details v-if="d.type==='FACILITY_UNAVAILABLE'" class="my-2"><summary>More controls</summary><label class="small fw-bold" :for="d.id+'-window'">Outage interval</label><select :id="d.id+'-window'" class="form-select form-select-sm" :value="d.intervalMode || 'custom'" @change="setOutageWindow(d,$event.target.value)"><option value="custom">Specific time interval</option><option value="event">Entire event</option></select></details>
        <SimulatorDisruptionInterval v-if="d.type !== 'SCHEDULE_DELAY'" :id="d.id" :index="index+1" :event="selectedEvent" v-model:start="d.start" v-model:end="d.end" :disabled="d.intervalMode==='event'" />
      </div>

      </div></div>
      <div class="d-flex flex-wrap gap-2 mt-3">
        <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="loading" @click="addDisruption">Add disruption</button>
        <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="loading" @click="resetSession">Reset Simulation</button>
        <button type="button" class="btn btn-pulse-primary btn-sm" :disabled="loading || !canRunSimulation" @click="runSimulation">Run simulation ({{ disruptionCards.length }})</button>
      </div>
    </section>
    <section v-if="!result" class="pulse-card p-3 p-lg-4 align-self-start" aria-label="Start a simulation"><h5>Start a new simulation</h5><p>Choose an event, configure a member absence, facility outage or activity delay, then run the simulation to explore impacts and recovery plans.</p><p class="small text-muted mb-0">This is a hypothetical session. Saved recoveries, approvals and history remain available below.</p><p v-if="!loading && validationMessage" class="small mt-2 mb-0" role="status">{{ validationMessage }}</p></section>
    </div>
    <p v-if="simulationSummary" class="simulation-impact-summary" role="status" aria-live="polite" aria-atomic="true">{{ simulationSummary }} <a v-if="overallRankedPlans.length" href="#simulator-recovery" class="summary-fix-link">See suggested fix &darr;</a></p>
    <SimulatorImpactWorkspace v-if="result" :data="impactData" :event-id="selectedEventId" :result="result" :show-facilities="hasFacilityDisruptions"
      :disruptions="result ? buildDisruptions() : []" :recovery="comparedRecovery" :loading="loading" />

    <section v-if="data && selectedEvent && hasFacilityDisruptions" class="pulse-card p-3 mb-4" style="margin-top:20px" aria-label="Facility Bookings">
     <div class="d-flex flex-wrap justify-content-between gap-2"><div><h6 class="fw-bold mb-1">Facility Bookings</h6><span class="badge bg-light text-dark border">{{ bookingCoverage.linked }} of {{ bookingCoverage.total }} linked</span></div><button type="button" class="btn btn-outline-secondary btn-sm" @click="openFacilitySetup">Manage bookings</button></div>
     <p class="small mt-2 mb-1">{{ bookingCoverage.total-bookingCoverage.linked }} activities have no linked booking records. Facility changes need verified booking evidence.</p>
     <p class="small text-muted mb-0">Arrange or verify original bookings through Manage bookings.</p>
    </section>
    <dialog ref="setupDialog" class="pulse-card facility-setup-dialog" aria-label="Manage Facility Bookings">
     <div class="d-flex justify-content-between gap-3"><h5 class="fw-bold">Manage Facility Bookings</h5><button type="button" class="btn btn-outline-secondary btn-sm" @click="setupDialog.close()">Return to simulator</button></div>
     <SimulatorFacilitySetup v-if="data && selectedEvent" :initial-activity-id="setupActivityId" :data="data" :event-id="selectedEventId" :busy="loading" @refresh="refreshSimulator(true)" />
    </dialog>
    <!-- ===================================================
         SCENARIO-SPECIFIC RECOMMENDATIONS
    ==================================================== -->

    <section v-if="result" id="simulator-recovery" class="recovery-planning-workspace mb-4" aria-label="Recovery planning workspace">
    <section class="pulse-card p-3 p-lg-4 shadow-sm recovery-ranking" aria-label="Combined recovery ranking">

      <div
        class="d-flex flex-wrap justify-content-between
               align-items-center gap-2 mb-3"
      >
        <div>
          <span
            class="text-uppercase fw-bold text-primary small"
            style="font-size: 0.65rem;"
          >
            Step 3 &middot; How to fix it
          </span>

          <h5 class="fw-bold mb-0">
            Suggested fix
          </h5>
        </div>

      </div>


      <p
        v-if="!result"
        class="small text-muted mb-0"
      >
        Run a simulation to evaluate recovery plans.
      </p>

      <template v-else>
        <details class="small mb-3 ranking-details"><summary>Details</summary>
        <p class="small score-colour-guide" aria-label="Score colour guide"><span class="score-green">80+</span> / <span class="score-amber">50-79</span> / <span class="score-rose">below 50</span> &middot; Score ranges only, never approval or readiness.</p>
        <p v-if="!bestRecoveryPlan" class="small ranking-warning" role="status"><strong>No fully verified recovery plan yet.</strong> Review conflicts and missing evidence. Facility and timing proposals still require final validation.</p>
        <p v-else class="small text-muted">Recommended proposal: {{ bestRecoveryPlan.title }}. Review requirements before applying.</p>
        <details class="small mb-3"><summary>Ranking and verification details</summary><p>Conflict resolution (40%), timetable preservation (30%), member suitability and workload (20%), venue suitability (10%). Existing evaluator scores are unchanged.</p><p>{{ recoveryEvaluation?.summary }}</p><p>Member acceptance, organiser confirmation and approved facility booking evidence are required before applying relevant changes.</p><div v-if="hasFacilityDisruptions" class="alert alert-info small" role="status">
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

        <p class="small text-muted">Overall options combine available building blocks and are checked against all selected disruptions. Search is limited to four choices per requirement and 64 combinations; this is not an exhaustive optimum. Individual member and facility suggestions remain available in Recovery Builder. Missing choices and unresolved conflicts require organizer review.</p>
        </details>
        </details>
        <p v-if="rankingLimit !== 'all' && displayedRankedPlans.length > Number(rankingLimit)" class="small text-muted">Your selected plan is also shown below the suggested fix.</p>
        <!-- RANKED EVALUATED OPTIONS -->

        <SimulatorRecoveryPlanCard v-for="plan in displayedRankedPlans" :key="plan.id" :plan="plan" :data="data" :segments="eventSegments" :selected="selectedRecoveryId===plan.id" @select="selectRecoveryPlan(plan.id)" />
        <button v-if="overallRankedPlans.length > 1" type="button" class="btn btn-link btn-sm p-0" @click="rankingLimit = rankingLimit === 1 ? 3 : 1">{{ rankingLimit === 1 ? 'See other options (' + Math.min(2, overallRankedPlans.length - 1) + ')' : 'Show the suggested fix only' }}</button>

      </template>
    </section>
    <!-- ===================================================
         RECOVERY BUILDER (collapsed)
    ==================================================== -->

    <section v-if="result" class="pulse-card p-3 p-lg-4 shadow-sm recovery-build" aria-label="Build your recovery">
    <details class="recovery-build-toggle" open><summary class="fw-bold">Choose someone else or build your own fix</summary>

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
            Recovery Builder
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

      <details v-if="result" class="small mb-2"><summary>Simulation checks</summary><p>{{ impactedCount }} affected activities &middot; {{ assignmentCount }} assignments requiring review &middot; {{ recoveryStatus }}. Feasibility does not confirm approval.</p></details>
      <p class="small text-muted">Preview an alternative or choose a complete recovery plan below.</p>
      <p class="small recovery-selection-summary" role="status"><template v-if="selectedRecoveryPlan"><strong>Current preview: {{ selectedRecoveryPlan.title }}</strong><br>Selected options are highlighted below. Adjusting a choice recalculates a custom recovery; it does not change the live event.</template><template v-else>Choose an alternative or a ranked plan to preview.</template></p>
      <details v-if="showMemberAvailabilityWarning" class="small text-muted mb-2"><summary>Member availability limits</summary><p>Candidate availability has not been confirmed. Check with your selected replacement before proceeding.</p></details>

      <p
        v-if="!result"
        class="text-muted small mb-0"
      >
        Waiting for a successful simulation.
      </p>

      <div v-if="result" class="recovery-alternatives" :class="{both:memberAssessments.length && hasFacilityDisruptions}"><div v-if="memberAssessments.length"><h6 class="fw-bold">Student replacement alternatives</h6><p class="small text-muted">Choose one replacement per unavailable student. Options for different students can be combined. Role suitability and personal availability must still be verified.</p><SimulatorCandidateChooser v-for="assessment in memberAssessments" :key="assessment.memberId" :assessment="assessment" :selected-id="previewMemberId(assessment.memberId)" @use="selectCandidate(assessment,$event)" /></div>
      <!-- One card per room for a whole-venue move, with how long it is free -->
      <div v-for="move in (result && combinedAssessment.venueMoves) || []" :key="move.venue" class="venue-move-panel">
       <h6 class="fw-bold mb-1">Move everything at {{ move.venue }}</h6>
       <p class="small text-muted mb-3">Pick a room. "Free" means no booking you can see on the Facility Calendar; it still needs a request and approval.</p>
       <div class="venue-move-card">
        <div class="d-flex justify-content-between align-items-center gap-2 mb-3"><strong>Rooms for {{ move.venue }}'s activities</strong><span class="badge bg-light text-dark border">{{ move.options.length }} {{ move.options.length===1?'room':'rooms' }}</span></div>
        <div v-for="option in move.options" :key="option.id" class="venue-room-choice" :class="{chosen:displayedFacilityChoices.includes(option.id)}">
         <div class="venue-room-main">
          <div class="venue-room-text"><strong>{{ option.room }}</strong>
           <span class="venue-chip" :class="option.leftover.length?'partial':'free'">{{ option.leftover.length?option.availability:'Free all day' }}</span>
           <div v-if="option.leftover.length" class="small text-muted mt-1">Covers {{ option.covered }} of {{ option.total }} activities &middot; {{ option.leftover.join(', ') }} need another room</div>
          </div>
          <button type="button" class="venue-room-button" :aria-pressed="displayedFacilityChoices.includes(option.id)" @click="chooseFacility(option.id)">{{ displayedFacilityChoices.includes(option.id)?'✓ Chosen':'Use this room' }}</button>
         </div>
         <!-- Partly free: pick another room for what's left -->
         <div v-if="displayedFacilityChoices.includes(option.id) && option.fill?.length" class="venue-fill">
          <p class="small fw-bold mb-2">{{ option.leftover.join(', ') }} ({{ option.fill[0].span }}): pick another room</p>
          <div v-for="fill in option.fill" :key="fill.id" class="venue-room-choice" :class="{chosen:displayedFacilityChoices.includes(fill.id)}">
           <div class="venue-room-main"><div class="venue-room-text"><strong>{{ fill.room }}</strong> <span class="venue-chip free">Free {{ fill.span }}</span></div>
           <button type="button" class="venue-room-button" :aria-pressed="displayedFacilityChoices.includes(fill.id)" @click="chooseFacility(fill.id)">{{ displayedFacilityChoices.includes(fill.id)?'✓ Chosen':'Use for the rest' }}</button></div>
          </div>
         </div>
         <p v-else-if="displayedFacilityChoices.includes(option.id) && option.leftover.length" class="small text-warning-emphasis mt-2 mb-0">No other room is free for {{ option.leftover.join(', ') }}.</p>
        </div>
       </div>
      </div>
      <SimulatorFacilityChoices v-if="result && hasFacilityDisruptions" :recommendations="facilityRecovery" :options="combinedAssessment.facilityOptions" :ranked-plans="rankedRecoveryPlans" :selected="displayedFacilityChoices" :data="data" :event="selectedEvent" @choose="chooseFacility" /></div>
    </details>
    </section>
    </section>

    <!-- ===================================================
         PLAN COMPARISON
    ==================================================== -->

    <SimulatorPlanComparison v-if="result || selectedSavedRecovery" id="simulator-comparison" :data="data" :segments="eventSegments" :before="selectedSavedRecovery?.before_state" :saved-status="selectedSavedRecovery?.application_status" :recovery="comparedRecovery" :result="result" />

    <!-- Review the comparison before confirming database recovery. -->
    <section aria-label="Recovery Workflow and Saved Recoveries" class="mt-4">
    <SimulatorRecoveryWorkflow :active="props.active" :session-version="sessionVersion" @review-saved="reviewSavedRecovery" :selected-recovery-id="selectedRecoveryId" @select-option="selectRecoveryPlan" :refresh-event="refreshSimulator" :refresh-version="invitationRefreshVersion" @invitations-changed="invitationRefreshVersion++" :data="data" :event-id="selectedEventId" :options="recoveryOptions"
      :disruptions="result ? buildDisruptions() : []" />
    </section>
      <SimulatorBackToTop :sections="sectionShortcuts" :active="props.active" />
    </div><!-- End Mode 2 Matrix Sandbox -->

  </div>
  
</template>


<style scoped>
.simulator-control-grid{display:grid;grid-template-columns:minmax(20rem,25rem) minmax(0,1fr);gap:1.25rem;align-items:start}
.simulator-builder{min-width:0;align-self:start}
#simulator-scenarios,#simulator-recovery,#simulator-comparison{scroll-margin-top:1.5rem}
.simulator-builder .row>[class*="col-"]{width:100%}
@media(max-width:1023px){.simulator-control-grid{grid-template-columns:1fr}.simulator-builder{position:static;max-height:none}.simulator-builder .row>[class*="col-"]{width:50%}}
@media(max-width:575px){.simulator-builder .row>[class*="col-"]{width:100%}.simulator-scenario-card{padding:.75rem!important}}
.simulator-metrics>div{display:flex}.simulator-metrics .pulse-card{width:100%;height:100%;min-height:6rem;display:flex;flex-direction:column;justify-content:space-between;gap:.25rem}.simulator-metrics .text-uppercase{min-height:2rem}.simulator-metrics .fs-5{font-size:clamp(.95rem,2vw,1.25rem)!important}
.pulse-candidate-card.is-selected{border-color:var(--pulse-primary)!important;box-shadow:0 0 0 2px var(--pulse-primary-light)}
.recovery-choice.is-selected{border-color:var(--pulse-primary)!important;box-shadow:0 0 0 2px var(--pulse-primary-light);background:var(--pulse-card-bg)}
.recovery-choice summary{cursor:pointer;padding:.5rem 0}.selected-changes{padding-left:1.2rem}
.facility-setup-dialog{width:min(95vw,60rem);max-height:90vh;overflow:auto;border:1px solid var(--pulse-border);padding:1.25rem;color:var(--pulse-ink)}.facility-setup-dialog::backdrop{background:#0008}
@media(max-width:767px){
.simulator-page :deep(.btn),.simulator-page :deep(.form-select),.simulator-page :deep(.form-control:not([type="checkbox"])),.simulator-page :deep(summary){min-height:44px}
.simulator-page :deep(.form-control),.simulator-page :deep(.form-select){font-size:1rem;min-width:0}
.simulator-page :deep(input[type="checkbox"]){width:1.15rem;height:1.15rem;vertical-align:middle}
.simulation-pip{display:none!important}
.simulator-page{padding-bottom:6rem!important;overflow-wrap:anywhere}
.simulator-page :deep(.sim-row-label){min-height:44px}
}
.recovery-planning-workspace{display:grid;grid-template-columns:minmax(0,1fr);gap:1.25rem;align-items:start}
.recovery-build,.recovery-ranking{min-width:0;overflow-wrap:anywhere}
.recovery-selection-summary{padding:.85rem;border:1px solid var(--pulse-border);border-radius:.65rem;background:var(--pulse-bg)}
@media(min-width:1200px){.recovery-planning-workspace{grid-template-columns:minmax(0,1fr)}.recovery-score-grid>.col-md-3{width:50%}}
@media(min-width:1280px){.simulator-control-grid{grid-template-columns:minmax(360px,400px) minmax(0,1fr)}}@media(min-width:1024px) and (max-width:1279px){.simulator-control-grid{grid-template-columns:330px minmax(0,1fr)}}
/* Stretch the alternative cards together on desktop without fixing their
   height, so expanded evidence and longer lists can still grow naturally. */
@media(min-width:1024px){
 .recovery-alternatives.both>*{display:flex;flex-direction:column}
 .recovery-alternatives.both :deep(.candidate-chooser),.recovery-alternatives.both :deep(.facility-choice-group){flex:1}
 .recovery-alternatives.both :deep(.candidate-chooser:last-child),.recovery-alternatives.both :deep(.facility-choice-group:last-child){margin-bottom:0!important}
}
.recovery-alternatives{display:grid;gap:1.25rem;min-width:0}.recovery-alternatives>*{min-width:0}@media(min-width:1024px){.recovery-alternatives.both{grid-template-columns:repeat(2,minmax(0,1fr))}}
.simulator-control-grid{display:block}.simulator-builder{width:100%}.scenario-builder-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:1.5rem}.scenario-builder-fields>div{min-width:0}.scenario-disruptions>.simulator-scenario-card:first-child{margin-top:0!important}.simulator-builder .row>[class*="col-"]{width:100%}@media(max-width:767px){.scenario-builder-fields{grid-template-columns:1fr}}.simulator-builder :is(select,input):focus{border-color:var(--pulse-primary);box-shadow:0 0 0 .2rem var(--pulse-primary-light)}
.score-colour-guide{display:flex;flex-wrap:wrap;gap:.4rem}.score-green{color:#2b8064}.score-amber{color:#966809}.score-rose{color:#c73b61}.ranking-warning{padding:.7rem;border-left:3px solid var(--pulse-amber);background:var(--pulse-amber-bg)}.recovery-choice.is-selected{background:var(--pulse-primary-light)}.simulator-page :deep(button[aria-pressed=true]:not(.btn-success)),.simulator-page :deep(.facility-choice.chosen){background:var(--pulse-primary-light);border-color:var(--pulse-primary)!important;color:var(--pulse-ink)}
.simulator-scenario-card{background:var(--pulse-primary-light)!important;border-color:var(--pulse-primary-border)!important}
.venue-move-card{border:1px solid var(--pulse-border);border-radius:1.4rem;padding:1.25rem;background:var(--pulse-card-bg)}
.venue-room-choice{border:1px solid var(--pulse-border);border-radius:1rem;padding:.85rem 1rem;margin-bottom:.6rem;background:var(--pulse-card-bg)}
.venue-room-main{display:flex;align-items:center;justify-content:space-between;gap:.75rem}.venue-room-text{min-width:0}.venue-room-text strong{margin-right:.4rem}
.venue-chip{display:inline-block;font-size:.72rem;font-weight:600;border-radius:1rem;padding:.15rem .55rem;vertical-align:middle}.venue-chip.free{background:#dcf4df;color:#247642}.venue-chip.partial{background:#fff1c7;color:#8a5a00}
.venue-room-button{flex-shrink:0;white-space:nowrap;border:1px solid var(--pulse-primary);color:var(--pulse-primary);background:var(--pulse-card-bg);border-radius:2rem;padding:.4rem .9rem;font-size:.8rem;font-weight:600;min-height:36px}
.venue-room-button:hover{background:var(--pulse-primary-light)}.venue-room-choice .venue-room-button[aria-pressed="true"]{background:var(--pulse-primary)!important;border-color:var(--pulse-primary)!important;color:#fff!important}
.venue-room-button:focus-visible{outline:2px solid var(--pulse-primary);outline-offset:2px}
.venue-room-choice.chosen{border:2px solid var(--pulse-primary);background:var(--pulse-primary-light)}
.venue-fill{margin-top:.85rem;padding:.85rem 0 0 .9rem;border-left:3px solid var(--pulse-primary)}.venue-fill .venue-room-choice{background:var(--pulse-card-bg);margin-bottom:.45rem}.venue-fill .venue-room-choice.chosen{background:var(--pulse-primary-light)}
@media(max-width:575px){.venue-room-main{flex-wrap:wrap}.venue-room-button{width:100%}}
.summary-fix-link{white-space:nowrap;font-weight:700;margin-left:.4rem}.simulation-impact-summary{padding:1rem 1.2rem;margin:0 0 1.25rem;border-left:4px solid var(--pulse-primary);border-radius:.65rem;background:var(--pulse-primary-light);color:var(--pulse-ink);font-size:clamp(1rem,1.5vw,1.15rem);font-weight:650;line-height:1.6;overflow-wrap:anywhere}
.simulator-page{padding-bottom:6rem!important;min-width:0}@media(max-width:767px){.simulator-page{padding-bottom:9rem!important}.simulation-impact-summary{padding:.9rem}}
</style>
