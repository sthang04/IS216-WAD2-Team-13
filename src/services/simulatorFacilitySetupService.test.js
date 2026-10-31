import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {describeSimulatorFacilityLinks} from './simulatorFacilitySetupService.js'
import {campusConnectFixture,FIXTURE_EVENT_ID} from '../../e2e-simulator/fixtures/campusConnect.js'
test('setup describes approved loaded links in activity order without changing data or ranking',()=>{
 const d=campusConnectFixture(),before=structuredClone(d),rows=describeSimulatorFacilityLinks(d,FIXTURE_EVENT_ID)
 assert.equal(rows.length,8);assert.deepEqual(rows.map(r=>r.segment.id),[1,2,3,4,5,6,7,8])
 assert.equal(rows[0].bookings[0].id,'1');assert.equal(rows[0].bookings[0].recordedChecksPassed,true)
 assert.deepEqual(d,before)
})
test('unlinked event remains empty even when accessible bookings exist',()=>{
 const rows=describeSimulatorFacilityLinks(campusConnectFixture('unlinked'),FIXTURE_EVENT_ID)
 assert.equal(rows.length,8);assert.ok(rows.every(r=>r.bookings.length===0))
 assert.deepEqual(describeSimulatorFacilityLinks(null,FIXTURE_EVENT_ID),[])
})
test('pending approval, wrong ownership and missing capacity never pass recorded eligibility checks',()=>{
 for(const change of ['pending','owner','capacity','inactive']){
  const d=campusConnectFixture()
  if(change==='pending')d.facility_bookings[0].status='Pending Admin Sign-off'
  if(change==='owner')d.facility_bookings[0].owner_club_id=2
  if(change==='capacity')d.facilities[0].capacity=null
  if(change==='inactive')d.facilities[0].is_active=false
  const booking=describeSimulatorFacilityLinks(d,FIXTURE_EVENT_ID)[0].bookings[0]
  assert.equal(booking.recordedChecksPassed,false,change);assert.ok(booking.blockers.length>0)
 }
})
test('wrong times, too-small room and another event allocation are explained',()=>{
 const d=campusConnectFixture()
 d.facility_bookings[0].start_time='11:00:00';d.facilities[0].capacity=0
 d.segment_facility_bookings.push({segment_id:99,booking_id:1})
 const row=describeSimulatorFacilityLinks(d,FIXTURE_EVENT_ID)[0].bookings[0]
 assert.equal(row.recordedChecksPassed,false)
 assert.ok(row.blockers.some(r=>/cover the proposed times/.test(r)))
 assert.ok(row.blockers.some(r=>/another event/.test(r)))
 assert.ok(row.blockers.some(r=>/Capacity is below/.test(r)))
})
test('missing linked record is visible as a blocker rather than replaced by another booking',()=>{
 const d=campusConnectFixture();d.facility_bookings=d.facility_bookings.filter(b=>b.id!==1)
 const rows=describeSimulatorFacilityLinks(d,FIXTURE_EVENT_ID)
 assert.equal(rows[0].bookings[0].id,'1')
 assert.equal(rows[0].bookings[0].recordedChecksPassed,false)
 assert.match(rows[0].bookings[0].blockers[0],/not in accessible records/)
})
test('setup navigates only supported calendar week and cannot create or link records',()=>{
 const component=readFileSync(new URL('../components/SimulatorFacilitySetup.vue',import.meta.url),'utf8')
 assert.match(component,/query:\{week:weekStartOf\(day\)\}/)
 assert.doesNotMatch(component,/\.insert\(|\.update\(|\.rpc\(|claimBooking\(|joinWaitlist\(/)
 assert.match(component,/Original booking linking is unavailable/)
 assert.match(component,/does not automatically link it to this event/)
})

test('existing conflict engine flags overlapping activities sharing the same linked booking',()=>{
 const d=campusConnectFixture()
 d.event_segments[0].ends_at=d.event_segments[1].ends_at
 const row=describeSimulatorFacilityLinks(d,FIXTURE_EVENT_ID)[0].bookings[0]
 assert.equal(row.recordedChecksPassed,false)
 assert.ok(row.blockers.some(reason=>/both use .*overlap/.test(reason)))
})
