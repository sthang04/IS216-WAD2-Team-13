<script setup>
// Inspecting a candidate is separate from choosing a hypothetical replacement.
// Neither interaction creates an invitation or sends a notification.
import {computed,ref,watch} from 'vue'
const props=defineProps({assessment:Object,selectedId:[String,Number]})
const emit=defineEmits(['use'])
const score=value=>typeof value==='number'&&Number.isFinite(value)?value+'/100':'Score unavailable'
// Inspection and filtering are local UI state; only the explicit use event
// tells the parent to change its hypothetical recovery selection.
const inspectedId=ref(null),search=ref(''),showAll=ref(false)
const warnings=computed(()=>[...new Set(props.assessment?.warnings || [])])
const candidates=computed(()=>props.assessment?.eligible || [])
const inspected=computed(()=>candidates.value.find(c=>String(c.id)===String(inspectedId.value)) || candidates.value.find(c=>String(c.id)===String(props.selectedId)) || candidates.value[0])
const affectedRoles=computed(()=>[...new Set((props.assessment?.affectedAssignments || []).map(a=>a.role_name).filter(Boolean))].join(', '))
const hasScore=value=>typeof value==='number'&&Number.isFinite(value)
// Use the service's recorded matches/load, never infer factor scores from the
// overall ranking score. Missing structured evidence stays explicitly unknown.
const roleEvidence=computed(()=>{const roles=new Set((props.assessment?.affectedAssignments || []).map(a=>String(a.role_name || '').trim().toLowerCase()).filter(Boolean));return roles.size&&Array.isArray(inspected.value?.matchedRoles)?inspected.value.matchedRoles.length+' of '+roles.size+' '+(roles.size===1?'role':'roles'):inspected.value?.experience || 'Unverified'})
const workloadEvidence=computed(()=>typeof inspected.value?.currentLoad==='number'&&Number.isFinite(inspected.value.currentLoad)?inspected.value.currentLoad+' '+(inspected.value.currentLoad===1?'task':'tasks'):inspected.value?.workload || 'Unrecorded')
const verificationReasons=computed(()=>[...new Set(inspected.value?.reviewReasons?.length?inspected.value.reviewReasons:[inspected.value?.reason].filter(Boolean))])
const filtered=computed(()=>candidates.value.filter(c=>(c.name+' '+c.specialty).toLowerCase().includes(search.value.toLowerCase())))
const visible=computed(()=>showAll.value || search.value?filtered.value:filtered.value.slice(0,5))
watch(()=>props.selectedId,id=>{if(id!=null)inspectedId.value=id})
// A different unavailable member needs a fresh search and inspection context.
watch(()=>props.assessment?.memberId,()=>{inspectedId.value=null;search.value='';showAll.value=false})
</script>
<template>
 <section class="candidate-chooser" :aria-label="'Replacement candidates for '+assessment.memberName">
  <header class="candidate-heading"><div class="candidate-title-row"><h3>Replace {{ assessment.memberName }}</h3><span class="candidate-badge">{{ inspected?.availabilityVerified?'Schedule evidence recorded':'Availability unverified' }}</span></div><p class="candidate-context">{{ assessment.segments.length }} affected {{ assessment.segments.length===1?'activity':'activities' }}<template v-if="affectedRoles"> &middot; {{ affectedRoles }}</template></p></header>
  <p v-if="!assessment.segments.length" class="small text-muted">No affected activities in this interval.</p>
  <p v-else-if="!candidates.length" class="small text-muted">No eligible replacement was found among accessible member records. Review conflicts or change the proposed timing.</p>
  <div v-else class="candidate-panels">
   <div>
    <label class="visually-hidden" :for="'candidate-search-'+assessment.memberId">Search candidates</label><input :id="'candidate-search-'+assessment.memberId" v-model="search" class="form-control candidate-search" type="search" placeholder="Search candidates">
    <div class="candidate-list" role="group" :aria-label="'Inspect replacement candidates for '+assessment.memberName"><button v-for="c in visible" :key="c.id" type="button" class="candidate-row" :class="{inspected:inspected?.id===c.id,chosen:String(selectedId)===String(c.id)}" :data-candidate-id="c.id" :aria-pressed="inspected?.id===c.id" @click="inspectedId=c.id"><span class="candidate-row-top"><strong>{{ c.name }}</strong><strong class="candidate-score">{{ score(c.score) }}</strong></span><span class="candidate-row-caption">{{ c.specialty || 'Role history unrecorded' }} &middot; {{ String(selectedId)===String(c.id)?'Selected for preview':'View score' }}</span></button></div>
    <p v-if="!visible.length" class="small">No candidates match your search.</p>
    <button type="button" v-if="filtered.length>5" class="btn btn-outline-secondary btn-sm mt-2" :aria-pressed="showAll" @click="showAll=!showAll">{{ showAll?'Show less':'Show all ('+filtered.length+')' }}</button>
   </div>
   <section v-if="inspected" class="candidate-detail" aria-label="Candidate details" data-testid="candidate-score-panel">
    <header class="candidate-info-header"><div><h3>{{ inspected.name }}</h3><span class="candidate-badge">{{ inspected.requiresManualReview || !inspected.availabilityVerified?'Needs verification':'Recorded role match' }}</span></div><div class="candidate-info-score"><strong v-if="hasScore(inspected.score)">{{ inspected.score }}<small>/100</small></strong><strong v-else class="score-unavailable">Score unavailable</strong><span>Candidate score</span></div></header>
    <h4 class="candidate-why">Why this candidate?</h4><p class="candidate-explanation">Based on recorded role match, availability evidence and workload.</p>
    <dl class="candidate-evidence-rows">
     <div><dt><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/></svg>Role match</dt><dd>{{ roleEvidence }}</dd></div>
     <div><dt><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="16" height="16" rx="3"/><path d="M7 2v6m8-6v6M3 10h16"/><circle cx="17" cy="17" r="5"/><path d="M17 14v3l2 1"/></svg>Availability</dt><dd><span class="candidate-status-pill" :class="{'is-checked':inspected.availabilityVerified}">{{ inspected.availabilityVerified?'Schedule checked':'Unverified' }}</span></dd></div>
     <div><dt><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18m-11 0v3h4v-3"/></svg>Recorded workload</dt><dd>{{ workloadEvidence }}</dd></div>
    </dl>
    <div class="candidate-before"><strong><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10v7m0-11v1"/></svg>Before proceeding</strong><p>Confirm role suitability and personal availability.</p></div>
    <details class="candidate-verification" open><summary>Verification details<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></summary><div class="candidate-verification-body"><p v-for="reason in verificationReasons" :key="reason">{{ reason }}</p><p>{{ inspected.availability }}. Personal availability still needs confirmation.</p><p v-if="inspected.matchedRoles?.length">Recorded roles: {{ inspected.matchedRoles.join(', ') }}.</p><p>The ranking score does not indicate acceptance or approval.</p></div></details>
    <div class="candidate-preview-action"><button type="button" class="btn btn-pulse-primary candidate-use-button" :aria-pressed="String(selectedId)===String(inspected.id)" @click="emit('use',inspected)">{{ String(selectedId)===String(inspected.id)?'In recovery preview':'Use in recovery preview' }}</button><p role="status">Preview only &middot; No invitation sent</p></div>
   </section>
  </div>
  <details class="small mt-3" v-if="assessment.segments.length"><summary>Affected activities ({{ assessment.segments.length }})</summary><ul><li v-for="activity in assessment.segments" :key="activity.id">{{ activity.title }}</li></ul></details>
  <details class="small mt-3" v-if="warnings.length"><summary>Availability evidence and limitations</summary><p v-for="w in warnings" :key="w">{{ w }}</p></details>
  <details class="small mt-3" v-if="assessment.excluded.length"><summary>Excluded replacement candidates ({{ assessment.excluded.length }})</summary><div v-for="c in assessment.excluded" :key="c.id" class="border-top py-2"><strong>{{ c.name }}</strong><p v-for="reason in c.reasons" :key="reason" class="mb-1">{{ reason }}</p><div v-for="conflict in c.conflicts" :key="conflict.segmentId">{{ conflict.eventName }} | {{ conflict.activity }} | {{ conflict.start }} to {{ conflict.end }}</div></div></details>
 </section>
</template>
<style scoped>
.candidate-chooser{container-type:inline-size;margin-bottom:1.5rem;padding:1.75rem;border:1px solid var(--pulse-border);border-radius:1.5rem;background:var(--pulse-card-bg)}
.candidate-title-row,.candidate-detail-heading,.candidate-row-top{display:flex;justify-content:space-between;align-items:baseline;gap:1rem}
.candidate-heading h3,.candidate-detail h3{font-size:1.15rem;line-height:1.4;font-weight:750;margin:0}.candidate-context{color:var(--pulse-ink-muted);font-size:.95rem;margin:1rem 0 0}
.candidate-badge{display:inline-block;align-self:start;background:var(--pulse-amber-bg);color:var(--pulse-amber);border-radius:.5rem;font-size:.8rem;font-weight:700;padding:.4rem .65rem;line-height:1.3}
.candidate-panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.25rem;align-items:start;margin-top:1rem}.candidate-panels>div,.candidate-detail{min-width:0}
.candidate-search{height:50px;font-size:1rem;border-radius:.75rem;margin-bottom:.65rem}.candidate-row{display:block;width:100%;text-align:left;border:1px solid var(--pulse-border);border-radius:.9rem;background:var(--pulse-card-bg);color:var(--pulse-ink);padding:1rem;margin-bottom:.65rem}.candidate-row-top strong{font-size:1.15rem;line-height:1.4}.candidate-row-top>strong:first-child{min-width:0;overflow-wrap:anywhere}.candidate-score{white-space:nowrap;font-size:1.2rem;font-weight:750}.candidate-row-caption{display:block;margin-top:.4rem;font-size:.95rem;color:var(--pulse-ink-muted);overflow-wrap:anywhere}.candidate-row.inspected{border-color:var(--pulse-primary);background:var(--pulse-primary-light);outline:1px solid var(--pulse-primary)}.candidate-row.chosen{box-shadow:inset 3px 0 var(--pulse-primary)}
.candidate-detail{padding:1.1rem 1rem .65rem;border:1px solid #dedede;border-radius:1.4rem;background:#fcfcfc;color:#181818;box-shadow:none;font-size:.8rem}.candidate-info-header{display:flex;justify-content:space-between;align-items:start;gap:1rem;padding:.1rem 0 1.25rem;border-bottom:1px solid #ededed}.candidate-detail h3{font-size:1rem;font-weight:650;margin:0 0 .55rem}.candidate-detail .candidate-badge,.candidate-status-pill{background:#ffe5d9;color:#bd4b16;font-weight:500;font-size:.7rem;line-height:1.2;padding:.2rem .45rem;border-radius:1rem}.candidate-info-score{text-align:right;flex-shrink:0}.candidate-info-score>strong{font-size:1.1rem;line-height:1.2;font-weight:650}.candidate-info-score small{font-size:.7rem;color:#666;font-weight:500}.candidate-info-score>span{display:block;font-size:.6rem;color:#555;margin-top:.25rem}.candidate-info-score .score-unavailable{font-size:.8rem}.candidate-why{font-size:.9rem;font-weight:650;margin:1.35rem 0 .55rem}.candidate-explanation{font-size:.7rem;color:#666;line-height:1.5;margin-bottom:.45rem}.candidate-evidence-rows{margin:0}.candidate-evidence-rows>div{display:flex;justify-content:space-between;align-items:center;gap:.8rem;padding:.65rem 0}.candidate-evidence-rows dt,.candidate-evidence-rows dd{font-size:.78rem;line-height:1.4;margin:0}.candidate-evidence-rows dt{display:flex;gap:.55rem;align-items:center;font-weight:400}.candidate-evidence-rows dd{text-align:right;font-weight:600;overflow-wrap:anywhere}.candidate-detail svg{width:15px;height:15px;flex-shrink:0;fill:none;stroke:#666;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.candidate-status-pill{display:inline-block;white-space:nowrap}.candidate-status-pill.is-checked{color:var(--pulse-blue);background:var(--pulse-blue-bg)}.candidate-before{padding:1.25rem .8rem 1rem}.candidate-before>strong{display:flex;align-items:center;gap:.55rem;font-size:.8rem;font-weight:600}.candidate-before p{font-size:.73rem;color:#666;margin:.5rem 0 0;line-height:1.5}.candidate-verification>summary{display:flex;align-items:center;justify-content:space-between;list-style:none;font-size:.8rem;font-weight:600;cursor:pointer;padding:.35rem 0}.candidate-verification>summary::-webkit-details-marker{display:none}.candidate-verification[open]>summary svg{transform:rotate(180deg)}.candidate-verification-body{padding-top:.6rem}.candidate-verification-body p{font-size:.7rem;color:#666;line-height:1.45;margin:0 0 .5rem}.candidate-preview-action{margin-top:.6rem}.candidate-use-button{width:100%;border-radius:2rem;font-size:.78rem;font-weight:600;padding:.55rem 1rem;line-height:1.4}.candidate-preview-action p{text-align:center;font-size:.58rem;color:#777;margin:.65rem 0 0}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--pulse-primary);outline-offset:3px}
@container(max-width:620px){.candidate-panels{grid-template-columns:1fr}.candidate-detail{padding:1.25rem}.candidate-title-row{align-items:start;flex-wrap:wrap}.candidate-row-top strong{font-size:1rem}.candidate-row-caption{font-size:.85rem}}
@media(max-width:767px){.candidate-chooser{padding:1rem;border-radius:1.1rem}.candidate-panels{grid-template-columns:1fr}}
</style>
