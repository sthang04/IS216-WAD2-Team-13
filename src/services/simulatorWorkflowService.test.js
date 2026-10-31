import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {SIMULATOR_WORKFLOW_VERIFIED,createSimulatorWorkflow,captureSimulatorState,prepareRecoveryDraft,projectRecoveryPreview,undoReadiness,
 workflowReadiness,invitationTerms,effectiveInvitationStatus,bookingEvidence,suggestSimulatorFacilities} from './simulatorWorkflowService.js'
import {deliverSimulatorInvitation} from '../../supabase/functions/_shared/simulatorInvitationDelivery.js'

// All data, RPCs and senders are synthetic mocks. No SQL migrations, database
// transitions or Telegram sends are executed by these tests.
const future='2099-11-02T00:00:00Z'
function fixture() {return {events:[{id:1,name:'Local',club_name:'Club',club_id:10,starts_at:'2026-11-02T18:00:00+08:00',ends_at:'2026-11-02T19:00:00+08:00'}],
 event_segments:[{id:1,event_id:1,title:'Act',segment_type:'Performance',starts_at:'2026-11-02T18:00:00+08:00',ends_at:'2026-11-02T19:00:00+08:00'}],
 segment_assignments:[{id:1,segment_id:1,member_id:1,role_name:'Dancer',is_required:true}],
 segment_facility_bookings:[{segment_id:1,booking_id:1}],members:[{id:1,full_name:'Original'},{id:2,full_name:'Standby'}],
 facilities:[{id:1,name:'Room',capacity:20,equipment:['Sound']}],
 facility_bookings:[{id:1,facility_id:1,owner_club_id:10,booking_date:'2026-11-02',start_time:'17:00:00',end_time:'22:00:00',status:'Booked'}]}}
const member={segmentId:1,assignmentId:1,replacedMemberId:1,replacementMemberId:2,roleName:'Dancer'}
function plan(changes=[member]) {return {id:'synthetic-plan',version:1,application_status:'Draft',lifecycle:'In Progress',actions:[],changes,before_state:captureSimulatorState(fixture(),1)}}
function accepted(p) {return {plan_id:p.id,recipient_member_id:2,replaced_member_id:1,status:'Accepted',expires_at:future,assignment_snapshot:invitationTerms(p,1)}}

test('release gate is false and disabled adapter makes zero requests for all actions',async()=>{
 assert.equal(SIMULATOR_WORKFLOW_VERIFIED,false)
 let calls=0;const api=createSimulatorWorkflow({rpc:async()=>{calls++;return {data:{}}}})
 for(const request of [()=>api.history(1),()=>api.invitation('i'),()=>api.save({},true),()=>api.invite('p',2,1,true),
  ()=>api.respond('i','Accepted',true),()=>api.cancel('i',true),()=>api.apply(plan(),true,true),()=>api.undo(plan(),true,true)]) {
  await assert.rejects(request(),/not been deployed/)
 }
 assert.equal(calls,0)
})
test('enabled adapter requires explicit confirmation before mutations',async()=>{
 let calls=0;const api=createSimulatorWorkflow({rpc:async()=>{calls++;return {data:{id:'p'},error:null}}},{enabled:true})
 await assert.rejects(api.apply(plan(),true,false),/Confirm/);await assert.rejects(api.undo(plan(),true,false),/Confirm/)
 assert.equal(calls,0)
})
test('RPC requests contain no caller identity; server derives it',async()=>{
 const calls=[];const api=createSimulatorWorkflow({rpc:async(name,args)=>{
  calls.push({name,args})
  const data=name==='rpc_simulator_invite'?{id:'i',plan_id:args.p_plan_id,recipient_member_id:2,replaced_member_id:1,status:'Pending'}:
   name==='rpc_simulator_respond_invitation'?{id:'i',status:'Accepted'}:
   name==='rpc_simulator_cancel_invitation'?{id:'i',status:'Cancelled'}:
   {id:args.p_plan_id,version:1,application_status:name==='rpc_simulator_apply_plan'?'Applied':'Undone'}
  return {data}
 }},{enabled:true})
 await api.invite('p',2,1,true);await api.respond('i','Accepted',true);await api.cancel('i',true)
 await api.apply(plan(),true,true);await api.undo(plan(),true,true)
 assert.equal(calls[0].name,'rpc_simulator_invite')
 assert.deepEqual(calls[1].args,{p_invitation_id:'i',p_response:'Accepted'})
 assert.ok(calls.every(c=>!('p_actor' in c.args)&&!('p_user_id' in c.args)))
})
test('backend failures, stale revisions and transaction errors remain errors',async()=>{
 for(const response of [{error:{message:'not authorised'}},{data:{ok:false,error:'stale plan'}},{data:null},
  {data:{ok:false,error:'original room unavailable'}},{data:{ok:false,error:'transaction rolled back'}}]) {
  const api=createSimulatorWorkflow({rpc:async()=>response},{enabled:true})
  await assert.rejects(api.apply(plan(),true,true));await assert.rejects(api.undo(plan(),true,true))
 }
 const api=createSimulatorWorkflow({rpc:async()=>{throw Error('network unavailable')}},{enabled:true})
 await assert.rejects(api.history(1),/network/)
})
test('response statuses are restricted to website Accept/Decline',async()=>{
 const api=createSimulatorWorkflow({rpc:async()=>({data:{id:'i',status:'Declined'}})},{enabled:true})
 assert.throws(()=>api.respond('i','Expired',true),/Accept or Decline/)
 assert.equal((await api.respond('i','Declined',true)).status,'Declined')
})
test('snapshot timestamps normalize to SQL UTC shape without private member fields',()=>{
 const data=fixture();data.members[0].student_email='private'
 const state=captureSimulatorState(data,1)
 assert.equal(state.event.starts_at,'2026-11-02T10:00:00.000000Z')
 assert.ok(!JSON.stringify(state).includes('private'))
 assert.throws(()=>captureSimulatorState({...data,segment_assignments:[{segment_id:1}]},1),/incomplete/)
})
test('plan normalization rejects invalid assignments/periods and retains pending room proposals',()=>{
 const data=fixture(),draft=prepareRecoveryDraft(data,1,{changes:[member]},[])
 assert.equal(draft.changes[0].assignmentId,1)
 assert.throws(()=>prepareRecoveryDraft(data,1,{changes:[{...member,assignmentId:99}]},[]),/exact assignment/)
 assert.equal(prepareRecoveryDraft(data,1,{changes:[{segmentId:1,venueName:'Room'}]},[]).changes[0].facilityBookingId,undefined)
 assert.throws(()=>prepareRecoveryDraft(data,1,{changes:[{segmentId:1,ends_at:'invalid'}]},[]),/Invalid proposed/)
 assert.throws(()=>prepareRecoveryDraft(data,1,{changes:[member],selectionIssues:['contradiction']},[]),/non-contradictory/)
})
test('exact accepted terms and manual acknowledgement are prerequisites',()=>{
 const p=plan();assert.equal(workflowReadiness({enabled:true,plan:p,invites:[accepted(p)],manualAcknowledged:true}).ready,true)
 assert.equal(workflowReadiness({enabled:true,plan:p,invites:[accepted(p)],manualAcknowledged:false}).ready,false)
 for(const status of ['Pending','Declined','Cancelled','Expired']) assert.equal(workflowReadiness({enabled:true,plan:p,
  invites:[{...accepted(p),status}],manualAcknowledged:true}).ready,false)
 assert.equal(workflowReadiness({enabled:true,plan:p,invites:[{...accepted(p),expires_at:'2000-01-01'}],manualAcknowledged:true}).ready,false)
})
test('changed roles, times or recipients cannot reuse acceptance',()=>{
 const p=plan(),invite=accepted(p)
 for(const changed of [{...invite,recipient_member_id:3},{...invite,assignment_snapshot:[]},
  {...invite,assignment_snapshot:[{...invite.assignment_snapshot[0],role_name:'Other'}]}]) {
  assert.equal(workflowReadiness({enabled:true,plan:p,invites:[changed],manualAcknowledged:true}).ready,false)
 }
 p.changes.push({segmentId:1,starts_at:'2026-11-02T11:00:00Z',ends_at:'2026-11-02T12:00:00Z'})
 assert.equal(workflowReadiness({enabled:true,plan:p,invites:[invite],manualAcknowledged:true}).ready,false)
})
test('expiry handles missing/invalid dates and duplicate status display safely',()=>{
 assert.equal(effectiveInvitationStatus({status:'Pending',expires_at:'bad'}),'Expired')
 assert.equal(effectiveInvitationStatus({status:'Accepted',expires_at:'2000-01-01'}),'Expired')
 assert.equal(effectiveInvitationStatus({status:'Cancelled',expires_at:future}),'Cancelled')
})
for(const [name,changes] of Object.entries({member:[member],schedule:[{segmentId:1,starts_at:'2026-11-02T11:00:00Z',ends_at:'2026-11-02T12:00:00Z'}],
 facility:[{segmentId:1,facilityBookingId:2}],combined:[member,{segmentId:1,starts_at:'2026-11-02T11:00:00Z',ends_at:'2026-11-02T12:00:00Z',facilityBookingId:2}]})) {
 test(name+' before/after preview supports a reversible snapshot (local model only)',()=>{
  const before=captureSimulatorState(fixture(),1),original=structuredClone(before)
  const after=projectRecoveryPreview(before,changes)
  assert.deepEqual(before,original);assert.notDeepEqual(after,before)
  const p={application_status:'Applied',before_state:before,after_state:after}
  assert.equal(undoReadiness(p,after).ready,true)
  const reordered=JSON.parse(JSON.stringify(after,(key,value)=>value))
  assert.equal(undoReadiness(p,reordered).ready,true)
  const newer=structuredClone(after);newer.segments[0].title='Newer edit'
  assert.equal(undoReadiness(p,newer).ready,false)
  assert.equal(undoReadiness({...p,application_status:'Undone'},after).ready,false)
 })
}
test('unrelated records outside the selected event do not change its snapshot',()=>{
 const data=fixture(),before=captureSimulatorState(data,1)
 data.event_segments.push({id:999,event_id:2,title:'Unrelated'})
 assert.deepEqual(captureSimulatorState(data,1),before)
})
test('facility evidence distinguishes physical conflicts, ownership and approval',()=>{
 const data=fixture(),start=data.event_segments[0].starts_at,end=data.event_segments[0].ends_at
 assert.deepEqual(bookingEvidence(data,1,10,start,end).reasons,[])
 data.facility_bookings[0].status='Pending Admin Sign-off'
 assert.ok(bookingEvidence(data,1,10,start,end).reasons.some(r=>r.includes('not confirmed')))
 data.facility_bookings[0].owner_club_id=99
 assert.ok(bookingEvidence(data,1,10,start,end).reasons.some(r=>r.includes('another club')))
 data.facility_bookings.push({...data.facility_bookings[0],id:2})
 assert.ok(bookingEvidence(data,1,10,start,end).reasons.some(r=>r.includes('overlaps')))
 assert.equal(bookingEvidence(data,999,10,start,end).status,'Unverified')
})
const invitation={id:'synthetic-invitation',recipient_member_id:2,status:'Pending',expires_at:future,event_name:'Local event',
 assignment_snapshot:[{activity:'Act',role_name:'Dancer',starts_at:'2026-11-02T10:00:00Z',ends_at:'2026-11-02T11:00:00Z'}]}
test('Telegram adapter reuses injected sender, persisted terms and an idempotency key',async()=>{
 const calls=[];const sender=async payload=>{calls.push(payload);return {status:'Sent',messageId:'mock-id'}}
 assert.equal((await deliverSimulatorInvitation(invitation,{origin:'https://pulse.example',sendExistingNotification:sender})).status,'Sent')
 assert.equal(calls[0].recipientMemberId,2);assert.match(calls[0].link,/replacementInvitation=/)
 assert.equal(calls[0].idempotencyKey,'simulator-invitation:synthetic-invitation')
 assert.ok(!('token' in calls[0]));assert.ok(!('reply_markup' in calls[0]))
})
test('Telegram missing sender, queued responses, invalid terms and delivery failures are not success',async()=>{
 await assert.rejects(deliverSimulatorInvitation(invitation,{origin:'https://pulse.example'}),/not connected/)
 await assert.rejects(deliverSimulatorInvitation(invitation,{origin:'http://pulse.example',sendExistingNotification:async()=>({})}),/HTTPS/)
 await assert.rejects(deliverSimulatorInvitation(invitation,{origin:'https://pulse.example',sendExistingNotification:async()=>({status:'Queued'})}),/not confirmed/)
 await assert.rejects(deliverSimulatorInvitation({...invitation,status:'Cancelled'},{origin:'https://pulse.example',sendExistingNotification:async()=>({})}),/not deliverable/)
 await assert.rejects(deliverSimulatorInvitation(invitation,{origin:'https://pulse.example',sendExistingNotification:async()=>{throw Error('send failed')}}),/send failed/)
})
test('SQL preparation contains release gates, exact state checks, transaction locks and restrictive grants',()=>{
 // Structural review only. This does NOT execute PostgreSQL or prove concurrency.
 const sql=readFileSync(new URL('../../supabase/migrations/202610310002_simulator_recovery_workflow.sql',import.meta.url),'utf8')
 for(const text of ['SECURITY DEFINER','SET search_path=pg_catalog','auth.uid()','can_manage_members','FOR UPDATE','LOCK TABLE',
  'p.after_state','p.before_state','p.version IS DISTINCT FROM p_version','EXCEPTION WHEN OTHERS','application_enabled boolean NOT NULL DEFAULT false',
  'invitations_enabled boolean NOT NULL DEFAULT false','Original assignment changed','No','Undo']) {
  if(!['No','Undo'].includes(text)) assert.ok(sql.includes(text),text)
 }
 assert.doesNotMatch(sql,/CREATE OR REPLACE|CREATE POLICY|ALTER TABLE public\./)
 assert.match(sql,/REVOKE ALL ON ALL FUNCTIONS IN SCHEMA simulator_private/)
 assert.match(sql,/p_undo AND p.application_status='Undone'/)
 assert.match(sql,/outcome,details/)
})

test('SQL migration has one transaction, unique function definitions and a complete final COMMIT',()=>{
 const sql=readFileSync(new URL('../../supabase/migrations/202610310002_simulator_recovery_workflow.sql',import.meta.url),'utf8')
 assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1)
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1)
 assert.ok(sql.trimEnd().endsWith('COMMIT;'))
 const names=[...sql.matchAll(/^CREATE FUNCTION ([^(]+)/gm)].map(m=>m[1])
 assert.equal(names.length,22);assert.equal(new Set(names).size,names.length)
 assert.equal((sql.match(/AS \$\$/g)||[]).length,22)
 assert.equal((sql.match(/^END \$\$;|^\$\$;/gm)||[]).length,22)
})
test('split timing fields are both included in acceptance terms',()=>{
 const p=plan([member,{segmentId:1,starts_at:'2026-11-02T11:00:00Z'},{segmentId:1,ends_at:'2026-11-02T12:00:00Z'}])
 const terms=invitationTerms(p,1)
 assert.equal(terms[0].starts_at,'2026-11-02T11:00:00.000000Z')
 assert.equal(terms[0].ends_at,'2026-11-02T12:00:00.000000Z')
})

test('malformed history and non-object RPC payloads cannot crash a successful workflow',async()=>{
 for(const data of [{},'invalid',[],null]) {
  const api=createSimulatorWorkflow({rpc:async()=>({data,error:null})},{enabled:true})
  await assert.rejects(api.history(1))
 }
 const api=createSimulatorWorkflow({rpc:async()=>({data:{plans:[],invitations:[],audit:[]}})},{enabled:true})
 assert.deepEqual((await api.history(1)).plans,[])
})

test('shared inventory suggestions never treat missing bookings as confirmed vacancy',()=>{
 const data=fixture();data.facilities.push({id:2,name:'Unbooked room',capacity:40,facility_type:'Studio'})
 const suggestions=suggestSimulatorFacilities(data,1,data.event_segments[0].starts_at,data.event_segments[0].ends_at)
 assert.match(suggestions.find(f=>f.id===2).status,/unverified/)
 data.facilities[1].capacity=0
 assert.equal(suggestSimulatorFacilities(data,1,data.event_segments[0].starts_at,data.event_segments[0].ends_at).find(f=>f.id===2).blocked,true)
 data.facilities[1].is_active=false
 assert.ok(!suggestSimulatorFacilities(data,1,data.event_segments[0].starts_at,data.event_segments[0].ends_at).some(f=>f.id===2))
})

test('mutation transport success is not persisted-operation confirmation',async()=>{
 const p=plan(),cases=[
  ['rpc_simulator_apply_plan',()=>api=>api.apply(p,true,true)],
  ['rpc_simulator_undo_plan',()=>api=>api.undo(p,true,true)],
  ['rpc_simulator_cancel_plan',()=>api=>api.cancelPlan(p,true)],
  ['rpc_simulator_attach_booking',()=>api=>api.attachBooking(p,1,77,true)],
  ['rpc_simulator_respond_invitation',()=>api=>api.respond('i','Accepted',true)],
  ['rpc_simulator_cancel_invitation',()=>api=>api.cancel('i',true)],
  ['rpc_simulator_invite',()=>api=>api.invite(p.id,2,1,true)]
 ]
 for(const [name,run] of cases)for(const data of [{},{ok:true},{id:'unrelated',version:1,status:'Accepted',application_status:'Applied'}]){
  const api=createSimulatorWorkflow({rpc:async actual=>{assert.equal(actual,name);return {data}}},{enabled:true})
  await assert.rejects(run()(api),/did not confirm/,name)
 }
})
test('wrong consent status and wrong booking association are not reported as successful',async()=>{
 const p=plan(),api=createSimulatorWorkflow({rpc:async name=>({data:name==='rpc_simulator_respond_invitation'?{id:'i',status:'Declined'}:
  {...p,changes:[{segmentId:1,facilityBookingId:88}]}})},{enabled:true})
 await assert.rejects(api.respond('i','Accepted',true),/did not confirm/)
 await assert.rejects(api.attachBooking(p,1,77,true),/did not confirm/)
})

test('Apply and Undo reject absent saved plan IDs before sending any RPC',async()=>{
 let calls=0;const api=createSimulatorWorkflow({rpc:async()=>{calls++;return {data:{}}}},{enabled:true})
 for(const id of [null,undefined,'','  ']){
  await assert.rejects(api.apply({id,version:1},true,true),/saved recovery plan/)
  await assert.rejects(api.undo({id,version:1},true,true),/saved recovery plan/)
 }
 assert.equal(calls,0)
})
