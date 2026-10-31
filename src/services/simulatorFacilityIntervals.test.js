import test from 'node:test'
import assert from 'node:assert/strict'
import {campusConnectFixture,campusConnectMultiEventFixture,FIXTURE_EVENT_ID} from '../../e2e-simulator/fixtures/campusConnect.js'
import {runCompleteSimulation} from './simulationService.js'
import {recommendFacilityRecovery} from './recoveryRecommendationService.js'
function shape(start,end){
 const d=campusConnectFixture();d.events=d.events.slice(0,1);d.events[0].starts_at=start;d.events[0].ends_at=end
 d.event_segments=[{...d.event_segments[0],starts_at:start,ends_at:end}]
 d.segment_assignments=d.segment_assignments.filter(a=>a.segment_id===1);d.segment_dependencies=[]
 d.segment_facility_slots=[{segment_id:1,facility_slot_id:1}];d.segment_facility_bookings=[{segment_id:1,booking_id:1}]
 const sg=t=>new Date(Date.parse(t)+8*3600000).toISOString()
 for(const slot of d.facility_slots){slot.event_date=sg(start).slice(0,10);slot.time_slot=sg(start).slice(11,16)+' - '+sg(end).slice(11,16)}
 for(const b of d.facility_bookings){b.booking_date=sg(start).slice(0,10);b.start_time=sg(start).slice(11,19);b.end_time=sg(end).slice(11,19)}
 return d
}
for(const [label,start,end] of [
 ['morning','2026-11-02T08:00:00+08:00','2026-11-02T09:00:00+08:00'],
 ['afternoon short','2026-11-02T14:00:00+08:00','2026-11-02T14:15:00+08:00'],
 ['evening long','2026-11-02T18:00:00+08:00','2026-11-02T22:00:00+08:00'],
 ['Singapore midnight / previous UTC day','2026-11-02T00:00:00+08:00','2026-11-02T01:00:00+08:00'],
 ['late evening boundary','2026-11-02T23:30:00+08:00','2026-11-02T23:59:00+08:00']
]){
 test('existing facility engine supports '+label,()=>{
  const d=shape(start,end),disruption={type:'FACILITY_UNAVAILABLE',venueName:'Fixture Original Room',start,end}
  const result=runCompleteSimulation(d,FIXTURE_EVENT_ID,[disruption])
  const rows=recommendFacilityRecovery(d,FIXTURE_EVENT_ID,result,[disruption])
  assert.equal(rows.length,1);assert.equal(rows[0].segmentId,1)
  assert.equal(rows[0].alternatives[0].venue,'Fixture Alternative Room')
  const adjacent={...disruption,start:end,end:new Date(Date.parse(end)+15*60000).toISOString()}
  const noImpact=runCompleteSimulation(d,FIXTURE_EVENT_ID,[adjacent])
  assert.equal(noImpact.conflictCounts.facility,0)
  assert.equal(recommendFacilityRecovery(d,FIXTURE_EVENT_ID,noImpact,[adjacent]).length,0)
 })
}
test('simultaneous affected activities retain separate facility recommendations',()=>{
 const d=campusConnectFixture()
 d.event_segments[1].starts_at=d.event_segments[0].starts_at;d.event_segments[1].ends_at=d.event_segments[0].ends_at
 const disruption={type:'FACILITY_UNAVAILABLE',venueName:'Fixture Original Room',start:d.event_segments[0].starts_at,end:d.event_segments[0].ends_at}
 const rows=recommendFacilityRecovery(d,FIXTURE_EVENT_ID,runCompleteSimulation(d,FIXTURE_EVENT_ID,[disruption]),[disruption])
 assert.deepEqual(rows.map(r=>r.segmentId),[1,2])
})
test('multi-room activities keep their other existing room out of replacement alternatives',()=>{
 const d=shape('2026-11-02T10:00:00+08:00','2026-11-02T11:00:00+08:00')
 d.facility_slots.push({...d.facility_slots[0],id:3,venue_name:'Second existing room'})
 d.segment_facility_slots.push({segment_id:1,facility_slot_id:3})
 const disruption={type:'FACILITY_UNAVAILABLE',venueName:'Fixture Original Room',start:d.events[0].starts_at,end:d.events[0].ends_at}
 const [row]=recommendFacilityRecovery(d,FIXTURE_EVENT_ID,runCompleteSimulation(d,FIXTURE_EVENT_ID,[disruption]),[disruption])
 assert.ok(!row.alternatives.some(a=>['Fixture Original Room','Second existing room'].includes(a.venue)))
})

test('multi-day event uses the matching date booking for each activity, not another day reservation',()=>{
 const d=campusConnectMultiEventFixture()
 d.event_segments=d.event_segments.map(s=>s.event_id===990003?{...s,event_id:FIXTURE_EVENT_ID}:s)
 d.events[0].ends_at=d.events.find(e=>e.id===990003).ends_at
 d.events=d.events.filter(e=>e.id!==990003)
 const outage={type:'FACILITY_UNAVAILABLE',venueName:'Fixture Original Room',start:'2026-11-03T10:00:00+08:00',end:'2026-11-03T10:30:00+08:00'}
 const rows=recommendFacilityRecovery(d,FIXTURE_EVENT_ID,runCompleteSimulation(d,FIXTURE_EVENT_ID,[outage]),[outage])
 assert.deepEqual(rows.map(r=>r.segmentId),[201])
 assert.equal(rows[0].alternatives[0].venue,'Fixture Alternative Room')
})
test('partial overlap intersects the activity while a period ending at its start has no impact',()=>{
 const d=shape('2026-11-02T10:00:00+08:00','2026-11-02T11:00:00+08:00')
 const base={type:'FACILITY_UNAVAILABLE',venueName:'Fixture Original Room',start:'2026-11-02T09:30:00+08:00'}
 const hit={...base,end:'2026-11-02T10:05:00+08:00'}
 assert.equal(recommendFacilityRecovery(d,FIXTURE_EVENT_ID,runCompleteSimulation(d,FIXTURE_EVENT_ID,[hit]),[hit]).length,1)
 const adjacent={...base,end:'2026-11-02T10:00:00+08:00'}
 assert.equal(recommendFacilityRecovery(d,FIXTURE_EVENT_ID,runCompleteSimulation(d,FIXTURE_EVENT_ID,[adjacent]),[adjacent]).length,0)
})
