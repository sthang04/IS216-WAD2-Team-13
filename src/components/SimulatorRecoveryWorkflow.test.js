import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as Vue from 'vue'
import {parse,compileScript,compileTemplate} from 'vue/compiler-sfc'
import * as workflow from '../services/simulatorWorkflowService.js'
import {simulatorWorkflowError} from '../services/simulatorWorkflowActivation.js'

// Compile the real components; only authenticated RPC responses are mocked.
// Enabling the injected constant here cannot enable the production source gate.
const flush=async()=>{for(let i=0;i<12;i++){await Promise.resolve();await Vue.nextTick()}}
const empty=()=>({plans:[],invitations:[],audit:[]})
const data={events:[{id:1,club_id:7,club_name:'Event club',name:'Event',starts_at:'2026-11-02T10:00:00Z',ends_at:'2026-11-02T11:00:00Z'},
 {id:2,club_id:8,name:'Other',starts_at:'2026-11-02T10:00:00Z',ends_at:'2026-11-02T11:00:00Z'}],
 event_segments:[{id:11,event_id:1,title:'Activity',segment_type:'Performance',starts_at:'2026-11-02T10:00:00Z',ends_at:'2026-11-02T11:00:00Z'}],
 segment_assignments:[],segment_facility_bookings:[]}
const option={id:'delay',title:'Delay',changes:[{segmentId:11,starts_at:'2026-11-02T10:05:00Z',ends_at:'2026-11-02T11:05:00Z'}]}
async function mount(name,api,enabled=true,initial={}){
 const {descriptor}=parse(readFileSync(new URL('./'+name+'.vue',import.meta.url),'utf8'))
 const script=compileScript(descriptor,{id:'recovery-regression'})
 const template=compileTemplate({source:descriptor.template.content,filename:name+'.vue',id:'recovery-regression',compilerOptions:{bindingMetadata:script.bindings}})
 assert.deepEqual(template.errors,[])
 const code=script.content.replace(/import[\s\S]*?from ['"][^'"]+['"];?/g,'').replace('export default','return')
 let auth
 const deps={...Vue,...workflow,simulatorWorkflowError,SIMULATOR_WORKFLOW_VERIFIED:enabled,createSimulatorWorkflow:()=>({capabilities:async()=>({contract_version:4,application_enabled:enabled,invitations_enabled:enabled}),...api}),
  supabase:{auth:{onAuthStateChange(callback){auth=callback;return {data:{subscription:{unsubscribe(){}}}}}}},
  SimulatorCalendarActions:{render:()=>null}}
 const entries=Object.entries(deps).filter(([key])=>/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key));
 const component=new Function(...entries.map(([key])=>key),code)(...entries.map(([,value])=>value));component.render=()=>null
 const props=Vue.reactive({data:structuredClone(data),eventId:1,options:[structuredClone(option)],disruptions:[],...initial})
 let instance
 const renderer=Vue.createRenderer({insert(){},remove(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}})
 const app=renderer.createApp({render:()=>Vue.h(component,{...props,ref:value=>{if(value)instance=value}})})
 app.mount({});await flush()
 return {app,props,state:instance.$.setupState,auth:(...args)=>auth(...args)}
}

test('recovery history loads initially and uses selected event club; production gate stays off',async()=>{
 const calls=[]
 const view=await mount('SimulatorRecoveryWorkflow',{history:async id=>{calls.push(id);return empty()}},false)
 try{assert.deepEqual(calls,[1]);assert.equal(view.state.eventClubId,7);assert.equal(view.state.historyLoading,false)
  view.state.queueAction('Cancel',()=>assert.fail('write'),'done');assert.match(view.state.error,/disabled/)
  assert.equal(workflow.SIMULATOR_WORKFLOW_VERIFIED,false)
 }finally{view.app.unmount()}
})

test('late history from a previous event cannot replace current event results',async()=>{
 let finish
 const view=await mount('SimulatorRecoveryWorkflow',{history:id=>id===1?new Promise(resolve=>{finish=resolve}):Promise.resolve({...empty(),plans:[{id:'other',event_id:2}]})})
 try{view.props.eventId=2;await flush();assert.equal(view.state.eventClubId,8)
  finish({...empty(),plans:[{id:'old',event_id:1}]});await flush()
  assert.equal(view.state.history.plans[0].id,'other')
 }finally{view.app.unmount()}
})

test('Start requires action-specific confirmation and preserves UUID across equivalent options and lost responses',async()=>{
 const requests=[];let fail=true
 const view=await mount('SimulatorRecoveryWorkflow',{history:async()=>empty(),start:async draft=>{requests.push(draft);if(fail)throw Error('Response lost');return {id:'saved'}}})
 try{
  view.state.selectedOptionId='delay';await flush()
  view.state.startPlan();assert.equal(requests.length,0)
  await view.state.executePending();assert.equal(requests.length,0)
  view.state.confirmed=true;await view.state.executePending();assert.equal(requests.length,1)
  view.props.options=[structuredClone(option)];await flush();fail=false
  view.state.startPlan();view.state.confirmed=true;await view.state.executePending()
  assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId)
 }finally{view.app.unmount()}
})

test('changing reviewed inputs invalidates confirmation; switching accounts clears prior history',async()=>{
 const view=await mount('SimulatorRecoveryWorkflow',{history:async()=>empty()})
 try{view.state.queueAction('Cancel',()=>assert.fail('stale write'),'done');view.state.confirmed=true
  view.state.manualAcknowledged=true;await flush();assert.equal(view.state.pendingAction,null);assert.equal(view.state.confirmed,false)
  view.state.history={...empty(),plans:[{id:'private'}]};view.auth('SIGNED_IN',{user:{id:'new-account'}});await flush()
  assert.equal(view.state.history.plans.length,0)
 }finally{view.app.unmount()}
})

test('invitation response refreshes history and exact terms, and signals inbox refresh',async()=>{
 let reads=0,responses=0
 const view=await mount('SimulatorRecoveryWorkflow',{history:async()=>{reads++;return empty()},respond:async()=>{responses++;return {status:'Accepted'}},invitation:async()=>({id:'invite',status:'Accepted'})})
 try{
  view.state.invitationId='invite';view.state.incoming={id:'invite',status:'Pending'};await flush()
  view.state.respond('Accepted');assert.equal(responses,0);view.state.confirmed=true
  await view.state.executePending();assert.equal(responses,1);assert.equal(reads,2)
  assert.equal(view.state.incoming.status,'Accepted');assert.match(view.state.message,/persisted/)
 }finally{view.app.unmount()}
})

test('persisted write remains successful when subsequent history refresh fails',async()=>{
 let reads=0
 const view=await mount('SimulatorRecoveryWorkflow',{history:async()=>{if(++reads>1)throw Error('read unavailable');return empty()}})
 try{view.state.queueAction('Cancel',async()=>({}),'Persisted cancellation');view.state.confirmed=true
  await view.state.executePending();assert.equal(view.state.error,'');assert.equal(view.state.message,'Persisted cancellation')
  assert.match(view.state.historyError,/read unavailable/)
 }finally{view.app.unmount()}
})

test('recipient inbox loads automatically, confirms one response and refreshes real status',async()=>{
 let reads=0,writes=0
 const invitation={id:'recipient-invite',event_name:'Event',status:'Pending',expires_at:'2099-11-02T00:00:00Z',assignment_snapshot:[]}
 const view=await mount('SimulatorInvitationInbox',{myInvitations:async()=>({invitations:[{...invitation,status:++reads>1?'Accepted':'Pending'}]}),respond:async()=>{writes++;return {status:'Accepted'}}})
 try{assert.equal(reads,1);view.state.respond(view.state.invitations[0],'Accepted');assert.equal(writes,0)
  view.state.confirmed=true;await view.state.confirmResponse();assert.equal(writes,1);assert.equal(reads,2)
  assert.equal(view.state.invitations[0].status,'Accepted');assert.equal(view.state.pending,null)
 }finally{view.app.unmount()}
})

test('recipient inbox cannot respond to expired or changed terms',async()=>{
 const view=await mount('SimulatorInvitationInbox',{myInvitations:async()=>({invitations:[{id:'i',status:'Pending',expires_at:'2099-01-01T00:00:00Z',assignment_snapshot:[]}]}),respond:()=>assert.fail('stale consent')})
 try{view.state.respond(view.state.invitations[0],'Accepted');view.state.invitations[0].assignment_snapshot.push({activity:'changed'})
  view.state.confirmed=true;await view.state.confirmResponse();assert.match(view.state.error,/changed or expired/)
 }finally{view.app.unmount()}
})

test('recipient response refresh signal reloads selected-event history without changing its club',async()=>{
 let reads=0
 const view=await mount('SimulatorRecoveryWorkflow',{history:async()=>{reads++;return empty()}})
 try{view.props.refreshVersion=1;await flush();assert.equal(reads,2);assert.equal(view.state.eventClubId,7)}
 finally{view.app.unmount()}
})
test('a late recipient inbox read cannot reveal the previous signed-in account data',async()=>{
 let resolveFirst,calls=0
 const view=await mount('SimulatorInvitationInbox',{myInvitations:()=>++calls===1?new Promise(resolve=>{resolveFirst=resolve}):Promise.resolve({invitations:[]})})
 try{view.auth('SIGNED_IN',{user:{id:'different'}});await flush()
  resolveFirst({invitations:[{id:'previous-private-invite',assignment_snapshot:[]}]});await flush()
  assert.deepEqual(view.state.invitations,[])
 }finally{view.app.unmount()}
})

test('application ON with invitations OFF permits Apply review but blocks Start and recipient responses',async()=>{
 const gates={contract_version:4,application_enabled:true,invitations_enabled:false}
 const view=await mount('SimulatorRecoveryWorkflow',{history:async()=>empty(),capabilities:async()=>gates})
 try{
  assert.equal(view.state.applicationEnabled,true);assert.equal(view.state.invitationEnabled,false)
  view.state.queueAction('Start',()=>assert.fail('gate bypass'),'done')
  assert.equal(view.state.pendingAction,null)
  view.state.queueAction('Confirm Recovery',async()=>({}),'done',{application:true})
  assert.equal(view.state.pendingAction.label,'Confirm Recovery')
 }finally{view.app.unmount()}
 const inbox=await mount('SimulatorInvitationInbox',{capabilities:async()=>gates,myInvitations:async()=>({invitations:[]})})
 try{assert.equal(inbox.state.invitationEnabled,false)}finally{inbox.app.unmount()}
})
test('unavailable reviewed capability RPC keeps all mutation actions disabled',async()=>{
 const view=await mount('SimulatorRecoveryWorkflow',{history:async()=>empty(),capabilities:async()=>{throw Error('function unavailable')}})
 try{assert.equal(view.state.applicationEnabled,false);assert.equal(view.state.invitationEnabled,false);assert.match(view.state.capabilityError,/not verified/)}
 finally{view.app.unmount()}
})

test('resolution requires confirmation and refreshes the applied plan revision and audit status',async()=>{
 const item={type:'MEMBER_UNAVAILABLE',memberId:3,start:'2026-11-02T10:00:00Z',end:'2026-11-02T12:00:00Z'}
 let calls=0,resolved=false
 const saved={id:'p',event_id:1,version:2,application_status:'Applied',after_fingerprint:'a'.repeat(64),disruptions:[item],changes:[]}
 const api={history:async()=>({plans:[{...saved,version:resolved?3:2}],invitations:[],audit:resolved?[{plan_id:'p',action:'DISRUPTION_RESOLVED',outcome:'Succeeded',details:JSON.stringify({disruption_index:1,disruption:item,applied_fingerprint:saved.after_fingerprint,reason:'Original availability independently verified.'})}]:[]}),
  resolveDisruption:async(p,index,note,confirmed)=>{calls++;assert.equal(p.version,2);assert.equal(index,1);assert.equal(confirmed,true);resolved=true;return {resolved:true}}}
 const view=await mount('SimulatorRecoveryWorkflow',api)
 try{
  view.state.selectedPlanId='p';await flush()
  assert.equal(view.state.disruptionResolutions[0].resolved,false)
  view.state.manualAcknowledged=true;view.state.resolutionReasons[1]='Original availability independently verified.';await flush()
  view.state.resolveDisruption(view.state.disruptionResolutions[0]);assert.equal(calls,0)
  view.state.confirmed=true;await view.state.executePending()
  assert.equal(calls,1);assert.equal(view.state.plan.version,3);assert.equal(view.state.disruptionResolutions[0].resolved,true)
 }finally{view.app.unmount()}
})

test('Apply stays busy until event refresh finishes, using the selected saved revision',async()=>{
 let finish,refreshes=0,applies=0
 const p={id:'p',event_id:1,version:7,application_status:'Draft',changes:[],actions:[],lifecycle:'In Progress'}
 const view=await mount('SimulatorRecoveryWorkflow',{history:async()=>({...empty(),plans:[p]}),confirm:async(current,ack,confirmed)=>{
  applies++;assert.equal(current.id,'p');assert.equal(current.version,7);assert.equal(ack,true);assert.equal(confirmed,true);return {...p,version:8,application_status:'Applied'}
 }},true,{refreshEvent:()=>{refreshes++;return new Promise(resolve=>{finish=resolve})}})
 try{
  view.state.selectedPlanId='p';view.state.manualAcknowledged=true;await flush()
  view.state.applyPlan();assert.equal(applies,0);view.state.confirmed=true
  const operation=view.state.executePending();await flush()
  assert.equal(applies,1);assert.equal(refreshes,1);assert.equal(view.state.busy,true)
  finish(true);await operation
  assert.equal(view.state.busy,false);assert.equal(view.state.busyAction,'')
 }finally{view.app.unmount()}
})
test('event refresh failure is a warning after confirmed persistence, not a fake write failure',async()=>{
 const view=await mount('SimulatorRecoveryWorkflow',{history:async()=>empty()},true,{refreshEvent:async()=>false})
 try{
  view.state.queueAction('Confirm Recovery',async()=>({}),'Persisted by server',{application:true,refresh:true})
  view.state.confirmed=true;await view.state.executePending()
  assert.equal(view.state.message,'Persisted by server');assert.equal(view.state.error,'')
  assert.match(view.state.refreshWarning,/operation was saved/)
 }finally{view.app.unmount()}
})
