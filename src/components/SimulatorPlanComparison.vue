<script setup>
// Purpose: Show the selected plan as before -> after for each changed activity, without mutating the source schedule.
import {computed,ref} from 'vue'
import {groupActivities} from '../services/simulatorActivityGroups.js'
const props=defineProps({data:Object,segments:Array,recovery:Object,result:Object,before:Object,savedStatus:String})
const same=(a,b)=>String(a)===String(b)
const member=id=>props.data?.members?.find(m=>same(m.id,id))?.full_name || 'Member '+id
const assignments=computed(()=>props.before?.assignments || props.data?.segment_assignments || [])
const originals=computed(()=>props.before?.segments || props.segments || [])
function names(id,proposed=false){const values=assignments.value.filter(a=>same(a.segment_id,id));return values.map(a=>{const change=proposed?props.recovery?.changes?.find(c=>same(c.segmentId,id)&&same(c.replacedMemberId,a.member_id)&&(c.assignmentId==null||same(c.assignmentId,a.id))):null;return member(change?.replacementMemberId ?? a.member_id)+(a.role_name?' ('+a.role_name+')':'')}).join(', ') || 'No recorded assignment'}
function venues(id){const links=props.before?.links || props.data?.segment_facility_bookings || [];return links.filter(l=>same(l.segment_id,id)).map(l=>{const booking=props.data?.facility_bookings?.find(b=>same(b.id,l.booking_id));return props.data?.facilities?.find(f=>same(f.id,booking?.facility_id))?.name || 'Booking '+l.booking_id+' (details unavailable)'}).join(', ') || 'No linked facility'}
// One row per activity: Day Ops crew copies of the same task are merged, names listed together.
const groupNames=(ids,proposed=false)=>ids.map(id=>names(id,proposed)).filter(n=>n!=='No recorded assignment').join(', ') || 'No recorded assignment'
const rows=computed(()=>groupActivities(originals.value).map(group=>{const parts=group.items.map(itemRow);return {...parts[0],ids:group.ids,parts,differences:[...new Set(parts.flatMap(p=>p.differences))]}}))
const itemRow=original=>{const proposed=props.recovery?.proposedSegments?.find(s=>same(s.id,original.id));const changes=props.recovery?.changes?.filter(c=>same(c.segmentId,original.id)) || [];const venue=props.recovery?.proposedVenues?.[String(original.id)] || changes.find(c=>c.venueName)?.venueName;const differences=[];if(proposed && (Date.parse(proposed.starts_at)!==Date.parse(original.starts_at)||Date.parse(proposed.ends_at)!==Date.parse(original.ends_at)))differences.push('Schedule');if(names(original.id)!==names(original.id,true))differences.push('Member');if(venue&&venue!==venues(original.id))differences.push('Facility');return {original,proposed,venue,differences}}
const count=computed(()=>rows.value.filter(r=>r.differences.length).length)
// Only the activities the plan changes, unless the user asks for the rest.
const showUnchanged=ref(false)
const shownRows=computed(()=>(showUnchanged.value?rows.value:rows.value.filter(r=>r.differences.length)).slice().sort((a,b)=>Date.parse(a.original.starts_at)-Date.parse(b.original.starts_at)))
// "11:30–12:30" in Singapore time
const clock=value=>new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value))
const timeRange=segment=>segment?clock(segment.starts_at)+'–'+clock(segment.ends_at):''
// Who is swapped for whom on this activity (once per pair, across crew copies)
function swaps(ids){const pairs=new Map();for(const c of props.recovery?.changes || [])if(c.replacementMemberId!=null&&ids.some(id=>same(id,c.segmentId)))pairs.set(c.replacedMemberId+'>'+c.replacementMemberId,{key:c.replacedMemberId+'>'+c.replacementMemberId,from:member(c.replacedMemberId),to:member(c.replacementMemberId)});return [...pairs.values()]}
const beforeVenue=row=>row.original.venue_name || venues(row.original.id)
// New times per crew copy, grouped; names shown when only some of the crew's copies move
function scheduleLines(row){const moved=row.parts.filter(p=>p.differences.includes('Schedule'));const lines=new Map();for(const p of moved){const to=timeRange(p.proposed);if(!lines.has(to))lines.set(to,{to,from:timeRange(p.original),who:[]});lines.get(to).who.push(...assignments.value.filter(a=>same(a.segment_id,p.original.id)).map(a=>member(a.member_id)))}return [...lines.values()].map(l=>({...l,who:moved.length<row.parts.length?l.who.join(', '):''}))}
</script>
<template>
 <section class="pulse-card p-3 p-lg-4" aria-label="Before and after">
  <div class="d-flex justify-content-between flex-wrap gap-2 mb-2"><h5 class="fw-bold mb-0">Before and after</h5><span v-if="recovery" class="badge bg-light text-dark border">{{ count }} changed {{ count===1?'activity':'activities' }}</span></div>
  <p v-if="!recovery" class="small text-muted mb-0" role="status">Pick a plan above to see what changes.</p><p v-else class="small text-muted">{{ recovery.title }} &middot; {{ recovery.saved?(savedStatus==='Undone'?'Undone - historical proposal; original schedule restored.':savedStatus==='Applied'?'Applied recovery - original and applied records.':'Saved proposal; not applied.'):'Preview only; nothing has changed yet.' }}</p>
  <ul v-if="recovery" class="ba-list list-unstyled mb-2">
   <li v-for="row in shownRows" :key="row.original.id" class="ba-row" :class="{changed:row.differences.length}">
    <div class="ba-activity"><strong>{{ row.original.title }}</strong> <span class="text-muted">&middot; {{ timeRange(row.original) }}<template v-if="row.ids.length>1"> &middot; {{ row.ids.length }} crew</template></span></div>
    <div class="ba-changes">
     <span v-for="line in scheduleLines(row)" :key="line.to"><template v-if="line.who">{{ line.who }}: </template><s>{{ line.from }}</s> &rarr; <strong>{{ line.to }}</strong></span>
     <span v-for="swap in swaps(row.ids)" :key="swap.key"><s>{{ swap.from }}</s> &rarr; <strong>{{ swap.to }}</strong></span>
     <span v-if="row.differences.includes('Facility')"><s>{{ beforeVenue(row) }}</s> &rarr; <strong>{{ row.venue }}</strong></span>
     <span v-if="!row.differences.length" class="text-muted">Unchanged</span>
    </div>
   </li>
  </ul>
  <button v-if="recovery && rows.length>count" type="button" class="btn btn-link btn-sm p-0" @click="showUnchanged=!showUnchanged">{{ showUnchanged?'Show changed activities only':'Show unchanged activities ('+(rows.length-count)+')' }}</button>
 </section>
</template>
<style scoped>.ba-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:.25rem 1rem;padding:.65rem .8rem;border-bottom:1px solid var(--pulse-border);font-size:.85rem;color:var(--pulse-ink-muted)}.ba-row.changed{color:var(--pulse-ink);background:#f3faf6;box-shadow:inset 3px 0 #2b8064}.ba-changes{display:flex;flex-wrap:wrap;gap:.25rem 1.25rem}.ba-changes s{color:var(--pulse-ink-muted)}.ba-changes strong{color:#24664c}summary{cursor:pointer;min-height:32px}</style>
