<script setup>
import {computed,ref,watch} from 'vue'
import {supabase} from '../supabase'
import {ORIGINAL_BOOKING_LINK_VERIFIED,createOriginalBookingWorkflow} from '../services/simulatorOriginalBookingService.js'
import {weekStartOf} from '../services/facilityService'
import {describeSimulatorFacilityLinks} from '../services/simulatorFacilitySetupService.js'
import SimulatorCalendarActions from './SimulatorCalendarActions.vue'
const props=defineProps({data:Object,eventId:[String,Number],busy:Boolean,initialActivityId:[String,Number]})
const emit=defineEmits(['refresh'])
const rows=computed(()=>describeSimulatorFacilityLinks(props.data,props.eventId))
const selectedId=ref(props.initialActivityId ?? '')
watch(rows,items=>{if(!items.some(r=>String(r.segment.id)===String(selectedId.value)))selectedId.value=items[0]?.segment.id ?? ''},{immediate:true})
const selected=computed(()=>rows.value.find(r=>String(r.segment.id)===String(selectedId.value)))
const event=computed(()=>props.data?.events?.find(e=>String(e.id)===String(props.eventId)))
const linkCount=computed(()=>rows.value.reduce((n,row)=>n+row.bookings.length,0))
const target=computed(()=>{
 const start=selected.value?.segment.starts_at
 if(!Number.isFinite(Date.parse(start)))return {path:'/facilities'}
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore'}).format(new Date(start))
 // The calendar accepts a week, not an event/room preselection.
 return {path:'/facilities',query:{week:weekStartOf(day)}}
})
const originalApi=createOriginalBookingWorkflow(supabase)
const evidence=ref(null),selectedBookingId=ref(''),confirmOriginal=ref(false),working=ref(false),linkError=ref(''),linkMessage=ref('')
let requestVersion=0
const chosenBooking=computed(()=>evidence.value?.bookings.find(b=>String(b.booking_id)===String(selectedBookingId.value)))
watch(()=>[props.eventId,selectedId.value,props.data],()=>{++requestVersion;evidence.value=null;selectedBookingId.value='';confirmOriginal.value=false;linkError.value='';linkMessage.value='';working.value=false})
watch(selectedBookingId,()=>{confirmOriginal.value=false})
async function discover(){
 const version=++requestVersion
 working.value=true;linkError.value='';linkMessage.value='';evidence.value=null;selectedBookingId.value='';confirmOriginal.value=false
 try{const result=await originalApi.discover(props.eventId,selectedId.value);if(version===requestVersion)evidence.value=result}
 catch(e){if(version===requestVersion)linkError.value=e.message}
 finally{if(version===requestVersion)working.value=false}
}
async function linkOriginal(){
 if(working.value)return
 const version=requestVersion
 working.value=true;linkError.value='';linkMessage.value=''
 try{
  await originalApi.link(evidence.value,chosenBooking.value,confirmOriginal.value)
  if(version===requestVersion){linkMessage.value='Original booking link persisted. Refreshing actual event records.';emit('refresh')}
 }catch(e){if(version===requestVersion)linkError.value=e.message}
 finally{if(version===requestVersion){working.value=false;confirmOriginal.value=false}}
}
</script>
<template>
 <section class="border rounded p-3 mt-3" aria-label="Event facility booking setup">
  <h6 class="fw-bold">Event facility booking links</h6>
  <p class="small">Claims, waitlists and approval stay in the Master Facility Calendar. Selecting or claiming a room there does not automatically link it to this event.</p>
  <label for="facility-setup-activity" class="small fw-bold">Activity for calendar</label>
  <select id="facility-setup-activity" v-model="selectedId" class="form-select form-select-sm mb-2">
   <option v-for="row in rows" :key="row.segment.id" :value="row.segment.id">{{ row.segment.title }} | {{ row.segment.starts_at }} to {{ row.segment.ends_at }}</option>
  </select>
  <RouterLink :to="target" class="btn btn-outline-primary btn-sm me-2">Open Facility Calendar for selected activity</RouterLink>
  <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="busy" @click="emit('refresh')">Refresh booking information</button>
  <p v-if="!linkCount" class="small text-warning mt-2">This event has no loaded booking links. Open the calendar to inspect or claim an existing eligible slot. Vacant intervals cannot be booked here.</p>
  
  <div class="small border rounded p-2 my-2">
   <button type="button" class="btn btn-outline-primary btn-sm" :disabled="busy || working || !selected" @click="discover">Find eligible original bookings</button>
   <p class="text-muted mb-1">Server-checked existing bookings only. Linking does not create, claim or approve a reservation.</p>
   <p v-if="!ORIGINAL_BOOKING_LINK_VERIFIED" class="text-warning">Original booking linking is unavailable in this environment. You can inspect existing bookings and arrange reservations in Facility Calendar.</p>
   <p v-if="linkError" role="alert" class="text-danger">{{ linkError }}</p>
   <p v-if="linkMessage" role="status">{{ linkMessage }}</p>
   <p v-if="evidence && !evidence.bookings.some(b=>b.eligible)" class="text-warning">No eligible original booking found. Use the calendar workflow for the selected activity; no vacant interval is treated as a reservation.</p>
   <div v-for="candidate in evidence?.bookings || []" :key="candidate.booking_id" class="border-top py-2">
    <label><input type="radio" name="original-booking" :value="candidate.booking_id" v-model="selectedBookingId" :disabled="!candidate.eligible || working"> {{ candidate.facility_name }} | Booking {{ candidate.booking_id }}</label>
    <div>{{ candidate.booking_date }} {{ candidate.start_time }} to {{ candidate.end_time }} | Owner club {{ candidate.owner_club_id }} | {{ candidate.status }}</div>
    <div>Room capacity {{ candidate.capacity ?? 'unverified' }}; assigned-staff lower bound {{ candidate.minimum_capacity }}. Total attendance requirement: {{ candidate.required_capacity ?? 'unknown' }}.</div>
    <div>{{ candidate.capacity_verified===true?'Capacity meets the reviewed attendance requirement; other suitability still needs confirmation.':'Capacity suitability requires explicit manual verification; staff count alone does not confirm it.' }}</div>
    <div>{{ candidate.eligible?'Eligible for linking only after explicit suitability confirmation.':candidate.reasons.join('; ') }}</div>
    <div v-for="reason in candidate.verification_required || []" :key="reason">{{ reason }}</div>
    <SimulatorCalendarActions :facility-id="candidate.facility_id" :venue="candidate.facility_name" :start="selected?.segment.starts_at" :end="selected?.segment.ends_at" :event-club-id="event?.club_id" :event-club-name="event?.club_name" />
   </div>
   <label class="d-block"><input v-model="confirmOriginal" type="checkbox" :disabled="working"> I confirm this booking and activity, actual audience capacity, required equipment and suitability.</label>
   <button type="button" class="btn btn-outline-primary btn-sm mt-1" :disabled="!ORIGINAL_BOOKING_LINK_VERIFIED || working || busy || !confirmOriginal || !chosenBooking?.eligible" @click="linkOriginal">Link approved booking to activity</button>
  </div>

  <details v-if="selected" class="small">
   <summary>Inspect linked records for {{ selected.segment.title }} ({{ selected.bookings.length }})</summary>
   <p v-if="!selected.bookings.length">No accessible booking is linked to this activity.</p>
   <div v-for="booking in selected.bookings" :key="booking.id" class="border-top py-2">
    <strong>{{ booking.facilityName }}</strong> | Booking {{ booking.id }} | {{ booking.status }}
    <div>Capacity {{ booking.capacity ?? 'unverified' }}; {{ booking.minimumCapacity }} recorded assignees. Audience and equipment requirements still need review.</div>
    <div v-if="booking.recordedChecksPassed">Recorded ownership, approval, time and minimum-capacity checks passed. Full visibility and suitability remain subject to verification.</div>
    <ul v-else><li v-for="reason in booking.blockers" :key="reason">{{ reason }}</li></ul>
    <SimulatorCalendarActions :venue="booking.facilityName" :start="selected.segment.starts_at" :end="selected.segment.ends_at" :event-club-id="event?.club_id" :event-club-name="event?.club_name" />
   </div>
  </details>
 </section>
</template>
