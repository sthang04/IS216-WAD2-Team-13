import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareDisruptionCards, assessCombinedRecovery, buildCombinedRecoveryOptions } from './combinedSimulationService.js'
import { runCompleteSimulation } from './simulationService.js'
import { evaluateRecoveryPlan, evaluateRecoveryPlans } from './recoveryPlanEvaluationService.js'

// Synthetic records, never live Supabase data. Dates carry explicit Singapore offsets.
const t = hour => '2026-11-02T'+hour+':00+08:00'
const unavailable = (id,memberId,start=t('18:00'),end=t('19:00')) => ({id,type:'MEMBER_UNAVAILABLE',memberId,start,end})
const delay = (id,segmentId=1,delayMinutes=30) => ({id,type:'SCHEDULE_DELAY',segmentId,delayMinutes})
function fixture() {
  return {events:[{id:1,name:'Combined test',club_id:10,starts_at:t('18:00'),ends_at:t('20:00')},{id:2,name:'Role history',club_id:10}],
    members:[1,2,3,4].map(id=>({id,full_name:'Synthetic member '+id})),
    replacement_memberships:[1,2,3,4].map(memberId=>({memberId,clubId:10,active:true,verified:true})),
    member_replacement_coverage:{rosterVerified:true,scheduleVerified:false},
    event_segments:[{id:1,event_id:1,title:'Act one',starts_at:t('18:00'),ends_at:t('19:00')},
      {id:2,event_id:1,title:'Act two',starts_at:t('19:00'),ends_at:t('20:00')},
      {id:3,event_id:2,title:'Past rehearsal',starts_at:'2026-11-01T18:00:00+08:00',ends_at:'2026-11-01T19:00:00+08:00'}],
    segment_assignments:[{id:1,segment_id:1,member_id:1,role_name:'Dancer'},
      {id:2,segment_id:1,member_id:2,role_name:'Dancer'},
      {id:3,segment_id:3,member_id:3,role_name:'Dancer'},
      {id:4,segment_id:3,member_id:4,role_name:'Dancer'}],
    segment_dependencies:[{prerequisite_segment_id:1,dependent_segment_id:2}],
    facility_slots:[{id:101,venue_name:'Studio A',event_date:'2026-11-02',time_slot:'17:00 - 22:00',status:'Booked'},
      {id:102,venue_name:'Studio B',event_date:'2026-11-02',time_slot:'17:00 - 22:00',status:'Booked'}],
    segment_facility_slots:[{segment_id:1,facility_slot_id:101},{segment_id:2,facility_slot_id:101}]}
}
function run(data,cards) {
  const ds=prepareDisruptionCards(data,1,cards)
  const result=runCompleteSimulation(data,1,ds)
  return {ds,result,assessment:assessCombinedRecovery(data,1,result,ds)}
}
test('single member card preserves existing risk and candidate behavior',()=>{
  const {result,assessment}=run(fixture(),[unavailable('a',1)])
  assert.equal(result.disruptionCount,1)
  assert.equal(assessment.memberGroups.length,1)
  assert.ok(assessment.memberGroups[0].eligible.some(c=>c.id===3 && c.score===70 && c.requiresManualReview))
})
test('all three disruption types produce one combined simulation',()=>{
  const {result,assessment}=run(fixture(),[unavailable('a',1,t('18:00'),t('20:00')),
    {id:'b',type:'FACILITY_UNAVAILABLE',venueName:'Studio A',start:t('18:00'),end:t('20:00')},delay('c')])
  assert.equal(result.disruptionCount,3)
  assert.ok(result.directImpacts.length>0)
  assert.ok(assessment.memberGroups.length && assessment.facilityRecovery.length && assessment.facilityOptions.length)
  const plans=buildCombinedRecoveryOptions(assessment,{'1':3},assessment.facilityOptions[0]?.id)
  const evaluation=evaluateRecoveryPlans({data:fixture(),eventId:1,disruptions:run(fixture(),[unavailable('a',1,t('18:00'),t('20:00')),
    {id:'b',type:'FACILITY_UNAVAILABLE',venueName:'Studio A',start:t('18:00'),end:t('20:00')},delay('c')]).ds,simulationResult:result,options:plans})
  assert.equal(evaluation.rankedPlans.length,plans.length)
})
test('repeated delay cards accumulate and preserve their timing in member options',()=>{
  const {result,assessment}=run(fixture(),[delay('a',1,15),delay('b',1,30),unavailable('c',1,t('18:30'),t('20:00'))])
  assert.equal(Date.parse(result.simulatedSegments.find(s=>s.id===1).starts_at)-Date.parse(t('18:00')),45*60000)
  const option=buildCombinedRecoveryOptions(assessment,{'1':3}).find(o=>o.id==='combined-selected')
  assert.ok(option.changes.some(c=>c.starts_at===result.simulatedSegments.find(s=>s.id===1).starts_at))
})
test('repeated member periods group once and do not duplicate assignment changes',()=>{
  const {assessment}=run(fixture(),[unavailable('a',1),unavailable('b',1,t('18:15'),t('18:45'))])
  assert.equal(assessment.memberGroups.length,1)
  const option=buildCombinedRecoveryOptions(assessment,{'1':3}).find(o=>o.id==='combined-selected')
  assert.equal(option.changes.filter(c=>c.replacementMemberId!=null).length,1)
})
test('multiple unavailable members retain distinguishable groups and exclude each other',()=>{
  const data=fixture(), {ds,assessment}=run(data,[unavailable('a',1),unavailable('b',2)])
  assert.deepEqual(assessment.memberGroups.map(g=>g.memberId),[1,2])
  assert.ok(assessment.memberGroups[0].excluded.some(c=>c.id===2))
  const good=buildCombinedRecoveryOptions(assessment,{'1':3,'2':4}).find(o=>o.id==='combined-selected')
  const evaluated=evaluateRecoveryPlan({data,eventId:1,disruptions:ds,option:good})
  assert.notEqual(evaluated.status,'INFEASIBLE')
  const bad=buildCombinedRecoveryOptions(assessment,{'1':3,'2':3}).find(o=>o.id==='combined-selected')
  assert.ok(evaluateRecoveryPlan({data,eventId:1,disruptions:ds,option:bad}).conflicts.some(c=>c.type==='REPLACEMENT_CAPACITY_CONFLICT'))
})
test('member targeting uses delayed timing rather than original timing',()=>{
  const data=fixture()
  const {assessment}=run(data,[delay('a',1,120),unavailable('b',1,t('20:00'),t('21:00'))])
  assert.equal(assessment.memberGroups[0].affectedAssignments.length,1)
  assert.equal(assessment.memberGroups[0].segments[0].starts_at,new Date(t('20:00')).toISOString())
})
test('candidate eligibility reflects simultaneous delay-induced clashes',()=>{
  const data=fixture()
  data.segment_assignments.push({id:5,segment_id:2,member_id:3,role_name:'Dancer'})
  const {assessment}=run(data,[delay('a',1,60),unavailable('b',1,t('19:00'),t('20:00'))])
  assert.ok(assessment.memberGroups[0].excluded.some(c=>c.id===3 && c.conflicts.some(x=>x.segmentId===2)))
})
test('exact assignment roles are all replaced without mixing original members',()=>{
  const data=fixture()
  data.segment_assignments.push({id:5,segment_id:1,member_id:1,role_name:'Crew'})
  const {ds,assessment}=run(data,[unavailable('a',1)])
  const option=buildCombinedRecoveryOptions(assessment,{'1':3}).find(o=>o.id==='combined-selected')
  const plan=evaluateRecoveryPlan({data,eventId:1,disruptions:ds,option})
  assert.equal(plan.proposedAssignments.filter(a=>a.segment_id===1 && a.member_id===1).length,0)
  assert.equal(plan.proposedAssignments.find(a=>a.id===2).member_id,2)
})
test('facility disruptions repeat without duplicated per-segment recommendations',()=>{
  const {assessment}=run(fixture(),[1,2].map(i=>({id:'f'+i,type:'FACILITY_UNAVAILABLE',venueName:'Studio A',start:t('18:00'),end:t('20:00')})))
  assert.equal(new Set(assessment.facilityRecovery.map(r=>r.segmentId)).size,assessment.facilityRecovery.length)
})
test('empty selections, duplicate IDs, invalid dates and unrelated selections fail visibly',()=>{
  const data=fixture()
  for(const cards of [[],[unavailable('a',1),unavailable('a',2)],
    [unavailable('a',1,t('19:00'),t('18:00'))],[unavailable('a',99)],
    [{id:'a',type:'OTHER'}],[delay('a',999)],[delay('a',1,0)],[delay('a',1,1.5)],
    [{...unavailable('a',1),start:'2026-02-30T18:00',end:'2026-03-01T19:00'}]]) {
    assert.throws(()=>prepareDisruptionCards(data,1,cards))
  }
})
test('Singapore local inputs normalize and string IDs resolve to actual loaded IDs',()=>{
  const ds=prepareDisruptionCards(fixture(),'1',[{...unavailable('a','1'),start:'2026-11-02T18:00',end:'2026-11-02T19:00'}])
  assert.equal(ds[0].memberId,1); assert.equal(ds[0].start,'2026-11-02T10:00:00.000Z')
})
test('combined processing is read-only and no-result assessment is empty',()=>{
  const data=fixture(), original=structuredClone(data)
  run(data,[unavailable('a',1),delay('b')]); assert.deepEqual(data,original)
  assert.deepEqual(assessCombinedRecovery(data,1,null,[]).memberGroups,[])
})

test('multiple facility/time choices merge once and contradictory choices fail evaluation',()=>{
  const data=fixture(), {assessment,ds}=run(data,[unavailable('a',1)])
  assessment.facilityOptions=[
    {id:'f1',title:'Move one',changes:[{segmentId:1,venueName:'Studio B'}]},
    {id:'f2',title:'Move two',changes:[{segmentId:2,venueName:'Studio B'}]},
    {id:'conflict',title:'Conflicting room',changes:[{segmentId:1,venueName:'Studio C'}]}]
  const combined=buildCombinedRecoveryOptions(assessment,{'1':3},['f1','f2']).find(o=>o.id==='combined-selected')
  assert.equal(combined.changes.filter(c=>c.venueName).length,2)
  assert.deepEqual(combined.selectionIssues,[])
  const bad=buildCombinedRecoveryOptions(assessment,{'1':3},['f1','conflict']).find(o=>o.id==='combined-selected')
  assert.ok(evaluateRecoveryPlan({data,eventId:1,disruptions:ds,option:bad}).conflicts.some(c=>c.type==='CONTRADICTORY_RECOVERY_SELECTION'))
})

test('selected combined plan replaces duplicate individual proposal',()=>{
  const {assessment}=run(fixture(),[unavailable('a',1)])
  const options=buildCombinedRecoveryOptions(assessment,{'1':3})
  assert.ok(options.some(o=>o.id==='combined-selected'))
  assert.ok(!options.some(o=>o.id==='member-1-candidate-3'))
})
test('same replacement across overlapping different activities is infeasible',()=>{
  const data=fixture()
  data.event_segments.find(s=>s.id===2).starts_at=t('18:15')
  data.segment_assignments.find(a=>a.id===2).segment_id=2
  const {ds,assessment}=run(data,[unavailable('a',1),unavailable('b',2,t('18:00'),t('20:00'))])
  const option=buildCombinedRecoveryOptions(assessment,{'1':3,'2':3}).find(o=>o.id==='combined-selected')
  assert.ok(evaluateRecoveryPlan({data,eventId:1,disruptions:ds,option}).conflicts.some(c=>c.type==='MEMBER_DOUBLE_BOOKING'))
})

test('automatic mixed plans cover unavailable member and every affected room together',()=>{
 const data=fixture(),{ds,assessment}=run(data,[unavailable('m',1),{id:'f',type:'FACILITY_UNAVAILABLE',venueName:'Studio A',start:t('18:00'),end:t('20:00')}])
 const options=buildCombinedRecoveryOptions(assessment).filter(o=>o.kind==='combined')
 assert.ok(options.length>=2)
 for(const option of options){
  assert.ok(option.changes.some(c=>c.replacementMemberId!=null))
  assert.ok(option.changes.some(c=>c.segmentId===1&&c.venueName==='Studio B'))
  assert.ok(option.changes.some(c=>c.segmentId===2&&(c.venueName==='Studio B'||c.starts_at)))
  const plan=evaluateRecoveryPlan({data,eventId:1,disruptions:ds,option})
  assert.ok(!plan.conflicts.some(c=>c.type==='MEMBER_UNAVAILABLE'))
  assert.equal(plan.status,'INFEASIBLE')
  assert.ok(plan.conflicts.some(c=>['FACILITY_DOUBLE_BOOKING','FACILITY_UNAVAILABLE','DEPENDENCY_CONFLICT'].includes(c.type)))
  assert.ok(plan.warnings.length)
 }
 assert.ok(options.length<=64)
})
test('contradictory venue and schedule inputs fail closed instead of last-write winning',()=>{
 const plan=evaluateRecoveryPlan({data:fixture(),eventId:1,option:{id:'bad',changes:[{segmentId:1,venueName:'Studio A',starts_at:t('18:00')},{segmentId:1,venueName:'Studio B',starts_at:t('18:30')}]}})
 assert.equal(plan.status,'INFEASIBLE')
 assert.ok(plan.conflicts.some(c=>c.type==='INVALID_RECOVERY_PROPOSAL'))
})

test('mixed combinations with an unreserved venue remain tentative rather than approved',()=>{
 const data=fixture();data.facility_slots=data.facility_slots.filter(s=>s.id!==102);data.facilities=[{id:1,name:'Studio A',is_active:true,capacity:50},{id:2,name:'Studio B',is_active:true,capacity:50}]
 const {ds,assessment}=run(data,[unavailable('m',1),{id:'f',type:'FACILITY_UNAVAILABLE',venueName:'Studio A',start:t('18:00'),end:t('20:00')}])
 const evaluation=evaluateRecoveryPlans({data,eventId:1,disruptions:ds,options:buildCombinedRecoveryOptions(assessment).filter(o=>o.kind==='combined')})
 const tentative=evaluation.rankedPlans.find(p=>p.status==='NEEDS_REVIEW')
 assert.ok(tentative)
 assert.ok(tentative.changes.some(c=>c.replacementMemberId!=null))
 assert.ok(tentative.changes.filter(c=>c.venueName==='Studio B').length===2)
 assert.ok(tentative.warnings.some(w=>/booking/i.test(w)))
 assert.equal(evaluation.recommendedPlan,null)
})
