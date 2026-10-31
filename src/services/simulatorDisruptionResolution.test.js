import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createSimulatorWorkflow,recordedDisruptionResolutions} from './simulatorWorkflowService.js'
const disruption={type:'MEMBER_UNAVAILABLE',memberId:3,start:'2026-11-02T10:00:00Z',end:'2026-11-02T12:00:00Z'}
const plan={id:'p',version:2,application_status:'Applied',after_fingerprint:'a'.repeat(64),disruptions:[disruption]}
const audit=(overrides={})=>({plan_id:'p',action:'DISRUPTION_RESOLVED',outcome:'Succeeded',created_at:'2026-11-01T00:00:00Z',
 details:JSON.stringify({disruption_index:1,disruption,applied_fingerprint:plan.after_fingerprint,reason:'Availability independently verified.'}),...overrides})
test('resolution status comes only from matching protected audit evidence',()=>{
 assert.equal(recordedDisruptionResolutions(plan,[])[0].resolved,false)
 assert.equal(recordedDisruptionResolutions(plan,[audit()])[0].resolved,true)
 for(const row of [audit({plan_id:'other'}),audit({details:'invalid'}),audit({outcome:'Blocked'}),
  audit({details:JSON.stringify({disruption_index:1,disruption:{...disruption,memberId:9},applied_fingerprint:plan.after_fingerprint})})])
  assert.equal(recordedDisruptionResolutions(plan,[row])[0].resolved,false)
 assert.equal(recordedDisruptionResolutions({...plan,after_fingerprint:'different'},[audit()])[0].resolved,false)
})
test('resolution RPC sends the selected revision and reason, never a caller identity',async()=>{
 const calls=[],api=createSimulatorWorkflow({rpc:async(name,args)=>{calls.push({name,args});return {data:{resolved:true,disruption_index:1,plan:{...plan,version:3}}}}},{enabled:true})
 await api.resolveDisruption(plan,1,'Availability independently verified.',true)
 assert.equal(calls[0].name,'rpc_simulator_resolve_disruption')
 assert.equal(calls[0].args.p_expected_version,2)
 assert.equal(calls[0].args.p_acknowledge_resolution,true)
 assert.equal('p_actor' in calls[0].args,false)
 await assert.rejects(api.resolveDisruption({...plan,version:null},1,'Availability verified.',true),/revision/)
 await assert.rejects(api.resolveDisruption(plan,1,'Availability verified.',false),/Confirm/)
})
test('resolution rejects authorization failures, stale versions and malformed server success',async()=>{
 for(const response of [{error:{message:'Event management permission required'}},{error:{message:'Plan revision changed'}},{data:{resolved:true,disruption_index:2,plan}}]){
  const api=createSimulatorWorkflow({rpc:async()=>response},{enabled:true})
  await assert.rejects(api.resolveDisruption(plan,1,'Availability independently verified.',true))
 }
})
test('migration 006 changes only the Undo guard call in transition_plan and retains original evidence',()=>{
 const sql=name=>readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8')
 const extract=text=>{const a=text.indexOf('FUNCTION simulator_private.transition_plan(');return text.slice(a,text.indexOf('END $$;',a)+7)}
 const before=sql('202610310005_simulator_safe_undo.sql'),after=sql('202610310006_simulator_disruption_resolution.sql')
 assert.equal(extract(after).replace('assert_undo_disruptions_resolved(p.id,p.event_id,p.disruptions)','assert_undo_disruptions_clear(p.event_id,p.disruptions)'),extract(before))
 assert.doesNotMatch(after,/SET disruptions|CREATE TABLE|UPDATE simulator_private.release_gate/)
 assert.match(after,/p_expected_version IS NULL/)
 assert.match(after,/event_club\(p.event_id,true\)/)
})
