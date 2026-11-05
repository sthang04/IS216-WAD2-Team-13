<script setup>
// Purpose: Explain existing evaluator scores and changes; expansion and selection remain independent UI state.
import {computed,ref,useId,watch} from 'vue'
import SimulatorScoreBars from './SimulatorScoreBars.vue'
import {controlRoomTime} from '../services/simulatorControlRoomService.js'
import {activityKey} from '../services/simulatorActivityGroups.js'
const props=defineProps({plan:Object,data:Object,segments:Array,selected:Boolean})
const emit=defineEmits(['select'])
const detailsId='recovery-option-details-'+useId()
// Expansion is presentation only and independent of selection. The proposed
// changes are always shown; scores, checks and evidence start collapsed.
const expanded=ref(false)
watch(()=>props.plan.rank,()=>{expanded.value=false})
const evidence=ref(null),verification=ref(null),fullChanges=ref(null)
const hasScore=computed(()=>typeof props.plan.score==='number'&&Number.isFinite(props.plan.score))
const conflictCount=computed(()=>Array.isArray(props.plan.conflicts)?props.plan.conflicts.length:null)
const activity=id=>props.segments?.find(s=>String(s.id)===String(id))?.title || 'Activity unavailable'
const member=id=>props.data?.members?.find(m=>String(m.id)===String(id))?.full_name || 'Member unavailable'
const changes=computed(()=>props.plan.changes || [])
// Group repeated display changes without changing the evaluator's proposal.
// Activity IDs, rather than titles, keep equally named activities distinct.
const memberChanges=computed(()=>{const groups=new Map();for(const c of changes.value.filter(c=>c.replacementMemberId!=null)){const key=JSON.stringify([c.replacedMemberId,c.replacementMemberId]);if(!groups.has(key))groups.set(key,{key,from:member(c.replacedMemberId),to:member(c.replacementMemberId),activities:new Set()});groups.get(key).activities.add(String(c.segmentId))}return [...groups.values()]})
// One line per new room ("Move to X · 19 activities"), not one per activity or crew copy
const facilityChanges=computed(()=>{const rows=new Map();for(const c of changes.value.filter(c=>c.venueName)){if(!rows.has(c.venueName))rows.set(c.venueName,{key:c.venueName,venue:c.venueName,activities:new Set()});const segment=props.segments?.find(s=>String(s.id)===String(c.segmentId));rows.get(c.venueName).activities.add(segment?activityKey(segment):String(c.segmentId));rows.get(c.venueName).title=activity(c.segmentId)}return [...rows.values()]})
// One line per activity and new time (Day Ops crew copies of the same change merged)
const timingChanges=computed(()=>[...new Map(changes.value.filter(c=>c.starts_at || c.ends_at).map(c=>[activity(c.segmentId)+'|'+c.starts_at+'|'+c.ends_at,c])).values()])
// Deduplicate only the presentation: distinct conflicts/warnings/reasons remain
// available as readable evidence below. The key includes entities so distinct activity problems
// with the same wording are never silently merged. Scores and ranks are read
// from the evaluator; a high score cannot satisfy any workflow requirement.
const issues=computed(()=>{
 const unique=new Map()
 for(const item of [...(props.plan.conflicts || []),...(props.plan.warnings || [])]){
  const value=typeof item==='string'?{message:item}:item
  const message=value.message || value.reason || 'Verification evidence unavailable'
  const ids=value.segmentIds || (value.segmentId!=null?[value.segmentId]:[])
  const context=[...ids.map(activity),value.memberId!=null?member(value.memberId):'',value.venue || value.venueName || ''].filter(Boolean).join(' / ') || [...new Set(changes.value.map(c=>activity(c.segmentId)))].join(', ') || props.plan.title
  const record=Object.entries(value).filter(([key])=>!['message','reason'].includes(key)).map(([key,v])=>key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ')+': '+readable(v)).join('; ')
  const key=(context+' '+message+' '+record).trim().replace(/\s+/g,' ').toLowerCase()
  if(!unique.has(key))unique.set(key,{key,context,message,record,action:/booking|facility|venue|room/i.test(message)?'Review facility evidence':/member|availability|qualification|role/i.test(message)?'Review member evidence':'Review check evidence'})
 }
 return [...unique.values()]
})
const reasons=computed(()=>[...new Set(props.plan.reasons || [])])
// Keep every evaluator metric without exposing a raw JSON blob. Unknown future
// metric keys remain visible with readable labels rather than being discarded.
const metricRows=computed(()=>Object.entries(props.plan.metrics || {}).map(([key,value])=>({label:key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' '),value:readable(value)})))
function readable(value){if(value==null)return 'Not recorded';if(Array.isArray(value))return value.map(readable).join('; ');if(typeof value==='object')return Object.entries(value).map(([key,v])=>key.replace(/_/g,' ')+': '+readable(v)).join('; ');return String(value)}
function showVerification(){expanded.value=true;if(verification.value){verification.value.open=true;if(fullChanges.value)fullChanges.value.open=true;(fullChanges.value || verification.value).querySelector('summary')?.focus()}}
function openEvidence(){if(!evidence.value)return;evidence.value.open=true;let parent=evidence.value.parentElement.closest('details');while(parent){parent.open=true;parent=parent.parentElement.closest('details')}}
</script>
<template>
 <article class="recovery-choice" :class="{'is-selected':selected,'is-best-match':plan.rank===1}" :data-plan-id="plan.id" :data-plan-title="plan.title" :aria-label="'Recovery plan '+plan.rank">
  <p v-if="plan.rank===1" class="best-match-badge">Best match <span>Highest-ranked option; availability and approval still need verification</span></p>
  <header class="plan-heading"><div class="plan-heading-main"><p class="plan-eyebrow">Recovery option<span v-if="plan.rank!=null"> #{{ plan.rank }}</span></p><h3>{{ plan.title }}</h3><div class="plan-badges"><span v-if="plan.status" class="plan-conflict-badge">{{ plan.status==='INFEASIBLE' ? 'Conflicts to resolve' : plan.status==='FEASIBLE' ? 'Checks passed; approval required' : 'Needs review' }}</span><span class="plan-check-badge">{{ issues.length }} {{ issues.length===1?'check':'checks' }} needed</span><span class="plan-conflict-badge" :class="{'no-conflicts':conflictCount===0,'has-conflicts':conflictCount>0}">{{ conflictCount===null?'Conflict evidence unavailable':conflictCount+' detected '+(conflictCount===1?'conflict':'conflicts') }}</span></div></div><div class="overall-score" aria-label="Overall recovery score"><strong v-if="hasScore">{{ plan.score }}<small>/100</small></strong><strong v-else class="score-unavailable">Score unavailable</strong><span>Plan score</span></div></header>
  <!-- Shorten only the card preview; complete proposal records remain below. -->
  <section class="plan-section proposed-changes" aria-label="Proposed changes"><h4>Proposed changes</h4>
   <div v-for="group in memberChanges.slice(0,2)" :key="group.key" class="proposed-change"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="8" cy="7" r="3"/><path d="M2 21v-4a6 6 0 0 1 12 0v4m2-17a3 3 0 0 1 0 6m1 4a5 5 0 0 1 5 5v2"/></svg><div><strong>Member replacement</strong><p>{{ group.from }} &rarr; {{ group.to }}</p><small>{{ group.activities.size }} {{ group.activities.size===1?'task':'tasks' }}</small></div></div>
   <div v-for="change in facilityChanges.slice(0,2)" :key="change.key" class="proposed-change"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 21V7l9-5 9 5v14h-7v-7h-4v7ZM7 8v3m5-5v5m5-3v3"/></svg><div><strong>Facility change</strong><p>Move to {{ change.venue }}<span v-if="plan.availability" class="plan-availability" :class="{partial:plan.leftover?.length}"> &middot; {{ plan.availability }}</span></p><small>{{ change.activities.size===1?change.title:change.activities.size+' activities' }}<template v-if="plan.leftover?.length"> &middot; {{ plan.leftover.join(', ') }} still need a room</template></small></div></div>
   <div v-for="(change,i) in timingChanges.slice(0,2)" :key="'time-'+i" class="proposed-change"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg><div><strong>Schedule change</strong><p>{{ activity(change.segmentId) }}</p><small>{{ change.starts_at?controlRoomTime(change.starts_at):'Start unchanged' }} &rarr; {{ change.ends_at?controlRoomTime(change.ends_at):'End unchanged' }}</small></div></div>
   <button v-if="memberChanges.length>2 || facilityChanges.length>2 || timingChanges.length>2" type="button" class="btn btn-link btn-sm p-0" @click="showVerification">View all {{ changes.length }} change records</button>
   <p v-if="!changes.length" class="plan-muted">No activity changes recorded.</p>
  </section>
  <div :id="detailsId" v-show="expanded" class="plan-detail-content">
  <details class="plan-section plan-rationale" aria-label="Plan rationale"><summary>Why this option?</summary><p class="plan-muted">Existing evaluator scores</p><SimulatorScoreBars :breakdown="plan.scoreBreakdown" /></details>
  <details class="plan-section plan-requirements" aria-label="Before you can apply"><summary>Before you can apply <span class="plan-check-badge">{{ issues.length }} {{ issues.length===1?'check':'checks' }}</span></summary>
   <div v-if="memberChanges.length" class="requirement-row"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="6" r="3"/><path d="M3 21v-5a6 6 0 0 1 12 0v5m2-9 2 2 4-5"/></svg><div><strong>Member verification</strong><p>Check role suitability and availability</p></div></div>
   <div v-if="facilityChanges.length" class="requirement-row"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18m-13 5 3 3 5-5"/></svg><div><strong>Facility booking verification</strong><p>Check booking, capacity and eligibility</p></div></div>
   <div v-if="timingChanges.length" class="requirement-row"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg><div><strong>Schedule verification</strong><p>Compare proposed times and existing bookings</p></div></div>
   <div class="requirement-row organiser-requirement"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2m-7 8 3 3 5-6"/></svg><div><strong>Organiser review</strong><p>Required before applying</p></div></div>
   <p class="plan-score-note">Scores and accessible checks do not confirm approval or readiness.</p>
  </details>
  <details ref="verification" class="plan-verification" data-testid="follow-up-actions"><summary>Verification details{{ issues.length ? ' ('+issues.length+')' : '' }}<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></summary><div class="plan-verification-body"><h5>Follow-up Actions</h5><p v-if="!issues.length">Review the saved recovery requirements before preparing requests.</p><ul><li v-for="issue in issues" :key="issue.key"><strong>{{ issue.context }}</strong>: {{ issue.message }} <a :href="'#plan-evidence-'+plan.id" @click="openEvidence">{{ issue.action }}</a><details v-if="issue.record"><summary>Check evidence</summary><p>{{ issue.record }}</p></details></li></ul>
   <details ref="fullChanges"><summary>Full activity changes</summary><ul><li v-for="(c,i) in changes" :key="i"><strong>{{ activity(c.segmentId) }}</strong><span v-if="c.replacementMemberId!=null">: {{ member(c.replacedMemberId) }} to {{ member(c.replacementMemberId) }}</span><span v-if="c.venueName">: move to {{ c.venueName }}</span><span v-if="c.starts_at || c.ends_at">: {{ controlRoomTime(c.starts_at) }} to {{ controlRoomTime(c.ends_at) }}</span></li></ul><a href="#simulator-recovery-workflow">Review recovery requirements</a></details>
   <!-- Detailed evaluator evidence stays available; selection only previews the
        plan and cannot satisfy invitation, booking or Apply requirements. -->
   <details ref="evidence" :id="'plan-evidence-'+plan.id"><summary>Scoring evidence</summary><p>Evaluator status: {{ plan.status || 'Not recorded' }}.</p><p v-for="reason in reasons" :key="reason">{{ reason }}</p><dl><template v-for="metric in metricRows" :key="metric.label"><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></template></dl><p v-if="!reasons.length && !metricRows.length">Detailed scoring evidence was not recorded.</p><p>Organiser acknowledgement is local; final workflow eligibility is checked before Apply.</p></details></div>
  </details>
  </div>
  <footer class="plan-footer"><button type="button" class="btn btn-outline-secondary plan-details-toggle" :aria-expanded="expanded" :aria-controls="detailsId" :aria-label="(expanded?'Hide':'View')+' details for recovery option '+plan.rank" @click="expanded=!expanded">{{ expanded?'Hide details':'Details' }}</button><button type="button" class="btn btn-pulse-primary plan-select-button" :aria-pressed="selected" @click="emit('select')">{{ selected?'Selected plan':'Select this plan' }}</button></footer>
 </article>
</template>
<style scoped>
.recovery-choice{container-type:inline-size;background:#fff!important;color:#181818;border:1px solid #dedede;border-radius:1.4rem;padding:1rem;margin-bottom:1rem;font-size:.78rem}.recovery-choice.is-selected{background:var(--pulse-primary-light)!important;border-color:var(--pulse-primary);box-shadow:inset 3px 0 var(--pulse-primary)}.plan-heading{display:flex;justify-content:space-between;align-items:start;gap:1rem;padding-bottom:1rem}.plan-heading-main{min-width:0}.plan-eyebrow{text-transform:uppercase;font-size:.6rem;font-weight:500;color:#666;margin:0 0 .45rem}.plan-heading h3{font-size:1.05rem;font-weight:650;line-height:1.4;margin:0 0 .5rem;overflow-wrap:anywhere}.overall-score{text-align:right;white-space:nowrap;flex-shrink:0;padding-top:.4rem}.overall-score>strong{font-size:1.1rem;font-weight:650;line-height:1.2}.overall-score small{font-size:.65rem;font-weight:500;color:#666}.overall-score>span{display:block;font-size:.58rem;color:#666;margin-top:.25rem}.overall-score .score-unavailable{font-size:.75rem}.plan-badges{display:flex;flex-wrap:wrap;gap:.3rem}.plan-check-badge,.plan-conflict-badge{display:inline-block;font-size:.65rem;padding:.2rem .4rem;line-height:1.2;border-radius:1rem;font-weight:500;white-space:nowrap}.plan-check-badge{background:#ffe5d9;color:#bd4b16}.plan-conflict-badge{background:#f0f0f0;color:#555}.plan-conflict-badge.no-conflicts{background:#dcf4df;color:#247642}.plan-conflict-badge.has-conflicts{background:var(--pulse-primary-light);color:var(--pulse-primary)}.plan-section{border-top:1px solid #ededed;padding:1rem 0}.plan-section h4{font-size:.9rem;font-weight:600;line-height:1.4;margin:0 0 .7rem}.proposed-change,.requirement-row{display:flex;align-items:baseline;gap:.55rem;margin:.6rem 0}.proposed-change>div,.requirement-row>div{min-width:0}.recovery-choice svg{width:14px;height:14px;fill:none;stroke:#777;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}.proposed-change strong,.requirement-row strong{font-size:.8rem;font-weight:500}.proposed-change p{font-size:.75rem;margin:.35rem 0;line-height:1.4}.proposed-change small{font-size:.65rem;color:#666}.plan-section-heading{display:flex;justify-content:space-between;gap:.6rem;align-items:baseline;margin-bottom:.65rem}.plan-section-heading h4{margin:0}.plan-section-heading>span:not(.plan-check-badge){font-size:.58rem;color:#777}.plan-rationale :deep(.score-factors){grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem .8rem}.plan-rationale :deep(.factor-label){font-size:.6rem;line-height:1.4}.plan-rationale :deep(.factor-label strong){font-weight:500;white-space:nowrap}.plan-rationale :deep(.factor-track){height:5px;background:#f2f2f2}.requirement-row svg{stroke:#b57a19}.requirement-row.organiser-requirement svg{stroke:#777}.requirement-row p{font-size:.68rem;line-height:1.4;color:#666;margin:.35rem 0 0}.plan-score-note,.plan-muted{font-size:.65rem;line-height:1.5;color:#666;margin:.8rem 0 0}.plan-requirements{padding-bottom:.4rem}.plan-verification>summary{display:flex;justify-content:space-between;align-items:center;gap:.6rem;list-style:none;font-size:.75rem;cursor:pointer;padding:.5rem 0}.plan-verification>summary::-webkit-details-marker{display:none}.plan-verification[open]>summary>svg{transform:rotate(180deg)}.plan-verification-body{padding:.65rem 0;font-size:.72rem;color:#555;line-height:1.5}.plan-verification-body h5{font-size:.8rem;font-weight:600}.plan-verification-body li{margin:.6rem 0}.plan-verification-body summary{cursor:pointer;margin:.6rem 0}.plan-verification-body dl{overflow-wrap:anywhere}.plan-footer{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.6rem;padding-top:.65rem}.plan-select-button{border-radius:2rem;font-size:.75rem;font-weight:600;padding:.5rem .85rem;line-height:1.4}button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--pulse-primary);outline-offset:3px}@container(max-width:350px){.plan-rationale :deep(.score-factors){grid-template-columns:1fr}}@media(max-width:767px){.plan-select-button{min-height:44px}}
.recovery-choice.is-best-match{border-color:#9bbfab;box-shadow:0 3px 12px #2b806410}.best-match-badge{margin:-1rem -1rem 1rem;padding:.65rem 1rem;background:#edf8f2;color:#24664c;border-radius:1.35rem 1.35rem 0 0;font-size:.78rem;font-weight:700}.best-match-badge span{display:block;font-size:.65rem;font-weight:400;line-height:1.5;margin-top:.2rem}.plan-section>summary{min-height:44px;cursor:pointer;font-weight:600;line-height:1.5}.plan-requirements>summary .plan-check-badge{margin-left:.35rem}
/* Selected plan: green, matching "Best match", instead of the red/pink highlight */
.recovery-choice.is-selected{background:#fff!important;border:2px solid #2b8064;box-shadow:0 3px 12px #2b806420}.plan-select-button[aria-pressed=true]{background:#2b8064;border-color:#2b8064;color:#fff}
details.plan-section:not([open]){padding:.3rem 0}
.plan-details-toggle{min-height:44px;border-radius:2rem;font-size:.75rem;padding:.5rem .85rem;line-height:1.4}.plan-detail-content{min-width:0}
.plan-availability{color:#24664c;font-weight:600}.plan-availability.partial{color:#9a6b00}
</style>
