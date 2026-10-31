import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stagingTestEnvironment,validateStagingStorage,allowedStagingRequest,STAGING_URL,LOCAL_ORIGIN,STAGING_REF} from '../../e2e-staging/stagingSafety.js'
test('staging harness never falls back to production URL or credentials',()=>{
 assert.throws(()=>stagingTestEnvironment({VITE_SUPABASE_URL:'https://bdqzysnapwxdzppkuftn.supabase.co'}),/NOT RUN/)
 assert.throws(()=>stagingTestEnvironment({PULSE_STAGING_PUBLISHABLE_KEY:'sb_secret_forbidden'}),/forbidden/)
 assert.throws(()=>stagingTestEnvironment({PULSE_STAGING_PUBLISHABLE_KEY:'sb_publishable_fixture'}),/STORAGE_STATE/)
 const result=stagingTestEnvironment({PULSE_STAGING_PUBLISHABLE_KEY:'sb_publishable_fixture',PULSE_STAGING_STORAGE_STATE:'outside-repository.json'})
 assert.equal(result.VITE_SUPABASE_URL,STAGING_URL)
})
test('staging request boundary blocks production and all Apply, Undo and direct writes',()=>{
 for(const path of ['/rest/v1/rpc/rpc_simulator_apply_plan','/rest/v1/rpc/rpc_simulator_undo_plan','/rest/v1/rpc/rpc_simulator_start_plan','/rest/v1/event_segments'])
  assert.equal(allowedStagingRequest(STAGING_URL+path,'POST'),false)
 for(const method of ['GET','POST','PATCH','DELETE'])assert.equal(allowedStagingRequest('https://bdqzysnapwxdzppkuftn.supabase.co/rest/v1/events',method),false)
 assert.equal(allowedStagingRequest(STAGING_URL+'/rest/v1/rpc/rpc_simulator_plan_history','POST'),true)
 assert.equal(allowedStagingRequest(STAGING_URL+'/rest/v1/event_segments?event_id=eq.990001','GET'),true)
 assert.equal(allowedStagingRequest(STAGING_URL+'/auth/v1/token?grant_type=password','POST'),false)
 assert.equal(allowedStagingRequest(STAGING_URL+'/auth/v1/token?grant_type=refresh_token','POST'),true)
})
test('staging session must belong to staging origin and never include production sessions',()=>{
 const state={origins:[{origin:LOCAL_ORIGIN,localStorage:[{name:'sb-'+STAGING_REF+'-auth-token',value:'not-a-real-token'}]}]}
 validateStagingStorage(state)
 assert.throws(()=>validateStagingStorage({origins:[]}),/No normal staging session/)
 const mixed=structuredClone(state);mixed.origins[0].localStorage.push({name:'sb-bdqzysnapwxdzppkuftn-auth-token',value:'not-real'})
 assert.throws(()=>validateStagingStorage(mixed),/Production session/)
})
test('staging harness keeps normal production gate unchanged and captures no private traces',()=>{
 const source=readFileSync(new URL('./simulatorWorkflowService.js',import.meta.url),'utf8')
 const config=readFileSync(new URL('../../playwright.staging.config.js',import.meta.url),'utf8')
 assert.match(source,/SIMULATOR_WORKFLOW_VERIFIED = simulatorWorkflowActivation/)
 assert.match(config,/reuseExistingServer:false/)
 for(const setting of ["trace:'off'","screenshot:'off'","video:'off'"])assert.ok(config.includes(setting))
})
