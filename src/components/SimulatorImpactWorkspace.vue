<script setup>
// Graph, timeline and heatmap share one preview model and playhead so inspecting
// a recovery never replaces the original schedule or writes to the backend.
import {computed,ref,watch,onUnmounted} from 'vue'
import SimulatorEventVillage from './SimulatorEventVillage.vue'
import {buildControlRoomModel,controlRoomTime,recoveryControlRoomResult} from '../services/simulatorControlRoomService.js'
const props=defineProps({data:Object,eventId:[String,Number],result:Object,disruptions:{type:Array,default:()=>[]},loading:Boolean,recovery:Object})
// Selection, disclosure and playback are shared across the three views; none
// of these controls changes the scenario or persisted event schedule.
const timelineView=ref('overlay'),selectedId=ref(null),selectedCell=ref(null)
const selectedDay=ref(''),village=ref(null),dependencyDialog=ref(null),selectedEdge=ref(null)
const previewMode=ref('disrupted'),playhead=ref(0),playing=ref(false),cascadeKey=ref(0)
let playback
const viewResult=computed(()=>previewMode.value==='recovery' && props.recovery?recoveryControlRoomResult(props.eventId,props.recovery):props.result)
const model=computed(()=>buildControlRoomModel(props.data || {},props.eventId,viewResult.value,props.disruptions,{day:selectedDay.value}))
const duration=computed(()=>Math.max(0,(model.value.domain.end-model.value.domain.start)/60000))
// Playback is minutes from the displayed day window, keeping the heatmap
// cursor and Time Machine bars aligned even for events on several dates.
const selectedTime=computed(()=>Number.isFinite(model.value.domain.start)?model.value.domain.start+playhead.value*60000:null)
const playheadStyle=computed(()=>({left:(duration.value?playhead.value/duration.value*100:0)+'%'}))
const activeActivities=computed(()=>model.value.activities.filter(a=>(timelineView.value==='original'?a.originalStart:a.simulatedStart)<=selectedTime.value && selectedTime.value<(timelineView.value==='original'?a.originalEnd:a.simulatedEnd)))
function stopPlayback(){clearInterval(playback);playing.value=false}
function togglePlayback(){
 if(playing.value){stopPlayback();return}
 if(playhead.value>=duration.value)playhead.value=0
 playing.value=true
 playback=setInterval(()=>{playhead.value=Math.min(duration.value,playhead.value+1);if(playhead.value>=duration.value)stopPlayback()},300)
}
function inspectTime(event){stopPlayback();playhead.value=Number(event.target.value)}
function inspectCell(cell,facility){selectedCell.value={...cell,facility};stopPlayback();playhead.value=(cell.start-model.value.domain.start)/60000}
// A new scenario/day invalidates the old cursor and inspected heatmap cell.
watch(model,()=>{stopPlayback();playhead.value=0;selectedCell.value=null})
watch(()=>props.recovery,plan=>{if(!plan)previewMode.value='disrupted';else if(plan.saved)previewMode.value='recovery'})
// Leaving the page must stop its timer instead of advancing an invisible view.
onUnmounted(stopPlayback)
const selected=computed(()=>model.value.activities.find(a=>String(a.id)===String(selectedId.value)))
const statusLabel=status=>status==='direct'?'Direct impact':status==='downstream'?'Downstream risk':'No detected impact'
function selectActivity(activity,preservePlayback=false){selectedId.value=activity.id;const ms=Date.parse(activity.simulated.starts_at);if(!preservePlayback && Number.isFinite(ms)){const day=new Date(ms+8*3600000).toISOString().slice(0,10);if(day!==model.value.day)selectedDay.value=day;}}
function barStyle(bar){return bar?{left:bar.left+'%',width:Math.max(bar.width,0.25)+'%'}:{}}
watch(()=>props.eventId,()=>{selectedEdge.value=null;selectedDay.value='';selectedId.value=null;selectedCell.value=null})
watch(()=>props.result,()=>{selectedEdge.value=null;selectedId.value=null;selectedCell.value=null})

// This disclosure changes presentation only. A quiet heatmap is not evidence
// of vacancy. Existing calculated timing, outage and room-conflict evidence
// determines the default; the user can always inspect linked booking records.
const heatmapOpen=ref(false)
const hasFacilityImpact=computed(()=>model.value.activities.some(a=>a.originalStart!==a.simulatedStart || a.originalEnd!==a.simulatedEnd) ||
 model.value.facilities.some(f=>f.cells.some(c=>['outage','conflict'].includes(c.status))) ||
 Object.keys(viewResult.value?.proposedVenues || {}).length>0 ||
 (viewResult.value?.newConflicts || []).some(c=>/FACILITY|BOOKING|VENUE|CAPACITY/.test(c.type || '')))
watch([()=>props.result,()=>props.recovery,previewMode],()=>{heatmapOpen.value=hasFacilityImpact.value},{immediate:true})
const selectedDependencies=computed(()=>model.value.edges.filter(e=>String(e.from.id)===String(selectedId.value)||String(e.to.id)===String(selectedId.value)))
// Missing intervals cannot support either a changed or unchanged claim.
const scheduleKnown=computed(()=>selected.value && [selected.value.originalStart,selected.value.originalEnd,selected.value.simulatedStart,selected.value.simulatedEnd].every(Number.isFinite))
const scheduleChanged=computed(()=>selected.value && (selected.value.originalStart!==selected.value.simulatedStart || selected.value.originalEnd!==selected.value.simulatedEnd))

// The engine identifies direct causes; join their disruption IDs back to the
// loaded resource records for the compact row, without reclassifying impacts.
const causeRows=computed(()=>{const causes=viewResult.value?.directImpacts?.find(i=>String(i.segmentId)===String(selectedId.value))?.causes || [];return causes.map(c=>{const d=props.disruptions.find(d=>d.id!=null&&String(d.id)===String(c.disruptionId)) || props.disruptions.find(d=>d.type===c.type&&(d.type!=='MEMBER_UNAVAILABLE'||props.data?.segment_assignments?.some(a=>String(a.segment_id)===String(selectedId.value)&&String(a.member_id)===String(d.memberId))));const resource=d?.type==='MEMBER_UNAVAILABLE'?props.data?.members?.find(m=>String(m.id)===String(d.memberId))?.full_name:d?.venueName;return {icon:c.type==='MEMBER_UNAVAILABLE'?'person':c.type==='FACILITY_UNAVAILABLE'?'facility':'time',text:[resource,c.reason].filter(Boolean).join(' \u00b7 ')}})})
// Only immediate recorded edges are contextual dependencies. Cascade status
// still comes from the simulator; a transitive risk is not a new direct edge.
const prerequisites=computed(()=>selectedDependencies.value.filter(e=>String(e.to.id)===String(selectedId.value)))
const dependents=computed(()=>selectedDependencies.value.filter(e=>String(e.from.id)===String(selectedId.value)))
function selectLinked(id){const activity=model.value.activities.find(a=>String(a.id)===String(id));if(activity){selectActivity(activity);dependencyDialog.value?.close();village.value?.focusActivity(id)}}
function clockLabel(value){return Number.isFinite(value)?new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)):'Time unavailable'}
const heatLabel=status=>({'outage':'Outage','conflict':'Conflict','in-use':'Event use','no-event-use':'No event use'}[status] || 'Evidence unavailable')
</script>
<template>
 <section id="simulator-impact" class="sim-impact-workspace" aria-label="Event impact workspace" :aria-busy="loading">
  <div v-if="loading" class="pulse-card p-4" role="status">Loading event activities and booking evidence...</div>
  <div v-else-if="!model.hasSimulation" class="pulse-card p-4 sim-impact-empty">
   <h5 class="fw-bold">Understand the impact</h5><p class="text-muted mb-0">Configure your disruptions and run the simulation to inspect affected activities, dependencies and actual linked booking intervals.</p>
  </div>
  <template v-else>
   <div class="pulse-card p-3 mb-3" v-if="recovery" aria-label="Visualization proposal">
    <strong>{{ previewMode==='recovery' ? recovery.title : 'Disruption impact' }}</strong>
    <div class="d-flex flex-wrap gap-2 mt-2"><button type="button" class="btn btn-pulse-outline btn-sm" :aria-pressed="previewMode==='disrupted'" @click="previewMode='disrupted'">Disruption impact</button><button type="button" class="btn btn-pulse-outline btn-sm" :aria-pressed="previewMode==='recovery'" @click="previewMode='recovery'">Preview selected recovery</button></div>
    <p v-if="previewMode==='recovery'" class="small mb-0 mt-2">Preview only. {{ recovery.metrics ? recovery.metrics.conflictCount+' conflicts; '+recovery.metrics.warningCount+' verification items.' : 'Saved proposal; readiness is checked below.' }} Proposed facilities are not approved bookings.</p>
   </div>
   <section class="sim-visual-grid" :class="{'heatmap-collapsed':!heatmapOpen}" aria-label="Impact visualizations">
    <section id="impact-dependencies" class="pulse-card p-3 p-lg-4 sim-graph-panel" aria-label="Event Village">
     <div class="village-workspace">
      <div class="village-map-panel">
     <div class="d-flex justify-content-between flex-wrap gap-2 mb-2"><h5 class="fw-bold">Event Village</h5><button type="button" class="btn btn-outline-secondary btn-sm" @click="cascadeKey++">Replay cascade</button></div>
     <div class="sim-impact-legend small mb-2"><span class="direct">Direct impact</span><span class="downstream">Downstream risk</span><span>No detected impact</span></div>

     <p v-if="model.cycle" class="alert alert-warning small" role="status">A dependency cycle exists. This graph does not establish a valid activity order.</p>
<SimulatorEventVillage ref="village" @inspect-edge="selectedEdge=$event" :model="model" :selected-id="selectedId" :replay-version="cascadeKey" @select="selectActivity" />
      </div>
      <aside class="impact-sidebar">
       <!-- One shared model supplies map statuses and overview counts; no
            dependency or cascade calculation is duplicated in the UI. -->
       <section aria-label="Impact Overview"><h6 class="fw-bold">Impact Overview</h6><span class="small text-muted" role="status">{{ previewMode==='recovery'?'Recovery preview':'Simulation complete' }}</span>
        <dl class="sim-summary simulator-metrics"><div><dt>Activities</dt><dd data-testid="impact-total">{{ model.activities.length }}</dd></div><div><dt>Direct impact</dt><dd data-testid="impact-direct">{{ model.activities.filter(a=>a.status==='direct').length }}</dd></div><div><dt>Downstream risk</dt><dd data-testid="impact-downstream">{{ model.activities.filter(a=>a.status==='downstream').length }}</dd></div><div><dt>Conflicts</dt><dd data-testid="impact-conflicts">{{ viewResult?.conflictCounts?.total ?? viewResult?.newConflicts?.length ?? 0 }}</dd></div></dl>
       </section>
       <section class="selected-activity" aria-label="Selected Activity"><div class="selected-heading"><h6 class="fw-bold mb-0">Selected Activity</h6><span v-if="selected" class="activity-impact-badge" :class="selected.status">{{ statusLabel(selected.status) }}</span></div><p v-if="!selected" class="small text-muted mt-2">Select an activity to inspect.</p>
        <div v-else class="sim-inspection small" role="status" aria-label="Activity inspector"><h5 class="selected-name">{{ selected.title }}</h5>
         <div v-for="(cause,i) in causeRows" :key="i" class="activity-fact"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0"><path v-if="cause.icon==='person'" d="M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21v-3a8 6 0 0 1 16 0v3Z"/><path v-else-if="cause.icon==='facility'" d="M3 21V7l9-5 9 5v14h-7v-7h-4v7ZM6 8v3h3V8Zm9 0v3h3V8Z"/><path v-else d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m1 4v6l4 3-1 2-5-4V6Z"/></svg><span>{{ cause.text }}</span></div><p v-if="!causeRows.length && selected.causes.length" class="activity-fact">{{ selected.causes[0] }}</p>
         <p class="activity-fact schedule-fact"><span aria-hidden="true">&#9719;</span><span v-if="!scheduleKnown">Schedule evidence unavailable</span><span v-else-if="!scheduleChanged">Schedule unchanged</span><span v-else>Schedule changed: {{ controlRoomTime(selected.simulated.starts_at) }}&ndash;{{ controlRoomTime(selected.simulated.ends_at) }}</span></p>
         <div v-if="selectedDependencies.length" class="selected-dependencies"><h6 class="fw-bold">Dependencies</h6><div v-if="prerequisites.length" class="context-dependencies"><strong>Immediate prerequisites</strong><button v-for="e in prerequisites" :key="e.from.id" type="button" @click="selectLinked(e.from.id)">&larr; {{ e.from.title }}</button></div><div v-if="dependents.length" class="context-dependencies"><strong>Immediate dependents</strong><button v-for="e in dependents" :key="e.to.id" type="button" @click="selectLinked(e.to.id)">&rarr; {{ e.to.title }}</button></div></div>
        </div>
        <button v-if="model.edges.length" type="button" class="btn btn-pulse-outline btn-sm mt-2" @click="dependencyDialog.showModal()">View all dependencies</button>
        <details v-if="selected" class="small mt-3"><summary>Full activity evidence</summary><p v-for="cause in selected.causes" :key="cause">{{ cause }}</p><p>Original: {{ controlRoomTime(selected.starts_at) }}&ndash;{{ controlRoomTime(selected.ends_at) }}</p><p>Simulated: {{ controlRoomTime(selected.simulated.starts_at) }}&ndash;{{ controlRoomTime(selected.simulated.ends_at) }}</p><p>Downstream risk requires review; it is not a confirmed failure.</p><a href="#simulator-recovery">Review recovery options</a></details>
       </section>
       <section v-if="selectedEdge" class="small mt-3" aria-label="Selected dependency"><strong>Recorded direct dependency</strong><div><button type="button" class="btn btn-link btn-sm p-0" @click="selectLinked(selectedEdge.from.id)">{{ selectedEdge.from.title }}</button> &rarr; <button type="button" class="btn btn-link btn-sm p-0" @click="selectLinked(selectedEdge.to.id)">{{ selectedEdge.to.title }}</button></div></section>

      </aside>
     </div>
    </section>
    <dialog v-if="model.edges.length" ref="dependencyDialog" class="dependency-dialog pulse-card" aria-label="All recorded dependencies"><div class="d-flex justify-content-between gap-3"><h6>Recorded dependencies</h6><button type="button" class="btn btn-pulse-outline btn-sm" @click="dependencyDialog.close()">Close dependencies</button></div><p class="small text-muted">Direct prerequisite relationships only. Downstream cascade risk does not add edges.</p><ul><li v-for="(e,i) in model.edges" :key="i"><button type="button" class="btn btn-link btn-sm" @click="selectLinked(e.from.id)">{{ e.from.title }}</button> &rarr; <button type="button" class="btn btn-link btn-sm" @click="selectLinked(e.to.id)">{{ e.to.title }}</button></li></ul></dialog>
    <section id="impact-timeline" class="pulse-card p-3 p-lg-4 sim-time-panel">
     <header class="timeline-header"><div><h6 class="fw-bold mb-1">Time Machine</h6><span class="small text-muted">Explore schedule changes &middot; Singapore time</span></div><div class="timeline-header-controls"><div role="group" aria-label="Timeline display" class="d-flex gap-1"><button v-for="mode in ['original','simulated','overlay']" :key="mode" type="button" class="btn btn-sm text-capitalize" :class="timelineView===mode ? 'btn-pulse-primary' : 'btn-pulse-outline'" :aria-pressed="timelineView===mode" @click="timelineView=mode">{{ mode }}</button></div><button type="button" class="btn btn-pulse-outline btn-sm" :aria-expanded="heatmapOpen" aria-controls="impact-facilities" @click="heatmapOpen=!heatmapOpen">{{ heatmapOpen?'Hide heatmap':'Show heatmap' }}</button></div></header>
<div class="sim-impact-legend small mt-3" role="group" aria-label="Timeline impact colours"><span class="direct">Direct impact</span><span class="downstream">Downstream risk</span><span>No detected impact</span></div>
<div class="sim-schedule-legend small mb-2"><span>&#9648; Original schedule</span><span>&#9648; {{ previewMode==='recovery'?'Proposed recovery':'Simulated schedule' }}</span><span>&#9474; Playback marker</span></div>
     <div v-if="model.days.length>1" class="mb-3"><label class="small fw-bold" for="impact-day">Event day (Singapore)</label><select id="impact-day" class="form-select form-select-sm" :value="model.day" @change="selectedDay=$event.target.value"><option v-for="day in model.days" :key="day" :value="day">{{ day }}</option></select></div>
     <div class="sim-timeline-axis small text-muted"><span>{{ controlRoomTime(model.domain.start) }}</span><span>{{ controlRoomTime(model.domain.end) }}</span></div>
     <div v-for="row in model.timeline" :key="row.id" class="sim-timeline-row">
      <button type="button" class="sim-row-label" @click="selectActivity(row)">{{ row.title }}</button>
      <div class="sim-timeline-lane">
       <button v-if="timelineView!=='simulated' && row.originalBar" type="button" class="sim-time-bar original" :class="{overlay:timelineView==='overlay'}" :style="barStyle(row.originalBar)" :aria-label="'Original '+row.title+': '+controlRoomTime(row.starts_at)+' to '+controlRoomTime(row.ends_at)" @click="selectActivity(row)" :title="row.title+': '+controlRoomTime(row.starts_at)+' to '+controlRoomTime(row.ends_at)"></button>
       <button v-if="timelineView!=='original' && row.simulatedBar" type="button" class="sim-time-bar simulated" :class="[row.status,{overlay:timelineView==='overlay'}]" :style="barStyle(row.simulatedBar)" :aria-label="'Simulated '+row.title+': '+controlRoomTime(row.simulated.starts_at)+' to '+controlRoomTime(row.simulated.ends_at)" @click="selectActivity(row)" :title="row.title+': '+controlRoomTime(row.simulated.starts_at)+' to '+controlRoomTime(row.simulated.ends_at)"></button>
       <span v-if="duration" class="sim-playhead" :style="playheadStyle" aria-hidden="true"></span>
       <span v-if="!row.originalBar && !row.simulatedBar" class="small text-muted">Timing unavailable</span>
      </div>
     </div>
     <div class="sim-transport" v-if="duration">
      <button type="button" class="btn btn-outline-secondary btn-sm" :aria-label="playing?'Pause timeline':'Play timeline'" @click="togglePlayback">{{ playing?'Pause':'Play' }}</button>
      <input type="range" aria-label="Timeline playback time" min="0" :max="duration" step="1" :value="playhead" @input="inspectTime">
      <output class="small" aria-live="off">{{ controlRoomTime(selectedTime) }}</output>
     </div>
     <!-- Selecting an active row must not change day/playhead or pause playback,
          even when original and proposed activity days differ. -->
     <section class="active-activities mt-3" aria-label="Activities at selected time"><div class="d-flex justify-content-between gap-2"><h6>Active at {{ clockLabel(selectedTime) }}</h6><span class="badge bg-light text-dark border">{{ activeActivities.length }} {{ activeActivities.length===1?'activity':'activities' }}</span></div><div class="active-rows"><button v-for="a in activeActivities" :key="a.id" type="button" :class="a.status" :aria-pressed="String(selectedId)===String(a.id)" @click="selectActivity(a,true)"><strong>{{ a.title }}</strong><span>{{ statusLabel(a.status) }}</span></button></div><p v-if="!activeActivities.length" class="small text-muted mb-0">No activities at this time.</p></section>

    </section>
    <section v-show="heatmapOpen" id="impact-facilities" class="pulse-card p-3 p-lg-4 sim-heat-panel">
     <div class="heatmap-heading"><h6 class="fw-bold mb-0">Facility Heatmap</h6><span class="small text-muted">{{ clockLabel(selectedTime) }}</span></div>
     <p class="small text-muted">&ldquo;No event use shown&rdquo; does not mean a room is available or approved.</p>
     <div class="sim-heat-legend small mb-3" aria-label="Heatmap states"><span class="in-use">Event use</span><span class="conflict">Conflict</span><span class="outage">Outage</span><span class="no-event-use">No event use shown</span></div>

     <p v-if="!model.facilities.length" class="small mb-0" role="status">No accessible linked facility bookings for this event. Arrange the original booking through Facility Calendar; no reservation is invented here.</p>
     <p v-if="model.missingLinks" class="alert alert-warning small">Some linked booking records are inaccessible. Verify calendar coverage before acting.</p>
     <div v-for="facility in model.facilities" :key="facility.id" class="sim-facility-row">
      <strong>{{ facility.name }}</strong>
      <details class="small"><summary>Linked booking details</summary><div v-for="booking in facility.bookings" :key="booking.id" class="small text-muted mb-1">Booking {{ booking.id }} &middot; {{ booking.status || 'Approval unverified' }} &middot; {{ booking.booking_date || booking.event_date }} {{ booking.start_time || booking.time_slot }}<span v-if="booking.end_time">&ndash;{{ booking.end_time }}</span></div></details>
      <p class="small text-muted sim-scroll-hint">Swipe or scroll horizontally for later time intervals.</p>
      <div class="sim-heat-scroll" tabindex="0" role="region" :aria-label="facility.name+' scrollable usage intervals'"><div class="sim-heat-labels small" :style="{gridTemplateColumns:'repeat('+facility.cells.length+', minmax(4.5rem,1fr))'}"><span v-for="cell in facility.cells" :key="cell.start">{{ new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(cell.start)) }}</span></div>
      <div class="sim-heat-cells" :style="{gridTemplateColumns:'repeat('+Math.max(1,facility.cells.length)+', minmax(4.5rem, 1fr))'}" role="group" :aria-label="facility.name+' booking timeline'">
       <button v-for="(cell,i) in facility.cells" :key="i" type="button" class="sim-heat-cell" :class="[cell.status,{current:selectedTime>=cell.start && selectedTime<cell.end,'is-selected':selectedCell?.start===cell.start && selectedCell?.facility===facility.name}]" :aria-pressed="selectedCell?.start===cell.start && selectedCell?.facility===facility.name" :aria-label="facility.name+': '+controlRoomTime(cell.start)+' to '+controlRoomTime(cell.end)+', '+cell.label" :title="controlRoomTime(cell.start)+' to '+controlRoomTime(cell.end)+': '+cell.label" @click="inspectCell(cell,facility.name)"><span class="visually-hidden">{{ cell.label }}</span><span aria-hidden="true">{{ heatLabel(cell.status) }}</span></button>
      </div></div>
     </div>
     <p v-if="!selectedCell" class="small text-muted mt-2 mb-0">Select a slot to inspect its recorded evidence.</p><div v-if="selectedCell" class="sim-inspection selected-slot small mt-3" role="status" aria-label="Selected facility slot"><strong>Selected slot</strong><br><strong>{{ selectedCell.facility }}</strong> &middot; {{ controlRoomTime(selectedCell.start) }}&ndash;{{ controlRoomTime(selectedCell.end) }} &middot; {{ selectedCell.label }}<div>{{ selectedCell.activities.join(', ') || 'No event activity in this interval.' }}</div><p v-for="reason in selectedCell.conflictDetails" :key="reason" class="mb-0">{{ reason }}</p></div>
    </section>
   </section>
  </template>
 </section>
</template>
<style scoped>
.sim-impact-workspace{min-width:0}.sim-impact-empty{display:flex;flex-direction:column}
.sim-activity-detail{border-top:1px solid var(--pulse-border);padding:.75rem 0}.sim-activity-detail summary{display:flex;flex-wrap:wrap;gap:.45rem .65rem;align-items:center;cursor:pointer;list-style:none}.sim-activity-detail summary::after{content:'+';margin-left:auto;font-weight:700}.sim-activity-detail[open] summary::after{content:'-'}.sim-status-label{font-size:.7rem;font-weight:700;border-radius:.3rem;padding:.2rem .45rem;background:var(--pulse-bg);color:var(--pulse-ink-muted)}.direct .sim-status-label{background:var(--pulse-primary-light);color:var(--pulse-primary)}.downstream .sim-status-label{background:var(--pulse-amber-bg);color:var(--pulse-amber)}
.sim-timeline-axis{display:flex;justify-content:space-between;gap:1rem;margin-left:30%;padding-bottom:.4rem}.sim-timeline-row{display:grid;grid-template-columns:28% minmax(0,1fr);gap:2%;padding:.65rem 0;border-top:1px solid var(--pulse-border);align-items:center}.sim-row-label{border:0;background:none;color:var(--pulse-ink);font-size:.75rem;text-align:left;padding:0;overflow-wrap:anywhere}.sim-timeline-lane{height:44px;position:relative;background:var(--pulse-bg);border-radius:.35rem;min-width:0}.sim-time-bar{position:absolute;min-width:4px;top:5px;height:32px;border-radius:.25rem;border:1px solid var(--pulse-border-hover);background:var(--pulse-border);color:var(--pulse-ink);font-size:.62rem;overflow:hidden;padding:0}.sim-time-bar.original.overlay{height:12px;top:3px}.sim-time-bar.simulated.overlay{height:19px;top:21px}.sim-time-bar.simulated{background:var(--pulse-blue-bg);border-color:var(--pulse-blue-border)}.sim-time-bar.direct{background:var(--pulse-primary-light);border-color:var(--pulse-primary-border)}.sim-time-bar.downstream{background:var(--pulse-amber-bg);border-color:var(--pulse-amber-border)}.sim-time-bar.original.overlay span{visibility:hidden}
.sim-facility-row{padding:.8rem 0;border-top:1px solid var(--pulse-border);overflow-wrap:anywhere}.sim-heat-cells{display:grid;gap:3px;margin-top:.5rem;overflow-x:auto}.sim-heat-cell{min-height:2.25rem;border:1px solid var(--pulse-border);border-radius:.25rem;color:var(--pulse-ink-muted);background:var(--pulse-bg);font-weight:700}.sim-heat-cell.in-use{background:var(--pulse-blue-bg);border-color:var(--pulse-blue-border);color:var(--pulse-blue)}.sim-heat-cell.outage{background:var(--pulse-primary-light);border-color:var(--pulse-primary-border);color:var(--pulse-primary)}.sim-heat-cell.conflict{background:var(--pulse-amber-bg);border-color:var(--pulse-amber-border);color:var(--pulse-amber)}.sim-inspection{padding:.8rem;border:1px solid var(--pulse-border);border-radius:.5rem;background:var(--pulse-bg)}
button:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--pulse-primary);outline-offset:3px}
@media(max-width:575px){.sim-timeline-row{grid-template-columns:1fr;gap:.35rem}.sim-timeline-axis{margin-left:0}.sim-activity-detail summary strong{flex-basis:100%}}
.sim-visual-grid{align-items:start;display:grid;grid-template-columns:minmax(0,1fr);gap:1rem}.sim-visual-grid>div,.sim-graph-panel{grid-column:1/-1}.sim-visual-grid>section{min-width:0;scroll-margin-top:1rem}
.sim-heat-scroll{overflow-x:auto;padding:3px}.sim-heat-labels{display:grid;gap:3px;min-width:max-content}.sim-heat-cells{overflow:visible;min-width:max-content}.sim-heat-labels span{font-size:.6rem;overflow-wrap:anywhere}.sim-heat-cell.current{outline:2px solid var(--pulse-ink);outline-offset:1px}.sim-heat-legend{display:flex;flex-wrap:wrap;gap:.4rem 1rem}
.sim-impact-legend{display:flex;flex-wrap:wrap;gap:1rem}.sim-impact-legend span:before{content:"";display:inline-block;width:.6rem;height:.6rem;border-radius:50%;background:var(--pulse-border-hover);margin-right:.35rem}.sim-impact-legend .direct:before{background:var(--pulse-primary)}.sim-impact-legend .downstream:before{background:var(--pulse-amber)}
.sim-transport{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-top:1rem}.sim-transport input{flex:1;min-width:6rem;accent-color:var(--pulse-primary)}.sim-playhead{position:absolute;inset-block:0;width:2px;background:var(--pulse-primary);pointer-events:none;z-index:1}
@media(min-width:1024px){.sim-visual-grid{grid-template-columns:minmax(0,13fr) minmax(0,7fr);align-items:stretch}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto;animation:none!important}}
.sim-schedule-legend{display:flex;flex-wrap:wrap;gap:.5rem 1rem}.sim-schedule-legend span:first-child{color:var(--pulse-ink-muted)}.sim-schedule-legend span:nth-child(2){color:var(--pulse-blue)}.sim-schedule-legend span:last-child{color:var(--pulse-primary)}
.sim-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.6rem}.sim-summary>div{padding:.75rem;background:var(--pulse-bg);border-radius:.65rem}.sim-summary strong{display:block;font-size:1.5rem}.sim-summary span{font-size:.75rem;color:var(--pulse-ink-muted)}@media(max-width:575px){.sim-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
.sim-impact-legend span:not(.direct):not(.downstream):before{background:var(--pulse-blue)}
.village-workspace{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,1fr);gap:1.25rem}.village-map-panel,.impact-sidebar{min-width:0}.impact-sidebar{border-left:1px solid var(--pulse-border);padding-left:1rem}.sim-summary{grid-template-columns:repeat(2,minmax(0,1fr));margin:.75rem 0 1.25rem}.sim-summary dt{font-size:.75rem;font-weight:500;color:var(--pulse-ink-muted)}.sim-summary dd{font-size:1.5rem;font-weight:750;margin:0}.selected-activity{border-top:1px solid var(--pulse-border);padding-top:1rem}.sim-inspection{background:transparent;border:0;padding:0}.sim-time-panel,.sim-heat-panel{min-width:0}.heatmap-collapsed .sim-time-panel{grid-column:1/-1}.sim-visual-grid .sim-graph-panel{grid-column:1/-1}.sim-visual-grid{align-items:stretch}@media(max-width:1023px){.village-workspace{grid-template-columns:1fr}.impact-sidebar{border-left:0;padding-left:0}.impact-sidebar{display:grid;grid-template-columns:1fr 1fr;gap:1rem}}@media(max-width:575px){.impact-sidebar{grid-template-columns:1fr}}button[aria-pressed=true]{background:var(--pulse-primary-light);border-color:var(--pulse-primary);color:var(--pulse-primary)}
/* Large workspaces must remain aligned while a pointer moves between panels. */
.pulse-card:hover{transform:none}
.timeline-header,.timeline-header-controls{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:start;gap:.65rem}.timeline-header-controls{justify-content:end}.sim-playhead{background:transparent;border-left:2px dashed var(--pulse-ink)}.sim-schedule-legend span:last-child{color:var(--pulse-ink)}.active-rows{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem}.active-rows button{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;min-width:0;gap:.5rem;border:1px solid var(--pulse-border);border-radius:.6rem;padding:.65rem;background:var(--pulse-card-bg);color:var(--pulse-ink);text-align:left;font-size:.75rem}.active-rows strong{min-width:0;overflow-wrap:anywhere}.active-rows span{display:inline-flex;align-self:center;flex:0 0 auto;width:fit-content;height:fit-content;line-height:1.4;font-size:.7rem;border-radius:.3rem;padding:.15rem .35rem;background:var(--pulse-blue-bg)}.active-rows .direct span{background:var(--pulse-primary-light)}.active-rows .downstream span{background:var(--pulse-amber-bg)}.context-dependencies button{display:block;background:none;border:0;padding:.3rem 0;text-align:left;color:var(--pulse-primary);font-size:.8rem}.dependency-dialog{width:min(92vw,42rem);max-height:80vh;overflow:auto;padding:1.25rem;color:var(--pulse-ink);border:1px solid var(--pulse-border)}.dependency-dialog::backdrop{background:#1a243b66}.dependency-dialog li{margin:.3rem 0}.sim-heat-cell{font-size:.62rem;padding:.4rem .2rem;min-height:2.65rem}.sim-heat-cell.is-selected{outline:2px solid var(--pulse-primary);outline-offset:2px}.selected-slot{border:1px solid var(--pulse-primary-border);border-radius:.6rem;padding:.7rem;background:var(--pulse-primary-light)}.sim-heat-legend span:before{content:'';display:inline-block;width:.6rem;height:.6rem;border-radius:50%;background:var(--pulse-border-hover);margin-right:.3rem}.sim-heat-legend .in-use:before{background:var(--pulse-blue)}.sim-heat-legend .conflict:before{background:var(--pulse-amber)}.sim-heat-legend .outage:before{background:var(--pulse-primary)}@media(max-width:575px){.active-rows{grid-template-columns:1fr}}
.selected-heading,.heatmap-heading{display:flex;justify-content:space-between;align-items:center;gap:.5rem}.activity-impact-badge{font-size:.65rem;font-weight:700;padding:.3rem .45rem;border-radius:.4rem;background:var(--pulse-blue-bg);white-space:nowrap}.activity-impact-badge.direct{background:var(--pulse-primary-light);color:var(--pulse-primary)}.activity-impact-badge.downstream{background:var(--pulse-amber-bg);color:var(--pulse-amber)}.selected-name{font-size:1.05rem;font-weight:750;line-height:1.4;margin:.8rem 0 .6rem}.activity-fact{display:flex;gap:.4rem;align-items:baseline;margin:.6rem 0}.selected-dependencies{border-top:1px solid var(--pulse-border);margin-top:1rem;padding-top:1rem}.context-dependencies strong{font-size:.7rem;font-weight:500;color:var(--pulse-ink-muted)}.sim-timeline-row{padding:.4rem 0}.sim-timeline-lane{height:35px}.sim-time-bar.original.overlay{height:10px;top:2px}.sim-time-bar.simulated.overlay{height:15px;top:17px}.sim-time-bar:not(.overlay){height:25px;top:5px}.sim-heat-cell{font-size:.72rem}.heatmap-heading{margin-bottom:.7rem}
</style>
