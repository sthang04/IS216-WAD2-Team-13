import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getSimulationTestData } from '../data/simulationTestData.js'
import { recommendMemberReplacements } from './recoveryRecommendationService.js'
import { evaluateRecoveryPlan } from './recoveryPlanEvaluationService.js'
import { runCompleteSimulation } from './simulationService.js'

// Tests use synthetic records only: no Supabase client, credentials or network.
const disruption = {type:'MEMBER_UNAVAILABLE',memberId:2,start:'2027-10-16T18:30:00+08:00',end:'2027-10-16T21:00:00+08:00'}
const rank = (data=getSimulationTestData(), ds=[disruption], limit=Infinity) => recommendMemberReplacements(data,1,2,ds,limit)
const candidate = (data,id) => rank(data).find(c => c.id === id)
// Isolate replacement review tests from the fixture's deliberate unrelated clash.
const evaluationData = () => {
  const data=getSimulationTestData()
  data.segment_assignments=data.segment_assignments.filter(a=>!(a.member_id===4 && a.segment_id===21))
  return data
}
const option = id => ({id:'test',title:'Replacement',changes:[3,4].map(segmentId => ({segmentId,replacedMemberId:2,replacementMemberId:id}))})

test('exact experience ranks before review candidates and has expected score',()=>{
  const rows=rank(); assert.equal(rows[0].id,6); assert.equal(rows[0].score,100)
  assert.equal(rows[0].requiresManualReview,false)
  assert.ok(rows.findIndex(c=>c.id===14)<rows.findIndex(c=>c.id===9))
  assert.equal(rows.find(c=>c.id===14).score,92)
})
test('unassigned standby is included for review, never called qualified',()=>{
  const data=getSimulationTestData(); assert.ok(!data.segment_assignments.some(a=>a.member_id===9))
  const c=candidate(data,9); assert.equal(c.roleMatch,'unverified'); assert.equal(c.requiresManualReview,true)
})
test('nonmatching role is explained separately from availability',()=>{
  const c=candidate(getSimulationTestData(),8); assert.equal(c.roleMatch,'none')
  assert.equal(c.availabilityVerified,true); assert.match(c.reason,/do not match/)
})
test('partial role coverage requires review; full multi-role coverage is exact',()=>{
  const data=getSimulationTestData()
  data.segment_assignments.find(a=>a.member_id===2 && a.segment_id===3).role_name='Dance Captain'
  data.segment_assignments.push({member_id:6,segment_id:20,role_name:'Dance Captain'})
  assert.equal(candidate(data,7).roleMatch,'partial'); assert.equal(candidate(data,7).requiresManualReview,true)
  assert.equal(candidate(data,6).roleMatch,'exact')
})
test('inactive, wrong-club, absent and unverified memberships are excluded',()=>{
  const data=getSimulationTestData(); assert.ok(!candidate(data,11)); assert.ok(!candidate(data,12))
  data.replacement_memberships=data.replacement_memberships.filter(m=>m.memberId!==6)
  data.replacement_memberships.find(m=>m.memberId===9).verified=false
  assert.ok(!candidate(data,6)); assert.ok(!candidate(data,9))
})
test('busy timetable and cross-event assignment conflicts are excluded',()=>{
  const data=getSimulationTestData(); assert.ok(!candidate(data,10)); assert.ok(!candidate(data,4))
})
test('simulated unavailability excludes a candidate',()=>{
  assert.ok(!rank(getSimulationTestData(),[disruption,{...disruption,memberId:13}]).some(c=>c.id===13))
})
test('adjacent intervals are not clashes',()=>{
  const data=getSimulationTestData(); data.member_busy_periods[0].end=disruption.start
  data.member_busy_periods[0].start='2027-10-16T17:00:00+08:00'
  assert.ok(candidate(data,10))
})
test('unknown schedule coverage requires review and earns no availability points',()=>{
  const data=getSimulationTestData(); data.member_replacement_coverage.scheduleVerified=false
  const c=candidate(data,6); assert.equal(c.roleMatch,'exact'); assert.equal(c.requiresManualReview,true)
  assert.equal(c.score,70); assert.match(c.reason,/Availability unverified/)
})
test('missing segment and invalid timestamps cannot prove availability',()=>{
  const data=getSimulationTestData(); data.segment_assignments.push({member_id:6,segment_id:999,role_name:'Crew'})
  assert.equal(candidate(data,6).availabilityVerified,false)
  data.event_segments.find(s=>s.id===20).starts_at='invalid'
  assert.equal(candidate(data,7).availabilityVerified,false)
})
test('unknown roster prevents recommendations rather than assuming membership',()=>{
  const data=getSimulationTestData(); data.member_replacement_coverage.rosterVerified=false
  assert.deepEqual(rank(data),[])
})
test('string IDs, normalization and limits preserve ranking',()=>{
  const data=getSimulationTestData(); data.members.find(m=>m.id===6).id='6'
  data.segment_assignments.find(a=>a.member_id===6).role_name=' Lead Dancer '
  assert.equal(rank(data,[disruption],1)[0].roleMatch,'exact')
  assert.equal(rank(data,[disruption],0).length,0)
})
test('unverified membership/timetable propagates into recovery evaluation',()=>{
  const data=evaluationData(); data.member_replacement_coverage.scheduleVerified=false
  const result=evaluateRecoveryPlan({data,eventId:1,disruptions:[disruption],option:option(6)})
  assert.equal(result.status,'NEEDS_REVIEW'); assert.ok(result.warnings.some(w=>/Availability unverified/.test(w)))
})
test('nonmatching role remains review-only in recovery evaluation',()=>{
  const result=evaluateRecoveryPlan({data:evaluationData(),eventId:1,disruptions:[disruption],option:option(8)})
  assert.equal(result.status,'NEEDS_REVIEW')
})
test('simulation and ranking do not mutate their inputs or fixtures',()=>{
  const data=getSimulationTestData(), before=structuredClone(data)
  rank(data); const result=runCompleteSimulation(data,1,[disruption])
  assert.ok(result.conflictCounts.total>=2); assert.deepEqual(data,before)
  data.members[0].full_name='changed'; assert.notEqual(getSimulationTestData().members[0].full_name,'changed')
})
test('live source is explicit, has no fixture fallback and uses the authorised roster adapter',()=>{
  // Static contract guard, NOT a live Supabase query or RLS verification.
  const loader=readFileSync(new URL('./simulationDataService.js',import.meta.url),'utf8')
  const view=readFileSync(new URL('../views/EventRiskView.vue',import.meta.url),'utf8')
  assert.doesNotMatch(loader,/import.*simulationTestData/)
  assert.match(loader,/source = 'supabase'/); assert.match(view,/source: 'supabase'/)
  assert.match(loader,/loadEventReplacementRosters\(supabase, events\)/); assert.match(view,/showMemberAvailabilityWarning/); assert.match(view,/Candidate availability has not been confirmed/)
})

test('fixture contains a partial-role standby by default',()=>{
  const c=candidate(getSimulationTestData(),7)
  assert.equal(c.roleMatch,'partial'); assert.equal(c.requiresManualReview,true)
})
test('known membership failure or busy timetable makes a recovery infeasible',()=>{
  for (const id of [10,11,12]) {
    const result=evaluateRecoveryPlan({data:evaluationData(),eventId:1,disruptions:[disruption],option:option(id)})
    assert.equal(result.status,'INFEASIBLE')
    assert.ok(result.conflicts.some(c=>c.type==='REPLACEMENT_INELIGIBLE'))
  }
})
test('unknown roster cannot produce a feasible replacement plan',()=>{
  const data=evaluationData(); data.member_replacement_coverage.rosterVerified=false
  assert.equal(evaluateRecoveryPlan({data,eventId:1,disruptions:[disruption],option:option(6)}).status,'NEEDS_REVIEW')
})
test('missing required role is unverified even if another role matches',()=>{
  const data=getSimulationTestData()
  data.segment_assignments.find(a=>a.member_id===2 && a.segment_id===3).role_name=''
  assert.equal(candidate(data,6).roleMatch,'unverified')
})
