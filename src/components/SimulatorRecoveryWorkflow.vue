<script setup>
// Purpose: Coordinate persisted recovery requests, consent, booking evidence, review, readiness, Apply/Undo and history refresh.
// Saved plans and invitations are server history, separate from scenario inputs.
// Resetting a hypothetical preview must never delete these persisted records.
import {computed,ref,watch,onMounted,onUnmounted,nextTick} from 'vue'
import {readRecoveryBookings,RECOVERY_BOOKING_EVENT} from '../services/simulatorBookingBridge.js'
import {simulatorCalendarTarget} from '../services/simulatorCalendarNavigation.js'
import {weekStartOf} from '../services/facilityService.js'
import {supabase} from '../supabase'
import {currentSessionPersona,canOpenView} from '../services/authService.js'
import {buildRecoveryTracker} from '../services/simulatorRecoveryTracker.js'
import {simulatorWorkflowError} from '../services/simulatorWorkflowActivation.js'
import SimulatorCalendarActions from './SimulatorCalendarActions.vue'
import {SIMULATOR_WORKFLOW_VERIFIED,createSimulatorWorkflow,prepareRecoveryDraft,projectRecoveryPreview,
 workflowReadiness,captureSimulatorState,undoReadiness,bookingEvidence,
 effectiveInvitationStatus,simulatorStartRequestKey,recordedDisruptionResolutions} from '../services/simulatorWorkflowService.js'
const props=defineProps({active:{type:Boolean,default:true},sessionVersion:{type:Number,default:0},data:Object,eventId:[Number,String],options:{type:Array,default:()=>[]},disruptions:{type:Array,default:()=>[]},refreshVersion:{type:Number,default:0},refreshEvent:Function,selectedRecoveryId:{type:String,default:null}})
const emit=defineEmits(['refresh','invitations-changed','select-option','stage-change','review-saved','operation-complete'])
// Reads are safe behind server authorization; every write still requires both gates.
const enabled=SIMULATOR_WORKFLOW_VERIFIED
const api=createSimulatorWorkflow(supabase,{enabled,allowReadOnly:true,eventContext:()=>selectedEvent.value})
// Fail closed until authenticated read-only metadata confirms the reviewed backend.
const capabilities=ref(null),capabilityError=ref('')
const applicationEnabled=computed(()=>enabled&&integrationReady.value&&capabilities.value?.application_enabled===true)
const invitationEnabled=computed(()=>enabled&&integrationReady.value&&capabilities.value?.invitations_enabled===true)
// Proposal IDs describe unsaved choices; plan IDs identify persisted history.
// Keeping them separate avoids applying a preview that was never saved/reviewed.
const selectedOptionId=ref(''),selectedPlanId=ref(''),bookingSelections=ref({}),resolutionReasons=ref({})
const confirmed=ref(false),manualAcknowledged=ref(false),busy=ref(false),error=ref(''),message=ref('')
const refreshWarning=ref(''),busyAction=ref('')
const history=ref({plans:[],invitations:[],audit:[]}),historyLoading=ref(false),historyError=ref('')
const incoming=ref(null),invitationError=ref(''),pendingAction=ref(null),clock=ref(Date.now())
const invitationId=ref(typeof window==='undefined'?null:new URLSearchParams(window.location.search).get('replacementInvitation'))
const startRequestId=ref(''),startRequestIds=new Map()
let historyTimer
// Context epochs invalidate all outstanding work after event/account changes;
// per-read versions also prevent older refreshes replacing newer history.
let contextEpoch=0,historyVersion=0,incomingVersion=0,authId,authSubscription,timer,disposed=false
const selectedEvent=computed(()=>props.data?.events?.find(e=>String(e.id)===String(props.eventId)))
const integrationReady=computed(()=>selectedEvent.value?.source_table!=='ops_events' || selectedEvent.value?.recovery_integration_ready===true)
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
const preview=computed(()=>{
 try{const draft=prepareRecoveryDraft(props.data,props.eventId,selectedOption.value,props.disruptions,bookingSelections.value)
  return {draft,after:projectRecoveryPreview(draft.expectedState,draft.changes),error:''}}
 catch(e){return {draft:null,after:null,error:e.message}}
})
const readiness=computed(()=>{void clock.value;return workflowReadiness({enabled:applicationEnabled.value,plan:plan.value,invites:history.value.invitations,manualAcknowledged:manualAcknowledged.value})})
const tracker=computed(()=>{void clock.value;return buildRecoveryTracker({plan:plan.value,invitations:history.value.invitations,audit:history.value.audit,manualAcknowledged:manualAcknowledged.value,enabled:applicationEnabled.value,data:props.data,now:clock.value})})
// Even a previously ready plan becomes unavailable while its requirements
// are loading or failed to refresh; stale UI state is not approval.
const applyReady=computed(()=>!historyLoading.value && !historyError.value && readiness.value.ready && tracker.value.status==='Ready to apply')
// Native disclosure retains mounted controls and all existing polling. Counts
// use authoritative plan/tracker results, never local optimistic approvals.
const savedStatusCounts=computed(()=>{
 void clock.value
 let pending=0,blocked=0
 for(const item of history.value.plans){
  const status=savedTracker(item)
  if(['Stale or blocked','Rejected or expired'].includes(status.status))blocked++
  else if(item.application_status==='Draft' && item.lifecycle==='In Progress' && !status.requirementsReady)pending++
 }
 return {pending,blocked}
})
const savedFilter=ref('All')
const savedCategory=item=>{const t=savedTracker(item);return item.application_status==='Applied'?'Applied':item.application_status==='Undone' || item.application_status==='Cancelled' || ['Stale or blocked','Rejected or expired'].includes(t.status)?'Other':t.requirementsReady?'Ready to Apply':'Pending'}
const visibleSaved=computed(()=>history.value.plans.filter(p=>savedFilter.value==='All' || savedCategory(p)===savedFilter.value))
const recoveryNotice=computed(()=>!integrationReady.value?'Live Day Ops tasks are loaded. Recovery updates require the operations integration migration.':historyError.value || (!enabled?'Live updates are unavailable in this environment. You can safely explore scenarios and compare proposals.':capabilityError.value?'Recovery readiness could not be verified. Refresh requirements or contact the club manager.':!plan.value && !invitationEnabled.value?'Preparing recovery requests is unavailable in this environment. Compare proposals now and ask a club manager about activation.':plan.value && !applicationEnabled.value?'Simulation preview: applying and undoing recovery are turned off on this site. Requirements may still be reviewed.':'') )
// Match the existing router's simulator access check. Missing backend activation,
// draft requirements and recovery-history permissions do not deny page access.
// Read the current persona on render instead of caching a non-reactive session.
function simulationAccessDenied(){const persona=currentSessionPersona();return !!persona&&!canOpenView(persona,'risk')}
function savedTracker(item){return buildRecoveryTracker({plan:item,invitations:history.value.invitations,audit:history.value.audit,data:props.data})}
watch([()=>tracker.value.status,plan],()=>{emit('stage-change',plan.value?tracker.value.status:'Draft');emit('review-saved',plan.value || null)})
const undoStatus=computed(()=>{
 try{return undoReadiness(plan.value,captureSimulatorState(props.data,props.eventId))}
 catch(e){return {ready:false,reason:e.message}}
})
function requestExists(target){return history.value.invitations.some(i=>String(i.plan_id)===String(plan.value?.id)&&String(i.recipient_member_id)===String(target.recipient)&&String(i.replaced_member_id)===String(target.replaced)&&['Pending','Accepted'].includes(effectiveInvitationStatus(i,clock.value)))}
function memberName(id){return props.data?.members?.find(m=>String(m.id)===String(id))?.full_name || 'Member '+id}
function activityName(id){return props.data?.event_segments?.find(s=>String(s.id)===String(id))?.title || 'Activity '+id}
// Manual fallback lists candidates for the exact room, club and whole interval.
// Listing is not association: only an explicit selection or a token-bound calendar
// receipt identifies the booking the user intends to attach.
function matchingBookings(change){
 const facilities=new Set((props.data?.facilities || []).filter(f=>f.name===change.venueName).map(f=>String(f.id)))
 const times=requirementTimes(change);return (bookingData.value.facility_bookings || []).filter(b=>facilities.has(String(b.facility_id))&&(String(b.owner_club_id)===String(eventClubId.value)||pendingForClub(b)||String(claimReceipts.value[String(change.segmentId)])===String(b.id))&&bookingCovers(b,times)&&!bookingEvidence(bookingData.value,b.id,eventClubId.value,times.starts_at,times.ends_at,props.eventId).reasons.includes('Booking is already allocated to another event.'))
}
function proposedTimes(change){
 const original=plan.value?.before_state?.segments?.find(s=>String(s.id)===String(change.segmentId)) || {}
 return (plan.value?.changes || []).filter(c=>String(c.segmentId)===String(change.segmentId)).reduce((t,c)=>({...t,...(c.starts_at?{starts_at:c.starts_at}:{}),...(c.ends_at?{ends_at:c.ends_at}:{})}),original)
}
async function loadCapabilities(){
 const epoch=contextEpoch
 if(!selectedEvent.value || !integrationReady.value){capabilities.value=null;return}
 try{const result=await api.capabilities(props.eventId);if(!disposed&&epoch===contextEpoch){capabilities.value=result;capabilityError.value=''}}
 catch(e){if(!disposed&&epoch===contextEpoch){capabilities.value=null;capabilityError.value='Backend activation not verified: '+e.message}}
}
async function loadHistory(){
 if(!selectedEvent.value || !integrationReady.value){history.value={plans:[],invitations:[],audit:[]};return}
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
let historyRefreshPromise=null
// Refresh server-backed requirements and booking evidence before deriving readiness; failed reads cannot authorize a write.
function refreshHistory(){if(historyRefreshPromise)return historyRefreshPromise;historyRefreshPromise=Promise.all([loadHistory(),loadCapabilities(),refreshBookingRecords()]).finally(()=>{historyRefreshPromise=null});return historyRefreshPromise}
// Responses from the separate recipient inbox also invalidate organiser readiness.
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
// Capture one reviewed action for the confirmation dialog. Changing its plan,
// bookings or acknowledgement invalidates the captured confirmation key.
// Capture one reviewed operation for explicit confirmation, preventing accidental execution from inspection controls.
function queueAction(label,operation,success,settings={}){
 if(!(settings.application?applicationEnabled.value:invitationEnabled.value)){error.value='Live recovery writes remain disabled: the required backend gate is OFF or unverified.';return}
 if(busy.value)return
 confirmed.value=false;error.value='';message.value='';refreshWarning.value=''
 confirmationTrigger=typeof document==='undefined'?null:document.activeElement
 pendingAction.value={label,operation,success,settings,key:confirmationKey.value,eventId:props.eventId,
  club:eventClubId.value,planId:plan.value?.id,revision:plan.value?.version}
}
// Execute the captured operation once and refresh persisted state; a transport response alone is not proof of success.
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
// Reuse one UUID for the same reviewed changes, including after a lost reply.
// Start persists requests atomically; selecting a candidate alone never calls it.
// Prepare exact selected recovery requests with an idempotent request identity, without applying task changes.
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
function invite(target){const id=plan.value.id;queueAction('Invite '+memberName(target.recipient)+' to replace '+memberName(target.replaced),()=>api.invite(id,target.recipient,target.replaced,true),'Invitation saved in the member inbox. Telegram awaits the configured simulator worker; refresh to check delivery status.')}
function respond(response){const id=incoming.value.id;queueAction(response+' invitation '+id,()=>api.respond(id,response,true),response==='Accepted'?'Accepted. You are assigned as soon as every replacement has accepted.':'Declined.',{refreshInvitation:true})}
function cancel(id){queueAction('Cancel invitation '+id,()=>api.cancel(id,true),'Invitation cancelled.')}
// Apply and Undo use the selected saved revision and a separate confirmation.
// Local readiness explains blockers; the backend repeats every safety check.
// Require current readiness before opening confirmation; PostgreSQL repeats authorization and concurrency checks.
function applyPlan(){if(!applyReady.value){error.value='Complete the outstanding requirements and review the saved recovery before applying.';return}const current={...plan.value},ack=manualAcknowledged.value;queueAction('Apply selected recovery',()=>api.confirm(current,ack,true),'Recovery committed by the server.',{refresh:true,application:true})}
// Request reversal of the selected applied revision; server checks current records and unresolved disruptions.
function undoPlan(){const current={...plan.value},ack=manualAcknowledged.value;queueAction('Undo Recovery Plan',()=>api.undo(current,ack,true),'Recovery reversed by the server; review the reopened issue.',{refresh:true,application:true})}
// Record explicit evidence that a disruption ended; this does not itself undo an applied plan.
function resolveDisruption(row){
 const current={...plan.value},reason=String(resolutionReasons.value[row.index] || '').trim()
 if(!manualAcknowledged.value){error.value='Independently verify original resource availability before recording resolution.';return}
 if(reason.length<8||reason.length>2000){error.value='Provide a resolution reason (8-2000 characters).';return}
 queueAction('Mark recorded disruption '+row.index+' resolved',()=>api.resolveDisruption(current,row.index,reason,true),
  'Resolution recorded. Original disruption history is retained; Undo must still validate the original event.',{application:true})
}
watch(selectedPlanId,()=>{resolutionReasons.value={}})
// A new hypothetical session clears local preparation and confirmation only.
// Persisted plans, invitations and audit history remain loaded and untouched.
watch(()=>props.sessionVersion,()=>{
 selectedOptionId.value='';selectedPlanId.value='';bookingSelections.value={};resolutionReasons.value={}
 pendingAction.value=null;confirmed.value=false;manualAcknowledged.value=false;error.value='';message.value=''
})
// Authentication/event changes clear private state immediately, then reload
// server history. Incremented epochs make in-flight responses harmless.
// Discard local confirmations when event/account context changes so old authorization evidence cannot be reused.
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
 historyTimer=setInterval(()=>{if(props.active && !busy.value && (typeof document==='undefined' || document.visibilityState==='visible'))void refreshHistory()},30000)
 authSubscription=supabase?.auth?.onAuthStateChange?.((_event,session)=>{
  const next=session?.user?.id ?? null
  if(next!==authId){authId=next;resetContext()}
 })?.data?.subscription
})
onUnmounted(()=>{disposed=true;++contextEpoch;++historyVersion;++incomingVersion;clearInterval(timer);clearInterval(historyTimer);authSubscription?.unsubscribe()})

// Presentation only. Do not turn local acknowledgement into a persisted approval.
const journey=computed(()=>{
 const changes=plan.value?.changes || selectedOption.value?.changes || []
 const hasMember=changes.some(c=>c.replacementMemberId!=null),hasRoom=changes.some(c=>c.venueName!=null||c.facilityBookingId!=null)
 const stage=(kind,relevant)=>{
  if(!plan.value && !selectedOption.value)return 'Select a plan'
  if(!relevant)return 'Not required'
  if(!plan.value)return 'Not prepared'
  if(historyLoading.value)return 'Refreshing'
  if(historyError.value)return 'Unable to verify'
  const rows=tracker.value.rows.filter(r=>r.kind===kind)
  if(!rows.length)return 'Unable to verify'
  if(rows.every(r=>r.satisfied))return kind==='Member acceptance'?'Accepted':'Approved'
  return [...new Set(rows.map(r=>r.status))].join(' / ')
 }
 return [
  {title:'Member acceptance',status:stage('Member acceptance',hasMember),hint:'Invitation status',target:plan.value?'#recovery-requirements':'#recovery-preparation'},
  {title:'Facility approval',status:stage('Facility approval',hasRoom),hint:'Booking status',target:'#recovery-requirements'},
  {title:'Organiser review',status:!plan.value && !selectedOption.value?'Select a plan':manualAcknowledged.value?'Acknowledged locally':'Local review required',hint:'Local acknowledgement only',target:'#organiser-review'},
  {title:'Apply / Undo',status:!plan.value?'Not prepared':historyLoading.value||historyError.value?'Unable to verify':plan.value.application_status==='Applied'?(applicationEnabled.value&&undoStatus.value.ready?'Applied - Undo eligible':'Applied - Undo blocked'):plan.value.application_status==='Undone'?'Undone':!applicationEnabled.value?'Unavailable':applyReady.value?'Ready to apply':'Blocked',hint:plan.value?.application_status==='Applied'?undoStatus.value.reason:'Subject to final eligibility',target:'#recovery-application'}
 ]
})
// Visual stage semantics are derived from authorised tracker rows. Local
// acknowledgement is blue information, never a green persisted approval.
// Unknown/permission-denied states stay grey and cannot enable Apply/Undo.
const stageTone=stage=>{
 const status=stage.status
 if(/Unable|Unavailable|Not required|Not prepared|Select a plan|Refreshing/i.test(status))return 'unavailable'
 if(/declined|rejected|blocked|expired|cancelled/i.test(status))return 'blocked'
 if(stage.title==='Organiser review')return manualAcknowledged.value?'information':'pending'
 if(['Accepted','Approved','Undone','Applied - Undo eligible'].includes(status))return 'complete'
 if(status==='Ready to apply')return 'information'
 return 'pending'
}
// Stage cards are informational; all recorded requirements remain in the tracker.
function requirementTime(row){
 // Tracker updated may be inherited from plan/audit. Label it as record context,
 // never as the time a member accepted or a facility was approved.
 if(row.key==='review')return 'Local acknowledgement; no saved review timestamp'
 return row.updated?'Record context: '+localTime(row.updated):'Timestamp not supplied'
}

// Group repeated replacements for display only. The saved proposal and each
// per-activity change still feed the existing invitation and Apply validators.
const summaryChanges=computed(()=>plan.value?.changes || selectedOption.value?.changes || [])
const summaryGroups=computed(()=>{const groups=new Map();for(const c of summaryChanges.value){const key=JSON.stringify([c.replacedMemberId,c.replacementMemberId,c.roleName,c.venueName,c.starts_at,c.ends_at]);if(!groups.has(key))groups.set(key,{...c,activities:[]});const g=groups.get(key);if(!g.activities.some(a=>String(a.id)===String(c.segmentId)))g.activities.push({id:c.segmentId,title:activityName(c.segmentId)})}return [...groups.values()]})
// Flatten technical snapshots into readable record fields without hiding any
// values or exposing raw JSON in the organiser's evidence disclosure.
function recordFields(value,path=''){if(value&&typeof value==='object')return Object.entries(value).flatMap(([key,v])=>recordFields(v,path?path+' / '+key:key));return [{field:path.replace(/_/g,' '),value:value==null?'Not recorded':String(value)}]}
const summaryCounts=computed(()=>({activities:new Set(summaryChanges.value.map(c=>String(c.segmentId))).size,assignments:new Set(summaryChanges.value.filter(c=>c.replacementMemberId!=null).map(c=>String(c.assignmentId || c.segmentId+':'+c.replacedMemberId))).size,rooms:new Set(summaryChanges.value.filter(c=>c.venueName!=null).map(c=>String(c.segmentId))).size}))

// Tabs inspect requirements, not progress. Moving between them never changes
// acknowledgement, consent, booking association or the server's Apply gates.
const activeStage=ref('Member acceptance'),bookingRefreshing=ref(false),bookingRefreshError=ref('')
// Hide inapplicable requirement tabs only; keep authoritative tracker/readiness unchanged.
const visibleJourney=computed(()=>journey.value.filter(stage=>stage.status!=='Not required'))
watch(visibleJourney,stages=>{if(!stages.some(stage=>stage.title===activeStage.value))activeStage.value=stages[0]?.title || 'Organiser review'},{immediate:true})
const activeStageIndex=computed(()=>Math.max(0,visibleJourney.value.findIndex(stage=>stage.title===activeStage.value)))
const currentStage=computed(()=>visibleJourney.value[activeStageIndex.value])
function selectStage(index,focus=false){activeStage.value=visibleJourney.value[(index+visibleJourney.value.length)%visibleJourney.value.length].title;if(focus)nextTick(()=>document.getElementById('recovery-tab-'+activeStageIndex.value)?.focus())}
watch([()=>plan.value?.id,()=>selectedOption.value?.id],()=>{const changes=plan.value?.changes || selectedOption.value?.changes || [];activeStage.value=['Applied','Undone','Cancelled'].includes(plan.value?.application_status)?'Apply / Undo':changes.some(c=>c.replacementMemberId!=null)?'Member acceptance':changes.some(c=>c.venueName!=null||c.facilityBookingId!=null)?'Facility approval':'Organiser review'},{immediate:true})
const hasSelection=computed(()=>!!plan.value||!!selectedOption.value)
const planInvitations=computed(()=>history.value.invitations.filter(i=>String(i.plan_id)===String(plan.value?.id)))
// The RPC invites a replacement/replaced-member pair for its exact assignment
// snapshot. Multiple roles are displayed together, not sent as duplicate invites.
const memberRequirements=computed(()=>{const groups=new Map();for(const c of summaryChanges.value.filter(c=>c.replacementMemberId!=null)){const key=c.replacedMemberId+':'+c.replacementMemberId;if(!groups.has(key))groups.set(key,{key,replaced:c.replacedMemberId,recipient:c.replacementMemberId,activities:new Set(),roles:new Set()});const row=groups.get(key);row.activities.add(String(c.segmentId));if(c.roleName)row.roles.add(c.roleName)}return [...groups.values()].map(row=>({...row,invitations:planInvitations.value.filter(i=>String(i.recipient_member_id)===String(row.recipient)&&String(i.replaced_member_id)===String(row.replaced)).sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)||String(b.id).localeCompare(String(a.id)))}))})
function memberState(row){if(historyLoading.value)return 'Refreshing';if(historyError.value)return 'Unable to verify';if(!plan.value)return 'Not prepared';if(!row.invitations.length)return 'Invitation required';const state=effectiveInvitationStatus(row.invitations[0],clock.value);const matching=tracker.value.rows.filter(r=>[...row.activities].some(id=>r.key==='member:'+id+':'+row.replaced+':'+row.recipient));return state==='Accepted'&&matching.some(r=>!r.satisfied)?'Consent requires renewed review':state}
function deliveryLabel(invitation){const status=invitation.delivery_status;return ['Sending','UNKNOWN'].includes(status)?'Delivery unconfirmed (do not resend)':status==='Pending Delivery'?'Awaiting configured sender':status==='NO_CHAT'?'Account not linked':status==='FAILED'?'Notification failed':status || 'Not reported'}
const roomRequirements=computed(()=>{const rows=new Map();for(const c of summaryChanges.value.filter(c=>c.venueName!=null||c.facilityBookingId!=null))rows.set(String(c.segmentId),c);return [...rows.values()]})
function requirementTimes(change){if(plan.value)return proposedTimes(change);const original=props.data?.event_segments?.find(s=>String(s.id)===String(change.segmentId)) || {};return (selectedOption.value?.changes || []).filter(c=>String(c.segmentId)===String(change.segmentId)).reduce((t,c)=>({...t,...(c.starts_at?{starts_at:c.starts_at}:{}),...(c.ends_at?{ends_at:c.ends_at}:{})}),original)}
function linkedBooking(change){const id=plan.value?change.facilityBookingId:bookingSelections.value[String(change.segmentId)] || change.facilityBookingId;return bookingData.value.facility_bookings?.find(b=>String(b.id)===String(id))}
function roomEvidence(change){const times=requirementTimes(change),id=plan.value?change.facilityBookingId:bookingSelections.value[String(change.segmentId)] || change.facilityBookingId;return bookingEvidence(bookingData.value,id,eventClubId.value,times.starts_at,times.ends_at,props.eventId)}
function roomState(change){if(historyLoading.value)return 'Refreshing';if(historyError.value)return 'Unable to verify';return plan.value?tracker.value.rows.find(r=>r.key==='room:'+change.segmentId)?.status || 'Approval unverified':roomEvidence(change).status || 'Unverified'}
// Refresh only booking records: a full simulator reload would discard the selected proposal.
const freshBookings=ref(null),claimReceipts=ref({}),requestTokens=new Map()
let bookingReadVersion=0
const bookingData=computed(()=>({...props.data,facility_bookings:freshBookings.value ?? props.data?.facility_bookings ?? []}))
function bookingCovers(b,t){return Date.parse(b.booking_date+'T'+b.start_time+'+08:00')<=Date.parse(t.starts_at)&&Date.parse(b.booking_date+'T'+b.end_time+'+08:00')>=Date.parse(t.ends_at)}
// Step 1: capture the current event, saved plan/proposal and booking-read version.
// Step 2: read visible records for the proposed times AND persisted booking IDs.
// Step 3: accept results only while that context is still current. A late calendar
// read must never replace evidence for another recovery; errors remain unverified.
async function refreshBookingRecords(){if(bookingRefreshing.value||busy.value||!props.active)return;const changes=roomRequirements.value;if(!changes.length)return;const version=++bookingReadVersion,context=confirmationContext();bookingRefreshing.value=true;bookingRefreshError.value='';try{const rows=await readRecoveryBookings({clubId:eventClubId.value,ranges:changes.map(requirementTimes),ids:changes.map(c=>c.facilityBookingId).filter(Boolean).concat(Object.values(claimReceipts.value))});if(version===bookingReadVersion&&context===confirmationContext())freshBookings.value=rows}catch(e){if(version===bookingReadVersion)bookingRefreshError.value=e.message}finally{if(version===bookingReadVersion)bookingRefreshing.value=false}}
function confirmationContext(){return JSON.stringify([props.eventId,eventClubId.value,plan.value?.id,selectedOption.value?.id,summaryChanges.value,props.sessionVersion])}
watch(()=>confirmationContext(),()=>{++bookingReadVersion;bookingRefreshing.value=false;bookingRefreshError.value='';freshBookings.value=null;claimReceipts.value={};requestTokens.clear();if(props.active)void refreshBookingRecords()})
watch(()=>props.active,active=>{if(active)void refreshHistory()})
function proposedFacilityId(change){const matches=(props.data?.facilities || []).filter(f=>f.name===change.venueName);return matches.length===1?matches[0].id:undefined}
function requestTarget(change){const target=simulatorCalendarTarget({venue:change.venueName,facilityId:linkedBooking(change)?.facility_id ?? proposedFacilityId(change),...{start:requirementTimes(change).starts_at,end:requirementTimes(change).ends_at}},weekStartOf);const context=confirmationContext();let item=requestTokens.get(String(change.segmentId));if(!item||item.context!==context){item={token:crypto.randomUUID(),context,segmentId:change.segmentId};requestTokens.set(String(change.segmentId),item)}return {...target,query:{...target.query,simRecoveryToken:item.token}}}
async function receiveClaim(event){const receipt=event.detail,item=[...requestTokens.values()].find(i=>i.token===receipt?.token);if(!item||item.context!==confirmationContext()||String(receipt.clubId)!==String(eventClubId.value))return;claimReceipts.value={...claimReceipts.value,...Object.fromEntries((item.segmentIds || [item.segmentId]).map(id=>[String(id),receipt.bookingId]))};await refreshBookingRecords()}
function refreshOnReturn(){if(props.active&&document.visibilityState==='visible'&&!busy.value)void refreshHistory()}
onMounted(()=>{if(typeof window==='undefined')return;window.addEventListener(RECOVERY_BOOKING_EVENT,receiveClaim);window.addEventListener('focus',refreshOnReturn);document.addEventListener('visibilitychange',refreshOnReturn);if(props.active)void refreshBookingRecords()})
onUnmounted(()=>{++bookingReadVersion;if(typeof window==='undefined')return;window.removeEventListener(RECOVERY_BOOKING_EVENT,receiveClaim);window.removeEventListener('focus',refreshOnReturn);document.removeEventListener('visibilitychange',refreshOnReturn)})
function exactClaim(change){if(proposedFacilityId(change)==null)return null;const id=claimReceipts.value[String(change.segmentId)];return matchingBookings(change).find(b=>String(b.id)===String(id))}
async function chooseExactClaim(change){const booking=exactClaim(change);if(!booking)return;bookingSelections.value[String(change.segmentId)]=booking.id;await nextTick();if(plan.value)attachBooking(change)}
function pendingForClub(booking){return booking.status==='Pending Admin Sign-off'&&(booking.recovery_transfers || []).some(t=>String(t.claiming_club_id)===String(eventClubId.value)&&t.transfer_status==='Pending Admin Sign-off')}
function facilityStatus(change){if(bookingRefreshError.value||historyError.value||historyLoading.value||bookingRefreshing.value)return 'Unable to verify';const booking=linkedBooking(change);if(!booking)return change.facilityBookingId?'Unable to verify':'Booking not linked';const transfers=(booking.recovery_transfers || []).filter(t=>String(t.claiming_club_id)===String(eventClubId.value));if(transfers.length===1&&transfers[0].transfer_status==='Rejected'&&!['Officially Confirmed Booking','Pending Admin Sign-off'].includes(booking.status))return 'Rejected';if(!matchingBookings(change).some(b=>String(b.id)===String(booking.id)))return 'Unable to verify';if(booking.status==='Pending Admin Sign-off')return 'Pending approval';if(/reject/i.test(booking.status || ''))return 'Rejected';if(plan.value)return roomState(change)==='Approved'?'Approved':roomState(change)==='Pending Approval'?'Pending approval':'Unable to verify';return ['Booked','Officially Confirmed Booking'].includes(booking.status)?'Approved':'Unable to verify'}

// One card per room and time block: activities in the same room that overlap or run
// back to back share one booking request and one booking link. Each activity still
// gets its own server link underneath, so tracker rows and Apply checks are unchanged.
const roomBlocks=computed(()=>{
 const byVenue=new Map()
 for(const change of roomRequirements.value){const t=requirementTimes(change),venue=change.venueName || 'Recorded facility';if(!byVenue.has(venue))byVenue.set(venue,[]);byVenue.get(venue).push({change,start:Date.parse(t.starts_at),end:Date.parse(t.ends_at)})}
 const blocks=[]
 for(const [venue,items] of byVenue){items.sort((a,b)=>a.start-b.start);let block=null;for(const item of items){if(block&&item.start<=block.end){block.changes.push(item.change);block.end=Math.max(block.end,item.end)}else{block={venue,changes:[item.change],start:item.start,end:item.end};blocks.push(block)}}}
 return blocks.map(b=>({...b,key:b.venue+'|'+b.start,first:b.changes[0],activities:[...new Set(b.changes.map(c=>activityName(c.segmentId)))]}))
})
const blockClock=ms=>Number.isFinite(ms)?new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ms)):''
const blockSpan=block=>blockClock(block.start)+'–'+blockClock(block.end)
const singaporeIso=ms=>new Date(ms+8*3600000).toISOString().slice(0,19)+'+08:00'
function blockStatus(block){const all=block.changes.map(facilityStatus);if(all.every(s=>s==='Approved'))return 'Approved';for(const s of ['Rejected','Pending approval','Unable to verify'])if(all.includes(s))return s;return all[0]}
function blockBadge(status){return status==='Approved'?'bg-success-subtle text-success':status==='Rejected'?'bg-danger-subtle text-danger':['Booking not linked','Unable to verify'].includes(status)?'bg-light text-dark border':'bg-warning-subtle text-dark'}
// Bookings that cover every activity in the block
function blockBookings(block){const [first,...rest]=block.changes;return matchingBookings(first).filter(b=>rest.every(c=>matchingBookings(c).some(o=>String(o.id)===String(b.id))))}
function setBlockBooking(block,id){for(const c of block.changes)bookingSelections.value[String(c.segmentId)]=id}
// Link one booking to every activity in turn; each link bumps the plan revision
function attachBlock(block){
 const start={...plan.value},bookingId=bookingSelections.value[String(block.first.segmentId)]
 queueAction('Associate booking '+bookingId+' with '+block.activities.length+' '+(block.activities.length===1?'activity':'activities')+' at '+block.venue,async()=>{let current=start,result;for(const c of block.changes){result=await api.attachBooking(current,c.segmentId,bookingId,true);if(result?.version!=null)current={...current,version:result.version}}return result},'Calendar booking associated with every activity in this block. Approval is still checked separately.')
}
function blockRequestTarget(block){const change=block.first;const target=simulatorCalendarTarget({venue:block.venue,facilityId:linkedBooking(change)?.facility_id ?? proposedFacilityId(change),start:singaporeIso(block.start),end:singaporeIso(block.end)},weekStartOf);const context=confirmationContext();let item=requestTokens.get(block.key);if(!item||item.context!==context){item={token:crypto.randomUUID(),context,segmentId:change.segmentId,segmentIds:block.changes.map(c=>c.segmentId)};requestTokens.set(block.key,item)}return {...target,query:{...target.query,simRecoveryToken:item.token}}}
function blockClaim(block){const booking=exactClaim(block.first);return booking&&block.changes.every(c=>String(exactClaim(c)?.id)===String(booking.id))?booking:null}
async function chooseBlockClaim(block){const booking=blockClaim(block);if(!booking)return;setBlockBooking(block,booking.id);await nextTick();if(plan.value)attachBlock(block)}

const outstandingChecks=computed(()=>plan.value?[...(plan.value.blockers || []),...tracker.value.rows.filter(r=>r.key!=='review'&&!r.satisfied).map(r=>r.activity+': '+r.status),...readiness.value.reasons]:[])
// Application is a recorded status, not another satisfied prerequisite. Do not
// include this informational row in the tracker's readiness or requirement count.
const statusRows=computed(()=>!plan.value?[]:[...tracker.value.rows,{key:'application',kind:'Application',activity:'Entire recovery',change:plan.value.title,status:plan.value.application_status,nextAction:journey.value[3].status,updated:plan.value.applied_at || plan.value.updated_at || null}])

const recoveryHistory=ref(null)
async function viewRecoveryHistory(){await nextTick();if(recoveryHistory.value){recoveryHistory.value.open=true;recoveryHistory.value.scrollIntoView({block:'nearest'});recoveryHistory.value.querySelector('summary')?.focus()}}
const selectedAudit=computed(()=>history.value.audit.filter(entry=>String(entry.plan_id)===String(plan.value?.id)))
const undoDisabledReason=computed(()=>historyLoading.value?'Refreshing recovery status.':historyError.value?'Refresh recovery status before Undo.':!applicationEnabled.value?'Undo is unavailable for this account or backend capability.':!manualAcknowledged.value?'Complete Organiser review before Undo.':!undoStatus.value.ready?undoStatus.value.reason:busy.value?'Another recovery action is running.':'')
// Explain only fields restored by the existing RPC. Snapshot differences, rather
// than proposal counts, also include timing changes and exact booking-link IDs.
const appliedDifferences=computed(()=>{
 const before=plan.value?.before_state,after=plan.value?.after_state;if(!before||!after)return []
 const rows=[]
 for(const a of after.assignments||[]){const b=before.assignments?.find(b=>String(b.id)===String(a.id));if(b&&String(a.member_id)!==String(b.member_id))rows.push({kind:'Member assignment',before:memberName(b.member_id),after:memberName(a.member_id),activity:activityName(a.segment_id)})}
 for(const a of after.segments||[]){const b=before.segments?.find(b=>String(b.id)===String(a.id));if(b&&(a.starts_at!==b.starts_at||a.ends_at!==b.ends_at))rows.push({kind:'Activity schedule',activity:activityName(a.id),before:localTime(b.starts_at)+' to '+localTime(b.ends_at),after:localTime(a.starts_at)+' to '+localTime(a.ends_at)})}
 if(before.event&&after.event&&(before.event.starts_at!==after.event.starts_at||before.event.ends_at!==after.event.ends_at))rows.push({kind:'Event schedule',activity:'Entire event',before:localTime(before.event.starts_at)+' to '+localTime(before.event.ends_at),after:localTime(after.event.starts_at)+' to '+localTime(after.event.ends_at)})
 const segments=new Set([...(before.links||[]),...(after.links||[])].map(l=>String(l.segment_id)))
 for(const id of segments){const ids=state=>(state.links||[]).filter(l=>String(l.segment_id)===id).map(l=>String(l.booking_id)).sort().join(', ');if(ids(before)!==ids(after))rows.push({kind:'Facility booking link',activity:activityName(id),before:ids(before)?'Booking '+ids(before):'No booking link',after:ids(after)?'Booking '+ids(after):'No booking link'})}
 return rows
})

// Pip (the guided chat) drives this same workflow instead of a copy of it: it reads
// pipState and calls pipAct. Every write still goes through queueAction/executePending,
// so the confirmation key, idempotent Start and server gates above all still apply.
// Pip's own button press is the user's confirmation, and its Apply button is the organiser review.
// Ready apart from the organiser review, which Pip's Apply button records when pressed
const pipApplyReady=computed(()=>{void clock.value;return !historyLoading.value&&!historyError.value&&
 workflowReadiness({enabled:applicationEnabled.value,plan:plan.value,invites:history.value.invitations,manualAcknowledged:true}).ready&&
 buildRecoveryTracker({plan:plan.value,invitations:history.value.invitations,audit:history.value.audit,manualAcknowledged:true,enabled:applicationEnabled.value,data:props.data,now:clock.value}).status==='Ready to apply'})
const pipState=computed(()=>({
 notice:recoveryNotice.value,canRequest:invitationEnabled.value,canApply:applicationEnabled.value,
 busy:busy.value,busyAction:busyAction.value,error:error.value,message:message.value,loading:historyLoading.value,
 planId:plan.value?.id || '',planTitle:plan.value?.title || '',applied:plan.value?.application_status || '',
 members:memberRequirements.value.map(row=>({key:row.key,recipient:row.recipient,replaced:row.replaced,count:row.activities.size,
  state:memberState(row),delivery:row.invitations[0]?deliveryLabel(row.invitations[0]):''})),
 rooms:roomBlocks.value.map(b=>({key:b.key,venue:b.venue,span:blockSpan(b),status:blockStatus(b),hasClaim:!!blockClaim(b),linked:!!b.first.facilityBookingId})),
 applyReady:pipApplyReady.value,outstanding:outstandingChecks.value,
 unresolved:plan.value?.application_status==='Applied'?disruptionResolutions.value.filter(r=>!r.resolved).map(r=>({index:r.index,type:r.disruption.type,memberId:r.disruption.memberId,venueName:r.disruption.venueName})):[],
 undoReady:applicationEnabled.value&&!busy.value&&!historyLoading.value&&!historyError.value&&undoStatus.value.ready,undoReason:undoStatus.value.reason || '',
 saved:history.value.plans.map(p=>({id:p.id,title:p.title,application_status:p.application_status,lifecycle:p.lifecycle,status:savedTracker(p).status,updated:p.updated_at}))
}))
async function pipAct(name,arg){
 if(name==='refresh')return refreshHistory()
 if(name==='open-saved'){selectedPlanId.value=arg;return}
 if(name==='room-target'){const block=roomBlocks.value.find(b=>b.key===arg);return block?blockRequestTarget(block):null}
 if(name==='start')startPlan()
 else if(name==='invite'){const row=memberRequirements.value.find(r=>r.key===arg);if(row)invite(row)}
 else if(name==='link-room'){const block=roomBlocks.value.find(b=>b.key===arg);if(block)await chooseBlockClaim(block)}
 else if(name==='apply'){manualAcknowledged.value=true;applyPlan()}
 else if(name==='undo'){manualAcknowledged.value=true;undoPlan()}
 else if(name==='cancel')cancelPlan()
 // The organiser confirmed in Pip that the person/room is back; Undo still re-checks on the server
 else if(name==='resolve'){const row=disruptionResolutions.value.find(r=>r.index===arg);if(row){manualAcknowledged.value=true;resolutionReasons.value[row.index]='Organiser confirmed in Pip that this disruption is over.';resolveDisruption(row)}}
 if(pendingAction.value){confirmed.value=true;await executePending()}
}
defineExpose({pipState,pipAct})

</script>

<template>
 <section id="simulator-recovery-workflow" tabindex="-1" class="pulse-card recovery-action-centre p-3 p-lg-4 shadow-sm mt-4 mb-4" aria-label="Persisted recovery workflow" :data-selected-recovery="selectedOptionId">
  <header class="action-centre-heading"><div><span class="text-uppercase fw-bold text-primary small step-eyebrow">Step 4 &middot; Make it happen</span><h5 class="fw-bold mb-1">Recovery Workflow</h5><p class="small text-muted mb-0">Act on required checks. Invitations and bookings can proceed in parallel.</p></div><span class="badge bg-light text-dark border">{{ plan ? tracker.status : 'Draft' }}</span></header>
  <div v-if="error" class="alert alert-danger small mt-3" role="alert">{{ error }}</div><p v-if="message" class="small action-feedback mt-3" role="status">{{ message }}</p><p v-if="busy" class="small mt-3" role="status">Running {{ busyAction }}; waiting for the server and refresh.</p><p v-if="refreshWarning" class="small text-warning" role="status">{{ refreshWarning }}</p><p v-if="invitationError" class="small text-warning" role="status">{{ invitationError }}</p>
  <label v-if="selectedRecoveryId===null" for="persisted-option" class="small fw-bold mt-3">Recovery option to preview</label><select v-if="selectedRecoveryId===null" id="persisted-option" v-model="selectedOptionId" :disabled="busy" class="form-select form-select-sm mb-3"><option value="">Select an option</option><option v-for="option in options" :key="option.id" :value="option.id">{{ option.title }}</option></select>
    <section v-if="selectedOption || plan" class="selected-recovery-summary small my-3" aria-label="Selected Recovery"><div class="d-flex justify-content-between gap-2"><h6 class="fw-bold">Selected Recovery</h6><span class="badge align-self-start" :class="plan && ['Applied','Undone'].includes(plan.application_status)?'bg-light text-dark border':'bg-warning-subtle text-dark'">{{ plan && ['Applied','Undone'].includes(plan.application_status)?displayStatus(plan):plan && tracker.requirementsReady?'Ready for final review':'Verification needed' }}</span></div><div class="proposal-summary"><strong>{{ plan?.title || selectedOption?.title }}</strong><p class="my-2">{{ summaryCounts.activities }} affected {{ summaryCounts.activities===1?'activity':'activities' }} &middot; {{ summaryCounts.assignments }} member {{ summaryCounts.assignments===1?'replacement':'replacements' }} &middot; {{ summaryCounts.rooms }} facility {{ summaryCounts.rooms===1?'change':'changes' }}</p><details><summary>View proposed activity changes</summary><div v-for="(group,i) in summaryGroups" :key="i" class="py-2"><span v-if="group.replacementMemberId!=null">{{ memberName(group.replacedMemberId) }} to {{ memberName(group.replacementMemberId) }} ({{ group.roleName || 'role requires verification' }})</span><span v-if="group.venueName">{{ group.venueName }}</span><span v-if="group.starts_at || group.ends_at"> {{ localTime(group.starts_at) }} to {{ localTime(group.ends_at) }}</span><details><summary>{{ group.activities.length }} affected {{ group.activities.length===1?'activity':'activities' }}</summary><ul><li v-for="activity in group.activities" :key="activity.id">{{ activity.title }}</li></ul></details></div></details></div></section>

  <p v-if="!hasSelection" class="small text-muted my-3">Choose a plan in Step 3 to start the recovery steps. Saved recoveries are below.</p>
  <!-- Stages only appear once there is a plan to act on. -->
  <template v-if="hasSelection">
  <div class="stage-guide small" aria-label="Stage Status Guide"><span class="complete">Complete</span><span class="pending">Needs action</span><span class="blocked">Blocked</span><span class="unavailable">Not started</span><span v-if="manualAcknowledged" class="information">Local acknowledgement</span></div>
  <nav class="recovery-journey" aria-label="Recovery stages" role="tablist"><button v-for="(stage,i) in visibleJourney" :id="'recovery-tab-'+i" :key="stage.title" type="button" role="tab" class="stage-card" :class="[stageTone(stage),{'is-active':activeStage===stage.title}]" :data-status-tone="stageTone(stage)" :aria-selected="activeStage===stage.title" aria-controls="recovery-stage-panel" :tabindex="activeStage===stage.title?0:-1" @click="selectStage(i)" @keydown.right.prevent="selectStage(i+1,true)" @keydown.left.prevent="selectStage(i-1,true)" @keydown.home.prevent="selectStage(0,true)" @keydown.end.prevent="selectStage(visibleJourney.length-1,true)"><small class="stage-eyebrow">Stage {{ i+1 }}</small><strong>{{ stage.title }}</strong><span class="stage-status">{{ stage.status }}</span></button></nav>
  <section id="recovery-stage-panel" class="recovery-stage-panel" role="tabpanel" :aria-labelledby="'recovery-tab-'+activeStageIndex" tabindex="0"><div v-if="activeStage!=='Facility approval'" class="stage-panel-heading"><h6>{{ currentStage.title }}</h6><span class="stage-status" :class="stageTone(currentStage)">{{ currentStage.status }}</span></div>
   <template v-if="activeStage==='Member acceptance'">
    <p class="stage-description">Prepare replacement invitations and track each response.</p><p v-if="hasSelection && !memberRequirements.length" class="small text-muted">Member acceptance is not required for this proposal.</p>
    <article v-for="row in memberRequirements" :key="row.key" class="stage-record" :aria-label="'Replacement invitation for '+memberName(row.recipient)"><div class="stage-record-heading"><strong>{{ memberName(row.recipient) }}<template v-if="row.roles.size"> &middot; {{ [...row.roles].join(', ') }}</template></strong><span class="badge bg-light text-dark border">{{ memberState(row) }}</span></div><p>{{ row.activities.size }} affected {{ row.activities.size===1?'activity':'activities' }} &middot; Replaces {{ memberName(row.replaced) }}</p><template v-if="row.invitations.length"><p>Telegram: {{ deliveryLabel(row.invitations[0]) }}. Delivery is not acceptance.</p><dl class="invitation-times"><template v-if="row.invitations[0].created_at"><dt>Created</dt><dd>{{ localTime(row.invitations[0].created_at) }}</dd></template><template v-if="row.invitations[0].responded_at"><dt>Response recorded</dt><dd>{{ localTime(row.invitations[0].responded_at) }}</dd></template></dl><p v-if="!row.invitations[0].created_at && !row.invitations[0].responded_at" class="text-muted">Timestamps not supplied.</p></template>
     <button v-if="plan" type="button" class="btn btn-pulse-primary btn-sm" :disabled="!invitationEnabled || busy || !!historyError || historyLoading || requestExists(row) || plan.application_status!=='Draft'" @click="invite(row)">Send replacement request</button>
     <details v-if="row.invitations.length" class="stage-evidence"><summary>Invitation evidence and actions</summary><div v-for="invitation in row.invitations" :key="invitation.id" class="py-2"><strong>{{ effectiveInvitationStatus(invitation,clock) }}</strong> &middot; Telegram: {{ deliveryLabel(invitation) }}<p>Created: {{ invitation.created_at?localTime(invitation.created_at):'Not supplied' }} &middot; Response recorded: {{ invitation.responded_at?localTime(invitation.responded_at):'Not supplied' }}. Delivery time is not supplied by this view.</p><button type="button" class="btn btn-outline-danger btn-sm" :disabled="!invitationEnabled || busy || !['Pending','Accepted'].includes(invitation.status)" @click="cancel(invitation.id)">Cancel invitation</button></div></details>
    </article>
    <div v-if="!plan && memberRequirements.length" class="workflow-actions"><button type="button" class="btn workflow-secondary-action" :disabled="!invitationEnabled || busy || !preview.draft" @click="startPlan">Prepare recovery requests</button></div>
    <p v-if="memberRequirements.length" class="stage-description">Preparation saves the proposal and creates pending invitations. Telegram uses the configured worker; refresh to check delivery.</p><p v-if="incoming" class="small">Your invitation is in <RouterLink to="/personal-schedule#simulator-invitation-inbox">Personal Schedule &mdash; My replacement invitations</RouterLink>. Accepting assigns you straight away.</p><p v-if="memberRequirements.length" class="small text-muted">Once every replacement accepts, the plan is applied automatically. No organiser approval is needed.</p>
   </template>
   <template v-else-if="activeStage==='Facility approval'">
    <article v-for="block in roomBlocks" :key="block.key" class="facility-approval-card" :aria-label="'Booking requirement for '+block.venue+' '+blockSpan(block)"><div class="stage-record-heading"><h6 class="fw-bold mb-0">Facility approval</h6><span class="badge" :class="blockBadge(blockStatus(block))">{{ blockStatus(block) }}</span></div><div class="facility-identity"><span aria-hidden="true"><svg width="20" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 21h18M6 21V5l6-2v18M12 8h6v13M9 8v2m0 3v2m6-3v2m0 3v2"/></svg></span><div><strong>{{ linkedBooking(block.first)?roomEvidence(block.first).facilityName:block.venue }} &middot; {{ blockSpan(block) }}</strong><p>{{ block.activities.join(', ') }}</p></div></div><template v-if="linkedBooking(block.first)"><div class="facility-booking-status"><strong>{{ blockStatus(block)==='Approved'?'Booking approved':blockStatus(block)==='Pending approval'?'Waiting for facility approval':blockStatus(block)==='Rejected'?'Booking rejected':'Booking status needs verification' }}</strong><p>Booking {{ linkedBooking(block.first).id }} &middot; {{ linkedBooking(block.first).booking_date }} &middot; {{ linkedBooking(block.first).start_time }}&ndash;{{ linkedBooking(block.first).end_time }}</p><div class="d-flex justify-content-between"><span>Booking link</span><span class="badge bg-success-subtle text-success">{{ plan?'Linked':'Selected for preview' }}</span></div></div><details class="stage-evidence booking-view"><summary>View booking details</summary><p>{{ linkedBooking(block.first).status }} &middot; {{ roomState(block.first) }}</p><p>{{ roomEvidence(block.first).reasons?.join(' ') }}</p><p>Approval does not complete other recovery checks.</p></details></template><template v-else><strong>Ready to request a room?</strong><p class="small text-muted mt-2">One booking for {{ block.venue }}, {{ blockSpan(block) }}, covers {{ block.activities.length===1?'this activity':'all '+block.activities.length+' activities' }}.</p><RouterLink :to="blockRequestTarget(block)" class="btn btn-pulse-primary facility-request">Request {{ block.venue }}, {{ blockSpan(block) }}</RouterLink></template><div v-if="blockClaim(block) && !block.first.facilityBookingId" class="facility-booking-status"><strong>Booking {{ blockClaim(block).id }} returned by the calendar</strong><p>{{ blockClaim(block).status }}. Approval is checked separately.</p><button type="button" class="btn btn-pulse-primary btn-sm" :disabled="busy || bookingRefreshing || !!bookingRefreshError || (plan && (!invitationEnabled || plan.application_status!=='Draft'))" @click="chooseBlockClaim(block)">{{ plan?'Confirm booking link':'Use booking in preview' }}</button></div><details class="stage-evidence"><summary>Already have a booking? Link it</summary><p>Choose your CCA's booking for this room that covers {{ blockSpan(block) }}. Pending bookings still need approval.</p><label :for="(plan?'attach-':'booking-')+block.key">Booking to link</label><select :id="(plan?'attach-':'booking-')+block.key" :value="bookingSelections[String(block.first.segmentId)] || ''" @change="setBlockBooking(block,$event.target.value)" class="form-select form-select-sm"><option value="">Select a booking</option><option v-for="booking in blockBookings(block)" :key="booking.id" :value="booking.id">Booking {{ booking.id }} | {{ booking.booking_date }} {{ booking.start_time }}&ndash;{{ booking.end_time }} | {{ booking.status }}</option></select><p v-if="!blockBookings(block).length" class="small text-muted mt-1 mb-0">No booking of yours covers this whole time yet.</p><button v-if="plan" type="button" class="btn btn-pulse-primary btn-sm mt-2" :disabled="!invitationEnabled || busy || historyLoading || !!historyError || bookingRefreshing || !!bookingRefreshError || plan.application_status!=='Draft' || !bookingSelections[String(block.first.segmentId)]" @click="attachBlock(block)">Link booking</button></details></article><div class="workflow-actions"><button v-if="!plan && roomRequirements.length" type="button" class="btn workflow-secondary-action" :disabled="!invitationEnabled || busy || !preview.draft" @click="startPlan">Prepare recovery requests</button><button type="button" class="btn workflow-secondary-action" :disabled="bookingRefreshing || busy" @click="refreshHistory">{{ bookingRefreshing?'Refreshing bookings...':'Refresh booking records' }}</button></div><p v-if="bookingRefreshError" class="small text-warning" role="status">Unable to refresh bookings: {{ bookingRefreshError }}. Previous records may be stale.</p>

   </template>
   <template v-else-if="activeStage==='Organiser review'">
    <p id="organiser-review" class="stage-description">Review proposed changes and outstanding requirements. Acknowledgement stays in this session; no separate organiser approval is saved.</p><ul v-if="outstandingChecks.length" class="outstanding-checks"><li v-for="reason in [...new Set(outstandingChecks)]" :key="reason">{{ reason }}</li></ul><p v-else-if="plan" class="small">No outstanding member or booking checks are reported. Review personal availability and suitability before acknowledging.</p>
    <details v-if="hasSelection" class="stage-evidence"><summary>Review proposed activity changes</summary><div v-for="(group,i) in summaryGroups" :key="i" class="py-2"><strong>{{ group.activities.map(a=>a.title).join(', ') }}</strong><p v-if="group.replacementMemberId!=null">{{ memberName(group.replacedMemberId) }} &rarr; {{ memberName(group.replacementMemberId) }}</p><p v-if="group.venueName">{{ group.venueName }}</p><p v-if="group.starts_at || group.ends_at">{{ localTime(group.starts_at) }} to {{ localTime(group.ends_at) }}</p></div></details>
    <label v-if="plan" class="acknowledgement-row"><input v-model="manualAcknowledged" type="checkbox" :disabled="busy || historyLoading || !!historyError || !(plan.application_status==='Applied' || tracker.requirementsReady)"> I manually checked personal availability, qualifications and facility suitability; incomplete data is not proof of availability.</label><p v-if="plan && !tracker.requirementsReady && plan.application_status!=='Applied'" class="small text-muted">Complete the recorded member and facility requirements before acknowledging.</p><p class="small">{{ manualAcknowledged?'Checked':'Not checked yet' }}. This tick is only for this session and isn't saved.</p><div v-if="!plan && hasSelection" class="workflow-actions"><button type="button" class="btn workflow-secondary-action" :disabled="!invitationEnabled || busy || !preview.draft" @click="startPlan">Prepare recovery requests</button></div>
   </template>
   <template v-else>
    <p id="recovery-application" class="stage-description">Apply and Undo use the saved recovery and are revalidated by the server.</p><p v-if="!plan" class="small text-muted">Prepare recovery requests before applying this proposal.</p><div v-if="plan?.blockers?.length" class="small"><p v-for="blocker in plan.blockers" :key="blocker">{{ blocker }}</p></div><ul v-if="plan?.application_status==='Draft' && readiness.reasons.length" class="outstanding-checks"><li v-for="reason in readiness.reasons" :key="reason">{{ reason.replace(/replacement member (\d+)/g,(_,id)=>'replacement '+memberName(id)).replace(/activity (\d+)/g,(_,id)=>activityName(id)) }}</li></ul>
    <button v-if="!plan || plan.application_status==='Draft'" type="button" class="btn btn-pulse-primary action-centre-primary" :disabled="!plan || busy || !applyReady" @click="applyPlan">Apply selected recovery</button><p v-if="plan?.application_status==='Draft' && !manualAcknowledged" class="small text-muted mt-2">Complete Organiser review before Apply.</p>
    <section v-if="plan?.application_status==='Applied'" class="applied-recovery" aria-label="Applied recovery"><div class="d-flex justify-content-between gap-2"><strong>{{ plan.title }}</strong><span class="badge bg-success-subtle text-success">Applied</span></div><p class="small mt-3">Recovery applied. Recorded event changes:</p><ul class="small"><li v-for="kind in [...new Set(appliedDifferences.map(row=>row.kind))]" :key="kind">{{ appliedDifferences.filter(row=>row.kind===kind).length }} {{ kind.toLowerCase() }} {{ appliedDifferences.filter(row=>row.kind===kind).length===1?'changed':'changes' }}</li></ul><p v-if="!plan.after_state" class="small text-muted">Applied snapshot unavailable. Exact changes cannot be verified.</p><div class="workflow-actions"><button type="button" class="btn btn-outline-danger btn-sm" :disabled="!!undoDisabledReason" aria-describedby="undo-eligibility" @click="undoPlan">Undo Recovery Plan</button><button type="button" class="btn workflow-secondary-action" @click="viewRecoveryHistory">View history</button></div><p id="undo-eligibility" class="small text-muted">{{ undoDisabledReason || undoStatus.reason }}</p><p class="small text-muted">Bookings, approvals, member responses and Telegram invitations are not automatically reversed.</p></section><section v-if="plan?.application_status==='Undone'" class="applied-recovery" aria-label="Undone recovery"><div class="d-flex justify-content-between"><strong>{{ plan.title }}</strong><span class="badge bg-secondary-subtle text-dark">Undone</span></div><p class="small mt-2">Recovery undo completed. Audit history is retained.</p><button type="button" class="btn workflow-secondary-action" @click="viewRecoveryHistory">View recovery history</button></section><p v-if="plan?.application_status==='Cancelled'" class="small">Recovery cancelled. Event records are unchanged.</p>
    <div v-if="plan && disruptionResolutions.length" class="border rounded p-2 my-3 small" aria-label="Recorded disruption resolution">
      <strong>Disruption resolution tracker</strong>
      <p>Verify the original resource, then record evidence. Resolution retains history and does not bypass Undo validation.</p>
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

    <details v-if="plan?.application_status==='Draft'" class="stage-evidence"><summary>Other recovery actions</summary><button type="button" class="btn btn-outline-danger btn-sm" :disabled="!invitationEnabled || busy" @click="cancelPlan">Cancel Recovery Plan</button></details>
   </template>
  </section>
  </template>
  <p v-if="selectedOption && !plan && preview.error" class="small text-warning mt-2">{{ preview.error }}</p><p v-if="simulationAccessDenied()" class="workflow-permission small" role="alert">Permission required: Your account cannot prepare recovery requests for this club. Contact an authorised club manager.</p><div v-else-if="recoveryNotice" class="workflow-availability small" role="status"><strong>{{ historyError?'Recovery status unavailable':'Recovery availability' }}</strong><p>{{ recoveryNotice }}</p></div>
  <details id="simulator-saved-recoveries" class="saved-status-disclosure mt-3">
   <summary>Saved Recoveries &amp; status <span>{{ history.plans.length }} saved<span v-if="savedStatusCounts.pending"> &middot; {{ savedStatusCounts.pending }} pending</span><span v-if="savedStatusCounts.blocked"> &middot; {{ savedStatusCounts.blocked }} blocked or expired</span><span v-if="historyLoading"> &middot; Refreshing</span><span v-if="historyError"> &middot; Status unavailable</span></span></summary>
  <section id="recovery-requirements" class="recovery-requirements status-tracker mt-3" aria-label="Pending recovery requirements"><div class="stage-panel-heading"><h6>Recovery Status Tracker</h6><button type="button" class="btn workflow-secondary-action" :disabled="historyLoading || busy" @click="refreshHistory">{{ historyLoading?'Refreshing statuses...':'Refresh statuses' }}</button></div><p v-if="!plan" class="small text-muted mb-0">Prepare a recovery or inspect a saved plan to track persisted requirements.</p><template v-else><p class="small">{{ tracker.status }} &middot; {{ tracker.satisfied }} of {{ tracker.total }} requirements satisfied.</p><p class="small text-muted">{{ tracker.nextAction }}</p><div class="table-responsive" tabindex="0" role="region" aria-label="Scrollable recovery requirements"><table class="table table-sm small align-middle"><thead><tr><th scope="col">Proposed change</th><th scope="col">Affected activity</th><th scope="col">Requirement</th><th scope="col">Current status</th><th scope="col">Next action</th><th scope="col">Timestamp evidence</th></tr></thead><tbody><tr v-for="row in statusRows" :key="row.key"><td>{{ row.change }}</td><td>{{ row.activity }}</td><td>{{ row.key==='review'?'Organiser review (local)':row.kind }}</td><td>{{ row.key==='review'?(manualAcknowledged?'Acknowledged locally':'Local review required'):row.status }}<div v-if="row.delivery">Delivery: {{ row.delivery }}. Delivery is not acceptance.</div></td><td>{{ row.nextAction }}</td><td>{{ requirementTime(row) }}</td></tr></tbody></table></div></template></section>
    <section class="my-4" aria-label="Saved Recoveries">
      <h6 class="fw-bold">Saved Recoveries</h6>
      <p v-if="history.plans.length" class="small text-muted">Review a saved proposal or refresh its recorded status.</p>
      <p v-if="!historyLoading && !historyError && !history.plans.length" class="small">No saved recoveries are available for this event.</p>
      <div v-if="history.plans.length" class="d-flex flex-wrap gap-2 my-2" role="group" aria-label="Saved recovery views"><button v-for="view in ['All','Pending','Ready to Apply','Applied','Other']" :key="view" type="button" class="btn btn-outline-secondary btn-sm" :aria-pressed="savedFilter===view" @click="savedFilter=view">{{ view }}</button></div>
      <p v-if="history.plans.length && !visibleSaved.length" class="small text-muted">No recoveries in this view.</p>
      <p v-if="visibleSaved.length" class="small text-muted recovery-scroll-hint">Scroll horizontally to view additional columns.</p><div class="table-responsive" v-if="visibleSaved.length" tabindex="0" role="region" aria-label="Scrollable saved recoveries"><table class="table table-sm align-middle small">
       <thead><tr><th scope="col">Recovery proposal</th><th scope="col">Status</th><th scope="col">Next action</th><th scope="col">Review</th></tr></thead>
       <tbody><tr v-for="item in visibleSaved" :key="item.id" :class="{'table-active':selectedPlanId===item.id}"><td>{{ item.title }}</td><td>{{ savedTracker(item).requirementsReady ? 'Ready for final review' : savedTracker(item).status }}</td><td>{{ savedTracker(item).nextAction }}</td><td><button type="button" class="btn btn-outline-secondary btn-sm" :disabled="busy" :aria-pressed="selectedPlanId===item.id" :data-saved-plan-id="item.id" @click="selectedPlanId=item.id">Review saved recovery</button><button v-if="item.application_status==='Applied'" type="button" class="btn workflow-secondary-action mt-1" :disabled="busy" @click="selectedPlanId=item.id;activeStage='Apply / Undo'">Review Undo</button></td></tr></tbody>
      </table></div>
    </section>

  </details>
    <details v-if="plan" ref="recoveryHistory" class="small my-3" aria-label="Recovery change history"><summary>Recovery change history</summary><p class="mt-2">{{ plan.title }} &middot; {{ plan.application_status }} &middot; Revision {{ plan.version }}</p><ul><li v-for="(row,i) in appliedDifferences" :key="i">{{ row.activity }} &middot; {{ row.kind }}: {{ row.before }} &rarr; {{ row.after }}</li></ul><p v-if="!selectedAudit.length">No audit entries are available in accessible records.</p><div v-for="entry in selectedAudit" :key="entry.id" class="border-top py-2">{{ entry.action }} &middot; {{ entry.outcome }}<span v-if="entry.created_at"> &middot; {{ localTime(entry.created_at) }}</span></div></details>
    <details class="small mt-4 recovery-support"><summary>Support diagnostics and audit history</summary>
    <details v-if="preview.draft && !plan" class="small my-2"><summary>Exact original and proposed records (local preview)</summary><div class="table-responsive"><table class="table table-sm"><tbody><tr v-for="(row,i) in recordFields({before:preview.draft.expectedState,after:preview.after})" :key="i"><th>{{ row.field }}</th><td>{{ row.value }}</td></tr></tbody></table></div></details>
    <details v-if="plan?.after_state" class="small"><summary>Undo preview: recorded applied state to original state</summary><div class="table-responsive"><table class="table table-sm"><tbody><tr v-for="(row,i) in recordFields({from:plan.after_state,to:plan.before_state})" :key="i"><th>{{ row.field }}</th><td>{{ row.value }}</td></tr></tbody></table></div></details>
      <p>Backend application gate: {{ capabilities?.application_enabled ?? 'unverified' }}. Invitation gate: {{ capabilities?.invitations_enabled ?? 'unverified' }}.</p>
      <p>{{ capabilityError }}</p>
      <p>Event {{ eventId }} | Club {{ eventClubId }} | Plan {{ plan?.id || 'not selected' }} | Revision {{ plan?.version }}</p>
    <details class="small mt-3"><summary>Technical audit history</summary><div v-for="entry in history.audit" :key="entry.id" class="small text-muted">{{ entry.created_at }} | {{ entry.action }} | {{ entry.outcome }} | {{ entry.details }}</div></details></details>
    <div v-if="pendingAction" class="recovery-dialog-backdrop" @keydown.esc="pendingAction=null;confirmed=false">
    <div ref="actionDialog" tabindex="-1" role="dialog" aria-label="Action confirmation" aria-modal="true" aria-describedby="recovery-confirm-title" class="pulse-card p-4 recovery-dialog" @keydown.tab="trapConfirmationFocus">
      <strong id="recovery-confirm-title">{{ pendingAction.label==='Undo Recovery Plan'?'Undo applied recovery?':'Confirm selected action: '+pendingAction.label }}</strong><section v-if="pendingAction.label==='Undo Recovery Plan'" aria-label="Proposed reversal" class="undo-reversal small my-3"><p>Restore recorded event changes, subject to server validation:</p><ul><li v-for="(row,i) in appliedDifferences" :key="i"><strong>{{ row.activity }} &middot; {{ row.kind }}</strong><br>{{ row.after }} &rarr; {{ row.before }}</li></ul><p v-if="!appliedDifferences.length">Exact snapshot changes are unavailable. The server must validate the saved records.</p><p>Not automatically reversed: Telegram messages and invitations, member responses, facility bookings or approvals. Booking links are restored; bookings are not cancelled.</p></section>
      <p class="small mt-2">{{ plan?.title || selectedOption?.title }}. This action will be checked by the server before it is saved.</p>
      <label><input v-model="confirmed" type="checkbox"> I confirm this selected action and its reviewed inputs.</label>
      <button type="button" :class="['btn btn-sm ms-2',pendingAction.label==='Undo Recovery Plan'?'btn-danger':'btn-pulse-primary']" aria-label="Confirm selected action" :disabled="!(pendingAction.settings.application ? applicationEnabled : invitationEnabled) || busy || !confirmed" @click="executePending">{{ pendingAction.label==='Undo Recovery Plan'?'Confirm Undo':'Confirm selected action' }}</button>
      <button type="button" class="btn btn-outline-secondary btn-sm ms-2" :disabled="busy" aria-label="Dismiss action" @click="pendingAction=null;confirmed=false">{{ pendingAction.label==='Undo Recovery Plan'?'Cancel':'Dismiss action' }}</button>
    </div></div>


 </section>
</template>
<style scoped>
.recovery-dialog-backdrop{position:fixed;inset:0;z-index:1090;background:#0008;display:flex;align-items:center;justify-content:center;padding:1rem}
.recovery-dialog{width:min(100%,36rem);max-height:90vh;overflow:auto;background:#fff;opacity:1}.recovery-dialog-backdrop :deep(.pulse-card){background:#fff}:global(body:has(.recovery-dialog) .back-to-top){visibility:hidden}.recovery-dialog button{margin-top:.75rem}
.recovery-requirements table{min-width:42rem}.table th{white-space:nowrap}.table td{max-width:20rem;overflow-wrap:anywhere}
.recovery-support{color:var(--pulse-ink-muted);font-size:.75rem}
.table-responsive:focus-visible{outline:2px solid var(--pulse-primary);outline-offset:2px}.recovery-scroll-hint{display:none}@media(max-width:1100px){.recovery-scroll-hint{display:block}}
.recovery-journey{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:1rem 0}.recovery-journey a{display:flex;flex-direction:column;align-items:start;gap:.45rem;border:1px solid var(--pulse-border);background:var(--pulse-bg);padding:1rem;border-radius:.85rem;text-decoration:none;color:var(--pulse-ink)}.recovery-journey small{font-size:.72rem;color:var(--pulse-ink-muted)}.stage-status{font-size:.75rem;font-weight:650}.recovery-journey a:focus-visible{outline:2px solid var(--pulse-primary)}@media(max-width:1023px){.recovery-journey{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:575px){.recovery-journey{grid-template-columns:1fr}}
.stage-guide{display:flex;flex-wrap:wrap;gap:.5rem 1rem;margin-top:1rem}.stage-guide span:before{content:'';display:inline-block;width:.6rem;height:.6rem;border-radius:50%;background:var(--stage-color);margin-right:.3rem}.complete{--stage-color:#2b8064;--stage-bg:#edf8f2}.pending{--stage-color:#9d700d;--stage-bg:#fff8e7}.blocked{--stage-color:#c53d57;--stage-bg:#fff0f3}.unavailable{--stage-color:#687484;--stage-bg:#f5f6f8}.information{--stage-color:#2374a6;--stage-bg:#edf6fc}.stage-card{display:flex;flex-direction:column;align-items:start;gap:.45rem;text-align:left;border:1px solid var(--pulse-border);border-top:3px solid var(--stage-color);border-radius:.85rem;padding:1rem;background:var(--stage-bg);color:var(--pulse-ink)}
.selected-recovery-summary{border-top:1px solid var(--pulse-border);border-bottom:1px solid var(--pulse-border);padding:1rem 0}.proposal-summary{background:var(--pulse-bg);padding:.9rem;border-radius:.75rem}.proposal-summary summary{cursor:pointer;font-weight:600}.booking-attention p{color:var(--pulse-ink-muted)}.stage-card{padding:.85rem;gap:.4rem}.stage-card small{font-size:.7rem}.recovery-requirements table{min-width:74rem}.table td{overflow-wrap:normal}section[aria-label="Saved Recoveries"] table{min-width:48rem}section[aria-label="Saved Recoveries"] button{white-space:nowrap}section[aria-label="Saved Recoveries"] .table-active{--bs-table-bg-state:var(--pulse-primary-light)}
.recovery-journey{gap:.65rem;margin:1rem 0}.stage-card{min-height:125px;padding:1rem;gap:.7rem;border-top-width:4px;border-radius:.8rem}.stage-status{align-self:flex-start;border-radius:.4rem;padding:.3rem .5rem;background:color-mix(in srgb,var(--stage-color) 12%,white);font-size:.7rem;line-height:1.25}.stage-card strong{font-size:.85rem}.stage-card small{font-size:.72rem}.stage-guide{gap:.6rem 1rem;font-size:.75rem}.selected-recovery-summary{padding:1rem 0;margin:1rem 0!important}.proposal-summary{padding:.8rem;border-radius:.8rem}.proposal-summary>p{font-size:.75rem}.proposal-summary>strong{font-size:.9rem}.proposal-summary>details>summary{font-size:.75rem}.booking-attention-card{border:1px solid var(--pulse-border);border-radius:.7rem;padding:.8rem;margin:.6rem 0}.booking-attention-card>strong{font-size:.9rem}.booking-context{font-size:.75rem;margin:.4rem 0 1rem}.booking-attention-card p:last-of-type{font-size:.8rem}.workflow-actions{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.6rem;margin:.75rem 0}.workflow-refresh{margin-left:auto}.workflow-permission{display:flex;gap:.4rem;border-left:3px solid var(--pulse-primary);background:var(--pulse-primary-light);padding:.8rem;margin:1rem 0 .6rem}.workflow-availability,.booking-check-details{margin:.8rem 0;color:var(--pulse-ink-muted)}.workflow-availability summary,.booking-check-details>summary{cursor:pointer}.workflow-availability p{margin:.5rem 0}section[aria-label="Saved Recoveries"]{border-top:1px solid var(--pulse-border);padding-top:1rem;margin-bottom:0!important}section[aria-label="Saved Recoveries"]>h6{font-size:.9rem}section[aria-label="Saved Recoveries"]>p{font-size:.8rem;color:var(--pulse-ink-muted)}@media(min-width:1024px){.recovery-journey{grid-template-columns:repeat(4,minmax(0,1fr))}}
.booking-attention-card .workflow-secondary-action,.workflow-actions .workflow-secondary-action{display:inline-flex;align-items:center;justify-content:center;gap:.3rem;width:auto;min-height:32px;padding:.45rem .75rem;border:1px solid #cbd5e1;border-radius:.5rem;background:#fff;color:#34445c;font-size:.75rem;font-weight:400;line-height:1.25;box-shadow:none}.workflow-secondary-action:hover:not(:disabled){background:#f8fafc;border-color:#aab9cc;color:#243047}.workflow-secondary-action:focus-visible{outline:2px solid var(--pulse-primary);outline-offset:2px}.workflow-secondary-action:disabled{opacity:.6}@media(max-width:767px){.booking-attention-card .workflow-secondary-action,.workflow-actions .workflow-secondary-action{min-height:44px}}
.action-centre-heading,.stage-panel-heading,.stage-record-heading{display:flex;justify-content:space-between;align-items:start;gap:.75rem}.action-centre-heading>.badge{align-self:start}.recovery-action-centre .selected-recovery-summary{border-top:0;margin-top:1rem!important;padding-top:0}.recovery-action-centre .recovery-journey{grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem}.recovery-action-centre .stage-card{background:var(--stage-bg);border:1px solid var(--stage-color);min-height:112px;padding:.85rem;gap:.65rem;cursor:pointer}/* Status colours fill the card; a separate blue ring identifies the selected tab. */
.recovery-action-centre .stage-card.is-active{outline:2px solid #2374a6;outline-offset:2px}.recovery-action-centre .stage-card .stage-status{background:transparent;padding:0;font-weight:650}
.stage-eyebrow{text-transform:uppercase;font-size:.6rem!important;color:var(--pulse-ink-muted)}.recovery-action-centre .stage-status{background:var(--stage-bg);color:var(--stage-color);font-size:.7rem;max-width:100%;white-space:normal}.recovery-action-centre .stage-card:focus-visible{outline:3px solid var(--pulse-ink);outline-offset:4px}.recovery-stage-panel,.status-tracker{border:1px solid var(--pulse-border);border-radius:1rem;padding:1rem;background:#fff}.stage-panel-heading{align-items:center;margin-bottom:.75rem}.stage-panel-heading h6{font-size:.95rem;font-weight:650;margin:0}.stage-description{font-size:.78rem;color:var(--pulse-ink-muted);line-height:1.5;margin:.5rem 0 1rem}.stage-record{padding:.9rem 0;border-bottom:1px solid var(--pulse-border);font-size:.78rem}.stage-record:last-of-type{border-bottom:0}.stage-record-heading{align-items:baseline;flex-wrap:wrap}.stage-record p{font-size:.72rem;line-height:1.5;color:var(--pulse-ink-muted);margin:.5rem 0}.stage-evidence{font-size:.73rem;margin:.8rem 0;line-height:1.5}.stage-evidence>summary{font-weight:600;cursor:pointer}.invitation-times{display:grid;grid-template-columns:auto 1fr;gap:.3rem .7rem;font-size:.7rem;color:var(--pulse-ink-muted)}.invitation-times dd{margin:0}.acknowledgement-row{display:flex;align-items:baseline;gap:.6rem;font-size:.78rem;line-height:1.5;margin:1rem 0}.outstanding-checks{font-size:.75rem;padding-left:1.1rem;line-height:1.6}.action-centre-primary{width:100%;margin-top:.7rem;font-size:.85rem}.action-feedback{background:var(--pulse-blue-bg);padding:.75rem;border-radius:.6rem}.recovery-action-centre .workflow-availability{padding:.8rem;border:1px solid var(--pulse-border);border-radius:.65rem;background:var(--pulse-bg)}.recovery-action-centre .workflow-secondary-action{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:.45rem .75rem;border:1px solid #cbd5e1;border-radius:.5rem;background:#fff;color:#34445c;font-size:.75rem;box-shadow:none}.recovery-action-centre .status-tracker table{min-width:70rem}@media(max-width:359px){.recovery-action-centre .recovery-journey{grid-template-columns:1fr}}@media(max-width:767px){.recovery-action-centre .stage-card{min-height:116px}.recovery-stage-panel,.status-tracker{padding:.8rem}.recovery-action-centre .workflow-secondary-action,.stage-record .btn{min-height:44px}.stage-panel-heading{flex-wrap:wrap}}
.applied-recovery{border:1px solid var(--pulse-border);border-radius:1rem;padding:1rem;background:#fff}.undo-reversal ul{max-height:25vh;overflow:auto;padding-right:.5rem}.undo-reversal>p:last-child{background:var(--pulse-bg);padding:.65rem;border-radius:.5rem}.undo-reversal li{margin-bottom:.7rem}
.facility-approval-card{background:#fff;border:1px solid var(--pulse-border);border-radius:1rem;padding:1rem;margin:.7rem 0;font-size:.8rem}.facility-identity{display:flex;gap:1rem;padding:1.2rem 0;border-bottom:1px solid var(--pulse-border);margin-bottom:1rem}.facility-identity>span{color:var(--pulse-primary);font-size:1.3rem}.facility-identity p,.facility-booking-status p{color:var(--pulse-ink-muted);margin:.5rem 0;font-size:.75rem}.facility-booking-status{border:1px solid var(--pulse-border);border-radius:.8rem;padding:.8rem;margin:.7rem 0}.facility-request{width:100%}.booking-view>summary{border:1px solid var(--pulse-border);border-radius:2rem;padding:.5rem;text-align:center}
.saved-status-disclosure{border:1px solid var(--pulse-border);border-radius:.7rem;padding:.8rem;min-width:0;scroll-margin-top:1.5rem}.saved-status-disclosure>summary{cursor:pointer;font-weight:650;min-height:44px;line-height:1.5}.saved-status-disclosure>summary>span{display:block;color:var(--pulse-ink-muted);font-weight:400;font-size:.8rem;overflow-wrap:anywhere}.saved-status-disclosure>summary:focus-visible{outline:2px solid var(--pulse-primary);outline-offset:3px}
.step-eyebrow{display:block;font-size:.65rem}
</style>
