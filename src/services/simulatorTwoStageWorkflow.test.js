import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createSimulatorWorkflow,prepareRecoveryDraft,captureSimulatorState,workflowReadiness,invitationTerms,projectRecoveryPreview} from './simulatorWorkflowService.js'
// All RPC responses here are mocks. These tests cannot prove SQL transactions,
// PostgreSQL lock behavior, deployment, notification delivery or real persistence.
const data={events:[{id:1,name:'Test',club_name:'Club',starts_at:'2026-11-02T10:00:00.123456Z',ends_at:'2026-11-02T11:00:00Z'}],
 event_segments:[{id:1,event_id:1,title:'Activity',segment_type:'Performance',starts_at:'2026-11-02T10:00:00.123456Z',ends_at:'2026-11-02T11:00:00Z'}],
 segment_assignments:[{id:1,segment_id:1,member_id:1,role_name:'Performer',is_required:true}],segment_facility_bookings:[]}
const member={segmentId:1,assignmentId:1,replacedMemberId:1,replacementMemberId:2,roleName:'Performer'}
const room={segmentId:1,venueName:'Recommended Room'}
const schedule={segmentId:1,starts_at:'2026-11-02T10:30:00Z',ends_at:'2026-11-02T11:30:00Z'}
const requestId='00000000-0000-4000-8000-000000000001'
const draft=changes=>({...prepareRecoveryDraft(data,1,{title:'Recovery',changes},[{type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:30}]),requestId})
const plan=changes=>({id:'persisted-id',version:1,lifecycle:'In Progress',application_status:'Draft',changes,actions:[],before_state:captureSimulatorState(data,1)})
const consent=p=>({plan_id:p.id,recipient_member_id:2,replaced_member_id:1,status:'Accepted',expires_at:'2099-11-02T00:00:00Z',assignment_snapshot:invitationTerms(p,1)})
const ready=(p,invites=[])=>workflowReadiness({enabled:true,plan:p,invites,manualAcknowledged:true})
test('Start captures exact state and calls only Start, preserving pending room and original assignments',async()=>{
 const original=structuredClone(data),calls=[]
 const api=createSimulatorWorkflow({rpc:async(name,args)=>{
  calls.push({name,args})
  return {data:name==='rpc_simulator_capture_state'?{state:draft([member,room]).expectedState,fingerprint:'a'.repeat(64)}:plan([member,room])}
 }},{enabled:true})
 const result=await api.start(draft([member,room]),true)
 assert.equal(result.id,'persisted-id');assert.equal(result.lifecycle,'In Progress')
 assert.deepEqual(calls.map(c=>c.name),['rpc_simulator_capture_state','rpc_simulator_start_plan'])
 assert.equal(calls[1].args.p_request_id,requestId)
 assert.equal(calls[1].args.p_changes[1].facilityBookingId,undefined)
 assert.deepEqual(data,original)
})
test('duplicate Start retries send the same request UUID; no extra client invitation or Apply calls',async()=>{
 const calls=[],d=draft([member])
 const api=createSimulatorWorkflow({rpc:async(name,args)=>{calls.push({name,args});return {data:name==='rpc_simulator_capture_state'?{state:d.expectedState,fingerprint:'b'.repeat(64)}:plan([member])}}},{enabled:true})
 await api.start(d,true);await api.start(d,true)
 assert.deepEqual(calls.filter(c=>c.name==='rpc_simulator_start_plan').map(c=>c.args.p_request_id),[requestId,requestId])
 assert.ok(!calls.some(c=>/apply|invite$/.test(c.name)))
})
test('Start rejects missing request ID, invalid server result, permission errors and stale capture honestly',async()=>{
 let calls=0
 const api=createSimulatorWorkflow({rpc:async()=>{calls++;return {error:{message:'Permission denied'}}}},{enabled:true})
 await assert.rejects(api.start({...draft([member]),requestId:null},true),/UUID/)
 assert.equal(calls,0)
 await assert.rejects(api.start(draft([member]),true),/Permission denied/)
 const stale=createSimulatorWorkflow({rpc:async()=>({data:{state:{},fingerprint:'a'.repeat(64)}})},{enabled:true})
 await assert.rejects(stale.start(draft([member]),true),/Event changed/)
 const missing=createSimulatorWorkflow({rpc:async name=>({data:name==='rpc_simulator_capture_state'?{state:draft([member]).expectedState,fingerprint:'a'.repeat(64)}:{ok:true}})},{enabled:true})
 await assert.rejects(missing.start(draft([member]),true),/persisted recovery/)
})
test('member consent remains separate: Pending Delivery, decline, cancellation and expiry block Confirm',()=>{
 const p=plan([member])
 for(const status of ['Pending','Declined','Expired','Cancelled'])assert.equal(ready(p,[{...consent(p),status}]).ready,false)
 assert.equal(ready(p,[consent(p)]).ready,true)
})
test('room proposals and pending approval block Confirm, approved persisted room action permits prerequisite',()=>{
 const p=plan([room])
 assert.equal(ready(p).ready,false)
 p.actions=[{action:1,kind:'Room',segmentId:1,status:'Pending Approval'}]
 assert.equal(ready(p).ready,false)
 p.actions[0].status='Approved'
 assert.equal(ready(p).ready,true)
})
test('schedule-only confirmation has no unrelated invitation or room prerequisites',()=>{
 const p=plan([schedule]);p.actions=[{action:1,kind:'Schedule',segmentId:1,status:'Awaiting Confirmation'}]
 assert.equal(ready(p).ready,true)
 assert.equal(ready({...p,lifecycle:'Open'}).ready,false)
 assert.equal(ready({...p,application_status:'Cancelled'}).ready,false)
})
test('mixed actions wait for every prerequisite without conflating member and room statuses',()=>{
 const p=plan([member,room,schedule]);p.actions=[{action:2,kind:'Room',segmentId:1,status:'Pending Approval'}]
 assert.equal(ready(p,[consent(p)]).ready,false)
 p.actions[0].status='Approved';assert.equal(ready(p,[consent(p)]).ready,true)
 assert.equal(ready(p,[{...consent(p),status:'Declined'}]).ready,false)
})
test('booking association and Cancel use revisioned RPCs, never mutate event data in the client',async()=>{
 const original=structuredClone(data),calls=[],p=plan([room])
 const api=createSimulatorWorkflow({rpc:async(name,args)=>{calls.push({name,args});return {data:{...p,version:args.p_expected_version,application_status:name==='rpc_simulator_cancel_plan'?'Cancelled':name==='rpc_simulator_apply_plan'?'Applied':name==='rpc_simulator_undo_plan'?'Undone':'Draft',changes:[{...room,facilityBookingId:args.p_booking_id}]}}}},{enabled:true})
 await api.attachBooking(p,1,77,true);await api.cancelPlan(p,true)
 assert.deepEqual(calls.map(c=>c.name),['rpc_simulator_attach_booking','rpc_simulator_cancel_plan'])
 assert.equal(calls[0].args.p_expected_version,1);assert.equal(calls[0].args.p_booking_id,77)
 assert.deepEqual(data,original)
 await assert.rejects(()=>api.cancelPlan({...p,version:null},true),/positive integer/)
})
test('Confirm reuses transactional Apply RPC; Undo remains a distinct revisioned operation',async()=>{
 const calls=[],p=plan([schedule])
 const api=createSimulatorWorkflow({rpc:async(name,args)=>{calls.push({name,args});return {data:{...p,version:args.p_expected_version,application_status:name==='rpc_simulator_apply_plan'?'Applied':'Undone'}}}},{enabled:true})
 await api.confirm(p,true,true);await api.undo({...p,application_status:'Applied',version:2},true,true)
 assert.deepEqual(calls.map(c=>c.name),['rpc_simulator_apply_plan','rpc_simulator_undo_plan'])
 assert.equal(calls[1].args.p_expected_version,2)
})
test('every new operation is gated and server rejection is never reported as success',async()=>{
 let calls=0;const client={rpc:async()=>{calls++;return {data:{ok:false,error:'Stale revision'}}}}
 const disabled=createSimulatorWorkflow(client),p=plan([schedule])
 for(const call of [()=>disabled.start(draft([schedule]),true),()=>disabled.attachBooking(p,1,2,true),()=>disabled.cancelPlan(p,true),()=>disabled.confirm(p,true,true)])
  await assert.rejects(call(),/not been deployed/)
 assert.equal(calls,0)
 await assert.rejects(createSimulatorWorkflow(client,{enabled:true}).confirm(p,true,true),/Stale revision/)
})
test('pending room preview retains original facility links and exact timestamp precision',()=>{
 const d=draft([room]),after=projectRecoveryPreview(d.expectedState,d.changes)
 assert.deepEqual(after,d.expectedState)
 assert.match(after.event.starts_at,/123456Z$/)
})
test('SQL Start/Cancel boundaries retain audit, consent checks, idempotency and restricted grants (source inspection only)',()=>{
 const sql=readFileSync(new URL('../../supabase/migrations/202610310002_simulator_recovery_workflow.sql',import.meta.url),'utf8')
 const start=sql.split('CREATE FUNCTION public.rpc_simulator_start_plan')[1].split('END $$;')[0]
 const cancel=sql.split('CREATE FUNCTION public.rpc_simulator_cancel_plan')[1].split('END $$;')[0]
 assert.match(start,/rpc_simulator_save_plan/);assert.match(start,/rpc_simulator_invite/)
 assert.match(start,/ORDER BY recipient,original/);assert.match(start,/start_payload IS DISTINCT FROM payload/)
 assert.doesNotMatch(start,/UPDATE public\./)
 assert.doesNotMatch(cancel,/UPDATE public\.|DELETE FROM/)
 assert.match(cancel,/status='Cancelled'/);assert.match(cancel,/recovery_audit/)
 for(const text of ['p_expected_version IS NULL','Pending Delivery','Awaiting Claim','Pending Approval','Ready to Confirm',
  'Start Recovery Plan before confirming','Replacement booking is not approved','An actual replacement booking is required'])
  assert.ok(sql.includes(text),text)
 const grants=sql.split('GRANT EXECUTE ON FUNCTION')[1]
 for(const rpc of ['rpc_simulator_start_plan','rpc_simulator_attach_booking','rpc_simulator_cancel_plan'])assert.ok(grants.includes(rpc))
})


test('Start retries preserve captured payload after a lost response, even if later state changes',async()=>{
 const d=draft([member]),calls=[];let first=true
 const api=createSimulatorWorkflow({rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)})
  if(name==='rpc_simulator_capture_state')return {data:{state:d.expectedState,fingerprint:'a'.repeat(64)}}
  if(first){first=false;return {error:{message:'Response lost'}}}
  return {data:plan([member])}
 }},{enabled:true})
 await assert.rejects(api.start(d,true),/Response lost/)
 await api.start(structuredClone(d),true)
 assert.equal(calls.filter(c=>c.name==='rpc_simulator_capture_state').length,1)
 const writes=calls.filter(c=>c.name==='rpc_simulator_start_plan')
 assert.deepEqual(writes[0].args,writes[1].args)
 await assert.rejects(api.start({...d,title:'Different proposal'},true),/different reviewed changes/)
 assert.equal(calls.length,3)
})
test('simultaneous Start calls share one capture and retain the same request payload',async()=>{
 const d=draft([member]),calls=[]
 const api=createSimulatorWorkflow({rpc:async(name,args)=>{calls.push({name,args});return {data:name==='rpc_simulator_capture_state'?{state:d.expectedState,fingerprint:'a'.repeat(64)}:plan([member])}}},{enabled:true})
 await Promise.all([api.start(d,true),api.start(structuredClone(d),true)])
 assert.equal(calls.filter(c=>c.name==='rpc_simulator_capture_state').length,1)
 const writes=calls.filter(c=>c.name==='rpc_simulator_start_plan');assert.equal(writes.length,2);assert.deepEqual(writes[0].args,writes[1].args)
})
