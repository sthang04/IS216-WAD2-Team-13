<script setup>
// Purpose: Read real invitation terms and confirm exact accept/decline responses; delivery status is not acceptance.
// This inbox records consent only. Assignment changes belong to the organizer's
// separately authorized Apply operation; Telegram delivery is independent.
import {ref,watch,onMounted,onUnmounted,nextTick} from 'vue'
import {supabase} from '../supabase'
import {createSimulatorWorkflow,SIMULATOR_WORKFLOW_VERIFIED,effectiveInvitationStatus} from '../services/simulatorWorkflowService.js'
const props=defineProps({refreshVersion:{type:Number,default:0}})
const emit=defineEmits(['responded'])
const api=createSimulatorWorkflow(supabase,{enabled:SIMULATOR_WORKFLOW_VERIFIED,allowReadOnly:true})
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
let expiryTimer
// Request generations prevent a previous account's delayed read/write response
// from repopulating this account's private inbox.
let generation=0,disposed=false,subscription,authId
// Read errors stay separate from persisted response errors. A late request from
// another authenticated session must never repopulate this recipient-only inbox.
async function refresh(){
 const version=++generation;loading.value=true;readError.value=''
 try{const [result,gate]=await Promise.all([api.myInvitations(),api.capabilities().catch(()=>null)]);if(!disposed&&version===generation){invitationEnabled.value=SIMULATOR_WORKFLOW_VERIFIED&&gate?.invitations_enabled===true;invitations.value=result.invitations;pending.value=null;confirmed.value=false}}
 catch(e){if(!disposed&&version===generation){invitations.value=[];readError.value='Inbox unavailable: '+e.message}}
 finally{if(!disposed&&version===generation)loading.value=false}
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
  await api.respond(action.id,action.response,true)
  if(disposed||version!==generation)return
  message.value='Response persisted. This does not change any assignment.'
  pending.value=null;confirmed.value=false
  await refresh();emit('responded')
 }catch(e){if(!disposed&&version===generation)error.value=e.message}
 finally{busy.value=false}
}
watch(()=>props.refreshVersion,()=>{void refresh()})
// Advance the visible expiry clock and reload when authentication changes;
// the server clock remains authoritative when accepting or declining.
onMounted(()=>{
 expiryTimer=setInterval(()=>{clock.value=Date.now()},1000)
 void refresh()
 subscription=supabase?.auth?.onAuthStateChange?.((_event,session)=>{
  const next=session?.user?.id ?? null
  if(next!==authId){authId=next;++generation;invitationEnabled.value=false;invitations.value=[];pending.value=null;confirmed.value=false;message.value='';error.value='';void refresh()}
 })?.data?.subscription
})
onUnmounted(()=>{clearInterval(expiryTimer);disposed=true;++generation;subscription?.unsubscribe()})
</script>
<template>
 <section id="simulator-invitation-inbox" class="pulse-card p-3 mb-3 invitation-inbox" aria-label="My replacement invitations" tabindex="-1" :aria-busy="loading || busy">
  <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
   <h2 class="h5 fw-bold mb-0">My Replacement Invitations</h2>
   <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="busy || loading" @click="refresh">Refresh my invitations</button>
  </div>
  <p class="small">Review requests to cover another member's role. Accepting does not assign you; the organizer must confirm recovery.</p>
  <p v-if="loading" role="status" class="small">Loading your invitations?</p>
  <p v-if="!invitationEnabled && !loading" class="small text-muted">You can view invitations here. Responses are currently unavailable in this environment; contact your organizer.</p>
  <p v-if="readError" role="status" class="small text-warning">{{ readError }}</p>
  <p v-if="error" role="alert" class="small text-danger">{{ error }}</p>
  <p v-if="message" role="status" class="small text-success">{{ message }}</p>
  <p v-if="busy" role="status" class="small">Saving your response?</p>
  <p v-if="!loading && !readError && !invitations.length" class="small mb-0">You're all caught up! No replacement invitations right now. New requests will appear here.</p>
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
 </section>
</template>
<style scoped>
.invitation-inbox { scroll-margin-top: 1rem; overflow-wrap: anywhere; }
.invitation-inbox button { min-height: 44px; }
</style>
