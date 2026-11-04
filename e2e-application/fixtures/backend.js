// SUPPORT FILE PURPOSE: backend.js supplies shared setup or controlled data for the browser workflows.
// Keep this support code: the Playwright tests depend on consistent setup and isolated state.
import {createMeetingBackend} from '/e2e-application/fixtures/meetingBackend.js'
﻿// Test-only database boundary. Browser tests still use production services/loader.
import {campusConnectMultiEventFixture} from '/e2e-simulator/fixtures/campusConnect.js'

export function createBackend(config,calls){
 const meetingRpc=createMeetingBackend(config)
 const key='pulse-application-data'
 const simulation=campusConnectMultiEventFixture()
 simulation.events=simulation.events.filter(e=>e.id!==990002)
 simulation.events[0].name='Fixture Alpha Showcase'
 simulation.events[1].name='Fixture Beta Workshop'
 for(const s of simulation.event_segments)if(s.event_id===990003)s.title='Fixture Beta activity '+(s.id-200)
 const facilities=[
  {id:101,name:'Fixture Dance Studio',facility_type:'Studio',capacity:40,is_active:true,equipment:['Mirrors'],location:'Fixture North'},
  {id:102,name:'Fixture Music Room',facility_type:'Music',capacity:20,is_active:true,equipment:['Piano'],location:'Fixture South'},
  {id:103,name:'Fixture Sports Hall',facility_type:'Sports',capacity:200,is_active:true,equipment:['Sound'],location:'Fixture West'}]
 const booking=(id,facility,owner,status)=>({id,booking_id:id,facility_id:facility.id,facility_name:facility.name,
  facility_type:facility.facility_type,capacity:facility.capacity,equipment:facility.equipment,
  owner_club_id:owner,owner_club_name:owner===71?'Fixture Arts Club':'Fixture Other Club',
  booking_date:'2026-11-09',start_time:'10:00:00',end_time:'11:00:00',status,
  is_transfer_window_open:true,waitlist_count:0,fbs_reference:'FIXTURE-FBS-'+id})
 const calendar=[booking(501,facilities[0],71,'Booked'),booking(502,facilities[1],72,'Proposed Peer Transfer'),
  booking(503,facilities[2],72,'Booked')]
 const transfer={...calendar[1],transfer_id:801,booking_id:502,booking_status:'Pending Admin Sign-off',
  releasing_club_id:72,releasing_club_name:'Fixture Other Club',claiming_club_id:71,claiming_club_name:'Fixture Arts Club',
  released_by_name:'Fixture Owner',claimed_by_name:'Fixture Exco',audit_voucher_id:'FIXTURE-AUDIT-801',
  claimed_at:'2026-11-03T01:00:00Z',state:'CLAIMED',direction:'INCOMING',
  osl_email_status:'SENT',hours_to_deadline:100,signoff_deadline:'2026-11-07T02:00:00Z'}
 const offered={...calendar[1],entry_id:901,club_id:71,club_name:'Fixture Arts Club',queue_position:1,
  status:'OFFERED',booking_status:'Proposed Peer Transfer',offer_expires_at:'2026-11-03T02:30:00Z'}
 const state=JSON.parse(sessionStorage.getItem(key)||'null')||{
  calendar:config().facilities?calendar:[],facilities:config().facilities?facilities:[],
  waitlist:config().offer?[offered]:[],transfers:config().transfers?[config().emailFailed?{...transfer,direction:'OUTGOING',releasing_club_id:71,releasing_club_name:'Fixture Arts Club',osl_email_status:'FAILED'}:transfer]:[],decisions:[],
  notifications:config().notifications?[
   {id:401,title:'Fixture schedule update',message:'Review your synthetic assignment',is_read:false,
    link_path:'/personal-schedule',created_at:'2026-11-03T01:55:00Z'},
   {id:402,title:'Fixture facility update',message:'Read the fixture calendar',is_read:false,
    link_path:'/facilities',created_at:'2026-11-03T01:50:00Z'}]:[]}
 const persist=()=>sessionStorage.setItem(key,JSON.stringify(state))
 const allowedTables=new Set([
  'v_master_facility_calendar','v_waitlist_queue','ops_events',
  ...Object.keys(simulation).filter(name=>Array.isArray(simulation[name])),
 ])
 const pendingReads=new Set()
 const faultKey='pulse-foundation-unexpected'
 const controls={
  unexpected(){return JSON.parse(sessionStorage.getItem(faultKey)||'[]')},
  recordUnexpected(message){
   const faults=JSON.parse(sessionStorage.getItem(faultKey)||'[]')
   faults.push(message);sessionStorage.setItem(faultKey,JSON.stringify(faults))
  },
  configure(patch){sessionStorage.setItem('pulse-foundation-config',JSON.stringify({...config(),...patch}))},
  release(){for(const resolve of pendingReads)resolve();pendingReads.clear()},
 }
 const ok=data=>({data:structuredClone(data),error:null})
 function tableRows(table){
  if(table==='v_master_facility_calendar'){
   if(config().simulation&&!config().facilities)return simulation.facility_bookings.map(b=>({...b,booking_id:b.id,facility_name:simulation.facilities.find(f=>f.id===b.facility_id)?.name,is_transfer_window_open:false,owner_club_name:'Fixture Club'}))
   return state.calendar
  }
  if(table==='v_waitlist_queue')return state.waitlist
  if(config().simulation){
   if(table==='events')return config().emptyEvents?[]:simulation.events
   if(table==='event_segments')return config().emptyActivities?[]:simulation.event_segments
   if(table==='facilities')return simulation.facilities
   return simulation[table]||[]
  }
  return table==='facilities'?state.facilities:[]
 }
 function query(table){
  if(!allowedTables.has(table)){
   controls.recordUnexpected('Table: '+table)
   throw Error('Unhandled foundation table: '+table)
  }
  const predicates=[],orders=[]
  let start=0,end=Infinity,single=false
  const q={
   select(){return q},eq(k,v){predicates.push(r=>String(r[k])===String(v));return q},
   neq(k,v){predicates.push(r=>String(r[k])!==String(v));return q},
   in(k,values){predicates.push(r=>values.map(String).includes(String(r[k])));return q},
   gte(k,v){predicates.push(r=>r[k]>=v);return q},lte(k,v){predicates.push(r=>r[k]<=v);return q},
   order(k,options={}){orders.push([k,options.ascending!==false]);return q},
   limit(n){end=n-1;return q},range(a,b){start=a;end=b;return q},
   single(){single=true;return q},maybeSingle(){single=true;return q},
   async then(resolve,reject){try{
    calls.push({name:'select',table})
    if(config().holdTable===table)await new Promise(done=>pendingReads.add(done))
    if(table==='ops_events'&&config().opsSample)return resolve({data:null,error:{code:'42P01',message:'Intentional fixture: sample-plan fallback'}})
    if(config().tableError===table)return resolve({data:null,count:null,error:{message:'Fixture read denied: '+table}})
    let rows=tableRows(table).filter(r=>predicates.every(fn=>fn(r)))
    rows=[...rows].sort((a,b)=>{for(const [k,asc]of orders){const d=String(a[k]??'').localeCompare(String(b[k]??''),undefined,{numeric:true});if(d)return asc?d:-d}return 0})
    resolve({data:single?(rows[0]||null):structuredClone(rows.slice(start,end+1)),count:rows.length,error:null})
   }catch(error){reject?.(error)}},
  }
  return q
 }
 async function rpc(name,args={}){
  if(config().rpcError===name)return {data:null,error:{message:'Fixture operation denied: '+name}}
  // App.vue mounts the meeting pane alongside the simulator. Supply its exact
  // empty read contracts without permitting any meeting mutations.
  const meetingResult=await meetingRpc(name,args)
  if(meetingResult!==undefined)return meetingResult

  if(name==='rpc_simulator_event_sources')return ok({contract_version:1,links:[]})
  if(name==='rpc_simulator_event_roster'){
   if(config().rosterError===args.p_event_id)return {data:null,error:{message:'Fixture roster denied'}}
   return ok({event_id:args.p_event_id,club_id:1,members:simulation.members.map(m=>({
    member_id:m.id,full_name:m.full_name,club_id:1,academic_year:'2026/2027'}))})
  }
  if(name==='rpc_simulator_plan_history'&&config().savedHistory)return ok({plans:[{
   id:'fixture-saved-'+args.p_event_id,event_id:args.p_event_id,title:'Fixture saved recovery '+args.p_event_id,
   application_status:'Draft',lifecycle:'In Progress',workflow_status:'In Progress',changes:[],disruptions:[],version:1}],invitations:[],audit:[]})
  // Scheduling alerts are recorded locally; this fixture never sends Telegram.
  if(name==='rpc_notify_schedule_change')return ok({})
  if(name==='rpc_my_notifications')return ok(state.notifications)
  if(name==='rpc_mark_notifications_read'){for(const n of state.notifications)if(args.p_notification_id==null||n.id===args.p_notification_id)n.is_read=true;persist();return ok({})}
  if(name==='rpc_delete_notifications'){state.notifications=state.notifications.filter(n=>args.p_notification_id!=null&&n.id!==args.p_notification_id);persist();return ok({})}
  if(name==='rpc_create_telegram_link_code')return ok('fixture-link-code')
  if(name==='rpc_osl_pending_transfers')return ok(state.transfers)
  if(name==='rpc_recent_transfer_decisions')return ok(state.decisions)
  if(name==='rpc_club_transfers')return ok([...state.transfers,...state.decisions])
  if(name==='rpc_transfer_audit_history')return ok([{audit_event_id:1,action:'CLAIMED',actor_name:'Fixture Exco',created_at:'2026-11-03T01:00:00Z'}])
  if(name==='rpc_request_osl_email'){state.transfers.forEach(t=>t.osl_email_status='SENT');persist();return ok({})}
  const b=state.calendar.find(b=>b.booking_id===args.p_booking_id)
  if(name==='rpc_release_booking'&&b){b.status='Proposed Peer Transfer';persist();return ok({})}
  if(name==='rpc_undo_release'&&b){b.status='Booked';persist();return ok({})}
  if(name==='rpc_claim_booking'&&b){
   b.status='Pending Admin Sign-off';b.claiming_club_id=71;b.claiming_club_name='Fixture Arts Club';b.transfer_id=801
   state.transfers=[{...transfer,...b,booking_status:b.status,state:'CLAIMED'}]
   state.waitlist=state.waitlist.map(e=>e.booking_id===b.booking_id?{...e,status:'CLAIMED'}:e)
   persist();return ok({})
  }
  if(name==='rpc_join_waitlist'&&b){
   state.waitlist.push({...b,entry_id:902,club_id:71,club_name:'Fixture Arts Club',queue_position:1,status:'WAITING',booking_status:b.status})
   b.waitlist_count=1;persist();return ok({queue_position:1})
  }
  if(name==='rpc_leave_waitlist'){
   state.waitlist=state.waitlist.filter(e=>e.booking_id!==args.p_booking_id)
   if(b)b.waitlist_count=0;persist();return ok({})
  }
  if(['rpc_approve_transfer','rpc_reject_transfer'].includes(name)){
   const t=state.transfers.find(t=>t.transfer_id===args.p_transfer_id)
   if(!t)return {data:null,error:{message:'Fixture transfer missing'}}
   const approved=name==='rpc_approve_transfer'
   state.decisions.push({...t,state:approved?'APPROVED':'REJECTED',rejection_reason:args.p_reason,confirmation_email_status:'QUEUED'})
   state.transfers=state.transfers.filter(row=>row!==t)
   const booking=state.calendar.find(b=>b.booking_id===t.booking_id)
   if(booking){booking.status=approved?'Officially Confirmed Booking':'Proposed Peer Transfer';if(approved){booking.owner_club_id=71;booking.owner_club_name='Fixture Arts Club'}}
   persist();return ok({})
  }
  return undefined
 }
 return {query,rpc,controls}
}

