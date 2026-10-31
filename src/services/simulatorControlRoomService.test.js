import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {buildControlRoomModel,controlRoomTime,recoveryControlRoomResult} from './simulatorControlRoomService.js'
import {campusConnectFixture,campusConnectMultiEventFixture,FIXTURE_EVENT_ID,fixtureRoomOutage} from '../../e2e-simulator/fixtures/campusConnect.js'
import {runCompleteSimulation} from './simulationService.js'
const run=(data,disruptions=[fixtureRoomOutage],eventId=FIXTURE_EVENT_ID)=>{
 const first=data.event_segments.find(s=>String(s.event_id)===String(eventId))
 const member=data.segment_assignments.find(a=>a.segment_id===first.id)?.member_id
 // The actual engine correctly rejects empty scenarios. For baseline visual
 // assertions, use a valid recorded member with a non-overlapping fixture period.
 const inputs=disruptions.length?disruptions:[{type:'MEMBER_UNAVAILABLE',memberId:member,
  start:new Date(Date.parse(first.starts_at)-86400000).toISOString(),end:new Date(Date.parse(first.starts_at)-82800000).toISOString()}]
 return buildControlRoomModel(data,eventId,runCompleteSimulation(data,eventId,inputs),inputs)
}
test('control room uses actual engine direct/downstream impacts and preserves all input data',()=>{
 const data=campusConnectFixture(),before=structuredClone(data),model=run(data)
 assert.equal(model.activities.length,8);assert.equal(model.affected.filter(a=>a.status==='direct').length,1)
 assert.equal(model.affected.filter(a=>a.status==='downstream').length,7)
 assert.equal(model.edges.length,7);assert.equal(model.cycle,false)
 assert.ok(model.affected[0].causes.length>0)
 assert.deepEqual(data,before)
})
test('timeline derives original and delayed positions from the real engine, with SG dates',()=>{
 const data=campusConnectFixture(),model=run(data,[{type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:20}])
 const row=model.timeline.find(a=>a.id===1)
 assert.equal(row.simulatedStart-row.originalStart,20*60000)
 assert.ok(row.simulatedBar.left>row.originalBar.left)
 assert.match(controlRoomTime('2026-11-01T16:00:00Z'),/2 Nov.*00:00/)
 assert.equal(controlRoomTime(null),'Time unavailable')
 assert.equal(controlRoomTime('invalid'),'Time unavailable')
})
test('heatmap includes only genuinely linked bookings, deduplicates links and labels outage honestly',()=>{
 const data=campusConnectFixture();data.segment_facility_bookings.push({...data.segment_facility_bookings[0]})
 const model=run(data)
 assert.equal(model.facilities.length,1);assert.equal(model.facilities[0].bookings.length,1)
 assert.equal(model.facilities[0].bookings[0].id,1)
 assert.equal(model.facilities[0].cells[0].status,'outage')
 assert.ok(model.facilities[0].cells.every(c=>!['available','approved','free'].includes(c.label.toLowerCase())))
 assert.deepEqual(run(campusConnectFixture('unlinked')).facilities,[])
})
test('gapped activities are not clashes and empty heat cells do not claim availability',()=>{
 const d=campusConnectFixture();d.event_segments=d.event_segments.filter(s=>s.event_id!==FIXTURE_EVENT_ID||[1,2].includes(s.id))
 d.event_segments.find(s=>s.id===1).ends_at='2026-11-02T10:15:00+08:00'
 d.event_segments.find(s=>s.id===2).starts_at='2026-11-02T10:30:00+08:00'
 d.event_segments.find(s=>s.id===2).ends_at='2026-11-02T10:45:00+08:00'
 const model=run(d,[])
 assert.ok(model.facilities[0].cells.some(c=>c.status==='no-event-use'))
 assert.ok(model.facilities[0].cells.every(c=>c.status!=='conflict'))
})
test('overlapping activities and actual competing reservations produce conflict heat cells',()=>{
 const d=campusConnectFixture()
 d.facility_bookings.push({...d.facility_bookings[0],id:999})
 const model=run(d,[])
 assert.ok(model.facilities[0].cells.some(c=>c.status==='conflict'))
})
test('event scoping excludes another event graph and inaccessible bookings are reported',()=>{
 const d=campusConnectMultiEventFixture(),model=run(d,[],990003)
 const allowed=new Set(d.event_segments.filter(s=>s.event_id===990003).map(s=>s.id))
 assert.equal(model.activities.length,allowed.size)
 assert.ok(model.nodes.every(n=>allowed.has(n.id)))
 assert.ok(model.edges.every(e=>allowed.has(e.from.id)&&allowed.has(e.to.id)))
 const missing=campusConnectFixture();missing.facility_bookings=[]
 assert.ok(run(missing).missingLinks>0)
 assert.deepEqual(run(missing).facilities,[])
})
test('dependency cycles are disclosed and stale/empty simulation results do not become a new event preview',()=>{
 const d=campusConnectFixture();d.segment_dependencies.push({prerequisite_segment_id:8,dependent_segment_id:1})
 const model=run(d,[]);assert.equal(model.cycle,true);assert.equal(model.nodes.length,8)
 assert.equal(buildControlRoomModel(d,FIXTURE_EVENT_ID,null).hasSimulation,false)
 assert.equal(buildControlRoomModel(d,FIXTURE_EVENT_ID,{eventId:123}).hasSimulation,false)
 assert.deepEqual(buildControlRoomModel({},1).activities,[])
})
test('submission startup no longer runs obsolete live-data debugging or pretend acceptance',()=>{
 assert.equal(existsSync(new URL('../debug/testReplacementRecommendations.js',import.meta.url)),false)
 assert.doesNotMatch(readFileSync(new URL('../main.js',import.meta.url),'utf8'),/testReplacementRecommendations/)
 assert.doesNotMatch(readFileSync(new URL('../views/EventRiskView.vue',import.meta.url),'utf8'),/simulateMemberAcceptance|dispatchAccepted/)
})


test('recovery inspection uses the exact evaluated schedule and leaves original linked rooms idle after a venue move',()=>{
 const data=campusConnectFixture(),original=structuredClone(data)
 const proposed=data.event_segments.map(s=>({...s,starts_at:new Date(Date.parse(s.starts_at)+60000).toISOString(),ends_at:new Date(Date.parse(s.ends_at)+60000).toISOString()}))
 const plan={proposedSegments:proposed,proposedVenues:{1:'Tentative other room'},conflicts:[{segmentId:1,message:'Approval required'}]}
 const result=recoveryControlRoomResult(FIXTURE_EVENT_ID,plan)
 const model=buildControlRoomModel(data,FIXTURE_EVENT_ID,result,[])
 assert.equal(model.activities[0].simulated.starts_at,proposed[0].starts_at)
 assert.deepEqual(model.activities[0].causes,['Approval required'])
 assert.ok(model.facilities.every(f=>f.cells.every(c=>!c.activities.includes(proposed[0].title))))
 assert.deepEqual(data,original)
 assert.equal(recoveryControlRoomResult(FIXTURE_EVENT_ID,null),null)
})


test('months between activities never compress the selected Singapore day',()=>{
 const data=campusConnectFixture();data.event_segments.find(s=>s.id===8).starts_at='2027-03-04T02:00:00Z';data.event_segments.find(s=>s.id===8).ends_at='2027-03-04T02:30:00Z'
 const result={eventId:FIXTURE_EVENT_ID,simulatedSegments:data.event_segments.filter(s=>s.event_id===FIXTURE_EVENT_ID)}
 const first=buildControlRoomModel(data,FIXTURE_EVENT_ID,result,[])
 assert.deepEqual(first.days,['2026-11-02','2027-03-04'])
 assert.ok(first.domain.end-first.domain.start<=86400000)
 assert.equal(first.timeline.length,7);assert.ok(first.timeline[0].originalBar.width>5)
 const later=buildControlRoomModel(data,FIXTURE_EVENT_ID,result,[],{day:'2027-03-04'})
 assert.equal(later.timeline.length,1);assert.equal(later.timeline[0].originalBar.width,100)
 assert.equal(later.facilities[0].cells[0].start,later.domain.start)
})
test('cross-midnight intervals split chronologically into real Singapore days',()=>{
 const data=campusConnectFixture();data.event_segments=data.event_segments.filter(s=>s.id===1)
 data.event_segments[0].starts_at='2026-11-01T15:30:00Z';data.event_segments[0].ends_at='2026-11-01T16:30:00Z'
 const result={eventId:FIXTURE_EVENT_ID,simulatedSegments:data.event_segments}
 const a=buildControlRoomModel(data,FIXTURE_EVENT_ID,result,[]),b=buildControlRoomModel(data,FIXTURE_EVENT_ID,result,[],{day:'2026-11-02'})
 assert.deepEqual(a.days,['2026-11-01','2026-11-02']);assert.equal(a.domain.end,b.domain.start)
 assert.equal(a.domain.end-a.domain.start,1800000);assert.equal(b.domain.end-b.domain.start,1800000)
 assert.equal(a.timeline[0].originalBar.width,100);assert.equal(b.timeline[0].originalBar.width,100)
})
