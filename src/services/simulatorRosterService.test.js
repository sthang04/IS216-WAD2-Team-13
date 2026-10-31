import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadEventReplacementRosters } from './simulatorRosterService.js'
import { recommendMemberReplacements } from './recoveryRecommendationService.js'
import { readSimulatorRows } from './simulatorPaginationService.js'

// All RPC responses here are mocks. No database, auth session or network is used.
const event = {id:1, club_name:'Example Club'}
const row = (id,club=10) => ({member_id:id,full_name:'Synthetic '+id,club_id:club,academic_year:'2026/27'})
const client = response => ({rpc:async(name,args)=>{
  assert.equal(name,'rpc_simulator_event_roster'); assert.deepEqual(args,{p_event_id:1})
  return response
}})
// Failures are explicit per-event coverage results, never successful empty rosters.
const assertUnavailable = async (promise, pattern) => {
  const data = await promise
  const coverage = Object.values(data.member_replacement_coverage.byEvent)[0]
  assert.equal(coverage.rosterVerified, false)
  assert.match(coverage.warning, pattern)
  assert.equal(data.events[0].club_id, null)
  assert.deepEqual(data.members, [])
}
const load = rows => loadEventReplacementRosters(client({data:{event_id:1,club_id:10,members:rows},error:null}),[event])

test('active eligible RPC roster becomes normalized membership evidence',async()=>{
  const data=await load([row(1),row(2)])
  assert.equal(data.events[0].club_id,10); assert.equal(data.members.length,2)
  assert.ok(data.replacement_memberships.every(m=>m.active && m.verified))
  assert.equal(data.member_replacement_coverage.scheduleVerified,false)
  assert.match(data.member_replacement_coverage.warning,/incomplete/)
})
test('unassigned standby reaches the real recommendation pipeline',async()=>{
  const roster=await load([row(1),row(2)])
  const data={...roster,event_segments:[{id:1,event_id:1,starts_at:'2026-11-10T10:00:00Z',ends_at:'2026-11-10T11:00:00Z'}],
    segment_assignments:[{segment_id:1,member_id:1,role_name:'Dancer'}]}
  const candidates=recommendMemberReplacements(data,1,1,[{type:'MEMBER_UNAVAILABLE',memberId:1,start:'2026-11-10T10:00:00Z',end:'2026-11-10T11:00:00Z'}])
  assert.equal(candidates[0].id,2); assert.equal(candidates[0].roleMatch,'unverified')
  assert.equal(candidates[0].requiresManualReview,true)
})
test('empty authorised roster remains empty, not a fixture fallback',async()=>{
  const data=await load([]); assert.deepEqual(data.members,[])
  assert.equal(data.events[0].club_id,10); assert.equal(data.member_replacement_coverage.rosterVerified,true)
})
test('inactive membership/member omission in mocked server response is preserved',async()=>{
  // Models the server's active-only response, not proof of executed SQL filtering.
  const data=await load([row(1)])
  assert.ok(!data.members.some(m=>m.id===2))
})
test('wrong-club response fails closed',async()=>{
  await assertUnavailable(load([row(2,99)]),/unrelated membership/)
})
test('unauthorised RPC request is a loading error',async()=>{
  await assertUnavailable(loadEventReplacementRosters(client({data:null,error:{code:'42501',message:'Event unavailable or not authorised'}}),[event]),/not authorised/)
})
test('missing RPC or backend failure never returns fake or empty success',async()=>{
  await assertUnavailable(loadEventReplacementRosters(client({data:null,error:{message:'function not found'}}),[event]),/function not found/)
  await assertUnavailable(loadEventReplacementRosters({rpc:async()=>{throw Error('network failure')}},[event]),/network failure/)
})
test('malformed response and event mismatch are rejected',async()=>{
  for(const payload of [null,{event_id:2,club_id:10,members:[]},{event_id:1,club_id:null,members:[]}]) {
    await assertUnavailable(loadEventReplacementRosters(client({data:payload,error:null}),[event]),/Invalid replacement roster/)
  }
})
test('private/unexpected fields are not copied',async()=>{
  const data=await load([{...row(1),student_email:'synthetic',auth_user_id:'synthetic',telegram_handle:'synthetic'}])
  assert.deepEqual(Object.keys(data.members[0]).sort(),['full_name','id'])
})
test('events are independently authorised and IDs deduplicate across rosters',async()=>{
  const calls=[]
  const data=await loadEventReplacementRosters({rpc:async(_,args)=>{
    calls.push(args.p_event_id)
    return {data:{event_id:args.p_event_id,club_id:10,members:[row(1)]},error:null}
  }},[event,{...event,id:2}])
  assert.deepEqual(calls,[1,2]); assert.equal(data.members.length,1)
})
test('unsafe numeric IDs are rejected instead of rounded',async()=>{
  await assertUnavailable(loadEventReplacementRosters(client({}),[{id:Number.MAX_SAFE_INTEGER+1}]),/Invalid event ID/)
})
test('SQL review guard checks active-only filters, auth, grants and no assignment join',()=>{
  // Structural checks only: SQL has NOT been installed or executed on PostgreSQL.
  const sql=readFileSync(new URL('../../supabase/migrations/202610310001_simulator_event_roster.sql',import.meta.url),'utf8')
  assert.match(sql,/caller_uid uuid := auth.uid()/)
  assert.match(sql,/SET search_path = pg_catalog/)
  assert.match(sql,/matching_clubs <> 1/)
  assert.match(sql,/caller.auth_user_id = caller_uid/)
  assert.match(sql,/caller.is_active = true/)
  assert.match(sql,/cm.is_active = true/)
  assert.match(sql,/m.is_active = true/)
  assert.match(sql,/cm.club_id = resolved_club_id/)
  assert.match(sql,/r.is_admin_role = false/)
  assert.match(sql,/FROM PUBLIC, anon, authenticated/)
  assert.doesNotMatch(sql,/JOIN public.segment_assignments|v_user_club_memberships|student_email|telegram_handle/)
  assert.doesNotMatch(sql,/CREATE OR REPLACE|ALTER TABLE|CREATE POLICY/)
})

test('actual live loader merges RPC standby with assigned impact members using mocks',async()=>{
  // Execute the loader's real functions with injected dependencies. Only import
  // bindings are replaced; all SELECT/merge/normalization logic stays unchanged.
  const source=readFileSync(new URL('./simulationDataService.js',import.meta.url),'utf8')
    .replace(/^import .*$/gm,'').replace(/export async function/g,'async function')
  const factory=new Function('supabase','isSupabaseConfigured','loadEventReplacementRosters','readSimulatorRows',
    source+'; return {loadLiveSimulationData,loadSimulationData};')
  const tables={
    events:[{...event,starts_at:'2026-11-10T10:00:00Z',ends_at:'2026-11-10T11:00:00Z'}],
    event_segments:[{id:1,event_id:1,starts_at:'2026-11-10T10:00:00Z',ends_at:'2026-11-10T11:00:00Z'}],
    segment_assignments:[{id:1,segment_id:1,member_id:1,role_name:'Dancer'}],
    segment_dependencies:[],segment_facility_bookings:[],facility_bookings:[],facilities:[],
    members:[{id:1,full_name:'Assigned impact member'}]
  }
  const fake={auth:{getUser:async()=>({data:{user:{id:'synthetic'}},error:null})},
    rpc:client({data:{event_id:1,club_id:10,members:[row(2)]},error:null}).rpc,
    from:table=>{
      assert.ok(table in tables,'Unexpected table '+table)
      let rows=tables[table], bounds=[0,199]
      const query={select:()=>query,order:()=>query,range:(from,to)=>{bounds=[from,to];return query},
        in:(column,values)=>{rows=rows.filter(r=>values.includes(r[column]));return query},
        eq:(column,value)=>{rows=rows.filter(r=>r[column]===value);return query},gte:()=>query,lte:()=>query,then:resolve=>Promise.resolve({data:rows.slice(bounds[0],bounds[1]+1),count:rows.length,error:null}).then(resolve)}
      return query
    }}
  const loader=factory(fake,()=>true,loadEventReplacementRosters,readSimulatorRows)
  const data=await loader.loadLiveSimulationData()
  assert.deepEqual(data.members.map(m=>m.id),[1,2])
  assert.equal(data.replacement_memberships[0].memberId,2)
  assert.equal(data.events[0].club_id,10)
  assert.equal(data.member_replacement_coverage.scheduleVerified,false)
  await assert.rejects(loader.loadSimulationData({source:'local'}),/test-only/)
  fake.rpc=async()=>({data:null,error:{message:'not deployed'}})
  const failed=await loader.loadLiveSimulationData()
  assert.equal(failed.member_replacement_coverage.byEvent['1'].rosterVerified,false)
  assert.match(failed.member_replacement_coverage.byEvent['1'].warning,/not deployed/)
  fake.auth.getUser=async()=>({data:{user:null},error:null})
  await assert.rejects(loader.loadLiveSimulationData(),/sign in/)
})

test('duplicate member-year evidence deduplicates while different years remain',async()=>{
  const data=await load([row(1),row(1),{...row(1),academic_year:'2025/26'}])
  assert.equal(data.members.length,1)
  assert.equal(data.replacement_memberships.length,2)
  assert.deepEqual(data.replacement_memberships.map(m=>m.academicYear).sort(),['2025/26','2026/27'])
})
test('failed unrelated event does not disable successful event candidates',async()=>{
  const data=await loadEventReplacementRosters({rpc:async(_,args)=>args.p_event_id===2
    ? {data:null,error:{message:'unrelated event denied'}}
    : {data:{event_id:1,club_id:10,members:[row(1),row(2)]},error:null}},[event,{...event,id:2}])
  assert.equal(data.member_replacement_coverage.rosterVerified,false)
  assert.equal(data.member_replacement_coverage.byEvent['1'].rosterVerified,true)
  assert.match(data.member_replacement_coverage.byEvent['2'].warning,/denied/)
  data.event_segments=[{id:1,event_id:1,starts_at:'2026-11-10T10:00:00Z',ends_at:'2026-11-10T11:00:00Z'}]
  data.segment_assignments=[{segment_id:1,member_id:1,role_name:'Dancer'}]
  const ds=[{type:'MEMBER_UNAVAILABLE',memberId:1,start:'2026-11-10T10:00:00Z',end:'2026-11-10T11:00:00Z'}]
  assert.equal(recommendMemberReplacements(data,1,1,ds)[0].id,2)
  assert.deepEqual(recommendMemberReplacements(data,2,1,ds),[])
})
test('malformed event response leaves no partial membership evidence',async()=>{
  const data=await load([row(1),row(2,99)])
  assert.deepEqual(data.members,[]); assert.deepEqual(data.replacement_memberships,[])
  assert.equal(data.member_replacement_coverage.byEvent['1'].rosterVerified,false)
})
