import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as Vue from 'vue'
import {parse,compileScript} from 'vue/compiler-sfc'
import {simulatorCalendarTarget} from './simulatorCalendarNavigation.js'
import {bookingEvidence} from './simulatorWorkflowService.js'
import {calendarOptionsForRecommendation,readSimulatorCalendarSnapshot} from './simulatorCalendarIntegration.js'
// Execute the actual shared pure helper without importing its browser-only
// Supabase/session dependencies into Node. Do not reproduce its eligibility rules.
const source=readFileSync(new URL('./facilityService.js',import.meta.url),'utf8')
const statusSource=source.match(/export const STATUSES = \{[\s\S]*?\n\}/)[0].replace('export const','const')
const bookingActions=Function('const TRANSFER_LEAD_DAYS=4;'+statusSource+';'+source.slice(source.indexOf('export function bookingActions')).replace('export function','return function'))()
const booking={booking_id:1,facility_id:2,facility_name:'Room A',booking_date:'2026-11-02',start_time:'18:00:00',end_time:'21:00:00',status:'Proposed Peer Transfer',owner_club_id:20,is_transfer_window_open:true}
const inspect=(rows=[booking],extra={})=>calendarOptionsForRecommendation({venue:'Room A',start:'2026-11-02T10:00:00Z',end:'2026-11-02T13:00:00Z',rows,clubId:10,canClaim:true,bookingActions,...extra})
test('released slot reuses calendar claim eligibility without confirming approval',()=>{
 assert.equal(inspect()[0].action,'Claim Room');assert.equal(inspect()[0].confirmed,false)
 assert.equal(inspect([{...booking,offered_club_id:30}])[0].action,'Join Waitlist')
 assert.equal(inspect([{...booking,offered_club_id:10}])[0].action,'Claim Room')
})
test('permission, transfer window and same-club restrictions come from calendar',()=>{
 assert.equal(inspect(undefined,{canClaim:false})[0].action,'View in Calendar')
 assert.equal(inspect([{...booking,is_transfer_window_open:false}])[0].action,'View in Calendar')
 assert.equal(inspect([{...booking,owner_club_id:10}])[0].action,'View in Calendar')
 assert.equal(inspect(undefined,{clubId:null})[0].action,'View in Calendar')
})
test('pending approval never confirms; a refreshed approved owned booking can confirm',()=>{
 assert.equal(inspect([{...booking,status:'Pending Admin Sign-off',claiming_club_id:10}])[0].confirmed,false)
 assert.match(inspect([{...booking,status:'Pending Admin Sign-off',claiming_club_id:10}])[0].reason,/Pending OSL/)
 assert.equal(inspect([{...booking,status:'Officially Confirmed Booking',owner_club_id:10}])[0].confirmed,true)
 assert.equal(inspect([{...booking,status:'Officially Confirmed Booking'}])[0].confirmed,false)
})
test('physical overlap blocks action but adjacent bookings do not',()=>{
 assert.equal(inspect([booking,{...booking,booking_id:3,status:'Booked'}])[0].action,'Unavailable')
 assert.equal(inspect([booking,{...booking,booking_id:3,start_time:'17:00:00',end_time:'18:00:00'}])[0].action,'Claim Room')
})
test('missing slots stay visible with vacancy warning and invalid times are rejected',()=>{
 assert.match(inspect([])[0].reason,/Vacancy is unverified/)
 assert.match(inspect([{...booking,start_time:'19:00:00'}])[0].reason,/full activity/)
 assert.equal(inspect(undefined,{start:'invalid'})[0].action,'Unavailable')
})
test('adapter preserves calendar slot order without changing recommendation ranking',()=>{
 const rows=[booking,{...booking,booking_id:4,facility_id:3}]
 assert.deepEqual(inspect(rows).map(r=>r.bookingId),[1,4])
})
test('notification reads/linking are not misrepresented as invitation creation or Telegram delivery',()=>{
 const notifications=readFileSync(new URL('./notificationService.js',import.meta.url),'utf8')
 assert.match(notifications,/rpc_my_notifications/)
 assert.match(notifications,/rpc_create_telegram_link_code/)
 assert.match(notifications,/rpc_my_telegram_link/)
 // No verified single-recipient writer is available here; do not invent one.
 assert.doesNotMatch(notifications,/\.insert\(|api\.telegram\.org/)
})

test('existing waitlist membership maps to Manage, not Join, using the shared helper',()=>{
 const options=inspect([{...booking,status:'Booked'}],{waitlistEntries:[{booking_id:1,status:'WAITING',queue_position:2}]})
 assert.equal(options[0].action,'Manage Waitlist')
 assert.match(options[0].reason,/already has a live queue/)
})
test('booked rooms may be waitlisted but are never presented as claimable',()=>{
 const option=inspect([{...booking,status:'Booked'}])[0]
 assert.equal(option.action,'Join Waitlist');assert.equal(option.confirmed,false)
})
test('calendar reader retrieves actual slot and queue snapshots and propagates missing coverage',async()=>{
 const calls=[],args={from:'2026-11-02',to:'2026-11-02',clubId:10}
 const result=await readSimulatorCalendarSnapshot({...args,
  fetchCalendar:async filters=>{calls.push(filters);return [booking]},
  fetchActiveClubEntries:async club=>{calls.push(club);return [{booking_id:1,status:'WAITING'}]}})
 assert.deepEqual(calls,[{from:args.from,to:args.to},10]);assert.equal(result.entries[0].status,'WAITING')
 await assert.rejects(readSimulatorCalendarSnapshot({...args,fetchCalendar:async()=>[booking],
  fetchActiveClubEntries:async()=>{throw Error('Queue permission denied')}}),/Queue permission denied/)
 await assert.rejects(readSimulatorCalendarSnapshot({...args,fetchCalendar:async()=>null,fetchActiveClubEntries:async()=>[]}),/incomplete/)
})
test('refresh reflects a changed claim status rather than preserving a stale claim hint',async()=>{
 let rows=[booking]
 const load=()=>readSimulatorCalendarSnapshot({from:'2026-11-02',to:'2026-11-02',clubId:10,
  fetchCalendar:async()=>rows,fetchActiveClubEntries:async()=>[]})
 assert.equal(inspect((await load()).rows)[0].action,'Claim Room')
 rows=[{...booking,status:'Pending Admin Sign-off',claiming_club_id:10}]
 assert.equal(inspect((await load()).rows)[0].action,'View in Calendar')
 assert.equal(inspect((await load()).rows)[0].confirmed,false)
 rows=[{...booking,status:'Officially Confirmed Booking',owner_club_id:10}]
 assert.equal(inspect((await load()).rows)[0].confirmed,true)
})
test('public readers never load another club queue',async()=>{
 let queueCalls=0
 const result=await readSimulatorCalendarSnapshot({from:'2026-11-02',to:'2026-11-02',clubId:null,
  fetchCalendar:async()=>[booking],fetchActiveClubEntries:async()=>{queueCalls++;return []}})
 assert.equal(queueCalls,0);assert.deepEqual(result.entries,[])
})
test('calendar UI navigation cannot execute a claim or fake room preselection',()=>{
 const component=readFileSync(new URL('../components/SimulatorCalendarActions.vue',import.meta.url),'utf8')
 assert.match(component,/>Open in Calendar<\//)
 assert.doesNotMatch(component,/claimBooking\(|joinWaitlist\(|leaveWaitlist\(|\.rpc\(/)
 assert.match(component,/simulatorCalendarTarget\(props,weekStartOf\)/)
 assert.match(component,/version!==refreshVersion/)
 assert.match(component,/onUnmounted\(invalidate\)/)
})
test('booking evidence flags unrelated event allocations without inventing a booking event_id',()=>{
 const data={facility_bookings:[{...booking,id:1,status:'Booked',owner_club_id:10}],
  event_segments:[{id:7,event_id:99}],segment_facility_bookings:[{segment_id:7,booking_id:1}]}
 const evidence=bookingEvidence(data,1,10,'2026-11-02T10:00:00Z','2026-11-02T13:00:00Z',1)
 assert.ok(evidence.reasons.some(r=>/another event/.test(r)))
})
test('server migration checks wrong-club/room allocation and approved status at Confirm, with separate calendar cancellation',()=>{
 const sql=readFileSync(new URL('../../supabase/migrations/202610310002_simulator_recovery_workflow.sql',import.meta.url),'utf8')
 const attach=sql.split('CREATE FUNCTION public.rpc_simulator_attach_booking')[1].split('END $$;')[0]
 const validate=sql.split('CREATE FUNCTION simulator_private.validate_event')[1].split('END $$;')[0]
 const cancel=sql.split('CREATE FUNCTION public.rpc_simulator_cancel_plan')[1].split('END $$;')[0]
 assert.match(attach,/other_segment.event_id<>p.event_id/)
 assert.match(attach,/c->>'venueName'=room/)
 assert.match(validate,/other_segment.event_id<>p_event/)
 assert.match(validate,/booking.owner_club_id IS DISTINCT FROM p_club/)
 assert.match(validate,/NOT IN \('Booked','Officially Confirmed Booking'\)/)
 assert.doesNotMatch(cancel,/UPDATE public\.|rpc_.*(?:claim|release|waitlist)/)
})

test('real calendar component discards an in-flight snapshot after the acting club changes',async()=>{
 const {descriptor}=parse(readFileSync(new URL('../components/SimulatorCalendarActions.vue',import.meta.url),'utf8'),{filename:'SimulatorCalendarActions.vue'})
 const script=compileScript(descriptor,{id:'calendar-audit'})
 const code=script.content.replace(/import[\s\S]*?from ['"][^'"]+['"];?/g,'').replace('export default','return')
 const session=Vue.ref({activeClubId:10,memberId:1,authUserId:'local-mock',isOslAdmin:false})
 let completeOld
 let calendarRead=()=>new Promise(resolve=>{completeOld=resolve})
 const deps={ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,onUnmounted:Vue.onUnmounted,
  fetchCalendar:(...args)=>calendarRead(...args),fetchActiveClubEntries:async()=>[],
  bookingActions,weekStartOf:date=>date,session,activeMembership:Vue.ref({club_name:'Club'}),
  canManageActiveClub:Vue.ref(true),calendarOptionsForRecommendation,readSimulatorCalendarSnapshot,simulatorCalendarTarget}
 const component=Function(...Object.keys(deps),code)(...Object.values(deps));component.render=()=>null
 const renderer=Vue.createRenderer({insert(){},remove(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),
  setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}})
 const app=renderer.createApp(component,{venue:'Room A',start:'2026-11-02T10:00:00Z',end:'2026-11-02T13:00:00Z',eventClubId:10})
 const state=app.mount({}).$.setupState
 try{
  const pending=state.refresh()
  session.value.activeClubId=20;await Vue.nextTick()
  completeOld([booking]);await pending
  assert.equal(state.rows,null);assert.equal(state.options.length,0)
  session.value.activeClubId=10;await Vue.nextTick()
  calendarRead=async()=>[{...booking,status:'Pending Admin Sign-off',claiming_club_id:10}]
  await state.refresh()
  assert.equal(state.options[0].action,'View in Calendar')
  assert.equal(state.options[0].confirmed,false)
 }finally{app.unmount()}
})


test('Booked alone is a recorded reservation rather than verified final approval',()=>{
 const row=inspect([{...booking,status:'Booked',owner_club_id:10}])[0]
 assert.equal(row.confirmed,false)
})
