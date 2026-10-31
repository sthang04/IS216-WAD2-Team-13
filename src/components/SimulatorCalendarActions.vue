<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { fetchCalendar, bookingActions, weekStartOf } from '../services/facilityService'
import {simulatorCalendarTarget} from '../services/simulatorCalendarNavigation.js'
import { fetchActiveClubEntries } from '../services/waitlistService'
import { session, activeMembership, canManageActiveClub } from '../services/sessionState'
import { calendarOptionsForRecommendation, readSimulatorCalendarSnapshot } from '../services/simulatorCalendarIntegration.js'
const props=defineProps({venue:String,facilityId:[String,Number],start:String,end:String,eventClubId:[String,Number],eventClubName:String})
const rows=ref(null),entries=ref([]),error=ref(''),busy=ref(false)
let refreshVersion=0
const clubMatches=computed(()=>props.eventClubId!=null?String(props.eventClubId)===String(session.value.activeClubId):!!props.eventClubName&&activeMembership.value?.club_name===props.eventClubName)
const options=computed(()=>rows.value===null?[]:calendarOptionsForRecommendation({
 ...props,rows:rows.value,bookingActions,waitlistEntries:entries.value,
 clubId:clubMatches.value?session.value.activeClubId:null,
 // Match the calendar's display permissions exactly. RPCs remain responsible
 // for real claim permissions; no organizer identity is passed as proof.
 canClaim:clubMatches.value&&canManageActiveClub.value,isOslAdmin:session.value.isOslAdmin
}))
const day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore'}).format(new Date(t))
const target=computed(()=>simulatorCalendarTarget(props,weekStartOf))
async function refresh(){
 const version=++refreshVersion
 busy.value=true;error.value='';rows.value=null;entries.value=[]
 try{
  if(!Number.isFinite(Date.parse(props.start))||!Number.isFinite(Date.parse(props.end))||Date.parse(props.start)>=Date.parse(props.end))throw Error('Invalid activity times.')
  const result=await readSimulatorCalendarSnapshot({fetchCalendar,fetchActiveClubEntries,
   from:day(props.start),to:day(props.end),clubId:clubMatches.value?session.value.activeClubId:null})
  // Ignore old responses after changing rooms, times, club, or leaving the page.
  if(version!==refreshVersion)return
  rows.value=result.rows;entries.value=result.entries
 }catch(e){if(version===refreshVersion)error.value=e.message}
 finally{if(version===refreshVersion)busy.value=false}
}
function invalidate(){
 ++refreshVersion;rows.value=null;entries.value=[];error.value='';busy.value=false
}
watch(()=>[props.venue,props.start,props.end,props.eventClubId,props.eventClubName,props.facilityId,
 session.value.activeClubId,session.value.memberId,session.value.authUserId,
 canManageActiveClub.value,session.value.isOslAdmin,clubMatches.value],invalidate)
onUnmounted(invalidate)
</script>
<template>
 <div class="small border-start ps-2 mt-1">
  <RouterLink v-if="venue" :to="target" class="btn btn-outline-primary btn-sm me-2">View / Request this facility</RouterLink>
  <button type="button" class="btn btn-outline-primary btn-sm" :disabled="busy" @click="refresh">{{ busy?'Checking calendar...':'Check / refresh actual slot status' }}</button>
  <div v-if="error" role="alert">{{ error }}</div>
  <div v-if="!clubMatches" class="text-muted">Select the event's club in the calendar. No claim eligibility is assumed for another club.</div>
  <div v-for="(option,index) in options" :key="option.bookingId ?? index" class="mt-1">
   <span v-if="option.bookingId">Booking {{ option.bookingId }} | {{ option.status }}. </span>{{ option.reason }}
   <span v-if="option.action!=='Unavailable'" class="ms-2">Calendar action: {{ option.action }}.</span>
   <span v-else class="ms-2">Unavailable for this activity.</span>
   <!-- Navigation only. No claim, waitlist or approval mutation happens here.
        Simulator focus parameters select facility/time only; no mutation is triggered. -->
   <RouterLink :to="target" class="ms-2">Open in Calendar</RouterLink>
  </div>
  <div class="text-muted">Snapshot only; calendar permissions and availability are rechecked when acting. No room is claimed here. After a claim, return and refresh. Pending approval never confirms a replacement.</div>
 </div>
</template>
