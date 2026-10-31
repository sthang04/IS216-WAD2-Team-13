import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'
import { getSimulationTestData } from '../data/simulationTestData.js'
import { runCompleteSimulation } from '../services/simulationService.js'
import { prepareDisruptionCards, assessCombinedRecovery, buildCombinedRecoveryOptions } from '../services/combinedSimulationService.js'
import {presentSimulatorFacilities} from '../services/simulatorFacilityPresentationService.js'
import { evaluateRecoveryPlans } from '../services/recoveryPlanEvaluationService.js'

// Compile the real SFC and run its setup/lifecycle with a no-DOM Vue renderer.
// Only the live loader is mocked. No server, browser, auth session or RPC is used.
async function mountView() {
  const source=readFileSync(new URL('./EventRiskView.vue',import.meta.url),'utf8')
  const {descriptor,errors}=parse(source,{filename:'EventRiskView.vue'})
  assert.deepEqual(errors,[])
  const script=compileScript(descriptor,{id:'unified-risk'})
  const template=compileTemplate({source:descriptor.template.content,filename:'EventRiskView.vue',id:'unified-risk',compilerOptions:{bindingMetadata:script.bindings}})
  assert.deepEqual(template.errors,[])
  const code=script.content.replace(/import[\s\S]*?from ['"][^'"]+['"];?/g,'').replace('export default','return')
  const deps={ref:Vue.ref,shallowRef:Vue.shallowRef,computed:Vue.computed,onMounted:Vue.onMounted,watch:Vue.watch,nextTick:Vue.nextTick,loadSimulationData:async()=>getSimulationTestData(),runCompleteSimulation,
    prepareDisruptionCards,assessCombinedRecovery,buildCombinedRecoveryOptions,evaluateRecoveryPlans,presentSimulatorFacilities,
    SimulatorInvitationInbox:{render:()=>null},SimulatorFacilitySetup:{render:()=>null},SimulatorCalendarActions:{render:()=>null},PipMascot:{render:()=>null},SimulatorRecoveryWorkflow:{render:()=>null},console:{log(){},error(){}}}
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
