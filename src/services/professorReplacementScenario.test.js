import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assessMemberReplacements, recommendMemberReplacements } from './recoveryRecommendationService.js'

// Synthetic examples only. Never seed or merge these names into live records.
const period = {start:'2026-11-02T18:00:00+08:00',end:'2026-11-02T21:00:00+08:00'}
const disruptions = [{type:'MEMBER_UNAVAILABLE',memberId:1,...period}]
function scenario() {
  const names=['Rachel Chua','John Pork','Michael Scott','Peter Griffin','Gordon Ramsay','Rick Astley','Ben Dover','Unauthorized Member','Standby A','Standby B','Standby C','Standby D']
  return {
    events:[{id:1,club_id:10,name:'Eurhythmix Simulator Demo'},{id:2,club_id:10,name:'Other Event'}],
    members:names.map((full_name,i)=>({id:i+1,full_name})),
    replacement_memberships:names.map((_,i)=>({memberId:i+1,clubId:i===7?99:10,active:true,verified:true})),
    member_replacement_coverage:{rosterVerified:true,scheduleVerified:false},
    event_segments:[
      {id:1,event_id:1,title:'Evening performance',starts_at:period.start,ends_at:period.end},
      {id:2,event_id:2,title:'Earlier rehearsal',starts_at:'2026-11-01T16:00:00+08:00',ends_at:'2026-11-01T17:00:00+08:00'},
      {id:3,event_id:2,title:'Cross-event rehearsal',starts_at:'2026-11-02T19:00:00+08:00',ends_at:'2026-11-02T20:00:00+08:00'},
      {id:4,event_id:2,title:'Afternoon duty',starts_at:'2026-11-02T16:00:00+08:00',ends_at:'2026-11-02T17:00:00+08:00'}],
    segment_assignments:[{id:1,segment_id:1,member_id:1,role_name:'Dance Captain'},
      ...names.slice(1).map((_,i)=>({segment_id:2,member_id:i+2,role_name:'Dance Captain'})),
      ...[4,5,6].map(member_id=>({segment_id:3,member_id,role_name:'Dance Captain'})),
      {segment_id:4,member_id:7,role_name:'Crew'}]
  }
}
test('professor scenario preserves exact-role candidates but requires availability confirmation',()=>{
  const result=assessMemberReplacements(scenario(),1,1,disruptions)
  for(const id of [2,3,7]) {
    const member=result.eligible.find(c=>c.id===id)
    assert.ok(member); assert.equal(member.roleMatch,'exact')
    assert.equal(member.requiresManualReview,true); assert.equal(member.availabilityVerified,false)
    assert.equal(member.score,70) // 50 role + 0 verified availability + 20 event workload.
  }
  assert.equal(result.excluded.some(c=>c.id===7),false)
})
test('only recorded overlaps exclude Peter, Gordon and Rick with actual context',()=>{
  const result=assessMemberReplacements(scenario(),1,1,disruptions)
  assert.deepEqual(result.excluded.map(c=>c.id),[4,5,6])
  for(const member of result.excluded) {
    assert.match(member.reasons[0],/Overlapping recorded event/)
    assert.deepEqual(member.conflicts[0],{segmentId:3,eventName:'Other Event',activity:'Cross-event rehearsal',
      start:'2026-11-02T19:00:00+08:00',end:'2026-11-02T20:00:00+08:00'})
  }
})
test('names alone never cause exclusions when overlap evidence is absent',()=>{
  const data=scenario(); data.segment_assignments=data.segment_assignments.filter(a=>a.segment_id!==3)
  const result=assessMemberReplacements(data,1,1,disruptions)
  assert.deepEqual(result.excluded,[])
  for(const id of [4,5,6]) assert.ok(result.eligible.some(c=>c.id===id))
})
test('assessment exposes all candidates while legacy Top 5 API remains compatible',()=>{
  const result=assessMemberReplacements(scenario(),1,1,disruptions)
  assert.equal(result.eligible.length,7)
  assert.equal(recommendMemberReplacements(scenario(),1,1,disruptions).length,5)
  assert.deepEqual(result.eligible.slice(0,5),recommendMemberReplacements(scenario(),1,1,disruptions))
})
test('unauthorized members appear in neither eligible nor excluded lists',()=>{
  const data=scenario(); data.segment_assignments.push({segment_id:3,member_id:8,role_name:'Crew'})
  const result=assessMemberReplacements(data,1,1,disruptions)
  assert.ok(![...result.eligible,...result.excluded].some(c=>c.id===8))
})
test('zero-length, reversed and malformed date ranges produce explicit warnings',()=>{
  for(const values of [{...period,end:period.start},{...period,start:period.end,end:period.start},{...period,start:'invalid'}]) {
    const result=assessMemberReplacements(scenario(),1,1,[{type:'MEMBER_UNAVAILABLE',memberId:1,...values}])
    assert.deepEqual(result.eligible,[]); assert.deepEqual(result.excluded,[])
    assert.match(result.warnings[0],/valid unavailability/)
  }
})
test('missing datasets, assignments and unverified rosters fail gracefully',()=>{
  assert.match(assessMemberReplacements(null,1,1,disruptions).warnings[0],/incomplete/)
  const data=scenario(); data.segment_assignments=[]
  assert.match(assessMemberReplacements(data,1,1,disruptions).warnings[0],/No recorded assignments/)
  data.member_replacement_coverage.rosterVerified=false
  assert.match(assessMemberReplacements(data,1,1,disruptions).warnings[0],/not verified/)
})
test('missing conflict titles use honest placeholders, duplicate roles do not duplicate conflicts',()=>{
  const data=scenario(); data.events[1].name=null; data.event_segments[2].title=null
  data.segment_assignments.push({segment_id:3,member_id:4,role_name:'Crew'})
  const excluded=assessMemberReplacements(data,1,1,disruptions).excluded.find(c=>c.id===4)
  assert.equal(excluded.conflicts.length,1)
  assert.equal(excluded.conflicts[0].eventName,'Event name unavailable')
  assert.equal(excluded.conflicts[0].activity,'Activity name unavailable')
})
test('busy periods and simulated unavailability have distinct actual reasons',()=>{
  const data=scenario(); data.member_busy_periods=[{memberId:2,...period}]
  const result=assessMemberReplacements(data,1,1,[...disruptions,{type:'MEMBER_UNAVAILABLE',memberId:3,...period}])
  assert.match(result.excluded.find(c=>c.id===2).reasons[0],/busy period/)
  assert.match(result.excluded.find(c=>c.id===3).reasons[0],/simulation/)
})
test('UI provides toggle, exclusion details and explicit no-send preview labels',()=>{
  // Markup wiring guard; this is not a browser interaction test.
  const source=readFileSync(new URL('../views/EventRiskView.vue',import.meta.url),'utf8')
  assert.match(source,/Show All Candidates/); assert.match(source,/Show Top 5/)
  assert.match(source,/candidateAssessment.excluded/); assert.match(source,/conflict.eventName/)
  assert.match(source,/Simulate Telegram invitation/); assert.match(source,/no message sent/)
})
