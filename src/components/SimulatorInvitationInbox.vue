<script setup>
// Purpose: Read real invitation terms and confirm exact accept/decline responses; delivery status is not acceptance.
// Accepting assigns the replacement straight away: the server applies the plan
// once everyone it is waiting for has accepted. Telegram delivery is independent.
import {ref,watch,onMounted,onUnmounted,nextTick} from 'vue'
import {supabase} from '../supabase'
import {createSimulatorWorkflow,SIMULATOR_WORKFLOW_VERIFIED,effectiveInvitationStatus} from '../services/simulatorWorkflowService.js'
const props=defineProps({refreshVersion:{type:Number,default:0}})
const emit=defineEmits(['responded'])
const api=createSimulatorWorkflow(supabase,{enabled:SIMULATOR_WORKFLOW_VERIFIED,allowReadOnly:true})
const expanded=ref(true)
const invitationEnabled=ref(false)
const invitations=ref([]),busy=ref(false),loading=ref(false),error=ref(''),readError=ref(''),message=ref(''),confirmed=ref(false),pending=ref(null)
const clock=ref(Date.now()),confirmationPanel=ref(null)
watch(pending,async action=>{
 if(!action)return
 await nextTick()
 const panel=confirmationPanel.value
 if(panel){
  panel.style.scrollMarginTop=((document.querySelector('header')?.getBoundingClientRect().height || 0)+16)+'px'
  panel.scrollIntoView({block:'start'});panel.focus({preventScroll:true})
 }
})
function localTime(value){const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',dateStyle:'medium',timeStyle:'short'}).format(date)+' (SGT)':'Time to be confirmed'}
function venue(invitation,term){return invitation.facilities?.find(f=>String(f.segment_id)===String(term.segment_id))?.venue_name || 'Location to be confirmed'}
let expiryTimer,refreshTimer
// Request generations prevent a previous account's delayed read/write response
// from repopulating this account's private inbox.
let generation=0,disposed=false,subscription,authId
// Read errors stay separate from persisted response errors. A late request from
// another authenticated session must never repopulate this recipient-only inbox.
function autoRefresh(){
 if(!document.hidden && !loading.value && !busy.value && !pending.value)void refresh()
}
async function refresh(){
 const version=++generation;loading.value=true;readError.value=''
 try{const [result,gate]=await Promise.all([api.myInvitations(),api.capabilities().catch(()=>null)]);if(!disposed&&version===generation){invitationEnabled.value=SIMULATOR_WORKFLOW_VERIFIED&&gate?.invitations_enabled===true;invitations.value=result.invitations;pending.value=null;confirmed.value=false}}
 catch(e){if(!disposed&&version===generation){invitations.value=[];readError.value='Inbox unavailable: '+e.message}}
 finally{if(!disposed&&version===generation){
  loading.value=false
  await nextTick()
  const inbox=globalThis.document?.getElementById('simulator-invitation-inbox')
  if(inbox && window.location.hash==='#simulator-invitation-inbox' && document.activeElement===inbox)inbox.scrollIntoView({block:'start',behavior:'instant'})
 }}
}
// What happened after the server saved the answer (see rpc_simulator_respond_invitation)
function responseMessage(response,result){
 if(response==='Declined')return 'Declined. The organiser will find someone else.'
 if(result?.assigned)return "You're assigned. It's now in your schedule."
 const waiting=Number(result?.waiting_for)||0
 if(waiting>0)return 'Accepted. You\'ll be assigned as soon as the other '+(waiting===1?'replacement accepts.':waiting+' replacements accept.')
 if(result?.assign_error)return 'Accepted, but you couldn\'t be assigned automatically ('+result.assign_error+'). Your organiser can finish it.'
 return 'Accepted.'
}
function respond(invitation,response){
 if(!invitationEnabled.value||busy.value||effectiveInvitationStatus(invitation)!=='Pending')return
 confirmed.value=false;error.value=''
 pending.value={id:invitation.id,response,terms:JSON.stringify(invitation)}
}
// Recheck the exact displayed terms and expiry at confirmation time. The RPC
// independently validates the real recipient and current server-side terms.
async function confirmResponse(){
 if(!invitationEnabled.value||busy.value||!confirmed.value||!pending.value)return
 const action=pending.value,current=invitations.value.find(i=>i.id===action.id)
 if(!current||JSON.stringify(current)!==action.terms||effectiveInvitationStatus(current)!=='Pending'){
  pending.value=null;confirmed.value=false;error.value='Invitation changed or expired. Refresh and review again.';return
 }
 const version=generation
 busy.value=true;error.value='';message.value=''
 try{
  const result=await api.respond(action.id,action.response,true)
  if(disposed||version!==generation)return
  message.value=responseMessage(action.response,result)
  pending.value=null;confirmed.value=false
  await refresh();emit('responded')
 }catch(e){if(!disposed&&version===generation)error.value=e.message}
 finally{busy.value=false}
}
watch(()=>props.refreshVersion,()=>{void refresh()})
// Advance the visible expiry clock and reload when authentication changes;
// the server clock remains authoritative when accepting or declining.
onMounted(()=>{
 refreshTimer=setInterval(autoRefresh,30000)
 globalThis.window?.addEventListener('focus',autoRefresh)
 globalThis.document?.addEventListener('visibilitychange',autoRefresh)
 expiryTimer=setInterval(()=>{clock.value=Date.now()},1000)
 void refresh()
 subscription=supabase?.auth?.onAuthStateChange?.((_event,session)=>{
  const next=session?.user?.id ?? null
  if(next!==authId){authId=next;++generation;invitationEnabled.value=false;invitations.value=[];pending.value=null;confirmed.value=false;message.value='';error.value='';void refresh()}
 })?.data?.subscription
})
onUnmounted(()=>{clearInterval(expiryTimer);clearInterval(refreshTimer);globalThis.window?.removeEventListener('focus',autoRefresh);globalThis.document?.removeEventListener('visibilitychange',autoRefresh);disposed=true;++generation;subscription?.unsubscribe()})
</script>
<template>
 <section id="simulator-invitation-inbox" class="pulse-card p-3 mb-3 invitation-inbox" aria-label="My replacement invitations" tabindex="-1" @focus.self="expanded=true" :aria-busy="loading || busy">
  <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
   <h2 class="h5 fw-bold mb-0 invitation-heading">
    <button type="button" class="invitation-toggle" :aria-expanded="expanded" aria-controls="replacement-invitation-content" @click="expanded=!expanded">
     <span>Replacement Invitations</span>
     <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" :class="{'invitation-chevron-open':expanded}"><path d="m6 9 6 6 6-6"/></svg>
    </button>
   </h2>
   <button type="button" class="btn btn-outline-secondary btn-sm rounded-pill invitation-refresh" :disabled="busy || loading" @click="refresh"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/></svg> {{ loading ? 'Refreshing...' : 'Refresh' }}</button>
  </div>
  <div id="replacement-invitation-content" v-show="expanded">
  <p class="small text-muted mb-4">Manage requests to cover another member's role.</p>
  <div class="invitation-explainer small"><span aria-hidden="true">&#9432;</span><div><p class="fw-semibold mb-1">How replacements work</p><p class="text-muted mb-0">Accepting assigns you to the role straight away. No organiser approval is needed. If several people were asked to cover for the same event, the swap happens once all of them accept.</p></div></div>
  <p v-if="loading" role="status" class="small">Loading your invitations...</p>
  <p v-if="!invitationEnabled && !loading && !readError && invitations.some(i=>effectiveInvitationStatus(i,clock)==='Pending')" class="small text-muted">Preview: responding is turned off on this site. Contact your organiser if you need assistance.</p>
  <p v-if="readError" role="status" class="small text-warning">{{ readError }}</p>
  <p v-if="error" role="alert" class="small text-danger">{{ error }}</p>
  <p v-if="message" role="status" class="small text-success">{{ message }}</p>
  <p v-if="busy" role="status" class="small">Saving your response...</p>
  <div v-if="!loading && !readError && !invitations.length" class="invitation-empty" role="status">
   <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7M2 5l9 7 9-7M15 18l3 3 4-5"/></svg>
   <h3 class="h6 fw-semibold">You're all caught up!</h3>
   <p>You don't have any replacement invitations right now.</p><p>New invitations will appear here automatically.</p>
  </div>
  <div v-if="pending" ref="confirmationPanel" tabindex="-1" class="border rounded p-3 my-2 small" aria-label="Confirm invitation response">
   <p>{{ pending.response==='Accepted' ? 'Accept' : 'Decline' }} the invitation for {{ invitations.find(i=>i.id===pending.id)?.event_name }}?</p>
   <label class="d-block mb-2"><input v-model="confirmed" type="checkbox"> I reviewed these invitation terms and confirm this response.</label>
   <div class="d-flex flex-wrap gap-2">
    <button type="button" class="btn btn-primary btn-sm" :disabled="!invitationEnabled || busy || !confirmed" @click="confirmResponse">Confirm invitation response</button>
    <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="busy" @click="pending=null;confirmed=false">Dismiss</button>
   </div>
  </div>
  <article v-for="invitation in invitations" :key="invitation.id" :data-invitation-id="invitation.id" :aria-label="invitation.event_name+' replacement invitation'" class="border rounded p-3 my-2 small">
   <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
    <h3 class="h6 fw-bold mb-0">{{ invitation.event_name }}</h3>
    <span class="badge bg-light text-dark border">{{ effectiveInvitationStatus(invitation,clock) }}</span>
   </div>
   <p class="text-muted my-2">{{ invitation.club_name || 'Club context to be confirmed' }}</p>
   <div v-for="term in invitation.assignment_snapshot" :key="term.assignment_id" class="mb-2">
    <strong>{{ term.activity }}</strong>
    <div>Requested role: {{ term.role_name }}</div>
    <div>{{ localTime(term.starts_at) }} to {{ localTime(term.ends_at) }}</div>
    <div>Location: {{ venue(invitation,term) }}</div>
   </div>
   <p class="text-muted">Expires {{ localTime(invitation.expires_at) }}</p>
   <div class="d-flex flex-wrap gap-2">
    <button type="button" class="btn btn-success btn-sm" :disabled="!invitationEnabled || busy || loading || effectiveInvitationStatus(invitation,clock)!=='Pending'" @click="respond(invitation,'Accepted')">Accept this invitation</button>
    <button type="button" class="btn btn-outline-danger btn-sm" :disabled="!invitationEnabled || busy || loading || effectiveInvitationStatus(invitation,clock)!=='Pending'" @click="respond(invitation,'Declined')">Decline this invitation</button>
   </div>
  </article>
  </div>
 </section>
</template>
<style scoped>
.invitation-inbox { scroll-margin-top: 1rem; overflow-wrap: anywhere; padding: 1.25rem !important; border: 1px solid var(--bs-border-color, #dee2e6); border-radius: 1.25rem; box-shadow: none; }
.invitation-heading { flex: 1; min-width: 0; }
.invitation-toggle { display: flex; align-items: center; justify-content: space-between; gap: .75rem; width: 100%; border: 0; padding: 0; color: inherit; background: transparent; font: inherit; text-align: left; }
.invitation-toggle svg { flex-shrink: 0; transition: transform .15s ease; }
.invitation-chevron-open { transform: rotate(180deg); }
.invitation-toggle:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; border-radius: .25rem; }
.invitation-refresh { display: inline-flex; align-items: center; gap: .5rem; padding-inline: 1rem; }
.invitation-explainer { display: flex; gap: .6rem; margin-bottom: 1.5rem; }
.invitation-empty { text-align: center; padding: 2.5rem 0 2rem; color: var(--bs-secondary-color, #6c757d); font-size: .875rem; }
.invitation-empty svg { margin-bottom: 1.75rem; }
.invitation-empty h3 { color: var(--bs-body-color); margin-bottom: .75rem; }
.invitation-empty p { margin-bottom: .4rem; }
.invitation-inbox button { min-height: 44px; }
</style>
