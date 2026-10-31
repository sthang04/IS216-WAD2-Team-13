import test from 'node:test'
import assert from 'node:assert/strict'
import {createOriginalBookingWorkflow,ORIGINAL_BOOKING_LINK_VERIFIED} from './simulatorOriginalBookingService.js'
import {createSimulatorWorkflow} from './simulatorWorkflowService.js'
const evidence={event_id:1,segment_id:2,event_fingerprint:'a'.repeat(64),
 bookings:[{booking_id:3,eligible:true,reasons:[],booking_fingerprint:'b'.repeat(64)}]}
test('original discovery uses the new secure read contract, never the plan attachment endpoint',async()=>{
 const calls=[];const api=createOriginalBookingWorkflow({rpc:async(name,args)=>{calls.push({name,args});return {data:evidence}}})
 assert.equal((await api.discover(1,2)).bookings[0].booking_id,3)
 assert.deepEqual(calls,[{name:'rpc_simulator_original_booking_candidates',args:{p_event_id:1,p_segment_id:2}}])
})
test('original write gate OFF means no write request even with eligible evidence',async()=>{
 assert.equal(ORIGINAL_BOOKING_LINK_VERIFIED,false);let calls=0
 const api=createOriginalBookingWorkflow({rpc:async()=>{calls++;return {data:{}}}})
 await assert.rejects(api.link(evidence,evidence.bookings[0],true),/disabled/)
 assert.equal(calls,0)
})
test('explicit confirmation, server fingerprints and confirmed response are mandatory',async()=>{
 const calls=[];const api=createOriginalBookingWorkflow({rpc:async(name,args)=>{calls.push({name,args});return {data:{linked:true,event_id:1,segment_id:2,booking_id:3}}}},{enabled:true})
 await assert.rejects(api.link(evidence,evidence.bookings[0],false),/Explicitly confirm/)
 await assert.rejects(api.link(evidence,{...evidence.bookings[0],eligible:false},true),/eligible/)
 await api.link(evidence,evidence.bookings[0],true)
 assert.equal(calls.length,1);assert.equal(calls[0].name,'rpc_simulator_link_original_booking')
 assert.equal(calls[0].args.p_expected_event_fingerprint,evidence.event_fingerprint)
 assert.ok(!('p_member_id' in calls[0].args))
})
test('missing, unauthorized and malformed discovery errors never become eligible bookings',async()=>{
 for(const response of [{error:{message:'permission denied'}},{data:{}},{data:{...evidence,event_id:9}}]){
  const api=createOriginalBookingWorkflow({rpc:async()=>response})
  await assert.rejects(api.discover(1,2))
 }
})
test('protected inbox can be read with writes disabled but responses cannot bypass the gate',async()=>{
 let calls=0
 const api=createSimulatorWorkflow({rpc:async()=>{calls++;return {data:{invitations:[]}}}},{allowReadOnly:true})
 assert.deepEqual(await api.myInvitations(),{invitations:[]})
 await assert.rejects(api.respond('id','Accepted',true),/not been deployed/)
 assert.equal(calls,1)
})
