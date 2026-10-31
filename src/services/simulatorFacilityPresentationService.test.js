import test from 'node:test'
import assert from 'node:assert/strict'
import {campusConnectFixture,campusConnectMultiEventFixture,FIXTURE_EVENT_ID,fixtureRoomOutage} from '../../e2e-simulator/fixtures/campusConnect.js'
import {runCompleteSimulation} from './simulationService.js'
import {assessCombinedRecovery,prepareDisruptionCards} from './combinedSimulationService.js'
import {evaluateRecoveryPlans} from './recoveryPlanEvaluationService.js'
import {presentSimulatorFacilities} from './simulatorFacilityPresentationService.js'
function run(data=campusConnectFixture(),eventId=FIXTURE_EVENT_ID,disruptions=[fixtureRoomOutage]){
 const result=runCompleteSimulation(data,eventId,disruptions),assessment=assessCombinedRecovery(data,eventId,result,disruptions)
 const evaluation=evaluateRecoveryPlans({data,eventId,disruptions,simulationResult:result,options:assessment.facilityOptions})
 return {result,assessment,evaluation,presented:presentSimulatorFacilities({data,recommendations:assessment.facilityRecovery,
  options:assessment.facilityOptions,rankedPlans:evaluation.rankedPlans,simulatedSegments:result.simulatedSegments})}
}
test('direct alternatives reuse real recommendation output and evaluator rank/score without mutating input',()=>{
 const d=campusConnectFixture(),before=structuredClone(d),{assessment,evaluation,presented}=run(d)
 const card=presented.find(r=>r.segmentId===1).alternatives[0]
 const option=assessment.facilityOptions.find(o=>o.changes.some(c=>c.segmentId===1&&c.venueName===card.venue))
 const ranked=evaluation.rankedPlans.find(p=>p.id===option.id)
 assert.equal(card.venue,'Fixture Alternative Room');assert.equal(card.score,ranked.score);assert.equal(card.evaluationRank,ranked.rank)
 assert.equal(card.capacity,50);assert.equal(card.minimumCapacity,1);assert.match(card.status,/Requires owner approval/)
 assert.equal(card.rejectedReasons.length,0);assert.deepEqual(d,before)
})
test('a confirmed conflicting reservation is excluded by the existing evaluator, not labelled available',()=>{
 const rec=run(campusConnectFixture('blocked')).presented.find(r=>r.segmentId===1)
 assert.equal(rec.alternatives.length,0)
 assert.ok(rec.excludedAlternatives[0].rejectedReasons.some(r=>/confirmed reservation/.test(r)))
})
test('existing suitability checks exclude capacity-disqualified rooms without changing scores',()=>{
 const d=campusConnectFixture();d.facilities[1].capacity=0
 const rec=run(d).presented.find(r=>r.segmentId===1)
 assert.equal(rec.alternatives.length,0);assert.match(rec.excludedAlternatives[0].rejectedReasons.join(' '),/Capacity is below/)
})
test('the unavailable room never reappears as an alternative and no records means no invented room',()=>{
 const normal=run().presented.find(r=>r.segmentId===1)
 assert.ok(normal.alternatives.every(a=>a.venue!=='Fixture Original Room'))
 const empty=run(campusConnectFixture('no-facility')).presented.find(r=>r.segmentId===1)
 assert.deepEqual(empty.alternatives,[])
 assert.deepEqual(run(campusConnectFixture('unlinked')).presented,[])
})
test('unrelated member conflicts do not remove a room recommendation',()=>{
 const {assessment,evaluation,result}=run()
 const ranked=evaluation.rankedPlans.map(p=>({...p,conflicts:[{type:'MEMBER_UNAVAILABLE',segmentId:1,message:'Member still unavailable'}]}))
 const rec=presentSimulatorFacilities({data:campusConnectFixture(),recommendations:assessment.facilityRecovery,
  options:assessment.facilityOptions,rankedPlans:ranked,simulatedSegments:result.simulatedSegments}).find(r=>r.segmentId===1)
 assert.equal(rec.alternatives.length,1);assert.equal(rec.alternatives[0].remainingConflicts.length,1)
})
test('selected booking must be linked to the selected event; stale cross-event selection is rejected',()=>{
 const d=campusConnectMultiEventFixture()
 assert.throws(()=>prepareDisruptionCards(d,FIXTURE_EVENT_ID,[{id:'F',...fixtureRoomOutage,facilityBookingId:4}]),/actual facility booking linked/)
 const valid=prepareDisruptionCards(d,FIXTURE_EVENT_ID,[{id:'F',...fixtureRoomOutage,facilityBookingId:1}])
 assert.equal(valid[0].venueName,'Fixture Original Room')
})
test('same flow evaluates a different selected event and its own affected activities',()=>{
 const d=campusConnectMultiEventFixture()
 const disruptions=[{...fixtureRoomOutage,start:'2026-11-03T10:00:00+08:00',end:'2026-11-03T10:30:00+08:00'}]
 const {presented}=run(d,990003,disruptions)
 assert.equal(presented[0].segmentId,201)
 assert.equal(presented[0].alternatives[0].venue,'Fixture Alternative Room')
 assert.match(presented[0].alternatives[0].starts_at,/2026-11-03/)
})
