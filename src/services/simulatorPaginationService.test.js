import test from 'node:test'
import assert from 'node:assert/strict'
import { readSimulatorRows } from './simulatorPaginationService.js'

// PostgREST-like mock: exact count is the total matching rows, not page length.
function mockRows(rows, {cap=200, reply}={}) {
  const calls=[]
  const client={from:table=>{
    let bounds, filters=[], orders=[]
    const query={
      select:(columns,options)=>{assert.equal(options.count,'exact');return query},
      eq:(key,value)=>{filters.push(r=>r[key]===value);return query},
      order:(key)=>{orders.push(key);return query},
      range:(from,to)=>{bounds=[from,to];return query},
      then:resolve=>{
        const visible=rows.filter(r=>filters.every(f=>f(r)))
        calls.push({table,bounds,orders})
        const normal={data:visible.slice(bounds[0],Math.min(bounds[1]+1,bounds[0]+cap)),count:visible.length,error:null}
        return Promise.resolve(reply ? reply(normal,calls.length) : normal).then(resolve)
      }
    }
    return query
  }}
  return {client,calls}
}
const rows=Array.from({length:7},(_,i)=>({id:i+1,active:i%2===0}))

test('server cap below requested size does not truncate records',async()=>{
  const {client,calls}=mockRows(rows,{cap:2})
  assert.deepEqual(await readSimulatorRows(client,'members'),rows)
  assert.deepEqual(calls.map(c=>c.bounds[0]),[0,2,4,6])
  assert.ok(calls.every(c=>c.orders[0]==='id'))
})
test('filters and exact counts are preserved on every page',async()=>{
  const {client}=mockRows(rows,{cap:1})
  assert.deepEqual(await readSimulatorRows(client,'members',q=>q.eq('active',true)),rows.filter(r=>r.active))
})
test('empty table is a complete zero-count result',async()=>{
  assert.deepEqual(await readSimulatorRows(mockRows([]).client,'members'),[])
})
test('missing exact count cannot silently become complete',async()=>{
  const {client}=mockRows(rows,{reply:r=>({...r,count:null})})
  await assert.rejects(readSimulatorRows(client,'members'),/exact count/)
})
test('early empty page is an incomplete result',async()=>{
  const {client}=mockRows(rows,{cap:2,reply:(r,n)=>n===2?{...r,data:[]}:r})
  await assert.rejects(readSimulatorRows(client,'members'),/Incomplete/)
})
test('count changes across pages require a refresh',async()=>{
  const {client}=mockRows(rows,{cap:2,reply:(r,n)=>({...r,count:r.count+(n===2?1:0)})})
  await assert.rejects(readSimulatorRows(client,'members'),/changed during loading/)
})
test('duplicate rows across pages fail rather than skipping unseen rows',async()=>{
  const {client}=mockRows(rows,{cap:2,reply:(r,n)=>n===2?{...r,data:[rows[0],rows[1]]}:r})
  await assert.rejects(readSimulatorRows(client,'members'),/Duplicate pagination/)
})
test('query errors propagate even after successful first page',async()=>{
  const {client}=mockRows(rows,{cap:2,reply:(r,n)=>n===2?{data:null,count:null,error:{message:'denied'}}:r})
  await assert.rejects(readSimulatorRows(client,'members'),/denied/)
})
test('composite-key tables receive stable composite ordering',async()=>{
  const data=[{segment_id:1,booking_id:1},{segment_id:1,booking_id:2}]
  const {client,calls}=mockRows(data,{cap:1})
  assert.deepEqual(await readSimulatorRows(client,'segment_facility_bookings'),data)
  assert.deepEqual(calls[0].orders,['segment_id','booking_id'])
})
test('missing primary keys and inconsistent count fail closed',async()=>{
  await assert.rejects(readSimulatorRows(mockRows([{}]).client,'members'),/pagination key/)
  const {client}=mockRows(rows,{reply:r=>({...r,count:1})})
  await assert.rejects(readSimulatorRows(client,'members'),/Inconsistent row count/)
})
