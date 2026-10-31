<script setup>
import {computed} from 'vue'
import SimulatorCalendarActions from './SimulatorCalendarActions.vue'
const props=defineProps({recommendations:Array,options:Array,rankedPlans:Array,selected:{type:Array,default:()=>[]},data:Object,event:Object})
const emit=defineEmits(['choose'])
const groups=computed(()=>{
 const map=new Map((props.recommendations || []).map(r=>[String(r.segmentId),{...r,choices:[]}]))
 for(const option of props.options || []){
  const change=option.changes.find(c=>c.venueName) || option.changes[0];if(!change)continue
  const key=String(change.segmentId)
  if(!map.has(key))map.set(key,{segmentId:change.segmentId,segmentTitle:props.data?.event_segments?.find(s=>String(s.id)===key)?.title,alternatives:[],excludedAlternatives:[],choices:[]})
  const group=map.get(key),fact=group.alternatives.find(a=>a.venue===change.venueName),plan=props.rankedPlans?.find(p=>p.id===option.id)
  if(change.venueName && group.excludedAlternatives?.some(a=>a.venue===change.venueName))continue
  group.choices.push({option,change,fact,plan,conflicts:(plan?.conflicts || []).filter(c=>/FACILITY|BOOKING|VENUE|CAPACITY/.test(c.type || '') && (c.segmentId==null || String(c.segmentId)===key))})
 }
 return [...map.values()]
})
const times=(row)=>{const original=props.data?.event_segments?.find(s=>String(s.id)===String(row.change.segmentId));const changes=row.option.changes.filter(c=>String(c.segmentId)===String(row.change.segmentId));return {start:changes.find(c=>c.starts_at!=null)?.starts_at || row.fact?.starts_at || original?.starts_at,end:changes.find(c=>c.ends_at!=null)?.ends_at || row.fact?.ends_at || original?.ends_at}}
</script>
<template>
 <section aria-label="Facility and schedule choices">
  <h6 class="fw-bold">Facility and schedule alternatives</h6><p class="small text-muted">Choose one coherent alternative per activity. Options for different activities can be combined. Booking approval and suitability must still be verified.</p>
  <p v-if="!groups.length" class="small">No facility or schedule recovery suggestion was generated from accessible records.</p>
  <section v-for="group in groups" :key="group.segmentId" data-testid="facility-recovery" class="mb-3">
   <h6>{{ group.segmentTitle || 'Affected activity' }}</h6>
   <div v-for="row in group.choices" :key="row.option.id" class="facility-choice border rounded p-3 mb-2" :class="{chosen:selected.includes(row.option.id)}" :data-facility-option="row.option.id" :data-testid="row.change.venueName?'facility-alternative':undefined">
    <div class="d-flex flex-wrap justify-content-between gap-2"><strong>{{ row.change.venueName || 'Schedule adjustment' }}</strong><span class="small">{{ row.plan?.score ?? 'Unverified' }}/100 recovery score</span></div>
    <p class="small mb-1">{{ row.option.title }}</p><p class="small mb-1">{{ row.conflicts.length?'Known facility conflict - review details':'No disqualifying facility conflict reported in accessible checks; visibility may be incomplete.' }}</p>
    <p class="small text-muted mb-2">{{ row.fact?.status || (row.change.venueName?'Booking approval and suitability require verification.':'Schedule and booking coverage need final validation.') }}</p>
    <button type="button" class="btn btn-sm btn-pulse-outline" :aria-pressed="selected.includes(row.option.id)" @click="emit('choose',row.option.id)">{{ selected.includes(row.option.id)?'Selected alternative':'Use this alternative' }}</button>
    <details class="small mt-2"><summary>View details</summary><p v-for="c in row.conflicts" :key="c.message">{{ c.message }}</p><template v-if="row.fact"><p>Capacity: {{ row.fact.capacity ?? 'unverified' }}; recorded assignee minimum: {{ row.fact.minimumCapacity ?? 'unverified' }}.</p><p>Suitability: {{ row.fact.suitability }}</p><p>Equipment: {{ row.fact.equipment?.join(', ') || 'unverified' }}.</p><p>{{ row.fact.reason }}</p></template><p v-for="c in row.option.changes" :key="c.segmentId">Proposed timing: {{ c.starts_at || 'unchanged' }} to {{ c.ends_at || 'unchanged' }}.</p></details>
    <SimulatorCalendarActions v-if="row.change.venueName" :venue="row.change.venueName" :facility-id="row.fact?.facilityId" :start="times(row).start" :end="times(row).end" :event-club-id="event?.club_id" :event-club-name="event?.club_name" />
   </div>
   <p v-if="!group.alternatives?.length" class="small text-warning">No eligible alternative facility in accessible records. Review later times or contact the facility administrator.</p>
   <p v-if="group.advice && !group.choices.length" class="small text-muted">{{ group.advice }}</p>
   <details v-if="group.excludedAlternatives?.length" class="small"><summary>Alternatives excluded by existing checks ({{ group.excludedAlternatives.length }})</summary><p v-for="a in group.excludedAlternatives" :key="a.venue">{{ a.venue }}: {{ a.rejectedReasons.join(' ') }}</p></details>
  </section>
 </section>
</template>
<style scoped>.facility-choice.chosen{border-color:var(--pulse-primary)!important;box-shadow:inset 3px 0 var(--pulse-primary)}summary{cursor:pointer}.facility-choice{overflow-wrap:anywhere}</style>
