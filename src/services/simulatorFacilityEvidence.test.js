import test from 'node:test'
import assert from 'node:assert/strict'
import {simulatorFacilityFacts,simulatorBookingPeriod} from './simulatorFacilityEvidence.js'
import {recommendFacilityRecovery} from './recoveryRecommendationService.js'
import {runCompleteSimulation} from './simulationService.js'
import {campusConnectFixture,FIXTURE_EVENT_ID,fixtureRoomOutage} from '../../e2e-simulator/fixtures/campusConnect.js'
const make=()=>{const d=campusConnectFixture();d.facilities[0].facility_type='Auditorium';d.facilities[1]={...d.facilities[1],name:'Sports Hall',facility_type:'Sports',is_active:true};d.facility_slots=d.facility_slots.slice(0,1);d.facility_bookings=d.facility_bookings.slice(0,1);return d}
test('active unbooked Sports Hall is a tentative alternative without inventing a booking',()=>{
 const d=make(),before=structuredClone(d),result=runCompleteSimulation(d,FIXTURE_EVENT_ID,[fixtureRoomOutage])
 const rec=recommendFacilityRecovery(d,FIXTURE_EVENT_ID,result,[fixtureRoomOutage])[0]
 assert.ok(rec.alternatives.some(a=>a.venue==='Sports Hall'));assert.deepEqual(d,before)
 const fact=simulatorFacilityFacts(d,1,result.simulatedSegments[0].starts_at,result.simulatedSegments[0].ends_at).find(f=>f.name==='Sports Hall')
 assert.equal(fact.blocked,false);assert.match(fact.warning,/club eligibility/);assert.match(fact.warning,/type differs/);assert.match(fact.status,/approval required/)
})
test('Singapore-local calendar overlap excludes confirmed bookings, not adjacent periods',()=>{
 const d=make(),start='2026-11-02T10:00:00+08:00',end='2026-11-02T10:30:00+08:00'
 d.facility_bookings.push({id:99,facility_id:2,booking_date:'2026-11-02',start_time:'10:00:00',end_time:'10:30:00',status:'Booked'})
 assert.equal(simulatorFacilityFacts(d,1,start,end).find(f=>f.id===2).blocked,true)
 d.facility_bookings[1].start_time='09:00:00';d.facility_bookings[1].end_time='10:00:00'
 assert.equal(simulatorFacilityFacts(d,1,start,end).find(f=>f.id===2).blocked,false)
 assert.equal(Date.parse(simulatorBookingPeriod(d.facility_bookings[1])[1]),Date.parse('2026-11-02T02:00:00Z'))
})
test('capacity and inactive facilities fail safely; pending reservations retain approval warnings',()=>{
 const d=make(),start='2026-11-02T10:00:00+08:00',end='2026-11-02T10:30:00+08:00'
 d.facilities[1].capacity=0
 assert.equal(simulatorFacilityFacts(d,1,start,end).find(f=>f.id===2).blocked,true)
 d.facilities[1].capacity=50
 d.facility_bookings.push({id:99,facility_id:2,booking_date:'2026-11-02',start_time:'10:00:00',end_time:'10:30:00',status:'Pending Admin Sign-off'})
 assert.match(simulatorFacilityFacts(d,1,start,end).find(f=>f.id===2).warning,/overlap/)
 d.facilities[1].is_active=false
 assert.equal(simulatorFacilityFacts(d,1,start,end).some(f=>f.id===2),false)
})
