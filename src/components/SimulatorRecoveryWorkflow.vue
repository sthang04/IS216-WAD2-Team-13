<script setup>
import {computed,ref,watch,onMounted,onUnmounted} from 'vue'
import {supabase} from '../supabase'
import {simulatorWorkflowError} from '../services/simulatorWorkflowActivation.js'
import SimulatorCalendarActions from './SimulatorCalendarActions.vue'
import {SIMULATOR_WORKFLOW_VERIFIED,createSimulatorWorkflow,prepareRecoveryDraft,projectRecoveryPreview,
 workflowReadiness,captureSimulatorState,undoReadiness,bookingEvidence,suggestSimulatorFacilities,
 effectiveInvitationStatus,simulatorStartRequestKey,recordedDisruptionResolutions} from '../services/simulatorWorkflowService.js'
const props=defineProps({data:Object,eventId:[Number,String],options:{type:Array,default:()=>[]},disruptions:{type:Array,default:()=>[]},refreshVersion:{type:Number,default:0},refreshEvent:Function})
const emit=defineEmits(['refresh','invitations-changed'])
// Reads are safe behind server authorization; every write still requires both gates.
const enabled=SIMULATOR_WORKFLOW_VERIFIED
const api=createSimulatorWorkflow(supabase,{enabled,allowReadOnly:true})
// Fail closed until authenticated read-only metadata confirms the reviewed backend.
const capabilities=ref(null),capabilityError=ref('')
const applicationEnabled=computed(()=>enabled&&capabilities.value?.application_enabled===true)
const invitationEnabled=computed(()=>enabled&&capabilities.value?.invitations_enabled===true)
const selectedOptionId=ref(''),selectedPlanId=ref(''),bookingSelections=ref({}),resolutionReasons=ref({})
const confirmed=ref(false),manualAcknowledged=ref(false),busy=ref(false),error=ref(''),message=ref('')
const refreshWarning=ref(''),busyAction=ref('')
const history=ref({plans:[],invitations:[],audit:[]}),historyLoading=ref(false),historyError=ref('')
const incoming=ref(null),invitationError=ref(''),pendingAction=ref(null),clock=ref(Date.now())
const invitationId=ref(typeof window==='undefined'?null:new URLSearchParams(window.location.search).get('replacementInvitation'))
const startRequestId=ref(''),startRequestIds=new Map()
let contextEpoch=0,historyVersion=0,incomingVersion=0,authId,authSubscription,timer,disposed=false
const selectedEvent=computed(()=>props.data?.events?.find(e=>String(e.id)===String(props.eventId)))
// Never use the facility navbar's active club as the event's identity.
const eventClubId=computed(()=>selectedEvent.value?.club_id ?? null)
const selectedOption=computed(()=>props.options.find(o=>o.id===selectedOptionId.value))
const plan=computed(()=>history.value.plans.find(p=>p.id===selectedPlanId.value))
const disruptionResolutions=computed(()=>recordedDisruptionResolutions(plan.value,history.value.audit))
const venueChanges=computed(()=>selectedOption.value?.changes?.filter(c=>c.venueName!=null)||[])
const preview=computed(()=>{
 try{const draft=prepareRecoveryDraft(props.data,props.eventId,selectedOption.value,props.disruptions,bookingSelections.value)
  return {draft,after:projectRecoveryPreview(draft.expectedState,draft.changes),error:''}}
 catch(e){return {draft:null,after:null,error:e.message}}
})
const readiness=computed(()=>{void clock.value;return workflowReadiness({enabled:applicationEnabled.value,plan:plan.value,invites:history.value.invitations,manualAcknowledged:manualAcknowledged.value})})
const incomingStatus=computed(()=>effectiveInvitationStatus(incoming.value,clock.value))
const undoStatus=computed(()=>{
 try{return undoReadiness(plan.value,captureSimulatorState(props.data,props.eventId))}
 catch(e){return {ready:false,reason:e.message}}
})
const inviteTargets=computed(()=>{
 const pairs=new Map()
 for(const change of plan.value?.changes || [])if(change.replacementMemberId!=null)pairs.set(change.replacedMemberId+':'+change.replacementMemberId,{replaced:change.replacedMemberId,recipient:change.replacementMemberId})
 return [...pairs.values()]
})
function memberName(id){return props.data?.members?.find(m=>String(m.id)===String(id))?.full_name || 'Member '+id}
function activityName(id){return props.data?.event_segments?.find(s=>String(s.id)===String(id))?.title || 'Activity '+id}
function facilitySuggestions(change){
 const segment=props.data?.event_segments?.find(s=>String(s.id)===String(change.segmentId))
 const times=(selectedOption.value?.changes || []).filter(c=>String(c.segmentId)===String(change.segmentId))
 return suggestSimulatorFacilities(props.data || {},change.segmentId,times.find(c=>c.starts_at!=null)?.starts_at ?? segment?.starts_at,times.find(c=>c.ends_at!=null)?.ends_at ?? segment?.ends_at)
}
function matchingBookings(change){
 const facilities=new Set((props.data?.facilities || []).filter(f=>f.name===change.venueName).map(f=>String(f.id)))
 return (props.data?.facility_bookings || []).filter(b=>facilities.has(String(b.facility_id)))
}
function bookingDetails(change){
 const segment=props.data?.event_segments?.find(s=>String(s.id)===String(change.segmentId))
 const times=(selectedOption.value?.changes || []).filter(c=>String(c.segmentId)===String(change.segmentId))
 return bookingEvidence(props.data || {},bookingSelections.value[String(change.segmentId)],eventClubId.value,
  times.find(c=>c.starts_at!=null)?.starts_at ?? segment?.starts_at,times.find(c=>c.ends_at!=null)?.ends_at ?? segment?.ends_at,props.eventId)
}
function proposedTimes(change){
 const original=plan.value?.before_state?.segments?.find(s=>String(s.id)===String(change.segmentId)) || {}
 return (plan.value?.changes || []).filter(c=>String(c.segmentId)===String(change.segmentId)).reduce((t,c)=>({...t,...(c.starts_at?{starts_at:c.starts_at}:{}),...(c.ends_at?{ends_at:c.ends_at}:{})}),original)
}
async function loadCapabilities(){
 const epoch=contextEpoch
 try{const result=await api.capabilities();if(!disposed&&epoch===contextEpoch){capabilities.value=result;capabilityError.value=''}}
 catch(e){if(!disposed&&epoch===contextEpoch){capabilities.value=null;capabilityError.value='Backend activation not verified: '+e.message}}
}
async function loadHistory(){
 if(!selectedEvent.value)return
 const version=++historyVersion,epoch=contextEpoch,eventId=props.eventId
 historyLoading.value=true;historyError.value=''
 try{
  const result=await api.history(eventId)
  if(disposed||version!==historyVersion||epoch!==contextEpoch)return
  history.value=result
  if(selectedPlanId.value&&!result.plans.some(p=>p.id===selectedPlanId.value))selectedPlanId.value=''
 }catch(e){if(!disposed&&version===historyVersion&&epoch===contextEpoch)historyError.value='History unavailable: '+e.message}
 finally{if(!disposed&&version===historyVersion&&epoch===contextEpoch)historyLoading.value=false}
}
async function refreshIncoming(){
 if(!invitationId.value)return
 const version=++incomingVersion,epoch=contextEpoch
 invitationError.value=''
 try{const result=await api.invitation(invitationId.value);if(!disposed&&version===incomingVersion&&epoch===contextEpoch)incoming.value=result}
 catch(e){if(!disposed&&version===incomingVersion&&epoch===contextEpoch){incoming.value=null;invitationError.value='Invitation unavailable: '+e.message}}
}
function refreshHistory(){return Promise.all([loadHistory(),loadCapabilities()])}
// Responses from the separate recipient inbox also invalidate organizer readiness.
watch(()=>props.refreshVersion,()=>{void loadHistory();void loadCapabilities();void refreshIncoming()})
// A confirmation is tied to a specific operation AND its reviewed inputs/revision.
const confirmationKey=computed(()=>JSON.stringify({
 event:props.eventId,club:eventClubId.value,option:selectedOption.value,preview:preview.value.draft,
 plan:plan.value,bookings:bookingSelections.value,incoming:incoming.value,manual:manualAcknowledged.value,resolutionReasons:resolutionReasons.value
}))
watch(confirmationKey,()=>{pendingAction.value=null;confirmed.value=false})
function queueAction(label,operation,success,settings={}){
 if(!(settings.application?applicationEnabled.value:invitationEnabled.value)){error.value='Live recovery writes remain disabled: the required backend gate is OFF or unverified.';return}
 if(busy.value)return
 confirmed.value=false;error.value='';message.value='';refreshWarning.value=''
 pendingAction.value={label,operation,success,settings,key:confirmationKey.value,eventId:props.eventId,
  club:eventClubId.value,planId:plan.value?.id,revision:plan.value?.version}
}
async function executePending(){
 const action=pendingAction.value
 if(!action||!confirmed.value||busy.value||!(action.settings.application?applicationEnabled.value:invitationEnabled.value))return
 if(action.key!==confirmationKey.value){pendingAction.value=null;confirmed.value=false;error.value='Reviewed inputs changed; choose and confirm the action again.';return}
 const epoch=contextEpoch
 pendingAction.value=null;busy.value=true;busyAction.value=action.label;error.value='';message.value='';refreshWarning.value=''
 try{
  const result=await action.operation()
  if(disposed||epoch!==contextEpoch)return
  action.settings.onResult?.(result)
  message.value=action.success
  // A refresh failure must not turn a persisted response into a fake write failure.
  await Promise.all([loadHistory(),loadCapabilities()])
  if(disposed||epoch!==contextEpoch)return
  if(action.settings.refreshInvitation){await refreshIncoming();emit('invitations-changed')}
  if(action.settings.refresh){
   // Await the real loader, so controls stay busy until the schedule refresh
   // finishes. A failed read cannot undo a confirmed server transaction.
   if(props.refreshEvent){
    try{const loaded=await props.refreshEvent();if(loaded===false)refreshWarning.value='The operation was saved, but the event refresh failed. Refresh live data before continuing.'}
    catch{refreshWarning.value='The operation was saved, but the event refresh failed. Refresh live data before continuing.'}
   }else emit('refresh')
  }
 }catch(e){if(!disposed&&epoch===contextEpoch){error.value=simulatorWorkflowError(e);await loadHistory()}}
 finally{if(!disposed&&epoch===contextEpoch){busy.value=false;busyAction.value='';confirmed.value=false}}
}
function startPlan(){
 if(!preview.value.draft)return
 const draft=JSON.parse(JSON.stringify(preview.value.draft)),key=simulatorStartRequestKey(draft)
 if(!startRequestIds.has(key))startRequestIds.set(key,crypto.randomUUID())
 startRequestId.value=startRequestIds.get(key)
 const requestId=startRequestId.value
 queueAction('Start Recovery Plan',()=>api.start({...draft,requestId},true),
  'Recovery started. Actions are pending; event records have not been changed.',{onResult:saved=>{selectedPlanId.value=saved.id}})
}
function attachBooking(change){
 const current={...plan.value},bookingId=bookingSelections.value[String(change.segmentId)]
 queueAction('Associate booking '+bookingId+' with '+activityName(change.segmentId),()=>api.attachBooking(current,change.segmentId,bookingId,true),'Calendar booking associated. Approval is still checked separately.')
}
function cancelPlan(){const current={...plan.value};queueAction('Cancel Recovery Plan',()=>api.cancelPlan(current,true),'Recovery cancelled. Event records are unchanged; handle calendar claims separately.')}
function invite(target){const id=plan.value.id;queueAction('Invite '+memberName(target.recipient)+' to replace '+memberName(target.replaced),()=>api.invite(id,target.recipient,target.replaced,true),'Invitation persisted in the protected Pulse inbox. No public notification or Telegram message was sent.')}
function respond(response){const id=incoming.value.id;queueAction(response+' invitation '+id,()=>api.respond(id,response,true),'Response persisted. No assignment was applied.',{refreshInvitation:true})}
function cancel(id){queueAction('Cancel invitation '+id,()=>api.cancel(id,true),'Invitation cancelled.')}
function applyPlan(){const current={...plan.value},ack=manualAcknowledged.value;queueAction('Confirm Recovery',()=>api.confirm(current,ack,true),'Recovery committed by the server.',{refresh:true,application:true})}
function undoPlan(){const current={...plan.value},ack=manualAcknowledged.value;queueAction('Undo Recovery Plan',()=>api.undo(current,ack,true),'Recovery reversed by the server; review the reopened issue.',{refresh:true,application:true})}
function resolveDisruption(row){
 const current={...plan.value},reason=String(resolutionReasons.value[row.index] || '').trim()
 if(!manualAcknowledged.value){error.value='Independently verify original resource availability before recording resolution.';return}
 if(reason.length<8||reason.length>2000){error.value='Provide a resolution reason (8-2000 characters).';return}
 queueAction('Mark recorded disruption '+row.index+' resolved',()=>api.resolveDisruption(current,row.index,reason,true),
  'Resolution recorded. Original disruption history is retained; Undo must still validate the original event.',{application:true})
}
watch(selectedPlanId,()=>{resolutionReasons.value={}})
function resetContext(){
 ++contextEpoch;++historyVersion;++incomingVersion
 capabilities.value=null;capabilityError.value='';history.value={plans:[],invitations:[],audit:[]};historyError.value='';historyLoading.value=false
 incoming.value=null;pendingAction.value=null;confirmed.value=false;manualAcknowledged.value=false;busy.value=false;busyAction.value='';refreshWarning.value=''
 selectedPlanId.value='';selectedOptionId.value='';bookingSelections.value={};error.value='';message.value=''
 startRequestIds.clear();startRequestId.value='';resolutionReasons.value={}
 void loadHistory();void loadCapabilities();void refreshIncoming()
}
watch(()=>[props.eventId,eventClubId.value],resetContext,{immediate:true})
// Equivalent option arrays do not invalidate an idempotent Start request.
watch(()=>props.options,()=>{if(!props.options.some(o=>o.id===selectedOptionId.value))selectedOptionId.value=''})
onMounted(()=>{
 timer=setInterval(()=>{clock.value=Date.now()},1000)
 authSubscription=supabase?.auth?.onAuthStateChange?.((_event,session)=>{
  const next=session?.user?.id ?? null
  if(next!==authId){authId=next;resetContext()}
 })?.data?.subscription
})
onUnmounted(()=>{disposed=true;++contextEpoch;++historyVersion;++incomingVersion;clearInterval(timer);authSubscription?.unsubscribe()})
</script>

<template>
  <section id="simulator-recovery-workflow" tabindex="-1" class="pulse-card p-4 shadow-sm mb-4" aria-label="Persisted recovery workflow">
    <h5 class="fw-bold">Start, Confirm, Cancel and Undo</h5>
    <div v-if="!enabled" class="alert alert-warning small" role="status">
      LIVE RECOVERY WRITES DISABLED. Live updates are awaiting backend activation and safety verification. Start, Invite, Accept, Confirm, Cancel and Undo remain gated pending safety verification.
      Simulate / Start Recovery Plan / Await acceptance and room approval / Confirm Recovery / Undo if needed.
    </div>
    <p class="small" role="status">Backend application gate: {{ capabilities ? (capabilities.application_enabled ? 'ON' : 'OFF') : 'Not verified' }}. Invitation gate: {{ capabilities ? (capabilities.invitations_enabled ? 'ON' : 'OFF') : 'Not verified' }}. No gate is changed here.</p>
    <p v-if="capabilityError" class="small text-warning" role="status">{{ capabilityError }}</p>
    <p v-if="enabled && !invitationEnabled" class="small text-warning">Start, invitation responses, cancellation and booking attachment await verified invitation-gate activation.</p>
    <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
    <div v-if="message" class="alert alert-info" role="status">{{ message }}</div>
    <div v-if="busy" class="small my-2" role="status" aria-live="polite"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Running {{ busyAction }}; waiting for the server and refresh.</div>
    <div v-if="refreshWarning" class="alert alert-warning small" role="status">{{ refreshWarning }}</div>
    <div v-if="historyError" class="alert alert-warning small" role="status">{{ historyError }}</div>
    <div v-if="invitationError" class="alert alert-warning small" role="status">{{ invitationError }}</div>
    <p class="small">Selected event club: {{ selectedEvent?.club_name || 'unverified' }} ({{ eventClubId ?? 'unverified' }}). Calendar acting-club selection does not change this identity.</p>
    <label for="persisted-option" class="small fw-bold">Recovery option to preview</label>
    <select id="persisted-option" v-model="selectedOptionId" :disabled="busy" class="form-select form-select-sm mb-3">
      <option value="">Select an option</option>
      <option v-for="option in options" :key="option.id" :value="option.id">{{ option.title }}</option>
    </select>
    <div v-for="change in selectedOption?.changes || []" :key="change.segmentId+':'+(change.assignmentId||'time')" class="small border-bottom py-2">
      <strong>{{ activityName(change.segmentId) }}</strong>
      <div v-if="change.replacementMemberId!=null">{{ memberName(change.replacedMemberId) }} to {{ memberName(change.replacementMemberId) }} ({{ change.roleName || 'role requires verification' }})</div>
      <div v-if="change.starts_at || change.ends_at">Proposed times: {{ change.starts_at }} to {{ change.ends_at }}</div>
      <div v-if="change.venueName">Proposed room: {{ change.venueName }}</div>
    </div>
    <div v-for="change in venueChanges" :key="'booking-'+change.segmentId" class="my-2 small">
      <label :for="'booking-'+change.segmentId" class="fw-bold">Actual booking for {{ activityName(change.segmentId) }}</label>
      <select :id="'booking-'+change.segmentId" v-model="bookingSelections[String(change.segmentId)]" class="form-select form-select-sm">
        <option value="">Select a verified booking</option>
        <option v-for="booking in matchingBookings(change)" :key="booking.id" :value="booking.id">Booking {{ booking.id }} | {{ booking.booking_date }} {{ booking.start_time }} | {{ booking.status }}</option>
      </select>
      <details class="mt-2"><summary>Compare shared facility inventory (read-only)</summary>
        <div v-for="facility in facilitySuggestions(change)" :key="facility.id" class="border-bottom py-1">
          <strong>{{ facility.name }}</strong> | {{ facility.type }} | Capacity {{ facility.capacity ?? 'unverified' }}
          <div>{{ facility.status }}. {{ facility.reasons.join(' ') }}</div>
          <div>{{ facility.warning }}</div>
        </div>
      </details>
      <div>Status: {{ bookingDetails(change).status }}. {{ bookingDetails(change).reasons.join(' ') }}</div>
      <div>Capacity: {{ bookingDetails(change).capacity ?? 'Unverified' }}. Equipment: {{ bookingDetails(change).equipment?.join(', ') || 'Unverified' }}.</div>
    </div>
    <p class="small text-muted mt-2">Use the existing <RouterLink to="/facilities">Master Facility Calendar</RouterLink> for claims, waitlists and OSL approval. A pending claim is not approved. This panel never creates or reverses bookings.</p>
    <p v-if="selectedOption && preview.error" class="small text-warning">{{ preview.error }}</p>
    <details v-if="preview.draft" class="small my-2"><summary>Exact original and proposed records (local preview)</summary><pre class="overflow-auto">{{ JSON.stringify({before:preview.draft.expectedState,after:preview.after},null,2) }}</pre></details>
    
    <div v-if="pendingAction" class="alert alert-info small" aria-label="Action confirmation">
      <strong>Confirm selected action: {{ pendingAction.label }}</strong>
      <div>Event {{ pendingAction.eventId }} | Event club {{ pendingAction.club ?? 'unverified' }} | Plan {{ pendingAction.planId || 'new plan' }} | Revision {{ pendingAction.revision ?? 'not started' }}</div>
      <label><input v-model="confirmed" type="checkbox"> I confirm this selected action and its reviewed inputs.</label>
      <button type="button" class="btn btn-primary btn-sm ms-2" :disabled="!(pendingAction.settings.application ? applicationEnabled : invitationEnabled) || busy || !confirmed" @click="executePending">Confirm selected action</button>
      <button type="button" class="btn btn-outline-secondary btn-sm ms-2" :disabled="busy" @click="pendingAction=null;confirmed=false">Dismiss action</button>
    </div>

    <label class="d-block small my-2"><input v-model="manualAcknowledged" type="checkbox"> I manually checked personal availability, qualifications and facility suitability; incomplete data is not proof of availability.</label>
    <button class="btn btn-outline-primary btn-sm me-2" :disabled="!invitationEnabled || busy || !preview.draft" @click="startPlan">Start Recovery Plan</button>
    <button class="btn btn-outline-secondary btn-sm" :disabled="historyLoading || busy" @click="refreshHistory">{{ historyLoading ? 'Refreshing history...' : 'Refresh persisted history' }}</button>
    <p class="small text-muted mt-2">Persisted history: {{ history.plans.length }} plans loaded (read-only refresh; mutations remain gated). In Progress / Ready to Confirm / Resolved / Cancelled / Undone are separate from simulation feasibility.</p>
    <select v-if="history.plans.length" v-model="selectedPlanId" :disabled="busy" class="form-select form-select-sm my-2" aria-label="Saved recovery plan">
      <option value="">Select a saved revision</option>
      <option v-for="item in history.plans" :key="item.id" :value="item.id">{{ item.title }} | {{ item.workflow_status || item.lifecycle }} | {{ item.application_status }} | v{{ item.version }}</option>
    </select>

    <div v-if="plan" class="small border rounded p-2 my-2">
      <strong>{{ plan.workflow_status || plan.lifecycle }}</strong>
      <div>Ready to Confirm means prerequisites are recorded; the server must still check freshness and conflicts.</div>
      <div v-for="blocker in plan.blockers || []" :key="blocker">{{ blocker }}</div>
      <div v-for="action in plan.actions || []" :key="action.action+':'+action.kind">
        {{ action.kind }} | {{ activityName(action.segmentId) }}: {{ action.status }}
      </div>
      <div v-if="plan.application_status==='Draft'">Notification delivery is pending integration. Consent must be recorded inside Pulse; no Telegram message is sent.</div>
    </div>
    <div v-for="change in plan?.changes?.filter(c => c.venueName) || []" :key="'claim-'+change.segmentId" class="small border rounded p-2 my-2">
      Proposed room: {{ change.venueName }} for {{ activityName(change.segmentId) }}.
      <SimulatorCalendarActions :venue="change.venueName"
        :start="proposedTimes(change).starts_at" :end="proposedTimes(change).ends_at"
        :event-club-id="data?.events?.find(e => String(e.id)===String(eventId))?.club_id"
        :event-club-name="data?.events?.find(e => String(e.id)===String(eventId))?.club_name" />
      <label :for="'attach-'+change.segmentId">Actual calendar booking to associate (approval still required)</label>
      <select :id="'attach-'+change.segmentId" v-model="bookingSelections[String(change.segmentId)]" class="form-select form-select-sm">
        <option value="">Select actual booking after calendar claim</option>
        <option v-for="booking in matchingBookings(change)" :key="booking.id" :value="booking.id">Booking {{ booking.id }} | {{ booking.booking_date }} {{ booking.start_time }} | {{ booking.status }}</option>
      </select>
      <button class="btn btn-outline-primary btn-sm mt-1"
        :disabled="!invitationEnabled || busy || plan.application_status!=='Draft' || !bookingSelections[String(change.segmentId)]"
        @click="attachBooking(change)">Associate calendar booking</button>
      <div>Current association: {{ change.facilityBookingId || 'Awaiting claim' }}. Refresh live event data if a newly claimed booking is missing.</div>
    </div>

    <div v-for="target in inviteTargets" :key="target.replaced+':'+target.recipient" class="small my-2">
      Invite {{ memberName(target.recipient) }} to replace {{ memberName(target.replaced) }}:
      <button class="btn btn-outline-primary btn-sm" :disabled="!invitationEnabled || busy || plan?.application_status!=='Draft'" @click="invite(target)">Create replacement invitation</button>
    </div>
    <div v-for="invitation in history.invitations.filter(i => String(i.plan_id)===String(plan?.id))" :key="invitation.id" class="small border rounded p-2 my-2">
      {{ memberName(invitation.recipient_member_id) }}: {{ invitation.status }} | Delivery: {{ invitation.delivery_status }} (Telegram integration unavailable)
      <button class="btn btn-outline-danger btn-sm ms-2" :disabled="!invitationEnabled || busy || !['Pending','Accepted'].includes(invitation.status)" @click="cancel(invitation.id)">Cancel invitation</button>
    </div>
    <div v-if="incoming" class="border rounded p-3 my-3">
      <strong>Replacement invitation: {{ incoming.event_name }}</strong>
      <div v-for="term in incoming.assignment_snapshot" :key="term.assignment_id" class="small">{{ term.activity }} | {{ term.role_name }} | {{ term.starts_at }} to {{ term.ends_at }}</div>
      <p>Status: {{ incomingStatus }}. Acceptance does not apply an assignment.</p>
      <button class="btn btn-success btn-sm me-2" :disabled="!invitationEnabled || busy || incomingStatus!=='Pending'" @click="respond('Accepted')">Accept invitation</button>
      <button class="btn btn-outline-danger btn-sm" :disabled="!invitationEnabled || busy || incoming.status!=='Pending'" @click="respond('Declined')">Decline invitation</button>
    </div>
    <div v-if="plan?.application_status==='Applied' && disruptionResolutions.length" class="border rounded p-2 my-3 small" aria-label="Recorded disruption resolution">
      <strong>Recorded resource disruptions</strong>
      <p>Independently verify the original resource is available again, then record why. Original disruption history is retained. Resolution does not change the event or bypass Undo validation.</p>
      <div v-for="row in disruptionResolutions" :key="row.index" class="border-top py-2">
        <strong>Disruption {{ row.index }}: {{ row.disruption.type==='MEMBER_UNAVAILABLE' ? memberName(row.disruption.memberId) : row.disruption.venueName }}</strong>
        <div>{{ row.disruption.start }} to {{ row.disruption.end }} | {{ row.resolved ? 'Explicitly resolved' : 'Unresolved ? blocks Undo when relevant to the original event' }}</div>
        <div v-if="row.resolved">{{ row.reason }} | {{ row.resolvedAt }}</div>
        <template v-else>
          <label :for="'resolution-'+row.index">Reason and evidence that original resource availability is restored</label>
          <textarea :id="'resolution-'+row.index" v-model="resolutionReasons[row.index]" class="form-control form-control-sm" maxlength="2000" :disabled="busy" />
          <button type="button" class="btn btn-outline-primary btn-sm mt-1" :disabled="!applicationEnabled || busy || !manualAcknowledged" @click="resolveDisruption(row)">Mark disruption {{ row.index }} resolved</button>
        </template>
      </div>
    </div>
    <ul class="small text-muted mt-3"><li v-for="reason in readiness.reasons" :key="reason">{{ reason }}</li></ul>
    <button class="btn btn-success btn-sm me-2" :disabled="busy || !readiness.ready" @click="applyPlan">Confirm Recovery</button>
    <button class="btn btn-outline-danger btn-sm me-2" :disabled="!invitationEnabled || busy || plan?.application_status!=='Draft'" @click="cancelPlan">Cancel Recovery Plan</button>
    <button class="btn btn-outline-danger btn-sm" :disabled="!applicationEnabled || busy || !manualAcknowledged || !undoStatus.ready" @click="undoPlan">Undo Recovery Plan</button>
    <p class="small text-muted mt-2">Undo: {{ undoStatus.reason }} External Telegram messages cannot be retracted. Invalid or transferred original bookings require manual recovery.</p>
    <details v-if="plan?.after_state" class="small"><summary>Undo preview: recorded applied state to original state</summary><pre class="overflow-auto">{{ JSON.stringify({from:plan.after_state,to:plan.before_state},null,2) }}</pre></details>
    <div v-for="entry in history.audit" :key="entry.id" class="small text-muted">{{ entry.created_at }} | {{ entry.action }} | {{ entry.outcome }} | {{ entry.details }}</div>
  </section>
</template>
