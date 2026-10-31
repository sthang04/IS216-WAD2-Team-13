<script setup>
import {computed,ref,watch,onMounted,onUnmounted,nextTick} from 'vue'
import {supabase} from '../supabase'
import {buildRecoveryTracker} from '../services/simulatorRecoveryTracker.js'
import {simulatorWorkflowError} from '../services/simulatorWorkflowActivation.js'
import SimulatorCalendarActions from './SimulatorCalendarActions.vue'
import {SIMULATOR_WORKFLOW_VERIFIED,createSimulatorWorkflow,prepareRecoveryDraft,projectRecoveryPreview,
 workflowReadiness,captureSimulatorState,undoReadiness,bookingEvidence,suggestSimulatorFacilities,
 effectiveInvitationStatus,simulatorStartRequestKey,recordedDisruptionResolutions} from '../services/simulatorWorkflowService.js'
const props=defineProps({data:Object,eventId:[Number,String],options:{type:Array,default:()=>[]},disruptions:{type:Array,default:()=>[]},refreshVersion:{type:Number,default:0},refreshEvent:Function,selectedRecoveryId:{type:String,default:null}})
const emit=defineEmits(['refresh','invitations-changed','select-option','stage-change','review-saved','operation-complete'])
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
let historyTimer
let contextEpoch=0,historyVersion=0,incomingVersion=0,authId,authSubscription,timer,disposed=false
const selectedEvent=computed(()=>props.data?.events?.find(e=>String(e.id)===String(props.eventId)))
// Never use the facility navbar's active club as the event's identity.
const eventClubId=computed(()=>selectedEvent.value?.club_id ?? null)
function keepAppliedSelection(){return ['Applied','Undone'].includes(history.value.plans.find(p=>p.id===selectedPlanId.value)?.application_status)}
watch(()=>props.selectedRecoveryId,id=>{if(id!==null && id!==selectedOptionId.value){selectedOptionId.value=id;if(id || !keepAppliedSelection())selectedPlanId.value='';bookingSelections.value={}}},{immediate:true})
watch(selectedOptionId,id=>{if(props.selectedRecoveryId!==null && id!==props.selectedRecoveryId)emit('select-option',id)})
const actionDialog=ref(null)
let confirmationTrigger
watch(pendingAction,async action=>{await nextTick();if(action)actionDialog.value?.focus();else confirmationTrigger?.focus?.()})
function localTime(value){if(!value)return 'unchanged';const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',dateStyle:'medium',timeStyle:'short'}).format(d):'Time unavailable'}
const displayStatus=p=>p.application_status==='Applied'?'Recovery applied':p.workflow_status || p.lifecycle
const selectedOption=computed(()=>props.options.find(o=>o.id===selectedOptionId.value))
watch(()=>JSON.stringify(selectedOption.value?.changes),()=>{if(selectedOption.value || !keepAppliedSelection())selectedPlanId.value='';pendingAction.value=null;confirmed.value=false})
const plan=computed(()=>history.value.plans.find(p=>p.id===selectedPlanId.value))
const disruptionResolutions=computed(()=>recordedDisruptionResolutions(plan.value,history.value.audit))
const venueChanges=computed(()=>selectedOption.value?.changes?.filter(c=>c.venueName!=null)||[])
const preview=computed(()=>{
 try{const draft=prepareRecoveryDraft(props.data,props.eventId,selectedOption.value,props.disruptions,bookingSelections.value)
  return {draft,after:projectRecoveryPreview(draft.expectedState,draft.changes),error:''}}
 catch(e){return {draft:null,after:null,error:e.message}}
})
const readiness=computed(()=>{void clock.value;return workflowReadiness({enabled:applicationEnabled.value,plan:plan.value,invites:history.value.invitations,manualAcknowledged:manualAcknowledged.value})})
const tracker=computed(()=>{void clock.value;return buildRecoveryTracker({plan:plan.value,invitations:history.value.invitations,audit:history.value.audit,manualAcknowledged:manualAcknowledged.value,enabled:applicationEnabled.value,data:props.data,now:clock.value})})
const applyReady=computed(()=>!historyLoading.value && !historyError.value && readiness.value.ready && tracker.value.status==='Ready to apply')
const savedFilter=ref('All')
const savedCategory=item=>{const t=savedTracker(item);return item.application_status==='Applied'?'Applied':item.application_status==='Undone' || item.application_status==='Cancelled' || ['Stale or blocked','Rejected or expired'].includes(t.status)?'Other':t.requirementsReady?'Ready to Apply':'Pending'}
const visibleSaved=computed(()=>history.value.plans.filter(p=>savedFilter.value==='All' || savedCategory(p)===savedFilter.value))
const recoveryNotice=computed(()=>historyError.value || (!enabled?'Live updates are unavailable in this environment. You can safely explore scenarios and compare proposals.':capabilityError.value?'Recovery readiness could not be verified. Refresh requirements or contact the club manager.':!plan.value && !invitationEnabled.value?'Preparing recovery requests is unavailable in this environment. Compare proposals now and ask a club manager about activation.':plan.value && !applicationEnabled.value?'Applying and undoing recovery are unavailable in this environment. Requirements may still be reviewed.':'') )
function savedTracker(item){return buildRecoveryTracker({plan:item,invitations:history.value.invitations,audit:history.value.audit,data:props.data})}
watch([()=>tracker.value.status,plan],()=>{emit('stage-change',plan.value?tracker.value.status:'Draft');emit('review-saved',plan.value || null)})
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
 }catch(e){if(!disposed&&version===historyVersion&&epoch===contextEpoch)historyError.value=/Event management permission required/i.test(e.message)?'Recovery history requires an active club role with member-management permission for '+(selectedEvent.value?.club_name || 'this event')+'. Your signed-in account is not authorized. Contact the club manager; changing the calendar acting club does not grant this permission.':'History unavailable: '+e.message}
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
function trapConfirmationFocus(event){
 const items=[...(actionDialog.value?.querySelectorAll('button:not(:disabled),input:not(:disabled)') || [])]
 const first=items[0],last=items.at(-1)
 if(event.shiftKey && (document.activeElement===first || document.activeElement===actionDialog.value)){event.preventDefault();last?.focus()}
 else if(!event.shiftKey && (document.activeElement===last || document.activeElement===actionDialog.value)){event.preventDefault();first?.focus()}
}
function queueAction(label,operation,success,settings={}){
 if(!(settings.application?applicationEnabled.value:invitationEnabled.value)){error.value='Live recovery writes remain disabled: the required backend gate is OFF or unverified.';return}
 if(busy.value)return
 confirmed.value=false;error.value='';message.value='';refreshWarning.value=''
 confirmationTrigger=typeof document==='undefined'?null:document.activeElement
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
   emit('operation-complete',result.application_status)
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
 queueAction('Prepare recovery requests',()=>api.start({...draft,requestId},true),
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
function applyPlan(){if(!applyReady.value){error.value='Complete the outstanding requirements and review the saved recovery before applying.';return}const current={...plan.value},ack=manualAcknowledged.value;queueAction('Apply selected recovery',()=>api.confirm(current,ack,true),'Recovery committed by the server.',{refresh:true,application:true})}
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
 selectedPlanId.value='';selectedOptionId.value=props.selectedRecoveryId ?? '';bookingSelections.value={};error.value='';message.value=''
 startRequestIds.clear();startRequestId.value='';resolutionReasons.value={}
 void loadHistory();void loadCapabilities();void refreshIncoming()
}
watch(()=>[props.eventId,eventClubId.value],resetContext,{immediate:true})
// Equivalent option arrays do not invalidate an idempotent Start request.
watch(()=>props.options,()=>{if(!props.options.some(o=>o.id===selectedOptionId.value))selectedOptionId.value=''})
onMounted(()=>{
 timer=setInterval(()=>{clock.value=Date.now()},1000)
 historyTimer=setInterval(()=>{if(!busy.value && (typeof document==='undefined' || document.visibilityState==='visible'))void refreshHistory()},30000)
 authSubscription=supabase?.auth?.onAuthStateChange?.((_event,session)=>{
  const next=session?.user?.id ?? null
  if(next!==authId){authId=next;resetContext()}
 })?.data?.subscription
})
onUnmounted(()=>{disposed=true;++contextEpoch;++historyVersion;++incomingVersion;clearInterval(timer);clearInterval(historyTimer);authSubscription?.unsubscribe()})
</script>

<template>
  <section id="simulator-recovery-workflow" tabindex="-1" class="pulse-card p-3 p-lg-4 shadow-sm mt-4 mb-4" aria-label="Persisted recovery workflow" :data-selected-recovery="selectedOptionId">
<div class="d-flex flex-wrap justify-content-between align-items-start gap-2"><h5 class="fw-bold">Recovery Workspace</h5><span class="badge bg-light text-dark border">{{ plan ? tracker.status : 'Draft' }}</span></div>
    <p class="small text-muted">Prepare the selected proposal, complete its approvals, then confirm. Undo restores the original schedule only after safety checks pass.</p>
    <p v-if="recoveryNotice" class="small recovery-notice rounded p-2" role="status">{{ recoveryNotice }}</p>
    <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
    <div v-if="message" class="alert alert-info" role="status">{{ message }}</div>
    <div v-if="busy" class="small my-2" role="status" aria-live="polite"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Running {{ busyAction }}; waiting for the server and refresh.</div>
    <div v-if="refreshWarning" class="alert alert-warning small" role="status">{{ refreshWarning }}</div>

    <div v-if="invitationError" class="alert alert-warning small" role="status">{{ invitationError }}</div>
    <label v-if="selectedRecoveryId===null" for="persisted-option" class="small fw-bold">Recovery option to preview</label>
    <select v-if="selectedRecoveryId===null" id="persisted-option" v-model="selectedOptionId" :disabled="busy" class="form-select form-select-sm mb-3">
      <option value="">Select an option</option>
      <option v-for="option in options" :key="option.id" :value="option.id">{{ option.title }}</option>
    </select>
    <p v-if="!plan && !selectedOption" class="small text-muted">Choose and compare a ranked proposal above to prepare recovery requests.</p>
    <p v-if="selectedOption && !plan" class="small fw-bold">Selected proposal: {{ selectedOption.title }}</p>
    <div v-for="change in !plan ? selectedOption?.changes || [] : []" :key="change.segmentId+':'+(change.assignmentId||'time')" class="small border-bottom py-2">
      <strong>{{ activityName(change.segmentId) }}</strong>
      <div v-if="change.replacementMemberId!=null">{{ memberName(change.replacedMemberId) }} to {{ memberName(change.replacementMemberId) }} ({{ change.roleName || 'role requires verification' }})</div>
      <div v-if="change.starts_at || change.ends_at">Proposed times: {{ localTime(change.starts_at) }} to {{ localTime(change.ends_at) }}</div>
      <div v-if="change.venueName">Proposed room: {{ change.venueName }}</div>
    </div>
    <div v-for="change in !plan ? venueChanges : []" :key="'booking-'+change.segmentId" class="my-2 small">
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
    <p v-if="venueChanges.length || plan?.changes?.some(c=>c.venueName || c.facilityBookingId)" class="small text-muted mt-2">Use the existing <RouterLink to="/facilities">Master Facility Calendar</RouterLink> for claims, waitlists and OSL approval. A pending claim is not approved. This panel never creates or reverses bookings.</p>
    <p v-if="selectedOption && !plan && preview.error" class="small text-warning">{{ preview.error }}</p>

    
    <div v-if="pendingAction" class="recovery-dialog-backdrop" @keydown.esc="pendingAction=null;confirmed=false">
    <div ref="actionDialog" tabindex="-1" role="dialog" aria-label="Action confirmation" aria-modal="true" aria-describedby="recovery-confirm-title" class="pulse-card p-4 recovery-dialog" @keydown.tab="trapConfirmationFocus">
      <strong id="recovery-confirm-title">Confirm selected action: {{ pendingAction.label }}</strong>
      <p class="small mt-2">{{ plan?.title || selectedOption?.title }}. This action will be checked by the server before it is saved.</p>
      <label><input v-model="confirmed" type="checkbox"> I confirm this selected action and its reviewed inputs.</label>
      <button type="button" class="btn btn-primary btn-sm ms-2" :disabled="!(pendingAction.settings.application ? applicationEnabled : invitationEnabled) || busy || !confirmed" @click="executePending">Confirm selected action</button>
      <button type="button" class="btn btn-outline-secondary btn-sm ms-2" :disabled="busy" @click="pendingAction=null;confirmed=false">Dismiss action</button>
    </div></div>

    <label v-if="plan && (plan.application_status==='Applied' || tracker.requirementsReady)" class="d-block small my-2"><input v-model="manualAcknowledged" type="checkbox"> I manually checked personal availability, qualifications and facility suitability; incomplete data is not proof of availability.</label>
    <button v-if="!plan" class="btn btn-outline-primary btn-sm me-2" :disabled="!invitationEnabled || busy || !preview.draft" @click="startPlan">Prepare recovery requests</button>
    <button class="btn btn-outline-secondary btn-sm" :disabled="historyLoading || busy" @click="refreshHistory">{{ historyLoading ? 'Refreshing history...' : 'Refresh persisted history' }}</button>
    <details class="small my-2"><summary>Saved recovery status guide</summary><p class="small text-muted mt-2">Persisted history: {{ history.plans.length }} plans loaded (read-only refresh; mutations remain gated). In Progress / Ready to Confirm / Resolved / Cancelled / Undone are separate from simulation feasibility.</p></details>
    <section class="my-4" aria-label="Saved recovery tracker">
      <h6 class="fw-bold">Pending and saved recoveries</h6>
      <p class="small text-muted">Proposals stay separate from the live schedule. Revisit a recovery below or refresh to check approvals.</p>
      <p v-if="!historyLoading && !history.plans.length" class="small">No saved recoveries are available for this event.</p>
      <div class="d-flex flex-wrap gap-2 my-2" role="group" aria-label="Saved recovery views"><button v-for="view in ['All','Pending','Ready to Apply','Applied','Other']" :key="view" type="button" class="btn btn-outline-secondary btn-sm" :aria-pressed="savedFilter===view" @click="savedFilter=view">{{ view }}</button></div>
      <p v-if="history.plans.length && !visibleSaved.length" class="small text-muted">No recoveries in this view.</p>
      <div class="table-responsive" v-if="visibleSaved.length"><table class="table table-sm align-middle small">
       <thead><tr><th scope="col">Recovery proposal</th><th scope="col">Status</th><th scope="col">Next action</th><th scope="col">Review</th></tr></thead>
       <tbody><tr v-for="item in visibleSaved" :key="item.id" :class="{'table-active':selectedPlanId===item.id}"><td>{{ item.title }}</td><td>{{ savedTracker(item).requirementsReady ? 'Ready for final review' : savedTracker(item).status }}</td><td>{{ savedTracker(item).nextAction }}</td><td><button type="button" class="btn btn-outline-secondary btn-sm" :disabled="busy" :aria-pressed="selectedPlanId===item.id" :data-saved-plan-id="item.id" @click="selectedPlanId=item.id">Review saved recovery</button></td></tr></tbody>
      </table></div>
    </section>
    <section id="recovery-requirements" tabindex="-1" v-if="plan" class="recovery-requirements border rounded p-3 mb-3" aria-label="Pending recovery requirements">
      <div class="d-flex flex-wrap justify-content-between gap-2"><h6 class="fw-bold">{{ plan.title }}</h6><span class="badge bg-light text-dark border">{{ tracker.status }}</span></div>
      <p class="small">{{ tracker.nextAction }}</p>
      <p class="small">{{ tracker.satisfied }} of {{ tracker.total }} recorded requirements satisfied. The server revalidates everything before Apply.</p>
      <div class="table-responsive"><table class="table table-sm small align-middle"><thead><tr><th scope="col">Proposed change</th><th scope="col">Affected activity</th><th scope="col">Requirement</th><th scope="col">Current status</th><th scope="col">Next action</th><th scope="col">Last updated</th></tr></thead><tbody>
       <tr v-for="row in tracker.rows" :key="row.key"><td>{{ row.change }}</td><td>{{ row.activity }}</td><td>{{ row.kind }}</td><td>{{ row.status }}<div v-if="row.delivery" class="text-muted">Delivery: {{ row.delivery }}. Delivery is not acceptance.</div></td><td>{{ row.nextAction }}</td><td>{{ row.updated ? localTime(row.updated) : 'Not supplied' }}</td></tr>
      </tbody></table></div>
    </section>

    <div v-if="plan" class="small border rounded p-2 my-2">
      <div class="d-flex flex-wrap align-items-center gap-2 mb-2"><strong>Selected saved plan: {{ plan.title }}</strong><span class="badge bg-light text-dark border">{{ displayStatus(plan) }}</span></div>
      <div v-for="(change,i) in plan.changes" :key="'saved-change-'+i" class="py-1"><strong>{{ activityName(change.segmentId) }}</strong><span v-if="change.venueName">: {{ change.venueName }}</span><span v-if="change.replacementMemberId!=null">: {{ memberName(change.replacedMemberId) }} to {{ memberName(change.replacementMemberId) }}</span><span v-if="change.starts_at || change.ends_at">: {{ localTime(change.starts_at) }} to {{ localTime(change.ends_at) }}</span></div>

      <div v-for="blocker in plan.blockers || []" :key="blocker">{{ blocker }}</div>
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
    <p v-if="incoming" class="small">Your replacement invitation is available in <RouterLink to="/personal-schedule#simulator-invitation-inbox">Personal Schedule - My replacement invitations</RouterLink>. Accepting it does not apply an assignment.</p>
    <div v-if="plan && disruptionResolutions.length" class="border rounded p-2 my-3 small" aria-label="Recorded disruption resolution">
      <strong>Disruption resolution tracker</strong>
      <p>Independently verify the original resource is available again, then record why. Original disruption history is retained. Resolution does not change the event or bypass Undo validation.</p>
      <div v-for="row in disruptionResolutions" :key="row.index" class="border-top py-2">
        <strong>Disruption {{ row.index }}: {{ row.disruption.type==='MEMBER_UNAVAILABLE' ? memberName(row.disruption.memberId) : row.disruption.venueName }}</strong>
        <div>{{ localTime(row.disruption.start) }} to {{ localTime(row.disruption.end) }} | {{ row.resolved ? 'Explicitly resolved' : plan.application_status==='Draft' && plan.lifecycle==='In Progress' ? 'Recovery in progress - original issue unresolved' : 'Unresolved - blocks Undo when relevant to the original event' }}</div>
        <div v-if="row.resolved">{{ row.reason }} | {{ row.resolvedAt }}</div>
        <template v-else-if="plan.application_status==='Applied'">
          <label :for="'resolution-'+row.index">Reason and evidence that original resource availability is restored</label>
          <textarea :id="'resolution-'+row.index" v-model="resolutionReasons[row.index]" class="form-control form-control-sm" maxlength="2000" :disabled="busy" />
          <button type="button" class="btn btn-outline-primary btn-sm mt-1" :disabled="!applicationEnabled || busy || !manualAcknowledged" @click="resolveDisruption(row)">Mark disruption {{ row.index }} resolved</button>
        </template>
      </div>
    </div>
    <ul v-if="plan?.application_status==='Draft'" class="small text-muted mt-3"><li v-for="reason in readiness.reasons" :key="reason">{{ reason.replace(/replacement member (\d+)/g,(_,id)=>'replacement '+memberName(id)).replace(/activity (\d+)/g,(_,id)=>activityName(id)) }}</li></ul>
    <a v-if="plan?.application_status==='Draft' && !tracker.requirementsReady" href="#recovery-requirements" class="btn btn-pulse-primary btn-sm me-2">Review outstanding requirements</a>
    <button v-if="plan?.application_status==='Draft' && tracker.requirementsReady" class="btn btn-success btn-sm me-2" :disabled="busy || !applyReady" @click="applyPlan">Apply selected recovery</button>
    <button v-if="plan?.application_status==='Draft'" class="btn btn-outline-danger btn-sm me-2" :disabled="!invitationEnabled || busy || plan?.application_status!=='Draft'" @click="cancelPlan">Cancel Recovery Plan</button>
    <button v-if="plan?.application_status==='Applied'" class="btn btn-outline-danger btn-sm" :disabled="!applicationEnabled || busy || !manualAcknowledged || !undoStatus.ready" @click="undoPlan">Undo Recovery Plan</button>
    <p v-if="plan?.application_status==='Applied'" class="small text-muted mt-2">Undo: {{ undoStatus.reason }} External Telegram messages cannot be retracted. Invalid or transferred original bookings require manual recovery.</p>

    <details class="small mt-4 recovery-support"><summary>Support diagnostics and audit history</summary>
    <details v-if="preview.draft && !plan" class="small my-2"><summary>Exact original and proposed records (local preview)</summary><pre class="overflow-auto">{{ JSON.stringify({before:preview.draft.expectedState,after:preview.after},null,2) }}</pre></details>
    <details v-if="plan?.after_state" class="small"><summary>Undo preview: recorded applied state to original state</summary><pre class="overflow-auto">{{ JSON.stringify({from:plan.after_state,to:plan.before_state},null,2) }}</pre></details>
      <p>Backend application gate: {{ capabilities?.application_enabled ?? 'unverified' }}. Invitation gate: {{ capabilities?.invitations_enabled ?? 'unverified' }}.</p>
      <p>{{ capabilityError }}</p>
      <p>Event {{ eventId }} | Club {{ eventClubId }} | Plan {{ plan?.id || 'not selected' }} | Revision {{ plan?.version }}</p>
    <details class="small mt-3"><summary>Technical audit history</summary><div v-for="entry in history.audit" :key="entry.id" class="small text-muted">{{ entry.created_at }} | {{ entry.action }} | {{ entry.outcome }} | {{ entry.details }}</div></details></details>
  </section>
</template>

<style scoped>
.recovery-dialog-backdrop{position:fixed;inset:0;z-index:1090;background:#0008;display:flex;align-items:center;justify-content:center;padding:1rem}
.recovery-dialog{width:min(100%,36rem);max-height:90vh;overflow:auto}.recovery-dialog button{margin-top:.75rem}
.recovery-requirements table{min-width:42rem}.table th{white-space:nowrap}.table td{max-width:20rem;overflow-wrap:anywhere}
.recovery-notice{background:var(--pulse-bg);border:1px solid var(--pulse-border)}.recovery-support{color:var(--pulse-ink-muted);font-size:.75rem}
</style>
