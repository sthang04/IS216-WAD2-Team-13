// WHY THIS FILE IS RETAINED: Checks that simulator booking discovery remains connected to the calendar service and expected refresh events.
// These focused regression checks preserve edge cases that browser journeys may not isolate.
// SCOPE: Non-browser checks using the Playwright test runner; excluded from browser E2E commands.
// A passing result here does not prove a complete user journey or deployed backend enforcement.
import {test,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../../../src/services/simulatorBookingBridge.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/export /g,'')
function reader(readRows){return new Function('supabase','readSimulatorRows',source+';return readRecoveryBookings')({},readRows)}
test('booking reader extends coverage to proposed dates and reads linked IDs outside that range',async()=>{
 const calls=[];const read=reader(async(client,table,configure)=>{const filters=[];const q={};for(const method of ['gte','lte','in','eq'])q[method]=(...args)=>{filters.push([method,...args]);return q};configure(q);calls.push({table,filters});if(table==='facility_transfers')return [{id:91,booking_id:2,claiming_club_id:7,transfer_status:'Rejected'}];return filters.some(f=>f[0]==='in')?[{id:2},{id:1}]:[{id:1}]})
 const rows=await read({ranges:[{starts_at:'2026-12-05T17:00:00Z',ends_at:'2026-12-05T18:00:00Z'}],ids:[2],clubId:7})
 expect(calls[0].filters).toEqual([['gte','booking_date','2026-12-06'],['lte','booking_date','2026-12-06']]);expect(calls[1].filters).toEqual([['in','id',[2]]]);expect(rows.map(r=>r.id)).toEqual([1,2]);expect(rows[1].recovery_transfers[0].transfer_status).toBe('Rejected');expect(calls[2].filters).toContainEqual(['eq','claiming_club_id',7])
})
test('permission or incomplete-record errors propagate rather than becoming empty availability',async()=>{
 const read=reader(async()=>{throw Error('Permission denied')});await expect(read({ranges:[{starts_at:'2026-12-01T01:00:00Z',ends_at:'2026-12-01T02:00:00Z'}]})).rejects.toThrow('Permission denied')
})
