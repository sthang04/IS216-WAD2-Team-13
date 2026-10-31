import test from 'node:test'
import assert from 'node:assert/strict'
import {campusConnectFixture,FIXTURE_EVENT_ID,fixtureAbsence,fixtureRoomOutage} from '../../e2e-simulator/fixtures/campusConnect.js'
import {assessMemberReplacements,recommendFacilityRecovery} from './recoveryRecommendationService.js'
import {runCompleteSimulation} from './simulationService.js'
import {loadEventReplacementRosters} from './simulatorRosterService.js'
import {prepareDisruptionCards} from './combinedSimulationService.js'
import {assessCombinedRecovery} from './combinedSimulationService.js'
test('ISOLATED fixture has eight activities, eight target assignments and seven valid dependency links',()=>{
 const d=campusConnectFixture(),segments=d.event_segments.filter(s=>s.event_id===FIXTURE_EVENT_ID),ids=new Set(segments.map(s=>s.id))
 assert.equal(segments.length,8);assert.equal(d.segment_assignments.filter(a=>ids.has(a.segment_id)).length,8)
 assert.equal(d.segment_dependencies.length,7)
 assert.ok(d.segment_dependencies.every(x=>ids.has(x.prerequisite_segment_id)&&ids.has(x.dependent_segment_id)))
 assert.notEqual(FIXTURE_EVENT_ID,900001) // Never claim this is the real event.
})
test('Suitable member requires exact-role evidence AND verified fixture schedule coverage',()=>{
 const result=assessMemberReplacements(campusConnectFixture('verified'),FIXTURE_EVENT_ID,1,[fixtureAbsence])
 const exact=result.eligible.find(c=>c.id===2)
 assert.equal(exact.roleMatch,'exact');assert.equal(exact.requiresManualReview,false);assert.equal(exact.score,100)
})
test('live-like incomplete availability retains exact standby under Needs Manual Review',()=>{
 const result=assessMemberReplacements(campusConnectFixture(),FIXTURE_EVENT_ID,1,[fixtureAbsence])
 const exact=result.eligible.find(c=>c.id===2),review=result.eligible.find(c=>c.id===3)
 assert.equal(exact.roleMatch,'exact');assert.equal(exact.requiresManualReview,true);assert.equal(exact.score,70)
 assert.equal(review.roleMatch,'none');assert.equal(review.requiresManualReview,true)
 assert.equal(result.excluded.find(c=>c.id===4).conflicts[0].activity,'Fixture overlapping assignment')
})
test('No Suitable Candidate when every standby has confirmed overlapping assignments',()=>{
 const result=assessMemberReplacements(campusConnectFixture('none'),FIXTURE_EVENT_ID,1,[fixtureAbsence])
 assert.equal(result.eligible.length,0);assert.deepEqual(result.excluded.map(c=>c.id),[2,3,4])
})
test('facility algorithm returns a supported alternative for Manual Review, never claims verified suitability',()=>{
 const d=campusConnectFixture(),r=runCompleteSimulation(d,FIXTURE_EVENT_ID,[fixtureRoomOutage])
 const recommendation=recommendFacilityRecovery(d,FIXTURE_EVENT_ID,r,[fixtureRoomOutage]).find(x=>x.segmentId===1)
 assert.equal(recommendation.alternatives[0].venue,'Fixture Alternative Room')
 assert.match(recommendation.alternatives[0].status,/Requires owner approval/)
 assert.ok(recommendation.alternatives.every(x=>!/confirmed|suitable/i.test(x.status)))
})
test('No Available Facility means no confirmed alternative in accessible records, not global vacancy proof',()=>{
 const d=campusConnectFixture('no-facility'),r=runCompleteSimulation(d,FIXTURE_EVENT_ID,[fixtureRoomOutage])
 const recommendation=recommendFacilityRecovery(d,FIXTURE_EVENT_ID,r,[fixtureRoomOutage]).find(x=>x.segmentId===1)
 assert.equal(recommendation.alternatives.length,0);assert.equal(recommendation.laterTimes.length,0)
 assert.match(recommendation.advice,/No confirmed alternative/)
})
test('member absence uses actual simulation engine and leaves isolated records unchanged',()=>{
 const d=campusConnectFixture(),original=structuredClone(d),r=runCompleteSimulation(d,FIXTURE_EVENT_ID,[fixtureAbsence])
 const assessment=assessCombinedRecovery(d,FIXTURE_EVENT_ID,r,[fixtureAbsence])
 assert.equal(assessment.memberGroups.length,1);assert.deepEqual(assessment.memberGroups[0].segments.map(s=>s.id),[1])
 assert.ok(r.conflictCounts.member>0);assert.deepEqual(d,original)
})
test('30-minute delay creates actual dependency, member and room overlaps in the eight-activity chain',()=>{
 const d=campusConnectFixture(),r=runCompleteSimulation(d,FIXTURE_EVENT_ID,[{type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:30}])
 assert.ok(r.conflictCounts.dependency>0);assert.ok(r.conflictCounts.memberDoubleBooking>0);assert.ok(r.conflictCounts.facilitySchedule>0)
})

test('real roster adapter never turns active membership or role history into verified availability',async()=>{
 const d=campusConnectFixture('verified')
 const roster=await loadEventReplacementRosters({rpc:async(_name,args)=>({data:{
  event_id:args.p_event_id,club_id:1,members:d.members.map(m=>({member_id:m.id,full_name:m.full_name,club_id:1,academic_year:'2026/27'}))
 }})},[d.events[0]])
 const liveShape={...d,...roster}
 const result=assessMemberReplacements(liveShape,FIXTURE_EVENT_ID,1,[fixtureAbsence])
 const exact=result.eligible.find(c=>c.id===2)
 assert.equal(exact.roleMatch,'exact')
 assert.equal(exact.availabilityVerified,false)
 assert.equal(exact.requiresManualReview,true)
 assert.equal(exact.score,70)
})
test('zero linked bookings block the facility input and do not generate imaginary room alternatives',()=>{
 const d=campusConnectFixture('unlinked')
 assert.deepEqual(d.segment_facility_slots,[])
 assert.deepEqual(d.segment_facility_bookings,[])
 assert.throws(()=>prepareDisruptionCards(d,FIXTURE_EVENT_ID,[{id:'F1',...fixtureRoomOutage}]),/Select a facility linked/)
 const r=runCompleteSimulation(d,FIXTURE_EVENT_ID,[fixtureAbsence])
 assert.deepEqual(recommendFacilityRecovery(d,FIXTURE_EVENT_ID,r,[fixtureRoomOutage]),[])
})
