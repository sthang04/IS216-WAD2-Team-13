<script setup>
import {computed,ref,watch,onUnmounted} from 'vue'
import {buildControlRoomModel,controlRoomTime,recoveryControlRoomResult} from '../services/simulatorControlRoomService.js'
const props=defineProps({data:Object,eventId:[String,Number],result:Object,disruptions:{type:Array,default:()=>[]},loading:Boolean,recovery:Object})
const tab=ref('dependencies'),timelineView=ref('overlay'),selectedId=ref(null),expanded=ref([]),selectedCell=ref(null)
const selectedDay=ref('')
const previewMode=ref('disrupted'),playhead=ref(0),playing=ref(false),cascadeKey=ref(0)
let playback
const viewResult=computed(()=>previewMode.value==='recovery' && props.recovery?recoveryControlRoomResult(props.eventId,props.recovery):props.result)
const model=computed(()=>buildControlRoomModel(props.data || {},props.eventId,viewResult.value,props.disruptions,{day:selectedDay.value}))
const duration=computed(()=>Math.max(0,(model.value.domain.end-model.value.domain.start)/60000))
const selectedTime=computed(()=>model.value.domain.start+playhead.value*60000)
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
function goTo(view){tab.value=view;document.getElementById('impact-'+view)?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'})}
watch(model,()=>{stopPlayback();playhead.value=0;selectedCell.value=null;cascadeKey.value++})
watch(()=>props.recovery,plan=>{if(!plan)previewMode.value='disrupted';else if(plan.saved)previewMode.value='recovery'})
onUnmounted(stopPlayback)
const selected=computed(()=>model.value.activities.find(a=>String(a.id)===String(selectedId.value)))
const statusLabel=status=>status==='direct'?'Direct impact':status==='downstream'?'Downstream risk':'No detected impact'
function selectActivity(activity){selectedId.value=activity.id;const ms=Date.parse(activity.simulated.starts_at);if(Number.isFinite(ms)){const day=new Date(ms+8*3600000).toISOString().slice(0,10);if(day!==model.value.day)selectedDay.value=day;}if(!expanded.value.includes(String(activity.id)))expanded.value.push(String(activity.id))}
function toggleActivity(id){const value=String(id);expanded.value=expanded.value.includes(value)?expanded.value.filter(x=>x!==value):[...expanded.value,value]}
function expandAll(){expanded.value=expanded.value.length===model.value.affected.length?[]:model.value.affected.map(a=>String(a.id))}
function barStyle(bar){return bar?{left:bar.left+'%',width:Math.max(bar.width,0.25)+'%'}:{}}
watch(()=>props.eventId,()=>{selectedDay.value='';selectedId.value=null;expanded.value=[];selectedCell.value=null})
watch(()=>props.result,()=>{selectedId.value=null;expanded.value=[];selectedCell.value=null})
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
    <div class="d-flex flex-wrap gap-2 mt-2"><button type="button" class="btn btn-outline-secondary btn-sm" :aria-pressed="previewMode==='disrupted'" @click="previewMode='disrupted'">Disruption impact</button><button type="button" class="btn btn-outline-secondary btn-sm" :aria-pressed="previewMode==='recovery'" @click="previewMode='recovery'">Preview selected recovery</button></div>
    <p v-if="previewMode==='recovery'" class="small mb-0 mt-2"><template v-if="recovery.metrics">{{ recovery.metrics.conflictCount }} unresolved checks; {{ recovery.metrics.warningCount }} verification requirements.</template><template v-else>Saved proposal preview. Review its authoritative requirements below; this view does not certify eligibility.</template> Proposed venues are not approved bookings. Review all outstanding requirements below.</p>
    <ul v-if="previewMode==='recovery'" class="small mb-0"><li v-for="(venue,id) in recovery.proposedVenues" :key="id">{{ model.activities.find(a=>String(a.id)===String(id))?.title }}: proposed {{ venue }}. Arrange and verify its calendar booking before applying.</li></ul>
   </div>
   <section class="pulse-card p-3 p-lg-4 mb-3" aria-label="Affected activities overview">
    <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
     <div><span class="small text-uppercase text-muted fw-bold">Impact overview</span><h5 class="fw-bold mb-1">Affected activities <span class="badge bg-light text-dark border">{{ model.affected.length }}</span></h5></div>
     <button v-if="model.affected.length" type="button" class="btn btn-outline-secondary btn-sm" @click="expandAll">{{ expanded.length===model.affected.length?'Collapse all':'Expand all' }}</button>
    </div>
    <p class="text-muted small">Direct impacts come from the simulation engine. Downstream risks indicate dependencies to review, not confirmed failures.</p>
    <p v-if="!model.affected.length" class="mb-0 small" role="status">No affected activities detected for this simulation.</p>
    <details v-for="activity in model.affected" :key="activity.id" :open="expanded.includes(String(activity.id))" class="sim-activity-detail" :class="activity.status">
     <summary @click.prevent="toggleActivity(activity.id)"><span class="sim-status-label">{{ statusLabel(activity.status) }}</span><strong>{{ activity.title }}</strong><span class="text-muted small">{{ controlRoomTime(activity.simulated.starts_at) }}&ndash;{{ controlRoomTime(activity.simulated.ends_at) }}</span></summary>
     <div class="small pt-2"><p v-for="cause in activity.causes" :key="cause" class="mb-1">{{ cause }}</p><p class="text-muted mb-1">Original: {{ controlRoomTime(activity.starts_at) }}&ndash;{{ controlRoomTime(activity.ends_at) }}</p></div>
    </details>
   </section>
   <div class="pulse-card p-3 mb-3" v-if="model.days.length" aria-label="Visualization date">
    <label class="small fw-bold" for="impact-day">Event day (Singapore)</label>
    <select id="impact-day" class="form-select form-select-sm" :value="model.day" @change="selectedDay=$event.target.value"><option v-for="day in model.days" :key="day" :value="day">{{ day }}</option></select>
    <p class="small text-muted mb-0 mt-2">Timeline and facility use show this day only. Select another event day to inspect later activities.</p>
   </div>
   <section class="sim-visual-grid" aria-label="Impact visualizations">
    <div class="d-flex flex-wrap gap-2 mb-3" role="group" aria-label="Impact view">
     <button v-for="view in [{id:'dependencies',label:'Dependency map'},{id:'timeline',label:'Timeline'},{id:'facilities',label:'Facility use'}]" :key="view.id" type="button" class="btn btn-sm" :class="tab===view.id?'btn-pulse-primary':'btn-pulse-outline'" :aria-pressed="tab===view.id" @click="goTo(view.id)">{{ view.label }}</button>
    </div>
    <section id="impact-dependencies" class="pulse-card p-3 p-lg-4 sim-graph-panel">
     <div class="d-flex justify-content-between gap-2 mb-2"><h6 class="fw-bold">Disruption impact graph</h6><button type="button" class="btn btn-outline-secondary btn-sm" @click="cascadeKey++">Replay cascade</button></div>
     <p class="small text-muted">Select an activity to inspect it. Lines show recorded prerequisites.</p><div class="sim-impact-legend small mb-2"><span class="direct">Direct impact</span><span class="downstream">Downstream risk</span><span>Unchanged</span></div>
     <p class="small text-muted sim-scroll-hint">Scroll horizontally to follow all activities. Select an activity to inspect it.</p>
     <p v-if="model.cycle" class="alert alert-warning small" role="status">A dependency cycle exists. This graph does not establish a valid activity order.</p>
     <div v-if="model.nodes.length" class="sim-graph-scroll" tabindex="0" role="region" aria-label="Scrollable activity dependency graph">
      <div :key="cascadeKey" class="sim-graph-canvas" :style="{width:model.graphWidth+'px',height:model.graphHeight+'px'}">
       <svg :width="model.graphWidth" :height="model.graphHeight" aria-hidden="true" class="sim-graph-lines">
        <g v-for="(edge,i) in model.edges" :key="i" :class="edge.from.status">
         <path :d="'M '+(edge.from.x+210)+' '+(edge.from.y+45)+' C '+(edge.from.x+240)+' '+(edge.from.y+45)+', '+(edge.to.x-30)+' '+(edge.to.y+45)+', '+edge.to.x+' '+(edge.to.y+45)" />
         <path :d="'M '+(edge.to.x-7)+' '+(edge.to.y+40)+' L '+edge.to.x+' '+(edge.to.y+45)+' L '+(edge.to.x-7)+' '+(edge.to.y+50)" />
        </g>
       </svg>
       <button v-for="node in model.nodes" :key="node.id" type="button" class="sim-graph-node" :class="[node.status,{selected:String(selectedId)===String(node.id)}]" :style="{left:node.x+'px',top:node.y+'px',animationDelay:(node.level*180)+'ms'}" :aria-pressed="String(selectedId)===String(node.id)" :aria-label="node.title+': '+statusLabel(node.status)" @click="selectActivity(node)"><strong>{{ node.title }}</strong><span>{{ controlRoomTime(node.simulated.starts_at) }}</span><small>{{ statusLabel(node.status) }}</small></button>
      </div>
     </div>
     <details class="small mt-3"><summary>Dependency relationships ({{ model.edges.length }})</summary><ul v-if="model.edges.length" class="mt-2 mb-0"><li v-for="(edge,i) in model.edges" :key="i">{{ edge.from.title }} &rarr; {{ edge.to.title }}</li></ul><p v-else class="mt-2 mb-0">No recorded dependencies for this event.</p></details>
    </section>
    <section id="impact-timeline" class="pulse-card p-3 p-lg-4 sim-time-panel">
     <div class="d-flex justify-content-between flex-wrap gap-2 mb-3"><div><h6 class="fw-bold mb-1">Time Machine</h6><span class="small text-muted">Singapore time &middot; preview only &middot; select a bar to inspect</span></div><div role="group" aria-label="Timeline display" class="d-flex gap-1"><button v-for="mode in ['original','simulated','overlay']" :key="mode" type="button" class="btn btn-sm text-capitalize" :class="timelineView===mode ? 'btn-pulse-primary' : 'btn-pulse-outline'" :aria-pressed="timelineView===mode" @click="timelineView=mode">{{ mode }}</button></div></div>
     <div class="sim-timeline-axis small text-muted"><span>{{ controlRoomTime(model.domain.start) }}</span><span>{{ controlRoomTime(model.domain.end) }}</span></div>
     <div v-for="row in model.timeline" :key="row.id" class="sim-timeline-row">
      <button type="button" class="sim-row-label" @click="selectActivity(row)">{{ row.title }}</button>
      <div class="sim-timeline-lane">
       <button v-if="timelineView!=='simulated' && row.originalBar" type="button" class="sim-time-bar original" :class="{overlay:timelineView==='overlay'}" :style="barStyle(row.originalBar)" :aria-label="'Original '+row.title+': '+controlRoomTime(row.starts_at)+' to '+controlRoomTime(row.ends_at)" @click="selectActivity(row)" :title="row.title+': '+controlRoomTime(row.starts_at)+' to '+controlRoomTime(row.ends_at)"><span>Original</span></button>
       <button v-if="timelineView!=='original' && row.simulatedBar" type="button" class="sim-time-bar simulated" :class="[row.status,{overlay:timelineView==='overlay'}]" :style="barStyle(row.simulatedBar)" :aria-label="'Simulated '+row.title+': '+controlRoomTime(row.simulated.starts_at)+' to '+controlRoomTime(row.simulated.ends_at)" @click="selectActivity(row)" :title="row.title+': '+controlRoomTime(row.simulated.starts_at)+' to '+controlRoomTime(row.simulated.ends_at)"><span>{{ previewMode==='recovery'?'Recovery':'Simulated' }}</span></button>
       <span v-if="duration" class="sim-playhead" :style="playheadStyle" aria-hidden="true"></span>
       <span v-if="!row.originalBar && !row.simulatedBar" class="small text-muted">Timing unavailable</span>
      </div>
     </div>
     <div class="sim-transport" v-if="duration">
      <button type="button" class="btn btn-outline-secondary btn-sm" :aria-label="playing?'Pause timeline':'Play timeline'" @click="togglePlayback">{{ playing?'Pause':'Play' }}</button>
      <input type="range" aria-label="Timeline playback time" min="0" :max="duration" step="1" :value="playhead" @input="inspectTime">
      <output class="small" aria-live="off">{{ controlRoomTime(selectedTime) }}</output>
     </div>
     <div class="small mt-2" aria-label="Activities at selected time"><strong>{{ activeActivities.length }} active activities</strong><div v-for="a in activeActivities" :key="a.id"><button type="button" class="btn btn-link btn-sm p-0" @click="selectActivity(a)">{{ a.title }}</button></div></div>
     <p class="small text-muted mt-3 mb-0">Timeline inspection does not edit schedules. Use validated recovery options for proposed changes.</p>
    </section>
    <section id="impact-facilities" class="pulse-card p-3 p-lg-4 sim-heat-panel">
     <h6 class="fw-bold">Facility impact heatmap</h6>
     <p class="small text-muted">Linked bookings only. Usage follows the current preview. &ldquo;No event use shown&rdquo; does not mean a room is available or approved.</p>
     <div class="sim-heat-legend small mb-3"><span>o Event activity</span><span>x Scheduling conflict</span><span>! Simulated outage</span><span>- No event use shown</span></div>
     <p class="small text-muted">Inspection time: {{ controlRoomTime(selectedTime) }}</p>
     <p v-if="!model.facilities.length" class="small mb-0" role="status">No accessible linked facility bookings for this event. Arrange the original booking through Facility Calendar; no reservation is invented here.</p>
     <p v-if="model.missingLinks" class="alert alert-warning small">Some linked booking records are inaccessible. Verify calendar coverage before acting.</p>
     <div v-for="facility in model.facilities" :key="facility.id" class="sim-facility-row">
      <strong>{{ facility.name }}</strong>
      <details class="small"><summary>Linked booking details</summary><div v-for="booking in facility.bookings" :key="booking.id" class="small text-muted mb-1">Booking {{ booking.id }} &middot; {{ booking.status || 'Approval unverified' }} &middot; {{ booking.booking_date || booking.event_date }} {{ booking.start_time || booking.time_slot }}<span v-if="booking.end_time">&ndash;{{ booking.end_time }}</span></div></details>
      <p class="small text-muted sim-scroll-hint">Swipe or scroll horizontally for later time intervals.</p>
      <div class="sim-heat-scroll" tabindex="0" role="region" :aria-label="facility.name+' scrollable usage intervals'"><div class="sim-heat-labels small" :style="{gridTemplateColumns:'repeat('+facility.cells.length+', minmax(3.5rem,1fr))'}"><span v-for="cell in facility.cells" :key="cell.start">{{ new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(cell.start)) }}</span></div>
      <div class="sim-heat-cells" :style="{gridTemplateColumns:'repeat('+Math.max(1,facility.cells.length)+', minmax(3.5rem, 1fr))'}" role="group" :aria-label="facility.name+' booking timeline'">
       <button v-for="(cell,i) in facility.cells" :key="i" type="button" class="sim-heat-cell" :class="[cell.status,{current:selectedTime>=cell.start && selectedTime<cell.end}]" :aria-label="facility.name+': '+controlRoomTime(cell.start)+' to '+controlRoomTime(cell.end)+', '+cell.label" :title="controlRoomTime(cell.start)+' to '+controlRoomTime(cell.end)+': '+cell.label" @click="inspectCell(cell,facility.name)"><span class="visually-hidden">{{ cell.label }}</span><span aria-hidden="true">{{ cell.status==='outage'?'!':cell.status==='conflict'?'x':cell.status==='in-use'?'o':'-' }}</span></button>
      </div></div>
     </div>
     <div v-if="selectedCell" class="sim-inspection small mt-3" role="status"><strong>{{ selectedCell.facility }}</strong> &middot; {{ controlRoomTime(selectedCell.start) }}&ndash;{{ controlRoomTime(selectedCell.end) }} &middot; {{ selectedCell.label }}<div>{{ selectedCell.activities.join(', ') || 'No event activity in this interval.' }}</div><p v-for="reason in selectedCell.conflictDetails" :key="reason" class="mb-0">{{ reason }}</p></div>
    </section>
    <div v-if="selected" class="sim-inspection small mt-3" role="status"><strong>{{ selected.title }}</strong> &middot; {{ statusLabel(selected.status) }}<div>Original: {{ controlRoomTime(selected.starts_at) }}&ndash;{{ controlRoomTime(selected.ends_at) }}</div><div>Simulated: {{ controlRoomTime(selected.simulated.starts_at) }}&ndash;{{ controlRoomTime(selected.simulated.ends_at) }}</div><p v-for="cause in selected.causes" :key="cause" class="mb-0 mt-1">{{ cause }}</p></div>
   </section>
  </template>
 </section>
</template>
<style scoped>
.sim-impact-workspace{min-width:0}.sim-impact-empty{height:100%;display:flex;flex-direction:column;justify-content:center;min-height:18rem}
.sim-activity-detail{border-top:1px solid var(--pulse-border);padding:.75rem 0}.sim-activity-detail summary{display:flex;flex-wrap:wrap;gap:.45rem .65rem;align-items:center;cursor:pointer;list-style:none}.sim-activity-detail summary::after{content:'+';margin-left:auto;font-weight:700}.sim-activity-detail[open] summary::after{content:'-'}.sim-status-label{font-size:.7rem;font-weight:700;border-radius:.3rem;padding:.2rem .45rem;background:var(--pulse-bg);color:var(--pulse-ink-muted)}.direct .sim-status-label{background:var(--pulse-primary-light);color:var(--pulse-primary)}.downstream .sim-status-label{background:var(--pulse-amber-bg);color:var(--pulse-amber)}
.sim-graph-scroll{overflow:auto;border:1px solid var(--pulse-border);border-radius:.65rem;background:var(--pulse-bg)}.sim-graph-canvas{position:relative}.sim-graph-lines{position:absolute;inset:0;pointer-events:none}.sim-graph-lines path{fill:none;stroke:var(--pulse-border-hover);stroke-width:2}.sim-graph-lines .direct path{stroke:var(--pulse-primary)}.sim-graph-lines .downstream path{stroke:var(--pulse-amber)}.sim-graph-node{position:absolute;width:210px;height:112px;text-align:left;border:1px solid var(--pulse-border);border-radius:.65rem;padding:.65rem;background:var(--pulse-card-bg);color:var(--pulse-ink);display:flex;flex-direction:column;gap:.2rem;overflow:hidden}.sim-graph-node strong{font-size:.8rem;line-height:1.2}.sim-graph-node span,.sim-graph-node small{font-size:.68rem;color:var(--pulse-ink-muted)}.sim-graph-node.direct{border-color:var(--pulse-primary-border);background:var(--pulse-primary-light)}.sim-graph-node.downstream{border-color:var(--pulse-amber-border);background:var(--pulse-amber-bg)}.sim-graph-node.selected{outline:2px solid var(--pulse-primary);outline-offset:2px}
.sim-timeline-axis{display:flex;justify-content:space-between;gap:1rem;margin-left:30%;padding-bottom:.4rem}.sim-timeline-row{display:grid;grid-template-columns:28% minmax(0,1fr);gap:2%;padding:.65rem 0;border-top:1px solid var(--pulse-border);align-items:center}.sim-row-label{border:0;background:none;color:var(--pulse-ink);font-size:.75rem;text-align:left;padding:0;overflow-wrap:anywhere}.sim-timeline-lane{height:44px;position:relative;background:var(--pulse-bg);border-radius:.35rem;min-width:0}.sim-time-bar{position:absolute;min-width:4px;top:5px;height:32px;border-radius:.25rem;border:1px solid var(--pulse-border-hover);background:var(--pulse-border);color:var(--pulse-ink);font-size:.62rem;overflow:hidden;padding:0}.sim-time-bar.original.overlay{height:12px;top:3px}.sim-time-bar.simulated.overlay{height:19px;top:21px}.sim-time-bar.simulated{background:var(--pulse-blue-bg);border-color:var(--pulse-blue-border)}.sim-time-bar.direct{background:var(--pulse-primary-light);border-color:var(--pulse-primary-border)}.sim-time-bar.downstream{background:var(--pulse-amber-bg);border-color:var(--pulse-amber-border)}.sim-time-bar.original.overlay span{visibility:hidden}
.sim-facility-row{padding:.8rem 0;border-top:1px solid var(--pulse-border);overflow-wrap:anywhere}.sim-heat-cells{display:grid;gap:3px;margin-top:.5rem;overflow-x:auto}.sim-heat-cell{min-height:2.25rem;border:1px solid var(--pulse-border);border-radius:.25rem;color:var(--pulse-ink-muted);background:var(--pulse-bg);font-weight:700}.sim-heat-cell.in-use{background:var(--pulse-blue-bg);border-color:var(--pulse-blue-border);color:var(--pulse-blue)}.sim-heat-cell.outage{background:var(--pulse-primary-light);border-color:var(--pulse-primary-border);color:var(--pulse-primary)}.sim-heat-cell.conflict{background:var(--pulse-amber-bg);border-color:var(--pulse-amber-border);color:var(--pulse-amber)}.sim-inspection{padding:.8rem;border:1px solid var(--pulse-border);border-radius:.5rem;background:var(--pulse-bg)}
button:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--pulse-primary);outline-offset:3px}
@media(max-width:575px){.sim-timeline-row{grid-template-columns:1fr;gap:.35rem}.sim-timeline-axis{margin-left:0}.sim-activity-detail summary strong{flex-basis:100%}}
.sim-visual-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:1rem}.sim-visual-grid>div,.sim-graph-panel{grid-column:1/-1}.sim-visual-grid>section{min-width:0;scroll-margin-top:1rem}
.sim-heat-scroll{overflow-x:auto;padding:3px}.sim-heat-labels{display:grid;gap:3px;min-width:max-content}.sim-heat-cells{overflow:visible;min-width:max-content}.sim-heat-labels span{font-size:.6rem;overflow-wrap:anywhere}.sim-heat-cell.current{outline:2px solid var(--pulse-ink);outline-offset:1px}.sim-heat-legend{display:flex;flex-wrap:wrap;gap:.4rem 1rem}
.sim-impact-legend{display:flex;flex-wrap:wrap;gap:1rem}.sim-impact-legend span:before{content:"";display:inline-block;width:.6rem;height:.6rem;border-radius:50%;background:var(--pulse-border-hover);margin-right:.35rem}.sim-impact-legend .direct:before{background:var(--pulse-primary)}.sim-impact-legend .downstream:before{background:var(--pulse-amber)}
.sim-transport{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-top:1rem}.sim-transport input{flex:1;min-width:6rem;accent-color:var(--pulse-primary)}.sim-playhead{position:absolute;inset-block:0;width:2px;background:var(--pulse-primary);pointer-events:none;z-index:1}
.sim-graph-node.direct,.sim-graph-node.downstream{animation:impact-cascade .65s ease-out both}.sim-graph-lines .direct path,.sim-graph-lines .downstream path{stroke-dasharray:8 4;animation:impact-flow 1.2s linear 2}
@keyframes impact-cascade{0%{opacity:.35;transform:scale(.96)}65%{box-shadow:0 0 0 5px var(--pulse-primary-light)}100%{opacity:1;transform:scale(1)}}@keyframes impact-flow{to{stroke-dashoffset:-24}}
@media(min-width:1200px){.sim-visual-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto;animation:none!important}}
</style>
