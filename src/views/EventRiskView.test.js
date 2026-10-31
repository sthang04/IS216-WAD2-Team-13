import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'
import {campusConnectFixture} from '../../e2e-simulator/fixtures/campusConnect.js'
import { getSimulationTestData } from '../data/simulationTestData.js'
import { runCompleteSimulation } from '../services/simulationService.js'
import { prepareDisruptionCards, assessCombinedRecovery, buildCombinedRecoveryOptions } from '../services/combinedSimulationService.js'
import {presentSimulatorFacilities} from '../services/simulatorFacilityPresentationService.js'
import {projectRecoveryPreview} from '../services/simulatorWorkflowService.js'
import { evaluateRecoveryPlans } from '../services/recoveryPlanEvaluationService.js'

// Compile the real SFC and run its setup/lifecycle with a no-DOM Vue renderer.
// Only the live loader is mocked. No server, browser, auth session or RPC is used.
async function mountView(fixture=getSimulationTestData()) {
  const source=readFileSync(new URL('./EventRiskView.vue',import.meta.url),'utf8')
  const {descriptor,errors}=parse(source,{filename:'EventRiskView.vue'})
  assert.deepEqual(errors,[])
  const script=compileScript(descriptor,{id:'unified-risk'})
  const template=compileTemplate({source:descriptor.template.content,filename:'EventRiskView.vue',id:'unified-risk',compilerOptions:{bindingMetadata:script.bindings}})
  assert.deepEqual(template.errors,[])
  const code=script.content.replace(/import[\s\S]*?from ['"][^'"]+['"];?/g,'').replace('export default','return')
  const deps={ref:Vue.ref,shallowRef:Vue.shallowRef,computed:Vue.computed,onMounted:Vue.onMounted,watch:Vue.watch,nextTick:Vue.nextTick,loadSimulationData:async()=>fixture,runCompleteSimulation,
    prepareDisruptionCards,assessCombinedRecovery,buildCombinedRecoveryOptions,evaluateRecoveryPlans,projectRecoveryPreview,presentSimulatorFacilities,
    SimulatorCandidateChooser:{render:()=>null},SimulatorFacilityChoices:{render:()=>null},SimulatorImpactWorkspace:{render:()=>null},SimulatorInvitationInbox:{render:()=>null},SimulatorFacilitySetup:{render:()=>null},SimulatorCalendarActions:{render:()=>null},PipMascot:{render:()=>null},SimulatorRecoveryWorkflow:{render:()=>null},console:{log(){},error(){}}}
  const component=new Function(...Object.keys(deps),code)(...Object.values(deps))
  component.render=()=>null
  const renderer=Vue.createRenderer({insert(){},remove(){},createElement:()=>({}),createText:()=>({}),
    createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}})
  const app=renderer.createApp(component)
  const instance=app.mount({})
  for(let i=0;i<4;i++) await Vue.nextTick()
  return {app,state:instance.$.setupState}
}
test('unified view adds/removes cards and runs mixed types once into the Pip result',async()=>{
  const {app,state}=await mountView()
  try {
    assert.equal(state.disruptionCards.length,1)
    state.addDisruption(); state.addDisruption()
    state.disruptionCards[1].type='FACILITY_UNAVAILABLE'
    state.disruptionCards[2].type='SCHEDULE_DELAY'
    state.runSimulation()
    assert.equal(state.result.disruptionCount,3)
    assert.ok(state.memberAssessments.length>0)
    assert.ok(state.hasFacilityDisruptions)
    const id=state.disruptionCards[2].id
    state.removeDisruption(id)
    assert.equal(state.disruptionCards.length,2); assert.equal(state.result,null)
    state.runSimulation(); assert.equal(state.result.disruptionCount,2)
  } finally {app.unmount()}
})
test('view rejects empty/invalid cards without retaining stale results',async()=>{
  const {app,state}=await mountView()
  try {
    state.disruptionCards[0].type='SCHEDULE_DELAY'; state.disruptionCards[0].delayMinutes=1.5
    state.runSimulation(); assert.match(state.error,/whole delay/); assert.equal(state.result,null)
    state.disruptionCards=[]; state.runSimulation()
    assert.match(state.error,/at least one/); assert.equal(state.result,null)
  } finally {app.unmount()}
})
test('single unified mount and original component remain intact',()=>{
  const app=readFileSync(new URL('../App.vue',import.meta.url),'utf8')
  const view=readFileSync(new URL('./EventRiskView.vue',import.meta.url),'utf8')
  const original=readFileSync(new URL('../components/WhatIfSimulator.vue',import.meta.url),'utf8')
  assert.equal((app.match(/<EventRiskView\b/g)||[]).length,1)
  assert.doesNotMatch(app,/<WhatIfSimulator/)
  assert.match(original,/function addDisruption/)
  assert.doesNotMatch(view,/activeScenario|buildDisruptions\(\)\[0\]/)
  assert.equal((view.match(/<PipMascot\b/g)||[]).length,1)
  assert.match(view,/Choose Disruption Scenarios/)
})


test('ranked selection drives exact comparison and preparation input, and clears on scenario change',async()=>{
 const view=await mountView(),s=view.state
 assert.ok(s.rankedRecoveryPlans.length>=2)
 for(const candidate of s.rankedRecoveryPlans.slice(0,2)){
  s.selectRecoveryPlan(candidate.id);await Vue.nextTick()
  assert.equal(s.selectedRecoveryPlan.id,candidate.id)
  assert.equal(s.activeComparison,'recovery')
  assert.deepEqual(s.comparisonSegments,candidate.proposedSegments)
  assert.deepEqual(s.recoveryOptions.find(o=>o.id===s.selectedRecoveryId).changes,candidate.changes)
 }
 s.disruptionCards[0].type='SCHEDULE_DELAY';await Vue.nextTick()
 assert.equal(s.selectedRecoveryId,'')
 assert.equal(s.selectedRecoveryPlan,null)
 view.app.unmount()
})


test('selecting a candidate card changes the combined proposal and keeps actual assignments untouched',async()=>{
 const view=await mountView(),s=view.state,before=JSON.stringify(s.data.segment_assignments)
 try{
  const group=s.memberAssessments.find(g=>g.eligible.length>=2);assert.ok(group)
  for(const candidate of group.eligible.slice(0,2)){
   await s.selectCandidate(group,candidate);await Vue.nextTick()
   assert.equal(s.replacementSelections[String(group.memberId)],candidate.id)
   assert.ok(s.selectedRecoveryPlan.changes.some(c=>c.replacementMemberId===candidate.id))
   assert.deepEqual(s.comparisonSegments,s.selectedRecoveryPlan.proposedSegments)
  }
  assert.equal(JSON.stringify(s.data.segment_assignments),before)
 }finally{view.app.unmount()}
})


test('facility choices replace incompatible venues and update the actual compared proposal',async()=>{
 const d=campusConnectFixture();d.facilities.push({id:3,name:'Fixture third room',is_active:true,capacity:60})
 d.facility_slots.push({...d.facility_slots[1],id:3,venue_name:'Fixture third room'});d.facility_bookings.push({...d.facility_bookings[1],id:3,facility_id:3})
 const view=await mountView(d),s=view.state,before=JSON.stringify(d)
 try{
  const card=s.disruptionCards[0];card.type='FACILITY_UNAVAILABLE';card.start='2026-11-02T10:00';card.end='2026-11-02T10:30';s.runSimulation();await Vue.nextTick()
  const options=s.combinedAssessment.facilityOptions.filter(o=>o.changes.some(c=>c.segmentId===1 && c.venueName))
  assert.ok(options.length>=2)
  await s.chooseFacility(options[0].id);await Vue.nextTick();assert.ok(s.selectedFacilityOptions.includes(options[0].id))
  await s.chooseFacility(options[1].id);await Vue.nextTick();assert.deepEqual([...s.selectedFacilityOptions],[options[1].id])
  assert.equal(s.selectedRecoveryPlan.changes.filter(c=>c.venueName).length,1)
  assert.deepEqual(s.comparisonSegments,s.selectedRecoveryPlan.proposedSegments)
  assert.equal(s.selectedRecoveryPlan.proposedVenues['1'],options[1].changes.find(c=>c.venueName).venueName)
  assert.equal(JSON.stringify(d),before)
 }finally{view.app.unmount()}
})
test('ranked selection is reflected by candidate details and subsequent combination uses that same member',async()=>{
 const view=await mountView(),s=view.state
 try{
  const group=s.memberAssessments.find(g=>g.eligible.length>=2);assert.ok(group)
  await s.selectCandidate(group,group.eligible[0]);await Vue.nextTick()
  const other=s.rankedRecoveryPlans.find(p=>p.changes.some(c=>c.replacementMemberId===group.eligible[1].id));assert.ok(other)
  s.selectRecoveryPlan(other.id);await Vue.nextTick()
  assert.equal(s.previewMemberId(group.memberId),group.eligible[1].id)
  s.adoptPreviewInputs();await Vue.nextTick()
  assert.equal(s.replacementSelections[String(group.memberId)],group.eligible[1].id)
 }finally{view.app.unmount()}
})
