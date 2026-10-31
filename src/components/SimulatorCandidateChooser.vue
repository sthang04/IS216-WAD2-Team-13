<script setup>
import {computed,ref,watch} from 'vue'
const props=defineProps({assessment:Object,selectedId:[String,Number]})
const emit=defineEmits(['use'])
const inspectedId=ref(null),search=ref(''),showAll=ref(false)
const candidates=computed(()=>props.assessment?.eligible || [])
const inspected=computed(()=>candidates.value.find(c=>String(c.id)===String(inspectedId.value)) || candidates.value.find(c=>String(c.id)===String(props.selectedId)) || candidates.value[0])
const filtered=computed(()=>candidates.value.filter(c=>(c.name+' '+c.specialty).toLowerCase().includes(search.value.toLowerCase())))
const visible=computed(()=>showAll.value || search.value?filtered.value:filtered.value.slice(0,5))
watch(()=>props.assessment?.memberId,()=>{inspectedId.value=null;search.value='';showAll.value=false})
</script>
<template>
 <section class="candidate-chooser" :aria-label="'Replacement candidates for '+assessment.memberName">
  <div class="candidate-heading"><h6 class="fw-bold mb-1">Replacement for {{ assessment.memberName }}</h6><details class="small"><summary>{{ assessment.segments.length }} affected activities</summary><ul><li v-for="s in assessment.segments" :key="s.id">{{ s.title }}</li></ul></details></div>
  <p v-if="!assessment.segments.length" class="small text-muted">No affected activities in this interval.</p>
  <p v-else-if="!candidates.length" class="small text-muted">No eligible replacement was found among accessible member records. Review conflicts or change the proposed timing.</p>
  <div v-else class="candidate-panels">
   <div>
    <label class="small fw-bold" :for="'candidate-search-'+assessment.memberId">Search candidates</label><input :id="'candidate-search-'+assessment.memberId" v-model="search" class="form-control form-control-sm mb-2" type="search">
    <p class="small text-muted mb-2"><span v-if="candidates.some(c=>!c.requiresManualReview)">Exact-role matches</span><span v-if="candidates.some(c=>c.requiresManualReview)">Needs Manual Review</span></p>
    <div class="candidate-list" role="group" :aria-label="'Inspect replacement candidates for '+assessment.memberName"><button v-for="c in visible" :key="c.id" type="button" class="candidate-row" :class="{inspected:inspected?.id===c.id,chosen:String(selectedId)===String(c.id)}" :data-candidate-id="c.id" :aria-pressed="inspected?.id===c.id" @click="inspectedId=c.id"><span><strong>{{ c.name }}</strong><small>{{ c.specialty || 'Role requires verification' }}</small></span><span><strong>{{ c.score }}/100</strong><small>{{ String(selectedId)===String(c.id)?'In preview':'Inspect' }}</small></span></button></div>
    <p v-if="!visible.length" class="small">No candidates match your search.</p>
    <button type="button" class="btn btn-outline-secondary btn-sm mt-2" :aria-pressed="showAll" @click="showAll=!showAll">{{ showAll?'Show Top 5':'Show All Candidates' }}</button>
   </div>
   <section v-if="inspected" class="candidate-detail border rounded p-3" aria-label="Candidate details">
    <div class="d-flex justify-content-between gap-2"><h6 class="fw-bold">{{ inspected.name }}</h6><span class="small fw-bold">{{ inspected.score }}/100</span></div>
    <p class="small mb-2">{{ inspected.specialty }}. {{ inspected.experience }}</p>
    <p class="small text-muted">{{ inspected.availabilityVerified?'Availability evidence recorded; review the proposed time.':"Availability hasn't been confirmed. Check with your selected replacement before proceeding." }}</p>
    <p class="small">{{ inspected.requiresManualReview?'Qualifications and availability need review.':'Recorded role match; final suitability still requires review.' }}</p>
    <button type="button" class="btn btn-pulse-primary btn-sm" :aria-pressed="String(selectedId)===String(inspected.id)" @click="emit('use',inspected)">{{ String(selectedId)===String(inspected.id)?'In recovery preview':'Use in recovery preview' }}</button>
    <p class="small mt-2 mb-0" role="status">{{ String(selectedId)===String(inspected.id)?'Selected for the hypothetical recovery. No invitation, Telegram message or live assignment has been made.':'Inspecting a candidate does not select or contact them.' }}</p>
    <details class="small mt-3"><summary>Suitability and scheduling evidence</summary><p>{{ inspected.reason }}</p><p>Experience: {{ inspected.experience }}. Workload: {{ inspected.workload }}.</p><p>Availability: {{ inspected.availability }}. No recorded event clash was found in the loaded candidate checks; this does not prove personal availability.</p><p v-for="reason in inspected.reviewReasons || []" :key="reason">{{ reason }}</p><p>Ranking uses the existing role, availability and workload scores. It is not acceptance or approval.</p></details>
   </section>
  </div>
  <details class="small mt-3" v-if="assessment.warnings?.length"><summary>Availability evidence and limitations</summary><p v-for="w in assessment.warnings" :key="w">{{ w }}</p></details>
  <details class="small mt-3" v-if="assessment.excluded.length"><summary>Excluded replacement candidates ({{ assessment.excluded.length }})</summary><div v-for="c in assessment.excluded" :key="c.id" class="border-top py-2"><strong>{{ c.name }}</strong><p v-for="reason in c.reasons" :key="reason" class="mb-1">{{ reason }}</p><div v-for="conflict in c.conflicts" :key="conflict.segmentId">{{ conflict.eventName }} | {{ conflict.activity }} | {{ conflict.start }} to {{ conflict.end }}</div></div></details>
 </section>
</template>
<style scoped>
.candidate-chooser{margin-bottom:1.5rem}.candidate-panels{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:1rem;margin-top:1rem}.candidate-row{width:100%;display:flex;justify-content:space-between;gap:1rem;text-align:left;border:1px solid var(--pulse-border);border-radius:.5rem;background:var(--pulse-card-bg);color:var(--pulse-ink);padding:.7rem;margin-bottom:.45rem}.candidate-row small{display:block;color:var(--pulse-ink-muted);font-size:.7rem}.candidate-row.inspected{background:var(--pulse-bg)}.candidate-row.chosen{border-color:var(--pulse-primary);box-shadow:inset 3px 0 var(--pulse-primary)}.candidate-detail{min-width:0}.candidate-heading summary{cursor:pointer}button:focus-visible{outline:2px solid var(--pulse-primary);outline-offset:2px}@media(max-width:767px){.candidate-panels{grid-template-columns:1fr}}
</style>
