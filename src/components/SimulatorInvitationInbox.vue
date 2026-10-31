<script setup>
import {ref,watch,onMounted,onUnmounted} from 'vue'
import {supabase} from '../supabase'
import {createSimulatorWorkflow,SIMULATOR_WORKFLOW_VERIFIED,effectiveInvitationStatus} from '../services/simulatorWorkflowService.js'
const props=defineProps({refreshVersion:{type:Number,default:0}})
const emit=defineEmits(['responded'])
const api=createSimulatorWorkflow(supabase,{enabled:SIMULATOR_WORKFLOW_VERIFIED,allowReadOnly:true})
const invitationEnabled=ref(false)
const invitations=ref([]),busy=ref(false),loading=ref(false),error=ref(''),readError=ref(''),message=ref(''),confirmed=ref(false),pending=ref(null)
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
 if(!invitationEnabled.value||busy.value)return
 confirmed.value=false;error.value=''
 pending.value={id:invitation.id,response,terms:JSON.stringify(invitation)}
}
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
onMounted(()=>{
 void refresh()
 subscription=supabase?.auth?.onAuthStateChange?.((_event,session)=>{
  const next=session?.user?.id ?? null
  if(next!==authId){authId=next;++generation;invitationEnabled.value=false;invitations.value=[];pending.value=null;confirmed.value=false;message.value='';error.value='';void refresh()}
 })?.data?.subscription
})
onUnmounted(()=>{disposed=true;++generation;subscription?.unsubscribe()})
</script>
<template>
 <section id="simulator-invitation-inbox" class="pulse-card p-3 mb-3" aria-label="My replacement invitations">
  <h6 class="fw-bold">My replacement invitations</h6>
  <p class="small">Only invitations for your signed-in member account are shown. Accepting does not assign you; the organizer must confirm recovery.</p>
  <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="busy || loading" @click="refresh">Refresh my invitations</button>
  <p v-if="!SIMULATOR_WORKFLOW_VERIFIED" class="small text-muted">Acceptance and decline remain disabled until safety verification and approved activation. Inbox reads require the reviewed recipient-only RPC.</p>
  <p v-if="readError" role="status" class="small text-warning">{{ readError }}</p>
  <p v-if="!invitationEnabled" class="small text-muted">Invitation writes await verified backend invitation-gate activation. Inbox reads do not send notifications or Telegram messages.</p>
  <p v-if="error" role="alert" class="small text-danger">{{ error }}</p>
  <p v-if="message" role="status" class="small">{{ message }}</p>
  <p v-if="!loading && !readError && !invitations.length" class="small">No replacement invitations for this signed-in account.</p>
  <div v-if="pending" class="border rounded p-2 my-2 small">
   {{ pending.response }} invitation {{ pending.id }}.
   <label class="d-block"><input v-model="confirmed" type="checkbox"> I reviewed these invitation terms and confirm this response.</label>
   <button type="button" class="btn btn-primary btn-sm" :disabled="!invitationEnabled || busy || !confirmed" @click="confirmResponse">Confirm invitation response</button>
   <button type="button" class="btn btn-outline-secondary btn-sm ms-2" :disabled="busy" @click="pending=null;confirmed=false">Dismiss</button>
  </div>
  <div v-for="invitation in invitations" :key="invitation.id" class="border rounded p-2 my-2 small">
   <strong>{{ invitation.event_name }}</strong> | {{ effectiveInvitationStatus(invitation) }} | Expires {{ invitation.expires_at }}
   <div v-for="term in invitation.assignment_snapshot" :key="term.assignment_id">{{ term.activity }} | {{ term.role_name }} | {{ term.starts_at }} to {{ term.ends_at }}</div>
   <button type="button" class="btn btn-success btn-sm me-2" :disabled="!invitationEnabled || busy || effectiveInvitationStatus(invitation)!=='Pending'" @click="respond(invitation,'Accepted')">Accept this invitation</button>
   <button type="button" class="btn btn-outline-danger btn-sm" :disabled="!invitationEnabled || busy || effectiveInvitationStatus(invitation)!=='Pending'" @click="respond(invitation,'Declined')">Decline this invitation</button>
  </div>
 </section>
</template>
