import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeSimulatorTimestamp, simulatorTimestampMicros, validateSimulatorRevision,
 captureSimulatorState, prepareRecoveryDraft, projectRecoveryPreview, undoReadiness,
 effectiveInvitationStatus, createSimulatorWorkflow, SIMULATOR_WORKFLOW_VERIFIED } from './simulatorWorkflowService.js'

// These are local JavaScript regressions and SQL source guards only. No SQL is
// executed. Simulated waits DO NOT establish PostgreSQL concurrency correctness.
function fixture() {return {
 events:[{id:1,name:'Microsecond test',club_name:'Test club',starts_at:'2026-11-02T18:00:00.123456+08:00',ends_at:'2026-11-02T19:00:00.654321+08:00'}],
 event_segments:[{id:1,event_id:1,title:'Activity',segment_type:'Performance',starts_at:'2026-11-02T18:00:00.123456+08:00',ends_at:'2026-11-02T19:00:00.654321+08:00'}],
 segment_assignments:[{id:1,segment_id:1,member_id:1,role_name:'Dancer',is_required:true}],segment_facility_bookings:[]}}
const change={segmentId:1,assignmentId:1,replacedMemberId:1,replacementMemberId:2}
const sql=readFileSync(new URL('../../supabase/migrations/202610310002_simulator_recovery_workflow.sql',import.meta.url),'utf8')
function definition(name) {
 const start=sql.indexOf('CREATE FUNCTION '+name+'(')
 const next=sql.indexOf('CREATE FUNCTION ',start+1)
 assert.ok(start>=0,'Function exists: '+name)
 return sql.slice(start,next<0?sql.length:next)
}
test('microsecond timestamps normalize without rounding and differ by exactly one microsecond',()=>{
 const a=normalizeSimulatorTimestamp('2026-11-02T18:00:00.123456+08:00')
 const b=normalizeSimulatorTimestamp('2026-11-02T10:00:00.123457Z')
 assert.equal(a,'2026-11-02T10:00:00.123456Z')
 assert.equal(simulatorTimestampMicros(b)-simulatorTimestampMicros(a),1n)
 assert.equal(normalizeSimulatorTimestamp('2026-11-02T10:00:00.1Z'),'2026-11-02T10:00:00.100000Z')
 assert.equal(normalizeSimulatorTimestamp('2026-11-02T10:00:00Z'),'2026-11-02T10:00:00.000000Z')
 assert.throws(()=>normalizeSimulatorTimestamp('2026-11-02T10:00:00.1234567Z'),/six fractional/)
})
test('member-only preview preserves exact original times and detects sub-millisecond stale state',()=>{
 const before=captureSimulatorState(fixture(),1),after=projectRecoveryPreview(before,[change])
 assert.equal(before.event.starts_at,'2026-11-02T10:00:00.123456Z')
 assert.equal(after.event.starts_at,before.event.starts_at)
 assert.equal(after.segments[0].ends_at,'2026-11-02T11:00:00.654321Z')
 const plan={application_status:'Applied',before_state:before,after_state:after}
 assert.equal(undoReadiness(plan,after).ready,true)
 const newer=structuredClone(after);newer.segments[0].starts_at='2026-11-02T10:00:00.123457Z'
 assert.equal(undoReadiness(plan,newer).ready,false)
 // The recorded original remains exact for a later server-authorised Undo.
 assert.equal(plan.before_state.segments[0].starts_at,'2026-11-02T10:00:00.123456Z')
})
test('period validation distinguishes reversed or valid sub-millisecond periods',()=>{
 const data=fixture()
 const valid=prepareRecoveryDraft(data,1,{changes:[{segmentId:1,starts_at:'2026-11-02T10:00:00.123456Z',ends_at:'2026-11-02T10:00:00.123457Z'}]},[])
 assert.ok(valid.changes.length)
 assert.throws(()=>prepareRecoveryDraft(data,1,{changes:[{segmentId:1,starts_at:'2026-11-02T10:00:00.123457Z',ends_at:'2026-11-02T10:00:00.123456Z'}]},[]),/Invalid proposed/)
})
test('save forwards a server-generated opaque fingerprint and exact captured state',async()=>{
 const draft=prepareRecoveryDraft(fixture(),1,{changes:[change]},[]),calls=[]
 const fingerprint='ab'.repeat(32)
 const api=createSimulatorWorkflow({rpc:async(name,args)=>{
  calls.push({name,args})
  return {data:name==='rpc_simulator_capture_state'?{state:draft.expectedState,fingerprint}:{id:'saved'}}
 }},{enabled:true})
 await api.save(draft,true)
 assert.deepEqual(calls.map(c=>c.name),['rpc_simulator_capture_state','rpc_simulator_save_plan'])
 assert.equal(calls[1].args.p_expected_fingerprint,fingerprint)
 assert.equal(calls[1].args.p_expected_state.segments[0].starts_at,'2026-11-02T10:00:00.123456Z')
})
test('one-microsecond newer server capture cannot silently rebase an older preview',async()=>{
 const draft=prepareRecoveryDraft(fixture(),1,{changes:[change]},[]),newer=structuredClone(draft.expectedState),calls=[]
 newer.segments[0].starts_at='2026-11-02T10:00:00.123457Z'
 const api=createSimulatorWorkflow({rpc:async(name)=>{calls.push(name);return {data:{state:newer,fingerprint:'cd'.repeat(32)}}}},{enabled:true})
 await assert.rejects(api.save(draft,true),/Event changed/)
 assert.deepEqual(calls,['rpc_simulator_capture_state'])
})
test('missing/malformed capture fingerprints fail before Save',async()=>{
 for(const fingerprint of [null,'','short',123]) {
  const draft=prepareRecoveryDraft(fixture(),1,{changes:[change]},[])
  const api=createSimulatorWorkflow({rpc:async()=>({data:{state:draft.expectedState,fingerprint}})},{enabled:true})
  await assert.rejects(api.save(draft,true),/Invalid server state/)
 }
})
test('NULL, absent, string, fractional, non-positive and overflowing revisions make zero requests',async()=>{
 let calls=0;const api=createSimulatorWorkflow({rpc:async()=>{calls++;return {data:{}}}},{enabled:true})
 for(const version of [null,undefined,'1',NaN,Infinity,0,-1,1.5,2147483648]) {
  assert.throws(()=>validateSimulatorRevision(version),/positive integer/)
  await assert.rejects(api.apply({id:'p',version},true,true),/positive integer/)
  await assert.rejects(api.undo({id:'p',version},true,true),/positive integer/)
 }
 assert.equal(calls,0);assert.equal(validateSimulatorRevision(1),1)
})
test('mocked invitation expiring while waiting is rejected after lock release',async()=>{
 let now=Date.parse('2026-11-02T10:00:00Z'),unlock,writes=0
 const invitation={status:'Accepted',expires_at:'2026-11-02T10:00:00.000500Z'}
 const waiting=new Promise(resolve=>{unlock=resolve})
 const api=createSimulatorWorkflow({rpc:async()=>{
  await waiting // Fake lock wait; not a PostgreSQL lock or transaction.
  if(effectiveInvitationStatus(invitation,now)==='Expired') return {data:{ok:false,error:'Invitation expired after waiting'}}
  writes++;return {data:{application_status:'Applied'}}
 }},{enabled:true})
 assert.equal(effectiveInvitationStatus(invitation,now),'Accepted')
 const rejected=assert.rejects(api.apply({id:'p',version:1},true,true),/expired after waiting/)
 now+=1;unlock();await rejected
 assert.equal(writes,0)
})
test('SQL retains lossless snapshots and hashes the server state, not browser JSON',()=>{
 assert.match(definition('simulator_private.iso'),/SS.US/)
 assert.doesNotMatch(definition('simulator_private.iso'),/SS.MS/)
 assert.match(definition('simulator_private.state_fingerprint'),/encode\(sha256\(convert_to\(p_state::text,'UTF8'\)\),'hex'\)/)
 const save=definition('public.rpc_simulator_save_plan')
 assert.match(save,/fingerprint:=simulator_private.state_fingerprint\(snapshot\)/)
 assert.match(save,/p_expected_fingerprint IS NULL/)
 assert.match(save,/snapshot,fingerprint\) RETURNING/)
 const transition=definition('simulator_private.transition_plan')
 assert.match(transition,/p.after_fingerprint ELSE p.before_fingerprint/)
 assert.match(transition,/after_fingerprint=simulator_private.state_fingerprint\(current_state\)/)
})
test('SQL establishes lock timeout before each blocking plan lock and before actor lookup',()=>{
 for(const name of ['public.rpc_simulator_invite','public.rpc_simulator_respond_invitation','public.rpc_simulator_cancel_invitation','simulator_private.transition_plan']) {
  const block=definition(name)
  assert.ok(block.indexOf("set_config('lock_timeout'")<block.indexOf('FOR UPDATE'),name)
 }
 const actor=definition('simulator_private.actor')
 assert.ok(actor.indexOf("set_config('lock_timeout'")<actor.indexOf('FROM public.members'))
})
test('SQL uses wall clock after locking and rechecks consent near completion',()=>{
 const response=definition('public.rpc_simulator_respond_invitation')
 assert.ok(response.lastIndexOf('FOR UPDATE')<response.indexOf('i.expires_at<=clock_timestamp()'))
 const transition=definition('simulator_private.transition_plan')
 const rowLock=transition.indexOf("AND status='Accepted' FOR UPDATE")
 assert.ok(rowLock>0&&rowLock<transition.indexOf('i.expires_at<=clock_timestamp()'))
 assert.match(transition,/Invitation expired before recovery completion/)
 assert.doesNotMatch(sql,/expires_at[<>]=?now\(\)/)
})
test('SQL rejects NULL revisions before row waits and checks stale versions before retries',()=>{
 const block=definition('simulator_private.transition_plan')
 assert.ok(block.indexOf('p_version IS NULL OR p_version<1')<block.indexOf('FOR UPDATE'))
 assert.ok(block.indexOf('p.version IS DISTINCT FROM p_version')<block.indexOf("p.application_status='Applied'"))
})
test('only selected event metadata is row-locked, while necessary phantom protections and history remain',()=>{
 const block=definition('simulator_private.transition_plan')
 assert.doesNotMatch(block,/LOCK TABLE public.events[, ]/)
 assert.match(block,/public.events e WHERE e.id=p.event_id FOR UPDATE/)
 assert.match(block,/LOCK TABLE public.event_segments,public.facility_bookings,public.segment_assignments/)
 assert.match(block,/EXCEPTION WHEN OTHERS/)
 assert.doesNotMatch(sql,/ON DELETE CASCADE|ON DELETE SET NULL|DELETE FROM simulator_private.recovery_audit/)
 assert.match(sql,/default NO ACTION/)
 assert.equal(SIMULATOR_WORKFLOW_VERIFIED,false)
 assert.match(sql,/application_enabled boolean NOT NULL DEFAULT false/)
})
