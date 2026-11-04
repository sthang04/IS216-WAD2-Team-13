// WHY THIS FILE IS RETAINED: Checks readable impact summaries, correct counts, and recovery shortlists without changing engine results.
// These focused regression checks preserve edge cases that browser journeys may not isolate.
// SCOPE: Node unit tests using node:test; excluded from browser E2E commands.
// A passing result here does not prove a complete user journey or deployed backend enforcement.
// Purpose: isolated behaviour checks for the simulator data/presentation contract; no browser or live database is used.
﻿import test from 'node:test'
import assert from 'node:assert/strict'
import {simulationImpactSummary as summary,visibleRecoveryOptions} from '../../src/services/simulatorPresentationService.js'
const data={members:[{id:7,full_name:'Asha'}],event_segments:[{id:1,event_id:9,title:'Stage setup'},{id:2,event_id:9,title:'Brief emcees'},{id:3,event_id:9,title:'Soundcheck'},{id:4,event_id:9,title:'Opening'}]}
const base={data,eventId:9,result:{directImpacts:[{segmentId:1},{segmentId:2}],downstreamRisks:[]}}
test('absence names actual resources and activities without claiming empty assignments',()=>{
 const text=summary({...base,disruptions:[{type:'MEMBER_UNAVAILABLE',memberId:7}]})
 assert.match(text,/Asha can't attend/);assert.match(text,/Stage setup and Brief emcees need review/)
 assert.doesNotMatch(text,/unassigned|no assigned|without a member|no member/i)
})
test('facility and accumulated delays use actual selected evidence',()=>{
 assert.match(summary({...base,disruptions:[{type:'FACILITY_UNAVAILABLE',venueName:'Studio C'}]}),/Studio C is unavailable/)
 assert.match(summary({...base,disruptions:[{type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:10},{type:'SCHEDULE_DELAY',segmentId:'1',delayMinutes:20}]}),/Stage setup is delayed 30 min/)
})
test('direct and downstream impacts are deduplicated separately',()=>{
 const text=summary({...base,result:{directImpacts:[{segmentId:1},{segmentId:'1'}],downstreamRisks:[{segmentId:1},{segmentId:3},{segmentId:'3'},{segmentId:4}]}})
 assert.match(text,/Stage setup needs review/);assert.match(text,/2 downstream activities also at risk/)
})
test('many impacts show actual count and a short sample',()=>{
 const text=summary({...base,result:{directImpacts:[1,2,3,4].map(segmentId=>({segmentId})),downstreamRisks:[]}})
 assert.match(text,/4 activities/);assert.match(text,/Stage setup, Brief emcees/);assert.ok(text.length<200)
})
test('unknown records preserve impact counts rather than claiming no impacts',()=>{
 const text=summary({...base,result:{directImpacts:[{segmentId:999}],downstreamRisks:[]},disruptions:[{type:'MEMBER_UNAVAILABLE',memberId:999}]})
 assert.match(text,/selected member/);assert.match(text,/affected activity needs review/);assert.doesNotMatch(text,/undefined|no direct activity/)
})
test('mixed causes stay compact and do not mutate engine results',()=>{
 const input={...base,disruptions:[{type:'MEMBER_UNAVAILABLE',memberId:7},{type:'FACILITY_UNAVAILABLE',venueName:'Studio C'},{type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:15}]}
 const before=JSON.stringify(input);assert.match(summary(input),/2 other disruptions/);assert.equal(JSON.stringify(input),before)
})
test('empty and future scenarios have honest fallback wording',()=>{
 assert.equal(summary(), '')
 assert.equal(summary({data:null,result:base.result}), '')
 assert.match(summary({...base,result:{directImpacts:[],downstreamRisks:[]}}),/no direct activity impacts were detected/)
 assert.match(summary({...base,disruptions:[{type:'FUTURE_SCENARIO'}]}),/selected disruption occurs/)
 assert.doesNotMatch(summary(base),/undefined/)
})

test('shortlist displays three without mutating scores, ranks or all-options data',()=>{
 const plans=Array.from({length:6},(_,i)=>({id:'plan-'+i,rank:i+1,score:99-i}))
 const before=JSON.stringify(plans)
 assert.deepEqual(visibleRecoveryOptions(plans).map(p=>p.id),['plan-0','plan-1','plan-2'])
 assert.deepEqual(visibleRecoveryOptions(plans,'all'),plans)
 assert.equal(JSON.stringify(plans),before)
})
test('a chosen option outside the top three remains visible without automatic selection',()=>{
 const plans=Array.from({length:6},(_,i)=>({id:'plan-'+i,rank:i+1}))
 assert.deepEqual(visibleRecoveryOptions(plans,3,'plan-5').map(p=>p.rank),[1,2,3,6])
 assert.equal(visibleRecoveryOptions(plans,3,'plan-0').length,3)
 assert.equal(visibleRecoveryOptions([],3,'missing').length,0)
})
