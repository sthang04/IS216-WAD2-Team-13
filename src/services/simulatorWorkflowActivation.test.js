import test from 'node:test'
import assert from 'node:assert/strict'
import {simulatorWorkflowActivation,simulatorWorkflowError} from './simulatorWorkflowActivation.js'
const staging={VITE_SUPABASE_URL:'https://xbtauyiinkrxvfrqakbw.supabase.co',VITE_SIMULATOR_WORKFLOW_PROJECT_REF:'xbtauyiinkrxvfrqakbw',VITE_SIMULATOR_WORKFLOW_ENABLED:'true'}
test('environment activation defaults OFF and requires explicit exact staging project match',()=>{
 assert.equal(simulatorWorkflowActivation().enabled,false)
 assert.equal(simulatorWorkflowActivation({...staging,VITE_SIMULATOR_WORKFLOW_ENABLED:'false'}).enabled,false)
 assert.equal(simulatorWorkflowActivation({...staging,VITE_SIMULATOR_WORKFLOW_ENABLED:true}).enabled,false)
 assert.equal(simulatorWorkflowActivation({...staging,VITE_SIMULATOR_WORKFLOW_PROJECT_REF:''}).enabled,false)
 assert.equal(simulatorWorkflowActivation({...staging,VITE_SUPABASE_URL:'https://bdqzysnapwxdzppkuftn.supabase.co'}).enabled,false)
 assert.equal(simulatorWorkflowActivation({...staging,VITE_SUPABASE_URL:staging.VITE_SUPABASE_URL+'.attacker.invalid'}).enabled,false)
 assert.equal(simulatorWorkflowActivation(staging).enabled,true)
})
test('production activation requires a second explicit opt-in and matching project',()=>{
 const production={...staging,VITE_SUPABASE_URL:'https://bdqzysnapwxdzppkuftn.supabase.co',VITE_SIMULATOR_WORKFLOW_PROJECT_REF:'bdqzysnapwxdzppkuftn'}
 assert.equal(simulatorWorkflowActivation(production).enabled,false)
 assert.equal(simulatorWorkflowActivation({...production,VITE_SIMULATOR_PRODUCTION_APPROVED:'true'}).enabled,true)
 assert.equal(simulatorWorkflowActivation({...staging,VITE_SUPABASE_URL:production.VITE_SUPABASE_URL,VITE_SIMULATOR_PRODUCTION_APPROVED:'true'}).enabled,false)
})
test('backend release rejection and version conflicts remain clear errors',()=>{
 assert.match(simulatorWorkflowError({code:'55000',message:'Simulator backend is not released for real operations'}),/activation is OFF/)
 assert.match(simulatorWorkflowError({message:'Plan revision changed'}),/No automatic retry/)
 assert.equal(simulatorWorkflowError({message:'Event management permission required'}),'Event management permission required')
})
