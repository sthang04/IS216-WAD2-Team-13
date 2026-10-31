import test from 'node:test'
import assert from 'node:assert/strict'
import {simulatorCalendarTarget,readSimulatorCalendarFocus,bookingMatchesSimulatorFocus,clearSimulatorCalendarFocus} from './simulatorCalendarNavigation.js'
const facilities=[{id:1,name:'Room A'},{id:2,name:'Room B'}]
const request={facilityId:2,venue:'Room B',start:'2026-11-02T10:00:00+08:00',end:'2026-11-02T10:30:00+08:00'}
const query=()=>simulatorCalendarTarget(request,day=>day).query
test('navigation carries exact facility and explicit requested times in the calendar week',()=>{
 const q=query();assert.equal(q.week,'2026-11-02');assert.equal(q.simFacilityId,'2')
 assert.equal(q.simStart,request.start);assert.equal(q.simEnd,request.end)
 const focus=readSimulatorCalendarFocus(q,facilities)
 assert.equal(focus.facilityId,2);assert.equal(focus.facilityName,'Room B')
})
test('calendar focus filters facility and overlapping time without inventing bookings',()=>{
 const focus=readSimulatorCalendarFocus(query(),facilities)
 const b={facility_id:2,booking_date:'2026-11-02',start_time:'10:00:00',end_time:'11:00:00'}
 assert.equal(bookingMatchesSimulatorFocus(b,focus),true)
 assert.equal(bookingMatchesSimulatorFocus({...b,facility_id:1},focus),false)
 assert.equal(bookingMatchesSimulatorFocus({...b,start_time:'10:30:00',end_time:'11:00:00'},focus),false)
 assert.equal(bookingMatchesSimulatorFocus({...b,booking_date:'2026-11-03'},focus),false)
})
test('ordinary calendar navigation is unaffected and clear preserves unrelated state',()=>{
 assert.equal(readSimulatorCalendarFocus({week:'2026-11-02'},facilities),null)
 assert.equal(bookingMatchesSimulatorFocus({},null),true)
 assert.deepEqual(clearSimulatorCalendarFocus({...query(),search:'original'}),{week:'2026-11-02',search:'original'})
})
test('ambiguous, unknown, malformed or local-time requests fail safely',()=>{
 for(const q of [{...query(),simFacilityId:'999'},{...query(),simStart:'invalid'},{...query(),simEnd:request.start},
  {...query(),simStart:'2026-11-02T10:00'},{...query(),simFacilityId:['2']}]){
  assert.ok(readSimulatorCalendarFocus(q,facilities)?.error)
 }
 assert.deepEqual(simulatorCalendarTarget({...request,end:'invalid'},d=>d),{path:'/facilities'})
 const q={...query()};delete q.simFacilityId
 assert.ok(readSimulatorCalendarFocus(q,[...facilities,{id:3,name:'Room B'}]).error)
})
